/**
 * core.ts — the pure half of watchdog: reading the process scan, matching
 * shells to calls, the stuck rule, and the words of the notes and summary.
 */

import type { WatchRun } from "../types";

/** Most runs kept; the oldest ended ones fall off. */
const KEEP = 40;

/** CPU ticks (1/100 s) a tree must use between two looks to count as working: 5% of a core over 10 s. */
export const ACTIVE_TICKS = 5;

/** After a TERM, how long a tree has before it gets a KILL: the next look, 10 s on. */
const KILL_GRACE_MS = 10_000;

/**
 * Lists the engine's shells: each child of the pid given whose stdout is a
 * task's `.output` file. One record per shell, NUL-ended, tab-separated:
 * pid, the tree's pids, the tree's CPU ticks, whether a `sleep` is in it,
 * the output file's size, its path, then the shell's command line.
 */
export const SCAN_SCRIPT = String.raw`
set -f
root=$1
tab=$(printf '\t')
trees=$(ps -e -o pid=,ppid= | awk -v root="$root" '
{ kids[$2] = kids[$2] " " $1 }
END {
  n = split(kids[root], top, " ")
  for (i = 1; i <= n; i++) {
    tree = top[i]; q = top[i]
    while (q != "") {
      m = split(q, cur, " "); q = ""
      for (j = 1; j <= m; j++) {
        k = split(kids[cur[j]], c, " ")
        for (l = 1; l <= k; l++) { tree = tree " " c[l]; q = q " " c[l] }
      }
    }
    print tree
  }
}')
[ -n "$trees" ] || exit 0
# one find over every child's stdout: the shells write theirs to a task's output file
links=$(find $(printf '%s\n' "$trees" | awk '{ print "/proc/" $1 "/fd/1" }') -maxdepth 0 -lname '*/tasks/*.output' -printf '%h\t%l\n' 2>/dev/null)
[ -n "$links" ] || exit 0
printf '%s\n' "$trees" | awk -v links="$links" '
BEGIN { n = split(links, l, "\n"); for (i = 1; i <= n; i++) { split(l[i], a, "\t"); split(a[1], d, "/"); file[d[3]] = a[2] } }
($1 in file) { print file[$1] "\t" $0 }' |
while IFS="$tab" read -r f tree; do
  stats= comms=
  for p in $tree; do stats="$stats /proc/$p/stat"; comms="$comms /proc/$p/comm"; done
  # utime stime cutime cstime: fields 14-17 of a stat line, counted after the ") " that ends the name
  set -- $(cat $stats $comms 2>/dev/null | awk '
    /\) / { sub(/^.*\) /, ""); t += $12 + $13 + $14 + $15; next }
    $0 == "sleep" { s = 1 }
    END { print t + 0, s + 0 }')
  ticks=$1 sleeping=$2
  set -- $tree
  size=$(stat -c %s "$f" 2>/dev/null || echo 0)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t' "$1" "$tree" "$ticks" "$sleeping" "$size" "$f"
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null
  printf '\0'
done
`;

/** One shell the scan found. */
export type ScanShell = {
  pid: number;
  pids: number[];
  ticks: number;
  sleeping: boolean;
  size: number;
  file: string;
  cmdline: string;
};

/** The scan's records; a malformed one is skipped. */
export function parseScan(stdout: string): ScanShell[] {
  const shells: ScanShell[] = [];
  for (const rec of stdout.split("\0")) {
    const f = rec.split("\t");
    if (f.length < 7) continue;
    const pid = Number(f[0]);
    const pids = f[1]!.split(" ").filter(Boolean).map(Number);
    const ticks = Number(f[2]);
    const size = Number(f[4]);
    if (!Number.isInteger(pid) || pid <= 0 || pids.some((p) => !Number.isInteger(p)))
      continue;
    if (!Number.isFinite(ticks) || !Number.isFinite(size) || !f[5]) continue;
    shells.push({
      pid,
      pids,
      ticks,
      sleeping: f[3] === "1",
      size,
      file: f[5],
      cmdline: f.slice(6).join("\t"),
    });
  }
  return shells;
}

/** The command as the engine's shell line quotes it for `eval '…'`. */
export const evalQuoted = (command: string) =>
  `eval '${command.replaceAll("'", `'"'"'`)}'`;

/**
 * Which new shell is each waiting foreground call's: the one whose command
 * line holds the call's command, else, when exactly one call and one new
 * shell are left, each other. Answers run id → shell.
 */
export function matchShells(
  runs: WatchRun[],
  shells: ScanShell[],
): Map<string, ScanShell> {
  const owned = new Set(runs.map((r) => r.outputFile).filter(Boolean));
  const free = shells.filter((s) => !owned.has(s.file));
  const waiting = runs.filter(
    (r) => r.endedAt === undefined && !r.taskId && !r.outputFile,
  );
  const out = new Map<string, ScanShell>();
  const taken = new Set<string>();
  for (const r of waiting) {
    const q = evalQuoted(r.command);
    const s = free.find((x) => !taken.has(x.file) && x.cmdline.includes(q));
    if (s) {
      out.set(r.id, s);
      taken.add(s.file);
    }
  }
  const restRuns = waiting.filter((r) => !out.has(r.id));
  const restShells = free.filter((s) => !taken.has(s.file));
  if (restRuns.length === 1 && restShells.length === 1)
    out.set(restRuns[0]!.id, restShells[0]!);
  return out;
}

/**
 * Applies one scan: each live run with a shell takes its pids, sizes and
 * ticks, and is active now when its output grew, it used CPU or a sleep runs
 * in it; a live run whose output file no shell holds any more has ended.
 * Answers the runs and the ids whose output grew (their last line wants
 * reading).
 */
export function applyScan(
  runs: WatchRun[],
  shells: ScanShell[],
  now: number,
): { runs: WatchRun[]; grew: Set<string> } {
  const matched = matchShells(runs, shells);
  const byFile = new Map(shells.map((s) => [s.file, s]));
  const grew = new Set<string>();
  const next = runs.map((r): WatchRun => {
    if (r.endedAt !== undefined) return r;
    const s =
      matched.get(r.id) ?? (r.outputFile ? byFile.get(r.outputFile) : undefined);
    if (!s) {
      return r.outputFile ? ended(r, now) : r;
    }
    const first = r.pid !== s.pid;
    const isGrown = s.size > (r.size ?? 0);
    const isWorking = !first && s.ticks - (r.ticks ?? 0) >= ACTIVE_TICKS;
    if (isGrown) grew.add(r.id);
    return {
      ...r,
      outputFile: s.file,
      pid: s.pid,
      pids: s.pids,
      size: s.size,
      ticks: s.ticks,
      sleeping: s.sleeping,
      // a sleep counts as active: what runs after it gets the whole limit
      ...(isGrown || isWorking || s.sleeping ? { activeAt: now } : {}),
    };
  });
  return { runs: next, grew };
}

/** Where a run stands: stopped by the watchdog, ended by itself, or running. */
export const statusOf = (r: WatchRun): "running" | "done" | "killed" =>
  r.killedAt !== undefined ? "killed" : r.endedAt !== undefined ? "done" : "running";

/** Foreground until its result came back with a background task. */
export const kindOf = (r: WatchRun): "fg" | "bg" => (r.taskId ? "bg" : "fg");

/** A run ended: its pids dropped, so no later signal reaches a reused one. */
export function ended(r: WatchRun, now: number): WatchRun {
  const { pids: _, ...rest } = r;
  return { ...rest, endedAt: now };
}

/** How long a run has printed nothing, used no CPU and run no sleep. */
export const quietMs = (r: WatchRun, now: number) => now - (r.activeAt ?? r.startedAt);

/** The rule: a running command with a shell, no wait loop, quiet for the limit. */
export const isStuck = (r: WatchRun, now: number, limitMs: number) =>
  statusOf(r) === "running" && r.pid !== undefined && !r.waiter && quietMs(r, now) >= limitMs;

/** A stopped run, the grace over, whose KILL has not gone out: sent whether or not its shell still stands. */
export const needsKill = (r: WatchRun, now: number) =>
  r.killedAt !== undefined &&
  !r.killSent &&
  r.pid !== undefined &&
  now - r.killedAt >= KILL_GRACE_MS;

/** Still looked at: running, or stopped with its KILL still to send. */
export const isWatched = (r: WatchRun) =>
  r.endedAt === undefined || (r.killedAt !== undefined && !r.killSent);

/**
 * `kill`'s targets for a run: the shell's process group, which a child keeps
 * when the shell dies and it is reparented out of the engine's tree, and the
 * tree's pids while the shell stands (the scan drops them once it is gone,
 * so a reused pid is never hit).
 */
export const killTargets = (r: WatchRun): string[] =>
  r.pid === undefined
    ? []
    : ["--", `-${r.pid}`, ...(r.pids ?? []).map(String)];

/** Keeps every live run and the newest ended ones, `keep` in all. */
export function trim(runs: WatchRun[], keep = KEEP): WatchRun[] {
  if (runs.length <= keep) return runs;
  const ended = runs.filter((r) => r.endedAt !== undefined);
  const drop = new Set(ended.slice(0, runs.length - keep));
  return runs.filter((r) => !drop.has(r));
}

/** 45s, 6m12s, 1h04m */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 38m, 1h10m, <1m */
export function fmtLeft(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "<1m";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${pad(m % 60)}m`;
}

/** The output file a background Bash result names. */
export function outputFileOf(text: string | undefined): string | undefined {
  return /Output is being written to: (\S+?\.output)\b/.exec(text ?? "")?.[1];
}

/**
 * Whether a kept row may carry a task notification: a user row when the
 * session is idle, a queued_command attachment when a running turn absorbs it.
 */
export const mayNotify = (m: { type: string; name?: string }) =>
  m.type === "user" || (m.type === "attachment" && m.name === "queued_command");

/** A task notification's id, from the row's text. */
export function notifiedTask(text: string): string | undefined {
  if (!text.includes("<task-notification>")) return undefined;
  return /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim() || undefined;
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

/** A wait loop: `until …; do …; done`, or a `while` that sleeps. */
export const isWaiter = (command: string) =>
  /\buntil\b[\s\S]*\bdo\b|\bwhile\b[\s\S]*\bsleep\b/.test(command);

const SETUP = /^(cd|export|set|source|\.)(\s|$)/;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A command in a few words: the first real step's program and argument, "retrain.sh d57". */
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

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the model reads once a command was stopped: why, and that re-running is its call. */
export function killNote(r: WatchRun, now: number, limitMs: number): string {
  const kind = r.taskId ? `background task ${r.taskId}` : "foreground";
  return [
    `The watchdog plugin stopped this ${kind} Bash command after ${fmtElapsed(now - r.startedAt)}: it printed nothing and used no CPU for ${fmtLeft(limitMs)}, so it looked stuck.`,
    `Command: ${clip(r.command, 300)}`,
    ...(r.line ? [`Last output line: ${clip(r.line, 200)}`] : []),
    "If its result is still needed, find out why it hung (a prompt waiting for input, a lock, a dead connection) and re-run it, fixed; if not, carry on.",
  ].join("\n");
}

/** The toast and transcript line for a stop. */
export const killLine = (r: WatchRun, limitMs: number) =>
  `watchdog: stopped ${kindOf(r)} ${shellName(r.command)} · no output or CPU for ${fmtLeft(limitMs)}`;

/** The band's items: live runs quiet for half the limit, and stops in the last limit. */
export function bandItems(runs: WatchRun[], now: number, limitMs: number): string[] {
  const items: string[] = [];
  for (const r of runs) {
    const name = shellName(r.command);
    if (r.killedAt !== undefined && now - r.killedAt < limitMs) items.push(`✗ ${name} stopped`);
    // stuck half a limit from now: quiet for half of it already
    else if (isStuck(r, now + limitMs / 2, limitMs))
      items.push(`⚠ ${name} quiet ${fmtLeft(quietMs(r, now))}/${fmtLeft(limitMs)}`);
  }
  return items;
}

const MARK: Record<ReturnType<typeof statusOf>, string> = {
  running: "▶",
  done: "✓",
  killed: "✗",
};

/** One run's state in words. */
function runNote(r: WatchRun, now: number): string {
  if (r.killedAt !== undefined)
    return r.endedAt === undefined ? "stopping" : "stopped by watchdog";
  if (r.endedAt !== undefined) return "ended";
  if (r.pid === undefined) return "starting";
  if (r.waiter) return "wait loop";
  if (r.sleeping) return "sleeping";
  return `quiet ${fmtLeft(quietMs(r, now))}`;
}

/** The /watchdog summary: the rule, then each run, newest last. */
export function summary(runs: WatchRun[], now: number, limitMs: number): string {
  const live = runs.filter((r) => r.endedAt === undefined).length;
  const stopped = runs.filter((r) => r.killedAt !== undefined).length;
  const head = `watchdog · stops a command after ${fmtLeft(limitMs)} with no output and no CPU · ${live} running · ${stopped} stopped`;
  if (runs.length === 0) return `${head}\nNo Bash commands yet.`;
  const lines = runs.map((r) => {
    const took = fmtElapsed((r.endedAt ?? now) - r.startedAt);
    const parts = [`${MARK[statusOf(r)]} ${kindOf(r)} ${shellName(r.command)}`, took, runNote(r, now)];
    if (r.line) parts.push(clip(r.line, 60));
    return parts.join(" · ");
  });
  return [head, ...lines].join("\n");
}
