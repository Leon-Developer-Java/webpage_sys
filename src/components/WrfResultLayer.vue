<template>
  <WebglLayer :key="layerKey" :src="imageUrl" :extent="extent" />
  <LayerCard
    badge="WRF"
    :file="display?.task_id || '暂无成功任务'"
    :legend-title="currentVariable?.units || ''"
    :gradient="gradient"
    :ticks="legendTicks"
    :show-legend="Boolean(currentVariable)"
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
    <div class="lc-row"><span>时次</span><b>{{ currentFrame?.time || '—' }}</b></div>
    <div v-if="meta?.quality?.status === 'partial'" class="lc-warning">
      部分结果：排除 {{ meta.quality.unreadable_frames?.length || meta.quality.excluded_frames?.length || 0 }} 个不可读帧，缺失时次已记录在元数据中。
    </div>
    <div v-if="error" class="lc-error">{{ error }}</div>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { getWrfDisplay, wrfAssetUrl } from "../api";
import LayerCard from "./LayerCard.vue";
import WebglLayer from "./WebglLayer.vue";

const props = defineProps({
  timeIndex: { type: Number, default: 0 },
  taskId: { type: String, default: "" },
  parsed: { type: Object, default: null },
  variantIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded", "variable-change", "resolution-change"]);
const flyToExtent = inject("flyToExtent", null);

const display = ref(null);
const selectedDomain = ref("");
const selectedVariable = ref("");
const error = ref("");
let loadGeneration = 0;

const meta = computed(() => display.value?.meta_json || null);
const domains = computed(() => Array.isArray(meta.value?.domains) ? meta.value.domains : []);
const currentDomain = computed(() => domains.value.find(item => item.id === selectedDomain.value) || domains.value[0] || null);
const variables = computed(() => Array.isArray(currentDomain.value?.variables) ? currentDomain.value.variables : []);
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value) || variables.value[0] || null);
const frames = computed(() => Array.isArray(currentVariable.value?.frames) ? currentVariable.value.frames : []);
const currentFrame = computed(() => frames.value[Math.max(0, Math.min(frames.value.length - 1, Number(props.timeIndex) || 0))] || null);
const imageUrl = computed(() => wrfAssetUrl(currentFrame.value?.url));
const extent = computed(() => {
  const values = (currentDomain.value?.extent || []).map(Number);
  return values.length === 4 && values.every(Number.isFinite) ? values : [73, 15, 135, 55];
});
const layerKey = computed(() => `${imageUrl.value}|${extent.value.join(",")}`);

const paletteMap = {
  T2: "linear-gradient(to right,#1e40af,#4794ff,#eee,#ffaa46,#b40426)",
  U10: "linear-gradient(to right,#1e40af,#7db4ff,#f5f5f5,#ff9664,#b40426)",
  V10: "linear-gradient(to right,#1e40af,#7db4ff,#f5f5f5,#ff9664,#b40426)",
  RAINC: "linear-gradient(to right,#f8fafc,#bfdbfe,#38bdf8,#2563eb,#1e3a8a)",
  RAINNC: "linear-gradient(to right,#f8fafc,#bfdbfe,#38bdf8,#2563eb,#1e3a8a)",
};
const gradient = computed(() => paletteMap[currentVariable.value?.name] || "linear-gradient(to right,#312e81,#2563eb,#22c55e,#facc15,#dc2626)");
const legendTicks = computed(() => {
  const low = Number(currentFrame.value?.display_min);
  const high = Number(currentFrame.value?.display_max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  return [low, (low + high) / 2, high].map(value => Number(value.toPrecision(4)).toString());
});

function formatResolution(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "原生";
  return meters >= 1000 ? `${Number((meters / 1000).toFixed(2))} km` : `${meters} m`;
}

async function load() {
  const generation = ++loadGeneration;
  error.value = "";
  try {
    const value = await getWrfDisplay(props.taskId);
    if (generation !== loadGeneration) return;
    display.value = value;
    if (!display.value?.meta_json) {
      error.value = "暂无成功的 WRF 任务";
      return;
    }
    selectedDomain.value = display.value.meta_json.default_domain || domains.value.at(-1)?.id || "";
    selectedVariable.value = display.value.meta_json.default_variable || variables.value[0]?.name || "";
    emit("display-loaded", {
      ...display.value.meta_json,
      file: display.value.task_id,
      times: frames.value.map(frame => frame.time),
      extent: extent.value,
    });
    flyToExtent?.(extent.value);
  } catch (cause) {
    if (generation !== loadGeneration) return;
    error.value = cause.message || "WRF 结果读取失败";
  }
}

watch(() => props.taskId, load);
watch(selectedDomain, () => {
  if (!variables.value.some(item => item.name === selectedVariable.value)) {
    selectedVariable.value = variables.value[0]?.name || "";
  }
  flyToExtent?.(extent.value);
});
watch([selectedVariable, currentFrame], () => {
  if (!currentVariable.value) return;
  emit("variable-change", {
    file: display.value?.task_id,
    element: currentVariable.value.label || currentVariable.value.name,
    unit: currentVariable.value.units,
    time: currentFrame.value?.time,
    range: extent.value.join(", "),
    grid: currentDomain.value?.grid?.join(" × "),
    times: frames.value.map(frame => frame.time),
    extent: extent.value,
  });
});

onMounted(load);
</script>

<style scoped>
.lc-error { padding: 8px 9px; color: #f87171; line-height: 1.45; }.lc-warning { padding: 8px 9px; border-radius: 7px; color: #f59e0b; background: #f59e0b18; font-size: 10px; line-height: 1.45; }
</style>
