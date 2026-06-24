<template>
  <WebglLayer :src="imageUrl" :extent="extent" />
  <LayerCard :badge="label" :file="file" :legend-title="legendTitle" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

defineProps({ label: String, file: String });

const BACKEND_BASE = "http://127.0.0.1:8002";
const imageUrl = `${BACKEND_BASE}/data/GFS/wait_process/053031.grib.png`;
const extent = [114, 27, 123, 35];

const legendTitle = "2m temperature (°C)";
const gradient = "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";
const ticks = ["14", "20", "25", "30", "34"];
</script>
