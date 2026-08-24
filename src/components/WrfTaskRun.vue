<template>
  <section class="task-run">
    <header class="run-head">
      <div><span>WRF TASK · ATTEMPT {{ task?.attempt_no || 1 }}</span><h2>{{ task?.id || '任务运行详情' }}</h2></div>
      <span v-if="task" :class="['status', task.status]">{{ statusLabel(task.status) }}</span>
    </header>
    <div v-if="!task" class="run-empty">请选择右侧正在运行或历史任务</div>
    <template v-else>
      <div class="progress-card">
        <div><span>{{ stageLabel(task.stage) }}</span><b>{{ task.progress || 0 }}%</b></div>
        <el-progress :percentage="task.progress || 0" :stroke-width="8" :show-text="false" />
        <div class="stage-flow">
          <span v-for="stage in stages" :key="stage.key" :class="stageClass(stage.min)"><i></i>{{ stage.label }}</span>
        </div>
      </div>
      <div class="run-grid">
        <section class="summary-card">
          <h3>任务参数</h3>
          <dl>
            <div><dt>模拟时段</dt><dd>{{ formatTime(task.request?.start_time) }}<br />{{ formatTime(task.request?.end_time) }}</dd></div>
            <div><dt>中心点</dt><dd>{{ task.request?.center?.lat }}, {{ task.request?.center?.lon }}</dd></div>
            <div><dt>嵌套域</dt><dd>{{ task.request?.domains?.length || 0 }} 层</dd></div>
            <div><dt>GFS Cycle</dt><dd>{{ task.runtime?.gfs_cycle || '待选择' }}</dd></div>
            <div><dt>数据进度</dt><dd>{{ task.runtime?.gfs_remote_reused || 0 }}/{{ task.runtime?.gfs_total || 0 }} 超算数据池就绪<br v-if="transferSummary" /><span v-if="transferSummary">{{ transferSummary }}</span></dd></div>
            <div><dt>物理方案</dt><dd>{{ task.request?.physics?.preset || '默认通用' }}</dd></div>
            <div><dt>Spin-up</dt><dd>{{ task.runtime?.spinup_hours ?? task.request?.spinup?.hours ?? 0 }} 小时<br />模型起报 {{ formatTime(task.runtime?.model_start_time) }}</dd></div>
          </dl>
          <p v-if="task.error" class="error">{{ task.error }}</p>
          <div v-if="task.failure" class="failure-guide">
            <b>{{ failureLabel(task.failure.failure_class) }}</b>
            <span>{{ failureAdvice(task.failure) }}</span>
          </div>
          <div class="actions">
            <el-button @click="emit('back')">返回可视化</el-button>
            <el-button v-if="canCancel" type="danger" plain @click="emit('cancel')">{{ task.status === 'cancel_pending' ? '重试取消' : '取消任务' }}</el-button>
            <el-button v-if="canRetryOutputs" type="primary" plain @click="emit('retry-outputs')">仅重试结果下载</el-button>
            <el-button v-if="canRenderPartial" type="warning" plain @click="emit('render-partial')">忽略坏帧并部分渲染</el-button>
            <el-button v-if="canResume" type="primary" @click="emit('resume')">认证并继续任务</el-button>
            <el-button v-if="canEditRestart" @click="emit('edit-restart')">调整参数并重新运行</el-button>
            <el-button v-if="['succeeded','partial_success'].includes(task.status)" type="primary" @click="emit('result')">查看结果</el-button>
          </div>
          <div v-if="attemptItems.length > 1" class="attempts">
            <b>运行尝试</b>
            <button
              v-for="item in attemptItems"
              :key="item.attempt_no"
              type="button"
              :class="{ active: Number(logAttemptNo || task.attempt_no) === Number(item.attempt_no) }"
              @click="emit('attempt-change', item.attempt_no)"
            >第 {{ item.attempt_no }} 次 · {{ statusLabel(item.status) }}</button>
          </div>
        </section>
        <section class="terminal-card">
          <div class="terminal-head">
            <div><i></i><span>service.log</span></div>
            <button type="button" :class="{ paused: !followingLatest }" @click="scrollToLatest(true)">
              {{ followingLatest ? '跟随最新' : pendingLogUpdate ? '有新日志 · 回到底部' : '已暂停 · 回到底部' }}
            </button>
          </div>
          <pre ref="logPanel" @scroll="handleLogScroll">{{ logs || '等待任务日志…' }}</pre>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
const props = defineProps({
  task: Object,
  logs: { type: String, default: "" },
  logAttemptNo: Number,
});
const emit = defineEmits(["cancel", "resume", "edit-restart", "retry-outputs", "render-partial", "attempt-change", "result", "back"]);
const logPanel = ref(null);
const followingLatest = ref(true);
const pendingLogUpdate = ref(false);
const transferSummary = computed(() => {
  const transfer = props.task?.runtime?.hpc_transfer;
  if (!transfer?.mode || transfer.mode === "pending" || transfer.state === "idle") return "";
  const mode = ({ sftp: "SFTP", pty: "PTY", pty_fallback: "PTY 回退", pty_retry: "PTY 重试", pty_resumed: "PTY 续传", scp: "SCP" })[transfer.mode] || transfer.mode;
  const legacyFallbackSucceeded = !transfer.state && transfer.mode === "pty_fallback" && props.task?.runtime?.remote_pid && Number(props.task?.progress || 0) >= 68;
  const transferState = legacyFallbackSucceeded ? "succeeded" : transfer.state;
  const state = ({ running: "进行中", succeeded: "成功", failed: "失败" })[transferState] || "";
  const message = legacyFallbackSucceeded ? "原生 SFTP 不可用，PTY 回退传输成功" : (transfer.message || "");
  return `任务配置传输：${mode}${state ? `（${state}）` : ""} · ${message}`;
});
const stages = [
  { key: "queue", label: "排队", min: 0 }, { key: "gfs", label: "GFS 数据", min: 5 },
  { key: "prepare", label: "准备超算", min: 40 }, { key: "wrf", label: "WPS / WRF", min: 68 },
  { key: "render", label: "结果渲染", min: 88 }, { key: "done", label: "完成", min: 100 },
];
const canCancel = computed(() => props.task && !["succeeded", "partial_success", "failed", "cancelled"].includes(props.task.status));
const canResume = computed(() => props.task?.status === "paused_external" || (
  props.task?.status === "failed" && props.task?.failure?.failure_class === "external"
));
const canEditRestart = computed(() => ["waiting_restart", "cancelled"].includes(props.task?.status) || (
  props.task?.status === "failed" && !props.task?.runtime?.remote_wrf_succeeded && props.task?.failure?.failure_class !== "external"
));
const canRetryOutputs = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && props.task?.runtime?.gfs_cycle);
const canRenderPartial = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && (
  Boolean(props.task?.runtime?.output_validation?.invalid?.length) || /netcdf|hdf|wrfout|unknown file format/i.test(props.task?.error || "")
));
const attemptItems = computed(() => [
  { attempt_no: Number(props.task?.attempt_no || 1), status: props.task?.status || "queued" },
  ...(props.task?.attempts || []),
].sort((a, b) => Number(b.attempt_no) - Number(a.attempt_no)));
function statusLabel(value) { return ({ queued: "排队中", prefetching: "准备数据", uploading: "准备超算", running: "运行中", rendering: "渲染中", succeeded: "已完成", partial_success: "部分完成", failed: "失败", waiting_restart: "待调整", paused_external: "等待认证", cancelled: "已取消", cancel_pending: "取消中", reconciling: "对账中" })[value] || value; }
function stageLabel(value) { return ({ queued: "等待并行执行名额", retrying_outputs: "等待恢复结果下载", retrying_partial_render: "等待部分结果渲染", checking_remote_outputs: "确认远端 WRF 结果", selecting_cycle: "选择 GFS 00Z 周期", waiting_for_gfs_cache: "等待超算 GFS 数据", checking_hpc_gfs: "校验超算 GFS 数据池", waiting_for_hpc_gfs: "等待超算 GFS 补齐", remote_gfs_ready: "超算 GFS 已就绪", preparing_hpc: "提交任务配置", running: "WPS / WRF 运行中", reconciling: "正在恢复超算连接", paused_external: "等待重新认证超算", cancel_pending: "正在取消远端进程", cancelled: "任务已取消", downloading_outputs: "拉取 wrfout 结果", rendering: "生成 WebP", done: "任务完成", failed: "本次尝试已停止" })[value] || value || "等待开始"; }
function failureLabel(value) { return ({ external: "外部连接故障", configuration: "参数配置失败", model: "WPS / WRF 运行失败", data: "驱动数据异常", output: "结果恢复失败" })[value] || "任务异常"; }
function failureAdvice(value) { return ({ resume: "不会清理远端计算；认证后从原阶段继续。", edit_and_restart: "返回配置页调整参数，确认任务专属路径后重新运行。", restart: "确认驱动数据和参数后，在原任务中重新运行。", retry_outputs: "远端计算结果将保留，只恢复下载与渲染。" })[value?.recommended_action] || "请根据日志确认后续操作。"; }
function stageClass(min) { return { done: Number(props.task?.progress || 0) >= min, active: Number(props.task?.progress || 0) >= min && Number(props.task?.progress || 0) < (stages.find(item => item.min > min)?.min || 101) }; }
function formatTime(value) { return String(value || "—").replace("T", " ").replace("Z", " UTC"); }
function scrollToLatest(resume = false) {
  if (resume) {
    followingLatest.value = true;
    pendingLogUpdate.value = false;
  }
  nextTick(() => {
    const element = logPanel.value;
    if (element && followingLatest.value) element.scrollTop = element.scrollHeight;
  });
}
function handleLogScroll() {
  const element = logPanel.value;
  if (!element) return;
  followingLatest.value = element.scrollHeight - element.scrollTop - element.clientHeight < 36;
  if (followingLatest.value) pendingLogUpdate.value = false;
}
watch(() => props.logs, () => {
  if (followingLatest.value) scrollToLatest();
  else pendingLogUpdate.value = true;
}, { immediate: true });
watch(() => props.task?.id, () => scrollToLatest(true));
</script>

<style scoped>
.task-run { min-height: 100%; padding: 20px; color: var(--text); font-size: 13px; }.run-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--border); }.run-head span:first-child { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: 1.4px; }.run-head h2 { margin: 4px 0 0; font: 17px "SFMono-Regular", Consolas, monospace; }.status { padding: 5px 10px; border-radius: 12px; color: #60a5fa; background: #3b82f620; font-size: 11px; }.status.succeeded { color: #22c55e; background: #22c55e20; }.status.failed, .status.waiting_restart, .status.cancelled { color: #f87171; background: #ef444420; }.status.paused_external { color: #f59e0b; background: #f59e0b20; }
.run-empty { min-height: 520px; display: grid; place-items: center; color: var(--muted); }.progress-card, .summary-card, .terminal-card { border: 1px solid var(--border); border-radius: 13px; background: var(--field); }.progress-card { margin: 16px 0; padding: 16px; }.progress-card > div:first-child { display: flex; justify-content: space-between; margin-bottom: 9px; }.progress-card span { color: var(--muted); font-size: 11px; }.progress-card b { color: var(--accent); font-size: 19px; }.stage-flow { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; margin-top: 14px; }.stage-flow span { display: flex; align-items: center; gap: 6px; }.stage-flow i { width: 7px; height: 7px; border-radius: 50%; background: #475569; }.stage-flow span.done { color: var(--text); }.stage-flow span.done i { background: #22c55e; }.stage-flow span.active i { background: var(--accent); box-shadow: 0 0 8px var(--accent); }.status.partial_success { color: #f59e0b; background: #f59e0b20; }
.run-grid { display: grid; grid-template-columns: minmax(300px, .7fr) minmax(440px, 1.3fr); gap: 14px; }.summary-card { padding: 15px; }.summary-card h3 { margin: 0 0 12px; font-size: 14px; }dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }dl div { padding: 9px; border-radius: 8px; background: var(--glass); }dt { color: var(--muted); font-size: 11px; }dd { margin: 4px 0 0; font-size: 12px; line-height: 1.5; }.error { padding: 9px; border-radius: 8px; color: #f87171; background: #ef444418; font-size: 11px; }.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
.failure-guide { display: grid; gap: 3px; margin-top: 8px; padding: 9px; border: 1px solid #f59e0b55; border-radius: 8px; background: #f59e0b12; }.failure-guide b { color: #f59e0b; font-size: 11px; }.failure-guide span { color: var(--muted); font-size: 10px; line-height: 1.45; }.attempts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }.attempts > b { width: 100%; font-size: 11px; }.attempts button { padding: 4px 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--glass); color: var(--muted); font-family: inherit; font-size: 10px; cursor: pointer; }.attempts button.active { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.terminal-card { min-height: 410px; overflow: hidden; background: #050914; }.terminal-head { display: flex; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 11px; }.terminal-head div { display: flex; align-items: center; gap: 7px; }.terminal-head i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.terminal-head button { padding: 0; border: 0; background: transparent; color: #94a3b8; font: inherit; cursor: pointer; }.terminal-head button:hover { color: var(--accent); }.terminal-head button.paused { color: #f59e0b; }.terminal-card pre { max-height: 470px; margin: 0; padding: 14px; overflow: auto; color: #cbd5e1; font: 11px/1.6 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
@media (max-width: 980px) { .run-grid { grid-template-columns: 1fr; }.stage-flow { grid-template-columns: repeat(3, 1fr); } }
</style>
