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
        <div class="service-summary" :class="{ offline: !serviceOnline }"><i></i><span>{{ serviceOnline ? `backend_wrf · 8007 · ${hpcModeLabel} · 最多 ${maxConcurrentTasks} 任务` : 'WRF 服务未连接' }}</span><button v-if="!serviceOnline" @click="refreshAll(true)">重试</button></div>
        <p v-if="serviceError" class="service-error">{{ serviceError }}</p>
        <p class="dock-hint">选择 WRF 驱动资料。当前版本仅开放 GFS 00Z，其他资料源保留扩展位置。</p>
        <div class="source-list">
          <button v-for="source in sources" :key="source.id" :class="{ selected: source.status === 'available', disabled: source.status !== 'available' }" @click="selectSource(source)">
            <span class="source-icon"><el-icon><DataAnalysis /></el-icon></span>
            <span class="source-copy"><b>{{ source.name }}</b><small>{{ source.description }}</small><em>{{ source.provider }}</em></span>
            <span :class="['source-state', source.status]">{{ source.status === 'available' ? '已接入' : '待接入' }}</span>
          </button>
        </div>
        <div class="source-note"><el-icon><InfoFilled /></el-icon><p>GFS 完整文件由超算脚本统一下载和校验；工作台只提交运行配置，并从超算拉取 WRF 结果。</p></div>
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
              <div class="result-toolbar"><span><i></i>GFS · {{ visualInfo?.element || 'WRF 结果' }}</span><b>{{ currentVisualTime || '等待时次' }}</b></div>
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

          <WrfTaskConfig v-else-if="workspaceView === 'new'" :options="options" :submitting="submitting" @submit="submitTask" @cancel="cancelConfig" />
          <WrfTaskRun v-else :task="selectedTask" :logs="logs" @cancel="cancelTask" @retry="retryTask" @retry-outputs="retryTaskOutputs" @render-partial="renderPartialTask" @result="showResult(selectedTask)" @back="showLatestResult" />
        </section>

        <aside class="right-sidebar">
          <section class="side-card glass data-pool">
            <header><div><span>FORECAST POOL</span><h3>预报数据池</h3></div><i :class="dataStatus?.status"></i></header>
            <template v-if="hpcAuthenticated">
              <div v-for="item in poolItems" :key="item.provider" class="pool-provider">
                <div class="provider-head"><b>{{ item.label }}</b><span>{{ poolStatus(item.status) }}</span></div>
                <article v-for="cycle in item.cycles" :key="cycle.cycle" :class="{ target: cycle.target }">
                  <div><b>{{ formatCycle(cycle.cycle) }}</b><span :class="cycle.status">{{ cycleLabel(cycle) }}</span></div>
                  <p>f{{ padHour(cycle.forecast_start) }}–f{{ padHour(cycle.forecast_end) }} · {{ cycle.completed_files }}/{{ cycle.total_files }}</p>
                  <el-progress :percentage="cyclePercent(cycle)" :stroke-width="4" :show-text="false" />
                  <small>{{ formatBytes(cycle.size_bytes) }} · {{ item.source }}</small>
                  <code :title="cycle.remote_path">{{ cycle.remote_path || '远端路径待确认' }}</code>
                  <p v-if="cycle.download_message" :class="['download-message', { error: cycle.status === 'error' }]" :title="cycle.download_message">日志：{{ cycle.download_message }}</p>
                  <button v-if="cycle.cleanup_allowed" class="cycle-cleanup" :disabled="gfsActionBusy" @click="confirmCleanupCycle(cycle)">清理旧周期</button>
                  <em v-else-if="cycle.protected && !cycle.target">运行中任务正在使用</em>
                </article>
                <div v-if="!item.cycles?.length" class="side-empty">{{ dataStatus?.message || '超算数据池暂无周期' }}</div>
              </div>
              <button class="side-action" :disabled="gfsActionBusy" @click="syncLatestRemoteGfs">{{ gfsActionBusy ? '正在检查并同步…' : '检查并同步最近两个 00Z 周期' }}</button>
            </template>
            <template v-else>
              <div class="side-empty">输入超算密码后显示和管理远端数据池</div>
              <button class="side-action" @click="authenticateAndSync(false)">连接超算</button>
            </template>
          </section>

          <section class="side-card glass history-card">
            <header><div><span>HISTORY</span><h3>历史任务</h3></div><span>{{ historyTasks.length }}</span></header>
            <div class="task-items">
              <article v-for="task in historyTasks" :key="task.id" :class="{ selected: task.id === activeTaskId }" @click="openHistoryTask(task)">
                <div><b>{{ taskDateRange(task) }}</b><span :class="['mini-status', task.status]">{{ taskStatus(task.status) }}</span></div>
                <p>{{ task.id }}</p><small>{{ task.request?.domains?.length || 0 }} 域 · {{ task.runtime?.gfs_cycle || '无 cycle' }}</small>
                <button class="delete-task" title="删除本地任务数据" @click.stop="confirmDelete(task)">删除</button>
              </article>
              <div v-if="!historyTasks.length" class="side-empty">暂无历史任务</div>
            </div>
            <button class="new-task" @click="openNewTask">＋ 新建任务</button>
          </section>

          <section class="side-card glass running-card">
            <header><div><span>RUNNING</span><h3>正在进行</h3></div><span>{{ runningTasks.length }}</span></header>
            <div class="task-items">
              <article v-for="task in runningTasks" :key="task.id" :class="{ selected: task.id === selectedTaskId }" @click="showRun(task)">
                <div><b>{{ taskStatus(task.status) }}</b><strong>{{ task.progress || 0 }}%</strong></div>
                <p>{{ task.id }}</p><el-progress :percentage="task.progress || 0" :stroke-width="4" :show-text="false" /><small>{{ task.stage }}</small>
              </article>
              <div v-if="!runningTasks.length" class="side-empty">当前没有运行中的任务</div>
            </div>
          </section>
        </aside>
      </div>

      <footer class="status-footer glass">
        <div class="footer-title"><span :class="['pulse', { offline: !serviceOnline }]"><i></i></span><div><b>WRF 数值预报工作台</b><small>{{ footerTaskSummary }}</small></div></div>
        <div class="workflow"><span class="done"><i>1</i>选择数据源</span><em></em><span :class="{ done: !!activeTaskId || !!resultTaskId, active: workspaceView === 'new' }"><i>2</i>配置任务</span><em></em><span :class="{ done: isDisplayable(selectedTask), active: workspaceView === 'run' && !isDisplayable(selectedTask) }"><i>3</i>超算运行</span><em></em><span :class="{ done: !!resultTaskId, active: workspaceView === 'result' && !!resultTaskId }"><i>4</i>查看结果</span></div>
        <div :class="['footer-service', { offline: !serviceOnline }]"><i></i>{{ serviceOnline ? `${hpcModeLabel} ${health?.hpc?.status || 'checking'} · ${activeTaskCount}/${maxConcurrentTasks}` : '服务离线' }}</div>
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
  authenticateWrfHpc, cancelWrfTask, cleanupWrfGfs, createWrfTask, deleteWrfTask, getWrfDataStatus,
  getWrfHealth, getWrfOptions, getWrfTaskLogs, listWrfTasks,
  renderPartialWrfTask, retryWrfTask, retryWrfTaskOutputs, syncLatestWrfGfs,
} from "../api.js";
import ProjMap from "../components/ProjMap.vue";
import WrfTaskConfig from "../components/WrfTaskConfig.vue";
import WrfTaskRun from "../components/WrfTaskRun.vue";
import WrfResultLayer from "../components/WrfResultLayer.vue";

const route = useRoute();
const router = useRouter();
const theme = inject("theme", ref(true));
const FINAL = new Set(["succeeded", "partial_success", "failed", "cancelled"]);
const sources = [
  { id: "gfs", name: "GFS 全球预报", description: "0.25° WRF 必需场，超算共享数据池", provider: "NOAA NOMADS", status: "available" },
  { id: "ecmwf", name: "ECMWF IFS", description: "欧洲中心全球预报资料", provider: "ECMWF Open Data", status: "planned" },
  { id: "era5", name: "ERA5 再分析", description: "历史再分析驱动资料", provider: "Copernicus CDS", status: "planned" },
];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];

const tool = ref("source");
const dockOpen = ref(true);
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const showGrid = ref(true);
const showVector = ref(true);
const mapDark = ref(Boolean(theme.value));
const workspaceView = ref("result");
const options = ref(null);
const health = ref(null);
const dataStatus = ref(null);
const tasks = ref([]);
const serviceError = ref("");
const submitting = ref(false);
const gfsActionBusy = ref(false);
const hpcAuthenticated = ref(false);
const selectedTaskId = ref("");
const resultTaskId = ref("");
const logs = ref("");
const logOffset = ref(0);
const visualTimes = ref([]);
const visualTimeIndex = ref(0);
const visualInfo = ref(null);
const visualPlaying = ref(false);
let refreshTimer = null;
let playbackTimer = null;

const serviceOnline = computed(() => health.value?.status === "online" && !serviceError.value);
const selectedTask = computed(() => tasks.value.find(task => task.id === selectedTaskId.value) || null);
const successfulTasks = computed(() => tasks.value.filter(task => isDisplayable(task)));
const historyTasks = computed(() => tasks.value.filter(task => FINAL.has(task.status)));
const runningTasks = computed(() => tasks.value.filter(task => !FINAL.has(task.status)));
const activeTaskId = computed(() => selectedTaskId.value || resultTaskId.value || health.value?.active_task_id || "");
const hpcModeLabel = computed(() => health.value?.hpc?.connection_mode === "direct" ? "HPC 直连" : "堡垒机");
const activeTaskCount = computed(() => Number(health.value?.active_task_count) || 0);
const maxConcurrentTasks = computed(() => Number(health.value?.max_concurrent_tasks || options.value?.capabilities?.max_concurrent_tasks) || 3);
const footerTaskSummary = computed(() => {
  if (selectedTaskId.value || resultTaskId.value) return selectedTaskId.value || resultTaskId.value;
  if (activeTaskCount.value) return `${activeTaskCount.value}/${maxConcurrentTasks.value} 个任务执行中`;
  return `GFS 00Z 驱动 · 最多 ${maxConcurrentTasks.value} 任务并行`;
});
const currentVisualTime = computed(() => visualTimes.value[visualTimeIndex.value] || "");
const poolItems = computed(() => {
  if (Array.isArray(dataStatus.value?.pool_items)) return dataStatus.value.pool_items;
  return [{ provider: "gfs", label: "GFS", source: "NOAA NOMADS", status: dataStatus.value?.status || "idle", cycles: [] }];
});
const dockTitle = computed(() => ({ source: "数据源选择", proj: "投影方式", base: "底图图层" })[tool.value]);

function openTool(name) { if (dockOpen.value && tool.value === name) dockOpen.value = false; else { tool.value = name; dockOpen.value = true; } }
function selectSource(source) { if (source.status !== "available") ElMessage.info(`${source.name} 尚未接入，当前仅支持 GFS`); }
function isDisplayable(task) { return Boolean(task && ["succeeded", "partial_success"].includes(task.status)); }
function taskStatus(value) { return ({ queued: "排队", prefetching: "准备数据", uploading: "准备超算", running: "运行", rendering: "渲染", succeeded: "成功", partial_success: "部分完成", failed: "失败", cancelled: "已取消", cancel_pending: "取消中", reconciling: "对账" })[value] || value; }
function poolStatus(value) { return ({ ready: "已就绪", downloading: "下载中", checking: "检查中", partial: "部分就绪", missing: "待下载", unavailable: "不可用", error: "异常", idle: "等待" })[value] || value || "等待"; }
function cycleLabel(cycle) {
  const status = poolStatus(cycle?.status);
  if (cycle?.target) return `保留 · ${status}`;
  return cycle?.complete ? "旧周期" : status;
}
function syncActionMessage(result) {
  const labels = { ready: "已就绪", started: "已启动", running: "下载中", failed: "启动失败" };
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  if (!actions.length) return "超算周期同步请求已提交";
  return actions.map(action => `${formatCycle(action.cycle)}：${labels[action.status] || action.status}${action.detail ? `（${action.detail}）` : ""}`).join("；");
}
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(2)} GB`; }
function formatCycle(value) { const text = String(value || ""); return text.length === 10 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8)}Z` : text; }
function padHour(value) { return value == null ? "---" : String(value).padStart(3, "0"); }
function cyclePercent(cycle) { return Math.round((Number(cycle.completed_files) || 0) / Math.max(1, Number(cycle.total_files) || 0) * 100); }
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
function openNewTask() { stopPlayback(); routeTo("new"); }
async function cancelConfig() {
  try { await ElMessageBox.confirm("当前未提交的任务配置不会保存，确定返回可视化？", "离开配置", { type: "warning" }); showLatestResult(); } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
function showRun(task) { if (!task) return; selectedTaskId.value = task.id; resetLogs(); routeTo("run", task.id); }
function showResult(task) { if (!isDisplayable(task)) return; resultTaskId.value = task.id; routeTo("result", task.id); }
function showLatestResult() { const task = successfulTasks.value[0]; routeTo("result", task?.id || ""); }
function openHistoryTask(task) { if (isDisplayable(task)) showResult(task); else showRun(task); }

function resetLogs() { logs.value = ""; logOffset.value = 0; }
function resetVisualization() { stopPlayback(); visualTimes.value = []; visualTimeIndex.value = 0; visualInfo.value = null; }
function onDisplayLoaded(payload) { visualTimes.value = Array.isArray(payload?.times) ? payload.times : []; setVisualTime(visualTimeIndex.value); }
function onVariableChange(payload) { visualInfo.value = payload; if (Array.isArray(payload?.times)) { visualTimes.value = payload.times; setVisualTime(visualTimeIndex.value); } }
function setVisualTime(value) { visualTimeIndex.value = Math.max(0, Math.min(Number(value) || 0, Math.max(0, visualTimes.value.length - 1))); }
function stopPlayback() { visualPlaying.value = false; clearInterval(playbackTimer); playbackTimer = null; }
function togglePlayback() { if (visualPlaying.value) { stopPlayback(); return; } if (visualTimes.value.length < 2) return; visualPlaying.value = true; playbackTimer = setInterval(() => setVisualTime(visualTimeIndex.value + 1 >= visualTimes.value.length ? 0 : visualTimeIndex.value + 1), 900); }

async function refreshAll(showMessage = false, includeRemote = hpcAuthenticated.value) {
  try { health.value = await getWrfHealth(); serviceError.value = ""; } catch (error) { if (!health.value) health.value = { status: "offline", hpc: { status: "unavailable" } }; serviceError.value = error.message; if (showMessage) ElMessage.error(error.message); }
  if (includeRemote) {
    try { dataStatus.value = await getWrfDataStatus(); } catch (error) { dataStatus.value = { status: "error", message: error.message, pool_items: [] }; }
  } else {
    dataStatus.value = { status: "locked", message: "等待超算认证", pool_items: [] };
  }
  try {
    tasks.value = await listWrfTasks();
    if (workspaceView.value === "result" && !tasks.value.some(task => task.id === resultTaskId.value && isDisplayable(task))) resultTaskId.value = successfulTasks.value[0]?.id || "";
    if (workspaceView.value === "run" && selectedTaskId.value) await refreshLogs();
  } catch (error) { if (showMessage) ElMessage.error(error.message); }
}
async function refreshLogs() {
  if (!selectedTaskId.value) return;
  try { const chunk = await getWrfTaskLogs(selectedTaskId.value, logOffset.value); logs.value += chunk.text || ""; logOffset.value = chunk.offset || logOffset.value; } catch { /* 主轮询会继续重试 */ }
}
async function ensureHpcReady(confirmButtonText, forcePrompt = false) {
  const hpc = health.value?.hpc || {};
  if (!forcePrompt && hpcAuthenticated.value && hpc.status === "ready") return;
  if (!serviceOnline.value) throw new Error(serviceError.value || "WRF 服务未连接");
  const { value } = await ElMessageBox.prompt(
    "请输入超算登录密码。密码仅保存在 backend_wrf 进程内存中，不会写入任务、数据库或日志。",
    "连接超算",
    {
      inputType: "password",
      inputPlaceholder: "超算登录密码",
      confirmButtonText,
      cancelButtonText: "取消",
      inputValidator: input => Boolean(input) || "请输入超算登录密码",
    },
  );
  health.value = { ...(health.value || {}), hpc: await authenticateWrfHpc(value) };
  hpcAuthenticated.value = true;
  ElMessage.success("超算认证成功");
}

async function authenticateAndSync(forcePrompt = false) {
  gfsActionBusy.value = true;
  try {
    await ensureHpcReady("认证并同步", forcePrompt);
  } catch (error) {
    hpcAuthenticated.value = false;
    dataStatus.value = { status: "locked", message: "等待超算认证", pool_items: [] };
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message);
    gfsActionBusy.value = false;
    return;
  }
  try {
    const result = await syncLatestWrfGfs();
    ElMessage.success(syncActionMessage(result));
    await refreshAll(false, true);
  } catch (error) {
    ElMessage.error(error.message);
    await refreshAll(false, true);
  } finally {
    gfsActionBusy.value = false;
  }
}
async function submitTask(payload) {
  submitting.value = true;
  try {
    await ensureHpcReady("认证并提交");
    const task = await createWrfTask(payload);
    ElMessage.success("WRF 任务已进入并行队列");
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
    ? `将终止任务 ${task.id} 对应的超算远端进程，是否继续？`
    : `将取消任务 ${task.id} 的排队或超算准备，不会启动远端 WRF，是否继续？`;
  try { await ElMessageBox.confirm(message, "取消 WRF 任务", { type: "warning", confirmButtonText: "确认取消" }); await cancelWrfTask(task.id); ElMessage.success(launched ? "远端取消请求已转入后台处理" : "任务已取消"); await refreshAll(); } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function retryTask() {
  if (!selectedTask.value) return;
  try { const task = await retryWrfTask(selectedTask.value.id); ElMessage.success("已创建新的重试任务"); await refreshAll(); showRun(task); } catch (error) { ElMessage.error(error.message); }
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
    await ElMessageBox.confirm("将跳过完整性校验失败的 wrfout 帧，并在 scene.meta.json 中记录缺失时次和质量告警。是否继续？", "部分渲染", { type: "warning", confirmButtonText: "确认忽略坏帧" });
    const task = await renderPartialWrfTask(selectedTask.value.id);
    ElMessage.success("已加入部分渲染队列"); await refreshAll(); showRun(task);
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function confirmDelete(task) {
  try {
    await ElMessageBox.confirm(`将删除本地任务 ${task.id} 的数据库记录、日志、raw wrfout、WebP 和元数据。超算远端目录不会删除。`, "删除 WRF 本地任务", { type: "error", confirmButtonText: "确认删除" });
    await deleteWrfTask(task.id); ElMessage.success("本地任务数据已删除");
    if (selectedTaskId.value === task.id) selectedTaskId.value = "";
    if (resultTaskId.value === task.id) resultTaskId.value = "";
    await refreshAll(); showLatestResult();
  } catch (error) { if (error !== "cancel" && error !== "close") ElMessage.error(error.message); }
}
async function syncLatestRemoteGfs() {
  gfsActionBusy.value = true;
  try {
    await ensureHpcReady("认证并同步");
    const result = await syncLatestWrfGfs();
    ElMessage.success(syncActionMessage(result));
    await refreshAll(false, true);
  }
  catch (error) { ElMessage.error(error.message); }
  finally { gfsActionBusy.value = false; }
}

async function confirmCleanupCycle(cycle) {
  const path = String(cycle?.remote_path || "");
  if (!path) return;
  try {
    await ElMessageBox.confirm(
      `将永久删除超算旧 GFS 周期：\n${path}\n\n目标周期、下载中周期和运行中任务使用的周期不会被删除。`,
      "清理超算旧数据",
      { type: "error", confirmButtonText: "确认删除此路径" },
    );
    gfsActionBusy.value = true;
    await cleanupWrfGfs([path]);
    ElMessage.success(`已清理 ${path}`);
    await refreshAll(false, true);
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
  await authenticateAndSync(true);
  refreshTimer = setInterval(() => refreshAll(false, hpcAuthenticated.value), 5000);
});
onBeforeUnmount(() => { clearInterval(refreshTimer); stopPlayback(); });
</script>

<style scoped>
.wrf-studio { height: calc(100vh - 70px); display: flex; gap: 10px; padding: 0 8px 8px; overflow: hidden; background: var(--bg); color: var(--text); }.glass { border: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--shadow); }
.tool-rail { flex-shrink: 0; width: 70px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 5px; border-radius: 14px; }.tool-rail button { width: 56px; min-height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 11px; background: transparent; color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; }.tool-rail button .el-icon, .tool-rail button b { font-size: 17px; }.tool-rail button.on { color: #fff; background: var(--accent); box-shadow: 0 8px 20px #3b82f630; }
.tool-dock { flex-shrink: 0; width: 282px; padding: 16px; overflow-y: auto; border-radius: 14px; scrollbar-width: none; }.tool-dock header, .side-card header, .workspace-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tool-dock header { padding-bottom: 13px; border-bottom: 1px solid var(--border); }.tool-dock header span, .side-card header span, .workspace-head > div > span { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: 1.2px; }.tool-dock h3, .side-card h3 { margin: 3px 0 0; font-size: 16px; }.tool-dock header > .el-icon { color: var(--muted); cursor: pointer; }.dock-hint { color: var(--muted); font-size: 10px; line-height: 1.55; }.service-summary { display: flex; align-items: center; gap: 7px; margin-top: 13px; padding: 9px; border-radius: 9px; color: #22c55e; background: #22c55e12; font-size: 10px; }.service-summary.offline { color: #f87171; background: #ef444414; }.service-summary i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }.service-summary span { flex: 1; }.service-summary button { border: 0; background: none; color: inherit; cursor: pointer; }.service-error { color: #f87171; font-size: 10px; word-break: break-word; }
.source-list, .picker { display: grid; gap: 8px; }.source-list > button { position: relative; display: flex; align-items: center; gap: 9px; min-height: 78px; padding: 11px; border: 1px solid var(--border); border-radius: 11px; background: var(--field); color: var(--text); text-align: left; }.source-list > button.selected { border-color: var(--accent); background: var(--accent-soft); }.source-list > button.disabled { opacity: .55; }.source-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--accent); background: var(--accent-soft); }.source-copy { min-width: 0; display: grid; flex: 1; gap: 2px; }.source-copy b { font-size: 12px; }.source-copy small { color: var(--muted); font-size: 9px; line-height: 1.4; }.source-copy em { color: var(--accent); font-size: 8px; font-style: normal; }.source-state { position: absolute; top: 7px; right: 8px; color: var(--muted); font-size: 8px; }.source-state.available { color: #22c55e; }.source-note { display: flex; gap: 7px; margin-top: 10px; padding: 9px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); }.source-note .el-icon { flex-shrink: 0; color: var(--accent); }.source-note p { margin: 0; font-size: 9px; line-height: 1.5; }
.picker button, .map-theme { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }.map-theme { justify-content: center; gap: 7px; margin-top: 10px; }
.studio-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }.content-row { flex: 1; min-height: 0; display: flex; gap: 10px; }.center-workspace { flex: 1; min-width: 0; position: relative; overflow: auto; border-radius: 14px; scrollbar-width: thin; }.workspace-head { padding: 14px 16px; border-bottom: 1px solid var(--border); }.workspace-head h2 { display: inline; margin: 0 9px 0 0; font-size: 18px; }.workspace-head small { color: var(--muted); font: 9px monospace; }.workspace-actions { display: flex; }.result-empty { height: calc(100% - 70px); min-height: 430px; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--muted); text-align: center; }.result-empty .el-icon { color: var(--accent); font-size: 38px; }.result-empty b { color: var(--text); font-size: 16px; }.result-empty span { font-size: 10px; }.result-toolbar { display: flex; justify-content: space-between; padding: 8px 12px; color: var(--muted); font-size: 10px; }.result-toolbar span { display: flex; align-items: center; gap: 6px; }.result-toolbar i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.result-toolbar b { color: var(--text); font: 10px monospace; }.visual-map { position: relative; height: calc(100% - 164px); min-height: 430px; margin: 0 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: #07101e; }.timebar { display: flex; align-items: center; gap: 7px; margin: 9px 10px 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }.timebar :deep(.el-slider) { flex: 1; margin: 0 8px; }.timebar time { min-width: 138px; font: 9px monospace; }.timebar > span { min-width: 38px; color: var(--muted); font-size: 9px; text-align: right; }
.right-sidebar { flex-shrink: 0; width: 272px; display: flex; flex-direction: column; gap: 9px; overflow-y: auto; scrollbar-width: none; }.side-card { padding: 12px; border-radius: 13px; }.side-card header { padding-bottom: 9px; border-bottom: 1px solid var(--border); }.side-card header h3 { font-size: 14px; }.side-card header > span { color: var(--muted); }.side-card header > i { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.side-card header > i.ready { background: #22c55e; }.side-card header > i.error { background: #ef4444; }.pool-provider { padding-top: 9px; }.provider-head { display: flex; justify-content: space-between; font-size: 10px; }.provider-head span { color: var(--muted); }.pool-provider article, .task-items article { position: relative; margin-top: 7px; padding: 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }.pool-provider article.target { border-color: #22c55e66; }.pool-provider article > div, .task-items article > div { display: flex; justify-content: space-between; gap: 6px; }.pool-provider article b, .task-items article b { font-size: 10px; }.pool-provider article span { color: #22c55e; font-size: 8px; }.pool-provider article span.downloading { color: #38bdf8; }.pool-provider article span.missing, .pool-provider article span.partial { color: #f59e0b; }.pool-provider article span.error { color: #f87171; }.pool-provider article p, .task-items article p { margin: 4px 0; overflow: hidden; color: var(--muted); font: 8px monospace; text-overflow: ellipsis; white-space: nowrap; }.pool-provider article p.download-message { white-space: normal; word-break: break-word; }.pool-provider article p.download-message.error { color: #f87171; }.pool-provider article small, .task-items article small { color: var(--muted); font-size: 8px; }.pool-provider article code { display: block; margin-top: 5px; overflow: hidden; color: #64748b; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }.pool-provider article em { display: block; margin-top: 5px; color: #f59e0b; font-size: 8px; font-style: normal; }.cycle-cleanup { margin-top: 6px; padding: 0; border: 0; background: transparent; color: #f87171; font-size: 8px; cursor: pointer; }.side-empty { padding: 15px 5px; color: var(--muted); font-size: 9px; text-align: center; }.cleanup-warning { display: grid; gap: 4px; margin-top: 8px; padding: 8px; border-radius: 8px; color: #f87171; background: #ef444414; font-size: 9px; }.cleanup-warning button, .side-action { border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }.side-action { width: 100%; margin-top: 7px; color: var(--accent); font-size: 9px; }.side-action:disabled, .cycle-cleanup:disabled { cursor: wait; opacity: .55; }
.history-card { flex: 1; min-height: 220px; }.task-items { max-height: 240px; overflow-y: auto; scrollbar-width: thin; }.task-items article { cursor: pointer; }.task-items article:hover, .task-items article.selected { border-color: var(--accent); }.task-items article strong { color: var(--accent); font-size: 10px; }.mini-status { padding: 2px 5px; border-radius: 7px; color: #64748b; background: #64748b22; font-size: 8px; }.mini-status.succeeded { color: #22c55e; background: #22c55e18; }.mini-status.partial_success { color: #f59e0b; background: #f59e0b18; }.mini-status.failed, .mini-status.cancelled { color: #f87171; background: #ef444418; }.delete-task { position: absolute; right: 7px; bottom: 6px; border: 0; background: transparent; color: #f87171; font-size: 8px; cursor: pointer; }.new-task { width: 100%; margin-top: 8px; padding: 9px; border: 1px dashed #22c55e; border-radius: 9px; background: #22c55e0c; color: #22c55e; font-weight: 700; cursor: pointer; }
.status-footer { flex-shrink: 0; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 13px; border-radius: 13px; }.footer-title { display: flex; align-items: center; gap: 9px; }.pulse { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent-soft); }.pulse i, .footer-service i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; }.pulse.offline i, .footer-service.offline i { background: #ef4444; box-shadow: 0 0 8px #ef4444; }.footer-title div { display: grid; gap: 2px; }.footer-title b { font-size: 11px; }.footer-title small { max-width: 230px; overflow: hidden; color: var(--muted); font: 8px monospace; text-overflow: ellipsis; white-space: nowrap; }.workflow { display: flex; align-items: center; gap: 6px; }.workflow span { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; }.workflow span i { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--border); border-radius: 50%; font-style: normal; }.workflow span.done { color: var(--text); }.workflow span.done i { border-color: var(--accent); color: #fff; background: var(--accent); }.workflow span.active i { box-shadow: 0 0 8px var(--accent); }.workflow em { width: 24px; height: 1px; background: var(--border); }.footer-service { display: flex; align-items: center; gap: 6px; color: #22c55e; font-size: 9px; }.footer-service.offline { color: #f87171; }
@media (max-width: 1250px) { .right-sidebar { width: 245px; }.tool-dock { width: 250px; }.workflow em { width: 12px; } }
@media (max-width: 980px) { .tool-dock { position: absolute; top: 70px; bottom: 8px; left: 88px; z-index: 20; }.right-sidebar { width: 225px; }.workflow { display: none; } }
@media (max-width: 760px) { .wrf-studio { height: auto; min-height: calc(100vh - 70px); overflow: visible; }.tool-rail { position: sticky; top: 70px; height: calc(100vh - 78px); }.studio-main, .content-row { min-height: 900px; }.content-row { flex-direction: column; }.right-sidebar { width: 100%; overflow: visible; }.center-workspace { min-height: 620px; }.status-footer { position: sticky; bottom: 0; }.timebar { flex-wrap: wrap; }.timebar time { min-width: 0; } }
</style>
