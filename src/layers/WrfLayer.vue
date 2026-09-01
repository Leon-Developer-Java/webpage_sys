<template>
  <WebglLayer :key="layerKey" :src="imageUrl" :extent="extent" />
  <LayerCard :badge="label" :file="currentVariable.name" :legend-title="currentVariable.unit" :gradient="currentVariable.gradient" :ticks="currentVariable.ticks">
    <label class="lc-row">
      <span>区域</span>
      <select v-model="domain">
        <option v-for="item in domainOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </label>
    <label class="lc-row">
      <span>分辨率</span>
      <select v-model="selectedResolution">
        <option v-for="item in resolutionOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
    </label>
    <label class="lc-row">
      <span>产品</span>
      <select v-model="variable">
        <option v-for="item in variableOptions" :key="item.value" :value="item.value">{{ item.name }}</option>
      </select>
    </label>
    <label class="lc-row">
      <span>日期</span>
      <select v-model="selectedDate">
        <option v-for="item in availableDates" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>
    <div class="lc-row">
      <span>时次</span>
      <b>{{ formatTime(time) }}</b>
    </div>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";
import { authedFetch, withToken } from "../api";

const props = defineProps({
  timeIndex: { type: Number, default: 12 },
  timelineLabel: { type: String, default: "" },
  parsed: { type: Object, default: null },
  parsedMeta: { type: Object, default: null },
  label: { type: String, default: "WRF" },
  variantIndex: { type: Number, default: 0 },
});

const emit = defineEmits(["display-loaded", "variable-change"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const display = ref(null);
let displayRequestId = 0;

function toPublicUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return withToken(path);
  const normalized = String(path).replaceAll("\\", "/");
  if (normalized.startsWith("data/")) return withToken(`${API_BASE}/${normalized}`);
  const idx = normalized.indexOf("/data/");
  return idx >= 0 ? withToken(`${API_BASE}${normalized.slice(idx)}`) : "";
}

async function loadWrfDisplay() {
  const requestId = ++displayRequestId;
  if (props.parsed || props.parsedMeta) {
    display.value = null;
    return;
  }
  try {
    const response = await authedFetch(`${API_BASE}/api/display/WRF`, { cache: "no-store" });
    const payload = await response.json();
    if (requestId === displayRequestId && payload?.code === 0) display.value = payload.data;
  } catch (error) {
    if (requestId === displayRequestId) console.error(error);
  }
}

const domains = {
  d01: {
    label: "d01 9km 区域",
    extent: [117.88736, 32.630562, 119.742645, 34.010075],
  },
  d02: {
    label: "d02 3km 重点区域",
    extent: [118.345093, 33.010822, 119.284912, 33.632328],
  },
};

const defaultDates = ["2025-07-16"];
const timelineSlotCount = 12;
const hiddenVariables = new Set(["PM2_5_DRY", "PM10", "AOD2D_OUT"]);

const variables = [
  {
    value: "PM2_5_DRY",
    name: "PM2.5 dry mass concentration",
    unit: "ug/m3",
    desc: "Near-surface PM2.5 concentration.",
    gradient: "linear-gradient(to right, #2563eb, #22c55e, #facc15, #f97316, #e11d48)",
    ticks: ["Low", "Medium", "High", "Very high", "Extreme"],
  },
  {
    value: "PM10",
    name: "PM10 mass concentration",
    unit: "ug/m3",
    desc: "Near-surface PM10 concentration.",
    gradient: "linear-gradient(to right, #38bdf8, #22c55e, #facc15, #fb923c, #b91c1c)",
    ticks: ["Low", "Medium", "High", "Very high", "Extreme"],
  },
  {
    value: "AOD2D_OUT",
    name: "Aerosol optical depth",
    unit: "AOD",
    desc: "Column aerosol optical depth.",
    gradient: "linear-gradient(to right, #eff6ff, #93c5fd, #facc15, #fb923c, #7f1d1d)",
    ticks: ["0", "0.4", "0.8", "1.2", "High"],
  },
  {
    value: "T2",
    name: "2m temperature",
    unit: "K",
    desc: "Air temperature at 2 metres above ground.",
    gradient: "linear-gradient(to right, #2563eb, #60a5fa, #fde68a, #fb923c, #dc2626)",
    ticks: ["Cold", "Cool", "Normal", "Warm", "Hot"],
  },
  {
    value: "U10",
    name: "10m U wind",
    unit: "m/s",
    desc: "East-west wind component at 10 metres.",
    gradient: "linear-gradient(to right, #1d4ed8, #93c5fd, #f8fafc, #fdba74, #b91c1c)",
    ticks: ["Negative", "Weak negative", "0", "Weak positive", "Positive"],
  },
  {
    value: "V10",
    name: "10m V wind",
    unit: "m/s",
    desc: "North-south wind component at 10 metres.",
    gradient: "linear-gradient(to right, #1d4ed8, #93c5fd, #f8fafc, #fdba74, #b91c1c)",
    ticks: ["Negative", "Weak negative", "0", "Weak positive", "Positive"],
  },
  {
    value: "PSFC",
    name: "Surface pressure",
    unit: "Pa",
    desc: "Model surface pressure.",
    gradient: "linear-gradient(to right, #312e81, #2563eb, #22c55e, #facc15, #dc2626)",
    ticks: ["Low", "Lower", "Medium", "Higher", "High"],
  },
  {
    value: "PBLH",
    name: "Boundary layer height",
    unit: "m",
    desc: "Planetary boundary layer height.",
    gradient: "linear-gradient(to right, #0f172a, #2563eb, #22c55e, #facc15, #f97316)",
    ticks: ["Low", "Lower", "Medium", "Higher", "High"],
  },
  {
    value: "RAINC",
    name: "Accumulated convective rain",
    unit: "mm",
    desc: "Accumulated convective precipitation.",
    gradient: "linear-gradient(to right, #f8fafc, #bfdbfe, #38bdf8, #2563eb, #1e3a8a)",
    ticks: ["0", "Light", "Moderate", "Heavy", "Strong"],
  },
  {
    value: "RAINNC",
    name: "Accumulated non-convective rain",
    unit: "mm",
    desc: "Accumulated non-convective precipitation.",
    gradient: "linear-gradient(to right, #f8fafc, #bfdbfe, #38bdf8, #2563eb, #1e3a8a)",
    ticks: ["0", "Light", "Moderate", "Heavy", "Strong"],
  },
];

const domain = ref("d02");
const variable = ref("T2");
const selectedResolution = ref("3km");
const selectedDate = ref(defaultDates[0]);
const flyToExtent = inject("flyToExtent", null);

const wrfMeta = computed(() => props.parsedMeta || props.parsed?.meta || props.parsed?.meta_json || display.value?.meta_json || null);
const workbenchDomains = computed(() => Array.isArray(wrfMeta.value?.domains) ? wrfMeta.value.domains : []);
const workbenchDomain = computed(() => workbenchDomains.value.find((item) => item.id === domain.value) || workbenchDomains.value[0] || null);
const domainOptions = computed(() => {
  if (workbenchDomains.value.length) {
    return workbenchDomains.value.map((item) => ({
      value: item.id,
      label: `${item.id} · ${Number(item.dx || 0) / 1000 || "?"}km`,
    }));
  }
  return Object.entries(domains).map(([value, item]) => ({ value, label: item.label }));
});
const currentDomain = computed(() => {
  const item = workbenchDomain.value;
  if (item && Array.isArray(item.extent) && item.extent.length === 4) {
    return { label: `${item.id} WRF 区域`, extent: item.extent.map(Number) };
  }
  return domains[domain.value] ?? domains.d02;
});
const resolutionProducts = computed(() => {
  const products = wrfMeta.value?.resolution_products;
  return products && typeof products === "object" ? products : {};
});
const resolutionOptions = computed(() => {
  if (workbenchDomain.value) {
    const km = Number(workbenchDomain.value.dx || 0) / 1000;
    return [{ value: "native", label: km ? `${Number(km.toFixed(2))}km` : "原始网格" }];
  }
  const entries = Object.entries(resolutionProducts.value);
  if (!entries.length) return [{ value: "3km", label: "3km" }];
  return entries.map(([value, item]) => ({
    value,
    label: item?.label || item?.resolution || value,
  }));
});
const currentResolutionProduct = computed(() => {
  const products = resolutionProducts.value;
  return products[selectedResolution.value]
    || products[wrfMeta.value?.default_resolution]
    || products["3km"]
    || Object.values(products)[0]
    || null;
});
const currentWebpFiles = computed(() => {
  if (workbenchDomain.value) {
    return (workbenchDomain.value.variables || []).flatMap((item) => (item.frames || []).map((frame) => frame.url)).filter(Boolean);
  }
  const files = currentResolutionProduct.value?.webp_files;
  if (Array.isArray(files) && files.length) return files;
  return Array.isArray(wrfMeta.value?.webp_files) ? wrfMeta.value.webp_files : [];
});
const availableDates = computed(() => {
  const parsedDates = (workbenchDomain.value?.times || wrfMeta.value?.times || [])
    .map((item) => String(item).slice(0, 10))
    .filter(Boolean);
  return parsedDates.length ? [...new Set(parsedDates)] : defaultDates;
});
const dayTimes = computed(() => {
  const source = workbenchDomain.value?.times || wrfMeta.value?.times;
  const list = Array.isArray(source) ? source : [];
  return list
    .map((item) => String(item))
    .filter((item) => item.startsWith(selectedDate.value));
});
const parsedVariables = computed(() => {
  const list = workbenchDomain.value?.variables || currentResolutionProduct.value?.variables || wrfMeta.value?.variables;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .filter((item) => !hiddenVariables.has(item.name))
    .map((item) => ({
      value: item.name,
      name: item.label || item.name,
      unit: item.units || "",
      desc: item.description || item.name,
      min: Number(item.min),
      max: Number(item.max),
      mean: Number(item.mean),
      gradient: gradientFor(item.name),
      ticks: ticksFor(item.name),
    }));
});
const variableOptions = computed(() => {
  const list = parsedVariables.value.length ? parsedVariables.value : variables;
  return list.filter((item) => !hiddenVariables.has(item.value));
});
const currentVariable = computed(
  () => variableOptions.value.find((item) => item.value === variable.value) ?? variableOptions.value[0],
);
const extent = computed(() => {
  if (hasMixedDomains.value) return currentDomain.value.extent;
  const bbox = wrfMeta.value?.bbox;
  const parsedExtent = [bbox?.west, bbox?.south, bbox?.east, bbox?.north].map(Number);
  if (parsedExtent.every(Number.isFinite) && parsedExtent[0] < parsedExtent[2] && parsedExtent[1] < parsedExtent[3]) {
    return parsedExtent;
  }
  return currentDomain.value.extent;
});
const hasMixedDomains = computed(() => {
  const files = currentWebpFiles.value;
  if (!Array.isArray(files)) return false;
  const domains = new Set(
    files
      .map((item) => String(item).match(/wrfout_(d\d{2})/i)?.[1]?.toLowerCase())
      .filter(Boolean),
  );
  return domains.size > 1;
});
const timelineHour = computed(() => {
  const labelHour = String(props.timelineLabel).match(/\d+/)?.[0];
  const hour = labelHour === undefined ? props.timeIndex : Number(labelHour);
  return Math.max(0, Math.min(12, Number.isFinite(hour) ? hour : 0));
});
const currentFrameIndex = computed(() => {
  const count = dayTimes.value.length;
  if (count <= 1) return 0;
  const sourceIndex = Number.isFinite(Number(props.timeIndex)) ? Number(props.timeIndex) : 0;
  if (props.parsed || props.parsedMeta) {
    return Math.max(0, Math.min(count - 1, Math.floor(sourceIndex)));
  }
  const clampedIndex = Math.max(0, Math.min(timelineSlotCount - 1, sourceIndex));
  return Math.round((clampedIndex / (timelineSlotCount - 1)) * (count - 1));
});
const time = computed(() => {
  const parsedTime = dayTimes.value[currentFrameIndex.value];
  if (parsedTime) return parsedTime.replace(":", "_").replace(":", "_");
  const hour = String(timelineHour.value).padStart(2, "0");
  return `${selectedDate.value}_${hour}_00_00`;
});
const imageUrl = computed(() => {
  const workbenchVariable = (workbenchDomain.value?.variables || []).find((item) => item.name === variable.value)
    || workbenchDomain.value?.variables?.[0];
  const workbenchFrame = workbenchVariable?.frames?.[currentFrameIndex.value];
  if (workbenchFrame?.url) return toPublicUrl(workbenchFrame.url);
  const parsedUrl = parsedWebpUrl(variable.value);
  if (parsedUrl) return parsedUrl;
  return toPublicUrl(display.value?.webp);
});
const selectedFrameUrls = computed(() => {
  if (workbenchDomain.value) {
    const selected = (workbenchDomain.value.variables || []).find((item) => item.name === variable.value)
      || workbenchDomain.value.variables?.[0];
    return (selected?.frames || []).map((frame) => toPublicUrl(frame.url)).filter(Boolean);
  }
  const files = currentWebpFiles.value;
  if (!Array.isArray(files) || !files.length) return imageUrl.value ? [imageUrl.value] : [];
  const target = String(variable.value || "");
  const candidates = files.filter(item => {
    const normalized = String(item).replaceAll("\\", "/");
    const base = normalized.split("/").pop()?.replace(/\.webp$/i, "") ?? "";
    return domainMatches(normalized) && base.endsWith(`_${target}`) && (!selectedDate.value || base.startsWith(selectedDate.value));
  });
  const ordered = dayTimes.value.map(item => {
    const timePart = String(item).replace(":", "_").replace(":", "_");
    return candidates.find(candidate => {
      const base = String(candidate).replaceAll("\\", "/").split("/").pop()?.replace(/\.webp$/i, "") ?? "";
      return base.startsWith(`${timePart}_`);
    });
  }).filter(Boolean);
  return [...new Set((ordered.length ? ordered : candidates).map(localDataUrl).filter(Boolean))];
});
const layerKey = computed(() => `${imageUrl.value}|${extent.value.join(",")}`);

function gradientFor(name) {
  return variables.find((item) => item.value === name)?.gradient
    ?? "linear-gradient(to right, #2563eb, #22c55e, #facc15, #f97316, #e11d48)";
}

function ticksFor(name) {
  return variables.find((item) => item.value === name)?.ticks ?? ["Low", "Medium", "High", "Very high", "Extreme"];
}

function parsedWebpUrl(variableName) {
  const files = currentWebpFiles.value;
  if (!Array.isArray(files)) return "";
  const target = String(variableName || "");
  const timePart = time.value;
  const picked = files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.webp$/i, "") ?? "";
    return domainMatches(name) && base.startsWith(`${timePart}_`) && base.endsWith(`_${target}`);
  }) || files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.webp$/i, "") ?? "";
    return domainMatches(name) && base.endsWith(`_${target}`);
  }) || files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.webp$/i, "") ?? "";
    return base.endsWith(`_${target}`);
  }) || firstRenderableWebp(files) || files[0];
  return localDataUrl(picked);
}

function domainMatches(path) {
  if (!hasMixedDomains.value) return true;
  return String(path).toLowerCase().includes(`wrfout_${domain.value}`);
}

function localDataUrl(path) {
  const url = toPublicUrl(path);
  if (!url) return "";
  const version = encodeURIComponent(wrfMeta.value?.dataset_id || wrfMeta.value?.meta_file || "");
  if (!version || url.includes("?")) return url;
  return `${url}?v=${version}`;
}

function isRenderableVariable(item) {
  const min = Number(item?.min);
  const max = Number(item?.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min;
}

function preferredVariable(meta) {
  const activeWorkbenchDomain = Array.isArray(meta?.domains)
    ? (meta.domains.find((item) => item.id === domain.value) || meta.domains.find((item) => item.id === meta.default_domain) || meta.domains[0])
    : null;
  const sourceVariables = activeWorkbenchDomain?.variables || meta?.variables;
  const list = Array.isArray(sourceVariables)
    ? sourceVariables.filter((item) => !hiddenVariables.has(item.name))
    : [];
  const priority = [meta?.default_variable, "T2", "PBLH", "U10", "V10", "PSFC", "RAINC", "RAINNC"].filter(Boolean);
  return priority
    .map((name) => list.find((item) => item.name === name && isRenderableVariable(item)))
    .find(Boolean)?.name
    ?? list.find(isRenderableVariable)?.name
    ?? list[0]?.name
    ?? variable.value;
}

function firstRenderableWebp(files) {
  const name = preferredVariable(wrfMeta.value);
  const timePart = time.value;
  return files.find((item) => {
    const normalized = String(item).replaceAll("\\", "/");
    const base = normalized.split("/").pop()?.replace(/\.webp$/i, "") ?? "";
    return domainMatches(normalized) && base.startsWith(`${timePart}_`) && base.endsWith(`_${name}`);
  });
}

function formatTime(value) {
  return value.replace("_", " ").replaceAll("_", ":");
}

// Emit WRF layer metadata to the right-side weather panel.
function buildPanelInfo() {
  const meta = wrfMeta.value || {};
  const weather = meta.weather_info || {};
  const current = currentVariable.value || {};
  const productVariables = workbenchDomain.value?.variables || currentResolutionProduct.value?.variables || meta.variables;
  const metaVar = (Array.isArray(productVariables) ? productVariables : [])
    .find((item) => item.name === variable.value) || {};
  const varInfo = (Array.isArray(meta.variable_information) ? meta.variable_information : [])
    .find((item) => item.name === variable.value) || {};
  const fmt = (value) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : "");

  return {
    file: String(meta.source_file || "").split("/").pop() || "",
    element: current.name || weather.element || "",
    element_description: varInfo.chinese_description || current.desc || "",
    time: formatTime(time.value),
    level: weather.level || "",
    range: weather.range || "",
    resolution: currentResolutionProduct.value?.resolution || weather.resolution || "",
    grid: currentResolutionProduct.value?.grid || weather.grid || "",
    unit: metaVar.units || current.unit || weather.unit || "",
    missing: weather.missing || "",
    status: weather.status || "",
    product: weather.product || "",
    coverage: currentDomain.value?.label || weather.coverage || "",
    variable_count: String(variableOptions.value.length || weather.variables || ""),
    min: fmt(metaVar.min),
    mean: fmt(metaVar.mean),
    max: fmt(metaVar.max),
  };
}

function emitPanelInfo() {
  if (!wrfMeta.value) return;
  const info = buildPanelInfo();
  const extraRows = [
    ["product", "Product", info.product],
    ["coverage", "Domain", info.coverage],
    ["resolution", "Resolution", info.resolution],
    ["variableCount", "Variable count", info.variable_count],
    ["min", "Min", info.min],
    ["mean", "Mean", info.mean],
    ["max", "Max", info.max],
  ];
  const metaOut = {
    ...wrfMeta.value,
    file: info.file,
    element: info.element,
    time: info.time,
    weather_info: { ...info },
    extraRows,
  };
  emit("variable-change", { ...info, extraRows });
  emit("display-loaded", {
    meta: metaOut,
    weather_info: { ...info },
    variables: workbenchDomain.value?.variables || currentResolutionProduct.value?.variables || wrfMeta.value?.variables || [],
    times: workbenchDomain.value?.times || wrfMeta.value?.times || [],
    image_url: imageUrl.value,
    image_urls: selectedFrameUrls.value,
    frames: selectedFrameUrls.value.map((url, index) => ({
      index,
      url,
      valid_time: dayTimes.value[index] || wrfMeta.value?.times?.[index] || "",
    })),
    file: info.file,
    variable: variable.value,
  });
}

let zoomedKey = "";
function zoomToDomain() {
  if (!wrfMeta.value) return;
  const ext = extent.value;
  if (!Array.isArray(ext) || ext.length !== 4) return;
  const [west, south, east, north] = ext.map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) return;
  const key = ext.join(",");
  if (key === zoomedKey) return;
  zoomedKey = key;
  const lonPad = Math.max((east - west) * 0.25, 0.05);
  const latPad = Math.max((north - south) * 0.25, 0.05);
  flyToExtent?.([west - lonPad, south - latPad, east + lonPad, north + latPad]);
}

watch(
  wrfMeta,
  (meta) => {
    if (Array.isArray(meta?.domains) && meta.domains.length) {
      const values = meta.domains.map((item) => item.id);
      const preferredDomain = meta.default_domain || values[0];
      if (!values.includes(domain.value)) domain.value = preferredDomain;
    }
    const firstVar = preferredVariable(meta);
    if (firstVar) {
      if (props.variantIndex > 0) {
        const opts = variableOptions.value;
        const baseIdx = opts.findIndex(v => v.value === firstVar);
        const offset = (baseIdx >= 0 ? baseIdx : 0) + props.variantIndex;
        variable.value = opts[offset % opts.length]?.value || firstVar;
      } else {
        variable.value = firstVar;
      }
    }
    selectedDate.value = availableDates.value[0] ?? defaultDates[0];
  },
  { immediate: true },
);
watch(
  () => [wrfMeta.value, resolutionOptions.value],
  () => {
    const values = resolutionOptions.value.map((item) => item.value);
    const preferred = wrfMeta.value?.default_resolution || "3km";
    if (!values.includes(selectedResolution.value)) {
      selectedResolution.value = values.includes(preferred) ? preferred : values[0] || "3km";
    }
  },
  { immediate: true },
);
watch(() => [wrfMeta.value, extent.value], zoomToDomain, { immediate: true });
watch(() => [wrfMeta.value, variable.value, domain.value, time.value, selectedResolution.value], emitPanelInfo, { immediate: true });

onMounted(() => {
  loadWrfDisplay().catch((error) => {
    console.warn("WRF display load failed", error);
  });
});

onBeforeUnmount(() => {
  displayRequestId += 1;
});
</script>

