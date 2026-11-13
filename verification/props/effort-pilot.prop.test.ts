/**
 * Property tests for effort-pilot/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  cut,
  cutTail,
  keepsCacheOnChange,
  LEVELS,
  MIN_CONFIDENCE,
  parseJev,
  RECENT_PROMPTS,
  stepEffort,
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
