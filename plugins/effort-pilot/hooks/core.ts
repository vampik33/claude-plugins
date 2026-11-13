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
 * Jev's question: which effort level the prompt needs. Jev (TypeSafe) is a
 * third party, so it gets prompts and answer text only, never tool output or
 * file contents.
 */
export function jevRequest(
  prompt: string,
  ctx: EffortContext,
  model: string | undefined,
  current: Step["session"],
) {
  return {
    model: "jev-latest",
    state: {
      prompt: cut(prompt, PROMPT_CHARS),
      earlierPrompts: ctx.prompts,
      previousAnswer: ctx.answer,
      model: model ?? "unknown",
      currentEffort: isLevel(current) ? current : "unknown",
    },
    questions: {
      effort: {
        type: "score",
        instructions:
          "A coding assistant is about to work on `prompt`, in a conversation whose earlier prompts and last answer are given. How much reasoning effort does this prompt need?",
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
  const id = model.replace(/\[.*\]$/, "");
  if (/^claude-(opus|sonnet|haiku)-5-5(\b|-)/.test(id)) return true;
  const fable = /^claude-fable-5-(\d+)(\b|-)/.exec(id);
  return fable !== null && Number(fable[1]) >= 1;
}

/**
 * The level a main-loop request goes out at: Jev's when it may steer, Jev is
 * at least MIN_CONFIDENCE sure and the request names a level. When Jev is
 * less sure, or made no call for this turn (`verdict` null), the level the
 * previous request went out at (`previous`), or the session's own before any.
 * Otherwise the session's own (none on a model without effort, a number left
 * as it is).
 */
export function stepEffort(
  session: Step["session"],
  verdict: Verdict | null,
  steers: boolean,
  previous?: Step["sent"],
): Step["session"] {
  if (!steers || !isLevel(session) || verdict?.kind === "failed") return session;
  if (verdict && verdict.confidence >= MIN_CONFIDENCE) return verdict.level;
  return isLevel(previous) ? previous : session;
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
    return `Jev unsure: ${verdict.level} ${pct(verdict.confidence)}, kept ${String(step.sent)}`;
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
