declare module "claude-code" {
  interface PluginState {
    "fix-findings": {
      /** Whether the running turn is one this mod sent the model back into. */
      continued: boolean;
    };
  }
}
