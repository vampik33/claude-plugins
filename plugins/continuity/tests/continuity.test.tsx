import { describe, expect, mock, test } from "claude-code/testing";
import type { SessionMessage } from "claude-code";

import {
  bar,
  blockingLimit,
  buildNote,
  fmtCountdown,
  fmtLength,
  fmtTokens,
  gaugeColor,
  lastCheck,
  openTodos,
  shouldHandover,
  userPrompts,
} from "../hooks/core.ts";

const user = (
  text: string,
  extra: Partial<SessionMessage> = {},
): SessionMessage => ({
  role: "user",
  text,
  toolUses: [],
  ...extra,
});
const tool = (
  name: string,
  input: Record<string, unknown>,
  out: Partial<{ text: string; isError: true; result: unknown }> = {},
) =>
  ({
    role: "assistant",
    text: "",
    toolUses: [{ tool_use_id: "t", tool: name, input, ...out }],
  }) as SessionMessage;

describe("words", () => {
  test("lengths, countdowns, tokens, bars, colours", () => {
    expect(fmtLength(485_000)).toBe("8m05s");
    expect(fmtLength(7_980_000)).toBe("2h13m");
    expect(fmtCountdown(5_025_000)).toBe("1:23:45");
    expect(fmtTokens(620_400)).toBe("620k");
    expect(fmtTokens(1_000_000)).toBe("1M");
    expect(bar(50, 8)).toBe("████░░░░");
    expect(gaugeColor(40, 75)).toBe("green");
    expect(gaugeColor(60, 75)).toBe("yellow");
    expect(gaugeColor(75, 75)).toBe("red");
  });
});

describe("guards", () => {
  const ok = {
    reason: "answer",
    isAborted: false,
    percent: 80,
    threshold: 75,
    paused: false,
    turnsSinceHandover: 3,
  };
  test("hands over only from an answered main-loop turn past the threshold", () => {
    expect(shouldHandover(ok)).toBe(true);
    expect(shouldHandover({ ...ok, agentId: "a1" })).toBe(false);
    expect(shouldHandover({ ...ok, reason: "error" })).toBe(false);
    expect(shouldHandover({ ...ok, isAborted: true })).toBe(false);
    expect(shouldHandover({ ...ok, percent: 74 })).toBe(false);
    expect(shouldHandover({ ...ok, percent: undefined })).toBe(false);
    expect(shouldHandover({ ...ok, paused: true })).toBe(false);
    expect(shouldHandover({ ...ok, turnsSinceHandover: 2 })).toBe(false);
  });

  test("the limit that blocks longest, with its reset", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(
      blockingLimit(
        [
          {
            kind: "five_hour",
            percentUsed: 100,
            resetsAt: "2026-10-05T14:00:00Z",
          },
          {
            kind: "seven_day",
            percentUsed: 60,
            resetsAt: "2026-10-09T00:00:00Z",
          },
        ],
        now,
      ),
    ).toEqual({
      kind: "five_hour",
      resetsAt: Date.parse("2026-10-05T14:00:00Z"),
    });
    expect(
      blockingLimit(
        [
          {
            kind: "five_hour",
            percentUsed: 90,
            resetsAt: "2026-10-05T14:00:00Z",
          },
        ],
        now,
      ),
    ).toBeUndefined();
  });
});

describe("facts", () => {
  const messages: SessionMessage[] = [
    user("fix the snapshot race"),
    user("<task-notification>x</task-notification>"),
    tool("TodoWrite", {
      todos: [
        { content: "add lock", status: "completed", activeForm: "" },
        { content: "write test", status: "in_progress", activeForm: "" },
      ],
    }),
    tool(
      "TaskCreate",
      { subject: "update docs", description: "" },
      { result: { task: { id: "7" } } },
    ),
    tool(
      "TaskCreate",
      { subject: "old", description: "" },
      { result: { task: { id: "8" } } },
    ),
    tool("TaskUpdate", { taskId: "8", status: "completed" }),
    user("", { toolResults: [{ tool_use_id: "t", text: "ok" } as never] }),
    tool(
      "Bash",
      { command: "cargo test -p deployer" },
      { text: "running 3 tests\ntest a ... FAILED\n", isError: true },
    ),
    tool("Bash", { command: "ls" }, { text: "a b" }),
    user("now run clippy"),
  ];

  test("typed prompts only", () => {
    expect(userPrompts(messages)).toEqual([
      "fix the snapshot race",
      "now run clippy",
    ]);
  });

  test("open to-dos from TodoWrite and the Task tools", () => {
    expect(openTodos(messages)).toEqual([
      { status: "in_progress", text: "write test" },
      { status: "pending", text: "update docs" },
    ]);
  });

  test("the last check run, failed, with its tail", () => {
    expect(lastCheck(messages)).toEqual({
      command: "cargo test -p deployer",
      passed: false,
      tail: "running 3 tests\ntest a ... FAILED",
    });
  });

  test("the note", () => {
    const note = buildNote({
      repo: "deployer",
      sessionId: "s1",
      at: new Date(2026, 9, 5, 16, 42).getTime(),
      percent: 78,
      window: 1_000_000,
      lengthMs: 7_980_000,
      prompts: ["fix the snapshot race", "a", "b", "c", "now run clippy"],
      where: {
        cwd: "/r/deployer",
        branch: "p31-snap",
        isWorktree: true,
        dirty: 3,
        lastCommit: "abc123 add lock",
      },
      todos: openTodos(messages),
      check: lastCheck(messages),
    });
    expect(note).toContain("# Handover · deployer · 2026-10-05 16:42");
    expect(note).toContain("context 78% of 1M · running 2h13m");
    expect(note).toContain("First prompt:\n> fix the snapshot race");
    expect(note).toContain("Latest prompts:\n> b\n> c\n> now run clippy");
    expect(note).toContain("- branch: p31-snap (a worktree)");
    expect(note).toContain("- uncommitted files: 3");
    expect(note).toContain("- [in_progress] write test");
    expect(note).toContain("`cargo test -p deployer` ✗ failed");
  });
});

/** The engine's side: usage, messages, git, and records of compaction and prompts. */
function engine(on: any, percent: number) {
  const seen = {
    toasts: [] as string[],
    compacted: [] as (string | undefined)[],
    submitted: [] as string[],
    written: [] as string[],
    suggested: [] as string[],
  };
  const clock = mock.clock(on, { now: Date.now() });
  mock.env(on, { HOME: "/h" });
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/r/deployer" }));
  on("session.id", () => ({ value: "s1" }));
  on("session.usage", () => ({
    value: {
      startedAt: Date.now() - 600_000,
      context: { window: 1_000_000, percent, tokens: percent * 10_000 },
      rateLimits: [
        {
          kind: "five_hour",
          percentUsed: 100,
          resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
    },
  }));
  on("session.messages", () => ({ value: [user("fix the snapshot race")] }));
  on("process.run", (_$: unknown, e: { argv: string[] }) => {
    const args = e.argv.join(" ");
    const out = args.includes("--show-toplevel")
      ? "/r/deployer"
      : args.includes("--abbrev-ref")
        ? "p31-snap"
        : args.includes("status")
          ? " M a.rs\n"
          : args.includes("log")
            ? "abc123 add lock"
            : ".git";
    return { value: { exitCode: 0, stdout: out + "\n", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on(
    "fs.write",
    (_$: unknown, e: { path: string }) => (
      seen.written.push(e.path),
      { value: undefined }
    ),
  );
  on(
    "session.compact",
    (_$: unknown, e: { instructions?: string }) => (
      seen.compacted.push(e.instructions),
      { messages: [user("summary")] }
    ),
  );
  on(
    "prompt.submit",
    (_$: unknown, e: { text: string }) => (
      seen.submitted.push(e.text),
      { text: e.text }
    ),
  );
  on(
    "prompt.suggest",
    (_$: unknown, e: { text: string }) => (
      seen.suggested.push(e.text),
      { isShown: true }
    ),
  );
  on(
    "ui.toast",
    (_$: unknown, e: { text: string }) => (
      seen.toasts.push(e.text),
      { value: undefined }
    ),
  );
  on("turn.complete", (_$: unknown, e: { answer: string }) => ({
    text: e.answer,
  }));
  on("classic.StopFailure", () => ({}));
  on("session.measure", (_$: unknown, e: { changed: string[] }) => ({ changed: e.changed }));
  return { seen, clock };
}

const turnEnd = ($: any, over: Record<string, unknown> = {}) =>
  $.turn.complete({
    answer: "",
    durationMs: 1,
    isAborted: false,
    turnId: "t",
    reason: "answer",
    ...over,
  } as never);

describe("session", () => {
  test("past the threshold: a grace, then note, compaction and a continue prompt", async ($, on) => {
    const { seen, clock } = engine(on, 80);
    await turnEnd($);
    expect(
      seen.toasts.some((t) =>
        t.startsWith("Context 80% ≥ 75%: handover + compact in 5 s"),
      ),
    ).toBe(true);
    expect(seen.compacted.length).toBe(0);
    await clock.advance(5_000);
    expect(seen.written).toEqual(["/h/.claude/handover/s1.md"]);
    expect(seen.compacted.length).toBe(1);
    expect(seen.compacted[0]).toContain("# Handover · deployer");
    expect(seen.submitted.length).toBe(1);
    expect(seen.submitted[0]).toContain(
      "Continue from this handover (also saved at /h/.claude/handover/s1.md)",
    );

    // the next turns are too soon for another
    await turnEnd($);
    await clock.advance(5_000);
    expect(seen.compacted.length).toBe(1);
  });

  test("a prompt of the person's cancels the grace; under the threshold nothing happens", async ($, on) => {
    const { seen, clock } = engine(on, 80);
    await turnEnd($);
    await $.prompt.submit({
      text: "wait, one more thing",
      origin: { kind: "composer" },
    } as never);
    await clock.advance(5_000);
    expect(seen.compacted.length).toBe(0);
    expect(seen.toasts).toContain("Handover cancelled");
  });

  test("nothing after an aborted turn, in a subagent, or under the threshold", async ($, on) => {
    const { seen, clock } = engine(on, 80);
    await turnEnd($, { isAborted: true, reason: "aborted" });
    await turnEnd($, { agentId: "a1" });
    await clock.advance(5_000);
    expect(seen.compacted.length).toBe(0);
  });

  test("a /compact of the person's keeps the note and offers to continue", async ($, on) => {
    const { seen, clock } = engine(on, 40);
    await $.session.compact({ trigger: "manual", instructions: "focus on the API", messages: [user("fix the race")] } as never);
    expect(seen.compacted[0]).toContain("focus on the API\n\nKeep the task");
    expect(seen.compacted[0]).toContain("> fix the race");
    expect(seen.suggested).toEqual([]);
    await clock.advance(1_500);
    expect(seen.suggested).toEqual(["Continue from the handover in /h/.claude/handover/s1.md"]);
  });

  test("the usage limit: blocked with a countdown, then a continue prompt after the reset", async ($, on) => {
    const { seen, clock } = engine(on, 30);
    await $.classic.StopFailure({ error: "rate_limit" } as never);
    expect(
      seen.toasts.some((t) =>
        t.startsWith("Usage limit (five_hour): continuing at"),
      ),
    ).toBe(true);
    await clock.advance(3_600_000 + 60_000);
    expect(
      seen.submitted.some((t) => t.startsWith("Continue where you left off")),
    ).toBe(true);
  });

  test("the gauge draws on terminal and desktop", async ($, on) => {
    engine(on, 62);
    await $.session.measure({
      context: { window: 1_000_000, percent: 62 },
      rateLimits: [],
      changed: ["context"],
    } as never);
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "continuity",
        surface,
        component: "AbovePrompt",
        props: {
          hasSurvey: false,
          isWorking: false,
          maxRows: 10,
          bodyColumns: 120,
          scroll: { offset: 0, bodyRows: 10 },
          view: {},
        } as never,
      });
      expect(await ui.find({ key: "continuity-gauge" })).toBeDefined();
      expect(
        await ui.find({ in: "continuity-gauge", type: "Text", text: " 62%" }),
      ).toBeDefined();
      expect(
        await ui.find({
          in: "continuity-gauge",
          type: "Text",
          text: "handover at 75% · 13 points to go",
        }),
      ).toBeDefined();
      await ui.unmount();
    }
  });
});
