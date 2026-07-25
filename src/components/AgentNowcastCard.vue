<template>
  <section class="nowcast-card">
    <header class="nc-head">
      <div>
        <b>短临降水预报</b>
        <span>{{ statusText }}</span>
      </div>
      <button
        v-if="result"
        type="button"
        class="ghost-btn"
        @click="toggleCollapsed"
      >{{ state.collapsed ? "展开地图" : "收起地图" }}</button>
    </header>

    <div v-if="!task" class="confirm-body">
      <p>系统已从数据库选择最新、连续且间隔6分钟的5帧雷达数据：</p>
      <ol class="frame-list">
        <li v-for="(frame, index) in confirmation.frames" :key="frame.file_uuid">
          <i>{{ index + 1 }}</i>
          <div><b>{{ frame.file_name }}</b><span>{{ formatTime(frame.valid_time) }}</span></div>
        </li>
      </ol>
      <div class="plan-row">
        <span>模型</span><b>降水短临预报</b>
        <span>预测长度</span><b>20帧 / 未来120分钟</b>
      </div>
      <button
        type="button"
        class="submit-btn"
        :disabled="submitting"
        @click="confirmSubmit"
      >{{ submitting ? "正在校验并提交…" : "确认并提交" }}</button>
    </div>

    <div v-else-if="!result" class="run-body">
      <div class="run-line">
        <span class="pulse"></span>
        <div><b>{{ statusText }}</b><small>任务 {{ task.run_id }}</small></div>
        <em>{{ progress }}%</em>
      </div>
      <div class="progress"><i :style="{ width: `${progress}%` }"></i></div>
      <p v-if="task.error || error" class="error">{{ task.error || error }}</p>
    </div>

    <div v-if="result && !state.collapsed" class="result-body">
      <div class="map-wrap">
        <ProjMap
          ref="mapRef"
          projection="等经纬"
          basemap="矢量底图"
          :grid="true"
          :vector="true"
          :dark="true"
        >
          <WebglLayer
            v-if="activeFrame?.prediction_url"
            :key="activeFrame.prediction_url"
            :src="activeFrame.prediction_url"
            :extent="result.extent"
          />
        </ProjMap>
        <div class="map-state">
          {{ formatTime(activeFrame?.valid_time) }} · 提前 {{ activeFrame?.lead_minutes ?? 0 }} 分钟
        </div>
      </div>

      <div class="radar-legend">
        <span>组合反射率</span>
        <div class="legend-colors"></div>
        <b>dBZ</b>
        <div class="legend-labels">
          <i v-for="value in [0, 10, 20, 30, 40, 50, 60, 70]" :key="value">{{ value }}</i>
        </div>
      </div>

      <div class="play-controls">
        <button type="button" @click="move(-1)" :disabled="activeIndex <= 0">上一帧</button>
        <button type="button" class="play-btn" @click="playing = !playing">
          {{ playing ? "暂停" : "播放" }}
        </button>
        <button type="button" @click="move(1)" :disabled="activeIndex >= frames.length - 1">下一帧</button>
        <span>第 {{ activeIndex + 1 }}/{{ frames.length }} 帧</span>
      </div>
      <ForecastTimeline
        :frames="frames"
        :active="activeIndex"
        :start-time="result.forecast_start_time"
        @update:active="selectFrame"
      />
      <p v-if="activeFrame?.summary" class="frame-summary">{{ activeFrame.summary }}</p>
    </div>

    <p v-if="error && !task" class="error">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  getAgentNowcastResult,
  getAgentNowcastRun,
  submitAgentNowcast,
} from "../api.js";
import ForecastTimeline from "./ForecastTimeline.vue";
import ProjMap from "./ProjMap.vue";
import WebglLayer from "./WebglLayer.vue";

const props = defineProps({
  state: { type: Object, required: true },
});
const emit = defineEmits(["change"]);

const submitting = ref(false);
const error = ref("");
const activeIndex = ref(0);
const playing = ref(false);
const mapRef = ref(null);
let pollTimer = null;
let playTimer = null;

const state = props.state;
const confirmation = computed(() => state.confirmation || { frames: [] });
const task = computed(() => state.task || null);
const result = computed(() => state.result || null);
const frames = computed(() => result.value?.frames || []);
const activeFrame = computed(() => frames.value[activeIndex.value] || null);
const progress = computed(() => {
  const value = Number(task.value?.progress);
  if (Number.isFinite(value)) return Math.min(100, Math.max(0, Math.round(value)));
  return task.value?.status === "running" ? 50 : task.value?.status === "succeeded" ? 100 : 10;
});
const statusText = computed(() => ({
  queued: "任务已进入队列",
  running: "模型正在预测",
  cancelling: "正在取消",
  succeeded: "预测完成",
  failed: "预测失败",
  cancelled: "任务已取消",
})[task.value?.status] || (task.value ? "正在准备任务" : "等待确认5帧输入"));

function formatTime(value) {
  const text = String(value || "").trim();
  if (!text) return "--";
  const date = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(date);
}

function persist() {
  emit("change");
}

async function confirmSubmit() {
  if (submitting.value || task.value) return;
  submitting.value = true;
  error.value = "";
  try {
    state.task = await submitAgentNowcast(
      confirmation.value.frames.map(frame => frame.file_uuid),
    );
    persist();
    schedulePoll(0);
  } catch (reason) {
    error.value = reason.message || "短临预报任务提交失败";
  } finally {
    submitting.value = false;
  }
}

function schedulePoll(delay = 1500) {
  clearTimeout(pollTimer);
  if (!task.value?.run_id) return;
  pollTimer = setTimeout(poll, delay);
}

async function poll() {
  if (!task.value?.run_id) return;
  try {
    state.task = await getAgentNowcastRun(task.value.run_id);
    persist();
    if (state.task.status === "succeeded") {
      state.result = await getAgentNowcastResult(state.task.run_id);
      state.collapsed = false;
      activeIndex.value = 0;
      playing.value = true;
      persist();
      await nextTick();
      mapRef.value?.flyTo(state.result.extent);
    } else if (!["failed", "cancelled"].includes(state.task.status)) {
      schedulePoll();
    }
  } catch (reason) {
    error.value = reason.message || "查询短临预报任务失败";
    schedulePoll(3000);
  }
}

function toggleCollapsed() {
  state.collapsed = !state.collapsed;
  persist();
  if (!state.collapsed) {
    nextTick(() => mapRef.value?.flyTo(result.value?.extent));
  }
}

function selectFrame(index) {
  activeIndex.value = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, frames.value.length - 1));
}

function move(delta) {
  playing.value = false;
  selectFrame(activeIndex.value + delta);
}

watch(playing, value => {
  clearInterval(playTimer);
  if (!value || frames.value.length < 2) return;
  playTimer = setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % frames.value.length;
  }, 900);
});

onMounted(async () => {
  if (task.value?.status === "succeeded" && !result.value) schedulePoll(0);
  else if (task.value && !["failed", "cancelled", "succeeded"].includes(task.value.status)) schedulePoll(0);
  else if (result.value) {
    await nextTick();
    mapRef.value?.flyTo(result.value.extent);
  }
});

onBeforeUnmount(() => {
  clearTimeout(pollTimer);
  clearInterval(playTimer);
});
</script>

<style scoped>
.nowcast-card { width: min(760px, 72vw); margin-top: 10px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--panel) 92%, transparent); }
.nc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
.nc-head div { display: flex; flex-direction: column; gap: 2px; }
.nc-head b { color: var(--text); font-size: 13px; }
.nc-head span { color: var(--muted); font-size: 10px; }
.ghost-btn, .play-controls button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text); cursor: pointer; }
.confirm-body, .run-body { padding: 12px 13px; }
.confirm-body > p { margin: 0 0 9px; color: var(--muted); font-size: 11px; }
.frame-list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.frame-list li { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; background: color-mix(in srgb, var(--panel) 80%, var(--accent) 5%); }
.frame-list li > i { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); font-size: 10px; font-style: normal; }
.frame-list div { min-width: 0; display: flex; flex: 1; justify-content: space-between; gap: 10px; }
.frame-list b { overflow: hidden; color: var(--text); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.frame-list span { flex-shrink: 0; color: var(--muted); font-size: 10px; }
.plan-row { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 5px 9px; margin: 10px 0; color: var(--muted); font-size: 10px; }
.plan-row b { color: var(--text); }
.submit-btn { width: 100%; padding: 8px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 700; cursor: pointer; }
.submit-btn:disabled { cursor: wait; opacity: .65; }
.run-line { display: flex; align-items: center; gap: 9px; }
.run-line div { display: flex; flex: 1; flex-direction: column; }
.run-line b { font-size: 12px; }
.run-line small { color: var(--muted); font-size: 9px; }
.run-line em { color: var(--accent); font-size: 11px; font-style: normal; font-weight: 700; }
.pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }
.progress { height: 4px; margin-top: 9px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--muted) 20%, transparent); }
.progress i { display: block; height: 100%; background: var(--accent); transition: width .25s; }
.result-body { padding-bottom: 10px; }
.map-wrap { position: relative; height: 370px; }
.map-wrap :deep(.projmap) { width: 100%; height: 100%; }
.map-state { position: absolute; right: 10px; bottom: 9px; z-index: 5; padding: 5px 8px; border-radius: 7px; background: rgba(12, 18, 30, .78); color: #fff; font-size: 10px; pointer-events: none; }
.radar-legend { display: grid; grid-template-columns: auto minmax(180px,1fr) auto; align-items: center; gap: 5px 9px; padding: 8px 12px 1px; color: var(--muted); font-size: 9px; }
.legend-colors { height: 8px; border-radius: 3px; background: linear-gradient(90deg,#04e9e7,#019ff4,#0300f4,#02fd02,#01c501,#008e00,#fdf802,#e5bc00,#fd9500,#d40000,#bc0000,#f800fd,#9854c6,#fdfdfd); }
.legend-labels { grid-column: 2; display: flex; justify-content: space-between; }
.legend-labels i { font-style: normal; }
.play-controls { display: flex; align-items: center; gap: 6px; padding: 8px 12px 2px; }
.play-controls button:disabled { cursor: default; opacity: .4; }
.play-controls .play-btn { border-color: var(--accent); color: var(--accent); }
.play-controls span { margin-left: auto; color: var(--muted); font-size: 10px; }
.frame-summary { margin: 7px 12px 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.error { margin: 8px 12px 12px; color: #ef4444; font-size: 10px; }
.result-body :deep(.time-tick.start + .time-tick span) { display: none; }

@media (max-width: 900px) {
  .nowcast-card { width: 100%; }
  .map-wrap { height: 300px; }
  .frame-list div { flex-direction: column; gap: 2px; }
  .plan-row { grid-template-columns: auto 1fr; }
}
</style>
