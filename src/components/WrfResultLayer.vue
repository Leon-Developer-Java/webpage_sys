<template>
  <WebglLayer v-if="precise && imageUrl" :key="layerKey" :src="imageUrl" :extent="extent" :crs="currentDomain.geolocation.target_crs" />
  <LayerCard
    badge="WRF"
    :file="display?.task_id || taskId || '暂无成功任务'"
    :legend-title="displayUnit.unit"
    :gradient="gradient"
    :ticks="legendTicks"
    :show-legend="Boolean(displayedFrame && currentVariable && gradient)"
    :initial-collapsed="false"
  >
    <label class="lc-row">
      <span>区域</span>
      <select v-model="selectedDomain">
        <option v-for="item in domains" :key="item.id" :value="item.id">
          {{ item.id.toUpperCase() }} · {{ formatResolution(item.dx) }}
        </option>
      </select>
    </label>
    <label class="lc-row">
      <span>变量</span>
      <select v-model="selectedVariable">
        <option v-for="item in variables" :key="item.name" :value="item.name">{{ item.label || item.name }}</option>
      </select>
    </label>
    <div class="lc-row"><span>时次</span><b>{{ displayedFrame?.time || (imageLoading ? '加载中' : '—') }}</b></div>
    <div v-if="!precise && currentFrame" class="lc-warning">{{ display?.geolocation_repair?.message || '该产品缺少可验证的投影定位信息，仅提供原始图预览。' }}<img v-if="imageUrl" :src="imageUrl" alt="WRF 原始结果预览" class="lc-legacy-image" @error="onImageError" /></div>
    <div v-if="meta?.quality?.status === 'partial'" class="lc-warning">
      部分结果：排除 {{ meta.quality.unreadable_frames?.length || meta.quality.excluded_frames?.length || 0 }} 个不可读帧，缺失时次已记录在元数据中。
    </div>
    <div v-if="error" class="lc-error" role="alert">{{ error }} <button :disabled="imageLoading" @click="retry">重试加载</button></div>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { fetchWrfAsset, getWrfDisplay } from "../api";
import LayerCard from "./LayerCard.vue";
import WebglLayer from "./WebglLayer.vue";
import {unitPresentation,formatDisplayValue,paletteGradient} from "../../packages/wrf-ui/src/presentation.js";

const props = defineProps({
  timeIndex: { type: Number, default: 0 },
  taskId: { type: String, default: "" },
  initialDomain: { type: String, default: "" },
  initialVariable: { type: String, default: "" },
  parsed: { type: Object, default: null },
  variantIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded", "variable-change", "resolution-change"]);
const flyToExtent = inject("flyToExtent", null);

const display = ref(null);
const selectedDomain = ref("");
const selectedVariable = ref("");
const error = ref("");
const imageUrl = ref("");
const displayedFrame = ref(null);
const imageLoading = ref(false);
const retryCount = ref(0);
let loadGeneration = 0;
let assetGeneration = 0;
let activeAssetUrl = "";
let assetController = null;

const meta = computed(() => display.value?.meta_json || null);
const domains = computed(() => Array.isArray(meta.value?.domains) ? meta.value.domains : []);
const currentDomain = computed(() => domains.value.find(item => item.id === selectedDomain.value) || domains.value[0] || null);
const variables = computed(() => Array.isArray(currentDomain.value?.variables) ? currentDomain.value.variables : []);
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || variables.value[0] || null);
const frames = computed(() => Array.isArray(currentVariable.value?.frames) ? currentVariable.value.frames : []);
const currentFrame = computed(() => frames.value[Math.max(0, Math.min(frames.value.length - 1, Number(props.timeIndex) || 0))] || null);
const precise = computed(() => currentDomain.value?.geolocation?.status === "reprojected" && currentDomain.value?.geolocation?.target_crs === "EPSG:3857" && (currentDomain.value?.extent || []).length === 4 && currentDomain.value.extent.every(value => Number.isFinite(Number(value))) && Number(currentDomain.value.extent[0]) < Number(currentDomain.value.extent[2]) && Number(currentDomain.value.extent[1]) < Number(currentDomain.value.extent[3]));
const extent = computed(() => {
  const values = (currentDomain.value?.extent || []).map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values : [73, 15, 135, 55];
});
const layerKey = computed(() => `${imageUrl.value}|${extent.value.join(",")}`);

const displayUnit = computed(() => unitPresentation(currentVariable.value || {}));
const gradient = computed(() => paletteGradient(currentVariable.value?.palette));
const legendTicks = computed(() => {
  const low = Number(displayedFrame.value?.display_min);
  const high = Number(displayedFrame.value?.display_max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  return [low, (low + high) / 2, high].map(value => formatDisplayValue(value, displayUnit.value));
});

function formatResolution(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "原生";
  return meters >= 1000 ? `${Number((meters / 1000).toFixed(2))} km` : `${meters} m`;
}

function onImageError() {
  imageUrl.value = "";
  displayedFrame.value = null;
  error.value = "WRF 图像解码失败，请重新加载结果或检查渲染产品。";
  emit("variable-change", { file: props.taskId, failed: true });
}

function retry() { if (currentFrame.value?.url) retryCount.value++; else load(); }

async function load() {
  const generation = ++loadGeneration;
  assetGeneration += 1;
  assetController?.abort();
  display.value = null;
  imageUrl.value = "";
  displayedFrame.value = null;
  if (activeAssetUrl) { URL.revokeObjectURL(activeAssetUrl); activeAssetUrl = ""; }
  error.value = "";
  try {
    const value = await getWrfDisplay(props.taskId);
    if (generation !== loadGeneration) return;
    if (value?.task_id && value.task_id !== props.taskId) throw new Error("结果任务与当前选择不一致，请重新加载。");
    display.value = value;
    if (!display.value?.meta_json) {
      error.value = "暂无成功的 WRF 任务";
      return;
    }
    selectedDomain.value = domains.value.some(d => d.id === props.initialDomain) ? props.initialDomain
      : display.value.meta_json.default_domain || domains.value.at(-1)?.id || "";
    selectedVariable.value = variables.value.some(v => v.name === props.initialVariable) ? props.initialVariable
      : display.value.meta_json.default_variable || variables.value[0]?.name || "";
    emit("display-loaded", {
      ...display.value.meta_json,
      file: props.taskId,
      times: frames.value.map(frame => frame.time),
      extent: extent.value,
    });
    flyToExtent?.(extent.value);
  } catch (cause) {
    if (generation !== loadGeneration) return;
    error.value = cause.message || "WRF 结果读取失败";
    emit("variable-change", { file: props.taskId, failed: true });
  }
}

watch(() => props.taskId, load);
// URLs may be reused; a frame belongs to its task, domain and variable too.
watch(() => JSON.stringify([props.taskId, selectedDomain.value, selectedVariable.value,
  currentFrame.value, extent.value, retryCount.value]), async () => {
  const frame = currentFrame.value ? { ...currentFrame.value } : null;
  const path = frame?.url;
  const generation = ++assetGeneration;
  assetController?.abort();
  assetController = new AbortController();
  imageUrl.value = "";
  displayedFrame.value = null;
  error.value = "";
  imageLoading.value = Boolean(path);
  emit("variable-change", { file: props.taskId, pending: true,
    times: frames.value.map(item => item.time) });
  if (activeAssetUrl) { URL.revokeObjectURL(activeAssetUrl); activeAssetUrl = ""; }
  if (!path) return;
  imageLoading.value = true;
  try {
    const blob = await fetchWrfAsset(path, assetController.signal);
    if (generation !== assetGeneration) return;
    const bitmap = await createImageBitmap(blob);
    bitmap.close();
    if (generation !== assetGeneration) return;
    activeAssetUrl = URL.createObjectURL(blob);
    imageUrl.value = activeAssetUrl;
    displayedFrame.value = frame;
    error.value = "";
  } catch (cause) {
    if (generation === assetGeneration && cause?.name !== "AbortError") {
      error.value = cause?.name === "InvalidStateError" ? "WRF 图像解码失败，请检查渲染产品或重新加载结果。" : cause.message || "WRF 图像读取失败";
      emit("variable-change", { file: props.taskId, failed: true });
    }
  } finally {
    if (generation === assetGeneration) imageLoading.value = false;
  }
});
watch(selectedDomain, () => {
  if (!variables.value.some(item => item.name === selectedVariable.value)) {
    selectedVariable.value = variables.value[0]?.name || "";
  }
  flyToExtent?.(extent.value);
});
watch([selectedVariable, displayedFrame], () => {
  if (!currentVariable.value || !displayedFrame.value || displayedFrame.value.url !== currentFrame.value?.url) return;
  emit("variable-change", {
    file: props.taskId,
    domain: selectedDomain.value,
    variable: selectedVariable.value,
    element: currentVariable.value.label || currentVariable.value.name,
    unit: displayUnit.value.unit,
    time: displayedFrame.value.time,
    range: extent.value.join(", "),
    grid: currentDomain.value?.grid?.join(" × "),
    times: frames.value.map(frame => frame.time),
    extent: extent.value,
  });
});

onMounted(load);
onBeforeUnmount(() => { loadGeneration += 1; assetGeneration += 1; assetController?.abort(); if (activeAssetUrl) URL.revokeObjectURL(activeAssetUrl); });
</script>

<style scoped>
.lc-error { padding: 8px 9px; color: #f87171; line-height: 1.45; }.lc-warning { padding: 8px 9px; border-radius: 7px; color: #f59e0b; background: #f59e0b18; font-size: 10px; line-height: 1.45; }
.lc-legacy-image { display: block; max-width: 100%; margin-top: 8px; }
</style>
