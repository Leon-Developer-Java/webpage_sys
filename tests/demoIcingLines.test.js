import test from "node:test";
import assert from "node:assert/strict";
import { DEMO_ICING_LINES } from "../src/data/demoIcingLines.js";

test("five clearly labeled demonstration transmission lines include endpoint towers", () => {
  assert.deepEqual(DEMO_ICING_LINES.map(line => line.name), ["富四线", "山富线", "富铁甲线", "富铁乙线", "巨牵线"]);
  for (const line of DEMO_ICING_LINES) {
    assert.ok(line.points.length >= 2);
    assert.ok(line.towers.length >= 2);
    assert.match(line.towers[0].name, /（/);
    assert.match(line.towers.at(-1).name, /（/);
  }
});
