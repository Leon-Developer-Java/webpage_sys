<template>
  <LayerCard :badge="label" :file="resolvedFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <label class="lc-row">
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length" @change="handleVariableChange">
        <option v-for="item in variables" :key="item.name" :value="item.name">{{ variableLabel(item) }}</option>
      </select>
    </label>
    <p v-if="error" class="lc-error">{{ error }}</p>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";

const props = defineProps({
  levelIndex: { type: Number, default: 0 },
  timeIndex: { type: Number, default: 0 },
  label: String,
  file: String,
  parsed: { type: Object, default: null },
});

const emit = defineEmits(["display-loaded", "variable-change"]);

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
const grid = ref(null);

let syncingVariable = false;

const resolvedFile = computed(() => grid.value?.file || props.file || "");
const currentMetaFile = computed(() => props.parsed?.meta?.meta_file || props.parsed?.meta_file || "");
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || null);
const legendTitle = computed(() => {
  const item = currentVariable.value;
  const unit = formatUnit(grid.value?.unit || item?.unit || "");
  const title = displayElementName(item, grid.value, unit);
  return unit ? `${title} (${unit})` : title;
});

const ticks = computed(() => {
  const item = currentVariable.value;
  const min = Number(grid.value?.scale_min ?? item?.stats?.min ?? grid.value?.min);
  const max = Number(grid.value?.scale_max ?? item?.stats?.max ?? grid.value?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["低", "", "", "高"];
  return [min, min + (max - min) / 3, min + (max - min) * 2 / 3, max].map(formatTick);
});

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
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, `${API_BASE}/`).toString();
}

function clearImageryLayer() {
  surface?.clear();
}

function applyImageryLayer() {
  const imageUrl = apiUrl(grid.value?.webp_url || grid.value?.image_url);
  const extent = grid.value?.extent;
  if (!imageUrl || !Array.isArray(extent) || extent.length !== 4) {
    clearImageryLayer();
    return;
  }

  surface?.setData(imageUrl, extent, 1);
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
    resolution: weather.resolution || "",
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

function emitDisplay(data) {
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
    image_url: currentGrid.webp_url || currentGrid.image_url || "",
    webp_url: currentGrid.webp_url || "",
    times: data?.times || [],
    frames: data?.frames || [],
    variables: variables.value,
    frame_count: Array.isArray(data?.frames) ? data.frames.length : 0,
  };

  emit("variable-change", payload);
  emit("display-loaded", {
    meta,
    weather_info: panelInfo,
    variables: variables.value,
    times: data?.times || [],
    frames: data?.frames || [],
    file: panelInfo.file,
    variable: currentGrid.variable || "",
  });
}

async function fetchCmaDisplay(variableName, levelIndex = 0, timeIndex = 0) {
  const params = new URLSearchParams();
  if (variableName) params.set("variable", variableName);
  params.set("level_index", String(levelIndex));
  params.set("time_index", String(timeIndex));
  if (currentMetaFile.value) params.set("meta_file", currentMetaFile.value);
  const response = await fetch(`${API_BASE}/api/display/CMA?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || "CMA 数据读取失败");
  }
  return payload.data;
}

async function loadDisplay(variableName = selectedVariable.value) {
  loading.value = true;
  error.value = "";
  try {
    const nextDisplay = await fetchCmaDisplay(variableName, props.levelIndex, props.timeIndex);
    variables.value = nextDisplay.variables || [];
    const nextVariable =
      nextDisplay.grid?.variable ||
      nextDisplay.weather_info?.variable_key ||
      nextDisplay.meta_json?.default_variable ||
      nextDisplay.meta_json?.extra?.cma?.primary_variable ||
      variables.value[0]?.name ||
      "";
    syncingVariable = true;
    selectedVariable.value = nextVariable;
    syncingVariable = false;
    grid.value = nextDisplay.grid || null;
    emitDisplay(nextDisplay);
    applyImageryLayer();
  } catch (err) {
    grid.value = null;
    clearImageryLayer();
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

function handleVariableChange() {
  if (selectedVariable.value && !syncingVariable) {
    loadDisplay(selectedVariable.value);
  }
}

onMounted(() => loadDisplay());

watch(() => props.levelIndex, () => loadDisplay(selectedVariable.value));
watch(() => props.timeIndex, () => loadDisplay(selectedVariable.value));
watch(() => props.parsed, () => loadDisplay(selectedVariable.value));
watch(refreshKey, () => loadDisplay(selectedVariable.value));

onBeforeUnmount(() => {
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
</style>
