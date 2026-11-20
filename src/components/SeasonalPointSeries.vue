<template>
  <section class="point-series" aria-label="附近原始格点数值">
    <div class="series-heading"><b>{{ region.name }}范围内原始格点</b><span>{{ layer.resolution || '分辨率未提供' }} · {{ data?.unit || layer.unit || '单位未提供' }}</span></div>
    <p v-if="loading" role="status">正在读取原始文件中的格点值…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load">重试格点</button></p>
    <template v-else-if="data">
      <p>最近格点：{{ data.sample_point.longitude.toFixed(4) }}°E，{{ data.sample_point.latitude.toFixed(4) }}°N；参照位置为{{ region.name }}范围中心。<strong>单个原始格点，非市域平均。</strong></p>
      <svg v-if="chart.points.length" viewBox="0 0 560 115" role="img" :aria-label="`${region.name}附近格点${data.period_months === 3 ? '季节窗口' : '所选时次'}数值曲线，单位${data.unit}`">
        <line x1="16" y1="103" x2="544" y2="103" class="chart-axis"/>
        <polyline v-for="(segment,i) in chart.segments" :key="i" :points="segment"/>
        <g v-for="point in chart.points" :key="point.index">
          <circle :cx="point.x" :cy="point.y" :r="point.index === active ? 5 : 3"/>
          <text :x="point.x" :y="Math.max(10,point.y-9)" text-anchor="middle">{{ display(point.value) }}</text>
        </g>
      </svg>
      <table><thead><tr><th>{{ data.period_months === 3 ? '三个月窗口' : '有效时次 北京时间' }}</th><th>格点值 {{ data.unit }}</th></tr></thead>
        <tbody><tr v-for="(item,index) in data.series" :key="item.valid_time" :class="{selected:index===active}">
          <td><button @click="$emit('select',index)">{{ data.period_months === 3 ? item.forecast_label : formatForecastTime(item.valid_time,'Asia/Shanghai') }}</button></td><td>{{ display(item.value) }}</td>
        </tr></tbody></table>
      <p>保留原始格点值，未进行空间插值或降尺度；缺测显示“缺测”。{{ data.unit === 'mm/day' ? 'mm/day为日均降水率或其距平，未换算为月累计量。' : '' }}连线只帮助比较所选时次，不代表逐日变化。</p>
    </template>
  </section>
</template>
<script setup>
import {computed,onBeforeUnmount,ref,shallowRef,watch} from 'vue';
import {getSeasonalPointSeries} from '../api';
import {forecastTimestamp,formatForecastTime} from '../utils/seasonalSelection';
import {pointInRegion,pointSeriesChart} from '../utils/seasonalGridView';
const props=defineProps({fileUuid:String,variableKey:String,frames:Array,layer:Object,region:Object,active:Number});
const emit=defineEmits(['loaded','select']);
const data=shallowRef(null),loading=ref(false),error=ref('');
const chart=computed(()=>pointSeriesChart(data.value?.series || []));
let generation=0,abort;
function display(value) {return typeof value==='number' && Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '缺测';}
async function load() {
  const request=++generation;abort?.abort();abort=new AbortController();data.value=null;error.value='';loading.value=true;emit('loaded',null);
  try {
    const [w,s,e,n]=props.region.bbox;
    const result=await getSeasonalPointSeries({fileUuid:props.fileUuid,variableKey:props.variableKey,validTimes:props.frames.map(f=>f.valid_time),longitude:(w+e)/2,latitude:(s+n)/2,signal:abort.signal});
    if(request!==generation)return;
    if(result.file_uuid!==props.fileUuid || result.variable_key!==props.variableKey || result.method!=='nearest_grid_point' || !Number.isFinite(result.sample_point?.longitude) || !Number.isFinite(result.sample_point?.latitude) || result.series?.length!==props.frames.length || result.series.some((item,i)=>forecastTimestamp(item.valid_time)!==forecastTimestamp(props.frames[i].valid_time) || (item.value!==null && (typeof item.value!=='number' || !Number.isFinite(item.value))))) throw new Error('格点结果与当前文件或时段不一致，未展示数值。');
    if(!pointInRegion(result.sample_point.longitude,result.sample_point.latitude,props.region)) throw new Error('指定范围内没有原始格点；未用范围外的格点代替，请扩大范围或选择更细网格的产品。');
    data.value=result;emit('loaded',result);
  } catch(cause) {if(request===generation && cause.name!=='AbortError') error.value=cause.message || '格点读取失败，未从图片估算。';}
  finally {if(request===generation)loading.value=false;}
}
watch(()=>JSON.stringify([props.fileUuid,props.variableKey,props.region,props.frames?.map(f=>f.valid_time)]),load,{immediate:true});
onBeforeUnmount(()=>{generation++;abort?.abort();});
</script>
<style scoped>
.point-series {border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12px;min-width:0;}
.series-heading {display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;}
p {margin:6px 0;color:var(--muted);line-height:1.6;overflow-wrap:anywhere;}
strong {color:var(--text);}
svg {display:block;width:100%;height:110px;overflow:visible;}
polyline {fill:none;stroke:#409eff;stroke-width:2;}
circle {fill:#409eff;stroke:var(--bg);stroke-width:1;}
text {font:12px sans-serif;fill:var(--text);}
.chart-axis {stroke:var(--border);}
table {border-collapse:collapse;width:100%;} th,td {padding:5px 7px;border:1px solid var(--border);text-align:left;}
th:last-child,td:last-child {text-align:right;}
tr.selected {background:var(--field);font-weight:bold;}
button {font:inherit;color:var(--text);background:transparent;border:0;cursor:pointer;text-align:left;text-decoration:underline;}
</style>
