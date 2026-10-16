<template>
  <svg class="wrf-domain-overlay" :class="{drawing:mode==='draw'&&!disabled&&!readOnly}" :viewBox="`0 0 ${state.width||1} ${state.height||1}`" @pointerdown="begin($event)" @pointermove="move" @pointerup="finish" @pointercancel="cancel">
    <g v-if="aoiRing.length" style="pointer-events:none"><path :d="path(aoiRing)" fill="none" stroke="#e6a637" stroke-width="2" stroke-dasharray="7 5"/><text v-if="point(aoiRing[0])" :x="point(aoiRing[0]).x" :y="point(aoiRing[0]).y-6" class="wrf-domain-text">建议关注范围</text></g>
    <g v-for="item in shapes" :key="item.domain.id">
      <path :d="item.path" :stroke="item.color" :fill="item.color" :fill-opacity="item.active?0.12:0.04" :stroke-width="item.active?3:2" :class="{editable:!readOnly}" @pointerdown.stop="begin($event,item.domain)" />
      <text v-if="item.label" :x="item.label.x" :y="item.label.y" class="wrf-domain-text">{{item.domain.id.toUpperCase()}}</text>
      <template v-if="item.active&&mode==='edit'&&!disabled&&!readOnly"><circle v-for="c in item.corners" :key="c.handle" :cx="c.x" :cy="c.y" r="6" :stroke="item.color" class="wrf-domain-handle" @pointerdown.stop="begin($event,item.domain,c.handle)" /></template>
    </g>
    <path v-if="sketch" :d="sketch" class="wrf-domain-sketch" />
  </svg>
</template>
<script setup>
import {computed,inject,ref,watch,onBeforeUnmount} from 'vue';
const props=defineProps({config:Object,preview:Object,activeKey:String,mode:String,disabled:Boolean,readOnly:Boolean,imageOverlay:Object});
const emit=defineEmits(['gesture','active-change']);
const projector=inject('mapProjector'),surface=inject('mapSurface'),state=projector.state;
const gesture=ref(null),end=ref(null);
const colors=['#3299ee','#20ba8c','#e6a637','#b285f5'];
function point(c){state.value.rev;return projector.project(c[0],c[1]);}
function path(coords){let prior=null;return coords.map(c=>{const p=point(c);if(!p){prior=null;return '';}const prefix=!prior||Math.hypot(p.x-prior.x,p.y-prior.y)>state.value.width*.8?'M':'L';prior=p;return `${prefix}${p.x},${p.y}`;}).join(' ');}
const aoiRing=computed(()=>{const a=props.config?.aoi;if(!a)return [];return [[a.west,a.south],[a.east,a.south],[a.east,a.north],[a.west,a.north],[a.west,a.south]];});
const shapes=computed(()=>(props.preview?.boundaries||[]).flatMap(b=>{const index=props.config?.domains?.findIndex(d=>d.id===b.id),domain=props.config?.domains?.[index];if(!domain)return [];const coords=b.polygon?.coordinates?.[0]||[],valid=coords.map(point).filter(Boolean);return [{domain,path:path(coords),color:colors[index%4],active:domain.node_key===props.activeKey,label:valid.length?{x:valid.reduce((s,p)=>s+p.x,0)/valid.length,y:valid.reduce((s,p)=>s+p.y,0)/valid.length}:null,corners:Object.entries(b.corners||{}).flatMap(([handle,c])=>{const p=point(c);return p?[{...p,handle}]:[];})}];}));
function position(e){const p=projector.unproject(e.clientX,e.clientY);return p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)?p:null;}
function begin(e,domain,handle){if(props.disabled||props.readOnly||e.button!==0)return;if(domain&&props.mode!=='draw')emit('active-change',domain.node_key);if(props.mode==='pan'||(!domain&&props.mode!=='draw'))return;const start=position(e);if(!start)return;e.preventDefault();const svg=e.currentTarget.ownerSVGElement||e.currentTarget;svg.setPointerCapture(e.pointerId);gesture.value={start,domain,handle,activeKey:props.activeKey};end.value=start;}
function move(e){if(gesture.value)end.value=position(e)||end.value;}
function finish(e){if(!gesture.value)return;const g=gesture.value,p=position(e)||end.value;cancel();if(p&&Math.abs(g.start.lon-p.lon)+Math.abs(g.start.lat-p.lat)>.001)emit('gesture',{...g,end:p});}
function cancel(){gesture.value=null;end.value=null;}
const sketch=computed(()=>{const g=gesture.value,e=end.value;if(!g||!e)return '';const s=g.start;return props.mode==='draw'?path([[s.lon,s.lat],[e.lon,s.lat],[e.lon,e.lat],[s.lon,e.lat],[s.lon,s.lat]]):path([[s.lon,s.lat],[e.lon,e.lat]]);});
watch(()=>[props.mode,props.disabled,props.readOnly],cancel);
watch(()=>props.imageOverlay,value=>{if(value?.url)surface.setData(value.url,value.extent,0.85,{mercator:(value.target_crs||'EPSG:3857')==='EPSG:3857'});else surface.clear();},{immediate:true});
onBeforeUnmount(()=>surface.clear());
</script>
