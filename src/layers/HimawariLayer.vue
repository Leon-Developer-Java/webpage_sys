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
  const assets = product.resolution_assets;
  if (assets && assets[resKey] && assets[resKey].webp_url) {
    return resolveHimawariImageUrl({
      product: { ...product, webp_url: assets[resKey].webp_url },
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

function isHimawariRgbProduct(product) {
  return product?.is_rgb === true ||
    product?.render_mode === "rgb" ||
    product?.render_mode === "image" ||
    product?.product_type === "composite";
}

function resolveHimawariImageUrl({ product, display: displayData, fallback = "", apiBase = "" } = {}) {
  const candidates = [
    product?.webp_url,
    product?.image_url,
    product?.image,
    product?.url,
    product?.src,
    displayData?.webp_url,
    displayData?.image_url,
    displayData?.image,
    displayData?.url,
    displayData?.src,
    fallback,
  ];

  for (const candidate of candidates) {
    const url = toPublicWebpUrl(candidate, apiBase);
    if (url) return url;
  }
  return "";
}

function buildHimawariVariableInfo({ product, display: displayData }) {
  const meta = displayData?.meta_json || displayData?.meta || {};
  const weather = meta.weather_info || displayData?.weather_info || {};
  const productDisplayName = productLabel(product);
  const isRgb = isHimawariRgbProduct(product);
  const unit = isRgb ? "RGB合成" : product?.display_unit || product?.unit || weather.unit || "";
  const cnDescription = firstText(
    product?.description_cn,
    product?.description_zh,
    product?.explanation_cn,
    product?.explanation_zh,
  );
  const enDescription = firstText(
    product?.description_en,
    product?.description,
    product?.long_name,
    product?.plain_name,
  );
  const { label: enLabel, explanation: enExplanation } = splitEnDescription(enDescription);
  const productId = product?.name || product?.key || "";
  const elementEn = productId ? productId + (enLabel ? ` · ${enLabel}` : "") : enLabel;
  const elementMeaning = cnDescription
    ? cnDescription + (enExplanation && enExplanation !== cnDescription ? ` ${enExplanation}` : "")
    : (enExplanation || "");

  return {
    file: meta.scene_id || displayData?.meta_file || weather.file || "—",
    element: productDisplayName || weather.element || "—",
    element_en: elementEn,
    elementMeaning,
    time: meta.observation_time || weather.time || "—",
    level: weather.level || "卫星观测",
    range: weather.range || formatExtent(meta.extent || displayData?.extent),
    grid: weather.grid || formatGrid(meta.grid || displayData?.grid),
    unit,
    missing: isRgb ? "—" : weather.missing || product?.missing || "—",
    status: weather.status || "解析完成",
    timeResolution: "10分钟",
    spatialResolution: weather.resolution || (meta.resolution ? `${meta.resolution}°` : ""),
    extraRows: buildExtraRows(product),
  };
}

function buildExtraRows(product) {
  if (!product) return [];
  return [
    { key: "wavelength", label: "波长", value: product.wavelength },
    { key: "source_bands", label: "来源", value: formatSourceBands(product.source_bands) },
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== "");
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function splitEnDescription(text) {
  if (!text) return { label: "", explanation: "" };
  const index = text.indexOf("; ");
  if (index <= 0) return { label: text, explanation: text };
  return {
    label: text.slice(0, index).trim(),
    explanation: text.slice(index + 2).trim(),
  };
}

function toPublicWebpUrl(value, apiBase) {
  const text = String(value || "").trim();
  if (!text || !/\.webp(\?.*)?$/i.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const base = String(apiBase || "").replace(/\/$/, "");
  if (text.startsWith("/")) return `${base}${text}`;
  if (/^(data|static|assets)\//i.test(text)) return `${base}/${text}`;
  return "";
}

function formatSourceBands(sourceBands) {
  if (!Array.isArray(sourceBands) || !sourceBands.length) return "";
  return sourceBands.join("、");
}

function formatExtent(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return "";
  const [west, south, east, north] = extent;
  return `${west}°E-${east}°E, ${south}°N-${north}°N`;
}

function formatGrid(grid) {
  if (!grid?.nx || !grid?.ny) return "";
  return `${grid.nx} × ${grid.ny}`;
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
  selectedResolution.value = props.resolution || "original";
  loadHimawariDisplay();
  timer = window.setInterval(loadHimawariDisplay, 30000);
});

watch(() => [props.refreshKey, props.sceneId], () => {
  loadHimawariDisplay();
});

watch(() => props.resolution, (value) => {
  if (value && value !== selectedResolution.value) selectedResolution.value = value;
});

watch(() => [display.value, imageExtent.value], flyToData, { immediate: true });

watch(() => selectedProductKey.value, emitSelectedVariableInfo);
watch(selectedResolution, (val) => emit("resolution-change", val));

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>
