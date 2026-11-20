/**
 * Property tests for effort-pilot/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { EffortLevel } from "../../plugins/effort-pilot/types";
import {
  capLevel,
  configuredEffort,
  cut,
  cutTail,
  keepsCacheOnChange,
  LEVELS,
  MIN_CONFIDENCE,
  parseJev,
  RECENT_PROMPTS,
  startTurnHolds,
  stepEffort,
  stepHolds,
  withPrompt,
} from "../../plugins/effort-pilot/hooks/core.ts";

const level = fc.constantFrom(...LEVELS);
const session = fc.oneof(level, fc.nat(64_000), fc.constant(undefined));
const verdict = fc.oneof(
  fc.constant(null),
  fc.record({
    kind: fc.constant("jev" as const),
    level,
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  fc.record({ kind: fc.constant("failed" as const), reason: fc.string() }),
);

describe("parseJev", () => {
  test("never throws, and picks the most likely level", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 5,
          maxLength: 5,
        }),
        (ps) => {
          const text = JSON.stringify({
            answers: {
              effort: {
                probabilities: Object.fromEntries(
                  ps.map((p, i) => [String(i), p]),
                ),
              },
            },
          });
          const v = parseJev(text)!;
          expect(ps[LEVELS.indexOf(v.level)]).toBe(Math.max(...ps));
          expect(v.confidence).toBeGreaterThanOrEqual(0);
          expect(v.confidence).toBeLessThanOrEqual(1);
        },
      ),
    );
    fc.assert(fc.property(fc.string(), (s) => void parseJev(s)));
    fc.assert(fc.property(fc.json(), (s) => void parseJev(s)));
  });
});

describe("capLevel", () => {
  test("never above a cap that is a level; otherwise the level as it was", () => {
    fc.assert(
      fc.property(level, fc.oneof(level, fc.anything()), (l, cap) => {
        const held = capLevel(l, cap);
        if (typeof cap === "string" && (LEVELS as readonly string[]).includes(cap))
          expect(held).toBe(LEVELS.indexOf(l) > LEVELS.indexOf(cap as EffortLevel) ? cap : l);
        else expect(held).toBe(l);
      }),
    );
  });
});

describe("stepEffort", () => {
  test("sends Jev's level when it is sure enough, the session's when unsure, the previous level with no call, and never adds or drops effort", () => {
    fc.assert(
      fc.property(session, verdict, fc.boolean(), session, (s, v, steers, prev) => {
        const sent = stepEffort(s, v, steers, prev);
        if (s === undefined || typeof s === "number") expect(sent).toBe(s);
        else if (!steers || v?.kind === "failed") expect(sent).toBe(s);
        else if (v !== null)
          expect(sent).toBe(v.confidence >= MIN_CONFIDENCE ? v.level : s);
        else expect(sent).toBe(typeof prev === "string" ? prev : s);
      }),
      // The no-call-with-a-previous-level case is under 1% of draws.
      { numRuns: 2_000 },
    );
  });
});

describe("configuredEffort", () => {
  test("a level in the env wins, auto or unset gives none, and settings never give max", () => {
    const value = fc.oneof(fc.constantFrom(...LEVELS), fc.anything());
    const settings = fc.record(
      {
        effortLevel: value,
        modelSettings: fc.oneof(
          fc.dictionary(
            fc.constantFrom("claude-opus-5-5", "claude-opus-5", "x"),
            fc.record({ effortLevel: value }, { requiredKeys: [] }),
          ),
          fc.anything(),
        ),
      },
      { requiredKeys: [] },
    );
    const model = fc.option(
      fc.oneof(
        fc.constantFrom("claude-opus-5-5", "claude-opus-5", "claude-opus-4-7", "claude-haiku-4-5"),
        fc.string(),
      ),
      { nil: undefined },
    );
    const env = fc.option(fc.oneof(fc.constantFrom(...LEVELS, "auto", "unset"), fc.string()), {
      nil: undefined,
    });
    fc.assert(
      fc.property(settings, model, env, fc.array(settings, { maxLength: 4 }), (s, m, e, shared) => {
        const r = configuredEffort(s, m, e, shared);
        if ((LEVELS as readonly unknown[]).includes(e)) expect(r).toBe(e);
        else if (e === "auto" || e === "unset") expect(r).toBeUndefined();
        else expect(r === undefined || (LEVELS.includes(r) && r !== "max")).toBe(true);
      }),
    );
  });
});

describe("holds", () => {
  const turn = fc.constantFrom("t1", "t2");
  const effort = fc.oneof(level, fc.constant(undefined));
  const model = fc.constantFrom("claude-opus-5-5", "claude-sonnet-5-5");
  const holds = fc.record({
    running: fc.option(turn, { nil: null }),
    held: fc.option(fc.record({ turnId: turn, by: fc.string() }), { nil: null }),
    skill: fc.option(
      fc.record({ turnId: fc.option(turn, { nil: null }), by: fc.string() }),
      { nil: null },
    ),
    base: fc.option(fc.record({ model, effort }), { nil: null }),
  });

  test("a turn's start runs it and takes a skill run before it; one from an earlier turn is dropped", () => {
    fc.assert(
      fc.property(holds, fc.string(), (h, text) => {
        const r = startTurnHolds(h, text, "t3");
        expect(r.running).toBe("t3");
        expect(r.base).toEqual(h.base);
        expect(r.skill).toEqual(
          h.skill?.turnId === null ? { turnId: "t3", by: h.skill.by } : null,
        );
        if (/\bultrathink\b/i.test(text))
          expect(r.held).toEqual({ turnId: "t3", by: "ultrathink" });
        else expect(r.held).toEqual(h.held);
      }),
    );
  });

  test("a request holds its turn only after a skill in it changed the level; else it is the base", () => {
    fc.assert(
      fc.property(holds, turn, model, effort, effort, (h, t, m, e, before) => {
        const r = stepHolds(h, t, m, e, before);
        expect(r.running).toBe(h.running);
        if (h.held?.turnId === t) expect(r).toBe(h);
        else if (h.skill?.turnId === t && e !== before) {
          expect(r.held).toEqual({ turnId: t, by: h.skill.by });
          expect(r.skill).toBeNull();
          expect(r.base).toEqual(h.base);
        } else {
          expect(r.held).toEqual(h.held);
          expect(r.skill).toEqual(h.skill);
          expect(r.base).toEqual({ model: m, effort: e });
          // nothing changed: the same object, so no write
          if (h.base?.model === m && h.base.effort === e) expect(r).toBe(h);
        }
      }),
    );
  });
});

describe("keepsCacheOnChange", () => {
  test("never off first-party", () => {
    fc.assert(
      fc.property(fc.string(), (m) =>
        expect(keepsCacheOnChange(m, false)).toBe(false),
      ),
    );
  });
});

describe("context for Jev", () => {
  test("keeps at most the last prompts, each cut", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 3000 }), { maxLength: 10 }),
        (ps) => {
          let c = { prompts: [] as string[], answer: "" };
          for (const p of ps) c = withPrompt(c, p);
          expect(c.prompts.length).toBe(Math.min(ps.length, RECENT_PROMPTS));
          for (const p of c.prompts) expect(p.length).toBeLessThanOrEqual(1001);
        },
      ),
    );
  });

  test("cut keeps the head, cutTail the tail, each within max + 1", () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(200), (s, n) => {
        expect(cut(s, n).length).toBeLessThanOrEqual(n + 1);
        expect(cutTail(s, n).length).toBeLessThanOrEqual(n + 1);
        if (s.length <= n) {
          expect(cut(s, n)).toBe(s);
          expect(cutTail(s, n)).toBe(s);
        } else {
          expect(cut(s, n).startsWith(s.slice(0, n))).toBe(true);
          expect(cutTail(s, n).endsWith(s.slice(s.length - n))).toBe(true);
        }
      }),
    );
  });
});
