/** One clickable row: an agent inserts `@agent-<name>`, a command or skill `/<name>`. */
export type PaletteItem = {
  kind: "agent" | "command";
  name: string;
  description: string;
};

/** Items of one source: `project`, `user`, `plugin:<name>` or `mcp`. */
export type PaletteGroup = {
  id: string;
  title: string;
  items: PaletteItem[];
};

/** How often an item was used, and when last (ms since epoch). */
export type Use = { count: number; last: number };

/** Uses by `<kind>:<name>` (`command:think`, `agent:rust-engineer`). */
export type Usage = Record<string, Use>;

declare module "claude-code" {
  interface PluginState {
    palette: {
      groups: PaletteGroup[];
      /** Whether the pane is open, as the last open or close left it. */
      pane: boolean;
      /** Group ids the person folded. */
      folded: string[];
      /** Agent descriptions by type, as `agent.offer` last carried them. */
      agentInfo: Record<string, string>;
      /** Uses across sessions, as `$.store` keeps them. */
      usage: Usage;
    };
  }
}
