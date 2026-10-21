<template>
  <details class="forcing-attempt-history" @toggle="onToggle">
    <summary>下载记录</summary>
    <p class="history-note">仅显示启用记录后的尝试；此前失败原因无法还原。</p>
    <button type="button" :disabled="loading" @click="load(false)">{{ loading ? '读取中…' : '更新记录' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!loading && !items.length">{{ supported ? '暂无已记录的下载尝试' : '下载工作器尚未支持尝试记录' }}</p>
    <div class="attempt-rows" aria-label="下载尝试记录">
      <article v-for="row in items" :key="row.id">
        <b>{{ row.file }} · 第 {{ row.attempt }} 次</b>
        <div>{{ statusLabel(row.status) }}<template v-if="row.cause"> · {{ causeLabel(row.cause) }}</template></div>
        <small v-if="row.origin === 'operator_pause_observation'">旧版在途请求的暂停观测；此前连接过程未记录。</small>
        <small>{{ row.started_at }}<template v-if="row.execution_seconds != null"> · 执行 {{ Number(row.execution_seconds).toFixed(1) }} 秒</template></small>
        <small v-if="row.bytes_after != null">续传：{{ row.bytes_before || 0 }} → {{ row.bytes_after }} 字节</small>
        <small v-if="row.http_status || row.curl_code">HTTP {{ row.http_status || '未收到响应' }} · curl {{ row.curl_code ?? '未执行' }}</small>
        <small v-if="row.next_retry_at">安排重试：{{ new Date(row.next_retry_at * 1000).toISOString() }}</small>
        <div v-for="request in row.requests.filter(r => r.cause || row.requests.length > 1)" :key="request.request" class="connection-attempt">
          连接 {{ request.request }}：{{ request.cause ? causeLabel(request.cause) : statusLabel(request.status) }}
          <small v-if="request.execution_seconds != null">{{ Number(request.execution_seconds).toFixed(1) }} 秒 · curl {{ request.curl_code ?? '未执行' }}</small>
        </div>
      </article>
    </div>
    <button v-if="nextCursor !== null" type="button" :disabled="loading" @click="load(true)">更早记录</button>
    <p v-if="damaged" role="status">部分记录写入未完成，已保留原始记录供核验。</p>
  </details>
</template>
<script setup>
import {ref, onBeforeUnmount} from 'vue';
import {getWrfForcingAttempts} from '../../api.js';
const props = defineProps({source: {type: String, required: true}, cycle: {type: String, required: true}});
const items=ref([]), nextCursor=ref(null), loading=ref(false), error=ref(''), supported=ref(true), damaged=ref(0);
let generation=0, controller=null, loaded=false;
const causes={low_speed_timeout:'低速超时',total_timeout:'达到单次总时限',connection_failure:'连接失败',rate_limited:'上游限流（HTTP 429）',timeout_unknown:'超时原因待确认',upstream_temporary:'上游临时故障',upstream_http_error:'上游 HTTP 错误',transfer_failure:'传输失败',command_failure:'下载命令未能执行',data_integrity:'资料完整性校验失败',operator_pause:'主动暂停交接（分片已保留）'};
function causeLabel(value){return causes[value] || '原因待核验';}
function statusLabel(value){return ({succeeded:'成功',failed:'失败',unfinished:'尚未记录结束',running:'下载中',interrupted:'中断或结果待确认'})[value] || '尚未记录结束';}
function onToggle(event){if(event.target.open && !loaded)load(false);}
async function load(older){
  const version=++generation;controller?.abort();controller=new AbortController();loading.value=true;error.value='';
  try{
    const data=await getWrfForcingAttempts(props.source,props.cycle,older?nextCursor.value:null,controller.signal);
    if(version!==generation)return;
    const combined=older?[...items.value,...data.items]:data.items;
    items.value=[...new Map(combined.map(row=>[row.id,row])).values()];nextCursor.value=data.next_cursor??null;
    supported.value=data.supported!==false;damaged.value=data.damaged_records||0;loaded=true;
  }catch(e){if(version===generation && e.name!=='AbortError')error.value='下载记录读取失败，请重试。';}
  finally{if(version===generation)loading.value=false;}
}
onBeforeUnmount(()=>{generation++;controller?.abort();});
</script>
<style scoped>
.forcing-attempt-history{margin-top:8px;font-size:11px;color:var(--text-secondary,#a8b6c9)}
summary{cursor:pointer;color:#69b5ff}.history-note{line-height:1.5}.attempt-rows{max-height:280px;overflow:auto}
.attempt-rows article{padding:8px 0!important;border:0!important;border-bottom:1px solid #334155!important;border-radius:0!important;background:none!important}
.attempt-rows b{overflow-wrap:anywhere;font-size:11px}.attempt-rows small{display:block;overflow-wrap:anywhere;line-height:1.5}
.connection-attempt{margin:5px 0 0 8px}button{background:#182c42;color:#8ac4ff;border:1px solid #34506b;border-radius:4px;padding:3px 6px;font-size:11px}
</style>
