/**
 * ttl.ts — which prompt-cache lifetime the main conversation gets, and the
 * countdown's arithmetic. Pure: no `$`, no engine.
 *
 * The TTL rules are ported from prompt-cache-control (claude-code-templates,
 * MIT): Claude Code's documented order, then a correction from request timing.
 */

export type Ttl = "5m" | "1h";

export type CacheEnv = {
  enable1h?: string;
  force5m?: string;
  /** CLAUDE_CODE_PROMPT_CACHE_TTL: "5m" or "1h" for the main conversation */
  ttlVar?: string;
};

/** What the account is billed as, as far as the mod can tell. */
export type Account = "subscription" | "credits" | "other";

/** One main-loop request, as the API reported it. */
export type Sample = {
  model: string;
  /** ms since the epoch when the request started: the cache lives from here */
  startedAt: number;
  read: number;
  write: number;
  fresh: number;
};

export type Color = "green" | "yellow" | "red";

export const isOn = (v: string | undefined) =>
  v === "1" || v?.toLowerCase() === "true";

const asTtl = (v: unknown): Ttl | undefined =>
  v === "5m" || v === "1h" ? v : undefined;

/**
 * The option, FORCE_PROMPT_CACHING_5M, CLAUDE_CODE_PROMPT_CACHE_TTL, the
 * promptCacheTtl setting, ENABLE_PROMPT_CACHING_1H, then the account's
 * default: 1 hour on a subscription within plan usage, else 5 minutes.
 */
export function decideTtl(
  option: unknown,
  env: CacheEnv,
  setting?: unknown,
  account?: Account,
): Ttl {
  const pinned = asTtl(option);
  if (pinned) return pinned;
  if (isOn(env.force5m)) return "5m";
  const fromVar = asTtl(env.ttlVar);
  if (fromVar) return fromVar;
  const fromSetting = asTtl(setting);
  if (fromSetting) return fromSetting;
  if (isOn(env.enable1h)) return "1h";
  return account === "subscription" ? "1h" : "5m";
}

/** A five-hour or seven-day window means a subscription; a full one means usage credits. */
export function accountOf(
  windows: readonly { kind: string; percentUsed: number }[],
): Account {
  const plan = windows.filter(
    (w) => w.kind === "five_hour" || w.kind === "seven_day",
  );
  if (plan.length === 0) return "other";
  return plan.some((w) => w.percentUsed >= 100) ? "credits" : "subscription";
}

export const ttlMs = (ttl: Ttl) => (ttl === "1h" ? 3_600_000 : 300_000);

const promptTokens = (s: Sample) => s.read + s.write + s.fresh;

// requests are timed from their start, so a little slack keeps a hit that
// landed just inside the lifetime from reading as proof of the longer one
const SLACK_MS = 10_000;

/**
 * What the traffic says about the lifetime: a hit more than 5 minutes after the
 * previous request proves 1 hour (and stays proven); a miss 5 to 60 minutes
 * after it, same model and a prompt that did not shrink, says 5 minutes.
 */
export function observeTtl(
  prev: Sample | undefined,
  cur: Sample,
  known: Ttl | undefined,
): Ttl | undefined {
  if (!prev || prev.read + prev.write === 0 || cur.model !== prev.model)
    return known;
  const gap = cur.startedAt - prev.startedAt;
  const before = promptTokens(prev);
  if (gap <= ttlMs("5m") + SLACK_MS) return known;
  if (cur.read >= before * 0.5) return "1h";
  if (known === "1h") return known;
  const lapsed =
    cur.write > 0 &&
    promptTokens(cur) >= before * 0.7 &&
    gap < ttlMs("1h") + SLACK_MS;
  return lapsed ? "5m" : known;
}

/** When the cache this request touched expires; undefined if it touched none. */
export const expiryOf = (s: Sample, ttl: Ttl): number | undefined =>
  s.read + s.write > 0 ? s.startedAt + ttlMs(ttl) : undefined;

/** Green above `yellowAt` of the lifetime left, yellow down to `redAt`, red below. */
export function colorFor(
  leftMs: number,
  lifeMs: number,
  yellowAt: number,
  redAt: number,
): Color {
  if (lifeMs <= 0) return "red";
  const share = leftMs / lifeMs;
  if (share <= redAt) return "red";
  return share <= yellowAt ? "yellow" : "green";
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
