/**
 * core.ts — the pure half of ship: reading git status, the repo's
 * marketplace and the installed plugins, and the words of the band.
 */

import type { ShipStale, ShipStatus } from "../types";

/** `git status --porcelain=v1 --branch` → the branch, its upstream, changed files and commits ahead. */
export function parseStatus(
  porcelain: string,
): Pick<ShipStatus, "branch" | "hasUpstream" | "ahead" | "changed"> {
  const lines = porcelain.split("\n").filter(Boolean);
  const head = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const m = /^(?:No commits yet on )?(\S+?)(?:\.\.\.(\S+))?(?: \[|$)/.exec(head);
  return {
    branch: m?.[1] ?? "",
    hasUpstream: Boolean(m?.[2]),
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    changed: lines.length,
  };
}

/** A marketplace.json → its name and each plugin's version. */
export function marketplaceVersions(json: string): {
  name: string;
  versions: Record<string, string>;
} {
  const m = JSON.parse(json) as {
    name?: string;
    plugins?: { name?: string; version?: string }[];
  };
  const versions: Record<string, string> = {};
  for (const p of m.plugins ?? [])
    if (p.name && p.version) versions[p.name] = p.version;
  return { name: m.name ?? "", versions };
}

/** installed_plugins.json → the version installed of each plugin from `marketplace`. */
export function installedVersions(
  json: string,
  marketplace: string,
): Record<string, string> {
  const m = JSON.parse(json) as {
    plugins?: Record<string, { version?: string }[]>;
  };
  const out: Record<string, string> = {};
  const suffix = `@${marketplace}`;
  for (const [key, entries] of Object.entries(m.plugins ?? {})) {
    const version = entries[0]?.version;
    if (key.endsWith(suffix) && version)
      out[key.slice(0, -suffix.length)] = version;
  }
  return out;
}

/** Installed mods whose version is not the repo's, by name. */
export function staleMods(
  repo: Record<string, string>,
  installed: Record<string, string>,
): ShipStale[] {
  return Object.keys(installed)
    .filter((name) => repo[name] !== undefined && repo[name] !== installed[name])
    .sort()
    .map((name) => ({ name, installed: installed[name]!, repo: repo[name]! }));
}

/** Plugins installed now at another version than the session loaded. */
export function needRestart(
  loaded: Record<string, string>,
  installed: Record<string, string>,
): string[] {
  return Object.keys(installed)
    .filter((name) => loaded[name] !== undefined && loaded[name] !== installed[name])
    .sort();
}

/** Whether the band has something to say. */
export const hasNews = (s: ShipStatus) =>
  s.ahead > 0 || s.stale.length > 0 || s.restart.length > 0;

/** Whether /ship has something to do. */
export const canShip = (s: ShipStatus) => s.ahead > 0 || s.stale.length > 0;

/** "ship · main ↑2 · ●3 uncommitted · fleet 0.4.2 → 0.5.0 · restart needed" */
export function bandLine(s: ShipStatus): string {
  const parts = [`ship · ${s.branch}${s.ahead ? ` ↑${s.ahead}` : ""}`];
  if (s.changed) parts.push(`●${s.changed} uncommitted`);
  for (const m of s.stale) parts.push(`${m.name} ${m.installed} → ${m.repo}`);
  if (s.restart.length) parts.push("restart needed");
  return parts.join(" · ");
}

/** The last few lines of a command's output, for a failure's report. */
export const tailOf = (text: string, n = 3) =>
  text.trim().split("\n").slice(-n).join("\n");
