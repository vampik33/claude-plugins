import type { Register } from "claude-code";

import { LEDGER_SUFFIX, ownedBy, parseLedger, reprompt } from "./core.ts";

export const register: Register = (on) => {
  on("classic.Stop", async ($, e, next) => {
    const r = await next(e);
    // once a turn, so it can never hold the model forever; work still in flight will wake it
    if (r.block || e.stop_hook_active || e.background_tasks?.length) return r;

    let text: string;
    try {
      text = await $.fs.read(`${e.cwd}${LEDGER_SUFFIX}`);
    } catch {
      return r; // no ledger, no loop
    }
    if (!ownedBy(text, e.session_id)) return r;
    const block = reprompt(parseLedger(text));
    return block ? { ...r, block } : r;
  });
};
