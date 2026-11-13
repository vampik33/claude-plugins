/**
 * core.ts — the pure half of chat-view: formatting, the bubble's width and
 * reading the transcript file's own timestamps. No `$`, no engine.
 */

import type { ChatViewTimes } from "../types";

/** Most rows kept per map, newest win; a long session's oldest fall off. */
export const KEEP = 2000;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

/** 16:42:07 (or 16:42), with "Oct 4 " in front when it is not today. */
export function fmtTime(at: number, now: number, seconds: boolean): string {
  const d = new Date(at);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}`;
  return d.toDateString() === new Date(now).toDateString()
    ? clock
    : `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`;
}

/** A turn's length as the engine's line writes it: 3s, 1m 4s, 1h 2m. */
export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** The row's text with a formatted time in front. */
export const stampText = (text: string, time: string) => `${time} · ${text}`;

/** "16:42:07 → 16:45:11" for a turn that ended at `endedAt` after `durationMs`. */
export const turnRange = (
  endedAt: number,
  durationMs: number,
  now: number,
  seconds: boolean,
) =>
  `${fmtTime(endedAt - durationMs, now, seconds)} → ${fmtTime(endedAt, now, seconds)}`;

/** Keeps the newest `keep` entries of a map whose values are times. */
export function cap(
  record: Record<string, number>,
  keep = KEEP,
): Record<string, number> {
  const entries = Object.entries(record);
  if (entries.length <= keep) return record;
  // slice(-keep) would keep everything at keep = 0
  return Object.fromEntries(
    entries.sort((a, b) => a[1] - b[1]).slice(entries.length - keep),
  );
}

/** The maps a ChatViewTimes holds; a new map is added here and in the type. */
const TIME_KEYS = [
  "sent",
  "byText",
  "turns",
  "replies",
  "repliesByText",
] as const satisfies readonly (keyof ChatViewTimes)[];

/** Builds a ChatViewTimes map by map. */
const mapTimes = (
  fn: (key: keyof ChatViewTimes) => Record<string, number>,
): ChatViewTimes =>
  Object.fromEntries(TIME_KEYS.map((k) => [k, fn(k)])) as ChatViewTimes;

// no prototype: a prompt typed `__proto__` is a key like any other
export const emptyTimes = (): ChatViewTimes =>
  mapTimes(() => Object.create(null));

/** `newer` folded over `older` map by map, each map capped. */
export const mergeTimes = (older: ChatViewTimes, newer: ChatViewTimes) =>
  mapTimes((k) => cap({ ...older[k], ...newer[k] }));

/** The map's own time for `key`; a prompt typed `constructor` finds no inherited one. */
export const timeOf = (times: Record<string, number>, key: string) =>
  Object.hasOwn(times, key) ? times[key] : undefined;

/**
 * The prompt origins that are the person's own typing: the terminal's
 * composer, the desktop app (an SDK host, which stamps `sdk` or nothing at
 * all, so `unclassified`) and Remote Control (`bridge`).
 *
 * `unclassified` also covers a teammate's message: its row carries `from`,
 * which the render hook checks, so it is stamped but never drawn as one.
 */
const OWN_PROMPT_KINDS = new Set(["composer", "sdk", "bridge", "unclassified"]);

/** Whether a row came from the person typing: a notification or another party's message did not. */
export function isOwnPrompt(origin: { kind: string }): boolean {
  return OWN_PROMPT_KINDS.has(origin.kind);
}

/** A heading, list item, quote, table, fence, HTML, rule or indented code. */
const BLOCK_START =
  /^( {4}|\t|\s*([#>|<]|[-*+]\s|\d+[.)]\s|```|~~~|([-*_])\3\3))/;

/** The reply's text with the time it started in front; on a line of its own before a block that a prefix would break. */
export function stampReply(
  text: string,
  at: number,
  now: number,
  seconds: boolean,
): string {
  const time = fmtTime(at, now, seconds);
  // a block keeps its meaning only at the line's start
  return BLOCK_START.test(text) ? `${time}\n\n${text}` : stampText(text, time);
}

/** Wide (CJK, emoji) code points: two cells each. */
const WIDE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

/** Cells a terminal draws for `s`: wide (CJK, emoji) code points take two. */
export function cellWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

/** Below this many columns the bubble takes the whole row. */
export const NARROW = 60;

/**
 * The bubble's outer width: its longest line plus border and padding (4
 * cells), at most 70% of the row (all of it below NARROW columns).
 */
export function bubbleWidth(text: string, columns: number): number {
  const room = columns < NARROW ? columns : Math.floor(columns * 0.7);
  // reduce, not Math.max(...lines): a pasted log can have more lines than a call takes arguments
  const longest = text
    .split("\n")
    .reduce((m, line) => Math.max(m, cellWidth(line)), 0);
  return Math.max(Math.min(longest + 4, room), Math.min(5, columns));
}

/** A row's non-blank text blocks, trimmed: each had one streamed first token. */
export const textBlocks = (content: unknown): string[] =>
  Array.isArray(content)
    ? content
        .filter(
          (b: any) =>
            b?.type === "text" &&
            typeof b.text === "string" &&
            b.text.trim() !== "",
        )
        .map((b: any) => (b.text as string).trim())
    : [];

/** The visible text of an assistant row (its key in `repliesByText`), or undefined for none. */
export function replyText(content: unknown): string | undefined {
  return textBlocks(content).join("\n") || undefined;
}

/** The typed text of a user row's content, or undefined for a tool result or a meta row. */
export function promptText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  if (content.some((b) => b?.type === "tool_result")) return undefined;
  const text = content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  return text || undefined;
}

/**
 * Times from a transcript file (JSONL): each typed prompt's row by uuid and
 * text, each reply row's by uuid and text, and each turn's end by its
 * duration. A reply row's time is when it was written, not its first token:
 * the file keeps no other.
 */
export function parseTranscript(jsonl: string): ChatViewTimes {
  const times = emptyTimes();
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"timestamp"')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at)) continue;
    if (
      row.type === "system" &&
      row.subtype === "turn_duration" &&
      typeof row.durationMs === "number"
    ) {
      times.turns[String(row.durationMs)] = at;
    } else if (
      row.type === "user" &&
      !row.isMeta &&
      !row.isSidechain &&
      typeof row.uuid === "string"
    ) {
      const text = promptText(row.message?.content);
      if (text === undefined) continue;
      times.sent[row.uuid] = at;
      times.byText[text] = at;
    } else if (
      row.type === "assistant" &&
      !row.isSidechain &&
      typeof row.uuid === "string"
    ) {
      const text = replyText(row.message?.content);
      if (text === undefined) continue;
      times.replies[row.uuid] = at;
      times.repliesByText[text] = at;
    }
  }
  return mapTimes((k) => cap(times[k]));
}

/** The end time of a turn drawn with `durationMs`: exact, else the closest within a second. */
export function turnEnd(
  turns: Record<string, number>,
  durationMs: number,
): number | undefined {
  const exact = turns[String(durationMs)];
  if (exact !== undefined) return exact;
  let best: number | undefined;
  let gap = 1000;
  for (const [ms, at] of Object.entries(turns)) {
    const d = Math.abs(Number(ms) - durationMs);
    if (d <= gap) {
      gap = d;
      best = at;
    }
  }
  return best;
}
