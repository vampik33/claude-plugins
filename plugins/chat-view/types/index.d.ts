/** When each typed prompt was sent and each reply started, by transcript row id; and turn ends by duration. */
export type ChatViewTimes = {
  /** prompt row uuid -> ms since the epoch */
  sent: Record<string, number>;
  /** prompt text -> ms, for a row whose id the render does not carry */
  byText: Record<string, number>;
  /** a turn's durationMs -> when it ended, ms since the epoch */
  turns: Record<string, number>;
  /** reply row uuid -> when its first token streamed, ms since the epoch */
  replies: Record<string, number>;
  /** reply text, trimmed -> ms, for a row whose id the render does not carry */
  repliesByText: Record<string, number>;
};

declare module "claude-code" {
  interface PluginState {
    "chat-view": { times: ChatViewTimes };
  }
}
