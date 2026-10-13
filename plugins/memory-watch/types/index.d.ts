/** One write to an auto-memory file, as the pane lists it. */
export type MemoryChange = {
  /** When it was written, ms since epoch. */
  at: number;
  /** The file's name in the memory dir: `feedback_testing.md`, `MEMORY.md`. */
  file: string;
  action: "created" | "updated";
  /** The frontmatter's `name`, `description` and `type`, where it has them. */
  name?: string;
  description?: string;
  type?: string;
  /** Lines the write added and removed. */
  added: number;
  removed: number;
};

declare module "claude-code" {
  interface PluginState {
    "memory-watch": {
      /** Newest first, at most MAX_CHANGES. */
      changes: MemoryChange[];
      /** Whether the pane is open, as the last open or close left it. */
      pane: boolean;
      /** Changes recorded since the pane was last open. */
      unread: number;
    };
  }
}
