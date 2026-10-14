/** A mod whose installed copy is not the repo's version. */
export type ShipStale = {
  name: string;
  installed: string;
  repo: string;
};

export type ShipStatus = {
  branch: string;
  hasUpstream: boolean;
  ahead: number;
  changed: number;
  stale: ShipStale[];
  /** Mods installed at another version than this session loaded */
  restart: string[];
};

declare module "claude-code" {
  interface PluginState {
    /**
     * status: the repo and the installed mods, as last read; loaded: each
     * installed plugin's version when the session (re)loaded its plugins;
     * running: whether /ship is under way
     */
    ship: {
      status: ShipStatus | null;
      loaded: Record<string, string>;
      running: boolean;
    };
  }
}
