import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { SummaryStatus } from "../types";
import {
  BIG_AT,
  cleanText,
  emptyActivity,
  extractHtml,
  fmtTime,
  isCheckDue,
  isRewriteDue,
  JEV_URL,
  jevBigRequest,
  jevProgressRequest,
  type JevQuestion,
  jevUpdateRequest,
  liveShells,
  logTool,
  mayBeBig,
  mergeActivity,
  type Message,
  OPEN_MS,
  openArgv,
  parseJev,
  placeholderHtml,
  digest,
  PROGRESS_EVERY_MS,
  type Progress,
  securePage,
  summaryPrompt,
  summarySystem,
  TAIL_BYTES,
} from "./core.ts";
import { SHOW_ME } from "./show-me.ts";
import { STACK, stackRows } from "./stack.ts";

const status = atom(
  { plugin: "big-picture", key: "status" } as const,
  { kind: "none" } as SummaryStatus,
);

const SUMMARY_MODEL = "haiku";
const SUMMARY_TOKENS = 16_000;
const SUMMARY_MS = 180_000;
const PLACEHOLDER =
  "No big work in this session yet. This page fills in once Jev judges the work big, and keeps up while it goes on.";

// the session's work; a reload starts it over
/** The current turn's work: what Jev judges "big" on. */
let activity = emptyActivity("");
/** All work since the summary was last written: what Jev judges "update" on. */
let since = emptyActivity("");
/** Once Jev judged the work big, later checks ask whether to update instead. */
let isBig = false;
/** The page last written, handed to Haiku to update. */
let lastSummary: string | undefined;
/** When the page was last written (ms since epoch). */
let lastWrittenAt: number | undefined;
/** The running commands' output when the summary was last written or a progress check last looked. */
let lastProgress: string | undefined;
let running = false;
/** What asked for a check: tool calls, a turn's end, the progress timer, or a press. */
type Why = "tools" | "turn" | "progress" | "manual";
/** Checks asked for while one ran: they run after it, each kind once. */
let queued = new Set<Why>();
let warned = false;
/** Looks at the running shells every PROGRESS_EVERY_MS. */
let progressWatch: { cancel: () => void } | undefined;

const setStatus = ($: EngineInterface, s: SummaryStatus) =>
  update($, status, () => s);

async function pagePath($: EngineInterface): Promise<string> {
  const home = (await $.env.get("HOME").catch(() => undefined)) ?? "/tmp";
  return `${home}/.claude/big-picture/${await $.session.id()}.html`;
}

async function writePage($: EngineInterface, html: string): Promise<string> {
  const path = await pagePath($);
  await $.process.run(["mkdir", "-p", path.slice(0, path.lastIndexOf("/"))]);
  await $.fs.write(path, html);
  return path;
}

const messagesOf = async ($: EngineInterface): Promise<Message[]> => {
  const messages = await $.session.messages().catch(() => []);
  return Array.isArray(messages) ? messages : [];
};

/** The background shells still running and the end of each one's output; one whose file is gone is left out. */
async function readProgress(
  $: EngineInterface,
  messages: readonly Message[],
): Promise<Progress[]> {
  const progress: Progress[] = [];
  for (const shell of liveShells(messages)) {
    const ran = await $.process
      .run(["tail", "-c", String(TAIL_BYTES), shell.outputFile])
      .catch(() => undefined);
    if (ran?.exitCode === 0)
      progress.push({ command: shell.command, tail: cleanText(ran.stdout) });
  }
  return progress;
}

/** The TypeSafe key Jev needs; without one, a toast the first time. */
async function jevKey($: EngineInterface): Promise<string | undefined> {
  const key = await $.env.get("TYPESAFE_API_KEY").catch(() => undefined);
  if (!key && !warned) $.ui.toast("big-picture: set TYPESAFE_API_KEY for Jev");
  warned ||= !key;
  return key || undefined;
}

/** Jev's p(yes) to one question; undefined (status failed) when it did not answer. */
async function askJev(
  $: EngineInterface,
  key: string,
  name: JevQuestion,
  body: unknown,
): Promise<number | undefined> {
  const res = await $.http
    .fetch(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    })
    .catch(() => undefined);
  const p = res?.ok ? parseJev(res.text, name) : undefined;
  if (p === undefined)
    await setStatus($, {
      kind: "failed",
      reason: res ? `Jev answered HTTP ${res.status}` : "Jev was not reached",
    });
  return p;
}

/**
 * Asks Jev one question with the line on classifying: true on a yes; false on
 * a no, the line as it was; undefined when Jev did not answer (status failed).
 */
async function jevSaysYes(
  $: EngineInterface,
  key: string,
  name: JevQuestion,
  body: unknown,
): Promise<boolean | undefined> {
  const was = await read($, status);
  await setStatus($, { kind: "working", step: "classifying" });
  const p = await askJev($, key, name, body);
  if (p === undefined) return undefined;
  if (p < BIG_AT) await setStatus($, was);
  return p >= BIG_AT;
}

/** Writes the page; work it did not cover is kept for the next check, all of it on a failure. */
async function summarize($: EngineInterface): Promise<void> {
  // the transcript read now covers `covered`; work logged while Haiku writes stays in `since`
  const covered = since;
  since = emptyActivity("");
  let isWritten = false;
  try {
    isWritten = await writeSummary($);
  } finally {
    if (!isWritten) since = mergeActivity(covered, since);
  }
}

/**
 * Haiku writes the summary page from the transcript (and updates the last
 * one); an open page picks it up on its next refresh.
 */
async function writeSummary($: EngineInterface): Promise<boolean> {
  await setStatus($, { kind: "working", step: "writing" });
  const messages = await messagesOf($);
  const progress = await readProgress($, messages);
  const reply = await $.model.complete({
    model: SUMMARY_MODEL,
    system: [{ text: summarySystem(SHOW_ME), cache: true }],
    prompt: summaryPrompt(digest(messages), lastSummary, progress),
    maxTokens: SUMMARY_TOKENS,
    timeoutMs: SUMMARY_MS,
  });
  if (!reply.isAnswered) {
    await setStatus($, { kind: "failed", reason: reply.reason });
    return false;
  }
  const summary = extractHtml(reply.text);
  if (!summary) {
    await setStatus($, { kind: "failed", reason: "the reply held no HTML page" });
    return false;
  }
  // the transcript may carry injected text: the page runs no script of the model's
  await writePage($, securePage(summary));
  lastSummary = summary;
  lastProgress = JSON.stringify(progress);
  lastWrittenAt = await $.clock.now();
  await setStatus($, { kind: "ready", at: lastWrittenAt });
  return true;
}

/**
 * Asks Jev whether the work is big until it is, and writes the summary; from
 * then on asks Jev whether the work since needs the summary updated.
 */
async function checkOnce(
  $: EngineInterface,
  isTurnEnd: boolean,
): Promise<void> {
  // a turn that changed no file neither judges nor rewrites; nor does nothing new
  if (!mayBeBig(activity)) return;
  if (lastSummary !== undefined && since.tools === 0) return;
  // mid-turn, too soon after the last page: the work waits in `since`, Jev unasked
  if (
    lastSummary !== undefined &&
    !isRewriteDue(await $.clock.now(), lastWrittenAt, isTurnEnd)
  )
    return;
  const key = await jevKey($);
  if (!key) return;
  // a big session whose first page failed: write it, no question
  const question: JevQuestion | undefined = !isBig
    ? "big"
    : lastSummary === undefined
      ? undefined
      : "update";
  if (
    question &&
    !(await jevSaysYes(
      $,
      key,
      question,
      question === "big"
        ? jevBigRequest(activity)
        : jevUpdateRequest(activity, since),
    ))
  )
    return;
  isBig = true;
  await summarize($);
}

/**
 * With a summary written and background shells running: when their output
 * moved since the last look, asks Jev whether it changed the picture, and
 * rewrites the summary on a yes.
 */
async function progressOnce($: EngineInterface): Promise<void> {
  if (lastSummary === undefined) return;
  const progress = await readProgress($, await messagesOf($));
  const seen = JSON.stringify(progress);
  if (progress.length === 0 || seen === lastProgress) return;
  const key = await jevKey($);
  if (!key) return;
  // a no is not asked again on the same output; a failed ask or write is
  const yes = await jevSaysYes(
    $,
    key,
    "progress",
    jevProgressRequest(activity, progress),
  );
  if (yes === false) lastProgress = seen;
  if (yes) await summarize($);
}

/** A press: the summary written now, no question asked; the work counts as big from then on. */
async function manualOnce($: EngineInterface): Promise<void> {
  isBig = true;
  await summarize($);
}

/** The checks one run of the queue asked for; a press covers all the others. */
async function checkOnceFor($: EngineInterface, whys: Set<Why>): Promise<void> {
  if (whys.has("manual")) return manualOnce($);
  if (whys.has("tools") || whys.has("turn")) await checkOnce($, whys.has("turn"));
  if (whys.has("progress")) await progressOnce($);
}

/** One check at a time; checks asked for meanwhile run after it, together. */
async function check($: EngineInterface, why: Why): Promise<void> {
  queued.add(why);
  if (running) return;
  running = true;
  try {
    while (queued.size > 0) {
      const whys = queued;
      queued = new Set();
      await checkOnceFor($, whys);
    }
  } catch (err) {
    await setStatus($, { kind: "failed", reason: String(err) }).catch(() => {});
  } finally {
    running = false;
    queued.clear();
  }
}

/**
 * After a reload: a written summary keeps the work big and is the page on
 * disk Haiku updates.
 */
async function restore($: EngineInterface): Promise<void> {
  const s = await read($, status);
  if (s.kind !== "ready") return;
  isBig = true;
  lastWrittenAt = s.at;
  lastSummary = await $.fs.read(await pagePath($)).catch(() => undefined);
}

/** Opens the page in the default browser, a placeholder before any summary; what it says, and whether it opened. */
async function show($: EngineInterface): Promise<{ text: string; isOpened: boolean }> {
  const path = await pagePath($);
  try {
    if (!(await $.fs.exists(path).catch(() => false)))
      await writePage($, placeholderHtml(PLACEHOLDER));
  } catch (err) {
    // a failed write is said, not thrown: the command and the band's press both show it
    return { text: `Could not write the summary page ${path}: ${String(err)}`, isOpened: false };
  }
  const ran = await $.process
    .run(openArgv(encodeURI(`file://${path}`)), { timeoutMs: OPEN_MS })
    .catch(() => undefined);
  return ran?.exitCode === 0
    ? { text: "Summary opened in the browser.", isOpened: true }
    : { text: `No browser opened the summary: ${path}`, isOpened: false };
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "big-picture",
      description:
        "Open the visual summary of this session's big work in the browser; update rewrites it now",
      argumentHint: "[update]",
    });
    progressWatch?.cancel();
    progressWatch = $.clock.every(
      PROGRESS_EVERY_MS,
      () => void check($, "progress"),
    );
    await restore($);
    return r;
  });

  // a /clear: the new session starts with no work and no summary
  on("session.end", async ($, e, next) => {
    const r = await next(e);
    if (e.reason !== "clear") return r;
    activity = emptyActivity("");
    since = emptyActivity("");
    isBig = false;
    lastSummary = undefined;
    lastWrittenAt = undefined;
    lastProgress = undefined;
    await setStatus($, { kind: "none" });
    return r;
  });

  on("command.run", { command: "big-picture" }, async ($, e) => {
    if (e.args.trim() !== "update") return { text: (await show($)).text };
    $.clock.after(0, () => void check($, "manual"));
    return { text: "Updating the summary." };
  });

  on("prompt.submit", async ($, e, next) => {
    activity = emptyActivity(e.text);
    return next(e);
  });

  // logging never fails the tool; checks run on a timer, outside this dispatch
  on("tool.call", async ($, e, next) => {
    const ran = await next(e);
    if (ran.deny === undefined && !ran.isError) {
      const input = e as unknown as Record<string, unknown>;
      activity = logTool(activity, e.tool, input);
      since = logTool(since, e.tool, input);
      if (isCheckDue(activity))
        $.clock.after(0, () => void check($, "tools"));
    }
    return ran;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (e.agentId === undefined && !e.isAborted)
      $.clock.after(0, () => void check($, "turn"));
    return r;
  });

  // its own line under the other bands: the summary's state and a show button,
  // once there is something to show; Jev judging work that has no summary yet is not
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const s = await read($, status);
    const isJudgingOnly =
      s.kind === "working" && s.step === "classifying" && lastSummary === undefined;
    if (s.kind === "none" || isJudgingOnly) return next(e);
    const below = await next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    const row = (
      <Box
        key="band:20-big-picture"
        flexDirection="row"
        columnGap={2}
        width={e.props.bodyColumns}
      >
        <Text dimColor>summary</Text>
        {s.kind === "working" && <Text color="yellow">{`● ${s.step}…`}</Text>}
        {s.kind === "ready" && (
          <Text dimColor>{`updated ${fmtTime(s.at)}`}</Text>
        )}
        {s.kind === "failed" && (
          <Text color="red" wrap="truncate-end">{`✗ ${s.reason}`}</Text>
        )}
        <Button
          key="big-picture-show"
          hotkey="s"
          dimColor
          onPress={async () => {
            const said = await show($);
            if (!said.isOpened) $.ui.toast(`big-picture: ${said.text}`);
          }}
        >
          show
        </Button>
        <Button
          key="big-picture-update"
          hotkey="u"
          dimColor
          onPress={() => void check($, "manual")}
        >
          update
        </Button>
      </Box>
    );
    return (
      <Box key={STACK} flexDirection="column" marginTop={1}>
        {stackRows(below, row)}
      </Box>
    );
  });
};
