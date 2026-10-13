import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { SummaryStatus } from "../types";
import {
  BIG_AT,
  cleanText,
  emptyActivity,
  extractHtml,
  fmtTime,
  type Format,
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
  textBlocks,
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
const pane = atom({ plugin: "big-picture", key: "pane" } as const, false);
const text = atom(
  { plugin: "big-picture", key: "text" } as const,
  null as string | null,
);

const ORCA_MS = 10_000;
/** How often an open tab is looked for, so one closed in Orca flips the button to show. */
const TAB_WATCH_MS = 2_000;
const PANE = "big-picture";
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
/** The summary last written (an HTML page or text), handed to Haiku to update. */
let lastSummary: string | undefined;
/** When the page was last written (ms since epoch). */
let lastWrittenAt: number | undefined;
let running = false;
let again = false;
/** Whether a check queued while one ran came from a turn's end. */
let againAtTurnEnd = false;
let warned = false;
/** A show or hide under way: presses meanwhile are dropped, not stacked into more tabs. */
let toggling = false;
/** Looks for the open tab every TAB_WATCH_MS. */
let tabWatch: { cancel: () => void } | undefined;

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

/**
 * Haiku writes the summary from the transcript (and updates the last one),
 * then shows it: in Orca a page for the tab, elsewhere text for the pane.
 */
async function writeSummary($: EngineInterface): Promise<boolean> {
  await setStatus($, { kind: "working", step: "writing" });
  const format: Format = (await inOrca($)) ? "html" : "text";
  const messages = await $.session.messages().catch(() => []);
  const reply = await $.model.complete({
    model: SUMMARY_MODEL,
    system: [{ text: summarySystem(SHOW_ME, format), cache: true }],
    prompt: summaryPrompt(
      digest(Array.isArray(messages) ? messages : []),
      lastSummary,
    ),
    maxTokens: SUMMARY_TOKENS,
    timeoutMs: SUMMARY_MS,
  });
  if (!reply.isAnswered) {
    await setStatus($, { kind: "failed", reason: reply.reason });
    return false;
  }
  const summary =
    format === "html" ? extractHtml(reply.text) : cleanText(reply.text);
  if (!summary) {
    await setStatus($, {
      kind: "failed",
      reason: `the reply held no ${format === "html" ? "HTML page" : "summary"}`,
    });
    return false;
  }
  // the transcript may carry injected text: the page runs no script of the model's
  if (format === "html") await writePage($, securePage(summary));
  else await update($, text, () => summary);
  lastSummary = summary;
  lastWrittenAt = await $.clock.now();
  await setStatus($, { kind: "ready", at: lastWrittenAt });
  const id = await read($, tab);
  if (id && (await orca($, ["reload", "--page", id]))?.exitCode !== 0)
    await forgetTab($); // closed in Orca
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
  const key = await $.env.get("TYPESAFE_API_KEY").catch(() => undefined);
  if (!key) {
    if (!warned) $.ui.toast("big-picture: set TYPESAFE_API_KEY for Jev");
    warned = true;
    return;
  }
  // a big session whose first page failed: write it, no question
  const question: JevQuestion | undefined = !isBig
    ? "big"
    : lastSummary === undefined
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

async function forgetTab($: EngineInterface): Promise<void> {
  tabWatch?.cancel();
  tabWatch = undefined;
  await update($, tab, () => null);
}

/** Forgets the tab once Orca no longer lists it: closed there by hand. */
async function watchTab($: EngineInterface): Promise<void> {
  const id = await read($, tab);
  if (!id) return forgetTab($);
  const list = await orca($, ["tab", "list"]);
  if (list?.exitCode === 0 && !hasTab(list.stdout, id)) await forgetTab($);
}

async function showTab($: EngineInterface): Promise<Said> {
  const path = await pagePath($);
  if (!(await $.fs.exists(path).catch(() => false)))
    await writePage($, placeholderHtml(PLACEHOLDER));
  const ran = await orca($, [
    "tab",
    "create",
    "--url",
    encodeURI(`file://${path}`),
  ]);
  const id = ran?.exitCode === 0 ? parseTabId(ran.stdout) : undefined;
  if (!id) return { text: "Orca did not open a browser tab.", isDone: false };
  await update($, tab, () => id);
  tabWatch?.cancel();
  tabWatch = $.clock.every(TAB_WATCH_MS, () => void watchTab($));
  return { text: "Summary shown.", isDone: true };
}

async function hideTab($: EngineInterface, id: string): Promise<Said> {
  await orca($, ["tab", "close", "--page", id]);
  await forgetTab($);
  return { text: "Summary hidden.", isDone: true };
}

/** Hides the tab if Orca still lists it, shows a new one if not. */
async function toggleTab($: EngineInterface): Promise<Said> {
  const id = await read($, tab);
  if (id) {
    const list = await orca($, ["tab", "list"]);
    if (list?.exitCode === 0 && hasTab(list.stdout, id)) return hideTab($, id);
  }
  return showTab($);
}

/** Closes the pane if open, opens it if not. */
async function togglePane($: EngineInterface): Promise<Said> {
  if (await read($, pane)) {
    await $.ui.close({ id: PANE });
    await update($, pane, () => false);
    return { text: "Summary hidden.", isDone: true };
  }
  const opened = await $.ui.open({ id: PANE, title: "Big picture" });
  await update($, pane, () => opened.isPlaced);
  return opened.isPlaced
    ? { text: "Summary shown.", isDone: true }
    : { text: "The summary pane is waiting for a wider terminal.", isDone: false };
}

/** In Orca the tab, elsewhere the pane; one at a time. */
async function toggle($: EngineInterface): Promise<Said> {
  if (toggling)
    return { text: "Still showing or hiding the summary.", isDone: true };
  toggling = true;
  try {
    return (await inOrca($)) ? await toggleTab($) : await togglePane($);
  } finally {
    toggling = false;
  }
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "big-picture",
      description: "Show or hide the visual summary of this session's big work",
    });
    // a reload keeps an open pane
    const panes = await $.ui.panes().catch(() => []);
    await update($, pane, () => panes.some((p) => p.id === PANE && p.isPlaced));
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

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const summary = await read($, text);
    if (summary === null)
      return (
        <Box width={e.props.bodyColumns}>
          <Text dimColor>{PLACEHOLDER}</Text>
        </Box>
      );
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {textBlocks(summary).map((b, i) => (
          <Box key={`block:${i}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
            {b.kind === "heading" && <Text bold>{b.lines[0]}</Text>}
            {b.kind === "prose" && <Text>{b.lines[0]}</Text>}
            {b.kind === "sketch" &&
              b.lines.map((line, j) => (
                <Text key={`line:${j}`} wrap="truncate-end">
                  {line === "" ? " " : line}
                </Text>
              ))}
          </Box>
        ))}
      </Box>
    );
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    const r = await next(e);
    await update($, pane, () => false);
    return r;
  });

  // its own line under the other bands: the summary's state and a show/hide toggle
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const s = await read($, status);
    const open = (await read($, tab)) !== null || (await read($, pane));
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
