import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { ShipStatus } from "../types";
import {
  bandLine,
  canShip,
  hasNews,
  installedVersions,
  marketplaceVersions,
  needRestart,
  parseStatus,
  staleMods,
  tailOf,
} from "./core.ts";

const status = atom(
  { plugin: "ship", key: "status" } as const,
  null as ShipStatus | null,
);
const loaded = atom(
  { plugin: "ship", key: "loaded" } as const,
  {} as Record<string, string>,
);
const running = atom({ plugin: "ship", key: "running" } as const, false);

/** git and claude must never wait on a prompt nobody sees. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" };
const PUSH_MS = 120_000;
const PLUGIN_MS = 180_000;

/** Where the repo, its marketplace and the installed-plugins record are. */
type Repo = { root: string; marketplace: string; installedPath: string };

const parsed = <T,>(text: unknown, parse: (t: string) => T): T | undefined => {
  if (typeof text !== "string") return undefined;
  try {
    return parse(text);
  } catch {
    return undefined;
  }
};

async function locate($: EngineInterface): Promise<Repo | undefined> {
  const top = await $.process
    .run(["git", "rev-parse", "--show-toplevel"])
    .catch(() => undefined);
  if (top?.exitCode !== 0) return undefined;
  const root = top.stdout.trim();
  const mkt = parsed(
    await $.fs.read(`${root}/.claude-plugin/marketplace.json`).catch(() => undefined),
    marketplaceVersions,
  );
  const home = await $.env.get("HOME").catch(() => undefined);
  if (!mkt?.name || !home) return undefined;
  return {
    root,
    marketplace: mkt.name,
    installedPath: `${home}/.claude/plugins/installed_plugins.json`,
  };
}

async function readInstalled(
  $: EngineInterface,
  r: Repo,
): Promise<Record<string, string>> {
  const text = await $.fs.read(r.installedPath).catch(() => undefined);
  return parsed(text, (t) => installedVersions(t, r.marketplace)) ?? {};
}

/** Reads git, the repo's versions and the installed ones into the state. */
async function refresh(
  $: EngineInterface,
  r: Repo,
): Promise<ShipStatus | undefined> {
  const [st, mkt, installed, base] = await Promise.all([
    $.process
      .run(["git", "status", "--porcelain=v1", "--branch"], { cwd: r.root })
      .catch(() => undefined),
    $.fs.read(`${r.root}/.claude-plugin/marketplace.json`).catch(() => undefined),
    readInstalled($, r),
    read($, loaded),
  ]);
  const repo = parsed(mkt, marketplaceVersions);
  if (st?.exitCode !== 0 || !repo) return undefined;
  const next: ShipStatus = {
    ...parseStatus(st.stdout),
    stale: staleMods(repo.versions, installed),
    restart: needRestart(base, installed),
  };
  await update($, status, () => next);
  return next;
}

type Ran = { exitCode: number; stdout: string; stderr: string };

const runIn = ($: EngineInterface, r: Repo, argv: string[], timeoutMs: number) =>
  $.process
    .run(argv, { cwd: r.root, env: NO_PROMPT, timeoutMs })
    .catch((err): Ran => ({ exitCode: 1, stdout: "", stderr: String(err) }));

const said = (x: Ran) => tailOf(x.stderr || x.stdout);

/** Push, refresh the marketplace, update the stale mods; answers the report. */
async function shipSteps($: EngineInterface, r: Repo): Promise<string> {
  const s = await refresh($, r);
  if (!s) return "ship: could not read git status or the marketplace.";
  if (!canShip(s)) return "Nothing to ship: no commits to push and every installed mod is current.";
  const lines: string[] = [];

  if (s.ahead > 0) {
    if (!s.hasUpstream)
      return `ship: ${s.branch} has no upstream; push it once with git push -u origin ${s.branch}.`;
    const push = await runIn($, r, ["git", "push"], PUSH_MS);
    if (push.exitCode !== 0) return `ship: git push failed:\n${said(push)}`;
    lines.push(`Pushed ${s.ahead} commit${s.ahead === 1 ? "" : "s"} on ${s.branch}.`);
  }

  if (s.stale.length > 0) {
    if (s.branch !== "main") {
      lines.push(`On ${s.branch}: the marketplace reads main, so no mod was updated.`);
    } else {
      const mk = await runIn($, r, ["claude", "plugin", "marketplace", "update", r.marketplace], PLUGIN_MS);
      if (mk.exitCode !== 0)
        return [...lines, `Marketplace update failed:\n${said(mk)}`].join("\n");
      for (const m of s.stale) {
        const up = await runIn($, r, ["claude", "plugin", "update", `${m.name}@${r.marketplace}`], PLUGIN_MS);
        if (up.exitCode !== 0) lines.push(`${m.name}: update failed: ${tailOf(said(up), 1)}`);
      }
    }
  }

  const after = await refresh($, r);
  const installed = await readInstalled($, r);
  const updated = s.stale.filter(
    (m) => installed[m.name] !== undefined && installed[m.name] !== m.installed,
  );
  if (updated.length)
    lines.push(`Updated ${updated.map((m) => `${m.name} ${m.installed} → ${installed[m.name]}`).join(", ")}.`);
  const behind = (after?.stale ?? []).filter((m) => s.branch === "main" || !s.stale.some((x) => x.name === m.name));
  if (behind.length && s.branch === "main")
    lines.push(
      `Still behind the repo: ${behind.map((m) => `${m.name} ${m.installed} (repo ${m.repo})`).join(", ")}; is the version bump committed and pushed?`,
    );
  if (after?.changed)
    lines.push(`${after.changed} uncommitted file${after.changed === 1 ? " was" : "s were"} not shipped.`);
  if (after?.restart.length)
    lines.push(`Restart Claude Code to load: ${after.restart.join(", ")}.`);
  return lines.join("\n");
}

async function ship($: EngineInterface, r: Repo | undefined): Promise<string> {
  if (!r) return "ship: this is not a plugin marketplace repo (no .claude-plugin/marketplace.json at the git root).";
  if (await read($, running)) return "ship is already running.";
  await update($, running, () => true);
  try {
    return await shipSteps($, r);
  } finally {
    await update($, running, () => false);
  }
}

export const register: Register = (on) => {
  /** Found again at each load; a module variable, so a reload starts it over. */
  let repo: Repo | undefined;

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "ship",
      description:
        "Push this repo's commits, refresh its marketplace and update the installed mods behind it",
    });
    repo = await locate($);
    if (repo) {
      // what this load of the plugins runs: a later update needs a restart
      const installed = await readInstalled($, repo);
      await update($, loaded, () => installed);
      await refresh($, repo);
    }
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId && repo) await refresh($, repo);
    return r;
  });

  on("command.run", { command: "ship" }, async ($) => ({
    text: await ship($, repo),
  }));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const s = await read($, status);
    const busy = await read($, running);
    if (e.props.hasSurvey || !s || (!hasNews(s) && !busy)) return next(e);
    const below = await next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text dimColor>{bandLine(s)}</Text>
          {busy ? (
            <Text color="cyan">shipping…</Text>
          ) : (
            canShip(s) && (
              <Button
                key="ship-run"
                dimColor
                onPress={() => void $.command.run({ command: "ship", args: "" } as never)}
              >
                ship
              </Button>
            )
          )}
        </Box>
      </Box>
    );
  });
};
