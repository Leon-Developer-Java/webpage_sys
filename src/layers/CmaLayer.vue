<template>
  <div class="cma-control">
    <label>
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length">
        <option v-for="item in variables" :key="item.name" :value="item.name">
          {{ item.name }}
        </option>
      </select>
    </label>
    <small v-if="grid">{{ grid.file }}</small>
    <small v-else-if="loading">正在读取 CMA 格点...</small>
    <small v-else>{{ error || "暂无 CMA 格点数据" }}</small>
    <div class="cma-legend">
      <small>{{ legendTitle }}</small>
      <div class="legend-bar" :style="{ background: gradient }"></div>
      <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
    </div>
  </div>
</template>

<script setup>
import { Rectangle, SingleTileImageryProvider } from "cesium";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  levelIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded"]);

const viewerRef = inject("cesiumViewer", ref(null));
const layerRefreshKeys = inject("layerRefreshKeys", ref({}));
const colors = ["#1d4ed8", "#0891b2", "#16a34a", "#facc15", "#dc2626"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const variables = ref([]);
const selectedVariable = ref("");
const grid = ref(null);
const loading = ref(false);
const error = ref("");
const renderPreview = ref("");
const renderStatus = ref("等待 CMA 数据");
const layerStatus = ref("等待地图图层");
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";

let imageryLayer = null;
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

const legendTitle = computed(() => {
  if (!grid.value) return "CMA";
  return `${grid.value.variable}${grid.value.unit ? ` (${grid.value.unit})` : ""}`;
});
const refreshKey = computed(() => layerRefreshKeys.value?.cma || 0);

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
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      payload.width,
      payload.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      packedValues(payload)
    );
    gl.uniform1i(gl.getUniformLocation(program, "uGrid"), 0);
    gl.uniform1f(gl.getUniformLocation(program, "uOpacity"), 0.78);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const dataUrl = renderCanvas.toDataURL("image/png");
    renderPreview.value = dataUrl;
    renderStatus.value = `WebGL 已生成色彩图：${payload.width} x ${payload.height}，数值 ${payload.min} - ${payload.max}`;
    return dataUrl;
  } catch (err) {
    console.error("CMA WebGL render failed", err);
    const dataUrl = renderGridImage2d(payload);
    renderPreview.value = dataUrl;
    renderStatus.value = `WebGL 失败，已用 Canvas 2D 兜底：${err?.message || err}`;
    return dataUrl;
  }
}

function renderGridImage2d(payload) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, payload.width);
  canvas.height = Math.max(2, payload.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(payload.width, payload.height);
  const packed = packedValues(payload);

  for (let i = 0; i < packed.length; i++) {
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

function removeImageryLayer() {
  const viewer = viewerRef?.value;
  if (viewer && imageryLayer) viewer.imageryLayers.remove(imageryLayer, true);
  imageryLayer = null;
  layerStatus.value = "地图图层未添加";
}

function applyImageryLayer() {
  const viewer = viewerRef?.value;
  const payload = grid.value;
  if (!viewer) {
    layerStatus.value = "等待 Cesium 地图初始化";
    return;
  }
  if (!payload?.extent || !payload?.values?.length) {
    layerStatus.value = "没有可叠加的格点数据";
    return;
  }

  removeImageryLayer();
  const [west, south, east, north] = payload.extent;
  const rectangle = paddedRectangle(west, south, east, north);
  const imageUrl = renderGridImage(payload);
  try {
    imageryLayer = viewer.imageryLayers.addImageryProvider(new SingleTileImageryProvider({
      url: imageUrl,
      rectangle: Rectangle.fromDegrees(west, south, east, north),
      tileWidth: payload.width,
      tileHeight: payload.height,
    }));
    imageryLayer.alpha = 1;
    layerStatus.value = `Cesium 图层已添加：${west.toFixed(3)}, ${south.toFixed(3)} - ${east.toFixed(3)}, ${north.toFixed(3)}`;
    viewer.camera.setView({ destination: rectangle });
    viewer.scene.requestRender();
  } catch (err) {
    console.error("CMA Cesium imagery layer failed", err);
    layerStatus.value = `Cesium 图层添加失败：${err?.message || err}`;
  }
}

function paddedRectangle(west, south, east, north) {
  const dx = Math.max((east - west) * 0.35, 0.5);
  const dy = Math.max((north - south) * 0.35, 0.5);
  return Rectangle.fromDegrees(
    Math.max(-180, west - dx),
    Math.max(-90, south - dy),
    Math.min(180, east + dx),
    Math.min(90, north + dy)
  );
}

function emitDisplay(display) {
  const payload = display.grid;
  const meta = payload?.meta || display.meta_json || null;
  emit("display-loaded", {
    meta,
    variables: display.variables || [],
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

async function loadDisplay(variableName = selectedVariable.value) {
  loading.value = true;
  error.value = "";
  try {
    const display = await fetchCmaDisplay(variableName, props.levelIndex);
    variables.value = display.variables || [];
    grid.value = display.grid;
    renderStatus.value = grid.value ? `已收到格点：${grid.value.width} x ${grid.value.height}` : "后端未返回 grid";
    selectedVariable.value = grid.value?.variable || display.meta_json?.extra?.cma?.primary_variable || variables.value[0]?.name || "";
    emitDisplay(display);
    applyImageryLayer();
  } catch (err) {
    grid.value = null;
    renderPreview.value = "";
    renderStatus.value = `色彩图未生成：${err?.message || err}`;
    removeImageryLayer();
    error.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadDisplay());

watch(() => viewerRef?.value, () => applyImageryLayer());
watch(selectedVariable, value => {
  if (value) loadDisplay(value);
});
watch(() => props.levelIndex, () => loadDisplay());
watch(refreshKey, () => loadDisplay(selectedVariable.value));

onBeforeUnmount(removeImageryLayer);
</script>

<style scoped>
.cma-control {
  position: absolute;
  top: 76px;
  left: 12px;
  z-index: 5;
  display: grid;
  gap: 5px;
  width: min(240px, calc(100% - 24px));
  padding: 8px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--glass);
  color: var(--text);
  font-size: 11px;
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
}

.cma-control label {
  display: grid;
  grid-template-columns: 34px 1fr;
  align-items: center;
  gap: 7px;
}

.cma-control select {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 7px;
  background: var(--field);
  color: var(--text);
  font: inherit;
  outline: none;
  color-scheme: light dark;
}

.cma-control select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.cma-control option {
  background: var(--field);
  color: var(--text);
}

.cma-control small {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.app.dark) .cma-control select,
:global(.app.dark) .cma-control option {
  background: #111827;
  color: #e5edf7;
}

.cma-legend {
  display: grid;
  gap: 4px;
  padding-top: 5px;
  border-top: 1px solid var(--border);
}

.cma-legend small {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

.cma-legend .legend-bar {
  height: 8px;
  border-radius: 4px;
}

.cma-legend ul {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.cma-legend ul li {
  flex: 1;
  min-width: 0;
  text-align: center;
}
</style>
