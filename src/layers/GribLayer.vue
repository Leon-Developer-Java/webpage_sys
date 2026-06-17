<template>
  <WebglLayer :src="src" />
  <div class="layer-legend">
    <small>位势高度 (gpm)</small>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul><li v-for="t in ticks" :key="t">{{ t }}</li></ul>
  </div>
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";
defineProps({ src: String });
const colors = ["#1e40af", "#0ea5e9", "#22c55e", "#facc15"];
const gradient = `linear-gradient(to right, ${colors.join(",")})`;
const ticks = ["5320", "5520", "5720", "5960"];
</script>
