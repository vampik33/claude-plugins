/**
 * Property tests for watchdog/hooks/core.ts pure functions, and the scan
 * script against this machine's real process table.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { WatchRun } from "../../plugins/watchdog/types";
import {
  ACTIVE_IO_BYTES,
  ACTIVE_TICKS,
  applyScan,
  bandItems,
  evalQuoted,
  isStuck,
  isWatched,
  killNote,
  killTargets,
  matchShells,
  needsKill,
  parseScan,
  quietMs,
  SCAN_SCRIPT,
  statusOf,
  type ScanShell,
  summary,
  trim,
} from "../../plugins/watchdog/hooks/core.ts";

const MIN = 60_000;
const LIMIT = 10 * MIN;
const T0 = 1_000_000;

const run = (o: Partial<WatchRun> = {}): WatchRun => ({
  id: "r1",
  command: "./hang.sh",
  startedAt: T0,
  ...o,
});

const shell = (o: Partial<ScanShell> = {}): ScanShell => ({
  pid: 10,
  pids: [10, 11],
  ticks: 0,
  sleeping: false,
  io: 0,
  serving: false,
  ageMs: 0,
  size: 0,
  file: "/t/tasks/a.output",
  cmdline: "zsh -c eval './hang.sh'",
  ...o,
});

const record = (s: ScanShell) =>
  `${s.pid}\t${s.pids.join(" ")}\t${s.ticks}\t${s.sleeping ? 1 : 0}\t${s.io}\t${s.serving ? 1 : 0}\t${s.ageMs}\t${s.size}\t${s.file}\t${s.cmdline}\0`;

const arbShell = fc.record({
  pid: fc.integer({ min: 2, max: 4_000_000 }),
  pids: fc.array(fc.integer({ min: 2, max: 4_000_000 }), {
    minLength: 1,
    maxLength: 6,
  }),
  ticks: fc.nat(),
  sleeping: fc.boolean(),
  io: fc.nat(),
  serving: fc.boolean(),
  ageMs: fc.nat(),
  size: fc.nat(),
  file: fc.stringMatching(/^\/[a-z/]{1,20}\.output$/),
  // a command line may hold tabs and newlines, never a NUL
  cmdline: fc.string().filter((s) => !s.includes("\0")),
});

describe("parseScan", () => {
  test("reads back every record it is given, tabs in the command line included", () => {
    fc.assert(
      fc.property(fc.array(arbShell, { maxLength: 5 }), (shells) => {
        expect(parseScan(shells.map(record).join(""))).toEqual(shells);
      }),
      { numRuns: 500 },
    );
  });

  test("never throws on junk, and keeps only well-formed records", () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        for (const s of parseScan(junk)) {
          expect(Number.isInteger(s.pid) && s.pid > 0).toBe(true);
          expect(s.file.length).toBeGreaterThan(0);
          expect(s.ageMs).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  test("a shell gone mid-scan (age -1) is skipped", () => {
    expect(parseScan(record(shell({ ageMs: -1 })))).toEqual([]);
  });
});

describe("evalQuoted / matchShells", () => {
  test("a call finds its shell by the quoted command, whatever quotes it holds", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (a, b) => {
          fc.pre(
            a !== b &&
              !evalQuoted(b).includes(evalQuoted(a)) &&
              !evalQuoted(a).includes(evalQuoted(b)),
          );
          const runs = [
            run({ id: "A", command: a }),
            run({ id: "B", command: b }),
          ];
          const shells = [
            shell({
              pid: 2,
              file: "/t/b.output",
              cmdline: `zsh -c x && ${evalQuoted(b)} && pwd`,
            }),
            shell({
              pid: 1,
              file: "/t/a.output",
              cmdline: `zsh -c x && ${evalQuoted(a)} && pwd`,
            }),
          ];
          const m = matchShells(runs, shells, T0 + 10_000);
          expect(m.get("A")?.file).toBe("/t/a.output");
          expect(m.get("B")?.file).toBe("/t/b.output");
        },
      ),
    );
  });

  test("a shell another run owns is never taken; one call and one new shell pair up", () => {
    const owned = run({ id: "bg", taskId: "b1", outputFile: "/t/x.output" });
    const m = matchShells(
      [owned, run({ id: "A", command: "quoted differently" })],
      [
        shell({ file: "/t/x.output", cmdline: "x" }),
        shell({ file: "/t/y.output", cmdline: "y" }),
      ],
      T0 + 10_000,
    );
    expect(m.get("A")?.file).toBe("/t/y.output");
    expect(m.has("bg")).toBe(false);
  });

  test("two unmatched calls and two new shells stay unpaired", () => {
    const m = matchShells(
      [run({ id: "A", command: "a" }), run({ id: "B", command: "b" })],
      [
        shell({ file: "/t/1.output", cmdline: "?" }),
        shell({ file: "/t/2.output", cmdline: "?" }),
      ],
      T0 + 10_000,
    );
    expect(m.size).toBe(0);
  });

  test("the fallback takes a shell only if it started after the call (a second of slack)", () => {
    fc.assert(
      fc.property(fc.nat({ max: 60 * MIN }), fc.nat({ max: 10 * MIN }), (ageMs, after) => {
        const now = T0 + after;
        const m = matchShells(
          [run({ id: "A", command: "quoted differently" })],
          [shell({ ageMs, cmdline: "?" })],
          now,
        );
        expect(m.has("A")).toBe(now - ageMs >= T0 - 1_000);
      }),
    );
  });

  test("a shell that stood before the call does not count against a new one", () => {
    const m = matchShells(
      [run({ id: "A", command: "quoted differently" })],
      [
        shell({ file: "/t/old.output", ageMs: 60 * MIN, cmdline: "?" }),
        shell({ file: "/t/new.output", ageMs: 0, cmdline: "?" }),
      ],
      T0 + 10_000,
    );
    expect(m.get("A")?.file).toBe("/t/new.output");
  });
});

describe("applyScan", () => {
  test("output growth and CPU use move the quiet clock; idle ticks do not", () => {
    // the first look's ticks are a baseline, not work
    const first = applyScan([run()], [shell({ size: 0, ticks: 100 })], T0 + 10_000).runs[0]!;
    expect(first.pid).toBe(10);
    expect(first.activeAt).toBeUndefined();
    const printed = applyScan([first], [shell({ size: 5, ticks: 100 })], T0 + 20_000).runs[0]!;
    expect(printed.activeAt).toBe(T0 + 20_000);
    const idle = applyScan(
      [printed],
      [shell({ size: 5, ticks: 100 + ACTIVE_TICKS - 1 })],
      T0 + 30_000,
    ).runs[0]!;
    expect(idle.activeAt).toBe(T0 + 20_000);
    const busy = applyScan(
      [idle],
      [shell({ size: 5, ticks: 100 + 2 * ACTIVE_TICKS })],
      T0 + 40_000,
    ).runs[0]!;
    expect(busy.activeAt).toBe(T0 + 40_000);
  });

  test("reading or writing a slow download's worth of data moves the quiet clock; less does not", () => {
    const first = applyScan([run()], [shell({ io: 1_000_000 })], T0 + 10_000).runs[0]!;
    expect(first.activeAt).toBeUndefined();
    const idle = applyScan([first], [shell({ io: 1_000_000 + ACTIVE_IO_BYTES - 1 })], T0 + 20_000).runs[0]!;
    expect(idle.activeAt).toBeUndefined();
    const moving = applyScan([idle], [shell({ io: 1_000_000 + 2 * ACTIVE_IO_BYTES })], T0 + 30_000).runs[0]!;
    expect(moving.activeAt).toBe(T0 + 30_000);
    // a tree whose processes exit sums less: never activity
    const shrunk = applyScan([moving], [shell({ io: 0 })], T0 + 40_000).runs[0]!;
    expect(shrunk.activeAt).toBe(T0 + 30_000);
  });

  test("a serving tree is never stuck, however long it idles", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), (looks) => {
        let r = run();
        for (let i = 1; i <= looks; i++)
          r = applyScan([r], [shell({ serving: true })], T0 + i * 10_000).runs[0]!;
        expect(isStuck(r, T0 + looks * 10_000, LIMIT)).toBe(false);
        expect(summary([r], T0 + looks * 10_000, LIMIT)).toContain("· serving");
      }),
      { numRuns: 50 },
    );
  });

  test("a run whose file no shell holds has ended; a stopped one stays stopped", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (isKilled) => {
          const r = applyScan(
            [run({ outputFile: "/t/gone.output", pid: 3, ...(isKilled ? { killedAt: T0 } : {}) })],
            [],
            T0 + 5,
          ).runs[0]!;
          expect(r.endedAt).toBe(T0 + 5);
          expect(statusOf(r)).toBe(isKilled ? "killed" : "done");
        },
      ),
    );
  });

  test("a waiting foreground call with no shell yet is left as it is", () => {
    const r = run();
    expect(applyScan([r], [], T0 + 5).runs[0]).toBe(r);
  });
});

describe("isStuck", () => {
  test("exactly when running, with a shell, and quiet for the limit", () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat({ max: 30 * MIN })),
        fc.nat({ max: 30 * MIN }),
        fc.boolean(),
        (active, at, hasPid) => {
          const r = run({
            ...(active === null ? {} : { activeAt: T0 + active }),
            ...(hasPid ? { pid: 9 } : {}),
          });
          const now = T0 + at;
          expect(quietMs(r, now)).toBe(now - T0 - (active ?? 0));
          expect(isStuck(r, now, LIMIT)).toBe(hasPid && quietMs(r, now) >= LIMIT);
        },
      ),
    );
  });

  test("never for a run already stopped or ended", () => {
    expect(
      isStuck(run({ pid: 9, killedAt: T0 }), T0 + 2 * LIMIT, LIMIT),
    ).toBe(false);
    expect(
      isStuck(run({ pid: 9, endedAt: T0 + 1 }), T0 + 2 * LIMIT, LIMIT),
    ).toBe(false);
  });

  test("one KILL follows the grace, even once the shell is gone (a child may outlive it)", () => {
    const r = run({ killedAt: T0, pid: 3, pids: [3, 4] });
    expect(needsKill(r, T0 + 9_999)).toBe(false);
    expect(needsKill(r, T0 + 10_000)).toBe(true);
    expect(isWatched(r)).toBe(true);
    // the shell gone: the scan dropped its pids, the group still gets the KILL
    const gone = applyScan([{ ...r, outputFile: "/t/a.output" }], [], T0 + 1).runs[0]!;
    expect(gone.endedAt).toBe(T0 + 1);
    expect(isWatched(gone)).toBe(true);
    expect(needsKill(gone, T0 + 19_000)).toBe(true);
    expect(killTargets(gone)).toEqual(["--", "-3"]);
    expect(killTargets(r)).toEqual(["--", "-3", "3", "4"]);
    const sent = { ...gone, killSent: true };
    expect(needsKill(sent, T0 + 19_000)).toBe(false);
    expect(isWatched(sent)).toBe(false);
  });

  test("a sleep longer than the limit leaves what follows it the whole limit", () => {
    let r = applyScan([run()], [shell({ sleeping: true })], T0 + 10_000).runs[0]!;
    for (let t = 20_000; t <= 2 * LIMIT; t += 10_000)
      r = applyScan([r], [shell({ sleeping: true })], T0 + t).runs[0]!;
    // the sleep ended; the next step is quiet and idle
    const after = applyScan([r], [shell()], T0 + 2 * LIMIT + 10_000).runs[0]!;
    expect(isStuck(after, T0 + 2 * LIMIT + 10_000, LIMIT)).toBe(false);
    expect(isStuck(after, T0 + 3 * LIMIT - 1, LIMIT)).toBe(false);
    expect(isStuck(after, T0 + 3 * LIMIT, LIMIT)).toBe(true);
  });
});

describe("killNote", () => {
  test("the output line stays inside one <output> block, whatever it holds", () => {
    fc.assert(
      // a last line is one line; tag pieces make nested spellings likely
      fc.property(
        fc
          .array(fc.constantFrom("<", "/", "output", ">", "OUTPUT", "x", " "), { minLength: 1, maxLength: 30 })
          .map((a) => a.join("")),
        (line) => {
        const note = killNote(run({ line, killedAt: T0 }), T0 + MIN, LIMIT);
        expect(note.match(/<output>/gi)).toHaveLength(1);
        expect(note.match(/<\/output>/gi)).toHaveLength(1);
        expect(note.trimEnd().split("\n").at(-2)).toMatch(/^<output>[\s\S]*<\/output>$/);
        },
      ),
    );
  });
});

describe("trim / words", () => {
  test("trim keeps every live run and at most `keep` in all when it can", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 80 }),
        fc.integer({ min: 1, max: 50 }),
        (ended, keep) => {
          const runs = ended.map((e, i) =>
            run({ id: `r${i}`, ...(e ? { endedAt: T0 } : {}) }),
          );
          const kept = trim(runs, keep);
          const live = runs.filter((r) => r.endedAt === undefined);
          expect(live.every((r) => kept.includes(r))).toBe(true);
          expect(kept.length).toBe(
            Math.max(Math.min(runs.length, keep), live.length),
          );
        },
      ),
    );
  });

  test("the band warns from half the limit and shows a stop for one limit", () => {
    const r = run({ pid: 9 });
    expect(bandItems([r], T0 + LIMIT / 2 - 1, LIMIT)).toEqual([]);
    expect(bandItems([r], T0 + LIMIT / 2, LIMIT)).toEqual([
      "⚠ hang.sh quiet 5m/10m",
    ]);
    const k = run({ killedAt: T0, endedAt: T0 + 1 });
    expect(bandItems([k], T0 + LIMIT - 1, LIMIT)).toEqual([
      "✗ hang.sh stopped",
    ]);
    expect(bandItems([k], T0 + LIMIT, LIMIT)).toEqual([]);
  });

  test("the summary has one line per run under its head", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom({}, { endedAt: T0 }, { killedAt: T0 }), { maxLength: 10 }),
        (states) => {
          const runs = states.map((st, i) => run({ id: `r${i}`, ...st }));
          const lines = summary(runs, T0 + MIN, LIMIT).split("\n");
          expect(lines.length).toBe(1 + Math.max(runs.length, 1));
        },
      ),
    );
  });
});

describe("SCAN_SCRIPT on this machine", () => {
  /** Scans this process's children; answers the shell writing to `file`. */
  const scanFor = (file: string) => {
    const p = Bun.spawnSync(["bash", "-c", SCAN_SCRIPT, "scan", String(process.pid)]);
    expect(p.exitCode).toBe(0);
    return parseScan(p.stdout.toString()).find((s) => s.file === file);
  };

  test("finds a child shell writing to a task file, its tree, its CPU and a sleep in it", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/watchdog-scan-${process.pid}/tasks`;
    await Bun.$`mkdir -p ${dir}`;
    const file = `${dir}/t1.output`;
    // a shell whose stdout is the task file, burning CPU then sleeping (the last `true` keeps bash from exec-ing into sleep, so the tree has two)
    const child = Bun.spawn(
      ["bash", "-c", "echo hello; timeout 1 yes >/dev/null; sleep 30; true"],
      {
        stdout: Bun.file(file),
      },
    );
    try {
      const scan = () => scanFor(file);
      await Bun.sleep(300);
      const busy = scan();
      expect(busy?.pid).toBe(child.pid);
      expect(busy?.size).toBe("hello\n".length);
      await Bun.sleep(1_200);
      const after = scan();
      expect(after!.ticks - busy!.ticks).toBeGreaterThanOrEqual(ACTIVE_TICKS);
      expect(after!.sleeping).toBe(true);
      expect(after!.pids.length).toBeGreaterThanOrEqual(2);
    } finally {
      child.kill();
      await Bun.$`rm -rf ${dir}/..`;
    }
  });

  test("a server and a watcher serve, an idle shell does not; a reaped child's I/O stays in the tree; the age is the shell's", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/watchdog-serve-${process.pid}/tasks`;
    await Bun.$`mkdir -p ${dir}`;
    const log = `${dir}/../app.log`;
    await Bun.write(log, "");
    // each `; true` keeps bash from exec-ing into its last command
    const kids = {
      server: "python3 -m http.server 0 --bind 127.0.0.1; true",
      watcher: `tail -f ${log}; true`,
      idle: "sleep 30; true",
      copy: "sleep 0.5; head -c 10000000 /dev/zero > /dev/null; sleep 30; true",
    };
    const children = Object.entries(kids).map(([name, cmd]) =>
      Bun.spawn(["bash", "-c", cmd], { stdout: Bun.file(`${dir}/${name}.output`) }),
    );
    try {
      const scan = (name: string) => scanFor(`${dir}/${name}.output`)!;
      await Bun.sleep(200);
      const before = { copy: scan("copy"), idle: scan("idle") };
      await Bun.sleep(1_800);
      const after = (name: string) => scan(name);
      expect(after("server").serving).toBe(true);
      expect(after("watcher").serving).toBe(true);
      expect(after("idle").serving).toBe(false);
      // head has exited and been reaped: its reads stay in its parent's count
      expect(after("copy").io - before.copy.io).toBeGreaterThanOrEqual(10_000_000);
      expect(after("idle").io - before.idle.io).toBeLessThan(ACTIVE_IO_BYTES);
      // started about 2 s before the second scan
      expect(after("idle").ageMs).toBeGreaterThanOrEqual(1_500);
      expect(after("idle").ageMs).toBeLessThan(5_000);
    } finally {
      // the shells' children first: an orphaned server would hold the test's output open
      for (const c of children) Bun.spawnSync(["pkill", "-P", String(c.pid)]);
      for (const c of children) c.kill();
      await Bun.$`rm -rf ${dir}/..`;
    }
  });

  test("thousands of TCP sockets on the machine still leave the tree's CPU, I/O and age read", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/watchdog-many-${process.pid}/tasks`;
    await Bun.$`mkdir -p ${dir}/../bin`;
    // an ss listing 8000 established sockets: as one awk argument, past the kernel's 128 KiB limit
    await Bun.write(
      `${dir}/../bin/ss`,
      `#!/bin/sh\nawk 'BEGIN { for (i = 0; i < 8000; i++) printf "ESTAB 0 0 127.0.0.1:%d 127.0.0.1:1 ino:%d sk:1 <->\\n\\t cubic bytes_acked:1 bytes_received:123456\\n", i, 9000000 + i }'\n`,
    );
    await Bun.$`chmod +x ${dir}/../bin/ss`;
    const file = `${dir}/busy.output`;
    const child = Bun.spawn(["bash", "-c", "timeout 1 yes >/dev/null; sleep 30; true"], {
      stdout: Bun.file(file),
    });
    const env = { ...process.env, PATH: `${dir}/../bin:${process.env.PATH}` };
    const scan = () => {
      const p = Bun.spawnSync(["bash", "-c", SCAN_SCRIPT, "scan", String(process.pid)], { env });
      expect(p.exitCode).toBe(0);
      return parseScan(p.stdout.toString()).find((s) => s.file === file)!;
    };
    try {
      await Bun.sleep(300);
      const busy = scan();
      await Bun.sleep(1_200);
      const after = scan();
      expect(after.ticks - busy.ticks).toBeGreaterThanOrEqual(ACTIVE_TICKS);
      expect(after.ageMs).toBeGreaterThanOrEqual(1_000);
    } finally {
      Bun.spawnSync(["pkill", "-P", String(child.pid)]);
      child.kill();
      await Bun.$`rm -rf ${dir}/..`;
    }
  });

  test("a quiet client receiving into memory from a server outside its tree moves data", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/watchdog-tcp-${process.pid}/tasks`;
    await Bun.$`mkdir -p ${dir}`;
    // the server's stdout is a pipe, not a task file: no shell of the scan's
    const server = Bun.spawn([
      "python3",
      "-c",
      `import socket, time
l = socket.socket(); l.bind(("127.0.0.1", 0)); l.listen(1)
print(l.getsockname()[1], flush=True)
c, _ = l.accept(); c.sendall(b"x" * 10_000_000); time.sleep(30)`,
    ], { stdout: "pipe" });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const { value } = await server.stdout.getReader().read();
      const port = Number(new TextDecoder().decode(value).trim());
      // recv into memory: no read/write, so rchar/wchar barely move; the socket stays open so its counters do
      const client = `import socket, sys, time
s = socket.create_connection(("127.0.0.1", int(sys.argv[1]))); n = 0
while n < 10_000_000:
    b = s.recv(1 << 20)
    if not b: break
    n += len(b)
time.sleep(30)`;
      child = Bun.spawn(["bash", "-c", `sleep 0.5; python3 -c '${client}' ${port}; true`], {
        stdout: Bun.file(`${dir}/client.output`),
      });
      const scan = () => scanFor(`${dir}/client.output`)!;
      await Bun.sleep(200);
      const before = scan();
      await Bun.sleep(1_800);
      const after = scan();
      expect(after.io - before.io).toBeGreaterThanOrEqual(10_000_000);
    } finally {
      // the shell's children first: an orphaned client would hold the test's output open
      if (child) Bun.spawnSync(["pkill", "-P", String(child.pid)]);
      child?.kill();
      server.kill();
      await Bun.$`rm -rf ${dir}/..`;
    }
  });
});
