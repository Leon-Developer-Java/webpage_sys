<template>
  <main ref="viewer" class="seasonal-embed">
    <p v-if="loading" role="status">正在读取所选季节降水图…</p>
    <section v-else-if="error" class="map-error" role="alert"><p>{{ error }}</p><button @click="load">重试</button></section>
    <template v-else-if="resource">
      <header class="map-heading">
        <b>{{ resource.meta.product || resource.file_name }}</b>
        <span>起报（UTC）：{{ issueLabel }}</span>
        <p v-if="selectionContext?.region" class="region-summary">{{ selectionContext.region.name }} · 经度 {{ selectionContext.region.bbox[0].toFixed(4) }}–{{ selectionContext.region.bbox[2].toFixed(4) }}°E · 纬度 {{ selectionContext.region.bbox[1].toFixed(4) }}–{{ selectionContext.region.bbox[3].toFixed(4) }}°N（定位包围框，非行政边界）</p>
        <p class="resolution-summary">原始网格分辨率：{{ layer.resolution || '未提供' }}{{ spacingSummary }} · {{ selectionContext?.region ? '仅显示' + selectionContext.region.name + '指定范围' : '全球视野' }}</p>
        <button v-if="selectionContext?.region" @click="map?.flyTo(regionalViewExtent(selectionContext.region,layer))">定位到{{ selectionContext.region.name }}</button>
        <button :disabled="!fullscreenAvailable" @click="fullscreen">全屏查看</button>
        <label>地图要素<select aria-label="地图要素" :value="variableKey" @change="chooseVariable($event.target.value)">
          <option v-for="item in variables" :key="item.key" :value="item.key" :disabled="!variableAvailable(item.key)">{{ item.label || item.key }}{{ variableAvailable(item.key) ? '' : '（该时次不可用）' }}</option>
        </select></label>
        <SeasonalOpacityControl v-model="seasonalOpacity"/>
        <label><input type="checkbox" v-model="showBasemap"/>显示底图</label>
        <template v-if="selectionContext?.region">
          <label>色标<select aria-label="降水色标" v-model="colorMode"><option value="regional">区域色标</option><option value="product">产品统一色标</option></select></label>
          <label><input type="checkbox" v-model="showValues"/>显示格点数值</label>
        </template>
      </header>
      <div class="map-area" :class="{'regional-map-area':selectionContext?.region}" @pointermove="showCoordinates" @pointerleave="pointer = null">
        <ProjMap ref="map" :dark="dark" :grid="true" :vector="false" :basemap="showBasemap ? '矢量底图' : ''" :preserve-view="!selectionContext?.region" :animate="false">
          <SeasonalRegionRaster :region="selectionContext?.region">
            <GribLayer :key="variableKey" data-type="SEASONAL_PRECIP" :parsed="parsed" :time-index="frameIndex" :auto-zoom="false" :alpha="regionalData ? 0 : seasonalOpacity/100"/>
          </SeasonalRegionRaster>
          <SeasonalRegionalField v-if="regionalData && regionalScale" :data="regionalData" :active="frameIndex" :scale="regionalScale" :opacity="seasonalOpacity/100" :show-values="showValues"/>
          <SeasonalRegionOverlay v-if="selectionContext?.region" :region="selectionContext.region" :layer="layer" :pointer="pointer"/>
        </ProjMap>
      </div>
      <footer>
        <p v-if="fieldLoading" class="map-hint" role="status">正在读取区域原始降水格点…</p>
        <p v-else-if="fieldError" class="map-hint" role="alert">{{ fieldError }} <button @click="loadRegionalField">重试区域格点</button></p>
        <p v-else-if="regionalData" class="regional-values-summary">{{ fieldSummary }}</p>
        <p v-if="notice" class="map-hint" role="status">{{ notice }}</p>
        <div class="map-time-controls">
          <button :disabled="frames.length < 2" @click="playing = !playing">{{ playing ? '暂停' : '播放' }}</button>
          <label>有效时次<select aria-label="地图有效时次" v-model.number="frameIndex">
            <option v-for="(frame,index) in frames" :key="frame.valid_time" :value="index">{{ layer.period_months === 3 ? frame.forecast_label : formatForecastTime(frame.valid_time, 'Asia/Shanghai') }}</option>
          </select></label>
          <span>北京时间 · {{ frameIndex + 1 }} / {{ frames.length }}</span>
        </div>
        <TimeAxis :times="timeLabels" :active="frameIndex" :max-ticks="4" @update:active="frameIndex = $event"/>
        <div v-if="regionalScale || layer.gradient" class="map-legend" aria-label="当前要素图例">
          <p v-if="regionalScale" class="map-hint">{{ colorMode==='regional' ? '区域色标（所选全部时次共用）' : '产品统一色标' }} · {{ layer.unit }}</p>
          <div class="legend-bar" :style="{background:regionalScale?.gradient || layer.gradient}"/>
          <div class="legend-ticks"><span v-for="(tick,i) in (regionalScale?.ticks || layer.legend_ticks)" :key="i">{{ tick }}</span></div>
        </div>
        <p class="map-hint">单位：{{ layer.unit || layer.displayUnit || '未提供' }} · 图中文字解读对应结果卡原时次；切换后点击上方“解读当前图”更新说明。</p>
        <p v-if="selectionContext?.region" class="map-hint">仅显示所列经纬度范围内的降水和原始格点，范围外不显示降水。格点值不是区域面积平均。</p>
      </footer>
      <SeasonalPointSeries v-if="selectionContext?.region" :file-uuid="resource.file_uuid" :variable-key="variableKey" :frames="frames" :layer="layer" :region="selectionContext.region" :active="frameIndex" @select="frameIndex=$event;playing=false"/>
    </template>
  </main>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import ProjMap from '../components/ProjMap.vue';
import GribLayer from '../layers/GribLayer.vue';
import TimeAxis from '../components/TimeAxis.vue';
import SeasonalRegionOverlay from '../components/SeasonalRegionOverlay.vue';
import SeasonalPointSeries from '../components/SeasonalPointSeries.vue';
import SeasonalRegionRaster from '../components/SeasonalRegionRaster.vue';
import SeasonalOpacityControl from '../components/SeasonalOpacityControl.vue';
import SeasonalRegionalField from '../components/SeasonalRegionalField.vue';
import {fieldScale,valueText,regionCells} from '../utils/seasonalRegionalField';
import {useSeasonalOpacity} from '../utils/seasonalOpacity';
import { getDisplayResource,getSeasonalRegionGrid } from '../api';
import { seasonalAgentContext } from '../utils/seasonalAgentContext';
import { forecastTimestamp, formatForecastTime, seasonalIssueTime } from '../utils/seasonalSelection';
import { resolveSeasonalMapSelection, seasonalMapFrames } from '../utils/seasonalMapSelection';
import {regionalViewExtent,seasonalGridSpacing} from '../utils/seasonalGridView';

const route = useRoute();
const dark = inject('theme', ref(true));
const viewer = ref(null);
const seasonalOpacity = useSeasonalOpacity();
const showBasemap = ref(true);
const colorMode=ref('regional'),showValues=ref(true),regionalData=shallowRef(null),fieldLoading=ref(false),fieldError=ref('');
let fieldGeneration=0,fieldAbort;
const map = ref(null), pointer = ref(null), selectionContext = shallowRef(null);
const fullscreenAvailable = document.fullscreenEnabled;
const notice = ref('');
const resource = shallowRef(null);
const loading = ref(false), error = ref(''), variableKey = ref(''), frameIndex = ref(0), playing = ref(false);
let timer = null, generation = 0;
const layer = computed(() => {
  const raw = resource.value?.meta?.variable_layers?.[variableKey.value];
  return raw ? {...raw,
    productCategory:raw.varType==='precipitation' && ['mm/day','mm/d'].includes(raw.unit) ? '降水率' : raw.productCategory,
    frames:seasonalMapFrames(raw, selectionContext.value?.validTimes)} : {};
});
const frames = computed(() => layer.value.frames || []);
const regionalScale=computed(()=>regionalData.value ? fieldScale(regionalData.value,colorMode.value,layer.value.color_range) : null);
const fieldSummary=computed(()=>{
  const values=regionCells(regionalData.value,frameIndex.value).map(cell=>cell.value).filter(v=>typeof v==='number' && Number.isFinite(v));
  if(!values.length)return '指定范围内没有可用原始格点值。';
  const min=Math.min(...values),max=Math.max(...values),kind=layer.value.varType==='anomaly' ? '降水距平' : layer.value.varType==='probability' ? '类别概率' : '降水';
  return `当前时次区域内 ${values.length} 个有效格点，${kind}范围 ${valueText(min)} 至 ${valueText(max)} ${layer.value.unit || ''}。${layer.value.varType==='anomaly' ? '正值偏多，负值偏少。' : ''}${min===max ? '这些格点数值相同，保留相同颜色。' : '图中数字为原始格点值。'}`;
});
async function loadRegionalField() {
  const request=++fieldGeneration;fieldAbort?.abort();fieldAbort=new AbortController();regionalData.value=null;fieldError.value='';fieldLoading.value=false;
  const region=selectionContext.value?.region;
  if(!resource.value || !region || !frames.value.length)return;
  fieldLoading.value=true;
  try {
    const data=await getSeasonalRegionGrid({fileUuid:resource.value.file_uuid,variableKey:variableKey.value,validTimes:frames.value.map(f=>f.valid_time),bbox:region.bbox,signal:fieldAbort.signal});
    if(request!==fieldGeneration)return;
    if(data.file_uuid!==resource.value.file_uuid || data.variable_key!==variableKey.value || data.unit!==layer.value.unit || data.result_type!==layer.value.varType || data.method!=='original_region_grid' || JSON.stringify(data.bbox)!==JSON.stringify(region.bbox) || !Array.isArray(data.longitudes) || !Array.isArray(data.latitudes) || data.longitudes.length*data.latitudes.length>5000 || !(data.grid_spacing?.longitude>0 && data.grid_spacing?.latitude>0) || data.series?.length!==frames.value.length)throw new Error('区域格点与当前选择不匹配。');
    if(!data.longitudes.every(x=>Number.isFinite(x) && region.bbox[0]<=x && x<=region.bbox[2]) || !data.latitudes.every(y=>Number.isFinite(y) && region.bbox[1]<=y && y<=region.bbox[3]))throw new Error('区域格点坐标超出指定范围。');
    data.series.forEach((frame,i)=>{if(forecastTimestamp(frame.valid_time)!==forecastTimestamp(frames.value[i].valid_time) || frame.values?.length!==data.latitudes.length || frame.values.some(row=>!Array.isArray(row) || row.length!==data.longitudes.length || row.some(v=>v!==null && (typeof v!=='number' || !Number.isFinite(v)))))throw new Error('区域格点时次或数值无效。');});
    regionalData.value=data;
  }catch(cause){if(request===fieldGeneration && cause.name!=='AbortError')fieldError.value='区域格点暂不可用，当前保留产品原图；'+(cause.message || '请重试。');}
  finally{if(request===fieldGeneration)fieldLoading.value=false;}
}
watch(()=>JSON.stringify([resource.value?.file_uuid,variableKey.value,selectionContext.value?.region,frames.value.map(f=>f.valid_time)]),loadRegionalField);
const spacingSummary = computed(() => {
  const spacing=seasonalGridSpacing(layer.value);
  if(!spacing || !selectionContext.value?.region)return '';
  const bbox=selectionContext.value.region.bbox,latitude=(bbox[1]+bbox[3])/2;
  return `（当地约 ${Math.round(111.2*Math.cos(latitude*Math.PI/180)*spacing.longitude)} × ${Math.round(111.2*spacing.latitude)} 公里）`;
});
const variables = computed(() => Object.entries(resource.value?.meta?.variable_layers || {}).filter(([,item]) => item.frames?.length).map(([key,item]) => ({key,label:item.label})));
const timeLabels = computed(() => frames.value.map(frame => formatForecastTime(frame.valid_time, 'Asia/Shanghai')));
const issueLabel = computed(() => formatForecastTime(seasonalIssueTime(resource.value), 'UTC'));
const parsed = computed(() => ({file_name:resource.value.file_name, data_type:'SEASONAL_PRECIP', business_type:'SEASONAL_PRECIP',
  meta:{...resource.value.meta, default_variable:variableKey.value, variable_layers:{[variableKey.value]:layer.value},
    variable_options:(resource.value.meta.variable_options || []).filter(item => item.key === variableKey.value).map(item=>({...item,productCategory:layer.value.productCategory}))}}));

async function load() {
  const request = ++generation;
  playing.value = false; resource.value = null; error.value = ''; loading.value = true;
  try {
    const context = seasonalAgentContext({fileUuid:route.query.file_uuid, variableKey:route.query.variable_key, validTime:route.query.valid_time,
      ...(route.query.region ? {region:JSON.parse(route.query.region)} : {}), ...(route.query.valid_times ? {validTimes:JSON.parse(route.query.valid_times)} : {})});
    if (!context || context.topic !== 'map') throw new Error('地图选择信息不完整，请从结果卡重新打开。');
    const data = await getDisplayResource({file_uuid:context.fileUuid});
    if (request !== generation) return;
    const selection = resolveSeasonalMapSelection(data, context.variableKey, context.validTime, context.validTimes, context.region);
    selectionContext.value = context;
    variableKey.value = selection.variableKey; frameIndex.value = selection.frameIndex; resource.value = data;
  } catch (cause) { if (request === generation) error.value = cause.message || '地图读取失败。'; }
  finally { if (request === generation) loading.value = false; }
}

function chooseVariable(key) {
  const oldTime = frames.value[frameIndex.value]?.valid_time;
  if (!variableAvailable(key)) return;
  const next = seasonalMapFrames(resource.value.meta.variable_layers[key], selectionContext.value?.validTimes);
  const index = next.findIndex(frame => forecastTimestamp(frame.valid_time) === forecastTimestamp(oldTime));
  playing.value = false;
  // No replacement of the user's selected forecast time across variables.
  if (index < 0) return;
  variableKey.value = key; frameIndex.value = index;
}

function variableAvailable(key) {
  try {
    const next = resource.value?.meta?.variable_layers?.[key];
    if (!next || (selectionContext.value?.validTimes && next.period_months !== layer.value.period_months)) return false;
    return seasonalMapFrames(next, selectionContext.value?.validTimes).some(frame =>
      forecastTimestamp(frame.valid_time) === forecastTimestamp(frames.value[frameIndex.value]?.valid_time));
  } catch { return false; }
}

function showCoordinates(event) { pointer.value = map.value?.screenToLonLat(event.clientX,event.clientY) || null; }

function reportSelection() {
  if (!resource.value || window.parent === window) return;
  let origin;
  try { origin = window.location.ancestorOrigins?.[0] || new URL(document.referrer).origin; } catch { return; }
  const trusted = new Set([window.location.origin, 'http://127.0.0.1:5173', 'http://localhost:5173',
    ...String(import.meta.env.VITE_AGENTSCOPE_WEB_URL || '').split(',').filter(Boolean).map(value => {try{return new URL(value).origin;}catch{return '';}})]);
  if (!trusted.has(origin)) return;
  const context = seasonalAgentContext({fileUuid:resource.value.file_uuid, variableKey:variableKey.value, validTime:frames.value[frameIndex.value]?.valid_time,
    region:selectionContext.value?.region, validTimes:selectionContext.value?.validTimes});
  if (context) window.parent.postMessage({type:'weather-seasonal-map-selection', selection:context}, origin);
}
function syncTheme(event) { if (event.key === 'zhihui-theme' && ['dark','light'].includes(event.newValue)) dark.value = event.newValue === 'dark'; }
async function fullscreen() {
  notice.value = '';
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await viewer.value?.requestFullscreen(); }
  catch { notice.value = '浏览器暂不允许全屏，可继续在对话内查看。'; }
}
watch([resource, variableKey, frameIndex], reportSelection, {flush:'post'});
watch([playing, frameIndex, variableKey], () => {
  window.clearTimeout(timer);
  if (playing.value && frames.value.length > 1) timer = window.setTimeout(() => {frameIndex.value = (frameIndex.value + 1) % frames.value.length;}, 1400);
});
watch(() => route.fullPath, load);
onMounted(() => {window.addEventListener('storage', syncTheme); load();});
onBeforeUnmount(() => {generation++;fieldGeneration++;fieldAbort?.abort(); window.clearTimeout(timer); window.removeEventListener('storage', syncTheme);});
</script>

<style scoped>
.seasonal-embed { display:flex; flex-direction:column; height:100dvh; overflow-y:auto; min-height:0; padding:10px; gap:8px; box-sizing:border-box; background:var(--bg); color:var(--text); }
.map-heading { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:center; font-size:12px; }
.map-heading b { flex-basis:100%; overflow-wrap:anywhere; }
.region-summary {flex-basis:100%;margin:0;line-height:1.5;font-weight:600;}
.resolution-summary {flex-basis:100%;margin:0;line-height:1.5;color:var(--text);}
.map-heading label, .map-time-controls label { display:flex; align-items:center; gap:6px; }
.map-area { flex:1 0 260px; min-height:260px; position:relative; border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.map-area :deep(.projmap) { height:100%; width:100%; }
.regional-map-area {flex-basis:360px;min-height:360px;}
.map-time-controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:12px; }
button, select { border:1px solid var(--border); border-radius:6px; padding:5px 8px; color:var(--text); background:var(--field); font:inherit; }
select { max-width:100%; min-width:0; }
select option { background:var(--bg); color:var(--text); }
footer { display:grid; gap:6px; }
.map-hint { margin:0; font-size:11px; line-height:1.5; color:var(--muted); }
.regional-values-summary {margin:0;font-size:12px;line-height:1.6;color:var(--text);font-weight:600;}
.legend-bar { height:8px; border-radius:4px; }
.legend-ticks { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); }
.map-error { padding:12px; overflow-wrap:anywhere; }
</style>
