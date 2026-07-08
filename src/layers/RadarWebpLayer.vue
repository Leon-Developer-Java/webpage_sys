<template>
  <LayerCard
    class="radar-layer-card"
    :badge="label"
    :file="resolvedFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
  >
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
  <div v-if="stationMarkers.length" class="radar-stations" aria-hidden="true">
    <span
      v-for="station in stationMarkers"
      :key="station.key"
      class="radar-station"
      :style="{ left: `${station.x}px`, top: `${station.y}px` }"
      :title="station.name"
    ></span>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import { withToken } from "../api";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: String,
  file: String,
  parsed: { type: Object, default: null },
  timeIndex: { type: Number, default: 0 },
  variantIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded", "variable-change"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const PRELOAD_FRAME_COUNT = 5;
const CACHE_BEHIND = 1;
const CACHE_AHEAD = 3;
const REFRESH_INTERVAL_MS = 30000;
const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const mapProjector = inject("mapProjector", null);
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const selectedLevelKey = ref("");
let timer = null;
let zoomedKey = "";
let requestId = 0;
const frameCache = new Map();
const pendingFrames = new Map();
const imageCache = new Map();
let wantedFrameIndices = new Set();
let appliedLayerKey = "";

const products = computed(() => display.value?.products ?? []);
const frames = computed(() => Array.isArray(display.value?.frames) ? display.value.frames : []);
const frameCount = computed(() => {
  const count = Number(display.value?.frame_count);
  if (Number.isFinite(count) && count > 0) return Math.floor(count);
  return frames.value.length;
});
const currentFrame = computed(() => display.value?.frame || frames.value[clampedTimeIndex()] || frames.value[0] || null);
const currentProduct = computed(() => products.value.find((item) => item.key === selectedProductKey.value) ?? products.value[0] ?? null);
const currentLevels = computed(() => sampleHeightLevels(currentProduct.value?.levels ?? []));
const currentLevel = computed(() => currentLevels.value.find((item) => item.key === selectedLevelKey.value) ?? currentLevels.value[0] ?? null);
const weatherInfo = computed(() => currentFrame.value?.weather_info || display.value?.weather_info || display.value?.meta_json?.weather_info || {});
const resolvedFile = computed(() => currentFrame.value?.file || weatherInfo.value.file || props.file || "");
const imageUrl = computed(() => props.src || currentLevel.value?.webp_url || currentLevel.value?.webp || currentFrame.value?.webp_url || currentFrame.value?.webp || display.value?.webp_url || display.value?.webp || "");
const imageExtent = computed(() => props.extent || currentLevel.value?.extent || currentProduct.value?.extent || currentFrame.value?.extent || display.value?.extent || display.value?.meta_json?.extent || [73, 15, 135, 55]);
const stationSource = computed(() => {
  const meta = display.value?.meta_json || {};
  const radarExtra = meta.extra?.radar || {};
  const formatSpecific = meta.format_specific || {};
  const stations = radarExtra.stations || formatSpecific.stations || weatherInfo.value?.stations || [];
  return Array.isArray(stations) ? stations : [];
});
const stationMarkers = computed(() => {
  const projectorState = mapProjector?.state?.value;
  if (projectorState) {
    projectorState.rev;
    projectorState.width;
    projectorState.height;
  }
  if (!mapProjector?.project) return [];
  return stationSource.value
    .map((station, index) => {
      const lon = Number(station?.longitude ?? station?.lon ?? station?.x);
      const lat = Number(station?.latitude ?? station?.lat ?? station?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const point = mapProjector.project(lon, lat);
      if (!point?.visible) return null;
      return {
        key: station?.id || station?.code || station?.name || `${lon},${lat},${index}`,
        name: station?.name || station?.code || "Radar station",
        x: Math.round(point.x),
        y: Math.round(point.y),
      };
    })
    .filter(Boolean);
});
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

function clampedTimeIndex(index = props.timeIndex) {
  const numeric = Number(index);
  const next = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  const count = frameCount.value || frames.value.length;
  if (!count) return Math.max(0, next);
  return Math.min(Math.max(next, 0), count - 1);
}

let variantApplied = false;
function syncSelection() {
  if (!products.value.length) {
    selectedProductKey.value = "";
    selectedLevelKey.value = "";
    return;
  }
  if (!products.value.some((item) => item.key === selectedProductKey.value)) {
    if (!variantApplied && props.variantIndex > 0 && products.value.length > 1) {
      selectedProductKey.value = products.value[props.variantIndex % products.value.length].key;
      variantApplied = true;
    } else {
      selectedProductKey.value = products.value[0].key;
    }
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

function resolvedImageUrl(path) {
  const url = apiUrl(path);
  return url ? withToken(url) : "";
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
  appliedLayerKey = "";
  surface?.clear();
}

function applyImageryLayer() {
  const url = apiUrl(imageUrl.value);
  const extent = imageExtent.value;
  if (!url || !Array.isArray(extent) || extent.length !== 4) {
    clearImageryLayer();
    return;
  }

  const layerKey = `${resolvedImageUrl(imageUrl.value)}|${extent.join(",")}`;
  if (layerKey === appliedLayerKey) return;
  appliedLayerKey = layerKey;
  const image = preloadedImageSource(imageUrl.value);
  surface?.setData(url, extent, 1, image ? { image } : {});
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

function frameIndexFromPayload(data, fallbackIndex) {
  const index = Number(data?.frame?.index);
  if (Number.isFinite(index)) return clampedTimeIndex(index);
  return clampedTimeIndex(fallbackIndex);
}

function payloadImageUrl(data) {
  if (!data) return "";
  const payloadProducts = Array.isArray(data.products) ? data.products : [];
  const product = payloadProducts.find((item) => item.key === selectedProductKey.value) ?? payloadProducts[0] ?? null;
  const levels = sampleHeightLevels(product?.levels ?? []);
  const level = levels.find((item) => item.key === selectedLevelKey.value) ?? levels[0] ?? null;
  const frame = data.frame || (Array.isArray(data.frames) ? data.frames[clampedTimeIndex()] : null);
  return props.src || level?.webp_url || level?.webp || frame?.webp_url || frame?.webp || data.webp_url || data.webp || "";
}

function cachePayload(index, data) {
  const item = {
    data,
    at: Date.now(),
  };
  frameCache.set(index, item);
  return item;
}

function preloadImage(url) {
  const resolved = resolvedImageUrl(url);
  if (!resolved) return Promise.resolve("");
  const cached = imageCache.get(resolved);
  if (cached) return cached.promise;

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const entry = { image, loaded: false, promise: null };
  const promise = new Promise((resolve, reject) => {
    image.onload = () => {
      entry.loaded = true;
      resolve(resolved);
    };
    image.onerror = () => reject(new Error(`Radar image preload failed: ${resolved}`));
  });
  entry.promise = promise.catch(() => "");
  imageCache.set(resolved, entry);
  image.src = resolved;
  return entry.promise;
}

function preloadedImageSource(url) {
  const cached = imageCache.get(resolvedImageUrl(url));
  if (!cached?.loaded || !cached.image?.complete || !cached.image.naturalWidth) return null;
  return cached.image;
}

function releaseImage(url) {
  const resolved = resolvedImageUrl(url);
  const cached = imageCache.get(resolved);
  if (!cached) return;
  cached.image.onload = null;
  cached.image.onerror = null;
  cached.image.src = "";
  imageCache.delete(resolved);
}

function clearImageCache() {
  imageCache.forEach(({ image }) => {
    image.onload = null;
    image.onerror = null;
    image.src = "";
  });
  imageCache.clear();
}

function preloadCachedImages() {
  frameCache.forEach(({ data }) => {
    preloadImage(payloadImageUrl(data));
  });
}

async function fetchRadarFrame(index, options = {}) {
  const targetIndex = clampedTimeIndex(index);
  if (!options.force && frameCache.has(targetIndex)) {
    const cached = frameCache.get(targetIndex);
    preloadImage(payloadImageUrl(cached.data));
    return cached.data;
  }
  if (!options.force && pendingFrames.has(targetIndex)) {
    return pendingFrames.get(targetIndex);
  }

  const request = (async () => {
    const params = new URLSearchParams();
    params.set("time_index", String(targetIndex));
    const response = await fetch(`${API_BASE}/api/display/RADAR?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "Radar display data load failed");
    }
    const data = payload.data;
    const actualIndex = frameIndexFromPayload(data, targetIndex);
    const keepResult = !options.prefetch || !wantedFrameIndices.size || wantedFrameIndices.has(targetIndex) || wantedFrameIndices.has(actualIndex);
    if (!keepResult) return data;
    const cached = cachePayload(actualIndex, data);
    if (actualIndex !== targetIndex) frameCache.set(targetIndex, cached);
    preloadImage(payloadImageUrl(data));
    return data;
  })();

  pendingFrames.set(targetIndex, request);
  try {
    return await request;
  } finally {
    pendingFrames.delete(targetIndex);
  }
}

function frameWindow(centerIndex, initial = false) {
  const count = frameCount.value;
  const center = clampedTimeIndex(centerIndex);
  const start = initial ? 0 : Math.max(0, center - CACHE_BEHIND);
  const end = initial
    ? (count ? Math.min(count - 1, PRELOAD_FRAME_COUNT - 1) : PRELOAD_FRAME_COUNT - 1)
    : (count ? Math.min(count - 1, center + CACHE_AHEAD) : center + CACHE_AHEAD);
  const indices = [];
  for (let index = start; index <= end; index += 1) {
    indices.push(index);
  }
  return indices;
}

function releaseFarFrames(keepIndices) {
  const keep = new Set(keepIndices);
  const keepUrls = new Set();
  const releaseUrls = [];

  frameCache.forEach((entry, index) => {
    const url = apiUrl(payloadImageUrl(entry.data));
    if (keep.has(index)) {
      if (url) keepUrls.add(url);
      return;
    }
    if (url) releaseUrls.push(url);
    frameCache.delete(index);
  });

  releaseUrls.forEach((url) => {
    if (!keepUrls.has(url)) releaseImage(url);
  });
}

function preloadFrameWindow(centerIndex, options = {}) {
  const indices = frameWindow(centerIndex, !!options.initial);
  wantedFrameIndices = new Set(indices);
  releaseFarFrames(indices);
  indices.forEach((index) => {
    fetchRadarFrame(index, { prefetch: true }).catch((err) => console.warn(err));
  });
}

function clearFrameCaches() {
  wantedFrameIndices = new Set();
  pendingFrames.clear();
  frameCache.clear();
  clearImageCache();
}

function applyDisplayPayload(data) {
  display.value = data;
  error.value = "";
  syncSelection();
  applyImageryLayer();
  preloadImage(imageUrl.value);
  emitDisplayLoaded();
}

async function loadRadarDisplay(options = {}) {
  const currentRequest = ++requestId;
  const targetIndex = clampedTimeIndex();
  try {
    const data = await fetchRadarFrame(targetIndex, { force: !!options.force });
    if (currentRequest !== requestId) return;
    await preloadImage(payloadImageUrl(data));
    if (currentRequest !== requestId) return;
    applyDisplayPayload(data);
    preloadFrameWindow(targetIndex, { initial: !!options.initial });
  } catch (err) {
    if (currentRequest !== requestId) return;
    error.value = "雷达数据未加载";
    clearImageryLayer();
    console.error(err);
  }
}

onMounted(() => {
  loadRadarDisplay({ initial: true, force: true });
  timer = window.setInterval(() => loadRadarDisplay({ force: true }), REFRESH_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  clearFrameCaches();
  clearImageryLayer();
});

watch(products, syncSelection);
watch(selectedProductKey, () => {
  syncSelection();
  clearImageCache();
  preloadCachedImages();
});
watch(selectedLevelKey, () => {
  clearImageCache();
  preloadCachedImages();
});
watch(() => props.parsed, () => {
  zoomedKey = "";
  clearFrameCaches();
  loadRadarDisplay({ initial: true, force: true });
});
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
:deep(.radar-layer-card.layer-card.collapsed .lc-body) {
  transform: translateY(-50%);
}

:deep(.radar-layer-card.layer-card.collapsed .lc-tab) {
  left: min(240px, calc(100% - 10px));
}

.lc-error {
  margin: 0;
  padding: 7px 9px;
  color: #dc2626;
  font-size: 11px;
  line-height: 1.4;
}

.radar-stations {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.radar-station {
  position: absolute;
  width: 9px;
  height: 9px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(24, 24, 27, 0.82);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.52), 0 1px 4px rgba(15, 23, 42, 0.35);
}
</style>
