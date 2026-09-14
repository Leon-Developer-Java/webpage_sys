import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agent = readFileSync(new URL("../src/views/Agent.vue", import.meta.url), "utf8");
const card = readFileSync(new URL("../src/components/AgentIcingModelCard.vue", import.meta.url), "utf8");

test("workflow icing result preserves its requested date range for the map card", () => {
  assert.match(agent, /const selected = run\.result\.selected_range;/);
  assert.match(agent, /requested_range = selected\?\.start && selected\?\.end/);
  assert.match(agent, /map_visible: \["season", "range"\]\.includes\(run\.result\.view\) \|\| Boolean\(requested_range\)/);
  assert.match(agent, /map_visible: \["season", "range"\]\.includes\(run\.result\.view\)/);
});

test("icing card loads requested range instead of the archive default view", () => {
  assert.match(card, /function requestedRange\(\)/);
  assert.match(card, /getWinterIcingView\(props\.state\.run_id, selected\.start, selected\.end\)/);
  assert.match(card, /props\.state\.requested_range = \{ start: rangeStart\.value, end: rangeEnd\.value \}/);
  assert.match(card, /if \(!props\.state\.winterArchive\) return getModelRunResult\(props\.state\.run_id\)/);
  assert.match(card, /syncRangeControls\(props\.state\.result\)/);
});

test("only direct icing views load a map by default; analysis results keep it on demand", () => {
  assert.match(card, /const mapVisible = computed\(\(\) => props\.state\.map_visible !== false\)/);
  assert.match(card, /v-if="!mapVisible && task\?\.status === 'succeeded'"/);
  assert.match(card, /task\.value\.status === "succeeded" && mapVisible\.value/);
  assert.match(card, /watch\(mapVisible, async value =>/);
});
