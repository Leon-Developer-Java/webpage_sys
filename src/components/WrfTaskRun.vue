<template>
  <section class="task-run">
    <header class="run-head">
      <div><span>WRF TASK</span><h2>{{ task?.id || '任务运行详情' }}</h2></div>
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
          <div class="actions">
            <el-button @click="emit('back')">返回可视化</el-button>
            <el-button v-if="canCancel" type="danger" plain @click="emit('cancel')">{{ task.status === 'cancel_pending' ? '重试取消' : '取消任务' }}</el-button>
            <el-button v-if="canRetryOutputs" type="primary" plain @click="emit('retry-outputs')">仅重试结果下载</el-button>
            <el-button v-if="canRenderPartial" type="warning" plain @click="emit('render-partial')">忽略坏帧并部分渲染</el-button>
            <el-button v-if="canRetry" @click="emit('retry')">按原参数重试</el-button>
            <el-button v-if="['succeeded','partial_success'].includes(task.status)" type="primary" @click="emit('result')">查看结果</el-button>
          </div>
        </section>
        <section class="terminal-card">
          <div class="terminal-head"><div><i></i><span>service.log</span></div><small>自动刷新</small></div>
          <pre>{{ logs || '等待任务日志…' }}</pre>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
const props = defineProps({ task: Object, logs: { type: String, default: "" } });
const emit = defineEmits(["cancel", "retry", "retry-outputs", "render-partial", "result", "back"]);
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
const canRetry = computed(() => ["failed", "cancelled"].includes(props.task?.status));
const canRetryOutputs = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && props.task?.runtime?.gfs_cycle);
const canRenderPartial = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && (
  Boolean(props.task?.runtime?.output_validation?.invalid?.length) || /netcdf|hdf|wrfout|unknown file format/i.test(props.task?.error || "")
));
function statusLabel(value) { return ({ queued: "排队中", prefetching: "准备数据", uploading: "准备超算", running: "运行中", rendering: "渲染中", succeeded: "已完成", partial_success: "部分完成", failed: "失败", cancelled: "已取消", cancel_pending: "取消中", reconciling: "对账中" })[value] || value; }
function stageLabel(value) { return ({ queued: "等待并行执行名额", retrying_outputs: "等待恢复结果下载", retrying_partial_render: "等待部分结果渲染", checking_remote_outputs: "确认远端 WRF 结果", selecting_cycle: "选择 GFS 00Z 周期", waiting_for_gfs_cache: "等待超算 GFS 数据", checking_hpc_gfs: "校验超算 GFS 数据池", waiting_for_hpc_gfs: "等待超算 GFS 补齐", remote_gfs_ready: "超算 GFS 已就绪", preparing_hpc: "提交任务配置", running: "WPS / WRF 运行中", cancel_pending: "正在取消远端进程", cancelled: "任务已取消", downloading_outputs: "拉取 wrfout 结果", rendering: "生成 WebP", done: "任务完成" })[value] || value || "等待开始"; }
function stageClass(min) { return { done: Number(props.task?.progress || 0) >= min, active: Number(props.task?.progress || 0) >= min && Number(props.task?.progress || 0) < (stages.find(item => item.min > min)?.min || 101) }; }
function formatTime(value) { return String(value || "—").replace("T", " ").replace("Z", " UTC"); }
</script>

<style scoped>
.task-run { min-height: 100%; padding: 20px; color: var(--text); }.run-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--border); }.run-head span:first-child { color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: 1.4px; }.run-head h2 { margin: 4px 0 0; font: 17px "SFMono-Regular", Consolas, monospace; }.status { padding: 5px 10px; border-radius: 12px; color: #60a5fa; background: #3b82f620; font-size: 10px; }.status.succeeded { color: #22c55e; background: #22c55e20; }.status.failed, .status.cancelled { color: #f87171; background: #ef444420; }
.run-empty { min-height: 520px; display: grid; place-items: center; color: var(--muted); }.progress-card, .summary-card, .terminal-card { border: 1px solid var(--border); border-radius: 13px; background: var(--field); }.progress-card { margin: 16px 0; padding: 16px; }.progress-card > div:first-child { display: flex; justify-content: space-between; margin-bottom: 9px; }.progress-card span { color: var(--muted); font-size: 11px; }.progress-card b { color: var(--accent); font-size: 19px; }.stage-flow { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; margin-top: 14px; }.stage-flow span { display: flex; align-items: center; gap: 6px; }.stage-flow i { width: 7px; height: 7px; border-radius: 50%; background: #475569; }.stage-flow span.done { color: var(--text); }.stage-flow span.done i { background: #22c55e; }.stage-flow span.active i { background: var(--accent); box-shadow: 0 0 8px var(--accent); }.status.partial_success { color: #f59e0b; background: #f59e0b20; }
.run-grid { display: grid; grid-template-columns: minmax(300px, .7fr) minmax(440px, 1.3fr); gap: 14px; }.summary-card { padding: 15px; }.summary-card h3 { margin: 0 0 12px; font-size: 13px; }dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }dl div { padding: 9px; border-radius: 8px; background: var(--glass); }dt { color: var(--muted); font-size: 9px; }dd { margin: 4px 0 0; font-size: 10px; line-height: 1.5; }.error { padding: 9px; border-radius: 8px; color: #f87171; background: #ef444418; font-size: 10px; }.actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
.terminal-card { min-height: 410px; overflow: hidden; background: #050914; }.terminal-head { display: flex; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 10px; }.terminal-head div { display: flex; align-items: center; gap: 7px; }.terminal-head i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.terminal-card pre { max-height: 470px; margin: 0; padding: 14px; overflow: auto; color: #cbd5e1; font: 10px/1.6 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
@media (max-width: 980px) { .run-grid { grid-template-columns: 1fr; }.stage-flow { grid-template-columns: repeat(3, 1fr); } }
</style>
