/**
 * view.tsx — the pane's body, drawn from a snapshot and a time. The hook draws
 * it once where a surface has no Client; the Client redraws it every second.
 */

import type { FleetAgent, FleetShell, FleetTree } from "../types";
import {
  etaMs,
  fmtClock,
  fmtElapsed,
  fmtLeft,
  isFailed,
  isLive,
  LOST,
  quietMs,
} from "./core.ts";

export type FleetView = {
  repo: string;
  width: number;
  agents: FleetAgent[];
  shells: FleetShell[];
  trees: FleetTree[];
};

/** The two elements the body uses, from `$.ui.resolve(e)` or `surface.elements`. */
type Elements = { Box: any; Text: any };

const fit = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s.padEnd(n);

/** "6m12s" while live; "6m12s · 16:42" once ended, with when it ended. */
const timing = (i: { startedAt: number; endedAt?: number }, now: number) =>
  i.endedAt === undefined
    ? fmtElapsed(now - i.startedAt)
    : `${fmtElapsed(i.endedAt - i.startedAt)} · ${fmtClock(i.endedAt, now)}`;

/** Live ones first, then the most recently ended. */
const order = <
  T extends { status: string; startedAt: number; endedAt?: number },
>(
  items: T[],
) =>
  [...items].sort(
    (a, b) =>
      Number(isLive(b.status)) - Number(isLive(a.status)) ||
      (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt),
  );

function mark(Text: any, status: string) {
  if (isLive(status)) return <Text color="cyan">▶</Text>;
  if (status === LOST) return <Text dimColor>?</Text>;
  return isFailed(status) ? (
    <Text color="red">✗</Text>
  ) : (
    <Text color="green">✓</Text>
  );
}

/** "▓▓▓▓░░░░░░" */
const bar = (frac: number, n = 10) => {
  const full = Math.max(0, Math.min(n, Math.round(frac * n)));
  return "▓".repeat(full) + "░".repeat(n - full);
};

/** A live shell's second line: waiting, stalled, or its progress, then its last output line. */
function shellDetail(Text: any, s: FleetShell, now: number, w: number) {
  const line = s.line ?? "";
  if (s.waiter)
    return <Text dimColor>{fit(`   waiting${line ? ` · ${line}` : ""}`, w).trimEnd()}</Text>;
  if (s.stalled) {
    const head = `   ⚠ no output ${fmtLeft(quietMs(s, now))}`;
    return (
      <Text>
        <Text color="yellow">{head}</Text>
        <Text dimColor>{fit(line ? ` · ${line}` : "", Math.max(0, w - head.length)).trimEnd()}</Text>
      </Text>
    );
  }
  if (s.progress) {
    const left = etaMs(s.progress, now);
    const head = `   ${bar(s.progress.frac)} ${Math.floor(s.progress.frac * 100)}%${left === undefined ? "" : ` ~${fmtLeft(left)}`}`;
    return (
      <Text>
        <Text color="cyan">{head}</Text>
        <Text dimColor>{fit(` · ${line}`, Math.max(0, w - head.length)).trimEnd()}</Text>
      </Text>
    );
  }
  return <Text dimColor>{fit(`   ${line}`, w).trimEnd()}</Text>;
}

export function drawFleet(els: Elements, v: FleetView, now: number) {
  const { Box, Text } = els;
  const w = Math.max(24, v.width);
  const name = Math.min(18, w - 10);
  const run = v.agents.filter((a) => isLive(a.status)).length;
  const fail = v.agents.filter((a) => isFailed(a.status)).length;
  const done = v.agents.length - run - fail;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>FLEET</Text>
        <Text dimColor>{` · ${v.repo}`}</Text>
      </Text>
      <Text> </Text>
      <Text
        dimColor
      >{`AGENTS  ${run} running · ${done} done · ${fail} failed`}</Text>
      {v.agents.length === 0 && <Text dimColor> none yet</Text>}
      {order(v.agents).map((a) => (
        <Box key={a.id} flexDirection="column">
          <Text>
            {mark(Text, a.status)}
            {` ${fit(a.type, name)} ${timing(a, now)}`}
          </Text>
          <Text dimColor>
            {"   " +
              fit(
                isLive(a.status) && a.lastTool
                  ? `${a.description} · ${a.lastTool}`
                  : a.description,
                w - 3,
              ).trimEnd()}
          </Text>
        </Box>
      ))}
      {v.shells.length > 0 && <Text> </Text>}
      {v.shells.length > 0 && <Text dimColor>BACKGROUND</Text>}
      {order(v.shells).map((s) => {
        const time = timing(s, now);
        const row = (
          <Text>
            {mark(Text, s.status)}
            {` ${fit(s.command, Math.max(8, w - 4 - time.length))} ${time}`}
          </Text>
        );
        if (!isLive(s.status) || (!s.line && !s.waiter && !s.stalled))
          return (
            <Box key={s.id} flexDirection="column">
              {row}
            </Box>
          );
        return (
          <Box key={s.id} flexDirection="column">
            {row}
            {shellDetail(Text, s, now, w)}
          </Box>
        );
      })}
      {v.trees.length > 0 && <Text> </Text>}
      {v.trees.length > 0 && <Text dimColor>WORKTREES</Text>}
      {v.trees.map((t) => (
        <Text key={t.path}>
          {`  ${fit(t.name, name)} `}
          {t.changed ? (
            <Text color="yellow">{`●${t.changed} changed`}</Text>
          ) : (
            <Text dimColor>clean</Text>
          )}
          {t.ahead ? ` ↑${t.ahead}` : ""}
          {t.behind ? ` ↓${t.behind}` : ""}
        </Text>
      ))}
    </Box>
  );
}
