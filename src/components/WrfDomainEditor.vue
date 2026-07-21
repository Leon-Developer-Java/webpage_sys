<template>
  <div class="domain-editor">
    <svg
      ref="overlay"
      :class="['domain-overlay', { drawing }]"
      @pointerdown.stop="onPointerDown"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @pointercancel.stop="cancelInteraction"
    >
      <template v-for="shape in domainShapes" :key="shape.id">
        <polygon
          :data-domain-index="shape.index"
          :points="shape.points"
          :class="['domain-shape', { active: shape.index === activeIndex }]"
          :style="{ stroke: shape.color }"
        />
        <text :x="shape.label.x" :y="shape.label.y" :fill="shape.color">{{ shape.id.toUpperCase() }}</text>
      </template>
    </svg>

    <div class="domain-tools">
      <div class="domain-tabs">
        <button
          v-for="(domain, index) in domains"
          :key="domain.id"
          :class="{ active: index === activeIndex }"
          :style="{ '--domain-color': COLORS[index] }"
          @click="selectDomain(index)"
        >
          {{ domain.id.toUpperCase() }}
        </button>
      </div>
      <button class="draw-button" :class="{ active: drawing }" @click="toggleDrawing">
        {{ drawing ? '取消重画' : '重画当前域' }}
      </button>
      <span>{{ drawing ? '在地图上按住并拖拽绘制矩形' : '拖动当前域可调整位置' }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from "vue";

const props = defineProps({
  domains: { type: Array, default: () => [] },
  center: { type: Object, default: () => ({ lat: 32.048, lon: 118.825 }) },
  activeIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["update:domains", "update:center", "update:activeIndex", "invalid", "drawing"]);
const projector = inject("mapProjector", null);
const flyToExtent = inject("flyToExtent", null);
const overlay = ref(null);
const drawing = ref(false);
const interaction = ref(null);
const draftBounds = ref(null);

const METERS_PER_DEGREE = 111320;
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899"];

function metersPerLongitude(lat) {
  return METERS_PER_DEGREE * Math.max(0.1, Math.cos(Number(lat || 0) * Math.PI / 180));
}

function normalized(bounds) {
  return {
    west: Math.min(bounds.west, bounds.east),
    east: Math.max(bounds.west, bounds.east),
    south: Math.min(bounds.south, bounds.north),
    north: Math.max(bounds.south, bounds.north),
  };
}

function calculatedBounds() {
  const result = [];
  props.domains.forEach((domain, index) => {
    if (index === 0) {
      const lat = Number(props.center.lat);
      const lon = Number(props.center.lon);
      const halfWidth = (Math.max(1, Number(domain.e_we) - 1) * Number(domain.dx)) / metersPerLongitude(lat) / 2;
      const halfHeight = (Math.max(1, Number(domain.e_sn) - 1) * Number(domain.dy || domain.dx)) / METERS_PER_DEGREE / 2;
      result.push({ west: lon - halfWidth, east: lon + halfWidth, south: lat - halfHeight, north: lat + halfHeight });
      return;
    }
    const parent = props.domains[index - 1];
    const parentBounds = result[index - 1];
    const referenceLat = (parentBounds.south + parentBounds.north) / 2;
    const west = parentBounds.west + (Math.max(1, Number(domain.i_parent_start)) - 1) * Number(parent.dx) / metersPerLongitude(referenceLat);
    const south = parentBounds.south + (Math.max(1, Number(domain.j_parent_start)) - 1) * Number(parent.dy || parent.dx) / METERS_PER_DEGREE;
    const width = (Math.max(1, Number(domain.e_we) - 1) * Number(domain.dx)) / metersPerLongitude(referenceLat);
    const height = (Math.max(1, Number(domain.e_sn) - 1) * Number(domain.dy || domain.dx)) / METERS_PER_DEGREE;
    result.push({ west, east: west + width, south, north: south + height });
  });
  return result;
}

const domainBounds = computed(calculatedBounds);
const domainShapes = computed(() => {
  // 订阅地图视图 revision，确保平移缩放后覆盖层同步重绘。
  void projector?.state?.value?.rev;
  return props.domains.map((domain, index) => {
    const bounds = index === props.activeIndex && draftBounds.value ? draftBounds.value : domainBounds.value[index];
    const corners = [
      [bounds.west, bounds.north], [bounds.east, bounds.north],
      [bounds.east, bounds.south], [bounds.west, bounds.south],
    ].map(([lon, lat]) => projector?.project?.(lon, lat)).filter(Boolean);
    const points = corners.map(point => `${point.x},${point.y}`).join(" ");
    const first = corners[0] || { x: 0, y: 0 };
    return { id: domain.id, index, points, color: COLORS[index], label: { x: first.x + 7, y: first.y + 16 } };
  });
});

function selectDomain(index) {
  cancelInteraction();
  emit("update:activeIndex", index);
}

function fitActiveDomain() {
  const bounds = domainBounds.value[props.activeIndex];
  if (!bounds) return;
  flyToExtent?.([bounds.west, bounds.south, bounds.east, bounds.north]);
}

function toggleDrawing() {
  drawing.value = !drawing.value;
  interaction.value = null;
  draftBounds.value = null;
  emit("drawing", drawing.value);
}

function point(event) {
  return projector?.unproject?.(event.clientX, event.clientY) || null;
}

function onPointerDown(event) {
  const value = point(event);
  if (!value) return;
  const targetIndex = Number(event.target?.dataset?.domainIndex);
  if (!drawing.value && targetIndex !== props.activeIndex) return;
  overlay.value?.setPointerCapture?.(event.pointerId);
  const original = domainBounds.value[props.activeIndex];
  interaction.value = {
    pointerId: event.pointerId,
    mode: drawing.value ? "draw" : "move",
    start: value,
    original: { ...original },
  };
  draftBounds.value = drawing.value
    ? { west: value.lon, east: value.lon, south: value.lat, north: value.lat }
    : { ...original };
}

function clampMoved(bounds, index) {
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;
  if (index === 0) {
    const west = Math.max(-180, Math.min(180 - width, bounds.west));
    const south = Math.max(-85, Math.min(85 - height, bounds.south));
    return { west, east: west + width, south, north: south + height };
  }
  const parent = domainBounds.value[index - 1];
  const west = Math.max(parent.west, Math.min(parent.east - width, bounds.west));
  const south = Math.max(parent.south, Math.min(parent.north - height, bounds.south));
  return { west, east: west + width, south, north: south + height };
}

function onPointerMove(event) {
  const state = interaction.value;
  if (!state || state.pointerId !== event.pointerId) return;
  const value = point(event);
  if (!value) return;
  if (state.mode === "draw") {
    draftBounds.value = normalized({ west: state.start.lon, east: value.lon, south: state.start.lat, north: value.lat });
    return;
  }
  const lonDelta = value.lon - state.start.lon;
  const latDelta = value.lat - state.start.lat;
  draftBounds.value = clampMoved(
    {
      west: state.original.west + lonDelta,
      east: state.original.east + lonDelta,
      south: state.original.south + latDelta,
      north: state.original.north + latDelta,
    },
    props.activeIndex,
  );
}

function snappedSegments(sizeMeters, dx, ratio = 1) {
  let segments = Math.round(sizeMeters / Math.max(1, dx));
  if (ratio > 1) {
    segments = Math.round(segments / ratio) * ratio;
    segments = Math.max(Math.ceil(9 / ratio) * ratio, segments);
    return Math.min(Math.floor(499 / ratio) * ratio, segments);
  }
  return Math.max(9, Math.min(499, segments));
}

function inside(child, parent) {
  const epsilon = 1e-7;
  return child.west >= parent.west - epsilon && child.east <= parent.east + epsilon
    && child.south >= parent.south - epsilon && child.north <= parent.north + epsilon;
}

function commitBounds(bounds, index) {
  const value = normalized(bounds);
  if (value.east - value.west < 0.02 || value.north - value.south < 0.02) {
    emit("invalid", "绘制范围过小，请拖拽更大的矩形");
    return false;
  }
  const domains = props.domains.map(domain => ({ ...domain }));
  const domain = domains[index];
  const centerLat = (value.south + value.north) / 2;
  const widthMeters = (value.east - value.west) * metersPerLongitude(centerLat);
  const heightMeters = (value.north - value.south) * METERS_PER_DEGREE;
  if (index === 0) {
    domain.e_we = snappedSegments(widthMeters, Number(domain.dx)) + 1;
    domain.e_sn = snappedSegments(heightMeters, Number(domain.dy || domain.dx)) + 1;
    emit("update:center", { lat: centerLat, lon: (value.west + value.east) / 2 });
  } else {
    const parent = domains[index - 1];
    const parentBounds = domainBounds.value[index - 1];
    if (!inside(value, parentBounds)) {
      emit("invalid", `${domain.id.toUpperCase()} 必须完全位于 ${parent.id.toUpperCase()} 内部`);
      return false;
    }
    const ratio = Math.round(Number(parent.dx) / Number(domain.dx));
    if (![3, 5].includes(ratio) || Number(parent.dy || parent.dx) / Number(domain.dy || domain.dx) !== ratio) {
      emit("invalid", "子域网格距必须为父域的 1/3 或 1/5");
      return false;
    }
    const segmentsX = snappedSegments(widthMeters, Number(domain.dx), ratio);
    const segmentsY = snappedSegments(heightMeters, Number(domain.dy || domain.dx), ratio);
    domain.e_we = segmentsX + 1;
    domain.e_sn = segmentsY + 1;
    const referenceLat = (parentBounds.south + parentBounds.north) / 2;
    const rawI = Math.round((value.west - parentBounds.west) * metersPerLongitude(referenceLat) / Number(parent.dx)) + 1;
    const rawJ = Math.round((value.south - parentBounds.south) * METERS_PER_DEGREE / Number(parent.dy || parent.dx)) + 1;
    domain.i_parent_start = Math.max(1, Math.min(Math.floor(Number(parent.e_we) - segmentsX / ratio), rawI));
    domain.j_parent_start = Math.max(1, Math.min(Math.floor(Number(parent.e_sn) - segmentsY / ratio), rawJ));
    domain.parent_id = index;
    domain.parent_grid_ratio = ratio;
  }
  emit("update:domains", domains);
  return true;
}

function onPointerUp(event) {
  const state = interaction.value;
  if (!state || state.pointerId !== event.pointerId) return;
  overlay.value?.releasePointerCapture?.(event.pointerId);
  if (draftBounds.value) commitBounds(draftBounds.value, props.activeIndex);
  interaction.value = null;
  draftBounds.value = null;
  if (drawing.value) {
    drawing.value = false;
    emit("drawing", false);
  }
}

function cancelInteraction() {
  interaction.value = null;
  draftBounds.value = null;
  if (drawing.value) {
    drawing.value = false;
    emit("drawing", false);
  }
}

watch(() => props.activeIndex, () => nextTick(fitActiveDomain));
onMounted(() => setTimeout(fitActiveDomain, 80));
</script>

<style scoped>
.domain-editor { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
.domain-overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; touch-action: none; }
.domain-overlay.drawing { pointer-events: all; cursor: crosshair; }
.domain-shape { fill: transparent; stroke-width: 2; stroke-dasharray: 7 5; vector-effect: non-scaling-stroke; pointer-events: none; }
.domain-shape.active { fill: color-mix(in srgb, var(--accent) 9%, transparent); stroke-width: 3; stroke-dasharray: none; pointer-events: all; cursor: move; }
.domain-overlay text { font: 700 12px "SFMono-Regular", Consolas, monospace; paint-order: stroke; stroke: #07101e; stroke-width: 4px; pointer-events: none; }
.domain-tools { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 8px; pointer-events: auto; }
.domain-tabs { display: flex; gap: 5px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--glass); backdrop-filter: blur(12px); }
.domain-tabs button, .draw-button { height: 30px; padding: 0 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--muted); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.domain-tabs button.active { border-color: var(--domain-color); color: var(--domain-color); background: color-mix(in srgb, var(--domain-color) 14%, transparent); }
.draw-button { border-color: var(--border); background: var(--glass); }
.draw-button.active { border-color: var(--accent); color: var(--accent); }
.domain-tools > span { padding: 6px 9px; border-radius: 7px; background: #07101ecc; color: #cbd5e1; font-size: 10px; }
@media (max-width: 720px) { .domain-tools { align-items: flex-start; flex-wrap: wrap; }.domain-tools > span { width: 100%; } }
</style>
