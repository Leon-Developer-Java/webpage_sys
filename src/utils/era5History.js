const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_VARIABLES = ["t2m", "sp", "u10", "v10"];

export function normalizeEra5HistoryDate(value) {
  const date = String(value || "").trim();
  return ISO_DATE_PATTERN.test(date) ? date : "";
}

export function era5HistoryDatesPath({ fresh = false, now = Date.now() } = {}) {
  const params = new URLSearchParams();
  if (fresh) params.set("t", String(now));
  const query = params.toString();
  return `/api/era5/history/dates${query ? `?${query}` : ""}`;
}

export function era5HistoryDisplayPath({ date = "", fresh = false, now = Date.now() } = {}) {
  const params = new URLSearchParams();
  const normalizedDate = normalizeEra5HistoryDate(date);
  if (date && !normalizedDate) {
    throw new TypeError("ERA5 history date must use YYYY-MM-DD format");
  }
  if (normalizedDate) params.set("date", normalizedDate);
  if (fresh) params.set("t", String(now));
  const query = params.toString();
  return `/api/era5/history/display${query ? `?${query}` : ""}`;
}

export function normalizeEra5HistoryDates(payload) {
  const seen = new Set();
  const dates = (Array.isArray(payload?.dates) ? payload.dates : [])
    .map(item => ({
      date: normalizeEra5HistoryDate(item?.date),
      dataset_id: String(item?.dataset_id || ""),
      active: item?.active === true,
    }))
    .filter(item => item.date && !seen.has(item.date) && seen.add(item.date))
    .sort((left, right) => right.date.localeCompare(left.date));

  return {
    active_date: normalizeEra5HistoryDate(payload?.active_date),
    window_days: Math.max(0, Number(payload?.window_days) || 0),
    window_start_date: normalizeEra5HistoryDate(payload?.window_start_date),
    window_end_date: normalizeEra5HistoryDate(payload?.window_end_date),
    complete: payload?.complete === true,
    dates,
  };
}

export function selectEra5HistoryDate(payload, preferredDate = "") {
  const normalized = normalizeEra5HistoryDates(payload);
  const available = new Set(normalized.dates.map(item => item.date));
  const preferred = normalizeEra5HistoryDate(preferredDate);
  if (preferred && available.has(preferred)) return preferred;
  if (normalized.active_date && available.has(normalized.active_date)) {
    return normalized.active_date;
  }
  return normalized.dates[0]?.date || "";
}

function hourOf(value) {
  const match = String(value || "").match(/[T ](\d{2}):/);
  return match ? Number(match[1]) : Number.NaN;
}

export function validateEra5HistoryDisplay(payload, requestedDate = "") {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("ERA5 history display response is empty");
  }
  const activeDate = normalizeEra5HistoryDate(payload.active_date);
  if (!activeDate) throw new TypeError("ERA5 history display has an invalid active_date");
  const normalizedRequested = normalizeEra5HistoryDate(requestedDate);
  if (normalizedRequested && normalizedRequested !== activeDate) {
    throw new TypeError("ERA5 history display date does not match the selected date");
  }

  const times = Array.isArray(payload.times) ? payload.times : [];
  const hours = times.map(hourOf);
  if (
    times.length !== 24
    || new Set(times).size !== 24
    || hours.some((hour, index) => hour !== index)
  ) {
    throw new TypeError("ERA5 history display must contain 24 ordered hourly frames");
  }

  const layers = payload.variable_layers || {};
  for (const variable of REQUIRED_VARIABLES) {
    const layer = layers[variable];
    if (!layer || !Array.isArray(layer.webp_urls) || layer.webp_urls.length !== 24) {
      throw new TypeError(`ERA5 history layer ${variable} must contain 24 images`);
    }
  }
  return payload;
}
