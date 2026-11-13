import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { ChatViewTimes } from "../types";
import {
  bubbleWidth,
  cap,
  emptyTimes,
  fmtDuration,
  fmtTime,
  isCommandEcho,
  isOwnPrompt,
  mergeTimes,
  parseTranscript,
  promptText,
  replyText,
  sentLine,
  stampReply,
  stampText,
  textBlocks,
  timeOf,
  turnEnd,
  turnRange,
} from "./core.ts";

const times = atom(
  { plugin: "chat-view", key: "times" } as const,
  emptyTimes(),
);

/**
 * When each main-loop text block of the current step streamed its first
 * non-blank token, oldest first, until its row is appended. Transient: a
 * reload mid-stream costs that reply its first-token time, nothing more.
 */
const pending: number[] = [];

/** Folds the transcript file's times under what the session already stamped. */
async function loadTranscript($: EngineInterface, path: string): Promise<void> {
  let jsonl: string;
  try {
    jsonl = await $.fs.read(path);
  } catch {
    return; // a new session has no file yet
  }
  const fromFile = parseTranscript(jsonl);
  await update($, times, (t) => mergeTimes(fromFile, t));
}

export const register: Register = (on, options) => {
  const seconds = options.seconds !== false;
  const showRange = options.turnRange !== false;
  const bubbles = options.bubbles !== false;

  // a resumed or forked session: earlier times come from its own transcript
  on("classic.SessionStart", async ($, e, next) => {
    const r = await next(e);
    if (e.source === "resume" || e.source === "fork")
      await loadTranscript($, e.transcript_path);
    return r;
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      pending.length = 0;
      await update($, times, () => emptyTimes());
    }
    return next(e);
  });

  // a typed prompt becomes a row: stamp it by the row's id
  on("session.append", { door: "prompt" }, async ($, e, next) => {
    const r = await next(e);
    if (e.agentId || !isOwnPrompt(e.origin) || "deny" in r) return r;
    if (e.message.isMeta) return r;
    const text = promptText(e.message.content);
    if (text === undefined) return r;
    const at = await $.clock.now();
    await update($, times, (t: ChatViewTimes) => ({
      ...t,
      sent: cap({ ...t.sent, [r.uuid]: at }),
      byText: cap({ ...t.byText, [text]: at }),
    }));
    return r;
  });

  // a typed slash command's echo: the engine draws it and no ui.render hook
  // sees it, so its send time is a line of its own under it (kept in the transcript)
  on("session.append", { door: "command" }, async ($, e, next) => {
    const r = await next(e);
    if (e.agentId || !isOwnPrompt(e.origin) || "deny" in r) return r;
    if (e.message.isMeta || !isCommandEcho(e.message.content)) return r;
    const at = await $.clock.now();
    $.ui.log(sentLine(fmtTime(at, at, seconds)));
    return r;
  });

  // each text block's first token, as it streams
  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    // a step's leftovers (an interrupted stream) never shift a later step's rows
    pending.length = 0;
    const started = new Set<number>();
    const stream = next(e);
    for await (const chunk of stream) {
      if (
        chunk.kind === "text" &&
        !started.has(chunk.index) &&
        chunk.text.trim() !== ""
      ) {
        started.add(chunk.index);
        pending.push(await $.clock.now());
      }
      yield chunk;
    }
    return await stream.result;
  });

  // a reply's text block becomes a row: give it the first-token time its block streamed
  on("session.append", { door: "response" }, async ($, e, next) => {
    const r = await next(e);
    if (e.agentId || "deny" in r) return r;
    const text = replyText(e.message.content);
    if (text === undefined) return r;
    // one first token per block; none streamed (an engine stand-in, a reload mid-stream): when the row was written
    const streamed = pending.splice(0, textBlocks(e.message.content).length);
    const at = streamed[0] ?? (await $.clock.now());
    await update($, times, (t: ChatViewTimes) => ({
      ...t,
      replies: cap({ ...t.replies, [r.uuid]: at }),
      repliesByText: cap({ ...t.repliesByText, [text]: at }),
    }));
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) {
      const end = await $.clock.now();
      await update($, times, (t) => ({
        ...t,
        turns: cap({ ...t.turns, [String(e.durationMs)]: end }),
      }));
    }
    return r;
  });

  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    if (!isOwnPrompt(e.props.origin) || e.props.from || e.props.task)
      return next(e);
    const t = await read($, times);
    const at =
      (e.requestId ? timeOf(t.sent, e.requestId) : undefined) ??
      timeOf(t.byText, e.props.text);
    const stamp =
      at === undefined ? undefined : fmtTime(at, await $.clock.now(), seconds);

    if (bubbles && e.surface === "terminal") {
      const { Box, Text } = $.ui.resolve(e);
      const width = bubbleWidth(e.props.text, e.viewport?.columns ?? 80);
      return (
        <Box
          flexDirection="column"
          alignItems="flex-end"
          width="100%"
          marginTop={1}
        >
          <Box
            key="chat-view-bubble"
            borderStyle="round"
            borderColor="subtle"
            paddingX={1}
            width={width}
          >
            <Text wrap="wrap">{e.props.text}</Text>
          </Box>
          {stamp === undefined ? null : <Text dimColor>{stamp}</Text>}
        </Box>
      );
    }

    if (stamp === undefined) return next(e);
    return next({
      ...e,
      props: { ...e.props, text: stampText(e.props.text, stamp) },
    });
  });

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (!e.props.isFirstOfReply) return next(e);
    const t = await read($, times);
    const at =
      (e.requestId ? timeOf(t.replies, e.requestId) : undefined) ??
      timeOf(t.repliesByText, e.props.text.trim());
    if (at === undefined) return next(e);
    return next({
      ...e,
      props: {
        ...e.props,
        text: stampReply(e.props.text, at, await $.clock.now(), seconds),
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
    const range = turnRange(
      end,
      e.props.durationMs,
      await $.clock.now(),
      seconds,
    );
    return (
      <Text
        dimColor
      >{`✻ ${e.props.word} for ${fmtDuration(e.props.durationMs)} · ${range}`}</Text>
    );
  });
};
