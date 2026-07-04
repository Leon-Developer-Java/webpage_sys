export function buildHimawariTimelineTicks(times = [], maxTicks = 12, activeIndex = -1) {
  const items = Array.isArray(times) ? times : [];
  return includeActiveTick(items.map((label, index) => buildTick(label, index)), items, activeIndex);
}

function includeActiveTick(ticks, items, activeIndex) {
  const index = Number(activeIndex);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return ticks;
  if (ticks.some((tick) => tick.index === index)) return ticks;
  return [...ticks, buildTick(items[index], index)].sort((a, b) => a.index - b.index);
}

function buildTick(label, index) {
  return {
    label,
    displayLabel: compactTickLabel(label),
    index,
  };
}

function compactTickLabel(label) {
  const text = String(label || "").trim();
  const match = text.match(/(\d{2}):(\d{2})$/);
  return match ? `${match[1]}:${match[2]}` : text;
}
