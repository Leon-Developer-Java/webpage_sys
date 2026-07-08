<template>
  <!--
    自包含 GFS / ECMWF 图层：
    1. GFS 和 ECMWF 作为两个独立数据源入口；
    2. 二者复用同一个 GRIB 图层组件；
    3. 后端优先返回 WEBP，PNG 仅作兜底兼容；
    4. 如果后端同时返回 float32，本组件仍支持点查真实值。
  -->
  <canvas ref="renderCanvas" class="gfs-render-canvas"></canvas>

  <LayerCard
    :badge="label || sourceName"
    :file="resolvedFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
  >
    <template v-if="variableOptions.length">
      <label class="lc-row">
        <span>产品类型</span>
        <select v-model="selectedProductCategory">
          <option v-for="item in productCategories" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
      </label>

      <label class="lc-row">
        <span>气象要素</span>
        <select v-model="selectedVariableKey">
          <option
            v-for="item in filteredVariableOptions"
            :key="item.key"
            :value="item.key"
          >
            {{ item.label }}
          </option>
        </select>
      </label>

      <label class="lc-row">
        <span>预报层级</span>
        <select v-model="selectedLevelKey">
          <option
            v-for="item in levelOptions"
            :key="item.key"
            :value="item.key"
          >
            {{ item.label }}
          </option>
        </select>
      </label>

      <label v-if="resolutionOptions.length > 1" class="lc-row">
        <span>显示分辨率</span>
        <select v-model="selectedResolutionKey">
          <option
            v-for="item in resolutionOptions"
            :key="item.key"
            :value="item.key"
          >
            {{ item.label }}
          </option>
        </select>
      </label>

      <div class="gfs-current">
        <span>当前时次</span>
        <b>{{ currentTimeLabel }}</b>
        <small>
          {{ safeIndex + 1 }} / {{ currentPngUrls.length || currentGridUrls.length || 1 }}
          · {{ renderModeText }}
          · {{ statusText }}
        </small>
      </div>

      <div class="gfs-stat-row">
        <span>Min {{ formatStat(currentStepStats?.min) }}</span>
        <span>Mean {{ formatStat(currentStepStats?.mean) }}</span>
        <span>Max {{ formatStat(currentStepStats?.max) }}</span>
        <em>{{ displayUnit }}</em>
      </div>

      <div v-if="pickedPoint" class="gfs-pick compact">
        <b>点查信息</b>
        <p>{{ pickedPoint.lon.toFixed(3) }}°, {{ pickedPoint.lat.toFixed(3) }}°</p>
        <p>{{ pickedPoint.variable }} · {{ pickedPoint.time }}</p>
        <p>
          数值：
          <span v-if="pickedPoint.missing">缺测</span>
          <span v-else>{{ pickedPoint.value.toFixed(2) }} {{ pickedPoint.unit }}</span>
        </p>
      </div>

      <div v-else class="gfs-pick-hint">
        点击地图查看该点经纬度和当前变量值
      </div>

      <div class="gfs-status" :class="{ error: !!error || !!gridError }">
        {{ error || gridError }}
      </div>
    </template>

    <template v-else>
      <div class="gfs-status" :class="{ error: !!error }">
        {{ statusText }}
      </div>
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import { authedFetch } from "../api";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: { type: String, default: "" },
  dataType: { type: String, default: "GFS" },
  file: String,
  parsed: {
    type: Object,
    default: null,
  },
  timeIndex: {
    type: Number,
    default: 0,
  },
  alpha: {
    type: Number,
    default: 1,
  },
  variantIndex: { type: Number, default: 0 },
});

const emit = defineEmits(["variable-change", "display-loaded"]);

const API_BASE = "http://127.0.0.1:8002";
const FALLBACK_EXTENT = [0, -90, 359.75, 90];
const FALLBACK_IMAGE = `${API_BASE}/data/GFS/053031.grib.webp`;
const DEFAULT_MISSING = -9999;

const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const requestMapResize = inject("requestMapResize", null);
const registerMapClick = inject("registerMapClick", null);

const DEFAULT_FOCUS_EXTENT = [73, 15, 135, 55];

const sourceName = computed(() => {
  const candidates = [
    props.dataType,
    props.parsed?.business_type,
    props.parsed?.data_type,
    props.parsed?.source,
    props.parsed?.meta?.business_type,
    props.parsed?.meta?.data_type,
    props.parsed?.weather_info?.source,
    props.parsed?.meta_json?.business_type,
    props.parsed?.meta_json?.data_type,
    props.parsed?.meta_json?.weather_info?.source,
  ];

  const text = candidates.map(v => String(v || "").toUpperCase()).join(" ");
  return text.includes("ECMWF") || text.includes("IFS") ? "ECMWF" : "GFS";
});

const renderCanvas = ref(null);

const display = ref(null);
const error = ref("");
const loading = ref(false);

const selectedProductCategory = ref("");
const selectedVariableKey = ref("");
const selectedLevelKey = ref("surface");
const selectedResolutionKey = ref("raw");

const gridValues = shallowRef(null);
const gridLoading = ref(false);
const gridError = ref("");
let gridRequestId = 0;

const pickedPoint = ref(null);

let timer = null;
let zoomedKey = "";
let unregisterMapClick = null;
let zoomTimer = null;
let renderRequestId = 0;

const variableLayers = computed(() => {
  const data = display.value || {};

  const layers =
    data.variable_layers ||
    data.weather_info?.variable_layers ||
    data.meta?.variable_layers ||
    data.extra?.variable_layers ||
    data.meta_json?.variable_layers ||
    data.meta_json?.weather_info?.variable_layers ||
    data.meta_json?.meta?.variable_layers ||
    {};

  if (layers && typeof layers === "object" && Object.keys(layers).length) {
    return layers;
  }

  const info = data.weather_info || data.meta_json?.weather_info || data.meta || data.meta_json?.meta || {};
  const urls =
    data.image_urls ||
    info.image_urls ||
    data.webp_urls ||
    info.webp_urls ||
    data.png_urls ||
    info.png_urls ||
    data.extra?.image_urls ||
    data.extra?.webp_urls ||
    data.extra?.png_urls ||
    data.meta_json?.image_urls ||
    data.meta_json?.webp_urls ||
    data.meta_json?.png_urls ||
    [];

  const singleUrl =
    data.image_url ||
    info.image_url ||
    data.webp_url ||
    info.webp_url ||
    data.png_url ||
    info.png_url ||
    data.extra?.image_url ||
    data.extra?.webp_url ||
    data.extra?.png_url ||
    data.meta_json?.image_url ||
    data.meta_json?.webp_url ||
    data.meta_json?.png_url ||
    "";

  return {
    default: {
      key: "default",
      label: info.mainVariableName || info.element || `${sourceName.value} field`,
      element: info.element || `${sourceName.value} field`,
      unit: info.unit || info.displayUnit || "",
      level: info.level || "surface",
      time: info.time || "",
      times: info.times || data.times || [],
      extent: info.extent || data.extent || FALLBACK_EXTENT,
      png_urls: Array.isArray(urls) && urls.length ? urls : [singleUrl || FALLBACK_IMAGE],
      grid_urls: info.grid_urls || data.grid_urls || [],
      min: info.min,
      max: info.max,
      mean: info.mean,
      missing: DEFAULT_MISSING,
      missingText: info.missing,
      grid: info.gridShape || null,
      range: info.range,
      quality: info.quality,
      alert: info.alert,
      varType: info.varType || "generic",
      color_range: info.color_range || {},
      gradient: "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)",
      legend_ticks: ["低", "较低", "中", "较高", "高"],
    },
  };
});

const variableOptions = computed(() => {
  const data = display.value || {};

  const options =
    data.variable_options ||
    data.weather_info?.variable_options ||
    data.meta?.variable_options ||
    data.extra?.variable_options ||
    data.meta_json?.variable_options ||
    data.meta_json?.weather_info?.variable_options ||
    data.meta_json?.meta?.variable_options ||
    [];

  if (Array.isArray(options) && options.length) {
    return options.map(item => ({
      key: String(item.key),
      label: item.label || item.element || String(item.key),
      unit: item.unit || item.displayUnit || "",
      varType: item.varType || "generic",
      ...item,
    }));
  }

  return Object.entries(variableLayers.value).map(([key, layer]) => ({
    key,
    label: layer.label || layer.element || key,
    unit: layer.unit || layer.displayUnit || "",
    varType: layer.varType || "generic",
    productCategory: layer.productCategory || categoryByVarType(layer.varType || "generic"),
  }));
});

const productCategories = computed(() => {
  const arr = variableOptions.value
    .map(item => item.productCategory || item.productType || categoryByVarType(item.varType) || "数值预报产品")
    .filter(Boolean);
  return [...new Set(arr)];
});

const filteredVariableOptions = computed(() => {
  if (!selectedProductCategory.value) return variableOptions.value;
  return variableOptions.value.filter(item => {
    const cat = item.productCategory || item.productType || categoryByVarType(item.varType) || "数值预报产品";
    return cat === selectedProductCategory.value;
  });
});

const currentVariable = computed(() => {
  return (
    filteredVariableOptions.value.find(item => item.key === selectedVariableKey.value) ||
    filteredVariableOptions.value[0] ||
    variableOptions.value[0] ||
    null
  );
});

const currentLayer = computed(() => {
  const key = currentVariable.value?.key || selectedVariableKey.value;
  return variableLayers.value[key] || Object.values(variableLayers.value)[0] || null;
});

const resolutionOptions = computed(() => {
  const opts =
    currentLayer.value?.resolution_options ||
    currentLayer.value?.resolutionOptions ||
    [];

  if (Array.isArray(opts) && opts.length) {
    return opts.map(item => ({
      key: String(item.key || item.value || "raw"),
      label: item.label || item.name || String(item.key || item.value || "原始分辨率"),
      ...item,
    }));
  }

  return [{ key: "raw", label: "原始分辨率" }];
});

const currentResolutionVariant = computed(() => {
  const variants =
    currentLayer.value?.resolution_variants ||
    currentLayer.value?.resolutionVariants ||
    {};

  const key = selectedResolutionKey.value || "raw";
  const selected = variants?.[key];

  // 差分产品未预生成或生成失败时，回退 raw，避免地图空白。
  if (selected && selected.status !== "pending" && selected.status !== "failed") {
    return selected;
  }

  return variants?.raw || null;
});

const currentDisplayLayer = computed(() => {
  if (!currentLayer.value) return null;

  const variant = currentResolutionVariant.value;
  if (!variant) return currentLayer.value;

  return {
    ...currentLayer.value,
    ...variant,
    // 这些基础属性优先保留变量层，避免 variant 信息不全导致面板空白。
    key: currentLayer.value.key,
    label: currentLayer.value.label,
    element: currentLayer.value.element,
    unit: currentLayer.value.unit,
    displayUnit: currentLayer.value.displayUnit,
    varType: currentLayer.value.varType,
    color_range: currentLayer.value.color_range,
    legend_ticks: currentLayer.value.legend_ticks,
    times: currentLayer.value.times,
    valid_times: currentLayer.value.valid_times,
    valid_hours: currentLayer.value.valid_hours,
    valid_time_hours: currentLayer.value.valid_time_hours,
    forecast_hours: currentLayer.value.forecast_hours,
    forecast_labels: currentLayer.value.forecast_labels,
  };
});

const levelOptions = computed(() => {
  const levelText =
    currentLayer.value?.level ||
    currentLayer.value?.typeOfLevel ||
    currentLayer.value?.GRIB_typeOfLevel ||
    "surface";

  return [
    {
      key: "surface",
      label: levelText,
    },
  ];
});

const currentPngUrls = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};

  // 字段名保留 currentPngUrls 是为了少改旧逻辑；
  // 实际上这里优先承载 image_urls / webp_urls，PNG 只兜底。
  const urls =
    layer.image_urls ||
    layer.imageUrls ||
    layer.webp_urls ||
    layer.webpUrls ||
    layer.png_urls ||
    layer.pngUrls ||
    [];

  const normalized = Array.isArray(urls) ? urls.map(toPublicUrl).filter(Boolean) : [];

  if (normalized.length) {
    return normalized;
  }

  const single = toPublicUrl(
    layer.image_url ||
    layer.image ||
    layer.webp_url ||
    layer.webp ||
    layer.png_url ||
    layer.png ||
    props.src
  );

  return single ? [single] : [FALLBACK_IMAGE];
});

const currentGridUrls = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};

  const urls =
    layer.grid_urls ||
    layer.gridUrls ||
    layer.binary_urls ||
    layer.binaryUrls ||
    layer.binary_layer?.grid_urls ||
    [];

  return Array.isArray(urls) ? urls.map(toPublicUrl).filter(Boolean) : [];
});

const imageExtent = computed(() => {
  const candidate =
    props.extent ||
    currentDisplayLayer.value?.extent ||
    currentLayer.value?.extent ||
    display.value?.extent ||
    display.value?.weather_info?.extent ||
    display.value?.meta_json?.extent ||
    display.value?.meta_json?.weather_info?.extent ||
    FALLBACK_EXTENT;

  if (Array.isArray(candidate) && candidate.length === 4) {
    return candidate.map(Number);
  }

  return FALLBACK_EXTENT;
});

const frameCount = computed(() => {
  return Math.max(currentGridUrls.value.length, currentPngUrls.value.length, currentTimes.value.length, 1);
});

const safeIndex = computed(() => {
  const count = frameCount.value;
  if (!count) return 0;

  const idx = Number.isFinite(props.timeIndex)
    ? Math.floor(props.timeIndex)
    : 0;

  return ((idx % count) + count) % count;
});

const currentImageUrl = computed(() => {
  return currentPngUrls.value[safeIndex.value] || currentPngUrls.value[0] || FALLBACK_IMAGE;
});

const currentGridUrl = computed(() => {
  return currentGridUrls.value[safeIndex.value] || currentGridUrls.value[0] || "";
});

const currentTimes = computed(() => {
  const times =
    currentLayer.value?.times ||
    currentLayer.value?.valid_times ||
    currentLayer.value?.validTimes ||
    currentLayer.value?.binary_layer?.times ||
    [];

  if (Array.isArray(times) && times.length) {
    return times.map(String);
  }

  return Array.from(
    { length: Math.max(currentPngUrls.value.length, currentGridUrls.value.length, 1) },
    (_, i) => `step${String(i).padStart(3, "0")}`
  );
});

const currentRawTimeLabel = computed(() => {
  return currentTimes.value[safeIndex.value] || `step${String(safeIndex.value).padStart(3, "0")}`;
});

const currentForecastHours = computed(() => {
  const hours =
    currentLayer.value?.forecast_hours ||
    currentLayer.value?.forecastHours ||
    currentLayer.value?.binary_layer?.forecast_hours ||
    [];

  if (Array.isArray(hours) && hours.length) {
    return hours.map((v, i) => parseForecastHourValue(v, i));
  }

  const labels =
    currentLayer.value?.forecast_labels ||
    currentLayer.value?.forecastLabels ||
    currentLayer.value?.binary_layer?.forecast_labels ||
    [];

  if (Array.isArray(labels) && labels.length) {
    return labels.map((v, i) => parseForecastHourValue(v, i));
  }

  return Array.from({ length: frameCount.value }, (_, i) => i);
});

const currentForecastLabel = computed(() => {
  const labels =
    currentLayer.value?.forecast_labels ||
    currentLayer.value?.forecastLabels ||
    currentLayer.value?.binary_layer?.forecast_labels ||
    [];

  return labels[safeIndex.value] || `F${String(currentForecastHours.value[safeIndex.value] ?? safeIndex.value).padStart(3, "0")}`;
});

const currentTimeLabel = computed(() => {
  return `${currentForecastLabel.value} · ${formatTimeLabel(currentRawTimeLabel.value)}`;
});

const gridWidth = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};
  return Number(
    layer.grid?.nx ||
    layer.gridShape?.nx ||
    layer.binary_layer?.width ||
    layer.binary_layer?.shape?.[1] ||
    0
  );
});

const gridHeight = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};
  return Number(
    layer.grid?.ny ||
    layer.gridShape?.ny ||
    layer.binary_layer?.height ||
    layer.binary_layer?.shape?.[0] ||
    0
  );
});

const gridMissing = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};
  return Number(layer.missing ?? layer.binary_layer?.missing ?? DEFAULT_MISSING);
});

const currentStepStats = computed(() => {
  const layer = currentDisplayLayer.value || currentLayer.value || {};

  const stats =
    layer.step_stats ||
    layer.stepStats ||
    layer.binary_layer?.step_stats ||
    [];

  return stats[safeIndex.value] || {
    min: currentLayer.value?.min,
    max: currentLayer.value?.max,
    mean: currentLayer.value?.mean,
  };
});

const weatherInfo = computed(() => {
  return display.value?.weather_info || display.value?.meta_json?.weather_info || display.value?.meta || {};
});

const resolvedFile = computed(() => {
  return (
    props.file ||
    display.value?.file_name ||
    display.value?.meta?.file ||
    weatherInfo.value.file ||
    display.value?.source_file?.split(/[\\/]/).pop() ||
    `${sourceName.value} realtime`
  );
});

const displayUnit = computed(() => {
  return currentLayer.value?.unit || currentVariable.value?.unit || currentLayer.value?.displayUnit || "";
});

const renderVarType = computed(() => {
  return String(currentLayer.value?.varType || currentVariable.value?.varType || "generic");
});

const renderColorRange = computed(() => {
  const range = currentLayer.value?.color_range || currentLayer.value?.colorRange || currentLayer.value?.binary_layer?.color_range || {};
  return {
    min: Number(range.min ?? currentLayer.value?.renderMin ?? currentLayer.value?.min),
    max: Number(range.max ?? currentLayer.value?.renderMax ?? currentLayer.value?.max),
    mode: range.mode || "auto",
  };
});

const legendTitle = computed(() => {
  const label = currentVariable.value?.label || currentLayer.value?.label || currentLayer.value?.element || `${sourceName.value} field`;
  const unit = displayUnit.value;
  return unit ? `${label} (${unit})` : label;
});

const gradient = computed(() => {
  return (
    currentLayer.value?.gradient ||
    currentVariable.value?.gradient ||
    gradientByVarType(renderVarType.value)
  );
});

const ticks = computed(() => {
  if (Array.isArray(currentLayer.value?.legend_ticks) && currentLayer.value.legend_ticks.length) {
    return currentLayer.value.legend_ticks;
  }

  const min = Number(renderColorRange.value.min);
  const max = Number(renderColorRange.value.max);

  if (Number.isFinite(min) && Number.isFinite(max) && Math.abs(max - min) > 1e-9) {
    return Array.from({ length: 5 }, (_, i) => {
      const value = min + (max - min) * i / 4;
      return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    });
  }

  return ["低", "较低", "中", "较高", "高"];
});

const binaryReady = computed(() => {
  return !!gridValues.value && gridWidth.value > 0 && gridHeight.value > 0;
});

const renderModeText = computed(() => {
  if (gridLoading.value) return "二进制加载中";
  if (binaryReady.value) return "二进制格点";

  const fmt =
    currentDisplayLayer.value?.image_format ||
    currentDisplayLayer.value?.imageFormat ||
    (String(currentImageUrl.value || "").toLowerCase().includes(".webp") ? "webp" : "png");

  return String(fmt).toLowerCase() === "webp" ? "WEBP预览" : "PNG预览";
});

const currentValidHours = computed(() => {
  const explicit =
    currentLayer.value?.valid_hours ||
    currentLayer.value?.validHours ||
    currentLayer.value?.valid_time_hours ||
    currentLayer.value?.validTimeHours ||
    currentLayer.value?.binary_layer?.valid_hours ||
    [];

  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((v, i) => parseValidHourForEmit(v, i));
  }

  const times = Array.isArray(currentTimes.value) ? currentTimes.value : [];
  if (times.length) {
    return times.map((t, i) => parseValidHourForEmit(t, i));
  }

  return [];
});

const currentBinaryLayer = computed(() => {
  return {
    key: currentVariable.value?.key || selectedVariableKey.value || currentLayer.value?.key || "",
    dtype: "float32",
    endian: "little",
    missing: gridMissing.value,
    shape: [gridHeight.value, gridWidth.value],
    width: gridWidth.value,
    height: gridHeight.value,
    grid_url: currentGridUrl.value,
    grid_urls: currentGridUrls.value,
    times: currentTimes.value,
    valid_hours: currentValidHours.value,
    valid_time_hours: currentValidHours.value,
    forecast_hours: currentForecastHours.value,
    forecast_labels: currentForecastHours.value.map(hour => `F${String(hour).padStart(3, "0")}`),
    unit: displayUnit.value,
    varType: renderVarType.value,
    color_range: renderColorRange.value,
    step_stats: currentLayer.value?.step_stats || currentLayer.value?.stepStats || [],
  };
});

const statusText = computed(() => {
  if (error.value) return error.value;
  if (gridError.value) return gridError.value;
  if (loading.value) return "图层读取中";
  if (gridLoading.value) return "数值矩阵加载中";

  const gridText = currentLayer.value?.grid?.text || currentLayer.value?.gridText || "";
  const levelText = currentLayer.value?.level || "";

  return [levelText, gridText ? `网格 ${gridText}` : ""].filter(Boolean).join(" · ") || "已加载";
});

function categoryByVarType(type) {
  if (type === "temperature") return "温度产品";
  if (type === "precipitation") return "降水产品";
  if (type === "pressure") return "气压产品";
  if (type === "wind") return "风场产品";
  return "数值预报产品";
}

function gradientByVarType(type) {
  if (type === "precipitation") {
    return "linear-gradient(to right, #f8fafc, #93c5fd, #22c55e, #facc15, #ef4444)";
  }

  if (type === "pressure") {
    return "linear-gradient(to right, #7c3aed, #2563eb, #22c55e, #facc15, #ef4444)";
  }

  if (type === "wind") {
    return "linear-gradient(to right, #e0f2fe, #38bdf8, #2563eb, #7c3aed, #ef4444)";
  }

  return "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";
}

function formatTimeLabel(value) {
  if (!value) return "—";

  const text = String(value);
  const match = text.match(/(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);

  if (match) {
    return `${match[1]}-${match[2]} ${match[3]}:${match[4]}`;
  }

  return text.length > 16 ? text.slice(0, 16) : text;
}

function toPublicUrl(path) {
  if (!path) return "";

  if (/^https?:\/\//i.test(path) || String(path).startsWith("data:")) {
    return path;
  }

  const normalized = String(path).replaceAll("\\", "/");
  const idx = normalized.indexOf("/data/");

  if (idx >= 0) {
    return `${API_BASE}${normalized.slice(idx)}`;
  }

  if (normalized.startsWith("/data/")) {
    return `${API_BASE}${normalized}`;
  }

  return normalized.startsWith("/")
    ? `${API_BASE}${normalized}`
    : `${API_BASE}/data/${sourceName.value}/${normalized}`;
}

function parseForecastHourValue(value, fallbackIndex = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value || "");

  const m1 = text.match(/F\s*(\d{1,3})/i);
  if (m1) return Number(m1[1]);

  const m2 = text.match(/(\d{1,3})\s*h/i);
  if (m2) return Number(m2[1]);

  const m3 = text.match(/(\d{1,3})/);
  if (m3) return Number(m3[1]);

  return fallbackIndex;
}

function parseValidHourForEmit(value, fallbackIndex = 0) {
  if (value === undefined || value === null || value === "") {
    return fallbackIndex;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return ((Math.floor(value) % 24) + 24) % 24;
  }

  const text = String(value);

  const iso = text.match(/T(\d{1,2}):\d{2}/);
  if (iso) return Number(iso[1]);

  const hm = text.match(/(\d{1,2}):\d{2}/);
  if (hm) return Number(hm[1]);

  const cn = text.match(/(\d{1,2})时/);
  if (cn) return Number(cn[1]);

  return fallbackIndex;
}

function defaultBusinessAxisTimes() {
  return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}时`);
}

let variantApplied = false;
function syncSelection() {
  if (!variableOptions.value.length) return;

  if (!productCategories.value.includes(selectedProductCategory.value)) {
    selectedProductCategory.value = productCategories.value[0] || "数值预报产品";
  }

  if (!filteredVariableOptions.value.some(item => item.key === selectedVariableKey.value)) {
    if (!variantApplied && props.variantIndex > 0 && filteredVariableOptions.value.length > 1) {
      selectedVariableKey.value = filteredVariableOptions.value[props.variantIndex % filteredVariableOptions.value.length]?.key || filteredVariableOptions.value[0]?.key;
      variantApplied = true;
    } else {
      selectedVariableKey.value = filteredVariableOptions.value[0]?.key || variableOptions.value[0].key;
    }
  }

  if (!levelOptions.value.some(item => item.key === selectedLevelKey.value)) {
    selectedLevelKey.value = levelOptions.value[0]?.key || "surface";
  }

  if (!resolutionOptions.value.some(item => item.key === selectedResolutionKey.value)) {
    selectedResolutionKey.value = resolutionOptions.value[0]?.key || "raw";
  }
}

function pickPayload(payload) {
  if (!payload) return null;
  return payload.data || payload;
}

function applyDisplayData(payload) {
  const data = pickPayload(payload);

  if (!data) {
    return;
  }

  display.value = data;
  syncSelection();
  pickedPoint.value = null;
  emitCurrentVariable();
}

async function loadGfsDisplay() {
  if (props.parsed) {
    applyDisplayData(props.parsed);
    return;
  }

  loading.value = true;

  try {
    const displayType = sourceName.value === "ECMWF" ? "ECMWF" : "GFS";
    const response = await authedFetch(`${API_BASE}/api/display/${displayType}?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
    });

    const payload = await response.json();

    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(payload.detail || payload.message || `${sourceName.value} 图层数据读取失败`);
    }

    applyDisplayData(payload);
    error.value = "";
  } catch (err) {
    error.value = `${sourceName.value} 数据未加载`;
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function loadGrid() {
  const url = currentGridUrl.value;
  const expectedSize = gridWidth.value * gridHeight.value;
  const requestId = ++gridRequestId;

  if (!url || !expectedSize) {
    gridValues.value = null;
    gridError.value = "";
    renderLayer();
    return;
  }

  gridLoading.value = true;
  gridError.value = "";

  try {
    const response = await authedFetch(url, { cache: "no-store" });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `${sourceName.value} 数值矩阵读取失败`);
    }

    const buffer = await response.arrayBuffer();
    const values = new Float32Array(buffer);

    if (values.length !== expectedSize) {
      throw new Error(`${sourceName.value} 数值矩阵尺寸不匹配：${values.length} != ${expectedSize}`);
    }

    if (requestId !== gridRequestId) return;

    gridValues.value = values;
    renderLayer();
  } catch (err) {
    if (requestId !== gridRequestId) return;

    gridValues.value = null;
    gridError.value = `${sourceName.value} 数值矩阵未加载：${err.message}`;
    console.error(err);
    renderLayer();
  } finally {
    if (requestId === gridRequestId) {
      gridLoading.value = false;
    }
  }
}

function normalizeLonForExtent(lon, extent) {
  const [west, , east] = extent;
  let x = Number(lon);

  if (west >= 0 && east > 180 && x < 0) {
    x += 360;
  }

  return x;
}

function getValueAtLonLat(lon, lat) {
  if (!gridValues.value || !gridWidth.value || !gridHeight.value) {
    return null;
  }

  const [west, south, east, north] = imageExtent.value.map(Number);
  const xLon = normalizeLonForExtent(lon, imageExtent.value);
  const yLat = Number(lat);

  if (xLon < west || xLon > east || yLat < south || yLat > north) {
    return null;
  }

  const col = Math.round((xLon - west) / (east - west) * (gridWidth.value - 1));
  const row = Math.round((north - yLat) / (north - south) * (gridHeight.value - 1));

  if (row < 0 || row >= gridHeight.value || col < 0 || col >= gridWidth.value) {
    return null;
  }

  const idx = row * gridWidth.value + col;
  const value = gridValues.value[idx];

  if (!Number.isFinite(value) || value === gridMissing.value) {
    return { lon, lat, row, col, value: null, missing: true };
  }

  return { lon, lat, row, col, value, missing: false };
}

function setupClickHandler() {
  if (unregisterMapClick || typeof registerMapClick !== "function") return;

  unregisterMapClick = registerMapClick((payload) => {
    if (!payload) return;
    onPointPick(payload.lon, payload.lat);
  });
}

function destroyClickHandler() {
  if (typeof unregisterMapClick === "function") unregisterMapClick();
  unregisterMapClick = null;
}

function onPointPick(lon, lat) {
  const picked = getValueAtLonLat(lon, lat);

  if (!picked) {
    pickedPoint.value = null;
    return;
  }

  pickedPoint.value = {
    ...picked,
    variable: currentVariable.value?.label || currentVariable.value?.key || `${sourceName.value} field`,
    unit: displayUnit.value,
    time: currentTimeLabel.value,
    min: currentStepStats.value?.min,
    max: currentStepStats.value?.max,
    mean: currentStepStats.value?.mean,
  };
}

function isGlobalExtent(ext) {
  if (!Array.isArray(ext) || ext.length !== 4) return false;

  const [west, south, east, north] = ext.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value))) return false;

  return Math.abs(east - west) >= 350 && Math.abs(north - south) >= 170;
}

function normalizeExtentForFly(ext) {
  if (!Array.isArray(ext) || ext.length !== 4) return null;

  let [west, south, east, north] = ext.map(Number);

  if ([west, south, east, north].some(value => !Number.isFinite(value))) return null;
  if (south >= north) return null;

  if (isGlobalExtent([west, south, east, north])) {
    return DEFAULT_FOCUS_EXTENT;
  }

  if (west >= 0 && east > 180 && east <= 360) {
    west = west > 180 ? west - 360 : west;
    east = east > 180 ? east - 360 : east;
    if (west > east) return DEFAULT_FOCUS_EXTENT;
  }

  if (west >= east) return null;

  const dx = Math.max((east - west) * 0.18, 0.3);
  const dy = Math.max((north - south) * 0.18, 0.3);

  return [
    Math.max(-180, west - dx),
    Math.max(-85, south - dy),
    Math.min(180, east + dx),
    Math.min(85, north + dy),
  ];
}

function zoomToData() {
  const target = normalizeExtentForFly(imageExtent.value);
  if (!target) return;

  const key = target.map(value => Number(value).toFixed(4)).join(",");
  if (key === zoomedKey) return;
  zoomedKey = key;

  window.clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => {
    requestMapResize?.();
    flyToExtent?.(target);
  }, 120);
}

function finiteRange(values) {
  const fixedMin = Number(renderColorRange.value.min);
  const fixedMax = Number(renderColorRange.value.max);

  if (Number.isFinite(fixedMin) && Number.isFinite(fixedMax) && Math.abs(fixedMax - fixedMin) > 1e-9) {
    return { min: fixedMin, max: fixedMax };
  }

  let min = Infinity;
  let max = -Infinity;
  const step = Math.max(1, Math.floor(values.length / 200000));

  for (let i = 0; i < values.length; i += step) {
    const v = Number(values[i]);
    if (!Number.isFinite(v) || v === gridMissing.value) continue;

    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 1e-9) {
    return { min: 0, max: 1 };
  }

  return { min, max };
}

function colorRamp(t, points) {
  const x = Math.max(0, Math.min(1, t));

  if (x <= 0) return points[0];
  if (x >= 1) return points[points.length - 1];

  const scaled = x * (points.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;

  const a = points[i];
  const b = points[i + 1];

  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    Math.round(a[3] + (b[3] - a[3]) * f),
  ];
}

function paletteForType(type) {
  // 降水：白/浅蓝/蓝/绿/黄/橙/红，弱降水也能看出来。
  if (type === "precipitation") {
    return [
      [248, 250, 252, 35],
      [191, 219, 254, 150],
      [59, 130, 246, 180],
      [34, 197, 94, 205],
      [250, 204, 21, 225],
      [249, 115, 22, 235],
      [220, 38, 38, 245],
    ];
  }

  // 气压：紫-蓝-青-绿-黄-橙-红，配合后端窄色标，压强梯度更明显。
  if (type === "pressure") {
    return [
      [76, 29, 149, 175],
      [37, 99, 235, 195],
      [6, 182, 212, 205],
      [34, 197, 94, 215],
      [250, 204, 21, 230],
      [249, 115, 22, 238],
      [220, 38, 38, 245],
    ];
  }

  if (type === "wind") {
    return [
      [224, 242, 254, 130],
      [56, 189, 248, 175],
      [37, 99, 235, 200],
      [124, 58, 237, 220],
      [239, 68, 68, 238],
    ];
  }

  // 温度/露点：深蓝-青-绿-黄-橙-红，高低温对比更清楚。
  return [
    [30, 58, 138, 175],
    [14, 165, 233, 195],
    [34, 197, 94, 205],
    [250, 204, 21, 225],
    [249, 115, 22, 235],
    [220, 38, 38, 245],
  ];
}

function renderBinaryToCanvas(values) {
  const width = gridWidth.value;
  const height = gridHeight.value;
  const canvas = renderCanvas.value;

  if (!canvas || !values || !width || !height) {
    return "";
  }

  const requestId = ++renderRequestId;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  const image = ctx.createImageData(width, height);
  const out = image.data;
  const { min, max } = finiteRange(values);
  const palette = paletteForType(renderVarType.value);

  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    const j = i * 4;

    if (!Number.isFinite(v) || v === gridMissing.value) {
      out[j] = 0;
      out[j + 1] = 0;
      out[j + 2] = 0;
      out[j + 3] = 0;
      continue;
    }

    let t = (v - min) / (max - min);

    if (renderVarType.value === "precipitation" && v <= 0.0001) {
      out[j] = 248;
      out[j + 1] = 250;
      out[j + 2] = 252;
      out[j + 3] = 30;
      continue;
    }

    const c = colorRamp(t, palette);
    out[j] = c[0];
    out[j + 1] = c[1];
    out[j + 2] = c[2];
    out[j + 3] = c[3];
  }

  if (requestId !== renderRequestId) {
    return "";
  }

  ctx.putImageData(image, 0, 0);

  return canvas.toDataURL("image/png");
}

function renderPngFallback() {
  const url = currentImageUrl.value;

  if (!url) {
    surface?.setData?.(null);
    return;
  }

  surface?.setData?.(url, imageExtent.value, props.alpha);
}

function renderLayer() {
  if (gridValues.value && gridWidth.value && gridHeight.value) {
    const url = renderBinaryToCanvas(gridValues.value);
    if (url) {
      surface?.setData?.(url, imageExtent.value, props.alpha);
      return;
    }
  }

  renderPngFallback();
}

function emitCurrentVariable() {
  if (!currentLayer.value) return;

  const payload = {
    source: sourceName.value,
    business_type: sourceName.value,
    data_type: sourceName.value,
    file: resolvedFile.value,
    element: currentLayer.value.element || currentLayer.value.label || legendTitle.value,
    time: currentTimeLabel.value,
    level: currentLayer.value.level || "",
    range: currentLayer.value.range || "",
    grid: currentLayer.value.grid?.text || currentLayer.value.gridText || "",
    missing: currentLayer.value.missingText || "",
    unit: displayUnit.value,
    vars: variableOptions.value.map(item => item.label || item.key).join("、"),
    steps: currentLayer.value.steps || String(frameCount.value),
    status: "解析成功",
    quality: currentLayer.value.quality || "",
    max: currentStepStats.value?.max,
    min: currentStepStats.value?.min,
    mean: currentStepStats.value?.mean,
    alert: currentLayer.value.alert || "无",
    extent: imageExtent.value,

    render_mode: binaryReady.value ? "binary" : renderModeText.value.replace("预览", "").toLowerCase(),
    png_url: String(currentImageUrl.value || "").toLowerCase().includes(".png") ? currentImageUrl.value : "",
    png_urls: currentPngUrls.value.filter(url => String(url).toLowerCase().includes(".png")),
    webp_url: String(currentImageUrl.value || "").toLowerCase().includes(".webp") ? currentImageUrl.value : "",
    webp_urls: currentPngUrls.value.filter(url => String(url).toLowerCase().includes(".webp")),
    image_url: currentImageUrl.value,
    image_urls: currentPngUrls.value,
    image_format: String(currentImageUrl.value || "").toLowerCase().includes(".webp") ? "webp" : "png",
    resolution_key: selectedResolutionKey.value,
    resolution_label: resolutionOptions.value.find(item => item.key === selectedResolutionKey.value)?.label || "原始分辨率",

    grid_url: currentGridUrl.value,
    grid_urls: currentGridUrls.value,
    binary_layer: currentBinaryLayer.value,
    binary_layers: {
      [currentBinaryLayer.value.key]: currentBinaryLayer.value,
    },
    dtype: "float32",
    endian: "little",
    shape: [gridHeight.value, gridWidth.value],
    width: gridWidth.value,
    height: gridHeight.value,

    times: currentTimes.value,
    valid_hours: currentValidHours.value,
    valid_time_hours: currentValidHours.value,
    forecast_hours: currentForecastHours.value,
    forecast_labels: currentForecastHours.value.map(hour => `F${String(hour).padStart(3, "0")}`),
    axis_times: defaultBusinessAxisTimes(),
    color_range: renderColorRange.value,
    varType: renderVarType.value,
  };

  emit("variable-change", payload);
  emit("display-loaded", {
    ...display.value,
    file: resolvedFile.value,
    product: currentVariable.value,
    level: currentLayer.value?.level || "",
    render_mode: payload.render_mode,
    binary_layer: payload.binary_layer,
    binary_layers: payload.binary_layers,
    meta: {
      ...payload,
      business_type: sourceName.value,
      data_type: sourceName.value,
      weather_info: payload,
    },
  });
}

function formatStat(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  const n = Number(value);
  return Math.abs(n) >= 10 ? n.toFixed(2) : n.toFixed(3);
}

watch(
  () => props.parsed,
  value => {
    if (value) {
      applyDisplayData(value);
    }
  },
  { immediate: true, deep: true }
);

watch(variableOptions, syncSelection);

watch(selectedProductCategory, () => {
  syncSelection();
});

watch(selectedVariableKey, () => {
  syncSelection();
  pickedPoint.value = null;
  emitCurrentVariable();
});

watch(selectedResolutionKey, () => {
  pickedPoint.value = null;
  gridValues.value = null;
  loadGrid();
  emitCurrentVariable();
  renderLayer();
});

watch(currentDisplayLayer, () => {
  pickedPoint.value = null;
  emitCurrentVariable();
});

watch(
  () => [currentVariable.value?.key, selectedResolutionKey.value, safeIndex.value, currentGridUrl.value, gridWidth.value, gridHeight.value],
  () => {
    pickedPoint.value = null;
    loadGrid();
    emitCurrentVariable();
  },
  { immediate: true }
);

watch(
  () => [currentImageUrl.value, imageExtent.value?.join(","), currentVariable.value?.key, selectedResolutionKey.value, currentLayer.value?.level],
  () => {
    zoomToData();
    setupClickHandler();
    if (!currentGridUrl.value) {
      renderPngFallback();
    }
  },
  { immediate: true }
);

watch(
  () => [renderColorRange.value.min, renderColorRange.value.max, renderVarType.value, props.alpha],
  () => {
    renderLayer();
  }
);

watch(
  () => sourceName.value,
  () => {
    display.value = null;
    error.value = "";
    gridError.value = "";
    pickedPoint.value = null;
    selectedResolutionKey.value = "raw";
    loadGfsDisplay();
  }
);

onMounted(() => {
  loadGfsDisplay();
  setupClickHandler();
  timer = window.setInterval(loadGfsDisplay, 30000);
});

onBeforeUnmount(() => {
  if (timer) {
    window.clearInterval(timer);
  }

  destroyClickHandler();
  window.clearTimeout(zoomTimer);
  surface?.clear?.();
});
</script>

<style scoped>
.gfs-render-canvas {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.gfs-current {
  display: grid;
  gap: 2px;
  margin-top: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.42);
  color: #cbd5e1;
  font-size: 10px;
}

.gfs-current b {
  color: #e5e7eb;
  font-size: 12px;
  font-weight: 700;
}

.gfs-current small {
  color: #94a3b8;
  line-height: 1.35;
}

.gfs-stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 7px;
  font-size: 10px;
  color: #cbd5e1;
}

.gfs-stat-row span {
  padding: 4px 5px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.38);
  text-align: center;
  white-space: nowrap;
}

.gfs-stat-row em {
  grid-column: 1 / -1;
  color: #94a3b8;
  font-style: normal;
  text-align: right;
}

.gfs-status {
  margin-top: 6px;
  font-size: 10px;
  color: #86efac;
  line-height: 1.4;
}

.gfs-status:empty {
  display: none;
}

.gfs-status.error {
  color: #fca5a5;
}

.gfs-pick {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  font-size: 10px;
  color: #cbd5e1;
}

.gfs-pick b {
  display: block;
  margin-bottom: 5px;
  color: #e5e7eb;
  font-size: 11px;
}

.gfs-pick p {
  margin: 3px 0;
}

.gfs-pick-hint {
  margin-top: 8px;
  color: #94a3b8;
  font-size: 10px;
  line-height: 1.45;
}
</style>
