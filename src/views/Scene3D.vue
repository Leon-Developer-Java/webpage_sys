<template>
  <main class="scene3d-page">
    <section class="scene3d-stage" aria-label="三维地形与输电线路">
      <div ref="container" class="scene3d-map"></div>
      <canvas ref="windCanvas" class="scene3d-wind" aria-label="三维风场"></canvas>
      <div class="scene3d-heading glass"><b>三维风场与输电线路</b><span>{{ activeRun ? activeRun.id : '南京默认场景' }}</span><span>左键平移 · 右键/中键旋转 · 滚轮缩放</span></div>
      <div v-if="loading" class="scene3d-loading" role="status">{{ loadingText }}</div>
      <div v-if="error" class="scene3d-error" role="alert">{{ error }}<button @click="initialize">重新连接</button></div>
      <div class="scene3d-status glass">{{ status }}<span>统计值保持未放大 · 模拟线路</span></div>
      <div class="scene3d-map-tools glass">
        <button @click="scene?.home()">复位视角</button><button @click="scene?.focus()">定位线路</button>
        <button @click="scene?.focus(true)">观察运动</button><button @click="scene?.startCrop()">框选风场</button><button @click="scene?.clearCrop()">清除框选</button>
      </div>
    </section>

    <aside class="scene3d-panel glass">
      <section>
        <h2>场景与底图</h2>
        <label>底图<select v-model="basemap"><option v-for="name in Object.keys(BASEMAPS)" :key="name">{{ name }}</option></select></label>
        <label>地形夸张 <output>{{ terrainScale.toFixed(1) }}×</output><input v-model.number="terrainScale" type="range" min="1" max="10" step="0.1"></label>
        <label><input v-model="linesVisible" type="checkbox"> 显示杆塔和导线</label>
        <label>线路分组<select v-model="group"><option value="all">全部线路对比</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select></label>
        <p v-if="geometry">{{ geometry.towers.length }} 基杆塔 · {{ geometry.spans.length }} 档 · 采样净空 {{ geometry.minimum_sampled_clearance.toFixed(2) }} m</p>
      </section>

      <section>
        <h2>风场与线路时间</h2>
        <p role="status">{{ weatherStatus }}</p>
        <button v-if="weatherStatus.startsWith('原风场') && /未启动|失败|错误/.test(weatherStatus)" @click="initialize">重连原风场</button>
        <div class="scene3d-row"><button :disabled="!result" @click="playing=!playing">{{ playing ? '暂停逐时' : '逐时播放' }}</button><time>{{ currentTime }}</time></div>
        <input v-model.number="frameIndex" aria-label="风场与线路时间轴" type="range" min="0" :max="Math.max(0,frames.length-1)" step="1" :disabled="!frames.length">
        <label>播放速度<select v-model.number="playbackSpeed"><option :value=".5">0.5×</option><option :value="1">1×</option><option :value="2">2×</option></select></label>
        <label>风场显示<select v-model="windMode"><option value="particles">三维风粒子</option><option value="volume">高度分层</option></select></label>
        <label>显示高度 <output>{{ displayHeight }} m</output><input v-model.number="displayHeight" type="range" min="500" max="4500" step="100"></label>
        <label>粒子数量 <output>{{ density }}</output><input v-model.number="density" type="range" min="500" max="24000" step="500"></label>
        <label>风速显示阈值 <output>{{ threshold.toFixed(1) }} m/s</output><input v-model.number="threshold" type="range" min="0" max="12" step=".5"></label>
      </section>

      <section>
        <h2>线路响应</h2>
        <label>显示模式<select v-model="mode"><option value="static">静态悬垂</option><option value="wind">WRF 风偏</option><option v-if="result?.mode==='dynamic_response'" value="data">导入动态响应</option></select></label>
        <label>运动放大 <output>{{ amplification }}×</output><input v-model.number="amplification" type="range" min="1" max="1000" step="1"></label>
        <label><input v-model="motionPlaying" type="checkbox"> 播放线路运动</label>
        <label v-if="mode==='data'"><input v-model="cloudVisible" type="checkbox"> 节点位移云图</label>
        <p>放大只影响显示，以下位移和荷载为原始数值。</p>
        <div class="scene3d-table-wrap"><table><thead><tr><th>分组</th><th>风速 m/s</th><th>位移 m</th></tr></thead><tbody>
          <tr v-for="row in comparisons" :key="row.id"><td>{{ row.name }}</td><td>{{ row.wind.toFixed(2) }}</td><td>{{ row.displacement.toFixed(4) }}</td></tr>
        </tbody></table></div>
        <p v-if="currentFrame?.maximum_response">导入节点最大位移：{{ currentFrame.maximum_response.toFixed(5) }} m</p>
        <details v-if="currentFrame"><summary>各档分量与杆塔荷载</summary>
          <div v-for="span in currentFrame.spans" :key="span.id" class="scene3d-span">
            <b>{{ span.id }}</b> 横向/竖向/沿线风速：{{ span.transverse_speed.toFixed(2) }} / {{ span.wind.w.toFixed(2) }} / {{ span.along_speed.toFixed(2) }} m/s<br>
            三向位移：{{ span.transverse_displacement.toFixed(4) }} / {{ span.vertical_displacement.toFixed(4) }} / {{ span.longitudinal_displacement.toFixed(4) }} m<br>
            张力 {{ (span.tension/1000).toFixed(2) }} kN · 弧垂 {{ span.sag.toFixed(2) }} m
          </div>
          <p v-for="(load,id) in currentFrame.tower_loads" :key="id">{{ id }}：{{ Math.hypot(...load).toFixed(1) }} N</p>
        </details>
      </section>

      <section>
        <h2>服务器计算</h2>
        <label>导线温度 <output>{{ parameters.temperature }} °C</output><input v-model.number="parameters.temperature" type="range" min="-20" max="80" step=".5"></label>
        <label>初始张力 <output>{{ Math.round(parameters.tension_ratio*100) }}% RTS</output><input v-model.number="parameters.tension_ratio" type="range" min=".15" max=".5" step=".01"></label>
        <div class="scene3d-row"><label v-for="part in componentChoices" :key="part.value"><input v-model="parameters.components" :value="part.value" type="checkbox">{{ part.label }}</label></div>
        <label><input v-model="parameters.maximum_wind_line" type="checkbox"> 在最大风速位置增加线路</label>
        <label>搜索高度（离地）<input v-model.number="parameters.sample_height" type="number" min="1" max="4500">m</label>
        <p>参数修改后生成新计划；旧任务结果和场景保持原参数。</p>
        <button class="scene3d-primary" :disabled="busy||!ready" @click="prepare">{{ busy ? '正在请求服务器…' : '生成计算计划' }}</button>
        <div v-if="plan" class="scene3d-plan">
          <b>待确认计划</b><pre>{{ JSON.stringify(plan.parameters,null,2) }}</pre>
          <p>数据：{{ plan.dataset?.name }}，{{ plan.dataset?.times?.length }} 个时次。计算在服务器执行。</p>
          <button class="scene3d-primary" :disabled="busy" @click="submit">确认并提交服务器</button><button @click="plan=null">取消计划</button>
        </div>
        <p v-if="activeRun">{{ activeRun.status }} · {{ activeRun.progress ?? 0 }}%</p>
        <progress v-if="activeRun" max="100" :value="activeRun.progress ?? 0"></progress>
        <button v-if="activeRun&&['running','queued'].includes(activeRun.status)" @click="cancelRun">取消当前计算</button>
        <label>历史任务<select :value="activeRun?.id||''" @change="openRun($event.target.value)"><option value="">选择已有任务</option><option v-for="run in history" :key="run.id" :value="run.id">{{ run.id.slice(-8) }} · {{ run.status }}</option></select></label>
        <button @click="openDefault">恢复默认场景</button>
      </section>

      <section>
        <h2>动态响应数据</h2>
        <p>沿用 transmission-dynamic-response/v1；节点为沿线、横向、竖向位移，单位 m。</p>
        <input aria-label="导入动态响应JSON" type="file" accept=".json,application/json" :disabled="busy||!activeRun||activeRun.status!=='succeeded'" @change="importResponse">
        <p v-if="!activeRun">先生成一份计算任务，再导入动态响应。</p>
        <div class="scene3d-row"><button :disabled="busy||activeRun?.status!=='succeeded'" @click="loadExample">加载原动态示例</button><button @click="downloadTemplate">下载导入模板</button></div>
      </section>
      <section><h2>说明</h2><p v-for="notice in notices" :key="notice">{{ notice }}</p><p>地形、风场和线路结果由 backend_scene3d 提供。当前分析使用已有 WRF 输出，不会启动新的 WRF 数值模拟。</p></section>
    </aside>
  </main>
</template>

<script setup>
import {computed,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {BASEMAPS} from '../utils/basemaps';
import {sceneRequest} from '../components/scene3d/api';
import {createScene} from '../components/scene3d/scene';

const route=useRoute(),router=useRouter();
const container=ref(),windCanvas=ref();let scene=null,controller=null,frameController=null,timer=null,polling=false,frameBusy=false,generation=0,disposed=false,lastPoll=0,productBase='/datasets/nanjing/baseline';
const loading=ref(true),loadingText=ref('连接三维服务器…'),error=ref(''),status=ref('加载中'),ready=ref(false),busy=ref(false);
const weatherStatus=ref('正在加载 WRF 风场…');
const geometry=ref(null),result=ref(null),currentFrame=ref(null),activeRun=ref(null),history=ref([]),plan=ref(null);
const basemap=ref('矢量底图'),terrainScale=ref(6),linesVisible=ref(true),group=ref('all');
const mode=ref('wind'),amplification=ref(50),motionPlaying=ref(true),cloudVisible=ref(true);
const frameIndex=ref(0),playing=ref(false),playbackSpeed=ref(1),windMode=ref('particles'),displayHeight=ref(2000),density=ref(8000),threshold=ref(0);
const parameters=reactive({dataset_id:'nanjing',temperature:20,tension_ratio:.45,maximum_wind_line:false,sample_height:60,components:['transverse','vertical','longitudinal']});
const componentChoices=[{value:'transverse',label:'横向'},{value:'vertical',label:'竖向'},{value:'longitudinal',label:'沿线'}];
const groups=computed(()=>geometry.value?.groups||[]),frames=computed(()=>result.value?.frames||[]);
const currentTime=computed(()=>frames.value[frameIndex.value]?.time||'--');
const notices=computed(()=>result.value?.notices||[]);
const comparisons=computed(()=>groups.value.map(g=>{const spans=currentFrame.value?.spans.filter(s=>s.group_id===g.id)||[];return {id:g.id,name:g.name,wind:Math.max(0,...spans.map(s=>s.wind.speed)),displacement:Math.max(0,...spans.map(s=>s.displacement))};}));
const frameCache=new Map();
const assetBase=()=>productBase;
function fail(reason){if(reason?.name!=='AbortError'&&!disposed)error.value=reason.message||String(reason);}

async function initialize(){
  controller?.abort();scene?.destroy();scene=null;ready.value=false;loading.value=true;error.value='';controller=new AbortController();
  try{
    await sceneRequest('/datasets',undefined,{signal:controller.signal});
    loadingText.value='加载原始地形和三维显示资源…';
    scene=await createScene(container.value,windCanvas.value,text=>status.value=text,controller.signal,text=>weatherStatus.value=text);
    ready.value=true;loading.value=false;
    history.value=(await sceneRequest('/runs')).items;
    if(route.query.run_id)await openRun(String(route.query.run_id));else await openDefault();
  }catch(reason){loading.value=false;fail(reason);}
}
async function loadProducts(value){
  const version=++generation;playing.value=false;frameController?.abort();frameCache.clear();
  productBase=activeRun.value?'/runs/'+activeRun.value.id:'/datasets/nanjing/baseline';
  result.value=value;group.value='all';frameIndex.value=0;
  const next=await sceneRequest(assetBase()+'/geometry');
  if(version!==generation||disposed)return;
  geometry.value=next;scene?.loadGeometry(next);
  mode.value=value.mode==='dynamic_response'?'data':'wind';scene?.setMode(mode.value);
  await showFrame(0);
}
async function openDefault(){
  try{activeRun.value=null;await router.replace({path:'/scene3d'});await loadProducts(await sceneRequest('/datasets/nanjing/baseline'));}
  catch(reason){fail(reason);}
}
async function openRun(id){
  if(!/^s3d_[0-9a-f]{32}$/.test(id)){if(id)error.value='任务标识不合法';return;}
  try{
    const run=await sceneRequest('/runs/'+id);activeRun.value=run;
    await router.replace({path:'/scene3d',query:{run_id:id}});
    if(run.status==='succeeded')await loadProducts(await sceneRequest('/runs/'+id+'/result'));
    else if(run.status==='failed')error.value=run.error||'任务失败';
  }catch(reason){fail(reason);}
}
async function showFrame(index){
  if(!scene||!result.value)return;
  frameController?.abort();frameController=new AbortController();const signal=frameController.signal,version=generation;
  frameBusy=true;
  try{
    const key=assetBase()+':'+index;
    let value=frameCache.get(key);
    if(!value){value=await sceneRequest(assetBase()+'/frames/'+index,undefined,{signal});frameCache.set(key,value);if(frameCache.size>8)frameCache.delete(frameCache.keys().next().value);}
    if(signal.aborted||version!==generation)return;
    currentFrame.value=value;scene.setFrame(value);scene.setCloud(cloudVisible.value);
    if(result.value.mode!=='dynamic_response')await scene.setWeatherFrame(index);
  }catch(reason){fail(reason);}finally{if(!signal.aborted)frameBusy=false;}
}
async function prepare(){
  busy.value=true;error.value='';
  try{plan.value=await sceneRequest('/plans',{...parameters,components:[...parameters.components]});}
  catch(reason){fail(reason);}finally{busy.value=false;}
}
async function submit(){
  if(!plan.value)return;busy.value=true;error.value='';
  try{
    const run=await sceneRequest('/runs',{plan_id:plan.value.id,idempotency_key:plan.value.id});
    plan.value=null;history.value=(await sceneRequest('/runs')).items;await openRun(run.id);
  }catch(reason){fail(reason);}finally{busy.value=false;}
}
async function cancelRun(){
  if(!window.confirm('取消当前服务器计算任务？'))return;
  try{activeRun.value=await sceneRequest('/runs/'+activeRun.value.id+'/cancel',{});}catch(reason){fail(reason);}
}
async function uploadResponse(payload){
  if(!activeRun.value||activeRun.value.status!=='succeeded')return;
  if(!window.confirm('在服务器校验并处理这份动态响应数据？原任务会保留。'))return;
  busy.value=true;error.value='';
  try{const run=await sceneRequest('/runs/'+activeRun.value.id+'/responses',payload);history.value=(await sceneRequest('/runs')).items;await openRun(run.id);}
  catch(reason){fail(reason);}finally{busy.value=false;}
}
async function importResponse(event){
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>8*1024*1024)throw new Error('动态数据不得超过8MB');await uploadResponse(JSON.parse(await file.text()));}
  catch(reason){fail(reason);}finally{event.target.value='';}
}
async function loadExample(){try{await uploadResponse(await sceneRequest('/examples/dynamic'));}catch(reason){fail(reason);}}
async function downloadTemplate(){try{const value=await sceneRequest('/examples/template');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='scene3d-response-template.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(reason){fail(reason);}}

watch(basemap,value=>scene?.setBasemap(value));watch(terrainScale,value=>scene?.setExaggeration(value));
watch(linesVisible,value=>scene?.setLinesVisible(value));watch(group,value=>scene?.showGroup(value));watch(mode,value=>scene?.setMode(value));
watch(amplification,value=>scene?.setAmplification(value));watch(motionPlaying,value=>scene?.setPlaying(value));watch(cloudVisible,value=>scene?.setCloud(value));
watch(windMode,value=>scene?.setWindMode(value));watch(displayHeight,value=>scene?.setHeight(value));watch(density,value=>scene?.setDensity(value));watch(threshold,value=>scene?.setThreshold(value));
watch(frameIndex,index=>{void showFrame(index);});
watch(()=>route.query.run_id,id=>{if(id&&String(id)!==activeRun.value?.id&&ready.value)void openRun(String(id));});
onMounted(()=>{
  void initialize();let ticks=0;
  timer=setInterval(async()=>{
    if(document.hidden||disposed)return;
    ticks++;
    const delay=result.value?.mode==='dynamic_response'?Math.max(.05,result.value.sample_interval)/playbackSpeed.value:1/playbackSpeed.value;
    if(playing.value&&!frameBusy&&frames.value.length>1&&ticks*.1>=delay){ticks=0;frameIndex.value=(frameIndex.value+1)%frames.value.length;}
    if(activeRun.value&&['queued','running'].includes(activeRun.value.status)&&!polling&&Date.now()-lastPoll>=2000){
      polling=true;lastPoll=Date.now();
      try{const old=activeRun.value;const run=await sceneRequest('/runs/'+old.id);
        if(activeRun.value?.id!==old.id)return;
        activeRun.value=run;
        if(run.status==='succeeded'){await loadProducts(await sceneRequest('/runs/'+run.id+'/result'));history.value=(await sceneRequest('/runs')).items;}
        else if(run.status==='failed')error.value=run.error||'服务器计算失败';
      }catch(reason){fail(reason);}finally{polling=false;}
    }
  },100);
});
onBeforeUnmount(()=>{disposed=true;generation++;clearInterval(timer);controller?.abort();frameController?.abort();frameCache.clear();scene?.destroy();});
</script>

<style scoped>
.scene3d-page{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 350px;height:calc(100vh - 64px);min-height:560px;background:#16232b;color:#e3edf4}
.scene3d-stage{position:relative;min-width:0;overflow:hidden}.scene3d-map,.scene3d-wind{position:absolute;inset:0;width:100%;height:100%}.scene3d-wind{pointer-events:none;z-index:1}.scene3d-heading{position:absolute;left:16px;top:16px;z-index:2;padding:12px 16px;border-radius:10px;display:flex;flex-direction:column;gap:6px}.scene3d-heading span{font-size:11px;color:#b6c8d7;font-family:monospace}.scene3d-panel{z-index:3;overflow:auto;padding:8px 18px 30px;background:var(--panel-bg,#172632);border-left:1px solid #45627655}.scene3d-panel section{padding:14px 0;border-bottom:1px solid #6b879333}.scene3d-panel h2{margin:0 0 12px;font-size:14px;font-weight:600;color:inherit}.scene3d-panel label{display:block;margin:9px 0;font-size:12px}.scene3d-panel select,.scene3d-panel input[type=number]{max-width:100%;border:1px solid #6b879377;background:#15252f;color:#e2eef5;border-radius:5px;padding:6px;margin-left:6px}.scene3d-panel input[type=range]{display:block;width:100%;accent-color:#60c5d8}.scene3d-panel output{float:right;color:#72c9dc}.scene3d-panel p{font-size:11px;line-height:1.7;color:#a9bdcc;margin:8px 0}.scene3d-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.scene3d-row time{font:11px monospace}.scene3d-page button{background:#263e4d;border:1px solid #54708088;border-radius:5px;padding:7px 10px;color:#deedf5;cursor:pointer;font-size:11px}.scene3d-page button:disabled{opacity:.4;cursor:default}.scene3d-page .scene3d-primary{background:#197d91;color:white;font-weight:600}.scene3d-map-tools{position:absolute;bottom:52px;left:16px;z-index:2;display:flex;gap:6px;padding:8px;border-radius:8px;flex-wrap:wrap}.scene3d-status{position:absolute;bottom:10px;left:16px;right:16px;z-index:2;padding:9px 12px;border-radius:6px;font-size:11px;display:flex;justify-content:space-between;gap:12px}.scene3d-status span{color:#aac4cd}.scene3d-loading{position:absolute;z-index:5;inset:0;display:grid;place-items:center;background:#10202ad9;font-size:14px}.scene3d-error{position:absolute;z-index:6;top:85px;left:18px;right:18px;background:#642b32e8;border:1px solid #d77380;border-radius:8px;padding:12px;font-size:12px}.scene3d-error button{margin-left:12px}.scene3d-panel table{width:100%;border-collapse:collapse;font-size:11px}.scene3d-panel td,.scene3d-panel th{padding:7px 3px;border-bottom:1px solid #6b879344;text-align:right}.scene3d-panel td:first-child,.scene3d-panel th:first-child{text-align:left}.scene3d-span{font-size:11px;line-height:1.9;border-top:1px solid #6b879333;padding:8px 0}.scene3d-plan{border:1px solid #6db7c3;padding:10px;margin-top:12px;border-radius:7px;font-size:12px}.scene3d-plan pre{font-size:10px;white-space:pre-wrap}.scene3d-panel progress{width:100%;accent-color:#60c5d8}.scene3d-panel details summary{font-size:12px;cursor:pointer}.scene3d-panel input[type=file]{width:100%;font-size:11px}
@media(max-width:850px){.scene3d-page{grid-template-columns:1fr;height:auto}.scene3d-stage{height:65vh;min-height:400px}.scene3d-panel{max-height:none;border-top:1px solid #45627655}.scene3d-status span{display:none}}
</style>
