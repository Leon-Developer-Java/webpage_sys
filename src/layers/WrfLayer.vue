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
  parsed: { type: Object, default: null },
  parsedMeta: { type: Object, default: null },
  label: { type: String, default: "WRF" },
});

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const display = ref(null);
const binaryImageUrl = ref("");
let binaryRenderToken = 0;

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
const timelineSlotCount = 12;
const hiddenVariables = new Set(["PM2_5_DRY", "PM10", "AOD2D_OUT"]);

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
const variable = ref("T2");
const selectedDate = ref(defaultDates[0]);
const flyToExtent = inject("flyToExtent", null);

const currentDomain = computed(() => domains[domain.value] ?? domains.d02);
const wrfMeta = computed(() => props.parsedMeta || props.parsed?.meta || props.parsed?.meta_json || display.value?.meta_json || null);
const availableDates = computed(() => {
  const parsedDates = (wrfMeta.value?.times ?? [])
    .map((item) => String(item).slice(0, 10))
    .filter(Boolean);
  return parsedDates.length ? [...new Set(parsedDates)] : defaultDates;
});
const dayTimes = computed(() => {
  const list = Array.isArray(wrfMeta.value?.times) ? wrfMeta.value.times : [];
  return list
    .map((item) => String(item))
    .filter((item) => item.startsWith(selectedDate.value));
});
const parsedVariables = computed(() => {
  const list = wrfMeta.value?.variables;
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
  const files = wrfMeta.value?.png_files;
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
  if (binaryImageUrl.value) return binaryImageUrl.value;
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
    return domainMatches(name) && base.startsWith(`${timePart}_`) && base.endsWith(`_${target}`);
  }) || files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return domainMatches(name) && base.endsWith(`_${target}`);
  }) || files.find((item) => {
    const name = String(item).replaceAll("\\", "/");
    const base = name.split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return base.endsWith(`_${target}`);
  }) || firstRenderablePng(files) || files[0];
  return localDataUrl(picked);
}

const binaryGrid = computed(() => {
  const files = wrfMeta.value?.bin_files;
  if (!Array.isArray(files)) return null;
  const target = String(variable.value || "");
  const timePart = time.value;
  return files.find((item) => {
    const path = String(item?.path || "").replaceAll("\\", "/");
    return domainMatches(path) && item?.variable === target && String(item?.time || "").replaceAll(":", "_") === timePart;
  }) || files.find((item) => {
    const path = String(item?.path || "").replaceAll("\\", "/");
    return domainMatches(path) && item?.variable === target;
  }) || null;
});

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

function colorStops() {
  const name = variable.value;
  if (name === "U10" || name === "V10") {
    return [
      [29, 78, 216],
      [147, 197, 253],
      [248, 250, 252],
      [253, 186, 116],
      [185, 28, 28],
    ];
  }
  if (name === "PBLH") {
    return [
      [15, 23, 42],
      [37, 99, 235],
      [34, 197, 94],
      [250, 204, 21],
      [249, 115, 22],
    ];
  }
  if (name === "RAINC" || name === "RAINNC") {
    return [
      [248, 250, 252],
      [191, 219, 254],
      [56, 189, 248],
      [37, 99, 235],
      [30, 58, 138],
    ];
  }
  return [
    [37, 99, 235],
    [34, 197, 94],
    [250, 204, 21],
    [249, 115, 22],
    [225, 29, 72],
  ];
}

function sampleColor(t) {
  const stops = colorStops();
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
  ];
}

async function renderBinaryGrid() {
  const grid = binaryGrid.value;
  const token = ++binaryRenderToken;
  if (!grid?.path) {
    binaryImageUrl.value = "";
    return;
  }

  try {
    const response = await fetch(localDataUrl(grid.path));
    if (!response.ok) throw new Error(`WRF binary request failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (token !== binaryRenderToken) return;

    const width = Number(grid.width);
    const height = Number(grid.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("WRF binary grid has invalid shape.");
    }

    const values = new Float32Array(buffer);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    const min = Number(grid.min);
    const max = Number(grid.max);
    const lo = Number.isFinite(min) ? min : currentVariable.value?.min;
    const hi = Number.isFinite(max) && max !== lo ? max : currentVariable.value?.max;
    const span = Number.isFinite(hi - lo) && hi !== lo ? hi - lo : 1;

    for (let y = 0; y < height; y += 1) {
      const sourceY = height - 1 - y;
      for (let x = 0; x < width; x += 1) {
        const value = values[sourceY * width + x];
        const offset = (y * width + x) * 4;
        if (!Number.isFinite(value)) {
          image.data[offset + 3] = 0;
          continue;
        }
        const [r, g, b] = sampleColor((value - lo) / span);
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 185;
      }
    }

    ctx.putImageData(image, 0, 0);
    binaryImageUrl.value = canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("WRF binary render failed, fallback to PNG.", err);
    if (token === binaryRenderToken) binaryImageUrl.value = "";
  }
}

function isRenderableVariable(item) {
  const min = Number(item?.min);
  const max = Number(item?.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min;
}

function preferredVariable(meta) {
  const list = Array.isArray(meta?.variables)
    ? meta.variables.filter((item) => !hiddenVariables.has(item.name))
    : [];
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
    const normalized = String(item).replaceAll("\\", "/");
    const base = normalized.split("/").pop()?.replace(/\.png$/i, "") ?? "";
    return domainMatches(normalized) && base.startsWith(`${timePart}_`) && base.endsWith(`_${name}`);
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
watch(() => [binaryGrid.value, variable.value, time.value, domain.value], renderBinaryGrid, { immediate: true });

onMounted(() => {
  loadWrfDisplay();
});
</script>
