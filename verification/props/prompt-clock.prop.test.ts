/**
 * Property tests for prompt-clock/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  cap,
  emptyTimes,
  fmtDuration,
  fmtTime,
  parseTranscript,
  promptText,
  turnEnd,
  turnRange,
} from "../../plugins/prompt-clock/hooks/core.ts";

const epoch = fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 });

describe("fmtTime", () => {
  test("same day: clock only; different day: month + day + clock", () => {
    fc.assert(
      fc.property(epoch, epoch, fc.boolean(), (at, now, seconds) => {
        const s = fmtTime(at, now, seconds);
        const sameDay =
          new Date(at).toDateString() === new Date(now).toDateString();
        if (sameDay) {
          // clock only: HH:MM or HH:MM:SS
          expect(s).toMatch(seconds ? /^\d{2}:\d{2}:\d{2}$/ : /^\d{2}:\d{2}$/);
        } else {
          // "Oct 4 HH:MM:SS" or "Oct 4 HH:MM"
          expect(s).toMatch(
            seconds ? /^\w+ \d+ \d{2}:\d{2}:\d{2}$/ : /^\w+ \d+ \d{2}:\d{2}$/,
          );
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("hours 00-23, minutes 00-59, seconds 00-59", () => {
    fc.assert(
      fc.property(epoch, epoch, (at, now) => {
        const s = fmtTime(at, now, true);
        const clockPart =
          s.includes(" ") && /[A-Z]/.test(s[0]!)
            ? s.split(" ").slice(2).join(" ")
            : s;
        const parts = clockPart.split(":");
        expect(Number(parts[0])).toBeLessThanOrEqual(23);
        expect(Number(parts[1])).toBeLessThan(60);
        if (parts[2]) expect(Number(parts[2])).toBeLessThan(60);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("fmtDuration", () => {
  const posMs = fc.integer({ min: 0, max: 360_000_000 });

  test("format shape: Xs, Xm Ys, or Xh Ym", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtDuration(ms);
        expect(s).toMatch(/^(\d+s|\d+m \d+s|\d+h \d+m)$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60s or 60m rollover", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtDuration(ms);
        // seconds: match "NNs" at end or after "m "
        const secMatch = s.match(/(\d+)s$/);
        if (secMatch && s.includes("m"))
          expect(Number(secMatch[1])).toBeLessThan(60);
        // minutes: match "NNm" before " "
        const minMatch = s.match(/(\d+)m/);
        if (minMatch && s.includes("h"))
          expect(Number(minMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("boundary: 60s gives 1m 0s", () => {
    expect(fmtDuration(60_000)).toBe("1m 0s");
  });

  test("boundary: 3600s gives 1h 0m", () => {
    expect(fmtDuration(3_600_000)).toBe("1h 0m");
  });
});

describe("promptText", () => {
  test("string input returns itself", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (s) => {
        expect(promptText(s)).toBe(s);
      }),
      { numRuns: 500 },
    );
  });

  test("tool_result blocks return undefined", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant({
              type: "tool_result",
              tool_use_id: "t",
              content: "ok",
            }),
            fc.record({ type: fc.constant("text"), text: fc.string() }),
          ),
          { minLength: 1, maxLength: 5 },
        ),
        (content) => {
          if (content.some((b) => (b as any).type === "tool_result")) {
            expect(promptText(content)).toBeUndefined();
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  test("non-string non-array returns undefined", () => {
    expect(promptText(42)).toBeUndefined();
    expect(promptText(null)).toBeUndefined();
    expect(promptText(undefined)).toBeUndefined();
    expect(promptText({})).toBeUndefined();
  });
});

describe("parseTranscript", () => {
  test("invalid JSON lines are skipped without error", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant("not json at all"),
            fc.constant("{broken"),
            fc.constant('{"no":"timestamp"}'),
          ),
          { minLength: 0, maxLength: 20 },
        ),
        (lines) => {
          const times = parseTranscript(lines.join("\n"));
          expect(Object.keys(times.sent)).toEqual([]);
          expect(Object.keys(times.turns)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("valid user rows are indexed by uuid and text", () => {
    const row = {
      type: "user",
      uuid: "u1",
      timestamp: "2026-10-05T13:00:00.000Z",
      message: { content: "hello" },
    };
    const times = parseTranscript(JSON.stringify(row));
    expect(times.sent["u1"]).toBeDefined();
    expect(times.byText["hello"]).toBeDefined();
  });

  test("turn_duration rows are indexed", () => {
    const row = {
      type: "system",
      subtype: "turn_duration",
      durationMs: 5000,
      timestamp: "2026-10-05T13:01:00.000Z",
    };
    const times = parseTranscript(JSON.stringify(row));
    expect(times.turns["5000"]).toBeDefined();
  });
});

describe("turnEnd (light)", () => {
  test("exact match always found", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), epoch, (dur, at) => {
        const turns = { [String(dur)]: at };
        expect(turnEnd(turns, dur)).toBe(at);
      }),
      { numRuns: 500 },
    );
  });

  test("within-a-second fuzzy match", () => {
    const turns = { "5000": 1_000_000_000_000 };
    expect(turnEnd(turns, 5500)).toBe(1_000_000_000_000);
    expect(turnEnd(turns, 4500)).toBe(1_000_000_000_000);
    expect(turnEnd(turns, 6001)).toBeUndefined();
  });
});

describe("cap (light)", () => {
  test("never exceeds keep", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 2_000_000_000_000 }),
          { minKeys: 0, maxKeys: 50 },
        ),
        fc.integer({ min: 0, max: 30 }),
        (record, keep) => {
          expect(Object.keys(cap(record, keep)).length).toBeLessThanOrEqual(
            keep,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  test("keep=0 always returns empty", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 2_000_000_000_000 }),
          { minKeys: 0, maxKeys: 20 },
        ),
        (record) => {
          expect(Object.keys(cap(record, 0)).length).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("keeps newest entries", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 2_000_000_000_000 }),
          { minKeys: 3, maxKeys: 50 },
        ),
        fc.integer({ min: 1, max: 30 }),
        (record, keep) => {
          const capped = cap(record, keep);
          const cappedValues = Object.values(capped);
          const allValues = Object.values(record).sort((a, b) => a - b);
          if (allValues.length > keep) {
            const threshold = allValues[allValues.length - keep]!;
            for (const v of cappedValues) {
              expect(v).toBeGreaterThanOrEqual(threshold);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("turnRange", () => {
  test("contains two times separated by arrow", () => {
    fc.assert(
      fc.property(
        epoch,
        fc.integer({ min: 1000, max: 600_000 }),
        epoch,
        fc.boolean(),
        (end, dur, now, sec) => {
          const s = turnRange(end, dur, now, sec);
          expect(s).toContain(" → ");
          const parts = s.split(" → ");
          expect(parts.length).toBe(2);
        },
      ),
      { numRuns: 500 },
    );
  });
});
