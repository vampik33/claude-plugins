import { describe, expect, mock, test } from "claude-code/testing";

import type { FleetAgent, FleetState } from "../types";
import {
  applyStatuses,
  emptyFleet,
  endShell,
  fmtElapsed,
  parseNotification,
  parseStatus,
  parseWorktrees,
  statusLine,
  summary,
  toolLabel,
  trim,
} from "../hooks/core.ts";

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
        "Background: cargo test --workspace ✓",
      ].join("\n"),
    );
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
  on("ui.open", () => (seen.opened++, { value: { isPlaced: true } }));
  on("ui.panes", () => ({ value: [] }));
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
    },
  );

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
});
