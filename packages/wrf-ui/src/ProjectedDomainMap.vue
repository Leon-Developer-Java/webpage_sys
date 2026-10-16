<template>
  <section class="wrf-map-shell" aria-label="计算域地图">
    <ProjectionMap ref="map" class="wrf-map" :projection="displayProjection" :animate="false" :dark="dark" :vector="true" :vector-data="fallbackMap" :tile-url="tiles">
      <ProjectedDomainOverlay :config="config" :preview="preview" :active-key="activeDomain?.node_key" :mode="mode" :disabled="disabled" :read-only="readOnly" :image-overlay="imageOverlay" @gesture="finish" @active-change="emit('active-change',$event)" />
    </ProjectionMap>
    <div class="wrf-map-tools">
      <label class="wrf-map-projection">地图投影<select v-model="displayProjection" aria-label="地图显示投影"><option v-for="p in DISPLAY_PROJECTIONS" :key="p" :value="p">{{p==='等经纬'?'等经纬度':p}}</option></select></label>
      <button aria-label="放大地图" @click="map?.zoomBy(.8)">＋</button><button aria-label="缩小地图" @click="map?.zoomBy(1.25)">−</button>
      <button v-if="!readOnly" :class="{selected:mode==='draw'}" :disabled="disabled" @click="mode=mode==='draw'?'pan':'draw'">{{config?.domains?.length?'重画选中域':'框选 D01'}}</button>
      <button v-if="!readOnly&&config?.domains?.length" :class="{selected:mode==='edit'}" :disabled="disabled" @click="mode=mode==='edit'?'pan':'edit'">移动 / 缩放域</button>
      <button :disabled="!preview?.boundaries?.length&&!imageOverlay?.extent" @click="fit">{{readOnly?'定位结果':'定位全部域'}}</button><button @click="home">中国视图</button>
    </div>
    <p class="wrf-map-note">{{readOnly?'拖动浏览结果 · 滚轮缩放':!config?.domains?.length?'点击“框选 D01”创建计算范围':mode==='pan'?'拖动浏览地图':mode==='draw'?'拖动框选计算域':'拖动域边界或角点'}}<span v-if="!readOnly"> · 显示投影不改变计算网格</span></p>
    <small class="wrf-map-attribution">© OpenStreetMap contributors · Natural Earth</small>
  </section>
</template>
<script setup>
import {computed,inject,nextTick,onMounted,ref,watch} from 'vue';
import ProjectionMap from './ProjectionMap.vue';
import ProjectedDomainOverlay from './ProjectedDomainOverlay.vue';
import fallbackMap from './fallback-map.json';
import {addDomain,clone} from './model.js';
import {DISPLAY_PROJECTIONS} from './presentation.js';
const props=defineProps({config:Object,preview:Object,disabled:Boolean,readOnly:Boolean,activeKey:String,imageOverlay:Object});
const emit=defineEmits(['preview-request','active-change']);
const map=ref(),mode=ref('pan'),displayProjection=ref('等经纬'),theme=inject('wrf-theme',ref('light'));
const dark=computed(()=>theme.value==='dark'),tiles='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const activeDomain=computed(()=>props.config?.domains?.find(d=>d.node_key===props.activeKey)||props.config?.domains?.[0]);
function extent(){if(props.imageOverlay?.extent?.length===4)return props.imageOverlay.extent;const points=(props.preview?.boundaries||[]).flatMap(b=>b.polygon?.coordinates?.[0]||[]);return points.length?[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]:null;}
function fit(){const value=extent();if(value)map.value?.flyTo(value);}
function home(){map.value?.flyTo([73,18,135,54]);}
function request(config,edit){emit('preview-request',{config,edit,requestId:crypto.randomUUID()});}
function finish(g){if(props.disabled||props.readOnly)return;const end=g.end;if(mode.value==='draw'){let config=clone(props.config||{domains:[]});if(!config.domains?.length){config=addDomain(config);config.center={lat:(g.start.lat+end.lat)/2,lon:(g.start.lon+end.lon)/2};config.projection={...config.projection,map_proj:config.projection?.map_proj||'lambert',truelat1:config.center.lat,truelat2:config.center.lat,stand_lon:config.center.lon};}const domain=config.domains.find(d=>d.node_key===(g.activeKey||props.activeKey))||config.domains[0];request(config,{operation:'draw',domain_id:domain.id,bounds:{west:Math.min(g.start.lon,end.lon),east:Math.max(g.start.lon,end.lon),south:Math.min(g.start.lat,end.lat),north:Math.max(g.start.lat,end.lat)}});mode.value='pan';}else if(g.domain)request(clone(props.config),g.handle?{operation:'resize',domain_id:g.domain.id,handle:g.handle,end}:{operation:'move',domain_id:g.domain.id,start:g.start,end});}
watch(displayProjection,async()=>{mode.value='pan';await nextTick();extent()?fit():home();});
watch(()=>props.preview?.boundaries?.length,(n,old)=>{if(n&&!old)nextTick(fit);});
watch(()=>props.imageOverlay?.extent?.join(','),(n,old)=>{if(n&&n!==old)nextTick(fit);});
onMounted(()=>nextTick(()=>extent()?fit():home()));
</script>
