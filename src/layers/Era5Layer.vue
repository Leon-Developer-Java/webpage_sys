<template>
  <WebglLayer v-if="!grid && imageSrc" :src="imageSrc" :extent="imageExtent" />
  <LayerCard
    :badge="label"
    :file="resolvedFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
  >
    <label class="lc-row">
      <span>要素</span>
      <select v-model="selectedVariable" :disabled="loading || !variables.length">
        <option v-for="item in variables" :key="item.name" :value="item.name">
          {{ item.label || item.name }}
        </option>
      </select>
    </label>
  </LayerCard>
</template>

<script setup>
import { Rectangle, SingleTileImageryProvider } from "cesium";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import WebglLayer from "../components/WebglLayer.vue";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: String,
  file: String,
});
const emit = defineEmits(["display-loaded"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const viewerRef = inject("cesiumViewer", ref(null));
const layerRefreshKeys = inject("layerRefreshKeys", ref({}));

const colors = ["#2563eb", "#0891b2", "#16a34a", "#facc15", "#dc2626"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const display = ref(null);
const grid = ref(null);
const variables = ref([]);
const selectedVariable = ref("");
const loading = ref(false);
const error = ref("");

let imageryLayer = null;
let renderCanvas = null;
let gl = null;
let program = null;
let buffer = null;
let valueTexture = null;
let syncingSelection = false;

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

const meta = computed(() => display.value?.meta_json ?? null);
const imageSrc = computed(() => props.src || toPublicUrl(display.value?.png));
const imageExtent = computed(() => props.extent || meta.value?.extent || meta.value?.bbox || [73, 15, 135, 55]);
const resolvedFile = computed(() => grid.value?.file || fileName(meta.value?.source_file) || fileName(display.value?.meta_file) || props.file || "");
const refreshKey = computed(() => layerRefreshKeys.value?.era5 || 0);

const legendTitle = computed(() => {
  if (loading.value) return "ERA5 loading";
  if (error.value) return error.value;
  if (grid.value) {
    const labelText = grid.value.label || grid.value.variable || "ERA5";
    return `${labelText}${grid.value.unit ? ` (${grid.value.unit})` : ""}`;
  }
  const weather = meta.value?.weather_info || {};
  return weather.element || meta.value?.extra?.default_variable || "ERA5";
});

const ticks = computed(() => {
  const source = grid.value || meta.value?.weather_info || {};
  const min = Number(source.min);
  const max = Number(source.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["low", "", "", "", "high"];
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
  return idx >= 0 ? `${API_BASE}${normalized.slice(idx)}` : "";
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  return value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
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

function packedValues(payload) {
  const min = Number(payload.min ?? 0);
  const max = Number(payload.max ?? 1);
  const span = Math.max(max - min, 0.000001);
  const nodata = Number(payload.nodata ?? -999999);
  return Uint8Array.from(payload.values || [], value => {
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
      packedValues(payload)
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
  const viewer = viewerRef?.value;
  if (viewer && imageryLayer) viewer.imageryLayers.remove(imageryLayer, true);
  imageryLayer = null;
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

function applyImageryLayer() {
  const viewer = viewerRef?.value;
  const payload = grid.value;
  if (!viewer || !payload?.extent || !payload?.values?.length) return;

  const [west, south, east, north] = payload.extent.map(Number);
  if ([west, south, east, north].some(value => !Number.isFinite(value)) || west >= east || south >= north) {
    error.value = "Invalid ERA5 extent";
    return;
  }

  removeImageryLayer();
  try {
    const imageUrl = renderGridImage(payload);
    imageryLayer = viewer.imageryLayers.addImageryProvider(new SingleTileImageryProvider({
      url: imageUrl,
      rectangle: Rectangle.fromDegrees(west, south, east, north),
      tileWidth: payload.width,
      tileHeight: payload.height,
    }));
    imageryLayer.alpha = 1;
    viewer.camera.setView({ destination: paddedRectangle(west, south, east, north) });
    viewer.scene.requestRender();
  } catch (err) {
    error.value = "ERA5 layer failed";
    console.error("ERA5 Cesium imagery layer failed", err);
  }
}

function emitDisplayLoaded() {
  const currentMeta = grid.value?.meta || meta.value;
  if (!currentMeta) return;
  emit("display-loaded", {
    meta: currentMeta,
    variables: display.value?.variables || grid.value?.variables || meta.value?.variables || [],
    file: grid.value?.file || fileName(meta.value?.source_file),
    variable: grid.value?.variable || meta.value?.extra?.default_variable || "",
  });
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
    display.value = payload.data;
    grid.value = payload.data?.grid || null;
    variables.value = payload.data?.variables || grid.value?.variables || [];
    syncSelectedVariable(grid.value?.variable || variableName || variables.value[0]?.name || "");
    emitDisplayLoaded();
    applyImageryLayer();
  } catch (err) {
    grid.value = null;
    variables.value = [];
    removeImageryLayer();
    error.value = "ERA5 data not loaded";
    console.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(loadDisplay);
watch(() => viewerRef?.value, () => applyImageryLayer());
watch(refreshKey, () => loadDisplay());
watch(selectedVariable, value => {
  if (!syncingSelection && value && value !== grid.value?.variable) loadDisplay(value);
});
watch(() => props.src, emitDisplayLoaded);
onBeforeUnmount(removeImageryLayer);
</script>
