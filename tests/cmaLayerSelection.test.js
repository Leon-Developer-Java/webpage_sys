import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@vue/compiler-sfc";
import { parse as parseJs } from "@babel/parser";

const { descriptor } = parse(readFileSync(new URL("../src/layers/CmaLayer.vue", import.meta.url), "utf8"));
let script = descriptor.scriptSetup.content;
for (const item of parseJs(script, { sourceType: "module" }).program.body.filter(item => item.type === "ImportDeclaration").reverse()) {
  script = script.slice(0, item.start) + script.slice(item.end);
}
script = script.replaceAll("import.meta.env.VITE_API_BASE", '"http://test.invalid"');

function createLayer(variantIndex, { failVariable = "" } = {}) {
  const calls = [], draws = [], events = [], unmounts = [];
  const names = ["Tair", "Qair", "Rain", "Wind"];
  const props = { variantIndex, resolution: "native", levelIndex: 0, timeIndex: 0, parsed: null };
  const context = vm.createContext({
    URL, URLSearchParams,
    defineProps: () => props,
    defineEmits: () => (name, payload) => events.push({ name, payload }),
    ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
    inject: (key, fallback) => key === "mapSurface" ? { setData: src => draws.push(src), clear() {} } : fallback,
    watch() {}, onMounted() {}, onBeforeUnmount: cb => unmounts.push(cb),
    withToken: value => value,
    Image: class { set src(value) { this.complete = true; this.naturalWidth = 2; queueMicrotask(() => this.onload?.()); } },
    authedFetch: async url => {
      const variable = new URL(url).searchParams.get("variable") || names[0];
      calls.push(variable);
      if (variable === failVariable) throw new Error("test rendering failure");
      return { ok: true, json: async () => ({ code: 0, data: {
        grid: { variable, webp_url: `/data/${variable}.webp`, extent: [0, 0, 2, 2], min: 0, max: 1 },
        variables: names.map(name => ({ name, label: name })), frames: [], frame_count: 1,
      } }) };
    },
  });
  vm.runInContext(script + "\nthis.layer = { loadDisplay, selectedVariable, grid, error };", context);
  return { ...context.layer, props, calls, draws, events, unmounts };
}

test("each CMA pane fetches and renders its selected element on first load", async () => {
  for (const [index, expected] of ["Tair", "Qair", "Rain", "Wind"].entries()) {
    const layer = createLayer(index);
    await layer.loadDisplay();
    assert.equal(layer.selectedVariable.value, expected);
    assert.equal(layer.grid.value.variable, expected);
    assert.equal(layer.draws.at(-1), `http://test.invalid/data/${expected}.webp`);
    assert.equal(layer.events.find(event => event.name === "variable-change").payload.variable, expected);
  }
});

test("an explicit element selection is not replaced by a pane offset", async () => {
  const layer = createLayer(3);
  await layer.loadDisplay("Qair");
  assert.equal(layer.selectedVariable.value, "Qair");
  assert.equal(layer.grid.value.variable, "Qair");
});

test("a failed variant request cannot display the default element under another label", async () => {
  const layer = createLayer(1, { failVariable: "Qair" });
  await layer.loadDisplay();
  assert.equal(layer.draws.length, 0);
  assert.equal(layer.events.length, 0);
  assert.match(layer.error.value, /failure/);
});
