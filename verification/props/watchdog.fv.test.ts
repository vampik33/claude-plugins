/**
 * formal-verify T1: watchdog's kill logic (plugins/watchdog/hooks/core.ts).
 * Spec answers in .formal-verify/targets.md § T1. Strengthened copies of
 * watchdog.prop.test.ts properties plus a model-based run of the look loop.
 * Guarantee ceiling: EXPLORED (fast-check), never PROVED.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { WatchRun } from "../../plugins/watchdog/types";
import {
  ACTIVE_IO_BYTES,
  ACTIVE_TICKS,
  applyScan,
  evalQuoted,
  isStuck,
  isWatched,
  killTargets,
  matchShells,
  needsKill,
  parseScan,
  type ScanShell,
  trim,
} from "../../plugins/watchdog/hooks/core.ts";

const SEED = Number(process.env.FV_SEED ?? 20261026);
const RUNS = Number(process.env.FV_RUNS ?? 300);
const opts = (o: fc.Parameters<any> = {}) => ({
  seed: SEED,
  numRuns: RUNS,
  ...o,
});

const MIN = 60_000;
const LIMIT = MIN;
const T0 = 1_000_000_000;
const SLACK = 1_000; // SPAWN_SLACK_MS, documented in core.ts
const GRACE = 10_000; // KILL_GRACE_MS, documented in core.ts

const record = (s: ScanShell) =>
  `${s.pid}\t${s.pids.join(" ")}\t${s.ticks}\t${s.sleeping ? 1 : 0}\t${s.io}\t${s.serving ? 1 : 0}\t${s.ageMs}\t${s.size}\t${s.file}\t${s.cmdline}\0`;

const PID = fc.integer({ min: 1, max: 2 ** 22 });
const BIG = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const arbShell = fc.record({
  pid: PID,
  pids: fc.array(PID, { minLength: 1, maxLength: 8 }),
  ticks: BIG,
  sleeping: fc.boolean(),
  io: BIG,
  serving: fc.boolean(),
  ageMs: BIG,
  size: BIG,
  file: fc.stringMatching(/^\/[a-z0-9/]{1,30}\/tasks\/[a-z0-9]{1,8}\.output$/),
  // Q2: the command line is untrusted: any characters but NUL (the scan's record end)
  cmdline: fc
    .string({ unit: "binary", maxLength: 200 })
    .filter((s) => !s.includes("\0")),
});

/** Commands built from pieces that make one command's quoted form a prefix of another's likely. */
const arbCmd = fc
  .array(fc.constantFrom("a", "b", "'", " ", "x", '"', "\\"), {
    minLength: 1,
    maxLength: 5,
  })
  .map((a) => a.join(""));

const run = (o: Partial<WatchRun> = {}): WatchRun => ({
  id: "r1",
  command: "./hang.sh",
  startedAt: T0,
  ...o,
});

/** POSIX shell word reading, single and double quotes only: the reference for evalQuoted (H7). */
function unquoteWord(s: string): string | undefined {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return undefined;
      out += s.slice(i + 1, j);
      i = j + 1;
    } else if (c === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) return undefined;
      const inner = s.slice(i + 1, j);
      if (/[\\$`]/.test(inner)) return undefined; // not produced by evalQuoted
      out += inner;
      i = j + 1;
    } else return undefined; // evalQuoted leaves nothing unquoted
  }
  return out;
}

describe("P3 evalQuoted", () => {
  // P3 (Q5: "evalQuoted(c) unquotes to exactly c under POSIX single-quote rules")
  // mutant: core.ts:157 `'"'"'` -> `'"'`   input: examples [["it's"]]
  test("the quoted word reads back as the command (own unquoter)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 4096 }), (c) => {
        const q = evalQuoted(c);
        expect(q.startsWith("eval ")).toBe(true);
        expect(unquoteWord(q.slice(5))).toBe(c);
      }),
      opts({ examples: [["it's"], ["''"], [""]] }),
    );
  });

  // P3 (same answer, second oracle: real bash reads the word, H7 independent implementation)
  // mutant: as above   input: examples [["it's"]]
  test("bash reads the quoted word back as the command", () => {
    fc.assert(
      fc.property(
        // bash -c takes no NUL; Q2 allows any bytes, NUL is listed under Assumptions
        fc
          .string({ unit: "binary", maxLength: 512 })
          .filter((s) => !s.includes("\0")),
        (c) => {
          const script = evalQuoted(c).replace(/^eval /, "printf %s ");
          const p = Bun.spawnSync(["bash", "-c", script], {
            env: { LC_ALL: "C.UTF-8" },
          });
          expect(p.exitCode).toBe(0);
          expect(p.stdout.toString()).toBe(c);
        },
      ),
      opts({
        numRuns: Math.min(RUNS, 200),
        examples: [["it's"], ["a'\"'\"'b"]],
      }),
    );
  });
});

describe("P4 parseScan", () => {
  // P4 (Q5: "parseScan reads back every well-formed record"), copy of the original, full Q3 ranges
  // mutant: core.ts:149 `f.slice(9).join("\t")` -> `f[9]`   input: any cmdline with a tab
  test("reads back every well-formed record, tabs in the command line included", () => {
    fc.assert(
      fc.property(fc.array(arbShell, { maxLength: 32 }), (shells) => {
        expect(parseScan(shells.map(record).join(""))).toEqual(shells);
      }),
      opts(),
    );
  });

  /** One field corrupted to a value that is not what the scan prints there. */
  const BAD: Record<number, string[]> = {
    0: ["0", "-3", "1.5", "x", "", "NaN"],
    1: ["0", "-1", "1.5", "x"],
    2: ["x", "", "NaN", "Infinity", "-1", "1.5"],
    3: ["2", "x", ""],
    4: ["x", "", "NaN", "Infinity", "-1", "1.5"],
    5: ["2", "x", ""],
    6: ["-1", "x", "", "NaN", "Infinity", "1.5"],
    7: ["x", "", "NaN", "Infinity", "-1", "1.5"],
    8: [""],
  };
  const arbBad = fc
    .constantFrom(...Object.keys(BAD).map(Number))
    .chain((field) =>
      fc.tuple(fc.constant(field), fc.constantFrom(...BAD[field]!)),
    );

  // P4 (Q4: "a malformed scan record is skipped"; the well-formed ones around it are kept)
  // mutant: core.ts:134 `pid <= 0` -> `pid < 0`   input: examples [field 0 = "0"]
  test("a record with one malformed field is skipped, the others kept", () => {
    fc.assert(
      fc.property(
        fc.array(arbShell, { minLength: 0, maxLength: 4 }),
        arbShell,
        arbBad,
        fc.nat(4),
        (good, victim, [field, value], at) => {
          const fields = record(victim).slice(0, -1).split("\t");
          if (field === 1) fields[1] = `${victim.pids.join(" ")} ${value}`;
          else fields[field] = value;
          const recs = good.map(record);
          recs.splice(Math.min(at, recs.length), 0, `${fields.join("\t")}\0`);
          expect(parseScan(recs.join(""))).toEqual(good);
        },
      ),
      opts({ examples: [[[], { ...fcShell0 }, [0, "0"], 0]] }),
    );
  });

  // P4 (Q5: "never throws"; any record it keeps has a positive pid and positive tree pids, H5)
  // mutant: core.ts:131 `pids.some(...)` -> `false`   input: corpus "1\t-1\t0\t0\t0\t0\t0\t0\t/f\tc"
  test("never throws on junk; anything kept has positive integer pids", () => {
    const junk = fc
      .array(
        fc.oneof(
          fc.constantFrom("\t", "\0", " ", "-", "0", "1", "/t.output", "x"),
          fc.string(),
        ),
        {
          maxLength: 60,
        },
      )
      .map((a) => a.join(""));
    fc.assert(
      fc.property(junk, (s) => {
        for (const sh of parseScan(s)) {
          expect(Number.isInteger(sh.pid) && sh.pid > 0).toBe(true);
          for (const p of sh.pids)
            expect(Number.isInteger(p) && p > 0).toBe(true);
          expect(sh.file.length).toBeGreaterThan(0);
          expect(sh.ageMs).toBeGreaterThanOrEqual(0);
        }
      }),
      opts({ examples: [["1\t-1\t0\t0\t0\t0\t0\t0\t/f\tc\0"]] }),
    );
  });
});

const fcShell0: ScanShell = {
  pid: 7,
  pids: [7],
  ticks: 0,
  sleeping: false,
  io: 0,
  serving: false,
  ageMs: 0,
  size: 0,
  file: "/t/tasks/a.output",
  cmdline: "c",
};

/**
 * "The command line holds the call's command" (core.ts docstring): the quoted command as one whole
 * word of the engine's shell line, not the start of a longer one. The engine's line puts a space
 * after it (`… && eval '<cmd>' < /dev/null && …`; listed under Assumptions).
 */
const holdsCommand = (cmdline: string, command: string) => ` ${cmdline} `.includes(` ${evalQuoted(command)} `);

describe("P1/P2 matchShells", () => {
  const arbRuns = fc.array(
    fc.record({
      command: arbCmd,
      startedAt: fc.integer({ min: T0 - 20_000, max: T0 }),
      kind: fc.constantFrom("waiting", "bg", "owned", "ended"),
    }),
    { maxLength: 6 },
  );
  const arbShells = fc.array(
    fc.record({
      cmd: arbCmd,
      quoted: fc.boolean(),
      ageMs: fc.nat({ max: 40_000 }),
      fileOf: fc.nat(9),
      // most shells run one of the calls' commands, so command matches and the fallback both happen
      of: fc.option(fc.nat(5), { nil: undefined }),
    }),
    { maxLength: 8 },
  );
  const build = (rs: fc.RecordValue<any>[], ss: any[]) => {
    const runs: WatchRun[] = rs.map((r, i) => ({
      id: `r${i}`,
      command: r.command,
      startedAt: r.startedAt,
      ...(r.kind === "bg" ? { taskId: `t${i}` } : {}),
      ...(r.kind === "owned" ? { outputFile: `/t/tasks/${i}.output` } : {}),
      ...(r.kind === "ended" ? { endedAt: T0 } : {}),
    }));
    const seen = new Set<string>();
    const shells: ScanShell[] = [];
    ss.forEach((s, i) => {
      const file = `/t/tasks/${s.fileOf}.output`;
      if (seen.has(file)) return;
      seen.add(file);
      shells.push({
        ...fcShell0,
        pid: 100 + i,
        pids: [100 + i],
        ageMs: s.ageMs,
        file,
        cmdline: s.quoted
          ? `zsh -c ${evalQuoted(s.of !== undefined && rs[s.of] ? rs[s.of].command : s.cmd)} < /dev/null`
          : `zsh -c ${s.cmd}`,
      });
    });
    return { runs, shells };
  };

  // P1 (Q5: "a shell is never matched to two runs, nor one another run owns")
  // P2 (Q5: "matched by quoted cmdline, or by the fallback: exactly 1 waiting run and 1 eligible
  //     shell left, the shell started >= call - 1 s"); the oracle re-derives the fallback's
  //     preconditions from that answer (H7)
  // mutant: core.ts:178 `!taken.has(x.file) &&` -> `` (dropped)   input: two runs, same command
  // mutant: core.ts:189 `>= r.startedAt - SPAWN_SLACK_MS` -> `>= r.startedAt - 2 * SPAWN_SLACK_MS`
  /** P1/P2's checks for one draw. */
  const checkMatch = (rs: any[], ss: any[], dt: number) => {
        const { runs, shells } = build(rs, ss);
        const now = T0 + dt;
        const m = matchShells(runs, shells, now);
        const owned = new Set(runs.map((r) => r.outputFile).filter(Boolean));
        const files = [...m.values()].map((s) => s.file);
        expect(new Set(files).size).toBe(files.length);
        for (const f of files) expect(owned.has(f)).toBe(false);
        const waiting = runs.filter(
          (r) => r.endedAt === undefined && !r.taskId && !r.outputFile,
        );
        for (const id of m.keys())
          expect(waiting.some((r) => r.id === id)).toBe(true);
        // the twin rule (user, F2 fix): calls waiting with the same command get no shell
        const twin = (r: WatchRun) => waiting.some((o) => o !== r && o.command === r.command);
        for (const r of waiting) if (twin(r)) expect(m.has(r.id)).toBe(false);
        const entries = [...m];
        const byCmd = entries.filter(([id, s]) => holdsCommand(s.cmdline, runs.find((r) => r.id === id)!.command));
        const other = entries.filter((e) => !byCmd.includes(e));
        expect(other.length).toBeLessThanOrEqual(1);
        if (other.length === 1) {
          const [id, s] = other[0]!;
          const r = runs.find((x) => x.id === id)!;
          expect(
            waiting.filter((x) => !byCmd.some(([i]) => i === x.id)).length,
          ).toBe(1);
          expect(now - s.ageMs).toBeGreaterThanOrEqual(r.startedAt - SLACK);
          const eligible = shells.filter(
            (x) =>
              !owned.has(x.file) &&
              !byCmd.some(([, y]) => y.file === x.file) &&
              now - x.ageMs >= r.startedAt - SLACK,
          );
          expect(eligible.length).toBe(1);
        }
        // the fallback's other half (core.ts docstring: "else, when exactly one call and one new
        // shell started since that call are left, each other"): such a pair is never left apart
        // the command half (docstring: "the one whose command line holds the call's command"): a call
        // not matched by its command finds no free shell, untaken, that holds it
        for (const r of waiting) {
          if (twin(r) || holdsCommand(m.get(r.id)?.cmdline ?? "", r.command)) continue;
          const free = shells.filter((x) => !owned.has(x.file) && !files.includes(x.file) && holdsCommand(x.cmdline, r.command));
          expect(free.map((x) => x.file)).toEqual([]);
        }
        const unmatched = waiting.filter((r) => !m.has(r.id));
        if (other.length === 0 && unmatched.length === 1) {
          const r = unmatched[0]!;
          const left = shells.filter(
            (x) => !owned.has(x.file) && !files.includes(x.file) && now - x.ageMs >= r.startedAt - SLACK,
          );
          if (left.length === 1) expect(m.has(r.id)).toBe(true);
        }
};
  test("injective, never an owned shell, each match by command or by the documented fallback", () => {
    fc.assert(
      fc.property(arbRuns, arbShells, fc.nat({ max: 20_000 }), checkMatch),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [
            [{ command: "a", startedAt: T0, kind: "waiting" }, { command: "a", startedAt: T0, kind: "waiting" }],
            [{ cmd: "a", quoted: true, ageMs: 0, fileOf: 0 }, { cmd: "a", quoted: true, ageMs: 0, fileOf: 1 }],
            0,
          ],
          // the fallback's age boundary exactly: started SPAWN_SLACK_MS before the call
          [[{ command: "a", startedAt: T0, kind: "waiting" }], [{ cmd: "b", quoted: false, ageMs: SLACK, fileOf: 0 }], 0],
        ],
      }),
    );
  });

  // P1/P2, the same checks where no call's quoted command sits inside a shell line except as a
  // whole word: a sub-case kept so they still bite while F1 is open
  // mutant: core.ts:178 `!taken.has(x.file) &&` -> `` (dropped)   input: examples[0]
  test("no partial command matches: injective, by command or by the fallback", () => {
    const clean = fc.tuple(arbRuns, arbShells, fc.nat({ max: 20_000 })).filter(([rs, ss]) => {
      const { runs, shells } = build(rs, ss);
      return runs.every((r) => shells.every((x) => x.cmdline.includes(evalQuoted(r.command)) === holdsCommand(x.cmdline, r.command)));
    });
    fc.assert(
      fc.property(clean, ([rs, ss, dt]) => checkMatch(rs, ss, dt)),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [
            [
              [{ command: "a", startedAt: T0, kind: "waiting" }, { command: "a", startedAt: T0, kind: "waiting" }],
              [{ cmd: "a", quoted: true, ageMs: 0, fileOf: 0 }, { cmd: "a", quoted: true, ageMs: 0, fileOf: 1 }],
              0,
            ],
          ],
          [[[{ command: "a", startedAt: T0, kind: "waiting" }], [{ cmd: "b", quoted: false, ageMs: SLACK, fileOf: 0 }], 0]],
        ],
      }),
    );
  });

  // P1 (Q5 + Q7 Critical "signals an unrelated process"): in a world where every waiting call's
  // real shell carries its own quoted command, a call is never matched to another call's shell.
  // mutant: core.ts:178 `x.cmdline.includes(q)` -> `true`   input: two runs, distinct commands
  test("a call is never matched to another call's real shell", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ command: arbCmd, up: fc.boolean() }), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.array(fc.nat(), { maxLength: 5 }),
        (calls, order) => {
          const runs = calls.map((c, i) =>
            run({ id: `r${i}`, command: c.command }),
          );
          // only some shells are up yet; ps lists them in pid order, which need not be call order
          const shells = calls
            .map((c, i) => ({ c, i, k: order[i] ?? i }))
            .filter(({ c }) => c.up)
            .sort((a, b) => a.k - b.k || a.i - b.i)
            .map(({ c, i }) => ({
              ...fcShell0,
              pid: 100 + i,
              pids: [100 + i],
              file: `/t/tasks/${i}.output`,
              cmdline: `zsh -c ${evalQuoted(c.command)} < /dev/null`,
            }));
          const m = matchShells(runs, shells, T0 + 5_000);
          for (const [id, s] of m)
            expect(s.file).toBe(`/t/tasks/${id.slice(1)}.output`);
        },
      ),
      opts({
        numRuns: RUNS * 3,
        examples: [
          [
            [
              { command: "a", up: false },
              { command: "a' b", up: true },
            ],
            [],
          ],
        ],
      }),
    );
  });
});

describe("P5 applyScan", () => {
  const arbRun = fc.record(
    {
      command: arbCmd,
      startedAt: fc.integer({ min: T0 - 5 * MIN, max: T0 }),
      taskId: fc.constant("t"),
      endedAt: fc.integer({ min: T0 - MIN, max: T0 }),
      pid: fc.integer({ min: 100, max: 104 }),
      pids: fc.array(fc.integer({ min: 100, max: 120 }), { maxLength: 3 }),
      outputFile: fc.constantFrom(
        ...[0, 1, 2, 3, 4].map((i) => `/t/tasks/${i}.output`),
      ),
      size: fc.nat(3),
      ticks: fc.nat(20),
      io: fc.nat(3 * ACTIVE_IO_BYTES),
      activeAt: fc.integer({ min: T0 - 5 * MIN, max: T0 }),
      killedAt: fc.integer({ min: T0 - MIN, max: T0 }),
      killSent: fc.boolean(),
      sleeping: fc.boolean(),
      serving: fc.boolean(),
    },
    { requiredKeys: ["command", "startedAt"] },
  );
  const arbScanShell = fc.record({
    pid: fc.integer({ min: 100, max: 104 }),
    pids: fc.array(fc.integer({ min: 100, max: 120 }), {
      minLength: 1,
      maxLength: 3,
    }),
    ticks: fc.nat(30),
    sleeping: fc.boolean(),
    io: fc.nat(4 * ACTIVE_IO_BYTES),
    serving: fc.boolean(),
    ageMs: fc.nat(MIN),
    size: fc.nat(4),
    file: fc.constantFrom(
      ...[0, 1, 2, 3, 4, 5].map((i) => `/t/tasks/${i}.output`),
    ),
    cmdline: fc.oneof(
      arbCmd.map((c) => `zsh -c ${evalQuoted(c)}`),
      fc.constant("?"),
    ),
  });

  // P5 (Q5: "ended runs untouched; activeAt only moves to now, and only when the output grew, the
  //     tree used CPU or I/O (after the first look), slept or serves; a run whose output file no
  //     shell holds has ended with its pids dropped"); the oracle is the documented rule (H7)
  //     + the twin rule (user, F2 fix): a held twin is active at each look and at its first shell
  // mutant: core.ts:216 `return r.outputFile ? ended(r, now) : r` -> `return r`   input: owned run, empty scan
  // mutant: core.ts:220 `>= ACTIVE_TICKS` -> `> ACTIVE_TICKS`   input: ticks delta exactly 5
  // mutant: core.ts:234 `|| s.serving` -> `` (dropped)   input: serving shell
  // mutant: core.ts:249 `const { pids: _, ...rest } = r` -> `const rest = r`   input: owned run, empty scan
  test("each run follows the documented rule", () => {
    fc.assert(
      fc.property(
        fc.array(arbRun, { maxLength: 6 }),
        fc.uniqueArray(arbScanShell, { maxLength: 6, selector: (s) => s.file }),
        fc.nat(MIN),
        (raw, shells, dt) => {
          const runs = raw.map((r, i): WatchRun => ({ ...r, id: `r${i}` }));
          const now = T0 + dt;
          const matched = matchShells(runs, shells, now);
          const out = applyScan(runs, shells, now);
          expect(out.runs).toHaveLength(runs.length);
          runs.forEach((r, i) => {
            const n = out.runs[i]!;
            if (r.endedAt !== undefined) {
              expect(n).toBe(r);
              expect(out.grew.has(r.id)).toBe(false);
              return;
            }
            const s =
              matched.get(r.id) ??
              shells.find((x) => r.outputFile && x.file === r.outputFile);
            if (!s) {
              if (r.outputFile) {
                const { pids: _, ...rest } = r;
                expect(n).toEqual({ ...rest, endedAt: now });
                expect("pids" in n).toBe(false);
              } else {
                const waiting = runs.filter((x) => x.endedAt === undefined && !x.taskId && !x.outputFile);
                const twin = waiting.includes(r) && waiting.some((o) => o !== r && o.command === r.command);
                expect(n).toEqual(twin ? { ...r, activeAt: now } : r);
              }
              expect(out.grew.has(r.id)).toBe(false);
              return;
            }
            const first = r.pid !== s.pid;
            const grown = s.size > (r.size ?? 0);
            const active =
              (r.pid === undefined && r.activeAt !== undefined) ||
              grown ||
              (!first && s.ticks - (r.ticks ?? 0) >= ACTIVE_TICKS) ||
              (!first && s.io - (r.io ?? 0) >= ACTIVE_IO_BYTES) ||
              s.sleeping ||
              s.serving;
            expect(out.grew.has(r.id)).toBe(grown);
            // docstring: the run "takes its pids, sizes and ticks"; nothing else of it changes
            expect(n).toEqual({
              ...r,
              outputFile: s.file,
              pid: s.pid,
              pids: s.pids,
              size: s.size,
              ticks: s.ticks,
              io: s.io,
              sleeping: s.sleeping,
              serving: s.serving,
              ...(active ? { activeAt: now } : {}),
            });
          });
        },
      ),
      opts({
        numRuns: RUNS * 3,
        // thresholds exactly: CPU and I/O deltas at ACTIVE_TICKS and ACTIVE_IO_BYTES, same pid
        examples: [
          [[{ command: "a", startedAt: T0, pid: 100, ticks: 0, io: 0, size: 0, outputFile: "/t/tasks/0.output" }], [{ ...fcShell0, pid: 100, pids: [100], ticks: ACTIVE_TICKS, file: "/t/tasks/0.output", cmdline: "?" }], 0],
          [[{ command: "a", startedAt: T0, pid: 100, ticks: 0, io: 0, size: 0, outputFile: "/t/tasks/0.output" }], [{ ...fcShell0, pid: 100, pids: [100], io: ACTIVE_IO_BYTES, file: "/t/tasks/0.output", cmdline: "?" }], 0],
          // the twin rule: two waiting twins held, a third call of that command already answered is not
          // mutant: core.ts `? { ...r, activeAt: now } : r` -> `r`; isTwin's `waiting.includes(r) &&` dropped
          [[{ command: "a", startedAt: T0 }, { command: "a", startedAt: T0 }, { command: "a", startedAt: T0, taskId: "t" }], [], 0],
          // a held twin's first shell: active at that look, its CPU so far a baseline
          // mutant: core.ts `const wasHeld = …` -> `false`
          [[{ command: "a", startedAt: T0, activeAt: T0 }], [{ ...fcShell0, file: "/t/tasks/0.output", cmdline: `zsh -c ${evalQuoted("a")}` }], 1_000],
        ],
      }),
    );
  });
});

describe("P5 applyScan, shells from the runs", () => {
  // P5 (same answer and oracle as above), with each shell the scan of a run's own file and pid
  // most of the time, so CPU, I/O and size deltas around the thresholds come up
  // mutant: core.ts:220 `s.ticks - (r.ticks ?? 0)` -> `s.ticks + (r.ticks ?? 0)`   input: random
  // mutant: core.ts:221 `(r.io ?? 0)` -> `(r.io && 0)`   input: random
  test("each run follows the documented rule", () => {
    const world = fc.array(
      fc.record({
        pid: fc.integer({ min: 100, max: 102 }),
        ticks: fc.nat(1_000),
        io: fc.nat(10 * ACTIVE_IO_BYTES),
        size: fc.nat(1_000),
        activeAt: fc.option(fc.integer({ min: T0 - 5 * MIN, max: T0 }), { nil: undefined }),
        dTicks: fc.integer({ min: -2, max: 2 * ACTIVE_TICKS }),
        dIo: fc.integer({ min: -2, max: 2 * ACTIVE_IO_BYTES }),
        dSize: fc.integer({ min: -1, max: 2 }),
        samePid: fc.boolean(),
        // rare, so the CPU, I/O and size thresholds still decide most runs
        sleeping: fc.constantFrom(false, false, false, true),
        serving: fc.constantFrom(false, false, false, true),
        up: fc.boolean(),
        ended: fc.boolean(),
      }),
      { maxLength: 5 },
    );
    fc.assert(
      fc.property(world, fc.nat(MIN), (ws, dt) => {
        const now = T0 + dt;
        const runs: WatchRun[] = ws.map((w, i) => ({
          id: `r${i}`,
          command: `c${i}`,
          startedAt: T0 - 5 * MIN,
          taskId: `t${i}`,
          outputFile: `/t/tasks/${i}.output`,
          pid: w.pid,
          pids: [w.pid],
          ticks: w.ticks,
          io: w.io,
          size: w.size,
          ...(w.activeAt === undefined ? {} : { activeAt: w.activeAt }),
          ...(w.ended ? { endedAt: T0 - 1 } : {}),
        }));
        const shells: ScanShell[] = ws.flatMap((w, i) =>
          w.up
            ? [{
                pid: w.samePid ? w.pid : w.pid + 10,
                pids: [w.samePid ? w.pid : w.pid + 10],
                ticks: Math.max(0, w.ticks + w.dTicks),
                sleeping: w.sleeping,
                io: Math.max(0, w.io + w.dIo),
                serving: w.serving,
                ageMs: 0,
                size: Math.max(0, w.size + w.dSize),
                file: `/t/tasks/${i}.output`,
                cmdline: "?",
              }]
            : [],
        );
        const out = applyScan(runs, shells, now);
        runs.forEach((r, i) => {
          const n = out.runs[i]!;
          if (r.endedAt !== undefined) return expect(n).toBe(r);
          const s = shells.find((x) => x.file === r.outputFile);
          if (!s) {
            expect(n.endedAt).toBe(now);
            expect("pids" in n).toBe(false);
            return;
          }
          const first = r.pid !== s.pid;
          const active =
            (r.pid === undefined && r.activeAt !== undefined) ||
            s.size > r.size! ||
            (!first && s.ticks - r.ticks! >= ACTIVE_TICKS) ||
            (!first && s.io - r.io! >= ACTIVE_IO_BYTES) ||
            s.sleeping ||
            s.serving;
          expect(n.activeAt).toBe(active ? now : r.activeAt);
          expect(out.grew.has(r.id)).toBe(s.size > r.size!);
          expect(n).toEqual({
            ...r,
            pid: s.pid,
            pids: s.pids,
            size: s.size,
            ticks: s.ticks,
            io: s.io,
            sleeping: s.sleeping,
            serving: s.serving,
            ...(active ? { activeAt: now } : {}),
          });
        });
      }),
      opts({ numRuns: RUNS * 3 }),
    );
  });
});

describe("P7 rules (copies of watchdog.prop.test.ts, exact)", () => {
  // P7 (Q5: "never signal a non-stuck run"): stuck exactly when running, with a shell, and quiet
  // for the limit (copy of the original "exactly when running" test, every status included)
  // mutant: core.ts:258 `>= limitMs` -> `> limitMs`   input: examples[0], quiet exactly the limit
  test("isStuck exactly when running, with a shell, and quiet for the limit", () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat({ max: 30 * MIN }), { nil: undefined }),
        fc.nat({ max: 30 * MIN }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (active, at, hasPid, killed, isEnded) => {
          const r = run({
            ...(active === undefined ? {} : { activeAt: T0 + active }),
            ...(hasPid ? { pid: 9 } : {}),
            ...(killed ? { killedAt: T0 } : {}),
            ...(isEnded ? { endedAt: T0 } : {}),
          });
          const now = T0 + at;
          expect(isStuck(r, now, LIMIT)).toBe(!killed && !isEnded && hasPid && now - T0 - (active ?? 0) >= LIMIT);
        },
      ),
      opts({ examples: [[undefined, LIMIT, true, false, false]] }),
    );
  });

  // P7 (Q5: "<= 1 KILL per run, the KILL >= 10 s after the TERM"): a KILL is due exactly when
  // stopped, not sent, with a pid, and the grace is over
  // mutant: core.ts:265 `>= KILL_GRACE_MS` -> `> KILL_GRACE_MS`   input: examples[0]
  test("needsKill and isWatched follow their rules", () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat({ max: MIN }), { nil: undefined }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.nat({ max: 2 * MIN }),
        (killedAt, sent, hasPid, isEnded, at) => {
          const r = run({
            ...(killedAt === undefined ? {} : { killedAt: T0 + killedAt }),
            ...(sent ? { killSent: true } : {}),
            ...(hasPid ? { pid: 9 } : {}),
            ...(isEnded ? { endedAt: T0 } : {}),
          });
          const now = T0 + at;
          expect(needsKill(r, now)).toBe(killedAt !== undefined && !sent && hasPid && at - killedAt >= GRACE);
          expect(isWatched(r)).toBe(!isEnded || (killedAt !== undefined && !sent));
        },
      ),
      opts({ examples: [[0, false, true, true, GRACE]] }),
    );
  });
});

describe("P6 killTargets", () => {
  // P6 (Q5: "[] without a pid; otherwise the only dash-prefixed target is -<pid>, all positive ints")
  // composed with parseScan + applyScan, the only source of pids (Q2: /proc fields trusted)
  // mutant: core.ts:280 `["--", ...]` -> `[...]` (no "--")   input: any run with a pid
  test("targets are '--', the group, then the tree's pids, every one a positive integer", () => {
    fc.assert(
      fc.property(
        fc.array(arbShell, { minLength: 1, maxLength: 4 }),
        (shells) => {
          const parsed = parseScan(shells.map(record).join(""));
          const runs = parsed.map((s, i) =>
            run({ id: `r${i}`, outputFile: s.file, taskId: `t${i}` }),
          );
          for (const r of applyScan(runs, parsed, T0 + 1).runs) {
            const t = killTargets(r);
            if (r.pid === undefined) {
              expect(t).toEqual([]);
              continue;
            }
            expect(t[0]).toBe("--");
            expect(t[1]).toBe(`-${r.pid}`);
            expect(t.slice(2)).toEqual(r.pids!.map(String));
            for (const x of [t[1]!.slice(1), ...t.slice(2)])
              expect(x).toMatch(/^[1-9][0-9]*$/);
            // the shell gone: its pids dropped, only the group is signalled
            const gone = applyScan([r], [], T0 + 2).runs[0]!;
            expect(killTargets(gone)).toEqual(["--", `-${r.pid}`]);
          }
          expect(killTargets(run())).toEqual([]);
        },
      ),
      opts(),
    );
  });
});

describe("P6 killTargets, from any scan output", () => {
  // P6 (Q5: "every target is a positive integer"), with the scan's stdout any bytes: the pids a run
  // can take come only through parseScan
  // mutant: core.ts:134 `pids.some((p) => !Number.isInteger(p))` -> `false`   input: examples[0]
  test("no target but '--' starts with a dash other than the group, all positive integers", () => {
    const junk = fc
      .array(fc.oneof(fc.constantFrom("\t", "\0", " ", "-", "0", "1", "-1", "/t/tasks/a.output", "x"), fc.string({ maxLength: 6 })), { maxLength: 60 })
      .map((a) => a.join(""));
    fc.assert(
      fc.property(junk, (out) => {
        const parsed = parseScan(out);
        const runs = parsed.map((s, i) => run({ id: `r${i}`, outputFile: s.file, taskId: `t${i}` }));
        for (const r of applyScan(runs, parsed, T0 + 1).runs)
          for (const x of killTargets(r).slice(1)) expect(x).toMatch(/^-?[1-9][0-9]*$/);
        for (const r of applyScan(runs, parsed, T0 + 1).runs)
          expect(killTargets(r).slice(2).every((x) => /^[1-9][0-9]*$/.test(x))).toBe(true);
      }),
      opts({ examples: [["1\t1 -1\t0\t0\t0\t0\t0\t0\t/t/tasks/a.output\tc\0"]] }),
    );
  });
});

describe("P4 parseScan, short records", () => {
  // P4 (Q4: "a malformed scan record is skipped"): a record without its command-line field
  // mutant: core.ts:127 `f.length < 10` -> `f.length < 9`   input: examples[0]
  test("a record of nine fields is skipped", () => {
    fc.assert(
      fc.property(arbShell, (sh) => {
        const nine = record(sh).slice(0, -1).split("\t").slice(0, 9).join("\t");
        expect(parseScan(`${nine}\0`)).toEqual([]);
      }),
      opts({ examples: [[fcShell0]] }),
    );
  });
});

describe("P8 trim", () => {
  // P8 (Q5: "live runs never dropped, order kept"; plus fleet's Lean-proven trim theorems:
  //     length <= keep unless live alone exceed it, the ended kept are the newest)
  // mutant: core.ts:286 `ended.slice(0, ...)` -> `ended.slice(1, ...)`   input: 2 ended, keep 1
  test("keeps live runs and the newest ended, in order, keep in all when it can", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 80 }),
        fc.integer({ min: 1, max: 50 }),
        (e, keep) => {
          const runs = e.map((x, i) =>
            run({ id: `r${i}`, ...(x ? { endedAt: T0 } : {}) }),
          );
          const kept = trim(runs, keep);
          const live = runs.filter((r) => r.endedAt === undefined);
          expect(live.every((r) => kept.includes(r))).toBe(true);
          expect(kept).toEqual(runs.filter((r) => kept.includes(r)));
          expect(kept.length).toBe(
            Math.max(Math.min(runs.length, keep), live.length),
          );
          const endedKept = kept.filter((r) => r.endedAt !== undefined);
          const ended = runs.filter((r) => r.endedAt !== undefined);
          expect(endedKept).toEqual(
            ended.slice(ended.length - endedKept.length),
          );
        },
      ),
      opts({ examples: [[[true, true], 1]] }),
    );
  });
});

/* ------------------------------------------------------------------------------------------ */
/* P7: the look loop, model-based. The world knows each call's real shell; the watchdog sees only
 * the scan. The step below mirrors register.tsx `look`/`tool.call`/`session.append` by hand
 * (listed under Assumptions): applyScan, then isStuck -> killedAt + TERM, else needsKill -> KILL. */

const TICK = 10_000;

type Call = {
  command: string;
  bg: boolean;
  callAt: number;
  spawnDelay: number;
  lifeMs: number;
  ignoresTerm: boolean;
  taskStopOk: boolean;
  /** per look: q quiet, g output, c CPU, i I/O, s sleep, v serve */
  acts: string[];
};

const arbCall = fc.record({
  command: arbCmd,
  bg: fc.boolean(),
  callAt: fc.integer({ min: 1, max: 8 * TICK }),
  spawnDelay: fc.integer({ min: 0, max: 15_000 }),
  lifeMs: fc.oneof(
    fc.integer({ min: 1_000, max: 30 * TICK }),
    fc.constant(Infinity),
  ),
  ignoresTerm: fc.boolean(),
  taskStopOk: fc.boolean(),
  acts: fc.array(
    fc.constantFrom("q", "q", "q", "q", "q", "q", "g", "c", "i", "s", "v"),
    {
      minLength: 30,
      maxLength: 30,
    },
  ),
});

type Sig = {
  run: string;
  sig: "TERM" | "KILL" | "STOP";
  at: number;
  targets: string[];
};

/** Look times: irregular gaps, since a reload re-arms the poll and a slow look skips one. */
const lookTimes = (gaps: number[]) => gaps.reduce<number[]>((ts, g) => [...ts, (ts.at(-1) ?? T0) + g], []);

function simulate(calls: Call[], pids: number[], gaps: number[]) {
  const looks = lookTimes(gaps);
  const pidOf = (i: number) => pids[i]!;
  const real = calls.map((c, i) => ({
    i,
    pid: pidOf(i),
    tree: [pidOf(i), pidOf(i) + 1],
    spawn: T0 + c.callAt + c.spawnDelay,
    exit: T0 + c.callAt + c.spawnDelay + c.lifeMs,
    file: `/t/tasks/${i}.output`,
    size: 0,
    cpu: 0,
    io: 0,
    looks: 0,
    lastAct: T0 + c.callAt,
  }));
  let runs: WatchRun[] = [];
  const sigs: Sig[] = [];
  const violations: string[] = [];
  const callEnded = new Set<number>();

  const deliver = (
    rid: string,
    sig: Sig["sig"],
    at: number,
    targets: string[],
  ) => {
    sigs.push({ run: rid, sig, at, targets });
    const own = real[Number(rid.slice(1))]!;
    for (const t of targets.filter((x) => x !== "--")) {
      const p = Number(t.startsWith("-") ? t.slice(1) : t);
      const hit = real.find((x) =>
        t.startsWith("-") ? x.pid === p : x.tree.includes(p),
      );
      // P7 world check: a signal reaches only the run's own real tree (pgid = its shell's pid)
      if (hit && hit !== own)
        violations.push(`${sig} for ${rid} hit call ${hit.i}'s tree at ${at}`);
      if (!hit) violations.push(`${sig} for ${rid} hit unknown pid ${t}`);
      if (
        hit &&
        hit.exit > at &&
        (sig === "KILL" || !calls[hit.i]!.ignoresTerm)
      )
        hit.exit = at;
    }
  };

  for (let k = 0; k < looks.length; k++) {
    const now = looks[k]!;
    const from = k === 0 ? T0 : looks[k - 1]!;
    // events between the looks, in time order: calls, bg results, ends of calls
    const evs: { at: number; f: () => void }[] = [];
    calls.forEach((c, i) => {
      const at = T0 + c.callAt;
      if (at > from && at <= now)
        evs.push({
          at,
          f: () =>
            (runs = trim([
              ...runs,
              { id: `r${i}`, command: c.command, startedAt: at },
            ])),
        });
      if (c.bg && at + c.spawnDelay + 1 > from && at + c.spawnDelay + 1 <= now)
        evs.push({
          // the engine answers a background call once its shell is up
          at: at + c.spawnDelay + 1,
          f: () =>
            (runs = runs.map((x) =>
              x.id === `r${i}`
                ? { ...x, taskId: `t${i}`, outputFile: real[i]!.file }
                : x,
            )),
        });
    });
    real.forEach((s, i) => {
      if (s.exit > from && s.exit <= now && !callEnded.has(i))
        evs.push({
          at: s.exit,
          f: () => {
            callEnded.add(i);
            // fg: the call answers; bg: the task notification ends it
            runs = runs.map((x) =>
              x.id === `r${i}` && x.endedAt === undefined
                ? endedAt(x, s.exit)
                : x,
            );
          },
        });
    });
    for (const e of evs.sort((a, b) => a.at - b.at)) e.f();
    if (!runs.some(isWatched)) continue;

    // the scan: every real shell standing now, in pid order
    const shells: ScanShell[] = [];
    for (const s of [...real].sort((a, b) => a.pid - b.pid)) {
      if (s.spawn > now || s.exit <= now) continue;
      const act = calls[s.i]!.acts[s.looks] ?? "q";
      if (act === "g") s.size++;
      if (act === "c") s.cpu += 2 * ACTIVE_TICKS;
      if (act === "i") s.io += 2 * ACTIVE_IO_BYTES;
      // CPU and I/O on a shell's first look are a baseline, as documented
      if (act !== "q" && !(s.looks === 0 && (act === "c" || act === "i"))) s.lastAct = now;
      s.looks++;
      shells.push({
        pid: s.pid,
        pids: s.tree,
        ticks: s.cpu,
        sleeping: act === "s",
        io: s.io,
        serving: act === "v",
        ageMs: now - s.spawn,
        size: s.size,
        file: s.file,
        cmdline: `zsh -c source snap && ${evalQuoted(calls[s.i]!.command)} < /dev/null`,
      });
    }
    const stuck: WatchRun[] = [];
    const kill: WatchRun[] = [];
    const a = applyScan(runs, shells, now);
    runs = a.runs.map((r) => {
      if (isStuck(r, now, LIMIT)) {
        stuck.push(r);
        return { ...r, killedAt: now };
      }
      if (needsKill(r, now)) {
        kill.push(r);
        return { ...r, killSent: true };
      }
      return r;
    });
    for (const r of stuck) {
      const i = Number(r.id.slice(1));
      // P7 (Q5: "never signal a non-stuck run"): its real shell was quiet for the limit
      const s = real[i]!;
      if (now - s.lastAct < LIMIT && s.exit > now)
        violations.push(
          `r${i} stopped at ${now} though its shell was active at ${s.lastAct}`,
        );
      if (r.taskId && calls[i]!.taskStopOk) {
        sigs.push({ run: r.id, sig: "STOP", at: now, targets: [] });
        if (s.exit > now) s.exit = now;
      } else deliver(r.id, "TERM", now, killTargets(r));
    }
    for (const r of kill) deliver(r.id, "KILL", now, killTargets(r));
  }
  return { sigs, violations, runs, real };
}

const endedAt = (r: WatchRun, at: number): WatchRun => {
  const { pids: _, ...rest } = r;
  return { ...rest, endedAt: at };
};

const arbWorld = fc
  .array(arbCall, { minLength: 1, maxLength: 6 })
  .chain((calls) =>
    fc.tuple(
      fc.constant(calls),
      fc.uniqueArray(
        fc.integer({ min: 1, max: 500 }).map((n) => n * 10),
        {
          minLength: calls.length,
          maxLength: calls.length,
        },
      ),
      fc.array(fc.integer({ min: 1_000, max: 20_000 }), { minLength: 30, maxLength: 30 }),
    ),
  );

const EVEN = Array(30).fill(TICK);
const P7_EXAMPLES: [[Call[], number[], number[]]][] = [
          [
            [
              [
                {
                  command: "x",
                  bg: false,
                  callAt: 1,
                  spawnDelay: 0,
                  lifeMs: Infinity,
                  ignoresTerm: true,
                  taskStopOk: false,
                  acts: Array(30).fill("q"),
                },
              ],
              [100],
              EVEN,
            ],
          ],
          [
            [
              [
                {
                  command: "a",
                  bg: false,
                  callAt: 1,
                  spawnDelay: 12_000,
                  lifeMs: Infinity,
                  ignoresTerm: false,
                  taskStopOk: false,
                  acts: Array(30).fill("v"),
                },
                {
                  command: "a' b",
                  bg: false,
                  callAt: 1_001,
                  spawnDelay: 0,
                  lifeMs: Infinity,
                  ignoresTerm: false,
                  taskStopOk: false,
                  acts: Array(30).fill("q"),
                },
              ],
              [200, 100],
              EVEN,
            ],
          ],
        ];

describe("P7 the look loop", () => {
  // P7a (Q5: "never signal a non-stuck run"; Q7 Critical: "signals an unrelated process": a
  //      signal reaches only the run's own real tree)
  // mutant: core.ts:178 `x.cmdline.includes(q)` -> `true`   input: examples[1] (two calls)
  test("signals reach only the run's own tree, and only once its shell was quiet", () => {
    fc.assert(
      fc.property(arbWorld, ([calls, pids, gaps]) => {
        const { violations } = simulate(calls, pids, gaps);
        expect([...new Set(violations)]).toEqual([]);
      }),
      opts({ numRuns: RUNS * 3, examples: P7_EXAMPLES }),
    );
  });

  // P7a, the same world checks where no call's quoted command equals or sits inside another's:
  // a sub-case of the property above, kept so its checks still bite while that one is VIOLATED
  // mutant: core.ts:258 `quietMs(r, now) >= limitMs` -> `quietMs(r, now) < limitMs`   input: random
  test("distinct commands: signals reach only the run's own tree, once its shell was quiet", () => {
    const distinct = arbWorld.filter(([calls]) => {
      const q = calls.map((c) => evalQuoted(c.command));
      return q.every((a, i) => q.every((b, j) => i === j || !b.includes(a)));
    });
    fc.assert(
      fc.property(distinct, ([calls, pids, gaps]) => {
        const { violations } = simulate(calls, pids, gaps);
        expect([...new Set(violations)]).toEqual([]);
      }),
      opts({ numRuns: RUNS * 3, examples: [P7_EXAMPLES[0]!] }),
    );
  });

  // P7b (Q5: "<= 1 TERM and <= 1 KILL per run, the KILL >= 10 s after the TERM")
  // mutant: core.ts:263 `!r.killSent &&` -> `` (dropped)   input: examples[0], a quiet fg call that ignores TERM
  // mutant: core.ts:265 `>= KILL_GRACE_MS` -> `>= 0`   input: same
  test("one stop, one KILL after the grace", () => {
    fc.assert(
      fc.property(arbWorld, ([calls, pids, gaps]) => {
        const { sigs } = simulate(calls, pids, gaps);
        for (const id of new Set(sigs.map((s) => s.run))) {
          const mine = sigs.filter((s) => s.run === id);
          const stops = mine.filter((s) => s.sig !== "KILL");
          const kills = mine.filter((s) => s.sig === "KILL");
          expect(stops.length).toBeLessThanOrEqual(1);
          expect(kills.length).toBeLessThanOrEqual(1);
          if (kills.length) {
            expect(stops.length).toBe(1);
            expect(kills[0]!.at - stops[0]!.at).toBeGreaterThanOrEqual(GRACE);
          }
        }
      }),
      opts({ numRuns: RUNS * 3, examples: P7_EXAMPLES }),
    );
  });

  // P7e (Q7 High: "a stuck command is never stopped" is a finding): a call whose real shell stays
  // quiet gets stopped by the look after the first one at which it is up and quiet for the limit
  // mutant: core.ts:258 `quietMs(r, now) >= limitMs` -> `quietMs(r, now) > 10 * limitMs`   input: example 1
  test("a call whose shell stays quiet is stopped within a look of its limit", () => {
    fc.assert(
      fc.property(arbWorld, ([calls, pids, gaps]) => {
        const quiet = calls.map((c) => ({
          ...c,
          acts: Array(30).fill("q"),
          lifeMs: Infinity,
        }));
        const { sigs, real } = simulate(quiet, pids, gaps);
        const looks = lookTimes(gaps);
        quiet.forEach((c, i) => {
          // the twin rule (user, F2 fix): a call sharing its command with another may be held back
          if (quiet.some((o, j) => j !== i && o.command === c.command)) return;
          // the first look its shell is up and its quiet time reached, then one look more
          const at = looks.findIndex((t) => t >= Math.max(T0 + c.callAt + LIMIT, real[i]!.spawn));
          const due = at < 0 ? undefined : looks[at + 1];
          if (due === undefined) return;
          expect(
            sigs.some(
              (s) => s.run === `r${i}` && s.sig !== "KILL" && s.at <= due,
            ),
          ).toBe(true);
        });
      }),
      opts({
        examples: [
          [
            [
              [
                {
                  command: "x",
                  bg: false,
                  callAt: 1,
                  spawnDelay: 0,
                  lifeMs: Infinity,
                  ignoresTerm: false,
                  taskStopOk: false,
                  acts: [],
                },
              ],
              [100],
              EVEN,
            ],
          ],
        ],
      }),
    );
  });
});
