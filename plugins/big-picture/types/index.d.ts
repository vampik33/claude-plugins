/** Where the summary stands: what the band line shows. */
export type SummaryStatus =
  | { kind: "none" }
  /** Jev or the fork is at work. */
  | { kind: "working"; step: "classifying" | "writing" }
  /** The page was last written at `at` (ms since epoch). */
  | { kind: "ready"; at: number }
  | { kind: "failed"; reason: string };

declare module "claude-code" {
  interface PluginState {
    "big-picture": {
      status: SummaryStatus;
      /** The Orca browser page showing the summary, while its tab is open. */
      tab: string | null;
      /** Outside Orca: whether the summary's terminal pane is open. */
      pane: boolean;
      /** Outside Orca: the text summary the pane shows, once written. */
      text: string | null;
    };
  }
}
