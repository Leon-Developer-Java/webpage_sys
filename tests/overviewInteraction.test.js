import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse as parseJs } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

function scriptSetup(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  return { source, script: parseSfc(source).descriptor.scriptSetup.content };
}

function functionSource(script, name) {
  const node = parseJs(script, { sourceType: "module" }).program.body
    .find(item => item.type === "FunctionDeclaration" && item.id.name === name);
  assert.ok(node, `Expected ${name} to be declared`);
  return script.slice(node.start, node.end);
}

test("data-source switching has no artificial delay or blocking state", () => {
  const { source, script } = scriptSetup("../src/views/Overview.vue");
  const selectSource = functionSource(script, "selectSource");

  assert.doesNotMatch(selectSource, /setTimeout|switching/);
  assert.doesNotMatch(source, /:disabled="switching/);
});

test("empty data sources do not expose hard-coded demo metadata", () => {
  const { source, script } = scriptSetup("../src/views/Overview.vue");

  assert.doesNotMatch(source, /gfs\.t00z\.pgrb2\.0p25\.f006|const infos\s*=/);
  assert.doesNotMatch(source, /MVP 当前版本|文件存储：原始数据|前端渲染：/);
  assert.doesNotMatch(script, /sourceFallbackInfo|defaultProcessing|const versions\s*=/);
});

test("map wrapper forwards playback props and the public flyTo method", () => {
  const { source, script } = scriptSetup("../src/components/ProjMap.vue");
  assert.match(source, /v-bind="\$attrs"/);
  const expose = parseJs(script, { sourceType: "module" }).program.body
    .find(item => item.type === "ExpressionStatement"
      && item.expression.type === "CallExpression"
      && item.expression.callee.name === "defineExpose");
  assert.ok(expose, "Expected public map methods to be exposed");
  const methods = expose.expression.arguments[0];
  const calls = [];
  const map = { value: { flyTo: (...args) => calls.push(args) } };
  const exposed = vm.runInNewContext(`(${script.slice(methods.start, methods.end)})`, { map });
  const extent = [100, 20, 120, 40];
  exposed.flyTo(extent);
  assert.equal(calls[0][0], extent);
  map.value = null;
  assert.doesNotThrow(() => exposed.flyTo(extent));
});

test("map auto-fit is suppressed while playback preserves the current view", () => {
  const { script } = scriptSetup("../packages/wrf-ui/src/ProjectionMap.vue");
  const flyTo = functionSource(script, "flyTo");
  const calls = [];
  const props = { preserveView: true, animate: true };
  const context = vm.createContext({
    props,
    fittedExtent: null,
    userAdjustedView: true,
    fitExtent: extent => {
      calls.push(["fit", extent]);
      return { center: [0, 0], scale: 1 };
    },
    animateTo: target => calls.push(["animate", target]),
  });
  vm.runInContext(`${flyTo}; this.flyTo = flyTo;`, context);

  context.flyTo([100, 20, 120, 40]);
  assert.deepEqual(calls, []);

  props.preserveView = false;
  context.flyTo([100, 20, 120, 40]);
  assert.equal(calls[0][0], "fit");
  assert.equal(calls[1][0], "animate");
});

test("playback is scoped to the selected catalog resource for every source", () => {
  const { source, script } = scriptSetup("../src/views/Overview.vue");
  const layerProps = functionSource(script, "layerProps");
  const resourceSceneId = functionSource(script, "resourceSceneId");
  const togglePlaying = functionSource(script, "togglePlaying");

  assert.match(source, /v-bind="layerProps\(p\.key, i\)"/);
  assert.match(resourceSceneId, /attributes\.scene_ids/);
  assert.match(layerProps, /resourceSceneId\(key, paneIndex\)/);
  assert.doesNotMatch(script, /selectedSeriesPlayable/);
  assert.doesNotMatch(togglePlaying, /\.playable|\.gaps|时间序列不连续/);
});

test("CMA catalog playback requests the exact meta file for each selected frame", () => {
  const { script } = scriptSetup("../src/layers/CmaLayer.vue");
  const fetchCmaDisplay = functionSource(script, "fetchCmaDisplay");

  assert.match(fetchCmaDisplay, /metaFileForIndex\(timeIndex\)/);
  assert.match(fetchCmaDisplay, /exact_meta/);
  assert.match(fetchCmaDisplay, /exactFrame \? 0 : timeIndex/);
});
