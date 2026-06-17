<template>
  <div class="time-axis">
    <div class="track" ref="trackEl" @click="seek">
      <div class="fill" :style="{ width: fillPct }"></div>
      <div class="thumb" :style="{ left: fillPct }"></div>
    </div>
    <div class="labels">
      <span v-for="(t, i) in times" :key="t" @click.stop="emit('update:active', i)">{{ t }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  times: { type: Array, default: () => [] },
  active: { type: Number, default: 0 },
  dark: Boolean
});
const emit = defineEmits(["update:active"]);
const trackEl = ref(null);

const pct = computed(() => Math.min(props.active / Math.max(props.times.length - 1, 1), 1));
const fillPct = computed(() => `${pct.value * 100}%`);

function seek(e) {
  const rect = trackEl.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  emit("update:active", Math.round(ratio * (props.times.length - 1)));
}
</script>

<style scoped>
.time-axis { display: flex; flex-direction: column; gap: 3px; user-select: none; }

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
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  pointer-events: none;
}
.track:hover::before { background: rgba(255, 255, 255, 0.18); }

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

.labels { display: flex; justify-content: space-between; }
.labels span { font-size: 11px; color: var(--muted); cursor: pointer; transition: 0.12s; }
.labels span:hover { color: var(--text); }
</style>
