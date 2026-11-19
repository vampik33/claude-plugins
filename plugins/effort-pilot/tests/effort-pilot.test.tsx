import { describe, expect, mock, test } from "claude-code/testing";

import {
  asksUltrathink,
  configuredEffort,
  footerLine,
  jevRequest,
  keepsCacheOnChange,
  parseJev,
  stepEffort,
  withAnswer,
  withPrompt,
} from "../hooks/core.ts";

const SURFACES = ["terminal", "desktop"] as const;
const OPUS55 = "claude-opus-5-5";

/** Jev's reply putting most weight on level `i` (0 low … 4 max). */
const reply = (i: number, confidence = 0.8) =>
  JSON.stringify({
    model: "jev-1.14.0",
    answers: {
      effort: {
        type: "score",
        score: i,
        confidence,
        probabilities: Object.fromEntries(
          [0, 1, 2, 3, 4].map((k) => [String(k), k === i ? 0.8 : 0.05]),
        ),
      },
    },
  });

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
};

type World = {
  env?: Record<string, string>;
  status?: number;
  /** Jev's answer level; undefined: Jev never answers. */
  level?: number | undefined;
  model?: string;
  confidence?: number;
  /** The session's first-party credential; null under a 3P provider or gateway. */
  auth?: null;
  /** The merged settings `$.settings.read()` answers. */
  settings?: Record<string, unknown>;
  /** One source's settings, as `$.settings.read({ source })` answers them. */
  sources?: Record<string, Record<string, unknown>>;
  /** The name a Skill call resolves to, by the name asked for. */
  resolves?: Record<string, string>;
  /** `$.command.list()` fails: no command's source is known. */
  noCommandList?: true;
};

function world(on: any, over: World = {}) {
  const seen = {
    bodies: [] as any[],
    steps: [] as any[],
    toasts: [] as string[],
    level: "level" in over ? over.level : 3,
    confidence: over.confidence,
  };
  const clock = mock.clock(on, { now: 1_000_000 });
  mock.env(on, { TYPESAFE_API_KEY: "k", ...over.env });
  on("session.start", (_$: unknown, e: unknown) => e);
  on("session.end", (_$: unknown, e: { sessionId: string }) => ({
    sessionId: e.sessionId,
  }));
  on("session.model", () => ({ value: over.model ?? OPUS55 }));
  on("settings.read", (_$: unknown, e: { source?: string }) => ({
    value: e.source ? (over.sources?.[e.source] ?? {}) : (over.settings ?? {}),
  }));
  on("command.list", () => {
    if (over.noCommandList) throw new Error("no list");
    return {
      value: [
        { name: "effort", description: "", source: "builtin" },
        { name: "quick", description: "", source: "user" },
      ],
    };
  });
  on("command.run", () => ({ ref: 1 }));
  on("tool.call", { tool: "Skill" }, (_$: unknown, e: { skill: string }) =>
    e.skill === "nope"
      ? { deny: "not allowed" }
      : e.skill === "gone"
        ? {
            isError: true,
            result: "Unknown skill: gone",
            text: "Unknown skill: gone",
          }
        : {
            result: {
              success: true,
              commandName: over.resolves?.[e.skill] ?? e.skill,
            },
          },
  );
  on("session.authorize", () => ({
    value: "auth" in over ? over.auth : { handle: "h", kind: "bearer" },
  }));
  on("prompt.submit", (_$: unknown, e: { text: string }) => ({ text: e.text }));
  on("turn.start", (_$: unknown, e: { turnId: string }) => ({
    turnId: e.turnId,
  }));
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({
    text: e.answer,
  }));
  on("ui.toast", (_$: unknown, e: { text: string }) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.render", () => h("Box", null));
  on(
    "http.fetch",
    async (_$: unknown, e: { url: string; init: { body: string } }) => {
      seen.bodies.push(JSON.parse(e.init.body));
      const level = seen.level;
      if (level === undefined) return new Promise<never>(() => {});
      const status = over.status ?? 200;
      return {
        value: {
          status,
          ok: status === 200,
          headers: {},
          text: reply(level, seen.confidence),
        },
      };
    },
  );
  on("turn.step", async function* (_$: unknown, e: any) {
    seen.steps.push(e);
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
    } as any;
  });
  return { seen, clock };
}

/** A main-loop turn starting with the prompt `text`. */
const startTurn = ($: any, text: string, turnId = "t1") =>
  $.turn.start({ text, turnId });

/** One main-loop (or agent) request at the session's `effort`. */
async function stepAt(
  $: any,
  effort: unknown,
  extra: Record<string, unknown> = {},
) {
  const s = $.turn.step({
    turnId: "t1",
    index: 0,
    model: OPUS55,
    effort,
    messageCount: 3,
    ...extra,
  });
  for await (const _ of s);
  return s.result;
}

/** The model calling the skill `skill` through the Skill tool (in subagent `agentId`). */
const callSkill = ($: any, skill: string, agentId?: string) =>
  $.tool.call({ tool: "Skill", skill, ...(agentId ? { agentId } : {}) });

/** The person typing `/command`; one typed over a running turn runs once it ends. */
const typeCommand = ($: any, command: string) =>
  $.command.run({ command, args: "" });

/** The text a typed `/quick`'s turn starts with. */
const QUICK_TURN = "<command-message>quick</command-message>";

const complete = ($: any, answer = "Done.", turnId = "t1") =>
  $.turn.complete({
    answer,
    durationMs: 1,
    isAborted: false,
    turnId,
    reason: "answer",
  });

async function bandTexts($: any, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({
    plugin: "effort-pilot",
    surface,
    component: "AbovePrompt",
    props: BAND_PROPS as never,
  });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  const drawn = JSON.stringify(await ui.drawn());
  await ui.unmount();
  return { texts, drawn };
}

describe("core", () => {
  test("parseJev takes the most likely level and Jev's confidence", () => {
    expect(parseJev(reply(3, 0.84))).toEqual({
      level: "xhigh",
      confidence: 0.84,
    });
    expect(parseJev(reply(0))).toEqual({ level: "low", confidence: 0.8 });
    expect(parseJev("not json")).toBeUndefined();
    expect(
      parseJev(
        JSON.stringify({ answers: { effort: { probabilities: { "0": 1 } } } }),
      ),
    ).toBeUndefined();
  });

  test("only cache-keeping models are steered, and only first-party", () => {
    for (const m of [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
      "claude-fable-5-2",
      "claude-opus-5-5[1m]",
    ])
      expect(keepsCacheOnChange(m, true)).toBe(true);
    for (const m of [
      "claude-opus-5",
      "claude-fable-5-0",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-opus-5-50",
    ])
      expect(keepsCacheOnChange(m, true)).toBe(false);
    expect(keepsCacheOnChange(OPUS55, false)).toBe(false);
  });

  test("stepEffort applies Jev's level only to a level, only when steering", () => {
    const v = { kind: "jev", level: "max", confidence: 0.9 } as const;
    expect(stepEffort("medium", v, true)).toBe("max");
    expect(stepEffort("medium", v, false)).toBe("medium");
    expect(stepEffort(undefined, v, true)).toBeUndefined();
    expect(stepEffort(32000, v, true)).toBe(32000);
    expect(stepEffort("medium", { kind: "failed", reason: "x" }, true)).toBe(
      "medium",
    );
    expect(stepEffort("medium", { ...v, confidence: 0.49 }, true)).toBe(
      "medium",
    );
    expect(stepEffort("medium", { ...v, confidence: 0.5 }, true)).toBe("max");
    expect(
      stepEffort("medium", { ...v, confidence: 0.49 }, true, "xhigh"),
    ).toBe("medium");
    expect(stepEffort("medium", null, true, "xhigh")).toBe("xhigh");
    expect(stepEffort("medium", null, true)).toBe("medium");
    expect(stepEffort("medium", { ...v, confidence: 0.9 }, true, "low")).toBe(
      "max",
    );
    expect(
      stepEffort("medium", { ...v, confidence: 0.49 }, false, "xhigh"),
    ).toBe("medium");
  });

  test("Jev gets prompts and answer text only, cut", () => {
    let c = { prompts: [] as string[], answer: "" };
    for (const p of ["a", "b", "c", "d"]) c = withPrompt(c, p);
    expect(c.prompts).toEqual(["b", "c", "d"]);
    c = withAnswer(c, "x".repeat(5000) + "END");
    expect(c.answer.endsWith("END")).toBe(true);
    expect(c.answer.length).toBeLessThan(1600);
    const body = jevRequest("y".repeat(10_000), c, OPUS55, "high");
    expect(Object.keys(body.state).sort()).toEqual([
      "defaultEffort",
      "earlierPrompts",
      "model",
      "previousAnswer",
      "prompt",
    ]);
    expect(body.state.prompt.length).toBeLessThan(4100);
    expect(body.state.defaultEffort).toBe("high");
    expect(body.questions.effort.instructions).toContain("`defaultEffort`");
    expect(jevRequest("p", c, OPUS55, undefined).state.defaultEffort).toBe(
      "unknown",
    );
    expect(body.questions.effort.criteria).toHaveLength(5);
  });

  test("Jev's criteria follow the guide: medium for everyday work, past high only rarely", () => {
    const { instructions, criteria } = jevRequest(
      "p",
      { prompts: [], answer: "" },
      OPUS55,
      "medium",
    ).questions.effort;
    const [low, medium, high, xhigh, max] = criteria;
    expect(low).toMatch(/^low: .*chat.*rename/);
    expect(medium).toMatch(/^medium: .*debugging.*feature.*bug fix/);
    expect(high).toMatch(
      /^high: .*edge cases.*medium effort already fell short/,
    );
    expect(xhigh).toMatch(/^xhigh: .*fell short on at high effort/);
    expect(max).toMatch(/^max: .*without the person.*security/);
    expect(instructions).toContain("`medium` is the default");
    expect(instructions).toContain("past `high`");
  });

  test("asksUltrathink finds the keyword as a word, in any case", () => {
    expect(asksUltrathink("ultrathink: why does the cache miss?")).toBe(true);
    expect(asksUltrathink("Please UltraThink this")).toBe(true);
    expect(asksUltrathink("ultrathinking")).toBe(false);
    expect(asksUltrathink("think hard")).toBe(false);
  });

  test("configuredEffort resolves the env, the model's, the top-level setting, then the model's default", () => {
    const s = {
      effortLevel: "medium",
      modelSettings: { [OPUS55]: { effortLevel: "high" } },
    };
    expect(configuredEffort(s, OPUS55, "max")).toBe("max");
    expect(configuredEffort(s, OPUS55, undefined)).toBe("high");
    expect(configuredEffort(s, `${OPUS55}[1m]`, undefined)).toBe("high");
    // `auto` and `unset`: Claude Code sends no level.
    expect(configuredEffort(s, OPUS55, "auto")).toBeUndefined();
    expect(configuredEffort(s, OPUS55, "unset")).toBeUndefined();
    // The user's own top-level effortLevel: Opus 5, Fable 5.1 and earlier only.
    expect(configuredEffort(s, "claude-opus-5", undefined)).toBe("medium");
    expect(
      configuredEffort({ effortLevel: "low" }, "claude-fable-5-1", undefined),
    ).toBe("low");
    expect(
      configuredEffort({ effortLevel: "low" }, "claude-sonnet-5-5", undefined),
    ).toBe("medium");
    // One from another settings file counts on every model: the last one set.
    expect(
      configuredEffort({ effortLevel: "low" }, "claude-sonnet-5-5", undefined, [
        { effortLevel: "high" },
        {},
        { effortLevel: "xhigh" },
        {},
      ]),
    ).toBe("xhigh");
    // Each model's own default.
    expect(configuredEffort({}, OPUS55, undefined)).toBe("medium");
    expect(configuredEffort({}, "claude-fable-5-2", undefined)).toBe("medium");
    expect(configuredEffort({}, "claude-haiku-5-5", undefined)).toBe("medium");
    expect(configuredEffort({}, "claude-opus-4-7", undefined)).toBe("xhigh");
    expect(configuredEffort({}, "claude-opus-5", undefined)).toBe("high");
    expect(configuredEffort({}, "claude-fable-5-1", undefined)).toBe("high");
    expect(configuredEffort({}, "claude-haiku-4-5", undefined)).toBeUndefined();
    expect(configuredEffort({}, "toString", undefined)).toBeUndefined();
    // No model: the merged top-level setting.
    expect(configuredEffort(s, undefined, undefined)).toBe("medium");
    // `max` is no settings level; a value that is none is skipped.
    expect(
      configuredEffort(
        { modelSettings: { [OPUS55]: { effortLevel: "max" } } },
        OPUS55,
        undefined,
      ),
    ).toBe("medium");
    expect(
      configuredEffort(
        { effortLevel: 7, modelSettings: "x" },
        "claude-opus-5",
        undefined,
      ),
    ).toBe("high");
  });

  test("footer names the model, the level sent and Jev's call", () => {
    const v = { kind: "jev", level: "xhigh", confidence: 0.84 } as const;
    const base = { turnId: "t", model: OPUS55 };
    expect(
      footerLine({
        ...base,
        session: "medium",
        sent: "xhigh",
        steered: true,
        verdict: v,
      }),
    ).toBe("opus-5-5 · effort xhigh · Jev: medium → xhigh 84%");
    expect(
      footerLine({
        ...base,
        session: "xhigh",
        sent: "xhigh",
        steered: true,
        verdict: v,
      }),
    ).toBe("opus-5-5 · effort xhigh · Jev kept xhigh 84%");
    expect(
      footerLine({
        ...base,
        session: "medium",
        sent: "medium",
        steered: false,
        verdict: null,
      }),
    ).toBe("opus-5-5 · effort medium");
    expect(
      footerLine({
        ...base,
        session: "medium",
        sent: "medium",
        steered: true,
        verdict: { ...v, confidence: 0.33 },
      }),
    ).toBe(
      "opus-5-5 · effort medium · Jev unsure: xhigh 33%, session level medium",
    );
    expect(
      footerLine({
        ...base,
        session: "xhigh",
        sent: "xhigh",
        steered: false,
        held: "ultrathink",
        verdict: v,
      }),
    ).toBe(
      "opus-5-5 · effort xhigh · Jev advises xhigh 84% (not applied: ultrathink)",
    );
  });
});

describe("a session", () => {
  test("Jev's level is sent on every main-loop step and shown under the answer", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "Refactor the auth flow across the services");
    expect(seen.bodies).toHaveLength(1);
    expect(seen.bodies[0].state.prompt).toBe(
      "Refactor the auth flow across the services",
    );
    await stepAt($, "medium");
    await stepAt($, "medium", { index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
    const r = await complete($);
    expect(r.text).toBe("opus-5-5 · effort xhigh · Jev: medium → xhigh 80%");
  });

  test("Jev under 50% sure on the first turn sends the session's level", async ($, on) => {
    const { seen } = world(on, { confidence: 0.33 });
    await startTurn($, "go");
    await stepAt($, "medium");
    expect(seen.steps[0].effort).toBe("medium");
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort medium · Jev unsure: xhigh 33%, session level medium",
    );
  });

  test("Jev under 50% sure sends the session's level, not the previous turn's", async ($, on) => {
    const { seen } = world(on, { level: 4 });
    await startTurn($, "Prove the queue is lock-free");
    await stepAt($, "medium");
    seen.level = 0;
    seen.confidence = 0.33;
    await startTurn($, "and the other one?", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    await stepAt($, "medium", { turnId: "t2", index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual([
      "max",
      "medium",
      "medium",
    ]);
    expect((await complete($, "Done.", "t2")).text).toBe(
      "opus-5-5 · effort medium · Jev unsure: low 33%, session level medium",
    );
    seen.confidence = 0.9;
    await startTurn($, "what is 2+2", "t3");
    await stepAt($, "medium", { turnId: "t3" });
    expect(seen.steps[3].effort).toBe("low");
  });

  test("a prompt typed mid-turn leaves the running turn's level", async ($, on) => {
    const { seen } = world(on, { level: 4 });
    await startTurn($, "Prove the queue is lock-free");
    await stepAt($, "medium");
    seen.level = 0;
    await $.prompt.submit({
      text: "what is 2+2",
      wait: true,
      turnId: "t1",
      origin: { kind: "composer" },
    });
    await stepAt($, "medium", { index: 1 });
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort max · Jev: medium → max 80%",
    );
    await startTurn($, "what is 2+2", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["max", "max", "low"]);
  });

  test("a turn with no prompt keeps the previous level, with no Jev call", async ($, on) => {
    const { seen } = world(on, { level: 4 });
    await startTurn($, "Prove the queue is lock-free");
    await stepAt($, "medium");
    await startTurn($, "", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.bodies).toHaveLength(1);
    expect(seen.steps.map((s) => s.effort)).toEqual(["max", "max"]);
  });

  test("a subagent's turn asks Jev nothing", async ($, on) => {
    const { seen } = world(on);
    await $.turn.start({ text: "search", turnId: "a", agentId: "a1" });
    expect(seen.bodies).toHaveLength(0);
  });

  test("a subagent's steps are left at their own level", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium", { agentId: "a1" });
    expect(seen.steps[0].effort).toBe("medium");
  });

  test("on a model that re-caches on a change, Jev is not asked", async ($, on) => {
    const { seen } = world(on, { model: "claude-opus-5" });
    await startTurn($, "go");
    await stepAt($, "high", { model: "claude-opus-5" });
    await startTurn($, "and again", "t2");
    await stepAt($, "high", { model: "claude-opus-5", turnId: "t2" });
    expect(seen.bodies).toHaveLength(0);
    expect(seen.steps.map((s) => s.effort)).toEqual(["high", "high"]);
    expect((await complete($, "Done.", "t2")).text).toBe(
      "opus-5 · effort high",
    );
    const { texts } = await bandTexts($, "terminal");
    expect(texts.join(" ")).not.toContain("Jev");
  });

  test("switching to a cache-keeping model asks Jev again, with the earlier prompts", async ($, on) => {
    const over: World = { model: "claude-opus-5" };
    const { seen } = world(on, over);
    await startTurn($, "go");
    await stepAt($, "high", { model: over.model });
    expect(seen.bodies).toHaveLength(0);
    over.model = OPUS55;
    await startTurn($, "now this", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.bodies).toHaveLength(1);
    expect(seen.bodies[0].state.earlierPrompts).toEqual(["go"]);
    expect(seen.steps[1].effort).toBe("xhigh");
  });

  test("with no first-party credential (a 3P provider, a gateway), Jev is not asked", async ($, on) => {
    const { seen } = world(on, { auth: null });
    await startTurn($, "go");
    await stepAt($, "high");
    expect(seen.bodies).toHaveLength(0);
    expect(seen.steps[0].effort).toBe("high");
  });

  test("with experimental betas off, Jev is not asked", async ($, on) => {
    const { seen } = world(on, {
      env: { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1" },
    });
    await startTurn($, "go");
    await stepAt($, "high");
    expect(seen.bodies).toHaveLength(0);
    expect(seen.steps[0].effort).toBe("high");
  });

  test("Jev failing leaves the session's level and says so", async ($, on) => {
    const { seen } = world(on, { status: 500 });
    await startTurn($, "go");
    await stepAt($, "high");
    expect(seen.steps[0].effort).toBe("high");
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort high · Jev: HTTP 500, session level",
    );
  });

  test("Jev not answering in time leaves the session's level", async ($, on) => {
    const { seen, clock } = world(on, { level: undefined });
    const p = startTurn($, "go");
    await clock.advance(4_000);
    await p;
    await stepAt($, "high");
    expect(seen.steps[0].effort).toBe("high");
    expect((await complete($)).text).toContain("no answer in 4 s");
  });

  test("no key: a toast once, and the session's level", async ($, on) => {
    const { seen } = world(on, { env: { TYPESAFE_API_KEY: "" } });
    await startTurn($, "one");
    await startTurn($, "two");
    expect(seen.bodies).toHaveLength(0);
    expect(seen.toasts).toEqual(["effort-pilot: set TYPESAFE_API_KEY for Jev"]);
  });

  test("Jev sees earlier prompts and the last answer, never tool output", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "first");
    await stepAt($, "medium");
    await complete($, "The first answer.");
    await startTurn($, "second");
    expect(seen.bodies[1].state).toEqual({
      prompt: "second",
      earlierPrompts: ["first"],
      previousAnswer: "The first answer.",
      model: OPUS55,
      defaultEffort: "medium",
    });
  });

  test("Jev's first call of a session names the configured default", async ($, on) => {
    const { seen } = world(on, {
      settings: {
        effortLevel: "medium",
        modelSettings: { [OPUS55]: { effortLevel: "high" } },
      },
    });
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("high");
  });

  test("CLAUDE_CODE_EFFORT_LEVEL is the default Jev is told", async ($, on) => {
    const { seen } = world(on, {
      env: { CLAUDE_CODE_EFFORT_LEVEL: "xhigh" },
      settings: { effortLevel: "high" },
    });
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("xhigh");
  });

  test("with no setting Jev is told the model's own default", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("medium");
  });

  test("on a model with no known default, Jev is told it is unknown", async ($, on) => {
    const { seen } = world(on, { model: "claude-sonnet-5-5-20261101" });
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("unknown");
  });

  test("a user-level effortLevel doesn't set Opus 5.5's default", async ($, on) => {
    const { seen } = world(on, {
      settings: { effortLevel: "low" },
      sources: { user: { effortLevel: "low" } },
    });
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("medium");
  });

  test("a project effortLevel sets Opus 5.5's default", async ($, on) => {
    const { seen } = world(on, {
      settings: { effortLevel: "high" },
      sources: {
        user: { effortLevel: "low" },
        project: { effortLevel: "high" },
      },
    });
    await startTurn($, "first");
    expect(seen.bodies[0].state.defaultEffort).toBe("high");
  });

  test("CLAUDE_CODE_EFFORT_LEVEL holds every request's level; Jev only advises", async ($, on) => {
    const { seen } = world(on, { env: { CLAUDE_CODE_EFFORT_LEVEL: "high" } });
    await startTurn($, "Refactor the auth flow across the services");
    await stepAt($, "high");
    await stepAt($, "high", { index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual(["high", "high"]);
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort high · Jev advises xhigh 80% (not applied: CLAUDE_CODE_EFFORT_LEVEL is set)",
    );
  });

  test("an ultrathink prompt holds its turn's level; the next turn is Jev's again", async ($, on) => {
    const { seen } = world(on, { level: 0 });
    await startTurn($, "ultrathink: why does the cache miss?");
    await stepAt($, "xhigh");
    await stepAt($, "xhigh", { index: 1 });
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort xhigh · Jev advises low 80% (not applied: ultrathink)",
    );
    await startTurn($, "and the other one?", "t2");
    // ultrathink's xhigh was the turn's, not the session's default.
    expect(seen.bodies[1].state.defaultEffort).toBe("medium");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh", "low"]);
  });

  test("a turn with no prompt after an ultrathink turn takes the session's level", async ($, on) => {
    const { seen } = world(on, { level: 0 });
    await startTurn($, "ultrathink about it");
    await stepAt($, "xhigh");
    await complete($);
    await startTurn($, "", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "medium"]);
  });

  test("a skill the model calls holds the rest of its turn once its effort shows", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "Refactor the auth flow across the services");
    await stepAt($, "medium");
    await callSkill($, "deep-review");
    await stepAt($, "max", { index: 1 });
    await stepAt($, "max", { index: 2 });
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort max · Jev advises xhigh 80% (not applied: deep-review skill's effort)",
    );
    await startTurn($, "next", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual([
      "xhigh",
      "max",
      "max",
      "xhigh",
    ]);
  });

  test("a skill is named as it resolved", async ($, on) => {
    world(on, { resolves: { "deep-review": "plugin:deep-review" } });
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "deep-review");
    await stepAt($, "max", { index: 1 });
    expect((await complete($)).text).toContain(
      "(not applied: plugin:deep-review skill's effort)",
    );
  });

  test("a Skill result with no name names the skill asked for", async ($, on) => {
    world(on, { resolves: { "deep-review": "" } });
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "deep-review");
    await stepAt($, "max", { index: 1 });
    expect((await complete($)).text).toContain(
      "(not applied: deep-review skill's effort)",
    );
  });

  test("a skill with no effort level holds nothing", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "commit");
    await stepAt($, "medium", { index: 1 });
    await stepAt($, "medium", { index: 2 });
    expect(seen.steps.map((s) => s.effort)).toEqual([
      "xhigh",
      "xhigh",
      "xhigh",
    ]);
  });

  test("a refused or failed Skill call holds nothing", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "nope");
    await callSkill($, "gone");
    await stepAt($, "low", { index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
  });

  test("a subagent's skill leaves the main loop's level to Jev", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "deep-review", "a1");
    await stepAt($, "max", { agentId: "a1" });
    await stepAt($, "medium", { index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "max", "xhigh"]);
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort xhigh · Jev: medium → xhigh 80%",
    );
  });

  test("a skill from an earlier turn holds nothing later", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium");
    await callSkill($, "commit");
    await complete($);
    await startTurn($, "next", "t2");
    await stepAt($, "low", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
  });

  test("an ultrathink turn stays held by ultrathink when a skill runs in it", async ($, on) => {
    const { seen } = world(on, { level: 0 });
    await startTurn($, "ultrathink: why does the cache miss?");
    await stepAt($, "xhigh");
    await callSkill($, "deep-review");
    await stepAt($, "max", { index: 1 });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "max"]);
    expect((await complete($)).text).toContain("(not applied: ultrathink)");
  });

  test("a typed /skill holds its own turn from its first request", async ($, on) => {
    const { seen } = world(on);
    await typeCommand($, "quick");
    await startTurn($, QUICK_TURN);
    // no earlier request: the level before it is the configured one (medium)
    await stepAt($, "low");
    await stepAt($, "low", { index: 1 });
    expect((await complete($)).text).toBe(
      "opus-5-5 · effort low · Jev advises xhigh 80% (not applied: quick skill's effort)",
    );
    await startTurn($, "next", "t2");
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["low", "low", "xhigh"]);
  });

  test("a /skill typed over a running turn holds its own turn, not the running one", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "Refactor the auth flow across the services");
    await stepAt($, "medium");
    await stepAt($, "medium", { index: 1 });
    // a queued command runs once the running turn has ended
    await complete($);
    await typeCommand($, "quick");
    await startTurn($, QUICK_TURN, "t2");
    await stepAt($, "low", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh", "low"]);
  });

  test("the level before a skill is the last unheld request's, not a held one's", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "high");
    await callSkill($, "quick");
    await stepAt($, "low", { index: 1 });
    await complete($);
    // back at high: a skill with no effort, though the last request ran at low
    await typeCommand($, "plain");
    await startTurn($, "<command-message>plain</command-message>", "t2");
    await stepAt($, "high", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "low", "xhigh"]);
  });

  test("on another model the level before a skill is that model's configured one", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "high");
    await complete($);
    await typeCommand($, "plain");
    await startTurn($, "<command-message>plain</command-message>", "t2");
    // Sonnet 5.5's own default: no skill's level
    await stepAt($, "medium", { turnId: "t2", model: "claude-sonnet-5-5" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
  });

  test("a built-in command holds nothing: /effort sets the session's level", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "go");
    await stepAt($, "medium");
    await complete($);
    await typeCommand($, "effort");
    await startTurn($, "next", "t2");
    await stepAt($, "low", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
    expect((await complete($, "Done.", "t2")).text).toBe(
      "opus-5-5 · effort xhigh · Jev: low → xhigh 80%",
    );
  });

  /** `/effort low` as saved: Opus 5.5's level in the settings. */
  const EFFORT_LOW = {
    settings: { modelSettings: { [OPUS55]: { effortLevel: "low" } } },
  };

  test("right after /effort low, a skill with effort medium holds its turn", async ($, on) => {
    const { seen } = world(on, EFFORT_LOW);
    await startTurn($, "go");
    await stepAt($, "medium");
    await complete($);
    await typeCommand($, "effort");
    await typeCommand($, "quick");
    await startTurn($, QUICK_TURN, "t2");
    // the last request ran at medium, but the session's level is now low
    await stepAt($, "medium", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "medium"]);
    expect((await complete($, "Done.", "t2")).text).toContain(
      "(not applied: quick skill's effort)",
    );
  });

  test("right after /effort low, a skill with no effort holds nothing", async ($, on) => {
    const { seen } = world(on, EFFORT_LOW);
    await startTurn($, "go");
    await stepAt($, "medium");
    await complete($);
    await typeCommand($, "effort");
    await typeCommand($, "quick");
    await startTurn($, QUICK_TURN, "t2");
    await stepAt($, "low", { turnId: "t2" });
    expect(seen.steps.map((s) => s.effort)).toEqual(["xhigh", "xhigh"]);
    expect((await complete($, "Done.", "t2")).text).toBe(
      "opus-5-5 · effort xhigh · Jev: low → xhigh 80%",
    );
  });

  test("a command whose source is unknown counts as a skill", async ($, on) => {
    const { seen } = world(on, { noCommandList: true });
    await typeCommand($, "quick");
    await startTurn($, QUICK_TURN);
    await stepAt($, "low");
    expect(seen.steps.map((s) => s.effort)).toEqual(["low"]);
  });

  test("/clear drops a skill waiting for the next turn", async ($, on) => {
    const { seen } = world(on);
    await typeCommand($, "quick");
    await $.session.end({
      reason: "clear",
      sessionId: "s1",
      resume: {},
    } as never);
    await startTurn($, "go");
    await stepAt($, "low");
    expect(seen.steps[0].effort).toBe("xhigh");
  });

  test("a hold survives a reload", async ($, on) => {
    const { seen } = world(on, { level: 0 });
    await startTurn($, "ultrathink: go");
    await $.session.start({ cwd: "/r" } as never);
    await stepAt($, "xhigh");
    expect(seen.steps[0].effort).toBe("xhigh");
  });

  test("/clear forgets the verdict and context; a reload keeps them", async ($, on) => {
    const { seen } = world(on);
    await startTurn($, "first");
    await stepAt($, "medium");
    await $.session.start({ cwd: "/r" } as never);
    expect((await complete($)).text).toContain("Jev: medium → xhigh");
    await $.session.end({
      reason: "clear",
      sessionId: "s1",
      resume: {},
    } as never);
    await startTurn($, "after clear");
    expect(seen.bodies[1].state.earlierPrompts).toEqual([]);
    expect(seen.bodies[1].state.previousAnswer).toBe("");
  });

  for (const surface of SURFACES)
    test(`the band shows the model and effort (${surface})`, async ($, on) => {
      world(on);
      let b = await bandTexts($, surface);
      expect(b.texts.join(" ")).toContain("opus-5-5 · effort –");
      await startTurn($, "go");
      await stepAt($, "medium");
      b = await bandTexts($, surface);
      expect(b.texts.join(" ")).toContain("opus-5-5 · effort xhigh");
      expect(b.texts.join(" ")).toContain("Jev: medium → xhigh 80%");
      expect(b.drawn).not.toContain("marginTop");
    });
});
