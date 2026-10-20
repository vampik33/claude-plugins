import { describe, expect, mock, test } from "claude-code/testing";

import { evalQuoted } from "../hooks/core.ts";

const ROOT = 100;
const MIN = 60_000;

/** A shell the fake process table holds, by its output file. */
type Proc = {
  pid: number;
  pids: number[];
  ticks: number;
  sleeping?: boolean;
  /** Bytes read and written */
  io?: number;
  serving?: boolean;
  /** When the shell started, on the mock clock */
  born?: number;
  out: string;
  command: string;
};

/** The engine beneath the mod: a process table, Bash calls held until released (background ones too, if asked), scans that answer late (if asked), and what the mod did. */
function engine(on: any, { holdBackground = false, scanDelay = 0 } = {}) {
  const procs = new Map<string, Proc>();
  const seen = {
    kills: [] as string[][],
    stops: [] as string[],
    prompts: [] as string[],
    toasts: [] as string[],
    logs: [] as string[],
  };
  const held: (() => void)[] = [];
  const clock = mock.clock(on, { now: Date.parse("2026-10-19T10:00:00Z") });
  const run = (stdout: string, exitCode = 0) => ({
    value: { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
  });
  on("process.run", (_$: unknown, e: { argv: string[] }) => {
    const [cmd] = e.argv;
    if (cmd === "sh") return run(`${ROOT}\n`);
    if (cmd === "bash") {
      // the ages are taken as the scan starts, as the real one samples the uptime
      const t = clock.now();
      const out = run(
        [...procs.entries()]
          .map(
            ([file, p]) =>
              `${p.pid}\t${p.pids.join(" ")}\t${p.ticks}\t${p.sleeping ? 1 : 0}\t${p.io ?? 0}\t${p.serving ? 1 : 0}\t${t - (p.born ?? t)}\t${p.out.length}\t${file}\t/usr/bin/zsh -c source snap && ${evalQuoted(p.command)} && pwd -P \0`,
          )
          .join(""),
      );
      return scanDelay ? clock.sleep(scanDelay).then(() => out) : out;
    }
    if (cmd === "tail") {
      const p = procs.get(e.argv.at(-1)!);
      return p ? run(p.out) : run("", 1);
    }
    if (cmd === "kill") seen.kills.push(e.argv.slice(1));
    return run("");
  });
  on("session.start", (_$: unknown, e: unknown) => e as never);
  on("command.register", () => ({ value: undefined }));
  on("ui.render", () => h("Box", null));
  on("ui.toast", (_$: unknown, e: { text: string }) => (seen.toasts.push(e.text), { value: undefined }));
  on("ui.log", (_$: unknown, e: { text: string }) => (seen.logs.push(e.text), { value: undefined }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("prompt.submit", (_$: unknown, e: { text: string }) => (seen.prompts.push(e.text), { text: e.text }));
  let task = 0;
  on("tool.call", (_$: unknown, e: { tool: string; task_id?: string; run_in_background?: boolean }) => {
    if (e.tool === "TaskStop") {
      seen.stops.push(e.task_id!);
      procs.delete(`/t/tasks/${e.task_id}.output`);
      return { result: { message: "stopped" } };
    }
    if (e.run_in_background) {
      const id = `b${++task}`;
      const r = {
        result: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: id },
        text: `Command running in background with ID: ${id}. Output is being written to: /t/tasks/${id}.output`,
      };
      return holdBackground ? new Promise((res) => held.push(() => res(r))) : r;
    }
    return new Promise((res) => held.push(() => res({ result: { stdout: "", stderr: "", interrupted: false }, text: "" })));
  });
  /** Lets a held call answer: the oldest, or the one at `i`. */
  const release = (i = 0) => held.splice(i, 1)[0]!();
  return { procs, seen, clock, release };
}

const bash = ($: any, command: string, bg = false) =>
  $.tool.call({ tool: "Bash", command, ...(bg ? { run_in_background: true } : {}) } as never);

const start = ($: any) => $.session.start({ cwd: "/r" } as never);

/** The /watchdog summary's text. */
const status = async ($: any): Promise<string> =>
  (await $.command.run({ command: "watchdog", args: "" } as never)).text;

describe("foreground", () => {
  test("a quiet, idle foreground command is stopped and its result tells the model why", async ($, on) => {
    const { procs, seen, clock, release } = engine(on);
    await start($);
    const call = bash($, "ssh build-box 'make deploy'");
    procs.set("/t/tasks/f1.output", {
      pid: 201, pids: [201, 202], ticks: 3, out: "connecting…\n", command: "ssh build-box 'make deploy'",
    });
    await clock.advance(9 * MIN);
    expect(seen.kills).toEqual([]);
    await clock.advance(2 * MIN);
    expect(seen.kills[0]).toEqual(["-TERM", "--", "-201", "201", "202"]);
    expect(seen.toasts.at(-1)).toMatch(/^watchdog: stopped fg ssh build-box · no output, CPU or I\/O for 10m$/);
    expect(seen.logs.at(-1)).toBe(seen.toasts.at(-1));
    // still standing after the grace: KILL
    await clock.advance(10_000);
    expect(seen.kills.at(-1)).toEqual(["-KILL", "--", "-201", "201", "202"]);
    procs.delete("/t/tasks/f1.output");
    release();
    const r = await call;
    expect(r.context?.[0]).toContain("The watchdog plugin stopped this foreground Bash command");
    expect(r.context?.[0]).toContain("<output>connecting…</output>");
    expect(seen.prompts).toEqual([]);
  });

  test("a child that outlives its shell still gets the KILL, by the process group", async ($, on) => {
    const { procs, seen, clock, release } = engine(on);
    await start($);
    const call = bash($, "./serve.sh");
    procs.set("/t/tasks/f1.output", { pid: 251, pids: [251, 252], ticks: 0, out: "", command: "./serve.sh" });
    await clock.advance(10 * MIN);
    expect(seen.kills).toEqual([["-TERM", "--", "-251", "251", "252"]]);
    // the shell died on the TERM; its child, reparented out of the engine's tree, did not
    procs.delete("/t/tasks/f1.output");
    release();
    await call;
    await clock.advance(10_000);
    expect(seen.kills.at(-1)).toEqual(["-KILL", "--", "-251"]);
    // once
    await clock.advance(MIN);
    expect(seen.kills).toHaveLength(2);
  });

  test("a /clear in the grace still lets the KILL go", async ($, on) => {
    const { procs, seen, clock, release } = engine(on);
    on("session.end", (_$: unknown, e: unknown) => e as never);
    await start($);
    const call = bash($, "./serve.sh");
    procs.set("/t/tasks/f1.output", { pid: 251, pids: [251, 252], ticks: 0, out: "", command: "./serve.sh" });
    await clock.advance(10 * MIN);
    procs.delete("/t/tasks/f1.output");
    release();
    await call;
    await $.session.end({ reason: "clear", sessionId: "s1" } as never);
    await start($);
    await clock.advance(10_000);
    expect(seen.kills.at(-1)).toEqual(["-KILL", "--", "-251"]);
  });

  test("a command using CPU or printing is never stopped", async ($, on) => {
    const { procs, seen, clock, release } = engine(on);
    await start($);
    const a = bash($, "cargo build --release");
    const b = bash($, "./train.sh");
    procs.set("/t/tasks/f1.output", { pid: 301, pids: [301], ticks: 0, out: "", command: "cargo build --release" });
    procs.set("/t/tasks/f2.output", { pid: 401, pids: [401], ticks: 0, out: "", command: "./train.sh" });
    for (let i = 0; i < 90; i++) {
      procs.get("/t/tasks/f1.output")!.ticks += 50;
      procs.get("/t/tasks/f2.output")!.out += `epoch ${i}\n`;
      await clock.advance(10_000);
    }
    expect(seen.kills).toEqual([]);
    procs.clear();
    release();
    release();
    expect((await a).context).toBeUndefined();
    expect((await b).context).toBeUndefined();
  });

  test("a sleeping tree is left alone; a wait loop whose body hangs is not", async ($, on) => {
    const { procs, seen, clock, release } = engine(on);
    await start($);
    const a = bash($, "until curl -sf localhost:8080; do sleep 5; done");
    const b = bash($, "sleep 900 && ./check.sh");
    // the loop's curl hangs: no sleep in its tree, no output, no CPU
    procs.set("/t/tasks/f1.output", { pid: 501, pids: [501, 502], ticks: 0, out: "", command: "until curl -sf localhost:8080; do sleep 5; done" });
    procs.set("/t/tasks/f2.output", { pid: 601, pids: [601, 602], ticks: 0, sleeping: true, out: "", command: "sleep 900 && ./check.sh" });
    await clock.advance(20 * MIN);
    expect(seen.kills.filter((k) => k[0] === "-TERM")).toEqual([["-TERM", "--", "-501", "501", "502"]]);
    procs.clear();
    release();
    release();
    await a;
    await b;
  });

  // someone else's shell that no call of this session owns: an hour old, or 2 s old with a scan that answers 5 s late
  for (const { name, born, scanDelay } of [
    { name: "a waiting call is never paired with a shell that stood before it", born: 60 * MIN, scanDelay: 0 },
    { name: "a slow scan does not make a shell that stood before the call look new", born: 2_000, scanDelay: 5_000 },
  ])
    test(name, async ($, on) => {
      const { procs, seen, clock, release } = engine(on, { scanDelay });
      await start($);
      procs.set("/t/tasks/x.output", { pid: 1101, pids: [1101], ticks: 0, born: clock.now() - born, out: "", command: "other" });
      // its own shell has not spawned yet: a permission prompt holds it
      const call = bash($, "./deploy.sh");
      await clock.advance(20 * MIN);
      expect(seen.kills).toEqual([]);
      expect(await status($)).toMatch(/▶ fg deploy\.sh · \S+ · starting/);
      release();
      await call;
    });

  test("a background call made while a foreground one waits keeps its own shell", async ($, on) => {
    const { procs, clock, release } = engine(on, { holdBackground: true });
    await start($);
    const fg = bash($, "./deploy.sh");
    const bg = bash($, "./serve.sh", true);
    // the background shell spawns before its call answers; the foreground one has none yet
    procs.set("/t/tasks/b1.output", { pid: 1201, pids: [1201], ticks: 0, serving: true, out: "", command: "./serve.sh" });
    await clock.advance(10_000);
    let text = await status($);
    expect(text).toMatch(/▶ fg deploy\.sh · 10s · starting/);
    expect(text).toMatch(/▶ fg serve\.sh · 10s · serving/);
    release(1);
    await bg;
    await clock.advance(10_000);
    text = await status($);
    expect(text).toMatch(/▶ fg deploy\.sh · 20s · starting/);
    expect(text).toMatch(/▶ bg serve\.sh · 20s · serving/);
    release();
    await fg;
  });
});

describe("background", () => {
  test("a stuck background task is stopped through TaskStop and the model is asked to decide", async ($, on) => {
    const { procs, seen, clock } = engine(on);
    await start($);
    await bash($, "python sim.py", true);
    procs.set("/t/tasks/b1.output", { pid: 701, pids: [701, 702], ticks: 10, out: "month 3/30\n", command: "python sim.py" });
    await clock.advance(11 * MIN);
    expect(seen.stops).toEqual(["b1"]);
    // whatever TaskStop left of the group gets the KILL after the grace
    expect(seen.kills).toEqual([["-KILL", "--", "-701"]]);
    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain("background task b1");
    expect(seen.prompts[0]).toContain("<output>month 3/30</output>");
    expect(seen.prompts[0]).toContain("re-run it");
    await clock.advance(10_000);
    const text = await status($);
    expect(text).toContain("0 running · 1 stopped");
    expect(text).toMatch(/✗ bg python sim\.py · 10m\d\ds · stopped by watchdog · month 3\/30/);
  });

  test("its notification ends a run, and the look stops with nothing live", async ($, on) => {
    const { procs, seen, clock } = engine(on);
    await start($);
    await bash($, "cargo test", true);
    procs.set("/t/tasks/b1.output", { pid: 801, pids: [801], ticks: 0, out: "", command: "cargo test" });
    await clock.advance(10_000);
    await $.session.append({
      message: {
        type: "user",
        content: [
          { type: "text", text: "<task-notification><task-id>b1</task-id><status>completed</status></task-notification>" },
        ],
      },
    } as never);
    await clock.advance(20 * MIN);
    expect(seen.stops).toEqual([]);
    const text = await status($);
    expect(text).toMatch(/✓ bg cargo test · 10s · ended/);
  });

  test("an idle server or watcher is never stopped; a quiet download is, once its data stops", async ($, on) => {
    const { procs, seen, clock } = engine(on);
    await start($);
    await bash($, "npm run dev", true);
    await bash($, "tsc --watch", true);
    await bash($, "curl -sSLo model.bin https://example.com/model.bin", true);
    procs.set("/t/tasks/b1.output", { pid: 1301, pids: [1301, 1302], ticks: 0, serving: true, out: "", command: "npm run dev" });
    procs.set("/t/tasks/b2.output", { pid: 1401, pids: [1401, 1402], ticks: 0, serving: true, out: "", command: "tsc --watch" });
    procs.set("/t/tasks/b3.output", { pid: 1501, pids: [1501, 1502], ticks: 0, io: 0, out: "", command: "curl -sSLo model.bin https://example.com/model.bin" });
    for (let i = 0; i < 180; i++) {
      // a megabyte a look: far under 5% of a core, nothing on stdout
      procs.get("/t/tasks/b3.output")!.io! += 1 << 20;
      await clock.advance(10_000);
    }
    expect(seen.stops).toEqual([]);
    // the download stalls: its data stops, and it is stopped a limit later
    await clock.advance(9 * MIN);
    expect(seen.stops).toEqual([]);
    await clock.advance(2 * MIN);
    expect(seen.stops).toEqual(["b3"]);
    expect(seen.prompts[0]).toContain("read or wrote no data");
  });

  test("a reload while a task runs picks the look up again", async ($, on) => {
    const { procs, seen, clock } = engine(on);
    await start($);
    await bash($, "./hang.sh", true);
    procs.set("/t/tasks/b1.output", { pid: 901, pids: [901], ticks: 0, out: "", command: "./hang.sh" });
    await start($);
    await clock.advance(11 * MIN);
    expect(seen.stops).toEqual(["b1"]);
  });
});

describe("band", () => {
  for (const surface of ["terminal", "desktop"] as const)
    test(`warns from half the limit (${surface})`, async ($, on) => {
      const { procs, clock } = engine(on);
      await start($);
      await bash($, "./hang.sh", true);
      procs.set("/t/tasks/b1.output", { pid: 901, pids: [901], ticks: 0, out: "", command: "./hang.sh" });
      const band = () =>
        $.ui.mount({
          plugin: "watchdog",
          surface,
          component: "AbovePrompt",
          props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } as never,
        } as never);
      await clock.advance(2 * MIN);
      let ui = await band();
      expect(await ui.find({ text: /watchdog/ })).toBeUndefined();
      await ui.unmount();
      await clock.advance(4 * MIN);
      ui = await band();
      expect(await ui.find({ text: /watchdog · ⚠ hang\.sh quiet 6m\/10m/ })).toBeDefined();
      await ui.unmount();
    });
});
