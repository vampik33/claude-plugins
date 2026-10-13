/**
 * Property tests for big-picture/hooks/core.ts.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  CHECK_EVERY,
  emptyActivity,
  extractHtml,
  hasTab,
  isCheckDue,
  logTool,
  mayBeBig,
  mergeActivity,
  parseJev,
  parseTabId,
  placeholderHtml,
  digest,
  type Message,
} from "../../plugins/big-picture/hooks/core.ts";

const call = fc.record({
  tool: fc.constantFrom("Read", "Edit", "Write", "Bash", "Agent", "Grep"),
  input: fc.record({
    file_path: fc.constantFrom("/a", "/b", "/c"),
    command: fc.string(),
    description: fc.string(),
  }),
});

describe("logTool", () => {
  test("tools counts every call; edits are distinct; lists stay bounded", () => {
    fc.assert(
      fc.property(fc.array(call, { maxLength: 80 }), (calls) => {
        const a = calls.reduce(
          (acc, c) => logTool(acc, c.tool, c.input),
          emptyActivity(""),
        );
        expect(a.tools).toBe(calls.length);
        expect(new Set(a.edits).size).toBe(a.edits.length);
        expect(a.commands.length).toBeLessThanOrEqual(30);
        for (const s of [...a.commands, ...a.agents])
          expect(s.length).toBeLessThanOrEqual(200);
        expect(mayBeBig(a)).toBe(
          calls.some((c) => c.tool === "Edit" || c.tool === "Write"),
        );
      }),
    );
  });

  test("a check is due exactly at multiples of CHECK_EVERY", () => {
    fc.assert(
      fc.property(fc.nat(200), (n) => {
        const a = { ...emptyActivity(""), tools: n };
        expect(isCheckDue(a)).toBe(n > 0 && n % CHECK_EVERY === 0);
      }),
    );
  });
});

describe("mergeActivity", () => {
  test("logging two runs apart and merging them equals logging them as one", () => {
    fc.assert(
      fc.property(fc.array(call, { maxLength: 40 }), fc.array(call, { maxLength: 40 }), (xs, ys) => {
        const log = (cs: typeof xs) =>
          cs.reduce((acc, c) => logTool(acc, c.tool, c.input), emptyActivity(""));
        expect(mergeActivity(log(xs), log(ys))).toEqual(log([...xs, ...ys]));
      }),
    );
  });
});

describe("parsers never throw", () => {
  test("parseJev: a probability in [0, 1] or undefined", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.json()),
        fc.constantFrom("big" as const, "update" as const),
        (s, name) => {
          const p = parseJev(s, name);
          if (p !== undefined) expect(p >= 0 && p <= 1).toBe(true);
        },
      ),
    );
  });

  test("parseTabId and hasTab", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), fc.string(), (s, id) => {
        const got = parseTabId(s);
        if (got !== undefined) expect(got.length).toBeGreaterThan(0);
        expect(typeof hasTab(s, id)).toBe("boolean");
      }),
    );
  });
});

describe("extractHtml", () => {
  test("finds a page wrapped in any prose", () => {
    const prose = fc
      .string()
      .filter((s) => !/<html|<\/html>|<!doctype/i.test(s));
    fc.assert(
      fc.property(prose, prose, fc.string(), (before, after, body) => {
        fc.pre(!/<\/html>/i.test(body));
        const page = `<!doctype html><html>${body}</html>`;
        expect(extractHtml(`${before}${page}${after}`)).toBe(page);
      }),
    );
  });
});

describe("placeholderHtml", () => {
  test("no tag of the text survives", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const body = placeholderHtml(s).split("<p>")[1]!.split("</p>")[0]!;
        expect(body).not.toMatch(/[<>"]/);
      }),
    );
  });
});

describe("digest", () => {
  const message: fc.Arbitrary<Message> = fc.record({
    role: fc.constantFrom("user" as const, "assistant" as const),
    text: fc.string(),
    toolUses: fc.array(
      fc.record({
        tool: fc.constantFrom("Edit", "Bash", "Read"),
        input: fc.record({ file_path: fc.string() }),
      }),
      { maxLength: 3 },
    ),
  });

  test("never over max, and the newest line kept whenever it fits", () => {
    fc.assert(
      fc.property(
        fc.array(message, { maxLength: 30 }),
        fc.nat(2000),
        (ms, max) => {
          const all = digest(ms, Number.MAX_SAFE_INTEGER).split("\n");
          const d = digest(ms, max);
          expect(d.length).toBeLessThanOrEqual(max);
          if (d !== "")
            expect(all.slice(-d.split("\n").length)).toEqual(d.split("\n"));
        },
      ),
    );
  });
});
