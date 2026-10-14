import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, SettingsSource } from "claude-code";

import type { MemoryChange } from "../types";
import {
  addChange,
  headline,
  memoryFile,
  normalizeDir,
  title,
  toChange,
  type Hunk,
  type MemoryRoots,
} from "./core.ts";

const PANE = "memory-watch";

const changes = atom(
  { plugin: "memory-watch", key: "changes" } as const,
  [] as MemoryChange[],
);
const pane = atom({ plugin: "memory-watch", key: "pane" } as const, false);
const unread = atom({ plugin: "memory-watch", key: "unread" } as const, 0);

/** Lists one change; counts it unread while the pane is closed. */
async function record($: EngineInterface, change: MemoryChange) {
  await update($, changes, (list) => addChange(list, change));
  if (!(await read($, pane))) await update($, unread, (n) => n + 1);
}

/** The settings sources `autoMemoryDirectory` is taken from, highest first:
 * the engine ignores it in the checked-in project settings. */
const MEMORY_DIR_SOURCES: readonly SettingsSource[] = [
  "policy",
  "flag",
  "local",
  "user",
];

/** Where memory lives besides `~/.claude`, read at each write (both can change). */
async function memoryRoots($: EngineInterface): Promise<MemoryRoots> {
  const home = await $.env.get("HOME");
  const configDir = normalizeDir(await $.env.get("CLAUDE_CONFIG_DIR"), home);
  let memoryDir = "";
  for (const source of MEMORY_DIR_SOURCES) {
    const s = await $.settings.read({ source }).catch(() => ({}));
    const dir = (s as { autoMemoryDirectory?: unknown }).autoMemoryDirectory;
    if (typeof dir === "string" && dir.trim() !== "") {
      memoryDir = normalizeDir(dir, home);
      break;
    }
  }
  return { configDir, memoryDir };
}

/**
 * Records a write when the path is an auto-memory file. `text` is the file's
 * new text; without it (an Edit's result holds the text before) it is read.
 */
async function note(
  $: EngineInterface,
  path: string,
  action: MemoryChange["action"],
  patch: readonly Hunk[],
  text?: string,
) {
  const file = memoryFile(path, await memoryRoots($));
  if (!file) return;
  const after = text ?? (await $.fs.read(path).catch(() => ""));
  await record($, toChange(file, action, after, patch, await $.clock.now()));
}

async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: "Memory" });
  await update($, pane, () => opened.isPlaced);
  await update($, unread, () => 0);
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

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "memory-watch",
      description:
        "Show or hide the pane summarizing this session's memory writes",
    });
    // a reload keeps an open pane
    const panes = await $.ui.panes().catch(() => []);
    await update($, pane, () => panes.some((p) => p.id === PANE && p.isPlaced));
    return r;
  });

  // a /clear starts a new conversation: its memory writes start over
  on("session.end", async ($, e, next) => {
    const r = await next(e);
    if (e.reason === "clear") {
      await update($, changes, () => []);
      await update($, unread, () => 0);
    }
    return r;
  });

  on("command.run", { command: "memory-watch" }, async ($) => {
    const opened = await togglePane($);
    return {
      text: !opened
        ? "Memory pane closed."
        : opened.isPlaced
          ? "Memory pane opened."
          : "Memory pane is waiting for a wider terminal.",
    };
  });

  // recording never fails the tool: what it ran is returned whatever note() does
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const ran = await next(e);
    if (ran.deny === undefined && !ran.isError && !ran.result.staged) {
      const { type, content, structuredPatch } = ran.result;
      const action = type === "create" ? "created" : "updated";
      await note($, e.file_path, action, structuredPatch, content).catch(
        () => {},
      );
    }
    return ran;
  });

  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const ran = await next(e);
    if (ran.deny === undefined && !ran.isError && !ran.result.staged)
      await note($, e.file_path, "updated", ran.result.structuredPatch).catch(
        () => {},
      );
    return ran;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const list = await read($, changes);
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {list.length === 0 && (
          <Text dimColor>No memory written this session.</Text>
        )}
        {list.map((c, i) => (
          <Box
            key={`change:${list.length - i}`}
            flexDirection="column"
            marginTop={i === 0 ? 0 : 1}
          >
            <Text bold wrap="truncate-end">
              {title(c)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {headline(c)}
            </Text>
            {c.description && <Text>{c.description}</Text>}
          </Box>
        ))}
      </Box>
    );
  });

  // its own line under the other bands: a show/hide toggle, once there is
  // something to show (or the pane is open, so it can be hidden)
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    const open = await read($, pane);
    if (!open && (await read($, changes)).length === 0) return next(e);
    const fresh = open ? 0 : await read($, unread);
    const below = await next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text dimColor>memory</Text>
          {fresh > 0 && <Text color="yellow">{`● ${fresh} new`}</Text>}
          <Button
            key="memory-watch-toggle"
            hotkey="m"
            dimColor
            onPress={() => togglePane($)}
          >
            {open ? "hide" : "show"}
          </Button>
        </Box>
      </Box>
    );
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    const r = await next(e);
    await update($, pane, () => false);
    return r;
  });
};
