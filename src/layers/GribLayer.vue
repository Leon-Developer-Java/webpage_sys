<template>
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
          <option v-for="item in levelOptions" :key="item.key" :value="item.key">
            {{ item.label }}
          </option>
        </select>
      </label>

      <div class="gfs-current">
        <span>当前时次</span>
        <b>{{ currentTimeLabel }}</b>
        <small>
          {{ safeIndex + 1 }} / {{ frameCount }}
          · WEBP
          · {{ statusText }}
        </small>
      </div>

      <div class="gfs-stat-row">
        <span>Min {{ formatStat(currentStepStats?.min) }}</span>
        <span>Mean {{ formatStat(currentStepStats?.mean) }}</span>
        <span>Max {{ formatStat(currentStepStats?.max) }}</span>
        <em>{{ displayUnit }}</em>
      </div>

      <div class="gfs-status" :class="{ error: !!error }">
        {{ error || statusText }}
      </div>
    </template>

    <template v-else>
      <div class="gfs-status" :class="{ error: !!error }">
        {{ error || statusText }}
      </div>
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
  variantIndex: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["variable-change", "display-loaded"]);

const API_BASE = "http://127.0.0.1:8002";
const FALLBACK_EXTENT = [-180, -90, 179.75, 90];
const DEFAULT_FOCUS_EXTENT = [73, 15, 135, 55];

const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const requestMapResize = inject("requestMapResize", null);

const display = ref(null);
const loading = ref(false);
const error = ref("");

const selectedProductCategory = ref("");
const selectedVariableKey = ref("");
const selectedLevelKey = ref("surface");

let refreshTimer = null;
let zoomTimer = null;
let zoomedKey = "";
let variantApplied = false;
let displayRequestId = 0;

const sourceName = computed(() => {
  const candidates = [
    props.dataType,
    props.parsed?.business_type,
    props.parsed?.data_type,
    props.parsed?.source,
    props.parsed?.weather_info?.source,
  ];
  const text = candidates.map(value => String(value || "").toUpperCase()).join(" ");
  return text.includes("ECMWF") || text.includes("IFS") ? "ECMWF" : "GFS";
});

const variableLayers = computed(() => {
  const data = display.value || {};
  const layers = data.variable_layers || {};
  return layers && typeof layers === "object" ? layers : {};
});

const variableOptions = computed(() => {
  const data = display.value || {};
  const options = Array.isArray(data.variable_options) ? data.variable_options : [];

  if (options.length) {
    return options.map(item => ({
      key: String(item.key),
      label: item.label || item.element || String(item.key),
      unit: item.unit || item.displayUnit || "",
      varType: item.varType || "generic",
      productCategory:
        item.productCategory ||
        item.productType ||
        categoryByVarType(item.varType),
      ...item,
    }));
  }

  return Object.entries(variableLayers.value).map(([key, layer]) => ({
    key,
    label: layer.label || layer.element || key,
    unit: layer.unit || layer.displayUnit || "",
    varType: layer.varType || "generic",
    productCategory:
      layer.productCategory ||
      layer.productType ||
      categoryByVarType(layer.varType),
  }));
});

const productCategories = computed(() => {
  return [
    ...new Set(
      variableOptions.value
        .map(item => item.productCategory || categoryByVarType(item.varType))
        .filter(Boolean)
    ),
  ];
});

const filteredVariableOptions = computed(() => {
  if (!selectedProductCategory.value) return variableOptions.value;
  return variableOptions.value.filter(item => {
    const category =
      item.productCategory ||
      item.productType ||
      categoryByVarType(item.varType);
    return category === selectedProductCategory.value;
  });
});

const currentVariable = computed(() => {
  return (
    filteredVariableOptions.value.find(
      item => item.key === selectedVariableKey.value
    ) ||
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
  const layer = currentLayer.value || {};
  const levelText =
    layer.level ||
    layer.typeOfLevel ||
    layer.GRIB_typeOfLevel ||
    "surface";

  return [{ key: "surface", label: levelText }];
});

const currentFrames = computed(() => {
  const layer = currentLayer.value || {};

  if (Array.isArray(layer.frames) && layer.frames.length) {
    return layer.frames
      .map((frame, index) => ({
        index,
        forecast_hour:
          Number.isFinite(Number(frame.forecast_hour))
            ? Number(frame.forecast_hour)
            : index,
        forecast_label:
          frame.forecast_label ||
          `F${String(
            Number.isFinite(Number(frame.forecast_hour))
              ? Number(frame.forecast_hour)
              : index
          ).padStart(3, "0")}`,
        valid_time:
          frame.valid_time ||
          layer.times?.[index] ||
          `step${String(index).padStart(3, "0")}`,
        url: toPublicUrl(frame.url),
        stats: frame.stats || {},
      }))
      .filter(frame => frame.url);
  }

  // 仅兼容当前 v2 接口的 image_urls；不再兼容 PNG、二进制和差分字段。
  const urls = Array.isArray(layer.image_urls)
    ? layer.image_urls.map(toPublicUrl).filter(Boolean)
    : [];
  const times = Array.isArray(layer.times) ? layer.times : [];
  const hours = Array.isArray(layer.forecast_hours)
    ? layer.forecast_hours
    : [];

  return urls.map((url, index) => ({
    index,
    forecast_hour: Number.isFinite(Number(hours[index]))
      ? Number(hours[index])
      : index,
    forecast_label: `F${String(
      Number.isFinite(Number(hours[index])) ? Number(hours[index]) : index
    ).padStart(3, "0")}`,
    valid_time: times[index] || `step${String(index).padStart(3, "0")}`,
    url,
    stats: {},
  }));
});

const frameCount = computed(() => Math.max(currentFrames.value.length, 1));

const safeIndex = computed(() => {
  const count = frameCount.value;
  const index = Number.isFinite(props.timeIndex)
    ? Math.floor(props.timeIndex)
    : 0;
  return ((index % count) + count) % count;
});

const currentFrame = computed(() => {
  return currentFrames.value[safeIndex.value] || currentFrames.value[0] || null;
});

const currentImageUrl = computed(() => {
  return (
    currentFrame.value?.url ||
    toPublicUrl(currentLayer.value?.image_url) ||
    toPublicUrl(display.value?.image_url) ||
    toPublicUrl(props.src)
  );
});

const imageExtent = computed(() => {
  const candidate =
    props.extent ||
    currentLayer.value?.extent ||
    display.value?.extent ||
    FALLBACK_EXTENT;

  if (Array.isArray(candidate) && candidate.length === 4) {
    const values = candidate.map(Number);
    if (values.every(Number.isFinite)) return values;
  }

  return FALLBACK_EXTENT;
});

const currentStepStats = computed(() => {
  const frameStats = currentFrame.value?.stats;
  if (frameStats && typeof frameStats === "object") {
    return {
      min: frameStats.min,
      mean: frameStats.mean,
      max: frameStats.max,
    };
  }

  return {
    min: currentLayer.value?.min,
    mean: currentLayer.value?.mean,
    max: currentLayer.value?.max,
  };
});

const currentForecastHours = computed(() => {
  return currentFrames.value.map((frame, index) => {
    const value = Number(frame.forecast_hour);
    return Number.isFinite(value) ? value : index;
  });
});

const currentTimes = computed(() => {
  return currentFrames.value.map(
    (frame, index) =>
      frame.valid_time || `step${String(index).padStart(3, "0")}`
  );
});

const currentValidHours = computed(() => {
  return currentTimes.value.map((value, index) =>
    parseValidHour(value, index)
  );
});

const currentTimeLabel = computed(() => {
  if (!currentFrame.value) return "—";
  return `${currentFrame.value.forecast_label} · ${formatTimeLabel(
    currentFrame.value.valid_time
  )}`;
});

const weatherInfo = computed(() => {
  const data = display.value || {};
  return data.weather_info || data.meta?.weather_info || {};
});

function extractGribFileName(value) {
  if (!value) return "";

  let text = String(value)
    .replaceAll("\\", "/")
    .split("?")[0]
    .split("#")[0];

  try {
    text = decodeURIComponent(text);
  } catch {
    // URL 解码失败时继续使用原字符串。
  }

  let name = text.split("/").pop() || "";

  // xxx.grib2.meta.json -> xxx.grib2
  name = name.replace(/\.meta\.json$/i, "");

  // xxx.grib2_t2m_step000.webp -> xxx.grib2
  const match = name.match(/^(.+\.(?:grib2|grib|grb2|grb))/i);
  if (match) return match[1];

  if (/\.(?:grib2|grib|grb2|grb)$/i.test(name)) {
    return name;
  }

  return "";
}

const resolvedFile = computed(() => {
  const data = display.value || {};
  const meta =
    data.meta && typeof data.meta === "object"
      ? data.meta
      : {};
  const info =
    data.weather_info ||
    meta.weather_info ||
    {};

  const candidates = [
    props.file,

    data.file_name,
    data.filename,
    data.file,

    meta.file_name,
    meta.filename,
    meta.file,

    info.file_name,
    info.filename,
    info.file,

    data.meta_url,
    meta.meta_url,

    currentLayer.value?.image_url,
    currentFrame.value?.url,
    data.image_url,

    currentLayer.value?.frames?.[0]?.url,
    data.image_urls?.[0],
  ];

  for (const candidate of candidates) {
    const fileName = extractGribFileName(candidate);
    if (fileName) return fileName;
  }

  return `${sourceName.value} realtime`;
});

const displayUnit = computed(() => {
  return (
    currentLayer.value?.unit ||
    currentVariable.value?.unit ||
    currentLayer.value?.displayUnit ||
    ""
  );
});

const displayResolution = computed(() => {
  return (
    currentLayer.value?.resolution ||
    display.value?.resolution ||
    weatherInfo.value?.resolution ||
    "—"
  );
});

const renderVarType = computed(() => {
  return String(
    currentLayer.value?.varType ||
    currentVariable.value?.varType ||
    "generic"
  );
});

const renderColorRange = computed(() => {
  const range =
    currentLayer.value?.color_range ||
    currentLayer.value?.colorRange ||
    {};

  return {
    min: Number(range.min ?? currentLayer.value?.min),
    max: Number(range.max ?? currentLayer.value?.max),
    mode: range.mode || "auto",
  };
});

const legendTitle = computed(() => {
  const label =
    currentVariable.value?.label ||
    currentLayer.value?.label ||
    currentLayer.value?.element ||
    `${sourceName.value} field`;

  return displayUnit.value ? `${label} (${displayUnit.value})` : label;
});

const gradient = computed(() => {
  return (
    currentLayer.value?.gradient ||
    currentVariable.value?.gradient ||
    gradientByVarType(renderVarType.value)
  );
});

const ticks = computed(() => {
  const configured = currentLayer.value?.legend_ticks;
  if (Array.isArray(configured) && configured.length) return configured;

  const min = Number(renderColorRange.value.min);
  const max = Number(renderColorRange.value.max);

  if (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    Math.abs(max - min) > 1e-9
  ) {
    return Array.from({ length: 5 }, (_, index) => {
      const value = min + ((max - min) * index) / 4;
      return Math.abs(value) >= 10
        ? value.toFixed(0)
        : value.toFixed(1);
    });
  }

  return ["低", "较低", "中", "较高", "高"];
});

const statusText = computed(() => {
  if (loading.value) return "图层读取中";

  const gridText =
    currentLayer.value?.grid?.text ||
    currentLayer.value?.gridText ||
    display.value?.grid?.text ||
    "";

  const levelText = currentLayer.value?.level || "";

  return (
    [levelText, gridText ? `网格 ${gridText}` : ""]
      .filter(Boolean)
      .join(" · ") || "已加载"
  );
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

function toPublicUrl(path) {
  if (!path) return "";

  const text = String(path);
  if (/^https?:\/\//i.test(text) || text.startsWith("data:")) {
    return text;
  }

  const normalized = text.replaceAll("\\", "/");
  const index = normalized.indexOf("/data/");

  if (index >= 0) {
    return `${API_BASE}${normalized.slice(index)}`;
  }

  if (normalized.startsWith("/")) {
    return `${API_BASE}${normalized}`;
  }

  return `${API_BASE}/data/${sourceName.value}/${normalized}`;
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

function parseValidHour(value, fallbackIndex = 0) {
  const text = String(value || "");

  const iso = text.match(/T(\d{1,2}):\d{2}/);
  if (iso) return Number(iso[1]);

  const regular = text.match(/(\d{1,2}):\d{2}/);
  if (regular) return Number(regular[1]);

  return fallbackIndex;
}

function defaultBusinessAxisTimes() {
  return Array.from(
    { length: 24 },
    (_, index) => `${String(index).padStart(2, "0")}时`
  );
}

function syncSelection() {
  if (!variableOptions.value.length) return;

  if (!productCategories.value.includes(selectedProductCategory.value)) {
    selectedProductCategory.value =
      productCategories.value[0] || "数值预报产品";
  }

  if (
    !filteredVariableOptions.value.some(
      item => item.key === selectedVariableKey.value
    )
  ) {
    if (
      !variantApplied &&
      props.variantIndex > 0 &&
      filteredVariableOptions.value.length > 1
    ) {
      selectedVariableKey.value =
        filteredVariableOptions.value[
          props.variantIndex % filteredVariableOptions.value.length
        ]?.key || filteredVariableOptions.value[0]?.key;
      variantApplied = true;
    } else {
      selectedVariableKey.value =
        filteredVariableOptions.value[0]?.key ||
        variableOptions.value[0]?.key ||
        "";
    }
  }

  if (!levelOptions.value.some(item => item.key === selectedLevelKey.value)) {
    selectedLevelKey.value = levelOptions.value[0]?.key || "surface";
  }
}

function pickPayload(payload) {
  return payload?.data || payload || null;
}

function applyDisplayData(payload) {
  const raw = pickPayload(payload);
  if (!raw) return;

  /*
   * 在线展示接口通常直接返回 compact meta v2；
   * 上传接口可能返回 { file_name, business_type, meta, weather_info }。
   * 这里统一成 GribLayer 可以直接读取的结构，并保留外层文件名。
   */
  const nestedMeta =
    raw.meta &&
    typeof raw.meta === "object" &&
    (raw.meta.variable_layers || raw.meta.schema_version)
      ? raw.meta
      : null;

  display.value = nestedMeta
    ? {
        ...nestedMeta,
        file_name:
          raw.file_name ||
          raw.filename ||
          raw.file ||
          nestedMeta.file_name ||
          nestedMeta.filename ||
          nestedMeta.file ||
          "",
        file:
          raw.file ||
          raw.file_name ||
          nestedMeta.file ||
          nestedMeta.file_name ||
          "",
        business_type:
          raw.business_type ||
          nestedMeta.business_type ||
          nestedMeta.source ||
          sourceName.value,
        data_type:
          raw.data_type ||
          nestedMeta.data_type ||
          nestedMeta.source ||
          sourceName.value,
        source:
          raw.source ||
          nestedMeta.source ||
          raw.business_type ||
          sourceName.value,
        meta_url:
          raw.meta_url ||
          nestedMeta.meta_url ||
          "",
        weather_info:
          raw.weather_info ||
          nestedMeta.weather_info ||
          {},
      }
    : raw;

  syncSelection();
  renderLayer();
  emitCurrentVariable();
}

async function loadDisplay() {
  const requestId = ++displayRequestId;
  if (props.parsed) {
    applyDisplayData(props.parsed);
    return;
  }

  loading.value = true;

  try {
    const response = await authedFetch(
      `${API_BASE}/api/display/${sourceName.value}?t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );

    const payload = await response.json();

    if (requestId !== displayRequestId) return;

    if (
      !response.ok ||
      (payload.code !== undefined && payload.code !== 0)
    ) {
      throw new Error(
        payload.detail ||
        payload.message ||
        `${sourceName.value} 图层数据读取失败`
      );
    }

    applyDisplayData(payload);
    error.value = "";
  } catch (exception) {
    if (requestId !== displayRequestId) return;
    error.value = `${sourceName.value} 数据未加载`;
    console.error(exception);
    surface?.setData?.(null);
  } finally {
    if (requestId === displayRequestId) loading.value = false;
  }
}

function renderLayer() {
  const url = currentImageUrl.value;

  if (!url) {
    surface?.setData?.(null);
    return;
  }

  surface?.setData?.(url, imageExtent.value, props.alpha);
}

function isGlobalExtent(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return false;
  const [west, south, east, north] = extent.map(Number);
  return (
    [west, south, east, north].every(Number.isFinite) &&
    Math.abs(east - west) >= 350 &&
    Math.abs(north - south) >= 170
  );
}

function normalizeExtentForFly(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return null;

  let [west, south, east, north] = extent.map(Number);

  if ([west, south, east, north].some(value => !Number.isFinite(value))) {
    return null;
  }

  if (isGlobalExtent([west, south, east, north])) {
    return DEFAULT_FOCUS_EXTENT;
  }

  if (south >= north || west >= east) return null;

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
  if (!currentImageUrl.value) {
    window.clearTimeout(zoomTimer);
    zoomedKey = "";
    return;
  }

  const target = normalizeExtentForFly(imageExtent.value);
  if (!target) return;

  const key = target.map(value => value.toFixed(4)).join(",");
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
    source: sourceName.value,
    business_type: sourceName.value,
    data_type: sourceName.value,
    file: resolvedFile.value,
    file_name: resolvedFile.value,
    element:
      currentLayer.value.element ||
      currentLayer.value.label ||
      legendTitle.value,
    time: currentTimeLabel.value,
    level: currentLayer.value.level || "",
    range: currentLayer.value.range || "",
    grid:
      currentLayer.value.grid?.text ||
      currentLayer.value.gridText ||
      display.value?.grid?.text ||
      "",
    resolution: displayResolution.value,
    spatial_resolution: displayResolution.value,
    missing: currentLayer.value.missingText || "",
    unit: displayUnit.value,
    vars: variableOptions.value
      .map(item => item.label || item.key)
      .join("、"),
    steps: String(frameCount.value),
    status: "解析成功",
    quality: currentLayer.value.quality || "",
    max: currentStepStats.value?.max,
    min: currentStepStats.value?.min,
    mean: currentStepStats.value?.mean,
    extent: imageExtent.value,
    image_url: currentImageUrl.value,
    image_urls: currentFrames.value.map(frame => frame.url),
    image_format: "webp",
    render_mode: "webp",
    frames: currentFrames.value,
    times: currentTimes.value,
    valid_hours: currentValidHours.value,
    valid_time_hours: currentValidHours.value,
    forecast_hours: currentForecastHours.value,
    forecast_labels: currentFrames.value.map(
      (frame, index) =>
        frame.forecast_label ||
        `F${String(currentForecastHours.value[index] ?? index).padStart(3, "0")}`
    ),
    axis_times: defaultBusinessAxisTimes(),
    color_range: renderColorRange.value,
    varType: renderVarType.value,
  };

  emit("variable-change", payload);
  emit("display-loaded", {
    ...display.value,
    file: resolvedFile.value,
    file_name: resolvedFile.value,
    product: currentVariable.value,
    level: currentLayer.value?.level || "",
    render_mode: "webp",
    image_format: "webp",
    image_url: payload.image_url,
    image_urls: payload.image_urls,
    frames: payload.frames,
    times: payload.times,
    forecast_hours: payload.forecast_hours,
    forecast_labels: payload.forecast_labels,
    valid_hours: payload.valid_hours,
    valid_time_hours: payload.valid_time_hours,
    meta: {
      ...payload,
      weather_info: payload,
    },
  });
}

function formatStat(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  const number = Number(value);
  return Math.abs(number) >= 10
    ? number.toFixed(2)
    : number.toFixed(3);
}

watch(
  () => props.parsed,
  value => {
    if (value) {
      displayRequestId += 1;
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
  renderLayer();
  emitCurrentVariable();
});

watch(
  () => [
    currentImageUrl.value,
    imageExtent.value.join(","),
    props.alpha,
  ],
  () => {
    renderLayer();
    zoomToData();
    emitCurrentVariable();
  },
  { immediate: true }
);

watch(
  () => sourceName.value,
  () => {
    display.value = null;
    error.value = "";
    selectedProductCategory.value = "";
    selectedVariableKey.value = "";
    selectedLevelKey.value = "surface";
    variantApplied = false;
    zoomedKey = "";
    loadDisplay();
  }
);

onMounted(() => {
  loadDisplay();
  refreshTimer = window.setInterval(loadDisplay, 30000);
});

onBeforeUnmount(() => {
  displayRequestId += 1;
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  window.clearTimeout(zoomTimer);
  surface?.clear?.();
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

.gfs-status.error {
  color: #fca5a5;
}

.lc-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  font-size: 11px;
  color: #cbd5e1;
}

.lc-row select {
  min-width: 0;
  height: 28px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.68);
  color: #e5e7eb;
  padding: 0 6px;
}
</style>
