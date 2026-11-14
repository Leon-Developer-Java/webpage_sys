export function buildVisibleTicks(times = [], options = {}) {
  const items = Array.isArray(times) ? times : [];
  const mode = options.mode || "sampled";

  if (mode === "adaptive") return buildAdaptiveTicks(items, options);

  if (mode === "all") {
    return items.map((label, index) => ({ label, index }));
  }

  if (mode === "hourly") {
    const hourlyTicks = items
      .map((label, index) => ({ label, index }))
      .filter((tick) => isHourlyLabel(tick.label));

    if (hourlyTicks.length) return hourlyTicks;
  }

  return buildSampledTicks(items, options.maxTicks || 12);
}

function buildAdaptiveTicks(items, { width = 0, measureText = text => text.length * 7, gap = 16 } = {}) {
  if (!items.length || width <= 0) return [];
  const ticks = items.map((label, index) => ({ label, index, text: String(label).match(/\d{2}:\d{2}$/)?.[0] || String(label) }));
  const size = tick => measureText(tick.text);
  const capacity = Math.max(2, Math.floor(width / (Math.max(...ticks.map(size)) + gap)) + 1);
  let candidates = ticks;
  if (ticks.length > capacity) {
    for (const minutes of [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]) {
      candidates = ticks.filter(tick => {
        if (tick.index === 0 || tick.index === ticks.length - 1) return true;
        const clock = tick.text.match(/^(\d{2}):(\d{2})$/);
        return clock && (Number(clock[1]) * 60 + Number(clock[2])) % minutes === 0;
      });
      if (candidates.length <= capacity) break;
    }
  }
  const bounds = tick => {
    const x = tick.index / Math.max(1, ticks.length - 1) * width;
    const left = tick.index === 0 ? 0 : tick.index === ticks.length - 1 ? width - size(tick) : x - size(tick) / 2;
    return { left, right: left + size(tick) };
  };
  const first = ticks[0], last = ticks.at(-1);
  const selected = [first];
  if (first === last || bounds(last).left < bounds(first).right + gap) return selected;
  for (const tick of candidates.slice(1)) {
    if (tick === last) continue;
    if (bounds(tick).left >= bounds(selected.at(-1)).right + gap && bounds(tick).right + gap <= bounds(last).left) selected.push(tick);
  }
  selected.push(last);
  return selected;
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
