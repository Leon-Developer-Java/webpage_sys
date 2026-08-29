<template>
  <WebglLayer :src="imageSrc" :extent="imageExtent" :alpha="opacity" />
  <LayerCard
    :badge="props.label || 'FY-3'"
    :file="cardFile"
    :legend-title="legendTitle"
    :gradient="gradient"
    :ticks="ticks"
    :show-legend="Boolean(imageSrc)"
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
import { authedFetch, withToken } from "../api";

const props = defineProps({
  src: String,
  label: String,
  file: String,
  extent: { type: Array, default: null },
  refreshKey: { type: Number, default: 0 },
  sceneId: { type: String, default: "" },
  timeIndex: { type: Number, default: 0 },
  variantIndex: { type: Number, default: 0 },
  resolution: { type: String, default: "original" },
});
const emit = defineEmits(["display-loaded", "display-error", "variable-change", "resolution-change"]);

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const flyToExtent = inject("flyToExtent", null);
const display = ref(null);
const error = ref("");
const selectedProductKey = ref("");
const selectedResolution = ref("original");
const opacity = 0.72;
let timer = null;
let zoomedKey = "";
let variantApplied = false;

const frames = computed(() => Array.isArray(display.value?.frames) ? display.value.frames : []);
const currentFrame = computed(() => {
  if (!frames.value.length) return null;
  const index = Math.min(Math.max(Math.round(Number(props.timeIndex) || 0), 0), frames.value.length - 1);
  return frames.value[index] || frames.value[frames.value.length - 1];
});
const imageExtent = computed(() => props.extent || currentFrame.value?.extent || display.value?.extent || display.value?.meta_json?.extent || [-180, -90, 180, 90]);
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
  products.value.find((item) => productName(item) === "B03") ||
  products.value.find((item) => productName(item) === "B01") ||
  products.value[0]
);
const selectedProduct = computed(() => {
  if (!products.value.length) return null;
  return products.value.find((item) => productName(item) === selectedProductKey.value) || defaultProduct.value;
});
const resolutionOptions = computed(() => {
  const opts = display.value?.resolution_options || display.value?.meta_json?.resolution_options || [];
  return Array.isArray(opts) && opts.length ? opts : [];
});

const effectiveResolution = computed(() => {
  const requested = selectedResolution.value || "original";
  const available = currentFrame.value?.available_resolutions;
  if (!Array.isArray(available) || !available.length || available.includes(requested)) return requested;
  return "original";
});

function productImageUrlForFrame(frame) {
  const product = selectedProduct.value;
  if (!product) return props.src || "";

  const resKey = effectiveResolution.value;
  const assets = product.resolution_assets;
  if (assets && assets[resKey] && assets[resKey].webp_url) {
    return resolveFY3ImageUrl({
      product: { ...product, webp_url: assets[resKey].webp_url },
      currentFrame: frame,
      resolution: resKey,
      fallback: props.src,
      apiBase: API_BASE,
    });
  }
  return resolveFY3ImageUrl({
    product,
    currentFrame: frame,
    resolution: resKey,
    fallback: props.src,
    apiBase: API_BASE,
  });
}

function currentProductImageUrl() {
  return productImageUrlForFrame(currentFrame.value);
}

const imageSrc = computed(() => currentProductImageUrl());
const cardFile = computed(() => props.file || currentFrame.value?.scene_id || display.value?.meta_json?.scene_id || "");
const legendTitle = computed(() => {
  const item = selectedProduct.value;
  if (!item) return error.value || "FY-3 数据未加载";
  const timeStr = formatObservationTime(currentFrame.value?.time || display.value?.meta_json?.observation_time);
  const prodLabel = productLabel(item);
  const unit = item.display_unit || item.unit;
  const productPart = unit ? `${prodLabel} (${unit})` : prodLabel;
  return timeStr ? `${timeStr} · ${productPart}` : productPart;
});
const gradient = "linear-gradient(to right, #0f172a, #2563eb, #22c55e, #facc15, #ef4444)";
const ticks = computed(() => productTicks(selectedProduct.value));

function productName(item) {
  return item?.name || item?.key || "";
}

function resolveFY3ImageUrl({ product, currentFrame, resolution = "original", fallback = "", apiBase = "" }) {
  const key = productName(product);
  const frameUrl = currentFrame?.webp_url || currentFrame?.image_url;

  if (key && frameUrl) {
    const suffix = resolution && resolution !== "original"
      ? `/diff/${resolution}/latlon/${key}.webp$1`
      : `/latlon/${key}.webp$1`;
    const replaced = String(frameUrl).replace(/\/(?:diff\/[^/]+\/)?latlon\/[^/]+?\.webp(\?.*)?$/i, suffix);
    if (replaced !== frameUrl) return toPublicWebpUrl(replaced, apiBase);
    return toPublicWebpUrl(frameUrl, apiBase);
  }

  if (!key) return toPublicWebpUrl(frameUrl || fallback, apiBase);
  return toPublicWebpUrl(product?.webp_url || product?.image_url || frameUrl || fallback, apiBase);
}

function toPublicWebpUrl(value, apiBase) {
  const text = String(value || "").trim();
  if (!text || !/\.webp(\?.*)?$/i.test(text)) return "";
  if (/^(data:|blob:)/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return withToken(text);
  const base = String(apiBase || "").replace(/\/$/, "");
  if (text.startsWith("/")) return withToken(`${base}${text}`);
  if (/^(data|static|assets)\//i.test(text)) return withToken(`${base}/${text}`);
  return withToken(text);
}

function productLabel(item) {
  return item?.name_cn || item?.name_zh || item?.long_name || item?.plain_name || productName(item);
}

function productTicks(item) {
  if (Array.isArray(item?.legend_ticks) && item.legend_ticks.length) return item.legend_ticks.map(String);
  const unit = item?.display_unit || item?.unit || "";
  if (unit === "%") return ["低", "中", "高"];
  if (unit === "K") return ["冷", "中", "暖"];
  return ["低", "中", "高"];
}

function currentProductFrameUrl() {
  return resolveFY3ImageUrl({
    product: selectedProduct.value,
    currentFrame: currentFrame.value,
    resolution: effectiveResolution.value,
    fallback: props.src,
    apiBase: API_BASE,
  });
}

function buildVariableInfo() {
  const item = selectedProduct.value;
  const frame = currentFrame.value || {};
  const meta = display.value?.meta_json || {};
  if (!item) return null;
  const quality = frame.quality || meta.quality || {};
  const warnings = Array.isArray(quality.warnings) ? quality.warnings.filter(Boolean) : [];
  const validRatio = Number(quality.valid_pixel_ratio);

  const bandKey = productName(item); // "B01", "B02", ...
  const bandNum = parseInt(bandKey.replace("B", ""), 10);
  const bandInfo = getFY3BandInfo(bandKey, bandNum, item.name_cn || "");

  // 含义：中文 + 英文解释
  const zhDesc = getFriendlyDescription(item.name_cn || "", bandKey, item);
  const elementMeaning = bandInfo.enExplanation
    ? `${zhDesc} ${bandInfo.enExplanation}`
    : zhDesc;

  return {
    source: "FY-3",
    product: { key: bandKey, label: productLabel(item) },
    file: frame.scene_id || meta.scene_id || "FY-3",
    element: productLabel(item),
    element_en: bandKey + (bandInfo.enLabel ? ` · ${bandInfo.enLabel}` : ""),
    elementMeaning,
    variable: bandKey,
    time: frame.time || meta.observation_time || "",
    level: item.level || "卫星观测",
    range: formatExtent(frame.extent || meta.extent || imageExtent.value),
    grid: formatGrid(item.grid || meta.grid),
    missing: warnings.length ? warnings.join("；") : (item.missing ?? "—"),
    unit: item.display_unit || item.unit || "",
    status: frame.status === "no_coverage" || meta.status === "no_coverage" ? "无区域覆盖" : "解析完成",
    quality: Number.isFinite(validRatio) ? `${(validRatio * 100).toFixed(2)}% 有效像素` : "—",
    type: item.category || item.type || "卫星波段",
    wavelength: bandInfo.wavelength || "",
    description: zhDesc,
    timeResolution: meta.temporal_resolution || "轨道过境 / 不定",
    spatialResolution: meta.spatial_resolution || "",
    times: frames.value.map((frameItem) => frameItem.label || frameItem.time || frameItem.scene_id).filter(Boolean),
    webp_urls: frames.value.map(productImageUrlForFrame).filter(Boolean),
    extraRows: buildFY3ExtraRows(bandInfo),
  };
}

/**
 * FY-3 MERSI-II 波段信息：英文标签、英文解释、波长
 */
function getFY3BandInfo(bandKey, bandNum, nameCn) {
  // 按波段号精确匹配波长
  const wavelengthMap = {
    1: "0.47um", 2: "0.55um", 3: "0.65um", 4: "0.865um",
    5: "1.38um", 6: "1.64um", 7: "2.13um",
    8: "0.412um", 9: "0.443um", 10: "0.49um", 11: "0.555um",
    12: "0.67um", 13: "0.709um", 14: "0.746um", 15: "0.865um",
    16: "0.905um", 17: "0.936um", 18: "0.94um", 19: "1.24um",
    20: "3.8um", 21: "4.05um", 22: "7.2um", 23: "8.55um",
    24: "10.8um", 25: "12.0um",
  };

  // 按中文名匹配英文标签与解释
  const enMap = {
    "蓝光可见光": { enLabel: "Blue-band visible reflectance", enExplanation: "Reflectance in the blue spectrum for daytime cloud and surface feature identification." },
    "绿光可见光": { enLabel: "Green-band visible reflectance", enExplanation: "Reflectance in the green spectrum, sensitive to vegetation and surface characteristics." },
    "红光可见光": { enLabel: "Red-band visible reflectance", enExplanation: "Reflectance in the red spectrum that highlights daytime cloud texture and boundaries." },
    "近红外": { enLabel: "Near-infrared reflectance", enExplanation: "Reflectance in the near-infrared, sensitive to vegetation, water bodies and cloud phase." },
    "短波红外": { enLabel: "Shortwave infrared reflectance", enExplanation: "Shortwave infrared channel sensitive to cloud microphysics, particle size and thermal contrast." },
    "红外窗口": { enLabel: "Infrared window brightness temperature", enExplanation: "Brightness temperature in the infrared window, reflects cloud-top and surface temperature distribution." },
    "红外探测": { enLabel: "Infrared sounding brightness temperature", enExplanation: "Sounding channel brightness temperature for atmospheric temperature and moisture profiling." },
    "红外辅助": { enLabel: "Infrared auxiliary brightness temperature", enExplanation: "Auxiliary infrared brightness temperature for atmospheric correction and thermal analysis." },
  };

  const wavelength = wavelengthMap[bandNum] || "";
  let enLabel = "", enExplanation = "";

  // 优先按 nameCn 精确匹配
  if (nameCn && enMap[nameCn]) {
    enLabel = enMap[nameCn].enLabel;
    enExplanation = enMap[nameCn].enExplanation;
  } else {
    // 模糊匹配
    for (const [key, val] of Object.entries(enMap)) {
      if (nameCn && nameCn.includes(key)) {
        enLabel = val.enLabel;
        enExplanation = val.enExplanation;
        break;
      }
    }
  }

  return { enLabel, enExplanation, wavelength };
}

function buildFY3ExtraRows(bandInfo) {
  const rows = [];
  if (bandInfo.wavelength) {
    rows.push({ key: "wavelength", label: "波长", value: bandInfo.wavelength });
  }
  return rows;
}

function getFriendlyDescription(nameCn, bandName, product) {
  // 优先使用产品自带的描述
  if (product.description_zh) return product.description_zh;
  if (product.description) return product.description;

  // 根据 name_cn 生成解释友好的描述
  const descriptionMap = {
    "蓝光可见光": "蓝光可见光反射率，反映云和地表对蓝光的反射强弱，可用于白天云区识别和真彩色合成。",
    "绿光可见光": "绿光可见光反射率，是真彩色合成的重要组成部分，反映云和地表的绿色波段反射特性。",
    "红光可见光": "红光可见光反射率，能清楚显示白天云的纹理和边界，是可见光云图的关键通道。",
    "近红外": "近红外反射率，对植被、水体和云相态差异比较敏感，可用于区分云与雪、陆地与水体的边界。",
    "短波红外": "短波红外通道，对云微物理特性（如云粒子大小和相态）敏感，常用于云相态分类和火点监测。",
    "红外窗口": "红外窗口通道亮温，反映云顶和地表温度分布，可用于全天候云监测、台风分析和温度反演。",
    "红外探测": "红外探测通道亮温，对大气温度和湿度垂直分布敏感，用于大气探测和水汽分析。",
    "红外辅助": "红外辅助通道亮温，用于大气校正和其他红外通道的辅助分析。",
  };

  // 尝试精确匹配
  if (nameCn && descriptionMap[nameCn]) return descriptionMap[nameCn];

  // 模糊匹配
  for (const [key, desc] of Object.entries(descriptionMap)) {
    if (nameCn && nameCn.includes(key)) return desc;
  }

  // 兜底
  return `${nameCn || bandName || "FY-3 MERSI-II"} 波段，反映大气和地表在该光谱区间内的辐射特性，用于气象监测与分析。`;
}

function formatExtent(extent) {
  if (!Array.isArray(extent) || extent.length !== 4) return "";
  const [west, south, east, north] = extent.map(Number);
  if ([west, south, east, north].some((value) => !Number.isFinite(value))) return "";
  return `${formatLon(west)}-${formatLon(east)}, ${formatLat(south)}-${formatLat(north)}`;
}

function formatLon(value) {
  const suffix = value < 0 ? "W" : "E";
  return `${Math.abs(value).toFixed(1)}°${suffix}`;
}

function formatLat(value) {
  const suffix = value < 0 ? "S" : "N";
  return `${Math.abs(value).toFixed(1)}°${suffix}`;
}

function formatGrid(grid) {
  if (!grid) return "";
  const nx = grid.nx || grid["nx"];
  const ny = grid.ny || grid["ny"];
  return nx && ny ? `${nx} × ${ny}` : "";
}

function formatObservationTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})$/);
  if (compact) {
    const date = new Date(Date.UTC(
      Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
      Number(compact[4]), Number(compact[5]),
    ));
    return formatBeijingTime(date);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatBeijingTime(parsed);

  const hm = text.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (hm) return `${hm[1]}-${hm[2]} ${hm[3]}:${hm[4]}`;

  return text.slice(0, 16);
}

function formatBeijingTime(date) {
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const mm = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(bj.getUTCDate()).padStart(2, "0");
  const hh = String(bj.getUTCHours()).padStart(2, "0");
  const mi = String(bj.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function syncSelection() {
  if (!products.value.length) return;
  if (products.value.some((item) => productName(item) === selectedProductKey.value)) return;
  if (!variantApplied && props.variantIndex > 0 && products.value.length > 1) {
    const defIdx = products.value.findIndex((item) => productName(item) === productName(defaultProduct.value));
    const offset = (defIdx >= 0 ? defIdx : 0) + props.variantIndex;
    selectedProductKey.value = productName(products.value[offset % products.value.length]);
    variantApplied = true;
  } else {
    selectedProductKey.value = productName(defaultProduct.value);
  }
}

function emitSelectedVariableInfo() {
  const info = buildVariableInfo();
  if (info) emit("variable-change", info);
}

function flyToData() {
  if (!display.value || !imageSrc.value) return;
  const ext = imageExtent.value;
  if (!Array.isArray(ext) || ext.length !== 4) return;
  const [west, south, east, north] = ext.map(Number);
  if ([west, south, east, north].some((value) => !Number.isFinite(value)) || west >= east || south >= north) return;
  const key = ext.join(",");
  if (key === zoomedKey) return;
  zoomedKey = key;
  const dx = Math.max((east - west) * 0.04, 0.05);
  const dy = Math.max((north - south) * 0.04, 0.05);
  flyToExtent?.([Math.max(west - dx, -180), Math.max(south - dy, -90), Math.min(east + dx, 180), Math.min(north + dy, 90)]);
}

async function loadDisplay() {
  try {
    const params = new URLSearchParams({limit: "144"});
    if (props.sceneId) params.set("scene_id", props.sceneId);
    const response = await authedFetch(`${API_BASE}/api/display/FY3?${params}`);
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(payload.detail || payload.message || "FY-3 数据读取失败");
    }
    display.value = payload.data;
    emit("display-loaded", payload.data);
    syncSelection();
    emitSelectedVariableInfo();
    error.value = "";
  } catch (err) {
    error.value = err?.message || "FY-3 数据未加载";
    emit("display-error", error.value);
    console.error(err);
  }
}

onMounted(() => {
  selectedResolution.value = props.resolution || "original";
  loadDisplay();
  timer = window.setInterval(loadDisplay, 30000);
});

watch(() => [props.refreshKey, props.sceneId], loadDisplay);
watch(() => props.resolution, (value) => {
  if (value && value !== selectedResolution.value) selectedResolution.value = value;
});
watch(() => [display.value, imageExtent.value], flyToData, { immediate: true });
watch(() => [selectedProductKey.value, selectedResolution.value, props.timeIndex], emitSelectedVariableInfo);
watch(selectedResolution, (val) => emit("resolution-change", val));

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>
