<template>
  <div ref="box" class="map-base">
    <ProjMap
      ref="pm"
      :projection="projection"
      :tile-url="tileUrl"
      :vector="vector"
      :grid="grid"
      :dark="dark"
      :data="dataRef"
      :sync-view="syncView"
      @view-change="v => emit('view-change', v)"
    />
    <slot></slot>
  </div>
</template>

<script setup>
import { computed, provide, ref } from "vue";
import ProjMap from "./ProjMap.vue";

const props = defineProps({
  projection: { type: String, default: "等经纬" },
  basemap: { type: String, default: "矢量底图" },
  grid: { type: Boolean, default: true },
  dark: Boolean,
  vector: Boolean,
  syncView: Object,
});
const emit = defineEmits(["view-change"]);

const TILE_URLS = {
  "矢量底图": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "影像底图": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "地形晕渲": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  "全球境界": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
};

const box = ref(null);
const pm = ref(null);
const dataRef = ref(null);
const tileUrl = computed(() => TILE_URLS[props.basemap] || TILE_URLS["矢量底图"]);

provide("mapSurface", {
  setData: (src, extent, alpha = 1) => { dataRef.value = src && extent ? { src, extent, alpha } : null; },
  clear: () => { dataRef.value = null; },
});
provide("flyToExtent", ext => pm.value?.flyTo(ext));
provide("mapControls", {
  zoomIn: () => pm.value?.zoomBy(0.8),
  zoomOut: () => pm.value?.zoomBy(1.25),
  home: () => pm.value?.home(),
  full: () => box.value?.requestFullscreen?.(),
});
</script>

<style scoped>
.map-base {
  position: relative;
  min-height: 0;
  overflow: hidden;
}
</style>
