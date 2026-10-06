export type ContinuityGauge = {
  /** Context fill, 0-100, once a response reported one */
  percent?: number;
  tokens?: number;
  window: number;
  /** When the session counts from ($.session.usage().startedAt) */
  startedAt: number;
};

export type ContinuityMode = {
  paused: boolean;
  /** pending: handover in its 5 s grace; compacting: under way; blocked: waiting out a usage limit */
  phase: "idle" | "pending" | "compacting" | "blocked";
  /** While blocked: when the limit resets and the session continues */
  resumeAt?: number;
};

/** When the cache the last main-loop request touched expires, and its lifetime. */
export type CacheDeadline = { expiresAt: number; lifeMs: number };

declare module "claude-code" {
  interface PluginState {
    continuity: {
      gauge: ContinuityGauge | null;
      mode: ContinuityMode;
      cache: CacheDeadline | null;
    };
  }
}
