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

/** The file a call writes or edits, if it is one that does. */
const editedPath = (tool: string, input: Readonly<Record<string, unknown>>) => {
  const path = input.file_path ?? input.notebook_path;
  return EDITING.has(tool) && typeof path === "string" ? path : undefined;
};

/** The activity with one more tool call that went through. */
export function logTool(
  a: Activity,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Activity {
  const next = { ...a, tools: a.tools + 1 };
  const path = editedPath(tool, input);
  if (path !== undefined && !a.edits.includes(path))
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

/**
 * Jev's yes/no: is new output from these running commands worth a rewrite?
 * Jev is a third party: it gets the commands, never their output (which may
 * hold secrets); only Haiku reads that.
 */
export function jevProgressRequest(turn: Activity, running: readonly Progress[]) {
  return jevBody(
    "progress",
    {
      request: cut(turn.prompt),
      runningCommands: running.map((r) => cut(r.command)),
    },
    "A visual summary of this session's work was written earlier, while these long-running commands kept running. They have printed new output since. Is their progress likely worth rewriting the summary for?",
    {
      true: "builds, test suites, benchmarks, migrations, deploys or other long jobs whose progress or result is part of the work's picture",
      false:
        "servers, watchers, log tails or other commands that run on without a result to show",
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
    /** The tool's record, once answered (a Bash one's `backgroundTaskId`). */
    result?: unknown;
    /** Present only when the tool reported an error. */
    isError?: true;
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

/** A row the person typed: not a tool result, not a tag (a reminder, a command, a notification). */
const isTyped = (m: Message) => {
  const text = m.text.trim();
  return (
    m.role === "user" &&
    !m.toolResults?.length &&
    text !== "" &&
    !text.startsWith("<")
  );
};

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
      if (!isTyped(m)) continue;
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

const TOP_FILES = 15;
const TOP_TOOLS = 10;

/** The session's numbers for the page's charts, counted from the transcript, never by the model. */
export type Stats = {
  /** Prompts the person typed. */
  prompts: number;
  toolCalls: number;
  commandsRun: number;
  subagents: number;
  /** Files written or edited, each once: only by calls answered without an error. */
  filesEdited: number;
  /** The TOP_FILES most edited files, by edits that went through; most first, ties in the order first edited. */
  topFiles: { file: string; edits: number }[];
  /** The TOP_TOOLS most used tools, most calls first; ties in the order first used. */
  topTools: { tool: string; calls: number }[];
};

/** The counts, most first; the sort is stable, so ties keep the order first seen. */
const top = (counts: Map<string, number>, n: number) =>
  [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);

const bump = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);

/** The main conversation's numbers: what was typed, the tools Claude called, the files it wrote or edited. */
export function sessionStats(messages: readonly Message[]): Stats {
  let prompts = 0;
  let toolCalls = 0;
  const tools = new Map<string, number>();
  const files = new Map<string, number>();
  for (const m of messages) {
    if (isTyped(m)) prompts++;
    if (m.role !== "assistant") continue;
    for (const u of m.toolUses) {
      toolCalls++;
      bump(tools, u.tool);
      const path = editedPath(u.tool, u.input);
      // a failed, refused or unanswered write changed no file; it still counts as a call
      if (path !== undefined && typeof u.text === "string" && !u.isError)
        bump(files, path);
    }
  }
  return {
    prompts,
    toolCalls,
    commandsRun: tools.get("Bash") ?? 0,
    subagents: tools.get("Agent") ?? 0,
    filesEdited: files.size,
    topFiles: top(files, TOP_FILES).map(([file, edits]) => ({ file, edits })),
    topTools: top(tools, TOP_TOOLS).map(([tool, calls]) => ({ tool, calls })),
  };
}

/** A background shell the transcript shows started and not yet ended. */
export type LiveShell = { id: string; command: string; outputFile: string };

/**
 * The background shells still running: a Bash call whose record names the
 * task it moved to the background, with no task notification for that id
 * after it. The id is the record's, never the result text's: a command's
 * output may say anything, so the text only gives the file, and only one
 * named for that id in a `tasks` directory.
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
      const id = (u.result as { backgroundTaskId?: unknown } | undefined)
        ?.backgroundTaskId;
      if (typeof id !== "string" || !/^[\w-]+$/.test(id)) continue;
      const outputFile = new RegExp(
        `Output is being written to: (/\\S*/tasks/${id}\\.output)`,
      ).exec(u.text)?.[1];
      if (outputFile && !outputFile.split("/").includes(".."))
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

const HTML_CONTRACT = `The summary is one self-contained HTML page that opens in a full browser window. It is read on its own and later, by the person who asked and by someone who never saw the code, so it explains as well as shows: use as many views as the work needs, more than a chat answer would.

The page, top to bottom:
1. An <h1> title, then <p class="tldr">: two or three plain sentences on what was done and why.
2. "At a glance": the numbers in <stats> as <div class="stats"> tiles (<div class="stat"><span class="num">12</span><span class="label">files edited</span></div>), then a bar chart of the most edited files. Every number on the page comes from <stats> or the session; never estimate one.
3. One <section> per piece of the work: an <h2>, a line on what was done and why, then its views: a Mermaid diagram for how things connect or flow, a text sketch for the shape of the code, a <table> for anything with several facts per item (files, options, before and after, test results). Each of these sections ends with <aside class="eli5"><div class="pic">…</div><h3>In simple words</h3><p>…</p></aside>: the pic is a big emoji picture of the idea (like 📦 → 🔍 → ✅) or a small inline <svg>, then two to four short sentences for someone who knows nothing about code: an everyday comparison, no jargon, no file or function names. It says what its section says and nothing more; when no honest comparison fits, say it plainly without one.
4. "Still open / next": a <table> of what is in progress, blocked or next, each with <span class="status done">, "wip", "blocked" or "next".

The views:
- Mermaid in <pre class="mermaid">: flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, timeline, mindmap or pie. Keep labels short; in a flowchart wrap a label with punctuation in double quotes (A["Send (later)"]), elsewhere write labels without quotes; no < or & in a diagram. The page gets its Mermaid script added, so write no <script> at all.
- Text sketches (pseudocode, call trees, file trees) in <pre>; a diff in <pre class="diff">, each added line in <span class="add">, each removed one in <span class="del">.
- A bar chart: <div class="bars"> holding one <div class="bar"><span class="label">name</span><span class="track"><span class="fill" style="width:N%"></span></span><span class="value">count</span></div> per item, N its count as a percent of the largest.
- Pictures: emoji, or inline <svg> drawn with shapes and text in currentColor so it shows in light and dark. No image files and no URLs.
- <div class="grid"> sets two views side by side on a wide screen.
- No <details>: the page reloads itself every minute, which would close them.

The page gets a stylesheet for all of the above, light and dark; write no <style> but a few lines for something it lacks. No external scripts, styles, fonts or images. Use real file names (relative to the project), functions and labels from the session; claim nothing the session does not show.

Reply with the HTML document alone, starting with <!doctype html>: no prose, no code fence.`;

/** The system prompt: show-me's guidance, then the page's contract. Fixed, so cached. */
export function summarySystem(showMe: string): string {
  return `You write a visual summary of a person's coding session with Claude: what was done and why, how the pieces fit, what is still in progress or next. Use this guidance for how to draw each view; the page contract after it says how many views the page has and what it holds:

<show-me>
${showMe}
</show-me>

${HTML_CONTRACT}`;
}

const runningSection = (running: readonly Progress[]) =>
  running.length === 0
    ? ""
    : `\n\n<running-commands>\nThese commands are still running; show where they stand.\n${running
        .map((r) => `$ ${cut(r.command)}\n${r.tail}`)
        .join("\n\n")}\n</running-commands>`;

const statsSection = (stats: Stats) =>
  `\n\n<stats>\nCounted over the main conversation; subagents' own tool calls are not in it.\n${JSON.stringify(stats)}\n</stats>`;

/** The page without its <style> blocks. */
const withoutStyle = (html: string) =>
  html.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");

/**
 * The user message: the session and its numbers, the commands still running,
 * and the page to update when there is one, its <style> dropped: the page gets
 * the stylesheet, and a copied older style would override it.
 */
export function summaryPrompt(
  session: string,
  stats: Stats,
  previous?: string,
  running: readonly Progress[] = [],
): string {
  const now = `<session>\n${session}\n</session>${statsSection(stats)}${runningSection(running)}`;
  return previous === undefined
    ? `${now}\n\nWrite the summary of this session's work.`
    : `${now}\n\n<previous-summary>\n${withoutStyle(previous)}\n</previous-summary>\n\nUpdate the previous summary to the session as it stands: keep what still holds and its diagrams where they still fit; add, change or drop what the newer work changed; and bring it to the page contract wherever it differs.`;
}

/** The HTML document in the model's reply, fences and prose around it dropped. */
export function extractHtml(text: string): string | undefined {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  // searched in the text itself: toLowerCase can change its length (İ)
  const end = [...text.matchAll(/<\/html>/gi)].at(-1)?.index ?? -1;
  if (start < 0 || end < start) return undefined;
  return text.slice(start, end + "</html>".length);
}

/** The one script a summary runs: Mermaid, from MERMAID_URL. */
export const MERMAID_LOADER = `<script type="module">import mermaid from "${MERMAID_URL}"; mermaid.initialize({ startOnLoad: true, suppressErrorRendering: true, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });</script>`;
/** sha256 of MERMAID_LOADER's body, base64: the CSP lets it run and no other inline script. */
export const MERMAID_LOADER_SHA256 =
  "DTPBEJKVzw3cY3urPFbmMtctTmCtnopRL7fHkxEQQGs=";

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

/** How often the open page reloads itself, so a rewrite shows without the mod reaching the browser. */
export const REFRESH_S = 60;
const REFRESH_META = `<meta http-equiv="refresh" content="${REFRESH_S}">`;

/**
 * The page's stylesheet, light and dark: the classes the contract names, so
 * the model writes none and every rewrite looks the same.
 */
export const BASE_CSS = `:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1d1f21;--muted:#5f6368;--card:#fff;--line:#d9dadc;--accent:#2b6cb0;--code:#f0f1f3;--add:#1a7f37;--add-bg:#e6ffec;--del:#cf222e;--del-bg:#ffebe9;--eli5:#fff8e1;--eli5-line:#e9c46a;--done:#1a7f37;--wip:#b26a00;--blocked:#cf222e;--next:#2b6cb0}
@media (prefers-color-scheme:dark){:root{--bg:#161718;--fg:#e6e6e6;--muted:#9aa0a6;--card:#1f2022;--line:#3a3c40;--accent:#7fb3ff;--code:#111213;--add:#56d364;--add-bg:#0f2a18;--del:#ff7b72;--del-bg:#3a1417;--eli5:#2a2414;--eli5-line:#8a6d1f;--done:#56d364;--wip:#e3a33b;--blocked:#ff7b72;--next:#7fb3ff}}
*{box-sizing:border-box}
body{max-width:1100px;margin:0 auto;padding:24px 16px 48px;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:1.9rem;line-height:1.25;margin:0 0 8px}
h2{font-size:1.35rem;margin:40px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:1.05rem;margin:0 0 4px}
p{margin:8px 0}
a{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-size:.9em;background:var(--code);padding:1px 5px;border-radius:4px}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0;overflow-x:auto;font-size:13px;line-height:1.45}
pre.mermaid{background:var(--card);text-align:center}
pre.diff .add{color:var(--add);background:var(--add-bg)}
pre.diff .del{color:var(--del);background:var(--del-bg)}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.95rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:var(--code)}
.tldr{font-size:1.1rem;background:var(--card);border-left:4px solid var(--accent);border-radius:6px;padding:12px 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat .num{display:block;font-size:1.8rem;font-weight:700;line-height:1.2}
.stat .label{color:var(--muted);font-size:.9rem}
.bars{display:grid;gap:6px;margin:16px 0}
.bar{display:grid;grid-template-columns:minmax(120px,30%) 1fr 3.5em;align-items:center;gap:10px;font-size:.92rem}
.bar .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .track{height:14px;background:var(--code);border-radius:4px;overflow:hidden}
.bar .fill{display:block;height:100%;background:var(--accent);border-radius:4px}
.bar .value{text-align:right;color:var(--muted)}
aside.eli5{background:var(--eli5);border:1px solid var(--eli5-line);border-radius:12px;padding:14px 18px;margin:16px 0}
aside.eli5 .pic{font-size:2.4rem;line-height:1.3;text-align:center;margin-bottom:6px}
aside.eli5 .pic svg{max-width:100%;height:auto}
.status{display:inline-block;padding:0 10px;border:1px solid currentColor;border-radius:999px;font-size:.85rem;white-space:nowrap}
.status.done{color:var(--done)}.status.wip{color:var(--wip)}.status.blocked{color:var(--blocked)}.status.next{color:var(--next)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:16px;align-items:start}
@media (max-width:640px){body{padding:16px 12px 32px}table{display:block;overflow-x:auto}.bar{grid-template-columns:40% 1fr 3em}}`;

const BASE_STYLE = `<style data-big-picture>${BASE_CSS}</style>`;

/**
 * A model-written page made safe to open: its scripts, every <meta> (an
 * http-equiv may be entity-encoded past any filter) and every <link> (a
 * dns-prefetch or preconnect reaches out past the CSP) dropped, and, before it, the
 * charset, the CSP, the mod's own refresh, the Mermaid loader and the stylesheet. The CSP comes
 * first, so it holds for all of the page; a later policy can only narrow it.
 * A page read back from disk (after a reload) carries the stylesheet, which
 * is dropped too, so a rewrite of it holds one.
 */
export function securePage(html: string): string {
  // until nothing changes: a cut may join `<scr` and `ipt>` into a new tag
  let body = html
    .replace(/^\s*<!doctype[^>]*>/i, "")
    .replace(/<style data-big-picture>[\s\S]*?<\/style>/g, "");
  for (let was = ""; was !== body; ) {
    was = body;
    body = body
      .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, "")
      .replace(/<(meta|link)\b[^>]*>?/gi, "");
  }
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SUMMARY_CSP}">
${REFRESH_META}
${MERMAID_LOADER}
${BASE_STYLE}
${body}`;
}

/** The model's text with escape sequences and other control characters gone. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "")
    .trim();
}

const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** The page shown before a summary exists. */
export function placeholderHtml(text: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">${REFRESH_META}<title>Big picture</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:2rem;opacity:.7}</style>
</head><body><p>${escape(text)}</p></body></html>`;
}

/** Seconds the opener waits for xdg-open to fail before taking the page as opened; under OPEN_MS. */
export const OPEN_WAIT_S = 5;

/** How long the mod lets the opener run. */
export const OPEN_MS = 10_000;

/**
 * Opens `url` in the default browser: xdg-open, else macOS's open. Its output
 * goes to /dev/null, so a browser it starts holds no pipe of the mod's open.
 * Outside GNOME and KDE, xdg-open runs the browser in the foreground until it
 * exits, so it runs in its own session in the background: an exit within
 * OPEN_WAIT_S gives its code, one still running then is a browser that opened.
 */
export function openArgv(url: string, waitS = OPEN_WAIT_S): string[] {
  return [
    "sh",
    "-c",
    `exec </dev/null >/dev/null 2>&1
if command -v xdg-open >/dev/null; then
  if command -v setsid >/dev/null; then setsid xdg-open "$1" & else xdg-open "$1" & fi
  pid=$!
  i=0
  while [ "$i" -lt ${waitS * 5} ]; do
    sleep 0.2
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit; }
    i=$((i + 1))
  done
  exit 0
fi
exec open "$1"`,
    "sh",
    url,
  ];
}

/** `09:05`, local time. */
export function fmtTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
