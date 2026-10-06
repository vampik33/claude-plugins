/**
 * Property tests for fleet/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  emptyFleet,
  fmtElapsed,
  isFailed,
  isLive,
  liveCount,
  parseNotification,
  parseStatus,
  parseWorktrees,
  statusLine,
  toolLabel,
  trim,
} from "../../plugins/fleet/hooks/core.ts";

const posMs = fc.integer({ min: 0, max: 360_000_000 });

describe("fmtElapsed", () => {
  test("format shape: Xs, XmYYs, or XhYYm", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtElapsed(ms);
        expect(s).toMatch(/^(\d+s|\d+m\d{2}s|\d+h\d{2}m)$/);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60s rollover", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtElapsed(ms);
        const secMatch = s.match(/(\d{2})s$/);
        if (secMatch) expect(Number(secMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("no 60m rollover", () => {
    fc.assert(
      fc.property(posMs, (ms) => {
        const s = fmtElapsed(ms);
        const minMatch = s.match(/h(\d{2})m$/);
        if (minMatch) expect(Number(minMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 2000 },
    );
  });

  test("monotonicity", () => {
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
            if (ms2) return Number(ms2[1]) * 60 + Number(ms2[2]);
            return Number(s.replace("s", ""));
          };
          expect(parseSec(fmtElapsed(hi))).toBeGreaterThanOrEqual(
            parseSec(fmtElapsed(lo)),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("boundary: exactly 60s gives 1m00s not 60s", () => {
    expect(fmtElapsed(60_000)).toBe("1m00s");
  });

  test("boundary: exactly 3600s gives 1h00m not 60m00s", () => {
    expect(fmtElapsed(3_600_000)).toBe("1h00m");
  });
});

describe("toolLabel", () => {
  test("never exceeds 40 characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.oneof(
          fc.record({
            command: fc.string({ minLength: 0, maxLength: 200 }),
          }),
          fc.record({
            file_path: fc.string({ minLength: 0, maxLength: 200 }),
          }),
          fc.record({
            pattern: fc.string({ minLength: 0, maxLength: 200 }),
          }),
          fc.record({
            description: fc.string({ minLength: 0, maxLength: 200 }),
          }),
          fc.constant({}),
        ),
        (tool, input) => {
          const label = toolLabel(tool, input);
          expect(label.length).toBeLessThanOrEqual(40);
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("truncated labels end with ellipsis", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.record({
          command: fc.string({ minLength: 50, maxLength: 200 }),
        }),
        (tool, input) => {
          const label = toolLabel(tool, input);
          if (label.length === 40) expect(label.endsWith("…")).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("parseNotification", () => {
  test("valid notifications parse correctly", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => !s.includes("<") && s.trim().length > 0),
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => !s.includes("<") && s.trim().length > 0),
        (id, status) => {
          const text = `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n</task-notification>`;
          const result = parseNotification(text);
          expect(result).toBeDefined();
          expect(result!.id).toBe(id.trim());
          expect(result!.status).toBe(status.trim());
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("text without task-notification tag returns undefined", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 0, maxLength: 200 })
          .filter((s) => !s.includes("<task-notification>")),
        (text) => {
          expect(parseNotification(text)).toBeUndefined();
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("parseWorktrees", () => {
  test("bare entries are excluded", () => {
    const out = "worktree /r/bare\nbare\n";
    expect(parseWorktrees(out)).toEqual([]);
  });

  test("each result has path and name", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc
              .string({ minLength: 1, maxLength: 50 })
              .filter((s) => !s.includes("\n")),
            branch: fc
              .string({ minLength: 1, maxLength: 30 })
              .filter((s) => !s.includes("\n") && !s.includes(" ")),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (trees) => {
          const porcelain = trees
            .map(
              (t) =>
                `worktree ${t.path}\nHEAD 1111111aaaa\nbranch refs/heads/${t.branch}`,
            )
            .join("\n\n");
          const result = parseWorktrees(porcelain);
          expect(result.length).toBe(trees.length);
          for (const r of result) {
            expect(r.path).toBeDefined();
            expect(r.name).toBeDefined();
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("parseStatus", () => {
  test("changed, ahead, behind are non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .string({ minLength: 1, maxLength: 40 })
            .filter((s) => !s.includes("\n")),
          { minLength: 0, maxLength: 20 },
        ),
        fc.option(fc.nat({ max: 50 }), { nil: undefined }),
        fc.option(fc.nat({ max: 50 }), { nil: undefined }),
        (files, ahead, behind) => {
          const header =
            ahead !== undefined || behind !== undefined
              ? `## main...origin/main${ahead !== undefined ? ` [ahead ${ahead}${behind !== undefined ? `, behind ${behind}` : ""}]` : ""}`
              : "## main";
          const porcelain = [header, ...files.map((f) => ` M ${f}`)].join("\n");
          const result = parseStatus(porcelain);
          expect(result.changed).toBeGreaterThanOrEqual(0);
          expect(result.ahead).toBeGreaterThanOrEqual(0);
          expect(result.behind).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("trim (light)", () => {
  test("result length <= max(keep, live count)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.oneof(
              fc.constant("running"),
              fc.constant("completed"),
              fc.constant("failed"),
            ),
            startedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
          }),
          { minLength: 0, maxLength: 100 },
        ),
        fc.integer({ min: 1, max: 50 }),
        (items, keep) => {
          const live = items.filter((i) => isLive(i.status)).length;
          expect(trim(items, keep).length).toBeLessThanOrEqual(
            Math.max(keep, live),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  test("live items are always preserved", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 5 }),
            status: fc.oneof(
              fc.constant("running"),
              fc.constant("pending"),
              fc.constant("waiting"),
              fc.constant("completed"),
              fc.constant("failed"),
            ),
            startedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        fc.integer({ min: 1, max: 50 }),
        (items, keep) => {
          const live = items.filter((i) => isLive(i.status));
          const trimmed = trim(items, keep);
          if (live.length <= keep) {
            for (const l of live) {
              expect(trimmed).toContain(l);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
