import { describe, expect, test } from "claude-code/testing";

import {
  cap,
  fmtDuration,
  fmtTime,
  parseTranscript,
  promptText,
  turnEnd,
  turnRange,
} from "../hooks/core.ts";

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
    const row = {
      type: "user",
      uuid: "row-1",
      timestamp: new Date().toISOString(),
      message: { content: "run the tests" },
    };
    on("fs.read", () => ({ value: JSON.stringify(row) + "\n" }));
    on("classic.SessionStart", () => ({}));
    on(
      "ui.render",
      (_$, e) =>
        h(
          "Text",
          null,
          (e.props as { text?: string }).text ?? "engine",
        ) as never,
    );
    await $.classic.SessionStart({
      source: "resume",
      transcript_path: "/t.jsonl",
    } as never);

    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({
        plugin: "prompt-clock",
        surface,
        component: "UserMessage",
        requestId: "row-1",
        props: {
          text: "run the tests",
          origin: { kind: "composer" },
          isExpanded: false,
        } as never,
      });
      expect(
        await ui.find({
          type: "Text",
          text: /^\d\d:\d\d:\d\d · run the tests$/,
        }),
      ).toBeDefined();
      await ui.unmount();

      const other = await $.ui.mount({
        plugin: "prompt-clock",
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
      await other.unmount();
    }
  });

  test("the turn line gets start and end", async ($, on) => {
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    on("ui.render", () => h("Text", null, "✻ Baked for 3s") as never);
    await $.turn.complete({
      answer: "",
      durationMs: 3000,
      isAborted: false,
      turnId: "t1",
      reason: "answer",
    } as never);
    const ui = await $.ui.mount({
      plugin: "prompt-clock",
      surface: "terminal",
      component: "TurnDuration",
      props: { word: "Baked", durationMs: 3000 },
    });
    expect(
      await ui.find({
        type: "Text",
        text: /^✻ Baked for 3s · \d\d:\d\d:\d\d → \d\d:\d\d:\d\d$/,
      }),
    ).toBeDefined();
    await ui.unmount();
  });
});
