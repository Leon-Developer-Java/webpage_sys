<template>
  <div class="time-axis" :class="{ compact: compactLabels, disabled, adaptive }">
    <div class="track" ref="trackEl" @click="seek" @pointermove="preview" @pointerleave="hoverIndex = null" @pointerdown="beginDrag" @pointerup="endDrag" @pointercancel="endDrag">
      <div v-if="!disabled" class="fill" :style="{ width: fillPct }"></div>
      <div v-if="!disabled" class="thumb" :style="{ left: fillPct }"></div>
    </div>
    <div v-if="adaptive && !disabled && hoverIndex !== null" class="seek-hint" :style="{ left: trackWidth < 220 ? '50%' : `clamp(100px, ${tickPct(hoverIndex)}, calc(100% - 100px))` }">{{ times[hoverIndex] }} · {{ hoverIndex + 1 }}/{{ times.length }}</div>
    <div v-if="disabled" class="disabled-label">{{ disabledLabel }}</div>
    <div v-else class="labels">
      <span
        v-for="tick in visibleTicks"
        :key="`${tick.index}-${tick.label}`"
        :class="{ first: tick.index === 0, last: tick.index === times.length - 1 }"
        :style="{ left: tickPct(tick.index) }"
        :title="tick.label"
        @click.stop="emit('update:active', tick.index)"
      >{{ tick.text || (compactLabels ? compactTickLabel(tick.label) : tick.label) }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { buildVisibleTicks } from "../utils/timeAxisTicks";

const props = defineProps({
  times: { type: Array, default: () => [] },
  active: { type: Number, default: 0 },
  tickMode: { type: String, default: "sampled" },
  compactLabels: Boolean,
  disabled: Boolean,
  disabledLabel: { type: String, default: "暂无可播放时间序列" },
  dark: Boolean
});
const emit = defineEmits(["update:active"]);
const trackEl = ref(null);
const adaptive = computed(() => props.tickMode === "adaptive");
const trackWidth = ref(0);
const hoverIndex = ref(null);
let dragging = false;
let observer;
let measureLabel = text => text.length * 7;
onMounted(() => {
  if (!adaptive.value) return;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const updateSize = () => {
    if (context) {
      const style = getComputedStyle(trackEl.value);
      context.font = `11px ${style.fontFamily}`;
      measureLabel = text => context.measureText(text).width;
    }
    trackWidth.value = trackEl.value?.getBoundingClientRect().width || 0;
  };
  observer = new ResizeObserver(updateSize);
  observer.observe(trackEl.value);
  updateSize();
});
onBeforeUnmount(() => observer?.disconnect());

function preview(event) {
  if (!adaptive.value || props.disabled || !props.times.length) return;
  const rect = trackEl.value.getBoundingClientRect();
  hoverIndex.value = Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))) * (props.times.length - 1));
  if (dragging) seek(event);
}
function beginDrag(event) {
  if (!adaptive.value || props.disabled || props.times.length < 2 || event.button !== 0) return;
  dragging = true;
  trackEl.value.setPointerCapture(event.pointerId);
  preview(event);
}
function endDrag() { dragging = false; hoverIndex.value = null; }

const pct = computed(() => Math.min(props.active / Math.max(props.times.length - 1, 1), 1));
const fillPct = computed(() => `${pct.value * 100}%`);
const visibleTicks = computed(() => buildVisibleTicks(props.times, { mode: props.tickMode, maxTicks: 12, width: trackWidth.value, measureText: text => measureLabel(text) }));

function seek(e) {
  if (props.disabled || props.times.length < 2) return;
  const rect = trackEl.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  emit("update:active", Math.round(ratio * (props.times.length - 1)));
}

function tickPct(index) {
  return `${Math.min(Math.max(index / Math.max(props.times.length - 1, 1), 0), 1) * 100}%`;
}

function compactTickLabel(label) {
  const text = String(label || "").trim();
  const match = text.match(/(\d{2}):(\d{2})$/);
  return match ? `${match[1]}:${match[2]}` : text;
}
</script>

<style scoped>
.time-axis { position: relative; display: flex; flex-direction: column; gap: 3px; margin: 0 10px; user-select: none; }
.seek-hint { position: absolute; bottom: 100%; z-index: 10; transform: translateX(-50%); max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; padding: 4px 8px; border-radius: 6px; background: var(--text, #172033); color: var(--bg, #fff); font-size: 11px; white-space: nowrap; pointer-events: none; }

.track {
  position: relative;
  height: 16px;
  overflow: hidden;
  cursor: pointer;
}
.track::before {
  content: '';
  position: absolute;
  left: 0; right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  background: color-mix(in srgb, var(--muted) 32%, transparent);
  border-radius: 2px;
  pointer-events: none;
}
.track:hover::before { background: color-mix(in srgb, var(--muted) 48%, transparent); }
.adaptive .track { touch-action: pan-y; }

.fill {
  position: absolute;
  left: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 2px;
  background: var(--accent);
}
.thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #f5a524;
  box-shadow: 0 0 0 3px rgba(245, 165, 36, 0.28);
  pointer-events: none;
}

.labels { position: relative; height: 16px; }
.labels span { position: absolute; transform: translateX(-50%); font-size: 11px; line-height: 16px; color: var(--muted); cursor: pointer; transition: 0.12s; white-space: nowrap; }
.labels span.first { transform: none; }
.labels span.last { transform: translateX(-100%); }
.labels span:hover { color: var(--text); }
.compact .labels span { font-size: 10px; }
.disabled .track { height: 12px; cursor: default; }
.disabled .track::before { height: 3px; background: color-mix(in srgb, var(--muted) 22%, transparent); }
.disabled .track:hover::before { background: color-mix(in srgb, var(--muted) 22%, transparent); }
.disabled-label { height: 16px; color: color-mix(in srgb, var(--muted) 72%, transparent); font-size: 11px; line-height: 16px; text-align: center; white-space: nowrap; }
</style>
