import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, SessionMessage } from "claude-code";

import type { CacheDeadline, ContinuityGauge, ContinuityMode } from "../types";
import {
  bar,
  blockingLimit,
  buildNote,
  compactInstructions,
  continuePrompt,
  countDirty,
  fmtLength,
  lastCheck,
  MIN_TURNS_BETWEEN,
  openTodos,
  shouldHandover,
  userPrompts,
} from "./core.ts";
import type { GaugeProps } from "./gauge.tsx";
import {
  accountOf,
  decideTtl,
  expiryOf,
  observeTtl,
  ttlMs,
  type CacheEnv,
  type Sample,
  type Ttl,
} from "./ttl.ts";

/** The grace between the turn's end and the handover, for a prompt to cancel it. */
const GRACE_MS = 5_000;
/** Past a limit's reset before continuing, so the first request is not refused again. */
const RESET_SLACK_MS = 60_000;
const SUGGEST_DELAY_MS = 1_500;

const gauge = atom(
  { plugin: "continuity", key: "gauge" } as const,
  null as ContinuityGauge | null,
);
const mode = atom(
  { plugin: "continuity", key: "mode" } as const,
  {
    paused: false,
    phase: "idle",
  } as ContinuityMode,
);
const cache = atom(
  { plugin: "continuity", key: "cache" } as const,
  null as CacheDeadline | null,
);

/** What the module keeps outside `$.state`; a reload starts it over. */
type Tracker = {
  threshold: number;
  resumeAfterLimit: boolean;
  turnsSinceHandover: number;
  grace: { cancel: () => void } | undefined;
  resume: { cancel: () => void } | undefined;
  cache: CacheTracker;
};

/** What the cache countdown learns as the session goes. */
type CacheTracker = {
  option: unknown;
  yellowAt: number;
  redAt: number;
  toast: boolean;
  env: CacheEnv;
  setting: unknown;
  observed: Ttl | undefined;
  prev: Sample | undefined;
  toastTimer: { cancel: () => void } | undefined;
};

async function readCacheSetting($: EngineInterface): Promise<unknown> {
  const home = await $.env.get("HOME").catch(() => undefined);
  const cwd = await $.session.cwd().catch(() => undefined);
  const files = [
    cwd && `${cwd}/.claude/settings.local.json`,
    cwd && `${cwd}/.claude/settings.json`,
    home && `${home}/.claude/settings.json`,
  ];
  for (const file of files) {
    if (!file) continue;
    try {
      const value = JSON.parse(await $.fs.read(file)).promptCacheTtl;
      if (value === "5m" || value === "1h") return value;
    } catch {
      // missing or unreadable: the next file
    }
  }
  return undefined;
}

async function readCacheEnv($: EngineInterface): Promise<CacheEnv> {
  const none = () => undefined;
  return {
    enable1h: await $.env.get("ENABLE_PROMPT_CACHING_1H").catch(none),
    force5m: await $.env.get("FORCE_PROMPT_CACHING_5M").catch(none),
    ttlVar: await $.env.get("CLAUDE_CODE_PROMPT_CACHE_TTL").catch(none),
  };
}

async function currentTtl($: EngineInterface, c: CacheTracker): Promise<Ttl> {
  if (c.observed) return c.observed;
  const usage = await $.session.usage().catch(() => undefined);
  return decideTtl(
    c.option,
    c.env,
    c.setting,
    accountOf(usage?.rateLimits ?? []),
  );
}

const share = (v: unknown, fallback: number) =>
  typeof v === "number" && v > 0 && v < 1 ? v : fallback;

async function git(
  $: EngineInterface,
  args: string[],
  cwd: string,
): Promise<string | undefined> {
  const r = await $.process
    .run(["git", ...args], { cwd })
    .catch(() => undefined);
  return r?.exitCode === 0 ? r.stdout.trim() : undefined;
}

/** Collects the facts, writes the note to ~/.claude/handover/<session>.md; its path and text. */
async function writeNote(
  $: EngineInterface,
  messages: readonly SessionMessage[],
): Promise<{ path: string; note: string }> {
  const [cwd, sessionId, usage, home] = await Promise.all([
    $.session.cwd(),
    $.session.id(),
    $.session.usage(),
    $.env.get("HOME").catch(() => undefined),
  ]);
  const [branch, gitDir, commonDir, status, lastCommit, top] =
    await Promise.all([
      git($, ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
      git($, ["rev-parse", "--git-dir"], cwd),
      git($, ["rev-parse", "--git-common-dir"], cwd),
      git($, ["status", "--porcelain"], cwd),
      git($, ["log", "-1", "--format=%h %s"], cwd),
      git($, ["rev-parse", "--show-toplevel"], cwd),
    ]);
  const now = Date.now();
  const note = buildNote({
    repo: (top ?? cwd).split("/").pop() || cwd,
    sessionId,
    at: now,
    percent: usage.context.percent,
    window: usage.context.window,
    lengthMs: now - usage.startedAt,
    prompts: userPrompts(messages),
    where: {
      cwd,
      branch,
      isWorktree: !!gitDir && !!commonDir && gitDir !== commonDir,
      dirty: status === undefined ? undefined : countDirty(status),
      lastCommit,
    },
    todos: openTodos(messages),
    check: lastCheck(messages),
  });
  const path = `${home ?? "~"}/.claude/handover/${sessionId}.md`;
  await $.fs.write(path, note + "\n");
  return { path, note };
}

async function setPhase(
  $: EngineInterface,
  phase: ContinuityMode["phase"],
  resumeAt?: number,
) {
  await update($, mode, (m) => {
    const { resumeAt: _, ...rest } = m;
    return resumeAt === undefined
      ? { ...rest, phase }
      : { ...rest, phase, resumeAt };
  });
}

/** Note, compaction, then a prompt that continues from the note. */
async function handover($: EngineInterface, t: Tracker): Promise<string> {
  t.grace = undefined;
  await setPhase($, "compacting");
  try {
    const messages = await $.session.messages();
    const { path, note } = await writeNote(
      $,
      Array.isArray(messages) ? messages : [],
    );
    const r = await $.session.compact({
      instructions: compactInstructions(note),
    });
    if (r.skip !== undefined) {
      $.ui.toast(`Handover written, compaction skipped: ${r.skip}`);
      return `Handover written to ${path}; compaction skipped: ${r.skip}`;
    }
    t.turnsSinceHandover = 0;
    await setPhase($, "idle");
    await $.prompt.submit({ text: continuePrompt(path, note) });
    return `Handover written to ${path}, compacted, continuing.`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    $.ui.toast(`Handover failed: ${why}`);
    return `Handover failed: ${why}`;
  } finally {
    const m = await read($, mode);
    if (m.phase === "compacting") await setPhase($, "idle");
  }
}

function cancelTimers(t: Tracker) {
  t.grace?.cancel();
  t.grace = undefined;
  t.resume?.cancel();
  t.resume = undefined;
}

async function refreshGauge($: EngineInterface) {
  const u = await $.session.usage().catch(() => undefined);
  if (!u) return;
  await update($, gauge, () => ({
    window: u.context.window,
    startedAt: u.startedAt,
    ...(u.context.percent !== undefined ? { percent: u.context.percent } : {}),
    ...(u.context.tokens !== undefined ? { tokens: u.context.tokens } : {}),
  }));
}

export const register: Register = (on, options) => {
  const yellowAt = share(options.cacheYellowAt, 0.25);
  const t: Tracker = {
    threshold:
      typeof options.threshold === "number" &&
      options.threshold > 0 &&
      options.threshold <= 100
        ? options.threshold
        : 75,
    resumeAfterLimit: options.resumeAfterLimit !== false,
    turnsSinceHandover: MIN_TURNS_BETWEEN,
    grace: undefined,
    resume: undefined,
    cache: {
      option: options.cacheTtl,
      yellowAt,
      redAt: Math.min(share(options.cacheRedAt, 0.1), yellowAt),
      toast: options.cacheToast !== false,
      env: {},
      setting: undefined,
      observed: undefined,
      prev: undefined,
      toastTimer: undefined,
    },
  };
  const pinnedTtl = t.cache.option === "5m" || t.cache.option === "1h";

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "handover",
      description: "Write the handover note, compact, and continue from it now",
    });
    await $.command.register({
      name: "continuity",
      description:
        "Show continuity's status, or pause and resume it: /continuity [on|off]",
    });
    await refreshGauge($);
    t.cache.env = await readCacheEnv($);
    t.cache.setting = await readCacheSetting($);
    // a reload drops the timers: a pending grace or a limit wait starts over as idle
    const m = await read($, mode);
    if (m.phase !== "idle") await setPhase($, "idle");
    return r;
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      cancelTimers(t);
      t.turnsSinceHandover = MIN_TURNS_BETWEEN;
      await setPhase($, "idle");
      // a new conversation, a new cache
      t.cache.prev = undefined;
      t.cache.observed = undefined;
      t.cache.toastTimer?.cancel();
      t.cache.toastTimer = undefined;
      await update($, cache, () => null);
    }
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    const r = await next(e);
    if (e.changed.includes("context")) await refreshGauge($);
    return r;
  });

  // each main-loop request's cache read/write restarts the cache countdown
  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    const c = t.cache;
    const startedAt = Date.now();
    const r = yield* next(e);
    if (!r.usage) return r;

    const cur: Sample = {
      model: r.usage.model || e.model,
      startedAt,
      read: r.usage.cache_read_input_tokens,
      write: r.usage.cache_creation_input_tokens,
      fresh: r.usage.input_tokens,
    };
    if (!pinnedTtl) c.observed = observeTtl(c.prev, cur, c.observed);
    c.prev = cur;

    const ttl = await currentTtl($, c);
    const expiresAt = expiryOf(cur, ttl);
    if (expiresAt === undefined) return r;
    const lifeMs = ttlMs(ttl);
    await update($, cache, () => ({ expiresAt, lifeMs }));

    c.toastTimer?.cancel();
    c.toastTimer = undefined;
    const redIn = expiresAt - lifeMs * c.redAt - Date.now();
    if (c.toast && redIn > 0) {
      c.toastTimer = $.clock.after(redIn, () => {
        const mins = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
        $.ui.toast(
          `Prompt cache expires in ~${mins} min: send a message to keep it warm`,
        );
      });
    }
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (e.agentId) return r;
    t.turnsSinceHandover += 1;
    await refreshGauge($);
    const g = await read($, gauge);
    const m = await read($, mode);
    if (
      m.phase === "idle" &&
      !t.grace &&
      shouldHandover({
        agentId: e.agentId,
        reason: e.reason,
        isAborted: e.isAborted,
        percent: g?.percent,
        threshold: t.threshold,
        paused: m.paused,
        turnsSinceHandover: t.turnsSinceHandover,
      })
    ) {
      await setPhase($, "pending");
      $.ui.toast(
        `Context ${g?.percent}% ≥ ${t.threshold}%: handover + compact in ${GRACE_MS / 1000} s (send a prompt or /continuity off to cancel)`,
      );
      t.grace = $.clock.after(GRACE_MS, () => void handover($, t));
    }
    return r;
  });

  // a prompt of the person's own wins over a pending handover or a limit wait
  on("prompt.submit", async ($, e, next) => {
    if (e.origin.kind === "composer") {
      const m = await read($, mode);
      if (m.phase === "pending" || m.phase === "blocked") {
        cancelTimers(t);
        await setPhase($, "idle");
        if (m.phase === "pending") $.ui.toast("Handover cancelled");
      }
    }
    return next(e);
  });

  // every compaction keeps the note's facts; after a /compact, offer to continue
  on("session.compact", async ($, e, next) => {
    if (e.agentId || e.trigger === "plugin") return next(e);
    const { path, note } = await writeNote($, e.messages);
    const instructions = [e.instructions, compactInstructions(note)]
      .filter(Boolean)
      .join("\n\n");
    const r = await next({ ...e, instructions });
    // the box takes no suggestion until the compaction has finished drawing
    if (e.trigger === "manual" && r.skip === undefined)
      $.clock.after(SUGGEST_DELAY_MS, () => {
        void $.prompt.suggest({ text: `Continue from the handover in ${path}` });
      });
    return r;
  });

  on("classic.StopFailure", async ($, e, next) => {
    const r = await next(e);
    if (e.error !== "rate_limit" || !t.resumeAfterLimit) return r;
    const m = await read($, mode);
    if (m.paused) return r;
    const usage = await $.session.usage().catch(() => undefined);
    const now = Date.now();
    const limit = blockingLimit(usage?.rateLimits ?? [], now);
    if (!limit) {
      $.ui.toast(
        "Usage limit reached; its reset time is unknown, so continuity will not resume by itself",
      );
      return r;
    }
    const resumeAt = limit.resetsAt + RESET_SLACK_MS;
    t.resume?.cancel();
    await setPhase($, "blocked", resumeAt);
    t.resume = $.clock.after(resumeAt - now, async () => {
      t.resume = undefined;
      await setPhase($, "idle");
      await $.prompt.submit({
        text: "Continue where you left off: the last turn stopped at the usage limit, which has now reset.",
      });
    });
    $.ui.toast(
      `Usage limit (${limit.kind}): continuing at ${new Date(resumeAt).toTimeString().slice(0, 5)}`,
    );
    return r;
  });

  on("command.run", { command: "handover" }, async ($) => {
    t.grace?.cancel();
    t.grace = undefined;
    return { text: await handover($, t) };
  });

  on("command.run", { command: "continuity" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg === "off") {
      cancelTimers(t);
      await update($, mode, () => ({ paused: true, phase: "idle" }));
      return {
        text: "Continuity paused: no automatic handover or limit resume until /continuity on.",
      };
    }
    if (arg === "on") {
      await update($, mode, (m) => ({ ...m, paused: false }));
      return { text: `Continuity on: handover at ${t.threshold}%.` };
    }
    const g = await read($, gauge);
    const m = await read($, mode);
    const fill =
      g?.percent === undefined ? "not measured yet" : `${g.percent}%`;
    return {
      text: `Continuity ${m.paused ? "paused" : "on"} · context ${fill} · handover at ${t.threshold}% · ${m.phase}${
        m.resumeAt
          ? ` until ${new Date(m.resumeAt).toTimeString().slice(0, 5)}`
          : ""
      }`,
    };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const g = await read($, gauge);
    if (e.props.hasSurvey || !g) return next(e);
    const m = await read($, mode);
    const d = await read($, cache);
    const below = await next(e);
    if (e.surface === "terminal" || e.surface === "desktop") {
      const { Box, Client } = $.ui.resolve(e);
      const props: GaugeProps = {
        percent: g.percent ?? null,
        tokens: g.tokens ?? null,
        window: g.window,
        startedAt: g.startedAt,
        threshold: t.threshold,
        phase: m.phase,
        paused: m.paused,
        resumeAt: m.resumeAt ?? null,
        cache: d && {
          ...d,
          yellowAt: t.cache.yellowAt,
          redAt: t.cache.redAt,
        },
      };
      // its own lines first, a row above the tip line; other bands below
      return (
        <Box flexDirection="column" marginTop={1}>
          <Client key="continuity-gauge" module="./gauge.tsx" props={props} />
          {below}
        </Box>
      );
    }
    const { Box, Text } = $.ui.resolve(e);
    const pct = g.percent;
    const until = d && ` · cache until ${new Date(d.expiresAt).toTimeString().slice(0, 5)}`;
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text
          dimColor
        >{`ctx ${pct === undefined ? "--" : `${bar(pct, 10)} ${pct}%`} · session ${fmtLength(Date.now() - g.startedAt)}${until ?? ""}`}</Text>
        {below}
      </Box>
    );
  });
};
