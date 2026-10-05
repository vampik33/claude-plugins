import { describe, expect, mock, test } from "claude-code/testing";

import type { CxJob } from "../types";
import {
  asReview,
  buildPrompt,
  chooseBase,
  companionJobId,
  isPushCommand,
  parseArgs,
  preselect,
  readOutcome,
  toolText,
  trimJobs,
} from "../hooks/core.ts";

/** A real `adversarial-review --json` output, cut to what the mod reads. */
const REAL = {
  review: "Adversarial Review",
  codex: { status: 0, stderr: "", stdout: "" },
  result: {
    verdict: "needs-attention",
    summary:
      "Do not ship: the helper now returns NaN for every ordinary non-empty array.",
    findings: [
      {
        severity: "high",
        title: "Loop reads one element past the array boundary",
        body: "The `i <= xs.length` condition evaluates `xs[xs.length]`.",
        file: "avg.ts",
        line_start: 3,
        line_end: 3,
        confidence: 1,
        recommendation: "Change the loop condition to `i < xs.length`.",
      },
      {
        severity: "low",
        title: "Empty array divides by zero",
        body: "avg([]) is NaN.",
        file: "avg.ts",
        line_start: 4,
        line_end: 5,
        confidence: 0.5,
        recommendation: "Return 0 or throw.",
      },
    ],
    next_steps: ["Fix the loop boundary."],
  },
  parseError: null,
};

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

describe("arguments", () => {
  test("/cx forms", () => {
    expect(parseArgs("")).toEqual({
      action: "start",
      mode: "adversarial",
      focus: "",
    });
    expect(parseArgs('adv "snapshot apply path"')).toEqual({
      action: "start",
      mode: "adversarial",
      focus: "snapshot apply path",
    });
    expect(parseArgs("the retry loop")).toEqual({
      action: "start",
      mode: "adversarial",
      focus: "the retry loop",
    });
    expect(parseArgs("review")).toEqual({
      action: "start",
      mode: "standard",
      focus: "",
    });
    expect(parseArgs("cancel")).toEqual({ action: "cancel" });
    expect(parseArgs(" last ")).toEqual({ action: "last" });
  });

  test("base: the PR's, else develop for greentic, else main", () => {
    expect(chooseBase("release/1.19", "git@github.com:greenticai/x.git")).toBe(
      "release/1.19",
    );
    expect(
      chooseBase(undefined, "git@github.com:greenticai/deployer.git"),
    ).toBe("develop");
    expect(chooseBase(undefined, "https://github.com/greentic-biz/x")).toBe(
      "develop",
    );
    expect(
      chooseBase(undefined, "https://github.com/vampik33/claude-plugins"),
    ).toBe("main");
  });

  test("push detection", () => {
    expect(isPushCommand("git push -u origin feat")).toBe(true);
    expect(isPushCommand("cargo fmt && git push")).toBe(true);
    expect(isPushCommand('gh pr create --title "x"')).toBe(true);
    expect(isPushCommand("git pushd")).toBe(false);
    expect(isPushCommand("echo git-push")).toBe(false);
    expect(isPushCommand("git status")).toBe(false);
  });
});

describe("output", () => {
  test("a real review parses; a malformed one is never guessed", () => {
    const ok = readOutcome("adversarial", JSON.stringify(REAL), "");
    expect(ok.status).toBe("completed");
    expect(ok.review?.findings.length).toBe(2);

    const bad = {
      ...REAL,
      result: { ...REAL.result, findings: [{ title: "x" }] },
      rawOutput: "free text",
    };
    const out = readOutcome("adversarial", JSON.stringify(bad), "");
    expect(out.status).toBe("failed");
    expect(out.review).toBeUndefined();
    expect(out.raw).toBe("free text");
    expect(asReview({ verdict: "ship it" })).toBeUndefined();
  });

  test("no JSON: the stderr tail is the reason", () => {
    expect(
      readOutcome("adversarial", "", "a\nb\nCodex is not logged in\n"),
    ).toEqual({
      status: "failed",
      error: "a\nb\nCodex is not logged in",
    });
  });

  test("a standard review is Codex's text", () => {
    const out = readOutcome(
      "standard",
      JSON.stringify({ codex: { status: 0, stdout: "- [P1] bug\n" } }),
      "",
    );
    expect(out).toEqual({ status: "completed", raw: "- [P1] bug" });
    expect(
      readOutcome(
        "standard",
        JSON.stringify({ codex: { status: 1, stderr: "boom", stdout: "" } }),
        "",
      ).status,
    ).toBe("failed");
  });

  test("preselect: medium and up by default", () => {
    const f = asReview(REAL.result)!.findings;
    expect(preselect(f, "medium+")).toEqual([true, false]);
    expect(preselect(f, "all")).toEqual([true, true]);
    expect(preselect(f, "none")).toEqual([false, false]);
  });

  test("the prompt carries each picked finding and the verification rules", () => {
    const f = asReview(REAL.result)!.findings;
    const text = buildPrompt(job(), [f[0]!], false);
    expect(text).toContain(
      "Codex adversarial review of deployer (base develop) returned 1 finding(s)",
    );
    expect(text).toContain(
      "1. [high] Loop reads one element past the array boundary",
    );
    expect(text).toContain("avg.ts:3 (confidence 1.00)");
    expect(text).toContain("VALID or FALSE POSITIVE");
    expect(text).toContain("Fix only the VALID findings");
    expect(buildPrompt(job(), [f[1]!], true)).toContain("avg.ts:4-5");
    expect(buildPrompt(job(), [f[1]!], true)).toContain(
      "Do not change any code",
    );
  });

  test("the tool's answer says Codex ran and carries its review", () => {
    const done = job({
      status: "completed",
      endedAt: 61_000,
      review: asReview(REAL.result),
    });
    const parsed = JSON.parse(toolText(done));
    expect(parsed.codexRan).toBe(true);
    expect(parsed.durationMs).toBe(60_000);
    expect(parsed.findings.length).toBe(2);
  });
});

describe("companion", () => {
  test("our running job by repo and start time", () => {
    const status = JSON.stringify({
      running: [
        {
          id: "old",
          jobClass: "review",
          workspaceRoot: "/r/deployer",
          startedAt: new Date(0).toISOString(),
          phase: "x",
        },
        {
          id: "mine",
          jobClass: "review",
          workspaceRoot: "/r/deployer",
          startedAt: new Date(98_000).toISOString(),
          phase: "reviewing",
        },
        {
          id: "task",
          jobClass: "task",
          workspaceRoot: "/r/deployer",
          startedAt: new Date(2_000).toISOString(),
        },
      ],
    });
    expect(
      companionJobId(status, { root: "/r/deployer", startedAt: 100_000 }),
    ).toEqual({ id: "mine", phase: "reviewing" });
    expect(
      companionJobId("nope", { root: "/r", startedAt: 0 }),
    ).toBeUndefined();
  });

  test("trim keeps running jobs", () => {
    const jobs = [
      job({ id: "a", status: "completed" }),
      job({ id: "b" }),
      job({ id: "c", status: "failed" }),
    ];
    expect(trimJobs(jobs, 2).map((j) => j.id)).toEqual(["b", "c"]);
  });
});

/** The engine's side for a /cx run: git, the companion, its output file. */
function engine(on: any, out: string) {
  const seen = {
    toasts: [] as string[],
    submitted: [] as string[],
    opened: 0,
    alive: true,
  };
  const clock = mock.clock(on, { now: Date.now() });
  mock.env(on, { HOME: "/h" });
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("tool.register", () => ({ value: undefined }));
  on("session.cwd", () => ({ value: "/r/deployer" }));
  on("fs.read", (_$: unknown, e: { path: string }) => ({
    value: e.path.endsWith("installed_plugins.json")
      ? JSON.stringify({
          plugins: {
            "codex@openai-codex": [{ installPath: "/p/codex/1.0.6" }],
          },
        })
      : e.path.endsWith("out.json")
        ? out
        : "",
  }));
  on("process.run", (_$: unknown, e: { argv: string[] }) => {
    const [cmd, ...rest] = e.argv;
    const ok = (stdout = "") => ({
      value: {
        exitCode: 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    const fail = () => ({
      value: {
        exitCode: 1,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    if (cmd === "git" && rest[0] === "rev-parse") return ok("/r/deployer\n");
    if (cmd === "git" && rest[0] === "remote")
      return ok("git@github.com:greenticai/deployer.git\n");
    if (cmd === "gh") return fail();
    if (cmd === "mkdir") return ok();
    if (cmd === "sh") return ok("4242\n");
    if (cmd === "kill") return seen.alive ? ok() : fail();
    if (cmd === "node") return ok(JSON.stringify({ running: [] }));
    return fail();
  });
  on(
    "ui.toast",
    (_$: unknown, e: { text: string }) => (
      seen.toasts.push(e.text),
      { value: undefined }
    ),
  );
  on("ui.open", () => (seen.opened++, { value: { isPlaced: true } }));
  on("ui.close", () => ({ value: undefined }));
  on(
    "prompt.submit",
    (_$: unknown, e: { text: string }) => (
      seen.submitted.push(e.text),
      { text: e.text }
    ),
  );
  on("command.run", () => ({ text: "" }));
  return { seen, clock };
}

const PANE_PROPS = {
  title: "Codex review",
  isFocused: false,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 30 },
} as never;

describe("session", () => {
  test("/cx runs in the background; when it ends the pane offers the picked findings", async ($, on) => {
    const { seen, clock } = engine(on, JSON.stringify(REAL));
    const started = await $.command.run({
      command: "cx",
      args: 'adv "avg helper"',
    } as never);
    expect((started as { text: string }).text).toContain("deployer → develop");

    const band = await $.ui.mount({
      plugin: "codex-review",
      surface: "terminal",
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
    expect(await band.find({ key: "codex-band" })).toBeDefined();
    await band.unmount();

    seen.alive = false;
    await clock.advance(10_000);
    expect(
      seen.toasts.some((t) => /^Codex needs-attention · 2 findings · /.test(t)),
    ).toBe(true);
    expect(seen.opened).toBe(1);

    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "codex-review",
        surface,
        component: "Pane",
        requestId: "codex-review",
        props: PANE_PROPS,
      });
      expect(
        await ui.find({ type: "Text", text: "needs-attention" }),
      ).toBeDefined();
      expect(await ui.find({ key: "send" })).toBeDefined();
      await ui.unmount();
    }

    const ui = await $.ui.mount({
      plugin: "codex-review",
      surface: "terminal",
      component: "Pane",
      requestId: "codex-review",
      props: PANE_PROPS,
    });
    expect((await ui.find({ key: "pick1" }))?.props.label).toBe("[ ]");
    await ui.press({ key: "pick1" });
    await ui.press({ key: "send" });
    expect(seen.submitted.length).toBe(1);
    expect(seen.submitted[0]).toContain("returned 2 finding(s)");
    await ui.unmount();
  });

  test("a malformed review is shown as Codex's raw text, not findings", async ($, on) => {
    const bad = JSON.stringify({
      ...REAL,
      result: null,
      parseError: "Unexpected token",
      rawOutput: "Codex said things",
    });
    const { seen, clock } = engine(on, bad);
    await $.command.run({ command: "cx", args: "" } as never);
    seen.alive = false;
    await clock.advance(10_000);
    expect(
      seen.toasts.some((t) => t.startsWith("Codex review failed after")),
    ).toBe(true);
    const ui = await $.ui.mount({
      plugin: "codex-review",
      surface: "terminal",
      component: "Pane",
      requestId: "codex-review",
      props: PANE_PROPS,
    });
    expect(
      await ui.find({ type: "Text", text: "Codex said things" }),
    ).toBeDefined();
    expect(await ui.find({ key: "send" })).toBeUndefined();
    expect(await ui.find({ key: "send-raw" })).toBeDefined();
    await ui.unmount();
  });

  test("the CodexReview tool waits for Codex and returns its findings; a failure is an error", async ($, on) => {
    engine(on, JSON.stringify(REAL));
    const r = (await $.tool.call({ tool: "mcp__codex-review__CodexReview", focus: "avg" } as never)) as {
      result?: string;
      isError?: boolean;
    };
    expect(r.isError).toBeFalsy();
    const parsed = JSON.parse(r.result!);
    expect(parsed.codexRan).toBe(true);
    expect(parsed.findings[0].severity).toBe("high");
  });

  test("the tool never passes off a failed run as a review", async ($, on) => {
    engine(on, "");
    const r = (await $.tool.call({ tool: "mcp__codex-review__CodexReview" } as never)) as {
      result?: string;
      isError?: boolean;
    };
    expect(r.isError).toBe(true);
    expect(r.result).toContain("do not substitute your own");
  });
});
