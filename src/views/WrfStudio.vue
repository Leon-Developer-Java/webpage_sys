<template>
  <div class="wrf-studio studio" @keydown.esc="sidebarOpen=false"><header class="studio-header"><h1>WRF 工作台</h1><nav><button @click="openNewTask">配置模拟</button><button :disabled="!selectedTask" @click="showRun(selectedTask)">运行过程</button><button :disabled="!isDisplayable(selectedTask)" @click="showResult(selectedTask)">可视化</button></nav><button ref="sidebarTrigger" :aria-expanded="sidebarOpen" aria-controls="wrf-task-sidebar" @click="sidebarOpen=!sidebarOpen">任务与资料 {{taskTotal}}</button></header>
    <aside v-if="workspaceView!=='new'" class="tool-rail glass">
      <button :class="{ on: dockOpen && tool === 'source' }" @click="openTool('source')"><el-icon><DataAnalysis /></el-icon><span>数据源</span></button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')"><el-icon><Position /></el-icon><span>投影</span></button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')"><el-icon><MapLocation /></el-icon><span>底图</span></button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid"><el-icon><Grid /></el-icon><span>经纬网</span></button>
      <button :class="{ on: showVector }" @click="showVector = !showVector"><b>界</b><span>边界</span></button>
    </aside>

    <section v-if="dockOpen && workspaceView!=='new'" class="tool-dock glass">
      <header><div><span>WRF 工作台</span><h3>{{ dockTitle }}</h3></div><el-icon @click="dockOpen = false"><Close /></el-icon></header>
      <template v-if="tool === 'source'">
        <div class="service-summary" :class="{ offline: !serviceOnline }"><i></i><span>{{ serviceOnline ? `backend_wrf · 8007 · ${hpcModeLabel}` : 'WRF 服务未连接' }}</span><button v-if="!serviceOnline" @click="refreshAll(true)">重试</button></div>
        <p v-if="serviceError" class="service-error">{{ txLabText(serviceError) }}</p>
        <div class="source-list">
          <button v-for="source in sources" :key="source.id" :class="{ selected: selectedSource === source.id, disabled: source.status !== 'available' }" @click="selectSource(source)">
            <span class="source-icon"><el-icon><DataAnalysis /></el-icon></span>
            <span class="source-copy"><b>{{ source.name }}</b><small>{{ source.description }}</small><em>{{ source.provider }}</em></span>
            <span :class="['source-state', source.status]">{{ source.status === 'available' ? '已接入' : '待接入' }}</span>
          </button>
        </div>
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
        <section :class="['center-workspace glass',{'editor-workspace':workspaceView==='new'}]"><p v-if="operationError && workspaceView!=='new'" class="operation-error" role="alert">{{operationError}}</p>
          <template v-if="workspaceView === 'result'">
            <header class="workspace-head">
              <div><span>WRF VISUALIZATION</span><h2>数值预报结果</h2><small>{{ resultLoading?'正在加载…':resultTaskId||'暂无可用结果' }}</small></div>
              <div class="workspace-actions"><el-button type="primary" @click="openNewTask">新建模拟任务</el-button></div>
            </header>
            <div v-if="resultLoading" class="result-empty" role="status"><b>正在加载可视化结果…</b></div>
            <div v-else-if="!resultTaskId" class="result-empty"><el-icon><Picture /></el-icon><b>暂无 WRF 可视化结果</b><span>{{operationError||'暂无可查看的已完成任务，请从历史任务选择或新建模拟。'}}</span><el-button type="primary" plain @click="openNewTask">新建模拟任务</el-button></div>
            <template v-else>
              <div class="result-toolbar"><span><i></i>{{ resultSourceLabel }} · {{ visualInfo?.element || 'WRF 结果' }}</span><b>{{ currentVisualTime || '等待时次' }}</b></div>
              <div class="visual-map">
                <ProjMap :key="`${resultTaskId}-${projection}`" :projection="projection" :basemap="basemap" :grid="showGrid" :vector="showVector" :dark="mapDark">
                  <WrfResultLayer :task-id="resultTaskId" :time-index="visualTimeIndex" :initial-domain="String(route.query.domain||'')" :initial-variable="String(route.query.variable||'')" @display-loaded="onDisplayLoaded" @variable-change="onVariableChange" />
                </ProjMap>
              </div>
              <div class="timebar">
                <el-button circle aria-label="第一帧" :icon="DArrowLeft" :disabled="visualTimes.length < 2" @click="setVisualTime(0)" />
                <el-button circle aria-label="上一帧" :icon="ArrowLeft" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimeIndex - 1)" />
                <el-button circle type="primary" :aria-label="visualPlaying ? '暂停' : '播放'" :icon="visualPlaying ? VideoPause : VideoPlay" :disabled="visualTimes.length < 2" @click="togglePlayback" />
                <el-button circle aria-label="下一帧" :icon="ArrowRight" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimeIndex + 1)" />
                <el-button circle aria-label="最后一帧" :icon="DArrowRight" :disabled="visualTimes.length < 2" @click="setVisualTime(visualTimes.length - 1)" />
                <el-slider v-model="visualTimeIndex" :min="0" :max="Math.max(0, visualTimes.length - 1)" :show-tooltip="false" @input="stopPlayback" />
                <time>{{ currentVisualTime || '暂无时次' }}</time><span>{{ visualTimes.length ? `${visualTimeIndex + 1}/${visualTimes.length}` : '0/0' }}</span>
              </div>
            </template>
          </template>

          <template v-else-if="workspaceView === 'new'">
            <p v-if="restartContext" class="restart-context">修改任务 {{ restartContext.taskId }} · 提交后新增第 {{ Number(restartContext.attemptNo||1)+1 }} 次尝试，旧记录保留。</p>
            <WrfTaskConfig
              :key="editorKey"
              :options="options"
              :data-source="selectedSource"
              :submitting="submitting"
              :initial-request="initialRequest" :service-ready="serviceOnline" :submit-error="operationError" :submit-label="restartContext?(submitting?'正在提交重跑…':'修改后重跑'):'开始模拟'" @change="saveDraft" @error="operationError=safeError($event)"
              @submit="submitTask"
              @cancel="cancelConfig"
            />
          </template>
          <WrfTaskRun
            v-else
            :task="selectedTask"
            :logs="logs"
            :log-attempt-no="logAttemptNo"
            @cancel="cancelTask"
            @resume="resumeTask"
            @edit-restart="editAndRestart" @delete="confirmDelete"
            @retry-outputs="retryTaskOutputs"
            @render-partial="renderPartialTask"
            @attempt-change="selectLogAttempt"
            @result="showResult(selectedTask)"
            @operation="manualOperation"
            @reuse="copyTask"
            @refresh="refreshAll(true)"
            @back="showLatestResult"
          />
        </section>

        <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭任务与资料" @click="sidebarOpen=false"></button><aside id="wrf-task-sidebar" ref="sidebarPanel" tabindex="-1" @keydown.tab="trapSidebarFocus" v-show="sidebarOpen" class="right-sidebar" aria-label="任务与资料" @keydown.esc="sidebarOpen=false">
          <section class="side-card glass data-pool">
            <header><div><span>FORECAST POOL</span><h3>预报数据池</h3></div><i :class="dataStatus?.status"></i></header>
            <div class="side-card-body">
              <template v-if="hpcAuthenticated">
                <div v-for="item in poolItems" :key="item.provider" class="pool-provider">
                  <div class="provider-head"><b>{{ item.label }}</b><span>{{ poolStatus(item.status) }}</span></div>
                  <small class="pool-scope">{{ poolDetail(item) }}</small>
                  <article
                    v-for="cycle in visiblePoolCycles(item)"
                    :key="cycle.cycle"
                    :class="{ target: cycle.target, 'task-required': cycle.task_required || cycle.task_priority }"
                  >
                    <div class="cycle-head"><b>{{ formatCycle(cycle.cycle) }}</b><span :class="cycle.status">{{ cycleLabel(cycle) }}</span></div>
                    <small>{{ cycle.completed_files }}/{{ cycle.total_files }} 文件 · {{ formatBytes(cycle.size_bytes) }}<template v-if="cycle.partial_size_bytes > 0"> · 当前分片 {{ formatBytes(cycle.partial_size_bytes) }}</template></small>
                    <div v-if="cycleTransferLabel(cycle)" class="cycle-transfer">
                      {{ cycleTransferLabel(cycle) }}<template v-if="cycle.status==='downloading' && cycle.download_rate_bps > 0"> · {{ formatRate(cycle.download_rate_bps) }}</template>
                    </div>
                    <el-progress :percentage="cyclePercent(cycle)" :stroke-width="4" :show-text="false" />
                    <div class="cycle-actions"><em>{{ cycleRetentionLabel(cycle) }}</em><button v-if="Number(getUser()?.role)>=3" class="cycle-delete" aria-label="删除资料周期" title="删除资料周期" :disabled="cycleDeleteBusy(item.provider,cycle.cycle)" @click="removeCycle(item.provider,cycle.cycle)">{{cycleDeleteBusy(item.provider,cycle.cycle)?'…':'×'}}</button></div>
                    <ForcingAttemptHistory v-if="options?.workbench_management?.forcing_attempt_history" :key="cycleKey(item.provider,cycle.cycle)" :source="item.provider" :cycle="cycle.cycle" />
                    <p v-if="cycleDeletions[cycleKey(item.provider,cycle.cycle)]" class="cycle-delete-status" role="status">{{cycleDeletionLabel(cycleDeletions[cycleKey(item.provider,cycle.cycle)])}} · {{cycleDeletions[cycleKey(item.provider,cycle.cycle)].phase==='queued'?'等待':'执行'}} {{deletionSeconds(cycleDeletions[cycleKey(item.provider,cycle.cycle)])}} 秒</p>
                  </article>
                  <article v-if="!item.cycles?.length" class="pool-summary"><div class="cycle-head"><b>{{ poolWindow(item) }}</b><span :class="item.status">{{ poolStatus(item.status) }}</span></div><small>{{ poolCoverage(item) }}</small></article>
                </div>
              </template>
              <template v-else>
                <div class="side-empty">{{ txLabText(health?.hpc?.message) || 'tx-lab 系统盘数据池尚未就绪' }}</div>
              </template>
            </div>
            <div class="side-card-actions">
              <button class="side-action" :disabled="gfsActionBusy" @click="prepareAllForcing">{{gfsActionBusy?'正在刷新…':'刷新'}}</button>
              <p v-if="poolRefreshMessage" class="pool-refresh-message" role="status">{{poolRefreshMessage}}</p>
            </div>
          </section>

          <section class="side-card glass history-card">
            <header><div><span>HISTORY</span><h3>历史任务</h3></div><span class="panel-count">{{ historyTasks.length }}</span></header>
            <div class="task-items">
              <article v-for="task in historyTasks" :key="task.id" :class="{ selected: task.id === activeTaskId }" :title="task.id" role="button" tabindex="0" @keydown.enter="openHistoryTask(task)" @click="openHistoryTask(task)">
                <div><b>{{ taskDateRange(task) }}</b><span :class="['mini-status', task.status]">{{ wrfTaskSummary(task) }}</span></div>
                <small>{{ `${task.request?.domains?.length || 0} 域 · ${String(task.request?.data_source || 'gfs').toUpperCase()} · ${formatCycle(task.runtime?.forcing_cycle || task.runtime?.gfs_cycle || task.runtime?.ecmwf_cycle) || '周期待定'}` }}</small>
                <button class="delete-task" title="删除任务" aria-label="删除任务" :disabled="deleteBusy(task.id)" @click.stop="confirmDelete(task)">{{deleteBusy(task.id)?'…':'×'}}</button>
                <p v-if="deleting[task.id]" class="task-deletion-status" :class="{failed:deleting[task.id].error}" role="status">{{deletionLabel(deleting[task.id])}}<span v-if="deleting[task.id].elapsed_seconds!=null"> · {{deleting[task.id].phase==='queued'?'等待':'执行'}} {{deletionSeconds(deleting[task.id])}} 秒</span><span v-if="deleting[task.id].summary && !deleting[task.id].summary.directory_mode"> · {{deleting[task.id].summary.files}} 个文件</span></p>
              </article>
              <div v-if="!historyTasks.length" class="side-empty">暂无历史任务</div>

            </div>
            <div class="history-pages"><button :disabled="!previousCursors.length" @click="changePage(false)">上一页</button><span>第 {{ previousCursors.length+1 }} 页</span><button :disabled="!nextCursor" @click="changePage(true)">下一页</button></div><button class="new-task" @click="openNewTask">＋ 新建模拟任务</button>
          </section>

          <section class="side-card glass running-card">
            <header><div><span>RUNNING</span><h3>正在进行</h3></div><span class="panel-count">{{ runningTasks.length }}</span></header>
            <p v-if="maxConcurrentTasks > 1" class="side-empty compact">{{ activeTaskCount }}/{{ maxConcurrentTasks }} 个任务执行中 · 资源不足自动排队</p>
            <div class="task-items">
              <article v-for="task in runningTasks" :key="task.id" :class="{ selected: task.id === activeTaskId }" :title="task.id" role="button" tabindex="0" @keydown.enter="showRun(task)" @click="showRun(task)">
                <div><b class="mini-status">{{ wrfTaskSummary(task) }}</b><strong>{{ task.progress || 0 }}%</strong></div>
                <small>{{ task.runtime?.resource_wait_reason || taskStage(task.stage) }}</small><el-progress :percentage="task.progress || 0" :stroke-width="3" :show-text="false" />
              </article>
              <div v-if="!runningTasks.length" class="side-empty compact">无运行任务</div>
            </div>
          </section>
        </aside>
      </div>

      <footer v-if="workspaceView!=='new'" class="status-footer glass">
        <div class="footer-title"><span :class="['pulse', { offline: !serviceOnline }]"><i></i></span><div><b>WRF 数值预报工作台</b><small>{{ footerTaskSummary }}</small></div></div>
        <div class="workflow"><span class="done"><i>1</i>选择数据源</span><em></em><span :class="{ done: !!activeTaskId || !!resultTaskId, active: workspaceView === 'new' }"><i>2</i>配置任务</span><em></em><span :class="{ done: isDisplayable(selectedTask), active: workspaceView === 'run' && !isDisplayable(selectedTask) }"><i>3</i>tx-lab 运行</span><em></em><span :class="{ done: !!resultTaskId, active: workspaceView === 'result' && !!resultTaskId }"><i>4</i>查看结果</span></div>
        <div :class="['footer-service', { offline: !serviceOnline }]"><i></i>{{ serviceOnline ? `${hpcModeLabel} ${health?.hpc?.status || 'checking'}${activeTaskCount ? ` · ${activeTaskCount} 个任务` : ''}` : '服务离线' }}</div>
      </footer>
      <section v-if="Object.values(deleting).some(item=>item.removed)||Object.values(cycleDeletions).some(item=>item.removed)" class="cleanup-progress" aria-label="空间清理状态">
        <b>空间清理</b>
        <p v-for="item in Object.values(deleting).filter(item=>item.removed)" :key="item.id" role="status">{{item.task_label||item.task_id}}：{{deletionLabel(item)}}</p>
        <p v-for="item in Object.values(cycleDeletions).filter(item=>item.removed)" :key="item.id" role="status">{{item.source.toUpperCase()}} {{item.cycle}}：{{cycleDeletionLabel(item)}}</p>
      </section>
    </main><WrfLegacyManagement ref="management" @completed="operationCompleted" @deletion-status="deletionStatus" />
  </div>
</template>

<script setup>
import {computed,nextTick,inject,onBeforeUnmount,onMounted,ref,shallowRef,toRaw,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {ElMessage,ElMessageBox} from 'element-plus';
import {ArrowLeft,ArrowRight,Check,Close,DArrowLeft,DArrowRight,DataAnalysis,Grid,MapLocation,Moon,Picture,Position,Sunny,VideoPause,VideoPlay} from '@element-plus/icons-vue';
import ForcingAttemptHistory from '../components/wrf/ForcingAttemptHistory.vue';
import {cancelWrfTask,createWrfTask,getWrfDataStatus,getWrfSubmission,getUser,getWrfHealth,getWrfOptions,getWrfTask,getWrfTaskLogs,listWorkbenchTasks, pageWorkbenchTasks,prepareWrfForcing,syncLatestWrfForcing} from '../api.js';
import {refreshWrfForcing,getWrfForcingRefresh,deleteWrfForcingCycle,getWrfForcingCleanupPlan,planWrfTaskRecovery,executeWrfTaskRecovery,getWrfTaskRecovery} from '../api.js';
import WrfLegacyManagement from '../components/WrfLegacyManagement.vue';
import {safeError} from '../utils/wrfFailure.js';
import {wrfTaskSummary} from '../utils/wrfTaskSummary.js';
import ProjMap from "../components/ProjMap.vue";
import WrfTaskConfig from "../components/WrfTaskConfig.vue";
import WrfTaskRun from "../components/WrfTaskRun.vue";
import WrfResultLayer from "../components/WrfResultLayer.vue";

const route = useRoute();
const router = useRouter();
const theme = inject("theme", ref(true));
const management=ref(null),initialRequest=shallowRef(null),editorKey=ref(0),operationError=ref(''),sidebarOpen=ref(false),sidebarTrigger=ref(null),sidebarPanel=ref(null);
let ownerGeneration=0;
const currentOwner=()=>String(getUser()?.uuid||getUser()?.id||'unknown');
let knownOwner=currentOwner();
const draftKey=()=> 'wrf:editor:'+currentOwner()+':ui2';
function saveDraft(request){if(currentOwner()==='unknown')return;sessionStorage.setItem(draftKey(),JSON.stringify({version:2,request,restart:restartContext.value}));}
function restoreDraft(){try{const saved=JSON.parse(sessionStorage.getItem(draftKey())||'null');if(saved?.version===2){initialRequest.value=saved.request;restartContext.value=saved.restart;selectedSource.value=saved.request.data_source;}}catch{operationError.value='草稿无法读取，请重新配置。';}}
function copyTask(){if(!selectedTask.value)return;restartContext.value=null;initialRequest.value=structuredClone(toRaw(selectedTask.value.request));selectedSource.value=initialRequest.value.data_source;editorKey.value++;saveDraft(initialRequest.value);routeToTaskCreation();}
function manualOperation(action){management.value?.operate(action,selectedTask.value);}
async function operationCompleted(task){restartContext.value=null;operationError.value='';await refreshAll();if(task?.id)await showRun(task);}
function authChanged(){const owner=currentOwner();if(owner===knownOwner)return;knownOwner=owner;ownerGeneration++;submitting.value=false;tasks.value=[];activeTasks.value=[];taskTotal.value=0;selectedDetail.value=null;pageCursor.value=null;previousCursors.value=[];nextCursor.value=null;deleting.value={};cycleDeletions.value={};health.value=null;selectedTaskId.value='';resultTaskId.value='';resetLogs();operationError.value='';initialRequest.value=null;restartContext.value=null;management.value?.close();poolRefreshMessage.value='';gfsActionBusy.value=false;editorKey.value++;restoreDraft();routeToTaskCreation();refreshAll();}
watch(sidebarOpen,(value,previous)=>{if(value)nextTick(()=>sidebarPanel.value?.focus());else if(previous)sidebarTrigger.value?.focus();});
function trapSidebarFocus(event){const panel=sidebarPanel.value;if(!panel||panel.closest('.wrf-studio').clientWidth>=1440)return;const items=[...panel.querySelectorAll('button,input,select,summary,a[href],[tabindex]')].filter(item=>!item.disabled&&item.tabIndex>=0&&item.getClientRects().length);if(!items.length){event.preventDefault();return;}const first=items[0],last=items.at(-1);if(event.target===panel||(!event.shiftKey&&event.target===last)||(event.shiftKey&&event.target===first)){event.preventDefault();(event.shiftKey?last:first).focus();}}
const FINAL = new Set(["succeeded", "partial_success", "failed", "waiting_restart", "cancelled"]);
const sources = [
  { id: "gfs", name: "GFS 全球预报", description: "0.25° 全球边界场", provider: "NOAA NOMADS", status: "available" },
  { id: "ecmwf", name: "ECMWF IFS", description: "0.25° 全球边界场", provider: "ECMWF Open Data", status: "available" },
];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];
function taskCreationTypeForPath(path) { return path === '/wrf/new' ? 'wrf' : ''; }

const initialCreationType = taskCreationTypeForPath(route.path);
const initialQueryView = ["result", "new", "run"].includes(String(route.query.view)) ? String(route.query.view) : "new";
const initialWorkspaceView = initialCreationType ? "new" : initialQueryView;

const tool = ref("source");
const selectedSource = ref("gfs");
const dockOpen = ref(false);
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const showGrid = ref(true);
const showVector = ref(true);
const mapDark = ref(Boolean(theme.value));
const workspaceView = ref(initialWorkspaceView);
const options = ref(null);
const health = ref(null);
const dataStatus = ref(null);
const tasks = ref([]),activeTasks=ref([]),taskTotal=ref(0);
const pageCursor=ref(null), nextCursor=ref(null), previousCursors=ref([]), selectedDetail=ref(null);
const deleting=ref({});
const serviceError = ref("");
const submitting = ref(false);
const gfsActionBusy = ref(false),poolRefreshMessage=ref(''),cycleDeletions=ref({});
let cycleDeleteTimer=null;
const selectedTaskId = ref(initialWorkspaceView === "run" ? String(route.query.task_id || "") : "");
const resultTaskId = ref(""),resultLoading=ref(false);
let resultGeneration=0;
const logs = ref("");
const logOffset = ref(0);
const logAttemptNo = ref(null);
const restartContext = ref(null);
const newTaskType = ref(initialCreationType || "wrf");

const visualTimes = ref([]);
const visualTimeIndex = ref(0);
const visualStatus = ref('idle');
let restoredFrameIndex = null;
const visualInfo = ref(null);
const visualPlaying = ref(false);
let refreshTimer = null;
let playbackTimer = null;
const refreshFlights=new Map();
let logGeneration=0;
let lastRemoteRefreshAt = 0;
const REMOTE_REFRESH_INTERVAL = 30000;
const MAX_LOG_CHARS = 300000;
const downloadSamples = new Map();

const serviceOnline = computed(() => health.value?.status === "online" && !serviceError.value);
const selectedTask = computed(() => [selectedDetail.value,...tasks.value].filter(Boolean).find(task => task.id === (workspaceView.value==='result'?resultTaskId.value:selectedTaskId.value)) || null);
const resultTask = computed(() => [selectedDetail.value,...tasks.value].find(task => task?.id === resultTaskId.value) || null);
const successfulTasks = computed(() => tasks.value.filter(task => isDisplayable(task)));
const historyTasks = computed(() => tasks.value.filter(task => FINAL.has(task.status)));
const runningTasks = computed(() => activeTasks.value.filter(task => !FINAL.has(task.status)));
// Selection belongs to the visible workspace, not a previously opened run.
const activeTaskId = computed(() => workspaceView.value === 'result' ? resultTaskId.value
  : workspaceView.value === 'run' ? selectedTaskId.value : '');
const hpcModeLabel = computed(() => health.value?.hpc?.connection_mode === "direct" ? "tx-lab 直连" : "远端连接");
const hpcStorageLow = computed(() => health.value?.hpc?.status === "storage_low");
const hpcAuthenticated = computed(() => ["ready", "storage_low"].includes(health.value?.hpc?.status));
const activeTaskCount = computed(() => Number(health.value?.active_task_count) || 0);
const maxConcurrentTasks = computed(() => Number(health.value?.max_concurrent_tasks || options.value?.capabilities?.max_concurrent_tasks) || 1);
const selectedSourceLabel = computed(() => ({ ecmwf: "ECMWF", gfs: "GFS" })[selectedSource.value] || "GFS");
const footerTaskSummary = computed(() => {
  if (selectedTaskId.value || resultTaskId.value) return workspaceView.value==='result'?resultTaskId.value:selectedTaskId.value;
  if (activeTaskCount.value) return `${activeTaskCount.value}/${maxConcurrentTasks.value} 个任务执行中`;
  return `${selectedSourceLabel.value} 00Z 驱动 · 最多 ${maxConcurrentTasks.value} 任务并行`;
});
const currentVisualTime = computed(() => visualInfo.value?.time || (visualStatus.value==='failed'?'加载失败':visualTimes.value.length ? '加载中…' : ''));
const resultSourceLabel = computed(() => {
  const task = resultTask.value;
  return String(task?.request?.data_source || selectedSource.value || "gfs").toUpperCase();
});
const poolItems = computed(() => {
  if (Array.isArray(dataStatus.value?.pool_items)) return dataStatus.value.pool_items;
  return [{ provider: selectedSource.value, label: selectedSourceLabel.value, source: selectedSource.value === "ecmwf" ? "ECMWF Open Data" : "NOAA NOMADS", status: dataStatus.value?.status || "idle", cycles: [] }];
});
const autoCleanupPending = computed(() => poolItems.value.some(item =>
  (item.cycles || []).some(cycle => cycle.auto_cleanup_allowed),
));
const creationPageType = computed(() => taskCreationTypeForPath(route.path));
const activeNewTaskType = computed(() => creationPageType.value || newTaskType.value);
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





function isDisplayable(task) { return Boolean(task && ['succeeded','partial_success'].includes(task.status)); }
function taskStatus(value) { return ({ pending_review: "等待审核", queued: "待调度", prefetching: "准备数据", uploading: "准备 tx-lab", running: "运行", rendering: "渲染", succeeded: "成功", partial_success: "部分完成", failed: "失败", waiting_restart: "待调整", waiting_upstream: "等待约 10 m forcing", preparing_forcing: "构建 CFD 强迫", cfd_1m_prepare: "准备 CFD 1 m", meshing: "构建分级网格", cfd_1m_mesh: "检查 CFD 网格", solving: "CFD / LES 求解", cfd_1m_solver: "CFD / LES 求解", generating_products: "生成微尺度产品", cfd_1m_export: "导出可视化图层", downloading_products: "校验产品包", publishing: "发布审核中", paused_external: "等待连接", cancelled: "已取消", cancel_pending: "取消中", reconciling: "恢复连接" })[value] || value; }
function taskStage(value) { return ({ resource_scientific_review: "等待资源与科学审核", queued: "等待执行名额", waiting_upstream: "等待约 10 m forcing", source_forcing_handoff: "校验已完成约 10 m forcing", preparing_forcing: "构建 CFD 边界转换", cfd_1m_prepare: "准备 OpenFOAM CFD 任务", cfd_1m_interface: "从 d08 forcing 生成边界剖面", meshing: "构建一次复用的分级网格", cfd_1m_mesh: "构建并检查 CFD 网格", solving: "执行 RANS 快照或 LES 时段", cfd_1m_solver: "执行 RANS 快照或 LES 时段", generating_products: "按 AGL 采样并生成三维浏览资产", cfd_1m_export: "按 AGL 高度导出 VTK 图层", downloading_products: "校验标准科学数据包", publishing: "质量门与原子发布", retrying_outputs: "等待恢复结果下载", retrying_partial_render: "等待部分结果渲染", checking_remote_outputs: "确认远端 WRF 结果", selecting_cycle: `选择 ${selectedSourceLabel.value} 00Z 周期`, waiting_for_gfs_cache: "等待 tx-lab 驱动数据补齐", checking_hpc_gfs: "校验 tx-lab 驱动数据池", checking_hpc_forcing: "校验 tx-lab 驱动数据池", waiting_for_hpc_gfs: "等待 tx-lab 驱动数据补齐", waiting_for_hpc_forcing: "等待 tx-lab 驱动数据补齐", remote_gfs_ready: "tx-lab 驱动数据已就绪", remote_forcing_ready: "tx-lab 驱动数据已就绪", preparing_hpc: "提交任务配置", running: "WPS / WRF 运行中", reconciling: "正在恢复 tx-lab 连接", paused_external: "等待重新连接 tx-lab", cancel_pending: "取消中", cancelled: "已取消", downloading_outputs: "拉取 wrfout 结果", rendering: "生成 WebP", done: "任务完成", failed: "本次尝试已停止" })[value] || value || "等待开始"; }
function txLabText(value) { return String(value || "").replaceAll("超算", "tx-lab"); }
function poolStatus(value) {
  return ({ ready: "已就绪", queued: "排队", downloading: "下载中", rate_limited: "限流等待", waiting_publish: "等待发布", failed: "下载失败", error: "下载失败", partial: "待补齐", storage_low: "空间不足", blocked_storage: "空间不足", idle: "待检查" })[value] || "待检查";
}
function poolDetail() { return "0.25° · 全球 · 00Z · 保留 2 周期"; }
function poolCoverage() { return "空间：全球 · 时效：f000–f072"; }
function poolWindow() { return "时间：最近两个 00Z 周期"; }
function visiblePoolCycles(item) {
  const priority = cycle => (cycle.task_required || cycle.task_priority) ? 0 : ["downloading", "rate_limited"].includes(cycle.status) ? 1 : cycle.prefetch_target ? 2 : cycle.retained ? 3 : 4;
  return [...(item?.cycles || [])]
    .sort((left, right) => priority(left) - priority(right) || String(right.cycle).localeCompare(String(left.cycle)));
}
function cycleNeedsCleanup(cycle) { return /CLEANUP_REQUIRED/i.test(String(cycle?.download_message || "")); }
function cycleLabel(cycle) {
  const status = poolStatus(cycle?.status);
  if(cycle?.cleanup_allowed)return '待清理';
  if (cycle?.task_required || cycle?.task_reference_count) return `任务使用中 · ${status}`;
  if (cycle?.target && cycleNeedsCleanup(cycle)) return "等待管理员核验";
  if (cycle?.prefetch_target) return `后台预取 · ${status}`;
  if (cycle?.retained) return `保留 · ${status}`;
  return cycle?.complete ? "已就绪" : status;
}
function cycleTransferLabel(cycle) {
  if(cycle?.cleanup_allowed)return '';
  if (["waiting_publish","queued"].includes(cycle?.status)) return cycle.wait_reason || (cycle.status==="queued" ? "等待本源下载工作器调度" : "上游完整周期尚未发布，等待 f072 发布确认");
  if (cycle?.status === "rate_limited") return cycle.retry_at ? `遵从限流等待至 ${new Date(Number(cycle.retry_at) * 1000).toLocaleTimeString()}` : "遵从限流等待";
  if (cycle?.status === "failed") return cycle.queue_message || "必需文件达到重试上限";
  if (cycle?.status === "downloading") return cycle.current_file ? `${cycle.current_file} 下载中` : "下载中，等待文件进度更新";
  return "";
}
function syncActionMessage(result) {
  const labels = { ready: "已就绪", started: "已启动", queued: "已进入队列", running: "下载中", failed: "启动失败" };
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
  return Math.min(100, Math.round(complete / total * 100));
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
      if (cycle.status === "downloading" && previous && !(Number(cycle.download_rate_bps) > 0)) {
        const elapsed = Math.max(1, (now - previous.at) / 1000);
        const measured = Math.max(0, received - previous.received) / elapsed;
        rate = measured > 0
          ? (previous.rate > 0 ? previous.rate * 0.6 + measured * 0.4 : measured)
          : 0;
      }
      if (!(Number(cycle.download_rate_bps) > 0)) cycle.download_rate_bps = Math.round(rate);
      downloadSamples.set(key, { at: now, received, rate });
    }
  }
  for (const key of downloadSamples.keys()) if (!seen.has(key)) downloadSamples.delete(key);
  return status;
}
function taskDateRange(task) { const start=String(task.request?.start_time||'').slice(0,16).replace('T',' ');return task.metadata?.name||start||task.id; }

function routeTo(view, taskId = "", replace = false) {
  const query = {};
  if (view !== "new") query.view = view;
  if (taskId) query.task_id = taskId;
  router[replace ? "replace" : "push"]({ path: "/wrf", query });
}
function syncRoute() {
  const creationType = taskCreationTypeForPath(route.path);
  const view = creationType ? "new" : (["result", "new", "run"].includes(String(route.query.view)) ? String(route.query.view) : "new");
  const taskId = String(route.query.task_id || "");
  if(workspaceView.value!==view||selectedTaskId.value!==taskId){operationError.value='';management.value?.close();}
  workspaceView.value = view;
  if (view === "new") newTaskType.value = creationType || "wrf";
  if (view === "run") { selectedTaskId.value = taskId; resetLogs(); }
  if (view === "result") loadResult(taskId);
  else {resultGeneration++;resultLoading.value=false;}

}
async function loadResult(taskId){
 const generation=++resultGeneration,owner=ownerGeneration;
 resultLoading.value=true;resultTaskId.value='';resetVisualization();
 try{
  let task;
  if(taskId)task=await getWrfTask(taskId);
  else{
   let cursor=null;const seen=new Set();
   do{
    const page=await pageWorkbenchTasks(20,cursor);
    if(generation!==resultGeneration||owner!==ownerGeneration||workspaceView.value!=='result')return;
    task=(page.items||[]).find(isDisplayable);
    cursor=page.next_cursor||null;
    if(seen.has(cursor))break;seen.add(cursor);
   }while(!task&&cursor);
  }
  if(generation!==resultGeneration||owner!==ownerGeneration||workspaceView.value!=='result')return;
  if(task&&!isDisplayable(task))throw new Error('该任务尚无可视化结果，请查看运行过程。');
  if(task){selectedDetail.value=task;const frame=Number(route.query.frame);restoredFrameIndex=Number.isSafeInteger(frame)&&frame>=0?frame:0;resultTaskId.value=task.id;}
 }catch(error){if(generation===resultGeneration&&owner===ownerGeneration)operationError.value=safeError(error.message);}
 finally{if(generation===resultGeneration&&owner===ownerGeneration)resultLoading.value=false;}
}
function routeToTaskCreation() { router.push({path:'/wrf/new'}); }
function openNewTask() { stopPlayback(); restartContext.value=null; initialRequest.value=null; editorKey.value++; sessionStorage.removeItem(draftKey()); newTaskType.value='wrf'; operationError.value=''; routeToTaskCreation(); }



function cancelConfig() { showLatestResult(); }
async function showRun(task) { if(!task)return;sidebarOpen.value=false; stopPlayback();selectedTaskId.value=task.id;selectedDetail.value=task;resetLogs();operationError.value='';routeTo('run',task.id);const id=task.id,owner=currentOwner();try{const detail=await getWrfTask(id);if(owner!==currentOwner()||selectedTaskId.value!==id)return;selectedDetail.value=detail;}catch(error){if(owner===currentOwner()&&selectedTaskId.value===id)operationError.value=safeError(error.message);} }
function showResult(task) { if (!isDisplayable(task)) return;sidebarOpen.value=false;selectedDetail.value=task; resultTaskId.value = task.id; routeTo("result", task.id); }
function showLatestResult() { if(workspaceView.value==='result'&&!route.query.task_id)loadResult('');else routeTo("result"); }
function openHistoryTask(task) { if (isDisplayable(task)) showResult(task); else showRun(task); }

function resetLogs(attemptNo = null) { logGeneration++; logs.value = ""; logOffset.value = 0; logAttemptNo.value = attemptNo; }
function selectLogAttempt(attemptNo) { resetLogs(Number(attemptNo)); refreshLogs(); }
function resetVisualization() { stopPlayback(); visualStatus.value='idle'; restoredFrameIndex=null; visualTimes.value = []; visualTimeIndex.value = 0; visualInfo.value = null; }
function onDisplayLoaded(payload) { if(payload?.file!==resultTaskId.value)return; visualTimes.value = Array.isArray(payload?.times) ? payload.times : []; setVisualTime(restoredFrameIndex??visualTimeIndex.value);restoredFrameIndex=null; }
function onVariableChange(payload) {
 if(payload?.file!==resultTaskId.value)return;
 visualStatus.value=payload.failed?'failed':payload.pending?'loading':'ready';
 visualInfo.value=payload.pending||payload.failed?null:payload;
 if(Array.isArray(payload.times)){visualTimes.value=payload.times;if(payload.times.length||!payload.pending)setVisualTime(visualTimeIndex.value);}
 if(payload.failed||visualTimes.value.length<2)stopPlayback();
 if(!payload.pending&&!payload.failed&&payload.domain&&payload.variable&&workspaceView.value==='result')router.replace({path:'/wrf',query:{...route.query,domain:payload.domain,variable:payload.variable,frame:String(visualTimeIndex.value)}});
}
function setVisualTime(value) { visualTimeIndex.value = Math.max(0, Math.min(Number(value) || 0, Math.max(0, visualTimes.value.length - 1))); }
function stopPlayback() { visualPlaying.value = false; clearInterval(playbackTimer); playbackTimer = null; }
function togglePlayback() { if (visualPlaying.value) { stopPlayback(); return; } if (visualTimes.value.length < 2) return; visualPlaying.value = true; playbackTimer = setInterval(() => { if(visualStatus.value==='ready'&&visualInfo.value?.time===visualTimes.value[visualTimeIndex.value])setVisualTime(visualTimeIndex.value + 1 >= visualTimes.value.length ? 0 : visualTimeIndex.value + 1); }, 900); }

async function refreshPart(key, action) {
 if(refreshFlights.has(key))return refreshFlights.get(key);
 const promise=action().finally(()=>{if(refreshFlights.get(key)===promise)refreshFlights.delete(key);});
 refreshFlights.set(key,promise);return promise;
}
async function refreshTasks(showMessage=false){
 const generation=ownerGeneration,owner=currentOwner(),cursor=pageCursor.value;
 return refreshPart('tasks:'+generation+':'+cursor,async()=>{try{
  const page=await pageWorkbenchTasks(20,cursor);
  if(generation!==ownerGeneration||owner!==currentOwner()||cursor!==pageCursor.value)return;
  tasks.value=(page.items||[]).filter(t=>!String(t.task_type||'').includes('downscale')&&!deleting.value[t.id]?.removed&&deleting.value[t.id]?.status!=='complete');activeTasks.value=page.active_items||tasks.value.filter(task=>!FINAL.has(task.status));taskTotal.value=page.total??tasks.value.length;nextCursor.value=page.next_cursor||null;
 }catch(error){if(showMessage&&owner===currentOwner())ElMessage.error(error.message);}});
}
async function refreshDetail(){
 const generation=ownerGeneration,id=selectedTaskId.value;if(workspaceView.value!=='run'||!id)return;
 return refreshPart('detail:'+generation+':'+id,async()=>{try{const detail=await getWrfTask(id);if(generation===ownerGeneration&&id===selectedTaskId.value)selectedDetail.value=detail;}catch(error){if(generation===ownerGeneration&&id===selectedTaskId.value)operationError.value=safeError(error.message);}});
}
async function refreshHealth(showMessage=false){
 const generation=ownerGeneration;
 return refreshPart('health:'+generation,async()=>{try{const value=await getWrfHealth();if(generation!==ownerGeneration)return;health.value=value;serviceError.value='';}catch(error){if(generation!==ownerGeneration)return;serviceError.value=error.message;if(showMessage)ElMessage.error(error.message);}});
}
async function refreshPool(force=false){
 const generation=ownerGeneration,source=selectedSource.value;
 if(!force&&Date.now()-lastRemoteRefreshAt<REMOTE_REFRESH_INTERVAL)return;
 return refreshPart('pool:'+generation+':'+source,async()=>{try{const [pool,refresh]=await Promise.all([getWrfDataStatus(source),getWrfForcingRefresh().catch(error=>{if(error.status===404)return {status:"unavailable",message:"资料管理服务待更新，请稍后刷新页面。"};throw error;})]);if(generation!==ownerGeneration||source!==selectedSource.value)return;dataStatus.value=trackDownloadMetrics({...pool,pool_items:(pool.pool_items||[]).map(item=>({...item,cycles:(item.cycles||[]).filter(cycle=>!cycleDeletions.value[cycleKey(item.provider,cycle.cycle)]?.removed)}))});if(['blocked','unavailable'].includes(refresh.status))poolRefreshMessage.value=refresh.message;lastRemoteRefreshAt=Date.now();}catch(error){if(generation===ownerGeneration&&source===selectedSource.value)dataStatus.value={status:'error',message:error.message,pool_items:[]};}});
}
async function refreshAll(showMessage=false,includeRemote=hpcAuthenticated.value,forceRemote=false){
 return Promise.allSettled([refreshHealth(showMessage),refreshTasks(showMessage),refreshDetail(),refreshLogs(),...(includeRemote?[refreshPool(forceRemote)]:[])]);
}
function changePage(forward){if(forward){previousCursors.value.push(pageCursor.value);pageCursor.value=nextCursor.value;}else pageCursor.value=previousCursors.value.pop()??null;refreshTasks(true);}
function deletionSeconds(item){return Math.floor((item.phase==='queued'?item.wait_seconds:item.execution_seconds)??item.elapsed_seconds??0);}
function deletionLabel(operation){
 if(operation.removed)return operation.status==='complete'?'已移除 · 空间清理完成':operation.error?'已移除 · 空间清理状态待确认':'已移除 · 空间清理中';
 if(operation.status==='blocked')return '删除未完成：'+(operation.error?.message||'操作条件发生变化');
 if(operation.status==='unknown')return operation.error?.message||'删除状态暂不可用，后台继续跟踪';
 if(operation.status==='submitting')return '正在提交删除…';
 if(operation.phase==='queued')return `排队删除 · 前方 ${operation.queue_position??0} 个任务`;
 return ({checking_state:'正在准备删除',inventory_assets:'正在核对目录',checking_references:'正在检查引用',preview:'正在准备删除文件',checking_execution:'正在复核目录',claimed:'正在删除',catalog_revoked:'正在撤下产品',access_denied:'正在删除文件',remote_deleted:'正在删除本地文件',local_deleted:'正在移除任务记录',catalog_purged:'正在移除任务记录',quarantining:'正在移除目录',space_cleanup:'已移除 · 空间清理中',complete:'已删除'})[operation.phase]||'正在后台删除…';
}
function deletionStatus(operation){
 deleting.value={...deleting.value,[operation.task_id]:operation};
 if(operation.removed||operation.status==='complete'){
  const firstRemoval=!tasks.value.every(task=>task.id!==operation.task_id);
  tasks.value=tasks.value.filter(task=>task.id!==operation.task_id);
  if(resultTaskId.value===operation.task_id){selectedDetail.value=null;showLatestResult();}
  else if(selectedTaskId.value===operation.task_id){selectedTaskId.value='';if(workspaceView.value==='run'){selectedDetail.value=null;routeToTaskCreation();}}
  if(firstRemoval){ElMessage.success(operation.removed?'任务已移除，后台清理空间':'任务已删除');refreshTasks();}
 }
}

async function refreshLogs() {
 const id=selectedTaskId.value,attempt=logAttemptNo.value,offset=logOffset.value,generation=ownerGeneration,epoch=logGeneration;
 if(!id||workspaceView.value!=='run')return;
 return refreshPart(`logs:${generation}:${id}:${epoch}`,async()=>{try{const chunk=await getWrfTaskLogs(id,offset,attempt);if(generation!==ownerGeneration||id!==selectedTaskId.value||epoch!==logGeneration)return;logs.value=(logs.value+(chunk.text||'')).slice(-MAX_LOG_CHARS);logOffset.value=chunk.offset??chunk.next_offset??offset;}catch(error){if(generation===ownerGeneration&&id===selectedTaskId.value&&epoch===logGeneration)operationError.value=safeError(error.message);}});
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
 if(submitting.value)return; operationError.value='';
 if(restartContext.value){
  submitting.value=true;const owner=currentOwner(),generation=ownerGeneration,context={...restartContext.value};
  const current=()=>owner===currentOwner()&&generation===ownerGeneration;
  const ledger=`wrf:restart:${owner}:${context.taskId}:${context.attemptNo}`;
  try{
   const pending=JSON.parse(localStorage.getItem(ledger)||'null');let plan;
   if(pending){
    // A sent execution is never replayed, including after page reload.
    plan=await getWrfTaskRecovery(context.taskId,pending.id);if(!current())return;
    if(plan.status!=='accepted')throw new Error('上次重跑结果尚未确认，请查看原任务状态；未重复执行。');
   }else{
    const fresh=await getWrfTask(context.taskId);if(!current())return;
    if(fresh.attempt_no!==context.attemptNo)throw new Error('尝试已变化，请重新选择任务。');
    plan=await planWrfTaskRecovery(context.taskId,null,'restart',structuredClone(payload),'manual');if(!current())return;
    if(plan.task_id!==context.taskId||plan.status!=='pending')throw new Error('重跑计划状态不匹配，未执行。');
    localStorage.setItem(ledger,JSON.stringify({id:plan.id}));
    plan=await executeWrfTaskRecovery(context.taskId,plan.id);if(!current())return;
    if(plan.status!=='accepted')throw new Error('重跑状态待核验，请查看原任务；未重复执行。');
   }
   const task=await getWrfTask(context.taskId);if(!current())return;
   localStorage.removeItem(ledger);sessionStorage.removeItem(draftKey());await operationCompleted(task);ElMessage.success('重跑已受理，旧尝试日志已保留');
  }catch(error){if(current())operationError.value=safeError(error.message)+(localStorage.getItem(ledger)?'；已保留原重跑编号，请查看任务状态，不要重复提交。':'');}
  finally{if(current())submitting.value=false;}
  return;
 }
 submitting.value=true;const owner=currentOwner();try {
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),b=>b.toString(16).padStart(2,'0')).join('');
 const ledger='wrf:pending:'+owner+':'+digest,pending=JSON.parse(localStorage.getItem(ledger)||'null');let task;
 if(pending){const state=await getWrfSubmission(pending.key);if(state.task_id)task=await getWrfTask(state.task_id);else if(state.status==='not_found')task=await createWrfTask(payload,pending.key);else throw new Error('上次提交结果尚未确认，未重复提交。');}
 else {const key='wrf-ui-'+crypto.randomUUID();localStorage.setItem(ledger,JSON.stringify({digest,key}));try {task=await createWrfTask(payload,key);}catch(error){if([400,401,403,409,422].includes(error.status))localStorage.removeItem(ledger);else throw new Error('提交响应不明确，已保留幂等键；再次开始将核验原提交。');throw error;}}
 localStorage.removeItem(ledger);if(owner!==currentOwner())return;tasks.value=[task,...tasks.value.filter(t=>t.id!==task.id)];sessionStorage.removeItem(draftKey());showRun(task);ElMessage.success('模拟任务已创建：'+task.id);
 }catch(error){if(owner===currentOwner())operationError.value=safeError(error.message);}finally{submitting.value=false;}
 }


async function cancelTask(){
 const task=selectedTask.value,owner=currentOwner();if(!task)return;
 try{await ElMessageBox.confirm('请求取消后将核验远端计算会话退出，核验完成前仍占用运行名额。','取消任务',{confirmButtonText:'确认取消',cancelButtonText:'暂不取消'});
 if(owner!==currentOwner()||selectedTask.value?.id!==task.id)return;
 await cancelWrfTask(task.id);if(owner===currentOwner())await refreshAll(true);
 }catch(error){if(error!=='cancel'&&error!=='close'&&owner===currentOwner()&&selectedTask.value?.id===task.id)operationError.value=safeError(error.message);}
}
function editAndRestart() {
 const task=selectedTask.value;if(!task?.request)return;
 restartContext.value={taskId:task.id,attemptNo:task.attempt_no,request:structuredClone(toRaw(task.request))};
 initialRequest.value=structuredClone(toRaw(task.request));selectedSource.value=task.request.data_source;editorKey.value++;saveDraft(initialRequest.value);operationError.value='';routeToTaskCreation();
}
function resumeTask() { management.value?.operate('resume',selectedTask.value); }
function retryTaskOutputs() { management.value?.operate('retry_outputs',selectedTask.value); }
function renderPartialTask() { management.value?.operate('render_partial',selectedTask.value); }
function confirmDelete(task) { if(!options.value?.workbench_management?.direct_deletion)return ElMessage.info('任务管理服务待更新，请稍后刷新页面。');management.value?.remove(task); }
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
async function prepareAllForcing() {
 if(gfsActionBusy.value)return;
 if(!options.value?.workbench_management?.forcing_refresh){poolRefreshMessage.value='资料管理服务待更新，请稍后刷新页面。';return;}
 gfsActionBusy.value=true;poolRefreshMessage.value='正在提交刷新…';
 const generation=ownerGeneration;
 try{
  await refreshWrfForcing();
  if(generation===ownerGeneration)poolRefreshMessage.value='已受理，后台准备最新两周期并清理旧资料。';
 }catch(error){if(generation===ownerGeneration)poolRefreshMessage.value=safeError(error.message);}
 finally{if(generation===ownerGeneration)gfsActionBusy.value=false;}
}
function deleteBusy(id){return ['submitting','checking','pending','executing','unknown'].includes(deleting.value[id]?.status);}

const cycleKey=(source,cycle)=>source+':'+cycle;
const cycleTrackingKey=()=> 'wrf:cycle-deletions:'+currentOwner();
const cycleDeleteBusy=(source,cycle)=>['submitting','checking','executing','unknown'].includes(cycleDeletions.value[cycleKey(source,cycle)]?.status);
function saveCycleTracking(){sessionStorage.setItem(cycleTrackingKey(),JSON.stringify(Object.values(cycleDeletions.value).filter(item=>item.id&&['checking','executing','unknown'].includes(item.status)).map(({id,source,cycle})=>({id,source,cycle}))));}
function cycleDeletionLabel(item){if(item.removed)return item.status==='complete'?'已移除 · 空间清理完成':item.error?'已移除 · 空间清理状态待确认':'已移除 · 空间清理中';if(item.error)return item.error.message;if(item.status==='blocked')return '删除未完成，资料仍保留';if(item.status==='unknown')return '删除状态待确认，未重复执行';if(item.phase==='queued')return `排队删除 · 前方 ${item.queue_position??0} 个任务`;return ({queued:'排队删除',checking_references:'正在准备删除',inventory_assets:'正在核对目录',deleting:'正在删除资料',quarantining:'正在移除目录',space_cleanup:'已移除 · 空间清理中',complete:'已删除',interrupted:'删除已中断，资料仍保留'})[item.phase]||'正在提交删除…';}
async function removeCycle(source,cycle){
 if(cycleDeleteBusy(source,cycle))return;
 if(!options.value?.workbench_management?.forcing_cycle_deletion)return ElMessage.info('资料管理服务待更新，请稍后刷新页面。');
 const key=cycleKey(source,cycle),owner=ownerGeneration;
 cycleDeletions.value={...cycleDeletions.value,[key]:{source,cycle,status:'submitting',elapsed_seconds:0}};
 try{const result=await deleteWrfForcingCycle(source,cycle);if(owner!==ownerGeneration)return;cycleDeletions.value={...cycleDeletions.value,[key]:result};saveCycleTracking();}
 catch(error){if(owner===ownerGeneration)cycleDeletions.value={...cycleDeletions.value,[key]:{source,cycle,status:'blocked',error:{message:safeError(error.message)}}};}
}
async function pollCycleDeletions(){
 const owner=ownerGeneration;
 await Promise.allSettled(Object.entries(cycleDeletions.value).filter(([,item])=>item.id&&['checking','executing'].includes(item.status)).map(async([key,item])=>{
  const result=await refreshPart('cycle-status:'+owner+':'+item.id,()=>getWrfForcingCleanupPlan(item.id));if(owner!==ownerGeneration)return;
  cycleDeletions.value={...cycleDeletions.value,[key]:result};saveCycleTracking();
  if(result.removed||result.status==='complete'){dataStatus.value={...dataStatus.value,pool_items:(dataStatus.value?.pool_items||[]).map(pool=>pool.provider===item.source?{...pool,cycles:(pool.cycles||[]).filter(cycle=>cycle.cycle!==item.cycle)}:pool)};if(!item.removed){ElMessage.success(result.removed?'资料已移除，后台清理空间':'资料周期已删除');refreshPool(true);}}
 }));
}
function cycleRetentionLabel(cycle){if(cycle.retained_complete)return '保留周期';if(cycle.task_required||cycle.task_reference_count)return '任务使用中';if(['downloading','queued','waiting_publish','rate_limited'].includes(cycle.status))return poolStatus(cycle.status);if(cycle.protected)return '引用保护';if(cycle.cleanup_allowed)return '待清理';return '状态待核验';}
function confirmCleanupCycle() { management.value?.cleanup(selectedSource.value); }

watch([() => route.path, () => route.query.view, () => route.query.task_id], syncRoute);
watch(theme, value => { mapDark.value = Boolean(value); });
onMounted(async () => {
  // Host layout and ordinary operations originate in c177766.

  try{for(const item of JSON.parse(sessionStorage.getItem(cycleTrackingKey())||'[]'))cycleDeletions.value[cycleKey(item.source,item.cycle)]={...item,status:'checking'};}catch{}
  cycleDeleteTimer=setInterval(()=>{if(!document.hidden)pollCycleDeletions();},1500);
  restoreDraft();window.addEventListener('weather-auth-changed',authChanged);
  try { options.value = await getWrfOptions(); } catch (error) { serviceError.value = error.message; }
  syncRoute();refreshAll(false,true,true);
  refreshTimer = setInterval(() => {if(!document.hidden)refreshAll(false,true);},5000);
});
onBeforeUnmount(() => { window.removeEventListener('weather-auth-changed',authChanged);clearInterval(cycleDeleteTimer);ownerGeneration++;clearInterval(refreshTimer); stopPlayback(); });
</script>

<style scoped>
.cleanup-progress{flex-shrink:0;max-height:120px;overflow:auto;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--bg);font-size:11px}.cleanup-progress p{margin:6px 0;overflow-wrap:anywhere;}

.wrf-studio { height: calc(100vh - 70px); display: flex; gap: 10px; padding: 0 8px 8px; overflow: hidden; background: var(--bg); color: var(--text); font-size: 13px; }.glass { border: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--shadow); }
.task-type-switch{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 18px 0}.task-type-switch button{display:grid;gap:4px;padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--field);color:var(--text);text-align:left;cursor:pointer}.task-type-switch button b{font-size:13px}.task-type-switch button span{color:var(--muted);font-size:10px;line-height:1.4}.task-type-switch button.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent-soft);background:var(--accent-soft)}.task-type-switch button:disabled{cursor:not-allowed;opacity:.65}
.tool-rail { flex-shrink: 0; width: 70px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 5px; border-radius: 14px; }.tool-rail button { width: 56px; min-height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 11px; background: transparent; color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; }.tool-rail button .el-icon, .tool-rail button b { font-size: 17px; }.tool-rail button.on { color: #fff; background: var(--accent); box-shadow: 0 8px 20px #3b82f630; }
.tool-dock { flex-shrink: 0; width: 282px; padding: 16px; overflow-y: auto; border-radius: 14px; scrollbar-width: none; }.tool-dock header, .side-card header, .workspace-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.tool-dock header { padding-bottom: 13px; border-bottom: 1px solid var(--border); }.tool-dock header span, .side-card header span, .workspace-head > div > span { color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: 1.2px; }.tool-dock h3, .side-card h3 { margin: 3px 0 0; font-size: 16px; }.tool-dock header > .el-icon { color: var(--muted); cursor: pointer; }.dock-hint { color: var(--muted); font-size: 10px; line-height: 1.55; }.service-summary { display: flex; align-items: center; gap: 7px; margin-top: 13px; padding: 9px; border-radius: 9px; color: #22c55e; background: #22c55e12; font-size: 10px; }.service-summary.offline { color: #f87171; background: #ef444414; }.service-summary i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }.service-summary span { flex: 1; }.service-summary button { border: 0; background: none; color: inherit; cursor: pointer; }.service-error { color: #f87171; font-size: 10px; word-break: break-word; }
.source-list, .picker { display: grid; gap: 8px; }.source-list > button { position: relative; display: flex; align-items: center; gap: 9px; min-height: 78px; padding: 11px; border: 1px solid var(--border); border-radius: 11px; background: var(--field); color: var(--text); text-align: left; }.source-list > button.selected { border-color: var(--accent); background: var(--accent-soft); }.source-list > button.disabled { opacity: .55; }.source-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--accent); background: var(--accent-soft); }.source-copy { min-width: 0; display: grid; flex: 1; gap: 2px; }.source-copy b { font-size: 12px; }.source-copy small { color: var(--muted); font-size: 9px; line-height: 1.4; }.source-copy em { color: var(--accent); font-size: 8px; font-style: normal; }.source-state { position: absolute; top: 7px; right: 8px; color: var(--muted); font-size: 8px; }.source-state.available { color: #22c55e; }.source-note { display: flex; gap: 7px; margin-top: 10px; padding: 9px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); }.source-note .el-icon { flex-shrink: 0; color: var(--accent); }.source-note p { margin: 0; font-size: 9px; line-height: 1.5; }
.picker button, .map-theme { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px 11px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }.map-theme { justify-content: center; gap: 7px; margin-top: 10px; }
.studio-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }.content-row { flex: 1; min-height: 0; display: flex; gap: 10px; }.center-workspace { flex: 1; min-width: 0; position: relative; overflow: auto; border-radius: 14px; scrollbar-width: thin; }.workspace-head { padding: 14px 16px; border-bottom: 1px solid var(--border); }.workspace-head h2 { display: inline; margin: 0 9px 0 0; font-size: 18px; }.workspace-head small { color: var(--muted); font: 9px monospace; }.workspace-actions { display: flex; }.result-empty { height: calc(100% - 70px); min-height: 430px; display: grid; place-content: center; justify-items: center; gap: 9px; color: var(--muted); text-align: center; }.result-empty .el-icon { color: var(--accent); font-size: 38px; }.result-empty b { color: var(--text); font-size: 16px; }.result-empty span { font-size: 10px; }.result-toolbar { display: flex; justify-content: space-between; padding: 8px 12px; color: var(--muted); font-size: 10px; }.result-toolbar span { display: flex; align-items: center; gap: 6px; }.result-toolbar i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }.result-toolbar b { color: var(--text); font: 10px monospace; }.visual-map { position: relative; height: calc(100% - 164px); min-height: 430px; margin: 0 10px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: #07101e; }.timebar { display: flex; align-items: center; gap: 7px; margin: 9px 10px 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }.timebar :deep(.el-slider) { flex: 1; margin: 0 8px; }.timebar time { min-width: 138px; font: 9px monospace; }.timebar > span { min-width: 38px; color: var(--muted); font-size: 9px; text-align: right; }
.right-sidebar { flex-shrink: 0; width: 272px; height: 100%; min-height: 0; display: grid; grid-template-rows: minmax(0, 3fr) minmax(0, 4fr) minmax(0, 3fr); align-self: stretch; gap: 9px; overflow: hidden; }.side-card { min-height: 0; display: flex; flex-direction: column; padding: 11px; overflow: hidden; border-radius: 13px; }.side-card header { flex-shrink: 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }.side-card header h3 { font-size: 14px; }.side-card header > span { color: var(--muted); }.side-card header > .panel-count { min-width: 24px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--field); font-size: 10px; letter-spacing: 0; text-align: center; }.side-card header > i { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.side-card header > i.ready { background: #22c55e; box-shadow: 0 0 8px #22c55e88; }.side-card header > i.storage_low { background: #f59e0b; box-shadow: 0 0 8px #f59e0b88; }.side-card header > i.error { background: #ef4444; box-shadow: 0 0 8px #ef444466; }.side-card-body, .task-items { flex: 1; min-height: 0; padding-right: 3px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }.side-card-actions { flex-shrink: 0; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--border); }.pool-provider { padding-top: 8px; }.provider-head { display: flex; justify-content: space-between; font-size: 10px; }.provider-head span { color: var(--muted); }.pool-provider article, .task-items article { position: relative; margin-top: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); transition: border-color .16s ease, background .16s ease, transform .16s ease; }.pool-provider article.target { border-color: #22c55e66; }.cycle-head, .task-items article > div { display: flex; align-items: center; justify-content: space-between; gap: 6px; }.pool-provider article b, .task-items article b { font-size: 10px; }.pool-provider article span { color: #22c55e; font-size: 8px; }.pool-provider article span.waiting_publish, .pool-provider article span.queued { color: #f59e0b; }.pool-provider article span.downloading { color: #38bdf8; }.pool-provider article span.missing, .pool-provider article span.partial { color: #f59e0b; }.pool-provider article span.error { color: #f87171; }.pool-provider article small, .task-items article small { display: block; margin-top: 4px; padding-right: 16px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.pool-provider article :deep(.el-progress), .running-card article :deep(.el-progress) { margin-top: 5px; }.cycle-actions { display: flex; align-items: center; min-height: 15px; margin-top: 3px; }.cycle-actions em { color: #f59e0b; font-size: 8px; font-style: normal; }.cycle-cleanup { padding: 0; border: 0; background: transparent; color: #f87171; font-size: 8px; cursor: pointer; }.side-empty { display: grid; min-height: 54px; place-items: center; padding: 12px 5px; color: var(--muted); font-size: 9px; text-align: center; }.side-empty.compact { padding: 8px 4px 2px; }.cleanup-warning { display: grid; gap: 4px; margin-top: 8px; padding: 8px; border-radius: 8px; color: #f87171; background: #ef444414; font-size: 9px; }.cleanup-warning button, .side-action { border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }.side-action { width: 100%; min-height: 30px; margin: 0; padding: 6px 8px; border-radius: 7px; color: var(--accent); background: var(--accent-soft); font-size: 9px; text-align: center; }.side-action:hover { background: #3b82f626; }.side-action:disabled, .cycle-cleanup:disabled { cursor: wait; opacity: .55; }
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

<style scoped>

/* Container layout is retained for the transplanted parameter editor. */
.wrf-studio{height:100%;min-height:0;display:grid;grid-template-columns:auto auto minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);padding:8px;box-sizing:border-box;container-type:inline-size}.studio-header{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}.studio-header h1{font-size:20px;margin:0}.studio-header nav{display:flex;gap:6px}.studio-header button,.sidebar-close{background:var(--field);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px 10px;cursor:pointer}.studio-main{grid-column:3;min-height:0}.wrf-studio:not(:has(.tool-rail)) .studio-main{grid-column:1/-1}.center-workspace.editor-workspace{overflow:hidden;display:flex;flex-direction:column;min-height:0}.editor-workspace :deep(.config-host){flex:1;min-height:0}.content-row{position:relative;min-width:0}.right-sidebar{grid-template-rows:minmax(0,3fr) minmax(0,4fr) minmax(0,2fr);width:300px;box-sizing:border-box;flex-shrink:0}.sidebar-close{display:block;justify-self:end}.sidebar-backdrop{display:none}.operation-error{max-height:72px;overflow:auto;padding:10px;color:var(--text);background:var(--accent-soft);overflow-wrap:anywhere}.task-items article:focus-visible{outline:2px solid var(--accent)}
@container(max-width:1439px){.right-sidebar{position:absolute;right:0;top:0;bottom:0;width:min(340px,100%);z-index:21;background:var(--bg);padding:8px;grid-template-rows:minmax(0,3fr) minmax(0,4fr) minmax(0,2fr)}.sidebar-close{display:block}.sidebar-backdrop{display:block;position:absolute;inset:0;z-index:20;background:#0006;border:0}.tool-rail{width:48px;padding:4px}.tool-rail button{width:40px}.tool-dock{position:absolute;top:48px;bottom:8px;left:60px;z-index:22;width:min(260px,calc(100% - 80px));box-sizing:border-box}.studio-main,.content-row{min-height:0}.center-workspace{min-height:0}.status-footer{position:static}.timebar{flex-wrap:wrap}.visual-map{min-height:160px}}
@container(max-width:639px){.studio-header h1{font-size:16px}.studio-header nav{order:3;width:100%}.status-footer{display:none}.center-workspace{min-height:0}.result-empty{min-height:0;padding:20px}.workspace-head{padding:8px}.workspace-head h2{font-size:16px}.workspace-head small{display:block;overflow-wrap:anywhere}.timebar time{min-width:0}}
</style>

<style scoped>
@container(max-width:1439px){.right-sidebar{height:100%}.content-row{flex-direction:row}}.wrf-studio{flex:1;min-height:0;height:auto}.task-items article{outline-offset:-2px}</style>

<style scoped>
.history-pages{display:flex;justify-content:space-between;align-items:center;gap:4px;padding:6px 0}.history-pages button{background:var(--field);color:var(--text);border:1px solid var(--border);border-radius:5px;padding:4px;cursor:pointer}.history-pages button:disabled{opacity:.4}</style>

<style scoped>
.restart-context{flex-shrink:0;margin:0;padding:8px 12px;max-height:56px;overflow:auto;overflow-wrap:anywhere;background:var(--accent-soft);font-size:12px}</style>

<style scoped>
.pool-refresh-message{font-size:12px;line-height:1.5;margin:8px 0 0;color:var(--muted)}.delete-task:disabled{opacity:.6;cursor:wait}</style>

<style scoped>
.task-deletion-status{margin:8px 16px 0 0;font-size:12px;line-height:1.5;color:var(--accent);overflow-wrap:anywhere}.task-deletion-status.failed{color:#f59e0b}</style>

<style scoped>
.cycle-actions{justify-content:space-between}.cycle-delete{color:#f87171;background:transparent;border:0;font-size:16px;cursor:pointer;padding:2px 6px}.cycle-delete:disabled{opacity:.5;cursor:wait}.cycle-delete-status{font-size:12px;line-height:1.5;margin:6px 0;color:var(--accent)}</style>
