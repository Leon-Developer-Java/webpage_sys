import test from "node:test";
import assert from "node:assert/strict";
import { buildVisibleTicks } from "../src/utils/timeAxisTicks.js";

const times = Array.from({ length: 121 }, (_, i) => {
  const minutes = 120 + i * 5;
  return `04-12 ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const measureText = text => text.length * 7;

for (const width of [160, 240, 390, 768, 900, 1440]) {
  test(`adaptive 121-frame labels do not overlap at ${width}px`, () => {
    const ticks = buildVisibleTicks(times, { mode: "adaptive", width, measureText });
    assert.equal(ticks[0].index, 0);
    assert.equal(ticks.at(-1).index, 120);
    let right = -16;
    for (const tick of ticks) {
      const size = measureText(tick.text);
      const left = tick.index === 0 ? 0 : tick.index === 120 ? width - size : tick.index / 120 * width - size / 2;
      assert(left >= right + 16);
      assert(left + size <= width);
      right = left + size;
      assert.equal(tick.label, times[tick.index]);
    }
    assert.equal(times.length, 121);
  });
}

test("endpoint proximity and measured wide labels do not cause collisions", () => {
  const ticks = buildVisibleTicks(times, { mode: "adaptive", width: 280, measureText: () => 100 });
  assert.deepEqual(ticks.map(t => t.index), [0, 120]);
});

test("adaptive empty, single frame and tiny tracks are safe", () => {
  assert.deepEqual(buildVisibleTicks([], { mode: "adaptive", width: 300 }), []);
  assert.deepEqual(buildVisibleTicks(times, { mode: "adaptive", width: 0 }), []);
  assert.equal(buildVisibleTicks([times[0]], { mode: "adaptive", width: 300 }).length, 1);
  assert.equal(buildVisibleTicks(times, { mode: "adaptive", width: 40 }).length, 1);
});

test("other time-axis modes retain their original labels and indices", () => {
  assert.deepEqual(buildVisibleTicks(times.slice(0, 3)), times.slice(0, 3).map((label, index) => ({ label, index })));
  assert.equal(buildVisibleTicks(times, { mode: "all" }).length, 121);
  assert(buildVisibleTicks(times, { mode: "hourly" }).every(t => t.label.endsWith(":00")));
});
