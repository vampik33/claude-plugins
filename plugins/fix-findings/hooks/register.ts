import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import { LEDGER_SUFFIX, ownedBy, parseLedger, reprompt } from "./core.ts";

const NAME = "fix-findings";
/** Whether the running turn is one this mod sent the model back into. */
const continued = atom(
  { plugin: "fix-findings", key: "continued" } as const,
  false,
);
const BUSY = new Set(["pending", "running"]);

/** Sends the model back; a prompt that did not enter frees the send-back and says why. */
async function sendBack($: EngineInterface, text: string) {
  let why: string | undefined;
  try {
    why = (await $.prompt.submit({ text })).drop;
  } catch (err) {
    why = err instanceof Error ? err.message : String(err);
  }
  if (why === undefined) return;
  await update($, continued, () => false);
  $.ui.toast(`fix-findings could not send Claude back to the loop: ${why}`);
}

/**
 * Not classic.Stop: an organization-managed Claude Code skips the classic hooks
 * of plugins it doesn't list. So the model is sent back with a prompt after the
 * turn ends, rather than by blocking the stop.
 */
export const register: Register = (on) => {
  // a prompt that starts a turn: ours keeps the continuation, any other ends it
  on("prompt.submit", async ($, e, next) => {
    if (e.turnId === undefined) {
      const ours = e.origin.kind === "plugin" && e.origin.name === NAME;
      await update($, continued, () => ours);
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    // once a turn something else started, so it can never hold the model forever
    if (e.agentId || e.reason !== "answer" || (await read($, continued)))
      return r;
    // work still in flight will wake it
    if ((await $.agent.list()).some((a) => BUSY.has(a.status))) return r;

    let text: string;
    try {
      text = await $.fs.read(`${await $.session.cwd()}${LEDGER_SUFFIX}`);
    } catch {
      return r; // no ledger, no loop
    }
    if (!ownedBy(text, await $.session.id())) return r;
    const block = reprompt(parseLedger(text));
    if (!block) return r;
    await update($, continued, () => true);
    // a plugin's prompt runs once the session is idle, after this turn ends: don't wait on it here
    void sendBack($, block).catch(() => {});
    return r;
  });
};
