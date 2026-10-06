/**
 * Property tests for continuity/hooks/ttl.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  accountOf,
  colorFor,
  decideTtl,
  expiryOf,
  fmtClock,
  isOn,
  observeTtl,
  ttlMs,
  type Account,
  type Sample,
} from "../../plugins/continuity/hooks/ttl.ts";

describe("fmtClock", () => {
  const posMs = fc.integer({ min: 0, max: 86_400_000 });

  test("format shape: H:MM:SS or M:SS", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtClock(ms);
        expect(s).toMatch(/^(\d+:\d{2}:\d{2}|\d+:\d{2})$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60 in seconds or minutes slots", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtClock(ms);
        const parts = s.split(":");
        const sec = Number(parts[parts.length - 1]);
        const min = Number(parts[parts.length - 2]);
        expect(sec).toBeLessThan(60);
        if (parts.length === 3) expect(min).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("negative input gives 0:00", () => {
    expect(fmtClock(-5000)).toBe("0:00");
    expect(fmtClock(-1)).toBe("0:00");
  });

  test("hour form used when >= 3600s", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3_600_000, max: 86_400_000 }), (ms) => {
        expect(fmtClock(ms).split(":").length).toBe(3);
      }),
      { numRuns: 500 },
    );
  });
});

describe("colorFor", () => {
  test("non-positive lifetime always returns red", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
        fc.integer({ min: -1_000_000, max: 0 }),
        fc.double({ min: 0, max: 1 }),
        fc.double({ min: 0, max: 1 }),
        (left, life, y, r) => {
          expect(colorFor(left, life, y, r)).toBe("red");
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("returns a valid colour", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true }),
        fc.double({ min: 1, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (left, life, y, r) => {
          expect(["green", "yellow", "red"]).toContain(
            colorFor(left, life, y, r),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("zero lifetime zero left is red (NaN share)", () => {
    expect(colorFor(0, 0, 0.25, 0.1)).toBe("red");
  });

  test("monotonicity: less time left never gives a less severe colour", () => {
    const severity = { green: 0, yellow: 1, red: 2 } as const;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3_600_000, noNaN: true }),
        fc.double({ min: 0, max: 3_600_000, noNaN: true }),
        fc.double({ min: 1, max: 3_600_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, life, y, r) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          expect(severity[colorFor(lo, life, y, r)]).toBeGreaterThanOrEqual(
            severity[colorFor(hi, life, y, r)],
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("accountOf", () => {
  test("returns a valid account type", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.oneof(
              fc.constant("five_hour"),
              fc.constant("seven_day"),
              fc.constant("daily"),
            ),
            percentUsed: fc.integer({ min: 0, max: 200 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (windows) => {
          const result = accountOf(windows);
          expect(["subscription", "credits", "other"]).toContain(result);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("no plan windows → other", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constant("daily"),
            percentUsed: fc.integer({ min: 0, max: 200 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (windows) => {
          expect(accountOf(windows)).toBe("other");
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("decideTtl (light)", () => {
  test("returns 5m or 1h", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant("5m"), fc.constant("1h"), fc.constant("auto")),
        fc.record({
          force5m: fc.oneof(fc.constant("1"), fc.constant(undefined)),
          enable1h: fc.oneof(fc.constant("1"), fc.constant(undefined)),
          ttlVar: fc.oneof(
            fc.constant("5m"),
            fc.constant("1h"),
            fc.constant(undefined),
          ),
        }),
        fc.oneof(fc.constant("5m"), fc.constant("1h"), fc.constant(undefined)),
        fc.oneof(
          fc.constant("subscription" as Account),
          fc.constant("credits" as Account),
          fc.constant("other" as Account),
        ),
        (opt, env, setting, acct) => {
          expect(["5m", "1h"]).toContain(decideTtl(opt, env, setting, acct));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("observeTtl (light)", () => {
  test("returns undefined, 5m, or 1h", () => {
    const sample = (): fc.Arbitrary<Sample> =>
      fc.record({
        model: fc.constant("claude-opus-5-5"),
        startedAt: fc.integer({
          min: 1_000_000_000_000,
          max: 2_000_000_000_000,
        }),
        read: fc.integer({ min: 0, max: 200_000 }),
        write: fc.integer({ min: 0, max: 10_000 }),
        fresh: fc.integer({ min: 0, max: 5_000 }),
      });
    fc.assert(
      fc.property(
        fc.option(sample(), { nil: undefined }),
        sample(),
        fc.oneof(
          fc.constant(undefined),
          fc.constant("5m" as const),
          fc.constant("1h" as const),
        ),
        (prev, cur, known) => {
          const result = observeTtl(prev, cur, known);
          expect([undefined, "5m", "1h"]).toContain(result);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("expiryOf", () => {
  test("expiry = startedAt + ttlMs when cache was touched", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
        fc.integer({ min: 1, max: 200_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.oneof(fc.constant("5m" as const), fc.constant("1h" as const)),
        (at, read, write, ttl) => {
          const s = { model: "m", startedAt: at, read, write, fresh: 0 };
          expect(expiryOf(s, ttl)).toBe(at + ttlMs(ttl));
        },
      ),
      { numRuns: 500 },
    );
  });

  test("no cache → no expiry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
        fc.oneof(fc.constant("5m" as const), fc.constant("1h" as const)),
        (at, ttl) => {
          const s = {
            model: "m",
            startedAt: at,
            read: 0,
            write: 0,
            fresh: 100,
          };
          expect(expiryOf(s, ttl)).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
