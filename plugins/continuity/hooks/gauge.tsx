import type { ClientModule } from "claude-code";

import {
  bar,
  fmtLength,
  fmtTokens,
  gaugeCells,
  gaugeColor,
  gaugeNote,
  NARROW,
} from "./core.ts";
import { colorFor, fmtClock, hitColor } from "./ttl.ts";

export type CacheClock = {
  expiresAt: number;
  lifeMs: number;
  yellowAt: number;
  redAt: number;
};

/** The session's cache hit rate and where its colour steps. */
export type CacheHitRate = {
  percent: number;
  greenAt: number;
  yellowAt: number;
};

export type GaugeProps = {
  percent: number | null;
  tokens: number | null;
  window: number;
  startedAt: number;
  threshold: number;
  phase: "idle" | "pending" | "compacting" | "blocked";
  paused: boolean;
  resumeAt: number | null;
  /** The band's width: under NARROW the line drops the token count and shortens the bar */
  columns: number;
  /** The prompt cache's countdown, once a request touched the cache */
  cache: CacheClock | null;
  /** The share of the session's prompt tokens the cache served, once a request reported usage */
  hits: CacheHitRate | null;
  /**
   * What this instance draws: `full`, the terminal's text bar, figures and note;
   * on the desktop the hook draws the bar as an Svg, `stats` the figures beside
   * it and `note` the usage-limit countdown under them.
   */
  part: "full" | "stats" | "note";
};

/** Context fill, session length and the cache countdown; the clocks tick with no hook call. */
const Gauge: ClientModule<GaugeProps, number> = (p, surface) => {
  if (surface.state === undefined) {
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  const { Box, Text } = surface.elements;
  const now = surface.state ?? Date.now();
  const pct = p.percent;
  const narrow = p.columns < NARROW;
  const cells = gaugeCells(p.columns);

  const note = gaugeNote(p, now);
  const noteLine = note && (
    <Text color={note.color} dimColor={note.dim} wrap="truncate-end">
      {note.text}
    </Text>
  );
  if (p.part === "note") return noteLine ?? <Text>{""}</Text>;

  const cacheLeft = p.cache && p.cache.expiresAt - now;
  const clock =
    p.cache &&
    cacheLeft !== null &&
    (cacheLeft <= 0 ? (
      <Text color="red">● cache cold</Text>
    ) : (
      <Text>
        <Text dimColor>cache </Text>
        <Text
          bold
          color={colorFor(
            cacheLeft,
            p.cache.lifeMs,
            p.cache.yellowAt,
            p.cache.redAt,
          )}
        >
          {fmtClock(cacheLeft)}
        </Text>
      </Text>
    ));
  const hit = p.hits && (
    <Text>
      <Text dimColor>hit </Text>
      <Text
        bold
        color={hitColor(p.hits.percent, p.hits.greenAt, p.hits.yellowAt)}
      >
        {`${p.hits.percent}%`}
      </Text>
    </Text>
  );
  /** The fill and, on a wide band, the tokens; `lead` goes before the fill. */
  const figures = (lead: string, fill: number) => [
    <Text bold>{`${lead}${fill}%`}</Text>,
    ...(narrow
      ? []
      : [
          <Text
            dimColor
          >{` ${fmtTokens(p.tokens ?? 0)}/${fmtTokens(p.window)}`}</Text>,
        ]),
  ];

  if (p.part === "stats")
    return (
      <Box flexDirection="row" columnGap={2}>
        {pct === null ? (
          <Text dimColor>--</Text>
        ) : (
          <Text>{figures("", pct)}</Text>
        )}
        <Text>
          <Text dimColor>session </Text>
          <Text>{fmtLength(now - p.startedAt)}</Text>
        </Text>
        {hit}
        {clock}
      </Box>
    );

  return (
    <Box flexDirection="column">
      <Text>
        <Text dimColor>ctx </Text>
        {pct === null ? (
          <Text dimColor>{`${bar(0, cells)} --`}</Text>
        ) : (
          <Text>
            <Text color={gaugeColor(pct, p.threshold)}>{bar(pct, cells)}</Text>
            {figures(" ", pct)}
          </Text>
        )}
        <Text dimColor>{narrow ? "  " : "   session "}</Text>
        <Text>{fmtLength(now - p.startedAt)}</Text>
        {[hit, clock].map(
          (item) =>
            item && (
              <Text>
                {narrow ? "  " : "   "}
                {item}
              </Text>
            ),
        )}
      </Text>
      {noteLine}
    </Box>
  );
};

export default Gauge;
