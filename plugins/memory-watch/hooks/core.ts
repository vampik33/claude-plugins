import type { MemoryChange } from "../types";

export const MAX_CHANGES = 50;

/** `~/.claude/projects/<slug>/memory/<file>.md`, any project's. */
const MEMORY_PATH = /\/\.claude\/projects\/[^/]+\/memory\/([^/]+\.md)$/;

/** The file's name when the path is an auto-memory file, else undefined. */
export function memoryFile(path: string): string | undefined {
  return MEMORY_PATH.exec(path.replaceAll("\\", "/"))?.[1];
}

export type Frontmatter = {
  name?: string;
  description?: string;
  type?: string;
};

const FIELD = /^\s*(name|description|type):\s*(.*?)\s*$/;

/**
 * `name`, `description` and `type` from a leading `---` block, at any indent
 * (`type` sits under `metadata:`); the first of each wins, quotes stripped.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: Frontmatter = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") return out;
    const m = FIELD.exec(line);
    if (!m) continue;
    const key = m[1] as keyof Frontmatter;
    const value = (m[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (out[key] === undefined && value !== "") out[key] = value;
  }
  return {}; // never closed: not frontmatter
}

export type Hunk = { lines: readonly string[] };

/** Lines added and removed across a tool result's `structuredPatch`. */
export function countLines(patch: readonly Hunk[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const h of patch)
    for (const l of h.lines) {
      if (l.startsWith("+")) added++;
      else if (l.startsWith("-")) removed++;
    }
  return { added, removed };
}

/** One change from the file's new text and the write's patch. */
export function toChange(
  file: string,
  action: MemoryChange["action"],
  text: string,
  patch: readonly Hunk[],
  at: number,
): MemoryChange {
  const counted = countLines(patch);
  // a new file's patch can come back empty: every line is added
  if (action === "created" && patch.length === 0)
    counted.added =
      text === "" ? 0 : text.replace(/\r?\n$/, "").split(/\r?\n/).length;
  return { at, file, action, ...parseFrontmatter(text), ...counted };
}

/** Newest first, at most `max`. */
export function addChange(
  list: readonly MemoryChange[],
  change: MemoryChange,
  max = MAX_CHANGES,
): MemoryChange[] {
  return [change, ...list].slice(0, max);
}

/** `09:05`, local time. */
export function fmtTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `09:05 created · feedback · +12 −0` */
export function headline(c: MemoryChange): string {
  const parts = [`${fmtTime(c.at)} ${c.action}`];
  if (c.type) parts.push(c.type);
  parts.push(`+${c.added} −${c.removed}`);
  return parts.join(" · ");
}

/** What names the memory: its frontmatter name, else the file (the index says so). */
export function title(c: MemoryChange): string {
  if (c.name) return c.name;
  return c.file === "MEMORY.md" ? "MEMORY.md (index)" : c.file;
}
