import { describe, expect, mock, test } from "claude-code/testing";

import {
  accountOf,
  addHits,
  colorFor,
  decideTtl,
  expiryOf,
  fmtClock,
  hitColor,
  hitPercent,
  observeTtl,
  type Sample,
} from "../hooks/ttl.ts";

const T0 = 1_000_000_000_000;
const sample = (over: Partial<Sample> = {}): Sample => ({
  model: "claude-opus-5-5",
  startedAt: T0,
  read: 80_000,
  write: 1_000,
  fresh: 500,
  ...over,
});

describe("ttl", () => {
  test("follows Claude Code's order, then the account", () => {
    expect(decideTtl("auto", {}, undefined, "subscription")).toBe("1h");
    expect(decideTtl("auto", {}, undefined, "credits")).toBe("5m");
    expect(decideTtl("auto", {}, undefined, "other")).toBe("5m");
    expect(decideTtl("auto", { force5m: "1" }, "1h", "subscription")).toBe(
      "5m",
    );
    expect(decideTtl("auto", { ttlVar: "1h" }, "5m")).toBe("1h");
    expect(decideTtl("auto", {}, "1h", "other")).toBe("1h");
    expect(decideTtl("5m", { enable1h: "1" }, undefined, "subscription")).toBe(
      "5m",
    );
  });

  test("account from rate-limit windows", () => {
    expect(accountOf([])).toBe("other");
    expect(accountOf([{ kind: "five_hour", percentUsed: 40 }])).toBe(
      "subscription",
    );
    expect(accountOf([{ kind: "five_hour", percentUsed: 100 }])).toBe(
      "credits",
    );
  });

  test("a hit after more than 5 minutes proves 1h; a lapse says 5m", () => {
    const prev = sample();
    expect(
      observeTtl(prev, sample({ startedAt: T0 + 20 * 60_000 }), undefined),
    ).toBe("1h");
    const miss = sample({
      startedAt: T0 + 20 * 60_000,
      read: 0,
      write: 82_000,
    });
    expect(observeTtl(prev, miss, undefined)).toBe("5m");
    expect(observeTtl(prev, miss, "1h")).toBe("1h");
    expect(
      observeTtl(prev, sample({ startedAt: T0 + 60_000 }), undefined),
    ).toBeUndefined();
  });
});

describe("countdown", () => {
  test("expiry counts from the request's start; no cache, no expiry", () => {
    expect(expiryOf(sample(), "1h")).toBe(T0 + 3_600_000);
    expect(expiryOf(sample(), "5m")).toBe(T0 + 300_000);
    expect(expiryOf(sample({ read: 0, write: 0 }), "1h")).toBeUndefined();
  });

  test("colour steps at 25% and 10% of the lifetime", () => {
    const life = 3_600_000;
    expect(colorFor(20 * 60_000, life, 0.25, 0.1)).toBe("green");
    expect(colorFor(15 * 60_000, life, 0.25, 0.1)).toBe("yellow");
    expect(colorFor(7 * 60_000, life, 0.25, 0.1)).toBe("yellow");
    expect(colorFor(6 * 60_000, life, 0.25, 0.1)).toBe("red");
    expect(colorFor(1_000, 300_000, 0.25, 0.1)).toBe("red");
    expect(colorFor(5_000, 0, 0.25, 0.1)).toBe("red");
    expect(colorFor(0, 0, 0.25, 0.1)).toBe("red");
    expect(colorFor(100, -1, 0.25, 0.1)).toBe("red");
  });

  test("clock format", () => {
    expect(fmtClock(3_600_000)).toBe("1:00:00");
    expect(fmtClock(59 * 60_000 + 1)).toBe("59:01");
    expect(fmtClock(1)).toBe("0:01");
    expect(fmtClock(-5)).toBe("0:00");
  });
});

describe("hit rate", () => {
  test("sums the session's prompt tokens; the cache's share rounds down", () => {
    const one = addHits(null, sample());
    expect(one).toEqual({ read: 80_000, total: 81_500 });
    const two = addHits(one, sample({ read: 0, write: 82_000, fresh: 0 }));
    expect(two).toEqual({ read: 80_000, total: 163_500 });
    expect(hitPercent(one)).toBe(98);
    expect(hitPercent(two)).toBe(48);
    expect(hitPercent({ read: 999, total: 1_000 })).toBe(99);
    expect(hitPercent({ read: 1_000, total: 1_000 })).toBe(100);
  });

  test("no figure before a prompt token", () => {
    expect(hitPercent(null)).toBeUndefined();
    expect(hitPercent({ read: 0, total: 0 })).toBeUndefined();
  });

  test("colour steps at 90% and 70%", () => {
    expect(hitColor(100, 90, 70)).toBe("green");
    expect(hitColor(90, 90, 70)).toBe("green");
    expect(hitColor(89, 90, 70)).toBe("yellow");
    expect(hitColor(70, 90, 70)).toBe("yellow");
    expect(hitColor(69, 90, 70)).toBe("red");
    expect(hitColor(0, 90, 70)).toBe("red");
  });
});

const BAND = {
  component: "AbovePrompt" as const,
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
};

/** The engine's side: an empty band, a subscription, and one request's usage. */
function engine(
  on: any,
  usage: { read: number; write: number } | null,
  below: unknown = h("Box", null),
) {
  mock.clock(on, { now: Date.now() });
  on("ui.render", () => below);
  on("session.measure", (_$: unknown, e: { changed: string[] }) => ({
    changed: e.changed,
  }));
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, percent: 29 },
      rateLimits: [{ kind: "five_hour", percentUsed: 10 }],
    },
  }));
  on("turn.step", async function* () {
    return {
      turnId: "t1",
      index: 0,
      answer: "",
      toolUses: [],
      stopReason: "end_turn",
      usage: usage && {
        model: "claude-opus-5-5",
        input_tokens: 10,
        output_tokens: 10,
        cache_read_input_tokens: usage.read,
        cache_creation_input_tokens: usage.write,
      },
    };
  });
}

/** The gauge draws once a measure reported the context. */
const measure = ($: any) =>
  $.session.measure({
    context: { window: 1_000_000, percent: 29 },
    rateLimits: [],
    changed: ["context"],
  } as never);

async function step($: any) {
  const stream = $.turn.step({
    turnId: "t1",
    index: 0,
    model: "claude-opus-5-5",
    messageCount: 1,
  });
  for await (const _ of stream) {
    // drain
  }
  return stream.result;
}

const CLOCK = /^(59|1:00):\d\d$/;

const HIT = /^\d+%$/;

/** The hit rate's figure in the gauge, if drawn: the coloured one (the desktop's fill is a bare "29%" too). */
const hitFigure = async (ui: any) =>
  (await ui.findAll({ in: "continuity-gauge", type: "Text", text: HIT })).find(
    (t: any) => t.props.color,
  );

describe("band", () => {
  for (const surface of ["terminal", "desktop"] as const) {
    test(`no clock before the first request (${surface})`, async ($, on) => {
      engine(on, null);
      await measure($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect(await ui.find({ key: "continuity-gauge" })).toBeDefined();
      expect(
        await ui.find({ in: "continuity-gauge", type: "Text", text: CLOCK }),
      ).toBeUndefined();
      await ui.unmount();
    });
  }

  test("a request that hit the cache starts a ticking clock on the gauge's line", async ($, on) => {
    engine(on, { read: 80_000, write: 1_000 });
    await measure($);
    await step($);
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      const text = await ui.find({
        in: "continuity-gauge",
        type: "Text",
        text: CLOCK,
      });
      expect(text?.props.color).toBe("green");
      await ui.unmount();
    }
  });

  for (const surface of ["terminal", "desktop"] as const) {
    test(`a request that touched no cache draws no clock (${surface})`, async ($, on) => {
      engine(on, { read: 0, write: 0 });
      await measure($);
      await step($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect(
        await ui.find({ in: "continuity-gauge", type: "Text", text: CLOCK }),
      ).toBeUndefined();
      await ui.unmount();
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`a subagent's request leaves the clock alone (${surface})`, async ($, on) => {
      engine(on, { read: 80_000, write: 1_000 });
      await measure($);
      const stream = $.turn.step({
        turnId: "t1",
        index: 0,
        model: "claude-opus-5-5",
        messageCount: 1,
        agentId: "a1",
      } as never);
      for await (const _ of stream) {
        // drain
      }
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect(
        await ui.find({ in: "continuity-gauge", type: "Text", text: CLOCK }),
      ).toBeUndefined();
      await ui.unmount();
    });
  }

  for (const surface of ["terminal", "desktop"] as const) {
    test(`no hit rate before the first request (${surface})`, async ($, on) => {
      engine(on, null);
      await measure($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect(await hitFigure(ui)).toBeUndefined();
      await ui.unmount();
    });

    test(`a warm request shows a green hit rate (${surface})`, async ($, on) => {
      engine(on, { read: 80_000, write: 1_000 });
      await measure($);
      await step($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      const fig = await hitFigure(ui);
      // 80000 / (80000 + 1000 + 10)
      expect(fig?.children).toEqual(["98%"]);
      expect(fig?.props.color).toBe("green");
      await ui.unmount();
    });

    test(`a request that rewrote the cache shows red (${surface})`, async ($, on) => {
      engine(on, { read: 0, write: 82_000 });
      await measure($);
      await step($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      const fig = await hitFigure(ui);
      expect(fig?.children).toEqual(["0%"]);
      expect(fig?.props.color).toBe("red");
      await ui.unmount();
    });

    test(`the rate survives a reload and /clear resets it (${surface})`, async ($, on) => {
      engine(on, { read: 80_000, write: 1_000 });
      mock.env(on, { HOME: "/h" });
      const engineOn = on as any;
      engineOn("command.register", () => ({ value: undefined }));
      engineOn("session.cwd", () => ({ value: "/r" }));
      engineOn("session.start", (_$: unknown, e: unknown) => e);
      engineOn("session.end", (_$: unknown, e: unknown) => e);
      await measure($);
      await step($);
      await $.session.start({ cwd: "/r" } as never);
      let ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect((await hitFigure(ui))?.children).toEqual(["98%"]);
      await ui.unmount();
      await $.session.end({ reason: "clear", sessionId: "s1" } as never);
      ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      expect(await hitFigure(ui)).toBeUndefined();
      await ui.unmount();
    });
  }

  test("a subagent's request leaves the hit rate alone", async ($, on) => {
    engine(on, { read: 0, write: 82_000 });
    await measure($);
    const stream = $.turn.step({
      turnId: "t1",
      index: 0,
      model: "claude-opus-5-5",
      messageCount: 1,
      agentId: "a1",
    } as never);
    for await (const _ of stream) {
      // drain
    }
    const ui = await $.ui.mount({
      plugin: "continuity",
      surface: "terminal",
      ...BAND,
    });
    expect(await hitFigure(ui)).toBeUndefined();
    await ui.unmount();
  });

  /** Each plugin's part of the band, as the engine stacks them: by the plugin that drew it. */
  const partOf = (drawn: any, plugin: string) =>
    drawn.part?.plugin === plugin
      ? drawn
      : drawn.children.find((c: any) => c.part?.plugin === plugin);

  for (const surface of ["terminal", "desktop"] as const) {
    test(`its row is its own part of the band, with no blank row above it (${surface})`, async ($, on) => {
      engine(on, { read: 80_000, write: 1_000 }, h("Text", null, "Heads up"));
      await measure($);
      const ui = await $.ui.mount({ plugin: "continuity", surface, ...BAND });
      const drawn: any = await ui.drawn();
      // another plugin's line is a part of its own, never inside this one
      expect(partOf(drawn, "test").children).toEqual(["Heads up"]);
      const own = partOf(drawn, "continuity");
      expect(own.props).toEqual({ flexDirection: "column" });
      expect(own.children.map((c: any) => c.type)).toEqual(["engine", "Box"]);
      expect(own.children[1].props.key).toBe("band:continuity");
      expect(own.children[1].props.marginTop).toBeUndefined();
      await ui.unmount();
    });
  }

  test("a surface with no Client draws the gauge as one plain line", async ($, on) => {
    engine(on, { read: 80_000, write: 1_000 }, h("Text", null, "Heads up"));
    await measure($);
    await step($);
    const ui = await $.ui.mount({
      plugin: "continuity",
      surface: "mobile",
      ...BAND,
    });
    const own = partOf(await ui.drawn(), "continuity");
    expect(own.children[1].props.key).toBe("band:continuity");
    expect(own.children[1].children[0].type).toBe("Text");
    expect(
      await ui.find({
        type: "Text",
        text: /^ctx [█░]+ 29% · session .* · hit 98% · cache until \d\d:\d\d$/,
      }),
    ).toBeDefined();
    await ui.unmount();
  });
});
