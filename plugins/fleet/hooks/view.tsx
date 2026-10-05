/**
 * view.tsx — the pane's body, drawn from a snapshot and a time. The hook draws
 * it once where a surface has no Client; the Client redraws it every second.
 */

import type { FleetAgent, FleetShell, FleetTree } from "../types";
import { fmtElapsed, isFailed, isLive } from "./core.ts";

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

const elapsed = (i: { startedAt: number; endedAt?: number }, now: number) =>
  fmtElapsed((i.endedAt ?? now) - i.startedAt);

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
  return isFailed(status) ? (
    <Text color="red">✗</Text>
  ) : (
    <Text color="green">✓</Text>
  );
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
            {` ${fit(a.type, name)} ${elapsed(a, now)}`}
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
      {order(v.shells).map((s) => (
        <Text key={s.id}>
          {mark(Text, s.status)}
          {` ${fit(s.command, w - 10)} ${elapsed(s, now)}`}
        </Text>
      ))}
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
