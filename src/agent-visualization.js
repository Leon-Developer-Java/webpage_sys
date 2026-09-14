import { registeredDisplayType } from "./agent-display-providers.js";

export function embeddedVisualizationType(dataType) {
  return registeredDisplayType(dataType);
}

export function canEmbedVisualization(reference) {
  return Boolean(reference?.uuid && embeddedVisualizationType(reference?.dataType));
}
