import type { ClientModule } from "claude-code";

import { drawFleet, type FleetView } from "./view.tsx";

/** The pane's body, redrawn every second so elapsed times tick with no hook call. */
const FleetPane: ClientModule<FleetView, number> = (props, surface) => {
  if (surface.state === undefined) {
    surface.every(1000, () => surface.setState(Date.now()));
    surface.setState(Date.now());
  }
  return drawFleet(surface.elements, props, surface.state ?? Date.now());
};

export default FleetPane;
