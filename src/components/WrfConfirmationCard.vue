<template>
  <section class="wrf-confirmation">
    <h4>WRF 完整配置确认</h4>
    <p>以下配置已通过服务端规则校验。确认将提交真实计算任务并消耗计算资源。</p>
    <p>确认有效期至 {{ new Date(event.expires_at * 1000).toLocaleString() }}。修改参数请重新生成确认卡。</p>
    <pre>{{ JSON.stringify(event.request, null, 2) }}</pre>
    <ul><li v-for="warning in event.warnings || []" :key="warning">{{ warning }}</li></ul>
    <div v-if="!task && !cancelled">
      <button :disabled="busy" @click="submit">{{ busy ? '处理中…' : '确认并创建 WRF 任务' }}</button>
      <button :disabled="busy" @click="cancel">取消本次确认</button>
    </div>
    <p v-if="cancelled">已取消，未创建任务。</p>
    <div v-if="task">
      <p>任务：{{ task.task_id }} · {{ status?.status || task.status }}</p>
      <p v-if="status">阶段：{{ status.stage }} · 进度 {{ status.progress }}%</p>
      <p v-if="status?.has_error">{{ status.message }}（{{ status.failure_class || '未分类' }}）</p>
      <p v-if="status?.quality_status">结果完整性：{{ status.quality_status }}；目录发布：{{ status.catalog_status || '未发布' }}</p>
      <p v-if="status?.domains?.length">已生成 {{ status.domains.length }} 个域的结果；计算完成不等于预报已经观测检验。</p>
      <RouterLink :to="`/wrf?view=run&task_id=${encodeURIComponent(task.task_id)}`">在 WRF 工作台查看</RouterLink>
      <button :disabled="refreshing" @click="refresh">刷新状态</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { submitAgentWrfTask, cancelAgentWrfConfirmation, getAgentWrfDiagnosis } from '../api';
const props = defineProps({ event: { type: Object, required: true } });
const emit = defineEmits(['update']);
const task = ref(props.event.task || null);
const cancelled = ref(Boolean(props.event.cancelled));
const status = ref(null);
const busy = ref(false);
const refreshing = ref(false);
const error = ref('');
let timer;
let disposed = false;
async function refresh() {
  if (!task.value || refreshing.value || disposed) return;
  clearTimeout(timer);
  refreshing.value = true;
  try {
    status.value = await getAgentWrfDiagnosis(task.value.task_id);
    error.value = '';
  } catch (cause) { error.value = cause.message || '状态查询失败'; }
  finally {
    refreshing.value = false;
    if (!disposed && !['succeeded', 'partial_success', 'failed', 'cancelled'].includes(status.value?.status)) {
      timer = setTimeout(refresh, 8000);
    }
  }
}
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    task.value = await submitAgentWrfTask(props.event.confirmation_id, props.event.session_id);
    emit('update', { task: task.value });
    await refresh();
  } catch (cause) { error.value = cause.message || '提交失败；请重试当前确认卡'; }
  finally { busy.value = false; }
}
async function cancel() {
  busy.value = true;
  error.value = '';
  try {
    await cancelAgentWrfConfirmation(props.event.confirmation_id, props.event.session_id);
    cancelled.value = true;
    emit('update', { cancelled: true });
  } catch (cause) { error.value = cause.message || '取消失败'; }
  finally { busy.value = false; }
}
onMounted(() => { if (task.value) refresh(); });
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); });
</script>

<style scoped>
.wrf-confirmation { margin: 12px 0; padding: 14px; border: 1px solid #64748b66; border-radius: 10px; }
h4 { margin: 0 0 8px; } p, li { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
pre { max-height: 360px; overflow: auto; padding: 10px; background: #64748b18; font-size: 11px; }
button { margin: 4px 8px 4px 0; padding: 6px 10px; cursor: pointer; } a { color: #60a5fa; }
[role=alert] { color: #ef4444; }
</style>
