import { describe, expect, mock, test } from "claude-code/testing";

import type { FleetAgent, FleetState } from "../types";
import {
  applyStatuses,
  emptyFleet,
  endShell,
  etaMs,
  fmtClock,
  fmtElapsed,
  fmtLeft,
  isWaiter,
  lastLine,
  loseShells,
  mayNotify,
  nextProgress,
  outputFileOf,
  parseNotification,
  parseProgress,
  parseStatus,
  parseWorktrees,
  shellName,
  shellNotes,
  statusLine,
  summary,
  toolLabel,
  trim,
} from "../hooks/core.ts";
import { drawFleet } from "../hooks/view.tsx";

const T0 = 1_000_000_000_000;
const agent = (over: Partial<FleetAgent> = {}): FleetAgent => ({
  id: "a1",
  type: "Explore",
  description: "map callers",
  startedAt: T0,
  status: "running",
  tools: 0,
  ...over,
});

describe("words", () => {
  test("elapsed", () => {
    expect(fmtElapsed(45_000)).toBe("45s");
    expect(fmtElapsed(372_000)).toBe("6m12s");
    expect(fmtElapsed(3_840_000)).toBe("1h04m");
  });

  test("clock: hours and minutes today, with the date on another day", () => {
    const at = new Date(2026, 9, 6, 9, 5, 30).getTime();
    expect(fmtClock(at, new Date(2026, 9, 6, 23, 0).getTime())).toBe("09:05");
    expect(fmtClock(at, new Date(2026, 9, 7, 0, 10).getTime())).toBe(
      "Oct 6 09:05",
    );
  });

  test("a tool call in a few words", () => {
    expect(
      toolLabel("Bash", { command: "cargo clippy --all -- -D warnings" }),
    ).toBe("Bash cargo clippy --all");
    expect(toolLabel("Read", { file_path: "/x/src/apply.rs" })).toBe(
      "Read apply.rs",
    );
    expect(toolLabel("Grep", { pattern: "snapshot_" })).toBe("Grep snapshot_");
    expect(toolLabel("TodoWrite", {})).toBe("TodoWrite");
  });

  test("status line counts the batch", () => {
    const f: FleetState = {
      ...emptyFleet(),
      batchStart: T0,
      agents: [
        agent({ id: "old", startedAt: T0 - 1, status: "completed" }),
        agent({ id: "a", status: "running" }),
        agent({ id: "b", status: "completed" }),
        agent({ id: "c", status: "failed" }),
      ],
      shells: [
        { id: "s", command: "cargo test", startedAt: T0, status: "running" },
      ],
    };
    expect(statusLine(f)).toBe("fleet 1▶ 1✓ 1✗ · bg 1");
    expect(statusLine(emptyFleet())).toBeUndefined();
  });

  test("all-done summary names failures and shells", () => {
    const f: FleetState = {
      ...emptyFleet(),
      batchStart: T0,
      agents: [
        agent({ id: "a", status: "completed" }),
        agent({
          id: "b",
          status: "failed",
          description: "map snapshot callers",
        }),
      ],
      shells: [
        {
          id: "s",
          command: "cargo test --workspace",
          startedAt: T0,
          status: "completed",
        },
      ],
    };
    expect(summary(f, "deployer", T0 + 580_000)).toBe(
      [
        "🤖 fleet · deployer",
        "All 2 agents done in 9m40s",
        "✓ 1 completed   ✗ 1 failed (Explore: map snapshot callers)",
        "Background shells: ✓ 1",
      ].join("\n"),
    );
  });

  test("the summary counts lost shells apart", () => {
    const shell = (id: string, status: string) => ({ id, command: "x", startedAt: T0, status });
    const f: FleetState = {
      ...emptyFleet(),
      batchStart: T0,
      shells: [shell("a", "completed"), shell("b", "failed"), shell("c", "lost")],
    };
    expect(summary(f, "r", T0 + 1_000).split("\n").at(-1)).toBe(
      "Background shells: ✓ 1   ✗ 1   ? 1",
    );
  });

  test("the summary carries no shell command text", () => {
    const secrets = [
      "curl -u user:SYNTHETIC_SECRET https://example.invalid",
      "TOKEN=SYNTHETIC_SECRET ./deploy.sh",
      "git push https://x:SYNTHETIC_SECRET@example.invalid/r.git",
    ];
    const f: FleetState = {
      ...emptyFleet(),
      batchStart: T0,
      shells: secrets.map((command, i) => ({
        id: `s${i}`,
        command,
        startedAt: T0,
        status: i === 0 ? "failed" : "completed",
      })),
    };
    const text = summary(f, "deployer", T0 + 1_000);
    expect(text).not.toContain("SYNTHETIC_SECRET");
    expect(text).not.toContain("curl");
    expect(text).toContain("Background shells: ✓ 2   ✗ 1");
  });
});

describe("transitions", () => {
  test("an agent that ends is reported once; a resumed one goes live again", () => {
    const first = applyStatuses([agent()], { a1: "completed" }, T0 + 5);
    expect(first.ended.map((a) => a.id)).toEqual(["a1"]);
    expect(first.agents[0]!.endedAt).toBe(T0 + 5);
    const again = applyStatuses(first.agents, { a1: "failed" }, T0 + 9);
    expect(again.ended).toEqual([]);
    const resumed = applyStatuses(first.agents, { a1: "running" }, T0 + 9);
    expect(resumed.agents[0]!.endedAt).toBeUndefined();
    expect(resumed.agents[0]!.status).toBe("running");
  });

  test("a shell ends by its task id, once", () => {
    const shells = [
      { id: "b1", command: "sleep 9", startedAt: T0, status: "running" },
    ];
    const r = endShell(shells, "b1", "completed", T0 + 9_000);
    expect(r.ended?.endedAt).toBe(T0 + 9_000);
    expect(endShell(r.shells, "b1", "failed", T0).ended).toBeUndefined();
    expect(endShell(shells, "zz", "completed", T0).ended).toBeUndefined();
  });

  test("a live shell the engine no longer has in flight is lost; its late notification still ends it", () => {
    const shells = [
      { id: "b1", command: "sleep 9", startedAt: T0, status: "running" },
      { id: "b2", command: "sleep 8", startedAt: T0, status: "running" },
      { id: "b3", command: "true", startedAt: T0, endedAt: T0 + 1, status: "completed" },
    ];
    const lost = loseShells(shells, new Set(["b2"]), T0 + 5_000);
    expect(lost.map((s) => [s.id, s.status, s.endedAt])).toEqual([
      ["b1", "lost", T0 + 5_000],
      ["b2", "running", undefined],
      ["b3", "completed", T0 + 1],
    ]);
    const late = endShell(lost, "b1", "failed", T0 + 9_000);
    expect(late.ended?.status).toBe("failed");
    expect(late.ended?.endedAt).toBe(T0 + 5_000);
  });

  test("trim keeps live items and the newest ended", () => {
    const items = [
      agent({ id: "1", status: "completed" }),
      agent({ id: "2", status: "running" }),
      agent({ id: "3", status: "completed" }),
    ];
    expect(trim(items, 2).map((i) => i.id)).toEqual(["2", "3"]);
  });

  test("task notifications", () => {
    expect(
      parseNotification(
        "<task-notification>\n<task-id>bjl2</task-id>\n<status>failed</status>\n</task-notification>",
      ),
    ).toEqual({ id: "bjl2", status: "failed" });
    expect(parseNotification("just text")).toBeUndefined();
  });

  test("a notification comes as a user row, or an attachment a running turn absorbed", () => {
    expect(mayNotify({ type: "user" })).toBe(true);
    expect(mayNotify({ type: "attachment", name: "queued_command" })).toBe(
      true,
    );
    expect(mayNotify({ type: "attachment", name: "nested_memory" })).toBe(
      false,
    );
    expect(mayNotify({ type: "assistant" })).toBe(false);
  });
});

describe("shell output", () => {
  test("the output file a background result names", () => {
    expect(
      outputFileOf(
        "Command running in background with ID: b1. Output is being written to: /tmp/x/tasks/b1.output. You will be notified when it completes.",
      ),
    ).toBe("/tmp/x/tasks/b1.output");
    expect(outputFileOf("done")).toBeUndefined();
    expect(outputFileOf(undefined)).toBeUndefined();
  });

  test("the last line: a redrawn bar's last frame, no colours, no blanks", () => {
    expect(lastLine("a\nb\n\n")).toBe("b");
    expect(lastLine("step 1\rstep 2\rstep 3")).toBe("step 3");
    expect(lastLine("\x1b[32mok 4/9\x1b[0m\r\n")).toBe("ok 4/9");
    expect(lastLine("  \n")).toBeUndefined();
    // the output is the shell's: no escape or control reaches the screen
    expect(lastLine("x\x1b]0;title\x07y\n")).toBe("xy");
    expect(lastLine("\x1b]52;c;ZXZpbA==\x1b\\ok\n")).toBe("ok");
    expect(lastLine("a\x1b(0b\x07\x08c\x9b2J\n")).toBe("a0bc2J");
  });

  test("progress from a percent or a count; dates and paths are no count", () => {
    expect(parseProgress("training 47%")).toBe(0.47);
    expect(parseProgress("12.5 % done")).toBe(0.125);
    expect(parseProgress("month 14/30")).toBe(14 / 30);
    expect(parseProgress("[ 3 / 4 ] folds")).toBe(0.75);
    expect(parseProgress("2026/10/12 started")).toBeUndefined();
    expect(parseProgress("wrote src/10/12/out.json")).toBeUndefined();
    expect(parseProgress("v1.10/2 x")).toBeUndefined();
    expect(parseProgress("9/4 odd")).toBeUndefined();
    expect(parseProgress("1/1")).toBeUndefined();
    expect(parseProgress("300% over")).toBeUndefined();
    expect(parseProgress("no numbers")).toBeUndefined();
  });

  test("a reading keeps where it started, and restarts when it goes back", () => {
    const a = nextProgress(undefined, 0.2, T0)!;
    expect(a).toEqual({ frac: 0.2, firstAt: T0, firstFrac: 0.2 });
    const b = nextProgress(a, 0.4, T0 + 60_000)!;
    expect(b).toEqual({ frac: 0.4, firstAt: T0, firstFrac: 0.2 });
    expect(nextProgress(b, undefined, T0 + 61_000)).toBe(b);
    expect(nextProgress(b, 0.1, T0 + 62_000)).toEqual({
      frac: 0.1,
      firstAt: T0 + 62_000,
      firstFrac: 0.1,
    });
  });

  test("time left at the rate so far, once 30 s have moved it", () => {
    const p = { frac: 0.4, firstAt: T0, firstFrac: 0.2 };
    expect(etaMs(p, T0 + 20_000)).toBeUndefined();
    expect(Math.round(etaMs(p, T0 + 10 * 60_000)!)).toBe(30 * 60_000);
    expect(etaMs({ ...p, frac: 0.2 }, T0 + 10 * 60_000)).toBeUndefined();
    expect(fmtLeft(20_000)).toBe("<1m");
    expect(fmtLeft(38 * 60_000)).toBe("38m");
    expect(fmtLeft(70 * 60_000)).toBe("1h10m");
  });

  test("wait loops", () => {
    expect(isWaiter('until grep -q DONE log; do sleep 30; done')).toBe(true);
    expect(isWaiter('while pgrep -f retrain; do sleep 60; done')).toBe(true);
    expect(isWaiter("cargo test")).toBe(false);
    expect(isWaiter("python sim.py --until 2026")).toBe(false);
  });

  test("a shell in a few words", () => {
    expect(shellName("cd /r && FOO=1 ./scripts/retrain.sh d57 --x")).toBe(
      "retrain.sh d57",
    );
    expect(shellName("export A=1; uv run python sim.py")).toBe("uv run");
    expect(shellName("cargo test --workspace")).toBe("cargo test");
    expect(shellName("S=/tmp/a; python3 -I /very/long/path/to/some_script_name.py")).toBe(
      "python3 -I",
    );
  });

  test("band notes: progress with ETA, stalls, nothing for waiters or ended", () => {
    const sh = (over: object) => ({
      id: "s",
      command: "python sim.py",
      startedAt: T0,
      status: "running",
      ...over,
    });
    const now = T0 + 10 * 60_000;
    expect(
      shellNotes(
        [
          sh({ progress: { frac: 0.4, firstAt: T0, firstFrac: 0.2 } }),
          sh({ command: "./retrain.sh d57", stalled: true, outputAt: T0 + 4 * 60_000 }),
          sh({ command: "until x; do sleep 9; done", waiter: true }),
          sh({ status: "completed", progress: { frac: 1, firstAt: T0, firstFrac: 0 } }),
          sh({ line: "no count here" }),
        ],
        now,
      ),
    ).toEqual(["python sim.py 40% ~30m", "retrain.sh d57 ⚠ 6m"]);
  });
});

describe("git", () => {
  test("worktrees by branch, a detached one by its head", () => {
    const out = [
      "worktree /r/main\nHEAD 1111111aaaa\nbranch refs/heads/main",
      "worktree /r/.claude/worktrees/agent-a9\nHEAD abcdef0123\ndetached",
      "worktree /r/bare\nbare",
    ].join("\n\n");
    expect(parseWorktrees(out)).toEqual([
      { path: "/r/main", name: "main" },
      { path: "/r/.claude/worktrees/agent-a9", name: "(abcdef0)" },
    ]);
  });

  test("status: changed files, ahead and behind", () => {
    expect(
      parseStatus(
        "## p31...origin/p31 [ahead 2, behind 1]\n M a.rs\n?? b.rs\n",
      ),
    ).toEqual({
      changed: 2,
      ahead: 2,
      behind: 1,
    });
    expect(parseStatus("## main\n")).toEqual({
      changed: 0,
      ahead: 0,
      behind: 0,
    });
  });
});

/** The engine's side: answers for every call the mod makes; records what it showed. */
function engine(
  on: any,
  list: { id: string; status: string }[],
  env: Record<string, string> = {},
) {
  const seen = {
    toasts: [] as string[],
    /** Texts sent to Telegram. */
    telegram: [] as string[],
    status: [] as (string | undefined)[],
    opened: 0,
    closed: 0,
    /** Whether the pane is open, and whether the next open is drawn. */
    isOpen: false,
    placeNext: true,
    isPlaced: false,
    /** False while another tab is in front of the pane. */
    isShown: true,
  };
  const clock = mock.clock(on, { now: Date.now() });
  /** Output files by path: what `tail` and `fs.stat` read. */
  const files: Record<string, string> = {};
  mock.env(on, env);
  on("http.fetch", (_$: unknown, e: { init: { body: string } }) => {
    seen.telegram.push(JSON.parse(e.init.body).text);
    return { value: { status: 200, ok: true, headers: {}, text: "{}" } };
  });
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/r/deployer" }));
  on("process.run", (_$: unknown, e: { argv: string[] }) => {
    const file = e.argv[0] === "tail" ? files[e.argv.at(-1)!] : undefined;
    return {
      value: {
        exitCode: file === undefined ? 1 : 0,
        stdout: file?.slice(-4096) ?? "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("fs.stat", (_$: unknown, e: { path: string }) =>
    e.path in files
      ? { value: { kind: "file", size: files[e.path]!.length, mtimeMs: 0, isLink: false } }
      : { value: { kind: "other", size: 0, mtimeMs: 0, isLink: false } },
  );
  on(
    "ui.toast",
    (_$: unknown, e: { text: string }) => (
      seen.toasts.push(e.text),
      { value: undefined }
    ),
  );
  on(
    "ui.status",
    (_$: unknown, e: { text?: string }) => (
      seen.status.push(e.text),
      { value: undefined }
    ),
  );
  on("ui.open", () => {
    seen.opened++;
    seen.isOpen = true;
    seen.isPlaced = seen.placeNext;
    return {
      value: seen.isPlaced
        ? { isPlaced: true }
        : { isPlaced: false, reason: "narrow" },
    };
  });
  on("ui.close", () => (seen.closed++, (seen.isOpen = false), { value: undefined }));
  on("ui.panes", () => ({
    value: seen.isOpen
      ? [{ id: "fleet", title: "Fleet", isShown: seen.isShown, isFocused: false, isPlaced: seen.isPlaced }]
      : [],
  }));
  on("agent.list", () => ({
    value: list.map((a) => ({ ...a, description: "", type: "Explore" })),
  }));
  let n = 0;
  on("agent.spawn", () => ({ model: "haiku", agentId: `a${++n}` }));
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({
    text: e.answer,
  }));
  return { seen, clock, files };
}

const BAND = {
  component: "AbovePrompt" as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  } as never,
};

const spawn = ($: any, description: string) =>
  $.agent.spawn({ prompt: "go", description, subagentType: "Explore" });

/** Draws the band once, so the mod learns whether the surface docks a pane. */
const drawBand = async (
  $: any,
  surface: "terminal" | "desktop",
  isFullscreen: boolean,
) => {
  const ui = await $.ui.mount({
    plugin: "fleet",
    surface,
    ...BAND,
    viewport: { columns: 160, rows: 40, isFullscreen },
  });
  await ui.unmount();
};

describe("session", () => {
  for (const surface of ["terminal", "desktop"] as const)
    test(
      `two agents open the pane; each end toasts; the batch's end says all done (${surface})`,
      { options: { sound: false, telegram: false } },
      async ($, on) => {
        const list = [
          { id: "a1", status: "running" },
          { id: "a2", status: "running" },
        ];
        const { seen, clock } = engine(on, list);
        await drawBand($, surface, true);

        await spawn($, "review plan");
        expect(seen.opened).toBe(0);
        await spawn($, "review apply");
        expect(seen.opened).toBe(1);

        await $.turn.complete({
          answer: "",
          durationMs: 1,
          isAborted: false,
          turnId: "t",
          reason: "answer",
          agentId: "a1",
        } as never);
        expect(
          seen.toasts.some((t) => /^✓ Explore · review plan · \d+s$/.test(t)),
        ).toBe(true);

        list[0]!.status = "completed";
        list[1]!.status = "failed";
        await clock.advance(2_000);
        expect(
          seen.toasts.some((t) =>
            t.startsWith("✗ Explore failed · review apply"),
          ),
        ).toBe(true);
        const allDone = () =>
          seen.toasts.some((t) => t.startsWith("All 2 agents done in"));
        expect(allDone()).toBe(false); // held past the engine's 2 s toast gap
        await clock.advance(2_100);
        expect(allDone()).toBe(true);
        // the band above the prompt carries the counts; the status line stays free
        expect(seen.status).toEqual([]);
      },
    );

  for (const surface of ["terminal", "desktop"] as const)
    test(
      `a turn's end marks lost the shells no longer in flight (${surface})`,
      { options: { sound: false, telegram: false } },
      async ($, on) => {
        const { seen, clock } = engine(on, []);
        let n = 0;
        on("tool.call", () => ({ result: { backgroundTaskId: `b${++n}` } }));
        on("classic.Stop", () => ({}));
        const task = (id: string) => ({ id, type: "shell", status: "running", description: "" });
        const stop = (ids: string[]) =>
          $.classic.Stop({ stop_hook_active: false, background_tasks: ids.map(task) } as never);
        const line = async () => {
          const ui = await $.ui.mount({ plugin: "fleet", surface, ...BAND });
          const text = (await ui.find({ type: "Text" }))?.text;
          await ui.unmount();
          return text;
        };

        await $.tool.call({ tool: "Bash", command: "cargo test" } as never);
        await $.tool.call({ tool: "Bash", command: "cargo bench" } as never);
        expect(await line()).toBe("fleet 0▶ 0✓ 0✗ · bg 2");

        await $.classic.Stop({ stop_hook_active: false } as never); // no list: nothing known
        expect(await line()).toBe("fleet 0▶ 0✓ 0✗ · bg 2");
        await stop(["b2"]);
        expect(await line()).toBe("fleet 0▶ 0✓ 0✗ · bg 1");
        await stop([]);
        expect(await line()).toBe("fleet"); // nothing live: the batch closed
        // no toast of its own for a lost shell; the batch's all-done counts it
        expect(seen.toasts).toEqual([]);
        await clock.advance(2_100);
        expect(seen.toasts).toEqual(["All done in 0s · Background shells: ✓ 0   ? 2"]);
      },
    );

  test(
    "agents that end together raise one toast",
    { options: { sound: false, telegram: false } },
    async ($, on) => {
      const list = [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
      ];
      const { seen, clock } = engine(on, list);
      await spawn($, "review plan");
      await spawn($, "review apply");
      list[0]!.status = "completed";
      list[1]!.status = "failed";
      await clock.advance(2_000);
      expect(seen.toasts).toHaveLength(1);
      expect(seen.toasts[0]).toMatch(
        /^2 finished: ✓ Explore · review plan · \d+s; ✗ Explore failed · review apply · \d+s$/,
      );
    },
  );

  test(
    "the away check survives a reload: session.start again keeps the last prompt's time",
    { options: { sound: false, idleMinutes: 5 } },
    async ($, on) => {
      const list = [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
      ];
      const { seen, clock } = engine(on, list, {
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_CHAT_ID: "c",
      });
      on("prompt.submit", (_$: unknown, e: { text: string }) => ({ text: e.text }));
      on("session.start", (_$, e) => e as never);
      await $.session.start({ cwd: "/r/deployer" } as never);
      await $.prompt.submit({ text: "go", origin: { kind: "composer" } } as never);
      await spawn($, "review plan");
      await spawn($, "review apply");
      await clock.advance(6 * 60_000);
      // a reload runs session.start again: the prompt's time stays, so the person is still away
      await $.session.start({ cwd: "/r/deployer" } as never);
      list[0]!.status = "completed";
      list[1]!.status = "completed";
      await clock.advance(2_000);
      expect(seen.telegram).toHaveLength(1);
      expect(seen.telegram[0]).toContain("All 2 agents done in");
    },
  );

  test(
    "no Telegram summary while the person is at the keyboard",
    { options: { sound: false, idleMinutes: 5 } },
    async ($, on) => {
      const list = [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
      ];
      const { seen, clock } = engine(on, list, {
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_CHAT_ID: "c",
      });
      on("prompt.submit", (_$: unknown, e: { text: string }) => ({ text: e.text }));
      on("session.start", (_$, e) => e as never);
      await $.session.start({ cwd: "/r/deployer" } as never);
      await spawn($, "review plan");
      await spawn($, "review apply");
      await clock.advance(6 * 60_000);
      await $.prompt.submit({ text: "go", origin: { kind: "composer" } } as never);
      list[0]!.status = "completed";
      list[1]!.status = "completed";
      await clock.advance(2_000);
      expect(seen.telegram).toEqual([]);
    },
  );

  for (const surface of ["terminal", "desktop"] as const)
    test(`an unasked open waits until the ${surface} docks the pane`, async ($, on) => {
      const { seen } = engine(on, [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
        { id: "a3", status: "running" },
      ]);
      await spawn($, "review plan"); // nothing drawn yet: unknown, so no open
      await drawBand($, surface, false);
      await spawn($, "review apply");
      expect(seen.opened).toBe(0); // inline it would cover the transcript
      await drawBand($, surface, true);
      await spawn($, "review docs");
      expect(seen.opened).toBe(1);
      // once per batch
      await spawn($, "review tests");
      expect(seen.opened).toBe(1);
    });

  test("/fleet opens the pane, then closes it", async ($, on) => {
    const { seen } = engine(on, []);
    const run = () => $.command.run({ command: "fleet", args: "" } as never);
    expect((await run()).text).toBe("Fleet pane opened.");
    expect((await run()).text).toBe("Fleet pane closed.");
    expect((await run()).text).toBe("Fleet pane opened.");
    expect([seen.opened, seen.closed]).toEqual([2, 1]);
  });

  for (const surface of ["terminal", "desktop"] as const)
    test(`the band's toggle shows and hides the pane, on a line under other bands (${surface})`, async ($, on) => {
      const { seen } = engine(on, [{ id: "a1", status: "running" }]);
      const mount = () => $.ui.mount({ plugin: "fleet", surface, ...BAND });

      let ui = await mount();
      expect(await ui.find({ key: "fleet-toggle" })).toBeUndefined();
      await ui.unmount();

      await spawn($, "map callers");
      ui = await mount();
      const drawn: any = await ui.drawn();
      expect(drawn.props.flexDirection).toBe("column");
      // a blank row above the fleet line, whatever is drawn above it
      expect(drawn.children.at(-1).props.marginTop).toBe(1);
      expect(await ui.find({ type: "Text", text: "fleet 1▶ 0✓ 0✗" })).toBeDefined();
      expect((await ui.find({ key: "fleet-toggle" }))?.text).toBe("show");
      await ui.press({ key: "fleet-toggle" });
      expect(seen.opened).toBe(1);
      await ui.unmount();

      ui = await mount();
      expect((await ui.find({ key: "fleet-toggle" }))?.text).toBe("hide");
      await ui.press({ key: "fleet-toggle" });
      expect(seen.closed).toBe(1);
      await ui.unmount();
    });

  for (const surface of ["terminal", "desktop"] as const)
    test(`the band's toggle shows and hides the pane on every press (${surface})`, async ($, on) => {
      const { seen } = engine(on, [{ id: "a1", status: "running" }]);
      seen.isShown = false; // the engine's isShown says nothing of the toggle
      await spawn($, "map callers");
      const mount = () => $.ui.mount({ plugin: "fleet", surface, ...BAND });
      const press = async (label: string) => {
        const ui = await mount();
        expect((await ui.find({ key: "fleet-toggle" }))?.text).toBe(label);
        await ui.press({ key: "fleet-toggle" });
        await ui.unmount();
      };
      for (let i = 0; i < 3; i++) {
        await press("show");
        expect(seen.isOpen).toBe(true);
        await press("hide");
        expect(seen.isOpen).toBe(false);
      }
      expect([seen.opened, seen.closed]).toEqual([3, 3]);
    });

  for (const surface of ["terminal", "desktop"] as const)
    test(`an auto-open that waits undrawn still offers show, and show draws it (${surface})`, async ($, on) => {
      const { seen } = engine(on, [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
      ]);
      seen.placeNext = false;
      await drawBand($, surface, true);
      await spawn($, "review plan");
      await spawn($, "review apply");
      expect([seen.opened, seen.isPlaced]).toEqual([1, false]);

      const mount = () => $.ui.mount({ plugin: "fleet", surface, ...BAND });
      let ui = await mount();
      expect((await ui.find({ key: "fleet-toggle" }))?.text).toBe("show");
      seen.placeNext = true; // a press is asked: drawn at any width
      await ui.press({ key: "fleet-toggle" });
      expect([seen.opened, seen.closed, seen.isPlaced]).toEqual([2, 0, true]);
      await ui.unmount();

      ui = await mount();
      expect((await ui.find({ key: "fleet-toggle" }))?.text).toBe("hide");
      await ui.unmount();
    });

  test("the pane lists agents with ticking time on terminal and desktop", async ($, on) => {
    engine(on, [{ id: "a1", status: "running" }]);
    await spawn($, "map callers");
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "fleet",
        surface,
        component: "Pane",
        requestId: "fleet",
        props: {
          title: "Fleet",
          isFocused: false,
          bodyColumns: 50,
          placement: "dock",
          scroll: { offset: 0, bodyRows: 20 },
        } as never,
      });
      expect(await ui.find({ key: "fleet-body" })).toBeDefined();
      expect(
        await ui.find({
          in: "fleet-body",
          type: "Text",
          text: /AGENTS {2}1 running · 0 done · 0 failed/,
        }),
      ).toBeDefined();
      expect(
        await ui.find({ in: "fleet-body", type: "Text", text: /map callers/ }),
      ).toBeDefined();
      await ui.unmount();
    }
  });

  for (const surface of ["terminal", "desktop"] as const)
    test(`the pane shows when an ended agent finished (${surface})`, async ($, on) => {
      engine(on, [{ id: "a1", status: "running" }]);
      await spawn($, "map callers");
      await $.turn.complete({
        answer: "",
        durationMs: 1,
        isAborted: false,
        turnId: "t",
        reason: "answer",
        agentId: "a1",
      } as never);
      const ui = await $.ui.mount({
        plugin: "fleet",
        surface,
        component: "Pane",
        requestId: "fleet",
        props: {
          title: "Fleet",
          isFocused: false,
          bodyColumns: 50,
          placement: "dock",
          scroll: { offset: 0, bodyRows: 20 },
        } as never,
      });
      const clock = fmtClock(Date.now(), Date.now());
      expect(
        await ui.find({
          in: "fleet-body",
          type: "Text",
          text: new RegExp(`Explore +\\d+s · ${clock}$`),
        }),
      ).toBeDefined();
      await ui.unmount();
    });
});

describe("shell progress", () => {
  const bgResult = (id: string) => ({
    result: { backgroundTaskId: id },
    text: `Command running in background with ID: ${id}. Output is being written to: /tmp/t/${id}.output. You will be notified when it completes.`,
  });
  const PANE = {
    component: "Pane" as const,
    requestId: "fleet",
    props: {
      title: "Fleet",
      isFocused: false,
      bodyColumns: 60,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 20 },
    } as never,
  };

  for (const surface of ["terminal", "desktop"] as const)
    test(
      `a shell's progress and ETA on the band and in the pane (${surface})`,
      { options: { sound: false, telegram: false } },
      async ($, on) => {
        const { clock, files } = engine(on, []);
        on("tool.call", () => bgResult("b1"));
        await $.tool.call({ tool: "Bash", command: "uv run python sim.py" } as never);
        files["/tmp/t/b1.output"] = "loading\nmonth 6/30\n";
        await clock.advance(5_000);
        files["/tmp/t/b1.output"] += "month 12/30\n";
        await clock.advance(60_000);

        const band = await $.ui.mount({ plugin: "fleet", surface, ...BAND });
        expect((await band.find({ type: "Text" }))?.text).toMatch(
          /^fleet 0▶ 0✓ 0✗ · bg 1 · uv run 40% ~\d+m$/,
        );
        await band.unmount();

        // the pane's Client ticks on the wall clock, which the mocked one ran ahead of: no ETA there yet
        const pane = await $.ui.mount({ plugin: "fleet", surface, ...PANE });
        expect(
          await pane.find({ in: "fleet-body", type: "Text", text: /▓▓▓▓░░░░░░ 40%( ~\d+m)? · month 12\/30/ }),
        ).toBeDefined();
        await pane.unmount();
      },
    );

  for (const surface of ["terminal", "desktop"] as const)
    test(
      `a quiet shell is stalled once, with a toast; new output clears it (${surface})`,
      { options: { sound: false, telegram: false } },
      async ($, on) => {
        const { seen, clock, files } = engine(on, []);
        on("tool.call", () => bgResult("b1"));
        await $.tool.call({ tool: "Bash", command: "./retrain.sh d57" } as never);
        files["/tmp/t/b1.output"] = "fitting\n";
        await clock.advance(5_000);
        await clock.advance(5 * 60_000);
        expect(seen.toasts).toEqual(["⚠ retrain.sh d57 · no output for 5m"]);
        await clock.advance(60_000);
        expect(seen.toasts).toHaveLength(1);

        let band = await $.ui.mount({ plugin: "fleet", surface, ...BAND });
        expect((await band.find({ type: "Text" }))?.text).toMatch(/· retrain.sh d57 ⚠ \dm$/);
        await band.unmount();

        files["/tmp/t/b1.output"] += "fold 2\n";
        await clock.advance(5_000);
        band = await $.ui.mount({ plugin: "fleet", surface, ...BAND });
        expect((await band.find({ type: "Text" }))?.text).toBe("fleet 0▶ 0✓ 0✗ · bg 1");
        await band.unmount();
      },
    );

  for (const surface of ["terminal", "desktop"] as const)
    test(
      `a wait loop is waiting, never stalled, and its stop button stops it (${surface})`,
      { options: { sound: false, telegram: false } },
      async ($, on) => {
        const { seen, clock, files } = engine(on, []);
        const stopped: string[] = [];
        on("tool.call", (_$: unknown, e: { tool: string; task_id?: string }) => {
          if (e.tool === "TaskStop") {
            stopped.push(e.task_id!);
            return { result: { message: "stopped", task_id: e.task_id, task_type: "shell" } };
          }
          return bgResult("b1");
        });
        await $.tool.call({
          tool: "Bash",
          command: "until grep -q DONE log; do sleep 30; done",
        } as never);
        files["/tmp/t/b1.output"] = "";
        await clock.advance(10 * 60_000);
        expect(seen.toasts).toEqual([]);

        const pane = await $.ui.mount({ plugin: "fleet", surface, ...PANE });
        expect(await pane.find({ in: "fleet-body", type: "Text", text: /^ +waiting$/ })).toBeDefined();
        expect((await pane.find({ key: "fleet-stop-b1" }))?.text).toBe("stop until grep");
        await pane.press({ key: "fleet-stop-b1" });
        expect(stopped).toEqual(["b1"]);
        await pane.unmount();
      },
    );

  test(
    "a reload picks the shell watch up again",
    { options: { sound: false, telegram: false } },
    async ($, on) => {
      const { clock, files } = engine(on, []);
      on("tool.call", () => bgResult("b1"));
      on("session.start", (_$, e) => e as never);
      await $.session.start({ cwd: "/r/deployer" } as never);
      await $.tool.call({ tool: "Bash", command: "python sim.py" } as never);
      await $.session.start({ cwd: "/r/deployer" } as never);
      files["/tmp/t/b1.output"] = "50%\n";
      await clock.advance(5_000);
      const band = await $.ui.mount({ plugin: "fleet", surface: "terminal", ...BAND });
      expect((await band.find({ type: "Text" }))?.text).toBe(
        "fleet 0▶ 0✓ 0✗ · bg 1 · python sim.py 50%",
      );
      await band.unmount();
    },
  );
});

/** Every line of text a drawing holds, one per outer Text. */
function lines(node: any): string[] {
  const flat = (n: any): string =>
    typeof n === "string" ? n : (n?.children ?? []).map(flat).join("");
  if (node?.type === "Text") return [flat(node)];
  return (node?.children ?? []).flatMap(lines);
}

describe("view", () => {
  test("ended agents and shells show when they finished; live ones do not", () => {
    const at = new Date(2026, 9, 6, 16, 42).getTime();
    const tree = drawFleet(
      { Box: "Box", Text: "Text" },
      {
        repo: "r",
        width: 50,
        agents: [
          agent({ id: "a", startedAt: at - 372_000, endedAt: at, status: "completed" }),
          agent({ id: "b", type: "Plan", startedAt: at, status: "running" }),
        ],
        shells: [
          { id: "s1", command: "cargo test", startedAt: at - 5_000, endedAt: at, status: "failed" },
          { id: "s2", command: "cargo build", startedAt: at, status: "running" },
          { id: "s3", command: "cargo doc", startedAt: at - 3_000, endedAt: at, status: "lost" },
        ],
        trees: [],
      },
      at + 45_000,
    );
    const text = lines(tree);
    expect(text).toContain(`✓ ${"Explore".padEnd(18)} 6m12s · 16:42`);
    expect(text).toContain(`▶ ${"Plan".padEnd(18)} 45s`);
    expect(text.find((l) => l.includes("cargo test"))).toMatch(/^✗ cargo test +5s · 16:42$/);
    expect(text.find((l) => l.includes("cargo build"))).toMatch(/^▶ cargo build +45s$/);
    expect(text.find((l) => l.includes("cargo doc"))).toMatch(/^\? cargo doc +3s · 16:42$/);
    expect(text.every((l) => l.length <= 50)).toBe(true);
  });
});
