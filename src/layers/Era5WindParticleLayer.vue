<template>
  <canvas
    ref="canvas"
    class="era5-wind-particle-layer"
    :class="{ 'is-hidden': !visible }"
    aria-hidden="true"
  ></canvas>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createEra5WindParticleSystem } from "../utils/era5WindParticles";

const props = defineProps({
  field: { type: Object, default: null },
  visible: { type: Boolean, default: true },
  particleCount: { type: Number, default: 2_000 },
  maxAge: { type: Number, default: 120 },
  timeScale: { type: Number, default: 36_000 },
  trailLength: { type: Number, default: 16 },
  framesPerSecond: { type: Number, default: 30 },
  maxDisplaySpeed: { type: Number, default: 30 },
  opacity: { type: Number, default: 0.94 },
  lineWidth: { type: Number, default: 1.5 },
  speedColors: {
    type: Array,
    default: () => ["#2563eb", "#0891b2", "#16a34a", "#facc15", "#dc2626"],
  },
  seed: { type: Number, default: 1 },
});

const emit = defineEmits(["ready", "error", "stats"]);
const canvas = ref(null);
const mapProjector = inject("mapProjector", null);

let gl = null;
let program = null;
let vertexBuffer = null;
let locations = {};
let particleSystem = null;
let historyLon = null;
let historyLat = null;
let historyGeneration = null;
let projectedX = null;
let projectedY = null;
let projectedVisible = null;
let vertexData = null;
let historyCursor = 0;
let historySize = 0;
let animationFrame = 0;
let lastFrameAt = 0;
let lastStatsAt = 0;
let mounted = false;
let contextLost = false;

const vertexShader = [
  "#version 300 es",
  "in vec2 aPosition;",
  "in float aStrength;",
  "in float aTrailAlpha;",
  "out float vStrength;",
  "out float vTrailAlpha;",
  "void main() {",
  "  vStrength = aStrength;",
  "  vTrailAlpha = aTrailAlpha;",
  "  gl_Position = vec4(aPosition, 0.0, 1.0);",
  "}",
].join("\n");

const fragmentShader = [
  "#version 300 es",
  "precision highp float;",
  "in float vStrength;",
  "in float vTrailAlpha;",
  "out vec4 frag;",
  "uniform vec3 uColor0;",
  "uniform vec3 uColor1;",
  "uniform vec3 uColor2;",
  "uniform vec3 uColor3;",
  "uniform vec3 uColor4;",
  "uniform float uOpacity;",
  "void main() {",
  "  float position = clamp(vStrength, 0.0, 1.0) * 4.0;",
  "  vec3 color;",
  "  if (position < 1.0) color = mix(uColor0, uColor1, position);",
  "  else if (position < 2.0) color = mix(uColor1, uColor2, position - 1.0);",
  "  else if (position < 3.0) color = mix(uColor2, uColor3, position - 2.0);",
  "  else color = mix(uColor3, uColor4, position - 3.0);",
  "  float visibility = mix(0.72, 1.0, clamp(vStrength, 0.0, 1.0));",
  "  frag = vec4(color, clamp(vTrailAlpha * visibility * uOpacity, 0.0, 1.0));",
  "}",
].join("\n");

function particleError(code, message, cause) {
  const error = new Error(message);
  error.name = "Era5WindParticleLayerError";
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function reportError(error) {
  emit("error", error);
  console.error(error);
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "ERA5 wind shader compilation failed";
    gl.deleteShader(shader);
    throw particleError("SHADER_COMPILE_FAILED", message);
  }
  return shader;
}

function createProgram() {
  const vertex = compileShader(gl.VERTEX_SHADER, vertexShader);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentShader);
  const nextProgram = gl.createProgram();
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(nextProgram) || "ERA5 wind shader link failed";
    gl.deleteProgram(nextProgram);
    throw particleError("SHADER_LINK_FAILED", message);
  }
  return nextProgram;
}

function initializeWebGl() {
  if (!canvas.value) return false;
  gl = canvas.value.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  if (!gl) {
    reportError(particleError(
      "WEBGL2_UNAVAILABLE",
      "This browser does not support the WebGL2 ERA5 wind particle layer",
    ));
    return false;
  }

  try {
    program = createProgram();
    locations = {
      position: gl.getAttribLocation(program, "aPosition"),
      strength: gl.getAttribLocation(program, "aStrength"),
      trailAlpha: gl.getAttribLocation(program, "aTrailAlpha"),
      colors: [0, 1, 2, 3, 4].map(index =>
        gl.getUniformLocation(program, `uColor${index}`),
      ),
      opacity: gl.getUniformLocation(program, "uOpacity"),
    };
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    contextLost = false;
    resizeCanvas();
    allocateVertexBuffer();
    emit("ready");
    return true;
  } catch (error) {
    reportError(error);
    disposeWebGl(false);
    return false;
  }
}

function disposeWebGl(loseContext = true) {
  if (!gl) return;
  if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
  if (program) gl.deleteProgram(program);
  if (loseContext) gl.getExtension("WEBGL_lose_context")?.loseContext();
  vertexBuffer = null;
  program = null;
  locations = {};
  gl = null;
}

function integerProp(value, fallback, minimum = 1, maximum = 100_000) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}

function rebuildParticleSystem() {
  particleSystem = null;
  historyLon = null;
  historyLat = null;
  historyGeneration = null;
  projectedX = null;
  projectedY = null;
  projectedVisible = null;
  vertexData = null;
  historyCursor = 0;
  historySize = 0;

  if (!props.field) {
    clearCanvas();
    return;
  }
  try {
    const count = integerProp(props.particleCount, 2_000, 1, 20_000);
    const maxAge = integerProp(props.maxAge, 120, 1, 65_535);
    historySize = integerProp(props.trailLength, 16, 2, 32);
    particleSystem = createEra5WindParticleSystem(props.field, {
      count,
      maxAge,
      seed: props.seed,
    });
    const historyValueCount = count * historySize;
    historyLon = new Float32Array(historyValueCount);
    historyLat = new Float32Array(historyValueCount);
    historyGeneration = new Uint32Array(historyValueCount);
    projectedX = new Float32Array(historyValueCount);
    projectedY = new Float32Array(historyValueCount);
    projectedVisible = new Uint8Array(historyValueCount);
    const maxSegments = count * (historySize - 1);
    vertexData = new Float32Array(maxSegments * 2 * 4);
    writeHistorySlot();
    allocateVertexBuffer();
    lastFrameAt = 0;
  } catch (error) {
    reportError(error);
    clearCanvas();
  }
}

function allocateVertexBuffer() {
  if (!gl || !vertexBuffer || !vertexData) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData.byteLength, gl.DYNAMIC_DRAW);
}

function writeHistorySlot() {
  if (!particleSystem || !historyLon) return;
  const offset = historyCursor * particleSystem.count;
  historyLon.set(particleSystem.lon, offset);
  historyLat.set(particleSystem.lat, offset);
  historyGeneration.set(particleSystem.generation, offset);
}

function updateProjectedHistory() {
  if (!particleSystem || !mapProjector?.project) return;
  const total = particleSystem.count * historySize;
  for (let index = 0; index < total; index += 1) {
    if (historyGeneration[index] === 0) {
      projectedVisible[index] = 0;
      continue;
    }
    const point = mapProjector.project(historyLon[index], historyLat[index]);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      projectedVisible[index] = 0;
      continue;
    }
    projectedX[index] = point.x;
    projectedY[index] = point.y;
    projectedVisible[index] = point.visible ? 1 : 0;
  }
}

function buildVertexData(width, height) {
  if (!particleSystem || !vertexData || !width || !height) return 0;
  updateProjectedHistory();
  const count = particleSystem.count;
  const maxSpeed = Math.max(0.001, Number(props.maxDisplaySpeed) || 30);
  const longitudePeriod = particleSystem.field.longitudePeriod;
  let cursor = 0;

  for (let trailAge = 0; trailAge < historySize - 1; trailAge += 1) {
    const newerSlot = (historyCursor - trailAge + historySize) % historySize;
    const olderSlot = (newerSlot - 1 + historySize) % historySize;
    const trailAlpha = Math.pow(1 - trailAge / historySize, 0.85);
    for (let particle = 0; particle < count; particle += 1) {
      const newerIndex = newerSlot * count + particle;
      const olderIndex = olderSlot * count + particle;
      const generation = historyGeneration[newerIndex];
      if (
        !generation
        || generation !== historyGeneration[olderIndex]
        || !projectedVisible[newerIndex]
        || !projectedVisible[olderIndex]
      ) {
        continue;
      }
      if (
        particleSystem.field.periodicLongitude
        && Math.abs(historyLon[newerIndex] - historyLon[olderIndex]) > longitudePeriod * 0.5
      ) {
        continue;
      }
      const newerX = projectedX[newerIndex];
      const newerY = projectedY[newerIndex];
      const olderX = projectedX[olderIndex];
      const olderY = projectedY[olderIndex];
      if (Math.abs(newerX - olderX) > width * 0.5) continue;

      const strength = Math.min(1, Math.max(0, particleSystem.speed[particle] / maxSpeed));
      vertexData[cursor++] = olderX / width * 2 - 1;
      vertexData[cursor++] = 1 - olderY / height * 2;
      vertexData[cursor++] = strength;
      vertexData[cursor++] = trailAlpha * 0.82;
      vertexData[cursor++] = newerX / width * 2 - 1;
      vertexData[cursor++] = 1 - newerY / height * 2;
      vertexData[cursor++] = strength;
      vertexData[cursor++] = trailAlpha;
    }
  }
  return cursor / 4;
}

function normalizedColor(value, fallback) {
  let input = value;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    input = [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ];
  }
  if (!Array.isArray(input) || input.length < 3) return fallback;
  const color = input.slice(0, 3).map(component => Number(component));
  if (color.some(component => !Number.isFinite(component))) return fallback;
  return color.map(component => Math.min(255, Math.max(0, component)) / 255);
}

function normalizedPalette() {
  const fallback = [
    [37, 99, 235],
    [8, 145, 178],
    [22, 163, 74],
    [250, 204, 21],
    [220, 38, 38],
  ];
  const values = Array.isArray(props.speedColors) && props.speedColors.length === 5
    ? props.speedColors
    : fallback;
  return values.map((value, index) =>
    normalizedColor(value, fallback[index].map(component => component / 255)),
  );
}

function drawParticles() {
  if (!gl || !program || !particleSystem || !props.visible) {
    clearCanvas();
    return 0;
  }
  const state = mapProjector?.state?.value;
  const width = state?.width || canvas.value?.clientWidth || 0;
  const height = state?.height || canvas.value?.clientHeight || 0;
  if (!width || !height) return 0;
  resizeCanvas(width, height);
  const vertexCount = buildVertexData(width, height);

  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!vertexCount) return 0;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexData.subarray(0, vertexCount * 4));
  const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(locations.strength);
  gl.vertexAttribPointer(
    locations.strength,
    1,
    gl.FLOAT,
    false,
    stride,
    2 * Float32Array.BYTES_PER_ELEMENT,
  );
  gl.enableVertexAttribArray(locations.trailAlpha);
  gl.vertexAttribPointer(
    locations.trailAlpha,
    1,
    gl.FLOAT,
    false,
    stride,
    3 * Float32Array.BYTES_PER_ELEMENT,
  );
  const palette = normalizedPalette();
  palette.forEach((color, index) => {
    gl.uniform3f(locations.colors[index], color[0], color[1], color[2]);
  });
  gl.uniform1f(locations.opacity, Math.min(1, Math.max(0, Number(props.opacity) || 0)));
  gl.lineWidth(Math.min(4, Math.max(1, Number(props.lineWidth) || 1)));
  gl.drawArrays(gl.LINES, 0, vertexCount);
  return vertexCount / 2;
}

function resizeCanvas(widthValue, heightValue) {
  if (!gl || !canvas.value) return;
  const state = mapProjector?.state?.value;
  const cssWidth = Math.max(
    1,
    Math.round(Number(widthValue) || state?.width || canvas.value.clientWidth || 1),
  );
  const cssHeight = Math.max(
    1,
    Math.round(Number(heightValue) || state?.height || canvas.value.clientHeight || 1),
  );
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const renderWidth = Math.round(cssWidth * pixelRatio);
  const renderHeight = Math.round(cssHeight * pixelRatio);
  if (canvas.value.width !== renderWidth) canvas.value.width = renderWidth;
  if (canvas.value.height !== renderHeight) canvas.value.height = renderHeight;
  gl.viewport(0, 0, renderWidth, renderHeight);
}

function clearCanvas() {
  if (!gl) return;
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function animate(timestamp) {
  animationFrame = requestAnimationFrame(animate);
  if (!gl || contextLost || !particleSystem || !props.visible || document.hidden) {
    lastFrameAt = 0;
    return;
  }
  const fps = integerProp(props.framesPerSecond, 30, 1, 60);
  const frameInterval = 1_000 / fps;
  if (lastFrameAt && timestamp - lastFrameAt < frameInterval) return;
  const deltaSeconds = lastFrameAt
    ? Math.min(0.05, Math.max(0, (timestamp - lastFrameAt) / 1_000))
    : 1 / fps;
  lastFrameAt = timestamp;

  try {
    const step = particleSystem.step(deltaSeconds, {
      timeScale: Math.max(0, Number(props.timeScale) || 0),
    });
    historyCursor = (historyCursor + 1) % historySize;
    writeHistorySlot();
    const segmentCount = drawParticles();
    if (timestamp - lastStatsAt >= 1_000) {
      lastStatsAt = timestamp;
      emit("stats", {
        particles: particleSystem.count,
        segments: segmentCount,
        moved: step.moved,
        respawned: step.respawned,
        framesPerSecond: fps,
      });
    }
  } catch (error) {
    reportError(error);
    particleSystem = null;
    clearCanvas();
  }
}

function onContextLost(event) {
  event.preventDefault();
  contextLost = true;
  gl = null;
  program = null;
  vertexBuffer = null;
  reportError(particleError("WEBGL_CONTEXT_LOST", "ERA5 wind WebGL context was lost"));
}

function onContextRestored() {
  if (!mounted) return;
  if (initializeWebGl()) {
    allocateVertexBuffer();
    lastFrameAt = 0;
  }
}

onMounted(() => {
  mounted = true;
  if (!mapProjector?.project) {
    reportError(particleError(
      "MAP_PROJECTOR_MISSING",
      "ERA5 wind particle layer must be mounted inside ProjMap",
    ));
    return;
  }
  canvas.value.addEventListener("webglcontextlost", onContextLost);
  canvas.value.addEventListener("webglcontextrestored", onContextRestored);
  if (!initializeWebGl()) return;
  rebuildParticleSystem();
  animationFrame = requestAnimationFrame(animate);
});

watch(
  () => [props.field, props.particleCount, props.maxAge, props.trailLength, props.seed],
  rebuildParticleSystem,
);
watch(
  () => props.visible,
  visible => {
    lastFrameAt = 0;
    if (!visible) clearCanvas();
  },
);

onBeforeUnmount(() => {
  mounted = false;
  cancelAnimationFrame(animationFrame);
  canvas.value?.removeEventListener("webglcontextlost", onContextLost);
  canvas.value?.removeEventListener("webglcontextrestored", onContextRestored);
  particleSystem = null;
  historyLon = null;
  historyLat = null;
  historyGeneration = null;
  projectedX = null;
  projectedY = null;
  projectedVisible = null;
  vertexData = null;
  disposeWebGl();
});
</script>

<style scoped>
.era5-wind-particle-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.era5-wind-particle-layer.is-hidden {
  opacity: 0;
}
</style>
