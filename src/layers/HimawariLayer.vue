<template>
  <WebglLayer :src="src" />
  <div class="layer-legend">
    <small>亮温 (°C)</small>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
  </div>
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
defineProps({ src: String });
const colors = ["#1f2937", "#9ca3af", "#f3f4f6", "#ef4444"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const ticks = ["-80", "-40", "0", "40"];
</script>
