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

export type FleetShell = {
  id: string;
  command: string;
  startedAt: number;
  endedAt?: number;
  status: string;
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
    fleet: { fleet: FleetState };
  }
}
