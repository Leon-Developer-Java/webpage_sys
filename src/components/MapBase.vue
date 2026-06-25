<template>
  <div :class="['map-base', { grid, dark }]">
    <div ref="container" class="map-canvas"></div>
    <slot :viewer="viewerRef"></slot>
  </div>
</template>

<script>
const BORDER_GEOJSON = "https://cdn.jsdelivr.net/gh/datasets/geo-countries@master/data/countries.geojson";
let borderGeojsonPromise = null;
function loadBorderGeojson() {
  if (!borderGeojsonPromise) borderGeojsonPromise = fetch(BORDER_GEOJSON).then((response) => response.json());
  return borderGeojsonPromise;
}
</script>

<script setup>
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from "vue";
import { Cartesian3, Color, ColorGeometryInstanceAttribute, GeographicProjection, GeometryInstance, ImageryLayer, Ion, PerInstanceColorAppearance, Primitive, Rectangle, SceneMode, SimplePolylineGeometry, UrlTemplateImageryProvider, Viewer, WebMercatorProjection } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

const props = defineProps({ grid: Boolean, dark: Boolean, basemap: String, mode: String, syncRect: Object, projection: String, borders: { default: null } });
const emit = defineEmits(["camera-change", "toggle-borders"]);
const container = ref(null);
const viewerRef = shallowRef(null);
const showBorders = ref(false);
const extent = Rectangle.fromDegrees(73, 15, 135, 55);
const tiles = {
  "矢量底图": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "影像底图": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "地形晕渲": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  "全球境界": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
};
let viewer, base, borderPrim = null, borderGen = 0, syncing = false;

watch(viewerRef, v => { if (v) applyBorders(); });

watch(() => props.borders, v => {
  if (v === null) return;
  showBorders.value = v;
  if (viewer) applyBorders();
}, { immediate: true });

provide("cesiumViewer", viewerRef);
provide("flyToExtent", flyToExtent);
// 把地图工具（缩放/复位/全屏/界）暴露给图层卡片，使其能与信息卡合并到同一张卡里。
provide("mapControls", {
  zoomIn: () => viewer && zoom(0.6),
  zoomOut: () => viewer && zoom(1.6),
  home: () => viewer && home(),
  full: () => full(),
  toggleBorders: () => toggleBorders(),
  borders: showBorders,
});

// 飞到指定经纬度范围 [west, south, east, north]。
// 多屏下每个窗口的画布尺寸/相机宽高比要等渲染循环跑几帧才更新到真实值，
// 若立刻飞行会按错误宽高比把小范围数据飞偏（看起来像停在全国中心/没飞）。
// 因此先 forceResize 触发重算，再等一小段时间让宽高比稳定后直接飞到正确位置（无跳变）。
function flyToExtent(ext, duration = 1.5) {
  if (!viewer || !Array.isArray(ext) || ext.length !== 4) return;
  const values = ext.map(Number);
  if (values.some(v => !Number.isFinite(v)) || values[0] >= values[2] || values[1] >= values[3]) return;
  const dest = Rectangle.fromDegrees(values[0], values[1], values[2], values[3]);
  const snap = viewer;
  if (typeof viewer.forceResize === "function") viewer.forceResize();
  viewer.scene.requestRender();
  setTimeout(() => {
    if (!snap || snap.isDestroyed()) return;
    if (typeof snap.forceResize === "function") snap.forceResize();
    snap.camera.flyTo({ destination: dest, duration });
  }, 120);
}

function setBase() {
  if (base) viewer.imageryLayers.remove(base);
  base = new ImageryLayer(new UrlTemplateImageryProvider({ url: tiles[props.basemap] || tiles["矢量底图"] }));
  viewer.imageryLayers.add(base, 0);
  viewer.scene.requestRender();
}

function clearBorders() {
  if (borderPrim && viewer && !viewer.isDestroyed() && !borderPrim.isDestroyed()) {
    viewer.scene.primitives.remove(borderPrim);
  }
  borderPrim = null;
}

function applyBorders() {
  const gen = ++borderGen;
  clearBorders();
  if (!showBorders.value) { viewer.scene.requestRender(); return; }
  const snap = viewer;
  loadBorderGeojson().then(geojson => {
    if (gen !== borderGen || !viewer || viewer.isDestroyed() || viewer !== snap) return;
    const instances = [];
    for (const { geometry } of geojson.features) {
      if (!geometry) continue;
      const rings = geometry.type === "Polygon" ? geometry.coordinates
                  : geometry.type === "MultiPolygon" ? geometry.coordinates.flat(1)
                  : [];
      for (const ring of rings) {
        if (ring.length < 2) continue;
        instances.push(new GeometryInstance({
          geometry: new SimplePolylineGeometry({ positions: Cartesian3.fromDegreesArray(ring.flat()) }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.BLACK) },
        }));
      }
    }
    if (!instances.length) return;
    borderPrim = viewer.scene.primitives.add(new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: false }),
    }));
    viewer.scene.requestRender();
  });
}

function toggleBorders() {
  if (props.borders === null) {
    showBorders.value = !showBorders.value;
    if (viewer) applyBorders();
  }
  emit("toggle-borders");
}

function paint() {
  const sea = props.dark ? "#0b1a2b" : "#7bbbd6";
  viewer.scene.backgroundColor = Color.fromCssColorString(sea);
  viewer.scene.globe.baseColor = Color.fromCssColorString(sea);
  viewer.scene.requestRender();
}

function home() {
  viewer.camera.setView({ destination: extent });
  viewer.scene.requestRender();
}

function zoom(factor) {
  const r = viewer.camera.computeViewRectangle();
  const dw = (r.east - r.west) * (factor - 1) / 2;
  const dh = (r.north - r.south) * (factor - 1) / 2;
  viewer.camera.setView({ destination: new Rectangle(r.west - dw, r.south - dh, r.east + dw, r.north + dh) });
  viewer.scene.requestRender();
}

function full() {
  container.value.parentElement.requestFullscreen();
}

function create() {
  Ion.defaultAccessToken = "";
  viewer = new Viewer(container.value, {
    animation: false, baseLayer: false, baseLayerPicker: false, fullscreenButton: false,
    geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
    requestRenderMode: true,
    mapProjection: props.projection === '墨卡托' ? new WebMercatorProjection() : new GeographicProjection(),
    sceneMode: props.mode === '3D' ? SceneMode.SCENE3D : SceneMode.SCENE2D, sceneModePicker: false, selectionIndicator: false, timeline: false
  });
  viewerRef.value = viewer;
  viewer.cesiumWidget.creditContainer.style.display = "none";
  setBase();
  paint();
  home();
  let prevCam = null;
  viewer.scene.postRender.addEventListener(() => {
    if (syncing) { syncing = false; return; }
    const { x, y, z } = viewer.camera.position;
    const fr = viewer.scene.mode === SceneMode.SCENE2D ? (viewer.camera.frustum.right || 0) : 0;
    if (prevCam &&
        Math.abs(x - prevCam.x) < 0.1 &&
        Math.abs(y - prevCam.y) < 0.1 &&
        Math.abs(z - prevCam.z) < 0.1 &&
        Math.abs(fr - prevCam.fr) < 1) return;
    prevCam = { x, y, z, fr };
    emit("camera-change", prevCam);
  });
}

function destroyViewer() {
  if (!viewer) return;
  borderGen++;
  viewerRef.value = null;
  viewer.destroy();
  viewer = null;
  base = null;
  borderPrim = null;
}

function ready() {
  if (!container.value) return;
  if (container.value.clientWidth && container.value.clientHeight) create();
  else requestAnimationFrame(ready);
}

onMounted(ready);
watch(() => props.dark, () => viewer && paint());
watch(() => props.basemap, () => viewer && setBase());
watch(() => props.projection, () => {
  if (!viewer) return;
  destroyViewer();
  create();
});
watch(() => props.mode, v => {
  if (!viewer) return;
  if (v === '3D') viewer.scene.morphTo3D(0);
  else viewer.scene.morphTo2D(0);
  viewer.scene.requestRender();
});
watch(() => props.syncRect, cam => {
  if (!viewer || !cam) return;
  syncing = true;
  if (viewer.scene.mode === SceneMode.SCENE2D) {
    viewer.camera.position = new Cartesian3(cam.x, cam.y, cam.z);
    if (cam.fr) {
      const f = viewer.camera.frustum;
      const ar = viewer.scene.drawingBufferWidth / viewer.scene.drawingBufferHeight;
      f.right = cam.fr;  f.left = -cam.fr;
      f.top = cam.fr / ar;  f.bottom = -cam.fr / ar;
    }
  } else {
    viewer.camera.setView({ destination: new Cartesian3(cam.x, cam.y, cam.z) });
  }
  viewer.scene.requestRender();
}, { flush: 'sync' });
onBeforeUnmount(destroyViewer);
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

</style>
