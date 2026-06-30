<template>
  <LayerCard :badge="label" :file="resolvedFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <label class="lc-row">
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length">
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
const emit = defineEmits(["display-loaded"]);

const surface = inject("mapSurface", null);
const flyToExtent = inject("flyToExtent", null);
const layerRefreshKeys = inject("layerRefreshKeys", ref({}));
const colors = ["#1d4ed8", "#0891b2", "#16a34a", "#facc15", "#dc2626"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const COMMON_NC_DISPLAY_VARIABLES = [
  "Tair_f_inst",
  "Rainf_tavg",
  "TotalPrecip_tavg",
  "Wind_f_inst",
  "Qair_f_inst",
  "Psurf_f_inst",
  "AvgSurfT_inst",
  "SoilMoist_inst",
  "SoilTemp_inst",
  "SWdown_f_tavg",
];

const variables = ref([]);
const selectedVariable = ref("");
const grid = ref(null);
const loading = ref(false);
const error = ref("");
const refreshKey = computed(() => layerRefreshKeys.value?.cma || 0);

let binaryRequestId = 0;
let syncingVariable = false;
let renderCanvas = null;
let gl = null;
let program = null;
let buffer = null;
let valueTexture = null;

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
  vec3 c0 = vec3(0.10, 0.28, 0.70);
  vec3 c1 = vec3(0.06, 0.63, 0.76);
  vec3 c2 = vec3(0.22, 0.72, 0.34);
  vec3 c3 = vec3(0.98, 0.77, 0.18);
  vec3 c4 = vec3(0.86, 0.16, 0.18);
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

const resolvedFile = computed(() => grid.value?.file || props.file || "");
const legendTitle = computed(() => {
  if (!grid.value) return "CMA";
  return `${grid.value.variable}${grid.value.unit ? ` (${grid.value.unit})` : ""}`;
});

const ticks = computed(() => {
  if (!grid.value) return ["低", "", "", "高"];
  const min = Number(grid.value.min);
  const max = Number(grid.value.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["低", "", "", "高"];
  return [min, min + (max - min) / 3, min + (max - min) * 2 / 3, max].map(formatTick);
});

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  return value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
}

function variableLabel(item) {
  const name = item?.name || "";
  const label = item?.label || "";
  return label && label !== name ? `${name} - ${label}` : name;
}

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
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
  if (!gl) throw new Error("当前浏览器不支持 WebGL2");

  if (!program) {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

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
}

function packedValues(payload) {
  const min = Number(payload.min ?? 0);
  const max = Number(payload.max ?? 1);
  const span = Math.max(max - min, 0.000001);
  const nodata = Number(payload.nodata ?? -999999);
  return Uint8Array.from(payload.values || [], value => {
    if (!Number.isFinite(value) || value <= nodata + 1) return 0;
    return Math.max(1, Math.min(255, Math.round(((value - min) / span) * 254 + 1)));
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, payload.width, payload.height, 0, gl.RED, gl.UNSIGNED_BYTE, packedValues(payload));
    gl.uniform1i(gl.getUniformLocation(program, "uGrid"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), 0.78);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return renderCanvas.toDataURL("image/png");
  } catch (err) {
    console.error("CMA WebGL render failed", err);
    return renderGridImage2d(payload);
  }
}

function renderGridImage2d(payload) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, payload.width);
  canvas.height = Math.max(2, payload.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(payload.width, payload.height);
  const packed = packedValues(payload);

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
    [29, 78, 216],
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

function clearImageryLayer() {
  surface?.clear();
}

function applyImageryLayer() {
  const payload = grid.value;
  if (!payload?.extent || !payload?.values?.length) {
    clearImageryLayer();
    return;
  }
  const [west, south, east, north] = payload.extent;
  surface?.setData(renderGridImage(payload), payload.extent, 1);
  const dx = Math.max((east - west) * 0.35, 0.5);
  const dy = Math.max((north - south) * 0.35, 0.5);
  flyToExtent?.([Math.max(-180, west - dx), Math.max(-90, south - dy), Math.min(180, east + dx), Math.min(90, north + dy)]);
}

function emitDisplay(display) {
  const payload = display.grid;
  const meta = payload?.meta || display.meta_json || null;
  emit("display-loaded", {
    meta,
    variables: display.variables || [],
    times: display.times || [],
    frames: display.frames || [],
    file: payload?.file || meta?.file || "",
    variable: payload?.variable || "",
  });
}

async function fetchCmaDisplay(variable, levelIndex = 0) {
  const params = new URLSearchParams();
  if (variable) params.set("variable", variable);
  params.set("level_index", String(levelIndex));
  const response = await fetch(`${API_BASE}/api/display/CMA?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(payload.detail || "CMA 数据读取失败");
  return payload.data;
}

function displayFromParsed(parsed, variableName) {
  const meta = parsed?.meta || {};
  const cma = meta.extra?.cma || {};
  const product = Object.values(cma.products || {})[0] || {};
  const topVariables = Array.isArray(meta.variables) ? meta.variables : [];
  const productVariables = Array.isArray(product.variables) ? product.variables : [];
  const allVariables = topVariables.length && typeof topVariables[0] === "object" ? topVariables : productVariables;
  const displayVariables = allVariables
    .filter(item => isGridVariable(item))
    .map(item => ({
      name: item.name,
      label: item.long_name || item.name,
      unit: item.display_unit || item.unit || "",
      dims: item.dims || [],
      shape: item.shape || [],
      float32: item.float32 || null,
      band: item.band || null,
      stats: item.stats || null,
    }));
  const variables = cma.product_type === "LAND_NC" || product.product_type === "LAND_NC"
    ? commonNcVariables(displayVariables)
    : displayVariables;
  const frames = normalizeFrames(meta, parsed);
  const firstMetaVariable = topVariables[0]?.name || topVariables[0] || "";
  const primary = variableName || meta.default_variable || cma.primary_variable || variables[0]?.name || firstMetaVariable || "";
  return {
    business_type: "CMA",
    meta_json: meta,
    variables,
    frames,
    times: frames.map(frame => frame.time).filter(Boolean).length
      ? frames.map(frame => frame.time).filter(Boolean)
      : (Array.isArray(meta.times) ? meta.times : []),
    frame_count: frames.length,
    grid: {
      file: frames[0]?.file || parsed?.file_name || meta.file || sourceFileName(meta.source_file) || "",
      variable: primary,
      unit: variableUnit(variables, primary) || meta.unit || "",
      extent: meta.extent || meta.bbox || [73, 15, 135, 55],
      min: 0,
      max: 1,
      mean: 0,
      nodata: -999999,
      meta,
    },
  };
}

function isGridVariable(item) {
  const dims = item?.dims || [];
  const shape = item?.shape || [];
  return Boolean(item?.float32) || Boolean(item?.band) || dims.slice(-2).join(",") === "lat,lon" || [2, 3].includes(shape.length);
}

function commonNcVariables(items) {
  const byName = new Map(items.filter(item => item.name).map(item => [item.name, item]));
  const picked = COMMON_NC_DISPLAY_VARIABLES.map(name => byName.get(name)).filter(Boolean);
  return picked.length ? picked : items;
}

function variableUnit(items, name) {
  return items.find(item => item.name === name)?.unit || "";
}

function variableStats(items, name) {
  const stats = items.find(item => item.name === name)?.stats;
  if (!stats) return null;
  const min = Number(stats.min);
  const max = Number(stats.max);
  return Number.isFinite(min) && Number.isFinite(max) && max > min
    ? { min, max, mean: Number(stats.mean) }
    : null;
}

function activeFrame(display) {
  const frames = Array.isArray(display?.frames) ? display.frames : [];
  if (!frames.length) return null;
  const index = Math.min(Math.max(Number(props.timeIndex) || 0, 0), frames.length - 1);
  return frames[index] || frames[0];
}

function normalizeFrames(meta, parsed) {
  if (Array.isArray(meta?.frames) && meta.frames.length) return meta.frames;
  const source = Array.isArray(meta?.source_file) ? meta.source_file : [meta?.source_file || parsed?.file_name || meta?.file].filter(Boolean);
  return source.map((item, index) => ({
    index,
    file: sourceFileName(item),
    source_file: item,
    time: Array.isArray(meta?.times) ? meta.times[index] : "",
    time_label: Array.isArray(meta?.times) ? meta.times[index] : "",
    extent: meta?.extent || meta?.bbox || null,
  }));
}

function sourceFileName(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.split(/[\\/]/).pop();
}

function binaryUrl(display, variableName) {
  const params = new URLSearchParams();
  const frame = activeFrame(display);
  const fileName = frame?.file || display?.grid?.file || props.file || "";
  if (fileName) params.set("file", fileName);
  if (variableName) params.set("variable", variableName);
  params.set("level_index", String(props.levelIndex));
  return `${API_BASE}/api/cma/grid?${params.toString()}`;
}

function headerNumber(headers, name, fallback = 0) {
  const raw = headers.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function headerExtent(headers, fallback) {
  const value = headers.get("X-CMA-Extent");
  if (!value) return fallback;
  const extent = value.split(",").map(Number);
  return extent.length === 4 && extent.every(Number.isFinite) ? extent : fallback;
}

async function loadBinaryGrid(display, variableName) {
  const requestId = ++binaryRequestId;
  const response = await fetch(binaryUrl(display, variableName));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "CMA 二进制格点读取失败");
  }

  const buffer = await response.arrayBuffer();
  if (requestId !== binaryRequestId) return;

  const baseGrid = display.grid || {};
  const fixedStats = variableStats(display.variables || [], variableName);
  const values = new Float32Array(buffer);
  const width = headerNumber(response.headers, "X-CMA-Nx", baseGrid.width);
  const height = headerNumber(response.headers, "X-CMA-Ny", baseGrid.height);
  if (values.length !== width * height) {
    throw new Error(`CMA 二进制格点尺寸不匹配：${values.length} != ${width * height}`);
  }

  grid.value = {
    ...baseGrid,
    file: activeFrame(display)?.file || baseGrid.file,
    variable: response.headers.get("X-CMA-Variable") || variableName || baseGrid.variable,
    unit: response.headers.get("X-CMA-Unit") || baseGrid.unit,
    width,
    height,
    extent: headerExtent(response.headers, baseGrid.extent),
    min: fixedStats?.min ?? headerNumber(response.headers, "X-CMA-Min", baseGrid.min),
    max: fixedStats?.max ?? headerNumber(response.headers, "X-CMA-Max", baseGrid.max),
    mean: fixedStats?.mean ?? headerNumber(response.headers, "X-CMA-Mean", baseGrid.mean),
    nodata: headerNumber(response.headers, "X-CMA-Missing", baseGrid.nodata ?? -999999),
    values,
  };
}

async function loadDisplay(variableName = selectedVariable.value) {
  loading.value = true;
  error.value = "";
  try {
    const display = props.parsed?.meta
      ? displayFromParsed(props.parsed, variableName)
      : await fetchCmaDisplay(variableName, props.levelIndex);
    variables.value = display.variables || [];
    const nextVariable = display.grid?.variable || display.meta_json?.extra?.cma?.primary_variable || variables.value[0]?.name || "";
    syncingVariable = true;
    selectedVariable.value = nextVariable;
    syncingVariable = false;
    await loadBinaryGrid(display, nextVariable);
    emitDisplay({ ...display, grid: grid.value });
    applyImageryLayer();
  } catch (err) {
    grid.value = null;
    clearImageryLayer();
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadDisplay());

watch(selectedVariable, value => {
  if (value && !syncingVariable) loadDisplay(value);
});
watch(() => props.levelIndex, () => loadDisplay());
watch(() => props.timeIndex, () => loadDisplay(selectedVariable.value));
watch(() => props.parsed, () => loadDisplay(selectedVariable.value));
watch(refreshKey, () => loadDisplay(selectedVariable.value));

onBeforeUnmount(clearImageryLayer);
</script>

<style scoped>
.lc-error {
  margin: 8px 0 0;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
}
</style>
