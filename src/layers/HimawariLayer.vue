<template>
  <WebglLayer :src="imageSrc" :extent="imageExtent" :alpha="opacity" />
  <LayerCard :badge="props.label || '葵花卫星'" :file="cardFile" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks">
    <template v-if="products.length">
      <label class="lc-row">
        <span>变量</span>
        <select v-model="selectedProductKey">
          <option v-for="product in products" :key="product.key" :value="product.key">{{ product.name_zh || product.key }}</option>
        </select>
      </label>
      <label class="lc-row">
        <span>融合</span>
        <input v-model.number="opacity" min="0.2" max="1" step="0.05" type="range" style="width: 100%; min-width: 0; accent-color: var(--accent);" />
      </label>
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import WebglLayer from "../components/WebglLayer.vue";

const props = defineProps({
  src: String,
  label: String,
  file: String,
  extent: { type: Array, default: null },
  refreshKey: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const viewerRef = inject("cesiumViewer", ref(null));
const flyToExtent = inject("flyToExtent", null);
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const opacity = ref(0.68);
let timer = null;
let zoomedKey = "";

const imageExtent = computed(() => props.extent || display.value?.extent || display.value?.meta_json?.extent || [73, 18, 136, 54]);
const variables = computed(() => display.value?.variables || display.value?.meta_json?.variables || []);
const composites = computed(() => display.value?.composites || display.value?.meta_json?.composites || []);
const products = computed(() => [
  ...composites.value.map((item) => ({ ...item, product_type: "composite" })),
  ...variables.value.map((item) => ({ ...item, product_type: "variable" })),
]);
const selectedProduct = computed(() => {
  if (!products.value.length) return null;
  return products.value.find((item) => item.key === selectedProductKey.value) || products.value[0];
});
const imageSrc = computed(() => props.src || selectedProduct.value?.png_data_url || display.value?.png_data_url || "");
const cardFile = computed(() => props.file || display.value?.meta_json?.scene_id || "");
const legendTitle = computed(() => {
  const item = selectedProduct.value;
  if (!item) return "葵花卫星";
  const unit = item.display_unit || item.unit;
  return unit ? `${item.name_zh || item.key} (${unit})` : item.name_zh || item.key;
});

const gradient = "linear-gradient(to right, #1f2937, #9ca3af, #f3f4f6, #ef4444)";
const ticks = ["-80", "-40", "0", "40"];
const statusText = computed(() => {
  if (error.value) return error.value;
  if (!imageSrc.value) return "葵花数据未加载";
  const meta = display.value?.meta_json || {};
  const parts = [meta.observation_time, selectedProduct.value?.plain_name].filter(Boolean);
  return parts.join(" · ");
});

function syncSelection() {
  if (!products.value.length) return;
  if (products.value.some((item) => item.key === selectedProductKey.value)) return;
  selectedProductKey.value =
    products.value.find((item) => item.key === "true_color")?.key ||
    products.value.find((item) => item.key === "B13")?.key ||
    products.value[0].key;
}

function flyToData() {
  if (!viewerRef?.value || !display.value) return;
  const ext = imageExtent.value;
  if (!Array.isArray(ext) || ext.length !== 4) return;
  const [west, south, east, north] = ext.map(Number);
  if ([west, south, east, north].some(v => !Number.isFinite(v)) || west >= east || south >= north) return;
  const key = ext.join(",");
  if (key === zoomedKey) return;
  zoomedKey = key;
  const dx = Math.max((east - west) * 0.04, 0.05);
  const dy = Math.max((north - south) * 0.04, 0.05);
  flyToExtent?.([west - dx, south - dy, east + dx, north + dy]);
}

async function loadHimawariDisplay() {
  try {
    const response = await fetch(`${API_BASE}/api/display/HIMAWARI`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "葵花数据读取失败");
    }
    display.value = payload.data;
    emit("display-loaded", payload.data);
    syncSelection();
    error.value = "";
  } catch (err) {
    error.value = "葵花数据未加载";
    console.error(err);
  }
}

onMounted(() => {
  loadHimawariDisplay();
  timer = window.setInterval(loadHimawariDisplay, 30000);
});

watch(() => props.refreshKey, () => {
  loadHimawariDisplay();
});

watch(() => [viewerRef?.value, display.value, imageExtent.value], flyToData, { immediate: true });

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>
