import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { PaletteGroup, PaletteItem } from "../types";
import { buildGroups, fillFor, label, projectPaths } from "./core.ts";

const PANE = "palette";
const SELF = "palette";

const groups = atom(
  { plugin: "palette", key: "groups" } as const,
  [] as PaletteGroup[],
);
const pane = atom({ plugin: "palette", key: "pane" } as const, false);
const folded = atom(
  { plugin: "palette", key: "folded" } as const,
  [] as string[],
);
const agentInfo = atom(
  { plugin: "palette", key: "agentInfo" } as const,
  {} as Record<string, string>,
);

/** Reads the session's commands, skills and custom agents into `groups`. */
async function refresh($: EngineInterface): Promise<void> {
  const commands = await $.command.list().catch(() => []);
  const usage = await $.session
    .usage({ breakdown: "summary" })
    .catch(() => undefined);
  const agents = usage?.context.breakdown?.agents ?? [];
  const local = await Promise.all(
    commands
      .filter((c) => c.source === "user")
      .map(async (c) => {
        const hits = await Promise.all(
          projectPaths(c.name).map((p) => $.fs.exists(p).catch(() => false)),
        );
        return hits.some(Boolean) ? c.name : undefined;
      }),
  );
  const projectNames = new Set(local.filter((n) => n !== undefined));
  await update($, groups, () =>
    buildGroups(commands, agents, projectNames, SELF),
  );
}

async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: "Palette" });
  await update($, pane, () => opened.isPlaced);
  await refresh($);
  return opened;
}

/** Closes the pane if the stored state says open, opens it if not. */
async function togglePane($: EngineInterface) {
  if (await read($, pane)) {
    await $.ui.close({ id: PANE });
    await update($, pane, () => false);
    return undefined;
  }
  return openPane($);
}

async function press($: EngineInterface, item: PaletteItem) {
  const box = await $.prompt.read();
  const filled = await $.prompt.fill(fillFor(item, box.text, box.cursor));
  if (!filled.isFilled)
    $.ui.toast(`palette: the prompt box did not take ${label(item)}`);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "palette",
      description:
        "Show or hide the pane listing this session's agents, skills and commands",
    });
    // a reload keeps an open pane
    const panes = await $.ui.panes().catch(() => []);
    const isOpen = panes.some((p) => p.id === PANE && p.isPlaced);
    await update($, pane, () => isOpen);
    if (isOpen) await refresh($);
    return r;
  });

  on("command.run", { command: "palette" }, async ($) => {
    const opened = await togglePane($);
    return {
      text: !opened
        ? "Palette closed."
        : opened.isPlaced
          ? "Palette opened."
          : "Palette is waiting for a wider terminal.",
    };
  });

  // the context's agent listing has no descriptions; the model's offer does
  on("agent.offer", async ($, e, next) => {
    const r = await next(e);
    if ((await read($, agentInfo))[e.agent] !== e.description)
      await update($, agentInfo, (m) => ({ ...m, [e.agent]: e.description }));
    return r;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e);
    const all = await read($, groups);
    const shut = new Set(await read($, folded));
    const info = await read($, agentInfo);
    const toggle = (id: string) =>
      update($, folded, (f) =>
        f.includes(id) ? f.filter((x) => x !== id) : [...f, id],
      );

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>Click to put it in the prompt</Text>
          <Button
            key="palette-refresh"
            plain
            dimColor
            onPress={() => refresh($)}
          >
            ↻
          </Button>
        </Box>
        {all.length === 0 && (
          <Text dimColor>No agents, skills or commands.</Text>
        )}
        {all.map((g) => (
          <Box key={`section:${g.id}`} flexDirection="column" marginTop={1}>
            <Button key={`group:${g.id}`} plain onPress={() => toggle(g.id)}>
              {`${shut.has(g.id) ? "▸" : "▾"} ${g.title} (${g.items.length})`}
            </Button>
            {!shut.has(g.id) &&
              g.items.map((item) => (
                <Box
                  key={`row:${item.kind}:${item.name}`}
                  flexDirection="row"
                  columnGap={1}
                >
                  <Button
                    key={`${item.kind}:${item.name}`}
                    plain
                    onPress={() => press($, item)}
                  >
                    {label(item)}
                  </Button>
                  <Text dimColor wrap="truncate-end">
                    {item.description || info[item.name] || ""}
                  </Text>
                </Box>
              ))}
          </Box>
        ))}
      </Box>
    );
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    const r = await next(e);
    await update($, pane, () => false);
    return r;
  });
};
