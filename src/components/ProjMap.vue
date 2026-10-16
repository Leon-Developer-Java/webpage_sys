<template><ProjectionMap ref="map" v-bind="$attrs" :frame-loader="preloadFrame" :cached-frame="getCachedFrame"><slot /></ProjectionMap></template>
<script setup>
import {ref} from 'vue';
import ProjectionMap from '../../packages/wrf-ui/src/ProjectionMap.vue';
import {getCachedFrame,preloadFrame} from '../utils/frameImageCache';
defineOptions({inheritAttrs:false});
const map=ref();
defineExpose({flyTo:(...args)=>map.value?.flyTo(...args),zoomBy:(...args)=>map.value?.zoomBy(...args),home:()=>map.value?.home(),screenToLonLat:(...args)=>map.value?.screenToLonLat(...args),clearData:()=>map.value?.clearData()});
</script>
