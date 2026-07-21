import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";

const filename = new URL(
  "../src/layers/Era5WindParticleLayer.vue",
  import.meta.url,
);

test("the standalone ERA5 WebGL particle component compiles as a Vue SFC", () => {
  const source = readFileSync(filename, "utf8");
  const parsed = parse(source, { filename: filename.pathname });
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.descriptor.scriptSetup);
  assert.ok(parsed.descriptor.template);
  assert.equal(parsed.descriptor.styles.length, 1);

  const script = compileScript(parsed.descriptor, {
    id: "era5-wind-particle",
  });
  const template = compileTemplate({
    source: parsed.descriptor.template.content,
    filename: filename.pathname,
    id: "era5-wind-particle",
  });
  const style = compileStyle({
    source: parsed.descriptor.styles[0].content,
    filename: filename.pathname,
    id: "era5-wind-particle",
    scoped: true,
  });

  assert.ok(script.content.includes("createEra5WindParticleSystem"));
  assert.ok(script.content.includes("speedColors"));
  assert.ok(script.content.includes("uColor4"));
  assert.equal(script.content.includes("smoothstep"), false);
  assert.deepEqual(template.errors, []);
  assert.ok(template.code.includes("era5-wind-particle-layer"));
  assert.deepEqual(style.errors, []);
  assert.ok(style.code.includes("pointer-events: none"));
});
