<template>
  <LayerCard :badge="label" :file="resolvedFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <template v-if="products.length">
      <label class="lc-row">
        <span>产品</span>
        <select v-model="selectedProductKey">
          <option v-for="product in products" :key="product.key" :value="product.key">{{ product.label }}</option>
        </select>
      </label>
      <label class="lc-row">
        <span>高度层</span>
        <select v-model="selectedLevelKey">
          <option v-for="levelItem in currentLevels" :key="levelItem.key" :value="levelItem.key">{{ levelItem.label }}</option>
        </select>
      </label>
    </template>
    <p v-if="error" class="lc-error">{{ error }}</p>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: String,
  file: String,
  parsed: { type: Object, default: null },
  timeIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded", "variable-change"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const selectedLevelKey = ref("");
let timer = null;
let zoomedKey = "";
let requestId = 0;

const products = computed(() => display.value?.products ?? []);
const frames = computed(() => Array.isArray(display.value?.frames) ? display.value.frames : []);
const currentFrame = computed(() => display.value?.frame || frames.value[clampedTimeIndex()] || frames.value[0] || null);
const currentProduct = computed(() => products.value.find((item) => item.key === selectedProductKey.value) ?? products.value[0] ?? null);
const currentLevels = computed(() => sampleHeightLevels(currentProduct.value?.levels ?? []));
const currentLevel = computed(() => currentLevels.value.find((item) => item.key === selectedLevelKey.value) ?? currentLevels.value[0] ?? null);
const weatherInfo = computed(() => currentFrame.value?.weather_info || display.value?.weather_info || display.value?.meta_json?.weather_info || {});
const resolvedFile = computed(() => currentFrame.value?.file || weatherInfo.value.file || props.file || "");
const imageUrl = computed(() => props.src || currentLevel.value?.webp_url || currentLevel.value?.webp || currentFrame.value?.webp_url || currentFrame.value?.webp || display.value?.webp_url || display.value?.webp || "");
const imageExtent = computed(() => props.extent || currentLevel.value?.extent || currentProduct.value?.extent || currentFrame.value?.extent || display.value?.extent || display.value?.meta_json?.extent || [73, 15, 135, 55]);
const legendTitle = computed(() => {
  return currentProduct.value?.legend?.title || currentProduct.value?.label || weatherInfo.value.unit || "Radar";
});
const statusText = computed(() => {
  if (error.value) return error.value;
  if (display.value?.display_error) return `雷达图层生成失败：${display.value.display_error}`;
  const items = [weatherInfo.value.time, currentLevel.value?.label].filter(Boolean);
  return items.length ? items.join(" · ") : weatherInfo.value.level || "";
});

const reflectivityColors = ["#04e9e7", "#019ff4", "#0300f4", "#02fd02", "#fdf802", "#fd9500", "#fd0000", "#bc0000", "#f800fd"];
const velocityColors = ["#313695", "#4575b4", "#74add1", "#abd9e9", "#f5f5f5", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"];
const legendColors = computed(() => {
  const colors = currentProduct.value?.legend?.colors;
  if (Array.isArray(colors) && colors.length) return colors;
  return currentProduct.value?.code === "VRAD" ? velocityColors : reflectivityColors;
});
const gradient = computed(() => `linear-gradient(to right, ${legendColors.value.join(",")})`);
const ticks = computed(() => {
  const values = currentProduct.value?.legend?.ticks;
  if (Array.isArray(values) && values.length) return values;
  return currentProduct.value?.code === "VRAD"
    ? ["-30", "-20", "-10", "0", "10", "20", "30"]
    : ["0", "10", "20", "30", "40", "50", "60", "70"];
});

function clampedTimeIndex() {
  if (!frames.value.length) return 0;
  return Math.min(Math.max(Number(props.timeIndex) || 0, 0), frames.value.length - 1);
}

function syncSelection() {
  if (!products.value.length) {
    selectedProductKey.value = "";
    selectedLevelKey.value = "";
    return;
  }
  if (!products.value.some((item) => item.key === selectedProductKey.value)) {
    selectedProductKey.value = products.value[0].key;
  }
  const levels = currentLevels.value;
  if (levels.length && !levels.some((item) => item.key === selectedLevelKey.value)) {
    selectedLevelKey.value = levels[0].key;
  }
}

function sampleHeightLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) return [];
  const keep = new Set();
  const add = (level) => {
    if (level?.key) keep.add(level.key);
  };
  const heightLevels = levels.filter((level) => level?.mode === "single_level" || /^level-\d+$/.test(String(level?.key || "")));
  levels.forEach((level) => {
    if (level?.key === "max" || level?.mode === "vertical_max") add(level);
  });
  if (heightLevels.length) {
    heightLevels.forEach((level, index) => {
      if (index % 5 === 0) add(level);
    });
    add(heightLevels[heightLevels.length - 1]);
  } else if (!keep.size) {
    levels.forEach(add);
  }
  return levels.filter((level) => keep.has(level.key));
}

function apiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || String(path).startsWith("data:")) return path;
  return new URL(path, `${API_BASE}/`).toString();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? "";
  return Math.abs(numeric) >= 100 ? numeric.toFixed(0) : numeric.toFixed(2);
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function formatResolution(info, spatial) {
  if (info.resolution) return info.resolution;
  const lon = Number(spatial?.resolution_lon);
  const lat = Number(spatial?.resolution_lat);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    return `${lon.toFixed(4)}° x ${lat.toFixed(4)}°`;
  }
  return "";
}

function formatStationSummary(stations) {
  if (!Array.isArray(stations) || !stations.length) return "";
  const names = stations.map((station) => station?.name).filter(Boolean);
  return names.length ? `${stations.length} 个：${names.join("、")}` : `${stations.length} 个站点`;
}

function productDescription(product) {
  const zh = product?.description || product?.element_desc_zh || "";
  const en = product?.description_en || product?.element_desc_en || "";
  return [zh, en].filter(Boolean).join("\n");
}

function clearImageryLayer() {
  surface?.clear();
}

function applyImageryLayer() {
  const url = apiUrl(imageUrl.value);
  const extent = imageExtent.value;
  if (!url || !Array.isArray(extent) || extent.length !== 4) {
    clearImageryLayer();
    return;
  }

  surface?.setData(url, extent, 1);
  zoomToData(extent);
}

function zoomToData(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return;
  const [west, south, east, north] = extent.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value)) || west >= east || south >= north) return;
  const key = extent.join(",");
  if (key === zoomedKey) return;
  zoomedKey = key;
  const dx = Math.max((east - west) * 0.3, 0.05);
  const dy = Math.max((north - south) * 0.3, 0.05);
  flyToExtent?.([west - dx, south - dy, east + dx, north + dy]);
}

function buildPanelMeta() {
  const meta = display.value?.meta_json || {};
  const frame = currentFrame.value || {};
  const info = { ...(display.value?.weather_info || {}), ...(meta.weather_info || {}), ...(frame.weather_info || {}) };
  const spatial = meta.spatial || {};
  const timeDetail = meta.time_detail || {};
  const formatSpecific = meta.format_specific || {};
  const radarExtra = meta.extra?.radar || {};
  const stations = radarExtra.stations || formatSpecific.stations || [];
  const selectedInfo = {
    ...info,
    file: frame.file || info.file,
    element: currentProduct.value?.label || info.element,
    level: currentLevel.value?.label || info.level,
    unit: currentProduct.value?.unit || info.unit,
    element_desc_zh: currentProduct.value?.description || info.element_desc_zh,
    element_desc_en: currentProduct.value?.description_en || info.element_desc_en,
    status: statusText.value || info.status,
  };

  return {
    ...meta,
    file: frame.file || meta.file,
    source_file: frame.source_file || meta.source_file,
    business_type: "Radar",
    data_type: "Radar",
    weather_info: selectedInfo,
    extraRows: [
      ["radarName", "雷达名称", firstValue(radarExtra.radar_name, formatSpecific.radar_name)],
      ["radarType", "雷达类型", firstValue(radarExtra.radar_type, formatSpecific.radar_type)],
      ["product", "产品", firstValue(info.product, currentProduct.value?.label)],
      ["productDescription", "产品说明", productDescription(currentProduct.value)],
      ["timeResolution", "时间分辨率", formatSeconds(timeDetail.step_seconds)],
      ["steps", "时次数", firstValue(info.step_count, info.steps)],
      ["resolution", "空间分辨率", formatResolution(info, spatial)],
      ["validGrid", "有效格点", firstValue(info.valid_grid, info.validGrid)],
      ["coverage", "覆盖率", info.coverage],
      ["max", "最大值", formatNumber(info.max)],
      ["mean", "平均值", formatNumber(info.mean)],
      ["min", "最小值", formatNumber(info.min)],
      ["quality", "质量", info.quality],
      ["alert", "预警", info.alert],
      ["updatedAt", "更新时间", firstValue(info.updated_at, info.update)],
      ["stations", "雷达站", formatStationSummary(stations)],
      ["variables", "产品数量", firstValue(info.variable_count, info.variables, info.vars)],
      ["levelCount", "高度层数", Array.isArray(meta.levels) && meta.levels.length ? `${meta.levels.length} 层` : ""],
    ],
  };
}

function emitDisplayLoaded() {
  if (!display.value) return;
  const payload = {
    ...display.value,
    meta: buildPanelMeta(),
    file: resolvedFile.value,
    product: currentProduct.value,
    level: currentLevel.value,
    element_desc_zh: currentProduct.value?.description || "",
    element_desc_en: currentProduct.value?.description_en || "",
    image_url: apiUrl(imageUrl.value),
    webp_url: apiUrl(imageUrl.value),
    extent: imageExtent.value,
    variables: products.value,
  };
  emit("variable-change", payload);
  emit("display-loaded", payload);
}

async function loadRadarDisplay() {
  const currentRequest = ++requestId;
  try {
    const params = new URLSearchParams();
    params.set("time_index", String(props.timeIndex || 0));
    const response = await fetch(`${API_BASE}/api/display/RADAR?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "雷达图层数据读取失败");
    }
    if (currentRequest !== requestId) return;
    display.value = payload.data;
    error.value = "";
    syncSelection();
    applyImageryLayer();
    emitDisplayLoaded();
  } catch (err) {
    if (currentRequest !== requestId) return;
    error.value = "雷达数据未加载";
    clearImageryLayer();
    console.error(err);
  }
}

onMounted(() => {
  loadRadarDisplay();
  timer = window.setInterval(loadRadarDisplay, 30000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  clearImageryLayer();
});

watch(products, syncSelection);
watch(selectedProductKey, syncSelection);
watch(() => props.parsed, () => loadRadarDisplay());
watch(() => props.timeIndex, () => loadRadarDisplay());
watch(
  () => [selectedProductKey.value, selectedLevelKey.value, imageUrl.value, JSON.stringify(imageExtent.value), display.value?.display_error],
  () => {
    applyImageryLayer();
    emitDisplayLoaded();
  },
);
</script>

<style scoped>
.lc-error {
  margin: 0;
  padding: 7px 9px;
  color: #dc2626;
  font-size: 11px;
  line-height: 1.4;
}
</style>
