<template>
  <div class="aoi-editor">
    <svg ref="overlay" :class="['map-overlay', { drawing }]" @pointerdown.stop="onPointerDown" @pointermove.stop="onPointerMove" @pointerup.stop="onPointerUp" @pointercancel.stop="cancelInteraction">
      <polygon v-if="terrainShape" :points="terrainShape" class="shape terrain" />
      <polygon v-if="forcingShape" :points="forcingShape" class="shape forcing" />
      <polygon v-if="supportShape" :points="supportShape" class="shape support" />
      <polygon :points="aoiShape" class="shape aoi" data-role="aoi" />
      <text v-if="aoiLabel" :x="aoiLabel.x" :y="aoiLabel.y" class="map-label aoi-label">发布 AOI · {{ aoi.width_m }} × {{ aoi.height_m }} m</text>
      <text v-if="supportLabel" :x="supportLabel.x" :y="supportLabel.y" class="map-label support-label">CFD 支撑域 · 缓冲 {{ displayBuffer }} m</text>
      <text v-if="terrainLabel" :x="terrainLabel.x" :y="terrainLabel.y" class="map-label terrain-label">{{ selectedTerrain.label }} · 地形覆盖</text>
    </svg>
    <div class="map-tools"><el-button size="small" :type="drawing ? 'primary' : 'default'" @click="toggleDrawing">{{ drawing ? '取消绘制' : '绘制 AOI 矩形' }}</el-button><el-button size="small" @click="fitExtent">定位范围</el-button><span>{{ drawing ? '在地图上按住并拖动，重新定义发布 AOI。' : '拖动蓝色 AOI 可平移范围；精确尺寸在右侧同步。' }}</span></div>
    <div class="legend"><span><i class="aoi-key" />发布 AOI</span><span><i class="support-key" />CFD 支撑域</span><span><i class="forcing-key" />约 10 m d08 forcing halo</span><span v-if="selectedTerrain"><i class="terrain-key" />审核地形覆盖</span></div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";

const props = defineProps({
  aoi: { type: Object, required: true },
  bufferM: { type: Number, default: 300 },
  selectedTerrain: { type: Object, default: null },
});
const emit = defineEmits(["update:aoi", "invalid"]);
const projector = inject("mapProjector", null);
const flyToExtent = inject("flyToExtent", null);
const overlay = ref(null);
const drawing = ref(false);
const interaction = ref(null);
const draftBounds = ref(null);
const METERS_PER_LATITUDE = 111_320;
const forcingHaloM = 2 * (27000 / (3 ** 7));

function metersPerLongitude(lat) { return METERS_PER_LATITUDE * Math.max(0.1, Math.cos(Number(lat || 0) * Math.PI / 180)); }
function normalize(bounds) { return { west: Math.min(bounds.west, bounds.east), east: Math.max(bounds.west, bounds.east), south: Math.min(bounds.south, bounds.north), north: Math.max(bounds.south, bounds.north) }; }
function boundsFor(centerLat, centerLon, widthM, heightM) { const halfWidth = Math.max(1, Number(widthM) || 1) / metersPerLongitude(centerLat) / 2; const halfHeight = Math.max(1, Number(heightM) || 1) / METERS_PER_LATITUDE / 2; return { west: centerLon - halfWidth, east: centerLon + halfWidth, south: centerLat - halfHeight, north: centerLat + halfHeight }; }
function expand(bounds, meters) { const lat = (bounds.south + bounds.north) / 2; return { west: bounds.west - meters / metersPerLongitude(lat), east: bounds.east + meters / metersPerLongitude(lat), south: bounds.south - meters / METERS_PER_LATITUDE, north: bounds.north + meters / METERS_PER_LATITUDE }; }
function points(bounds) { void projector?.state?.value?.rev; return [[bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south], [bounds.west, bounds.south]].map(([lon, lat]) => projector?.project?.(lon, lat)).filter(Boolean).map(point => `${point.x},${point.y}`).join(" "); }
function topLeft(bounds, dx = 8, dy = 17) { const value = projector?.project?.(bounds.west, bounds.north); return value ? { x: value.x + dx, y: value.y + dy } : null; }

const aoiBounds = computed(() => draftBounds.value || boundsFor(Number(props.aoi.center_lat), Number(props.aoi.center_lon), props.aoi.width_m, props.aoi.height_m));
const supportBounds = computed(() => expand(aoiBounds.value, Math.max(300, Number(props.bufferM) || 300)));
const forcingBounds = computed(() => expand(supportBounds.value, forcingHaloM));
const terrainBounds = computed(() => { const terrain = props.selectedTerrain; if (!terrain || terrain.coverage_center_lat == null || terrain.coverage_center_lon == null) return null; return boundsFor(Number(terrain.coverage_center_lat), Number(terrain.coverage_center_lon), terrain.coverage_width_m, terrain.coverage_height_m); });
const aoiShape = computed(() => points(aoiBounds.value));
const supportShape = computed(() => points(supportBounds.value));
const forcingShape = computed(() => points(forcingBounds.value));
const terrainShape = computed(() => terrainBounds.value ? points(terrainBounds.value) : "");
const aoiLabel = computed(() => topLeft(aoiBounds.value));
const supportLabel = computed(() => topLeft(supportBounds.value));
const terrainLabel = computed(() => terrainBounds.value ? topLeft(terrainBounds.value, 8, 32) : null);
const displayBuffer = computed(() => Math.max(300, Number(props.bufferM) || 300));

function emitBounds(bounds) { const value = normalize(bounds); const centerLat = (value.south + value.north) / 2; const centerLon = (value.west + value.east) / 2; const widthM = Math.round((value.east - value.west) * metersPerLongitude(centerLat)); const heightM = Math.round((value.north - value.south) * METERS_PER_LATITUDE); if (widthM < 25 || heightM < 25) { emit("invalid", "AOI 至少应为 25 m × 25 m"); return false; } emit("update:aoi", { ...props.aoi, center_lat: Number(centerLat.toFixed(6)), center_lon: Number(centerLon.toFixed(6)), center_x_m: null, center_y_m: null, width_m: widthM, height_m: heightM }); return true; }
function toggleDrawing() { drawing.value = !drawing.value; draftBounds.value = null; interaction.value = null; }
function screenPoint(event) { return projector?.unproject?.(event.clientX, event.clientY) || null; }
function onPointerDown(event) { const value = screenPoint(event); if (!value || (!drawing.value && event.target?.dataset?.role !== "aoi")) return; overlay.value?.setPointerCapture?.(event.pointerId); interaction.value = { pointerId: event.pointerId, start: value, original: { ...aoiBounds.value }, mode: drawing.value ? "draw" : "move" }; draftBounds.value = drawing.value ? { west: value.lon, east: value.lon, south: value.lat, north: value.lat } : { ...aoiBounds.value }; }
function onPointerMove(event) { const state = interaction.value; const value = screenPoint(event); if (!state || state.pointerId !== event.pointerId || !value) return; if (state.mode === "draw") { draftBounds.value = normalize({ west: state.start.lon, east: value.lon, south: state.start.lat, north: value.lat }); return; } const lonDelta = value.lon - state.start.lon; const latDelta = value.lat - state.start.lat; draftBounds.value = { west: state.original.west + lonDelta, east: state.original.east + lonDelta, south: state.original.south + latDelta, north: state.original.north + latDelta }; }
function onPointerUp(event) { const state = interaction.value; if (!state || state.pointerId !== event.pointerId) return; overlay.value?.releasePointerCapture?.(event.pointerId); if (draftBounds.value) emitBounds(draftBounds.value); interaction.value = null; draftBounds.value = null; if (drawing.value) drawing.value = false; }
function cancelInteraction() { interaction.value = null; draftBounds.value = null; }
function fitExtent() { const bounds = forcingBounds.value; flyToExtent?.([bounds.west, bounds.south, bounds.east, bounds.north]); }
watch(() => [props.aoi.center_lat, props.aoi.center_lon, props.aoi.width_m, props.aoi.height_m], () => { if (!interaction.value) nextTick(fitExtent); });
onMounted(() => setTimeout(fitExtent, 120));
</script>

<style scoped>
.aoi-editor{position:absolute;inset:0;z-index:5;pointer-events:none}.map-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none}.map-overlay.drawing{pointer-events:auto;cursor:crosshair}.shape{vector-effect:non-scaling-stroke;fill:transparent;pointer-events:none}.shape.aoi{stroke:#4da8ff;stroke-width:3;fill:#4da8ff22;pointer-events:auto;cursor:move}.shape.support{stroke:#f4b84f;stroke-width:2;stroke-dasharray:7 5}.shape.forcing{stroke:#b68cff;stroke-width:1.5;stroke-dasharray:4 4}.shape.terrain{stroke:#56d292;stroke-width:1.5;fill:#56d29214}.map-label{font:700 11px "SFMono-Regular",Consolas,monospace;paint-order:stroke;stroke:#08121e;stroke-width:4px;pointer-events:none}.aoi-label{fill:#8fc9ff}.support-label{fill:#f7cb77}.terrain-label{fill:#89e3b0}.map-tools{position:absolute;z-index:7;top:12px;left:12px;right:12px;display:flex;align-items:center;gap:7px;pointer-events:auto}.map-tools span{max-width:410px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:#0d1b2bdd;color:#d5e5f2;font-size:11px;backdrop-filter:blur(8px)}.legend{position:absolute;z-index:7;bottom:10px;left:12px;display:flex;flex-wrap:wrap;gap:9px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:#0d1b2bdd;color:#c5d7e7;font-size:10px;backdrop-filter:blur(8px)}.legend span{display:flex;align-items:center;gap:4px}.legend i{width:13px;height:3px;display:inline-block}.aoi-key{background:#4da8ff}.support-key{background:#f4b84f}.forcing-key{background:repeating-linear-gradient(90deg,#b68cff 0 3px,transparent 3px 5px)}.terrain-key{background:#56d292}@media(max-width:720px){.map-tools{align-items:flex-start;flex-wrap:wrap}.map-tools span{width:100%}}
</style>
