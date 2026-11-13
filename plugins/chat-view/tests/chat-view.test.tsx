import { describe, expect, mock, test } from "claude-code/testing";

import {
  bubbleWidth,
  cap,
  cellWidth,
  fmtDuration,
  fmtTime,
  isOwnPrompt,
  parseTranscript,
  promptText,
  stampReply,
  turnEnd,
  turnRange,
} from "../hooks/core.ts";

/** Beneath the plugin: the engine draws a row's (possibly rewritten) text. */
const echoText = (on: any) =>
  on("ui.render", (_$: unknown, e: { props: { text?: string } }) =>
    h("Text", null, e.props.text ?? "engine") as never,
  );

const at = (h: number, m: number, s: number, day = 5) =>
  new Date(2026, 9, day, h, m, s).getTime();

describe("formatting", () => {
  test("today shows the clock, another day adds the date", () => {
    const now = at(18, 0, 0);
    expect(fmtTime(at(16, 42, 7), now, true)).toBe("16:42:07");
    expect(fmtTime(at(16, 42, 7), now, false)).toBe("16:42");
    expect(fmtTime(at(23, 10, 5, 4), now, true)).toBe("Oct 4 23:10:05");
  });

  test("durations as the engine writes them", () => {
    expect(fmtDuration(3000)).toBe("3s");
    expect(fmtDuration(64_000)).toBe("1m 4s");
    expect(fmtDuration(3_720_000)).toBe("1h 2m");
  });

  test("a turn's range runs from end minus duration to end", () => {
    expect(turnRange(at(16, 45, 11), 184_000, at(18, 0, 0), true)).toBe(
      "16:42:07 → 16:45:11",
    );
  });
});

describe("transcript", () => {
  const rows = [
    {
      type: "user",
      uuid: "u1",
      timestamp: "2026-10-05T13:42:07.000Z",
      message: { role: "user", content: "fix the race" },
    },
    {
      type: "user",
      uuid: "u2",
      timestamp: "2026-10-05T13:43:00.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }],
      },
    },
    {
      type: "user",
      uuid: "u3",
      isMeta: true,
      timestamp: "2026-10-05T13:43:01.000Z",
      message: { content: "meta" },
    },
    {
      type: "system",
      subtype: "turn_duration",
      durationMs: 62053,
      timestamp: "2026-10-05T13:45:11.000Z",
    },
  ];
  const parsed = parseTranscript(
    rows.map((r) => JSON.stringify(r)).join("\n") + "\nnot json\n",
  );

  test("typed prompts by id and text; tool results and meta rows skipped", () => {
    expect(parsed.sent).toEqual({ u1: Date.parse("2026-10-05T13:42:07.000Z") });
    expect(parsed.byText["fix the race"]).toBe(
      Date.parse("2026-10-05T13:42:07.000Z"),
    );
  });

  test("turn ends by duration, matched exactly or within a second", () => {
    const end = Date.parse("2026-10-05T13:45:11.000Z");
    expect(turnEnd(parsed.turns, 62053)).toBe(end);
    expect(turnEnd(parsed.turns, 62500)).toBe(end);
    expect(turnEnd(parsed.turns, 70000)).toBeUndefined();
  });

  test("prompt text from string or text blocks", () => {
    expect(promptText("hi")).toBe("hi");
    expect(promptText([{ type: "text", text: "a" }, { type: "image" }])).toBe(
      "a",
    );
    expect(promptText([{ type: "tool_result" }])).toBeUndefined();
  });

  test("cap keeps the newest entries", () => {
    expect(Object.keys(cap({ a: 1, b: 3, c: 2 }, 2)).sort()).toEqual([
      "b",
      "c",
    ]);
  });

  test("cap to zero keeps nothing", () => {
    expect(cap({ a: 1, b: 3 }, 0)).toEqual({});
  });
});

describe("rows", () => {
  test("a resumed session's typed prompt gets its send time; a notification's does not", async ($, on) => {
    mock.clock(on, { now: at(18, 0, 0) });
    const row = {
      type: "user",
      uuid: "row-1",
      timestamp: new Date(at(16, 42, 7)).toISOString(),
      message: { content: "run the tests" },
    };
    on("fs.read", () => ({ value: JSON.stringify(row) + "\n" }));
    on("classic.SessionStart", () => ({}));
    echoText(on);
    await $.classic.SessionStart({
      source: "resume",
      transcript_path: "/t.jsonl",
    } as never);

    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "chat-view",
        surface,
        component: "UserMessage",
        requestId: "row-1",
        props: {
          text: "run the tests",
          origin: { kind: "composer" },
          isExpanded: false,
        } as never,
      });
      if (surface === "terminal") {
        expect((await ui.find({ key: "chat-view-bubble" }))?.text).toBe(
          "run the tests",
        );
        expect(await ui.find({ type: "Text", text: "16:42:07" })).toBeDefined();
      } else {
        expect(
          await ui.find({ type: "Text", text: "16:42:07 · run the tests" }),
        ).toBeDefined();
      }
      await ui.unmount();

      const other = await $.ui.mount({
        plugin: "chat-view",
        surface,
        component: "UserMessage",
        props: {
          text: "task done",
          origin: { kind: "task-notification" },
          isExpanded: false,
        } as never,
      });
      expect(
        await other.find({ type: "Text", text: "task done" }),
      ).toBeDefined();
      expect(await other.find({ key: "chat-view-bubble" })).toBeUndefined();
      await other.unmount();
    }
  });

  test("the turn line gets start and end, from the engine's clock", async ($, on) => {
    mock.clock(on, { now: at(16, 45, 11) });
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    on("ui.render", () => h("Text", null, "✻ Baked for 3s") as never);
    await $.turn.complete({
      answer: "",
      durationMs: 3000,
      isAborted: false,
      turnId: "t1",
      reason: "answer",
    } as never);
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "chat-view",
        surface,
        component: "TurnDuration",
        props: { word: "Baked", durationMs: 3000 },
      });
      expect(
        await ui.find({
          type: "Text",
          text: "✻ Baked for 3s · 16:45:08 → 16:45:11",
        }),
      ).toBeDefined();
      await ui.unmount();
    }
  });

  test("the transcript is read on resume and fork, not on a fresh start", async ($, on) => {
    const reads: string[] = [];
    on("fs.read", (_$, e) => {
      reads.push(e.path);
      return { value: "" };
    });
    on("classic.SessionStart", () => ({}));
    for (const source of ["startup", "clear", "compact"] as const)
      await $.classic.SessionStart({
        source,
        transcript_path: `/${source}.jsonl`,
      } as never);
    expect(reads).toEqual([]);
    for (const source of ["resume", "fork"] as const)
      await $.classic.SessionStart({
        source,
        transcript_path: `/${source}.jsonl`,
      } as never);
    expect(reads).toEqual(["/resume.jsonl", "/fork.jsonl"]);
  });
});

describe("chat view helpers", () => {
  test("the person's own prompts: terminal, desktop (sdk or unstamped) and Remote Control", () => {
    for (const kind of ["composer", "sdk", "bridge", "unclassified"])
      expect(isOwnPrompt({ kind })).toBe(true);
    for (const kind of ["task-notification", "peer", "plugin", "channel", "scheduled-trigger"])
      expect(isOwnPrompt({ kind })).toBe(false);
  });

  test("the bubble fits its longest line, up to 70% of the row, all of a narrow one", () => {
    expect(bubbleWidth("hi", 100)).toBe(6);
    expect(bubbleWidth("short\na longer line", 100)).toBe(17);
    expect(bubbleWidth("x".repeat(200), 100)).toBe(70);
    expect(bubbleWidth("x".repeat(200), 50)).toBe(50);
    expect(bubbleWidth("", 100)).toBe(5);
    expect(bubbleWidth("Привет", 100)).toBe(10);
    expect(bubbleWidth("x\n".repeat(200_000), 100)).toBe(5);
  });

  test("wide characters take two cells", () => {
    expect(cellWidth("日本")).toBe(4);
    expect(cellWidth("🙂a")).toBe(3);
    expect(cellWidth("ok")).toBe(2);
  });

  test("a reply's time goes in front of a paragraph, on its own line before a block", () => {
    const now = at(18, 0, 0);
    const t = at(16, 42, 7);
    expect(stampReply("The folder is set.", t, now, true)).toBe(
      "16:42:07 · The folder is set.",
    );
    for (const block of ["# Title", "- item", "1. step", "> quote", "```ts\nx\n```", "| a |", "    code", "---"])
      expect(stampReply(block, t, now, true)).toBe(`16:42:07\n\n${block}`);
    for (const inline of ["**Done.**", "_note_", "2026 was fine.", "-1 is negative."])
      expect(stampReply(inline, t, now, true)).toBe(`16:42:07 · ${inline}`);
  });

  test("a resumed transcript's reply rows by uuid and text; a sidechain's and a tool call's skipped", () => {
    const ts = "2026-10-05T13:42:09.000Z";
    const rows = [
      { type: "assistant", uuid: "a1", timestamp: ts, message: { content: [{ type: "text", text: " Done. " }] } },
      { type: "assistant", uuid: "a2", timestamp: ts, message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } },
      { type: "assistant", uuid: "a3", isSidechain: true, timestamp: ts, message: { content: [{ type: "text", text: "sub" }] } },
    ];
    const parsed = parseTranscript(rows.map((r) => JSON.stringify(r)).join("\n"));
    expect(parsed.replies).toEqual({ a1: Date.parse(ts) });
    expect(parsed.repliesByText).toEqual({ "Done.": Date.parse(ts) });
  });
});

/** Raises the person's prompt as a session appends it, from `kind`. */
const appendPrompt = ($: any, uuid: string, text: string, kind: string) =>
  $.session.append({
    door: "prompt",
    origin: { kind },
    uuid,
    message: { type: "user", role: "user", content: [{ type: "text", text }] },
  });

describe("live times", () => {
  test("a desktop prompt (sdk or unstamped) gets its send time; a peer's does not", async ($, on) => {
    mock.clock(on, { now: at(9, 30, 0) });
    echoText(on);
    await appendPrompt($, "d1", "from the desktop", "sdk");
    await appendPrompt($, "d2", "unstamped desktop", "unclassified");
    await appendPrompt($, "p1", "a peer says hi", "peer");
    const cases = [
      ["d1", "from the desktop", "sdk", "09:30:00 · from the desktop"],
      ["d2", "unstamped desktop", "unclassified", "09:30:00 · unstamped desktop"],
      ["p1", "a peer says hi", "peer", "a peer says hi"],
    ] as const;
    for (const [requestId, text, kind, drawn] of cases) {
      const ui = await $.ui.mount({
        plugin: "chat-view",
        surface: "desktop",
        component: "UserMessage",
        requestId,
        props: { text, origin: { kind }, isExpanded: false } as never,
      });
      expect(await ui.find({ type: "Text", text: drawn })).toBeDefined();
      await ui.unmount();
    }
  });

  test("a teammate's message is no bubble, even unstamped", async ($, on) => {
    echoText(on);
    const ui = await $.ui.mount({
      plugin: "chat-view",
      surface: "terminal",
      component: "UserMessage",
      props: {
        text: "ping",
        origin: { kind: "unclassified" },
        from: { kind: "teammate", name: "rev" },
        isExpanded: false,
      } as never,
    });
    expect(await ui.find({ key: "chat-view-bubble" })).toBeUndefined();
    await ui.unmount();
  });

  test("bubbles off: the terminal stamps the text in place", { options: { bubbles: false } }, async ($, on) => {
    mock.clock(on, { now: at(9, 30, 0) });
    echoText(on);
    await appendPrompt($, "u1", "plain row", "composer");
    const ui = await $.ui.mount({
      plugin: "chat-view",
      surface: "terminal",
      component: "UserMessage",
      requestId: "u1",
      props: { text: "plain row", origin: { kind: "composer" }, isExpanded: false } as never,
    });
    expect(await ui.find({ type: "Text", text: "09:30:00 · plain row" })).toBeDefined();
    expect(await ui.find({ key: "chat-view-bubble" })).toBeUndefined();
    await ui.unmount();
  });

  test("the bubble's width follows the row's columns", async ($, on) => {
    mock.clock(on, { now: at(9, 30, 0) });
    on("ui.render", () => h("Text", null, "engine") as never);
    for (const [columns, width] of [[120, 84], [40, 40]] as const) {
      const ui = await $.ui.mount({
        plugin: "chat-view",
        surface: "terminal",
        component: "UserMessage",
        viewport: { columns, rows: 40 },
        props: { text: "y".repeat(300), origin: { kind: "composer" }, isExpanded: false } as never,
      });
      expect((await ui.find({ key: "chat-view-bubble" }))?.props.width).toBe(width);
      await ui.unmount();
    }
  });

  test("a reply's time is when its first token streamed, not when its row was written", async ($, on) => {
    const clock = mock.clock(on, { now: at(10, 0, 0) });
    echoText(on);
    on("turn.step", async function* () {
      yield { kind: "text", index: 0, text: "\n" };
      await clock.advance(2000); // blank so far: no first token yet
      yield { kind: "text", index: 0, text: "First" };
      await clock.advance(5000);
      yield { kind: "text", index: 0, text: " answer." };
      yield { kind: "text", index: 1, text: "Second block." };
      return { turnId: "t1", index: 0, answer: "First answer.Second block.", toolUses: [], stopReason: "end_turn" };
    } as never);
    const stream = $.turn.step({ turnId: "t1", index: 0, model: "claude-opus-5-5", messageCount: 1 });
    for await (const _ of stream) {
      // drain
    }
    await clock.advance(30_000); // the rows are written later
    const reply = (uuid: string, text: string) =>
      $.session.append({
        door: "response",
        origin: { kind: "model", model: "claude-opus-5-5" },
        uuid,
        message: { type: "assistant", role: "assistant", content: [{ type: "text", text }] },
      });
    await reply("r1", "First answer.");
    await reply("r2", "Second block.");
    await reply("r3", "API Error: overloaded"); // no streamed token: the row's own time

    for (const surface of ["terminal", "desktop"] as const) {
      for (const [requestId, text, drawn] of [
        ["r1", "First answer.", "10:00:02 · First answer."],
        ["r2", "Second block.", "10:00:07 · Second block."],
        ["r3", "API Error: overloaded", "10:00:37 · API Error: overloaded"],
      ] as const) {
        const ui = await $.ui.mount({
          plugin: "chat-view",
          surface,
          component: "AssistantMessage",
          requestId,
          props: { text, isFirstOfReply: true },
        });
        expect(await ui.find({ type: "Text", text: drawn })).toBeDefined();
        await ui.unmount();
      }
      const cont = await $.ui.mount({
        plugin: "chat-view",
        surface,
        component: "AssistantMessage",
        requestId: "r1",
        props: { text: "First answer.", isFirstOfReply: false },
      });
      expect(await cont.find({ type: "Text", text: "First answer." })).toBeDefined();
      await cont.unmount();
    }
  });

  test("a subagent's stream and rows leave the main replies alone", async ($, on) => {
    mock.clock(on, { now: at(11, 0, 0) });
    echoText(on);
    on("turn.step", async function* () {
      yield { kind: "text", index: 0, text: "sub text" };
      return { turnId: "t2", index: 0, answer: "sub text", toolUses: [], stopReason: "end_turn" };
    } as never);
    const stream = $.turn.step({ turnId: "t2", index: 0, model: "claude-haiku-5-5", messageCount: 1, agentId: "a1" });
    for await (const _ of stream) {
      // drain
    }
    await $.session.append({
      door: "response",
      origin: { kind: "model", model: "claude-haiku-5-5" },
      uuid: "s1",
      agentId: "a1",
      message: { type: "assistant", role: "assistant", content: [{ type: "text", text: "sub text" }] },
    });
    const ui = await $.ui.mount({
      plugin: "chat-view",
      surface: "desktop",
      component: "AssistantMessage",
      requestId: "s1",
      props: { text: "sub text", isFirstOfReply: true },
    });
    expect(await ui.find({ type: "Text", text: "sub text" })).toBeDefined();
    await ui.unmount();
  });
});
