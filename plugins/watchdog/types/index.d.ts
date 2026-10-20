/** One Bash command the model ran, from its call to its end. */
export type WatchRun = {
  /** The call's tool_use_id */
  id: string;
  command: string;
  /** The background task id, once it has one: started there, or moved there */
  taskId?: string;
  startedAt: number;
  /** When its shell went away (or its foreground call answered) */
  endedAt?: number;
  /** The shell's pid and its whole process tree, at the last look */
  pid?: number;
  pids?: number[];
  /** The file the engine writes its output to */
  outputFile?: string;
  /** The output file's size at the last look */
  size?: number;
  /** CPU clock ticks of the tree at the last look */
  ticks?: number;
  /** Bytes the tree had read and written at the last look */
  io?: number;
  /** When it last printed, used CPU, moved data, ran a sleep or served */
  activeAt?: number;
  /** The last non-blank line of output */
  line?: string;
  /** A `sleep` in its tree at the last look */
  sleeping?: boolean;
  /** A listening TCP socket or an inotify watch in its tree at the last look: a server or a watcher */
  serving?: boolean;
  /** When the watchdog stopped it */
  killedAt?: number;
  /** The KILL after the grace went out */
  killSent?: boolean;
};

declare module "claude-code" {
  interface PluginState {
    /** runs: the session's Bash commands, live and the newest ended */
    watchdog: { runs: WatchRun[] };
  }
}
