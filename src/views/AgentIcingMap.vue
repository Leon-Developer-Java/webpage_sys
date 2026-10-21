<template>
  <section class="icing-map" aria-label="对话覆冰地图">
    <header>
      <strong>覆冰地图</strong>
      <span v-if="selectedRange">查询日期 {{ selectedRange.start }} 至 {{ selectedRange.end }}</span>
      <button type="button" :disabled="loading" @click="loadResult">重新加载</button>
    </header>
    <div v-if="loading" class="message" role="status">正在读取覆冰结果…</div>
    <div v-else-if="error" class="message error" role="alert">{{ error }}</div>
    <template v-else-if="frames.length">
      <div class="map-wrap">
        <ProjMap ref="map" projection="等经纬" basemap="矢量底图" :grid="true" :vector="true" :dark="dark">
          <WebglLayer v-if="activeFrame?.raster_url" :key="activeFrame.raster_url" :src="activeFrame.raster_url" :extent="result.extent" />
          <IcingPointLayer :points="grid" />
        </ProjMap>
        <div class="map-state">{{ activeFrame?.active_grid_cells || 0 }} 个覆冰网格 · 最大净冰厚 {{ activeFrame?.max_net_ice_thickness_mm ?? '--' }} mm</div>
      </div>
      <p v-if="gridError" class="grid-error" role="alert">{{ gridError }}</p>
      <div class="legend">
        <span>净冰厚（{{ result.colorbar?.unit || 'mm' }}）</span>
        <div class="legend-scale">
          <div class="colors" :style="{ background: legendGradient }"></div>
          <div class="ticks"><span v-for="(tick, index) in legendTicks" :key="index">{{ tick }}</span></div>
        </div>
      </div>
      <div class="controls">
        <button type="button" :disabled="activeIndex === 0" @click="move(-1)">上一时次</button>
        <button type="button" :disabled="frames.length < 2" @click="playing = !playing">{{ playing ? '暂停' : '播放' }}</button>
        <button type="button" :disabled="activeIndex === frames.length - 1" @click="move(1)">下一时次</button>
        <span>第 {{ activeIndex + 1 }}/{{ frames.length }} 帧 · {{ activeTime }}（北京时间）</span>
      </div>
      <ForecastTimeline :frames="frames" :active="activeIndex" :start-time="frames[0]?.valid_time" @update:active="seek" />
    </template>
    <div v-else class="message" role="status">该时段暂无可展示的覆冰时次。</div>
  </section>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getIcingGrid, getModelRunResult, getWinterIcingView } from "../api.js";
import ForecastTimeline from "../components/ForecastTimeline.vue";
import IcingPointLayer from "../components/IcingPointLayer.vue";
import ProjMap from "../components/ProjMap.vue";
import WebglLayer from "../components/WebglLayer.vue";

const route = useRoute();
const dark = inject("theme", ref(true));
const result = ref(null);
const map = ref(null);
const grid = ref([]);
const loading = ref(false);
const error = ref("");
const gridError = ref("");
const activeIndex = ref(0);
const playing = ref(false);
let loadVersion = 0;
let gridVersion = 0;
let playTimer = null;

function utcTime(value) {
  const text = String(value || "");
  return text && !/(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? `${text}Z` : text;
}
const frames = computed(() => (result.value?.frames || []).map(frame => ({ ...frame, valid_time: utcTime(frame.valid_time) })));
const activeFrame = computed(() => frames.value[activeIndex.value]);
const selectedRange = computed(() => result.value?.selected_range);
const activeTime = computed(() => {
  const date = new Date(activeFrame.value?.valid_time || "");
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
});
const legendGradient = computed(() => `linear-gradient(90deg, ${(result.value?.colorbar?.colors || ["#2563eb", "#06b6d4", "#22c55e", "#facc15", "#f97316", "#dc2626"]).join(",")})`);
const legendTicks = computed(() => {
  const ticks = result.value?.colorbar?.ticks || [0, 3, 6, 9, 12, 15];
  return ticks.map((tick, index) => index === ticks.length - 1 ? result.value?.colorbar?.overflow_label || tick : tick);
});

async function loadResult() {
  const version = ++loadVersion;
  playing.value = false;
  loading.value = true;
  error.value = "";
  result.value = null;
  grid.value = [];
  activeIndex.value = 0;
  const runId = String(route.query.run_id || "").trim();
  try {
    if (!runId) throw new Error("缺少覆冰任务编号，请从对话结果重新打开地图。");
    const start = String(route.query.start_date || "");
    const end = String(route.query.end_date || "");
    let view = route.query.archive_id && start && end
      ? await getWinterIcingView(runId, start, end)
      : await getModelRunResult(runId);
    if (!view.frames?.length && view.archive_id && view.season_overview?.days?.length) {
      const days = view.season_overview.days;
      view = await getWinterIcingView(runId, days[0].date, days.at(-1).date);
    }
    if (version !== loadVersion) return;
    result.value = view;
  } catch (cause) {
    if (version === loadVersion) error.value = cause.message || "覆冰结果读取失败";
  } finally {
    if (version === loadVersion) loading.value = false;
  }
  if (version === loadVersion) {
    await nextTick();
    map.value?.flyTo(result.value?.extent);
  }
}

async function loadGrid(url) {
  const version = ++gridVersion;
  grid.value = [];
  gridError.value = "";
  if (!url) return;
  try {
    const points = await getIcingGrid(url);
    if (version === gridVersion) grid.value = points;
  } catch (cause) {
    if (version === gridVersion) gridError.value = cause.message || "覆冰格点读取失败";
  }
}
function seek(index) {
  playing.value = false;
  activeIndex.value = Math.max(0, Math.min(frames.value.length - 1, Number(index) || 0));
}
function move(delta) { seek(activeIndex.value + delta); }
watch(() => activeFrame.value?.grid_url, loadGrid);
watch(playing, value => {
  clearInterval(playTimer);
  if (value) playTimer = setInterval(() => { activeIndex.value = (activeIndex.value + 1) % frames.value.length; }, 900);
});
watch(() => route.fullPath, loadResult, { immediate: true });
onBeforeUnmount(() => { ++loadVersion; ++gridVersion; clearInterval(playTimer); });
</script>

<style scoped>
.icing-map { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; overflow: hidden; background: var(--bg); }
header, .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; font-size: 12px; }
header { border-bottom: 1px solid var(--border); }
header span, .controls span { color: var(--muted); }
header button { margin-left: auto; }
button { border: 1px solid var(--border); border-radius: 6px; background: var(--field); color: var(--text); padding: 5px 9px; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
.map-wrap { position: relative; flex: 1; min-height: 180px; }
.map-wrap :deep(.projmap) { width: 100%; height: 100%; }
.map-state { position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 20px); padding: 5px 8px; border-radius: 6px; background: rgba(13,22,35,.85); color: #fff; font-size: 11px; pointer-events: none; }
.legend { display: flex; align-items: center; gap: 12px; padding: 8px 12px 0; color: var(--muted); font-size: 11px; }
.legend-scale { flex: 1; min-width: 0; }.colors { height: 8px; border-radius: 3px; }.ticks { display: flex; justify-content: space-between; padding-top: 2px; }
.controls span { margin-left: auto; font-size: 11px; }.message { display: grid; flex: 1; place-content: center; padding: 20px; color: var(--muted); text-align: center; }
.error, .grid-error { color: #ef4444; }.grid-error { margin: 0; padding: 4px 12px; font-size: 11px; }
@media (max-width: 520px) { .controls span { width: 100%; margin-left: 0; } header span { order: 1; width: 100%; } }
</style>
