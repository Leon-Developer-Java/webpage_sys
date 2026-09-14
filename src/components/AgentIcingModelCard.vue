<template>
  <section :class="['icing-model-card', { expanded }]">
    <header class="card-head">
      <div>
        <b>覆冰预测</b>
        <span>{{ stageText }}</span>
      </div>
      <div class="head-actions">
        <button type="button" class="ghost-btn" @click="$emit('expand')">{{ expanded ? '收起' : (mapVisible ? '展开' : '展开地图') }}</button>
        <button v-if="state.run_id" type="button" class="ghost-btn" @click="openModelPage">专用模型调用</button>
      </div>
    </header>

    <div v-if="!mapVisible && task?.status === 'succeeded'" class="map-collapsed">
      <span>覆冰地图已收起，可按需展开查看。</span>
      <button type="button" class="ghost-btn" @click="$emit('expand')">展开地图</button>
    </div>

    <div v-else-if="!result" class="run-body">
      <div class="run-line">
        <span :class="['pulse', task?.status]"></span>
        <div><b>{{ stageText }}</b><small>任务 {{ state.run_id || '--' }}</small></div>
        <em>{{ progress }}%</em>
      </div>
      <div class="progress"><i :style="{ width: `${progress}%` }"></i></div>
      <p v-if="task?.error || error" class="error">{{ task?.error || error }}</p>
    </div>

    <template v-else>
      <div v-if="seasonDays.length" class="season-picker">
        <b>整冬逐日概览（{{ seasonDays.length }} 天）</b>
        <div class="range-controls">
          <label>开始 <input v-model="rangeStart" type="date" :min="seasonStart" :max="seasonEnd" /></label>
          <label>结束 <input v-model="rangeEnd" type="date" :min="seasonStart" :max="seasonEnd" /></label>
          <button type="button" class="ghost-btn" @click="loadSeasonRange">查看时段</button>
        </div>
        <select v-model="selectedDate" @change="loadSeasonDay"><option v-for="day in seasonDays" :key="day.date" :value="day.date">{{ day.date }} · {{ day.max_net_ice_thickness_mm }} mm</option></select>
        <small>任意日期区间均可查看：7 天以内逐小时播放，较长时段按每日峰值帧播放。</small>
      </div>
      <div class="summary-grid">
        <div><span>预报时次</span><b>{{ frames.length }}</b></div>
        <div><span>最大净冰厚</span><b>{{ maxThickness }} mm</b></div>
        <div><span>当前覆冰格点</span><b>{{ activeFrame?.active_grid_cells || 0 }}</b></div>
      </div>
      <div v-if="rangeSummary" class="range-summary">{{ rangeLabel }} · 峰值 {{ rangeSummary.max_net_ice_thickness_mm ?? '--' }} mm（{{ formatTime(rangeSummary.peak_valid_time) }}）· 最大活跃格点 {{ rangeSummary.max_active_grid_cells ?? '--' }} · 重度及以上 {{ rangeSummary.max_severe_grid_cells ?? '--' }}</div>
      <div class="map-wrap">
        <ProjMap ref="mapRef" projection="等经纬" basemap="矢量底图" :grid="true" :vector="true" :dark="true">
          <WebglLayer v-if="activeFrame?.raster_url" :key="activeFrame.raster_url" :src="activeFrame.raster_url" :extent="result.extent" />
          <IcingPointLayer v-if="grid.length" :points="grid" />
          <IcingLineLayer :lines="demoLines" />
        </ProjMap>
        <div class="map-state">{{ formatTime(activeFrame?.valid_time) }} · {{ activeFrame?.active_grid_cells || 0 }} 个覆冰网格</div>
        <div class="demo-line-note">线路与杆塔位置为演示模拟</div>
      </div>
      <div class="icing-legend">
        <span>净冰厚</span><div :style="{ background: legendGradient }"></div><b>{{ result.colorbar?.unit || 'mm' }}</b>
      </div>
      <div class="play-controls">
        <button type="button" @click="move(-1)" :disabled="activeIndex <= 0">上一时次</button>
        <button type="button" class="play-btn" @click="playing = !playing">{{ playing ? '暂停' : '播放' }}</button>
        <button type="button" @click="move(1)" :disabled="activeIndex >= frames.length - 1">下一时次</button>
        <span>第 {{ activeIndex + 1 }}/{{ frames.length }} 帧</span>
      </div>
      <ForecastTimeline :frames="frames" :active="activeIndex" :start-time="result.forecast_start_time" @update:active="selectFrame" />
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getIcingGrid, getModelRun, getModelRunResult, getWinterIcingView } from "../api.js";
import ForecastTimeline from "./ForecastTimeline.vue";
import IcingPointLayer from "./IcingPointLayer.vue";
import IcingLineLayer from "./IcingLineLayer.vue";
import ProjMap from "./ProjMap.vue";
import WebglLayer from "./WebglLayer.vue";
import { DEMO_ICING_LINES } from "../data/demoIcingLines.js";

const props = defineProps({ state: { type: Object, required: true }, expanded: { type: Boolean, default: false } });
const emit = defineEmits(["expand", "change"]);
const router = useRouter();
const task = ref(null);
const error = ref("");
const activeIndex = ref(0);
const playing = ref(false);
const mapRef = ref(null);
const grid = ref([]);
const demoLines = DEMO_ICING_LINES;
const selectedDate = ref("");
const rangeStart = ref("");
const rangeEnd = ref("");
let pollTimer = null;
let playTimer = null;

const result = computed(() => props.state.result || null);
const mapVisible = computed(() => props.state.map_visible !== false);
const frames = computed(() => Array.isArray(result.value?.frames) ? result.value.frames : []);
const seasonDays = computed(() => Array.isArray(result.value?.season_overview?.days) ? result.value.season_overview.days : []);
const seasonStart = computed(() => seasonDays.value[0]?.date || "2025-10-01");
const seasonEnd = computed(() => seasonDays.value.at(-1)?.date || "2026-02-28");
const rangeSummary = computed(() => result.value?.range_summary || null);
const rangeLabel = computed(() => {
  const selected = result.value?.selected_range;
  if (!selected?.start) return "";
  return selected.start === selected.end ? selected.start : `${selected.start} 至 ${selected.end}`;
});
const activeFrame = computed(() => frames.value[activeIndex.value] || null);
const progress = computed(() => {
  const value = Number(task.value?.progress) || (task.value?.status === "succeeded" ? 100 : 0);
  return Math.min(100, Math.max(0, Math.round(value)));
});
const stageText = computed(() => ({
  queued: "任务已进入队列", download: "正在下载 GFS", prepare: "正在整理输入数据", backfill: "正在回算初始覆冰状态",
  predict: "正在生成覆冰预测", render: "正在渲染地图栅格", succeeded: "覆冰预测完成", failed: "任务失败", cancelled: "任务已取消",
})[task.value?.stage] || ({ queued: "任务已进入队列", running: "正在执行覆冰预测", succeeded: "覆冰预测完成", failed: "任务失败", cancelled: "任务已取消" })[task.value?.status] || "正在读取覆冰任务");
const maxThickness = computed(() => {
  const values = frames.value.map(frame => Number(frame?.max_net_ice_thickness_mm)).filter(Number.isFinite);
  return values.length ? Math.max(...values).toFixed(2) : "--";
});
const legendGradient = computed(() => {
  const colors = result.value?.colorbar?.colors;
  return Array.isArray(colors) && colors.length ? `linear-gradient(90deg, ${colors.join(",")})` : "linear-gradient(90deg,#2563eb,#06b6d4,#22c55e,#facc15,#f97316,#dc2626)";
});

function persist() { props.state.updated_at = Date.now(); emit("change"); }
function formatTime(value) {
  const raw = String(value || "");
  const date = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
  if (Number.isNaN(date.getTime())) return raw || "--";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}
function selectFrame(index) { activeIndex.value = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, frames.value.length - 1)); }
function move(delta) { playing.value = false; selectFrame(activeIndex.value + delta); }
function schedulePoll(delay = 1500) { clearTimeout(pollTimer); if (props.state.run_id) pollTimer = setTimeout(poll, delay); }
function requestedRange() {
  const selected = props.state.requested_range;
  return selected?.start && selected?.end ? selected : null;
}
function syncRangeControls(view) {
  const selected = view?.selected_range || requestedRange();
  if (selected?.start && selected?.end) {
    rangeStart.value = selected.start;
    rangeEnd.value = selected.end;
    selectedDate.value = selected.start === selected.end ? selected.start : "";
    return;
  }
  if (seasonDays.value.length) {
    selectedDate.value = seasonDays.value[0]?.date || "";
    rangeStart.value = seasonStart.value;
    rangeEnd.value = seasonEnd.value;
  }
}
async function loadModelResult() {
  const selected = requestedRange();
  // The winter-view endpoint deliberately accepts only the fixed 2025
  // archive.  User-requested historical replays expose their frames via the
  // generic result endpoint instead.
  if (!props.state.winterArchive) return getModelRunResult(props.state.run_id);
  return selected ? getWinterIcingView(props.state.run_id, selected.start, selected.end) : getModelRunResult(props.state.run_id);
}
async function poll() {
  if (!props.state.run_id) return;
  try {
    task.value = await getModelRun(props.state.run_id);
    if (task.value.status === "succeeded" && mapVisible.value) {
      props.state.result = await loadModelResult();
      syncRangeControls(props.state.result);
      activeIndex.value = 0;
      playing.value = true;
      persist();
      await nextTick();
      mapRef.value?.flyTo(props.state.result?.extent);
    } else if (!['succeeded', 'failed', 'cancelled'].includes(task.value.status)) schedulePoll();
  } catch (reason) { error.value = reason.message || "覆冰任务状态读取失败"; schedulePoll(3000); }
}
async function loadSeasonDay() {
  if (!props.state.run_id || !selectedDate.value) return;
  rangeStart.value = selectedDate.value;
  rangeEnd.value = selectedDate.value;
  await loadSeasonRange();
}
async function loadSeasonRange() {
  if (!props.state.run_id || !rangeStart.value || !rangeEnd.value) return;
  if (rangeEnd.value < rangeStart.value) { error.value = "结束日期不能早于开始日期。"; return; }
  try {
    props.state.result = await getWinterIcingView(props.state.run_id, rangeStart.value, rangeEnd.value);
    props.state.requested_range = { start: rangeStart.value, end: rangeEnd.value };
    activeIndex.value = 0;
    playing.value = true;
    persist();
  } catch (reason) { error.value = reason.message || "覆冰时段结果读取失败"; }
}
async function loadGrid() {
  const url = activeFrame.value?.grid_url;
  grid.value = [];
  if (!url) return;
  try { const points = await getIcingGrid(url); if (activeFrame.value?.grid_url === url) grid.value = points; } catch { grid.value = []; }
}
function openModelPage() { router.push({ path: "/model", query: { run_id: props.state.run_id } }); }

watch(playing, value => { clearInterval(playTimer); if (value && frames.value.length > 1) playTimer = setInterval(() => selectFrame((activeIndex.value + 1) % frames.value.length), 900); });
watch(activeIndex, loadGrid);
watch(() => props.expanded, value => { if (value) nextTick(() => mapRef.value?.flyTo(result.value?.extent)); });
watch(mapVisible, async value => {
  if (value && task.value?.status === "succeeded" && !result.value) await poll();
});
onMounted(async () => { syncRangeControls(result.value); await poll(); if (result.value) { await loadGrid(); nextTick(() => mapRef.value?.flyTo(result.value?.extent)); } });
onBeforeUnmount(() => { clearTimeout(pollTimer); clearInterval(playTimer); });
</script>

<style scoped>
.icing-model-card { width: min(760px, 72vw); margin-top: 10px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--panel) 92%, transparent); }
.icing-model-card.expanded { width: min(1180px, 94vw); margin: 0 auto; }
.card-head, .head-actions, .run-line, .play-controls { display: flex; align-items: center; }
.card-head { justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
.card-head > div:first-child { display: grid; gap: 2px; }.card-head b { color: var(--text); font-size: 13px; }.card-head span, small { color: var(--muted); font-size: 10px; }.head-actions { gap: 6px; }
.ghost-btn, .play-controls button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text); cursor: pointer; font: inherit; font-size: 10px; }
.run-body, .map-collapsed { padding: 12px 13px; }.map-collapsed { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 11px; }.run-line { gap: 9px; }.run-line div { display: grid; flex: 1; gap: 2px; }.run-line em { color: var(--accent); font-size: 11px; font-style: normal; font-weight: 700; }
.pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }.pulse.failed { background: #ef4444; }.pulse.succeeded { background: #22c55e; }
.progress { height: 4px; margin-top: 9px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--muted) 20%, transparent); }.progress i { display: block; height: 100%; background: var(--accent); transition: width .25s; }.error { margin: 8px 0 0; color: #ef4444; font-size: 10px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; padding: 10px 12px; }.summary-grid div { display: grid; gap: 3px; padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--panel) 80%, var(--accent) 5%); }.summary-grid span { color: var(--muted); font-size: 9px; }.summary-grid b { color: var(--text); font-size: 13px; }
.season-picker { display: grid; gap: 6px; padding: 10px 12px; color: var(--muted); font-size: 10px; }.season-picker b { color: var(--text); }.season-picker select, .range-controls input { max-width: 280px; padding: 5px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--panel); }.range-controls { display: flex; align-items: end; flex-wrap: wrap; gap: 7px; }.range-controls label { display: grid; gap: 3px; color: var(--muted); }.range-controls input { max-width: none; }.range-summary { margin: 0 12px 7px; padding: 7px 8px; border-radius: 7px; background: color-mix(in srgb, var(--accent) 8%, var(--panel)); color: var(--muted); font-size: 10px; }
.map-wrap { position: relative; height: 330px; }.expanded .map-wrap { height: min(62vh, 620px); }.map-wrap :deep(.projmap) { width: 100%; height: 100%; }.map-state { position: absolute; right: 10px; bottom: 9px; z-index: 5; padding: 5px 8px; border-radius: 7px; background: rgba(12,18,30,.78); color: #fff; font-size: 10px; pointer-events: none; }.demo-line-note { position: absolute; left: 10px; bottom: 9px; z-index: 5; padding: 5px 8px; border-radius: 7px; background: rgba(12,18,30,.78); color: #dbeafe; font-size: 10px; pointer-events: none; }
.icing-legend { display: grid; grid-template-columns: auto minmax(180px,1fr) auto; align-items: center; gap: 9px; padding: 8px 12px 1px; color: var(--muted); font-size: 9px; }.icing-legend div { height: 8px; border-radius: 3px; }
.play-controls { gap: 6px; padding: 8px 12px 2px; }.play-controls button:disabled { cursor: default; opacity: .4; }.play-controls .play-btn { border-color: var(--accent); color: var(--accent); }.play-controls span { margin-left: auto; color: var(--muted); font-size: 10px; }
@media (max-width: 900px) { .icing-model-card { width: 100%; }.map-wrap, .expanded .map-wrap { height: 300px; }.summary-grid { grid-template-columns: 1fr; }.head-actions { flex-wrap: wrap; justify-content: flex-end; } }
</style>
