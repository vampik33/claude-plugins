export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** Jev's last call: its level and confidence, or why it gave none. */
export type Verdict = (
  | { kind: "jev"; level: EffortLevel; confidence: number }
  | { kind: "failed"; reason: string }
) & {
  /** The main-loop turn Jev was asked for; its steps alone use the call. */
  turnId?: string;
};

/** The last main-loop request: its model, the session's level, and what was sent. */
export type Step = {
  /** The turn the request was part of. */
  turnId: string;
  model: string;
  /** The level the session asked for; absent on a model without effort. */
  session?: EffortLevel | number;
  /** The level the request went out at. */
  sent?: EffortLevel | number;
  /** Whether Jev's level is applied on this model (false: advice only). */
  steered: boolean;
  /** Jev's call for this request's turn; null when the turn has none. */
  verdict: Verdict | null;
};

/** What Jev reads beside the prompt: earlier prompts and the last answer, cut. */
export type EffortContext = { prompts: string[]; answer: string };

declare module "claude-code" {
  interface PluginState {
    "effort-pilot": {
      verdict: Verdict | null;
      step: Step | null;
      context: EffortContext;
    };
  }
}
