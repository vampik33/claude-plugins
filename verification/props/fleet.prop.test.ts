/**
 * Property tests for fleet/hooks/core.ts pure functions.
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import fc from "fast-check";

import {
  emptyFleet,
  etaMs,
  fmtElapsed,
  fmtLeft,
  heldArgv,
  lastLine,
  nextProgress,
  parseProgress,
  shellName,
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

describe("shell output", () => {
  test("parseProgress is a fraction in [0, 1] or nothing", () => {
    fc.assert(
      fc.property(fc.string(), (line) => {
        const p = parseProgress(line);
        if (p !== undefined) {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 3000 },
    );
  });

  test("parseProgress reads any count k/n with n >= 2", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 100_000 }), fc.nat(), (n, k) => {
        const done = k % (n + 1);
        expect(parseProgress(`step ${done}/${n} done`)).toBe(done / n);
      }),
    );
  });

  test("lastLine holds no line break, no escape, no edge blanks", () => {
    fc.assert(
      fc.property(fc.string(), (tail) => {
        const l = lastLine(tail);
        if (l === undefined) return;
        expect(l).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
        expect(l).toBe(l.trim());
        expect(l.length).toBeGreaterThan(0);
      }),
      { numRuns: 3000 },
    );
  });

  test("a reading never moves its start forward while it rises", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 30 }),
        (fracs) => {
          let p = undefined as ReturnType<typeof nextProgress>;
          fracs.forEach((f, i) => {
            const before = p;
            p = nextProgress(p, f, i * 1000);
            expect(p!.frac).toBe(f);
            if (before && f >= before.frac) expect(p!.firstAt).toBe(before.firstAt);
            else expect(p!.firstAt).toBe(i * 1000);
          });
        },
      ),
    );
  });

  test("etaMs is non-negative when given", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (a, b, dt) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const left = etaMs({ frac: hi, firstAt: 0, firstFrac: lo }, dt);
          if (left !== undefined) expect(left).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  test("fmtLeft shape", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 * 3_600_000 }), (ms) => {
        expect(fmtLeft(ms)).toMatch(/^(<1m|\d+m|\d+h\d{2}m)$/);
      }),
    );
  });

  test("shellName is short and one line", () => {
    fc.assert(
      fc.property(fc.string(), (cmd) => {
        const n = shellName(cmd);
        expect(n.length).toBeLessThanOrEqual(20);
        expect(n).not.toMatch(/\n/);
      }),
      { numRuns: 3000 },
    );
  });
});

/**
 * heldArgv's script, run for real by sh on a PATH holding only `sh` and the
 * tools a case names. A fake tool answers by the file's directory: `held`
 * exits 0, `free` exits 1 quietly, `err` exits 1 with a message, `odd` exits 3.
 */
describe("heldArgv", () => {
  const FAKE = `#!/bin/sh
for a; do f=$a; done
case $f in
  */held/*) exit 0 ;;
  */free/*) exit 1 ;;
  */err/*) echo "no such file" >&2; exit 1 ;;
  *) exit 3 ;;
esac
`;
  /** Every file fake fuser is asked about is free: shows when lsof was skipped. */
  const ALL_FREE = "#!/bin/sh\nexit 1\n";

  function run(files: string[], tools: Record<string, string>) {
    const dir = mkdtempSync(`${tmpdir()}/fleet-held-`);
    symlinkSync(Bun.which("sh")!, `${dir}/sh`);
    for (const [name, body] of Object.entries(tools)) {
      if (body.startsWith("/")) symlinkSync(body, `${dir}/${name}`);
      else {
        writeFileSync(`${dir}/${name}`, body);
        chmodSync(`${dir}/${name}`, 0o755);
      }
    }
    const p = Bun.spawnSync(heldArgv(files), { env: { PATH: dir } });
    rmSync(dir, { recursive: true });
    return {
      exitCode: p.exitCode,
      stdout: p.stdout.toString(),
      stderr: p.stderr.toString(),
    };
  }

  const MIX = [
    "/t/held/a.output",
    "/t/free/b.output",
    "/t/err/c.output",
    "/t/odd/d.output",
    "/t/free/e f.output",
  ];
  const FREE_OUT = "/t/free/b.output\n/t/free/e f.output\n";

  test("with lsof: only the files it quietly finds no holder for, in order", () => {
    expect(run(MIX, { lsof: FAKE })).toEqual({
      exitCode: 0,
      stdout: FREE_OUT,
      stderr: "",
    });
  });

  test("with fuser alone: the same", () => {
    expect(run(MIX, { fuser: FAKE })).toEqual({
      exitCode: 0,
      stdout: FREE_OUT,
      stderr: "",
    });
  });

  test("with both, lsof answers", () => {
    expect(run(MIX, { lsof: FAKE, fuser: ALL_FREE }).stdout).toBe(FREE_OUT);
  });

  test("with neither: exit 2, nothing printed", () => {
    expect(run(MIX, {})).toEqual({ exitCode: 2, stdout: "", stderr: "" });
  });

  test("no files: exit 0, nothing printed", () => {
    expect(run([], { lsof: FAKE })).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  // 200 runs, each a real sh and up to six fake lsof processes: 2 s on an idle machine,
  // past bun's default 5 s with every core busy, so the budget is the work's, not 5 s.
  test("any file name comes back verbatim, free ones only, in order", () => {
    const name = fc
      .string({ minLength: 1, maxLength: 24 })
      .filter((s) => !/[\n\0/]/.test(s));
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom("held", "free", "err", "odd"), name), {
          maxLength: 6,
        }),
        (items) => {
          const files = items.map(([kind, n]) => `/t/${kind}/${n}`);
          const r = run(files, { lsof: FAKE });
          expect(r.exitCode).toBe(0);
          expect(r.stdout).toBe(
            files.filter((f) => f.startsWith("/t/free/")).map((f) => `${f}\n`).join(""),
          );
        },
      ),
      { numRuns: 200 },
    );
  }, 20_000);

  /** The system's tools: a file a live process writes to is held, one nobody opened is free. */
  for (const tool of ["lsof", "fuser"] as const)
    test.skipIf(!Bun.which(tool))(`the real ${tool}: held and free files`, async () => {
      const dir = mkdtempSync(`${tmpdir()}/fleet-real-`);
      mkdirSync(`${dir}/x`);
      const held = `${dir}/x/held.output`;
      const free = `${dir}/x/free.output`;
      writeFileSync(free, "");
      const fd = openSync(held, "w");
      const child = spawn("sleep", ["30"], { stdio: ["ignore", fd, fd] });
      closeSync(fd);
      try {
        const r = run([held, free, `${dir}/x/missing.output`], {
          [tool]: Bun.which(tool)!,
        });
        expect(r).toEqual({ exitCode: 0, stdout: `${free}\n`, stderr: "" });
      } finally {
        child.kill();
        rmSync(dir, { recursive: true });
      }
    });
});
