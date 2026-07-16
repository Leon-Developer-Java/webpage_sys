<template>
  <div class="forecast-timeline" :class="{ disabled: !frames.length }">
    <div class="date-bands">
      <span
        v-for="band in dateBands"
        :key="`${band.label}-${band.left}`"
        :style="{ left: `${band.left}%`, width: `${band.width}%` }"
      >{{ band.label }}</span>
    </div>

    <div
      ref="trackEl"
      class="forecast-track"
      role="slider"
      :aria-valuemin="0"
      :aria-valuemax="Math.max(0, frames.length - 1)"
      :aria-valuenow="safeActive"
      :tabindex="frames.length ? 0 : -1"
      @pointerdown="beginSeek"
      @keydown.left.prevent="move(-1)"
      @keydown.right.prevent="move(1)"
    >
      <div class="track-line"></div>
      <div class="track-fill" :style="{ width: `${activePosition}%` }"></div>
      <i class="start-marker" title="起报时刻"></i>

      <button
        v-for="tick in ticks"
        :key="`${tick.index}-${tick.label}`"
        class="time-tick"
        :class="{ start: tick.start }"
        :style="{ left: `${tick.position}%` }"
        type="button"
        @pointerdown.stop
        @click.stop="selectTick(tick)"
      >
        <i></i><span>{{ tick.label }}</span>
      </button>

      <div class="active-pin" :style="{ left: `${activePosition}%` }">
        <div class="time-bubble">
          <b>{{ activeDateLabel }}</b>
          <span>{{ activeLeadLabel }}</span>
        </div>
        <i class="thumb"></i>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  frames: { type: Array, default: () => [] },
  active: { type: Number, default: 0 },
  startTime: { type: String, default: "" },
});
const emit = defineEmits(["update:active"]);
const trackEl = ref(null);

function parseTime(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const parsed = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  return parsed.getTime();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatClock(value) {
  const time = parseTime(value);
  if (!Number.isFinite(time)) return "--:--";
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value, withYear = false) {
  const time = parseTime(value);
  if (!Number.isFinite(time)) return "--";
  const date = new Date(time);
  return withYear
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getMonth() + 1}月${date.getDate()}日`;
}

const safeActive = computed(() => Math.min(Math.max(Math.round(Number(props.active) || 0), 0), Math.max(0, props.frames.length - 1)));
const frameTimes = computed(() => props.frames.map(frame => parseTime(frame?.valid_time)));
const startMillis = computed(() => {
  const explicit = parseTime(props.startTime);
  if (Number.isFinite(explicit)) return explicit;
  const first = frameTimes.value.find(Number.isFinite);
  const lead = Number(props.frames[0]?.lead_minutes || 0) * 60_000;
  return Number.isFinite(first) ? first - Math.max(0, lead) : 0;
});
const endMillis = computed(() => {
  const valid = frameTimes.value.filter(Number.isFinite);
  return valid.length ? valid[valid.length - 1] : startMillis.value + Math.max(1, props.frames.length) * 60_000;
});
const duration = computed(() => Math.max(1, endMillis.value - startMillis.value));

function positionForTime(time) {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.min(100, ((time - startMillis.value) / duration.value) * 100));
}

const activeFrame = computed(() => props.frames[safeActive.value] || null);
const activePosition = computed(() => positionForTime(frameTimes.value[safeActive.value]));
const activeDateLabel = computed(() => {
  const value = activeFrame.value?.valid_time;
  return value ? `${formatDate(value, true)} ${formatClock(value)}` : "等待预报结果";
});
const activeLeadLabel = computed(() => {
  const lead = Number(activeFrame.value?.lead_minutes);
  return Number.isFinite(lead) ? `提前 ${lead} 分钟` : "";
});

const ticks = computed(() => {
  if (!props.frames.length) return [];
  const maxTicks = 9;
  const stride = Math.max(1, Math.ceil(props.frames.length / maxTicks));
  const selected = new Set([0, props.frames.length - 1, safeActive.value]);
  for (let index = 0; index < props.frames.length; index += stride) selected.add(index);
  const items = [...selected].sort((a, b) => a - b).map(index => ({
    index,
    label: formatClock(props.frames[index]?.valid_time),
    position: positionForTime(frameTimes.value[index]),
    start: false,
  }));
  items.unshift({ index: 0, label: `起报 ${formatClock(props.startTime)}`, position: 0, start: true });
  return items;
});

const dateBands = computed(() => {
  const points = [
    { time: startMillis.value, label: formatDate(props.startTime || props.frames[0]?.valid_time) },
    ...props.frames.map((frame, index) => ({ time: frameTimes.value[index], label: formatDate(frame?.valid_time) })),
  ].filter(item => Number.isFinite(item.time));
  if (!points.length) return [];
  const groups = [];
  for (const point of points) {
    const previous = groups[groups.length - 1];
    if (!previous || previous.label !== point.label) groups.push({ label: point.label, start: point.time, end: point.time });
    else previous.end = point.time;
  }
  return groups.map((group, index) => {
    const next = groups[index + 1];
    const left = positionForTime(group.start);
    const right = next ? positionForTime(next.start) : 100;
    return { label: group.label, left, width: Math.max(0, right - left) };
  });
});

function nearestIndex(clientX) {
  if (!trackEl.value || !props.frames.length) return 0;
  const rect = trackEl.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  const target = startMillis.value + ratio * duration.value;
  let bestIndex = 0;
  let bestDistance = Infinity;
  frameTimes.value.forEach((time, index) => {
    const distance = Number.isFinite(time) ? Math.abs(time - target) : Infinity;
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });
  return bestIndex;
}

function beginSeek(event) {
  if (!props.frames.length) return;
  trackEl.value?.setPointerCapture?.(event.pointerId);
  emit("update:active", nearestIndex(event.clientX));
  const moveHandler = moveEvent => emit("update:active", nearestIndex(moveEvent.clientX));
  const endHandler = () => {
    trackEl.value?.removeEventListener("pointermove", moveHandler);
    trackEl.value?.removeEventListener("pointerup", endHandler);
    trackEl.value?.removeEventListener("pointercancel", endHandler);
  };
  trackEl.value?.addEventListener("pointermove", moveHandler);
  trackEl.value?.addEventListener("pointerup", endHandler);
  trackEl.value?.addEventListener("pointercancel", endHandler);
}

function move(delta) {
  emit("update:active", Math.min(Math.max(safeActive.value + delta, 0), Math.max(0, props.frames.length - 1)));
}

function selectTick(tick) {
  emit("update:active", tick.start ? 0 : tick.index);
}
</script>

<style scoped>
.forecast-timeline { min-width: 0; padding: 0 8px 2px; user-select: none; }
.forecast-timeline.disabled { pointer-events: none; opacity: .55; }
.date-bands { position: relative; height: 19px; margin-bottom: 26px; border-bottom: 1px solid var(--border); }
.date-bands span { position: absolute; bottom: 3px; overflow: hidden; padding-left: 5px; color: var(--muted); font-size: 9px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.date-bands span + span { border-left: 1px solid var(--border); }
.forecast-track { position: relative; height: 30px; outline: none; cursor: ew-resize; touch-action: none; }
.track-line, .track-fill { position: absolute; top: 5px; left: 0; height: 5px; border-radius: 5px; }
.track-line { right: 0; background: color-mix(in srgb, var(--muted) 28%, transparent); }
.track-fill { background: var(--accent); }
.start-marker { position: absolute; top: 0; left: 0; width: 2px; height: 15px; border-radius: 2px; background: #f59e0b; }
.time-tick { position: absolute; top: 0; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; transform: translateX(-50%); cursor: pointer; }
.time-tick i { width: 1px; height: 9px; background: color-mix(in srgb, var(--muted) 55%, transparent); }
.time-tick span { font-size: 9px; white-space: nowrap; }
.time-tick.start { align-items: flex-start; transform: none; }
.time-tick.start span { color: #f59e0b; }
.active-pin { position: absolute; top: 0; z-index: 5; pointer-events: none; }
.thumb { position: absolute; top: 7px; left: 0; width: 14px; height: 14px; border: 2px solid #fff; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,165,36,.22); transform: translate(-50%, -50%); }
.time-bubble { position: absolute; bottom: 23px; left: 0; display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-radius: 8px; background: #f59e0b; color: #172033; box-shadow: 0 4px 14px rgba(0,0,0,.22); transform: translateX(-50%); white-space: nowrap; }
.time-bubble::after { content: ''; position: absolute; top: 100%; left: 50%; border: 5px solid transparent; border-top-color: #f59e0b; transform: translateX(-50%); }
.time-bubble b { font-size: 10px; }
.time-bubble span { font-size: 9px; opacity: .75; }
@media (max-width: 900px) {
  .time-bubble b { max-width: 105px; overflow: hidden; text-overflow: ellipsis; }
  .time-tick:nth-of-type(even) span { display: none; }
}
</style>
