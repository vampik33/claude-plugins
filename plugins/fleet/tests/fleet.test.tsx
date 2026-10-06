import { describe, expect, mock, test } from "claude-code/testing";

import type { FleetAgent, FleetState } from "../types";
import {
  applyStatuses,
  emptyFleet,
  endShell,
  fmtClock,
  fmtElapsed,
  loseShells,
  mayNotify,
  parseNotification,
  parseStatus,
  parseWorktrees,
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
function engine(on: any, list: { id: string; status: string }[]) {
  const seen = {
    toasts: [] as string[],
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
  mock.env(on, {});
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/r/deployer" }));
  on("process.run", () => ({
    value: {
      exitCode: 1,
      stdout: "",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
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
  return { seen, clock };
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

describe("session", () => {
  test(
    "two agents open the pane; each end toasts; the batch's end says all done",
    { options: { sound: false, telegram: false } },
    async ($, on) => {
      const list = [
        { id: "a1", status: "running" },
        { id: "a2", status: "running" },
      ];
      const { seen, clock } = engine(on, list);

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

  test(
    "a turn's end marks lost the shells no longer in flight",
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
        const ui = await $.ui.mount({ plugin: "fleet", surface: "terminal", ...BAND });
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

  test("/fleet opens the pane, then closes it", async ($, on) => {
    const { seen } = engine(on, []);
    const run = () => $.command.run({ command: "fleet", args: "" } as never);
    expect((await run()).text).toBe("Fleet pane opened.");
    expect((await run()).text).toBe("Fleet pane closed.");
    expect((await run()).text).toBe("Fleet pane opened.");
    expect([seen.opened, seen.closed]).toEqual([2, 1]);
  });

  test("the band's toggle shows and hides the pane, on a line under other bands", async ($, on) => {
    const { seen } = engine(on, [{ id: "a1", status: "running" }]);
    const mount = () => $.ui.mount({ plugin: "fleet", surface: "terminal", ...BAND });

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

  test("the band's toggle shows and hides the pane on every press", async ($, on) => {
    const { seen } = engine(on, [{ id: "a1", status: "running" }]);
    seen.isShown = false; // the engine's isShown says nothing of the toggle
    await spawn($, "map callers");
    const mount = () => $.ui.mount({ plugin: "fleet", surface: "terminal", ...BAND });
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

  test("an auto-open that waits undrawn still offers show, and show draws it", async ($, on) => {
    const { seen } = engine(on, [
      { id: "a1", status: "running" },
      { id: "a2", status: "running" },
    ]);
    seen.placeNext = false;
    await spawn($, "review plan");
    await spawn($, "review apply");
    expect([seen.opened, seen.isPlaced]).toEqual([1, false]);

    const mount = () => $.ui.mount({ plugin: "fleet", surface: "terminal", ...BAND });
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

  test("the pane shows when an ended agent finished", async ($, on) => {
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
      surface: "terminal",
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
