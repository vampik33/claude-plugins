/**
 * The band above the prompt in any combination of mods: hooks/stack.ts is
 * copied into every mod that draws there; the copies must match, and folding
 * any subset of the mods' hooks in any nesting order must give one column with
 * one blank row above it, none between rows, and the same order every time:
 * the top rows, what the engine drew, the middle rows by key, the bottom rows.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fc from "fast-check";

import { STACK, stackRows } from "../../plugins/memory-watch/hooks/stack.ts";

const MODS = [
  "big-picture",
  "codex-review",
  "continuity",
  "fleet",
  "memory-watch",
  "ship",
  "watchdog",
] as const;

// the key each mod gives its row (only the prefix matters to the stack)
const ROW_KEY: Record<(typeof MODS)[number], string> = {
  "big-picture": "band:30-big-picture",
  "codex-review": "band:60-codex",
  continuity: "band-bottom:continuity",
  fleet: "band:70-fleet",
  "memory-watch": "band:20-memory-watch",
  ship: "band:40-ship",
  watchdog: "band:50-watchdog",
};

type El = { type: string; props: Record<string, unknown>; children: unknown[] };
const el = (
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): El => ({
  type,
  props,
  children,
});

// what the engine hands the innermost hook
const bases: Record<string, unknown> = {
  null: null,
  undefined: undefined,
  "empty Box": el("Box", {}),
  tip: el("Text", {}, "Heads up"),
};

/** The engine's fold: the first hook outermost, each one drawing over `next`. */
function fold(order: readonly (typeof MODS)[number][], base: unknown): unknown {
  const at = (i: number): unknown => {
    if (i === order.length) return base;
    const below = at(i + 1);
    const row = el("Box", { key: ROW_KEY[order[i]] }, order[i]);
    return el(
      "Box",
      { key: STACK, flexDirection: "column", marginTop: 1 },
      ...stackRows(below, row),
    );
  };
  return at(0);
}

const margins = (n: unknown): number => {
  if (!n || typeof n !== "object") return 0;
  const e = n as El;
  return (
    (e.props?.marginTop ? 1 : 0) +
    (e.children ?? []).reduce((s: number, c) => s + margins(c), 0)
  );
};
const stacks = (n: unknown): number => {
  if (!n || typeof n !== "object") return 0;
  const e = n as El;
  return (
    (e.props?.key === STACK ? 1 : 0) +
    (e.children ?? []).reduce((s: number, c) => s + stacks(c), 0)
  );
};

describe("band stack", () => {
  test("every mod's copy of hooks/stack.ts is the same file", () => {
    const read = (m: string) =>
      readFileSync(
        new URL(`../../plugins/${m}/hooks/stack.ts`, import.meta.url),
        "utf8",
      );
    const memory = read("memory-watch");
    for (const m of MODS) expect(read(m)).toBe(memory);
  });

  test("any subset in any order: one column, one blank row, top first, bottom last", () => {
    const subset = fc
      .subarray([...MODS], { minLength: 1 })
      .chain((mods) =>
        fc.shuffledSubarray(mods, {
          minLength: mods.length,
          maxLength: mods.length,
        }),
      );
    fc.assert(
      fc.property(
        subset,
        fc.constantFrom(...Object.keys(bases)),
        (order, baseName) => {
          const base = bases[baseName];
          const out = fold(order, base) as El;
          expect(out.props.key).toBe(STACK);
          expect(stacks(out)).toBe(1);
          expect(margins(out)).toBe(1);
          const keys = out.children.map((c) =>
            String((c as El).props?.key ?? "base"),
          );
          const tip = baseName === "tip" ? 1 : 0;
          expect(keys.length).toBe(order.length + tip);
          // the same rows in the same order, whatever the nesting
          const has = (m: (typeof MODS)[number]) => order.includes(m);
          expect(keys).toEqual([
            ...(tip ? ["base"] : []),
            ...order
              .map((m) => ROW_KEY[m])
              .filter((k) => k.startsWith("band:"))
              .sort(),
            ...(has("continuity") ? ["band-bottom:continuity"] : []),
          ]);
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("all of them, any nesting: memory, summary, ship, watchdog, codex, fleet, ctx", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...MODS], { minLength: MODS.length, maxLength: MODS.length }),
        (order) => {
          const out = fold(order, null) as El;
          expect(out.children.map((c) => (c as El).children[0])).toEqual([
            "memory-watch",
            "big-picture",
            "ship",
            "watchdog",
            "codex-review",
            "fleet",
            "continuity",
          ]);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("the middle rows sort by key between the pinned ones", () => {
    const out = fold(
      ["big-picture", "continuity", "fleet", "codex-review", "memory-watch"],
      null,
    ) as El;
    expect(out.children.map((c) => (c as El).props.key)).toEqual([
      "band:20-memory-watch",
      "band:30-big-picture",
      "band:60-codex",
      "band:70-fleet",
      "band-bottom:continuity",
    ]);
  });

  test("what is not a column is kept whole, as one row; an empty Box is nothing", () => {
    const row = el("Box", { key: "band:20-memory-watch" });
    expect(stackRows(null, row)).toEqual([row]);
    expect(stackRows(el("Box", {}), row)).toEqual([row]);
    const tip = el("Text", {}, "Heads up");
    expect(stackRows(tip, row)).toEqual([tip, row]);
    const other = el("Box", { key: "someone-else", marginTop: 1 }, tip);
    expect(stackRows(other, row)).toEqual([other, row]);
  });
});
