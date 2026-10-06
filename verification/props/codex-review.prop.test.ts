/**
 * Property tests for codex-review/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  asReview,
  buildPrompt,
  buildRawPrompt,
  chooseBase,
  companionJobId,
  fmtElapsed,
  isPushCommand,
  isSafeRef,
  parseArgs,
  preselect,
  readOutcome,
  trimJobs,
  type CxCommand,
} from "../../plugins/codex-review/hooks/core.ts";

import type {
  CxFinding,
  CxJob,
} from "../../plugins/codex-review/types/index.d.ts";

const job = (over: Partial<CxJob> = {}): CxJob => ({
  id: "cx-1",
  mode: "adversarial",
  repo: "deployer",
  root: "/r/deployer",
  base: "develop",
  focus: "",
  dir: "/h/.cache/codex-review/cx-1",
  pid: 42,
  startedAt: 1_000,
  status: "running",
  byTool: false,
  ...over,
});

const finding = (over: Partial<CxFinding> = {}): CxFinding => ({
  severity: "high",
  title: "Bug",
  body: "Description",
  file: "src/main.ts",
  line_start: 1,
  line_end: 5,
  confidence: 0.9,
  recommendation: "Fix it",
  ...over,
});

describe("parseArgs", () => {
  test("always returns a valid CxCommand", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (args) => {
        const result = parseArgs(args);
        expect(["start", "cancel", "last"]).toContain(result.action);
        if (result.action === "start") {
          expect(["adversarial", "standard"]).toContain(result.mode);
          expect(typeof result.focus).toBe("string");
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("cancel and last are case-insensitive", () => {
    expect(parseArgs("cancel").action).toBe("cancel");
    expect(parseArgs("last").action).toBe("last");
    expect(parseArgs("CANCEL").action).toBe("cancel");
    expect(parseArgs("LAST").action).toBe("last");
    expect(parseArgs("Cancel").action).toBe("cancel");
  });

  test("review keyword sets standard mode", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (focus) => {
        const result = parseArgs(`review ${focus}`);
        expect(result.action).toBe("start");
        if (result.action === "start") {
          expect(result.mode).toBe("standard");
        }
      }),
      { numRuns: 500 },
    );
  });

  test("unquoting strips matching quotes", () => {
    const r = parseArgs('review "my focus area"');
    expect(r.action).toBe("start");
    if (r.action === "start") {
      expect(r.focus).toBe("my focus area");
    }
  });
});

describe("isSafeRef", () => {
  test("never accepts a string starting with '-'", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map((s) => `-${s}`),
        (ref) => {
          expect(isSafeRef(ref)).toBe(false);
        },
      ),
      { numRuns: 2000 },
    );
  });

  test("never accepts a string with spaces", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 20 }),
          )
          .map(([a, b]) => `${a} ${b}`),
        (ref) => {
          expect(isSafeRef(ref)).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("never accepts '..' (path traversal)", () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.stringOf(fc.constantFrom("a", "b", "/", "."), {
              minLength: 0,
              maxLength: 10,
            }),
            fc.stringOf(fc.constantFrom("a", "b", "/", "."), {
              minLength: 0,
              maxLength: 10,
            }),
          )
          .map(([a, b]) => `${a}..${b}`),
        (ref) => {
          expect(isSafeRef(ref)).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("never accepts empty string", () => {
    expect(isSafeRef("")).toBe(false);
  });

  test("never accepts shell metacharacters", () => {
    const shellChars = [
      ";",
      "&",
      "|",
      "$",
      "`",
      "(",
      ")",
      "{",
      "}",
      "!",
      "~",
      "'",
      '"',
      "\\",
      "\n",
      "\t",
    ];
    for (const c of shellChars) {
      expect(isSafeRef(`main${c}evil`)).toBe(false);
    }
  });

  test("accepts valid branch names", () => {
    fc.assert(
      fc.property(
        fc
          .stringOf(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/-".split(
                "",
              ),
            ),
            {
              minLength: 1,
              maxLength: 50,
            },
          )
          .filter((s) => /^[A-Za-z0-9._/]/.test(s) && !s.includes("..")),
        (ref) => {
          expect(isSafeRef(ref)).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("isPushCommand", () => {
  test("detects git push in various positions", () => {
    const prefixes = ["", "cargo fmt && ", "echo ok; ", "true | "];
    fc.assert(
      fc.property(
        fc.constantFrom(...prefixes),
        fc.string({ minLength: 0, maxLength: 30 }),
        (prefix, suffix) => {
          expect(isPushCommand(`${prefix}git push ${suffix}`)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("does not match git pushd or similar", () => {
    expect(isPushCommand("git pushd")).toBe(false);
    expect(isPushCommand("git pushed")).toBe(false);
    expect(isPushCommand("git-push")).toBe(false);
  });
});

describe("asReview", () => {
  test("rejects non-objects and missing fields", () => {
    const invalid = [null, undefined, 42, "string", [], {}, { verdict: "bad" }];
    for (const v of invalid) {
      expect(asReview(v)).toBeUndefined();
    }
  });

  test("accepts valid reviews", () => {
    const validReview = {
      verdict: "needs-attention",
      summary: "Issues found",
      findings: [finding()],
      next_steps: ["Fix it"],
    };
    const result = asReview(validReview);
    expect(result).toBeDefined();
    expect(result!.verdict).toBe("needs-attention");
  });

  test("rejects findings with invalid severity", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .filter((s) => !["critical", "high", "medium", "low"].includes(s)),
        (sev) => {
          const review = {
            verdict: "approve",
            summary: "ok",
            findings: [{ ...finding(), severity: sev }],
            next_steps: [],
          };
          expect(asReview(review)).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("readOutcome", () => {
  test("invalid JSON always fails", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }).filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (out, err) => {
          const result = readOutcome("adversarial", out, err);
          expect(result.status).toBe("failed");
        },
      ),
      { numRuns: 1000 },
    );
  });

  test("always returns a valid Outcome", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant("adversarial" as const),
          fc.constant("standard" as const),
        ),
        fc.oneof(
          fc.constant(""),
          fc.constant("not json"),
          fc.constant(
            JSON.stringify({ codex: { status: 0, stdout: "review text\n" } }),
          ),
          fc.constant(
            JSON.stringify({
              codex: { status: 1, stderr: "error" },
              result: null,
            }),
          ),
        ),
        fc.string({ minLength: 0, maxLength: 100 }),
        (mode, out, err) => {
          const result = readOutcome(mode, out, err);
          expect(["completed", "failed"]).toContain(result.status);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("companionJobId", () => {
  test("invalid JSON returns undefined", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }).filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        (json) => {
          expect(companionJobId(json, { root: "/r", pid: 42 })).toBeUndefined();
        },
      ),
      { numRuns: 500 },
    );
  });

  test("empty running array returns undefined", () => {
    expect(
      companionJobId(JSON.stringify({ running: [] }), {
        root: "/r",
        pid: 42,
      }),
    ).toBeUndefined();
  });

  test("matches by root and pid", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (root, pid, id) => {
          const status = JSON.stringify({
            running: [{ id, jobClass: "review", workspaceRoot: root, pid }],
          });
          const result = companionJobId(status, { root, pid });
          expect(result?.id).toBe(id);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("fence escaping: buildPrompt / buildRawPrompt", () => {
  const nearTags = fc.oneof(
    fc.constant("</codex-review>"),
    fc.constant("</ codex-review>"),
    fc.constant("</codex-review >"),
    fc.constant("< /codex-review>"),
    fc.constant("</CODEX-REVIEW>"),
    fc.constant("</CODEX-REVIEW\n>"),
    fc.constant("<codex-review>"),
    fc.constant("< codex-review >"),
  );

  const textWithNearTags = fc
    .tuple(
      fc.string({ minLength: 0, maxLength: 100 }),
      nearTags,
      fc.string({ minLength: 0, maxLength: 100 }),
    )
    .map(([a, tag, b]) => `${a}${tag}${b}`);

  test("buildPrompt: exactly one opening and one closing fence tag", () => {
    fc.assert(
      fc.property(textWithNearTags, (body) => {
        const f = finding({ body });
        const out = buildPrompt(job(), [f], false);
        expect(out.match(/<codex-review>/g)?.length).toBe(1);
        expect(out.match(/<\/codex-review>/g)?.length).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });

  test("buildRawPrompt: exactly one opening and one closing fence tag", () => {
    fc.assert(
      fc.property(textWithNearTags, (raw) => {
        const out = buildRawPrompt(job(), raw);
        expect(out.match(/<codex-review>/g)?.length).toBe(1);
        expect(out.match(/<\/codex-review>/g)?.length).toBe(1);
      }),
      { numRuns: 1000 },
    );
  });

  test("no near-tag variant survives inside the fenced body", () => {
    const variants = [
      "</codex-review >",
      "</ codex-review>",
      "< /codex-review>",
      "</CODEX-REVIEW>",
      "</CODEX-REVIEW\n>",
      "<codex-review >",
    ];
    for (const v of variants) {
      const out = buildRawPrompt(job(), `prefix ${v} suffix`);
      expect(out.match(/<\/codex-review>/g)?.length).toBe(1);
    }
  });

  test("arbitrary text never breaks the fence count", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (raw) => {
        const out = buildRawPrompt(job(), raw);
        expect(out.match(/<codex-review>/g)?.length).toBe(1);
        expect(out.match(/<\/codex-review>/g)?.length).toBe(1);
      }),
      { numRuns: 2000 },
    );
  });
});

describe("fmtElapsed (codex-review copy)", () => {
  test("format shape and no 60s/60m rollover", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 360_000_000 }), (ms) => {
        const s = fmtElapsed(ms);
        expect(s).toMatch(/^(\d+s|\d+m\d{2}s|\d+h\d{2}m)$/);
        const secMatch = s.match(/(\d{2})s$/);
        if (secMatch) expect(Number(secMatch[1])).toBeLessThan(60);
        const minMatch = s.match(/h(\d{2})m$/);
        if (minMatch) expect(Number(minMatch[1])).toBeLessThan(60);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("trimJobs (light)", () => {
  test("result length <= max(keep, running count)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              status: fc.oneof(
                fc.constant("running" as const),
                fc.constant("completed" as const),
                fc.constant("failed" as const),
              ),
            })
            .map((r) => job({ status: r.status })),
          { minLength: 0, maxLength: 20 },
        ),
        fc.integer({ min: 1, max: 10 }),
        (jobs, keep) => {
          const running = jobs.filter((j) => j.status === "running").length;
          expect(trimJobs(jobs, keep).length).toBeLessThanOrEqual(
            Math.max(keep, running),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("preselect", () => {
  test("'all' ticks everything, 'none' unticks everything", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .constantFrom("critical", "high", "medium", "low")
            .map((s) => finding({ severity: s as CxFinding["severity"] })),
          { minLength: 0, maxLength: 20 },
        ),
        (findings) => {
          expect(preselect(findings, "all").every(Boolean)).toBe(true);
          expect(preselect(findings, "none").every((v) => !v)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("default rule: low is off, others are on", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .constantFrom("critical", "high", "medium", "low")
            .map((s) => finding({ severity: s as CxFinding["severity"] })),
          { minLength: 1, maxLength: 20 },
        ),
        (findings) => {
          const picked = preselect(findings, "medium+");
          findings.forEach((f, i) => {
            if (f.severity === "low") expect(picked[i]).toBe(false);
            else expect(picked[i]).toBe(true);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("chooseBase", () => {
  test("prBase is returned when present", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (base, url) => {
          expect(chooseBase(base, url)).toBe(base);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("greentic repos get develop, others get main", () => {
    expect(chooseBase(undefined, "git@github.com:greenticai/x.git")).toBe(
      "develop",
    );
    expect(chooseBase(undefined, "https://github.com/greentic-biz/x")).toBe(
      "develop",
    );
    expect(chooseBase(undefined, "https://github.com/other/x")).toBe("main");
  });
});
