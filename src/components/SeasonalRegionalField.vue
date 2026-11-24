<template>
  <svg class="regional-field" aria-label="区域原始格点降水分布" data-ready="true">
    <g v-for="(cell,i) in cells" :key="i">
      <path :d="cell.path" :fill="cell.color" :fill-opacity="opacity" stroke="white" stroke-opacity="0.25" stroke-width="0.7"/>
      <text v-if="showValues && cell.label" :x="cell.x" :y="cell.y" text-anchor="middle" dominant-baseline="middle">{{ cell.label }}</text>
    </g>
  </svg>
</template>
<script setup>
import {computed,inject} from 'vue';
import {fieldColor,regionCells,valueText} from '../utils/seasonalRegionalField';
const props=defineProps({data:Object,active:Number,scale:Object,opacity:Number,showValues:Boolean});
const projector=inject('mapProjector');
const cells=computed(()=>{
  projector.state.value.rev;
  return regionCells(props.data,props.active).flatMap(cell=>{
    const [w,s,e,n]=cell.bbox,points=[[w,s],[w,n],[e,n],[e,s]].map(([x,y])=>projector.project(x,y));
    if(!points.every(Boolean))return [];
    const center=projector.project(cell.longitude,cell.latitude);
    const width=Math.abs(points[2].x-points[0].x),height=Math.abs(points[0].y-points[1].y);
    return [{...center,path:points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')+' Z',color:fieldColor(cell.value,props.scale),
      label:center?.visible && width>=42 && height>=24 ? valueText(cell.value) : ''}];
  });
});
</script>
<style scoped>
.regional-field {position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;}
text {font:600 10px sans-serif;fill:#fff;stroke:#102030;stroke-width:2px;paint-order:stroke;stroke-linejoin:round;}
</style>
