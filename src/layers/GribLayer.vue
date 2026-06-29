<template>
  <WebglLayer :src="imageUrl" :extent="extent" />
  <LayerCard badge="GFS·ECMWF" file="053031.grib.png" legend-title="2m temperature (°C)" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import { inject, onMounted } from "vue";
import LayerCard from "../components/LayerCard.vue";
import WebglLayer from "../components/WebglLayer.vue";

// 成员2：GFS / ECMWF 数据层
// 后端负责生成 PNG + meta.json，本组件负责把 PNG 和 extent 传给 WebglLayer。

const BACKEND_BASE = "http://127.0.0.1:8002";

// 优先使用上传后台 wait_process 目录下的 GFS PNG。
// 若该路径无法访问，可改为：`${BACKEND_BASE}/data/GFS/053031.grib.png`
const imageUrl = `${BACKEND_BASE}/data/GFS/wait_process/053031.grib.png`;

// extent = [west, south, east, north]
const extent = [114, 27, 123, 35];
const gradient = "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";
const ticks = ["14", "20", "25", "30", "34"];

const flyToExtent = inject("flyToExtent", null);
onMounted(() => {
  const [w, s, e, n] = extent;
  const dx = Math.max((e - w) * 0.35, 0.5), dy = Math.max((n - s) * 0.35, 0.5);
  flyToExtent?.([w - dx, s - dy, e + dx, n + dy]);
});
</script>
<!--<template>-->
<!--  &lt;!&ndash; GFS / ECMWF 后端 PNG 叠加层 &ndash;&gt;-->
<!--  <WebglLayer :src="imageUrl" :extent="extent" />-->

<!--  &lt;!&ndash; GFS / ECMWF 图例与状态 &ndash;&gt;-->
<!--  <div class="layer-legend gfs-legend">-->
<!--    <div class="legend-head">-->
<!--      <div>-->
<!--        <b>GFS·ECMWF</b>-->
<!--        <small>{{ fileName }}</small>-->
<!--      </div>-->
<!--      <button @click="loadLatestGfs">刷新</button>-->
<!--    </div>-->

<!--    <div class="legend-status" :class="{ error: hasError }">-->
<!--      {{ statusText }}-->
<!--    </div>-->

<!--    <small>{{ legendTitle }}</small>-->
<!--    <div class="legend-bar" :style="{ background: gradient }"></div>-->
<!--    <ul>-->
<!--      <li v-for="t in ticks" :key="t">{{ t }}</li>-->
<!--    </ul>-->
<!--  </div>-->
<!--</template>-->

<!--<script setup>-->
<!--import { computed, onBeforeUnmount, onMounted, ref } from "vue";-->
<!--import WebglLayer from "../components/WebglLayer.vue";-->

<!--/*-->
<!--  成员2：GFS / ECMWF 数据层-->

<!--  只修改 src/layers/GribLayer.vue，不改公共框架。-->
<!--  本组件自己读取后端 /api/display/GFS，获取最新 png_url 和 extent。-->
<!--  这样前端上传并解析 GFS 后，本图层可以刷新到最新结果。-->
<!--*/-->

<!--const BACKEND_BASE = "http://127.0.0.1:8002";-->

<!--// 兜底 PNG：后端未启动或 display 接口暂时失败时仍能展示测试图层。-->
<!--const FALLBACK_IMAGE = `${BACKEND_BASE}/data/GFS/wait_process/053031.grib.png`;-->
<!--const FALLBACK_EXTENT = [114, 27, 123, 35];-->

<!--const imageUrl = ref(FALLBACK_IMAGE);-->
<!--const extent = ref(FALLBACK_EXTENT);-->

<!--const fileName = ref("等待 GFS 数据");-->
<!--const unit = ref("°C");-->
<!--const element = ref("2m temperature");-->
<!--const statusText = ref("正在读取最新 GFS 数据...");-->
<!--const hasError = ref(false);-->

<!--let timer = null;-->

<!--const legendTitle = computed(() => {-->
<!--  return `${element.value} (${unit.value})`;-->
<!--});-->

<!--const gradient = "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";-->
<!--const ticks = ["14", "20", "25", "30", "34"];-->

<!--function toFullUrl(url) {-->
<!--  if (!url) return FALLBACK_IMAGE;-->
<!--  return url.startsWith("http") ? url : `${BACKEND_BASE}${url}`;-->
<!--}-->

<!--function bboxToExtent(bbox) {-->
<!--  if (!bbox) return null;-->

<!--  const west = bbox.west;-->
<!--  const south = bbox.south;-->
<!--  const east = bbox.east;-->
<!--  const north = bbox.north;-->

<!--  if ([west, south, east, north].every(v => typeof v === "number")) {-->
<!--    return [west, south, east, north];-->
<!--  }-->

<!--  return null;-->
<!--}-->

<!--function normalizeExtent(data) {-->
<!--  const candidate =-->
<!--    data?.extent ||-->
<!--    data?.meta?.extent ||-->
<!--    data?.weather_info?.extent ||-->
<!--    data?.meta_json?.extent ||-->
<!--    data?.meta_json?.meta?.extent ||-->
<!--    bboxToExtent(data?.bbox) ||-->
<!--    bboxToExtent(data?.meta_json?.bbox);-->

<!--  if (Array.isArray(candidate) && candidate.length === 4) {-->
<!--    return candidate.map(Number);-->
<!--  }-->

<!--  return FALLBACK_EXTENT;-->
<!--}-->

<!--function normalizePngUrl(data) {-->
<!--  const candidate =-->
<!--    data?.png_url ||-->
<!--    data?.meta?.png_url ||-->
<!--    data?.weather_info?.png_url ||-->
<!--    data?.meta_json?.png_url ||-->
<!--    data?.meta_json?.meta?.png_url ||-->
<!--    (Array.isArray(data?.png_urls) ? data.png_urls[0] : "");-->

<!--  return toFullUrl(candidate);-->
<!--}-->

<!--function normalizeFileName(data) {-->
<!--  return (-->
<!--    data?.file_name ||-->
<!--    data?.meta?.file ||-->
<!--    data?.weather_info?.file ||-->
<!--    data?.source_file?.split(/[\\/]/).pop() ||-->
<!--    "GFS PNG"-->
<!--  );-->
<!--}-->

<!--async function loadLatestGfs() {-->
<!--  try {-->
<!--    const response = await fetch(`${BACKEND_BASE}/api/display/GFS?t=${Date.now()}`, {-->
<!--      method: "GET",-->
<!--      cache: "no-store"-->
<!--    });-->

<!--    if (!response.ok) {-->
<!--      throw new Error(`HTTP ${response.status}`);-->
<!--    }-->

<!--    const payload = await response.json();-->
<!--    const data = payload?.data || payload;-->

<!--    imageUrl.value = normalizePngUrl(data);-->
<!--    extent.value = normalizeExtent(data);-->
<!--    fileName.value = normalizeFileName(data);-->

<!--    const info = data?.weather_info || data?.meta || {};-->
<!--    element.value = info.element || info.mainVariableName || "GFS field";-->
<!--    unit.value = info.unit || info.displayUnit || "unknown";-->

<!--    statusText.value = "已加载后端最新 GFS 图层";-->
<!--    hasError.value = false;-->
<!--  } catch (error) {-->
<!--    console.warn("GFS display fetch failed:", error);-->

<!--    imageUrl.value = FALLBACK_IMAGE;-->
<!--    extent.value = FALLBACK_EXTENT;-->
<!--    fileName.value = "053031.grib.png";-->
<!--    element.value = "2m temperature";-->
<!--    unit.value = "°C";-->

<!--    statusText.value = "未能读取最新接口，当前显示本地测试 PNG";-->
<!--    hasError.value = true;-->
<!--  }-->
<!--}-->

<!--onMounted(() => {-->
<!--  loadLatestGfs();-->

<!--  // 上传并解析后，后端会更新最新 meta/png。-->
<!--  // 这里轮询刷新，避免改 Overview.vue。-->
<!--  timer = window.setInterval(loadLatestGfs, 5000);-->
<!--});-->

<!--onBeforeUnmount(() => {-->
<!--  if (timer) {-->
<!--    window.clearInterval(timer);-->
<!--  }-->
<!--});-->
<!--</script>-->

<!--<style scoped>-->
<!--.gfs-legend {-->
<!--  min-width: 190px;-->
<!--}-->

<!--.legend-head {-->
<!--  display: flex;-->
<!--  align-items: flex-start;-->
<!--  justify-content: space-between;-->
<!--  gap: 8px;-->
<!--  margin-bottom: 8px;-->
<!--}-->

<!--.legend-head b {-->
<!--  display: block;-->
<!--  font-size: 12px;-->
<!--  color: #f8fafc;-->
<!--}-->

<!--.legend-head small {-->
<!--  display: block;-->
<!--  margin-top: 3px;-->
<!--  max-width: 135px;-->
<!--  color: #cbd5e1;-->
<!--  font-size: 10px;-->
<!--  word-break: break-all;-->
<!--}-->

<!--.legend-head button {-->
<!--  border: none;-->
<!--  border-radius: 6px;-->
<!--  padding: 3px 8px;-->
<!--  color: #dbeafe;-->
<!--  background: rgba(59, 130, 246, 0.28);-->
<!--  cursor: pointer;-->
<!--}-->

<!--.legend-head button:hover {-->
<!--  background: rgba(59, 130, 246, 0.42);-->
<!--}-->

<!--.legend-status {-->
<!--  margin-bottom: 8px;-->
<!--  font-size: 10px;-->
<!--  color: #86efac;-->
<!--}-->

<!--.legend-status.error {-->
<!--  color: #fca5a5;-->
<!--}-->
<!--</style>-->
