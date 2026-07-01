export function buildHimawariTimelineTicks(times = [], maxTicks = 12) {
  const items = Array.isArray(times) ? times : [];
  const hourlyTicks = items
    .map((label, index) => ({ label, index }))
    .filter((tick) => /\b\d{2}:00\b$/.test(String(tick.label || "").trim()));

  return sampleTicks(hourlyTicks.length ? hourlyTicks : items.map((label, index) => ({ label, index })), maxTicks);
}

function sampleTicks(ticks, maxTicks) {
  if (!ticks.length) return [];
  if (ticks.length <= maxTicks) return ticks;

  const step = Math.ceil((ticks.length - 1) / (maxTicks - 1));
  const sampled = [];
  for (let position = 0; position < ticks.length; position += step) {
    sampled.push(ticks[position]);
  }

  const lastTick = ticks[ticks.length - 1];
  if (sampled[sampled.length - 1]?.index !== lastTick.index) {
    sampled.push(lastTick);
  }
  return sampled;
}
