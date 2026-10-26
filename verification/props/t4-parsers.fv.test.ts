/**
 * formal-verify T4: fleet, continuity and prompt-clock functions the Lean models leave out.
 * Spec answers in .formal-verify/targets.md § T4. Guarantee ceiling: EXPLORED.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  lastLine as fleetLastLine,
  parseProgress,
  nextProgress,
  etaMs,
  parseStatus,
  parseWorktrees,
  shellName,
  shellNotes,
} from "../../plugins/fleet/hooks/core.ts";
import { lastLine as watchdogLastLine } from "../../plugins/watchdog/hooks/core.ts";
import {
  blockingLimit,
  buildNote,
  compactInstructions,
  lastCheck,
  openTodos,
} from "../../plugins/continuity/hooks/core.ts";
import {
  KEEP,
  parseTranscript,
  promptText,
} from "../../plugins/prompt-clock/hooks/core.ts";

const SEED = Number(process.env.FV_SEED ?? 20261026);
const RUNS = Number(process.env.FV_RUNS ?? 300);
const opts = (o: fc.Parameters<any> = {}) => ({
  seed: SEED,
  numRuns: RUNS,
  ...o,
});
const str = (max = 4096) => fc.string({ unit: "binary", maxLength: max });

describe("P1 lastLine (fleet and watchdog)", () => {
  const tail = fc
    .array(
      fc.oneof(
        fc.constantFrom(
          "\x1b[31m",
          "\x1b]0;title\x07",
          "\x1b]8;;http://x\x1b\\",
          "\x1b",
          "\x1bc",
          "\x9b31m",
          "\r",
          "\n",
          "\r\n",
          "\x00",
          "\x7f",
          "\x85",
          "47%",
          " ",
          "done",
        ),
        str(20),
      ),
      { maxLength: 40 },
    )
    .map((a) => a.join(""));
  // P1 (Q5: "the result contains no ESC or other control character")
  // mutant: fleet core.ts:268 CONTROLS `[\x00-\x1f\x7f-\x9f]` -> `[\x00-\x1f]`   input: examples[0]
  for (const [name, lastLine] of [
    ["fleet", fleetLastLine],
    ["watchdog", watchdogLastLine],
  ] as const)
    test(`${name}: no control character reaches the screen`, () => {
      fc.assert(
        fc.property(tail, (t) => {
          const l = lastLine(t);
          if (l === undefined) return;
          expect(l).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
          expect(l.trim()).toBe(l);
          expect(l.length).toBeGreaterThan(0);
        }),
        opts({ numRuns: RUNS * 3, examples: [["a\x85b"]] }),
      );
    });
});

describe("P1 lastLine, content", () => {
  // P1b (user D1a, 2026-10-26: "lastLine returns the real last line"): on a tail with no escape
  // or control character but line breaks, the answer is its last non-blank line, trimmed
  // mutant: fleet core.ts:280 `.at(-1)` -> `.at(0)`   input: examples[0]
  const line = fc.string({ unit: "grapheme", maxLength: 20 }).map((t) => t.replace(/[\x00-\x1f\x7f-\x9f]/g, ""));
  for (const [name, lastLine] of [["fleet", fleetLastLine], ["watchdog", watchdogLastLine]] as const)
    test(`${name}: the last non-blank line`, () => {
      fc.assert(
        fc.property(fc.array(fc.tuple(line, fc.constantFrom("\n", "\r\n", "\r")), { maxLength: 10 }), (ls) => {
          const tail = ls.map(([l, br]) => l + br).join("");
          expect(lastLine(tail)).toBe(ls.map(([l]) => l.trim()).filter(Boolean).at(-1));
        }),
        opts({ numRuns: RUNS * 3, examples: [[[["first", "\n"], ["last", "\n"]]]] }),
      );
    });
});

describe("P2 parseProgress", () => {
  type Tok = { s: string; pct?: number; count?: [number, number] };
  const tok: fc.Arbitrary<Tok> = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 0, max: 1000 }),
        fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }),
        fc.constantFrom("", " "),
      )
      .map(([n, d, sp]) => {
        const s = d === undefined ? `${n}` : `${n}.${d}`;
        return { s: `${s}${sp}%`, pct: Number(s) };
      }),
    fc
      .tuple(fc.nat(500), fc.nat(500), fc.constantFrom("/", " / "))
      .map(([a, b, sep]) => ({
        s: `${a}${sep}${b}`,
        count: [a, b] as [number, number],
      })),
    fc
      .tuple(
        fc.integer({ min: 1990, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      )
      .map(([y, m, d]) => ({ s: `${y}/${String(m).padStart(2, "0")}/${d}` })),
    fc
      .tuple(fc.constantFrom("src", "a", "v1.2"), fc.nat(99), fc.nat(99))
      .map(([p, a, b]) => ({ s: `${p}/${a}/${b}` })),
    fc
      .constantFrom("month", "epoch", "loss", "eta", "-", "x")
      .map((s) => ({ s })),
  );
  // P2 (Q5: "always in [0, 1]; dates and paths are never read as a fraction; x% with x <= 100
  //     reads back as x/100"): the first percent at most 100, else the first count, else none
  // mutant: fleet core.ts:289 `Number(pct[1]) <= 100` -> `true`   input: examples[0] "150%"
  // mutant: fleet core.ts:290 `(?<![\d./-])` -> ``   input: examples[1] "2026/10/12"
  test("a reading only from a percent at most 100 or a standalone count", () => {
    fc.assert(
      fc.property(fc.array(tok, { maxLength: 6 }), (ts) => {
        const line = ts.map((t) => t.s).join(" ");
        const got = parseProgress(line);
        if (got !== undefined) {
          expect(got).toBeGreaterThanOrEqual(0);
          expect(got).toBeLessThanOrEqual(1);
        }
        const pct = ts.find((t) => t.pct !== undefined);
        if (pct && pct.pct! <= 100) {
          expect(got).toBeCloseTo(pct.pct! / 100, 12);
          return;
        }
        if (pct) return; // a first percent over 100: what follows is not stated (Q5)
        const c = ts.find(
          (t) => t.count && t.count[1] >= 2 && t.count[0] <= t.count[1],
        );
        expect(got).toBe(c ? c.count![0] / c.count![1] : undefined);
      }),
      opts({
        numRuns: RUNS * 5,
        examples: [[[{ s: "150%", pct: 150 }]], [[{ s: "2026/10/12" }]], [[{ s: "100%", pct: 100 }]], [[{ s: "1/2", count: [1, 2] }]]],
      }),
    );
  });

  // P2 (same answer): a lone percent over 100 is no reading
  // mutant: as the first above   input: examples[0]
  test("a percent over 100 alone is no reading", () => {
    fc.assert(
      fc.property(fc.integer({ min: 101, max: 100_000 }), fc.option(fc.nat(9), { nil: undefined }), (n, d) => {
        expect(parseProgress(d === undefined ? `${n}%` : `${n}.${d}%`)).toBeUndefined();
      }),
      opts({ examples: [[1000, undefined], [1000, 5]] }),
    );
  });

  // P2 (totality across the progress helpers; Q4 undefined is normal)
  test("nextProgress / etaMs never throw and stay in range", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
            nil: undefined,
          }),
          { maxLength: 20 },
        ),
        (fs) => {
          let p: ReturnType<typeof nextProgress>;
          fs.forEach((f, i) => {
            p = nextProgress(p, f, i * 10_000);
            if (p) {
              const e = etaMs(p, i * 10_000);
              if (e !== undefined) expect(e).toBeGreaterThanOrEqual(0);
            }
          });
        },
      ),
      opts(),
    );
  });
});

describe("P4 git porcelain", () => {
  // paths that hold the porcelain's own keywords, so an unanchored pattern misreads them
  const path = fc.oneof(
    fc.stringMatching(/^\/[a-z0-9 ._-]{1,20}(\/[a-z0-9 ._-]{1,10}){0,2}$/),
    fc.constantFrom("/x/bare", "/bare", "/HEAD abcdef0", "/x/branch refs/heads/y", "/worktree a", "/a\tb"),
  );
  const tree = fc.record({
    path,
    kind: fc.constantFrom("branch", "detached", "bare"),
    branch: fc.stringMatching(/^[a-z0-9][a-z0-9._/-]{0,20}$/),
    head: fc.stringMatching(/^[0-9a-f]{40}$/),
  });
  // P4 (Q5: "checked against round-trip models of git output")
  // mutant: fleet core.ts:235 `if (!path || /^bare$/m.test(block)) continue;` -> `if (!path) continue;`   input: examples[0]
  test("parseWorktrees reads back each non-bare tree", () => {
    fc.assert(
      fc.property(fc.array(tree, { maxLength: 8 }), (ts) => {
        const out = ts
          .map((t) =>
            [
              `worktree ${t.path}`,
              ...(t.kind === "bare"
                ? ["bare"]
                : [
                    `HEAD ${t.head}`,
                    t.kind === "branch"
                      ? `branch refs/heads/${t.branch}`
                      : "detached",
                  ]),
            ].join("\n"),
          )
          .join("\n\n");
        expect(parseWorktrees(out ? `${out}\n` : "")).toEqual(
          ts
            .filter((t) => t.kind !== "bare")
            .map((t) => ({
              path: t.path,
              name: t.kind === "branch" ? t.branch : `(${t.head.slice(0, 7)})`,
            })),
        );
      }),
      opts({
        examples: [
          [[{ path: "/a", kind: "bare", branch: "x", head: "0".repeat(40) }]],
        ],
      }),
    );
  });

  // P4 (same answer)
  // mutant: fleet core.ts:252 `/behind (\d+)/` -> `/behind (\d)/`   input: examples[0] behind 12
  test("parseStatus reads back the changed count and ahead/behind", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[ MADRCU?!]{2} [a-z0-9 ._/-]{1,20}$/), {
          maxLength: 30,
        }),
        fc.nat(500),
        fc.nat(500),
        fc.constantFrom(
          "main...origin/main",
          "No commits yet on main",
          "HEAD (no branch)",
          "feat",
        ),
        (files, ahead, behind, br) => {
          const ab = [
            ahead ? `ahead ${ahead}` : "",
            behind ? `behind ${behind}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          const head = `## ${br}${ab ? ` [${ab}]` : ""}`;
          expect(parseStatus([head, ...files].join("\n") + "\n")).toEqual({
            changed: files.length,
            ahead,
            behind,
          });
        },
      ),
      opts({ examples: [[[], 0, 12, "main...origin/main"], [[], 3, 0, "main...origin/main"], [[], 0, 0, "feat"]] }),
    );
  });
});

describe("fleet words (Q1, totality only: no Q5 property named)", () => {
  test("shellName and shellNotes never throw", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            command: str(200),
            stalled: fc.boolean(),
            waiter: fc.boolean(),
            frac: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
              nil: undefined,
            }),
          }),
          { maxLength: 10 },
        ),
        (ss) => {
          for (const s of ss)
            expect(typeof shellName(s.command)).toBe("string");
          const shells = ss.map((s, i) => ({
            id: `s${i}`,
            command: s.command,
            startedAt: 0,
            status: "running",
            stalled: s.stalled,
            waiter: s.waiter,
            ...(s.frac === undefined
              ? {}
              : { progress: { frac: s.frac, firstAt: 0, firstFrac: 0 } }),
          }));
          expect(Array.isArray(shellNotes(shells as any, 60_000))).toBe(true);
        },
      ),
      opts(),
    );
  });
});

describe("P5 blockingLimit", () => {
  const NOW = Date.UTC(2026, 9, 26, 12);
  // P5 (Q5: "the latest reset among limits at >= 100 % that reset in the future; undefined when
  //     there are none")
  // mutant: continuity core.ts:260 `>= 100` -> `> 100`   input: examples[0]
  // mutant: continuity core.ts:263 `b.resetsAt - a.resetsAt` -> `a.resetsAt - b.resetsAt`   input: two blocking limits
  test("the latest future reset of an exceeded window", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom("five_hour", "seven_day", "spend_limit"),
            percentUsed: fc.oneof(
              fc.constantFrom(99.9, 100, 100.1, 150),
              fc.integer({ min: 0, max: 200 }),
            ),
            resetsAt: fc.option(
              fc.oneof(
                fc
                  .integer({ min: -10 * 3_600_000, max: 10 * 3_600_000 })
                  .map((d) => new Date(NOW + d).toISOString()),
                fc.constantFrom("", "garbage"),
              ),
              { nil: undefined },
            ),
          }),
          { maxLength: 6 },
        ),
        (ls) => {
          const got = blockingLimit(ls as any, NOW);
          const blocking = ls
            .filter((l) => l.percentUsed >= 100 && l.resetsAt)
            .map((l) => ({ kind: l.kind, resetsAt: Date.parse(l.resetsAt!) }))
            .filter((l) => Number.isFinite(l.resetsAt) && l.resetsAt > NOW);
          if (blocking.length === 0) return expect(got).toBeUndefined();
          const latest = Math.max(...blocking.map((b) => b.resetsAt));
          expect(got?.resetsAt).toBe(latest);
          expect(
            blocking.some((b) => b.kind === got!.kind && b.resetsAt === latest),
          ).toBe(true);
        },
      ),
      opts({
        examples: [
          [
            [
              {
                kind: "five_hour",
                percentUsed: 100,
                resetsAt: new Date(NOW + 60_000).toISOString(),
              },
            ],
          ],
          // resets exactly now: no longer blocking
          [[{ kind: "five_hour", percentUsed: 100, resetsAt: new Date(NOW).toISOString() }]],
        ],
      }),
    );
  });
});

type Use = { tool: string; input: any; result?: any };
const todo = fc.record({
  status: fc.constantFrom("pending", "in_progress", "completed", "deleted"),
  content: str(30),
});
const uses = (junk: boolean): fc.Arbitrary<Use> => fc.oneof(
  fc
    .array(todo, { maxLength: 5 })
    .map((todos) => ({ tool: "TodoWrite", input: { todos } })),
  fc
    .tuple(fc.constantFrom("1", "2", "3"), str(20))
    .map(([id, subject]) => ({
      tool: "TaskCreate",
      input: { subject },
      result: { task: { id } },
    })),
  fc
    .tuple(
      fc.constantFrom("1", "2", "3", "9"),
      fc.option(
        fc.constantFrom("pending", "in_progress", "completed", "deleted"),
        { nil: undefined },
      ),
      fc.option(str(20), { nil: undefined }),
    )
    .map(([taskId, status, subject]) => ({
      tool: "TaskUpdate",
      input: {
        taskId,
        ...(status ? { status } : {}),
        ...(subject !== undefined ? { subject } : {}),
      },
    })),
  fc.constant({ tool: "Bash", input: { command: "ls" } }),
  // Q2: tool inputs are untrusted: a call the engine refused still sits in the transcript
  ...(junk ? [fc.jsonValue({ maxDepth: 2 }).map((todos) => ({ tool: "TodoWrite", input: { todos } }))] : []),
);
// the oracle, run over calls drawn from `use`
const openTodosProperty = (use: fc.Arbitrary<Use>) =>
  fc.property(
    fc.array(fc.array(use, { maxLength: 4 }), { maxLength: 10 }),
    (msgs) => {
      const messages = msgs.map((us) => ({
        role: "assistant",
        text: "",
        toolUses: us.map((u, i) => ({ tool_use_id: `u${i}`, ...u })),
      }));
      const got = openTodos(messages as any);
      let list: { status: string; text: string }[] = [];
      const tasks = new Map<string, { status: string; text: string }>();
      for (const u of msgs.flat()) {
        if (u.tool === "TodoWrite" && Array.isArray(u.input.todos))
          list = u.input.todos.map((t: any) => ({
            status: String(t?.status),
            text: String(t?.content),
          }));
        else if (u.tool === "TaskCreate")
          tasks.set(u.result.task.id, {
            status: "pending",
            text: u.input.subject,
          });
        else if (u.tool === "TaskUpdate" && tasks.has(u.input.taskId)) {
          const t = tasks.get(u.input.taskId)!;
          if (u.input.status) t.status = u.input.status;
          if (u.input.subject) t.text = u.input.subject;
        }
      }
      expect(got).toEqual(
        [...list, ...tasks.values()].filter(
          (t) => t.status !== "completed" && t.status !== "deleted",
        ),
      );
    },
  );

describe("P6 openTodos", () => {
  // P6 (Q5: "the latest TodoWrite list plus the tasks, in order, none completed or deleted";
  //     totality is Q4: "undefined results, skipped lines" are the normal outcomes)
  // mutant: continuity core.ts:117 `t.status !== "completed" &&` -> ``   input: examples[0]
  test("the latest list and the tasks, open ones only, in order", () => {
    fc.assert(
      openTodosProperty(uses(true)),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [
            [
              [
                {
                  tool: "TodoWrite",
                  input: { todos: [{ status: "completed", content: "x" }] },
                },
              ],
            ],
          ],
        ],
      }),
    );
  });
});

describe("P6 openTodos, schema-valid inputs", () => {
  // P6, the same rule on calls whose input holds to the tools' schemas (objects for to-dos): a
  // sub-case of the property above, kept so its checks still bite while that one is VIOLATED
  // mutant: continuity core.ts:111 `if (input.status)` -> `if (false)`   input: random
  test("schema-valid: the latest list and the tasks, open ones kept in order", () => {
    fc.assert(openTodosProperty(uses(false)), opts({ numRuns: RUNS * 3 }));
  });
});

describe("lastCheck (Q1; Q4 totality, and the last finished check-like call wins)", () => {
  const cmd = fc.constantFrom(
    "cargo test",
    "bun test x",
    "ls",
    "echo hi",
    "npm run test",
    "pytest -q",
    "git status",
    "cargo clippy",
    "tsc -p .",
    "npx jest",
    "echo cargo testx",
    "attest",
    "make test",
  );
  const IS_CHECK = new Set([
    "cargo test",
    "bun test x",
    "npm run test",
    "pytest -q",
    "cargo clippy",
    "tsc -p .",
    "npx jest",
    "make test",
  ]);
  // mutant: continuity core.ts:141 `if (u.text === undefined) continue;` -> ``   input: examples[0]
  test("answers the last finished check, its result and its tail", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(
            fc.record({
              command: cmd,
              text: fc.option(str(200), { nil: undefined }),
              isError: fc.boolean(),
            }),
            { maxLength: 3 },
          ),
          { maxLength: 8 },
        ),
        (msgs) => {
          const messages = msgs.map((us) => ({
            role: "assistant",
            text: "",
            toolUses: us.map((u, i) => ({
              tool_use_id: `u${i}`,
              tool: "Bash",
              input: { command: u.command },
              ...(u.text === undefined ? {} : { text: u.text }),
              ...(u.isError ? { isError: true } : {}),
            })),
          }));
          const got = lastCheck(messages as any);
          const last = msgs
            .flat()
            .filter((u) => IS_CHECK.has(u.command) && u.text !== undefined)
            .at(-1);
          if (!last) return expect(got).toBeUndefined();
          expect(got?.command).toBe(last.command);
          expect(got?.passed).toBe(!last.isError);
          expect(got?.tail).toBe(
            last.text!.trimEnd().split("\n").slice(-15).join("\n"),
          );
        },
      ),
      opts({
        examples: [
          [
            [
              [
                { command: "cargo test", text: "ok", isError: false },
                { command: "cargo test", text: undefined, isError: false },
              ],
            ],
          ],
        ],
      }),
    );
  });
});

describe("handover-note fence (Q1: the buildNote / compactInstructions fence; same rule as T3 P2)", () => {
  const fenceText = fc
    .array(
      fc.oneof(
        fc.constantFrom(
          "<",
          "</",
          "< /",
          "<\n/",
          "handover-note",
          "HANDOVER-NOTE",
          ">",
          " ",
          "\n",
          "x",
          "```",
        ),
        str(6),
      ),
      { maxLength: 30 },
    )
    .map((a) => a.join(""));
  const FENCE = /<\s*\/?\s*handover-note/gi;
  // P7 (Q1 named this fence; the rule is T3 P2's: "<, optional whitespace, optional /, then the
  //     tag name appears exactly twice")
  // mutant: continuity core.ts:230 `<\s*\/?\s*handover-note[^>]*>` -> `<\/?handover-note[^>]*>`   input: examples[0]
  test("quoted prompts, to-dos and command output never open or close the fence", () => {
    fc.assert(
      fc.property(fenceText, fenceText, fenceText, (prompt, todo, tail) => {
        const note = buildNote({
          repo: "r",
          sessionId: "s",
          at: 0,
          window: 200_000,
          lengthMs: 0,
          prompts: [prompt, prompt],
          where: { cwd: "/r", isWorktree: false },
          todos: [{ status: "pending", text: todo }],
          check: { command: "bun test", passed: false, tail },
        });
        const p = compactInstructions(note);
        const tags = [...p.matchAll(FENCE)];
        expect(tags.map((m) => m[0])).toEqual(["<handover-note", "</handover-note"]);
        expect(tags[0]!.index).toBe(p.indexOf("\n<handover-note>\n") + 1);
        expect(tags[1]!.index).toBe(p.lastIndexOf("\n</handover-note>\n") + 1);
      }),
      opts({ examples: [["< /handover-note>", "", ""]] }),
    );
  });
});

/** The typed text of a user row, from the transcript format (H7: not the code's promptText). */
function refPromptText(c: unknown): string | undefined {
  if (typeof c === "string") return c;
  if (!Array.isArray(c) || c.some((b) => b?.type === "tool_result")) return undefined;
  const t = c.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  return t === "" ? undefined : t;
}

function transcriptProperty(keys: string[]) {
  const ts = fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) });
  const key = fc.oneof(fc.constantFrom(...keys), str(30));
  const content = fc.oneof(
    key,
    fc.array(fc.oneof(key.map((text) => ({ type: "text", text })), fc.constant({ type: "image" })), { maxLength: 3 }),
    fc.constant([{ type: "tool_result", content: "x" }]),
  );
  const row = fc.oneof(
    fc.record({ type: fc.constant("user"), uuid: key, timestamp: ts.map((t) => new Date(t).toISOString()), isMeta: fc.boolean(), isSidechain: fc.boolean(), message: content.map((c) => ({ content: c })) }),
    fc.record({ type: fc.constant("system"), subtype: fc.constant("turn_duration"), durationMs: fc.nat(100_000), timestamp: ts.map((t) => new Date(t).toISOString()) }),
  );
  const line = fc.oneof({ weight: 6, arbitrary: row.map((r) => JSON.stringify(r)) }, { weight: 1, arbitrary: str(60) }, { weight: 1, arbitrary: fc.constant('{"timestamp": oops') });
  return fc.property(fc.array(line, { maxLength: 200 }), (ls) => {
    const got = parseTranscript(ls.join("\n"));
    const sent = new Map<string, number>();
    const byText = new Map<string, number>();
    const turns = new Map<string, number>();
    for (const l of ls) {
      let r: any;
      try {
        r = JSON.parse(l);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
      const at = Date.parse(r?.timestamp);
      if (!Number.isFinite(at)) continue;
      if (r.type === "system" && r.subtype === "turn_duration" && typeof r.durationMs === "number") turns.set(String(r.durationMs), at);
      else if (r.type === "user" && !r.isMeta && !r.isSidechain && typeof r.uuid === "string") {
        const text = refPromptText(r.message?.content);
        if (text === undefined) continue;
        sent.set(r.uuid, at);
        byText.set(text, at);
      }
    }
    for (const [m, rec] of [[sent, got.sent], [byText, got.byText], [turns, got.turns]] as const) {
      expect(Object.keys(rec).length).toBeLessThanOrEqual(KEEP);
      for (const [k, at] of m) {
        expect(Object.hasOwn(rec, k)).toBe(true);
        expect(rec[k]).toBe(at);
      }
      expect(Object.keys(rec).length).toBe(m.size);
    }
  });
}

describe("P3 parseTranscript, past the cap", () => {
  // P3 (Q5: "the result stays within the limits cap enforces"): more typed prompts than KEEP keep
  // exactly the newest KEEP (cap's docstring: "the newest win")
  // mutant: prompt-clock core.ts:70 `if (entries.length <= keep) return record;` -> `return record;`   input: any
  test("more than KEEP prompts keep the newest KEEP", () => {
    fc.assert(
      fc.property(fc.integer({ min: KEEP + 1, max: KEEP + 50 }), fc.nat(1_000), (n, shift) => {
        const base = Date.UTC(2026, 9, 26);
        const order = Array.from({ length: n }, (_, i) => (i * 7919 + shift) % n);
        const lines = order.map((k) => JSON.stringify({ type: "user", uuid: `u${k}`, timestamp: new Date(base + k * 1000).toISOString(), message: { content: `p${k}` } }));
        const got = parseTranscript(lines.join("\n"));
        const newest = new Set(Array.from({ length: KEEP }, (_, i) => `u${n - KEEP + i}`));
        expect(Object.keys(got.sent).length).toBe(KEEP);
        for (const k of Object.keys(got.sent)) expect(newest.has(k)).toBe(true);
        expect(Object.keys(got.byText).length).toBe(KEEP);
      }),
      opts({ numRuns: 20 }),
    );
  });
});

describe("P3 parseTranscript", () => {
  // P3 (Q5: "every typed prompt's text and uuid map to its timestamp, including keys like
  //     __proto__; never throws; the result stays within cap's limit"); turn ends by duration too
  // mutant: prompt-clock core.ts:119 `!row.isMeta &&` -> ``   input: a meta row
  test("each typed prompt's uuid and text map to its time, any key", () => {
    fc.assert(
      transcriptProperty(["__proto__", "constructor", "toString", "hasOwnProperty", "", "a"]),
      opts({ examples: [[[JSON.stringify({ type: "user", uuid: "__proto__", timestamp: "2026-10-26T00:00:00Z", message: { content: "__proto__" } })]]] }),
    );
  });

  // P3, the same checks with no "__proto__" key: a sub-case of the property above, kept so its
  // other checks still bite while that one is VIOLATED
  // mutant: prompt-clock core.ts:119 `!row.isMeta &&` -> ``   input: a meta row
  test("prompts other than __proto__: uuid and text map to their time", () => {
    fc.assert(transcriptProperty(["constructor", "toString", "hasOwnProperty", "", "a"]), opts());
  });
});
