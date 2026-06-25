<template>
  <WebglLayer :src="imageUrl" :extent="extent" />
  <LayerCard :badge="label" :file="file" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import { inject, onMounted, ref, watch } from "vue";
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

defineProps({ label: String, file: String });

const BACKEND_BASE = "http://127.0.0.1:8002";
const imageUrl = `${BACKEND_BASE}/data/GFS/wait_process/053031.grib.png`;
const extent = [114, 27, 123, 35];

const legendTitle = "2m temperature (°C)";
const gradient = "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";
const ticks = ["14", "20", "25", "30", "34"];

const viewerRef = inject("cesiumViewer", ref(null));
const flyToExtent = inject("flyToExtent", null);
let zoomed = false;

function flyToData() {
  if (!viewerRef?.value || zoomed) return;
  zoomed = true;
  const [west, south, east, north] = extent;
  const dx = Math.max((east - west) * 0.1, 0.05);
  const dy = Math.max((north - south) * 0.1, 0.05);
  flyToExtent?.([west - dx, south - dy, east + dx, north + dy]);
}

watch(() => viewerRef?.value, () => setTimeout(flyToData, 120));
onMounted(() => setTimeout(flyToData, 120));
</script>
