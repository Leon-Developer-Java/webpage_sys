import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/api.js", import.meta.url),
  "utf8",
);

test("ERA5 history assets fall back to the browser origin in same-origin production mode", () => {
  assert.match(source, /configuredBase \|\| window\.location\.origin/);
  assert.match(source, /return withToken\(new URL\(value/);
  assert.doesNotMatch(source, /new URL\(value, `\$\{ERA5_HISTORY_BASE\.replace/);
});

test("ERA5 history API requests use the authenticated request pipeline", () => {
  assert.match(
    source,
    /async function era5HistoryRequest[\s\S]*?await authedFetch\(`/,
  );
  assert.doesNotMatch(
    source,
    /async function era5HistoryRequest[\s\S]*?await fetch\(`/,
  );
});
