<template>
  <LayerCard :badge="label" :file="resolvedFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <label class="lc-row">
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length" @change="handleVariableChange">
        <option v-for="item in variables" :key="item.name" :value="item.name">{{ variableLabel(item) }}</option>
      </select>
    </label>
    <label class="lc-row">
      <span>分辨率</span>
      <select v-model="selectedResolution" :disabled="loading || !resolutionOptions.length" @change="handleResolutionChange">
        <option v-for="item in resolutionOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>
    <p v-if="error" class="lc-error">{{ error }}</p>
    <p v-else-if="warningText" class="lc-warning">{{ warningText }}</p>
    <p v-if="!error && grid?.capped" class="lc-note">
      当前显示网格已限幅为 {{ grid.width }} × {{ grid.height }}，未达到请求的 {{ grid.target_resolution_km }} km 间距。插值不增加原始数据精度。
    </p>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import { authedFetch, withToken } from "../api";

const props = defineProps({
  levelIndex: { type: Number, default: 0 },
  timeIndex: { type: Number, default: 0 },
  label: String,
  file: String,
  parsed: { type: Object, default: null },
  variantIndex: { type: Number, default: 0 },
  resolution: { type: String, default: "native" },
  playing: { type: Boolean, default: false },
});

const emit = defineEmits(["display-loaded", "variable-change", "resolution-change"]);

const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const layerRefreshKeys = inject("layerRefreshKeys", ref({}));
const refreshKey = computed(() => layerRefreshKeys.value?.cma || 0);
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const colors = ["#1d4ed8", "#0891b2", "#16a34a", "#facc15", "#dc2626"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;

const loading = ref(false);
const error = ref("");
const variables = ref([]);
const selectedVariable = ref("");
const selectedResolution = ref(normalizeResolutionKey(props.resolution));
const resolutionOptions = ref(defaultResolutionOptions());
const warnings = ref([]);
const grid = ref(null);
const lastFrameCount = ref(0);

let syncingVariable = false;
let displayRequestId = 0;
let cacheRevision = 0;
const displayCache = new Map();
const pendingDisplays = new Map();
const imageCache = new Map();
const FRAME_PRELOAD_CONCURRENCY = 4;

const resolvedFile = computed(() => grid.value?.file || props.file || "");
const catalogFrames = computed(() => {
  const meta = props.parsed?.meta || props.parsed?.meta_json || props.parsed || {};
  return Array.isArray(meta.frames) ? meta.frames : [];
});

function metaFileForIndex(timeIndex) {
  const index = Math.max(0, Math.floor(Number(timeIndex) || 0));
  return catalogFrames.value[index]?.meta_file
    || props.parsed?.meta?.meta_file
    || props.parsed?.meta_file
    || "";
}

function usesExactCatalogFrame(timeIndex) {
  const index = Math.max(0, Math.floor(Number(timeIndex) || 0));
  return Boolean(catalogFrames.value[index]?.meta_file);
}
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || null);
const legendTitle = computed(() => {
  const item = currentVariable.value;
  const unit = formatUnit(grid.value?.unit || item?.unit || "");
  const title = displayElementName(item, grid.value, unit);
  return unit ? `${title} (${unit})` : title;
});
const warningText = computed(() => warnings.value.slice(0, 2).join(" / "));

const ticks = computed(() => {
  const item = currentVariable.value;
  const min = Number(grid.value?.scale_min ?? item?.stats?.min ?? grid.value?.min);
  const max = Number(grid.value?.scale_max ?? item?.stats?.max ?? grid.value?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["低", "", "", "高"];
  return [min, min + (max - min) / 3, min + (max - min) * 2 / 3, max].map(formatTick);
});

function normalizeResolutionKey(value) {
  const key = String(value || "native").trim().toLowerCase();
  if (!key || key === "origin" || key === "original") return "native";
  return ["native", "3km", "1km"].includes(key) ? key : "native";
}

function defaultResolutionOptions() {
  return [
    { key: "native", label: "原始", playable: true, is_native: true },
    { key: "3km", label: "3 km", playable: false, is_native: false },
    { key: "1km", label: "1 km", playable: false, is_native: false },
  ];
}

function setResolutionOptions(data) {
  const next = data?.resolution_options || data?.meta_json?.resolution_options || data?.meta_json?.extra?.cma?.resolutions;
  resolutionOptions.value = Array.isArray(next) && next.length ? next : defaultResolutionOptions();
  if (!resolutionOptions.value.some(item => item.key === selectedResolution.value)) {
    selectedResolution.value = "native";
    emit("resolution-change", "native");
  }
}

function variableLabel(item) {
  return displayElementName(item, null, formatUnit(item?.unit || "")) || item?.name || "";
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  return value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
}

function formatUnit(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if (normalized === "1" || normalized === "1.0" || normalized === "none" || normalized === "null" || normalized === "n/a") return "";
  if (normalized === "c") return "℃";
  if (normalized === "k") return "K";
  if (normalized === "pa") return "Pa";
  if (normalized === "m") return "m";
  if (normalized === "m s-1" || normalized === "m/s") return "m/s";
  if (normalized === "w m-2" || normalized === "w/m2" || normalized === "w m^-2") return "W/m²";
  if (normalized === "kg m-2" || normalized === "kg/m2" || normalized === "kg m^-2") return "kg/m²";
  if (normalized === "kg m-2 s-1" || normalized === "kg/m2/s" || normalized === "kg m^-2 s^-1") return "kg/(m²·s)";
  if (normalized === "kg kg-1" || normalized === "kg/kg") return "kg/kg";
  if (normalized === "m^3 m-3" || normalized === "m3 m-3" || normalized === "m^3/m^3") return "m³/m³";
  return text;
}

function stripLabelUnit(label, unit) {
  const text = String(label || "").trim();
  if (!text || !unit) return text;
  const compactUnit = unit.replace(/\s+/g, "").toLowerCase();
  return text.replace(/\s*\[(.*?)\]\s*$/u, (_, bracketUnit) => {
    const normalizedBracket = String(bracketUnit || "").trim().replace(/\s+/g, "").toLowerCase();
    return normalizedBracket === compactUnit ? "" : ` [${bracketUnit}]`;
  }).trim();
}

function preferredZhName(item, fallback = "") {
  const raw = String(item?.name_cn || item?.description || item?.element_desc_zh || fallback || "").trim();
  if (!raw) return "";
  const short = raw.split(/[\n，。,；;：:（(]/u)[0]?.trim() || "";
  return short || raw;
}

function displayElementName(item, gridLike = null, unit = "") {
  const zh = preferredZhName(item);
  if (zh) return zh;
  const rawTitle = item?.label || gridLike?.label || gridLike?.variable || "CMA";
  return stripLabelUnit(rawTitle, unit);
}

function apiUrl(path) {
  if (!path) return "";
  const url = /^https?:\/\//i.test(path) ? path : new URL(path, `${API_BASE}/`).toString();
  return withToken(url);
}

function displayImagePath(data) {
  return data?.grid?.webp_url || data?.webp_url || data?.webp || "";
}

function preloadImage(path) {
  const resolved = apiUrl(path);
  if (!resolved || imageCache.has(resolved)) return Promise.resolve(resolved);

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const promise = new Promise((resolve, reject) => {
    image.onload = () => resolve(resolved);
    image.onerror = () => reject(new Error(`CMA image preload failed: ${resolved}`));
  });
  image.src = resolved;
  imageCache.set(resolved, { image, promise });
  return promise.catch(() => "");
}

function releaseImage(path) {
  const resolved = apiUrl(path);
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

function clearNativeFrameCaches() {
  cacheRevision += 1;
  pendingDisplays.clear();
  displayCache.clear();
  clearImageCache();
}

function clearImageryLayer() {
  surface?.clear();
}

function applyImageryLayer() {
  const imageUrl = apiUrl(grid.value?.webp_url);
  const extent = grid.value?.extent;
  if (!imageUrl || !Array.isArray(extent) || extent.length !== 4) {
    clearImageryLayer();
    return;
  }

  const cached = imageCache.get(imageUrl)?.image;
  surface?.setData(imageUrl, extent, 1, cached?.complete && cached.naturalWidth ? { image: cached } : {});
  const [west, south, east, north] = extent;
  const dx = Math.max((east - west) * 0.35, 0.5);
  const dy = Math.max((north - south) * 0.35, 0.5);
  flyToExtent?.([
    Math.max(-180, west - dx),
    Math.max(-90, south - dy),
    Math.min(180, east + dx),
    Math.min(90, north + dy),
  ]);
}

function activeFrame(data) {
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  if (!frames.length) return null;
  const index = Math.min(Math.max(Number(props.timeIndex) || 0, 0), frames.length - 1);
  return frames[index] || frames[0];
}

function buildPanelInfo(data) {
  const currentGrid = data?.grid || {};
  const metaJson = data?.meta_json || {};
  const weather = data?.weather_info || metaJson.weather_info || {};
  const cmaExtra = metaJson.extra?.cma || {};
  const item = currentVariable.value || variables.value.find(entry => entry.name === currentGrid.variable) || null;
  const frame = activeFrame(data);
  const displayUnit = formatUnit(currentGrid.unit || item?.unit || weather.unit || "");
  const elementName = displayElementName(item, currentGrid, displayUnit);
  return {
    ...weather,
    file: currentGrid.file || weather.file || metaJson.file || "",
    product: weather.product || cmaExtra.product_name || "",
    product_type: weather.product_type || cmaExtra.product_type || "",
    element: elementName || weather.element || currentGrid.variable || "",
    element_desc_zh: weather.element_desc_zh || item?.description || "",
    element_desc_en: weather.element_desc_en || item?.description_en || "",
    time: weather.time || frame?.time_label || frame?.time || metaJson.time || "",
    level: "",
    range: weather.range || metaJson.range || "",
    resolution: currentGrid.resolution || weather.resolution || "",
    grid: weather.grid || (currentGrid.width && currentGrid.height ? `${currentGrid.width} x ${currentGrid.height}` : metaJson.grid || ""),
    unit: displayUnit || "-",
    display_unit: displayUnit,
    variable_count: weather.variable_count || weather.variables || weather.vars || variables.value.length || "",
    min: Number.isFinite(Number(currentGrid.min)) ? `${formatTick(Number(currentGrid.min))}${displayUnit ? ` ${displayUnit}` : ""}` : weather.min || "",
    mean: Number.isFinite(Number(currentGrid.mean)) ? `${formatTick(Number(currentGrid.mean))}${displayUnit ? ` ${displayUnit}` : ""}` : weather.mean || "",
    max: Number.isFinite(Number(currentGrid.max)) ? `${formatTick(Number(currentGrid.max))}${displayUnit ? ` ${displayUnit}` : ""}` : weather.max || "",
    missing: weather.missing || currentGrid.nodata || metaJson.missing || "",
    status: weather.status || "解析成功",
  };
}

function emitDisplay(data, framePreloadPromise = null) {
  const currentGrid = data?.grid || {};
  const panelInfo = buildPanelInfo(data);
  const elementDesc = [
    panelInfo.element_desc_zh,
    panelInfo.element_desc_en,
  ].filter(Boolean).join("\n");

  const meta = {
    ...(data?.meta_json || {}),
    file: panelInfo.file,
    element: panelInfo.element,
    time: panelInfo.time,
    level: "",
    range: panelInfo.range,
    grid: panelInfo.grid,
    unit: panelInfo.unit,
    missing: panelInfo.missing,
    status: panelInfo.status,
    weather_info: panelInfo,
    extraRows: [
      ["product", "数据产品", panelInfo.product],
      ["productType", "产品类型", panelInfo.product_type],
      ["elementDesc", "要素说明", elementDesc],
      ["resolution", "空间分辨率", panelInfo.resolution],
      ["variableCount", "可选要素数", panelInfo.variable_count],
      ["min", "最小值", panelInfo.min],
      ["mean", "平均值", panelInfo.mean],
      ["max", "最大值", panelInfo.max],
    ],
  };

  const payload = {
    file: panelInfo.file,
    variable: currentGrid.variable || "",
    variable_key: currentGrid.variable || "",
    element: panelInfo.element,
    element_desc_zh: panelInfo.element_desc_zh,
    element_desc_en: panelInfo.element_desc_en,
    time: panelInfo.time,
    level: "",
    range: panelInfo.range,
    resolution: panelInfo.resolution,
    grid: panelInfo.grid,
    unit: panelInfo.unit,
    variable_count: panelInfo.variable_count,
    min: panelInfo.min,
    mean: panelInfo.mean,
    max: panelInfo.max,
    missing: panelInfo.missing,
    status: panelInfo.status,
    product: panelInfo.product,
    product_type: panelInfo.product_type,
    extent: currentGrid.extent || [],
    webp_url: currentGrid.webp_url || "",
    resolution_key: currentGrid.resolution_key || selectedResolution.value,
    resolution_options: resolutionOptions.value,
    playable: currentGrid.playable,
    warnings: warnings.value,
    times: data?.times || [],
    frames: data?.frames || [],
    variables: variables.value,
    frame_count: Array.isArray(data?.frames) ? data.frames.length : 0,
    frame_preload_promise: framePreloadPromise,
  };

  emit("variable-change", payload);
  emit("display-loaded", {
    meta,
    weather_info: panelInfo,
    variables: variables.value,
    times: data?.times || [],
    frames: data?.frames || [],
    resolution_key: currentGrid.resolution_key || selectedResolution.value,
    resolution_options: resolutionOptions.value,
    warnings: warnings.value,
    file: panelInfo.file,
    variable: currentGrid.variable || "",
    frame_preload_promise: framePreloadPromise,
  });
}

function cacheKey(variableName, levelIndex, timeIndex, resolutionKey) {
  return JSON.stringify([
    metaFileForIndex(timeIndex),
    normalizeResolutionKey(resolutionKey),
    variableName || "",
    Number(levelIndex) || 0,
    Number(timeIndex) || 0,
  ]);
}

async function fetchCmaDisplay(variableName, levelIndex = 0, timeIndex = 0, resolutionKey = selectedResolution.value) {
  const params = new URLSearchParams();
  if (variableName) params.set("variable", variableName);
  params.set("level_index", String(levelIndex));
  const exactFrame = usesExactCatalogFrame(timeIndex);
  params.set("time_index", String(exactFrame ? 0 : timeIndex));
  params.set("resolution", normalizeResolutionKey(resolutionKey));
  const metaFile = metaFileForIndex(timeIndex);
  if (metaFile) params.set("meta_file", metaFile);
  if (exactFrame) params.set("exact_meta", "true");
  const response = await authedFetch(`${API_BASE}/api/display/CMA?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || "CMA 数据读取失败");
  }
  return payload.data;
}

async function fetchCachedDisplay(variableName, levelIndex, timeIndex, resolutionKey) {
  const key = cacheKey(variableName, levelIndex, timeIndex, resolutionKey);
  const isNative = normalizeResolutionKey(resolutionKey) === "native";
  if (isNative && displayCache.has(key)) {
    const cached = displayCache.get(key);
    preloadImage(displayImagePath(cached));
    return cached;
  }
  if (isNative && pendingDisplays.has(key)) {
    return pendingDisplays.get(key);
  }

  const revision = cacheRevision;
  const request = fetchCmaDisplay(variableName, levelIndex, timeIndex, resolutionKey)
    .then((data) => {
      if (isNative && revision === cacheRevision) {
        displayCache.set(key, data);
        preloadImage(displayImagePath(data));
      }
      return data;
    })
    .finally(() => {
      if (isNative) pendingDisplays.delete(key);
    });

  if (isNative) {
    pendingDisplays.set(key, request);
  }
  return request;
}

function frameCountOf(data) {
  const frames = Array.isArray(data?.frames) ? data.frames.length : 0;
  return Number(data?.frame_count) || frames || 0;
}

function trimNativeCache(centerIndex) {
  const keepMin = Math.max(0, centerIndex - CACHE_BEHIND);
  const keepMax = centerIndex + CACHE_AHEAD;
  const dropKeys = [];
  for (const key of displayCache.keys()) {
    try {
      const [, resolutionKey, , , index] = JSON.parse(key);
      if (resolutionKey === "native" && (index < keepMin || index > keepMax)) {
        dropKeys.push(key);
      }
    } catch {
      dropKeys.push(key);
    }
  }

  dropCacheKeys(dropKeys);

  while (displayCache.size > MAX_NATIVE_CACHE_FRAMES) {
    const firstKey = displayCache.keys().next().value;
    if (!firstKey) break;
    dropCacheKeys([firstKey]);
  }
}

function dropCacheKeys(keys) {
  const uniqueKeys = [...new Set(keys)].filter(key => displayCache.has(key));
  if (!uniqueKeys.length) return;

  const dropSet = new Set(uniqueKeys);
  const keepUrls = new Set(
    [...displayCache.entries()]
      .filter(([key]) => !dropSet.has(key))
      .map(([, data]) => apiUrl(displayImagePath(data)))
      .filter(Boolean)
  );

  uniqueKeys.forEach((key) => {
    const data = displayCache.get(key);
    const url = apiUrl(displayImagePath(data));
    displayCache.delete(key);
    if (url && !keepUrls.has(url)) releaseImage(url);
  });
}

async function preloadNativeFrames(data, variableName) {
  if (selectedResolution.value !== "native") return;
  const count = frameCountOf(data);
  if (count <= 1) return;
  const revision = cacheRevision;
  const indices = Array.from({ length: count }, (_, index) => index);
  let cursor = 0;
  const worker = async () => {
    while (cursor < indices.length && revision === cacheRevision) {
      const index = indices[cursor];
      cursor += 1;
      const key = cacheKey(variableName, props.levelIndex, index, "native");
      if (displayCache.has(key)) continue;
      try {
        await fetchCachedDisplay(variableName, props.levelIndex, index, "native");
      } catch {
        // 单帧失败不阻塞其余可播放帧的预加载。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FRAME_PRELOAD_CONCURRENCY, count) }, worker));
}

async function loadDisplay(variableName = selectedVariable.value) {
  const requestId = ++displayRequestId;
  const resolutionKey = normalizeResolutionKey(selectedResolution.value);
  loading.value = true;
  error.value = "";
  try {
    let nextDisplay = await fetchCachedDisplay(variableName, props.levelIndex, props.timeIndex, resolutionKey);
    if (requestId !== displayRequestId) return;
    setResolutionOptions(nextDisplay);
    variables.value = nextDisplay.variables || [];
    const defaultVar =
      nextDisplay.grid?.variable ||
      nextDisplay.weather_info?.variable_key ||
      nextDisplay.meta_json?.default_variable ||
      nextDisplay.meta_json?.extra?.cma?.primary_variable ||
      variables.value[0]?.name ||
      "";
    let nextVariable = variableName || defaultVar;
    if (!variableName && props.variantIndex > 0 && variables.value.length > 1) {
      const defaultIdx = variables.value.findIndex(v => v.name === defaultVar);
      const offset = (defaultIdx >= 0 ? defaultIdx : 0) + props.variantIndex;
      nextVariable = variables.value[offset % variables.value.length]?.name || defaultVar;
    }
    if (nextVariable && nextVariable !== nextDisplay.grid?.variable) {
      nextDisplay = await fetchCachedDisplay(nextVariable, props.levelIndex, props.timeIndex, resolutionKey);
      if (requestId !== displayRequestId) return;
    }
    if (!nextDisplay.grid || nextDisplay.grid.variable !== nextVariable) {
      throw new Error(nextDisplay.warnings?.join(" / ") || "CMA 所选要素没有可显示的数据");
    }
    syncingVariable = true;
    selectedVariable.value = nextVariable;
    syncingVariable = false;
    grid.value = nextDisplay.grid || null;
    lastFrameCount.value = frameCountOf(nextDisplay);
    warnings.value = nextDisplay.warnings || nextDisplay.grid?.warnings || nextDisplay.weather_info?.warnings || [];
    await preloadImage(displayImagePath(nextDisplay));
    if (requestId !== displayRequestId) return;
    const framePreloadPromise = preloadNativeFrames(nextDisplay, nextVariable);
    emitDisplay(nextDisplay, framePreloadPromise);
    applyImageryLayer();
  } catch (err) {
    if (requestId !== displayRequestId) return;
    grid.value = null;
    warnings.value = [];
    clearImageryLayer();
    error.value = err.message || String(err);
  } finally {
    if (requestId === displayRequestId) {
      loading.value = false;
    }
  }
}

function handleVariableChange() {
  if (selectedVariable.value && !syncingVariable) {
    clearNativeFrameCaches();
    loadDisplay(selectedVariable.value);
  }
}

function handleResolutionChange() {
  selectedResolution.value = normalizeResolutionKey(selectedResolution.value);
  emit("resolution-change", selectedResolution.value);
  clearNativeFrameCaches();
  loadDisplay(selectedVariable.value);
}

onMounted(() => loadDisplay());

watch(() => props.levelIndex, () => {
  clearNativeFrameCaches();
  loadDisplay(selectedVariable.value);
});
watch(() => props.timeIndex, () => loadDisplay(selectedVariable.value));
watch(() => props.resolution, value => {
  const next = normalizeResolutionKey(value);
  if (next !== selectedResolution.value) {
    selectedResolution.value = next;
    clearNativeFrameCaches();
    loadDisplay(selectedVariable.value);
  }
});
watch(() => props.playing, value => {
  if (value && selectedResolution.value !== "native") {
    selectedResolution.value = "native";
    emit("resolution-change", "native");
    clearNativeFrameCaches();
    loadDisplay(selectedVariable.value);
  } else if (value && grid.value) {
    preloadNativeFrames({ frame_count: lastFrameCount.value, frames: [] }, selectedVariable.value);
  }
});
watch(() => props.parsed, () => {
  clearNativeFrameCaches();
  loadDisplay(selectedVariable.value);
});
watch(refreshKey, () => {
  clearNativeFrameCaches();
  loadDisplay(selectedVariable.value);
});
watch(() => props.variantIndex, () => {
  clearNativeFrameCaches();
  loadDisplay("");
});

onBeforeUnmount(() => {
  displayRequestId += 1;
  clearNativeFrameCaches();
  clearImageryLayer();
});
</script>

<style scoped>
.lc-error {
  margin: 8px 0 0;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
}

.lc-warning {
  margin: 8px 0 0;
  color: #b45309;
  font-size: 12px;
  line-height: 1.4;
}

.lc-note {
  margin: 8px 0 0;
  color: inherit;
  opacity: 0.75;
  font-size: 12px;
  line-height: 1.4;
}
</style>
