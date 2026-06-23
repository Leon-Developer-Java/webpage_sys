<template>
  <WebglLayer :src="imageUrl" :extent="extent" />

  <div class="layer-legend">
    <small>{{ legendTitle }}</small>
    <div class="legend-bar" :style="{ background: gradient }"></div>
    <ul>
      <li v-for="t in ticks" :key="t">{{ t }}</li>
    </ul>
  </div>
</template>

<script setup>
import WebglLayer from "../components/WebglLayer.vue";

// 成员2：GFS / ECMWF 数据层
// 后端负责生成 PNG + meta.json，本组件负责把 PNG 和 extent 传给 WebglLayer。

const BACKEND_BASE = "http://127.0.0.1:8002";

// 优先使用上传后台 wait_process 目录下的 GFS PNG。
// 若该路径无法访问，可改为：`${BACKEND_BASE}/data/GFS/053031.grib.png`
const imageUrl = `${BACKEND_BASE}/data/GFS/wait_process/053031.grib.png`;

// extent = [west, south, east, north]
const extent = [114, 27, 123, 35];

const legendTitle = "2m temperature (°C)";
const gradient = "linear-gradient(to right, #1e40af, #0ea5e9, #22c55e, #facc15, #ef4444)";
const ticks = ["14", "20", "25", "30", "34"];
</script>