<template>
  <svg class="icing-lines" aria-label="四平覆冰演示线路">
    <g v-for="line in projectedLines" :key="line.name">
      <polyline class="line-shadow" :points="line.path" />
      <polyline class="line-stroke" :points="line.path" :style="{ stroke: line.color }" />
      <g v-for="tower in line.towers" :key="tower.name" class="tower" :transform="`translate(${tower.x} ${tower.y})`">
        <title>{{ tower.name }}</title>
        <path class="tower-frame" d="M0,-11 L-5,8 M0,-11 L5,8 M-5,8 H5 M-3,2 H3 M-4,-4 H4 M-8,-7 H8 M-6,-7 L-3,-4 M6,-7 L3,-4" />
        <circle class="tower-node" cx="0" cy="-11" r="2" />
      </g>
      <g v-if="line.label" class="line-label" :transform="`translate(${line.label.x} ${line.label.y})`">
        <text y="1">{{ line.name }}</text>
      </g>
    </g>
  </svg>
</template>

<script setup>
import { computed, inject } from "vue";

const props = defineProps({ lines: { type: Array, default: () => [] } });
const projector = inject("mapProjector");

const projectedLines = computed(() => {
  projector?.state?.value?.rev;
  if (!projector) return [];
  return props.lines.map(line => {
    const points = line.points.map(([lon, lat]) => projector.project(lon, lat)).filter(point => point?.visible);
    const label = projector.project(line.label[0], line.label[1]);
    return {
      ...line,
      path: points.map(point => `${point.x},${point.y}`).join(" "),
      towers: line.towers.map(tower => ({ ...tower, ...projector.project(tower.lon, tower.lat) })).filter(tower => tower.visible),
      label: label?.visible ? label : null,
    };
  }).filter(line => line.path && line.towers.length);
});
</script>

<style scoped>
.icing-lines { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.line-shadow, .line-stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.line-shadow { stroke: rgba(4, 10, 22, .82); stroke-width: 6; }
.line-stroke { stroke-width: 3; stroke-dasharray: 10 3; filter: drop-shadow(0 1px 1px rgba(0,0,0,.55)); }
.tower { pointer-events: auto; cursor: help; }
.tower-frame { fill: none; stroke: #172033; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.tower-node { fill: #f8fafc; stroke: #172033; stroke-width: 1.2; }
.tower:hover .tower-frame, .tower:hover .tower-node { stroke: #b45309; }
.tower:hover .tower-node { fill: #fbbf24; }
.line-label text { fill: #000; font-size: 12px; font-weight: 700; dominant-baseline: middle; paint-order: stroke; stroke: rgba(255,255,255,.9); stroke-width: 2.4px; stroke-linejoin: round; }
</style>
