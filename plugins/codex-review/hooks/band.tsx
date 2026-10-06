import type { ClientModule } from "claude-code";

import { fmtElapsed, idleText } from "./core.ts";
import type { LastResult } from "./core.ts";

export type BandProps =
  | { kind: "running"; label: string; startedAt: number; detail: string }
  | { kind: "idle"; last: LastResult | null };

/** The codex line above the prompt; elapsed and "ago" tick with no hook call. */
const CodexBand: ClientModule<BandProps, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  const { Text } = surface.elements;
  const now = surface.state ?? Date.now();
  if (props.kind === "idle")
    return (
      <Text>
        <Text color="cyan">codex</Text>
        <Text dimColor>{` · ${idleText(props.last, now)}`}</Text>
      </Text>
    );
  return (
    <Text>
      <Text color="cyan">{props.label}</Text>
      {` ⏳ ${fmtElapsed(now - props.startedAt)}`}
      <Text dimColor>{` · ${props.detail}`}</Text>
    </Text>
  );
};

export default CodexBand;
