/** A check runs after this many tool calls, and once more at the turn's end. */
export const CHECK_EVERY = 10;
/** During a turn, rewrites are at least this far apart; a turn's end may always rewrite. */
export const MIN_GAP_MS = 5 * 60_000;
/** Jev's p(yes) at or above which the work counts as big. */
export const BIG_AT = 0.5;
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const MERMAID_URL =
  "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";

const MAX_COMMANDS = 30;
const MAX_TEXT = 200;

/** What the current turn has done, as Jev reads it. */
export type Activity = {
  prompt: string;
  /** Tool calls that went through, subagents' included. */
  tools: number;
  /** Files written or edited, each once, in order. */
  edits: string[];
  /** Shell commands run, the first MAX_COMMANDS, each cut short. */
  commands: string[];
  /** Subagents started, by description. */
  agents: string[];
};

export function emptyActivity(prompt: string): Activity {
  return { prompt, tools: 0, edits: [], commands: [], agents: [] };
}

const cut = (s: string) =>
  s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;

const EDITING = new Set(["Write", "Edit", "NotebookEdit"]);

/** The activity with one more tool call that went through. */
export function logTool(
  a: Activity,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Activity {
  const next = { ...a, tools: a.tools + 1 };
  const path = input.file_path ?? input.notebook_path;
  if (EDITING.has(tool) && typeof path === "string" && !a.edits.includes(path))
    next.edits = [...a.edits, path];
  if (
    tool === "Bash" &&
    typeof input.command === "string" &&
    a.commands.length < MAX_COMMANDS
  )
    next.commands = [...a.commands, cut(input.command)];
  if (tool === "Agent" && typeof input.description === "string")
    next.agents = [...a.agents, cut(input.description)];
  return next;
}

/** `a`, then `b` logged after it, as one activity. */
export function mergeActivity(a: Activity, b: Activity): Activity {
  return {
    prompt: b.prompt || a.prompt,
    tools: a.tools + b.tools,
    edits: [...a.edits, ...b.edits.filter((e) => !a.edits.includes(e))],
    commands: [...a.commands, ...b.commands].slice(0, MAX_COMMANDS),
    agents: [...a.agents, ...b.agents],
  };
}

/** A check is due at every CHECK_EVERY-th tool call. */
export const isCheckDue = (a: Activity) =>
  a.tools > 0 && a.tools % CHECK_EVERY === 0;

/** Whether a check may lead to a rewrite: always at a turn's end, else MIN_GAP_MS after the last. */
export const isRewriteDue = (
  now: number,
  lastWrittenAt: number | undefined,
  isTurnEnd: boolean,
) =>
  isTurnEnd || lastWrittenAt === undefined || now - lastWrittenAt >= MIN_GAP_MS;

/** Work that changed no file is never big: Jev is not asked. */
export const mayBeBig = (a: Activity) => a.edits.length > 0;

const workDone = (a: Activity) => ({
  toolCalls: a.tools,
  filesChanged: a.edits,
  commandsRun: a.commands,
  subagents: a.agents,
});

const jevBody = (
  name: JevQuestion,
  state: unknown,
  instructions: string,
  criteria: { true: string; false: string },
) => ({
  model: "jev-latest",
  state,
  questions: { [name]: { type: "noul", instructions, criteria } },
});

export type JevQuestion = "big" | "update";

/** Jev's yes/no: is the turn's work big enough for a visual summary? */
export function jevBigRequest(turn: Activity) {
  return jevBody(
    "big",
    { request: cut(turn.prompt), ...workDone(turn) },
    "Is this a big piece of coding work, worth a visual summary with diagrams for the person who asked for it?",
    {
      true: "a feature, a refactor or a fix spanning several files or steps; a reviewer would want the big picture",
      false:
        "a small tweak, a one-file fix, a question answered, or mostly reading and searching",
    },
  );
}

/** Jev's yes/no: has the work since the last summary changed its picture? */
export function jevUpdateRequest(turn: Activity, since: Activity) {
  return jevBody(
    "update",
    { request: cut(turn.prompt), workSinceTheSummary: workDone(since) },
    "A visual summary of this session's work was written earlier. Has the work done since changed the picture enough that the summary needs rewriting?",
    {
      true: "new files, components, flows or decisions the summary cannot show, or a step finished that it shows as open",
      false:
        "small follow-ups, test runs, formatting or fixes inside what the summary already shows",
    },
  );
}

/** p(yes) of the named question from Jev's reply, or undefined when it is not one. */
export function parseJev(text: string, name: JevQuestion): number | undefined {
  try {
    const answers = (
      JSON.parse(text) as { answers?: Record<string, { noul?: unknown }> }
    ).answers;
    const p = answers?.[name]?.noul;
    return typeof p === "number" && p >= 0 && p <= 1 ? p : undefined;
  } catch {
    return undefined;
  }
}

/** One transcript row, as `$.session.messages()` gives it. */
export type Message = {
  role: "user" | "assistant";
  text: string;
  toolUses: readonly { tool: string; input: Record<string, unknown> }[];
  toolResults?: readonly unknown[];
};

const DIGEST_CHARS = 60_000;

/** One tool use in a line: the tool and its file, command, description or pattern. */
export function toolLine(tool: string, input: Record<string, unknown>): string {
  const what = [
    input.file_path,
    input.command,
    input.description,
    input.pattern,
  ].find((v) => typeof v === "string") as string | undefined;
  return what ? `${tool} ${cut(what.split("\n")[0]!)}` : tool;
}

/**
 * The transcript in lines a small model reads: what the person typed, what
 * Claude said, each tool used; the newest that fit in `max` characters.
 */
export function digest(
  messages: readonly Message[],
  max = DIGEST_CHARS,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    const text = m.text.trim();
    if (m.role === "user") {
      if (m.toolResults?.length || text === "" || text.startsWith("<"))
        continue;
      lines.push(`USER: ${text}`);
    } else {
      if (text !== "") lines.push(`CLAUDE: ${text}`);
      for (const u of m.toolUses)
        lines.push(`  → ${toolLine(u.tool, u.input)}`);
    }
  }
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    size += lines[i]!.length + 1;
    if (size > max) break;
    kept.unshift(lines[i]!);
  }
  return kept.join("\n");
}

/** The system prompt: show-me's guidance, then the page's contract. Fixed, so cached. */
export function summarySystem(showMe: string): string {
  return `You write a visual summary of a person's coding session with Claude: what was done and why, how the pieces fit, what is still in progress or next. Follow this guidance for choosing the views:

<show-me>
${showMe}
</show-me>

The summary is one self-contained HTML page:
- Text sketches (pseudocode, call trees, file trees, diffs) go in <pre> blocks; color diff lines.
- Mermaid diagrams go in <pre class="mermaid"> blocks, rendered by this script and no other: <script type="module">import mermaid from "${MERMAID_URL}"; mermaid.initialize({ startOnLoad: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });</script>
- No other external scripts, styles, fonts or images. Inline CSS, light and dark via prefers-color-scheme, readable in a narrow side panel.
- Open with a title and one short paragraph; real file names, functions and labels from the session. Claim nothing the session does not show.
- It is a diagram summary: at least one Mermaid diagram of how the pieces connect or flow, and a text sketch (a file tree or call tree) of what changed. Prose only labels the visuals.

Reply with the HTML document alone, starting with <!doctype html>: no prose, no code fence.`;
}

/** The user message: the session, and the page to update when there is one. */
export function summaryPrompt(session: string, previous?: string): string {
  const now = `<session>\n${session}\n</session>`;
  return previous === undefined
    ? `${now}\n\nWrite the summary of this session's work.`
    : `${now}\n\n<previous-summary>\n${previous}\n</previous-summary>\n\nUpdate the previous summary to the session as it stands: keep what still holds, its layout and diagrams where they still fit; add, change or drop what the newer work changed.`;
}

/** The HTML document in the model's reply, fences and prose around it dropped. */
export function extractHtml(text: string): string | undefined {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (start < 0 || end < start) return undefined;
  return text.slice(start, end + "</html>".length);
}

const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** The page shown before a summary exists. */
export function placeholderHtml(text: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Big picture</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:2rem;opacity:.7}</style>
</head><body><p>${escape(text)}</p></body></html>`;
}

/** `browserPageId` from `orca tab create --json`. */
export function parseTabId(stdout: string): string | undefined {
  try {
    const id = (JSON.parse(stdout) as { result?: { browserPageId?: unknown } })
      .result?.browserPageId;
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `orca tab list --json` still lists the page. */
export function hasTab(stdout: string, id: string): boolean {
  try {
    const tabs = (
      JSON.parse(stdout) as {
        result?: { tabs?: { browserPageId?: unknown }[] };
      }
    ).result?.tabs;
    return Array.isArray(tabs) && tabs.some((t) => t.browserPageId === id);
  } catch {
    return false;
  }
}

/** `09:05`, local time. */
export function fmtTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
