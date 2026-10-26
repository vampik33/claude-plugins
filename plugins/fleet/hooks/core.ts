/**
 * core.ts — the pure half of fleet: status transitions, parsing git and task
 * notifications, and the words of the toasts, status line and summary.
 */

import type {
  FleetAgent,
  FleetProgress,
  FleetShell,
  FleetState,
  FleetTree,
} from "../types";

/** Most agents and shells kept; the oldest ended ones fall off. */
export const KEEP = 40;

export const emptyFleet = (): FleetState => ({
  agents: [],
  shells: [],
  trees: [],
  autoOpened: false,
});

/** Still going: not started, running a turn, or held. */
export const isLive = (status: string) =>
  status === "pending" || status === "running" || status === "waiting";

export const isFailed = (status: string) =>
  status === "failed" || status === "killed";

/** 45s, 6m12s, 1h04m */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

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

/** 16:42, with "Oct 4 " in front when it is not today. */
export function fmtClock(at: number, now: number): string {
  const d = new Date(at);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString()
    ? clock
    : `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`;
}

/** Keeps every live item and the newest ended ones, `keep` in all. */
export function trim<T extends { status: string; startedAt: number }>(
  items: T[],
  keep = KEEP,
): T[] {
  if (items.length <= keep) return items;
  const ended = items.filter((i) => !isLive(i.status));
  const drop = new Set(ended.slice(0, items.length - keep));
  return items.filter((i) => !drop.has(i));
}

const firstWord = (v: unknown) =>
  typeof v === "string" ? v.trim().split(/\s+/).slice(0, 3).join(" ") : "";
const baseName = (v: unknown) =>
  typeof v === "string" ? (v.split("/").pop() ?? "") : "";

/** A tool call in a few words: "Bash cargo clippy", "Read apply.rs", "Grep snapshot_". */
export function toolLabel(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  let arg = "";
  if (tool === "Bash") arg = firstWord(i.command);
  else if (typeof i.file_path === "string") arg = baseName(i.file_path);
  else if (typeof i.pattern === "string") arg = i.pattern;
  else if (typeof i.description === "string") arg = i.description;
  const label = arg ? `${tool} ${arg}` : tool;
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

/**
 * Whether a kept row may carry a task notification: a user row when the
 * session is idle, a queued_command attachment when a running turn absorbs it.
 */
export const mayNotify = (m: { type: string; name?: string }) =>
  m.type === "user" || (m.type === "attachment" && m.name === "queued_command");

/** A task notification's id and status, from the row's text. */
export function parseNotification(
  text: string,
): { id: string; status: string } | undefined {
  if (!text.includes("<task-notification>")) return undefined;
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim();
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim();
  return id && status ? { id, status } : undefined;
}

/**
 * Applies statuses (from `$.agent.list()`, a notification, a turn's end) to
 * the agents; answers the new list and the agents that just ended.
 */
export function applyStatuses(
  agents: FleetAgent[],
  statuses: Record<string, string>,
  now: number,
): { agents: FleetAgent[]; ended: FleetAgent[] } {
  const ended: FleetAgent[] = [];
  const next = agents.map((a) => {
    const status = statuses[a.id];
    if (status === undefined || status === a.status) return a;
    // a resumed agent goes live again under the same id
    if (isLive(status)) {
      const { endedAt: _, ...rest } = a;
      return { ...rest, status };
    }
    const changed = { ...a, status, endedAt: a.endedAt ?? now };
    if (isLive(a.status)) ended.push(changed);
    return changed;
  });
  return { agents: next, ended };
}

/** A shell the engine stopped tracking with no notification: its exit is unknown. */
export const LOST = "lost";

/**
 * Marks a shell ended by its task id; answers it, or undefined if it is not a
 * live or lost one. A lost one's late notification still sets its real status.
 */
export function endShell(
  shells: FleetShell[],
  id: string,
  status: string,
  now: number,
): { shells: FleetShell[]; ended?: FleetShell } {
  let ended: FleetShell | undefined;
  const next = shells.map((s) => {
    if (s.id !== id || !(isLive(s.status) || s.status === LOST)) return s;
    ended = { ...s, status, endedAt: s.endedAt ?? now };
    return ended;
  });
  return { shells: next, ended };
}

/** Marks lost each live shell the engine no longer has in flight. */
export function loseShells(
  shells: FleetShell[],
  inFlight: ReadonlySet<string>,
  now: number,
): FleetShell[] {
  return shells.map((s) =>
    isLive(s.status) && !inFlight.has(s.id)
      ? { ...s, status: LOST, endedAt: now }
      : s,
  );
}

export const liveCount = (f: FleetState) =>
  f.agents.filter((a) => isLive(a.status)).length +
  f.shells.filter((s) => isLive(s.status)).length;

/** "✓ rust-reviewer · review apply · 6m12s" or "✗ Explore failed · map callers · 2m03s" */
export function endToast(
  name: string,
  what: string,
  status: string,
  ms: number,
): string {
  const head = isFailed(status) ? `✗ ${name} ${status}` : `✓ ${name}`;
  return [head, what, fmtElapsed(ms)].filter(Boolean).join(" · ");
}

/** The batch's counts on the band line above the prompt: "fleet 2▶ 1✓ 0✗ · bg 1" */
export function statusLine(f: FleetState): string | undefined {
  const batch = f.batchStart;
  if (batch === undefined) return undefined;
  const agents = f.agents.filter((a) => a.startedAt >= batch);
  const run = agents.filter((a) => isLive(a.status)).length;
  const fail = agents.filter((a) => isFailed(a.status)).length;
  const done = agents.length - run - fail;
  const bg = f.shells.filter((s) => isLive(s.status)).length;
  return `fleet ${run}▶ ${done}✓ ${fail}✗${bg ? ` · bg ${bg}` : ""}`;
}

/** The all-done message: how many, how long, what failed, which shells. */
export function summary(f: FleetState, repo: string, now: number): string {
  const batch = f.batchStart ?? now;
  const agents = f.agents.filter((a) => a.startedAt >= batch);
  const shells = f.shells.filter((s) => s.startedAt >= batch);
  const failed = agents.filter((a) => isFailed(a.status));
  const lines = [`🤖 fleet · ${repo}`];
  if (agents.length) {
    lines.push(
      `All ${agents.length} agent${agents.length === 1 ? "" : "s"} done in ${fmtElapsed(now - batch)}`,
    );
    const fails = failed.length
      ? `   ✗ ${failed.length} failed (${failed.map((a) => `${a.type}: ${a.description}`).join("; ")})`
      : "";
    lines.push(`✓ ${agents.length - failed.length} completed${fails}`);
  } else {
    lines.push(`All done in ${fmtElapsed(now - batch)}`);
  }
  // no command text leaves the device: any word of it may hold a secret
  if (shells.length) {
    const bad = shells.filter((s) => isFailed(s.status)).length;
    const lost = shells.filter((s) => s.status === LOST).length;
    lines.push(
      `Background shells: ✓ ${shells.length - bad - lost}${bad ? `   ✗ ${bad}` : ""}${lost ? `   ? ${lost}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** `git worktree list --porcelain` → each tree's path and branch (or short head). */
export function parseWorktrees(
  porcelain: string,
): { path: string; name: string }[] {
  const trees: { path: string; name: string }[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path || /^bare$/m.test(block)) continue;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    const head = /^HEAD ([0-9a-f]{7})/m.exec(block)?.[1];
    trees.push({ path, name: branch ?? `(${head ?? "detached"})` });
  }
  return trees;
}

/** `git status --porcelain=v1 --branch` → changed files and ahead/behind of upstream. */
export function parseStatus(
  porcelain: string,
): Pick<FleetTree, "changed" | "ahead" | "behind"> {
  const lines = porcelain.split("\n").filter(Boolean);
  const head = lines[0]?.startsWith("## ") ? lines.shift()! : "";
  return {
    changed: lines.length,
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
  };
}

/** No output for this long marks a live shell stalled. */
export const STALL_MS = 5 * 60_000;

/** The output file a background Bash result names. */
export function outputFileOf(text: string | undefined): string | undefined {
  return /Output is being written to: (\S+?\.output)\b/.exec(text ?? "")?.[1];
}

/** Escape sequences: OSC (titles, links, clipboard), then CSI (colours, cursor), then any other ESC pair. */
const ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\s\S]?/g;
/** Control characters left once lines are split: none of them reaches the screen. */
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * The last non-blank line of an output tail: a `\r`-redrawn bar's last frame,
 * every escape sequence and control character dropped, since the output is
 * the shell's and goes on screen.
 */
export function lastLine(tail: string): string | undefined {
  return tail
    .replace(ESCAPES, "")
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(CONTROLS, "").trim())
    .filter(Boolean)
    .at(-1);
}

/**
 * The fraction done a line says: "47%" or "month 14/30". A slash inside a
 * date or a path (2026/10/12, src/10/12) is no count.
 */
export function parseProgress(line: string): number | undefined {
  const pct = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
  if (pct && Number(pct[1]) <= 100) return Number(pct[1]) / 100;
  for (const m of line.matchAll(/(?<![\d./-])(\d+)\s*\/\s*(\d+)(?![\d./-])/g)) {
    const done = Number(m[1]);
    const total = Number(m[2]);
    if (total >= 2 && done <= total) return done / total;
  }
  return undefined;
}

/** A new reading: kept from where it started, restarted when it goes back (a new phase). */
export function nextProgress(
  prev: FleetProgress | undefined,
  frac: number | undefined,
  now: number,
): FleetProgress | undefined {
  if (frac === undefined) return prev;
  if (!prev || frac < prev.frac) return { frac, firstAt: now, firstFrac: frac };
  return { ...prev, frac };
}

/** Time left at the rate seen so far; undefined until 30 s of movement. */
export function etaMs(p: FleetProgress, now: number): number | undefined {
  const dt = now - p.firstAt;
  const df = p.frac - p.firstFrac;
  if (dt < 30_000 || df <= 0) return undefined;
  return ((1 - p.frac) * dt) / df;
}

/** 38m, 1h10m, <1m */
export function fmtLeft(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "<1m";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad(m % 60)}m`;
}

/** A wait loop: `until …; do …; done`, or a `while` that sleeps. */
export const isWaiter = (command: string) =>
  /\buntil\b[\s\S]*\bdo\b|\bwhile\b[\s\S]*\bsleep\b/.test(command);

const SETUP = /^(cd|export|set|source|\.)(\s|$)/;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A shell in a few words: the first real step's program and argument, "retrain.sh d57". */
export function shellName(command: string): string {
  const step =
    command
      .split(/&&|\|\||;|\n/)
      .map((s) => s.trim())
      .find((s) => s && !SETUP.test(s) && !s.split(/\s+/).every((w) => ASSIGN.test(w))) ??
    command.trim();
  const name = step
    .split(/\s+/)
    .filter((w) => !ASSIGN.test(w))
    .slice(0, 2)
    .map((w) => w.split("/").pop())
    .join(" ");
  return name.length > 20 ? `${name.slice(0, 19)}…` : name;
}

/** How quiet a live shell has been. */
export const quietMs = (s: FleetShell, now: number) =>
  now - (s.outputAt ?? s.startedAt);

/** A live shell's state in a few words, or undefined when there is nothing to say. */
export function shellNote(s: FleetShell, now: number): string | undefined {
  if (s.waiter) return "waiting";
  if (s.stalled) return `⚠ no output ${fmtLeft(quietMs(s, now))}`;
  if (!s.progress) return undefined;
  const left = etaMs(s.progress, now);
  return `${Math.floor(s.progress.frac * 100)}%${left === undefined ? "" : ` ~${fmtLeft(left)}`}`;
}

/** The band's progress items: "sim.py 47% ~38m", "retrain.sh d57 ⚠ 6m". */
export function shellNotes(shells: FleetShell[], now: number): string[] {
  return shells
    .filter((s) => isLive(s.status) && !s.waiter)
    .flatMap((s) => {
      const name = shellName(s.command);
      if (s.stalled) return [`${name} ⚠ ${fmtLeft(quietMs(s, now))}`];
      const note = shellNote(s, now);
      return note ? [`${name} ${note}`] : [];
    });
}
