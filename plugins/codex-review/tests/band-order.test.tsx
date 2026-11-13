import { describe, expect, test } from "claude-code/testing";

import { bandOrder } from "../hooks/core.ts";

const row = (plugin: string) => ({
  plugin,
  tree: h("Box", { key: `band:${plugin}` }),
});
const names = (rows: { plugin: string }[]) => rows.map((r) => r.plugin);

describe("band order", () => {
  test("codex, ctx, then model and effort are last; the rest keep their order", () => {
    expect(
      names(
        bandOrder(
          ["effort-pilot", "ship", "continuity", "fleet", "codex-review"].map(row),
        ),
      ),
    ).toEqual(["ship", "fleet", "codex-review", "continuity", "effort-pilot"]);
    expect(names(bandOrder(["continuity", "ship"].map(row)))).toEqual([
      "ship",
      "continuity",
    ]);
    expect(names(bandOrder([]))).toEqual([]);
  });

  test("applying it again changes nothing, so the chain's order doesn't matter", () => {
    const once = bandOrder(
      ["continuity", "effort-pilot", "watchdog", "codex-review"].map(row),
    );
    expect(bandOrder(once)).toEqual(once);
  });

  for (const surface of ["terminal", "desktop"] as const)
    test(`the band is stacked in that order (${surface})`, async ($) => {
      const ui = await $.ui.mount({
        plugin: "codex-review",
        surface,
        component: "AbovePromptList",
        props: {
          hasSurvey: false,
          isCollapsed: false,
          isWorking: false,
          maxRows: 10,
          bodyColumns: 120,
          scroll: { offset: 0, bodyRows: 10 },
          view: {},
          rows: ["continuity", "effort-pilot", "ship", "codex-review"].map(row),
        } as never,
      });
      const drawn: any = await ui.drawn();
      await ui.unmount();
      expect(drawn.children.map((c: any) => c.props.key)).toEqual([
        "band:ship",
        "band:codex-review",
        "band:continuity",
        "band:effort-pilot",
      ]);
    });
});
