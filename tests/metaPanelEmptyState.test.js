import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse as parseJs } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";

const source = readFileSync(new URL("../src/components/MetaPanel.vue", import.meta.url), "utf8");
const descriptor = parseSfc(source).descriptor;
const script = descriptor.scriptSetup.content;
const meaningfulNode = parseJs(script, { sourceType: "module" }).program.body
  .find(node => node.type === "FunctionDeclaration" && node.id.name === "isMeaningfulValue");
const meaningfulSource = script.slice(meaningfulNode.start, meaningfulNode.end);

test("weather metadata placeholders are not treated as real data", () => {
  const context = vm.createContext({});
  vm.runInContext(`${meaningfulSource}; this.isMeaningfulValue = isMeaningfulValue;`, context);

  assert.equal(context.isMeaningfulValue(undefined), false);
  assert.equal(context.isMeaningfulValue("—"), false);
  assert.equal(context.isMeaningfulValue("undefined"), false);
  assert.equal(context.isMeaningfulValue("CMA_product.nc"), true);
});

test("the metadata panel uses a visual empty state without demo descriptions", () => {
  assert.match(descriptor.template.content, /暂无气象数据/);
  assert.match(descriptor.template.content, /DataAnalysis/);
  assert.doesNotMatch(source, /暂无解析信息|表示当前图层所展示|2 米高度处/);
});
