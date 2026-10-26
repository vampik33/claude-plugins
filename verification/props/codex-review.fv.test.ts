/**
 * formal-verify T3: codex-review's guards (plugins/codex-review/hooks/core.ts).
 * Spec answers in .formal-verify/targets.md § T3. Guarantee ceiling: EXPLORED.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { CxFinding, CxJob } from "../../plugins/codex-review/types";
import {
  buildPrompt,
  buildRawPrompt,
  companionJobId,
  isSafeRef,
  parseArgs,
  readOutcome,
  trimJobs,
} from "../../plugins/codex-review/hooks/core.ts";

const SEED = Number(process.env.FV_SEED ?? 20261026);
const RUNS = Number(process.env.FV_RUNS ?? 300);
const opts = (o: fc.Parameters<any> = {}) => ({ seed: SEED, numRuns: RUNS, ...o });

const str = (max = 2048) => fc.string({ unit: "binary", maxLength: max });

/** Characters a POSIX shell treats specially, plus bash's history, brace and caret. */
const SHELL_META = /[|&;<>()$`\\"'\s*?[\]#~=%!{}^]/;

describe("P1 isSafeRef", () => {
  const refish = fc
    .array(
      fc.oneof(
        fc.constantFrom("main", "feat", "/", ".", "-", "..", "_", "a", "0", "@", "+", ",", ":", "é", "ẞ", "~", " ", "\t", "\n", ";", "$(x)", "`", "'", "\\", "*", "{", "^", "\0", "\u2028", "\u00a0"),
        str(4),
      ),
      { maxLength: 8 },
    )
    .map((a) => a.join(""));

  // P1 (Q5: "a ref it accepts never starts with -, and holds no whitespace, shell metacharacter
  //     or ..")
  // mutant: core.ts:68 `[A-Za-z0-9._/]` -> `[A-Za-z0-9._/-]` (first char)   input: examples[0] "-x"
  // mutant: core.ts:68 `&& !ref.includes("..")` -> `` (dropped)   input: examples[1] "a..b"
  test("an accepted ref has no leading dash, whitespace, shell metacharacter or ..", () => {
    fc.assert(
      fc.property(refish, (r) => {
        if (!isSafeRef(r)) return;
        expect(r.length).toBeGreaterThan(0);
        expect(r.startsWith("-")).toBe(false);
        expect(SHELL_META.test(r)).toBe(false);
        expect(new RegExp("[\\s\\u0085\\u2028\\u2029\\u00a0\\ufeff]", "u").test(r)).toBe(false);
        expect(r.includes("..")).toBe(false);
        expect(r.includes("\0")).toBe(false);
      }),
      opts({ numRuns: RUNS * 5, examples: [["-x"], ["a..b"]] }),
    );
  });

  // P1's completeness over every git-valid name was narrowed with the user's OK (2026-10-26, D2
  // 2b: rejecting a ref is a safe outcome) to the plain names below
});

describe("P1 isSafeRef, plain names", () => {
  // P1 (Q5 completeness, narrowed by the user, D2 2b): a git-valid name of letters, digits and
  // . _ / - only is accepted; the oracle is real git (H7)
  // mutant: core.ts:67 `(ref: string) => ...` -> `() => undefined`   input: examples[0] "main"
  test("a git-valid name of letters, digits and . _ / - is accepted", () => {
    const name = fc.array(fc.constantFrom("feat", "x", "/", ".", "-", "_", "0", "Main", "lock"), { minLength: 1, maxLength: 6 }).map((a) => a.join(""));
    fc.assert(
      fc.property(name, (r) => {
        if (r.startsWith("-") || r.includes("..")) return;
        const git = Bun.spawnSync(["git", "check-ref-format", "--branch", r]);
        if (git.exitCode !== 0) return; // not a branch name: rejecting it is normal (Q4)
        expect(isSafeRef(r)).toBe(true);
      }),
      opts({ numRuns: Math.min(RUNS, 200), examples: [["main"], ["feat/x-0"]] }),
    );
  });
});

const finding = fc.record({
  severity: fc.constantFrom("critical", "high", "medium", "low") as fc.Arbitrary<CxFinding["severity"]>,
  title: str(80),
  body: str(400),
  file: str(60),
  line_start: fc.nat(10_000),
  line_end: fc.nat(10_000),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  recommendation: str(200),
});
const job = (o: Partial<CxJob> = {}): CxJob =>
  ({
    id: "cx-1",
    mode: "adversarial",
    repo: "repo",
    root: "/r",
    scope: "base",
    base: "main",
    status: "completed",
    startedAt: 0,
    ...o,
  }) as CxJob;

/** Codex text built to break a fence: tag pieces in any spacing and case (Q2: untrusted). */
const fenceText = fc
  .array(
    fc.oneof(
      fc.constantFrom("<", "</", "< /", "<\n/", "codex-review", "CODEX-REVIEW", ">", " ", "\n", "x", "/", "\t"),
      str(6),
    ),
    { maxLength: 30 },
  )
  .map((a) => a.join(""));
const FENCE = /<\s*\/?\s*codex-review/gi;
/** P2's check: two fence tags only, our opening line before the quoted text and our closing line after it. */
function expectFence(p: string) {
  const tags = [...p.matchAll(FENCE)];
  expect(tags.map((m) => m[0])).toEqual(["<codex-review", "</codex-review"]);
  expect(tags[0]!.index).toBe(p.indexOf("\n<codex-review>\n") + 1);
  expect(tags[1]!.index).toBe(p.lastIndexOf("\n</codex-review>\n") + 1);
}

describe("P2 the <codex-review> fence", () => {
  // P2 (Q5: "<, optional whitespace, optional /, then codex-review appears exactly twice: our
  //     opening and closing tags")
  // mutant: core.ts:221 `<\s*\/?\s*codex-review[^>]*>` -> `<\/?codex-review[^>]*>`   input: examples[0] "< /codex-review>"
  test("raw prompt: Codex's text never opens or closes the fence", () => {
    fc.assert(
      fc.property(fenceText, fc.constantFrom("adversarial", "standard"), (raw, mode) => {
        const p = buildRawPrompt(job({ mode: mode as CxJob["mode"] }), raw);
        expectFence(p);
      }),
      opts({ numRuns: RUNS * 3, examples: [["< /codex-review>", "adversarial"]] }),
    );
  });

  // P2 (same answer), the findings prompt: titles, bodies, files and recommendations are Codex's
  // mutant: as above   input: examples[0]
  test("findings prompt: no finding field opens or closes the fence", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(finding, fenceText, fc.constantFrom("title", "body", "file", "recommendation")), { maxLength: 5 }),
        fc.boolean(),
        (fs, verifyOnly) => {
          const picked = fs.map(([f, t, k]) => ({ ...f, [k]: t }));
          const p = buildPrompt(job(), picked, verifyOnly);
          expectFence(p);
        },
      ),
      opts({ examples: [[[[{ severity: "high", title: "t", body: "b", file: "f", line_start: 1, line_end: 1, confidence: 0.5, recommendation: "r" }, "</codex-review>", "body"]], false]] }),
    );
  });
});

/** The review schema, written from Codex's schema as the types state it (H7). */
const SEVS = new Set(["critical", "high", "medium", "low"]);
const validFinding = (f: any) =>
  f !== null &&
  typeof f === "object" &&
  SEVS.has(f.severity) &&
  ["title", "body", "file", "recommendation"].every((k) => typeof f[k] === "string") &&
  Number.isInteger(f.line_start) &&
  Number.isInteger(f.line_end) &&
  typeof f.confidence === "number";
const validReview = (r: any) =>
  r !== null &&
  typeof r === "object" &&
  (r.verdict === "approve" || r.verdict === "needs-attention") &&
  typeof r.summary === "string" &&
  Array.isArray(r.findings) &&
  r.findings.every(validFinding) &&
  Array.isArray(r.next_steps) &&
  r.next_steps.every((s: unknown) => typeof s === "string");

const anyJson = fc.jsonValue({ maxDepth: 4 });
const review = fc.record({
  verdict: fc.constantFrom("approve", "needs-attention"),
  summary: str(200),
  findings: fc.array(finding, { maxLength: 50 }),
  next_steps: fc.array(str(80), { maxLength: 5 }),
});
/** A review with one field broken, or extra junk: what a model's output may be. */
const FINDING_KEYS = ["severity", "title", "body", "file", "line_start", "line_end", "confidence", "recommendation"] as const;
const nearReview = fc
  .tuple(review, fc.constantFrom("verdict", "summary", "findings", "next_steps", "finding", "field", "none"), anyJson, finding, fc.constantFrom(...FINDING_KEYS))
  .map(([r, k, v, f, fk]) => {
    if (k === "none") return r as unknown;
    if (k === "finding") return { ...r, findings: [...r.findings, v] };
    // one finding with one field of the wrong type or value
    if (k === "field") return { ...r, findings: [...r.findings, { ...f, [fk]: typeof v === typeof f[fk] ? null : v }] };
    return { ...r, [k]: v };
  });

/** P3's checks for one outcome. */
function checkOutcome(mode: string, o: string, err: string) {
        const r = readOutcome(mode as CxJob["mode"], o, err);
        expect(["completed", "failed"]).toContain(r.status);
        expect(r.error === undefined || typeof r.error === "string").toBe(true);
        expect(r.raw === undefined || typeof r.raw === "string").toBe(true);
        let p: any;
        try {
          p = JSON.parse(o);
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          expect(r.status).toBe("failed");
          return;
        }
        const codex = p?.codex ?? {};
        if (typeof codex.status === "number" && codex.status !== 0) expect(r.status).toBe("failed");
        if (r.status === "completed") {
          expect(r.error).toBeUndefined();
          if (mode === "adversarial") {
            expect(validReview(r.review)).toBe(true);
            expect(validReview(p?.result)).toBe(true);
          } else {
            expect(typeof r.raw === "string" && r.raw.length > 0).toBe(true);
          }
        } else expect(typeof r.error === "string" && r.error.length > 0).toBe(true);
        // P3b (user D1b: "both directions"): a run that did not fail, with a review that holds to
        // the schema, completes with that review; in standard mode with text, with that text
        const failed = typeof codex.status === "number" && codex.status !== 0;
        if (!failed && mode === "adversarial" && validReview(p?.result)) {
          expect(r.status).toBe("completed");
          expect(r.review).toEqual(p.result);
        }
        if (!failed && mode === "standard" && typeof codex.stdout === "string" && codex.stdout.trim() !== "") {
          expect(r.status).toBe("completed");
          expect(r.raw).toBe(codex.stdout.trim());
        }
  }

describe("P3 readOutcome", () => {
  const payload = fc.record(
    {
      codex: fc.oneof(
        fc.record(
          {
            status: fc.oneof(fc.integer({ min: -2, max: 3 }), anyJson),
            stdout: fc.oneof(str(200), anyJson),
            stderr: fc.oneof(str(200), anyJson),
          },
          { requiredKeys: [] },
        ),
        anyJson,
      ),
      result: fc.oneof(nearReview, anyJson),
      parseError: fc.oneof(str(80), anyJson),
      rawOutput: fc.oneof(str(200), anyJson),
    },
    { requiredKeys: [] },
  );
  const out = fc.oneof(payload.map((p) => JSON.stringify(p)), anyJson.map((j) => JSON.stringify(j)), str(200));

  // P3 (Q5: "never throws; completed adversarial passes the schema; completed standard has
  //     non-empty raw text; a non-zero codex.status gives failed; error and raw are strings or
  //     undefined, as declared")
  // mutant: core.ts:184 `if (review && !failed)` -> `if (review)`   input: examples[0]
  // mutant: core.ts:175 `if (failed || !text)` -> `if (!text)`   input: examples[1]

  test("an outcome always holds to its declared shape and the schema", () => {
    fc.assert(
      fc.property(fc.constantFrom("adversarial", "standard"), out, str(400), checkOutcome),
      opts({
        numRuns: RUNS * 5,
        examples: [
          ["adversarial", JSON.stringify({ codex: { status: 1 }, result: { verdict: "approve", summary: "", findings: [], next_steps: [] } }), ""],
          ["standard", JSON.stringify({ codex: { status: 2, stdout: "text" } }), ""],
        ],
      }),
    );
  });

  // P3, the same checks with the companion's own fields typed as its contract says (Q2: the
  // companion is trusted, Codex's text and review are not): a sub-case of the property above,
  // kept so its other checks still bite while that one is VIOLATED
  // mutant: core.ts:184 `if (review && !failed)` -> `if (review)`   input: examples[0]
  test("trusted companion fields: an outcome holds to its shape and the schema", () => {
    const companion = fc.record(
      {
        codex: fc.record({ status: fc.integer({ min: -2, max: 3 }), stdout: str(200), stderr: str(200) }, { requiredKeys: [] }),
        result: fc.oneof(nearReview, anyJson),
        parseError: str(80),
        rawOutput: str(200),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.constantFrom("adversarial", "standard"), fc.oneof(companion.map((p) => JSON.stringify(p)), str(200)), str(400), checkOutcome),
      opts({
        numRuns: RUNS * 5,
        examples: [
          ["adversarial", JSON.stringify({ codex: { status: 1 }, result: { verdict: "approve", summary: "", findings: [], next_steps: [] } }), ""],
          ["standard", JSON.stringify({ codex: { status: 0, stdout: " text " } }), ""],
        ],
      }),
    );
  });
});

describe("P3 readOutcome, schema-strict reviews", () => {
  // P3 and P3b, the same checks with the companion trusted (Q2) and every next_steps entry a string:
  // a sub-case kept so the "both directions" checks still bite while F10 and F11 are open
  // mutant: core.ts:184 `if (review && !failed)` -> `if (false)`   input: examples[0]
  // mutant: core.ts:181 `return { status: "completed", raw: text }` -> `raw: text.slice(1)`   input: examples[1]
  test("trusted companion, string next steps: shape, schema, both directions", () => {
    const strict = (p: any) => !(Array.isArray(p?.result?.next_steps) && p.result.next_steps.some((x: unknown) => typeof x !== "string"));
    const companion = fc
      .record(
        {
          codex: fc.record({ status: fc.integer({ min: -2, max: 3 }), stdout: str(200), stderr: str(200) }, { requiredKeys: [] }),
          result: fc.oneof(nearReview, fc.jsonValue({ maxDepth: 4 })),
          parseError: str(80),
          rawOutput: str(200),
        },
        { requiredKeys: [] },
      )
      .filter(strict);
    fc.assert(
      fc.property(fc.constantFrom("adversarial", "standard"), fc.oneof(companion.map((p) => JSON.stringify(p)), str(200)), str(400), checkOutcome),
      opts({
        numRuns: RUNS * 5,
        examples: [
          ["adversarial", JSON.stringify({ codex: { status: 0 }, result: { verdict: "approve", summary: "s", findings: [], next_steps: ["n"] } }), ""],
          ["standard", JSON.stringify({ codex: { status: 0, stdout: " text " } }), ""],
          // each finding field broken once: the schema check must see every one
          ...FINDING_KEYS.map((k) => [
            "adversarial",
            JSON.stringify({ result: { verdict: "approve", summary: "", findings: [{ severity: "low", title: "t", body: "b", file: "f", line_start: 1, line_end: 1, confidence: 0.5, recommendation: "r", [k]: k === "severity" ? "urgent" : k.startsWith("line") ? 1.5 : 7 }], next_steps: [] } }),
            "",
          ] as [string, string, string]),
        ],
      }),
    );
  });
});

describe("P4 companionJobId, string ids", () => {
  // P4 both directions, ids strings as the companion writes them: a sub-case kept while F12 is open
  // mutant: core.ts:313 `phase: mine.phase` -> `phase: undefined`   input: examples[0]
  test("ours is found with its phase; no other is", () => {
    const entry = fc.record(
      {
        jobClass: fc.constantFrom("review", "task"),
        workspaceRoot: fc.constantFrom("/r", "/s"),
        pid: fc.constantFrom(7, 8),
        id: fc.constantFrom("j1", "j2", ""),
        phase: fc.oneof(str(10), fc.constant(undefined)),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 6 }), fc.constantFrom(7, 8), (running, pid) => {
        const got = companionJobId(JSON.stringify({ running }), { root: "/r", pid });
        const mine = running.find((r) => r.jobClass === "review" && r.workspaceRoot === "/r" && r.pid === pid);
        expect(got).toEqual(mine?.id ? { id: mine.id, phase: mine.phase } : undefined);
      }),
      opts({ numRuns: RUNS * 3, examples: [[[{ jobClass: "review", workspaceRoot: "/r", pid: 7, id: "j1", phase: "x" }], 7]] }),
    );
  });
});

describe("P4 companionJobId", () => {
  const entry = fc.record(
    {
      jobClass: fc.constantFrom("review", "task", "x"),
      workspaceRoot: fc.constantFrom("/r", "/s", "/r/"),
      pid: fc.oneof(fc.constantFrom(7, 8), fc.jsonValue({ maxDepth: 1 })),
      id: fc.oneof(fc.constantFrom("j1", "j2", ""), fc.jsonValue({ maxDepth: 1 })),
      phase: fc.oneof(str(10), fc.constant(undefined)),
    },
    { requiredKeys: [] },
  );
  const status = fc.oneof(
    fc.record({ running: fc.oneof(fc.array(fc.oneof(entry, fc.jsonValue({ maxDepth: 2 })), { maxLength: 6 }), fc.jsonValue({ maxDepth: 2 })) }, { requiredKeys: [] }).map((x) => JSON.stringify(x)),
    fc.jsonValue({ maxDepth: 3 }).map((j) => JSON.stringify(j)),
    str(100),
  );
  // P4 (Q5: "never throws; matches only the same pid, the same root and jobClass review"), and
  // (user D1b: "both directions") finds our job when it is there, its id a string
  // mutant: core.ts:311 `r.pid === job.pid` -> `true`   input: examples[0]
  // mutant: core.ts:313 `phase: mine.phase` -> `phase: undefined`   input: examples[1]
  test("only our own running review is ours, and ours is found", () => {
    fc.assert(
      fc.property(status, fc.constantFrom(7, 8), (s, pid) => {
        const got = companionJobId(s, { root: "/r", pid });
        let report: any;
        try {
          report = JSON.parse(s);
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          return expect(got).toBeUndefined();
        }
        const running: any[] = Array.isArray(report?.running) ? report.running : [];
        const mine = running.find((r) => r?.jobClass === "review" && r.workspaceRoot === "/r" && r.pid === pid);
        // a job id that is not a string is not one we can pass on: no match then (D1b, "its id a string")
        expect(got).toEqual(typeof mine?.id === "string" && mine.id ? { id: mine.id, phase: mine.phase } : undefined);
      }),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [JSON.stringify({ running: [{ jobClass: "review", workspaceRoot: "/r", pid: 8, id: "j1" }] }), 7],
          [JSON.stringify({ running: [{ jobClass: "review", workspaceRoot: "/r", pid: 7, id: "j1", phase: "reviewing" }] }), 7],
        ],
      }),
    );
  });
});

describe("P5 parseArgs", () => {
  const args = fc
    .array(fc.oneof(fc.constantFrom("cancel", "CANCEL", "Last", "review", "REVIEW", "adv", "Adversarial", "'", '"', " ", "\t", "\n"), str(8)), {
      maxLength: 10,
    })
    .map((a) => a.join(""));
  // P5 (Q5: "total, always a valid command; cancel and last are case-insensitive")
  // mutant: core.ts:28 `?.toLowerCase()` -> ``   input: examples[0] "CANCEL"
  test("always a valid command, keywords in any case", () => {
    fc.assert(
      fc.property(args, (a) => {
        const c = parseArgs(a);
        const head = a.trim().split(/\s+/).filter(Boolean)[0]?.toLowerCase();
        if (head === "cancel") expect(c).toEqual({ action: "cancel" });
        else if (head === "last") expect(c).toEqual({ action: "last" });
        else {
          expect(c.action).toBe("start");
          if (c.action !== "start") return;
          expect(c.mode).toBe(head === "review" ? "standard" : "adversarial");
          // P5b (user D1c: "focus rules"): the words after an adv/adversarial/review keyword (all
          // words without one), joined by a space, one pair of matching outer quotes taken off
          const words = a.trim().split(/\s+/).filter(Boolean);
          const rest = head === "review" || head === "adv" || head === "adversarial" ? words.slice(1) : words;
          const joined = rest.join(" ");
          const q = joined[0];
          const unquoted = joined.length >= 2 && (q === "'" || q === '"') && joined.at(-1) === q ? joined.slice(1, -1) : joined;
          expect(c.focus).toBe(unquoted);
        }
      }),
      opts({ numRuns: RUNS * 3, examples: [["CANCEL"], ["  Last  x"], ["REVIEW 'a b'"], ["adv \"x\""], ["'"], ["Adversarial  a   b"]] }),
    );
  });
});

describe("P6 trimJobs", () => {
  // P6 (Q5: same as T1 P8: running jobs never dropped, order kept, keep in all when it can, the
  //     ended kept are the newest)
  // mutant: core.ts:290 `ended.slice(0, ...)` -> `ended.slice(1, ...)`   input: examples[0]
  test("keeps running jobs and the newest ended, in order", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("running", "completed", "failed", "cancelled"), { maxLength: 40 }), fc.integer({ min: 1, max: 20 }), (st, keep) => {
        const jobs = st.map((s, i) => job({ id: `j${i}`, status: s as CxJob["status"] }));
        const kept = trimJobs(jobs, keep);
        const live = jobs.filter((j) => j.status === "running");
        expect(live.every((j) => kept.includes(j))).toBe(true);
        expect(kept).toEqual(jobs.filter((j) => kept.includes(j)));
        expect(kept.length).toBe(Math.max(Math.min(jobs.length, keep), live.length));
        const ended = jobs.filter((j) => j.status !== "running");
        const endedKept = kept.filter((j) => j.status !== "running");
        expect(endedKept).toEqual(ended.slice(ended.length - endedKept.length));
      }),
      opts({ examples: [[["completed", "completed"], 1]] }),
    );
  });
});
