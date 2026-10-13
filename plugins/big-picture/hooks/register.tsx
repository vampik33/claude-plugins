import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { SummaryStatus } from "../types";
import {
  BIG_AT,
  emptyActivity,
  extractHtml,
  fmtTime,
  hasTab,
  isCheckDue,
  isRewriteDue,
  JEV_URL,
  jevBigRequest,
  type JevQuestion,
  jevUpdateRequest,
  logTool,
  mayBeBig,
  mergeActivity,
  parseJev,
  parseTabId,
  placeholderHtml,
  digest,
  securePage,
  summaryPrompt,
  summarySystem,
} from "./core.ts";
import { SHOW_ME } from "./show-me.ts";

const status = atom(
  { plugin: "big-picture", key: "status" } as const,
  { kind: "none" } as SummaryStatus,
);
const tab = atom(
  { plugin: "big-picture", key: "tab" } as const,
  null as string | null,
);

const ORCA_MS = 10_000;
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
let lastHtml: string | undefined;
/** When the page was last written (ms since epoch). */
let lastWrittenAt: number | undefined;
let running = false;
let again = false;
/** Whether a check queued while one ran came from a turn's end. */
let againAtTurnEnd = false;
let warned = false;

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

const orca = ($: EngineInterface, args: string[]) =>
  $.process
    .run(["orca", ...args, "--json"], { timeoutMs: ORCA_MS })
    .catch(() => undefined);

const inOrca = async ($: EngineInterface) =>
  (await $.env.get("TERM_PROGRAM").catch(() => undefined)) === "Orca";

/** Jev's p(yes) to one question; undefined (status failed) when it did not answer. */
async function askJev(
  $: EngineInterface,
  key: string,
  name: JevQuestion,
): Promise<number | undefined> {
  const body =
    name === "big"
      ? jevBigRequest(activity)
      : jevUpdateRequest(activity, since);
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

/** Haiku writes the page from the transcript (and updates the last one), then shows it. */
async function writeSummary($: EngineInterface): Promise<boolean> {
  await setStatus($, { kind: "working", step: "writing" });
  const messages = await $.session.messages().catch(() => []);
  const reply = await $.model.complete({
    model: SUMMARY_MODEL,
    system: [{ text: summarySystem(SHOW_ME), cache: true }],
    prompt: summaryPrompt(
      digest(Array.isArray(messages) ? messages : []),
      lastHtml,
    ),
    maxTokens: SUMMARY_TOKENS,
    timeoutMs: SUMMARY_MS,
  });
  if (!reply.isAnswered) {
    await setStatus($, { kind: "failed", reason: reply.reason });
    return false;
  }
  const html = extractHtml(reply.text);
  if (!html) {
    await setStatus($, { kind: "failed", reason: "the reply held no HTML page" });
    return false;
  }
  // the transcript may carry injected text: the page runs no script of the model's
  await writePage($, securePage(html));
  lastHtml = html;
  lastWrittenAt = await $.clock.now();
  await setStatus($, { kind: "ready", at: lastWrittenAt });
  const id = await read($, tab);
  if (id && (await orca($, ["reload", "--page", id]))?.exitCode !== 0)
    await update($, tab, () => null); // closed in Orca
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
  if (lastHtml !== undefined && since.tools === 0) return;
  // mid-turn, too soon after the last page: the work waits in `since`, Jev unasked
  if (
    lastHtml !== undefined &&
    !isRewriteDue(await $.clock.now(), lastWrittenAt, isTurnEnd)
  )
    return;
  const key = await $.env.get("TYPESAFE_API_KEY").catch(() => undefined);
  if (!key) {
    if (!warned) $.ui.toast("big-picture: set TYPESAFE_API_KEY for Jev");
    warned = true;
    return;
  }
  // a big session whose first page failed: write it, no question
  const question: JevQuestion | undefined = !isBig
    ? "big"
    : lastHtml === undefined
      ? undefined
      : "update";
  if (question) {
    const was = await read($, status);
    await setStatus($, { kind: "working", step: "classifying" });
    const p = await askJev($, key, question);
    if (p === undefined) return;
    if (p < BIG_AT) return void (await setStatus($, was));
  }
  isBig = true;
  await summarize($);
}

/** One check at a time; a check asked for meanwhile runs after it. */
async function check($: EngineInterface, isTurnEnd: boolean): Promise<void> {
  if (running) {
    again = true;
    againAtTurnEnd ||= isTurnEnd;
    return;
  }
  running = true;
  try {
    let atTurnEnd = isTurnEnd;
    do {
      again = false;
      await checkOnce($, atTurnEnd);
      atTurnEnd = againAtTurnEnd;
      againAtTurnEnd = false;
    } while (again);
  } catch (err) {
    await setStatus($, { kind: "failed", reason: String(err) }).catch(() => {});
  } finally {
    running = false;
    againAtTurnEnd = false;
  }
}

/** What a show or hide says, and whether it did what was asked. */
type Said = { text: string; isDone: boolean };

async function showTab($: EngineInterface): Promise<Said> {
  const path = await pagePath($);
  if (!(await $.fs.exists(path).catch(() => false)))
    await writePage($, placeholderHtml(PLACEHOLDER));
  if (!(await inOrca($)))
    return { text: `Not in Orca: the summary is at ${path}`, isDone: false };
  const ran = await orca($, [
    "tab",
    "create",
    "--url",
    encodeURI(`file://${path}`),
  ]);
  const id = ran?.exitCode === 0 ? parseTabId(ran.stdout) : undefined;
  if (!id) return { text: "Orca did not open a browser tab.", isDone: false };
  await update($, tab, () => id);
  return { text: "Summary shown.", isDone: true };
}

async function hideTab($: EngineInterface, id: string): Promise<Said> {
  await orca($, ["tab", "close", "--page", id]);
  await update($, tab, () => null);
  return { text: "Summary hidden.", isDone: true };
}

/** Hides the tab if Orca still lists it, shows a new one if not. */
async function toggle($: EngineInterface): Promise<Said> {
  const id = await read($, tab);
  if (id) {
    const list = await orca($, ["tab", "list"]);
    if (list?.exitCode === 0 && hasTab(list.stdout, id)) return hideTab($, id);
  }
  return showTab($);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "big-picture",
      description: "Show or hide the visual summary of this session's big work",
    });
    return r;
  });

  on("command.run", { command: "big-picture" }, async ($) => ({
    text: (await toggle($)).text,
  }));

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
        $.clock.after(0, () => void check($, false));
    }
    return ran;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (e.agentId === undefined && !e.isAborted)
      $.clock.after(0, () => void check($, true));
    return r;
  });

  // its own line under the other bands: the summary's state and a show/hide toggle
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const s = await read($, status);
    const open = (await read($, tab)) !== null;
    const below = await next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text dimColor>summary</Text>
          {s.kind === "working" && <Text color="yellow">{`● ${s.step}…`}</Text>}
          {s.kind === "ready" && (
            <Text dimColor>{`updated ${fmtTime(s.at)}`}</Text>
          )}
          {s.kind === "failed" && (
            <Text color="red" wrap="truncate-end">{`✗ ${s.reason}`}</Text>
          )}
          <Button
            key="big-picture-toggle"
            hotkey="s"
            dimColor
            onPress={async () => {
              const said = await toggle($);
              if (!said.isDone) $.ui.toast(`big-picture: ${said.text}`);
            }}
          >
            {open ? "hide" : "show"}
          </Button>
        </Box>
      </Box>
    );
  });
};
