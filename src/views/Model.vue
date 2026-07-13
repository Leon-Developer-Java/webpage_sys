<template>
  <div class="model-page">
    <aside class="rail glass">
      <button :class="{ on: dockOpen && tool === 'model' }" @click="openTool('model')">
        <el-icon><Operation /></el-icon><span>模型选择</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'file' }" @click="openTool('file')">
        <el-icon><FolderOpened /></el-icon><span>任务数据</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')">
        <el-icon><Position /></el-icon><span>投影</span>
      </button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')">
        <el-icon><MapLocation /></el-icon><span>底图</span>
      </button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid">
        <el-icon><Grid /></el-icon><span>经纬网</span>
      </button>
      <button :class="{ on: showVector }" @click="toggleVector">
        <b class="dim-icon">界</b><span>边界</span>
      </button>
      <button :class="{ on: linked }" @click="linked = !linked">
        <el-icon><Connection /></el-icon><span>双屏联动</span>
      </button>
    </aside>

    <section v-if="dockOpen" class="dock glass">
      <div class="dock-head">
        <div>
          <span class="dock-kicker">专用模型调用</span>
          <h3>{{ dockTitle }}</h3>
        </div>
        <el-icon @click="dockOpen = false"><Close /></el-icon>
      </div>

      <template v-if="tool === 'model'">
        <div class="service-summary" :class="{ offline: !serviceOnline }">
          <i></i>
          <span>{{ serviceOnline ? `模型服务在线 · ${health?.model_device || 'auto'}` : '模型服务未连接' }}</span>
          <button v-if="!serviceOnline" @click="loadModels">重试</button>
        </div>
        <p v-if="serviceError" class="error-text">{{ serviceError }}</p>
        <p class="pick-hint">模型列表和可用状态来自 backend_model。</p>
        <div class="picker model-picker">
          <button
            v-for="item in models"
            :key="item.id"
            :class="{ on: modelId === item.id, disabled: item.status !== 'available' }"
            @click="selectModel(item)"
          >
            <span class="model-icon"><el-icon><Operation /></el-icon></span>
            <span class="model-copy">
              <b>{{ item.name }}</b>
              <small>{{ item.description }}</small>
              <em v-if="item.architecture">{{ item.architecture }}</em>
            </span>
            <el-icon v-if="modelId === item.id" class="check"><Check /></el-icon>
            <span v-else-if="item.status !== 'available'" class="soon-tag">待接入</span>
          </button>
        </div>
        <div class="model-note">
          <el-icon><InfoFilled /></el-icon>
          <p>当前降水短临模型固定接收连续25帧NetCDF：前5帧作为输入，后20帧同时用于真实值对比。</p>
        </div>
      </template>

      <template v-else-if="tool === 'file'">
        <div class="selected-model">
          <span>当前模型</span>
          <b>{{ activeModel?.name || '请先选择模型' }}</b>
        </div>
        <label class="upload-zone" :class="{ disabled: isBusy }">
          <input type="file" accept=".nc" multiple hidden :disabled="isBusy" @change="chooseFiles" />
          <el-icon><UploadFilled /></el-icon>
          <b>选择25帧雷达NetCDF</b>
          <span>文件会按文件名时间排序，并检查是否连续间隔6分钟</span>
        </label>
        <div class="list-head">
          <span>已选文件 · {{ files.length }}/25</span>
          <button v-if="files.length && !isBusy" @click="clearFiles">清空</button>
        </div>
        <div v-if="sequenceMessage" class="sequence-state" :class="{ ready: sequenceReady }">
          <el-icon><CircleCheck v-if="sequenceReady" /><InfoFilled v-else /></el-icon>
          <span>{{ sequenceMessage }}</span>
        </div>
        <ul v-if="files.length" class="files">
          <li v-for="(file, index) in files" :key="file.key">
            <i class="dot"></i>
            <div><b>{{ index + 1 }}. {{ file.name }}</b><span>{{ file.size }}</span></div>
            <button v-if="!isBusy" title="移除" @click="removeFile(file.key)"><Close /></button>
          </li>
        </ul>
        <div v-else class="empty-files">尚未选择输入数据</div>

        <div v-if="isBusy || runStatus" class="task-card">
          <div><span>{{ taskStageText }}</span><b>{{ Math.round(taskProgress) }}%</b></div>
          <el-progress :percentage="Math.round(taskProgress)" :show-text="false" :stroke-width="6" />
          <small v-if="runStatus?.run_id">任务 {{ shortRunId }}</small>
          <p v-if="runStatus?.error">{{ runStatus.error }}</p>
        </div>
        <el-button type="primary" class="run-button" :loading="submitting" :disabled="!canSubmit" @click="submitRun">
          <el-icon v-if="!submitting"><VideoPlay /></el-icon>{{ runButtonText }}
        </el-button>
        <el-button v-if="canCancel" class="cancel-button" @click="cancelRun">取消任务</el-button>
        <p class="hint">上传完成后任务进入单GPU队列；页面会自动轮询，完成后载入双屏结果。</p>
      </template>

      <template v-else-if="tool === 'proj'">
        <p class="pick-hint">两个结果窗口使用同一种投影。</p>
        <div class="picker">
          <button v-for="item in projections" :key="item" :class="{ on: projection === item }" @click="projection = item">
            <span>{{ item }}</span><el-icon v-if="projection === item"><Check /></el-icon>
          </button>
        </div>
      </template>

      <template v-else>
        <p class="pick-hint">两个结果窗口共用底图设置。</p>
        <div class="picker">
          <button v-for="item in basemaps" :key="item" :class="{ on: basemap === item }" @click="basemap = item">
            <span>{{ item }}</span><el-icon v-if="basemap === item"><Check /></el-icon>
          </button>
        </div>
        <button v-if="showVector" class="theme-switch" @click="mapDark = !mapDark">
          <el-icon><Sunny v-if="mapDark" /><Moon v-else /></el-icon>
          {{ mapDark ? '切换为亮色地图' : '切换为暗色地图' }}
        </button>
      </template>
    </section>

    <main class="workspace">
      <div class="result-layout">
        <section class="visual-workspace">
          <div class="maps">
            <div class="cell">
              <span class="cell-tag truth">真实值</span>
              <ProjMap
                ref="truthMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
                :sync-view="linked && viewEmitter !== 'truth' ? syncView : null"
                @view-change="value => onViewChange('truth', value)"
              >
                <WebglLayer v-if="activeFrame?.truth_url" :key="activeFrame.truth_url" :src="activeFrame.truth_url" :extent="result.extent" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待真实值结果</span></div>
              <div v-else class="pane-state"><i></i>{{ activeTimeFull }}</div>
            </div>
            <div class="cell">
              <span class="cell-tag prediction">预测值</span>
              <ProjMap
                ref="predictionMap"
                :grid="showGrid"
                :dark="mapDark"
                :vector="showVector"
                :basemap="basemap"
                :projection="projection"
                :sync-view="linked && viewEmitter !== 'prediction' ? syncView : null"
                @view-change="value => onViewChange('prediction', value)"
              >
                <WebglLayer v-if="activeFrame?.prediction_url" :key="activeFrame.prediction_url" :src="activeFrame.prediction_url" :extent="result.extent" />
              </ProjMap>
              <div v-if="!activeFrame" class="map-empty"><el-icon><Picture /></el-icon><span>等待预测值结果</span></div>
              <div v-else class="pane-state"><i></i>提前 {{ activeFrame.lead_minutes }} 分钟</div>
            </div>
          </div>

          <div class="radar-legend">
            <span>组合反射率</span>
            <div class="legend-colors"></div>
            <div class="legend-labels"><i v-for="value in [0, 10, 20, 30, 40, 50, 60, 70]" :key="value">{{ value }}</i></div>
            <b>dBZ</b>
          </div>

          <div class="timebar glass" :class="{ disabled: !frames.length }">
            <div class="tb-head">
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(0)"><el-icon><DArrowLeft /></el-icon></button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(activeIndex - 1)"><el-icon><ArrowLeft /></el-icon></button>
              <button class="tc-play" :disabled="!frames.length" @click="playing = !playing">
                <el-icon><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon>
              </button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(activeIndex + 1)"><el-icon><ArrowRight /></el-icon></button>
              <button class="tc-btn" :disabled="!frames.length" @click="setTimeIndex(frames.length - 1)"><el-icon><DArrowRight /></el-icon></button>
              <div class="tc-speed">
                <button v-for="value in [0.5, 1, 2, 4]" :key="value" :class="{ on: speed === value }" @click="speed = value">{{ value }}x</button>
              </div>
              <span class="tc-time">{{ activeFrame ? `${activeTimeFull} · +${activeFrame.lead_minutes} min` : '任务完成后可播放20帧预报' }}</span>
            </div>
            <TimeAxis :times="axisTimes" :active="activeIndex" @update:active="setTimeIndex" :dark="dark" />
          </div>
        </section>

        <aside class="metrics glass">
          <div class="metrics-head">
            <div><span>预报评估</span><h3>结果信息</h3></div>
            <i :class="statusClass"></i>
          </div>
          <template v-if="result">
            <div class="valid-time">
              <span>当前时次</span><b>{{ activeTimeFull }}</b><small>第 {{ activeIndex + 1 }}/{{ frames.length }} 帧 · 提前 {{ activeFrame?.lead_minutes }} 分钟</small>
            </div>
            <h4>当前帧指标</h4>
            <div class="metric-grid">
              <div><span>MAE</span><b>{{ number(activeLead?.model_mae) }}</b><small>dBZ</small></div>
              <div><span>RMSE</span><b>{{ number(activeLead?.model_rmse) }}</b><small>dBZ</small></div>
              <div><span>Bias</span><b>{{ signed(activeLead?.model_bias) }}</b><small>dBZ</small></div>
              <div><span>CSI 20</span><b>{{ percent(activeLead?.model_csi_20dbz) }}</b><small>命中评分</small></div>
              <div><span>POD 20</span><b>{{ percent(activeLead?.model_pod_20dbz) }}</b><small>命中率</small></div>
              <div><span>FAR 20</span><b>{{ percent(activeLead?.model_far_20dbz) }}</b><small>空报率</small></div>
            </div>
            <h4>20帧平均</h4>
            <div class="summary-list">
              <p><span>平均 MAE</span><b>{{ number(modelSummary.mae_mean) }} dBZ</b></p>
              <p><span>平均 RMSE</span><b>{{ number(modelSummary.rmse_mean) }} dBZ</b></p>
              <p><span>CSI ≥ 20 dBZ</span><b>{{ percent(modelSummary.csi_20dbz_mean) }}</b></p>
              <p><span>CSI ≥ 30 dBZ</span><b>{{ percent(modelSummary.csi_30dbz_mean) }}</b></p>
              <p><span>较持续性基线 MAE</span><b class="good">{{ improvementText }}</b></p>
            </div>
            <h4>运行信息</h4>
            <div class="run-info">
              <p><span>模型</span><b>{{ result.architecture }}</b></p>
              <p><span>版本</span><b>{{ result.model_version }}</b></p>
              <p><span>设备</span><b>{{ result.device }}</b></p>
              <p><span>推理耗时</span><b>{{ number(result.inference_seconds) }} s</b></p>
              <p><span>结果网格</span><b>{{ result.shape?.join(' × ') }}</b></p>
            </div>
          </template>
          <div v-else class="metrics-empty">
            <el-icon><DataAnalysis /></el-icon>
            <b>{{ isBusy ? taskStageText : '暂无预报结果' }}</b>
            <span>{{ isBusy ? '任务完成后会自动加载结果与评估指标' : '选择模型和25帧数据后提交任务' }}</span>
          </div>
        </aside>
      </div>

      <footer class="workflow glass">
        <div class="workflow-title">
          <span class="pulse"><i></i></span>
          <div><b>{{ activeModel?.name || '降水短临预报' }}</b><small>{{ runStatus?.run_id || '专用模型任务工作区' }}</small></div>
        </div>
        <div class="steps">
          <span :class="{ done: !!modelId }"><i>1</i>选择模型</span><em></em>
          <span :class="{ done: sequenceReady }"><i>2</i>上传数据</span><em></em>
          <span :class="{ done: inferenceDone, active: isBusy }"><i>3</i>解析并预报</span><em></em>
          <span :class="{ done: !!result }"><i>4</i>查看结果</span>
        </div>
        <div class="service-state" :class="{ offline: !serviceOnline }"><i></i>{{ serviceOnline ? 'backend_model · 8006' : '服务离线' }}</div>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  ArrowLeft, ArrowRight, Check, CircleCheck, Close, Connection, DArrowLeft, DArrowRight,
  DataAnalysis, FolderOpened, Grid, InfoFilled, MapLocation, Moon, Operation, Picture,
  Position, Sunny, UploadFilled, VideoPause, VideoPlay,
} from "@element-plus/icons-vue";
import {
  cancelModelRun, getDedicatedModels, getModelHealth, getModelMetrics, getModelRun,
  getModelRunResult, submitModelRun,
} from "../api.js";
import ProjMap from "../components/ProjMap.vue";
import TimeAxis from "../components/TimeAxis.vue";
import WebglLayer from "../components/WebglLayer.vue";

const LAST_RUN_KEY = "weather-model-last-run";
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const fallbackModels = [
  { id: "precipitation_nowcasting", name: "降水短临预报", description: "使用5帧组合反射率预报未来20帧", status: "available", architecture: "alphapre_phaseplus_amp_hier" },
  { id: "icing_prediction", name: "覆冰预测", description: "面向输电线路等场景的覆冰风险预测", status: "scaffold" },
];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];

const dark = inject("theme");
const tool = ref("model");
const dockOpen = ref(true);
const models = ref(fallbackModels);
const modelId = ref("precipitation_nowcasting");
const health = ref(null);
const serviceOnline = ref(false);
const serviceError = ref("");
const files = ref([]);
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const showGrid = ref(true);
const showVector = ref(false);
const mapDark = ref(dark.value);
const linked = ref(true);
const syncView = ref(null);
const viewEmitter = ref("");
const truthMap = ref(null);
const predictionMap = ref(null);
const submitting = ref(false);
const uploadProgress = ref(0);
const runStatus = ref(null);
const result = ref(null);
const metrics = ref(null);
const activeIndex = ref(0);
const playing = ref(false);
const speed = ref(1);
let pollTimer = null;
let playbackTimer = null;
let disposed = false;

const activeModel = computed(() => models.value.find(item => item.id === modelId.value));
const dockTitle = computed(() => ({ model: "模型选择", file: "任务数据", proj: "投影方式", base: "底图图层" })[tool.value]);
const frames = computed(() => Array.isArray(result.value?.frames) ? result.value.frames : []);
const activeFrame = computed(() => frames.value[activeIndex.value] || null);
const axisTimes = computed(() => frames.value.map(frame => String(frame.valid_time || "").slice(11, 16)));
const activeTimeFull = computed(() => activeFrame.value?.valid_time || "--");
const modelSummary = computed(() => metrics.value?.summary?.model || result.value?.metrics_summary?.model || {});
const persistenceSummary = computed(() => metrics.value?.summary?.persistence || result.value?.metrics_summary?.persistence || {});
const activeLead = computed(() => metrics.value?.per_lead?.[activeIndex.value] || {});
const isBusy = computed(() => submitting.value || ["queued", "running", "cancelling"].includes(runStatus.value?.status));
const canCancel = computed(() => ["queued", "running", "cancelling"].includes(runStatus.value?.status));
const inferenceDone = computed(() => ["succeeded", "failed", "cancelled"].includes(runStatus.value?.status));
const taskProgress = computed(() => submitting.value ? uploadProgress.value : Number(runStatus.value?.progress || 0));
const shortRunId = computed(() => runStatus.value?.run_id ? `${runStatus.value.run_id.slice(0, 12)}…` : "");
const canSubmit = computed(() => serviceOnline.value && activeModel.value?.status === "available" && sequenceReady.value && !isBusy.value);
const runButtonText = computed(() => submitting.value ? `正在上传 ${Math.round(uploadProgress.value)}%` : isBusy.value ? "任务执行中" : result.value ? "重新运行预报" : "提交并开始预报");
const statusClass = computed(() => ({ online: serviceOnline.value, running: isBusy.value, success: !!result.value }));
const taskStageText = computed(() => {
  if (submitting.value) return "正在上传25帧数据";
  return ({ queued: "任务排队中", running: "模型推理中", cancelling: "正在取消", succeeded: "预报已完成", failed: "任务失败", cancelled: "任务已取消" })[runStatus.value?.status] || "等待提交";
});
const improvementText = computed(() => {
  const model = Number(modelSummary.value.mae_mean);
  const baseline = Number(persistenceSummary.value.mae_mean);
  if (!Number.isFinite(model) || !Number.isFinite(baseline) || baseline === 0) return "--";
  return `${((baseline - model) / baseline * 100).toFixed(1)}%`;
});

const sequenceCheck = computed(() => {
  if (!files.value.length) return { ready: false, message: "" };
  if (files.value.length !== 25) return { ready: false, message: `还需选择 ${Math.max(0, 25 - files.value.length)} 帧（固定流程要求恰好25帧）` };
  if (files.value.some(item => !item.stamp)) return { ready: false, message: "部分文件名缺少14位时间戳" };
  for (let index = 1; index < files.value.length; index += 1) {
    if (stampMillis(files.value[index].stamp) - stampMillis(files.value[index - 1].stamp) !== 360000) {
      return { ready: false, message: `第 ${index} 与 ${index + 1} 帧之间不是6分钟连续间隔` };
    }
  }
  return { ready: true, message: `${formatStamp(files.value[0].stamp)} 至 ${formatStamp(files.value[24].stamp)}，连续25帧校验通过` };
});
const sequenceReady = computed(() => sequenceCheck.value.ready);
const sequenceMessage = computed(() => sequenceCheck.value.message);

function openTool(name) {
  if (dockOpen.value && tool.value === name) dockOpen.value = false;
  else { tool.value = name; dockOpen.value = true; }
}

function selectModel(item) {
  if (item.status !== "available") { ElMessage.info("该模型仍是预留骨架，暂不可运行。"); return; }
  modelId.value = item.id;
  tool.value = "file";
}

function fileStamp(name) {
  return String(name || "").match(/_(\d{14})_/)?.[1] || "";
}

function stampMillis(stamp) {
  if (!/^\d{14}$/.test(stamp)) return NaN;
  return Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));
}

function formatStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)} ${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`;
}

function chooseFiles(event) {
  const selected = Array.from(event.target.files || []);
  const invalid = selected.filter(file => !file.name.toLowerCase().endsWith(".nc"));
  if (invalid.length) ElMessage.warning(`已忽略 ${invalid.length} 个非NetCDF文件。`);
  const incoming = selected.filter(file => file.name.toLowerCase().endsWith(".nc")).map(file => ({
    key: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: formatSize(file.size),
    stamp: fileStamp(file.name),
    raw: file,
  }));
  const merged = new Map(files.value.map(file => [file.name, file]));
  incoming.forEach(file => merged.set(file.name, file));
  files.value = Array.from(merged.values()).sort((a, b) => (a.stamp || a.name).localeCompare(b.stamp || b.name));
  if (files.value.length > 25) ElMessage.warning("当前超过25帧，请移除多余文件后再提交。");
  event.target.value = "";
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function removeFile(key) { files.value = files.value.filter(file => file.key !== key); }
function clearFiles() { files.value = []; }

async function loadModels() {
  serviceError.value = "";
  try {
    const [registry, status] = await Promise.all([getDedicatedModels(), getModelHealth()]);
    models.value = registry.length ? registry : fallbackModels;
    health.value = status;
    serviceOnline.value = true;
    if (!models.value.some(item => item.id === modelId.value && item.status === "available")) {
      modelId.value = models.value.find(item => item.status === "available")?.id || "";
    }
  } catch (error) {
    serviceOnline.value = false;
    serviceError.value = error.message || "模型服务连接失败";
  }
}

async function submitRun() {
  if (!canSubmit.value) return;
  stopPolling();
  playing.value = false;
  submitting.value = true;
  uploadProgress.value = 0;
  runStatus.value = null;
  result.value = null;
  metrics.value = null;
  activeIndex.value = 0;
  try {
    const task = await submitModelRun({
      modelId: modelId.value,
      files: files.value.map(item => item.raw),
      startTimestamp: files.value[0].stamp,
      onUploadProgress: value => { uploadProgress.value = value; },
    });
    runStatus.value = task;
    localStorage.setItem(LAST_RUN_KEY, task.run_id);
    ElMessage.success("文件上传完成，任务已进入模型队列。");
    schedulePoll(0);
  } catch (error) {
    ElMessage.error(error.message || "模型任务提交失败");
  } finally {
    submitting.value = false;
  }
}

function schedulePoll(delay = 1500) {
  stopPolling();
  if (disposed || !runStatus.value?.run_id) return;
  pollTimer = setTimeout(pollRun, delay);
}

async function pollRun() {
  const runId = runStatus.value?.run_id;
  if (!runId || disposed) return;
  try {
    runStatus.value = await getModelRun(runId);
    if (runStatus.value.status === "succeeded") {
      await loadResult(runId);
      ElMessage.success("预报完成，已载入真实值与预测值。")
    } else if (!TERMINAL_STATUSES.has(runStatus.value.status)) {
      schedulePoll();
    } else if (runStatus.value.status === "failed") {
      ElMessage.error(runStatus.value.error || "模型任务失败");
    }
  } catch (error) {
    serviceOnline.value = false;
    serviceError.value = error.message || "任务状态读取失败";
    schedulePoll(3000);
  }
}

async function loadResult(runId) {
  result.value = await getModelRunResult(runId);
  try { metrics.value = await getModelMetrics(result.value.metrics_url); }
  catch (error) { metrics.value = null; ElMessage.warning(error.message || "逐时指标读取失败"); }
  serviceOnline.value = true;
  activeIndex.value = 0;
  await nextTick();
  truthMap.value?.flyTo(result.value.extent);
  predictionMap.value?.flyTo(result.value.extent);
}

async function cancelRun() {
  if (!runStatus.value?.run_id) return;
  try {
    runStatus.value = await cancelModelRun(runStatus.value.run_id);
    if (!TERMINAL_STATUSES.has(runStatus.value.status)) schedulePoll();
    ElMessage.info(runStatus.value.status === "cancelled" ? "任务已取消。" : "已请求取消，当前推理结束后生效。");
  } catch (error) { ElMessage.error(error.message || "取消任务失败"); }
}

async function restoreLastRun() {
  const runId = localStorage.getItem(LAST_RUN_KEY);
  if (!runId) return;
  try {
    runStatus.value = await getModelRun(runId);
    if (runStatus.value.status === "succeeded") await loadResult(runId);
    else if (!TERMINAL_STATUSES.has(runStatus.value.status)) schedulePoll();
  } catch { localStorage.removeItem(LAST_RUN_KEY); }
}

function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
function setTimeIndex(value) { activeIndex.value = Math.min(Math.max(Math.round(Number(value) || 0), 0), Math.max(0, frames.value.length - 1)); }
function startPlayback() {
  clearInterval(playbackTimer);
  if (!playing.value || frames.value.length < 2) return;
  playbackTimer = setInterval(() => setTimeIndex((activeIndex.value + 1) % frames.value.length), Math.max(150, 900 / speed.value));
}

function onViewChange(source, view) {
  if (!linked.value) return;
  viewEmitter.value = source;
  syncView.value = view;
}

function toggleVector() {
  showVector.value = !showVector.value;
  if (showVector.value) mapDark.value = false;
}

function number(value) { const n = Number(value); return Number.isFinite(n) ? n.toFixed(2) : "--"; }
function signed(value) { const n = Number(value); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}` : "--"; }
function percent(value) { const n = Number(value); return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "--"; }

watch([playing, speed], startPlayback);
watch(frames, value => { if (!value.length) playing.value = false; setTimeIndex(activeIndex.value); });
watch(linked, value => { if (!value) { syncView.value = null; viewEmitter.value = ""; } });
watch(dark, value => { if (!showVector.value) mapDark.value = value; });

onMounted(async () => { await loadModels(); await restoreLastRun(); });
onBeforeUnmount(() => { disposed = true; stopPolling(); clearInterval(playbackTimer); });
</script>

<style scoped>
.model-page { display: flex; gap: 10px; padding: 10px; height: 100%; min-height: 0; background: var(--backdrop); }
.rail { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.rail button { display: grid; place-items: center; gap: 3px; width: 54px; height: 52px; border: 0; border-radius: 12px; background: transparent; color: var(--muted); font: inherit; font-size: 10px; cursor: pointer; transition: .15s; }
.rail button .el-icon { font-size: 19px; }
.rail button:hover { color: var(--text); background: var(--field); }
.rail button.on { color: #fff; background: var(--accent); }
.dim-icon { font-size: 14px; font-weight: 800; line-height: 1; }

.dock { flex-shrink: 0; width: 284px; display: flex; flex-direction: column; gap: 13px; padding: 17px; overflow-y: auto; scrollbar-width: none; }
.dock::-webkit-scrollbar, .files::-webkit-scrollbar { display: none; }
.dock-head { display: flex; align-items: flex-start; justify-content: space-between; }
.dock-head h3 { margin: 2px 0 0; font-size: 16px; }
.dock-head > .el-icon { margin-top: 3px; color: var(--muted); cursor: pointer; }
.dock-kicker { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: 1px; }
.pick-hint, .hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.hint { text-align: center; }
.error-text { margin: 0; color: #ef4444; font-size: 10px; line-height: 1.4; }
.service-summary { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 9px; color: #16a34a; background: color-mix(in srgb, #16a34a 10%, transparent); font-size: 10px; }
.service-summary i, .service-state i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 7px #22c55e; }
.service-summary.offline { color: #ef4444; background: color-mix(in srgb, #ef4444 10%, transparent); }
.service-summary.offline i, .service-state.offline i { background: #ef4444; box-shadow: 0 0 7px #ef4444; }
.service-summary button { margin-left: auto; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }

.picker { display: flex; flex-direction: column; gap: 7px; }
.picker button { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border: 1px solid var(--border); border-radius: 11px; background: var(--field); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: .15s; }
.picker button:hover { border-color: var(--accent); }
.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.picker button.disabled { opacity: .55; }
.model-picker button { position: relative; justify-content: flex-start; gap: 10px; min-height: 72px; text-align: left; }
.model-icon { flex-shrink: 0; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--accent); background: var(--accent-soft); }
.model-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.model-copy b { color: var(--text); font-size: 13px; }
.model-copy small { color: var(--muted); font-size: 10px; line-height: 1.4; }
.model-copy em { overflow: hidden; color: var(--accent); font-size: 9px; font-style: normal; text-overflow: ellipsis; }
.soon-tag { flex-shrink: 0; color: var(--muted); font-size: 9px; }
.check { color: var(--accent); }
.model-note { display: flex; align-items: flex-start; gap: 8px; padding: 10px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--muted); }
.model-note .el-icon { flex-shrink: 0; margin-top: 2px; color: var(--accent); }
.model-note p { margin: 0; font-size: 10px; line-height: 1.55; }
.theme-switch { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; cursor: pointer; }

.selected-model { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 11px; border-radius: 10px; background: var(--accent-soft); font-size: 11px; }
.selected-model span { color: var(--muted); }
.selected-model b { color: var(--accent); font-size: 12px; text-align: right; }
.upload-zone { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 12px; border: 1px dashed var(--border); border-radius: 12px; background: var(--field); text-align: center; cursor: pointer; transition: .15s; }
.upload-zone:hover { border-color: var(--accent); }
.upload-zone.disabled { cursor: not-allowed; opacity: .55; }
.upload-zone .el-icon { color: var(--accent); font-size: 27px; }
.upload-zone b { font-size: 12px; }
.upload-zone span { color: var(--muted); font-size: 10px; line-height: 1.45; }
.list-head { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; }
.list-head button { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 10px; cursor: pointer; }
.sequence-state { display: flex; align-items: flex-start; gap: 6px; padding: 8px 9px; border-radius: 9px; color: #d97706; background: color-mix(in srgb, #f59e0b 10%, transparent); font-size: 10px; line-height: 1.4; }
.sequence-state.ready { color: #16a34a; background: color-mix(in srgb, #22c55e 10%, transparent); }
.sequence-state .el-icon { flex-shrink: 0; margin-top: 1px; }
.files { display: grid; gap: 5px; max-height: 190px; margin: 0; padding: 0; overflow-y: auto; list-style: none; scrollbar-width: none; }
.files li { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }
.files .dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.files div { flex: 1; min-width: 0; }
.files b, .files span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.files b { font-size: 10px; font-weight: 500; }
.files span { margin-top: 2px; color: var(--muted); font-size: 9px; }
.files li > button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.files li > button svg { width: 12px; }
.empty-files { padding: 16px 10px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 11px; text-align: center; }
.task-card { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }
.task-card > div { display: flex; justify-content: space-between; font-size: 10px; }
.task-card small { color: var(--muted); font-size: 9px; }
.task-card p { margin: 0; color: #ef4444; font-size: 10px; line-height: 1.4; }
.run-button, .cancel-button { width: 100%; margin-left: 0 !important; }

.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.result-layout { flex: 1; min-height: 0; display: flex; gap: 10px; }
.visual-workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.maps { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cell { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; }
.cell :deep(.projmap) { position: absolute; inset: 0; }
.cell-tag { position: absolute; top: 9px; right: 9px; z-index: 6; padding: 5px 11px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: rgba(16,24,38,.75); backdrop-filter: blur(10px); color: #eaf1fb; font-size: 11px; font-weight: 700; pointer-events: none; }
.cell-tag.truth { box-shadow: inset 3px 0 #22c55e; }
.cell-tag.prediction { box-shadow: inset 3px 0 #3b82f6; }
.pane-state { position: absolute; left: 10px; bottom: 10px; z-index: 6; display: flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; background: rgba(16,24,38,.7); color: rgba(234,241,251,.8); font-size: 9px; pointer-events: none; }
.pane-state i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.map-empty { position: absolute; inset: 0; z-index: 5; display: grid; place-content: center; justify-items: center; gap: 8px; color: rgba(234,241,251,.55); background: rgba(14,21,34,.22); pointer-events: none; }
.map-empty .el-icon { font-size: 28px; }
.map-empty span { font-size: 11px; }
.radar-legend { flex-shrink: 0; display: grid; grid-template-columns: auto minmax(180px, 1fr) auto; align-items: center; gap: 7px 10px; padding: 2px 10px; color: var(--muted); font-size: 9px; }
.legend-colors { height: 8px; border-radius: 3px; background: linear-gradient(90deg,#04e9e7,#019ff4,#0300f4,#02fd02,#01c501,#008e00,#fdf802,#e5bc00,#fd9500,#fd0000,#d40000,#bc0000,#f800fd,#9854c6,#fdfdfd); }
.legend-labels { grid-column: 2; display: flex; justify-content: space-between; margin-top: -6px; }
.legend-labels i { font-style: normal; }
.radar-legend > b { grid-column: 3; grid-row: 1; font-weight: 500; }

.timebar { flex-shrink: 0; padding: 8px 13px 7px; border-radius: 13px; }
.timebar.disabled { opacity: .6; }
.tb-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.tc-btn, .tc-play { display: grid; place-items: center; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.tc-btn { width: 24px; height: 24px; }
.tc-play { width: 31px; height: 31px; border-radius: 50%; background: var(--accent); color: #fff; }
.tc-btn:disabled, .tc-play:disabled { cursor: not-allowed; opacity: .45; }
.tc-speed { display: flex; gap: 2px; margin-left: 8px; padding: 2px; border-radius: 7px; background: var(--field); }
.tc-speed button { padding: 3px 6px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); font: inherit; font-size: 9px; cursor: pointer; }
.tc-speed button.on { color: #fff; background: var(--accent); }
.tc-time { margin-left: auto; color: var(--text); font-size: 10px; font-variant-numeric: tabular-nums; }

.metrics { flex-shrink: 0; width: 250px; padding: 15px; overflow-y: auto; scrollbar-width: none; }
.metrics::-webkit-scrollbar { display: none; }
.metrics-head { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 11px; border-bottom: 1px solid var(--border); }
.metrics-head span { color: var(--accent); font-size: 9px; font-weight: 700; letter-spacing: 1px; }
.metrics-head h3 { margin: 2px 0 0; font-size: 15px; }
.metrics-head > i { width: 8px; height: 8px; margin-top: 8px; border-radius: 50%; background: #94a3b8; }
.metrics-head > i.online { background: #22c55e; box-shadow: 0 0 7px #22c55e; }
.metrics-head > i.running { background: #f59e0b; box-shadow: 0 0 7px #f59e0b; }
.metrics-head > i.success { background: #3b82f6; box-shadow: 0 0 7px #3b82f6; }
.valid-time { display: flex; flex-direction: column; gap: 3px; margin: 11px 0; padding: 10px; border-radius: 10px; background: var(--accent-soft); }
.valid-time span, .valid-time small { color: var(--muted); font-size: 9px; }
.valid-time b { color: var(--accent); font-size: 12px; }
.metrics h4 { margin: 13px 0 7px; color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase; }
.metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.metric-grid > div { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 2px; padding: 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); }
.metric-grid span { color: var(--muted); font-size: 8px; }
.metric-grid b { grid-row: 2; color: var(--text); font-size: 15px; }
.metric-grid small { grid-row: 2; color: var(--muted); font-size: 7px; }
.summary-list, .run-info { display: grid; gap: 1px; }
.summary-list p, .run-info p { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin: 0; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 9px; }
.summary-list span, .run-info span { color: var(--muted); }
.summary-list b, .run-info b { max-width: 135px; overflow: hidden; font-size: 9px; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.summary-list .good { color: #16a34a; }
.metrics-empty { display: flex; flex-direction: column; align-items: center; gap: 7px; margin-top: 60px; color: var(--muted); text-align: center; }
.metrics-empty .el-icon { color: var(--accent); font-size: 34px; }
.metrics-empty b { color: var(--text); font-size: 12px; }
.metrics-empty span { max-width: 175px; font-size: 10px; line-height: 1.5; }

.workflow { flex-shrink: 0; min-height: 58px; display: flex; align-items: center; gap: 18px; padding: 8px 14px; border-radius: 14px; }
.workflow-title { display: flex; align-items: center; gap: 9px; min-width: 180px; }
.workflow-title > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.workflow-title b { font-size: 11px; }
.workflow-title small { max-width: 155px; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.pulse { display: grid; place-items: center; width: 29px; height: 29px; border-radius: 9px; background: var(--accent-soft); }
.pulse i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.steps { flex: 1; display: flex; align-items: center; justify-content: center; }
.steps span { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; white-space: nowrap; }
.steps span i { display: grid; place-items: center; width: 19px; height: 19px; border: 1px solid var(--border); border-radius: 50%; font-style: normal; font-size: 9px; }
.steps span.done { color: var(--text); }
.steps span.done i { border-color: var(--accent); background: var(--accent); color: #fff; }
.steps span.active i { box-shadow: 0 0 0 3px var(--accent-soft); }
.steps em { width: clamp(10px,2vw,34px); height: 1px; margin: 0 6px; background: var(--border); }
.service-state { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 9px; white-space: nowrap; }

@media (max-width: 1250px) {
  .metrics { width: 215px; }
  .dock { width: 260px; }
  .workflow-title { min-width: 0; }
  .workflow-title small, .service-state { display: none; }
}
@media (max-width: 980px) {
  .metrics { display: none; }
  .dock { width: 235px; }
  .steps em { margin: 0 3px; }
}
</style>
