import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { CacheDeadline } from "../types";
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

const deadline = atom(
  { plugin: "cache-timer", key: "deadline" } as const,
  null as CacheDeadline | null,
);

/** What the module learns as the session goes; a reload starts it over. */
type Tracker = {
  option: unknown;
  env: CacheEnv;
  setting: unknown;
  observed: Ttl | undefined;
  prev: Sample | undefined;
  toastTimer: { cancel: () => void } | undefined;
};

async function readSetting($: EngineInterface): Promise<unknown> {
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

async function readEnv($: EngineInterface): Promise<CacheEnv> {
  const none = () => undefined;
  return {
    enable1h: await $.env.get("ENABLE_PROMPT_CACHING_1H").catch(none),
    force5m: await $.env.get("FORCE_PROMPT_CACHING_5M").catch(none),
    ttlVar: await $.env.get("CLAUDE_CODE_PROMPT_CACHE_TTL").catch(none),
  };
}

async function currentTtl($: EngineInterface, t: Tracker): Promise<Ttl> {
  if (t.observed) return t.observed;
  const usage = await $.session.usage().catch(() => undefined);
  return decideTtl(
    t.option,
    t.env,
    t.setting,
    accountOf(usage?.rateLimits ?? []),
  );
}

const share = (v: unknown, fallback: number) =>
  typeof v === "number" && v > 0 && v < 1 ? v : fallback;

export const register: Register = (on, options) => {
  const yellowAt = share(options.yellowAt, 0.25);
  const redAt = Math.min(share(options.redAt, 0.1), yellowAt);
  const wantToast = options.toast !== false;
  const pinned = options.ttl === "5m" || options.ttl === "1h";
  const t: Tracker = {
    option: options.ttl,
    env: {},
    setting: undefined,
    observed: undefined,
    prev: undefined,
    toastTimer: undefined,
  };

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    t.env = await readEnv($);
    t.setting = await readSetting($);
    return r;
  });

  // /clear starts a new conversation in the same process, and a new cache
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      t.prev = undefined;
      t.observed = undefined;
      t.toastTimer?.cancel();
      t.toastTimer = undefined;
      await update($, deadline, () => null);
    }
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
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
    if (!pinned) t.observed = observeTtl(t.prev, cur, t.observed);
    t.prev = cur;

    const ttl = await currentTtl($, t);
    const expiresAt = expiryOf(cur, ttl);
    if (expiresAt === undefined) return r;
    const lifeMs = ttlMs(ttl);
    await update($, deadline, () => ({ expiresAt, lifeMs }));

    t.toastTimer?.cancel();
    t.toastTimer = undefined;
    const redIn = expiresAt - lifeMs * redAt - Date.now();
    if (wantToast && redIn > 0) {
      t.toastTimer = $.clock.after(redIn, () => {
        const mins = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
        $.ui.toast(
          `Prompt cache expires in ~${mins} min: send a message to keep it warm`,
        );
      });
    }
    return r;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const d = await read($, deadline);
    if (e.props.hasSurvey || !d) return next(e);

    const below = await next(e);

    if (e.surface === "terminal" || e.surface === "desktop") {
      const { Box, Client } = $.ui.resolve(e);
      return (
        <Box flexDirection="row" columnGap={3}>
          {below}
          <Client
            key="cache-clock"
            module="./clock.tsx"
            props={{ ...d, yellowAt, redAt }}
          />
        </Box>
      );
    }
    const { Box, Text } = $.ui.resolve(e);
    const until = new Date(d.expiresAt).toTimeString().slice(0, 5);
    return (
      <Box flexDirection="row" columnGap={3}>
        {below}
        <Text dimColor>{`cache until ${until}`}</Text>
      </Box>
    );
  });
};
