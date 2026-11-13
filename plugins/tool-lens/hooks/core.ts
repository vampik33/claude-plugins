/** Pure helpers for tool-lens: no `$`, so they are tested directly. */

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: readonly string[];
};

/** One changed file and its hunks. */
export type FileDiff = { path: string; hunks: readonly Hunk[] };

/** Most diff lines drawn under one call; the rest is counted. */
export const MAX_DIFF_LINES = 400;

const ICONS = new Map<string, string>([
  ["Edit", "✎"],
  ["Write", "✎"],
  ["NotebookEdit", "✎"],
  ["Read", "▤"],
  ["Grep", "⌕"],
  ["Glob", "⌕"],
  ["Bash", "$"],
  ["Monitor", "$"],
  ["WebFetch", "⇣"],
  ["WebSearch", "⇣"],
  ["Agent", "◈"],
  ["Task", "◈"],
  ["Skill", "✦"],
  ["TodoWrite", "☑"],
]);

/** The glyph for a tool: its own, `◆` for an MCP tool, `•` otherwise. */
export function iconOf(tool: string): string {
  return ICONS.get(tool) ?? (tool.startsWith("mcp__") ? "◆" : "•");
}

/** `45ms`, `1.2s`, `12s`, `3m 05s`. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Rough tokens for `chars` characters of text: about 4 per token. */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

/** `~840 tok`, `~1.2k tok`, `~35k tok`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return `~${n} tok`;
  if (n < 10_000) return `~${(Math.round(n / 100) / 10).toFixed(1)}k tok`;
  return `~${Math.round(n / 1000)}k tok`;
}

const RESERVED = new Set([
  "tool",
  "tool_use_id",
  "agentId",
  "requestMeta",
  "consent",
]);

/** Length of the arguments the model wrote: the call's input less the engine's keys. */
export function argsChars(input: Record<string, unknown>): number {
  // fromEntries defines own keys: an argument named `__proto__` is counted, not swallowed
  const args = Object.fromEntries(
    Object.entries(input).filter(([k]) => !RESERVED.has(k)),
  );
  return JSON.stringify(args).length;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function hunksOf(v: unknown): Hunk[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (h): h is Hunk =>
      isObj(h) &&
      typeof h.oldStart === "number" &&
      typeof h.newStart === "number" &&
      Array.isArray(h.lines),
  );
}

/**
 * The diffs a finished call's stored result holds: Edit's and Write's
 * `structuredPatch` (a created file as all-added lines), and Bash's
 * `bashEditDiff` (which Claude Code fills only on some models). An error
 * result is a string and holds none.
 */
export function diffsOf(tool: string, output: unknown): FileDiff[] {
  if (!isObj(output)) return [];
  if (tool === "Edit" || tool === "Write") {
    const path = typeof output.filePath === "string" ? output.filePath : "";
    const hunks = hunksOf(output.structuredPatch);
    if (hunks.length > 0) return [{ path, hunks }];
    if (output.type === "create" && typeof output.content === "string") {
      const lines = output.content.replace(/\n$/, "").split("\n");
      return [
        {
          path,
          hunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map((l) => `+${l}`),
            },
          ],
        },
      ];
    }
    return [];
  }
  if (tool === "Bash" && isObj(output.bashEditDiff)) {
    const files = output.bashEditDiff.files;
    if (!Array.isArray(files)) return [];
    return files
      .filter(isObj)
      .map((f) => ({
        path: typeof f.filePath === "string" ? f.filePath : "",
        hunks: hunksOf(f.hunks),
      }))
      .filter((f) => f.hunks.length > 0);
  }
  return [];
}

/**
 * Files a Bash call changed that its `bashEditDiff` lists no hunks for
 * (`moreFiles`): a diff drawn from `diffsOf` is then partial.
 */
export function omittedFiles(tool: string, output: unknown): number {
  if (tool !== "Bash" || !isObj(output) || !isObj(output.bashEditDiff))
    return 0;
  const more = output.bashEditDiff.moreFiles;
  return typeof more === "number" && more > 0 ? more : 0;
}

/** Lines added and removed across the diffs. */
export function countLines(diffs: readonly FileDiff[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const f of diffs) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.startsWith("+")) added++;
        else if (l.startsWith("-")) removed++;
      }
    }
  }
  return { added, removed };
}

// A Code source takes tab and newline as its only control characters.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Unified-diff sources for the diffs, one per file, holding at most `max`
 * diff lines in all; `cut` counts the lines left out. A hunk cut short gets
 * a header counting only the lines it keeps, so it still parses.
 */
export function diffSources(
  diffs: readonly FileDiff[],
  max = MAX_DIFF_LINES,
): { files: { path: string; source: string }[]; cut: number } {
  const files: { path: string; source: string }[] = [];
  let used = 0;
  let cut = 0;
  for (const f of diffs) {
    const parts: string[] = [];
    for (const h of f.hunks) {
      const keep = Math.max(0, Math.min(h.lines.length, max - used));
      cut += h.lines.length - keep;
      if (keep === 0) continue;
      used += keep;
      const lines = h.lines.slice(0, keep);
      const isWhole = keep === h.lines.length;
      const oldLines = isWhole
        ? h.oldLines
        : lines.filter((l) => !l.startsWith("+") && !l.startsWith("\\")).length;
      const newLines = isWhole
        ? h.newLines
        : lines.filter((l) => !l.startsWith("-") && !l.startsWith("\\")).length;
      parts.push(
        `@@ -${h.oldStart},${oldLines} +${h.newStart},${newLines} @@`,
        ...lines.map((l) => l.replace(CONTROL, "")),
      );
    }
    if (parts.length > 0)
      files.push({ path: f.path, source: parts.join("\n") });
  }
  return { files, cut };
}

/** A path relative to `cwd` when it lies inside it. */
export function shortPath(path: string, cwd: string | undefined): string {
  const base = cwd?.replace(/\/$/, "");
  return base && path.startsWith(`${base}/`)
    ? path.slice(base.length + 1)
    : path;
}

/** At most `max` characters, the rest an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** What a call acts on, for its line in a folded group: a path, a command, a pattern. */
export function callLabel(
  tool: string,
  input: unknown,
  cwd: string | undefined,
  max = 60,
): string {
  const name = tool.startsWith("mcp__")
    ? tool.slice(5).replace("__", ".")
    : tool;
  if (!isObj(input)) return name;
  const str = (k: string) => (typeof input[k] === "string" ? input[k] : "");
  const path = str("file_path") || str("notebook_path");
  const target =
    (path && shortPath(path, cwd)) ||
    (str("command").split("\n")[0] ?? "") ||
    str("pattern") ||
    str("url") ||
    str("query") ||
    str("description") ||
    str("skill");
  return clip(target ? `${name} ${target}` : name, max);
}

/** Most bytes of the session log read for a backfill: its tail, the latest calls. */
export const LOG_TAIL_BYTES = 4_000_000;

/**
 * Finds the session's log by its id in a project folder under the projects
 * folder and prints its last `LOG_TAIL_BYTES` bytes; prints nothing when there
 * is none yet. Null for an id that is not a plain name (a `/` or `..` would
 * leave the projects folder).
 */
export function logTailArgv(
  projectsDir: string,
  sessionId: string,
): string[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  return [
    "sh",
    "-c",
    'for f in "$1"/*/"$2".jsonl; do [ -f "$f" ] && exec tail -c "$3" "$f"; done; exit 0',
    "sh",
    projectsDir,
    sessionId,
    String(LOG_TAIL_BYTES),
  ];
}

/** The text of a tool_result block as the model read it: a string, or its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { text: string } =>
        isObj(b) && b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

/**
 * Durations and tokens of the calls a session log (JSONL) records: the time
 * from the row holding the tool_use to the row holding its result (approval
 * wait included), and the tokens of the arguments plus the result text. A
 * call whose tool_use row is not in the text (a tail cut it) is left out.
 */
export function parseLog(
  jsonl: string,
): Record<string, { ms?: number; tokens: number; isFromLog: true }> {
  const uses = new Map<string, { at: number; chars: number }>();
  const out: Record<string, { ms?: number; tokens: number; isFromLog: true }> =
    {};
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"tool_')) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // the tail's cut first line, or a torn write
    }
    if (!isObj(row) || !isObj(row.message)) continue;
    const content = row.message.content;
    if (!Array.isArray(content)) continue;
    const at =
      typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    for (const b of content) {
      if (!isObj(b)) continue;
      if (
        row.type === "assistant" &&
        b.type === "tool_use" &&
        typeof b.id === "string"
      ) {
        const input = isObj(b.input) ? b.input : {};
        uses.set(b.id, { at, chars: argsChars(input) });
      } else if (
        row.type === "user" &&
        b.type === "tool_result" &&
        typeof b.tool_use_id === "string"
      ) {
        const use = uses.get(b.tool_use_id);
        if (!use) continue;
        const ms = at - use.at;
        out[b.tool_use_id] = {
          ...(Number.isFinite(ms) && ms >= 0 ? { ms } : {}),
          tokens: estimateTokens(use.chars + resultText(b.content).length),
          isFromLog: true,
        };
      }
    }
  }
  return out;
}

/** Merges a new duration into what is stored: an exact one is never replaced by the wall clock. */
export function mergeMs<T extends { ms?: number; isExact?: boolean }>(
  stored: T | null,
  ms: number,
  isExact: boolean,
): T {
  const base = (stored ?? {}) as T;
  if (base.isExact && !isExact) return base;
  return { ...base, ms, isExact };
}
