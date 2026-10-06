/**
 * core.ts — the pure half of fleet: status transitions, parsing git and task
 * notifications, and the words of the toasts, status line and summary.
 */

import type { FleetAgent, FleetShell, FleetState, FleetTree } from "../types";

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
