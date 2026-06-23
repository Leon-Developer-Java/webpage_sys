<template>
  <canvas ref="canvas" class="webgl-render-source"></canvas>
</template>

<script setup>
import { ImageryLayer, Rectangle, SingleTileImageryProvider } from "cesium";
import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  src: String,
  extent: { type: Array, default: () => [73, 15, 135, 55] },
  values: Object,
  width: Number,
  height: Number,
  product: String,
  missing: { type: Number, default: -9999 },
  viewer: Object,
  alpha: { type: Number, default: 1 },
});
const canvas = ref(null);
const viewerRef = inject("cesiumViewer", ref(null));
let gl, program, texture, hasTex = false;
let renderMode = 0;
let textureVersion = 0;
let uModeLoc = null;
let uMissingLoc = null;
let imageryLayer = null;
let imageryViewer = null;

const vert = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const frag = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uTex;
uniform int uMode;
uniform float uMissing;

vec4 rgba(float r, float g, float b, float a) {
  return vec4(r / 255.0, g / 255.0, b / 255.0, a / 255.0);
}

vec4 reflectivity(float v) {
  if (v <= uMissing + 0.5 || isnan(v) || v < 0.0) return vec4(0.0);
  if (v < 5.0) return rgba(4.0, 233.0, 231.0, 160.0);
  if (v < 10.0) return rgba(1.0, 159.0, 244.0, 175.0);
  if (v < 15.0) return rgba(3.0, 0.0, 244.0, 190.0);
  if (v < 20.0) return rgba(2.0, 253.0, 2.0, 205.0);
  if (v < 25.0) return rgba(1.0, 197.0, 1.0, 215.0);
  if (v < 30.0) return rgba(0.0, 142.0, 0.0, 225.0);
  if (v < 35.0) return rgba(253.0, 248.0, 2.0, 230.0);
  if (v < 40.0) return rgba(229.0, 188.0, 0.0, 235.0);
  if (v < 45.0) return rgba(253.0, 149.0, 0.0, 240.0);
  if (v < 50.0) return rgba(253.0, 0.0, 0.0, 242.0);
  if (v < 55.0) return rgba(212.0, 0.0, 0.0, 245.0);
  if (v < 60.0) return rgba(188.0, 0.0, 0.0, 248.0);
  if (v < 65.0) return rgba(248.0, 0.0, 253.0, 248.0);
  if (v < 70.0) return rgba(152.0, 84.0, 198.0, 250.0);
  return rgba(253.0, 253.0, 253.0, 255.0);
}

vec4 velocity(float v) {
  if (v <= uMissing + 0.5 || isnan(v)) return vec4(0.0);
  if (v < -20.0) return rgba(49.0, 54.0, 149.0, 235.0);
  if (v < -10.0) return rgba(69.0, 117.0, 180.0, 235.0);
  if (v < -5.0) return rgba(116.0, 173.0, 209.0, 230.0);
  if (v < -1.0) return rgba(171.0, 217.0, 233.0, 225.0);
  if (v < 0.0) return rgba(224.0, 243.0, 248.0, 210.0);
  if (v < 1.0) return rgba(245.0, 245.0, 245.0, 180.0);
  if (v < 5.0) return rgba(254.0, 224.0, 144.0, 220.0);
  if (v < 10.0) return rgba(253.0, 174.0, 97.0, 230.0);
  if (v < 20.0) return rgba(244.0, 109.0, 67.0, 235.0);
  if (v < 30.0) return rgba(215.0, 48.0, 39.0, 240.0);
  return rgba(165.0, 0.0, 38.0, 245.0);
}

void main(){
  if (uMode == 0) {
    frag = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
    return;
  }

  float value = texture(uTex, vUv).r;
  frag = uMode == 2 ? velocity(value) : reflectivity(value);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader 编译失败");
  }
  return shader;
}

function setCanvasSize(width, height) {
  const nextWidth = Math.max(1, Number(width) || 1);
  const nextHeight = Math.max(1, Number(height) || 1);
  if (canvas.value.width !== nextWidth) canvas.value.width = nextWidth;
  if (canvas.value.height !== nextHeight) canvas.value.height = nextHeight;
  gl.viewport(0, 0, nextWidth, nextHeight);
}

function currentRectangle() {
  const [west, south, east, north] = props.extent ?? [];
  const values = [west, south, east, north].map(Number);
  if (values.some((item) => !Number.isFinite(item))) return null;
  if (values[0] >= values[2] || values[1] >= values[3]) return null;
  return Rectangle.fromDegrees(values[0], values[1], values[2], values[3]);
}

function currentViewer() {
  return props.viewer || viewerRef?.value || null;
}

function removeImageryLayer() {
  if (imageryViewer && imageryLayer) {
    try {
      imageryViewer.imageryLayers.remove(imageryLayer, true);
      imageryViewer.scene.requestRender();
    } catch {
      // The owning Cesium viewer may already be destroyed during projection changes.
    }
  }
  imageryLayer = null;
  imageryViewer = null;
}

function updateCesiumLayer() {
  const viewer = currentViewer();
  const rectangle = currentRectangle();
  if (!viewer || !hasTex || !rectangle) {
    removeImageryLayer();
    return;
  }

  let url = "";
  try {
    gl.finish();
    url = canvas.value.toDataURL("image/png");
  } catch (err) {
    console.error("WebGL 渲染结果导出失败", err);
    removeImageryLayer();
    return;
  }

  removeImageryLayer();
  imageryLayer = new ImageryLayer(new SingleTileImageryProvider({
    url,
    rectangle,
    tileWidth: canvas.value.width,
    tileHeight: canvas.value.height,
  }));
  imageryLayer.alpha = Math.min(1, Math.max(0, Number(props.alpha) || 0));
  viewer.imageryLayers.add(imageryLayer);
  imageryViewer = viewer;
  viewer.scene.requestRender();
}

function draw() {
  if (!gl) return;
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!hasTex) {
    updateCesiumLayer();
    return;
  }
  gl.useProgram(program);
  gl.uniform1i(uModeLoc, renderMode);
  gl.uniform1f(uMissingLoc, props.missing);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  updateCesiumLayer();
}

function bindCommonTextureParams(filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function loadImageTexture() {
  const currentVersion = ++textureVersion;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    if (currentVersion !== textureVersion || !gl) return;
    setCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
    texture = texture || gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    bindCommonTextureParams(gl.LINEAR);
    renderMode = 0;
    hasTex = true;
    draw();
  };
  image.onerror = () => {
    if (currentVersion !== textureVersion) return;
    hasTex = false;
    draw();
  };
  image.src = props.src;
}

function loadGridTexture() {
  ++textureVersion;
  if (!props.values || !props.width || !props.height) {
    hasTex = false;
    draw();
    return;
  }

  setCanvasSize(props.width, props.height);
  texture = texture || gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R32F,
    props.width,
    props.height,
    0,
    gl.RED,
    gl.FLOAT,
    props.values,
  );
  bindCommonTextureParams(gl.NEAREST);
  renderMode = props.product === "VRAD" ? 2 : 1;
  hasTex = true;
  draw();
}

function updateTexture() {
  if (!gl) return;
  hasTex = false;
  if (props.values && props.width && props.height) {
    loadGridTexture();
  } else if (props.src) {
    loadImageTexture();
  } else {
    ++textureVersion;
    draw();
  }
}

onMounted(() => {
  gl = canvas.value.getContext("webgl2", { alpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("当前浏览器不支持 WebGL2。");
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program 链接失败");
  }
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uTex"), 0);
  uModeLoc = gl.getUniformLocation(program, "uMode");
  uMissingLoc = gl.getUniformLocation(program, "uMissing");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  updateTexture();
});

watch(
  () => [props.src, props.values, props.width, props.height, props.product, props.missing],
  updateTexture,
);

watch(() => props.extent, updateCesiumLayer, { deep: true });

watch(() => props.viewer, updateCesiumLayer);

watch(() => props.alpha, updateCesiumLayer);

watch(
  () => viewerRef?.value,
  (viewer) => {
    if (viewer) updateCesiumLayer();
    else removeImageryLayer();
  },
);

onBeforeUnmount(() => {
  removeImageryLayer();
  if (texture && gl) gl.deleteTexture(texture);
});
</script>

<style scoped>
.webgl-render-source {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
