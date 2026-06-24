<template>
  <WebglLayer :src="imageSrc" :extent="imageExtent" :alpha="opacity" />
  <div class="layer-legend">
    <small>{{ legendTitle }}</small>
    <div v-if="products.length" class="himawari-controls">
      <label>
        <span>变量</span>
        <select v-model="selectedProductKey">
          <option v-for="product in products" :key="product.key" :value="product.key">
            {{ product.name_zh || product.key }}
          </option>
        </select>
      </label>
      <label>
        <span>融合</span>
        <input v-model.number="opacity" min="0.2" max="1" step="0.05" type="range" />
      </label>
    </div>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
    <p v-if="statusText" class="himawari-status">{{ statusText }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";

const props = defineProps({
  src: String,
  extent: { type: Array, default: null },
  refreshKey: { type: Number, default: 0 },
});
const emit = defineEmits(["display-loaded"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const opacity = ref(0.68);
let timer = null;

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
const legendTitle = computed(() => {
  const item = selectedProduct.value;
  if (!item) return "葵花卫星";
  const unit = item.display_unit || item.unit;
  return unit ? `${item.name_zh || item.key} (${unit})` : item.name_zh || item.key;
});

const colors = ["#1f2937", "#9ca3af", "#f3f4f6", "#ef4444"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
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

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.himawari-status {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.35;
}

.himawari-controls {
  display: grid;
  gap: 5px;
  margin: 7px 0 8px;
}

.himawari-controls label {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
}

.himawari-controls select {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.82);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  padding: 4px 6px;
}

.himawari-controls input[type="range"] {
  min-width: 0;
  accent-color: var(--accent);
}
</style>
