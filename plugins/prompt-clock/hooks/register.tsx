import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { PromptClockTimes } from "../types";
import {
  cap,
  emptyTimes,
  fmtDuration,
  parseTranscript,
  promptText,
  stampText,
  turnEnd,
  turnRange,
} from "./core.ts";

const times = atom(
  { plugin: "prompt-clock", key: "times" } as const,
  emptyTimes(),
);

/** Folds the transcript file's times under what the session already stamped. */
async function loadTranscript($: EngineInterface, path: string): Promise<void> {
  let jsonl: string;
  try {
    jsonl = await $.fs.read(path);
  } catch {
    return; // a new session has no file yet
  }
  const fromFile = parseTranscript(jsonl);
  await update($, times, (t) => ({
    sent: cap({ ...fromFile.sent, ...t.sent }),
    byText: cap({ ...fromFile.byText, ...t.byText }),
    turns: cap({ ...fromFile.turns, ...t.turns }),
  }));
}

export const register: Register = (on, options) => {
  const seconds = options.seconds !== false;
  const showRange = options.turnRange !== false;

  // a resumed session: earlier prompts' times come from its own transcript
  on("classic.SessionStart", async ($, e, next) => {
    const r = await next(e);
    if (e.source === "resume" || e.source === "startup")
      await loadTranscript($, e.transcript_path);
    return r;
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") await update($, times, () => emptyTimes());
    return next(e);
  });

  // a typed prompt becomes a row: stamp it by the row's id
  on("session.append", { door: "prompt" }, async ($, e, next) => {
    const r = await next(e);
    if (e.agentId || e.origin.kind !== "composer" || "deny" in r) return r;
    const text = promptText(e.message.content);
    if (text === undefined) return r;
    const at = Date.now();
    await update($, times, (t: PromptClockTimes) => ({
      ...t,
      sent: cap({ ...t.sent, [r.uuid]: at }),
      byText: cap({ ...t.byText, [text]: at }),
    }));
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) {
      const end = Date.now();
      await update($, times, (t) => ({
        ...t,
        turns: cap({ ...t.turns, [String(e.durationMs)]: end }),
      }));
    }
    return r;
  });

  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    if (e.props.origin.kind !== "composer") return next(e);
    const t = await read($, times);
    const at =
      (e.requestId ? t.sent[e.requestId] : undefined) ?? t.byText[e.props.text];
    if (at === undefined) return next(e);
    return next({
      ...e,
      props: {
        ...e.props,
        text: stampText(e.props.text, at, Date.now(), seconds),
      },
    });
  });

  on("ui.render", { component: "TurnDuration" }, async ($, e, next) => {
    if (!showRange) return next(e);
    const t = await read($, times);
    const end = turnEnd(t.turns, e.props.durationMs);
    if (end === undefined) return next(e);
    // the engine's line is opaque and takes the row, so the mod draws the whole line
    const { Text } = $.ui.resolve(e);
    const range = turnRange(end, e.props.durationMs, Date.now(), seconds);
    return <Text dimColor>{`✻ ${e.props.word} for ${fmtDuration(e.props.durationMs)} · ${range}`}</Text>;
  });
};
