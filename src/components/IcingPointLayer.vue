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
      <b>覆冰网格</b>
      <span>经度 {{ hovered.lon.toFixed(3) }}°，纬度 {{ hovered.lat.toFixed(3) }}°</span>
      <span>净冰厚 {{ hovered.ice_thick_mm.toFixed(2) }} mm</span>
      <span>类型 {{ hovered.ice_type_name }}</span>
      <span>等级 {{ levelName(hovered.icing_level) }}</span>
      <span v-if="Number(hovered.icing_growth_mm) > 0">本时次增厚 {{ Number(hovered.icing_growth_mm).toFixed(2) }} mm</span>
      <span v-if="Number(hovered.icing_melt_mm) > 0">本时次消融 {{ Number(hovered.icing_melt_mm).toFixed(2) }} mm</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref } from "vue";

const props = defineProps({ points: { type: Array, default: () => [] } });
const projector = inject("mapProjector");
const hovered = ref(null);

function levelName(value) {
  return ({ 1: "轻度", 2: "中度", 3: "重度", 4: "严重" })[Number(value)] || "无覆冰";
}

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
.icing-point { position: absolute; display: block; width: 14px; height: 14px; padding: 0; margin: -7px; appearance: none; -webkit-appearance: none; border: 0 !important; outline: 0 !important; background: transparent !important; color: transparent !important; box-shadow: none !important; opacity: 0 !important; pointer-events: auto; cursor: crosshair; }
.icing-tooltip { position: absolute; z-index: 2; width: max-content; max-width: 210px; padding: 8px 10px; transform: translate(10px, -108%); border: 1px solid rgba(255,255,255,.22); border-radius: 8px; background: rgba(13, 22, 35, .92); color: #f8fafc; font-size: 11px; line-height: 1.55; pointer-events: none; }
.icing-tooltip span, .icing-tooltip b { display: block; }
</style>
