<template>
  <WebglLayer :src="src" />
  <LayerCard :badge="label" :file="file" legend-title="温度 (°C)" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

defineProps({ src: String, label: String, file: String });

const gradient = "linear-gradient(to right, #2563eb, #22c55e, #facc15, #e11d48)";
const ticks = ["-20", "0", "20", "40"];
</script>
