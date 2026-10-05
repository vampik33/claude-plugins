/** When each typed prompt was sent, by its transcript row id; and turn ends by duration. */
export type PromptClockTimes = {
  /** row uuid -> ms since the epoch */
  sent: Record<string, number>;
  /** prompt text -> ms, for a row whose id the render does not carry */
  byText: Record<string, number>;
  /** a turn's durationMs -> when it ended, ms since the epoch */
  turns: Record<string, number>;
};

declare module 'claude-code' {
  interface PluginState {
    'prompt-clock': { times: PromptClockTimes };
  }
}
