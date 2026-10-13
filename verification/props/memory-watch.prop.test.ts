/**
 * Property tests for memory-watch/hooks/core.ts.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  addChange,
  countLines,
  memoryFile,
  headline,
  parseFrontmatter,
  title,
  toChange,
} from "../../plugins/memory-watch/hooks/core.ts";
import type { MemoryChange } from "../../plugins/memory-watch/types";

const segment = fc.stringMatching(/^[A-Za-z0-9_.-]{1,12}$/);
const line = fc.oneof(
  fc.string().map((s) => `+${s}`),
  fc.string().map((s) => `-${s}`),
  fc.string().map((s) => ` ${s}`),
);
const change: fc.Arbitrary<MemoryChange> = fc.record({
  at: fc.nat(),
  file: segment,
  action: fc.constantFrom("created" as const, "updated" as const),
  added: fc.nat(100),
  removed: fc.nat(100),
});

describe("memoryFile", () => {
  test("names the file directly under a project's memory dir", () => {
    fc.assert(
      fc.property(fc.array(segment), segment, segment, (pre, slug, name) => {
        const base = `/${pre.join("/")}/.claude/projects/${slug}/memory`;
        expect(memoryFile(`${base}/${name}.md`)).toBe(`${name}.md`);
        expect(memoryFile(`${base}/${name}/${name}.md`)).toBeUndefined();
      }),
    );
  });
});

describe("countLines", () => {
  test("added + removed = the patch's +/- lines, context ignored", () => {
    fc.assert(
      fc.property(fc.array(fc.array(line).map((lines) => ({ lines }))), (p) => {
        const all = p.flatMap((h) => h.lines);
        const { added, removed } = countLines(p);
        expect(added).toBe(all.filter((l) => l.startsWith("+")).length);
        expect(removed).toBe(all.filter((l) => l.startsWith("-")).length);
      }),
    );
  });
});

describe("parseFrontmatter", () => {
  test("never throws; yields only known, non-empty keys", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const fm = parseFrontmatter(`---\n${s}\n---\n`);
        for (const [k, v] of Object.entries(fm)) {
          expect(["name", "description", "type"]).toContain(k);
          expect(v).not.toBe("");
        }
      }),
    );
  });

  test("text not opening with --- has none", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        fc.pre(s.split(/\r?\n/)[0]?.trim() !== "---");
        expect(parseFrontmatter(s)).toEqual({});
      }),
    );
  });
});

describe("addChange", () => {
  test("the new one first, the rest in order, at most max", () => {
    fc.assert(
      fc.property(
        fc.array(change),
        change,
        fc.integer({ min: 1, max: 60 }),
        (l, c, max) => {
          const out = addChange(l, c, max);
          expect(out.length).toBe(Math.min(l.length + 1, max));
          expect(out[0]).toBe(c);
          expect(out.slice(1)).toEqual(l.slice(0, max - 1));
        },
      ),
    );
  });
});

describe("toChange", () => {
  test("counts the patch; a created file with none counts its lines", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(line).map((lines) => ({ lines }))),
        fc.constantFrom("created" as const, "updated" as const),
        // non-empty lines: an empty last one reads as the closing newline
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !/[\r\n]/.test(s)),
          { minLength: 1 },
        ),
        (p, action, lines) => {
          const c = toChange("x.md", action, lines.join("\n"), p, 0);
          if (p.length > 0 || action === "updated")
            expect([c.added, c.removed]).toEqual(Object.values(countLines(p)));
          else expect([c.added, c.removed]).toEqual([lines.length, 0]);
        },
      ),
    );
  });
});

describe("headline and title", () => {
  test("headline carries the action and counts; title is never empty", () => {
    fc.assert(
      fc.property(change, (c) => {
        expect(headline(c)).toContain(c.action);
        expect(headline(c)).toContain(`+${c.added} −${c.removed}`);
        expect(title(c).length).toBeGreaterThan(0);
      }),
    );
  });
});
