<template>
  <div class="wrf-studio">
    <aside class="tool-rail glass">
      <button :class="{ on: dockOpen && tool === 'source' }" @click="openTool('source')"><el-icon><DataAnalysis /></el-icon><span>数据源</span></button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')"><el-icon><Position /></el-icon><span>投影</span></button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')"><el-icon><MapLocation /></el-icon><span>底图</span></button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid"><el-icon><Grid /></el-icon><span>经纬网</span></button>
      <button :class="{ on: showVector }" @click="showVector = !showVector"><b>界</b><span>边界</span></button>
    </aside>

    <section v-if="dockOpen" class="tool-dock glass">
      <header><div><span>WRF 工作台</span><h3>{{ dockTitle }}</h3></div><el-icon @click="dockOpen = false"><Close /></el-icon></header>
      <template v-if="tool === 'source'">
        <div class="service-summary" :class="{ offline: !serviceOnline }"><i></i><span>{{ serviceOnline ? `backend_wrf · 8007 · ${hpcModeLabel}` : 'WRF 服务未连接' }}</span><button v-if="!serviceOnline" @click="refreshAll(true)">重试</button></div>
        <p v-if="serviceError" class="service-error">{{ txLabText(serviceError) }}</p>
        <p class="dock-hint">选择 WRF 驱动资料。GFS 与 ECMWF 使用同一套任务、数据池和结果流程。</p>
        <div class="source-list">
          <button v-for="source in sources" :key="source.id" :class="{ selected: selectedSource === source.id, disabled: source.status !== 'available' }" @click="selectSource(source)">
            <span class="source-icon"><el-icon><DataAnalysis /></el-icon></span>
            <span class="source-copy"><b>{{ source.name }}</b><small>{{ source.description }}</small><em>{{ source.provider }}</em></span>
            <span :class="['source-state', source.status]">{{ source.status === 'available' ? '已接入' : '待接入' }}</span>
          </button>
        </div>
        <div class="source-note"><el-icon><InfoFilled /></el-icon><p>{{ selectedSourceLabel }} 由 tx-lab 后台持续预取；工作台只提交配置并拉取 WRF 结果。</p></div>
      </template>
      <template v-else-if="tool === 'proj'">
        <p class="dock-hint">WRF 结果使用单地图展示，切换投影不会改变原始数据。</p>
        <div class="picker"><button v-for="item in projections" :key="item" :class="{ on: projection === item }" @click="projection = item"><span>{{ item }}</span><el-icon v-if="projection === item"><Check /></el-icon></button></div>
      </template>
      <template v-else>
        <p class="dock-hint">选择结果地图底图。</p>
        <div class="picker"><button v-for="item in basemaps" :key="item" :class="{ on: basemap === item }" @click="basemap = item"><span>{{ item }}</span><el-icon v-if="basemap === item"><Check /></el-icon></button></div>
        <button class="map-theme" @click="mapDark = !mapDark"><el-icon><Sunny v-if="mapDark" /><Moon v-else /></el-icon>{{ mapDark ? '切换亮色地图' : '切换暗色地图' }}</button>
      </template>
    </section>

    <main class="studio-main">
      <div class="content-row">
        <section class="center-workspace glass">
          <template v-if="workspaceView === 'result'">
            <header class="workspace-head">
              <div><span>WRF VISUALIZATION</span><h2>数值预报结果</h2><small>{{ resultTaskId || '暂无成功任务' }}</small></div>
              <div class="workspace-actions"><el-button type="primary" @click="openNewTask">新建任务</el-button></div>
            </header>
            <div v-if="!resultTaskId" class="result-empty"><el-icon><Picture /></el-icon><b>暂无 WRF 可视化结果</b><span>从右侧新建任务，任务完成后将在这里展示 WebP 预报图。</span><el-button type="primary" plain @click="openNewTask">新建模拟任务</el-button></div>
            <template v-else>
              <div class="result-toolbar"><span><i></i>{{ resultSourceLabel }} · {{ visualInfo?.element || 'WRF 结果' }}</span><b>{{ currentVisualTime || '等待时次' }}</b></div>
              <div class="visual-map">
                <ProjMap :key="`${resultTaskId}-${projection}`" :projection="projection" :basemap="basemap" :grid="showGrid" :vector="showVector" :dark="mapDark">
                  <WrfResultLayer :task-id="resultTaskId" :time-index="visualTimeIndex" @display-loaded="onDisplayLoaded" @variable-change="onVariableChange" />
                </ProjMap>
              </div>
              <div class="timebar">
                <el-button circle :icon="DArrowLeft" :disabled="visualTimes.length < 2" @click="setVisualTime(0)" />
                <el-button circle :icon="ArrowLeft" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimeIndex - 1)" />
                <el-button circle type="primary" :icon="visualPlaying ? VideoPause : VideoPlay" :disabled="visualTimes.length < 2" @click="togglePlayback" />
                <el-button circle :icon="ArrowRight" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimeIndex + 1)" />
                <el-button circle :icon="DArrowRight" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimes.length - 1)" />
                <el-slider v-model="visualTimeIndex" :min="0" :max="Math.max(0, visualTimes.length - 1)" :show-tooltip="false" @input="stopPlayback" />
                <time>{{ currentVisualTime || '暂无时次' }}</time><span>{{ visualTimes.length ? `${visualTimeIndex + 1}/${visualTimes.length}` : '0/0' }}</span>
              </div>
            </template>
          </template>

          <WrfTaskConfig
            v-else-if="workspaceView === 'new'"
            :options="options"
            :data-source="selectedSource"
            :submitting="submitting"
            :initial-request="restartContext?.request"
            :retry-task-id="restartContext?.taskId || ''"
            :attempt-no="restartContext?.attemptNo || 1"
            @submit="submitTask"
            @cancel="cancelConfig"
          />
          <WrfTaskRun
            v-else
            :task="selectedTask"
            :logs="logs"
            :log-attempt-no="logAttemptNo"
            @cancel="cancelTask"
            @resume="resumeTask"
            @edit-restart="editAndRestart"
            @retry-outputs="retryTaskOutputs"
            @render-partial="renderPartialTask"
            @attempt-change="selectLogAttempt"
            @result="showResult(selectedTask)"
            @back="showLatestResult"
          />
        </section>

        <aside class="right-sidebar">
          <section class="side-card glass data-pool">
            <header><div><span>FORECAST POOL</span><h3>预报数据池</h3></div><i :class="dataStatus?.status"></i></header>
            <div class="side-card-body">
              <template v-if="hpcAuthenticated">
                <div v-for="item in poolItems" :key="item.provider" class="pool-provider">
                  <div class="provider-head"><b>{{ item.label }}</b><span>{{ poolStatus(item.status) }}</span></div>
                  <small class="pool-scope">0.25° · 后台预取 · 保留 2 周期</small>
                  <article
                    v-for="cycle in visiblePoolCycles(item)"
                    :key="cycle.cycle"
                    :class="{ target: cycle.target, 'task-required': cycle.task_required }"
                  >
                    <div class="cycle-head"><b>{{ formatCycle(cycle.cycle) }}</b><span :class="cycle.status">{{ cycleLabel(cycle) }}</span></div>
                    <small>{{ cycle.completed_files }}/{{ cycle.total_files }} 文件 · {{ formatBytes(cycle.size_bytes) }}</small>
                    <div v-if="cycle.status === 'downloading' && cycle.partial_size_bytes" class="cycle-transfer">
                      {{ formatBytes(cycle.partial_size_bytes) }} 下载中<template v-if="cycle.download_rate_bps >= 1024"> · {{ formatRate(cycle.download_rate_bps) }}</template>
                    </div>
                    <el-progress :percentage="cyclePercent(cycle)" :stroke-width="4" :show-text="false" />
                    <div v-if="cycle.auto_cleanup_allowed || cycle.cleanup_allowed || (cycle.protected && !cycle.target)" class="cycle-actions">
                      <em v-if="cycle.auto_cleanup_allowed">同步时自动清理</em>
                      <button v-else-if="cycle.cleanup_allowed" class="cycle-cleanup" :disabled="gfsActionBusy" @click="confirmCleanupCycle(cycle)">人工清理</button>
                      <em v-else-if="cycle.task_required">任务优先</em>
                      <em v-else>近期保留</em>
                    </div>
                  </article>
                  <div v-if="!item.cycles?.length" class="side-empty">{{ txLabText(dataStatus?.message) || 'tx-lab 数据池暂无周期' }}</div>
                </div>
              </template>
              <template v-else>
                <div class="side-empty">{{ txLabText(health?.hpc?.message) || 'tx-lab 系统盘数据池尚未就绪' }}</div>
              </template>
            </div>
            <div class="side-card-actions">
              <button v-if="hpcAuthenticated" class="side-action" :disabled="gfsActionBusy" @click="syncLatestRemoteForcing">{{ gfsActionBusy ? '正在同步…' : (autoCleanupPending ? `自动清理并同步 ${selectedSourceLabel} 00Z` : `同步 ${selectedSourceLabel} 最新 00Z`) }}</button>
              <button v-else class="side-action" @click="refreshHpcConnection">检查 tx-lab 连接</button>
            </div>
          </section>

          <section class="side-card glass history-card">
            <header><div><span>HISTORY</span><h3>历史任务</h3></div><span class="panel-count">{{ historyTasks.length }}</span></header>
            <div class="task-items">
              <article v-for="task in historyTasks" :key="task.id" :class="{ selected: task.id === activeTaskId }" :title="task.id" @click="openHistoryTask(task)">
                <div><b>{{ taskDateRange(task) }}</b><span :class="['mini-status', task.status]">{{ taskStatus(task.status) }}</span></div>
                <small>{{ task.request?.domains?.length || 0 }} 域 · {{ String(task.request?.data_source || 'gfs').toUpperCase() }} · {{ formatCycle(task.runtime?.forcing_cycle || task.runtime?.gfs_cycle || task.runtime?.ecmwf_cycle) || '周期待定' }}</small>
                <button class="delete-task" title="删除本地任务数据" aria-label="删除本地任务数据" @click.stop="confirmDelete(task)">×</button>
              </article>
              <div v-if="!historyTasks.length" class="side-empty">暂无历史任务</div>
            </div>
            <button class="new-task" @click="openNewTask">＋ 新建任务</button>
          </section>

          <section class="side-card glass running-card">
            <header><div><span>RUNNING</span><h3>正在进行</h3></div><span class="panel-count">{{ runningTasks.length }}</span></header>
            <div class="task-items">
              <article v-for="task in runningTasks" :key="task.id" :class="{ selected: task.id === selectedTaskId }" :title="task.id" @click="showRun(task)">
                <div><b>{{ taskStatus(task.status) }}</b><strong>{{ task.progress || 0 }}%</strong></div>
                <small>{{ taskStage(task.stage) }}</small><el-progress :percentage="task.progress || 0" :stroke-width="3" :show-text="false" />
              </article>
              <div v-if="!runningTasks.length" class="side-empty compact">无运行任务</div>
            </div>
          </section>
        </aside>
      </div>

      <footer class="status-footer glass">
        <div class="footer-title"><span :class="['pulse', { offline: !serviceOnline }]"><i></i></span><div><b>WRF 数值预报工作台</b><small>{{ footerTaskSummary }}</small></div></div>
        <div class="workflow"><span class="done"><i>1</i>选择数据源</span><em></em><span :class="{ done: !!activeTaskId || !!resultTaskId, active: workspaceView === 'new' }"><i>2</i>配置任务</span><em></em><span :class="{ done: isDisplayable(selectedTask), active: workspaceView === 'run' && !isDisplayable(selectedTask) }"><i>3</i>tx-lab 运行</span><em></em><span :class="{ done: !!resultTaskId, active: workspaceView === 'result' && !!resultTaskId }"><i>4</i>查看结果</span></div>
        <div :class="['footer-service', { offline: !serviceOnline }]"><i></i>{{ serviceOnline ? `${hpcModeLabel} ${health?.hpc?.status || 'checking'}${activeTaskCount ? ` · ${activeTaskCount} 个任务` : ''}` : '服务离线' }}</div>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowLeft, ArrowRight, Check, Close, DArrowLeft, DArrowRight, DataAnalysis, Grid,
  InfoFilled, MapLocation, Moon, Picture, Position, Sunny, VideoPause, VideoPlay,
} from "@element-plus/icons-vue";
import {
  cancelWrfTask, cleanupWrfForcing, createWrfTask, deleteWrfTask, getWrfDataStatus,
  getWrfHealth, getWrfOptions, getWrfTaskLogs, getWrfTaskRestartPlan, listWrfTasks,
  renderPartialWrfTask, restartWrfTask, resumeWrfTask, retryWrfTaskOutputs, syncLatestWrfForcing,
} from "../api.js";
import ProjMap from "../components/ProjMap.vue";
import WrfTaskConfig from "../components/WrfTaskConfig.vue";
import WrfTaskRun from "../components/WrfTaskRun.vue";
import WrfResultLayer from "../components/WrfResultLayer.vue";

const route = useRoute();
const router = useRouter();
const theme = inject("theme", ref(true));
const FINAL = new Set(["succeeded", "partial_success", "failed", "waiting_restart", "cancelled"]);
const sources = [
  { id: "gfs", name: "GFS 全球预报", description: "0.25° WRF 边界场，tx-lab 共享数据池", provider: "NOAA NOMADS Grib Filter", status: "available" },
  { id: "ecmwf", name: "ECMWF IFS", description: "0.25° IFS 完整文件，tx-lab 共享数据池", provider: "ECMWF Open Data", status: "available" },
  { id: "era5", name: "ERA5 再分析", description: "历史再分析驱动资料", provider: "Copernicus CDS", status: "planned" },
];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];
const initialWorkspaceView = ["result", "new", "run"].includes(String(route.query.view)) ? String(route.query.view) : "result";

const tool = ref("source");
const selectedSource = ref("gfs");
const dockOpen = ref(true);
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const showGrid = ref(true);
const showVector = ref(true);
const mapDark = ref(Boolean(theme.value));
const workspaceView = ref(initialWorkspaceView);
const options = ref(null);
const health = ref(null);
const dataStatus = ref(null);
const tasks = ref([]);
const serviceError = ref("");
const submitting = ref(false);
const gfsActionBusy = ref(false);
const selectedTaskId = ref(initialWorkspaceView === "run" ? String(route.query.task_id || "") : "");
const resultTaskId = ref("");
const logs = ref("");
const logOffset = ref(0);
const logAttemptNo = ref(null);
const restartContext = ref(null);
const visualTimes = ref([]);
const visualTimeIndex = ref(0);
const visualInfo = ref(null);
const visualPlaying = ref(false);
let refreshTimer = null;
let playbackTimer = null;
let refreshInFlight = false;
let lastRemoteRefreshAt = 0;
const REMOTE_REFRESH_INTERVAL = 20000;
const MAX_LOG_CHARS = 300000;
const downloadSamples = new Map();

const serviceOnline = computed(() => health.value?.status === "online" && !serviceError.value);
const selectedTask = computed(() => tasks.value.find(task => task.id === selectedTaskId.value) || null);
const successfulTasks = computed(() => tasks.value.filter(task => isDisplayable(task)));
const historyTasks = computed(() => tasks.value.filter(task => FINAL.has(task.status)));
const runningTasks = computed(() => tasks.value.filter(task => !FINAL.has(task.status)));
const activeTaskId = computed(() => selectedTaskId.value || resultTaskId.value || health.value?.active_task_id || "");
const hpcModeLabel = computed(() => health.value?.hpc?.connection_mode === "direct" ? "tx-lab 直连" : "远端连接");
const hpcAuthenticated = computed(() => health.value?.hpc?.status === "ready");
const activeTaskCount = computed(() => Number(health.value?.active_task_count) || 0);
const maxConcurrentTasks = computed(() => Number(health.value?.max_concurrent_tasks || options.value?.capabilities?.max_concurrent_tasks) || 1);
const selectedSourceLabel = computed(() => selectedSource.value === "ecmwf" ? "ECMWF" : "GFS");
const footerTaskSummary = computed(() => {
  if (selectedTaskId.value || resultTaskId.value) return selectedTaskId.value || resultTaskId.value;
  if (activeTaskCount.value) return `${activeTaskCount.value}/${maxConcurrentTasks.value} 个任务执行中`;
  return `${selectedSourceLabel.value} 00Z 驱动 · 最多 ${maxConcurrentTasks.value} 任务并行`;
});
const currentVisualTime = computed(() => visualTimes.value[visualTimeIndex.value] || "");
const resultSourceLabel = computed(() => {
  const task = tasks.value.find(item => item.id === resultTaskId.value);
  return String(task?.request?.data_source || selectedSource.value || "gfs").toUpperCase();
});
const poolItems = computed(() => {
  if (Array.isArray(dataStatus.value?.pool_items)) return dataStatus.value.pool_items;
  return [{ provider: selectedSource.value, label: selectedSourceLabel.value, source: selectedSource.value === "ecmwf" ? "ECMWF Open Data" : "NOAA NOMADS", status: dataStatus.value?.status || "idle", cycles: [] }];
});
const autoCleanupPending = computed(() => poolItems.value.some(item =>
  (item.cycles || []).some(cycle => cycle.auto_cleanup_allowed),
));
const dockTitle = computed(() => ({ source: "数据源选择", proj: "投影方式", base: "底图图层" })[tool.value]);

function openTool(name) { if (dockOpen.value && tool.value === name) dockOpen.value = false; else { tool.value = name; dockOpen.value = true; } }
function selectSource(source) {
  if (source.status !== "available") {
    ElMessage.info(`${source.name} 尚未接入`);
    return;
  }
  selectedSource.value = source.id;
  refreshAll(true);
}
function isDisplayable(task) { return Boolean(task && ["succeeded", "partial_success"].includes(task.status)); }
function taskStatus(value) { return ({ queued: "待调度", prefetching: "准备数据", uploading: "准备 tx-lab", running: "运行", rendering: "渲染", succeeded: "成功", partial_success: "部分完成", failed: "失败", waiting_restart: "待调整", paused_external: "等待连接", cancelled: "已取消", cancel_pending: "取消中", reconciling: "恢复连接" })[value] || value; }
function taskStage(value) { return ({ queued: "等待执行名额", selecting_cycle: `选择 ${selectedSourceLabel.value} 00Z 周期`, checking_hpc_gfs: "校验 tx-lab 驱动数据池", checking_hpc_forcing: "校验 tx-lab 驱动数据池", waiting_for_hpc_gfs: "等待 tx-lab 驱动数据补齐", waiting_for_hpc_forcing: "等待 tx-lab 驱动数据补齐", remote_gfs_ready: "tx-lab 驱动数据已就绪", remote_forcing_ready: "tx-lab 驱动数据已就绪", preparing_hpc: "提交任务配置", running: "WPS / WRF 运行中", downloading_outputs: "拉取 wrfout 结果", rendering: "生成 WebP", done: "任务完成", failed: "本次尝试已停止" })[value] || value || "等待开始"; }
function txLabText(value) { return String(value || "").replaceAll("超算", "tx-lab"); }
function poolStatus(value) { return ({ ready: "已就绪", downloading: "下载中", checking: "检查中", partial: "部分就绪", missing: "待下载", unavailable: "不可用", error: "需处理", idle: "等待" })[value] || value || "等待"; }
function visiblePoolCycles(item) {
  const priority = cycle => cycle.task_required ? 0 : cycle.status === "downloading" ? 1 : cycle.prefetch_target ? 2 : cycle.retained ? 3 : 4;
  return [...(item?.cycles || [])]
    .sort((left, right) => priority(left) - priority(right) || String(right.cycle).localeCompare(String(left.cycle)));
}
function cycleNeedsCleanup(cycle) { return /CLEANUP_REQUIRED/i.test(String(cycle?.download_message || "")); }
function cycleLabel(cycle) {
  const status = poolStatus(cycle?.status);
  if (cycle?.task_required) return `任务所需 · ${status}`;
  if (cycle?.target && cycleNeedsCleanup(cycle)) return "等待自动清理";
  if (cycle?.prefetch_target) return `后台预取 · ${status}`;
  if (cycle?.retained) return `保留 · ${status}`;
  return cycle?.complete ? "旧周期" : status;
}
function syncActionMessage(result) {
  const labels = { ready: "已就绪", started: "已启动", running: "下载中", failed: "启动失败" };
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  const deleted = result?.auto_cleanup?.deleted?.length || 0;
  const prefix = deleted ? `已自动清理 ${deleted} 个旧周期；` : "";
  if (!actions.length) return `${prefix}tx-lab 周期同步请求已提交`;
  return prefix + actions.map(action => {
    if (/CLEANUP_REQUIRED/i.test(String(action.detail || ""))) return `${formatCycle(action.cycle)}：请先清理旧周期`;
    return `${formatCycle(action.cycle)}：${labels[action.status] || action.status}${action.detail ? `（${txLabText(action.detail)}）` : ""}`;
  }).join("；");
}
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
function formatRate(value) { return `${formatBytes(value)}/s`; }
function formatCycle(value) { const text = String(value || ""); return text.length === 10 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8)}Z` : text; }
function cyclePercent(cycle) {
  const complete = Number(cycle.completed_files) || 0;
  const total = Math.max(1, Number(cycle.total_files) || 0);
  const averageSize = complete > 0 ? (Number(cycle.size_bytes) || 0) / complete : 0;
  const partialEquivalent = averageSize > 0 ? (Number(cycle.partial_size_bytes) || 0) / averageSize : 0;
  return Math.min(100, Math.round((complete + partialEquivalent) / total * 100));
}
function trackDownloadMetrics(status) {
  const now = Date.now();
  const seen = new Set();
  for (const item of status?.pool_items || []) {
    for (const cycle of item.cycles || []) {
      const key = `${item.provider || "gfs"}:${cycle.cycle}`;
      seen.add(key);
      const hasPartialTelemetry = Object.prototype.hasOwnProperty.call(cycle, "partial_size_bytes");
      if (!hasPartialTelemetry) {
        cycle.download_rate_bps = 0;
        downloadSamples.delete(key);
        continue;
      }
      const received = (Number(cycle.size_bytes) || 0) + (Number(cycle.partial_size_bytes) || 0);
      const previous = downloadSamples.get(key);
      let rate = 0;
      if (cycle.status === "downloading" && previous) {
        const elapsed = Math.max(1, (now - previous.at) / 1000);
        const measured = Math.max(0, received - previous.received) / elapsed;
        rate = measured >= 1024
          ? (previous.rate > 0 ? previous.rate * 0.6 + measured * 0.4 : measured)
          : 0;
      }
      cycle.download_rate_bps = Math.round(rate);
      downloadSamples.set(key, { at: now, received, rate });
    }
  }
  for (const key of downloadSamples.keys()) if (!seen.has(key)) downloadSamples.delete(key);
  return status;
}
function taskDateRange(task) { const start = String(task.request?.start_time || "").slice(0, 10); const end = String(task.request?.end_time || "").slice(0, 10); return start && end ? `${start} → ${end}` : task.id; }

function routeTo(view, taskId = "", replace = false) {
  const query = { view };
  if (taskId) query.task_id = taskId;
  router[replace ? "replace" : "push"]({ path: "/wrf", query });
}
function syncRoute() {
  const view = ["result", "new", "run"].includes(String(route.query.view)) ? String(route.query.view) : "result";
  const taskId = String(route.query.task_id || "");
  workspaceView.value = view;
  if (view === "run") { selectedTaskId.value = taskId; resetLogs(); }
  if (view === "result") {
    const requested = tasks.value.find(task => task.id === taskId && isDisplayable(task));
    resultTaskId.value = requested?.id || successfulTasks.value[0]?.id || "";
    resetVisualization();
  }
}
function openNewTask() { stopPlayback(); restartContext.value = null; routeTo("new"); }
async function cancelConfig() {
  try { await ElMessageBox.confirm("当前未提交的任务配置不会保存，确定返回可视化？", "离开配置", { type: "warning" }); restartContext.value = null; showLatestResult(); } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
function showRun(task) { if (!task) return; selectedTaskId.value = task.id; resetLogs(); routeTo("run", task.id); }
function showResult(task) { if (!isDisplayable(task)) return; resultTaskId.value = task.id; routeTo("result", task.id); }
function showLatestResult() { const task = successfulTasks.value[0]; routeTo("result", task?.id || ""); }
function openHistoryTask(task) { if (isDisplayable(task)) showResult(task); else showRun(task); }

function resetLogs(attemptNo = null) { logs.value = ""; logOffset.value = 0; logAttemptNo.value = attemptNo; }
function selectLogAttempt(attemptNo) { resetLogs(Number(attemptNo)); refreshLogs(); }
function resetVisualization() { stopPlayback(); visualTimes.value = []; visualTimeIndex.value = 0; visualInfo.value = null; }
function onDisplayLoaded(payload) { visualTimes.value = Array.isArray(payload?.times) ? payload.times : []; setVisualTime(visualTimeIndex.value); }
function onVariableChange(payload) { visualInfo.value = payload; if (Array.isArray(payload?.times)) { visualTimes.value = payload.times; setVisualTime(visualTimeIndex.value); } }
function setVisualTime(value) { visualTimeIndex.value = Math.max(0, Math.min(Number(value) || 0, Math.max(0, visualTimes.value.length - 1))); }
function stopPlayback() { visualPlaying.value = false; clearInterval(playbackTimer); playbackTimer = null; }
function togglePlayback() { if (visualPlaying.value) { stopPlayback(); return; } if (visualTimes.value.length < 2) return; visualPlaying.value = true; playbackTimer = setInterval(() => setVisualTime(visualTimeIndex.value + 1 >= visualTimes.value.length ? 0 : visualTimeIndex.value + 1), 900); }

async function refreshAll(showMessage = false, includeRemote = hpcAuthenticated.value, forceRemote = false) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    try { health.value = await getWrfHealth(); serviceError.value = ""; } catch (error) { if (!health.value) health.value = { status: "offline", hpc: { status: "unavailable" } }; serviceError.value = error.message; if (showMessage) ElMessage.error(error.message); }
    const remoteDue = includeRemote && (forceRemote || !lastRemoteRefreshAt || Date.now() - lastRemoteRefreshAt >= REMOTE_REFRESH_INTERVAL);
    if (remoteDue) {
      try { dataStatus.value = trackDownloadMetrics(await getWrfDataStatus(selectedSource.value)); lastRemoteRefreshAt = Date.now(); } catch (error) { dataStatus.value = { status: "error", message: error.message, pool_items: [] }; }
    } else if (!includeRemote) {
      dataStatus.value = { status: "locked", message: "等待 tx-lab 连接", pool_items: [] };
    }
    try {
      tasks.value = await listWrfTasks();
      if (workspaceView.value === "result" && !tasks.value.some(task => task.id === resultTaskId.value && isDisplayable(task))) resultTaskId.value = successfulTasks.value[0]?.id || "";
      if (workspaceView.value === "run" && selectedTaskId.value) await refreshLogs();
    } catch (error) { if (showMessage) ElMessage.error(error.message); }
  } finally {
    refreshInFlight = false;
  }
}
async function refreshLogs() {
  if (!selectedTaskId.value) return;
  try {
    const chunk = await getWrfTaskLogs(selectedTaskId.value, logOffset.value, logAttemptNo.value);
    logs.value += chunk.text || "";
    if (logs.value.length > MAX_LOG_CHARS) logs.value = `… 已省略较早日志 …\n${logs.value.slice(-MAX_LOG_CHARS)}`;
    logOffset.value = chunk.offset || logOffset.value;
  } catch { /* 主轮询会继续重试 */ }
}
async function ensureHpcReady(_actionLabel, forceRefresh = false) {
  let hpc = health.value?.hpc || {};
  if (!forceRefresh && hpc.status === "ready") return;
  if (!serviceOnline.value) throw new Error(serviceError.value || "WRF 服务未连接");
  health.value = await getWrfHealth();
  hpc = health.value?.hpc || {};
  if (hpc.status !== "ready") throw new Error(hpc.message || "tx-lab 专用 SSH 密钥或运行环境未就绪");
}

function showSyncResult(result) {
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  const message = syncActionMessage(result);
  if (actions.some(action => action.status === "failed")) ElMessage.warning(message);
  else ElMessage.success(message);
}

async function refreshHpcConnection() {
  gfsActionBusy.value = true;
  try {
    await ensureHpcReady("检查连接", true);
    await refreshAll(false, true, true);
    ElMessage.success("tx-lab 连接正常");
  } catch (error) {
    dataStatus.value = { status: "locked", message: "等待 tx-lab 密钥连接", pool_items: [] };
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message);
  } finally {
    gfsActionBusy.value = false;
  }
}
async function submitTask(payload) {
  submitting.value = true;
  try {
    await ensureHpcReady("认证并提交");
    let task;
    if (restartContext.value) {
      const plan = await getWrfTaskRestartPlan(restartContext.value.taskId);
      const paths = [
        ...(plan.local_paths || []).map(path => `本地：${path}`),
        ...(plan.remote_paths || []).map(path => `tx-lab：${path}`),
      ];
      await ElMessageBox.confirm(
        `将归档第 ${plan.attempt_no} 次尝试，并清理以下任务专属残片：\n\n${paths.join("\n")}\n\n共享 GFS 数据池和历史归档不会删除。`,
        "确认调整参数并重新运行",
        { type: "warning", confirmButtonText: "确认清理并重新运行", cancelButtonText: "返回修改" },
      );
      task = await restartWrfTask(plan.task_id, payload, plan.attempt_no);
      restartContext.value = null;
      ElMessage.success(`原任务已开始第 ${task.attempt_no} 次尝试`);
    } else {
      task = await createWrfTask(payload);
      ElMessage.success("WRF 任务已开始动态并行调度");
    }
    await refreshAll();
    showRun(task);
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message);
  } finally { submitting.value = false; }
}
async function cancelTask() {
  const task = selectedTask.value; if (!task) return;
  const launched = Boolean(task.runtime?.remote_pid);
  const message = launched
    ? `将终止任务 ${task.id} 对应的 tx-lab 远端进程，是否继续？`
    : `将取消任务 ${task.id} 的动态调度或 tx-lab 准备，不会启动远端 WRF，是否继续？`;
  try { await ElMessageBox.confirm(message, "取消 WRF 任务", { type: "warning", confirmButtonText: "确认取消" }); await cancelWrfTask(task.id); ElMessage.success(launched ? "远端取消请求已转入后台处理" : "任务已取消"); await refreshAll(); } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function editAndRestart() {
  const task = selectedTask.value;
  if (!task) return;
  try {
    await ensureHpcReady("认证并检查重跑路径");
    const plan = await getWrfTaskRestartPlan(task.id);
    if (!plan.can_restart) throw new Error(plan.reason || "当前任务不能清理重跑");
    restartContext.value = {
      taskId: task.id,
      attemptNo: Number(task.attempt_no || 1),
      request: JSON.parse(JSON.stringify(task.request || {})),
    };
    routeTo("new");
  } catch (error) { ElMessage.error(error.message); }
}
async function resumeTask() {
  const task = selectedTask.value;
  if (!task) return;
  try {
    await ensureHpcReady("认证并继续任务", true);
    const resumed = await resumeWrfTask(task.id);
    ElMessage.success("已保留远端计算并开始从原阶段对账");
    await refreshAll();
    showRun(resumed);
  } catch (error) { ElMessage.error(error.message); }
}
async function retryTaskOutputs() {
  if (!selectedTask.value) return;
  try {
    await ensureHpcReady("认证并恢复下载");
    const task = await retryWrfTaskOutputs(selectedTask.value.id);
    ElMessage.success("已从断点恢复结果下载，不会重新运行 WPS/WRF");
    await refreshAll();
    showRun(task);
  } catch (error) { ElMessage.error(error.message); }
}
async function renderPartialTask() {
  if (!selectedTask.value) return;
  try {
    await ElMessageBox.confirm("将跳过无法读取的 wrfout 帧，并在 scene.meta.json 中记录缺失时次和质量告警。是否继续？", "部分渲染", { type: "warning", confirmButtonText: "确认忽略不可读帧" });
    const task = await renderPartialWrfTask(selectedTask.value.id);
    ElMessage.success("已开始部分渲染动态调度"); await refreshAll(); showRun(task);
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function confirmDelete(task) {
  try {
    await ElMessageBox.confirm(`将删除本地任务 ${task.id} 的数据库记录、日志、raw wrfout、WebP 和元数据。tx-lab 远端目录不会删除。`, "删除 WRF 本地任务", { type: "error", confirmButtonText: "确认删除" });
    await deleteWrfTask(task.id); ElMessage.success("本地任务数据已删除");
    if (selectedTaskId.value === task.id) selectedTaskId.value = "";
    if (resultTaskId.value === task.id) resultTaskId.value = "";
    await refreshAll(); showLatestResult();
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function syncLatestRemoteForcing() {
  gfsActionBusy.value = true;
  try {
    await ensureHpcReady("认证并同步");
    const result = await syncLatestWrfForcing(selectedSource.value);
    showSyncResult(result);
    await refreshAll(false, true, true);
  }
  catch (error) { ElMessage.error(error.message); }
  finally { gfsActionBusy.value = false; }
}

async function confirmCleanupCycle(cycle) {
  const path = String(cycle?.remote_path || "");
  if (!path) return;
  try {
    await ElMessageBox.confirm(
      `将永久删除 tx-lab 旧 ${selectedSourceLabel.value} 周期：\n${path}\n\n目标周期、下载中周期和运行中任务使用的周期不会被删除。`,
      "清理 tx-lab 旧数据",
      { type: "error", confirmButtonText: "确认删除此路径" },
    );
    gfsActionBusy.value = true;
    await cleanupWrfForcing(selectedSource.value, [path]);
    ElMessage.success(`已清理 ${path}`);
    await refreshAll(false, true, true);
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message);
  } finally {
    gfsActionBusy.value = false;
  }
}

watch(() => [route.query.view, route.query.task_id], syncRoute);
watch(theme, value => { mapDark.value = Boolean(value); });
onMounted(async () => {
  try { options.value = await getWrfOptions(); } catch (error) { serviceError.value = error.message; }
  await refreshAll(false, false); syncRoute();
  if (hpcAuthenticated.value) await refreshAll(false, true, true);
  refreshTimer = setInterval(() => refreshAll(false, hpcAuthenticated.value), 5000);
});
onBeforeUnmount(() => { clearInterval(refreshTimer); stopPlayback(); });
</script>

<style scoped>
.wrf-studio { height: calc(100vh - 70px); display: flex; gap: 10px; padding: 0 8px 8px; overflow: hidden; background: var(--bg); color: var(--text); font-size: 13px; }.glass { border: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--shadow); }
.tool-rail { flex-shrink: 0; width: 70px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 5px; border-radius: 14px; }.tool-rail button { width: 56px; min-height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 11px; background: transparent; color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; }.tool-rail button .el-icon, .tool-rail button b { font-size: 17px; }.tool-rail button.on { color: #fff; background: var(--accent); box-shadow: 0 8px 20px #3b82f630; }
.tool-dock { flex-shrink: 0; width: 282px; padding: 16px; overflow-y: auto; border-radius: 14px; scrollbar-width: none; }.tool-dock header, .side-card header, .workspace-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tool-dock header { padding-bottom: 13px; border-bottom: 1px solid var(--border); }.tool-dock header span, .side-card header span, .workspace-head > div > span { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: 1.2px; }.tool-dock h3, .side-card h3 { margin: 3px 0 0; font-size: 16px; }.tool-dock header > .el-icon { color: var(--muted); cursor: pointer; }.dock-hint { color: var(--muted); font-size: 10px; line-height: 1.55; }.service-summary { display: flex; align-items: center; gap: 7px; margin-top: 13px; padding: 9px; border-radius: 9px; color: #22c55e; background: #22c55e12; font-size: 10px; }.service-summary.offline { color: #f87171; background: #ef444414; }.service-summary i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }.service-summary span { flex: 1; }.service-summary button { border: 0; background: none; color: inherit; cursor: pointer; }.service-error { color: #f87171; font-size: 10px; word-break: break-word; }
.source-list, .picker { display: grid; gap: 8px; }.source-list > button { position: relative; display: flex; align-items: center; gap: 9px; min-height: 78px; padding: 11px; border: 1px solid var(--border); border-radius: 11px; background: var(--field); color: var(--text); text-align: left; }.source-list > button.selected { border-color: var(--accent); background: var(--accent-soft); }.source-list > button.disabled { opacity: .55; }.source-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--accent); background: var(--accent-soft); }.source-copy { min-width: 0; display: grid; flex: 1; gap: 2px; }.source-copy b { font-size: 12px; }.source-copy small { color: var(--muted); font-size: 9px; line-height: 1.4; }.source-copy em { color: var(--accent); font-size: 8px; font-style: normal; }.source-state { position: absolute; top: 7px; right: 8px; color: var(--muted); font-size: 8px; }.source-state.available { color: #22c55e; }.source-note { display: flex; gap: 7px; margin-top: 10px; padding: 9px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); }.source-note .el-icon { flex-shrink: 0; color: var(--accent); }.source-note p { margin: 0; font-size: 9px; line-height: 1.5; }
.picker button, .map-theme { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }.map-theme { justify-content: center; gap: 7px; margin-top: 10px; }
.studio-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }.content-row { flex: 1; min-height: 0; display: flex; gap: 10px; }.center-workspace { flex: 1; min-width: 0; position: relative; overflow: auto; border-radius: 14px; scrollbar-width: thin; }.workspace-head { padding: 14px 16px; border-bottom: 1px solid var(--border); }.workspace-head h2 { display: inline; margin: 0 9px 0 0; font-size: 18px; }.workspace-head small { color: var(--muted); font: 9px monospace; }.workspace-actions { display: flex; }.result-empty { height: calc(100% - 70px); min-height: 430px; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--muted); text-align: center; }.result-empty .el-icon { color: var(--accent); font-size: 38px; }.result-empty b { color: var(--text); font-size: 16px; }.result-empty span { font-size: 10px; }.result-toolbar { display: flex; justify-content: space-between; padding: 8px 12px; color: var(--muted); font-size: 10px; }.result-toolbar span { display: flex; align-items: center; gap: 6px; }.result-toolbar i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.result-toolbar b { color: var(--text); font: 10px monospace; }.visual-map { position: relative; height: calc(100% - 164px); min-height: 430px; margin: 0 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: #07101e; }.timebar { display: flex; align-items: center; gap: 7px; margin: 9px 10px 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }.timebar :deep(.el-slider) { flex: 1; margin: 0 8px; }.timebar time { min-width: 138px; font: 9px monospace; }.timebar > span { min-width: 38px; color: var(--muted); font-size: 9px; text-align: right; }
.right-sidebar { flex-shrink: 0; width: 272px; height: 100%; min-height: 0; display: grid; grid-template-rows: minmax(0, 3fr) minmax(0, 4fr) minmax(0, 3fr); align-self: stretch; gap: 9px; overflow: hidden; }.side-card { min-height: 0; display: flex; flex-direction: column; padding: 11px; overflow: hidden; border-radius: 13px; }.side-card header { flex-shrink: 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }.side-card header h3 { font-size: 14px; }.side-card header > span { color: var(--muted); }.side-card header > .panel-count { min-width: 24px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--field); font-size: 10px; letter-spacing: 0; text-align: center; }.side-card header > i { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.side-card header > i.ready { background: #22c55e; box-shadow: 0 0 8px #22c55e88; }.side-card header > i.error { background: #ef4444; box-shadow: 0 0 8px #ef444466; }.side-card-body, .task-items { flex: 1; min-height: 0; padding-right: 3px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }.side-card-actions { flex-shrink: 0; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--border); }.pool-provider { padding-top: 8px; }.provider-head { display: flex; justify-content: space-between; font-size: 10px; }.provider-head span { color: var(--muted); }.pool-provider article, .task-items article { position: relative; margin-top: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); transition: border-color .16s ease, background .16s ease, transform .16s ease; }.pool-provider article.target { border-color: #22c55e66; }.cycle-head, .task-items article > div { display: flex; align-items: center; justify-content: space-between; gap: 6px; }.pool-provider article b, .task-items article b { font-size: 10px; }.pool-provider article span { color: #22c55e; font-size: 8px; }.pool-provider article span.downloading { color: #38bdf8; }.pool-provider article span.missing, .pool-provider article span.partial { color: #f59e0b; }.pool-provider article span.error { color: #f87171; }.pool-provider article small, .task-items article small { display: block; margin-top: 4px; padding-right: 16px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.pool-provider article :deep(.el-progress), .running-card article :deep(.el-progress) { margin-top: 5px; }.cycle-actions { display: flex; align-items: center; min-height: 15px; margin-top: 3px; }.cycle-actions em { color: #f59e0b; font-size: 8px; font-style: normal; }.cycle-cleanup { padding: 0; border: 0; background: transparent; color: #f87171; font-size: 8px; cursor: pointer; }.side-empty { display: grid; min-height: 54px; place-items: center; padding: 12px 5px; color: var(--muted); font-size: 9px; text-align: center; }.side-empty.compact { padding: 8px 4px 2px; }.cleanup-warning { display: grid; gap: 4px; margin-top: 8px; padding: 8px; border-radius: 8px; color: #f87171; background: #ef444414; font-size: 9px; }.cleanup-warning button, .side-action { border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }.side-action { width: 100%; min-height: 30px; margin: 0; padding: 6px 8px; border-radius: 7px; color: var(--accent); background: var(--accent-soft); font-size: 9px; text-align: center; }.side-action:hover { background: #3b82f626; }.side-action:disabled, .cycle-cleanup:disabled { cursor: wait; opacity: .55; }
.cycle-transfer { margin-top: 4px; overflow: hidden; color: #38bdf8; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.pool-scope { display: block; margin-top: 3px; color: var(--muted); font-size: 9px; }
.pool-provider article.task-required { border-color: #60a5fa99; box-shadow: inset 2px 0 0 #60a5fa; }
.task-items article { cursor: pointer; }.task-items article:hover { border-color: #60a5fa88; transform: translateY(-1px); }.task-items article.selected { border-color: var(--accent); background: var(--accent-soft); }.task-items article strong { color: var(--accent); font-size: 10px; }.mini-status { padding: 2px 5px; border-radius: 7px; color: #64748b; background: #64748b22; font-size: 8px; }.mini-status.succeeded { color: #22c55e; background: #22c55e18; }.mini-status.partial_success { color: #f59e0b; background: #f59e0b18; }.mini-status.failed, .mini-status.waiting_restart, .mini-status.cancelled { color: #f87171; background: #ef444418; }.mini-status.paused_external, .mini-status.reconciling { color: #f59e0b; background: #f59e0b18; }.delete-task { position: absolute; right: 7px; bottom: 6px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #f87171; font-size: 13px; line-height: 18px; cursor: pointer; }.delete-task:hover { background: #ef444418; }.new-task { flex-shrink: 0; width: 100%; min-height: 31px; margin-top: 7px; padding: 7px; border: 1px dashed #22c55e; border-radius: 8px; background: #22c55e0b; color: #22c55e; font-size: 9px; font-weight: 700; cursor: pointer; }.new-task:hover { background: #22c55e18; }.running-card .task-items article { padding-bottom: 8px; }
.status-footer { flex-shrink: 0; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 13px; border-radius: 13px; }.footer-title { display: flex; align-items: center; gap: 9px; }.pulse { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent-soft); }.pulse i, .footer-service i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; }.pulse.offline i, .footer-service.offline i { background: #ef4444; box-shadow: 0 0 8px #ef4444; }.footer-title div { display: grid; gap: 2px; }.footer-title b { font-size: 11px; }.footer-title small { max-width: 230px; overflow: hidden; color: var(--muted); font: 8px monospace; text-overflow: ellipsis; white-space: nowrap; }.workflow { display: flex; align-items: center; gap: 6px; }.workflow span { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; }.workflow span i { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--border); border-radius: 50%; font-style: normal; }.workflow span.done { color: var(--text); }.workflow span.done i { border-color: var(--accent); color: #fff; background: var(--accent); }.workflow span.active i { box-shadow: 0 0 8px var(--accent); }.workflow em { width: 24px; height: 1px; background: var(--border); }.footer-service { display: flex; align-items: center; gap: 6px; color: #22c55e; font-size: 9px; }.footer-service.offline { color: #f87171; }
@media (max-width: 1250px) { .right-sidebar { width: 245px; }.tool-dock { width: 250px; }.workflow em { width: 12px; } }
@media (max-width: 980px) { .tool-dock { position: absolute; top: 70px; bottom: 8px; left: 88px; z-index: 20; }.right-sidebar { width: 225px; }.workflow { display: none; } }
@media (max-width: 760px) { .wrf-studio { height: auto; min-height: calc(100vh - 70px); overflow: visible; }.tool-rail { position: sticky; top: 70px; height: calc(100vh - 78px); }.studio-main, .content-row { min-height: 900px; }.content-row { flex-direction: column; }.right-sidebar { width: 100%; height: auto; grid-template-rows: 280px 340px 280px; overflow: visible; }.center-workspace { min-height: 620px; }.status-footer { position: sticky; bottom: 0; }.timebar { flex-wrap: wrap; }.timebar time { min-width: 0; } }

/* WRF 工作台的信息密度较高，但交互文字不应低于 11px。 */
.tool-rail button, .dock-hint, .service-summary, .service-error,
.source-copy small, .source-note p, .picker button, .map-theme,
.result-toolbar, .provider-head, .pool-provider article b,
.task-items article b, .side-empty, .cleanup-warning, .side-action,
.footer-title b, .footer-service { font-size: 11px; }
.source-copy b, .side-card header h3 { font-size: 13px; }
.source-copy em, .source-state, .pool-provider article span,
.pool-provider article p, .pool-provider article small,
.task-items article p, .task-items article small, .mini-status,
.delete-task, .cycle-cleanup, .pool-provider article em { font-size: 10px; }
.tool-dock header span, .side-card header span, .workspace-head > div > span,
.result-toolbar b, .timebar time, .timebar > span, .workflow span,
.footer-title small { font-size: 10px; }
</style>
