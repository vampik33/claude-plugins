import type { ClientModule } from "claude-code";

import { colorFor, fmtClock } from "./ttl.ts";

export type ClockProps = {
  expiresAt: number;
  lifeMs: number;
  yellowAt: number;
  redAt: number;
};

/**
 * The countdown itself, drawn on the surface's own frame clock: one tick a
 * second with no hook dispatch, so it moves in real time whatever the session
 * is doing. The hooks module only hands it a new `expiresAt`.
 */
const CacheClock: ClientModule<ClockProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    // start the tick once: the setState here makes every later call see a state
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  const { Text } = surface.elements;
  const left = props.expiresAt - (surface.state ?? Date.now());
  if (left <= 0) return <Text color="red">● cache cold</Text>;
  return (
    <Text
      bold
      color={colorFor(left, props.lifeMs, props.yellowAt, props.redAt)}
    >
      {`⏱ ${fmtClock(left)}`}
    </Text>
  );
};

export default CacheClock;
