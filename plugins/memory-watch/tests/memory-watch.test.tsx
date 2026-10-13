import { describe, expect, test } from "claude-code/testing";

import type { MemoryChange } from "../types";
import {
  addChange,
  countLines,
  headline,
  memoryFile,
  parseFrontmatter,
  title,
  toChange,
} from "../hooks/core.ts";

const DIR = "/home/u/.claude/projects/-home-u-repo/memory";
const AT = new Date(2026, 9, 13, 9, 5).getTime();

const MEMO = `---
name: version-bumps
description: "Always bump the plugin version after changes"
metadata:
  type: feedback
---

Bump it.
`;

const change = (over: Partial<MemoryChange> = {}): MemoryChange => ({
  at: AT,
  file: "feedback_version_bumps.md",
  action: "updated",
  added: 1,
  removed: 0,
  ...over,
});

describe("core", () => {
  test("memory files of any project; nothing else", () => {
    expect(memoryFile(`${DIR}/feedback_x.md`)).toBe("feedback_x.md");
    expect(memoryFile(`${DIR}/MEMORY.md`)).toBe("MEMORY.md");
    expect(memoryFile(`${DIR}/sub/x.md`)).toBeUndefined();
    expect(memoryFile(`${DIR}/notes.txt`)).toBeUndefined();
    expect(memoryFile("/home/u/projects/x/memory/a.md")).toBeUndefined();
    expect(memoryFile("/home/u/.claude/projects/s/memory.md")).toBeUndefined();
  });

  test("frontmatter: name, description, nested type; quotes stripped", () => {
    expect(parseFrontmatter(MEMO)).toEqual({
      name: "version-bumps",
      description: "Always bump the plugin version after changes",
      type: "feedback",
    });
  });

  test("frontmatter: none, unclosed, or only in the body", () => {
    expect(parseFrontmatter("# Memory Index\n- [x](x.md)")).toEqual({});
    expect(parseFrontmatter("---\nname: a\n")).toEqual({});
    expect(parseFrontmatter("text\n---\nname: a\n---")).toEqual({});
  });

  test("frontmatter: CRLF and the first of a repeated key", () => {
    expect(
      parseFrontmatter("---\r\nname: a\r\nname: b\r\ntype: user\r\n---\r\n"),
    ).toEqual({ name: "a", type: "user" });
  });

  test("lines added and removed across hunks", () => {
    expect(
      countLines([
        { lines: [" a", "-b", "+c", "+d"] },
        { lines: ["-e", " f"] },
      ]),
    ).toEqual({ added: 2, removed: 2 });
    expect(countLines([])).toEqual({ added: 0, removed: 0 });
  });

  test("a created file with an empty patch counts every line added", () => {
    const c = toChange("x.md", "created", MEMO, [], AT);
    expect([c.added, c.removed]).toEqual([8, 0]);
    expect(toChange("x.md", "created", "", [], AT).added).toBe(0);
    expect(toChange("x.md", "updated", MEMO, [], AT).added).toBe(0);
  });

  test("newest first, capped", () => {
    let list: MemoryChange[] = [];
    for (let i = 0; i < 5; i++) list = addChange(list, change({ at: i }), 3);
    expect(list.map((c) => c.at)).toEqual([4, 3, 2]);
  });

  test("headline and title", () => {
    expect(headline(change({ type: "feedback", added: 12 }))).toBe(
      "09:05 updated · feedback · +12 −0",
    );
    expect(headline(change({ action: "created" }))).toBe(
      "09:05 created · +1 −0",
    );
    expect(title(change({ name: "version-bumps" }))).toBe("version-bumps");
    expect(title(change({ file: "MEMORY.md" }))).toBe("MEMORY.md (index)");
    expect(title(change())).toBe("feedback_version_bumps.md");
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
  requestId: "memory-watch",
  props: {
    title: "Memory",
    isFocused: false,
    bodyColumns: 40,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  } as never,
};

function engine(on: any) {
  const seen = { opened: 0, closed: 0, isOpen: false };
  const files = new Map<string, string>();
  on("clock.now", () => ({ value: AT }));
  on("ui.render", () => h("Box", null));
  on("command.register", () => ({ value: undefined }));
  on("fs.read", (_$: unknown, e: { path: string }) => ({
    value: files.get(e.path) ?? "",
  }));
  // the tools beneath: a Write creates, an Edit appends a line
  on("tool.call", (_$: unknown, e: any) => {
    if (e.tool === "Write") {
      const isNew = !files.has(e.file_path);
      files.set(e.file_path, e.content);
      return {
        result: {
          type: isNew ? "create" : "update",
          filePath: e.file_path,
          content: e.content,
          structuredPatch: [],
          originalFile: null,
        },
      };
    }
    if (e.tool === "Edit") {
      if (!files.has(e.file_path))
        return { result: "File does not exist.", isError: true };
      files.set(e.file_path, files.get(e.file_path) + e.new_string);
      return {
        result: {
          filePath: e.file_path,
          oldString: e.old_string,
          newString: e.new_string,
          originalFile: "",
          structuredPatch: [{ lines: [`+${e.new_string}`] }],
          userModified: false,
          replaceAll: false,
        },
      };
    }
    return { result: "" };
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
            id: "memory-watch",
            title: "Memory",
            isShown: true,
            isFocused: false,
            isPlaced: true,
          },
        ]
      : [],
  }));
  return { seen, files };
}

const write = ($: any, file_path: string, content: string) =>
  $.tool.call({ tool: "Write", file_path, content });
const edit = ($: any, file_path: string, new_string: string) =>
  $.tool.call({ tool: "Edit", file_path, old_string: "x", new_string });

describe("session", () => {
  test("memory writes list in the pane, newest first", async ($, on) => {
    engine(on);
    await write($, `${DIR}/feedback_version_bumps.md`, MEMO);
    await edit($, `${DIR}/MEMORY.md`, "- [x](x.md)"); // fails: no such file
    await write($, `${DIR}/MEMORY.md`, "# Memory Index\n");
    await edit($, `${DIR}/MEMORY.md`, "- [x](x.md)\n");
    await write($, "/home/u/repo/notes.md", MEMO); // not memory

    await $.command.run({ command: "memory-watch", args: "" } as never);
    const ui = await $.ui.mount({
      plugin: "memory-watch",
      surface: "terminal",
      ...PANE,
    });
    const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
    expect(texts).toEqual([
      "MEMORY.md (index)",
      "09:05 updated · +1 −0",
      "MEMORY.md (index)",
      "09:05 created · +1 −0",
      "version-bumps",
      "09:05 created · feedback · +8 −0",
      "Always bump the plugin version after changes",
    ]);
    await ui.unmount();
  });

  test("an empty pane says so", async ($, on) => {
    engine(on);
    await $.command.run({ command: "memory-watch", args: "" } as never);
    const ui = await $.ui.mount({
      plugin: "memory-watch",
      surface: "terminal",
      ...PANE,
    });
    expect(
      await ui.find({ type: "Text", text: "No memory written this session." }),
    ).toBeDefined();
    await ui.unmount();
  });

  test("/memory-watch opens the pane, then closes it", async ($, on) => {
    const { seen } = engine(on);
    const run = () =>
      $.command.run({ command: "memory-watch", args: "" } as never);
    expect((await run()).text).toBe("Memory pane opened.");
    expect((await run()).text).toBe("Memory pane closed.");
    expect([seen.opened, seen.closed]).toEqual([1, 1]);
  });

  test("the band line shows and hides the pane, counting unread writes", async ($, on) => {
    const { seen } = engine(on);
    const mount = () =>
      $.ui.mount({ plugin: "memory-watch", surface: "terminal", ...BAND });

    let ui = await mount();
    expect((await ui.find({ key: "memory-watch-toggle" }))?.text).toBe("show");
    expect(await ui.find({ type: "Text", text: /new/ })).toBeUndefined();
    await ui.unmount();

    await write($, `${DIR}/a.md`, MEMO);
    await write($, `${DIR}/b.md`, MEMO);
    ui = await mount();
    expect(await ui.find({ type: "Text", text: "● 2 new" })).toBeDefined();
    await ui.press({ key: "memory-watch-toggle" });
    expect(seen.opened).toBe(1);
    await ui.unmount();

    // read while open: nothing counts
    await write($, `${DIR}/c.md`, MEMO);
    ui = await mount();
    expect((await ui.find({ key: "memory-watch-toggle" }))?.text).toBe("hide");
    expect(await ui.find({ type: "Text", text: /new/ })).toBeUndefined();
    await ui.press({ key: "memory-watch-toggle" });
    expect(seen.closed).toBe(1);
    await ui.unmount();

    ui = await mount();
    expect((await ui.find({ key: "memory-watch-toggle" }))?.text).toBe("show");
    expect(await ui.find({ type: "Text", text: /new/ })).toBeUndefined();
    await ui.unmount();
  });
});
