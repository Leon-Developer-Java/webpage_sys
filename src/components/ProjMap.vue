<template><ProjectionMap ref="map" v-bind="$attrs" :tile-url="tileUrl" :frame-loader="preloadFrame" :cached-frame="getCachedFrame"><slot /></ProjectionMap></template>
<script setup>
import {computed,ref,useAttrs} from 'vue';
import ProjectionMap from '../../packages/wrf-ui/src/ProjectionMap.vue';
import {getCachedFrame,preloadFrame} from '../utils/frameImageCache';
import {BASEMAPS} from '../utils/basemaps';
defineOptions({inheritAttrs:false});
const map=ref();
const attrs=useAttrs();
const tileUrl=computed(()=>attrs.tileUrl ?? attrs['tile-url'] ?? BASEMAPS[attrs.basemap]?.url);
defineExpose({flyTo:(...args)=>map.value?.flyTo(...args),zoomBy:(...args)=>map.value?.zoomBy(...args),home:()=>map.value?.home(),screenToLonLat:(...args)=>map.value?.screenToLonLat(...args),clearData:()=>map.value?.clearData()});
</script>
