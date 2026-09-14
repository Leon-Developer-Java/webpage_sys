import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, compileScript, compileStyle } from "@vue/compiler-sfc";

const filename = new URL("../src/components/AgentDataVisualization.vue", import.meta.url);
const source = readFileSync(filename, "utf8");
const parsed = parse(source, { filename: filename.pathname });

test("embedded data viewer compiles and uses the existing model-result card pattern", () => {
  assert.deepEqual(parsed.errors, []);
  assert.doesNotThrow(() => compileScript(parsed.descriptor, { id: "agent-data-viewer-test" }));
  const style = compileStyle({ source: parsed.descriptor.styles[0].content, id: "agent-data-viewer-test", scoped: true });
  assert.deepEqual(style.errors, []);
  assert.match(source, /WebglLayer/);
  assert.doesNotMatch(source, /CmaLayer/);
  assert.match(source, /ForecastTimeline/);
  assert.match(source, /summary-grid/);
  assert.match(source, /play-controls/);
  assert.match(source, /loadDisplayDocument/);
  assert.doesNotMatch(source, /api\/display\/CMA/);
  assert.doesNotMatch(source, /CMA 数据可视化/);
  assert.match(source, /variables\.length > 1/);
  assert.match(source, /times\.length > 1/);
  assert.match(source, /grid\.value\?\.image_url \|\| grid\.value\?\.webp_url/);
  assert.match(style.code, /width:\s*min\(760px, 72vw\)/);
  assert.match(style.code, /height:\s*330px/);
  assert.match(style.code, /overflow:\s*hidden/);
});

test("collapse control is in the fixed header before the map container", () => {
  const collapseIndex = source.indexOf(">收起<");
  const mapIndex = source.indexOf('class="map-wrap"');
  assert.ok(collapseIndex >= 0);
  assert.ok(mapIndex > collapseIndex);
});
