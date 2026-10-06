import { describe, expect, test } from "claude-code/testing";

import type { PaletteItem } from "../types";
import {
  buildGroups,
  fillFor,
  label,
  projectPaths,
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

function engine(on: any) {
  const seen = {
    fills: [] as { text: string; mode?: string }[],
    opened: 0,
    closed: 0,
    isOpen: false,
  };
  const draft = { text: "", cursor: 0 };
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
  on("fs.exists", () => ({ value: false }));
  on("prompt.read", () => ({ value: { ...draft } }));
  on("prompt.fill", (_$: unknown, e: { text: string; mode: string }) => {
    seen.fills.push({ text: e.text, mode: e.mode });
    return { isFilled: true };
  });
  on(
    "ui.open",
    () => (seen.opened++, (seen.isOpen = true), { value: { isPlaced: true } }),
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
  return { seen, draft };
}

describe("pane", () => {
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
  }

  test("agent.offer descriptions show beside the agent", async ($, on) => {
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
      surface: "terminal",
      ...PANE,
    });
    expect(await ui.find({ type: "Text", text: "Rust expert" })).toBeDefined();
    await ui.unmount();
  });
});
