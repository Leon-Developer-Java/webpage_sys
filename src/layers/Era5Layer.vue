<template>
  <WebglLayer v-if="!gridLayer && imageSrc" :src="imageSrc" :extent="imageExtent" />
  <LayerCard
    :badge="label"
    :file="resolvedFile"
    :legend-title="cardLegendTitle"
    :gradient="gradient"
    :ticks="ticks"
  >
    <label class="lc-row">
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length">
        <option v-for="item in variables" :key="item.name" :value="item.name">
          {{ optionLabel(item) }}
        </option>
      </select>
    </label>
    <p v-if="frameSummary" class="lc-note">{{ frameSummary }}</p>
  </LayerCard>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import WebglLayer from "../components/WebglLayer.vue";

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
const layerRefreshKeys = inject("layerRefreshKeys", ref({}));

const colors = ["#2563eb", "#0891b2", "#16a34a", "#facc15", "#dc2626"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const display = ref(null);
const gridLayer = ref(null);
const variables = ref([]);
const selectedVariable = ref("");
const loading = ref(false);
const error = ref("");
const framePayload = ref(null);

let renderCanvas = null;
let gl = null;
let program = null;
let buffer = null;
let valueTexture = null;
let syncingSelection = false;
let loadToken = 0;
let lastExtentKey = "";

const vert = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const frag = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uGrid;
uniform float uOpacity;

vec3 ramp(float t) {
  vec3 c0 = vec3(0.15, 0.39, 0.92);
  vec3 c1 = vec3(0.03, 0.57, 0.70);
  vec3 c2 = vec3(0.09, 0.64, 0.29);
  vec3 c3 = vec3(0.98, 0.80, 0.13);
  vec3 c4 = vec3(0.86, 0.15, 0.22);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

void main() {
  float packed = texture(uGrid, vec2(vUv.x, 1.0 - vUv.y)).r;
  if (packed <= 0.0) discard;
  float t = clamp((packed * 255.0 - 1.0) / 254.0, 0.0, 1.0);
  frag = vec4(ramp(t), uOpacity);
}`;

const meta = computed(() => display.value?.meta_json ?? display.value ?? null);
const currentLayer = computed(() => layerForVariable(selectedVariable.value));
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || null);
const frameIndex = computed(() => {
  const count = Math.max(
    layerImageUrls(currentLayer.value).length || 0,
    currentLayer.value?.grid_urls?.length || 0,
    currentLayer.value?.times?.length || 0,
    1
  );
  return Math.min(Math.max(Number(props.timeIndex) || 0, 0), count - 1);
});
const imageSrc = computed(() => props.src || toPublicUrl(display.value?.webp || display.value?.image_url || display.value?.png));
const imageExtent = computed(() => props.extent || meta.value?.extent || meta.value?.bbox || [73, 15, 135, 55]);
const resolvedFile = computed(() => fileName(meta.value?.source_file) || fileName(display.value?.meta_file) || props.file || "");
const currentTime = computed(() => currentLayer.value?.times?.[frameIndex.value] || meta.value?.times?.[frameIndex.value] || "");
const frameSummary = computed(() => {
  const parts = [
    currentLayer.value?.width && currentLayer.value?.height ? `${currentLayer.value.width} x ${currentLayer.value.height}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
});
const refreshKey = computed(() => layerRefreshKeys.value?.era5 || 0);
const parsedKey = computed(() => {
  const parsed = props.parsed;
  return parsed?.dataset_id
    || parsed?.meta?.dataset_id
    || parsed?.source_file
    || parsed?.meta?.source_file
    || parsed?.file_name
    || "";
});

const cardLegendTitle = computed(() => {
  if (loading.value) return "ERA5 loading";
  if (error.value) return error.value;
  const layer = currentLayer.value;
  if (!layer) return "ERA5";
  const labelText = variableZhName(selectedVariable.value, layer, currentVariable.value);
  const unit = formatUnit(layer.unit || currentVariable.value?.unit || "");
  return `${labelText}${unit ? ` (${unit})` : ""}`;
});

const legendTitle = computed(() => {
  if (loading.value) return "ERA5 loading";
  if (error.value) return error.value;
  const layer = currentLayer.value;
  if (layer) {
    const labelText = layer.label || layer.name || "ERA5";
    const unit = layer.unit ? ` (${layer.unit})` : "";
    const time = layer.times?.[frameIndex.value] ? ` · ${layer.times[frameIndex.value]}` : "";
    return `${labelText}${unit}${time}`;
  }
  const weather = meta.value?.weather_info || {};
  return weather.element || meta.value?.default_variable || "ERA5";
});

const ticks = computed(() => {
  const stats = currentStats();
  const min = Number(stats.min);
  const max = Number(stats.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["低", "", "", "", "高"];
  if (Math.abs(max - min) < 0.000001) return [formatTick(min), "", "", "", formatTick(max)];
  return Array.from({ length: 5 }, (_, index) => formatTick(min + ((max - min) * index) / 4));
});

function fileName(path) {
  if (!path) return "";
  return String(path).replaceAll("\\", "/").split("/").pop() || "";
}

function toPublicUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = String(path).replaceAll("\\", "/");
  const idx = normalized.indexOf("/data/");
  return idx >= 0 ? `${API_BASE}${normalized.slice(idx)}` : normalized.startsWith("/data/") ? `${API_BASE}${normalized}` : "";
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  return value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
}

function formatUnit(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if (["1", "1.0", "none", "null", "n/a"].includes(normalized)) return "";
  if (normalized === "c") return "C";
  if (normalized === "k") return "K";
  if (normalized === "pa") return "Pa";
  if (normalized === "m") return "m";
  if (normalized === "m s**-1" || normalized === "m s-1" || normalized === "m/s") return "m/s";
  if (normalized === "m of water equivalent") return "m";
  if (normalized === "j m**-2" || normalized === "j m-2" || normalized === "j/m2") return "J/m2";
  if (normalized === "w m**-2" || normalized === "w m-2" || normalized === "w/m2") return "W/m2";
  return text;
}

const ERA5_VARIABLE_NAMES = {
  t2m: "2米气温",
  tp: "总降水量",
  sp: "地面气压",
  u10: "10米U风",
  v10: "10米V风",
  ssrd: "地表太阳短波辐射",
  d2m: "2米露点温度",
  msl: "海平面气压",
  u: "纬向风",
  v: "经向风",
  z: "位势",
  q: "比湿",
  r: "相对湿度",
  t: "温度",
};

const ERA5_VARIABLE_DESCRIPTIONS = {
  t2m: "距地面约2米高度的空气温度，用于表示近地面冷热状况。",
  tp: "一段时间内累积的总降水量，常用于降雨或降雪过程分析。",
  sp: "地表气压，表示地表附近大气对单位面积产生的压力。",
  u10: "10米高度的东西向风分量，正值表示向东，负值表示向西。",
  v10: "10米高度的南北向风分量，正值表示向北，负值表示向南。",
  ssrd: "到达地表的太阳短波辐射能量，可反映地表获得的太阳辐射强度。",
  d2m: "距地面约2米高度的露点温度，用于反映近地面空气湿度状况。",
  msl: "折算到海平面的气压，常用于分析天气系统和气压场。",
  u: "东西向风分量，正值表示向东，负值表示向西。",
  v: "南北向风分量，正值表示向北，负值表示向南。",
  z: "位势高度相关变量，常用于分析高空环流形势。",
  q: "比湿，表示单位质量湿空气中所含水汽质量。",
  r: "相对湿度，表示空气接近饱和的程度。",
  t: "空气温度，用于表示对应层次的大气冷热状况。",
};

function rawElementName(layer, variableItem = null) {
  return variableItem?.label || variableItem?.long_name || layer?.label || layer?.name || selectedVariable.value || "ERA5";
}

function variableZhName(variableName, layer = null, variableItem = null) {
  const key = String(variableName || layer?.name || variableItem?.name || "").toLowerCase();
  return variableItem?.name_cn || layer?.name_cn || ERA5_VARIABLE_NAMES[key] || rawElementName(layer, variableItem);
}

function bilingualElementName(layer, variableItem = null) {
  const zh = variableZhName(selectedVariable.value, layer, variableItem);
  const en = rawElementName(layer, variableItem);
  return en && en !== zh ? `${zh} / ${en}` : zh;
}

function variableDescription(variableName, layer = null, variableItem = null) {
  const key = String(variableName || layer?.name || variableItem?.name || "").toLowerCase();
  return variableItem?.description || layer?.description || ERA5_VARIABLE_DESCRIPTIONS[key] || "ERA5数据中的可渲染气象要素。";
}

function formatTimeLabel(value) {
  const text = String(value || "").trim();
  if (!text || text === "static") return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})?/);
  if (iso) return `${iso[2]}-${iso[3]} ${iso[4]}:${iso[5] || "00"}`;
  const spaced = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):?(\d{2})?/);
  if (spaced) return `${spaced[2]}-${spaced[3]} ${spaced[4]}:${spaced[5] || "00"}`;
  return text.length > 16 ? text.slice(0, 16) : text;
}

function formatRange(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return "";
  const [west, south, east, north] = extent.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value))) return "";
  return `${west.toFixed(2)}E-${east.toFixed(2)}E, ${south.toFixed(2)}N-${north.toFixed(2)}N`;
}

function formatStat(value, unit = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const abs = Math.abs(numeric);
  const text = abs >= 10000 || (abs > 0 && abs < 0.01)
    ? numeric.toExponential(2)
    : numeric.toFixed(abs >= 100 ? 2 : abs >= 10 ? 3 : 4);
  return unit ? `${text} ${unit}` : text;
}

function optionLabel(item) {
  const labelText = variableZhName(item?.name, null, item);
  return item?.name && item.name !== labelText ? `${labelText} (${item.name})` : labelText;
}

function normalizeDisplay(payload) {
  const data = payload?.data || payload || {};
  const nestedMeta = data.meta_json || data.meta || data;
  const layers = data.variable_layers || nestedMeta.variable_layers || {};
  const options = data.variable_options || nestedMeta.variable_options || data.variables || nestedMeta.variables || [];
  return {
    ...data,
    meta_json: nestedMeta,
    variable_layers: layers,
    variable_options: normalizeOptions(options),
    variables: normalizeOptions(options),
  };
}

function normalizeOptions(options) {
  return (options || [])
    .map(item => {
      if (typeof item === "string") return { name: item, label: item, unit: "" };
      return {
        name: item?.name,
        label: item?.label || item?.long_name || item?.name,
        unit: item?.unit || item?.units || item?.display_unit || "",
      };
    })
    .filter(item => item.name);
}

function layerForVariable(variableName) {
  const layers = display.value?.variable_layers || meta.value?.variable_layers || {};
  if (variableName && layers[variableName]) return layers[variableName];
  const lowered = String(variableName || "").toLowerCase();
  const match = Object.entries(layers).find(([key]) => key.toLowerCase() === lowered);
  if (match) return match[1];
  const first = Object.values(layers)[0];
  return first || null;
}

function layerImageUrls(layer) {
  return layer?.webp_urls || layer?.image_urls || layer?.png_urls || [];
}

function currentStats() {
  const layer = currentLayer.value;
  return layer?.stats?.[frameIndex.value] || layer?.stats?.[0] || framePayload.value || {};
}

function buildPanelInfo(layer, imageUrls = []) {
  const weather = meta.value?.weather_info || {};
  const stats = currentStats();
  const unit = formatUnit(layer?.unit || currentVariable.value?.unit || weather.unit || "");
  const extent = layer?.extent || meta.value?.extent || meta.value?.bbox;
  const width = Number(layer?.width || 0);
  const height = Number(layer?.height || 0);
  const variableNames = variables.value.map(item => variableZhName(item.name, null, item)).filter(Boolean);

  return {
    ...weather,
    file: resolvedFile.value,
    source: "ERA5",
    product: weather.product || "ERA5 再分析资料",
    element: bilingualElementName(layer, currentVariable.value),
    variable: selectedVariable.value,
    time: formatTimeLabel(currentTime.value) || currentTime.value || weather.time || "",
    level: weather.level || layer?.level || "地表",
    range: formatRange(extent) || weather.range || "",
    resolution: weather.resolution || "",
    grid: width && height ? `${width} x ${height}` : weather.grid || "",
    unit: unit || "-",
    missing: "",
    status: "",
    element_desc: variableDescription(selectedVariable.value, layer, currentVariable.value),
    variables: variableNames.join(", "),
    variable_count: variables.value.length,
    steps: imageUrls.length || layer?.times?.length || weather.steps || "",
    step_count: imageUrls.length || layer?.times?.length || weather.step_count || "",
    min: formatStat(stats.min, unit),
    mean: formatStat(stats.mean, unit),
    max: formatStat(stats.max, unit),
    extent,
    image_url: imageUrls[frameIndex.value] || imageUrls[0] || "",
    webp_url: layer?.webp_urls?.[frameIndex.value] || layer?.webp_urls?.[0] || "",
    times: layer?.times || meta.value?.times || [],
  };
}

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function initRenderer(width, height) {
  renderCanvas = renderCanvas || document.createElement("canvas");
  renderCanvas.width = Math.max(2, width);
  renderCanvas.height = Math.max(2, height);
  gl = gl || renderCanvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL2 is not supported by this browser.");

  if (program) return;

  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }

  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  valueTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, valueTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function packValues(values, stats, nodata) {
  const min = Number(stats.min ?? 0);
  const max = Number(stats.max ?? 1);
  const span = Math.max(max - min, 0.000001);
  return Uint8Array.from(values, value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= nodata + 1) return 0;
    return Math.max(1, Math.min(255, Math.round(((numeric - min) / span) * 254 + 1)));
  });
}

function renderGridImage(payload) {
  try {
    initRenderer(payload.width, payload.height);
    gl.viewport(0, 0, renderCanvas.width, renderCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bindTexture(gl.TEXTURE_2D, valueTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      payload.width,
      payload.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      packValues(payload.values, payload, payload.nodata)
    );
    gl.uniform1i(gl.getUniformLocation(program, "uGrid"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), 0.78);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return renderCanvas.toDataURL("image/png");
  } catch (err) {
    console.error("ERA5 WebGL render failed", err);
    return renderGridImage2d(payload);
  }
}

function renderGridImage2d(payload) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, payload.width);
  canvas.height = Math.max(2, payload.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(payload.width, payload.height);
  const packed = packValues(payload.values, payload, payload.nodata);

  for (let i = 0; i < packed.length; i += 1) {
    const offset = i * 4;
    if (packed[i] === 0) {
      image.data[offset + 3] = 0;
      continue;
    }
    const [r, g, b] = colorRamp((packed[i] - 1) / 254);
    image.data[offset] = r;
    image.data[offset + 1] = g;
    image.data[offset + 2] = b;
    image.data[offset + 3] = 200;
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function colorRamp(t) {
  const stops = [
    [37, 99, 235],
    [8, 145, 178],
    [22, 163, 74],
    [250, 204, 21],
    [220, 38, 38],
  ];
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return [0, 1, 2].map(channel =>
    Math.round(stops[index][channel] + (stops[index + 1][channel] - stops[index][channel]) * local)
  );
}

function removeImageryLayer() {
  surface?.clear();
}

function applyImageryLayer(payload) {
  if (!payload?.extent || !payload?.values?.length) {
    surface?.clear();
    return;
  }

  const [west, south, east, north] = payload.extent.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value)) || west >= east || south >= north) {
    error.value = "Invalid ERA5 extent";
    return;
  }

  surface?.setData(renderGridImage(payload), [west, south, east, north], 1);
  const extentKey = [west, south, east, north].join(",");
  if (extentKey !== lastExtentKey) {
    lastExtentKey = extentKey;
    const dx = Math.max((east - west) * 0.35, 0.5);
    const dy = Math.max((north - south) * 0.35, 0.5);
    flyToExtent?.([Math.max(-180, west - dx), Math.max(-90, south - dy), Math.min(180, east + dx), Math.min(90, north + dy)]);
  }
}

function applyImageLayer(payload) {
  if (!payload?.extent || !payload?.imageUrl) {
    surface?.clear();
    return;
  }

  const [west, south, east, north] = payload.extent.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value)) || west >= east || south >= north) {
    error.value = "Invalid ERA5 extent";
    return;
  }

  surface?.setData(toPublicUrl(payload.imageUrl), [west, south, east, north], 1);
  const extentKey = [west, south, east, north].join(",");
  if (extentKey !== lastExtentKey) {
    lastExtentKey = extentKey;
    const dx = Math.max((east - west) * 0.35, 0.5);
    const dy = Math.max((north - south) * 0.35, 0.5);
    flyToExtent?.([Math.max(-180, west - dx), Math.max(-90, south - dy), Math.min(180, east + dx), Math.min(90, north + dy)]);
  }
}

async function paintImageryLayer(payload) {
  await nextTick();
  applyImageryLayer(payload);
  requestAnimationFrame(() => {
    if (framePayload.value === payload) applyImageryLayer(payload);
  });
}

async function paintImageLayer(payload) {
  await nextTick();
  applyImageLayer(payload);
  requestAnimationFrame(() => {
    if (framePayload.value === payload) applyImageLayer(payload);
  });
}

function emitLayerMeta() {
  const layer = currentLayer.value;
  if (!layer) return;
  const times = layer.times || meta.value?.times || [];
  const imageUrls = layerImageUrls(layer);
  const panelInfo = buildPanelInfo(layer, imageUrls);
  const payload = {
    layer: "ERA5",
    variable: selectedVariable.value,
    file: panelInfo.file,
    element: panelInfo.element,
    unit: panelInfo.unit,
    time: panelInfo.time,
    level: panelInfo.level,
    range: panelInfo.range,
    grid: panelInfo.grid,
    missing: panelInfo.missing,
    status: panelInfo.status,
    min: panelInfo.min,
    mean: panelInfo.mean,
    max: panelInfo.max,
    times,
    axis_times: times,
    webp_urls: layer.webp_urls || [],
    image_urls: imageUrls,
    png_urls: layer.png_urls || [],
    grid_urls: layer.grid_urls || [],
    extent: panelInfo.extent,
    image_url: panelInfo.image_url,
    webp_url: panelInfo.webp_url,
    frame_count: Math.max(imageUrls.length || 0, layer.grid_urls?.length || 0, times.length || 0),
  };
  emit("variable-change", payload);
  emit("display-loaded", {
    meta: {
      ...(meta.value || {}),
      ...(framePayload.value || {}),
      source: "ERA5",
      file: panelInfo.file,
      element: panelInfo.element,
      time: panelInfo.time,
      level: panelInfo.level,
      range: panelInfo.range,
      grid: panelInfo.grid,
      unit: panelInfo.unit,
      missing: panelInfo.missing,
      status: panelInfo.status,
      extent: payload.extent,
      weather_info: panelInfo,
      extraRows: [
        ["elementDesc", "要素说明", panelInfo.element_desc],
        ["variable", "变量代号", selectedVariable.value],
        ["min", "最小值", panelInfo.min],
        ["mean", "平均值", panelInfo.mean],
        ["max", "最大值", panelInfo.max],
      ],
    },
    weather_info: panelInfo,
    variables: variables.value,
    times,
    webp_urls: imageUrls,
    file: resolvedFile.value,
    variable: selectedVariable.value,
  });
}

async function loadFrame() {
  const layer = currentLayer.value;
  const imageUrls = layerImageUrls(layer);
  if (!imageUrls.length) {
    await loadBinaryFrame();
    return;
  }

  const token = ++loadToken;
  const index = frameIndex.value;
  const stats = layer.stats?.[index] || layer.stats?.[0] || {};
  const payload = {
    variable: selectedVariable.value,
    label: layer.label || selectedVariable.value,
    unit: layer.unit || "",
    width: Number(layer.width) || 0,
    height: Number(layer.height) || 0,
    extent: layer.extent || meta.value?.extent || meta.value?.bbox,
    nodata: Number(layer.nodata ?? -999999),
    imageUrl: imageUrls[index] || imageUrls[0],
    min: Number(stats.min ?? 0),
    max: Number(stats.max ?? 1),
    mean: Number(stats.mean ?? 0),
    time: layer.times?.[index] || "",
  };
  if (token !== loadToken) return;

  framePayload.value = payload;
  gridLayer.value = layer;
  await paintImageLayer(payload);
  emitLayerMeta();
}

async function loadBinaryFrame() {
  const layer = currentLayer.value;
  if (!layer?.grid_urls?.length) {
    gridLayer.value = null;
    framePayload.value = null;
    removeImageryLayer();
    emitLayerMeta();
    return;
  }

  const token = ++loadToken;
  const index = frameIndex.value;
  const url = toPublicUrl(layer.grid_urls[index] || layer.grid_urls[0]);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ERA5 binary grid load failed: ${response.status}`);
  const bufferData = await response.arrayBuffer();
  if (token !== loadToken) return;

  const width = Number(layer.width);
  const height = Number(layer.height);
  const values = new Float32Array(bufferData);
  if (!width || !height || values.length !== width * height) {
    throw new Error(`ERA5 binary grid size mismatch: ${values.length} != ${width} x ${height}`);
  }

  const stats = layer.stats?.[index] || layer.stats?.[0] || {};
  const payload = {
    variable: selectedVariable.value,
    label: layer.label || selectedVariable.value,
    unit: layer.unit || "",
    width,
    height,
    extent: layer.extent || meta.value?.extent || meta.value?.bbox,
    nodata: Number(layer.nodata ?? -999999),
    values,
    min: Number(stats.min ?? 0),
    max: Number(stats.max ?? 1),
    mean: Number(stats.mean ?? 0),
    time: layer.times?.[index] || "",
  };

  framePayload.value = payload;
  gridLayer.value = layer;
  await paintImageryLayer(payload);
  emitLayerMeta();
}

function syncSelectedVariable(value) {
  syncingSelection = true;
  selectedVariable.value = value || "";
  queueMicrotask(() => {
    syncingSelection = false;
  });
}

async function loadDisplay(variableName = selectedVariable.value) {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams();
    if (variableName) params.set("variable", variableName);
    const query = params.toString();
    const response = await fetch(`${API_BASE}/api/display/ERA5${query ? `?${query}` : ""}`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "ERA5 data load failed");
    }
    display.value = normalizeDisplay(payload.data);
    variables.value = display.value.variables || [];
    const nextVariable = variableName || display.value.default_variable || meta.value?.default_variable || variables.value[0]?.name || "";
    syncSelectedVariable(nextVariable);
    await nextTick();
    await loadFrame();
  } catch (err) {
    gridLayer.value = null;
    framePayload.value = null;
    variables.value = [];
    removeImageryLayer();
    error.value = "ERA5 数据未加载";
    console.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(loadDisplay);
watch(refreshKey, () => loadDisplay(""));
watch(parsedKey, value => {
  if (value) loadDisplay("");
});
watch(selectedVariable, async value => {
  if (!syncingSelection && value) {
    emitLayerMeta();
    await loadFrame();
  }
});
watch(() => props.timeIndex, () => loadFrame());
watch(() => props.src, emitLayerMeta);
onBeforeUnmount(() => {
  removeImageryLayer();
  if (gl) {
    if (valueTexture) gl.deleteTexture(valueTexture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    gl = null;
  }
});
</script>

<style scoped>
.lc-note {
  margin: 0;
  padding: 0 9px 7px;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
