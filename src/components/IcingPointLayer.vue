<template>
  <div class="icing-points">
    <button
      v-for="item in projected"
      :key="item.key"
      class="icing-point"
      :style="{ left: `${item.x}px`, top: `${item.y}px` }"
      @mouseenter="hovered = item"
      @mouseleave="hovered = null"
    ></button>
    <div v-if="hovered" class="icing-tooltip" :style="{ left: `${hovered.x}px`, top: `${hovered.y}px` }">
      <b>覆冰点</b>
      <span>经度 {{ hovered.lon.toFixed(3) }}°，纬度 {{ hovered.lat.toFixed(3) }}°</span>
      <span>累计厚度 {{ hovered.ice_thick_mm.toFixed(2) }} mm</span>
      <span>类型 {{ hovered.ice_type_name }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref } from "vue";

const props = defineProps({ points: { type: Array, default: () => [] } });
const projector = inject("mapProjector");
const hovered = ref(null);

const projected = computed(() => {
  projector?.state?.value?.rev;
  if (!projector) return [];
  return props.points.map((point, index) => {
    const screen = projector.project(point.lon, point.lat);
    return screen?.visible ? { ...point, ...screen, key: `${point.lon}-${point.lat}-${index}` } : null;
  }).filter(Boolean);
});
</script>

<style scoped>
.icing-points { position: absolute; inset: 0; pointer-events: none; }
.icing-point { position: absolute; width: 12px; height: 12px; margin: -6px; border: 2px solid #fff; border-radius: 50%; background: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, .8); pointer-events: auto; cursor: pointer; animation: icing-pulse 1.2s infinite; }
.icing-tooltip { position: absolute; z-index: 2; width: max-content; max-width: 210px; padding: 8px 10px; transform: translate(10px, -108%); border: 1px solid rgba(255,255,255,.22); border-radius: 8px; background: rgba(13, 22, 35, .92); color: #f8fafc; font-size: 11px; line-height: 1.55; pointer-events: none; }
.icing-tooltip span, .icing-tooltip b { display: block; }
@keyframes icing-pulse { 70% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
</style>
