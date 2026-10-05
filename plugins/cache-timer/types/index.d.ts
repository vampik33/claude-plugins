/** When the cache the last main-loop request touched expires, and its lifetime. */
export type CacheDeadline = { expiresAt: number; lifeMs: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-timer': { deadline: CacheDeadline | null }
  }
}
