import { describe, expect, mock, test } from "claude-code/testing";

import {
  argsChars,
  callLabel,
  countLines,
  diffSources,
  diffsOf,
  estimateTokens,
  fmtDuration,
  fmtTokens,
  iconOf,
  logTailArgv,
  mergeMs,
  omittedFiles,
  parseLog,
  shortPath,
} from "../hooks/core.ts";

const PATCH = [
  {
    oldStart: 3,
    oldLines: 2,
    newStart: 3,
    newLines: 3,
    lines: [" keep", "-old", "+new", "+more"],
  },
];

const EDIT_OUTPUT = {
  filePath: "/repo/src/a.ts",
  oldString: "old",
  newString: "new\nmore",
  originalFile: null,
  structuredPatch: PATCH,
  userModified: false,
  replaceAll: false,
};

const BASH_OUTPUT = {
  stdout: "ok",
  stderr: "",
  interrupted: false,
  isImage: false,
  noOutputExpected: false,
  bashEditDiff: {
    files: [
      { filePath: "/repo/a.rs", hunks: PATCH },
      { filePath: "/repo/b.ts", hunks: PATCH },
    ],
    moreFiles: 0,
    changedFiles: ["/repo/a.rs", "/repo/b.ts"],
  },
};

const row = (tool: string, output: unknown, extra: object = {}) => ({
  tool_use_id: "t1",
  tool,
  input: {},
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output,
  ...extra,
});

const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true };
const SURFACES = ["terminal", "desktop"] as const;

describe("core", () => {
  test("durations", () => {
    expect(fmtDuration(45)).toBe("45ms");
    expect(fmtDuration(1234)).toBe("1.2s");
    expect(fmtDuration(12_900)).toBe("12s");
    expect(fmtDuration(185_000)).toBe("3m 05s");
    expect(fmtDuration(-1)).toBe("");
  });

  test("tokens", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(401)).toBe(101);
    expect(fmtTokens(840)).toBe("~840 tok");
    expect(fmtTokens(1234)).toBe("~1.2k tok");
    expect(fmtTokens(35_400)).toBe("~35k tok");
  });

  test("args leave out the engine's keys", () => {
    expect(
      argsChars({
        tool: "Bash",
        tool_use_id: "x",
        agentId: "a",
        command: "ls",
      }),
    ).toBe(JSON.stringify({ command: "ls" }).length);
  });

  test("icons", () => {
    expect(iconOf("Edit")).toBe("✎");
    expect(iconOf("mcp__kbo__query")).toBe("◆");
    expect(iconOf("Unknown")).toBe("•");
    expect(iconOf("toString")).toBe("•");
  });

  test("diffs of Edit, created Write, Bash, and an error", () => {
    expect(diffsOf("Edit", EDIT_OUTPUT)).toEqual([
      { path: "/repo/src/a.ts", hunks: PATCH },
    ]);
    const created = diffsOf("Write", {
      type: "create",
      filePath: "/repo/n.ts",
      content: "a\nb\n",
      structuredPatch: [],
    });
    expect(created[0]?.hunks[0]?.lines).toEqual(["+a", "+b"]);
    expect(diffsOf("Bash", BASH_OUTPUT).map((f) => f.path)).toEqual([
      "/repo/a.rs",
      "/repo/b.ts",
    ]);
    expect(diffsOf("Bash", { stdout: "" })).toEqual([]);
    expect(diffsOf("Edit", "String to replace not found")).toEqual([]);
    expect(diffsOf("Read", EDIT_OUTPUT)).toEqual([]);
  });

  test("line counts", () => {
    expect(countLines(diffsOf("Bash", BASH_OUTPUT))).toEqual({
      added: 4,
      removed: 2,
    });
  });

  test("sources cap lines and keep a cut hunk parseable", () => {
    const big = {
      path: "/f",
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: [" a", "-b", "+c", " d"],
        },
        {
          oldStart: 9,
          oldLines: 1,
          newStart: 9,
          newLines: 1,
          lines: ["-x", "+y"],
        },
      ],
    };
    const { files, cut } = diffSources([big], 3);
    expect(cut).toBe(3);
    expect(files[0]?.source).toBe("@@ -1,2 +1,2 @@\n a\n-b\n+c");
    const whole = diffSources([big]);
    expect(whole.cut).toBe(0);
    expect(whole.files[0]?.source.split("\n")).toHaveLength(8);
  });

  test("control characters are dropped from diff lines", () => {
    const { files } = diffSources([
      {
        path: "/f",
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-a\r", "+b\r"],
          },
        ],
      },
    ]);
    expect(files[0]?.source).toBe("@@ -1,1 +1,1 @@\n-a\n+b");
  });

  test("paths and duration merging", () => {
    expect(shortPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(shortPath("/other/a.ts", "/repo")).toBe("/other/a.ts");
    expect(mergeMs(null, 50, false)).toEqual({ ms: 50, isExact: false });
    expect(mergeMs({ ms: 20, isExact: true }, 50, false)).toEqual({
      ms: 20,
      isExact: true,
    });
    expect(mergeMs({ ms: 50, isExact: false, tokens: 3 }, 20, true)).toEqual({
      ms: 20,
      isExact: true,
      tokens: 3,
    });
  });
});

test("without duration_ms the wall clock is shown", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 });
  let id = "";
  on("tool.call", async (_$, e) => {
    id = e.tool_use_id;
    await clock.advance(2500);
    return { result: { stdout: "" }, text: "" };
  });
  await $.tool.call({ tool: "Bash", command: "ls" });

  const ui = await $.ui.mount({
    plugin: "tool-lens",
    surface: "desktop",
    component: "ToolUse",
    requestId: id,
    props: { ...row("Bash", { stdout: "" }), tool_use_id: id },
  });
  expect((await ui.find({ type: "Text", text: /tok/ }))?.text).toContain(
    "2.5s",
  );
  await ui.unmount();
});

test("a call gets its icon, duration and tokens", async ($, on) => {
  mock.clock(on, { now: 1_000_000 });
  on("classic.PostToolUse", () => ({}));
  let id = "";
  on("tool.call", (_$, e) => {
    id = e.tool_use_id;
    return { result: { stdout: "" }, text: "x".repeat(400) };
  });
  await $.tool.call({ tool: "Bash", command: "ls" });
  await $.classic.PostToolUse({
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_response: {},
    tool_use_id: id,
    duration_ms: 1234,
  });

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface,
      component: "ToolUse",
      requestId: id,
      props: { ...row("Bash", { stdout: "" }), tool_use_id: id },
      viewport: FULLSCREEN,
    });
    expect(await ui.keepsBeneath()).toBe(true);
    expect((await ui.find({ type: "Text", text: "$" }))?.text).toBe("$");
    const facts = await ui.find({ type: "Text", text: /tok/ });
    expect(facts?.text).toContain("1.2s");
    // 400 chars of result + {"command":"ls"} (16) → 104 tokens
    expect(facts?.text).toContain("~104 tok");
    expect(await ui.find({ type: "Button" })).toBeUndefined();
    await ui.unmount();
  }
});

test("an Edit's diff opens and closes on press", async ($) => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface,
      component: "ToolUse",
      requestId: `edit-${surface}`,
      props: row("Edit", EDIT_OUTPUT),
      viewport: FULLSCREEN,
    });
    const key = "diff:t1";
    expect((await ui.find({ key }))?.text).toContain("▸ diff +2 −1");
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    await ui.press({ key });
    expect((await ui.find({ key }))?.text).toContain("▾");
    expect(await ui.find({ type: "Code" })).toBeDefined();
    await ui.press({ key });
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    await ui.unmount();
  }
});

test("a Bash edit lists each changed file", async ($, on) => {
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({
    cwd: "/repo",
    surface: "desktop",
    isInteractive: true,
  });
  const ui = await $.ui.mount({
    plugin: "tool-lens",
    surface: "desktop",
    component: "ToolUse",
    requestId: "bash1",
    props: row("Bash", BASH_OUTPUT, { tool_use_id: "bash1" }),
  });
  await ui.press({ key: "diff:bash1" });
  expect(await ui.findAll({ type: "Code" })).toHaveLength(2);
  expect(await ui.find({ type: "Text", text: "a.rs" })).toBeDefined();
  await ui.unmount();
});

const PARTIAL_BASH = {
  ...BASH_OUTPUT,
  bashEditDiff: { ...BASH_OUTPUT.bashEditDiff, moreFiles: 12 },
};

test("a partial Bash diff says how many files it leaves out", async ($) => {
  expect(omittedFiles("Bash", PARTIAL_BASH)).toBe(12);
  expect(omittedFiles("Bash", BASH_OUTPUT)).toBe(0);
  expect(omittedFiles("Edit", PARTIAL_BASH)).toBe(0);
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface,
      component: "ToolUse",
      requestId: `partial-${surface}`,
      props: row("Bash", PARTIAL_BASH, { tool_use_id: `partial-${surface}` }),
      viewport: FULLSCREEN,
    });
    const key = `diff:partial-${surface}`;
    expect((await ui.find({ key }))?.text).toContain("+12 more files");
    await ui.press({ key });
    expect(
      await ui.find({ type: "Text", text: /12 more changed files not shown/ }),
    ).toBeDefined();
    await ui.unmount();
  }
});

test("the engine's Bash result keeps its diff only when it is partial", async ($, on) => {
  let seen: unknown;
  // beneath the plugin: the engine's result row, recording what it was handed
  on("ui.render", { component: "ToolResult" }, ($, e) => {
    seen = e.props.output;
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  const result = (output: unknown) => ({
    tool_use_id: "r9",
    tool: "Bash",
    output,
    isErrored: false,
  });
  for (const [output, keeps] of [
    [PARTIAL_BASH, true],
    [BASH_OUTPUT, false],
  ] as const) {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface: "desktop",
      component: "ToolResult",
      props: result(output) as never,
    });
    expect("bashEditDiff" in (seen as object)).toBe(keeps);
    await ui.unmount();
  }
});

test("a terminal without clicks shows no toggle", async ($) => {
  const ui = await $.ui.mount({
    plugin: "tool-lens",
    surface: "terminal",
    component: "ToolUse",
    requestId: "e2",
    props: row("Edit", EDIT_OUTPUT),
    viewport: { ...FULLSCREEN, isFullscreen: false },
  });
  expect(await ui.find({ type: "Button" })).toBeUndefined();
  expect(await ui.find({ type: "Text", text: "✎" })).toBeDefined();
  await ui.unmount();
});

test("an errored call is drawn red and has no toggle", async ($) => {
  const ui = await $.ui.mount({
    plugin: "tool-lens",
    surface: "desktop",
    component: "ToolUse",
    requestId: "e3",
    props: row("Edit", "String to replace not found", { isErrored: true }),
  });
  const icon = await ui.find({ type: "Text", text: "✎" });
  expect(icon?.props).toMatchObject({ color: "error" });
  expect(await ui.find({ type: "Button" })).toBeUndefined();
  await ui.unmount();
});

describe("a folded group", () => {
  const group = (isExpanded: boolean) => ({
    isActive: false,
    isExpanded,
    calls: [
      {
        tool_use_id: "g1",
        tool: "Read",
        input: { file_path: "/repo/src/a.ts" },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: {},
      },
      {
        tool_use_id: "g2",
        tool: "Edit",
        input: { file_path: "/repo/src/a.ts" },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: EDIT_OUTPUT,
      },
    ],
  });

  test("keeps its line and lists each call, the Edit with a toggle", async ($, on) => {
    on("session.start", (_$, e) => ({ cwd: e.cwd }));
    await $.session.start({
      cwd: "/repo",
      surface: "desktop",
      isInteractive: true,
    });
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: "tool-lens",
        surface,
        component: "ToolGroup",
        props: group(false),
        viewport: FULLSCREEN,
      });
      expect(await ui.keepsBeneath()).toBe(true);
      expect(
        await ui.find({ type: "Text", text: /Read src\/a\.ts/ }),
      ).toBeDefined();
      expect(
        await ui.find({ type: "Text", text: /Edit src\/a\.ts/ }),
      ).toBeDefined();
      expect(await ui.findAll({ type: "Button" })).toHaveLength(1);
      await ui.press({ key: "diff:g2" });
      expect(await ui.find({ type: "Code" })).toBeDefined();
      await ui.press({ key: "diff:g2" });
      await ui.unmount();
    }
  });

  test("unfolded, its rows draw themselves", async ($) => {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface: "desktop",
      component: "ToolGroup",
      props: group(true),
    });
    expect(await ui.find({ type: "Button" })).toBeUndefined();
    await ui.unmount();
  });
});

const LOG = [
  "cut-off half of a line",
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-13T10:00:00.000Z",
    message: {
      content: [
        {
          type: "tool_use",
          id: "old1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-11-13T10:00:02.500Z",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "old1", content: "x".repeat(400) },
        { type: "tool_result", tool_use_id: "cut", content: "its use was cut" },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-11-13T10:00:03.000Z",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "old1",
          content: [{ type: "text", text: "ab" }, { type: "image" }],
        },
      ],
    },
  }),
].join("\n");

test("the log gives durations and tokens, skipping calls whose use it lost", () => {
  const got = parseLog(LOG);
  expect(Object.keys(got)).toEqual(["old1"]);
  // the later result row wins; 16 chars of args + "ab" → 5 tokens
  expect(got.old1).toEqual({ ms: 3000, tokens: 5, isFromLog: true });
  const first = parseLog(LOG.split("\n").slice(0, 3).join("\n"));
  // {"command":"ls"} is 16 chars, + 400 → 104 tokens
  expect(first.old1).toEqual({ ms: 2500, tokens: 104, isFromLog: true });
});

test("the log's tail is found by the session id", () => {
  const argv = logTailArgv("/h/.claude/projects", "abc") ?? [];
  expect(logTailArgv("/h/.claude/projects", "a*")).toBeNull();
  expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
  expect(argv.slice(3)).toEqual([
    "sh",
    "/h/.claude/projects",
    "abc",
    "4000000",
  ]);
});

test("calls from before the mod loaded show the log's figures, with ≈", async ($, on) => {
  mock.env(on, { HOME: "/h" });
  on("session.id", () => ({ value: "abc" }));
  let argv: readonly string[] = [];
  on("process.run", (_$, e) => {
    argv = e.argv;
    return {
      value: {
        exitCode: 0,
        stdout: LOG,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({
    cwd: "/repo",
    surface: "desktop",
    isInteractive: true,
  });
  expect(argv[4]).toBe("/h/.claude/projects");

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: "tool-lens",
      surface,
      component: "ToolUse",
      requestId: "old1",
      props: row("Bash", { stdout: "" }, { tool_use_id: "old1" }),
      viewport: FULLSCREEN,
    });
    const facts = await ui.find({ type: "Text", text: /tok/ });
    expect(facts?.text).toContain("≈3.0s");
    expect(facts?.text).toContain("~5 tok");
    await ui.unmount();
  }
});

test("call labels", () => {
  expect(callLabel("Read", { file_path: "/repo/x.ts" }, "/repo")).toBe(
    "Read x.ts",
  );
  expect(callLabel("Bash", { command: "ls -la\necho hi" }, undefined)).toBe(
    "Bash ls -la",
  );
  expect(callLabel("mcp__kbo__query", { sql: "x" }, undefined)).toBe(
    "kbo.query",
  );
  expect(
    callLabel("Grep", { pattern: "a".repeat(80) }, undefined),
  ).toHaveLength(60);
});

describe("the engine's result row", () => {
  const result = (tool: string, output: unknown, extra: object = {}) => ({
    tool_use_id: "r1",
    tool,
    output,
    isErrored: false,
    ...extra,
  });

  test("an Edit's diff moves into the toggle", async ($) => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: "tool-lens",
        surface,
        component: "ToolResult",
        props: result("Edit", EDIT_OUTPUT),
        viewport: FULLSCREEN,
      });
      expect(await ui.keepsBeneath()).toBe(false);
      await ui.unmount();
    }
  });

  test("ctrl+o, an error or a terminal without clicks keeps it", async ($) => {
    for (const [props, viewport] of [
      [result("Edit", EDIT_OUTPUT, { isExpanded: true }), FULLSCREEN],
      [result("Edit", "boom", { isErrored: true }), FULLSCREEN],
      [result("Edit", EDIT_OUTPUT), { ...FULLSCREEN, isFullscreen: false }],
      [result("Read", { type: "text" }), FULLSCREEN],
    ] as const) {
      const ui = await $.ui.mount({
        plugin: "tool-lens",
        surface: "terminal",
        component: "ToolResult",
        props: props as never,
        viewport,
      });
      expect(await ui.keepsBeneath()).toBe(true);
      await ui.unmount();
    }
  });
});
