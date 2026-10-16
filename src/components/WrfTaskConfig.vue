<template>
 <div class="config-host"><p v-if="!versionReady" class="capability-note" role="alert">WRF组件版本已更新，请保存配置并刷新页面后继续。</p>
 <p v-if="!options" class="capability-note" role="status">正在读取模拟配置，您可以先编辑参数。</p>
 <p v-else-if="!compatible" class="capability-note" role="status">工作台服务能力尚未更新，参数可以继续编辑，暂不能开始模拟。</p>
 <wrf-config-editor :submitLabel.prop="submitLabel" :showHeader.prop="false" :error.prop="submitError" :submitReason.prop="!serviceReady?'服务未就绪，输入已保留':!compatible?'服务能力尚未就绪，输入已保留':''" :config.prop="config" :options.prop="options" :preview.prop="preview" :previewPending.prop="previewPending" :previewError.prop="previewError" :disabled.prop="submitting||validating" :submitDisabled.prop="!versionReady||!serviceReady||!compatible||!inputValidation.valid||assessment.errors.length>0" :editorKey.prop="editorIdentity" hostMode="workbench" @config-change="changed($event.detail)" @validation-change="inputValidation=$event.detail" @preview-request="previewGeometry($event.detail)" @action="action($event.detail)" />
 <section class="configuration-assessment" aria-label="参数组合校验" :aria-busy="assessment.checking">
  <strong>{{assessment.checking?'正在核验参数组合':assessment.errors.length?'参数组合冲突，暂不能启动':'参数组合校验'}}</strong>
  <p v-for="error in assessment.errors" :key="error" class="configuration-conflict" role="alert">{{error}}</p>
  <p v-if="assessment.failure" role="alert">{{assessment.failure}} <button type="button" @click="checkConfiguration">重新校验</button></p>
  <p v-for="rule in assessment.pending" :key="rule.id">{{rule.message}}；{{rule.suggestion}}</p>
  <p v-if="!assessment.pending.length">待核验：实际驱动资料的垂直覆盖、必需字段、地形及积分稳定性；配置规则通过不等于运行必然成功。</p>
 </section>
 </div>
</template>
<script setup>
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {ElMessage} from 'element-plus';
import {registerWrfElements,defaultConfig,withKeys,geometryRequest,calculationRequest} from '@zhihuiqixiang/wrf-ui';
import {previewWrfDomains,validateWrfTask,resolveWrfNamelist} from '../api.js';
const versionReady=registerWrfElements();
const props=defineProps({options:Object,dataSource:{type:String,default:'gfs'},submitting:Boolean,serviceReady:{type:Boolean,default:true},initialRequest:Object,submitError:String,submitLabel:String});
const emit=defineEmits(['submit','cancel','change','error']);
const config=ref(defaultConfig(props.options||{},props.dataSource)),preview=ref(null),previewPending=ref(false),previewError=ref(''),validating=ref(false);
const inputValidation=ref({valid:true,errors:[]}),editorIdentity=ref(crypto.randomUUID());
const compatible=computed(()=>props.options?.configuration_profile?.id==='wrf-ordinary-ui-2');
const assessment=ref({checking:false,errors:[],pending:[],failure:''});
let checkSequence=0,checkController=null,checkTimer=null;
let dirty=false,sequence=0,controller=null,previewTimer=null,validGeometry='';
const signature=c=>JSON.stringify(geometryRequest(c));
function cancelPreview(){clearTimeout(previewTimer);previewTimer=null;controller?.abort();sequence++;}
function changed({config:next}){dirty=true;const changedGeometry=signature(next)!==signature(config.value);config.value=withKeys(next);if(changedGeometry)cancelPreview();if(!next.domains.length){preview.value=null;validGeometry='';previewPending.value=false;}else if(signature(next)!==validGeometry)previewPending.value=true;emit('change',calculationRequest(config.value,props.options||{}));}
function previewGeometry({config:next,edit,requestId}){cancelPreview();const call=sequence,requestedGeometry=signature(next);config.value=withKeys(next);previewPending.value=true;previewError.value='';previewTimer=setTimeout(async()=>{previewTimer=null;if(call!==sequence)return;controller=new AbortController();try{const result=await previewWrfDomains(geometryRequest(next,edit),controller.signal);if(call!==sequence||signature(config.value)!==requestedGeometry)return;const keys=new Map(config.value.domains.map(d=>[d.id,d.node_key]));config.value={...config.value,center:result.center,domains:result.domains.map(d=>({...d,node_key:keys.get(d.id)||crypto.randomUUID()})),projection:result.projection_parameters,aoi:result.aoi};preview.value={...result,requestId};validGeometry=signature(config.value);emit('change',calculationRequest(config.value,props.options||{}));}catch(e){if(call===sequence&&e.name!=='AbortError')previewError.value=e.message;}finally{if(call===sequence)previewPending.value=false;}},180);}
watch(()=>props.options,value=>{if(value&&!dirty&&!props.initialRequest)config.value=defaultConfig(value,props.dataSource);},{immediate:true});
watch(()=>props.dataSource,source=>{config.value={...config.value,data_source:source,forecast_interval_hours:source==='ecmwf'?3:1};});
watch(()=>props.initialRequest,value=>{if(!value)return;dirty=true;editorIdentity.value=crypto.randomUUID();inputValidation.value={valid:true,errors:[]};config.value=withKeys({...defaultConfig(props.options||{},value.data_source),...structuredClone(value),projection:structuredClone(value.projection??value.namelist?.wps?.geogrid??defaultConfig(props.options||{},value.data_source).projection),configuration_profile:'wrf-ordinary-ui-2'});if(config.value.domains.length)previewGeometry({config:config.value,requestId:crypto.randomUUID()});},{immediate:true});
function invalidateCheck(){clearTimeout(checkTimer);checkController?.abort();checkSequence++;}
async function checkConfiguration(){
 invalidateCheck();
 if(!compatible.value||!config.value.domains.length||!inputValidation.value.valid){assessment.value={checking:false,errors:[],pending:[],failure:''};return;}
 const sequence=checkSequence,request=calculationRequest(config.value,props.options||{}),snapshot=JSON.stringify(request);
 checkController=new AbortController();assessment.value={checking:true,errors:[],pending:[],failure:''};
 try{const result=await resolveWrfNamelist(request,checkController.signal);
  if(sequence!==checkSequence||snapshot!==JSON.stringify(calculationRequest(config.value,props.options||{})))return;
  assessment.value={checking:false,errors:result.errors||[],pending:(result.rules||[]).filter(r=>r.severity==='pending'),failure:''};
 }catch(e){if(sequence===checkSequence&&e.name!=='AbortError')assessment.value=e.status===422?{checking:false,errors:[e.message],pending:[],failure:''}:{checking:false,errors:[],pending:[],failure:'参数组合尚未核验：'+e.message+'；开始模拟时将重新校验，输入保持不变。'};}
}
watch(()=>JSON.stringify([calculationRequest(config.value,props.options||{}),inputValidation.value.valid,compatible.value]),()=>{
 invalidateCheck();assessment.value={checking:!!config.value.domains.length,errors:[],pending:[],failure:''};checkTimer=setTimeout(checkConfiguration,350);
},{immediate:true});
async function action({action}){if(action==='cancel')return emit('cancel');if(action!=='submit'||!versionReady||validating.value||props.submitting)return;if(!props.serviceReady)return ElMessage.warning('服务未就绪，输入已保留');if(!inputValidation.value.valid)return ElMessage.warning(inputValidation.value.errors[0]||'请完成有效的数值输入');if(previewPending.value||previewError.value||signature(config.value)!==validGeometry)return ElMessage.warning('请先完成有效的计算域预览');if(props.options?.configuration_profile?.id!=='wrf-ordinary-ui-2')return ElMessage.error('工作台需要 wrf-ordinary-ui-2 服务能力，输入已保留');validating.value=true;const request=calculationRequest(config.value,props.options||{}),snapshot=JSON.stringify(request);try{const validated=await validateWrfTask(request);if(snapshot!==JSON.stringify(calculationRequest(config.value,props.options||{})))throw new Error('校验期间配置已变化，请再次开始模拟');emit('submit',validated.request);}catch(e){emit('error',e.message);ElMessage.error(e.message);}finally{validating.value=false;}}
defineExpose({currentRequest:()=>calculationRequest(config.value,props.options||{})});
onBeforeUnmount(()=>{cancelPreview();invalidateCheck();});
</script>
<style scoped>.config-host{display:flex;flex-direction:column;height:100%;min-height:0}.config-host>wrf-config-editor{flex:1;min-height:0}.capability-note{margin:0;padding:11px 20px;background:#fff9e9;color:#8b681d;font-size:12px;border-bottom:1px solid #eee3c6}.configuration-assessment{flex:none;padding:8px 16px;max-height:145px;overflow:auto;background:var(--el-bg-color,#101b29);font-size:12px;border-top:1px solid #34465c}.configuration-assessment p{margin:4px 0}.configuration-conflict{color:#ff9999}</style>
