// The band above the prompt as one column: whatever order the engine nests the
// mods' AbovePrompt hooks in, and whichever of them draw, their lines share one
// Box with one blank row above it and none between them. A row keyed
// `band-top:<mod>` goes above the rest, `band-bottom:<mod>` under it and
// `band:<mod>` between, each group in key order, so the order never depends on
// the nesting; what the engine drew itself stays first among the middle rows.
//
// Copied as-is into every mod that draws in the band (each mod installs alone);
// verification/props/band-stack.prop.test.ts checks the copies match.

/** The key of the shared column: a hook that finds it below flattens it. */
export const STACK = "band-stack";

type Node = {
  type?: unknown;
  props?: { key?: unknown };
  children?: readonly unknown[];
};

const keyOf = (row: unknown): string => {
  const key = (row as Node | null | undefined)?.props?.key;
  return typeof key === "string" ? key : "";
};

/** Where a row sorts: its group (top, middle, bottom), then its key. */
const rank = (row: unknown): [number, string] => {
  const key = keyOf(row);
  if (key.startsWith("band-top:")) return [0, key];
  if (key.startsWith("band-bottom:")) return [2, key];
  return [1, key.startsWith("band:") ? key : ""];
};
const after = (a: unknown, b: unknown): boolean => {
  const [ga, ka] = rank(a);
  const [gb, kb] = rank(b);
  return ga !== gb ? ga > gb : ka > kb;
};

/**
 * The column's rows: what `next(e)` drew (the column's own rows when it is the
 * column, nothing when it is empty, else that tree as one row) with `row` put
 * before the first row that sorts after it.
 */
export function stackRows<T>(below: unknown, row: T): T[] {
  const b = below as Node | null | undefined;
  const rows: T[] =
    !b || typeof b !== "object"
      ? []
      : b.type === "Box" && keyOf(b) === STACK
        ? ([...(b.children ?? [])] as T[])
        : b.type === "Box" && (b.children ?? []).length === 0
          ? []
          : [b as T];
  const at = rows.findIndex((r) => after(r, row));
  if (at === -1) return [...rows, row];
  return [...rows.slice(0, at), row, ...rows.slice(at)];
}
