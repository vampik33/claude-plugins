import type { ClientModule } from "claude-code";

import { bar, fmtCountdown, fmtLength, fmtTokens, gaugeColor, WARN_POINTS } from "./core.ts";

export type GaugeProps = {
  percent: number | null;
  tokens: number | null;
  window: number;
  startedAt: number;
  threshold: number;
  phase: "idle" | "pending" | "compacting" | "blocked";
  paused: boolean;
  resumeAt: number | null;
};

/** Context fill and session length; the length and a limit countdown tick with no hook call. */
const Gauge: ClientModule<GaugeProps, number> = (p, surface) => {
  if (surface.state === undefined) {
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  const { Box, Text } = surface.elements;
  const now = surface.state ?? Date.now();
  const pct = p.percent;

  let note: { text: string; color?: string; dim?: boolean } | undefined;
  if (p.phase === "blocked" && p.resumeAt)
    note = { text: `⏸ usage limit · continues in ${fmtCountdown(p.resumeAt - now)} · /continuity off cancels`, color: "yellow" };
  else if (p.phase === "pending") note = { text: "⟳ handover + compact in a few seconds · send a prompt to cancel", color: "cyan" };
  else if (p.phase === "compacting") note = { text: "⟳ handover written · compacting", color: "cyan" };
  else if (p.paused) note = { text: "continuity paused · /continuity on", dim: true };
  else if (pct !== null && pct >= p.threshold) note = { text: `over ${p.threshold}%: handover + compact after this turn`, color: "yellow" };
  else if (pct !== null && pct >= p.threshold - WARN_POINTS)
    note = { text: `handover at ${p.threshold}% · ${p.threshold - pct} points to go`, dim: true };

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>ctx </Text>
        {pct === null ? (
          <Text dimColor>{`${bar(0, 16)} --`}</Text>
        ) : (
          <Text>
            <Text color={gaugeColor(pct, p.threshold)}>{bar(pct, 16)}</Text>
            <Text bold>{` ${pct}%`}</Text>
            <Text dimColor>{` ${fmtTokens(p.tokens ?? 0)}/${fmtTokens(p.window)}`}</Text>
          </Text>
        )}
        <Text dimColor>{"   session "}</Text>
        <Text>{fmtLength(now - p.startedAt)}</Text>
      </Text>
      {note && (
        <Text color={note.color} dimColor={note.dim}>
          {note.text}
        </Text>
      )}
    </Box>
  );
};

export default Gauge;
