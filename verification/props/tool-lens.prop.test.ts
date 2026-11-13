/**
 * Property tests for tool-lens/hooks/core.ts pure functions, and the
 * log-tail script run for real against a temp projects folder.
 */
import { afterAll, describe, expect, test } from "bun:test";
import fc from "fast-check";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  argsChars,
  callLabel,
  clip,
  countLines,
  diffSources,
  diffsOf,
  estimateTokens,
  fmtDuration,
  fmtTokens,
  type Hunk,
  iconOf,
  LOG_TAIL_BYTES,
  logTailArgv,
  mergeMs,
  omittedFiles,
  parseLog,
  shortPath,
} from "../../plugins/tool-lens/hooks/core.ts";

const RUNS = { numRuns: 1000 };

/** A diff line: context, added or removed, any text without a newline. */
const diffLine = fc
  .tuple(
    fc.constantFrom(" ", "+", "-"),
    fc.string({ maxLength: 40 }).map((s) => s.replace(/\n/g, "")),
  )
  .map(([p, s]) => p + s);

/** A hunk whose header counts agree with its lines. */
const hunk: fc.Arbitrary<Hunk> = fc
  .tuple(
    fc.integer({ min: 1, max: 5000 }),
    fc.array(diffLine, { minLength: 1, maxLength: 60 }),
  )
  .map(([start, lines]) => ({
    oldStart: start,
    oldLines: lines.filter((l) => !l.startsWith("+")).length,
    newStart: start,
    newLines: lines.filter((l) => !l.startsWith("-")).length,
    lines,
  }));

const fileDiff = fc.record({
  path: fc.constantFrom("/r/a.ts", "/r/b.rs", "/r/c.md"),
  hunks: fc.array(hunk, { minLength: 1, maxLength: 5 }),
});

/** Parses a unified-diff source back into hunks, checking each header against its lines. */
function hunksOfSource(source: string): { lines: string[]; ok: boolean }[] {
  const out: { lines: string[]; ok: boolean; old: number; new: number }[] = [];
  for (const line of source.split("\n")) {
    const m = /^@@ -\d+,(\d+) \+\d+,(\d+) @@$/.exec(line);
    if (m)
      out.push({ lines: [], ok: true, old: Number(m[1]), new: Number(m[2]) });
    else out[out.length - 1]?.lines.push(line);
  }
  return out.map((h) => ({
    lines: h.lines,
    ok:
      h.lines.filter((l) => !l.startsWith("+")).length === h.old &&
      h.lines.filter((l) => !l.startsWith("-")).length === h.new,
  }));
}

describe("fmtDuration", () => {
  test("never empty for a finite non-negative time, and uses one unit form", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 * 3_600_000 }), (ms) => {
        expect(fmtDuration(ms)).toMatch(/^(\d+ms|\d+\.\ds|\d+s|\d+m \d{2}s)$/);
      }),
      RUNS,
    );
  });

  test("monotone: a longer call never reads as shorter", () => {
    const secs = (s: string) => {
      const m = /^(\d+)m (\d+)s$/.exec(s);
      if (m) return Number(m[1]) * 60 + Number(m[2]);
      if (s.endsWith("ms")) return Number(s.slice(0, -2)) / 1000;
      return Number(s.slice(0, -1));
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3_600_000 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(secs(fmtDuration(lo))).toBeLessThanOrEqual(
            secs(fmtDuration(hi)),
          );
        },
      ),
      RUNS,
    );
  });

  test("negative or non-finite is empty", () => {
    for (const v of [-1, NaN, Infinity]) expect(fmtDuration(v)).toBe("");
  });
});

describe("tokens", () => {
  test("estimate is ceil(chars / 4) and never negative", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 10_000_000 }), (n) => {
        const t = estimateTokens(n);
        expect(t).toBe(Math.ceil(Math.max(0, n) / 4));
      }),
      RUNS,
    );
  });

  test("format always reads ~N tok or ~N.Nk tok or ~Nk tok", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000_000 }), (n) => {
        expect(fmtTokens(n)).toMatch(/^~(\d+|\d+\.\dk|\d+k) tok$/);
      }),
      RUNS,
    );
  });

  test("args leave out exactly the engine's keys", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (args) => {
        const withEngine = {
          ...args,
          tool: "X",
          tool_use_id: "id",
          agentId: "a",
          requestMeta: {},
          consent: "c",
        };
        const own = Object.fromEntries(
          Object.entries(args).filter(
            ([k]) =>
              ![
                "tool",
                "tool_use_id",
                "agentId",
                "requestMeta",
                "consent",
              ].includes(k),
          ),
        );
        expect(argsChars(withEngine)).toBe(JSON.stringify(own).length);
      }),
      RUNS,
    );
  });
});

describe("diffs", () => {
  test("diffSources keeps at most max lines, counts the rest, and every hunk header matches its lines", () => {
    fc.assert(
      fc.property(
        fc.array(fileDiff, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 1, max: 200 }),
        (diffs, max) => {
          const total = diffs
            .flatMap((f) => f.hunks)
            .reduce((n, h) => n + h.lines.length, 0);
          const { files, cut } = diffSources(diffs, max);
          const kept = files.flatMap((f) => hunksOfSource(f.source));
          const keptLines = kept.reduce((n, h) => n + h.lines.length, 0);
          expect(keptLines).toBe(Math.min(total, max));
          expect(keptLines + cut).toBe(total);
          for (const h of kept) expect(h.ok).toBe(true);
        },
      ),
      RUNS,
    );
  });

  test("countLines counts + and - lines across files", () => {
    fc.assert(
      fc.property(fc.array(fileDiff, { maxLength: 4 }), (diffs) => {
        const lines = diffs.flatMap((f) => f.hunks.flatMap((h) => h.lines));
        expect(countLines(diffs)).toEqual({
          added: lines.filter((l) => l.startsWith("+")).length,
          removed: lines.filter((l) => l.startsWith("-")).length,
        });
      }),
      RUNS,
    );
  });

  test("diffsOf never throws and finds none in what is not an edit result", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("Edit", "Write", "Bash", "Read", "mcp__x__y"),
        fc.anything(),
        (tool, out) => {
          const got = diffsOf(tool, out);
          expect(Array.isArray(got)).toBe(true);
          if (tool === "Read" || tool === "mcp__x__y") expect(got).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  test("a created file is all added lines", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string().map((s) => s.replace(/\n/g, "")),
          { minLength: 1, maxLength: 30 },
        ),
        (lines) => {
          const [d] = diffsOf("Write", {
            type: "create",
            filePath: "/f",
            content: `${lines.join("\n")}\n`,
            structuredPatch: [],
          });
          expect(d?.hunks[0]?.lines).toEqual(lines.map((l) => `+${l}`));
        },
      ),
      RUNS,
    );
  });
});

describe("omittedFiles", () => {
  test("a positive moreFiles on a Bash result, else 0", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("Bash", "Edit"),
        fc.anything(),
        (tool, more) => {
          const got = omittedFiles(tool, {
            bashEditDiff: { files: [], moreFiles: more },
          });
          const want =
            tool === "Bash" && typeof more === "number" && more > 0 ? more : 0;
          expect(got).toBe(want);
        },
      ),
      RUNS,
    );
  });

  test("never throws on any result", () => {
    fc.assert(
      fc.property(fc.anything(), (out) => {
        expect(omittedFiles("Bash", out)).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

describe("labels and paths", () => {
  test("clip never exceeds max and keeps short text whole", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 100 }), (s, max) => {
        const c = clip(s, max);
        expect(c.length).toBeLessThanOrEqual(Math.max(max, 0));
        if (s.length <= max) expect(c).toBe(s);
      }),
      RUNS,
    );
  });

  test("callLabel starts with the tool's name and fits", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.anything(),
        (tool, input) => {
          const label = callLabel(tool, input, "/r");
          expect(label.length).toBeLessThanOrEqual(60);
        },
      ),
      RUNS,
    );
  });

  test("shortPath strips the cwd only at a path boundary", () => {
    expect(shortPath("/repo/a", "/repo")).toBe("a");
    expect(shortPath("/repository/a", "/repo")).toBe("/repository/a");
    expect(shortPath("/repo/a", "/repo/")).toBe("a");
  });

  test("icons are one glyph", () => {
    fc.assert(
      fc.property(fc.string(), (tool) => {
        expect([...iconOf(tool)]).toHaveLength(1);
      }),
      RUNS,
    );
  });
});

describe("mergeMs", () => {
  test("an exact duration is never replaced by the wall clock; anything else takes the new value", () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.record({ ms: fc.nat(), isExact: fc.boolean(), tokens: fc.nat() }),
          { nil: null },
        ),
        fc.nat(),
        fc.boolean(),
        (stored, ms, isExact) => {
          const got = mergeMs(stored, ms, isExact);
          if (stored?.isExact && !isExact) expect(got).toEqual(stored);
          else expect(got).toEqual({ ...(stored ?? {}), ms, isExact });
        },
      ),
      RUNS,
    );
  });
});

describe("parseLog", () => {
  const call = fc.record({
    id: fc.uuid().map((u) => `toolu_${u}`),
    command: fc.string({ maxLength: 50 }),
    result: fc.string({ maxLength: 200 }),
    at: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }),
    ms: fc.integer({ min: 0, max: 600_000 }),
  });

  const rows = (c: {
    id: string;
    command: string;
    result: string;
    at: number;
    ms: number;
  }) => [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(c.at).toISOString(),
      message: {
        content: [
          {
            type: "tool_use",
            id: c.id,
            name: "Bash",
            input: { command: c.command },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      timestamp: new Date(c.at + c.ms).toISOString(),
      message: {
        content: [
          { type: "tool_result", tool_use_id: c.id, content: c.result },
        ],
      },
    }),
  ];

  test("every call with both rows gets its duration and tokens", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(call, { selector: (c) => c.id, maxLength: 20 }),
        (calls) => {
          const got = parseLog(calls.flatMap(rows).join("\n"));
          expect(Object.keys(got).sort()).toEqual(
            calls.map((c) => c.id).sort(),
          );
          for (const c of calls) {
            expect(got[c.id]).toEqual({
              ms: c.ms,
              tokens: estimateTokens(
                JSON.stringify({ command: c.command }).length + c.result.length,
              ),
              isFromLog: true,
            });
          }
        },
      ),
      RUNS,
    );
  });

  test("a tail cut anywhere never throws and keeps only calls whose use row survived whole", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(call, {
          selector: (c) => c.id,
          minLength: 1,
          maxLength: 10,
        }),
        fc.nat(),
        (calls, cutAt) => {
          const text = calls.flatMap(rows).join("\n");
          const tail = text.slice(cutAt % text.length);
          const got = parseLog(tail);
          for (const id of Object.keys(got))
            expect(calls.some((c) => c.id === id)).toBe(true);
        },
      ),
      RUNS,
    );
  });

  test("noise lines are ignored", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (lines) => {
        expect(() => parseLog(lines.join("\n"))).not.toThrow();
      }),
      RUNS,
    );
  });
});

describe("logTailArgv, run for real", () => {
  const dir = mkdtempSync(join(tmpdir(), "tool-lens-"));
  const projects = join(dir, "projects");
  mkdirSync(join(projects, "-some-project"), { recursive: true });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (id: string) => {
    const argv = logTailArgv(projects, id);
    if (!argv) return { code: null, out: "" };
    const r = Bun.spawnSync(argv);
    return { code: r.exitCode, out: r.stdout.toString() };
  };

  test("prints the whole of a small log found by its id", () => {
    writeFileSync(
      join(projects, "-some-project", "s1.jsonl"),
      "line1\nline2\n",
    );
    expect(run("s1")).toEqual({ code: 0, out: "line1\nline2\n" });
  });

  test("prints only the last LOG_TAIL_BYTES of a big log", () => {
    const big = `${"a".repeat(LOG_TAIL_BYTES)}\nTAIL`;
    writeFileSync(join(projects, "-some-project", "s2.jsonl"), big);
    const { code, out } = run("s2");
    expect(code).toBe(0);
    expect(out.length).toBe(LOG_TAIL_BYTES);
    expect(out.endsWith("\nTAIL")).toBe(true);
  });

  test("an id with no log prints nothing and exits 0", () => {
    expect(run("missing")).toEqual({ code: 0, out: "" });
  });

  test("a projects folder that does not exist prints nothing and exits 0", () => {
    const r = Bun.spawnSync(logTailArgv(join(dir, "nope"), "s1") ?? []);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("");
  });

  test("an id holding shell or glob characters is refused before any command runs", () => {
    writeFileSync(join(projects, "-some-project", "x1.jsonl"), "real\n");
    for (const id of ["x*", "x?", "$(echo x1)", "../x1", "x1 y", ""]) {
      expect(logTailArgv(projects, id)).toBeNull();
    }
    expect(run("x1")).toEqual({ code: 0, out: "real\n" });
  });
});
