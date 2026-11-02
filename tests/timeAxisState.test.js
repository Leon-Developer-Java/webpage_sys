import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse as parseJs } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

const source = readFileSync(new URL("../src/components/TimeAxis.vue", import.meta.url), "utf8");
const script = parseSfc(source).descriptor.scriptSetup.content;
const seekNode = parseJs(script, { sourceType: "module" }).program.body
  .find(node => node.type === "FunctionDeclaration" && node.id.name === "seek");
const seekSource = script.slice(seekNode.start, seekNode.end);

function createAxis(disabled, times = ["00时", "02时"]) {
  const events = [];
  const context = vm.createContext({
    props: { disabled, times },
    trackEl: { value: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } },
    emit: (...args) => events.push(args),
    Math,
  });
  vm.runInContext(`${seekSource}; this.seek = seek;`, context);
  return { seek: context.seek, events };
}

test("disabled and single-frame time axes ignore seek operations", () => {
  const disabled = createAxis(true);
  disabled.seek({ clientX: 50 });
  assert.deepEqual(disabled.events, []);

  const singleFrame = createAxis(false, ["00时"]);
  singleFrame.seek({ clientX: 50 });
  assert.deepEqual(singleFrame.events, []);
});

test("an interactive time axis emits the nearest frame index", () => {
  const axis = createAxis(false, ["00时", "02时", "04时"]);
  axis.seek({ clientX: 80 });
  assert.deepEqual(axis.events, [["update:active", 2]]);
});
