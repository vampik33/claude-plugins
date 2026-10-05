import type { ClientModule } from "claude-code";

import { fmtElapsed } from "./core.ts";

export type BandProps = {
  label: string;
  startedAt: number;
  detail: string;
};

/** The running review's line above the prompt; elapsed time ticks with no hook call. */
const CodexBand: ClientModule<BandProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  const { Text } = surface.elements;
  const now = surface.state ?? Date.now();
  return (
    <Text>
      <Text color="cyan">{props.label}</Text>
      {` ⏳ ${fmtElapsed(now - props.startedAt)}`}
      <Text dimColor>{` · ${props.detail}`}</Text>
    </Text>
  );
};

export default CodexBand;
