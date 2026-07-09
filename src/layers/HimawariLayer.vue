<template>
  <WebglLayer :src="imageSrc" :extent="imageExtent" :alpha="opacity" />
  <LayerCard
    :badge="props.label || 'Himawari'"
    :file="cardFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
    :show-legend="showLegend"
  >
    <template v-if="products.length">
      <label class="lc-row">
        <span>变量</span>
        <select v-model="selectedProductKey">
          <option v-for="product in products" :key="productName(product)" :value="productName(product)">{{ productLabel(product) }}</option>
        </select>
      </label>
      <label v-if="resolutionOptions.length" class="lc-row">
        <span>分辨率</span>
        <select v-model="selectedResolution">
          <option v-for="opt in resolutionOptions" :key="opt.key" :value="opt.key">{{ opt.label }}</option>
        </select>
      </label>
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LayerCard from "../components/LayerCard.vue";
import WebglLayer from "../components/WebglLayer.vue";
import { authedFetch } from "../api";
import { buildHimawariVariableInfo, isHimawariRgbProduct, resolveHimawariImageUrl } from "./himawariVariableInfo";

const props = defineProps({
  src: String,
  label: String,
  file: String,
  extent: { type: Array, default: null },
  refreshKey: { type: Number, default: 0 },
  sceneId: { type: String, default: "" },
  variantIndex: { type: Number, default: 0 },
  resolution: { type: String, default: "original" },
});
const emit = defineEmits(["display-loaded", "variable-change", "resolution-change"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const flyToExtent = inject("flyToExtent", null);
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const selectedResolution = ref("original");
const opacity = 0.68;
let timer = null;
let zoomedKey = "";

const imageExtent = computed(() => props.extent || display.value?.extent || display.value?.meta_json?.extent || display.value?.meta_json?.bbox || [73, 18, 136, 54]);
const variables = computed(() => display.value?.variables || display.value?.meta_json?.variables || []);
const composites = computed(() => display.value?.composites || display.value?.meta_json?.composites || []);
const products = computed(() => {
  const apiProducts = display.value?.products || display.value?.meta_json?.products;
  if (Array.isArray(apiProducts) && apiProducts.length) return apiProducts;
  return [
    ...composites.value.map((item) => ({ ...item, product_type: "composite" })),
    ...variables.value.map((item) => ({ ...item, product_type: "variable" })),
  ];
});
const defaultProduct = computed(() =>
  products.value.find((item) => productName(item) === "B13") ||
  products.value.find((item) => productName(item) === "true_color") ||
  products.value[0]
);
const selectedProduct = computed(() => {
  if (!products.value.length) return null;
  return products.value.find((item) => productName(item) === selectedProductKey.value) || defaultProduct.value;
});
const isRgbProduct = computed(() => isHimawariRgbProduct(selectedProduct.value));
const resolutionOptions = computed(() => {
  const opts = display.value?.resolution_options || display.value?.meta_json?.resolution_options || [];
  return Array.isArray(opts) && opts.length ? opts : [];
});
const imageSrc = computed(() => {
  const product = selectedProduct.value;
  if (!product) return props.src || "";

  const resKey = selectedResolution.value;
  // 优先使用 resolution_assets 中对应分辨率的 png_url
  const assets = product.resolution_assets;
  if (assets && assets[resKey] && assets[resKey].png_url) {
    return resolveHimawariImageUrl({
      product: { ...product, png_url: assets[resKey].png_url },
      display: display.value,
      fallback: props.src,
      apiBase: API_BASE,
    });
  }
  return resolveHimawariImageUrl({
    product,
    display: display.value,
    fallback: props.src,
    apiBase: API_BASE,
  });
});
const cardFile = computed(() => props.file || display.value?.meta_json?.scene_id || "");
const legendTitle = computed(() => {
  if (isRgbProduct.value) return "";
  const item = selectedProduct.value;
  if (!item) return "Himawari";
  const unit = item.display_unit || item.unit;
  return unit ? `${productLabel(item)} (${unit})` : productLabel(item);
});

const showLegend = computed(() => !isRgbProduct.value);
const gradient = computed(() => showLegend.value ? "linear-gradient(to right, #1f2937, #9ca3af, #f3f4f6, #ef4444)" : "");
const ticks = computed(() => showLegend.value ? productTicks(selectedProduct.value) : []);
const statusText = computed(() => {
  if (error.value) return error.value;
  if (!imageSrc.value) return "Himawari 数据未加载";
  const meta = display.value?.meta_json || {};
  const parts = [formatBeijingTime(meta.observation_time), productLongName(selectedProduct.value)].filter(Boolean);
  return parts.join(" · ");
});

function productName(item) {
  return item?.name || item?.key || "";
}

function productLabel(item) {
  return item?.name_cn || item?.name_zh || item?.long_name || item?.plain_name || productName(item);
}

function productLongName(item) {
  return item?.long_name || item?.plain_name || item?.description || "";
}

function productTicks(item) {
  if (Array.isArray(item?.legend_ticks) && item.legend_ticks.length) {
    return item.legend_ticks.map(String);
  }
  const unit = item?.display_unit || item?.unit || "";
  if (unit === "%") return ["0", "40", "80", "120"];
  if (unit === "K") return ["200", "240", "280", "320"];
  return ["-80", "-40", "0", "40"];
}

function formatBeijingTime(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace("Z", "+00:00"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  const beijing = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijing.getUTCDate()).padStart(2, "0");
  const hour = String(beijing.getUTCHours()).padStart(2, "0");
  const minute = String(beijing.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

let variantApplied = false;
function syncSelection() {
  if (!products.value.length) return;
  if (products.value.some((item) => productName(item) === selectedProductKey.value)) return;
  if (!variantApplied && props.variantIndex > 0 && products.value.length > 1) {
    const defIdx = products.value.findIndex(p => productName(p) === productName(defaultProduct.value));
    const offset = (defIdx >= 0 ? defIdx : 0) + props.variantIndex;
    selectedProductKey.value = productName(products.value[offset % products.value.length]);
    variantApplied = true;
  } else {
    selectedProductKey.value = productName(defaultProduct.value);
  }
}

function emitSelectedVariableInfo() {
  if (!display.value || !selectedProduct.value) return;
  emit("variable-change", buildHimawariVariableInfo({
    product: selectedProduct.value,
    display: display.value,
  }));
}

function flyToData() {
  if (!display.value) return;
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
    const query = props.sceneId ? `?scene_id=${encodeURIComponent(props.sceneId)}` : "";
    const response = await authedFetch(`${API_BASE}/api/display/HIMAWARI${query}`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "Himawari 数据读取失败");
    }
    display.value = payload.data;
    emit("display-loaded", payload.data);
    syncSelection();
    emitSelectedVariableInfo();
    error.value = "";
  } catch (err) {
    error.value = "Himawari 数据未加载";
    console.error(err);
  }
}

onMounted(() => {
  loadHimawariDisplay();
  timer = window.setInterval(loadHimawariDisplay, 30000);
});

watch(() => [props.refreshKey, props.sceneId], () => {
  loadHimawariDisplay();
});

watch(() => [display.value, imageExtent.value], flyToData, { immediate: true });

watch(() => selectedProductKey.value, emitSelectedVariableInfo);
watch(selectedResolution, (val) => emit("resolution-change", val));

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>
