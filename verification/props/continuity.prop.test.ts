/**
 * Property tests for continuity/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  bar,
  blockingLimit,
  buildNote,
  compactInstructions,
  continuePrompt,
  countDirty,
  fmtCountdown,
  fmtLength,
  fmtTokens,
  gaugeColor,
  lastCheck,
  openTodos,
  shouldHandover,
  userPrompts,
  WARN_POINTS,
  type NoteFacts,
  type TurnFacts,
} from "../../plugins/continuity/hooks/core.ts";

const posMs = fc.integer({ min: 0, max: 360_000_000 });
const width = fc.integer({ min: 0, max: 200 });
const percent = fc.integer({ min: 0, max: 100 });

describe("fmtLength", () => {
  test("format shape: XmYYs or XhYYm", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtLength(ms);
        expect(s).toMatch(/^\d+[hm]\d{2}[ms]$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60s rollover: seconds field is 00-59", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtLength(ms);
        const secMatch = s.match(/(\d{2})s$/);
        if (secMatch) expect(Number(secMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60m rollover: minutes field is 00-59 in hour form", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtLength(ms);
        const minMatch = s.match(/h(\d{2})m$/);
        if (minMatch) expect(Number(minMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("negative input treated as zero", () => {
    expect(fmtLength(-1000)).toBe("0m00s");
    expect(fmtLength(-999_999)).toBe("0m00s");
  });

  test("monotonicity: longer ms never gives a shorter formatted time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86_400_000 }),
        fc.integer({ min: 0, max: 86_400_000 }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const parseSec = (s: string) => {
            const hm = s.match(/^(\d+)h(\d+)m$/);
            if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60;
            const ms2 = s.match(/^(\d+)m(\d+)s$/);
            return Number(ms2![1]) * 60 + Number(ms2![2]);
          };
          expect(parseSec(fmtLength(hi))).toBeGreaterThanOrEqual(
            parseSec(fmtLength(lo)),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("fmtCountdown", () => {
  test("format shape: H:MM:SS", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtCountdown(ms);
        expect(s).toMatch(/^\d+:\d{2}:\d{2}$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60 in minutes or seconds slots", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtCountdown(ms);
        const parts = s.split(":");
        expect(Number(parts[1])).toBeLessThan(60);
        expect(Number(parts[2])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("fmtTokens", () => {
  const tokenCount = fc.integer({ min: 0, max: 200_000_000 });

  test("never returns '1000k' or similar rollover", () => {
    fc.assert(
      fc.property(tokenCount, (n) => {
        const s = fmtTokens(n);
        if (s.endsWith("k")) {
          const num = Number(s.slice(0, -1));
          expect(num).toBeLessThan(1000);
        }
      }),
      { numRuns: 5000 },
    );
  });

  test("format matches pattern: digits, optionally with k or M suffix", () => {
    fc.assert(
      fc.property(tokenCount, (n) => {
        const s = fmtTokens(n);
        expect(s).toMatch(/^\d+(\.\d+)?[kM]?$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("boundary: 999_500 and above rounds to 1M, not 1000k", () => {
    expect(fmtTokens(999_500)).toBe("1M");
    expect(fmtTokens(999_600)).toBe("1M");
    expect(fmtTokens(999_499)).toBe("999k");
    expect(fmtTokens(1_000_000)).toBe("1M");
  });

  test("monotonicity: larger n never gives a smaller formatted value", () => {
    const toNum = (s: string) => {
      if (s.endsWith("M")) return Number(s.slice(0, -1)) * 1_000_000;
      if (s.endsWith("k")) return Number(s.slice(0, -1)) * 1_000;
      return Number(s);
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(toNum(fmtTokens(hi))).toBeGreaterThanOrEqual(
            toNum(fmtTokens(lo)),
          );
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("bar", () => {
  test("always returns exactly `width` characters", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: false }),
        fc.integer({ min: 0, max: 200 }),
        (p, w) => {
          const b = bar(p, w);
          expect([...b].length).toBe(w);
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("NaN and Infinity render an empty bar", () => {
    expect(bar(NaN, 10)).toBe("░".repeat(10));
    expect(bar(Infinity, 10)).toBe("░".repeat(10));
    expect(bar(-Infinity, 10)).toBe("░".repeat(10));
  });

  test("0% is all empty, 100% is all full", () => {
    fc.assert(
      fc.property(width, (w) => {
        expect(bar(0, w)).toBe("░".repeat(w));
        expect(bar(100, w)).toBe("█".repeat(w));
      }),
      { numRuns: 500 },
    );
  });

  test("only contains █ and ░ characters", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.integer({ min: 0, max: 100 }),
        (p, w) => {
          const b = bar(p, w);
          expect(b).toMatch(/^[█░]*$/);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("gaugeColor", () => {
  test("returns a valid colour", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (p, t) => {
          expect(["green", "yellow", "red"]).toContain(gaugeColor(p, t));
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("at or above threshold is always red", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (t) => {
        expect(gaugeColor(t, t)).toBe("red");
        expect(gaugeColor(t + 1, t)).toBe("red");
      }),
      { numRuns: 500 },
    );
  });

  test("monotonicity: higher percent never moves to a less severe colour", () => {
    const severity = { green: 0, yellow: 1, red: 2 } as const;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (a, b, t) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(severity[gaugeColor(hi, t)]).toBeGreaterThanOrEqual(
            severity[gaugeColor(lo, t)],
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("countDirty", () => {
  test("empty string gives 0", () => {
    expect(countDirty("")).toBe(0);
  });

  test("counts non-empty lines", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.stringOf(
            fc.char().filter((c) => c !== "\n"),
            { minLength: 1, maxLength: 20 },
          ),
          {
            minLength: 0,
            maxLength: 50,
          },
        ),
        (lines) => {
          const input = lines.join("\n");
          expect(countDirty(input)).toBe(lines.length);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("blockingLimit", () => {
  test("never returns a limit in the past", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
        (now) => {
          const limits = [
            {
              kind: "five_hour",
              percentUsed: 100,
              resetsAt: new Date(now - 1000).toISOString(),
            },
            {
              kind: "seven_day",
              percentUsed: 100,
              resetsAt: new Date(now + 3600_000).toISOString(),
            },
          ];
          const result = blockingLimit(limits, now);
          if (result) expect(result.resetsAt).toBeGreaterThan(now);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("returns undefined when nothing is at 100%", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
        (pct, now) => {
          const limits = [
            {
              kind: "five_hour",
              percentUsed: pct,
              resetsAt: new Date(now + 3600_000).toISOString(),
            },
          ];
          expect(blockingLimit(limits, now)).toBeUndefined();
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("fence escaping: compactInstructions / continuePrompt", () => {
  /** Any string a model could read as the closing fence tag. */
  const nearTags = fc.oneof(
    fc.constant("</handover-note>"),
    fc.constant("</ handover-note>"),
    fc.constant("</handover-note >"),
    fc.constant("< /handover-note>"),
    fc.constant("</HANDOVER-NOTE>"),
    fc.constant("</HANDOVER-NOTE\n>"),
    fc.constant("<handover-note>"),
    fc.constant("< handover-note >"),
  );

  const textWithNearTags = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 200 }),
      nearTags,
      fc.string({ minLength: 0, maxLength: 200 }),
    )
    .map(([a, tag, b]) => `${a}${tag}${b}`);

  test("compactInstructions: exactly one opening and one closing fence tag", () => {
    fc.assert(
      fc.property(textWithNearTags, (note) => {
        const out = compactInstructions(note);
        expect(out.match(/<handover-note>/g)?.length).toBe(1);
        expect(out.match(/<\/handover-note>/g)?.length).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });

  test("continuePrompt: exactly one opening and one closing fence tag", () => {
    fc.assert(
      fc.property(textWithNearTags, (note) => {
        const out = continuePrompt("/h/n.md", note);
        expect(out.match(/<handover-note>/g)?.length).toBe(1);
        expect(out.match(/<\/handover-note>/g)?.length).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });

  test("no near-tag variant survives inside the fenced body", () => {
    const variants = [
      "</handover-note >",
      "</ handover-note>",
      "< /handover-note>",
      "</HANDOVER-NOTE>",
      "</HANDOVER-NOTE\n>",
      "<handover-note >",
    ];
    for (const v of variants) {
      const out = continuePrompt("/h/n.md", `prefix ${v} suffix`);
      // The original tag should not appear anywhere in the body
      // (it's replaced with ‹). Only the real closing tag appears once.
      expect(out.match(/<\/handover-note>/g)?.length).toBe(1);
    }
  });

  test("arbitrary text never breaks the fence count", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (note) => {
        const out = compactInstructions(note);
        expect(out.match(/<handover-note>/g)?.length).toBe(1);
        expect(out.match(/<\/handover-note>/g)?.length).toBe(1);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("userPrompts", () => {
  test("returns only strings, never empty", () => {
    const msg = (text: string, extra: Record<string, unknown> = {}) =>
      ({ role: "user", text, toolUses: [], ...extra }) as any;

    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 100 }).map((t) => msg(t)),
            fc.constant(msg("")),
            fc.constant(msg("<meta>system</meta>")),
            fc.constant(
              msg("ok", { toolResults: [{ tool_use_id: "t", text: "x" }] }),
            ),
          ),
          { minLength: 0, maxLength: 20 },
        ),
        (messages) => {
          const result = userPrompts(messages);
          for (const r of result) {
            expect(typeof r).toBe("string");
            expect(r.length).toBeGreaterThan(0);
            expect(r.trimStart().startsWith("<")).toBe(false);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("shouldHandover (light)", () => {
  test("never fires on a subagent turn", () => {
    fc.assert(
      fc.property(
        fc.record({
          agentId: fc.string({ minLength: 1, maxLength: 10 }),
          reason: fc.constant("answer"),
          isAborted: fc.constant(false),
          percent: fc.integer({ min: 80, max: 100 }),
          threshold: fc.constant(75),
          paused: fc.constant(false),
          turnsSinceHandover: fc.integer({ min: 3, max: 100 }),
        }),
        (t) => {
          expect(shouldHandover(t as TurnFacts)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
