import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/api.js", import.meta.url),
  "utf8",
);

test("ERA5 history assets fall back to the browser origin in same-origin production mode", () => {
  assert.match(source, /configuredBase \|\| window\.location\.origin/);
  assert.doesNotMatch(source, /new URL\(value, `\$\{ERA5_HISTORY_BASE\.replace/);
});
