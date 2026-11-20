import { describe, expect, test } from "claude-code/testing";

import type { PaletteGroup, PaletteItem } from "../types";
import {
  buildGroups,
  filterGroups,
  fillFor,
  label,
  mostUsed,
  projectPaths,
  ranSkill,
  recordUse,
  REPEAT_MS,
  type RawCommand,
} from "../hooks/core.ts";

const cmd = (over: Partial<RawCommand> & { name: string }): RawCommand => ({
  description: `${over.name} does things`,
  source: "user",
  ...over,
});
const agent: PaletteItem = {
  kind: "agent",
  name: "rust-engineer",
  description: "",
};
const skill: PaletteItem = {
  kind: "command",
  name: "plugin-dev:create-plugin",
  description: "",
};

describe("groups", () => {
  const commands: RawCommand[] = [
    cmd({ name: "clear", source: "builtin" }),
    cmd({ name: "think" }),
    cmd({ name: "deploy" }),
    cmd({ name: "hookify:list", source: "plugin", plugin: "hookify" }),
    cmd({ name: "hookify:help", source: "plugin", plugin: "hookify" }),
    cmd({ name: "palette", source: "plugin", plugin: "palette" }),
    cmd({ name: "cx", source: "plugin", plugin: "codex-review" }),
    cmd({ name: "db:prompt", source: "mcp" }),
  ];
  const agents = [
    { agentType: "rust-engineer", source: "userSettings" },
    { agentType: "reviewer", source: "projectSettings" },
    { agentType: "hookify:conversation-analyzer", source: "plugin" },
  ];
  const groups = buildGroups(commands, agents, new Set(["deploy"]), "palette");

  test("by source in order: project, user, plugins, then the rest", () => {
    expect(groups.map((g) => g.id)).toEqual([
      "project",
      "user",
      "plugin:codex-review",
      "plugin:hookify",
      "mcp",
    ]);
  });

  test("built-ins and the palette's own command are left out", () => {
    const names = groups.flatMap((g) => g.items.map((i) => i.name));
    expect(names).not.toContain("clear");
    expect(names).not.toContain("palette");
  });

  test("project names go to project; agents first, then by name", () => {
    expect(groups[0]!.items.map(label)).toEqual(["@reviewer", "/deploy"]);
    expect(groups[3]!.items.map(label)).toEqual([
      "@hookify:conversation-analyzer",
      "/hookify:help",
      "/hookify:list",
    ]);
  });

  test("a plugin command with no plugin named groups by its prefix", () => {
    const g = buildGroups(
      [cmd({ name: "x:y", source: "plugin" })],
      [],
      new Set(),
      "palette",
    );
    expect(g[0]!.id).toBe("plugin:x");
  });

  test("project paths of a plain and a namespaced name", () => {
    expect(projectPaths("deploy")).toEqual([
      ".claude/commands/deploy.md",
      ".claude/skills/deploy/SKILL.md",
    ]);
    expect(projectPaths("git:status")).toEqual([
      ".claude/commands/git/status.md",
    ]);
  });
});

describe("fill", () => {
  test("a command goes first, over an empty draft", () => {
    expect(fillFor(skill, "", 0)).toEqual({
      text: "/plugin-dev:create-plugin ",
      mode: "replace",
    });
  });

  test("a command keeps the draft after it and replaces a leading command", () => {
    expect(fillFor(skill, "make a mod", 4).text).toBe(
      "/plugin-dev:create-plugin make a mod",
    );
    expect(fillFor(skill, "/think  make a mod", 0).text).toBe(
      "/plugin-dev:create-plugin make a mod",
    );
  });

  test("an agent is mentioned at the cursor, spaced from the word before", () => {
    expect(fillFor(agent, "", 0)).toEqual({
      text: "@agent-rust-engineer ",
      mode: "insert",
    });
    expect(fillFor(agent, "ask ", 4).text).toBe("@agent-rust-engineer ");
    expect(fillFor(agent, "ask", 3).text).toBe(" @agent-rust-engineer ");
  });
});

describe("usage", () => {
  test("a use counts once, a repeat within REPEAT_MS does not", () => {
    const one = recordUse({}, "command:think", 1_000);
    expect(one).toEqual({ "command:think": { count: 1, last: 1_000 } });
    expect(recordUse(one, "command:think", 1_000 + REPEAT_MS - 1)).toBe(one);
    expect(recordUse(one, "command:think", 1_000 + REPEAT_MS)).toEqual({
      "command:think": { count: 2, last: 1_000 + REPEAT_MS },
    });
  });

  const item = (kind: PaletteItem["kind"], name: string): PaletteItem => ({
    kind,
    name,
    description: "",
  });
  const groups: PaletteGroup[] = [
    {
      id: "user",
      title: "user",
      items: [item("agent", "think"), item("command", "think")],
    },
    {
      id: "plugin:x",
      title: "plugin:x",
      items: [item("command", "x:a"), item("command", "x:b")],
    },
  ];

  test("none used: no group", () => {
    expect(mostUsed(groups, {})).toBeUndefined();
    expect(mostUsed(groups, { "command:gone": { count: 9, last: 0 } })).toBe(
      undefined,
    );
  });

  test("most first, then the latest use, then by name; listed ones only", () => {
    const top = mostUsed(groups, {
      "command:x:b": { count: 1, last: 5 },
      "command:x:a": { count: 1, last: 5 },
      "agent:think": { count: 1, last: 9 },
      "command:think": { count: 3, last: 1 },
      "command:clear": { count: 50, last: 1 },
    });
    expect(top!.id).toBe("most used");
    expect(top!.items.map(label)).toEqual(["/think", "@think", "/x:a", "/x:b"]);
  });

  test("at most n", () => {
    const usage = { "command:x:a": { count: 2, last: 0 } };
    const top = mostUsed(
      groups,
      { ...usage, "command:x:b": { count: 1, last: 0 } },
      1,
    );
    expect(top!.items.map(label)).toEqual(["/x:a"]);
  });
});

describe("search", () => {
  const groups: PaletteGroup[] = [
    {
      id: "user",
      title: "user",
      items: [
        { kind: "agent", name: "rust-engineer", description: "" },
        { kind: "command", name: "think", description: "Deep Reasoning" },
      ],
    },
    {
      id: "plugin:hookify",
      title: "plugin:hookify",
      items: [
        { kind: "command", name: "hookify:list", description: "List rules" },
      ],
    },
  ];
  const names = (gs: PaletteGroup[]) => gs.flatMap((g) => g.items.map(label));

  test("a blank query keeps everything", () => {
    expect(filterGroups(groups, "")).toBe(groups);
    expect(filterGroups(groups, "   ")).toBe(groups);
  });

  test("matches name or description, any case; empty groups dropped", () => {
    expect(names(filterGroups(groups, "HOOK"))).toEqual(["/hookify:list"]);
    expect(filterGroups(groups, "hook").map((g) => g.id)).toEqual([
      "plugin:hookify",
    ]);
    expect(names(filterGroups(groups, "reasoning"))).toEqual(["/think"]);
  });

  test("every word must match", () => {
    expect(names(filterGroups(groups, "list rules"))).toEqual([
      "/hookify:list",
    ]);
    expect(filterGroups(groups, "list think")).toEqual([]);
  });

  test("agent descriptions from agent.offer are searched", () => {
    expect(
      names(
        filterGroups(groups, "rust expert", { "rust-engineer": "Rust expert" }),
      ),
    ).toEqual(["@rust-engineer"]);
  });
});

describe("ranSkill", () => {
  test("the name the result gives, else the one asked for", () => {
    expect(ranSkill({ commandName: "plugin:deploy" }, "deploy")).toBe(
      "plugin:deploy",
    );
    for (const result of [
      undefined,
      null,
      "deploy ran",
      {},
      { commandName: "" },
      { commandName: 7 },
    ])
      expect(ranSkill(result, "deploy")).toBe("deploy");
  });
});

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

const PANE = {
  component: "Pane" as const,
  requestId: "palette",
  props: {
    title: "Palette",
    isFocused: false,
    bodyColumns: 40,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  } as never,
};

function engine(
  on: any,
  opts: {
    exists?: (path: string) => boolean;
    storeGate?: Promise<void>;
    /** `$.session.root()` fails, as it may outside a project */
    noRoot?: boolean;
    /** `$.session.cwd()` fails too */
    noCwd?: boolean;
  } = {},
) {
  const seen = {
    fills: [] as { text: string; mode?: string }[],
    opened: 0,
    closed: 0,
    isOpen: false,
    openArgs: [] as unknown[],
  };
  const draft = { text: "", cursor: 0 };
  const store = new Map<string, unknown>();
  // the counts are stored aside from the call: a test awaits the count it wants
  type Counts = Record<string, { count: number }> | undefined;
  const waiting: { is: (u: Counts) => boolean; done: () => void }[] = [];
  const counted = (is: (u: Counts) => boolean) =>
    new Promise<void>((done) =>
      is(store.get("usage") as Counts) ? done() : waiting.push({ is, done }),
    );
  let now = 0;
  on("store.get", async (_$: unknown, e: { key: string }) => {
    await opts.storeGate;
    return { value: store.get(e.key) };
  });
  on("store.set", (_$: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value);
    for (const w of waiting.filter((w) => w.is(e.value as Counts))) w.done();
    return { value: undefined };
  });
  on("clock.now", () => ({ value: (now += REPEAT_MS) }));
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("command.list", () => ({
    value: [
      cmd({ name: "think" }),
      cmd({ name: "hookify:list", source: "plugin", plugin: "hookify" }),
      cmd({ name: "clear", source: "builtin" }),
    ],
  }));
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: {
        breakdown: {
          agents: [
            { agentType: "rust-engineer", source: "userSettings", tokens: 1 },
          ],
        },
      },
    },
  }));
  on("session.root", () => {
    if (opts.noRoot) throw new Error("no root");
    return { value: "/proj" };
  });
  on("session.cwd", () => {
    if (opts.noCwd) throw new Error("no cwd");
    return { value: "/cwd" };
  });
  on("fs.exists", (_$: unknown, e: { path: string }) => ({
    value: opts.exists?.(e.path) ?? false,
  }));
  on("prompt.read", () => ({ value: { ...draft } }));
  on("prompt.fill", (_$: unknown, e: { text: string; mode: string }) => {
    seen.fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true };
  });
  on(
    "ui.open",
    (_$: unknown, e: unknown) => (
      seen.opened++,
      seen.openArgs.push(e),
      (seen.isOpen = true),
      { value: { isPlaced: true } }
    ),
  );
  on(
    "ui.close",
    () => (seen.closed++, (seen.isOpen = false), { value: undefined }),
  );
  on("ui.panes", () => ({
    value: seen.isOpen
      ? [
          {
            id: "palette",
            title: "Palette",
            isShown: true,
            isFocused: false,
            isPlaced: true,
          },
        ]
      : [],
  }));
  return { seen, draft, store, counted };
}

describe("pane", () => {
  test("a command runs without waiting for its count to be stored", async ($, on) => {
    let release = () => {};
    const storeGate = new Promise<void>((r) => (release = r));
    const { store, counted } = engine(on, { storeGate });
    on("command.run", { command: "think" }, () => ({ text: "ran" }));
    const r = await $.command.run({ command: "think", args: "" } as never);
    expect(r).toMatchObject({ text: "ran" });
    expect(store.get("usage")).toBeUndefined();
    release();
    await counted((u) => u?.["command:think"]?.count === 1);
    expect(store.get("usage")).toMatchObject({ "command:think": { count: 1 } });
  });

  for (const surface of ["terminal", "desktop"] as const) {
    test(`${surface}: /palette opens it, lists items, a press fills the prompt`, async ($, on) => {
      const { seen, draft } = engine(on);
      await $.command.run({ command: "palette", args: "" } as never);
      expect(seen.opened).toBe(1);

      const ui = await $.ui.mount({ plugin: "palette", surface, ...PANE });
      expect((await ui.find({ key: "agent:rust-engineer" }))?.text).toBe(
        "@rust-engineer",
      );
      expect((await ui.find({ key: "command:hookify:list" }))?.text).toBe(
        "/hookify:list",
      );
      expect(await ui.find({ key: "command:clear" })).toBeUndefined();

      await ui.press({ key: "command:think" });
      draft.text = "review this";
      draft.cursor = 11;
      await ui.press({ key: "agent:rust-engineer" });
      expect(seen.fills).toEqual([
        { text: "/think ", mode: "replace" },
        { text: " @agent-rust-engineer ", mode: "insert" },
      ]);
      await ui.unmount();

      await $.command.run({ command: "palette", args: "" } as never);
      expect(seen.closed).toBe(1);
    });

    test(`${surface}: a group header folds and unfolds its items`, async ($, on) => {
      engine(on);
      await $.command.run({ command: "palette", args: "" } as never);
      const mount = () => $.ui.mount({ plugin: "palette", surface, ...PANE });

      let ui = await mount();
      expect((await ui.find({ key: "group:user" }))?.text).toBe("▾ user (2)");
      await ui.press({ key: "group:user" });
      await ui.unmount();

      ui = await mount();
      expect((await ui.find({ key: "group:user" }))?.text).toBe("▸ user (2)");
      expect(await ui.find({ key: "command:think" })).toBeUndefined();
      await ui.press({ key: "group:user" });
      await ui.unmount();

      ui = await mount();
      expect(await ui.find({ key: "command:think" })).toBeDefined();
      await ui.unmount();
    });

    test(`${surface}: agent.offer descriptions show beside the agent`, async ($, on) => {
      engine(on);
      on("agent.offer", () => ({ isOffered: true }));
      await $.command.run({ command: "palette", args: "" } as never);
      await $.agent.offer({
        agent: "rust-engineer",
        description: "Rust expert",
        source: "userSettings",
      } as never);
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      expect(
        await ui.find({ type: "Text", text: "Rust expert" }),
      ).toBeDefined();
      await ui.unmount();
    });

    test(`${surface}: project commands are found under the project root`, async ($, on) => {
      engine(on, { exists: (p) => p === "/proj/.claude/commands/think.md" });
      await $.command.run({ command: "palette", args: "" } as never);
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      expect((await ui.find({ key: "group:project" }))?.text).toBe(
        "▾ project (1)",
      );
      expect(await ui.find({ key: "group:user" })).toBeDefined();
      await ui.unmount();
    });

    test(`${surface}: no project root: /palette still opens, the cwd stands for it`, async ($, on) => {
      const { seen } = engine(on, {
        noRoot: true,
        exists: (p) => p === "/cwd/.claude/commands/think.md",
      });
      await $.command.run({ command: "palette", args: "" } as never);
      expect(seen.opened).toBe(1);
      const ui = await $.ui.mount({ plugin: "palette", surface, ...PANE });
      expect((await ui.find({ key: "group:project" }))?.text).toBe(
        "▾ project (1)",
      );
      await ui.unmount();
    });

    test(`${surface}: neither root nor cwd: /palette opens with no project group`, async ($, on) => {
      const { seen } = engine(on, {
        noRoot: true,
        noCwd: true,
        exists: () => true,
      });
      await $.command.run({ command: "palette", args: "" } as never);
      expect(seen.opened).toBe(1);
      const ui = await $.ui.mount({ plugin: "palette", surface, ...PANE });
      expect(await ui.find({ key: "group:project" })).toBeUndefined();
      expect((await ui.find({ key: "command:think" }))?.text).toBe("/think");
      await ui.unmount();
    });

    test(`${surface}: used items show first under most used, kept in the store`, async ($, on) => {
      const { seen, store, counted } = engine(on);
      on("command.run", { command: "think" }, () => ({ text: "" }));
      on("agent.spawn", () => ({ model: "m" }));
      await $.command.run({ command: "palette", args: "" } as never);
      await $.command.run({ command: "think", args: "" } as never);
      await $.agent.spawn({ subagentType: "rust-engineer" } as never);
      await $.command.run({ command: "think", args: "" } as never);
      await counted(
        (u) =>
          u?.["command:think"]?.count === 2 &&
          u?.["agent:rust-engineer"]?.count === 1,
      );

      expect(store.get("usage")).toMatchObject({
        "command:think": { count: 2 },
        "agent:rust-engineer": { count: 1 },
      });
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      expect((await ui.find({ key: "group:most used" }))?.text).toBe(
        "▾ most used (2)",
      );
      expect((await ui.find({ key: "top:command:think" }))?.text).toBe(
        "/think",
      );
      expect((await ui.find({ key: "top:agent:rust-engineer" }))?.text).toBe(
        "@rust-engineer",
      );
      expect(await ui.find({ key: "command:think" })).toBeDefined();
      await ui.press({ key: "top:command:think" });
      expect(seen.fills).toEqual([{ text: "/think ", mode: "replace" }]);
      await ui.unmount();
    });

    test(`${surface}: typing filters the items, opening folded groups; Enter puts the first`, async ($, on) => {
      const { seen } = engine(on);
      await $.command.run({ command: "palette", args: "" } as never);
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      await ui.press({ key: "group:plugin:hookify" });
      expect(await ui.find({ key: "command:hookify:list" })).toBeUndefined();

      await ui.input({ key: "palette-search", text: "hook", kind: "change" });
      expect(await ui.find({ key: "command:hookify:list" })).toBeDefined();
      expect(await ui.find({ key: "command:think" })).toBeUndefined();
      expect(await ui.find({ key: "agent:rust-engineer" })).toBeUndefined();

      await ui.input({ key: "palette-search", text: "hook", kind: "submit" });
      expect(seen.fills).toEqual([{ text: "/hookify:list ", mode: "replace" }]);

      await ui.input({ key: "palette-search", text: "nope", kind: "change" });
      expect(
        await ui.find({ type: "Text", text: 'Nothing matches "nope".' }),
      ).toBeDefined();

      await ui.input({ key: "palette-search", text: "", kind: "change" });
      expect(await ui.find({ key: "command:think" })).toBeDefined();
      expect(await ui.find({ key: "command:hookify:list" })).toBeUndefined();
      await ui.unmount();
    });

    test(`${surface}: /palette asks for the keyboard; the search field takes it`, async ($, on) => {
      const { seen } = engine(on);
      await $.command.run({ command: "palette", args: "" } as never);
      expect(seen.openArgs[0]).toMatchObject({ id: "palette", focus: true });
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      const drawn = JSON.stringify(await ui.drawn());
      expect(drawn).toContain('"key":"palette-search"');
      expect(drawn).toContain('"autoFocus":true');
      await ui.unmount();
    });

    // the kit has no implementation of $.ui.focus: the refocus is not asserted
    test(`${surface}: ✕ clears the search`, async ($, on) => {
      engine(on);
      await $.command.run({ command: "palette", args: "" } as never);
      const ui = await $.ui.mount({
        plugin: "palette",
        surface,
        ...PANE,
      });
      expect(await ui.find({ key: "palette-search-clear" })).toBeUndefined();
      await ui.input({ key: "palette-search", text: "hook", kind: "change" });
      expect(await ui.find({ key: "command:think" })).toBeUndefined();

      await ui.press({ key: "palette-search-clear" });
      expect(await ui.find({ key: "command:think" })).toBeDefined();
      expect(await ui.find({ key: "palette-search-clear" })).toBeUndefined();
      await ui.unmount();
    });

    test(`${surface}: draws nothing in the band; /palette is the way in`, async ($, on) => {
      engine(on);
      const ui = await $.ui.mount({ plugin: "palette", surface, ...BAND });
      expect(await ui.find({ key: "palette-toggle" })).toBeUndefined();
      expect(await ui.find({ text: "palette" })).toBeUndefined();
      await ui.unmount();
    });
  }
});

describe("counting skills the model calls", () => {
  /** Core's Skill tool: `nope` is refused by a hook beneath, `gone` errors. */
  const skillTool = (on: any) =>
    on("tool.call", { tool: "Skill" }, (_$: unknown, e: { skill: string }) =>
      e.skill === "nope"
        ? { deny: "not allowed" }
        : e.skill === "gone"
          ? {
              isError: true,
              result: "Unknown skill: gone",
              text: "Unknown skill: gone",
            }
          : { result: { success: true, commandName: e.skill } },
    );
  const skillCall = (skill: string, agentId?: string) =>
    ({ tool: "Skill", skill, ...(agentId ? { agentId } : {}) }) as never;

  test("a Skill call counts command:<skill>", async ($, on) => {
    const { store, counted } = engine(on);
    skillTool(on);
    const r = await $.tool.call(skillCall("deploy"));
    expect(r).toMatchObject({
      result: { success: true, commandName: "deploy" },
    });
    await counted((u) => u?.["command:deploy"]?.count === 1);
    expect(store.get("usage")).toEqual({
      "command:deploy": { count: 1, last: expect.any(Number) },
    });
  });

  test("a Skill call counts under the name it resolved to", async ($, on) => {
    const { store, counted } = engine(on);
    on("tool.call", { tool: "Skill" }, () => ({
      result: { success: true, commandName: "plugin:deploy" },
    }));
    await $.tool.call(skillCall("deploy"));
    await counted((u) => u?.["command:plugin:deploy"]?.count === 1);
    expect(Object.keys(store.get("usage") as object)).toEqual([
      "command:plugin:deploy",
    ]);
  });

  test("a Skill result with no name counts the name asked for", async ($, on) => {
    const { store, counted } = engine(on);
    on("tool.call", { tool: "Skill" }, () => ({ result: "loaded" }));
    await $.tool.call(skillCall("deploy"));
    await counted((u) => u?.["command:deploy"]?.count === 1);
    expect(Object.keys(store.get("usage") as object)).toEqual([
      "command:deploy",
    ]);
  });

  test("a refused or failed Skill call is not counted", async ($, on) => {
    const { store, counted } = engine(on);
    skillTool(on);
    expect(await $.tool.call(skillCall("nope"))).toMatchObject({
      deny: "not allowed",
    });
    expect(await $.tool.call(skillCall("gone"))).toMatchObject({
      isError: true,
    });
    // counts run one after another: once a later one is stored, those before it are too
    await $.tool.call(skillCall("deploy"));
    await counted((u) => u?.["command:deploy"]?.count === 1);
    expect(Object.keys(store.get("usage") as object)).toEqual([
      "command:deploy",
    ]);
  });

  test("a Skill call from inside a subagent counts", async ($, on) => {
    const { store, counted } = engine(on);
    let agentSeen: string | undefined;
    on(
      "tool.call",
      { tool: "Skill" },
      (_$: unknown, e: { agentId?: string }) => {
        agentSeen = e.agentId;
        return { result: { success: true, commandName: "deploy" } };
      },
    );
    await $.tool.call(skillCall("deploy", "a1"));
    expect(agentSeen).toBe("a1");
    await counted((u) => u?.["command:deploy"]?.count === 1);
    expect(store.get("usage")).toMatchObject({
      "command:deploy": { count: 1 },
    });
  });

  test("a typed /skill still counts, once", async ($, on) => {
    const { store, counted } = engine(on);
    skillTool(on);
    on("command.run", { command: "deploy" }, () => ({ text: "" }));
    await $.command.run({ command: "deploy", args: "" } as never);
    await $.tool.call(skillCall("other"));
    await counted((u) => u?.["command:other"]?.count === 1);
    expect(store.get("usage")).toMatchObject({
      "command:deploy": { count: 1 },
      "command:other": { count: 1 },
    });
  });
});
