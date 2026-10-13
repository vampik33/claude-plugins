/** A check runs after this many tool calls, and once more at the turn's end. */
export const CHECK_EVERY = 10;
/** During a turn, rewrites are at least this far apart; a turn's end may always rewrite. */
export const MIN_GAP_MS = 5 * 60_000;
/** How often the background shells still running are looked at, for progress to show. */
export const PROGRESS_EVERY_MS = 30 * 60_000;
/** How much of a running shell's output, from its end, a progress check reads. */
export const TAIL_BYTES = 2_000;
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

export type JevQuestion = "big" | "update" | "progress";

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

/** Jev's yes/no: has the running commands' output changed the picture? */
export function jevProgressRequest(turn: Activity, running: readonly Progress[]) {
  return jevBody(
    "progress",
    {
      request: cut(turn.prompt),
      runningCommands: running.map((r) => ({
        command: cut(r.command),
        latestOutput: r.tail,
      })),
    },
    "A visual summary of this session's work was written earlier, while these long-running commands kept running. Does their latest output change the picture enough that the summary needs rewriting?",
    {
      true: "a phase or step finished, a failure or error appeared, or progress moved well past where the summary last showed it",
      false:
        "the same step still running, or output that only repeats or adds noise",
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
  toolUses: readonly {
    tool: string;
    input: Record<string, unknown>;
    /** The result as the model read it, once answered. */
    text?: string;
  }[];
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

/** A background shell the transcript shows started and not yet ended. */
export type LiveShell = { id: string; command: string; outputFile: string };

/**
 * The background shells still running: a Bash result that moved its command
 * to the background (its id and output file), with no task notification for
 * that id after it.
 */
export function liveShells(messages: readonly Message[]): LiveShell[] {
  const live = new Map<string, LiveShell>();
  for (const m of messages) {
    if (m.role === "user") {
      if (!m.text.includes("<task-notification>")) continue;
      for (const [, id] of m.text.matchAll(/<task-id>([^<]+)<\/task-id>/g))
        live.delete(id!.trim());
      continue;
    }
    for (const u of m.toolUses) {
      if (u.tool !== "Bash" || typeof u.text !== "string") continue;
      const id = /running in background with ID: ([\w-]+)/.exec(u.text)?.[1];
      const outputFile = /Output is being written to: (\S+?\.output)/.exec(
        u.text,
      )?.[1];
      if (id && outputFile)
        live.set(id, {
          id,
          command: typeof u.input.command === "string" ? u.input.command : "",
          outputFile,
        });
    }
  }
  return [...live.values()];
}

/** A running command and the end of its output, as a summary shows its progress. */
export type Progress = { command: string; tail: string };

/** Where the summary is shown: an HTML page in an Orca tab, or text in a terminal pane. */
export type Format = "html" | "text";

/** The text summary's widest line, so the pane need not wrap a diagram. */
export const TEXT_WIDTH = 60;

const HTML_CONTRACT = `The summary is one self-contained HTML page:
- Text sketches (pseudocode, call trees, file trees, diffs) go in <pre> blocks; color diff lines.
- Mermaid diagrams go in <pre class="mermaid"> blocks; the page gets its Mermaid script added, so write no <script> at all.
- No external scripts, styles, fonts or images. Inline CSS, light and dark via prefers-color-scheme, readable in a narrow side panel.
- Open with a title and one short paragraph; real file names, functions and labels from the session. Claim nothing the session does not show.
- It is a diagram summary: at least one Mermaid diagram of how the pieces connect or flow, and a text sketch (a file tree or call tree) of what changed. Prose only labels the visuals.

Reply with the HTML document alone, starting with <!doctype html>: no prose, no code fence.`;

const TEXT_CONTRACT = `The summary is plain text for a terminal side pane, no line of a diagram wider than ${TEXT_WIDTH} characters:
- A line starting with "# " is a section heading; the first line is "# " and the title.
- Diagrams and sketches (file trees, call trees, pseudocode, diffs, and flows drawn with box-drawing characters like ┌─┐│└┘├▶→ where show-me would use Mermaid) go between two lines of three backticks alone, shown as written.
- Prose is short paragraphs, a blank line between them; it wraps to the pane.
- Nothing else: no Markdown emphasis, links or tables, no HTML, no escape codes.
- Real file names, functions and labels from the session. Claim nothing the session does not show.
- It is a diagram summary: at least one diagram of how the pieces connect or flow, and a file tree or call tree of what changed. Prose only labels the visuals.

Reply with the summary alone: no preamble, no fence around all of it.`;

/** The system prompt: show-me's guidance, then the format's contract. Fixed, so cached. */
export function summarySystem(showMe: string, format: Format): string {
  return `You write a visual summary of a person's coding session with Claude: what was done and why, how the pieces fit, what is still in progress or next. Follow this guidance for choosing the views:

<show-me>
${showMe}
</show-me>

${format === "html" ? HTML_CONTRACT : TEXT_CONTRACT}`;
}

const runningSection = (running: readonly Progress[]) =>
  running.length === 0
    ? ""
    : `\n\n<running-commands>\nThese commands are still running; show where they stand.\n${running
        .map((r) => `$ ${cut(r.command)}\n${r.tail}`)
        .join("\n\n")}\n</running-commands>`;

/** The user message: the session, the commands still running, and the page to update when there is one. */
export function summaryPrompt(
  session: string,
  previous?: string,
  running: readonly Progress[] = [],
): string {
  const now = `<session>\n${session}\n</session>${runningSection(running)}`;
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

/** The one script a summary runs: Mermaid, from MERMAID_URL. */
export const MERMAID_LOADER = `<script type="module">import mermaid from "${MERMAID_URL}"; mermaid.initialize({ startOnLoad: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });</script>`;
/** sha256 of MERMAID_LOADER's body, base64: the CSP lets it run and no other inline script. */
export const MERMAID_LOADER_SHA256 =
  "Olg3I0JmxL6iPaXBstF8PxlFzHJ/YejN9UP70TigNEw=";

/**
 * Only the Mermaid loader and Mermaid's own files may run: no other script,
 * no request out but Mermaid's, no base, form or frame. Allows inline styles
 * and data: images, which Mermaid draws with.
 */
export const SUMMARY_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${MERMAID_LOADER_SHA256}' ${MERMAID_URL.slice(0, MERMAID_URL.lastIndexOf("/dist/") + 1)}`,
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

/**
 * A model-written page made safe to open: its scripts, every <meta> (an
 * http-equiv may be entity-encoded past any filter) and every <link> (a
 * dns-prefetch or preconnect reaches out past the CSP) dropped, and, before it, the
 * charset, the CSP and the Mermaid loader. The CSP comes first, so it
 * holds for all of the page; a later policy can only narrow it.
 */
export function securePage(html: string): string {
  // until nothing changes: a cut may join `<scr` and `ipt>` into a new tag
  let body = html.replace(/^\s*<!doctype[^>]*>/i, "");
  for (let was = ""; was !== body; ) {
    was = body;
    body = body
      .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, "")
      .replace(/<(meta|link)\b[^>]*>?/gi, "");
  }
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SUMMARY_CSP}">
${MERMAID_LOADER}
${body}`;
}

/** One piece of the text summary as the pane draws it. */
export type TextBlock = {
  kind: "heading" | "prose" | "sketch";
  /** A sketch's lines, as written; a heading's or a paragraph's one line. */
  lines: string[];
};

/** The model's text with escape sequences and other control characters gone. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "")
    .trim();
}

/** The text summary in headings, paragraphs and sketches; an unclosed sketch runs to the end. */
export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let prose: string[] = [];
  let sketch: string[] | undefined;
  const flush = () => {
    if (prose.length) blocks.push({ kind: "prose", lines: [prose.join(" ")] });
    prose = [];
  };
  for (const line of cleanText(text).split("\n")) {
    if (/^\s*```/.test(line)) {
      if (sketch) {
        if (sketch.length) blocks.push({ kind: "sketch", lines: sketch });
        sketch = undefined;
      } else {
        flush();
        sketch = [];
      }
    } else if (sketch) sketch.push(line);
    else if (/^#+\s+\S/.test(line)) {
      flush();
      blocks.push({ kind: "heading", lines: [line.replace(/^#+\s+/, "")] });
    } else if (line.trim() === "") flush();
    else prose.push(line.trim());
  }
  flush();
  if (sketch?.length) blocks.push({ kind: "sketch", lines: sketch });
  return blocks;
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
