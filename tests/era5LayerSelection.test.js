import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const filename = new URL("../src/layers/Era5Layer.vue", import.meta.url);

test("a selected parsed ERA5 resource is not overwritten by the latest display endpoint", () => {
  const source = readFileSync(filename, "utf8");
  const endpointOccurrences = source.match(/\/api\/display\/ERA5/g) || [];

  assert.equal(endpointOccurrences.length, 1);
  assert.match(source, /if \(props\.parsed\)[\s\S]*?else \{[\s\S]*?\/api\/display\/ERA5/);
  assert.doesNotMatch(
    source,
    /display\.value = normalizeDisplay\(payload\.data\);[\s\S]*?display\.value = normalizeDisplay\(payload\.data\);/,
  );
});
