/**
 * Property tests for palette/hooks/core.ts usage functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  mostUsed,
  recordUse,
  REPEAT_MS,
  useKey,
} from "../../plugins/palette/hooks/core.ts";
import type { PaletteGroup, Usage } from "../../plugins/palette/types";

const name = fc.constantFrom("a", "b", "c", "x:a", "x:b", "think");
const kind = fc.constantFrom("agent" as const, "command" as const);
const groups: fc.Arbitrary<PaletteGroup[]> = fc.array(
  fc.record({
    id: fc.string(),
    title: fc.string(),
    items: fc.array(fc.record({ kind, name, description: fc.string() })),
  }),
);
const usage: fc.Arbitrary<Usage> = fc.dictionary(
  fc.tuple(kind, name).map(([k, n]) => `${k}:${n}`),
  fc.record({ count: fc.nat(100), last: fc.nat(1_000_000) }),
);

describe("recordUse", () => {
  test("adds one use, or none within REPEAT_MS of the last", () => {
    fc.assert(
      fc.property(usage, name, fc.nat(2_000_000), (u, n, now) => {
        const key = `command:${n}`;
        const was = u[key];
        const next = recordUse(u, key, now);
        if (was && now - was.last < REPEAT_MS) expect(next).toBe(u);
        else
          expect(next[key]).toEqual({ count: (was?.count ?? 0) + 1, last: now });
      }),
    );
  });
});

describe("mostUsed", () => {
  test("at most n distinct listed items with a use, most first", () => {
    fc.assert(
      fc.property(groups, usage, fc.integer({ min: 1, max: 12 }), (g, u, n) => {
        const items = mostUsed(g, u, n)?.items ?? [];
        const listed = new Set(g.flatMap((x) => x.items.map(useKey)));
        const keys = items.map(useKey);
        expect(items.length).toBeLessThanOrEqual(n);
        expect(new Set(keys).size).toBe(keys.length);
        for (const k of keys) {
          expect(listed.has(k)).toBe(true);
          expect(u[k]).toBeDefined();
        }
        const counts = keys.map((k) => u[k]!.count);
        expect(counts).toEqual([...counts].sort((a, b) => b - a));
        const used = [...listed].filter((k) => u[k]).length;
        expect(items.length).toBe(Math.min(n, used));
      }),
    );
  });
});
