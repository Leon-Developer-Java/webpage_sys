<template>
  <WebglLayer :src="src" />
  <LayerCard :badge="label" :file="file" legend-title="亮温 (°C)" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

defineProps({ src: String, label: String, file: String });

const gradient = "linear-gradient(to right, #1f2937, #9ca3af, #f3f4f6, #ef4444)";
const ticks = ["-80", "-40", "0", "40"];
</script>
