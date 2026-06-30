<template>
  <!-- GFS 展示使用后端 PNG；float32 只用于点查，避免 WebglLayer 用雷达色标渲染降水/气压。 -->
  <WebglLayer
    :src="currentImageUrl"
    :extent="imageExtent"
    :values="null"
    :width="0"
    :height="0"
    :product="currentVariable?.key"
    :missing="gridMissing"
  />

  <LayerCard
    :badge="label || 'GFS·ECMWF'"
    :file="resolvedFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
  >
    <template v-if="variableOptions.length">
      <label class="lc-row">
        <span>产品类型</span>
        <select v-model="selectedProductCategory">
          <option v-for="item in productCategories" :key="item" :value="item">{{ item }}</option>
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

      <div class="gfs-current">
        <span>当前时次</span>
        <b>{{ currentTimeLabel }}</b>
        <small>{{ safeIndex + 1 }} / {{ currentPngUrls.length }} · {{ statusText }}</small>
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
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

/*
  刘家鹤：GFS / ECMWF 数据层

  功能：
  1. 读取后端 /api/display/GFS 返回的 GFS/ECMWF 解析结果
  2. 支持后端 variable_options / variable_layers 多变量结构
  3. 左上角 LayerCard 风格变量选择
  4. 根据底部时间轴 timeIndex 切换当前变量的多时次 PNG
  5. 支持全球 GFS extent: [0, -90, 359.75, 90]
  6. 兼容旧版后端只返回 png_url / png_urls 的情况
*/

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: { type: String, default: "GFS·ECMWF" },
  file: String,

  // Overview.vue 传入的当前解析结果
  parsed: {
    type: Object,
    default: null
  },

  // Overview.vue 底部时间轴传入的时次索引
  timeIndex: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(["variable-change", "display-loaded"]);

const API_BASE = "http://127.0.0.1:8002";
const FALLBACK_EXTENT = [0, -90, 359.75, 90];
const FALLBACK_IMAGE = `${API_BASE}/data/GFS/053031.grib.png`;
const DEFAULT_MISSING = -9999;

const flyToExtent = inject("flyToExtent", null);
const requestMapResize = inject("requestMapResize", null);
const registerMapClick = inject("registerMapClick", null);
const DEFAULT_FOCUS_EXTENT = [73, 15, 135, 55];

const display = ref(null);
const error = ref("");
const loading = ref(false);

const selectedProductCategory = ref("");
const selectedVariableKey = ref("");
const selectedLevelKey = ref("surface");

const gridValues = shallowRef(null);
const gridLoading = ref(false);
const gridError = ref("");
let gridRequestId = 0;

const pickedPoint = ref(null);

let timer = null;
let zoomedKey = "";
let unregisterMapClick = null;
let zoomTimer = null;

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

  // 兼容旧接口：只有一个默认 PNG 图层时，也伪造成一个变量层
  const info = data.weather_info || data.meta_json?.weather_info || data.meta || data.meta_json?.meta || {};
  const urls =
    data.png_urls ||
    info.png_urls ||
    data.extra?.png_urls ||
    data.meta_json?.png_urls ||
    [];

  const singleUrl =
    data.png_url ||
    info.png_url ||
    data.extra?.png_url ||
    data.meta_json?.png_url ||
    "";

  return {
    default: {
      key: "default",
      label: info.mainVariableName || info.element || "GFS field",
      element: info.element || "GFS field",
      unit: info.unit || info.displayUnit || "",
      level: info.level || "surface",
      time: info.time || "",
      times: info.times || data.times || [],
      extent: info.extent || data.extent || FALLBACK_EXTENT,
      png_urls: Array.isArray(urls) && urls.length ? urls : [singleUrl || FALLBACK_IMAGE],
      min: info.min,
      max: info.max,
      mean: info.mean,
      missing: DEFAULT_MISSING,
      missingText: info.missing,
      grid: info.gridShape || null,
      range: info.range,
      quality: info.quality,
      alert: info.alert,
      gradient: "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)",
      legend_ticks: ["低", "较低", "中", "较高", "高"]
    }
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
      ...item
    }));
  }

  return Object.entries(variableLayers.value).map(([key, layer]) => ({
    key,
    label: layer.label || layer.element || key,
    unit: layer.unit || layer.displayUnit || "",
    varType: layer.varType || "generic"
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

const levelOptions = computed(() => {
  const levelText =
    currentLayer.value?.level ||
    currentLayer.value?.typeOfLevel ||
    currentLayer.value?.GRIB_typeOfLevel ||
    "surface";

  return [
    {
      key: "surface",
      label: levelText
    }
  ];
});

const currentPngUrls = computed(() => {
  const urls = currentLayer.value?.png_urls || currentLayer.value?.pngUrls || [];
  const normalized = urls.map(toPublicUrl).filter(Boolean);

  if (normalized.length) {
    return normalized;
  }

  const single = toPublicUrl(currentLayer.value?.png_url || currentLayer.value?.png || props.src);
  return single ? [single] : [FALLBACK_IMAGE];
});

const imageExtent = computed(() => {
  const candidate =
    props.extent ||
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

const safeIndex = computed(() => {
  const count = currentPngUrls.value.length;

  if (!count) {
    return 0;
  }

  const idx = Number.isFinite(props.timeIndex)
    ? Math.floor(props.timeIndex)
    : 0;

  return ((idx % count) + count) % count;
});

const currentImageUrl = computed(() => {
  return currentPngUrls.value[safeIndex.value] || FALLBACK_IMAGE;
});

const currentTimes = computed(() => {
  const times = currentLayer.value?.times || [];

  if (Array.isArray(times) && times.length) {
    return times.map(String);
  }

  return Array.from(
    { length: currentPngUrls.value.length },
    (_, i) => `step${String(i).padStart(3, "0")}`
  );
});

const currentRawTimeLabel = computed(() => {
  return currentTimes.value[safeIndex.value] || `step${String(safeIndex.value).padStart(3, "0")}`;
});

const currentForecastLabel = computed(() => {
  const labels = currentLayer.value?.forecast_labels || currentLayer.value?.forecastLabels || [];
  return labels[safeIndex.value] || `F${String(safeIndex.value).padStart(3, "0")}`;
});

const currentForecastHours = computed(() => {
  const hours = currentLayer.value?.forecast_hours || currentLayer.value?.forecastHours || [];
  if (Array.isArray(hours) && hours.length) {
    return hours.map((v, i) => parseForecastHourValue(v, i));
  }

  const labels = currentLayer.value?.forecast_labels || currentLayer.value?.forecastLabels || [];
  if (Array.isArray(labels) && labels.length) {
    return labels.map((v, i) => parseForecastHourValue(v, i));
  }

  return currentPngUrls.value.map((_, i) => i);
});

const currentTimeLabel = computed(() => {
  return `${currentForecastLabel.value} · ${formatTimeLabel(currentRawTimeLabel.value)}`;
});

const gridWidth = computed(() => {
  return Number(currentLayer.value?.grid?.nx || currentLayer.value?.gridShape?.nx || 0);
});

const gridHeight = computed(() => {
  return Number(currentLayer.value?.grid?.ny || currentLayer.value?.gridShape?.ny || 0);
});

const gridMissing = computed(() => {
  return Number(currentLayer.value?.missing ?? DEFAULT_MISSING);
});

const currentGridUrl = computed(() => {
  const urls = currentLayer.value?.grid_urls || currentLayer.value?.gridUrls || [];
  const url = urls[safeIndex.value] || "";
  return toPublicUrl(url);
});

const currentStepStats = computed(() => {
  const stats = currentLayer.value?.step_stats || currentLayer.value?.stepStats || [];

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
    "GFS realtime"
  );
});

const displayUnit = computed(() => {
  return currentLayer.value?.unit || currentVariable.value?.unit || currentLayer.value?.displayUnit || "";
});

const legendTitle = computed(() => {
  const label = currentVariable.value?.label || currentLayer.value?.label || currentLayer.value?.element || "GFS field";
  const unit = displayUnit.value;
  return unit ? `${label} (${unit})` : label;
});

const gradient = computed(() => {
  return (
    currentLayer.value?.gradient ||
    currentVariable.value?.gradient ||
    gradientByVarType(currentLayer.value?.varType || currentVariable.value?.varType)
  );
});

const ticks = computed(() => {
  if (Array.isArray(currentLayer.value?.legend_ticks) && currentLayer.value.legend_ticks.length) {
    return currentLayer.value.legend_ticks;
  }

  const min = Number(currentLayer.value?.min);
  const max = Number(currentLayer.value?.max);

  if (Number.isFinite(min) && Number.isFinite(max) && Math.abs(max - min) > 1e-9) {
    return Array.from({ length: 5 }, (_, i) => {
      const value = min + (max - min) * i / 4;
      return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
    });
  }

  return ["低", "较低", "中", "较高", "高"];
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

function formatTimeLabel(value) {
  if (!value) return "—";

  const text = String(value);
  const match = text.match(/(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);

  if (match) {
    return `${match[1]}-${match[2]} ${match[3]}:${match[4]}`;
  }

  return text.length > 16 ? text.slice(0, 16) : text;
}

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
    : `${API_BASE}/data/GFS/${normalized}`;
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

function defaultBusinessAxisTimes() {
  return ["00时", "02时", "04时", "06时", "08时", "10时", "12时", "14时", "16时", "18时", "20时", "22时"];
}

function syncSelection() {
  if (!variableOptions.value.length) return;

  if (!productCategories.value.includes(selectedProductCategory.value)) {
    selectedProductCategory.value = productCategories.value[0] || "数值预报产品";
  }

  if (!filteredVariableOptions.value.some(item => item.key === selectedVariableKey.value)) {
    selectedVariableKey.value = filteredVariableOptions.value[0]?.key || variableOptions.value[0].key;
  }

  if (!levelOptions.value.some(item => item.key === selectedLevelKey.value)) {
    selectedLevelKey.value = levelOptions.value[0]?.key || "surface";
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
    const response = await fetch(`${API_BASE}/api/display/GFS?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store"
    });

    const payload = await response.json();

    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(payload.detail || payload.message || "GFS/ECMWF 图层数据读取失败");
    }

    applyDisplayData(payload);
    error.value = "";
  } catch (err) {
    error.value = "GFS/ECMWF 数据未加载";
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
    return;
  }

  gridLoading.value = true;
  gridError.value = "";

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || "GFS 数值矩阵读取失败");
    }

    const buffer = await response.arrayBuffer();
    const values = new Float32Array(buffer);

    if (values.length !== expectedSize) {
      throw new Error(`GFS 数值矩阵尺寸不匹配：${values.length} != ${expectedSize}`);
    }

    if (requestId !== gridRequestId) return;

    gridValues.value = values;
  } catch (err) {
    if (requestId !== gridRequestId) return;

    gridValues.value = null;
    gridError.value = `GFS 数值矩阵未加载：${err.message}`;
    console.error(err);
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
    variable: currentVariable.value?.label || currentVariable.value?.key || "GFS field",
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

  // 全球 GFS 是 0~359.75，业务系统默认聚焦中国—东亚，而不是飞到整个地球。
  if (isGlobalExtent([west, south, east, north])) {
    return DEFAULT_FOCUS_EXTENT;
  }

  // 0~360 经度转换为 -180~180，避免 ProjMap 的 wrapPi 处理异常。
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

function emitCurrentVariable() {
  if (!currentLayer.value) return;

  const payload = {
    file: resolvedFile.value,
    element: currentLayer.value.element || currentLayer.value.label || legendTitle.value,
    time: currentTimeLabel.value,
    level: currentLayer.value.level || "",
    range: currentLayer.value.range || "",
    grid: currentLayer.value.grid?.text || currentLayer.value.gridText || "",
    missing: currentLayer.value.missingText || "",
    unit: displayUnit.value,
    vars: variableOptions.value.map(item => item.label || item.key).join("、"),
    steps: currentLayer.value.steps || String(currentPngUrls.value.length),
    status: "解析成功",
    quality: currentLayer.value.quality || "",
    max: currentStepStats.value?.max,
    min: currentStepStats.value?.min,
    mean: currentStepStats.value?.mean,
    alert: currentLayer.value.alert || "无",
    extent: imageExtent.value,
    png_url: currentImageUrl.value,
    png_urls: currentPngUrls.value,
    times: currentTimes.value,
    forecast_hours: currentForecastHours.value,
    forecast_labels: currentForecastHours.value.map(hour => `F${String(hour).padStart(3, "0")}`),
    axis_times: defaultBusinessAxisTimes(),
  };

  emit("variable-change", payload);
  emit("display-loaded", {
    ...display.value,
    file: resolvedFile.value,
    product: currentVariable.value,
    level: currentLayer.value?.level || "",
    meta: {
      ...payload,
      business_type: "GFS/ECMWF",
      data_type: "GFS/ECMWF",
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
watch(selectedVariableKey, () => {
  syncSelection();
  pickedPoint.value = null;
  emitCurrentVariable();
});
watch(currentLayer, () => {
  pickedPoint.value = null;
  emitCurrentVariable();
});
watch(
  () => [currentVariable.value?.key, safeIndex.value, currentGridUrl.value],
  () => {
    pickedPoint.value = null;
    loadGrid();
    emitCurrentVariable();
  },
  { immediate: true }
);
watch(
  () => [currentImageUrl.value, imageExtent.value?.join(","), currentVariable.value?.key, currentLayer.value?.level],
  () => {
    zoomToData();
    setupClickHandler();
  },
  { immediate: true }
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
});
</script>

<style scoped>
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
