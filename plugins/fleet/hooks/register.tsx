import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { FleetAgent, FleetShell, FleetState } from "../types";
import {
  applyStatuses,
  emptyFleet,
  endShell,
  endToast,
  isFailed,
  isLive,
  liveCount,
  parseNotification,
  parseStatus,
  parseWorktrees,
  statusLine,
  summary,
  toolLabel,
  trim,
} from "./core.ts";
import { drawFleet, type FleetView } from "./view.tsx";

const PANE = "fleet";
const ENDED = new Set(["completed", "failed", "killed"]);
const TOAST_GAP_MS = 2_100;

const fleet = atom({ plugin: "fleet", key: "fleet" } as const, emptyFleet());
const pane = atom({ plugin: "fleet", key: "pane" } as const, false);

/** What the module keeps outside `$.state`; a reload starts it over. */
type Tracker = {
  autoOpen: boolean;
  sound: boolean;
  telegram: boolean;
  idleMs: number;
  repo: string;
  root: string | undefined;
  lastPrompt: number;
  poll: { cancel: () => void } | undefined;
};

function chime($: EngineInterface, sound: "complete" | "dialog-error") {
  // $.audio has no player on a Linux terminal; paplay does
  void $.process
    .run(["paplay", `/usr/share/sounds/freedesktop/stereo/${sound}.oga`])
    .catch(() => undefined);
}

async function sendTelegram($: EngineInterface, text: string): Promise<void> {
  const none = () => undefined;
  const token = await $.env.get("TELEGRAM_BOT_TOKEN").catch(none);
  const chat = await $.env.get("TELEGRAM_CHAT_ID").catch(none);
  if (!token || !chat) return;
  const res = await $.http
    .fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    })
    .catch(none);
  if (!res?.ok)
    $.ui.log(`fleet: Telegram send failed (${res?.status ?? "no response"})`, {
      to: "debug",
    });
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => []);
  return panes.some((p) => p.id === PANE && p.isShown && p.isPlaced);
}

async function refreshTrees($: EngineInterface, t: Tracker): Promise<void> {
  if (!t.root) return;
  const list = await $.process
    .run(["git", "worktree", "list", "--porcelain"], { cwd: t.root })
    .catch(() => undefined);
  if (!list || list.exitCode !== 0) return;
  const trees = await Promise.all(
    parseWorktrees(list.stdout).map(async (w) => {
      const st = await $.process
        .run(["git", "status", "--porcelain=v1", "--branch"], { cwd: w.path })
        .catch(() => undefined);
      const counts =
        st && st.exitCode === 0
          ? parseStatus(st.stdout)
          : { changed: 0, ahead: 0, behind: 0 };
      return { ...w, ...counts };
    }),
  );
  await update($, fleet, (f) => ({ ...f, trees }));
}

/** Toasts each item that just ended; a chime for a failure. */
function announce(
  $: EngineInterface,
  t: Tracker,
  agents: FleetAgent[],
  shells: FleetShell[],
) {
  for (const a of agents) {
    if (!ENDED.has(a.status)) continue; // a teammate gone idle is no finish
    $.ui.toast(
      endToast(a.type, a.description, a.status, a.endedAt! - a.startedAt),
    );
    if (isFailed(a.status) && t.sound) chime($, "dialog-error");
  }
  for (const s of shells) {
    $.ui.toast(
      endToast("shell", s.command, s.status, s.endedAt! - s.startedAt),
    );
    if (isFailed(s.status) && t.sound) chime($, "dialog-error");
  }
}

/** When nothing is live any more: the all-done alert, and the batch closes. */
async function settle($: EngineInterface, t: Tracker): Promise<void> {
  const f = await read($, fleet);
  if (liveCount(f) > 0) return;
  t.poll?.cancel();
  t.poll = undefined;
  if (f.batchStart === undefined) return;

  const batch = f.batchStart;
  const size =
    f.agents.filter((a) => a.startedAt >= batch).length +
    f.shells.filter((s) => s.startedAt >= batch).length;
  const now = Date.now();
  const text = summary(f, t.repo, now);
  await update($, fleet, ({ batchStart: _, ...g }) => ({
    ...g,
    autoOpened: false,
  }));
  // one item's own toast says it all; the all-done alert is for a batch
  if (size >= 2) {
    // the engine drops a toast within 2 s of the last, and the last item's just showed
    const done = text.split("\n").slice(1, 3).join(" · ");
    $.clock.after(TOAST_GAP_MS, () => $.ui.toast(done));
    if (t.sound) chime($, "complete");
  }
  if (t.telegram && now - t.lastPrompt >= t.idleMs) await sendTelegram($, text);
}

/** One look at `$.agent.list()`: status changes, their alerts, maybe all done. */
async function tick($: EngineInterface, t: Tracker): Promise<void> {
  const list = await $.agent.list().catch(() => undefined);
  if (!list) return;
  const statuses = Object.fromEntries(list.map((a) => [a.id, a.status]));
  let ended: FleetAgent[] = [];
  await update($, fleet, (f) => {
    const r = applyStatuses(f.agents, statuses, Date.now());
    ended = r.ended;
    return { ...f, agents: r.agents };
  });
  announce($, t, ended, []);
  await settle($, t);
}

function ensurePoll($: EngineInterface, t: Tracker) {
  if (!t.poll) t.poll = $.clock.every(2000, () => void tick($, t));
}

/** A task notification or a turn's end: one agent or shell reached `status`. */
async function endTask(
  $: EngineInterface,
  t: Tracker,
  id: string,
  status: string,
): Promise<void> {
  let agents: FleetAgent[] = [];
  let shell: FleetShell | undefined;
  await update($, fleet, (f) => {
    const now = Date.now();
    const a = applyStatuses(f.agents, { [id]: status }, now);
    const s = endShell(f.shells, id, status, now);
    agents = a.ended;
    shell = s.ended;
    return { ...f, agents: a.agents, shells: s.shells };
  });
  announce($, t, agents, shell ? [shell] : []);
  await settle($, t);
}

async function openPane($: EngineInterface, t: Tracker) {
  const opened = await $.ui.open({ id: PANE, title: `Fleet · ${t.repo}` });
  // an unasked open on a narrow terminal waits undrawn: still "show"
  await update($, pane, () => opened.isPlaced);
  void refreshTrees($, t);
  return opened;
}

/** Closes the pane if drawn (undefined), opens it if not (how it opened). */
async function togglePane($: EngineInterface, t: Tracker) {
  if (await isPaneShown($)) {
    await $.ui.close({ id: PANE });
    return undefined;
  }
  return openPane($, t);
}

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n")
      : "";

export const register: Register = (on, options) => {
  const t: Tracker = {
    autoOpen: options.autoOpen !== false,
    sound: options.sound !== false,
    telegram: options.telegram !== false,
    idleMs:
      (typeof options.idleMinutes === "number" && options.idleMinutes >= 0
        ? options.idleMinutes
        : 5) * 60_000,
    repo: "",
    root: undefined,
    lastPrompt: Date.now(),
    poll: undefined,
  };

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({
      name: "fleet",
      description:
        "Show or hide the pane with this session's agents, background shells and worktrees",
    });
    const top = await $.process
      .run(["git", "rev-parse", "--show-toplevel"])
      .catch(() => undefined);
    t.root = top?.exitCode === 0 ? top.stdout.trim() : undefined;
    const cwd = await $.session.cwd().catch(() => "");
    t.repo = (t.root ?? cwd).split("/").pop() || "session";
    // a reload keeps an open pane
    const shown = await isPaneShown($);
    await update($, pane, () => shown);
    $.clock.every(15_000, async () => {
      const shown = await isPaneShown($);
      // a waiting pane gets drawn once the terminal widens
      if (shown !== (await read($, pane))) await update($, pane, () => shown);
      if (shown) await refreshTrees($, t);
    });
    // a reload while agents run: pick the poll up again
    if ((await read($, fleet)).agents.some((a) => isLive(a.status)))
      ensurePoll($, t);
    return r;
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      t.poll?.cancel();
      t.poll = undefined;
      await update($, fleet, (f) => ({ ...emptyFleet(), trees: f.trees }));
    }
    return next(e);
  });

  on("command.run", { command: "fleet" }, async ($) => {
    const opened = await togglePane($, t);
    return {
      text: !opened
        ? "Fleet pane closed."
        : opened.isPlaced
          ? "Fleet pane opened."
          : "Fleet pane is waiting for a wider terminal.",
    };
  });

  on("prompt.submit", async ($, e, next) => {
    if (e.origin.kind === "composer") t.lastPrompt = Date.now();
    return next(e);
  });

  on("agent.spawn", async ($, e, next) => {
    const r = await next(e);
    if (r.deny !== undefined || !r.agentId) return r;
    const agent: FleetAgent = {
      id: r.agentId,
      type: e.subagentType,
      description: e.description,
      model: r.model,
      startedAt: Date.now(),
      status: "running",
      tools: 0,
      ...(e.isTeammate ? { teammate: true } : {}),
    };
    let open = false;
    await update($, fleet, (f) => {
      const agents = trim([...f.agents, agent]);
      const live = agents.filter((a) => isLive(a.status)).length;
      open = t.autoOpen && !f.autoOpened && live >= 2;
      return {
        ...f,
        agents,
        batchStart: f.batchStart ?? agent.startedAt,
        autoOpened: f.autoOpened || open,
      };
    });
    ensurePoll($, t);
    if (open && !(await isPaneShown($))) void openPane($, t);
    return r;
  });

  on("tool.call", async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId;
      const label = toolLabel(String(e.tool), e);
      await update($, fleet, (f) =>
        f.agents.some((a) => a.id === id)
          ? {
              ...f,
              agents: f.agents.map((a) =>
                a.id === id ? { ...a, lastTool: label, tools: a.tools + 1 } : a,
              ),
            }
          : f,
      );
    }
    const r = await next(e);
    if (e.tool !== "Bash" || r.deny !== undefined) return r;
    const taskId = (r.result as { backgroundTaskId?: string } | undefined)
      ?.backgroundTaskId;
    if (!taskId) return r;
    const shell: FleetShell = {
      id: taskId,
      command: e.command,
      startedAt: Date.now(),
      status: "running",
    };
    await update($, fleet, (f) => ({
      ...f,
      shells: trim([...f.shells.filter((s) => s.id !== taskId), shell]),
      batchStart: f.batchStart ?? shell.startedAt,
    }));
    return r;
  });

  // a background task's notification: a shell or an agent finished
  on("session.append", async ($, e, next) => {
    const r = await next(e);
    if (e.message.type !== "user") return r;
    const note = parseNotification(textOf(e.message.content));
    if (note) await endTask($, t, note.id, note.status);
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) return r;
    const f = await read($, fleet);
    const a = f.agents.find((x) => x.id === e.agentId);
    if (a && !a.teammate && isLive(a.status))
      await endTask(
        $,
        t,
        a.id,
        e.isAborted ? "killed" : e.reason === "error" ? "failed" : "completed",
      );
    return r;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const f = await read($, fleet);
    const view: FleetView = {
      repo: t.repo,
      width: e.props.bodyColumns,
      agents: f.agents,
      shells: f.shells,
      trees: f.trees,
    };
    if (e.surface === "terminal" || e.surface === "desktop") {
      const { Client } = $.ui.resolve(e);
      return <Client key="fleet-body" module="./pane.tsx" props={view} />;
    }
    return drawFleet($.ui.resolve(e), view, Date.now());
  });

  // its own line under the other bands: the counts and a show/hide toggle
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const f = await read($, fleet);
    const open = await read($, pane);
    const empty = f.agents.length === 0 && f.shells.length === 0;
    if (e.props.hasSurvey || (empty && !open)) return next(e);
    const below = await next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Text dimColor>{statusLine(f) ?? "fleet"}</Text>
          <Button
            key="fleet-toggle"
            hotkey="f"
            dimColor
            onPress={() => togglePane($, t)}
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
