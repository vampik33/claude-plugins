import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { WatchRun } from "../types";
import {
  applyScan,
  bandItems,
  ended,
  isStuck,
  isWatched,
  killTargets,
  killLine,
  killNote,
  lastLine,
  mayNotify,
  needsKill,
  notifiedTask,
  outputFileOf,
  parseScan,
  SCAN_SCRIPT,
  summary,
  trim,
} from "./core.ts";

const POLL_MS = 10_000;
/** Bytes of a run's output read for its last line. */
const TAIL_BYTES = "4096";

const runs = atom({ plugin: "watchdog", key: "runs" } as const, [] as WatchRun[]);

/** What the module keeps outside `$.state`; a reload starts it over. */
type Watch = {
  limitMs: number;
  /** The engine's pid: its children are the shells */
  root?: number;
  poll?: { cancel: () => void };
  /** A look still running: the next one waits its turn */
  isLooking?: boolean;
  /** Whether the band showed anything at the last look, so it is redrawn once more to clear */
  banded: boolean;
};

/** The engine's pid: the parent of a child it runs. */
async function findRoot($: EngineInterface): Promise<number | undefined> {
  const r = await $.process.run(["sh", "-c", "echo $PPID"]).catch(() => undefined);
  const pid = Number(r?.stdout.trim());
  return r?.exitCode === 0 && Number.isInteger(pid) && pid > 1 ? pid : undefined;
}

const signal = ($: EngineInterface, sig: "TERM" | "KILL", r: WatchRun) =>
  $.process.run(["kill", `-${sig}`, ...killTargets(r)]).catch(() => undefined);

/** Stops one stuck run and says so; a background one's model is told by a prompt of its own. */
async function stop($: EngineInterface, w: Watch, r: WatchRun, now: number) {
  const line = killLine(r, w.limitMs);
  $.ui.toast(line);
  $.ui.log(line);
  // a foreground call's own hook hands the model the note with its result
  if (!r.taskId) {
    await signal($, "TERM", r);
    return;
  }
  const res = await $.tool
    .call({ tool: "TaskStop", task_id: r.taskId } as never)
    .catch(() => undefined);
  if (!res || res.deny !== undefined || res.isError)
    await signal($, "TERM", r);
  void $.prompt.submit({ text: killNote(r, now, w.limitMs) }).catch(() => undefined);
}

/** One look at the shells: output, CPU, ends, stops. */
async function tick($: EngineInterface, w: Watch): Promise<void> {
  if (w.isLooking) return;
  w.isLooking = true;
  try {
    await look($, w);
  } finally {
    w.isLooking = false;
  }
}

async function look($: EngineInterface, w: Watch): Promise<void> {
  if (!(await read($, runs)).some(isWatched)) {
    w.poll?.cancel();
    w.poll = undefined;
    return;
  }
  w.root ??= await findRoot($);
  if (w.root === undefined) return;
  const out = await $.process
    .run(["bash", "-c", SCAN_SCRIPT, "watchdog-scan", String(w.root)])
    .catch(() => undefined);
  if (!out || out.exitCode !== 0) return;
  const shells = parseScan(out.stdout);
  const now = await $.clock.now();
  const grew: WatchRun[] = [];
  const stuck: WatchRun[] = [];
  const kill: WatchRun[] = [];
  await update($, runs, (prev) => {
    const a = applyScan(prev, shells, now);
    return a.runs.map((r) => {
      if (a.grew.has(r.id)) grew.push(r);
      if (isStuck(r, now, w.limitMs)) {
        stuck.push(r);
        return { ...r, killedAt: now };
      }
      if (needsKill(r, now)) {
        kill.push(r);
        return { ...r, killSent: true };
      }
      return r;
    });
  });
  const lines = new Map<string, string>();
  await Promise.all(
    grew.map(async (r) => {
      const tail = await $.process
        .run(["tail", "-c", TAIL_BYTES, r.outputFile!])
        .catch(() => undefined);
      const line = tail?.exitCode === 0 ? lastLine(tail.stdout) : undefined;
      if (line) lines.set(r.id, line);
    }),
  );
  if (lines.size > 0)
    await update($, runs, (prev) =>
      prev.map((r) => (lines.has(r.id) ? { ...r, line: lines.get(r.id) } : r)),
    );
  for (const r of stuck) await stop($, w, { ...r, line: lines.get(r.id) ?? r.line }, now);
  for (const r of kill) await signal($, "KILL", r);
  // quiet minutes move with no state change: the band redraws each look while it shows
  const banded = bandItems(await read($, runs), now, w.limitMs).length > 0;
  if (banded || w.banded) $.ui.invalidate("ui.render");
  w.banded = banded;
}

function ensurePoll($: EngineInterface, w: Watch) {
  if (!w.poll) w.poll = $.clock.every(POLL_MS, () => void tick($, w));
}

/** Marks a run ended unless it already is; answers it as it now stands. */
async function endRun($: EngineInterface, id: string): Promise<WatchRun | undefined> {
  let run: WatchRun | undefined;
  const now = await $.clock.now();
  await update($, runs, (prev) =>
    prev.map((r) => {
      if (r.id !== id) return r;
      run = r.endedAt !== undefined ? r : ended(r, now);
      return run;
    }),
  );
  return run;
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n")
      : "";

export const register: Register = (on, options) => {
  const w: Watch = {
    limitMs:
      (typeof options.quietMinutes === "number" && options.quietMinutes > 0
        ? options.quietMinutes
        : 10) * 60_000,
    banded: false,
  };

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "watchdog",
      description: "Summarize this session's Bash commands: running, quiet, and stopped as stuck",
    });
    // a reload while commands run: pick the look up again
    if ((await read($, runs)).some(isWatched)) ensurePoll($, w);
    return r;
  });

  on("session.end", async ($, e, next) => {
    // shells outlive a /clear; the ended rows go, but a stopped one keeps its row until its KILL is sent
    if (e.reason === "clear")
      await update($, runs, (prev) => prev.filter(isWatched));
    return next(e);
  });

  on("command.run", { command: "watchdog" }, async ($) => ({
    text: summary(await read($, runs), await $.clock.now(), w.limitMs),
  }));

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const now = await $.clock.now();
    const id = e.tool_use_id ?? `call-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const base = {
      id,
      command: e.command,
      startedAt: now,
    };
    if (!e.run_in_background) {
      await update($, runs, (prev) => trim([...prev, base]));
      ensurePoll($, w);
    }
    const r = await next(e);
    const taskId =
      r.deny === undefined
        ? (r.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId
        : undefined;
    if (taskId) {
      // started in the background, or a foreground one moved there (its timeout, ctrl+b)
      const file = outputFileOf(r.text);
      await update($, runs, (prev) => {
        const bg = (x: WatchRun): WatchRun => ({
          ...x,
          taskId,
          ...(file && !x.outputFile ? { outputFile: file } : {}),
        });
        return prev.some((x) => x.id === id)
          ? prev.map((x) => (x.id === id ? bg(x) : x))
          : trim([...prev, bg(base)]);
      });
      ensurePoll($, w);
      return r;
    }
    if (r.deny !== undefined) {
      await update($, runs, (prev) => prev.filter((x) => x.id !== id));
      return r;
    }
    const run = await endRun($, id);
    if (run?.killedAt === undefined) return r;
    return {
      ...r,
      context: [...(r.context ?? []), killNote(run, run.killedAt, w.limitMs)],
    } as typeof r;
  });

  // a background task's notification: its run ended
  on("session.append", async ($, e, next) => {
    const r = await next(e);
    if (!mayNotify(e.message)) return r;
    const task = notifiedTask(textOf(e.message.content));
    if (!task) return r;
    const run = (await read($, runs)).find((x) => x.taskId === task);
    if (run) await endRun($, run.id);
    return r;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const items = bandItems(await read($, runs), await $.clock.now(), w.limitMs);
    if (items.length === 0) return next(e);
    const below = await next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {below}
        <Text dimColor>{["watchdog", ...items].join(" · ")}</Text>
      </Box>
    );
  });
};
