<template>
 <section ref="editor" :class="['wrf-ui wrf-editor', {'wrf-editor-bounded':hostMode==='workbench','wrf-guided':presentation==='guided'}]">
  <header v-if="showHeader!==false" class="wrf-head"><div><small>WRF WORKBENCH</small><h2>区域天气模拟</h2></div><span>GFS / ECMWF</span></header>
  <nav class="wrf-editor-tabs" aria-label="配置面板"><button :aria-pressed="mobilePanel==='settings'" @click="mobilePanel='settings'">参数</button><button :aria-pressed="mobilePanel==='map'" @click="mobilePanel='map'">地图</button></nav>
  <div :class="['wrf-editor-layout', 'wrf-panel-'+mobilePanel]">
   <aside v-show="presentation!=='guided'" class="wrf-settings">
    <section><h3>资料与时间</h3><div class="wrf-fields">
     <label>驱动资料<select :value="value.data_source" :disabled="locked" @change="setSource($event.target.value)"><option value="gfs">GFS 全球预报</option><option value="ecmwf">ECMWF IFS</option></select></label>
     <label>驱动资料间隔<select :value="value.forecast_interval_hours" :disabled="locked" @change="field('forecast_interval_hours',+$event.target.value)"><option v-for="n in intervals" :key="n" :value="n">{{n}} 小时</option></select></label>
     <label>开始时间（UTC）<input type="datetime-local" :value="time(value.start_time)" :disabled="locked" @change="field('start_time',$event.target.value+':00Z')"><small>{{local(value.start_time)}}</small></label>
     <label>结束时间（UTC）<input type="datetime-local" :value="time(value.end_time)" :disabled="locked" @change="field('end_time',$event.target.value+':00Z')"><small>{{local(value.end_time)}}</small></label>
     <label>结果输出间隔<select :value="value.history_interval_minutes" :disabled="locked" @change="field('history_interval_minutes',+$event.target.value)"><option v-for="n in profile.history_intervals_minutes||[10,30,60,180,360]" :value="n" :key="n">{{n}} 分钟</option></select></label>
     <label>Spin-up（小时）<input type="number" :min="spinupLimits[0]" :max="spinupLimits[1]" :step="value.forecast_interval_hours||1" :value="inputValue('run.spinup',value.spinup?.hours??6)" :disabled="locked" @input="runtimeInput('spinup',$event)"></label>
     <label>垂直层数<input type="number" :min="verticalLimits[0]" :max="verticalLimits[1]" :value="inputValue('run.vertical_levels',value.vertical_levels??88)" :disabled="locked" @input="runtimeInput('vertical_levels',$event)"></label>
    </div></section>
    <section><div class="wrf-section-head"><h3>计算域</h3><button :disabled="locked||(!history.length&&!Object.keys(invalidInputs).length)" @click="undo">撤销</button></div>
     <p v-if="changeNotice" role="status" class="wrf-change-notice">{{changeNotice}}</p>
     <p v-if="!value.domains.length" class="wrf-muted">在右侧地图框选 D01，或使用坐标创建。</p>
     <button v-if="!value.domains.length" :disabled="locked" @click="addRoot">按坐标创建 D01</button>
     <div v-for="d in value.domains" :key="d.node_key" :style="{marginLeft:depth(value.domains,d)*12+'px'}" :class="['wrf-domain-row',{active:active===d.node_key}]">
      <button class="wrf-domain-title" @click="active=d.node_key">{{d.id.toUpperCase()}} <small>{{d.dx}} m</small></button>
      <button title="增加子域" :aria-label="`为${d.id}增加子域`" :disabled="locked||value.domains.length>=4" @click="add(d.node_key)">＋</button><button :aria-label="`删除${d.id}及子域`" :disabled="locked" @click="remove(d.node_key)">−</button>
     </div>
     <div v-if="value.center" class="wrf-fields">
      <label>投影<select :value="value.projection.map_proj" :disabled="locked" @change="projection('map_proj',$event.target.value)"><option value="lambert">Lambert</option><option value="mercator">Mercator</option><option value="polar">Polar</option></select></label>
      <label v-for="k in ['lat','lon']" :key="k">{{k==='lat'?'中心纬度':'中心经度'}}<input type="number" :min="k==='lat'?-90:-180" :max="k==='lat'?90:180" step="any" :value="inputValue('center.'+k,value.center[k])" :disabled="locked" @input="numberInput(center,k,$event,'center.'+k)"></label>
      <label v-for="k in ['truelat1',...(value.projection.map_proj==='lambert'?['truelat2']:[]),'stand_lon']" :key="k">{{k}}<input type="number" :min="k==='stand_lon'?-180:-90" :max="k==='stand_lon'?180:90" step="any" :value="inputValue('projection.'+k,value.projection[k])" :disabled="locked" @input="numberInput(projection,k,$event,'projection.'+k)"></label>
     </div>
     <div v-if="selected" class="wrf-fields wrf-domain-fields">
      <label v-if="!selected.parent_id">网格距（m）<input type="number" min="1000" max="50000" step="1" :value="inputValue('domain.'+selected.node_key+'.dx',selected.dx)" :disabled="locked" @input="numberInput(domainField,'dx',$event,'domain.'+selected.node_key+'.dx')"></label>
      <label v-else>嵌套比例<select :value="selected.parent_grid_ratio" :disabled="locked" @change="domainField('parent_grid_ratio',+$event.target.value)"><option :value="3">3:1</option><option :value="5">5:1</option></select></label>
      <label v-for="k in ['e_we','e_sn',...(selected.parent_id?['i_parent_start','j_parent_start']:[])]" :key="k">{{labels[k]}}<input type="number" :min="k.startsWith('e_')?10:1" :max="k.startsWith('e_')?500:undefined" :value="inputValue('domain.'+selected.node_key+'.'+k,selected[k])" :disabled="locked" @input="numberInput(domainField,k,$event,'domain.'+selected.node_key+'.'+k)"></label>
     </div>
     <details v-if="preview?.boundaries?.length"><summary>查看投影后四角</summary><div v-for="b in preview.boundaries" :key="b.id"><b>{{b.id.toUpperCase()}}</b><p v-for="(c,k) in b.corners" :key="k" class="wrf-mono">{{k}} {{c[1].toFixed(4)}}, {{c[0].toFixed(4)}}</p></div></details>
    </section>
    <section><h3>物理与同化</h3><p class="wrf-muted">默认通用设置，可按研究需求修改。</p><div class="wrf-fields">
     <label>网格松弛<select :value="value.assimilation_scheme||'off'" :disabled="locked" @change="field('assimilation_scheme',$event.target.value)"><option v-for="a in profile.assimilation_schemes||[{value:'off',label:'关闭'}]" :value="a.value" :key="a.value">{{a.label}}</option></select></label>
     <label v-if="selected">{{selected.id.toUpperCase()}} 积云对流<select aria-label="当前域积云对流" :value="selectedCumulusChoice" :disabled="locked" @change="cumulus($event.target.value)"><option value="auto">按网格距默认</option><option v-for="c in cumulusChoices" :value="c.value" :key="c.value">{{c.label}}</option></select><small>{{selected.dx}} m · 当前采用 {{selectedCumulusLabel}}；仅修改当前域。</small></label>
    </div><p v-if="value.namelist?.input?.physics?.cu_physics!==undefined" class="wrf-muted">修改当前域积云时会替换同名高级覆盖，其他域保留当前显式值。</p><details><summary>修改其他物理参数</summary><div class="wrf-fields"><label v-for="f in otherPhysicsFields" :key="f.id">{{f.label}}<select v-if="f.choices?.length" :value="value.physics?.[f.id]??profile.physics_defaults?.[f.id]" :disabled="locked" @change="physics(f.id,+$event.target.value)"><option v-for="c in f.choices" :value="c.value" :key="c.value">{{c.label}}</option></select><input v-else type="number" :min="f.min" :max="f.max" :value="inputValue('physics.'+f.id,value.physics?.[f.id]??profile.physics_defaults?.[f.id])" :disabled="locked" @input="numberInput(physics,f.id,$event,'physics.'+f.id)"></label></div></details></section>
   </aside>
   <div class="wrf-map-column"><nav v-if="presentation==='guided'" aria-label="计算域选择"><button v-for="d in value.domains" :key="d.node_key" :aria-pressed="active===d.node_key" @click="active=d.node_key">{{d.id.toUpperCase()}}</button><button :disabled="locked||!history.length" @click="undo">撤销</button></nav><DomainMap :config="value" :preview="preview" :active-key="active" :disabled="locked||previewPending" :read-only="readOnly" @active-change="active=$event" @preview-request="mapEdit"/><div class="wrf-map-status"><span v-if="previewPending">正在校验投影边界…</span><span v-else-if="previewError" role="alert" class="wrf-error">{{previewError}}，输入已保留</span><span v-else-if="value.domains.length&&preview?.boundaries?.length">{{value.domains.length}} 个计算域 · {{Math.min(...value.domains.map(d=>d.dx))}} m 最细网格</span><span v-else>计算范围尚未创建</span><button v-if="previewError&&value.domains.length&&!readOnly" :disabled="locked||previewPending" @click="retryPreview">重新校验投影</button><span>地理资料 default</span></div></div>
  </div>
  <p v-if="!validation.valid" role="alert" class="wrf-error">{{validation.errors.join('；')}}</p>
  <p v-if="error||props.error" role="alert" class="wrf-error">{{error||props.error}}</p>
  <footer v-if="!hideSubmit&&hostMode!=='agent'&&!readOnly" class="wrf-footer"><div class="wrf-submit-status"><span>CPU · {{value.domains.length}} 个计算域</span><span v-if="blockedReason" role="status">{{blockedReason}}</span><button v-if="!validation.valid||!value.domains.length" @click="locateIssue">定位配置</button></div><button class="primary" :disabled="Boolean(blockedReason)" @click="emit('action',{action:'submit'})">{{disabled?'正在校验…':(submitLabel||'开始模拟')}}</button></footer>
 </section>
</template>
<script setup>
import {computed,nextTick,ref,watch} from 'vue';
import DomainMap from './DomainMap.vue';
import {numberIssue,numericFields,numericValidation} from './numericValidation.js';
import {addDomain,clone,cumulusOverrides,cumulusValue,defaultConfig,depth,descendants,removeDomain,setCumulus,setDomain,withKeys} from './model.js';
const props=defineProps({presentation:{type:String,default:'full'},submitLabel:String,error:String,config:Object,options:Object,preview:Object,previewPending:Boolean,previewError:String,disabled:Boolean,submitDisabled:Boolean,submitReason:String,readOnly:Boolean,hideSubmit:Boolean,hostMode:String,showHeader:{default:true},editorKey:String});
const editor=ref(null),mobilePanel=ref('settings');
const blockedReason=computed(()=>props.disabled?'正在校验或提交，请稍候':props.submitReason||(!value.value.domains.length?'请先创建计算域':!validation.value.valid?validation.value.errors[0]:props.previewPending?'正在校验投影边界':props.previewError?'投影校验未通过，请修改或重新校验':!props.preview?.boundaries?.length?'请先完成计算域投影校验':props.submitDisabled?'服务暂不能提交此配置':''));
async function locateIssue(){mobilePanel.value='settings';await nextTick();const target=editor.value?.querySelector('[aria-invalid="true"]')||editor.value?.querySelector('.wrf-settings input');target?.scrollIntoView({block:'center'});target?.focus();}
const emit=defineEmits(['config-change','preview-request','action','validation-change']);
const value=ref(withKeys(props.config||defaultConfig(props.options))),active=ref(value.value.domains[0]?.node_key||''),history=ref([]),error=ref(''),lastRequest=ref(''),changeNotice=ref(''),invalidInputs=ref({});
const validation=computed(()=>numericValidation(value.value,props.options,invalidInputs.value));
watch(validation,state=>emit('validation-change',state),{deep:true,immediate:true,flush:'sync'});
watch(()=>props.editorKey,(key,previous)=>{if(previous!==undefined&&key!==previous){invalidInputs.value={};history.value=[];error.value='';changeNotice.value='';}});
const profile=computed(()=>props.options?.configuration_profile||{}),locked=computed(()=>props.disabled||props.readOnly),selected=computed(()=>value.value.domains.find(d=>d.node_key===active.value)||value.value.domains[0]);
const intervals=computed(()=>profile.value.forecast_intervals?.[value.value.data_source]||(value.value.data_source==='ecmwf'?[3]:[1,3,6]));
const spinupLimits=computed(()=>[profile.value.runtime_parameters?.spinup_hours?.min??0,profile.value.runtime_parameters?.spinup_hours?.max]),verticalLimits=computed(()=>[profile.value.runtime_parameters?.vertical_levels?.min??10,profile.value.runtime_parameters?.vertical_levels?.max??500]);
const otherPhysicsFields=computed(()=>(profile.value.physics_fields||[]).filter(f=>f.id!=='cu_physics'));
const cumulusChoices=computed(()=>profile.value.physics_fields?.find(f=>f.id==='cu_physics')?.choices||[{value:0,label:'关闭'},{value:3,label:'Grell–Freitas'}]);
const selectedCumulusChoice=computed(()=>selected.value?cumulusOverrides(value.value)[selected.value.node_key]??'auto':'auto');
const selectedCumulusLabel=computed(()=>{const n=selected.value?cumulusValue(value.value,selected.value,props.options):0;return `${cumulusChoices.value.find(c=>c.value===n)?.label??'方案'}（${n}）${selectedCumulusChoice.value==='auto'?'，按网格距默认':'，显式覆盖'}`;});
const labels={e_we:'东西网格数',e_sn:'南北网格数',i_parent_start:'父域起点 i',j_parent_start:'父域起点 j'};
watch(()=>props.config,c=>{if(c&&JSON.stringify(c)!==JSON.stringify(value.value)){const old=value.value.domains;const next=withKeys(c);next.domains.forEach(d=>{d.node_key=c.domains.find(x=>x.id===d.id)?.node_key||old.find(x=>x.id===d.id)?.node_key||d.node_key;});value.value=next;if(!next.domains.some(d=>d.node_key===active.value))active.value=next.domains[0]?.node_key||'';}},{deep:true});
function update(next,geometry=false){if(locked.value)return;history.value.push(clone(value.value));if(history.value.length>30)history.value.shift();value.value=next;error.value='';changeNotice.value='';emit('config-change',{config:clone(next)});if(geometry&&next.domains.length)request({config:clone(next),requestId:crypto.randomUUID()});}
function perform(fn){try{update(fn(),true);}catch(e){error.value=e.message;}}
function field(k,v){const next={...clone(value.value),[k]:v};if(k==='vertical_levels'&&next.namelist?.input?.domains)delete next.namelist.input.domains.e_vert;if(k==='history_interval_minutes'&&next.namelist?.input?.time_control)delete next.namelist.input.time_control.history_interval;update(next);}
function inputValue(key,fallback){return Object.hasOwn(invalidInputs.value,key)?invalidInputs.value[key]:fallback;}
function numberInput(set,k,e,key){const raw=e.target.value,spec=numericFields(value.value,props.options)[key];e.target.setAttribute('aria-invalid',String(Boolean(numberIssue(raw,spec))));if(numberIssue(raw,spec)){invalidInputs.value={...invalidInputs.value,[key]:raw};return;}set(k,Number(raw));const remaining={...invalidInputs.value};delete remaining[key];invalidInputs.value=remaining;}
function runtimeInput(k,e){numberInput((key,n)=>field(key,key==='spinup'?{mode:'custom',hours:n}:n),k,e,'run.'+k);}
function setSource(v){field('data_source',v);if(!intervals.value.includes(value.value.forecast_interval_hours))field('forecast_interval_hours',intervals.value[0]);}
function addRoot(){perform(()=>addDomain(value.value));active.value=value.value.domains[0]?.node_key;}
function add(key){const old=new Set(value.value.domains.map(d=>d.node_key));perform(()=>addDomain(value.value,key));active.value=value.value.domains.find(d=>!old.has(d.node_key))?.node_key||active.value;}
function remove(key){const removed=descendants(value.value.domains,key),nodes=value.value.domains.filter((d,i)=>removed.has(i+1));perform(()=>removeDomain(value.value,key));if(nodes.length&&nodes.every(d=>!value.value.domains.some(p=>p.node_key===d.node_key))){const remaining={...invalidInputs.value};for(const d of nodes)for(const field of Object.keys(remaining))if(field.startsWith('domain.'+d.node_key+'.'))delete remaining[field];invalidInputs.value=remaining;changeNotice.value=`已删除 ${nodes.map(d=>d.id.toUpperCase()).join('、')}${nodes.length>1?'（含子域）':''}；可撤销。`;}if(!value.value.domains.some(d=>d.node_key===active.value))active.value=value.value.domains[0]?.node_key||'';}
function domainField(k,v){perform(()=>setDomain(value.value,selected.value.node_key,k,v));}
function projection(k,v){const next=clone(value.value);next.projection[k]=v;update(next,true);}
function center(k,v){const next=clone(value.value);next.center[k]=v;update(next,true);}
function physics(k,v){const next=clone(value.value);if(v==='auto')delete next.physics[k];else next.physics[k]=v;next.physics.preset='自定义';delete next.physics[k+'_by_domain'];if(next.namelist?.input?.physics)delete next.namelist.input.physics[k];update(next);}
function cumulus(v){try{update(setCumulus(value.value,selected.value.node_key,v));}catch(e){error.value=e.message;}}
function undo(){if(Object.keys(invalidInputs.value).length){invalidInputs.value={};changeNotice.value='已撤销未完成的数值输入，参数已恢复。';return;}const next=history.value.pop();if(!next)return;value.value=next;changeNotice.value='已撤销上次修改，计算域与参数已恢复。';emit('config-change',{config:clone(next)});if(next.domains.length)request({config:clone(next),requestId:crypto.randomUUID()});}
function request(e){lastRequest.value=e.requestId;emit('preview-request',e);}
function retryPreview(){request({config:clone(value.value),requestId:crypto.randomUUID()});}
function mapEdit(e){update(e.config);request(e);}
watch(()=>props.preview,p=>{if(!p?.domains||!p.center||(p.requestId&&p.requestId!==lastRequest.value))return;const keys=new Map(value.value.domains.map(d=>[d.id,d.node_key]));const next={...clone(value.value),center:p.center,domains:p.domains.map(d=>({...d,node_key:keys.get(d.id)||crypto.randomUUID()})),projection:p.projection_parameters||value.value.projection,aoi:p.aoi??value.value.aoi};if(JSON.stringify(next)!==JSON.stringify(value.value)){value.value=next;emit('config-change',{config:clone(next)});}},{deep:true});
function time(v){return String(v||'').slice(0,16);}
function local(v){const d=new Date(v);return Number.isFinite(+d)?'北京时间 '+d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';}
</script>
