export type FleetAgent = {
  id: string;
  type: string;
  description: string;
  model?: string;
  startedAt: number;
  endedAt?: number;
  /** AgentStatus, as `$.agent.list()` or a task notification last said */
  status: string;
  /** The last tool it called, short: "Bash cargo clippy" */
  lastTool?: string;
  tools: number;
  /** A teammate goes idle between turns, so its turn's end is no finish */
  teammate?: boolean;
};

/** A fraction done, and where the reading started, for the ETA. */
export type FleetProgress = {
  frac: number;
  firstAt: number;
  firstFrac: number;
};

export type FleetShell = {
  id: string;
  command: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  /** The file the engine writes the shell's output to */
  outputFile?: string;
  /** The output file's size at the last look */
  size?: number;
  /** When the output last grew (ms) */
  outputAt?: number;
  /** The last non-blank line of output */
  line?: string;
  progress?: FleetProgress;
  /** A wait loop (`until …; do sleep`): quiet by design, never stalled */
  waiter?: boolean;
  /** No output for the stall time; set once, cleared by new output */
  stalled?: boolean;
};

export type FleetTree = {
  name: string;
  path: string;
  changed: number;
  ahead: number;
  behind: number;
};

export type FleetState = {
  agents: FleetAgent[];
  shells: FleetShell[];
  trees: FleetTree[];
  /** When the current batch's first item started; unset between batches */
  batchStart?: number;
  /** Whether this batch already opened the pane by itself */
  autoOpened: boolean;
};

declare module "claude-code" {
  interface PluginState {
    /** pane: whether the fleet pane is open (shown or a tab); lastPrompt: when the person last sent a prompt (ms), for the away check */
    fleet: { fleet: FleetState; pane: boolean; lastPrompt: number };
  }
}
