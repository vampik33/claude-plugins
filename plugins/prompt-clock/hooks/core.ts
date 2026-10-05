/**
 * core.ts — the pure half of prompt-clock: formatting and reading the
 * transcript file's own timestamps. No `$`, no engine.
 */

import type { PromptClockTimes } from "../types";

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

/** The row's text with its send time in front. */
export const stampText = (
  text: string,
  at: number,
  now: number,
  seconds: boolean,
) => `${fmtTime(at, now, seconds)} · ${text}`;

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
  return Object.fromEntries(entries.sort((a, b) => a[1] - b[1]).slice(-keep));
}

export const emptyTimes = (): PromptClockTimes => ({
  sent: {},
  byText: {},
  turns: {},
});

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
 * text, and each turn's end by its duration.
 */
export function parseTranscript(jsonl: string): PromptClockTimes {
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
    }
  }
  return {
    sent: cap(times.sent),
    byText: cap(times.byText),
    turns: cap(times.turns),
  };
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
