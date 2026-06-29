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
import { computed, inject, onMounted, ref, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

const props = defineProps({
  timeIndex: { type: Number, default: 12 },
  timelineLabel: { type: String, default: "" },
  parsedMeta: { type: Object, default: null },
  label: { type: String, default: "WRF" },
});

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const display = ref(null);

function toPublicUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  const normalized = String(path).replaceAll("\\", "/");
  const idx = normalized.indexOf("/data/");
  return idx >= 0 ? `${API_BASE}${normalized.slice(idx)}` : "";
}

function loadWrfDisplay() {
  fetch(`${API_BASE}/api/display/WRF`).then((response) => response.json()).then((payload) => {
    if (payload?.code === 0) display.value = payload.data;
  });
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

const domainOptions = Object.entries(domains).map(([value, item]) => ({
  value,
  label: item.label,
}));

const defaultDates = ["2025-07-16"];

const variables = [
  {
    value: "PM2_5_DRY",
    name: "PM2.5 干质量浓度",
    unit: "ug/m3",
    desc: "近地面细颗粒物浓度，用于空气质量预报展示。",
    gradient: "linear-gradient(to right, #2563eb, #22c55e, #facc15, #f97316, #e11d48)",
    ticks: ["低", "中", "偏高", "高", "极高"],
  },
  {
    value: "PM10",
    name: "PM10 颗粒物浓度",
    unit: "ug/m3",
    desc: "可吸入颗粒物浓度，适合与 PM2.5 联合展示污染过程。",
    gradient: "linear-gradient(to right, #38bdf8, #22c55e, #facc15, #fb923c, #b91c1c)",
    ticks: ["低", "中", "偏高", "高", "极高"],
  },
  {
    value: "AOD2D_OUT",
    name: "气溶胶光学厚度",
    unit: "AOD",
    desc: "柱积分气溶胶光学厚度，反映大气浑浊程度。",
    gradient: "linear-gradient(to right, #eff6ff, #93c5fd, #facc15, #fb923c, #7f1d1d)",
    ticks: ["0", "0.4", "0.8", "1.2", "高"],
  },
  {
    value: "T2",
    name: "2 米气温",
    unit: "K",
    desc: "近地面 2 米气温，可用于天气背景场展示。",
    gradient: "linear-gradient(to right, #2563eb, #60a5fa, #fde68a, #fb923c, #dc2626)",
    ticks: ["低温", "偏低", "适中", "偏高", "高温"],
  },
  {
    value: "U10",
    name: "10 米东西风",
    unit: "m/s",
    desc: "10 米高度东西向风速，正值表示偏西风分量。",
    gradient: "linear-gradient(to right, #1d4ed8, #93c5fd, #f8fafc, #fdba74, #b91c1c)",
    ticks: ["负", "弱负", "0", "弱正", "正"],
  },
  {
    value: "V10",
    name: "10 米南北风",
    unit: "m/s",
    desc: "10 米高度南北向风速，正值表示偏南风分量。",
    gradient: "linear-gradient(to right, #1d4ed8, #93c5fd, #f8fafc, #fdba74, #b91c1c)",
    ticks: ["负", "弱负", "0", "弱正", "正"],
  },
  {
    value: "PSFC",
    name: "地面气压",
    unit: "Pa",
    desc: "模式地面气压场，可辅助判断天气系统。",
    gradient: "linear-gradient(to right, #312e81, #2563eb, #22c55e, #facc15, #dc2626)",
    ticks: ["低", "偏低", "中", "偏高", "高"],
  },
  {
    value: "PBLH",
    name: "边界层高度",
    unit: "m",
    desc: "行星边界层高度，对污染扩散能力判断很关键。",
    gradient: "linear-gradient(to right, #0f172a, #2563eb, #22c55e, #facc15, #f97316)",
    ticks: ["低", "较低", "中", "较高", "高"],
  },
  {
    value: "RAINC",
    name: "累积对流降水",
    unit: "mm",
    desc: "对流降水累积量，用于识别强对流降水贡献。",
    gradient: "linear-gradient(to right, #f8fafc, #bfdbfe, #38bdf8, #2563eb, #1e3a8a)",
    ticks: ["0", "小", "中", "大", "强"],
  },
  {
    value: "RAINNC",
    name: "累积非对流降水",
    unit: "mm",
    desc: "非对流降水累积量，常用于连续性降水展示。",
    gradient: "linear-gradient(to right, #f8fafc, #bfdbfe, #38bdf8, #2563eb, #1e3a8a)",
    ticks: ["0", "小", "中", "大", "强"],
  },
];

const domain = ref("d02");
const variable = ref("PM2_5_DRY");
const selectedDate = ref(defaultDates[0]);
const flyToExtent = inject("flyToExtent", null);

const currentDomain = computed(() => domains[domain.value] ?? domains.d02);
const wrfMeta = computed(() => props.parsedMeta || display.value?.meta_json || null);
const availableDates = computed(() => {
  const parsedDates = (wrfMeta.value?.times ?? [])
    .map((item) => String(item).slice(0, 10))
    .filter(Boolean);
  return parsedDates.length ? [...new Set(parsedDates)] : defaultDates;
});
const parsedVariables = computed(() => {
  const list = wrfMeta.value?.variables;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.map((item) => ({
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
const variableOptions = computed(() => parsedVariables.value.length ? parsedVariables.value : variables);
const currentVariable = computed(
  () => variableOptions.value.find((item) => item.value === variable.value) ?? variableOptions.value[0],
);
const extent = computed(() => {
  const bbox = wrfMeta.value?.bbox;
  const parsedExtent = [bbox?.west, bbox?.south, bbox?.east, bbox?.north].map(Number);
  if (parsedExtent.every(Number.isFinite) && parsedExtent[0] < parsedExtent[2] && parsedExtent[1] < parsedExtent[3]) {
    return parsedExtent;
  }
  return currentDomain.value.extent;
});
const timelineHour = computed(() => {
  const labelHour = String(props.timelineLabel).match(/\d+/)?.[0];
  const hour = labelHour === undefined ? props.timeIndex : Number(labelHour);
  return Math.max(0, Math.min(12, Number.isFinite(hour) ? hour : 0));
});
const time = computed(() => {
  const parsedTimes = wrfMeta.value?.times;
  const parsedTime = Array.isArray(parsedTimes)
    ? parsedTimes[Math.min(Math.max(props.timeIndex, 0), parsedTimes.length - 1)]
    : null;
  if (parsedTime) return parsedTime.replace(":", "_").replace(":", "_");
  const hour = String(timelineHour.value).padStart(2, "0");
  return `${selectedDate.value}_${hour}_00_00`;
});
const imageUrl = computed(() => {
  const parsedUrl = parsedPngUrl(variable.value);
  if (parsedUrl) return parsedUrl;
  return toPublicUrl(display.value?.png);
});
const layerKey = computed(() => `${imageUrl.value}|${extent.value.join(",")}`);

function gradientFor(name) {
  return variables.find((item) => item.value === name)?.gradient
    ?? "linear-gradient(to right, #2563eb, #22c55e, #facc15, #f97316, #e11d48)";
}

function ticksFor(name) {
  return variables.find((item) => item.value === name)?.ticks ?? ["低", "中", "偏高", "高", "极高"];
}

function parsedPngUrl(variableName) {
  const files = wrfMeta.value?.png_files;
  if (!Array.isArray(files)) return "";
  const target = String(variableName || "");
  const timePart = time.value;
  const picked = files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return base.startsWith(`${timePart}_`) && base.endsWith(`_${target}`);
  }) || files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return base.endsWith(`_${target}`);
  }) || firstRenderablePng(files) || files[0];
  return localDataUrl(picked);
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
  const list = Array.isArray(meta?.variables) ? meta.variables : [];
  const priority = ["T2", "PBLH", "U10", "V10", "PSFC", "RAINC", "RAINNC"];
  return priority
    .map((name) => list.find((item) => item.name === name && isRenderableVariable(item)))
    .find(Boolean)?.name
    ?? list.find(isRenderableVariable)?.name
    ?? list[0]?.name
    ?? variable.value;
}

function firstRenderablePng(files) {
  const name = preferredVariable(wrfMeta.value);
  const timePart = time.value;
  return files.find((item) => {
    const base = String(item).replaceAll("\\", "/").split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return base.startsWith(`${timePart}_`) && base.endsWith(`_${name}`);
  });
}

function formatTime(value) {
  return value.replace("_", " ").replaceAll("_", ":");
}

let zoomedKey = "";
function zoomToDomain() {
  // 和 CMA 一致：等数据(wrfMeta)就绪后再飞，避免空数据时复位到默认范围。
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
    const firstVar = preferredVariable(meta);
    if (firstVar) variable.value = firstVar;
    selectedDate.value = availableDates.value[0] ?? defaultDates[0];
  },
  { immediate: true },
);
watch(() => [wrfMeta.value, extent.value], zoomToDomain, { immediate: true });

onMounted(() => {
  loadWrfDisplay();
});
</script>
