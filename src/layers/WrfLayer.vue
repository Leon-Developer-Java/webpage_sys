<template>
  <WebglLayer :src="src" />
  <LayerCard :badge="label" :file="file" legend-title="dBZ" :gradient="gradient" :ticks="ticks" />
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
import LayerCard from "../components/LayerCard.vue";

defineProps({ src: String, label: String, file: String });

const gradient = "linear-gradient(to right, #2563eb, #22c55e, #facc15, #e11d48)";
const ticks = ["0", "10", "40", "70"];
</script>
