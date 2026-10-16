import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wrfLayer = fs.readFileSync(new URL("../src/components/WrfResultLayer.vue", import.meta.url), "utf8");
const webglLayer = fs.readFileSync(new URL("../src/components/WebglLayer.vue", import.meta.url), "utf8");
const projMap = fs.readFileSync(new URL("../packages/wrf-ui/src/ProjectionMap.vue", import.meta.url), "utf8");

test("WRF Web Mercator metadata reaches the map texture sampler", () => {
  assert.match(wrfLayer, /:crs="currentDomain\.geolocation\.target_crs"/);
  assert.match(webglLayer, /mercator: props\.crs === "EPSG:3857"/);
  assert.match(projMap, /uniform int uHasBase, uHasData, uBaseMerc, uDataMerc/);
  assert.match(projMap, /v = \(myNorth - my\) \/ \(myNorth - mySouth\)/);
  assert.match(projMap, /uDataMerc, dataRef\.value\?\.mercator \? 1 : 0/);
});

test("non-Mercator layers keep linear latitude sampling", () => {
  assert.match(projMap, /v = \(uDataBox\.w - lat\) \/ \(uDataBox\.w - uDataBox\.y\)/);
});
