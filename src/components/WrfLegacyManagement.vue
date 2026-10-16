<template>
  <el-dialog v-model="visible" :title="title" width="min(640px, calc(100vw - 24px))" append-to-body class="wrf-legacy-dialog" @closed="invalidate">
    <p class="task-id">{{ target?.id }}</p>
    <p v-if="busy" role="status">{{ deletion ? phaseLabel(deletion.phase) : '正在核验' }} · {{ Math.floor(deletion?.elapsed_seconds||0) }} 秒</p>
    <p v-if="deletion">操作编号：{{ deletion.id }}</p><el-button v-if="deletion && !busy && ['checking','executing'].includes(deletion.status)" @click="resumePolling">查询原操作状态</el-button>
    <p v-if="deletion?.error" role="alert">{{ deletion.error.message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="mode==='publish'">
      <p>重试登记已有完整结果，不重新下载、渲染或计算。</p>
      <el-button :disabled="busy" type="primary" @click="executePublish">确认重试发布</el-button>
    </template>
    <template v-if="recovery">
      <p>{{ recovery.impact }}</p>
      <p v-if="Object.keys(recovery.changes||{}).length">修改字段：{{ Object.keys(recovery.changes).join('、') }}</p>
      <details v-if="recovery.paths"><summary>精确处理范围</summary><p>旧尝试的参数、状态和日志留档；共享资料及独立远端尝试保留。</p><ul><li v-for="path in [...(recovery.paths.local_paths||[]),...(recovery.paths.remote_paths||[])]" :key="path">{{ path }}</li></ul></details>
      <p>有效期至 {{ new Date(recovery.expires_at*1000).toLocaleString() }}</p>
      <el-button :disabled="busy||recovery.status!=='pending'" type="primary" @click="executeRecovery">确认{{ labels[recovery.action] }}</el-button>
    </template>
    <template v-if="deletion?.summary">
      <p>{{ deletion.summary.files }} 个文件 · {{ formatBytes(deletion.summary.bytes) }} · 正式产品 {{ deletion.summary.published_assets }} 项。删除不可恢复。</p>
      <p>保留：{{ deletion.summary.protected.join('、') }}</p>
      <details><summary>精确删除清单</summary><ul><li v-for="item in [...deletion.local,...deletion.remote]" :key="item.path">{{ item.path }} · {{ item.files }} 文件 · {{ formatBytes(item.bytes) }}</li></ul></details>
      <el-button v-if="deletion.status==='pending' && !deletion.execution_requested" :disabled="busy" type="danger" @click="executeDelete">确认按此清单彻底删除</el-button>
      <el-button v-if="deletion.status==='unknown'" :disabled="busy" @click="reconcileDelete">核验并继续删除事务</el-button>
    </template>
    <template v-if="mode==='forcing'">
      <p>按时次补齐，不触发资料清理。取消仅释放本请求引用；其他任务、预取及在途下载不受影响。</p>
      <form class="forcing-form" @submit.prevent="downloadRange">
        <label>资料源<select v-model="downloadSource"><option value="gfs">GFS</option><option value="ecmwf">ECMWF</option></select></label>
        <label>00 UTC 周期<input v-model="downloadCycle" pattern="[0-9]{8}00" required aria-label="下载周期" /></label>
        <label>起始时次<input v-model.number="downloadFirst" type="number" min="0" max="72" :step="downloadSource==='gfs'?1:3" required /></label>
        <label>结束时次<input v-model.number="downloadLast" type="number" min="0" max="72" :step="downloadSource==='gfs'?1:3" required /></label>
        <el-button native-type="submit" :disabled="busy">补齐指定时次</el-button><el-button :disabled="busy" @click="refreshDownloads">刷新请求</el-button>
      </form>
      <article v-for="item in downloads" :key="item.id" class="download-operation">
        <b>{{ item.source.toUpperCase() }} · {{ item.cycle }} · f{{ item.start_hour }}–f{{ item.end_hour }}</b><p>{{ downloadLabel(item.status) }} · {{ item.observation?.message||item.detail?.message||'完整周期与本请求所需时次分别核验' }}</p>
        <p v-if="item.observation">已齐 {{ item.observation.valid_hours?.length||0 }} / {{ item.detail?.hours?.length || 0 }} · {{ item.observation.last_error||'' }}</p>
        <el-button :disabled="busy" @click="inspectDownload(item)">核验进度与缺口</el-button>
        <el-button v-if="['accepted','unknown','cancel_unknown','cancel_pending'].includes(item.status)" :disabled="busy" @click="cancelDownload(item)">取消本请求</el-button>
      </article>
    </template>
    <template v-if="cleanupPlan">
      <p v-if="cleanupPlan.status!=='pending'" role="status">{{cleanupPlan.removed ? (cleanupPlan.status==='complete'?'已移除 · 空间清理完成':'已移除 · 空间清理中') : cleanupPlan.status==='checking'?'排队移除目录':'移除处理中'}}</p>
      <p v-if="cleanupPlan.retention_upgrade">确认后启用每源保留最新两个完整周期的自动清理；可靠终止的失败任务将按需重新下载。活动、未知身份和下载引用继续保护。</p><p>以下 {{ cleanupPlan.candidates.length }} 个周期的清理计划；有引用、下载活动或清单变化将阻断。</p>
      <ul><li v-for="item in cleanupPlan.candidates" :key="item.path">{{ (item.remote_path||item.path) }} · {{ item.file_count??'未记录' }} 文件 · {{ formatBytes(item.size_bytes ?? item.bytes) }}</li></ul>
      <el-button :disabled="busy||cleanupPlan.status!=='pending'||(!cleanupPlan.candidates.length && !cleanupPlan.retention_upgrade)" type="danger" @click="executeCleanup">确认按此清单清理</el-button>
    </template>
    <template #footer><el-button @click="close">{{ mode==='operation'?'暂不执行':'关闭' }}</el-button></template>
  </el-dialog>
</template>
<script setup>
// Compatibility UI only; all execution remains in the existing WRF service.
import {ref,onBeforeUnmount} from 'vue';
import {getUser,getWrfTask,planWrfTaskRecovery,executeWrfTaskRecovery,publishWrfTask,createWrfTaskDeletionPlan,executeWrfTaskDeletion,reconcileWrfTaskDeletion,previewWrfForcingCleanup,cleanupWrfForcing,getWrfTaskDeletionPlan,getWrfForcingCleanupPlan,listWrfForcingDownloads,getWrfForcingDownload,submitWrfForcingDownload,cancelWrfForcingDownload} from '../api.js';
import {deleteWrfTaskDirect} from '../api.js';
import {safeError} from '../utils/wrfFailure.js';
const emit=defineEmits(['completed','deletion-status']);
const visible=ref(false),title=ref('任务管理'),target=ref(null),mode=ref('task'),busy=ref(false),error=ref(''),recovery=ref(null),deletion=ref(null),cleanupPlan=ref(null);
const labels={resume:'恢复连接并核验状态',retry_outputs:'重试结果处理',render_partial:'部分渲染',restart:'再次启动模拟',publish:'重试发布'};
let sequence=0,owner='';
const actor=()=>String(getUser()?.uuid||getUser()?.id||'unknown');
const current=call=>visible.value&&call===sequence&&owner===actor();
const formatBytes=value=>Number.isFinite(Number(value))?(Number(value)/1024/1024).toFixed(2)+' MB':'大小待核验';
function invalidate(){sequence++;busy.value=false;clearInterval(downloadTimer);}
function close(){visible.value=false;invalidate();}
function begin(name,kind,task){sequence++;owner=actor();title.value=name;mode.value=kind;target.value=task;error.value='';recovery.value=null;deletion.value=null;cleanupPlan.value=null;visible.value=true;return sequence;}
async function operate(action,task,request){
  if(!task||busy.value)return;
  const call=begin(labels[action]||action,'operation',task);busy.value=true;
  try{
    const fresh=await getWrfTask(task.id);if(!current(call))return;
    if(task.attempt_no!=null&&fresh.attempt_no!==task.attempt_no)throw new Error('尝试已变化，请重新选择任务。');
    target.value=fresh;
    if(action==='publish'){mode.value='publish';return;}
    const plan=await planWrfTaskRecovery(task.id,null,action,request,'manual');if(current(call))recovery.value=plan;
  }catch(e){if(current(call)&&e!=='cancel'&&e!=='close')error.value=safeError(e.message);}finally{if(call===sequence)busy.value=false;}
}
async function executePublish(){
 const call=sequence,task=target.value;if(busy.value||mode.value!=='publish'||!task)return;busy.value=true;
 try {await publishWrfTask(task.id);if(!current(call))return;const updated=await getWrfTask(task.id);if(current(call)){close();emit('completed',updated);}}
 catch(e){if(current(call)){mode.value='publish_unknown';error.value=safeError(e.message)+'；请刷新任务核验发布状态。';}}
 finally{if(call===sequence)busy.value=false;}
}
async function executeRecovery(){
  const plan=recovery.value;if(!plan||busy.value||plan.status!=='pending')return;
  const call=sequence;busy.value=true;
  try{const result=await executeWrfTaskRecovery(plan.task_id,plan.id);if(!current(call))return;
    recovery.value={...plan,status:result.status};
    if(result.status==='accepted'){const task=await getWrfTask(plan.task_id);if(current(call)){close();emit('completed',task);}}
    else error.value='操作结果待对账，禁止重复执行。';
  }catch(e){if(current(call)){recovery.value={...plan,status:'unknown'};error.value=safeError(e.message)+'；请核验原操作状态，不要重复提交。';}}finally{if(call===sequence)busy.value=false;}
}
const phaseLabel=phase=>({checking_state:'核验计算状态',inventory_assets:'统计专属资产',checking_references:'检查发布引用',preview:'清单已就绪',checking_execution:'复核执行条件',catalog_revoked:'登记已撤销',access_denied:'访问已失效',remote_deleted:'远端资产已删除',local_deleted:'本地资产已删除',complete:'删除完成',interrupted:'操作已中断，未自动重放'})[phase]||'删除处理中';
const tracked=new Map();
let stopped=false;
const trackingKey=()=>`wrf:deletions:${actor()}`;
function saveTracking(){sessionStorage.setItem(trackingKey(),JSON.stringify([...tracked.values()].filter(x=>x.owner===actor()).map(({task_id,id})=>({task_id,id}))));}
function observe(plan){
 emit('deletion-status',plan);
 if(visible.value&&target.value?.id===plan.task_id){deletion.value=plan;busy.value=plan.status==='checking'||plan.status==='executing'||(plan.status==='pending'&&plan.execution_requested);}
}
function track(plan){
 const old=tracked.get(plan.id);if(old)clearTimeout(old.timer);tracked.delete(plan.id);
 const entry={...plan,owner:actor(),timer:null,failures:0};tracked.set(plan.id,entry);saveTracking();observe(plan);
 const poll=async()=>{if(stopped||entry.owner!==actor())return;let failed=false;try{
  const state=await getWrfTaskDeletionPlan(entry.task_id,entry.id);entry.failures=0;if(stopped||entry.owner!==actor())return;Object.assign(entry,state);observe(state);
  if(['complete','blocked','unknown'].includes(state.status)||(state.status==='pending'&&!state.execution_requested&&!state.delete_now)){if(state.status!=='unknown')tracked.delete(entry.id);saveTracking();if(state.status==='complete')emit('completed');return;}
 }catch(e){failed=true;if(stopped||entry.owner!==actor())return;if(e.status===401||e.status===403){tracked.delete(entry.id);saveTracking();emit('deletion-status',{...entry,status:'blocked',error:{message:safeError(e.message)}});if(visible.value&&target.value?.id===entry.task_id){busy.value=false;error.value=safeError(e.message);}return;}}
 if(failed && ++entry.failures>=4){emit('deletion-status',{...entry,status:'unknown',error:{message:'删除状态暂不可用，正在后台重连。'}});}entry.timer=setTimeout(poll,failed?15000:1500);
 };entry.timer=setTimeout(poll,500);
}
function resumePolling(){const plan=deletion.value;if(!plan)return;tracked.delete(plan.id);track(plan);busy.value=true;error.value='';}
async function remove(task){
 const operationOwner=actor();
 if([...tracked.values()].some(item=>item.task_id===task.id&&item.owner===operationOwner))return;
 emit('deletion-status',{task_id:task.id,status:'submitting'});
 try{const plan=await deleteWrfTaskDirect(task.id);if(operationOwner!==actor())return;track(plan);}
 catch(e){if(operationOwner===actor())emit('deletion-status',{task_id:task.id,status:'blocked',error:{message:safeError(e.message)}});}
}

async function deleteAction(reconcile=false){
 const plan=deletion.value;if(!plan||busy.value)return;const call=sequence;busy.value=true;
 try{const state=reconcile?await reconcileWrfTaskDeletion(plan.task_id,plan.id):await executeWrfTaskDeletion(plan.task_id,plan.id,plan.digest,true);if(owner!==actor())return;track(state);if(current(call))observe(state);}
 catch(e){if(current(call)){busy.value=false;error.value=safeError(e.message)+'；查询原操作状态，不重复执行。';deletion.value={...plan,status:'unknown'};}track({...plan,status:'unknown'});}
}
const executeDelete=()=>deleteAction(false),reconcileDelete=()=>deleteAction(true);
try{for(const plan of JSON.parse(sessionStorage.getItem(trackingKey())||'[]'))track(plan);}catch{/* Invalid tracking data never triggers execution. */}
onBeforeUnmount(()=>{stopped=true;clearInterval(downloadTimer);for(const entry of tracked.values())clearTimeout(entry.timer);});
async function cleanup(source){if(busy.value)return;const call=begin('两周期保留与精确清理确认','cleanup',null);busy.value=true;try{const plan=await previewWrfForcingCleanup(source,true);if(current(call))cleanupPlan.value=plan;}catch(e){if(current(call))error.value=safeError(e.message);}finally{if(call===sequence)busy.value=false;}}
async function executeCleanup(){const plan=cleanupPlan.value;if(!plan||busy.value||plan.status!=='pending')return;const call=sequence;busy.value=true;try{let result=await cleanupWrfForcing(plan.id,plan.digest);while(current(call)&&['checking','executing'].includes(result.status)){cleanupPlan.value=result;await new Promise(resolve=>setTimeout(resolve,1500));if(!current(call))return;result=await getWrfForcingCleanupPlan(plan.id);}if(current(call)){cleanupPlan.value=result;if(result.status==='complete'){close();emit('completed');}else error.value=result.error?.message||'清理状态待确认，未重放操作。';}}catch(e){if(current(call)){error.value=safeError(e.message);try{const state=await getWrfForcingCleanupPlan(plan.id);if(current(call))cleanupPlan.value=state;}catch{if(current(call))cleanupPlan.value={...plan,status:'unknown'};}}}finally{if(call===sequence)busy.value=false;}}
const downloads=ref([]),downloadSource=ref('gfs'),downloadCycle=ref(new Date().toISOString().slice(0,10).replaceAll('-','')+'00'),downloadFirst=ref(0),downloadLast=ref(72);
let downloadTimer=null,downloadRequest=null;
const downloadLabel=status=>({accepted:'已入队',submitting:'提交待对账',unknown:'状态待核验',ready:'所需时次已齐',cancelled:'本请求已取消',cancel_pending:'正在释放引用',cancel_unknown:'引用释放待核验'})[status]||status;
async function refreshDownloads(){const call=sequence;try{const result=await listWrfForcingDownloads();if(current(call)&&mode.value==='forcing')downloads.value=(result.items||[]).map(item=>({...item,observation:downloads.value.find(old=>old.id===item.id)?.observation}));}catch(e){if(current(call))error.value=safeError(e.message);}}
function forcing(source){begin('资料下载与补缺','forcing',null);downloadSource.value=source;downloads.value=[];refreshDownloads();clearInterval(downloadTimer);downloadTimer=setInterval(()=>{if(!document.hidden&&visible.value&&mode.value==='forcing')refreshDownloads();},30000);}
async function downloadRange(){
 if(busy.value)return;const call=sequence;busy.value=true;error.value='';
 const scope=JSON.stringify([downloadSource.value,downloadCycle.value,downloadFirst.value,downloadLast.value]);
 if(!downloadRequest||downloadRequest.scope!==scope)downloadRequest={scope,key:crypto.randomUUID()};
 try{const result=await submitWrfForcingDownload(downloadSource.value,downloadCycle.value,downloadFirst.value,downloadLast.value,downloadRequest.key);if(current(call)){downloadRequest.id=result.id;if(['ready','cancelled'].includes(result.status))downloadRequest=null;await refreshDownloads();}}
 catch(e){if(current(call))error.value=safeError(e.message)+'；原幂等键已保留，重试不会重复入队。';}finally{if(current(call))busy.value=false;}
}
async function inspectDownload(item){const call=sequence;busy.value=true;try{const state=await getWrfForcingDownload(item.id);if(current(call))downloads.value=downloads.value.map(old=>old.id===item.id?state:old);}catch(e){if(current(call))error.value=safeError(e.message);}finally{if(current(call))busy.value=false;}}
async function cancelDownload(item){const call=sequence;busy.value=true;try{const state=await cancelWrfForcingDownload(item.id);if(current(call)){downloads.value=downloads.value.map(old=>old.id===item.id?state:old);if(state.status==='cancelled'&&downloadRequest?.id===item.id)downloadRequest=null;}}catch(e){if(current(call))error.value=safeError(e.message);}finally{if(current(call))busy.value=false;}}
defineExpose({operate,remove,cleanup,forcing,close});
</script>
<style>.wrf-legacy-dialog .el-dialog__body{max-height:calc(100dvh - 180px);overflow:auto;overflow-wrap:anywhere}.wrf-legacy-dialog .task-id{color:var(--muted);font-size:12px}.wrf-legacy-dialog .management-actions{display:flex;flex-wrap:wrap;gap:8px}</style>

<style>.wrf-legacy-dialog .forcing-form{display:flex;flex-wrap:wrap;gap:10px}.forcing-form label{display:grid;gap:4px}.forcing-form input,.forcing-form select{max-width:140px;padding:6px;background:var(--field);color:var(--text);border:1px solid var(--border);border-radius:5px}.download-operation{padding:10px 0;border-top:1px solid var(--border);margin-top:12px}</style>
