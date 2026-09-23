<template>
  <section class="task-run">
    <header class="run-head">
      <div><span>{{ isDownscale ? 'HIGH-RESOLUTION DOWNSCALING' : `WRF TASK · ATTEMPT ${task?.attempt_no || 1}` }}</span><h2>{{ task?.id || '任务运行详情' }}</h2></div>
      <span v-if="task" :class="['status', task.status]">{{ statusLabel(task.status) }}</span>
    </header>
    <div v-if="!task" class="run-empty">请选择右侧正在运行或历史任务</div>
    <template v-else>
      <div class="progress-card">
        <div><span>{{ stageLabel(task.stage) }}</span><b>{{ task.progress || 0 }}%</b></div>
        <el-progress :percentage="task.progress || 0" :stroke-width="8" :show-text="false" />
        <div class="stage-flow" :style="{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }">
          <span v-for="stage in stages" :key="stage.key" :class="stageClass(stage.min)"><i></i>{{ stage.label }}</span>
        </div>
      </div>
      <div class="run-grid">
        <section class="summary-card">
          <h3>任务参数</h3>
          <dl v-if="isDownscale">
            <div><dt>中尺度 forcing</dt><dd>{{ formatTime(task.runtime?.mesoscale_window?.start_utc || task.request?.start_time) }} 起<br />{{ forcingDurationHours }} 小时 · {{ forcingDurationHours + 1 }} 个逐小时时次</dd></div>
            <div><dt>微尺度语义</dt><dd>{{ microscaleSummary }}<br v-if="!isForcingOnly" />{{ !isForcingOnly ? '非连续 1 m 预报' : '第一阶段仅生成 WRF forcing' }}</dd></div>
            <div v-if="!isForcingOnly"><dt>产品范围</dt><dd>{{ productFootprint }}<br />1 m 采样</dd></div>
            <div v-if="!isForcingOnly"><dt>CFD 外域</dt><dd>{{ task.runtime?.cfd_domain?.width_m || '—' }} m × {{ task.runtime?.cfd_domain?.height_m || '—' }} m<br />缓冲 {{ task.runtime?.cfd_domain?.buffer_m ?? '—' }} m</dd></div>
            <div v-if="!isForcingOnly"><dt>地表模型</dt><dd>{{ task.runtime?.surface?.mode === 'auto_flat' ? '理想化平坦地表' : (task.runtime?.terrain?.id || '审核真实地形') }}<br />{{ task.runtime?.surface?.geometry?.version || task.runtime?.terrain?.version || 'v1' }}</dd></div>
            <div><dt>质量 / 发布</dt><dd>{{ task.quality?.status || 'pending' }} / {{ task.publication?.status || 'blocked' }}</dd></div>
            <div><dt>认证状态</dt><dd>{{ task.certification?.status || 'research' }}<br />{{ task.certification?.profile_id || '待专家审核' }}</dd></div>
            <div v-if="!isForcingOnly"><dt>计算方案</dt><dd>{{ task.runtime?.parameterization?.label || task.request?.parameterization_profile_id || '标准业务 RANS' }}<br />{{ task.runtime?.parameterization?.configuration_status === 'customized_research' ? '自定义研究配置 · 内部预览' : `${task.runtime?.parameterization?.version || 'v1'} · ${task.runtime?.parameterization?.release_mode === 'internal_preview' ? '内部预览' : '受管发布'}` }}</dd></div>
            <div v-if="!isForcingOnly"><dt>边界模板</dt><dd>{{ task.request?.cfd?.turbulence?.boundary_template_id || 'wrf-flux-aware-mixed-open/v2' }}</dd></div>
            <div><dt>上游模式</dt><dd>{{ task.request?.upstream_mode === 'reuse_34m' ? '复用认证 34 m forcing' : task.request?.upstream_mode === 'reuse_10m' ? `复用约 10 m forcing · ${task.request?.source_forcing_task_id || '—'}` : '完整 27 km → 约 10 m forcing' }}</dd></div>
          </dl>
          <dl v-else>
            <div><dt>模拟时段</dt><dd>{{ formatTime(task.request?.start_time) }}<br />{{ formatTime(task.request?.end_time) }}</dd></div>
            <div><dt>中心点</dt><dd>{{ task.request?.center?.lat }}, {{ task.request?.center?.lon }}</dd></div>
            <div><dt>嵌套域</dt><dd>{{ task.request?.domains?.length || 0 }} 层</dd></div>
            <div><dt>{{ forcingLabel }}</dt><dd>{{ forcingValue }}</dd></div>
            <div><dt>运行配置</dt><dd>{{ runtimeProfileLabel }}<br v-if="task.runtime?.fallback_used" /><span v-if="task.runtime?.fallback_used">GPU 异常后已自动回退</span></dd></div>
            <div><dt>驱动资料</dt><dd>{{ forcingProgressLabel }}<br v-if="transferSummary" /><span v-if="transferSummary">{{ transferSummary }}</span></dd></div>
            <div><dt>物理方案</dt><dd>{{ task.request?.physics?.preset || '默认通用' }}</dd></div>
            <div><dt>Spin-up</dt><dd>{{ task.runtime?.spinup_hours ?? task.request?.spinup?.hours ?? 0 }} 小时<br />模型起报 {{ formatTime(task.runtime?.model_start_time) }}</dd></div>
          </dl>
          <p v-if="isDownscale" class="gfs-demand">当前阶段只会在审核 forcing、地形和资源全部通过后启动受管远端运行器；smoke 产物不会转为正式发布。</p>
          <p v-else-if="gfsDemandHint" class="gfs-demand">{{ gfsDemandHint }}</p>
          <p v-if="task.error" class="error">{{ displayError }}</p>
          <div v-if="task.failure" class="failure-guide">
            <b>{{ failureLabel(task.failure.failure_class) }}</b>
            <span>{{ failureAdvice(task.failure) }}</span>
          </div>
          <div class="actions">
            <el-button @click="emit('back')">返回可视化</el-button>
            <el-button v-if="canCancel" type="danger" plain @click="emit('cancel')">{{ task.status === 'cancel_pending' ? '重试取消' : '取消任务' }}</el-button>
            <el-button v-if="canRetryOutputs" type="primary" plain @click="emit('retry-outputs')">仅重试结果下载</el-button>
            <el-button v-if="canRenderPartial" type="warning" plain @click="emit('render-partial')">忽略不可读帧并部分渲染</el-button>
            <el-button v-if="canResume" type="primary" @click="emit('resume')">认证并继续任务</el-button>
            <el-button v-if="canEditRestart" @click="emit('edit-restart')">{{ isDownscale ? "恢复高分任务" : "调整参数并重新运行" }}</el-button>
            <el-button v-if="canRequestCertification" type="warning" plain @click="emit('certify')">提交配置认证审核</el-button>
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
          <pre ref="logPanel" @scroll="handleLogScroll">{{ displayLogs || '等待任务日志…' }}</pre>
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
const emit = defineEmits(["cancel", "resume", "edit-restart", "retry-outputs", "render-partial", "attempt-change", "result", "back", "certify"]);
const logPanel = ref(null);
const followingLatest = ref(true);
const pendingLogUpdate = ref(false);
const displayLogs = computed(() => String(props.logs || "").replaceAll("超算", "tx-lab"));
const displayError = computed(() => String(props.task?.error || "").replaceAll("超算", "tx-lab"));
const isDownscale = computed(() => props.task?.task_type === "high_resolution_downscale");
const isForcingOnly = computed(() => isDownscale.value && props.task?.request?.execution_scope === "forcing_only");
const isCfdHandoff = computed(() => isDownscale.value && props.task?.request?.upstream_mode === "reuse_10m");
const isComposite = computed(() => isDownscale.value && props.task?.request?.execution_scope === "wrf_cfd" && props.task?.request?.upstream_mode === "full_chain");
const highresSampling = computed(() => props.task?.runtime?.microscale_sampling || {});
const forcingDurationHours = computed(() => {
  const runtimeDuration = Number(props.task?.runtime?.mesoscale_window?.duration_hours);
  if (Number.isInteger(runtimeDuration) && runtimeDuration > 0) return runtimeDuration;
  const start = Date.parse(props.task?.request?.start_time || "");
  const end = Date.parse(props.task?.request?.end_time || "");
  const derived = (end - start) / 3600000;
  return Number.isInteger(derived) && derived > 0 ? derived : 48;
});
const microscaleSummary = computed(() => isForcingOnly.value ? `约 10 m forcing · ${forcingDurationHours.value} h / ${forcingDurationHours.value + 1} 时次` : (highresSampling.value.solver_family === "les"
  ? `${highresSampling.value.episodes?.length || 0} 个 LES 统计时段`
  : `${highresSampling.value.selected_valid_times?.length || highresSampling.value.max_count || 0} 个 RANS 独立快照`));
const productFootprint = computed(() => {
  const aoi = props.task?.request?.aoi || {};
  return aoi.width_m && aoi.height_m ? `${aoi.width_m} m × ${aoi.height_m} m` : "待预检";
});
const sourceLabel = computed(() => ({ ecmwf: "ECMWF", ec: "ECMWF" })[props.task?.request?.data_source] || "GFS");
const forcingCycle = computed(() => props.task?.runtime?.forcing_cycle || props.task?.runtime?.gfs_cycle || props.task?.runtime?.ecmwf_cycle);
const forcingLabel = computed(() => `${sourceLabel.value} 周期`);
const forcingValue = computed(() => forcingCycle.value || "待选择");
const forcingReused = computed(() => props.task?.runtime?.forcing_remote_reused ?? props.task?.runtime?.gfs_remote_reused ?? props.task?.runtime?.ecmwf_remote_reused ?? 0);
const forcingTotal = computed(() => props.task?.runtime?.forcing_total ?? props.task?.runtime?.gfs_total ?? props.task?.runtime?.ecmwf_total ?? 0);
const forcingProgressLabel = computed(() => {
  return `${forcingReused.value}/${forcingTotal.value} 个 ${sourceLabel.value} 时次已就绪`;
});
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
const runtimeProfileLabel = computed(() => {
  const requested = props.task?.runtime?.requested_runtime_profile || props.task?.request?.runtime_profile || "cpu";
  const actual = props.task?.runtime?.active_runtime_profile || requested;
  return requested === actual ? actual.toUpperCase() : `${requested.toUpperCase()} → ${actual.toUpperCase()}`;
});
const gfsDemandHint = computed(() => {
  if (!["checking_hpc_gfs", "waiting_for_hpc_gfs", "checking_hpc_forcing", "waiting_for_hpc_forcing"].includes(props.task?.stage)) return "";
  const cycle = forcingCycle.value || "目标周期";
  const total = Number(forcingTotal.value) || 0;
  const ready = Number(forcingReused.value) || 0;
  const remaining = Math.max(0, total - ready);
  const waiting = props.task?.runtime?.gfs_download_detail === "shared"
    ? "当前共享下载结束后自动接续"
    : "已按任务优先下载";
  return `${cycle} · 还差 ${remaining}/${total} 个任务时次 · ${waiting}`;
});
const wrfStages = [
  { key: "queue", label: "调度", min: 0 }, { key: "forcing", label: "驱动数据", min: 5 },
  { key: "prepare", label: "准备 tx-lab", min: 40 }, { key: "wrf", label: "WPS / WRF", min: 68 },
  { key: "render", label: "结果渲染", min: 88 }, { key: "done", label: "完成", min: 100 },
];
const downscaleStages = [
  { key: "queue", label: "排队", min: 0 }, { key: "forcing", label: "约 10 m forcing", min: 15 },
  { key: "coupling", label: "边界转换", min: 35 }, { key: "mesh", label: "分级网格", min: 52 },
  { key: "solve", label: "CFD 快照", min: 72 }, { key: "publish", label: "质量发布", min: 100 },
];
const cfdStages = [
  { key: "queue", label: "排队", min: 0 }, { key: "forcing", label: "10 m forcing", min: 60 },
  { key: "coupling", label: "边界转换", min: 68 }, { key: "mesh", label: "分级网格", min: 75 },
  { key: "solve", label: "CFD 求解", min: 84 }, { key: "publish", label: "质量发布", min: 100 },
];
const compositeStages = [
  { key: "queue", label: "排队", min: 0 }, { key: "wrf", label: "d04→d08 WRF-LES", min: 15 }, { key: "forcing", label: "forcing 质量门", min: 60 }, { key: "mesh", label: "CFD 分级网格", min: 75 }, { key: "solve", label: "RANS / LES", min: 84 }, { key: "publish", label: "质量发布", min: 100 },
];
const forcingOnlyStages = [
  { key: "queue", label: "排队", min: 0 }, { key: "forcing", label: "末级 NDOWN", min: 32 },
  { key: "quality", label: "forcing 质量门", min: 72 }, { key: "publish", label: "归档", min: 100 },
];
const stages = computed(() => isDownscale.value ? (isForcingOnly.value ? forcingOnlyStages : (isComposite.value ? compositeStages : (isCfdHandoff.value ? cfdStages : downscaleStages))) : wrfStages);
const canCancel = computed(() => props.task && !["succeeded", "partial_success", "failed", "cancelled"].includes(props.task.status));
const canResume = computed(() => !isDownscale.value && (props.task?.status === "paused_external" || (
  props.task?.status === "failed" && props.task?.failure?.failure_class === "external"
)));
const canEditRestart = computed(() => isDownscale.value
  ? ["failed", "cancelled", "partial_success"].includes(props.task?.status)
  : ["waiting_restart", "cancelled"].includes(props.task?.status) || (
  props.task?.status === "failed" && !props.task?.runtime?.remote_wrf_succeeded && props.task?.failure?.failure_class !== "external"
));
const canRequestCertification = computed(() => isDownscale.value && props.task?.quality?.status === "complete" && props.task?.certification?.status !== "certified");
const canRetryOutputs = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && forcingCycle.value);
const canRenderPartial = computed(() => props.task?.status === "failed" && props.task?.runtime?.remote_wrf_succeeded && (
  Boolean(props.task?.runtime?.output_validation?.invalid?.length) || /netcdf|hdf|wrfout|unknown file format/i.test(props.task?.error || "")
));
const attemptItems = computed(() => [
  { attempt_no: Number(props.task?.attempt_no || 1), status: props.task?.status || "queued" },
  ...(props.task?.attempts || []),
].sort((a, b) => Number(b.attempt_no) - Number(a.attempt_no)));
function statusLabel(value) { return ({ pending_review: "等待审核", queued: "待调度", prefetching: "准备数据", uploading: "准备 tx-lab", running: "运行中", rendering: "渲染中", succeeded: "已完成", partial_success: "部分完成", failed: "失败", waiting_restart: "待调整", waiting_upstream: isForcingOnly.value ? "等待约 10 m forcing" : isCfdHandoff.value ? "等待已完成约 10 m forcing" : isComposite.value ? "等待普通 WRF d04" : "等待认证的 34 m forcing", source_forcing_handoff: "交接约 10 m forcing", preparing_forcing: "构建 CFD 强迫", waiting_ndown_wrf_les: "等待 ndown / WRF LES", source_handoff_running: "交接普通 WRF 输出", source_handoff_failed: "上游输出交接失败", meshing: "构建分级网格", solving: "CFD / LES 求解", generating_products: "生成微尺度产品", downloading_products: "校验产品包", publishing: "质量发布中", paused_external: "等待连接", cancelled: "已取消", cancel_pending: "取消中", reconciling: "对账中" })[value] || value; }
function stageLabel(value) { return ({ upstream_failed: "上游 WRF 失败", resource_scientific_review: "等待资源与科学审核", queued: "等待执行名额", waiting_upstream: isForcingOnly.value ? "等待末级 NDOWN 与约 10 m WRF" : (props.task?.request?.upstream_mode === "reuse_34m" ? "等待认证的 34 m forcing" : props.task?.request?.upstream_mode === "reuse_10m" ? "等待已完成约 10 m forcing" : isComposite.value ? "等待普通 WRF d04 原生输出" : "等待认证的约 10 m forcing"), preparing_remote: "上传高分受管合同", checking_upstream_restart: "检查普通 WRF 原生重启场", source_handoff_running: "交接普通 WRF 原生输出", source_forcing_handoff: "交接并校验约 10 m forcing", surface_prepare: props.task?.request?.surface_mode === "auto_flat" ? "生成平坦地表并推导粗糙度" : "校验并准备真实地形", waiting_ndown_wrf_les: isForcingOnly.value || isComposite.value ? "执行 ndown / WRF LES" : "等待 ndown / WRF LES", source_handoff_failed: "普通 WRF 输出交接失败", remote_status_retrying: "连接暂时中断，自动对账远端任务", preparing_forcing: isForcingOnly.value || isComposite.value ? "执行 d04→d08 WRF-LES" : "构建 coupling manifest", meshing: "构建一次复用的分级网格", solving: highresSampling.value.solver_family === "les" ? "执行有限 LES 统计时段" : "执行独立 RANS 稳态快照", generating_products: "按 AGL 采样并准备三维浏览资产", downloading_products: "校验标准科学数据包", publishing: isForcingOnly.value ? "冻结 mesoscale forcing manifest" : "执行质量门与原子发布", retrying_outputs: "等待恢复结果下载", retrying_partial_render: "等待部分结果渲染", checking_remote_outputs: "确认远端 WRF 结果", selecting_cycle: `选择 ${sourceLabel.value} 00Z 周期`, waiting_for_gfs_cache: "等待 tx-lab 驱动数据", waiting_for_forcing_cache: "等待 tx-lab 驱动数据", checking_hpc_gfs: "校验 tx-lab 驱动数据池", checking_hpc_forcing: "校验 tx-lab 驱动数据池", waiting_for_hpc_gfs: "等待 tx-lab 驱动数据补齐", waiting_for_hpc_forcing: "等待 tx-lab 驱动数据补齐", remote_gfs_ready: "tx-lab 驱动数据已就绪", remote_forcing_ready: "tx-lab 驱动数据已就绪", preparing_hpc: "提交任务配置", running: "WPS / WRF 运行中", reconciling: "正在恢复 tx-lab 连接", paused_external: "等待 tx-lab 连接", cancel_pending: "正在取消远端进程", cancelled: "任务已取消", downloading_outputs: "拉取 wrfout 结果", rendering: "生成 WebP", done: "任务完成", failed: "本次尝试已停止" })[value] || value || "等待开始"; }
function failureLabel(value) { return ({ external: "外部连接故障", configuration: "参数配置失败", model: "WPS / WRF 运行失败", data: "驱动数据异常", output: "结果恢复失败" })[value] || "任务异常"; }
function failureAdvice(value) { return ({ resume: "不会清理远端计算；认证后从原阶段继续。", edit_and_restart: "返回配置页调整参数，确认任务专属路径后重新运行。", restart: "确认驱动数据和参数后，在原任务中重新运行。", retry_outputs: "远端计算结果将保留，只恢复下载与渲染。" })[value?.recommended_action] || "请根据日志确认后续操作。"; }
function stageClass(min) { return { done: Number(props.task?.progress || 0) >= min, active: Number(props.task?.progress || 0) >= min && Number(props.task?.progress || 0) < (stages.value.find(item => item.min > min)?.min || 101) }; }
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
.gfs-demand { margin: 9px 0 0; padding: 8px 9px; border: 1px solid #60a5fa55; border-radius: 8px; color: #93c5fd; background: #3b82f612; font-size: 11px; line-height: 1.45; }
.terminal-card { min-height: 410px; overflow: hidden; background: #050914; }.terminal-head { display: flex; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 11px; }.terminal-head div { display: flex; align-items: center; gap: 7px; }.terminal-head i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.terminal-head button { padding: 0; border: 0; background: transparent; color: #94a3b8; font: inherit; cursor: pointer; }.terminal-head button:hover { color: var(--accent); }.terminal-head button.paused { color: #f59e0b; }.terminal-card pre { max-height: 470px; margin: 0; padding: 14px; overflow: auto; color: #cbd5e1; font: 11px/1.6 "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
@media (max-width: 980px) { .run-grid { grid-template-columns: 1fr; }.stage-flow { grid-template-columns: repeat(3, 1fr); } }
</style>
