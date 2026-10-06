import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { PaletteGroup, PaletteItem, Usage } from "../types";
import {
  buildGroups,
  filterGroups,
  fillFor,
  label,
  MOST_USED,
  mostUsed,
  projectPaths,
  recordUse,
} from "./core.ts";

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
const usage = atom({ plugin: "palette", key: "usage" } as const, {} as Usage);
const USAGE = "usage";
const query = atom({ plugin: "palette", key: "query" } as const, "");

const stored = async ($: EngineInterface) =>
  ((await $.store.get(USAGE)) as Usage | undefined) ?? {};

/** Counts one use in the store (shared by every session) and in `usage`. */
async function addUse($: EngineInterface, key: string): Promise<void> {
  const was = await stored($);
  const now = recordUse(was, key, await $.clock.now());
  if (now !== was) await $.store.set(USAGE, now);
  await update($, usage, () => now);
}

// one at a time, so parallel spawns don't overwrite each other's count
let counting = Promise.resolve();
function countUse($: EngineInterface, key: string): Promise<void> {
  counting = counting.then(() => addUse($, key)).catch(() => {});
  return counting;
}

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
    const kept = await stored($).catch(() => ({}));
    await update($, usage, () => kept);
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

  on("command.run", async ($, e, next) => {
    await countUse($, `command:${e.command}`);
    return next(e);
  });

  on("skill.prompt", async ($, e, next) => {
    await countUse($, `command:${e.skill}`);
    return next(e);
  });

  on("agent.spawn", async ($, e, next) => {
    await countUse($, `agent:${e.subagentType}`);
    return next(e);
  });

  // the context's agent listing has no descriptions; the model's offer does
  on("agent.offer", async ($, e, next) => {
    const r = await next(e);
    if ((await read($, agentInfo))[e.agent] !== e.description)
      await update($, agentInfo, (m) => ({ ...m, [e.agent]: e.description }));
    return r;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e);
    const { Box, Button, Text } = els;
    const Input = "Input" in els ? els.Input : undefined;
    const listed = await read($, groups);
    const top = mostUsed(listed, await read($, usage));
    const info = await read($, agentInfo);
    const q = await read($, query);
    const all = filterGroups(top ? [top, ...listed] : listed, q, info);
    // while searching every group with a match shows open
    const shut = new Set(q.trim() ? [] : await read($, folded));
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
        {Input && (
          <Box marginTop={1}>
            <Input
              key="palette-search"
              label="Search: "
              placeholder="type to filter"
              value={q}
              autoFocus
              submitLabel="put first"
              onInput={(v) => update($, query, () => v)}
              onSubmit={() => {
                const first = all[0]?.items[0];
                if (first) void press($, first);
              }}
            />
          </Box>
        )}
        {all.length === 0 && (
          <Text dimColor>
            {q.trim()
              ? `Nothing matches "${q.trim()}".`
              : "No agents, skills or commands."}
          </Text>
        )}
        {all.map((g) => (
          <Box key={`section:${g.id}`} flexDirection="column" marginTop={1}>
            <Button key={`group:${g.id}`} plain onPress={() => toggle(g.id)}>
              {`${shut.has(g.id) ? "▸" : "▾"} ${g.title} (${g.items.length})`}
            </Button>
            {!shut.has(g.id) &&
              g.items.map((item) => {
                const id = `${g.id === MOST_USED ? "top:" : ""}${item.kind}:${item.name}`;
                const about = item.description || info[item.name] || "";
                return (
                  <Box
                    key={`row:${id}`}
                    flexDirection="column"
                    marginTop={1}
                    marginLeft={2}
                  >
                    <Button key={id} plain onPress={() => press($, item)}>
                      {label(item)}
                    </Button>
                    {about !== "" && (
                      <Box marginLeft={2}>
                        <Text dimColor wrap="truncate-end">
                          {about}
                        </Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
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
