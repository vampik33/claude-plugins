import { atom, read, update } from "claude-code";
import type { EngineInterface, ProcessRunResult, Register } from "claude-code";

import type { CxJob, CxMode } from "../types";
import {
  buildPrompt,
  buildRawPrompt,
  chooseBase,
  companionJobId,
  emptyCx,
  fmtElapsed,
  isPushCommand,
  isSafeRef,
  parseArgs,
  preselect,
  readOutcome,
  toolText,
  trimJobs,
  where,
} from "./core.ts";

const PANE = "codex-review";
const TOOL = "mcp__codex-review__CodexReview";
const POLL_MS = 10_000;
/** How long one wait for the companion lasts; the tool waits again until it exits. */
const WAIT_S = 30;

const cx = atom({ plugin: "codex-review", key: "cx" } as const, emptyCx());

/** What the module keeps outside `$.state`; a reload starts it over. */
type Tracker = {
  suggestAfterPush: boolean;
  preselect: unknown;
  poll: { cancel: () => void } | undefined;
  suggestPending: boolean;
};

type StartRequest = {
  mode: CxMode;
  focus: string;
  base?: string;
  cwd?: string;
  byTool: boolean;
};

async function run(
  $: EngineInterface,
  argv: string[],
  cwd?: string,
  timeoutMs?: number,
): Promise<ProcessRunResult | undefined> {
  return $.process.run(argv, { cwd, timeoutMs }).catch(() => undefined);
}

async function findCompanion(
  $: EngineInterface,
  home: string,
): Promise<string | undefined> {
  try {
    const installed = JSON.parse(
      await $.fs.read(`${home}/.claude/plugins/installed_plugins.json`),
    );
    const path = installed?.plugins?.["codex@openai-codex"]?.[0]?.installPath;
    return typeof path === "string"
      ? `${path}/scripts/codex-companion.mjs`
      : undefined;
  } catch {
    return undefined;
  }
}

async function detectBase($: EngineInterface, root: string): Promise<string> {
  const pr = await run(
    $,
    ["gh", "pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"],
    root,
    15_000,
  );
  const remote = await run($, ["git", "remote", "get-url", "origin"], root);
  return chooseBase(
    pr?.exitCode === 0 ? pr.stdout.trim() || undefined : undefined,
    remote?.exitCode === 0 ? remote.stdout.trim() : "",
  );
}

/** Starts the companion detached, writing its JSON to the job's folder; a job or why not. */
async function startJob(
  $: EngineInterface,
  t: Tracker,
  req: StartRequest,
): Promise<CxJob | string> {
  const home = await $.env.get("HOME").catch(() => undefined);
  if (!home) return "HOME is not set";
  const companion = await findCompanion($, home);
  if (!companion)
    return "The codex plugin (codex@openai-codex) is not installed: run /plugin to install it, then /codex:setup.";
  const top = await run($, ["git", "rev-parse", "--show-toplevel"], req.cwd);
  if (!top || top.exitCode !== 0)
    return `Not a git repository: ${req.cwd ?? "the session's directory"}`;
  const root = top.stdout.trim();
  const base = req.base || (await detectBase($, root));
  if (!isSafeRef(base)) return `Not a branch name: ${base}`;
  const id = `cx-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = `${home}/.cache/codex-review/${id}`;
  const made = await run($, ["mkdir", "-p", dir]);
  if (made?.exitCode !== 0) return `Cannot create ${dir}`;

  const sub = req.mode === "adversarial" ? "adversarial-review" : "review";
  // after "--" the focus is free text, never an option of the companion's
  const focus = req.mode === "adversarial" && req.focus ? ["--", req.focus] : [];
  // read-only: never --write; detached so the review outlives this call and a reload
  const started = await run($, [
    "sh",
    "-c",
    'cd "$1" || exit 1; out="$2"; err="$3"; shift 3; nohup "$@" > "$out" 2> "$err" < /dev/null & echo $!',
    "cx",
    root,
    `${dir}/out.json`,
    `${dir}/err.log`,
    "node",
    companion,
    sub,
    "--json",
    "--base",
    base,
    ...focus,
  ]);
  const pid = Number(started?.stdout.trim());
  if (!started || started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0)
    return `Codex did not start: ${started?.stderr.trim() || "no pid"}`;

  const job: CxJob = {
    id,
    mode: req.mode,
    repo: root.split("/").pop() || root,
    root,
    base,
    focus: req.focus,
    dir,
    pid,
    startedAt: Date.now(),
    status: "running",
    byTool: req.byTool,
  };
  await update($, cx, (s) => ({ ...s, jobs: trimJobs([...s.jobs, job]) }));
  ensurePoll($, t);
  return job;
}

async function isAlive($: EngineInterface, pid: number): Promise<boolean> {
  const r = await run($, ["kill", "-0", String(pid)]);
  return r?.exitCode === 0;
}

/** Reads a finished job's output into the state, once; answers the job as stored. */
async function finishJob(
  $: EngineInterface,
  t: Tracker,
  id: string,
): Promise<CxJob | undefined> {
  const job = (await read($, cx)).jobs.find((j) => j.id === id);
  if (!job || job.status !== "running") return job;
  const out = await $.fs.read(`${job.dir}/out.json`).catch(() => "");
  const err = await $.fs.read(`${job.dir}/err.log`).catch(() => "");
  const outcome = readOutcome(job.mode, out, err);
  let done: CxJob | undefined;
  let fresh = false;
  await update($, cx, (s) => {
    const cur = s.jobs.find((j) => j.id === id);
    if (!cur || cur.status !== "running") {
      done = cur;
      return s;
    }
    fresh = true;
    done = { ...cur, ...outcome, endedAt: Date.now() };
    const jobs = s.jobs.map((j) => (j.id === id ? done! : j));
    if (cur.byTool) return { ...s, jobs };
    return {
      ...s,
      jobs,
      shown: id,
      picked: preselect(done.review?.findings ?? [], t.preselect),
    };
  });
  if (fresh && done && !done.byTool) await announce($, done);
  return done;
}

async function announce($: EngineInterface, job: CxJob) {
  const took = fmtElapsed((job.endedAt ?? job.startedAt) - job.startedAt);
  if (job.status === "failed") {
    $.ui.toast(
      `Codex review failed after ${took}: ${job.error ?? "no output"}`,
    );
  } else {
    const n = job.review?.findings.length;
    $.ui.toast(
      job.review
        ? `Codex ${job.review.verdict} · ${n} finding${n === 1 ? "" : "s"} · ${took}`
        : `Codex review done · ${took}`,
    );
  }
  const opened = await $.ui
    .open({ id: PANE, title: "Codex review" })
    .catch(() => undefined);
  if (opened && !opened.isPlaced)
    $.ui.toast("Codex findings are ready: /cx last opens them");
}

/** Every 10 s while a job runs: its phase, or its end. */
async function pollJobs($: EngineInterface, t: Tracker): Promise<void> {
  const running = (await read($, cx)).jobs.filter(
    (j) => j.status === "running",
  );
  if (running.length === 0) {
    t.poll?.cancel();
    t.poll = undefined;
    return;
  }
  const home = (await $.env.get("HOME").catch(() => undefined)) ?? "";
  const companion = await findCompanion($, home);
  for (const job of running) {
    if (!(await isAlive($, job.pid))) {
      await finishJob($, t, job.id);
      continue;
    }
    if (!companion) continue;
    const st = await run($, ["node", companion, "status", "--json"], job.root);
    const phase =
      st?.exitCode === 0 ? companionJobId(st.stdout, job)?.phase : undefined;
    if (phase && phase !== job.phase)
      await update($, cx, (s) => ({
        ...s,
        jobs: s.jobs.map((j) => (j.id === job.id ? { ...j, phase } : j)),
      }));
  }
}

function ensurePoll($: EngineInterface, t: Tracker) {
  if (!t.poll) t.poll = $.clock.every(POLL_MS, () => void pollJobs($, t));
}

/** Stops running jobs: the companion's own cancel, then the process. */
async function cancelJobs($: EngineInterface, ids?: string[]): Promise<number> {
  const running = (await read($, cx)).jobs.filter(
    (j) => j.status === "running" && (!ids || ids.includes(j.id)),
  );
  const home = (await $.env.get("HOME").catch(() => undefined)) ?? "";
  const companion = await findCompanion($, home);
  for (const job of running) {
    if (companion) {
      const st = await run(
        $,
        ["node", companion, "status", "--json"],
        job.root,
      );
      const mine =
        st?.exitCode === 0 ? companionJobId(st.stdout, job) : undefined;
      if (mine)
        await run(
          $,
          ["node", companion, "cancel", mine.id, "--json"],
          job.root,
        );
    }
    await run($, ["kill", String(job.pid)]);
  }
  const gone = new Set(running.map((j) => j.id));
  await update($, cx, (s) => ({
    ...s,
    jobs: s.jobs.map((j) =>
      gone.has(j.id) && j.status === "running"
        ? { ...j, status: "cancelled" as const, endedAt: Date.now() }
        : j,
    ),
  }));
  return running.length;
}

/** Waits for the companion to exit, a $ call at a time (each free of the hook's budget). */
async function waitForExit(
  $: EngineInterface,
  pid: number,
  signal: AbortSignal,
): Promise<boolean> {
  const loop = `i=0; while kill -0 "$1" 2>/dev/null; do i=$((i + 1)); [ "$i" -ge ${WAIT_S} ] && exit 3; sleep 1; done`;
  for (;;) {
    if (signal.aborted) return false;
    const r = await run(
      $,
      ["sh", "-c", loop, "cx", String(pid)],
      undefined,
      (WAIT_S + 15) * 1000,
    );
    if (r?.exitCode === 0) return true;
    if (!r && !(await isAlive($, pid))) return true;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const register: Register = (on, options) => {
  const t: Tracker = {
    suggestAfterPush: options.suggestAfterPush !== false,
    preselect: options.preselect,
    poll: undefined,
    suggestPending: false,
  };

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "cx",
      description:
        "Codex review in the background: /cx [adv|review] [focus], /cx last, /cx cancel",
    });
    await $.tool.register({
      name: "CodexReview",
      description:
        "Runs a real Codex review (OpenAI Codex via the codex plugin's companion, read-only) of the git branch checked out in `cwd` against `base`, and returns Codex's findings as JSON: verdict, summary, findings[severity,title,body,file,line_start,line_end,confidence,recommendation], next_steps. Takes minutes. If it fails it returns an error: never substitute your own review for it.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["adversarial", "standard"],
            description:
              "adversarial (default): challenges the design and finds bugs; standard: Codex's built-in review",
          },
          base: {
            type: "string",
            description:
              "Base branch to diff against; default the PR's base, else develop/main",
          },
          focus: {
            type: "string",
            description: "One line on what the change does (adversarial only)",
          },
          cwd: {
            type: "string",
            description:
              "The repository's working directory; default the session's",
          },
        },
      },
    });
    // a reload while a review runs: follow it again
    if ((await read($, cx)).jobs.some((j) => j.status === "running"))
      ensurePoll($, t);
    return r;
  });

  on("command.run", { command: "cx" }, async ($, e) => {
    const cmd = parseArgs(e.args);
    if (cmd.action === "cancel") {
      const n = await cancelJobs($);
      return {
        text: n
          ? `Cancelled ${n} Codex review${n === 1 ? "" : "s"}.`
          : "No Codex review is running.",
      };
    }
    if (cmd.action === "last") {
      const s = await read($, cx);
      const last = [...s.jobs]
        .reverse()
        .find((j) => j.status === "completed" || j.status === "failed");
      if (!last) return { text: "No finished Codex review in this session." };
      await update($, cx, (x) => ({
        ...x,
        shown: last.id,
        picked:
          x.shown === last.id
            ? x.picked
            : preselect(last.review?.findings ?? [], t.preselect),
      }));
      await $.ui.open({ id: PANE, title: "Codex review" });
      return { text: "Codex findings opened." };
    }
    const cwd = await $.session.cwd().catch(() => undefined);
    const job = await startJob($, t, {
      mode: cmd.mode,
      focus: cmd.focus,
      cwd,
      byTool: false,
    });
    if (typeof job === "string") return { text: job };
    return {
      text: `Codex ${cmd.mode} review started in the background: ${job.repo} → ${job.base}${cmd.focus ? ` · "${cmd.focus}"` : ""}. /cx cancel stops it.`,
    };
  });

  on("tool.call", { tool: TOOL }, async ($, e, next) => {
    const mode: CxMode =
      str(e.mode) === "standard" ? "standard" : "adversarial";
    const cwd = str(e.cwd) ?? (await $.session.cwd().catch(() => undefined));
    const job = await startJob($, t, {
      mode,
      focus: str(e.focus) ?? "",
      base: str(e.base),
      cwd,
      byTool: true,
    });
    if (typeof job === "string")
      return { result: `Codex did not run: ${job}`, isError: true };
    const exited = await waitForExit($, job.pid, next.signal);
    if (!exited) {
      await cancelJobs($, [job.id]);
      return { result: "Codex review cancelled.", isError: true };
    }
    const done = await finishJob($, t, job.id);
    if (!done || done.status !== "completed")
      return {
        result: `Codex did not complete a review (do not substitute your own): ${done?.error ?? "unknown error"}${done?.raw ? `\n\nRaw output:\n${done.raw}` : ""}`,
        isError: true,
      };
    return { result: toolText(done) };
  });

  // a push or a new PR: propose a review once the turn is over
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const r = await next(e);
    if (
      t.suggestAfterPush &&
      r.deny === undefined &&
      !r.isError &&
      isPushCommand(e.command)
    )
      t.suggestPending = true;
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId && t.suggestPending) {
      t.suggestPending = false;
      void $.prompt.suggest({ text: "/cx adv" });
    }
    return r;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const running = (await read($, cx)).jobs.filter(
      (j) => j.status === "running",
    );
    if (e.props.hasSurvey || running.length === 0) return next(e);
    const job = running[running.length - 1]!;
    const below = await next(e);
    const label = `codex ${job.mode === "adversarial" ? "adversarial-review" : "review"}`;
    const more = running.length > 1 ? ` · +${running.length - 1} more` : "";
    const detail = `${job.phase ?? "starting"} · ${job.repo} → ${job.base}${more} · /cx cancel`;
    if (e.surface === "terminal" || e.surface === "desktop") {
      const { Box, Client } = $.ui.resolve(e);
      return (
        <Box flexDirection="row" columnGap={3}>
          {below}
          <Client
            key="codex-band"
            module="./band.tsx"
            props={{ label, startedAt: job.startedAt, detail }}
          />
        </Box>
      );
    }
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="row" columnGap={3}>
        {below}
        <Text dimColor>{`${label} · ${detail}`}</Text>
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e);
    const s = await read($, cx);
    const job = s.jobs.find((j) => j.id === s.shown);
    if (!job)
      return <Text dimColor>No Codex review to show. /cx starts one.</Text>;
    const took = fmtElapsed((job.endedAt ?? Date.now()) - job.startedAt);
    const close = () => $.ui.close({ id: PANE });
    const send = async (text: string) => {
      await close();
      await $.prompt.submit({ text });
    };

    if (!job.review) {
      return (
        <Box flexDirection="column">
          <Text>
            <Text bold>CODEX</Text>
            <Text
              dimColor
            >{` · ${job.status} · ${took} · ${job.repo} → ${job.base}`}</Text>
          </Text>
          {job.error && <Text color="red">{job.error}</Text>}
          {job.raw && <Text>{job.raw}</Text>}
          <Text> </Text>
          <Box flexDirection="row" columnGap={2}>
            {job.raw && (
              <Button
                key="send-raw"
                variant="primary"
                label="Send to Claude: verify & fix"
                onPress={() => send(buildRawPrompt(job, job.raw!))}
              />
            )}
            <Button
              key="dismiss"
              role="dismiss"
              label="dismiss"
              onPress={close}
            />
          </Box>
        </Box>
      );
    }

    const { verdict, summary, findings } = job.review;
    const chosen = findings.filter((_, i) => s.picked[i]);
    const sevColor = (sev: string) =>
      sev === "critical" || sev === "high"
        ? "red"
        : sev === "medium"
          ? "yellow"
          : undefined;
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>CODEX </Text>
          <Text color={verdict === "approve" ? "green" : "yellow"}>
            {verdict}
          </Text>
          <Text
            dimColor
          >{` · ${findings.length} finding${findings.length === 1 ? "" : "s"} · ${took} · base ${job.base}`}</Text>
        </Text>
        <Text dimColor>{summary}</Text>
        <Text> </Text>
        {findings.map((f, i) => (
          <Box key={`f${i}`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`pick${i}`}
                plain
                label={s.picked[i] ? "[x]" : "[ ]"}
                onPress={() =>
                  update($, cx, (x) => ({
                    ...x,
                    picked: findings.map((_, j) =>
                      j === i ? !x.picked[j] : !!x.picked[j],
                    ),
                  }))
                }
              />
              <Text color={sevColor(f.severity)}>
                {f.severity.toUpperCase().padEnd(8)}
              </Text>
              <Text>{f.title}</Text>
            </Box>
            <Text
              dimColor
            >{`    ${where(f)} · confidence ${f.confidence.toFixed(2)}`}</Text>
          </Box>
        ))}
        <Text> </Text>
        <Box flexDirection="row" columnGap={2}>
          {chosen.length > 0 && (
            <Button
              key="send"
              variant="primary"
              label={`Send ${chosen.length} to Claude: verify & fix`}
              onPress={() => send(buildPrompt(job, chosen, false))}
            />
          )}
          {chosen.length > 0 && (
            <Button
              key="verify"
              label="verify only"
              onPress={() => send(buildPrompt(job, chosen, true))}
            />
          )}
          <Button
            key="dismiss"
            role="dismiss"
            label="dismiss"
            onPress={close}
          />
        </Box>
      </Box>
    );
  });
};
