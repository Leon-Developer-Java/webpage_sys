<template>
  <section :class="['data-map-card', { expanded }]" :aria-label="`${displayTypeLabel} 对话内数据可视化`">
    <header class="card-head">
      <div>
        <b>{{ document?.title || `${displayTypeLabel} 数据可视化` }}</b>
        <span>{{ loading ? "正在读取展示数据" : name || fileUuid }}</span>
      </div>
      <div class="head-actions">
        <button type="button" class="ghost-btn" @click="expanded = !expanded">{{ expanded ? "恢复" : "展开" }}</button>
        <button type="button" class="ghost-btn" @click="$emit('close')">收起</button>
      </div>
    </header>

    <p v-if="error" class="viewer-state error">{{ error }}</p>
    <div v-else-if="!grid" class="run-body">
      <div class="run-line">
        <span class="pulse"></span>
        <div><b>正在加载地图</b><small>{{ name || fileUuid }}</small></div>
      </div>
      <div class="progress"><i></i></div>
    </div>

    <template v-else>
      <div class="summary-grid">
        <div><span>可用要素</span><b>{{ variables.length }}</b></div>
        <div><span>当前要素</span><b>{{ currentVariableName }}</b></div>
        <div><span>网格尺寸</span><b>{{ gridSize }}</b></div>
      </div>

      <div v-if="variables.length > 1 || resolutionOptions.length > 1" class="option-row">
        <label v-if="variables.length > 1">
          <span>要素</span>
          <select v-model="selectedVariable" :disabled="loading || !variables.length" @change="reloadDisplay">
            <option v-for="item in variables" :key="item.name" :value="item.name">{{ variableLabel(item) }}</option>
          </select>
        </label>
        <label v-if="resolutionOptions.length > 1">
          <span>分辨率</span>
          <select v-model="selectedResolution" :disabled="loading" @change="reloadDisplay">
            <option v-for="item in resolutionOptions" :key="item.key" :value="item.key" :disabled="item.playable === false">
              {{ item.label || item.key }}
            </option>
          </select>
        </label>
        <span v-if="loading" class="loading-label">正在更新地图…</span>
      </div>

      <div class="map-wrap">
        <ProjMap ref="mapRef" projection="等经纬" basemap="矢量底图" :grid="true" :vector="true" :dark="true">
          <WebglLayer v-if="imageUrl" :key="imageUrl" :src="imageUrl" :extent="extent" />
        </ProjMap>
        <div class="map-state">{{ currentTime || "单时次" }} · {{ selectedResolutionLabel }}</div>
      </div>

      <div class="data-legend">
        <span>{{ legendTitle }}</span>
        <div class="legend-colors"></div>
        <b>{{ displayUnit || "数值" }}</b>
        <div class="legend-labels"><i v-for="tick in legendTicks" :key="tick">{{ tick }}</i></div>
      </div>

      <div v-if="times.length > 1" class="play-controls">
        <button type="button" :disabled="loading || timeIndex <= 0" @click="move(-1)">上一时次</button>
        <button type="button" class="play-btn" :disabled="times.length < 2" @click="playing = !playing">{{ playing ? "暂停" : "播放" }}</button>
        <button type="button" :disabled="loading || timeIndex >= times.length - 1" @click="move(1)">下一时次</button>
        <span>第 {{ times.length ? timeIndex + 1 : 1 }}/{{ times.length || 1 }} 时次</span>
      </div>
      <ForecastTimeline
        v-if="timelineFrames.length > 1"
        :frames="timelineFrames"
        :active="timeIndex"
        :start-time="timelineFrames[0]?.valid_time || ''"
        @update:active="selectTime"
      />
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { authedFetch, getDisplayResource } from "../api";
import { loadDisplayDocument, registeredDisplayType } from "../agent-display-providers.js";
import ForecastTimeline from "./ForecastTimeline.vue";
import ProjMap from "./ProjMap.vue";
import WebglLayer from "./WebglLayer.vue";

const props = defineProps({
  fileUuid: { type: String, required: true },
  dataType: { type: String, required: true },
  name: { type: String, default: "" },
  initialExpanded: { type: Boolean, default: false },
});
defineEmits(["close"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const mapRef = ref(null);
const loading = ref(false);
const error = ref("");
const expanded = ref(props.initialExpanded);
const playing = ref(false);
const resource = ref(null);
const document = ref(null);
const selectedVariable = ref("");
const selectedResolution = ref("native");
const timeIndex = ref(0);
let requestId = 0;
let playTimer = null;

const displayTypeLabel = computed(() => ({ RADAR: "雷达", HIMAWARI: "葵花卫星", FY3: "风云三号" })[registeredDisplayType(props.dataType)] || registeredDisplayType(props.dataType) || props.dataType || "数据");
const variables = computed(() => document.value?.variables || []);
const resolutionOptions = computed(() => document.value?.resolutionOptions || [{ key: "native", label: "原始", playable: true }]);
const frames = computed(() => document.value?.frames || []);
const times = computed(() => document.value?.times || frames.value.map(frame => frame.valid_time));
const grid = computed(() => frames.value[Math.min(timeIndex.value, Math.max(0, frames.value.length - 1))] || frames.value[0] || null);
const extent = computed(() => Array.isArray(grid.value?.extent) && grid.value.extent.length === 4
  ? grid.value.extent.map(Number)
  : [73, 15, 135, 55]);
const imageUrl = computed(() => absoluteDataUrl(grid.value?.image_url || grid.value?.webp_url));
const currentTime = computed(() => timeValue(times.value[timeIndex.value]));
const timelineFrames = computed(() => times.value.map(item => ({ valid_time: timeValue(item), lead_minutes: 0 })));
const selectedResolutionLabel = computed(() => resolutionOptions.value.find(item => item.key === selectedResolution.value)?.label || selectedResolution.value);
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || null);
const currentVariableName = computed(() => currentVariable.value?.name_cn || currentVariable.value?.label || selectedVariable.value || "未提供");
const gridSize = computed(() => grid.value?.width && grid.value?.height ? `${grid.value.width} × ${grid.value.height}` : "未提供");
const displayUnit = computed(() => formatUnit(grid.value?.unit || currentVariable.value?.unit));
const legendTitle = computed(() => displayUnit.value ? `${currentVariableName.value} (${displayUnit.value})` : currentVariableName.value);
const legendTicks = computed(() => {
  const minimum = Number(grid.value?.scale_min ?? currentVariable.value?.stats?.min ?? grid.value?.min);
  const maximum = Number(grid.value?.scale_max ?? currentVariable.value?.stats?.max ?? grid.value?.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return ["低", "", "", "高"];
  return [minimum, minimum + (maximum - minimum) / 3, minimum + (maximum - minimum) * 2 / 3, maximum].map(formatTick);
});

function absoluteDataUrl(path) {
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : new URL(path, `${API_BASE}/`).toString();
}

function timeValue(item) {
  if (item && typeof item === "object") return item.label || item.time || item.valid_time || "";
  return String(item || "");
}

function formatUnit(value) {
  const text = String(value || "").trim();
  const known = { c: "℃", k: "K", pa: "Pa", "m/s": "m/s", "m s-1": "m/s" };
  return known[text.toLowerCase()] || (text === "1" ? "" : text);
}

function formatTick(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1000 || (absolute > 0 && absolute < 0.01)) return value.toExponential(1);
  return value.toFixed(absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2);
}

function variableLabel(item) {
  const label = item?.name_cn || item?.label || item?.description || item?.name || "未命名要素";
  return item?.name && label !== item.name ? `${label} (${item.name})` : label;
}

async function loadResource() {
  const type = registeredDisplayType(props.dataType);
  if (!type) {
    error.value = `当前对话窗口尚未接入 ${props.dataType || "该类型"} 可视化。`;
    return;
  }
  error.value = "";
  document.value = null;
  selectedVariable.value = "";
  selectedResolution.value = "native";
  timeIndex.value = 0;
  try {
    resource.value = await getDisplayResource(props.fileUuid);
    if (String(resource.value?.data_type || "").toUpperCase() !== type) {
      throw new Error("资源类型与对话引用不一致，未打开可视化。");
    }
    await loadDisplay();
  } catch (cause) {
    error.value = cause?.message || "系统可视化数据读取失败。";
  }
}

async function loadDisplay() {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const result = await loadDisplayDocument(resource.value, {
      variable: selectedVariable.value,
      resolution: selectedResolution.value,
      timeIndex: timeIndex.value,
    }, { fetch: authedFetch, apiBase: API_BASE });
    if (id !== requestId) return;
    document.value = result;
    selectedVariable.value = result.selectedVariable;
    selectedResolution.value = result.selectedResolution;
    timeIndex.value = Math.min(timeIndex.value, Math.max(0, result.times.length - 1));
    await nextTick();
    mapRef.value?.flyTo(extent.value);
  } catch (cause) {
    if (id === requestId) error.value = cause?.message || `${displayTypeLabel.value} 数据读取失败。`;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function reloadDisplay() {
  playing.value = false;
  timeIndex.value = 0;
  loadDisplay();
}

function selectTime(index) {
  const next = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, times.value.length - 1));
  if (next === timeIndex.value) return;
  timeIndex.value = next;
  loadDisplay();
}

function move(delta) {
  playing.value = false;
  selectTime(timeIndex.value + delta);
}

watch(playing, value => {
  clearInterval(playTimer);
  if (!value || times.value.length < 2) return;
  playTimer = setInterval(() => selectTime((timeIndex.value + 1) % times.value.length), 1200);
});
watch(expanded, value => { if (value) nextTick(() => mapRef.value?.flyTo(extent.value)); });
watch(() => [props.fileUuid, props.dataType], loadResource, { immediate: true });
onBeforeUnmount(() => clearInterval(playTimer));
</script>

<style scoped>
.data-map-card { position: relative; isolation: isolate; width: min(760px, 72vw); max-width: 100%; margin-top: 10px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--panel) 92%, transparent); }
.data-map-card.expanded { width: min(1180px, 94vw); margin: 10px auto 0; }
.card-head, .head-actions, .run-line, .play-controls { display: flex; align-items: center; }
.card-head { position: relative; z-index: 3; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); background: var(--panel); }
.card-head > div:first-child { display: grid; min-width: 0; gap: 2px; }
.card-head b { color: var(--text); font-size: 13px; }
.card-head span, small { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.head-actions { flex: 0 0 auto; gap: 6px; }
.ghost-btn, .play-controls button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text); cursor: pointer; font: inherit; font-size: 10px; }
.run-body { padding: 12px 13px; }
.run-line { gap: 9px; }
.run-line div { display: grid; flex: 1; gap: 2px; }
.pulse { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent); }
.progress { height: 4px; margin-top: 9px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--muted) 20%, transparent); }
.progress i { display: block; width: 55%; height: 100%; background: var(--accent); animation: loading 1.1s ease-in-out infinite alternate; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; padding: 10px 12px; }
.summary-grid div { display: grid; gap: 3px; min-width: 0; padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--panel) 80%, var(--accent) 5%); }
.summary-grid span { color: var(--muted); font-size: 9px; }
.summary-grid b { overflow: hidden; color: var(--text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.option-row { display: flex; align-items: end; gap: 10px; padding: 0 12px 10px; }
.option-row label { display: grid; min-width: 150px; gap: 4px; color: var(--muted); font-size: 9px; }
.option-row select { min-width: 0; padding: 5px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--text); font: inherit; font-size: 10px; }
.loading-label { margin-left: auto; color: var(--muted); font-size: 10px; }
.map-wrap { position: relative; z-index: 1; height: 330px; overflow: hidden; background: #07101e; }
.expanded .map-wrap { height: min(62vh, 620px); }
.map-wrap :deep(.projmap) { width: 100%; height: 100%; }
.map-state { position: absolute; right: 10px; bottom: 9px; z-index: 5; padding: 5px 8px; border-radius: 7px; background: rgba(12, 18, 30, .78); color: #fff; font-size: 10px; pointer-events: none; }
.data-legend { display: grid; grid-template-columns: auto minmax(180px, 1fr) auto; align-items: center; gap: 5px 9px; padding: 8px 12px 1px; color: var(--muted); font-size: 9px; }
.legend-colors { height: 8px; border-radius: 3px; background: linear-gradient(90deg, #1d4ed8, #0891b2, #16a34a, #facc15, #dc2626); }
.legend-labels { grid-column: 2; display: flex; justify-content: space-between; }
.legend-labels i { font-style: normal; }
.play-controls { gap: 6px; padding: 8px 12px 6px; }
.play-controls button:disabled { cursor: default; opacity: .4; }
.play-controls .play-btn { border-color: var(--accent); color: var(--accent); }
.play-controls span { margin-left: auto; color: var(--muted); font-size: 10px; }
.viewer-state { margin: 0; padding: 30px 12px; color: var(--muted); text-align: center; }
.error { color: #f87171; }
@keyframes loading { from { transform: translateX(-25%); } to { transform: translateX(110%); } }

@media (max-width: 900px) {
  .data-map-card, .data-map-card.expanded { width: 100%; margin-inline: 0; }
  .map-wrap, .expanded .map-wrap { height: 300px; }
  .summary-grid { grid-template-columns: 1fr; }
  .option-row { align-items: stretch; flex-direction: column; }
  .option-row label { min-width: 0; }
  .head-actions { flex-wrap: wrap; justify-content: flex-end; }
}
</style>
