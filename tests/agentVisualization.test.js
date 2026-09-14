import test from "node:test";
import assert from "node:assert/strict";

import {
  canEmbedVisualization,
  embeddedVisualizationType,
} from "../src/agent-visualization.js";

test("conversation viewer is exposed for every registered typed file reference", () => {
  assert.equal(embeddedVisualizationType("cma"), "CMA");
  assert.equal(canEmbedVisualization({ uuid: "file-1", dataType: "CMA" }), true);
  assert.equal(canEmbedVisualization({ uuid: "", dataType: "CMA" }), false);
  for (const dataType of ["ERA5", "WRF", "Radar", "GFS", "ECMWF", "Himawari", "FY3"]) {
    assert.equal(canEmbedVisualization({ uuid: "file-1", dataType }), true, dataType);
  }
  assert.equal(canEmbedVisualization({ uuid: "file-1", dataType: "UNKNOWN" }), false);
});
