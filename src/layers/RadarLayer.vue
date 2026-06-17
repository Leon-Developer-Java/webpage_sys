<template>
  <WebglLayer :src="src" />
  <div class="layer-legend">
    <small>dBZ</small>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
  </div>
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
defineProps({ src: String });
const colors = ["#2563eb", "#22c55e", "#facc15", "#e11d48"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const ticks = ["0", "10", "30", "50", "70"];
</script>
