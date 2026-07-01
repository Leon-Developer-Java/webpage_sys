export function buildVisibleTicks(times = [], options = {}) {
  const items = Array.isArray(times) ? times : [];
  const mode = options.mode || "sampled";

  if (mode === "hourly") {
    const hourlyTicks = items
      .map((label, index) => ({ label, index }))
      .filter((tick) => isHourlyLabel(tick.label));

    if (hourlyTicks.length) return hourlyTicks;
  }

  return buildSampledTicks(items, options.maxTicks || 12);
}

function buildSampledTicks(items, maxTicks) {
  if (items.length <= maxTicks) {
    return items.map((label, index) => ({ label, index }));
  }

  const step = Math.ceil((items.length - 1) / (maxTicks - 1));
  const ticks = [];

  for (let index = 0; index < items.length; index += step) {
    ticks.push({ label: items[index], index });
  }

  const lastIndex = items.length - 1;
  if (ticks[ticks.length - 1]?.index !== lastIndex) {
    ticks.push({ label: items[lastIndex], index: lastIndex });
  }

  return ticks;
}

function isHourlyLabel(label) {
  const text = String(label || "").trim();
  return /\b\d{2}:00\b$/.test(text);
}
