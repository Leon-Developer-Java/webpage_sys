import test from "node:test";
import assert from "node:assert/strict";

import {
  era5HistoryDatesPath,
  era5HistoryDisplayPath,
  normalizeEra5HistoryDates,
  selectEra5HistoryDate,
  validateEra5HistoryDisplay,
} from "../src/utils/era5History.js";

function completeDisplay(date = "2026-07-16") {
  const times = Array.from({ length: 24 }, (_, hour) => (
    `${date}T${String(hour).padStart(2, "0")}:00`
  ));
  const variable_layers = Object.fromEntries(
    ["t2m", "sp", "u10", "v10"].map(name => [name, {
      times,
      webp_urls: times.map((_, index) => `/data/${date}/${name}_${index}.webp`),
    }]),
  );
  return {
    active_date: date,
    times,
    variable_layers,
  };
}

test("history API paths include the selected date and cache buster", () => {
  assert.equal(
    era5HistoryDatesPath({ fresh: true, now: 123 }),
    "/api/era5/history/dates?t=123",
  );
  assert.equal(
    era5HistoryDisplayPath({ date: "2026-07-16", fresh: true, now: 456 }),
    "/api/era5/history/display?date=2026-07-16&t=456",
  );
});

test("history dates are normalized, deduplicated and newest first", () => {
  const result = normalizeEra5HistoryDates({
    active_date: "2026-07-16",
    window_days: 90,
    dates: [
      { date: "2026-07-15", dataset_id: "older" },
      { date: "invalid", dataset_id: "bad" },
      { date: "2026-07-16", dataset_id: "latest", active: true },
      { date: "2026-07-15", dataset_id: "duplicate" },
    ],
  });

  assert.deepEqual(result.dates.map(item => item.date), ["2026-07-16", "2026-07-15"]);
  assert.equal(result.window_days, 90);
  assert.equal(result.dates[0].active, true);
});

test("date selection preserves an available user choice, then falls back to active", () => {
  const payload = {
    active_date: "2026-07-16",
    dates: [
      { date: "2026-07-16", active: true },
      { date: "2026-07-15" },
    ],
  };
  assert.equal(selectEra5HistoryDate(payload, "2026-07-15"), "2026-07-15");
  assert.equal(selectEra5HistoryDate(payload, "2026-07-01"), "2026-07-16");
});

test("a selected history day requires four complete 24-hour layers", () => {
  const valid = completeDisplay();
  assert.equal(validateEra5HistoryDisplay(valid, "2026-07-16"), valid);

  const incomplete = completeDisplay();
  incomplete.variable_layers.u10.webp_urls.pop();
  assert.throws(
    () => validateEra5HistoryDisplay(incomplete, "2026-07-16"),
    /u10 must contain 24 images/,
  );
});

test("history display rejects a response for a different selected date", () => {
  assert.throws(
    () => validateEra5HistoryDisplay(completeDisplay("2026-07-16"), "2026-07-15"),
    /does not match the selected date/,
  );
});
