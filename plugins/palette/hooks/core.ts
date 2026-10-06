/**
 * core.ts — pure logic: the session's commands and agents grouped by where
 * they come from, and what a press writes into the prompt box.
 */

import type { PaletteGroup, PaletteItem } from "../types";

/** One slash command or skill as `$.command.list()` gives it. */
export type RawCommand = {
  name: string;
  description: string;
  source: "builtin" | "plugin" | "user" | "mcp";
  plugin?: string;
};

/** One custom agent as the context breakdown lists it. */
export type RawAgent = { agentType: string; source: string };

const AGENT_GROUP: Record<string, string> = {
  projectSettings: "project",
  localSettings: "project",
  userSettings: "user",
};

const pluginOf = (name: string) =>
  name.includes(":") ? name.slice(0, name.indexOf(":")) : name;

/** Where a user-source command or skill would live in the project's `.claude/`. */
export function projectPaths(name: string): string[] {
  const parts = name.split(":");
  const paths = [`.claude/commands/${parts.join("/")}.md`];
  if (parts.length === 1) paths.push(`.claude/skills/${name}/SKILL.md`);
  return paths;
}

const rank = (id: string) =>
  id === "project" ? 0 : id === "user" ? 1 : id.startsWith("plugin:") ? 2 : 3;

/**
 * Groups by source: project, user, each plugin, then anything else (mcp).
 * Built-in commands and the palette's own entries are left out.
 */
export function buildGroups(
  commands: RawCommand[],
  agents: RawAgent[],
  projectNames: ReadonlySet<string>,
  self: string,
): PaletteGroup[] {
  const groups = new Map<string, PaletteItem[]>();
  const add = (id: string, item: PaletteItem) => {
    if (id === `plugin:${self}`) return;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  };

  for (const a of agents) {
    const id =
      a.source === "plugin"
        ? `plugin:${pluginOf(a.agentType)}`
        : (AGENT_GROUP[a.source] ?? a.source);
    // the listing has no descriptions: agent.offer's fill them in when drawn
    add(id, { kind: "agent", name: a.agentType, description: "" });
  }
  for (const c of commands) {
    if (c.source === "builtin") continue;
    const id =
      c.source === "plugin"
        ? `plugin:${c.plugin ?? pluginOf(c.name)}`
        : c.source === "user"
          ? projectNames.has(c.name)
            ? "project"
            : "user"
          : c.source;
    add(id, { kind: "command", name: c.name, description: c.description });
  }

  return [...groups]
    .map(([id, items]) => ({
      id,
      title: id,
      items: items.sort(
        (a, b) =>
          Number(a.kind === "command") - Number(b.kind === "command") ||
          a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** What a row reads: `@<name>` for an agent, `/<name>` for a command or skill. */
export const label = (item: PaletteItem) =>
  `${item.kind === "agent" ? "@" : "/"}${item.name}`;

/**
 * What a press puts in the prompt box. A command or skill goes first (a slash
 * command only runs from the start), replacing a leading one; an agent
 * mention goes in at the cursor, spaced from the word before it.
 */
export function fillFor(
  item: PaletteItem,
  draft: string,
  cursor: number,
): { text: string; mode: "replace" | "insert" } {
  if (item.kind === "command")
    return {
      text: `/${item.name} ${draft.replace(/^\/\S+\s*/, "")}`,
      mode: "replace",
    };
  const before = draft.slice(0, cursor);
  const gap = before === "" || /\s$/.test(before) ? "" : " ";
  return { text: `${gap}@agent-${item.name} `, mode: "insert" };
}
