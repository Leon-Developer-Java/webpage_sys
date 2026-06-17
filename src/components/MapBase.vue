<template>
  <div :class="['map-base', { grid, dark }]">
    <div ref="container" class="map-canvas"></div>
    <slot></slot>
    <div class="map-tools">
      <button @click="zoom(0.6)"><el-icon><Plus /></el-icon></button>
      <button @click="zoom(1.6)"><el-icon><Minus /></el-icon></button>
      <button @click="home"><el-icon><Aim /></el-icon></button>
      <button @click="full"><el-icon><FullScreen /></el-icon></button>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Color, ImageryLayer, Ion, Rectangle, SceneMode, UrlTemplateImageryProvider, Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Aim, FullScreen, Minus, Plus } from "@element-plus/icons-vue";

const props = defineProps({ grid: Boolean, dark: Boolean, basemap: String, master: Boolean, syncRect: Object });
const emit = defineEmits(["camera-change"]);
const container = ref(null);
const extent = Rectangle.fromDegrees(73, 15, 135, 55);
const tiles = {
  "矢量底图": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "影像底图": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "地形晕渲": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  "全球境界": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
};
let viewer, base;

function setBase() {
  if (base) viewer.imageryLayers.remove(base);
  base = new ImageryLayer(new UrlTemplateImageryProvider({ url: tiles[props.basemap] || tiles["矢量底图"] }));
  viewer.imageryLayers.add(base);
  viewer.scene.requestRender();
}

function paint() {
  const sea = props.dark ? "#0b1a2b" : "#7bbbd6";
  viewer.scene.backgroundColor = Color.fromCssColorString(sea);
  viewer.scene.globe.baseColor = Color.fromCssColorString(sea);
  viewer.scene.requestRender();
}

function home() {
  viewer.camera.setView({ destination: extent });
}

function zoom(factor) {
  const r = viewer.camera.computeViewRectangle();
  const dw = (r.east - r.west) * (factor - 1) / 2;
  const dh = (r.north - r.south) * (factor - 1) / 2;
  viewer.camera.setView({ destination: new Rectangle(r.west - dw, r.south - dh, r.east + dw, r.north + dh) });
}

function full() {
  container.value.parentElement.requestFullscreen();
}

function create() {
  Ion.defaultAccessToken = "";
  viewer = new Viewer(container.value, {
    animation: false, baseLayer: false, baseLayerPicker: false, fullscreenButton: false,
    geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
    requestRenderMode: true, sceneMode: SceneMode.SCENE2D, sceneModePicker: false, selectionIndicator: false, timeline: false
  });
  viewer.cesiumWidget.creditContainer.style.display = "none";
  setBase();
  paint();
  home();
  let prevRect = null;
  viewer.scene.postRender.addEventListener(() => {
    if (!props.master) return;
    const r = viewer.camera.computeViewRectangle();
    if (!r) return;
    if (prevRect && Math.abs(r.west - prevRect.west) < 1e-6 && Math.abs(r.north - prevRect.north) < 1e-6) return;
    prevRect = { west: r.west, south: r.south, east: r.east, north: r.north };
    emit("camera-change", prevRect);
  });
}

function ready() {
  if (!container.value) return;
  if (container.value.clientWidth && container.value.clientHeight) create();
  else requestAnimationFrame(ready);
}

onMounted(ready);
watch(() => props.dark, () => viewer && paint());
watch(() => props.basemap, () => viewer && setBase());
watch(() => props.syncRect, rect => {
  if (!viewer || !rect) return;
  viewer.camera.setView({ destination: new Rectangle(rect.west, rect.south, rect.east, rect.north) });
  viewer.scene.requestRender();
});
onBeforeUnmount(() => viewer && viewer.destroy());
</script>

<style scoped>
.map-base {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.map-canvas {
  position: absolute;
  inset: 0;
}

.map-base :deep(.cesium-viewer),
.map-base :deep(.cesium-widget),
.map-base :deep(.cesium-widget canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.map-base :deep(.cesium-viewer-bottom),
.map-base :deep(.cesium-viewer-toolbar) {
  display: none;
}

.map-base.grid::after {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.22) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.22) 1px, transparent 1px);
  background-size: 12.5% 12.5%;
  content: "";
}

.map-tools {
  position: absolute;
  right: 14px;
  top: 14px;
  z-index: 4;
  display: grid;
  gap: 6px;
}

.map-tools button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--glass);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  color: var(--text);
  cursor: pointer;
  transition: 0.15s;
}

.map-tools button:hover { color: var(--accent); }
</style>
