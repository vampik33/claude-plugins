import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { EffortContext, Step, Verdict } from "../types";
import {
  bandOrder,
  configuredEffort,
  footerLine,
  JEV_TIMEOUT_MS,
  JEV_URL,
  jevRequest,
  keepsCacheOnChange,
  parseJev,
  shortModel,
  stepEffort,
  verdictWords,
  withAnswer,
  withPrompt,
} from "./core.ts";

const NAME = "effort-pilot";
const verdict = atom(
  { plugin: "effort-pilot", key: "verdict" } as const,
  null as Verdict | null,
);
const step = atom(
  { plugin: "effort-pilot", key: "step" } as const,
  null as Step | null,
);
const EMPTY: EffortContext = { prompts: [], answer: "" };
const context = atom(
  { plugin: "effort-pilot", key: "context" } as const,
  EMPTY,
);

/** Module variables: read again at each load. */
let firstParty: boolean | undefined;
let warned = false;

const truthy = (v: string | undefined) =>
  !!v && v !== "0" && v.toLowerCase() !== "false";

/**
 * Whether the session talks to Anthropic directly (an API key or a Claude
 * subscription): the engine holds no first-party credential under a 3P
 * provider or a gateway. Disabled betas also re-cache on an effort change.
 */
async function isFirstParty($: EngineInterface): Promise<boolean> {
  if (firstParty === undefined) {
    const [auth, noBetas] = await Promise.all([
      $.session.authorize().catch(() => null),
      $.env
        .get("CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS")
        .catch(() => undefined),
    ]);
    firstParty = auth !== null && !truthy(noBetas);
  }
  return firstParty;
}

/** Jev's level for the prompt, or why there is none; never waits past JEV_TIMEOUT_MS. */
async function askJev($: EngineInterface, body: unknown): Promise<Verdict> {
  const key = await $.env.get("TYPESAFE_API_KEY").catch(() => undefined);
  if (!key) {
    if (!warned) $.ui.toast("effort-pilot: set TYPESAFE_API_KEY for Jev");
    warned = true;
    return { kind: "failed", reason: "no TYPESAFE_API_KEY" };
  }
  const ask = $.http
    .fetch(JEV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    })
    .then((res): Verdict => {
      const v = res.ok ? parseJev(res.text) : undefined;
      if (v) return { kind: "jev", ...v };
      return {
        kind: "failed",
        reason: res.ok ? "unreadable reply" : `HTTP ${res.status}`,
      };
    })
    .catch((): Verdict => ({ kind: "failed", reason: "not reached" }));
  // Cancelled once Jev answers; a cancelled wait never settles the race.
  const timer = new AbortController();
  const late = $.clock.sleep(JEV_TIMEOUT_MS, { signal: timer.signal }).then(
    (): Verdict => ({
      kind: "failed",
      reason: `no answer in ${JEV_TIMEOUT_MS / 1000} s`,
    }),
    () => new Promise<never>(() => {}),
  );
  try {
    return await Promise.race([ask, late]);
  } finally {
    timer.abort();
  }
}

async function decide(
  $: EngineInterface,
  prompt: string,
  turnId: string,
): Promise<void> {
  // The settings and env name the default before any request has: read
  // alongside the rest, so the prompt waits for one round of reads.
  const [ctx, last, model, settings, envLevel] = await Promise.all([
    read($, context),
    read($, step),
    $.session.model().catch(() => undefined),
    $.settings.read().catch(() => ({})),
    $.env.get("CLAUDE_CODE_EFFORT_LEVEL").catch(() => undefined),
  ]);
  const m = model ?? last?.model;
  const v = await askJev(
    $,
    jevRequest(
      prompt,
      ctx,
      m,
      last?.session ?? configuredEffort(settings, m, envLevel),
    ),
  );
  await Promise.all([
    update($, verdict, () => ({ ...v, turnId })),
    update($, context, (c) => withPrompt(c ?? EMPTY, prompt)),
  ]);
}

/** Jev's call when it was made for `turnId`; a call for another turn is none. */
async function verdictFor(
  $: EngineInterface,
  turnId: string | undefined,
): Promise<Verdict | null> {
  const v = await read($, verdict);
  return v && turnId !== undefined && v.turnId === turnId ? v : null;
}

const sameStep = (a: Step | null, b: Step) =>
  JSON.stringify(a) === JSON.stringify(b);

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    firstParty = undefined;
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      await update($, verdict, () => null);
      await update($, step, () => null);
      await update($, context, () => EMPTY);
    }
    return next(e);
  });

  // Each main-loop turn with a prompt: Jev picks its level before the turn's
  // first request. Asked at turn.start, not prompt.submit: a prompt typed
  // mid-turn is submitted while the running turn still has requests to send.
  on("turn.start", async ($, e, next) => {
    if (e.agentId === undefined && e.text.trim())
      await decide($, e.text, e.turnId);
    return next(e);
  }).catch(($, e, next) => next(e));

  // Each main-loop request goes out at Jev's level where a change keeps the cache.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);
    // `last`: the previous main-loop request, whose level stays when Jev is unsure.
    const [v, last, direct] = await Promise.all([
      verdictFor($, e.turnId),
      read($, step),
      isFirstParty($),
    ]);
    const steers = keepsCacheOnChange(e.model, direct);
    const sent = stepEffort(
      e.effort,
      v,
      steers,
      last?.steered ? last.sent : undefined,
    );
    const s: Step = {
      turnId: e.turnId,
      model: e.model,
      session: e.effort,
      sent,
      steered: steers,
      verdict: v,
    };
    if (!sameStep(last, s)) await update($, step, () => s);
    return yield* next(sent === e.effort ? e : { ...e, effort: sent });
  });

  // Under each main-loop answer: the model, the level it ran at, Jev's call.
  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (e.agentId !== undefined) return r;
    await update($, context, (c) => withAnswer(c ?? EMPTY, e.answer));
    const s = await read($, step);
    if (!s || s.turnId !== e.turnId) return r;
    const line = footerLine(s);
    return { ...r, text: r.text === e.answer ? line : `${r.text}\n${line}` };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const s = await read($, step);
    const m = s?.model ?? (await $.session.model().catch(() => undefined));
    if (!m) return next(e);
    const below = await next(e);
    const { Box, Text } = $.ui.resolve(e);
    const words = s ? verdictWords(s) : undefined;
    const row = (
      <Box key={`band:${NAME}`} flexDirection="row" columnGap={2}>
        <Text>
          {shortModel(m)} · effort{" "}
          {s?.sent === undefined ? "–" : String(s.sent)}
        </Text>
        {words && <Text dimColor>{words}</Text>}
      </Box>
    );
    return (
      <Box flexDirection="column">
        {below}
        {row}
      </Box>
    );
  });

  // codex, ctx, then model and effort are the band's last rows, in that order.
  on("ui.render", { component: "AbovePromptList" }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, rows: bandOrder(e.props.rows) } }),
  );
};
