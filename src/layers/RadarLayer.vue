<template>
  <WebglLayer
    :src="fallbackImageSrc"
    :extent="imageExtent"
    :values="gridValues"
    :width="gridWidth"
    :height="gridHeight"
    :product="currentProduct?.code"
    :missing="gridMissing"
  />
  <LayerCard :badge="label" :file="resolvedFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <template v-if="products.length">
      <label class="lc-row">
        <span>产品</span>
        <select v-model="selectedProductKey">
          <option v-for="product in products" :key="product.key" :value="product.key">{{ product.label }}</option>
        </select>
      </label>
      <label class="lc-row">
        <span>高度层</span>
        <select v-model="selectedLevelKey">
          <option v-for="levelItem in currentLevels" :key="levelItem.key" :value="levelItem.key">{{ levelItem.label }}</option>
        </select>
      </label>
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  label: String,
  file: String,
});

const API_BASE = "http://127.0.0.1:8002";
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const selectedLevelKey = ref("");
const gridValues = shallowRef(null);
const gridLoading = ref(false);
const gridError = ref("");
let timer = null;
let gridRequestId = 0;

const products = computed(() => display.value?.grid_products ?? []);
const currentProduct = computed(() => products.value.find((item) => item.key === selectedProductKey.value) ?? products.value[0] ?? null);
const currentLevels = computed(() => currentProduct.value?.levels ?? []);
const currentLevel = computed(() => currentLevels.value.find((item) => item.key === selectedLevelKey.value) ?? currentLevels.value[0] ?? null);
const fallbackImageSrc = computed(() => props.src || display.value?.png_data_url || "");
const imageExtent = computed(() => props.extent || currentLevel.value?.extent || currentProduct.value?.extent || display.value?.extent || display.value?.meta_json?.extent || [73, 15, 135, 55]);
const gridWidth = computed(() => currentLevel.value?.grid?.nx || currentProduct.value?.grid?.nx || 0);
const gridHeight = computed(() => currentLevel.value?.grid?.ny || currentProduct.value?.grid?.ny || 0);
const gridMissing = computed(() => currentLevel.value?.missing ?? currentProduct.value?.missing ?? -9999);
const weatherInfo = computed(() => display.value?.weather_info || display.value?.meta_json?.weather_info || {});
const resolvedFile = computed(() => weatherInfo.value.file || props.file || "");
const legendTitle = computed(() => {
  if (!currentProduct.value) return weatherInfo.value.unit || "dBZ";
  const unit = currentProduct.value.unit ? ` (${currentProduct.value.unit})` : "";
  return `${currentProduct.value.label}${unit}`;
});
const statusText = computed(() => {
  if (error.value) return error.value;
  if (gridError.value) return gridError.value;
  if (display.value?.grid_error) return `雷达网格选项生成失败：${display.value.grid_error}`;
  if (gridLoading.value) return "数值矩阵加载中...";
  const items = [weatherInfo.value.time, currentLevel.value?.label].filter(Boolean);
  return items.length ? items.join(" · ") : weatherInfo.value.level || "";
});

const reflectivityColors = [
  "#04e9e7",
  "#019ff4",
  "#0300f4",
  "#02fd02",
  "#fdf802",
  "#fd9500",
  "#fd0000",
  "#bc0000",
  "#f800fd",
];
const velocityColors = [
  "#313695",
  "#4575b4",
  "#74add1",
  "#abd9e9",
  "#f5f5f5",
  "#fee090",
  "#fdae61",
  "#f46d43",
  "#d73027",
  "#a50026",
];
const gradient = computed(() => {
  const colors = currentProduct.value?.code === "VRAD" ? velocityColors : reflectivityColors;
  return `linear-gradient(to right, ${colors.join(",")})`;
});
const ticks = computed(() => currentProduct.value?.code === "VRAD"
  ? ["-30", "-20", "-10", "0", "10", "20", "30"]
  : ["0", "10", "20", "30", "40", "50", "60", "70"]);

function syncSelection() {
  if (!products.value.length) return;

  if (!products.value.some((item) => item.key === selectedProductKey.value)) {
    selectedProductKey.value = products.value[0].key;
  }

  const levels = currentProduct.value?.levels ?? [];
  if (levels.length && !levels.some((item) => item.key === selectedLevelKey.value)) {
    selectedLevelKey.value = levels[0].key;
  }
}

function apiUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

async function loadGrid() {
  const level = currentLevel.value;
  const url = apiUrl(level?.grid_url);
  const expectedSize = gridWidth.value * gridHeight.value;
  const requestId = ++gridRequestId;

  if (!url || !expectedSize) {
    gridValues.value = null;
    return;
  }

  gridLoading.value = true;
  gridError.value = "";
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || "雷达数值矩阵读取失败");
    }

    const buffer = await response.arrayBuffer();
    const values = new Float32Array(buffer);
    if (values.length !== expectedSize) {
      throw new Error(`雷达数值矩阵尺寸不匹配：${values.length} != ${expectedSize}`);
    }
    if (requestId !== gridRequestId) return;
    gridValues.value = values;
  } catch (err) {
    if (requestId !== gridRequestId) return;
    gridValues.value = null;
    gridError.value = `雷达数值矩阵未加载：${err.message}`;
    console.error(err);
  } finally {
    if (requestId === gridRequestId) gridLoading.value = false;
  }
}

async function loadRadarDisplay() {
  try {
    const response = await fetch(`${API_BASE}/api/display/RADAR`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "雷达图层数据读取失败");
    }
    display.value = payload.data;
    syncSelection();
    loadGrid();
    error.value = "";
  } catch (err) {
    error.value = "雷达数据未加载";
    console.error(err);
  }
}

onMounted(() => {
  loadRadarDisplay();
  timer = window.setInterval(loadRadarDisplay, 30000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

watch(products, syncSelection);
watch(selectedProductKey, syncSelection);
watch(
  () => [currentProduct.value?.key, currentLevel.value?.key, currentLevel.value?.grid_url],
  loadGrid,
);
</script>

