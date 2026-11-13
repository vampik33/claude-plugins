/** What tool-lens measured for one tool call. */
export type ToolLensStats = {
  /** How long the call ran, in ms. */
  ms?: number;
  /** True when `ms` is Claude Code's own `duration_ms` (no permission wait); false for the hook's wall clock. */
  isExact?: boolean;
  /** Estimated tokens: the arguments the model wrote plus the result it read. */
  tokens?: number;
  /** True when read back from the session log: `ms` then includes any approval wait. */
  isFromLog?: true;
};

declare module "claude-code" {
  interface PluginState {
    "tool-lens": {
      /** Per tool_use_id. */
      stats: StateFamily<ToolLensStats | null>;
      /** Calls read back from the session log, by tool_use_id: those made before the mod loaded. */
      logged: Record<string, ToolLensStats>;
      /** Per tool_use_id: whether the diff is expanded. */
      isOpen: StateFamily<boolean>;
    };
  }
}
