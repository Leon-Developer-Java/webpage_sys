<template>
  <WebglLayer v-if="frame" :src="frame.url" :extent="parsed.extent" />
  <IcingPointLayer v-if="points.length" :points="points" />
  <LayerCard v-if="parsed" badge="预测产品" :file="parsed.file_name"
    :legend-title="`${parsed.element} (${parsed.unit})`" :gradient="gradient" :ticks="ticks"
    :show-legend="Boolean(gradient)">
    <template v-if="!frame || pointError" #default>
      {{ pointError || "当前时次无预报帧" }}
    </template>
  </LayerCard>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";
import IcingPointLayer from "../components/IcingPointLayer.vue";
import LayerCard from "../components/LayerCard.vue";
import { getIcingGrid } from "../api";

defineOptions({ inheritAttrs: false });
const props = defineProps({ parsed: Object, timeIndex: Number });
const emit = defineEmits(["display-loaded"]);
const flyToExtent = inject("flyToExtent", null);
const frame = computed(() => props.parsed?.frames?.[props.timeIndex]);
const colors = computed(() => props.parsed?.colorbar?.colors || []);
const gradient = computed(() => colors.value.length ? `linear-gradient(to right, ${colors.value.join(",")})` : "");
const ticks = computed(() => {
  const bar = props.parsed?.colorbar;
  return (bar?.ticks || []).map((tick, i) =>
    i === bar.ticks.length - 1 && bar.overflow_label ? bar.overflow_label : tick);
});
const points = ref([]);
const pointError = ref("");

watch(() => props.parsed, product => {
  if (!product) return;
  flyToExtent?.(product.extent);
  emit("display-loaded", product);
}, { immediate: true });

watch(() => frame.value?.grid_url, async (url, previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  points.value = [];
  pointError.value = "";
  if (!url) return;
  try {
    const values = await getIcingGrid(url);
    if (current) points.value = values;
  } catch (error) {
    if (current) pointError.value = error.message || "格点明细加载失败";
  }
}, { immediate: true });
</script>
