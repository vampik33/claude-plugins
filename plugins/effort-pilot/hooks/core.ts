import type { EffortContext, EffortLevel, Step, Verdict } from "../types";

/** The five effort levels, lowest first: Jev's score levels 0-4. */
export const LEVELS: readonly EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
/** How long a prompt waits for Jev before the session's own level stands. */
export const JEV_TIMEOUT_MS = 4_000;
/** Earlier prompts kept for Jev, oldest first. */
export const RECENT_PROMPTS = 3;
/** Below this confidence Jev's level is shown but not applied. */
export const MIN_CONFIDENCE = 0.5;
const PROMPT_CHARS = 4_000;
const EARLIER_PROMPT_CHARS = 1_000;
const ANSWER_CHARS = 1_500;

/** A model id without its context suffix: `claude-opus-5-5[1m]` → `claude-opus-5-5`. */
const baseModelId = (m: string) => m.replace(/\[.*\]$/, "");

export const isLevel = (x: unknown): x is EffortLevel =>
  typeof x === "string" && (LEVELS as readonly string[]).includes(x);

/** The head of a long text, marked as cut. */
export const cut = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max)}…`;

/** The tail of a long text, marked as cut: an answer's conclusion is at its end. */
export const cutTail = (s: string, max: number) =>
  s.length <= max ? s : `…${s.slice(s.length - max)}`;

/** The context after one more prompt: the last RECENT_PROMPTS kept. */
export const withPrompt = (
  c: EffortContext,
  prompt: string,
): EffortContext => ({
  ...c,
  prompts: [...c.prompts, cut(prompt, EARLIER_PROMPT_CHARS)].slice(
    -RECENT_PROMPTS,
  ),
});

export const withAnswer = (
  c: EffortContext,
  answer: string,
): EffortContext => ({
  ...c,
  answer: cutTail(answer, ANSWER_CHARS),
});

/**
 * The effort level the settings give `model` by default, as the engine
 * resolves it: `CLAUDE_CODE_EFFORT_LEVEL`, then the model's
 * `modelSettings.<id>.effortLevel` (where `/effort` saves it), then
 * `effortLevel`; undefined when none names a level.
 */
export function configuredEffort(
  settings: Readonly<Record<string, unknown>>,
  model: string | undefined,
  envLevel: string | undefined,
): EffortLevel | undefined {
  if (isLevel(envLevel)) return envLevel;
  const byModel = settings.modelSettings as
    | Record<string, { effortLevel?: unknown } | undefined>
    | undefined;
  const id = model && baseModelId(model);
  const perModel = id ? byModel?.[id]?.effortLevel : undefined;
  if (isLevel(perModel)) return perModel;
  return isLevel(settings.effortLevel) ? settings.effortLevel : undefined;
}

/**
 * Jev's question: which effort level the prompt needs, knowing the level the
 * assistant runs at by default (`defaultLevel`), which also stands when Jev is
 * unsure. Jev (TypeSafe) is a third party, so it gets prompts and answer text
 * only, never tool output or file contents.
 */
export function jevRequest(
  prompt: string,
  ctx: EffortContext,
  model: string | undefined,
  defaultLevel: Step["session"],
) {
  return {
    model: "jev-latest",
    state: {
      prompt: cut(prompt, PROMPT_CHARS),
      earlierPrompts: ctx.prompts,
      previousAnswer: ctx.answer,
      model: model ?? "unknown",
      defaultEffort: isLevel(defaultLevel) ? defaultLevel : "unknown",
    },
    questions: {
      effort: {
        type: "score",
        instructions:
          "A coding assistant is about to work on `prompt`, in a conversation whose earlier prompts and last answer are given. It runs at `defaultEffort` unless you confidently pick another level, and stays at `defaultEffort` when you are unsure. How much reasoning effort does this prompt need?",
        criteria: [
          "low: a lookup, a one-line answer, a yes/no, or a trivial mechanical edit",
          "medium: a small, well-specified change or a direct question about known code",
          "high: a multi-step change in a few files, or debugging with a clear lead",
          "xhigh: a feature, refactor or investigation across many files, or a subtle bug",
          "max: hard reasoning: architecture, proofs, concurrency, security, or a problem earlier attempts failed on",
        ],
      },
    },
  };
}

/** Jev's most likely level and its confidence, or undefined when the reply is not one. */
export function parseJev(
  text: string,
): { level: EffortLevel; confidence: number } | undefined {
  let answer: { probabilities?: unknown; confidence?: unknown } | undefined;
  try {
    answer = (JSON.parse(text) as { answers?: { effort?: typeof answer } })
      .answers?.effort;
  } catch {
    return undefined;
  }
  const probs = answer?.probabilities;
  if (!probs || typeof probs !== "object") return undefined;
  let best = -1;
  let bestP = -1;
  for (let i = 0; i < LEVELS.length; i++) {
    const p = (probs as Record<string, unknown>)[String(i)];
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) return undefined;
    if (p > bestP) [best, bestP] = [i, p];
  }
  const c = answer?.confidence;
  return {
    level: LEVELS[best]!,
    confidence: typeof c === "number" && c >= 0 && c <= 1 ? c : bestP,
  };
}

/**
 * Whether an effort change keeps the prompt cache: on these models, with an
 * API key or a Claude subscription (the prompt-caching docs' list). Elsewhere
 * a change re-sends the whole conversation uncached, so Jev only advises.
 */
export function keepsCacheOnChange(
  model: string,
  firstParty: boolean,
): boolean {
  if (!firstParty) return false;
  const id = baseModelId(model);
  if (/^claude-(opus|sonnet|haiku)-5-5(\b|-)/.test(id)) return true;
  const fable = /^claude-fable-5-(\d+)(\b|-)/.exec(id);
  return fable !== null && Number(fable[1]) >= 1;
}

/**
 * The level a main-loop request goes out at. The session's own when Jev may
 * not steer, failed, or the request names no level (none on a model without
 * effort, a number left as it is). With no call for this turn (`verdict`
 * null), the level the previous request went out at (`previous`), else the
 * session's. Otherwise Jev's when it is at least MIN_CONFIDENCE sure, else
 * the session's own (the configured default).
 */
export function stepEffort(
  session: Step["session"],
  verdict: Verdict | null,
  steers: boolean,
  previous?: Step["sent"],
): Step["session"] {
  if (!steers || !isLevel(session) || verdict?.kind === "failed") return session;
  if (!verdict) return isLevel(previous) ? previous : session;
  return verdict.confidence >= MIN_CONFIDENCE ? verdict.level : session;
}

/** A model id as a short name: `claude-opus-5-5` → `opus-5-5`. */
export const shortModel = (m: string) => m.replace(/^claude-/, "");

const pct = (c: number) => `${Math.round(c * 100)}%`;

/** What Jev did for the step's turn, in a few words; undefined with no call. */
export function verdictWords(step: Step): string | undefined {
  const { verdict } = step;
  if (!verdict) return undefined;
  if (verdict.kind === "failed") return `Jev: ${verdict.reason}, session level`;
  if (step.session === undefined)
    return `Jev: ${verdict.level} (model takes no effort)`;
  if (!step.steered)
    return `Jev advises ${verdict.level} ${pct(verdict.confidence)} (not applied: a change would re-cache this model)`;
  if (verdict.confidence < MIN_CONFIDENCE)
    return `Jev unsure: ${verdict.level} ${pct(verdict.confidence)}, session level ${String(step.sent)}`;
  return step.session === step.sent
    ? `Jev kept ${verdict.level} ${pct(verdict.confidence)}`
    : `Jev: ${String(step.session)} → ${verdict.level} ${pct(verdict.confidence)}`;
}

/** The line under each answer: the model, the level it ran at, and Jev's call. */
export function footerLine(step: Step): string {
  const head = [
    shortModel(step.model),
    step.sent === undefined ? "no effort" : `effort ${String(step.sent)}`,
  ].join(" · ");
  const words = verdictWords(step);
  return words ? `${head} · ${words}` : head;
}

/** The band's last three rows, top to bottom: codex, ctx, then model and effort. */
const BAND_TAIL = ["codex-review", "continuity", "effort-pilot"];

/**
 * The band's rows with BAND_TAIL's moved to the end in its order, the rest as
 * they came. Each of the three mods applies it, so the order is the same
 * whichever of them is installed and whatever order their hooks run in.
 */
export function bandOrder<R extends { plugin: string }>(rows: readonly R[]): R[] {
  return [
    ...rows.filter((r) => !BAND_TAIL.includes(r.plugin)),
    ...BAND_TAIL.flatMap((p) => rows.filter((r) => r.plugin === p)),
  ];
}
