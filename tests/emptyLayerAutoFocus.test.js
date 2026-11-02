import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@vue/compiler-sfc";

function scriptSetup(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  return parse(source).descriptor.scriptSetup?.content || "";
}

test("empty forecast layers do not fly to a fallback extent", () => {
  const script = scriptSetup("../src/layers/GribLayer.vue");
  assert.match(script, /function zoomToData\(\)\s*{\s*if \(!currentImageUrl\.value\)/);
});

test("empty satellite layers require a renderable image before flying", () => {
  for (const file of ["FY3Layer.vue", "HimawariLayer.vue"]) {
    const script = scriptSetup(`../src/layers/${file}`);
    assert.match(script, /function flyToData\(\)\s*{\s*if \(!display\.value \|\| !imageSrc\.value\) return;/);
  }
});
