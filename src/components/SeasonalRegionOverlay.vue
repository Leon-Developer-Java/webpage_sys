<template>
  <div class="region-overlay" aria-label="预报地区定位">
    <svg class="region-box" aria-hidden="true"><path v-if="outline" :d="outline"/></svg>
    <span v-if="pin?.visible" class="region-pin" :style="{left:`${pin.x}px`,top:`${pin.y}px`}">⊕ <b>{{ region.name }}</b></span>
    <span class="coordinates">{{ pointer ? `经度 ${pointer.lon.toFixed(4)}° · 纬度 ${pointer.lat.toFixed(4)}°` : '移动鼠标查看经纬度' }}</span>
  </div>
</template>
<script setup>
import {computed, inject, onMounted, onBeforeUnmount} from 'vue';
import {regionalViewExtent} from '../utils/seasonalGridView';
const props = defineProps({region:{type:Object,required:true},layer:Object,pointer:Object});
const projector = inject('mapProjector');
const flyTo = inject('flyToExtent');
const pin = computed(() => {
  projector.state.value.rev;
  const [w,s,e,n] = props.region.bbox;
  return projector.project((w+e)/2,(s+n)/2);
});
const outline = computed(() => {
  projector.state.value.rev;
  const [w,s,e,n] = props.region.bbox;
  const points = [[w,s],[w,n],[e,n],[e,s]].map(([lon,lat]) => projector.project(lon,lat));
  return points.every(Boolean) ? points.map((p,i) => `${i?'L':'M'}${p.x},${p.y}`).join(' ')+' Z' : '';
});
// Fit only on initial mount or the explicit reposition action, never on frame changes.
let timer;
onMounted(() => {timer=window.setTimeout(() => flyTo?.(regionalViewExtent(props.region,props.layer)),0);});
onBeforeUnmount(() => window.clearTimeout(timer));
</script>
<style scoped>
.region-overlay,.region-box {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;}
.region-box path {fill:none;stroke:#ffdf5e;stroke-width:2;stroke-dasharray:6 4;filter:drop-shadow(0 1px 2px #000);}
.region-pin {position:absolute;transform:translate(-10px,-50%);font-size:20px;color:#ffdf5e;text-shadow:0 1px 3px #000;white-space:nowrap;}
.region-pin b {font-size:14px;background:#101b2ce8;color:white;padding:3px 6px;border-radius:4px;}
.coordinates {position:absolute;left:8px;bottom:8px;background:#101b2ce8;color:white;border-radius:4px;padding:4px 7px;font-size:11px;}
</style>
