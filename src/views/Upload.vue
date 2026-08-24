<template>
  <div class="up">
    <div class="up-main">
      <div class="stats-row">
        <div class="stat-card glass" v-for="s in stats" :key="s.label">
          <div class="sc-label">{{ s.label }}</div>
          <div :class="['sc-val', s.cls]">{{ s.val }}</div>
          <div class="sc-sub">{{ s.sub }}</div>
        </div>
      </div>
      <div
        class="drop-zone"
        :class="{ over: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
        @click="input.click()"
      >
        <el-icon class="dz-icon"><Upload /></el-icon>
        <p class="dz-title">拖拽文件到此处，或<em>点击选择</em></p>
        <small class="dz-hint">支持雷达 CINRAD/NetCDF、GRIB2、FY-3 HDF、Himawari DAT(.bz2) 与 WRF NetCDF；单次最多并行上传 2 个文件</small>
        <input ref="input" type="file" multiple hidden accept=".cinrad,.nc,.grib,.grib2,.grb,.grb2,.hdf,.hdf5,.dat,.bz2" @change="onPick" />
      </div>

      <div class="file-section glass">
        <div class="sec-bar">
          <div class="tabs">
            <button :class="{ on: tab === 'upload' }" @click="switchTab('upload')">待上传</button>
            <button :class="{ on: tab === 'parse' }" @click="switchTab('parse')">解析记录</button>
          </div>
          <span class="sec-info">
            {{ tab === 'upload'
              ? (checked.length ? `已选 ${checked.length} 个` : `共 ${files.length} 个`)
              : (pqChecked.length ? `已选 ${pqChecked.length} 个` : `共 ${parseQueue.length} 个`) }}
          </span>
          <div class="bar-btns">
            <template v-if="tab === 'upload'">
              <div v-if="checked.length >= 2" class="batch-type">
                <el-select
                  v-model="batchDataType"
                  class="batch-type-select"
                  size="small"
                  placeholder="统一设置类型"
                  title="统一设置数据类型"
                >
                  <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
                </el-select>
              </div>
              <button class="act del" :disabled="!checked.length" @click="deleteChecked">
                <el-icon><Delete /></el-icon>删除
              </button>
              <button class="act up" :disabled="!checked.length" @click="uploadChecked">
                <el-icon><Upload /></el-icon>上传选中
              </button>
            </template>
            <template v-else>
              <button class="act del" :disabled="!pqChecked.length" @click="deletePqChecked">
                <el-icon><Delete /></el-icon>清除选择
              </button>
              <button class="act parse" :disabled="!pqChecked.length" @click="parsePqChecked">
                <el-icon><DataAnalysis /></el-icon>解析 / 重试
              </button>
            </template>
          </div>
        </div>

        <div class="tbl-wrap" v-if="tab === 'upload'">
          <table class="tbl">
            <colgroup>
              <col style="width:36px"><col>
              <col style="width:68px"><col style="width:90px">
              <col style="width:130px"><col style="width:142px"><col style="width:76px">
            </colgroup>
            <thead>
              <tr>
                <th><input type="checkbox" :checked="allChecked" @change="toggleAll" :disabled="!files.length" /></th>
                <th>文件名</th>
                <th>格式</th>
                <th>大小</th>
                <th>修改时间</th>
                <th class="pin-l">数据类型<span class="req">*</span></th>
                <th class="pin-r">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!files.length">
                <td colspan="7" class="tbl-empty">暂无文件，请拖拽或点击上方区域选择</td>
              </tr>
              <tr
                v-for="f in files"
                :key="f.id"
                :class="{ hl: selected === f.id, done: f.status === 'done' }"
                @click="f.status === 'done' && (selected = f.id)"
              >
                <td><input type="checkbox" v-model="f.checked" @click.stop /></td>
                <td>
                  <div class="td-name">
                    <el-icon v-if="f.dup" class="dup-icon" title="列表中存在同名文件"><WarningFilled /></el-icon>
                    <span class="trunc" :title="f.name">{{ f.name }}</span>
                  </div>
                </td>
                <td>{{ f.fmt }}</td>
                <td>{{ f.size }}</td>
                <td>{{ f.modified }}</td>
                <td class="pin-l">
                  <div class="type-cell">
                    <select class="type-sel" v-model="f.dataType" @click.stop @change="markTypeManual(f)" :disabled="f.status !== 'pending'">
                      <option value="">选择类型</option>
                      <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
                    </select>
                    <small v-if="f.typeDetected" :title="f.detectionReason">自动识别</small>
                    <small v-else-if="!f.dataType" class="unresolved">未识别</small>
                  </div>
                </td>
                <td class="pin-r">
                  <span :class="['badge', f.status]">{{ STATUS[f.status] }}</span>
                  <button v-if="['queued', 'uploading'].includes(f.status)" class="row-cancel" @click.stop="cancelFileUpload(f)">取消</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="tbl-wrap" v-else>
          <table class="tbl">
            <colgroup>
              <col style="width:36px"><col>
              <col style="width:68px"><col style="width:90px">
              <col style="width:124px"><col style="width:120px"><col style="width:76px">
            </colgroup>
            <thead>
              <tr>
                <th><input type="checkbox" :checked="pqAllChecked" @change="togglePqAll" :disabled="!parseQueue.some(canQueueAction)" /></th>
                <th>文件名</th>
                <th>格式</th>
                <th>大小</th>
                <th>上传时间</th>
                <th class="pin-l">数据类型</th>
                <th class="pin-r">解析状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!parseQueue.length">
                <td colspan="7" class="tbl-empty">暂无解析记录</td>
              </tr>
              <tr
                v-for="f in parseQueue"
                :key="f.id"
                class="record-row"
                :class="{ hl: selected === f.id, done: f.status === 'done' }"
                @click="selected = f.id"
              >
                <td><input type="checkbox" v-model="f.checked" :disabled="!canQueueAction(f)" @click.stop /></td>
                <td><span class="trunc" :title="f.name">{{ f.name }}</span></td>
                <td>{{ f.fmt }}</td>
                <td>{{ f.size }}</td>
                <td>{{ f.uploaded }}</td>
                <td class="pin-l"><span class="type-tag">{{ f.dataType }}</span></td>
                <td class="pin-r">
                  <span
                    :class="['badge', f.status === 'parsing' ? 'uploading' : f.status]"
                    :title="parseStatusDetail(f)"
                  >{{ parseStatusText(f) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <MetaPanel :meta="cur?.meta" :steps="cur?.steps ?? []">
      <template #empty>
        <el-icon><Upload /></el-icon>
        <p>上传完成后查看气象信息</p>
      </template>
    </MetaPanel>
  </div>

  <teleport to="body">
    <div v-if="dlgVisible" class="dlg-mask" @click.self="cancelUpload">
      <div class="dlg">
        <div class="dlg-head">上传提醒</div>
        <div class="dlg-body">
          <p class="dlg-desc">以下 {{ missingTypeFiles.length }} 个文件未选择数据类型，无法上传：</p>
          <ul class="dlg-list">
            <li v-for="n in missingTypeFiles" :key="n">{{ n }}</li>
          </ul>
          <p v-if="pendingUpload.length" class="dlg-confirm">
            继续将仅上传剩余 <b>{{ pendingUpload.length }}</b> 个已选择数据类型的文件，是否继续？
          </p>
          <p v-else class="dlg-confirm">所有选中文件均未选择数据类型，请返回补充后再上传。</p>
        </div>
        <div class="dlg-foot">
          <button class="dlg-cancel" @click="cancelUpload">取消</button>
          <button v-if="pendingUpload.length" class="dlg-ok" @click="doUpload">确定</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { DataAnalysis, Delete, Upload, WarningFilled } from "@element-plus/icons-vue";
import { ElNotification } from "element-plus";
import MetaPanel from "../components/MetaPanel.vue";
import {
  getRawScenes,
  listSatelliteParseTasks,
  prepareUploadCollections,
  retryUploadCollection,
  startSatelliteParseTask,
  uploadFileResumable,
  waitForSatelliteParseTask,
  getUploadTasks,
  retryUploadTask,
} from "../api.js";

const files = ref([]);
const selected = ref(null);
const dragging = ref(false);
const input = ref(null);
const tab = ref("upload");
const dlgVisible = ref(false);
const missingTypeFiles = ref([]);
const pendingUpload = ref([]);
const uploadQueue = [];
const uploadControllers = new Map();
let activeUploadCount = 0;
let queueTimer = null;

// GFS 与 ECMWF 必须分开。不能再使用合并入口，否则 ECMWF 可能会被落入 GFS 目录。
const TYPES = ["ERA5", "GFS", "ECMWF", "CMA", "雷达", "葵花", "FY-3", "WRF"];
const STATUS = { pending: "待上传", queued: "排队中", uploading: "上传中", done: "完成", error: "失败", cancelled: "已取消" };
const PARSE_STATUS = { pending: "待解析", parsing: "解析中", done: "已解析", error: "不完整" };

const parseQueue = ref([]);
const databaseTaskTotal = ref(0);
const databaseParsedTotal = ref(0);

function parseStatusText(file) {
  if (isRawSourceMissing(file)) return "原文件缺失";
  if (file?.rawStatus === "no_coverage") return "无区域覆盖";
  if (file?.rawStatus === "waiting_collection") return "等待集合完整";
  if (file?.status === "parsing" && Number.isFinite(Number(file?.progress))) {
    return `解析中 ${Number(file.progress).toFixed(1)}%`;
  }
  if (file?.status === "error" && file?.rawStatus === "parse_error") return "解析失败";
  return PARSE_STATUS[file?.status] || file?.status || "—";
}

function parseStatusDetail(file) {
  if (file?.parseError) return String(file.parseError);
  const details = Array.isArray(file?.missing) ? file.missing.filter(Boolean) : [];
  return details.join("；");
}

function isRawSourceMissing(file) {
  return file?.queueKind === "database"
    && /raw source is missing/i.test(String(file?.parseError || ""));
}

const checked = computed(() => files.value.filter(f => f.checked));
const allChecked = computed(() => files.value.length > 0 && files.value.every(f => f.checked));
const batchTypeTargets = computed(() => {
  return checked.value.filter(file => file.status === "pending");
});
const batchDataType = computed({
  get() {
    const types = batchTypeTargets.value.map(file => file.dataType || "");
    if (!types.length || types.some(type => type !== types[0])) return "";
    return types[0];
  },
  set(dataType) {
    applyBatchType(dataType);
  },
});
const pqChecked = computed(() => parseQueue.value.filter(f => f.checked));
const pqAllChecked = computed(() => {
  const actionable = parseQueue.value.filter(canQueueAction);
  return actionable.length > 0 && actionable.every(f => f.checked);
});

const cur = computed(() => {
  const uploaded = files.value.find(f => f.id === selected.value);
  if (uploaded?.status === "done") return uploaded;
  return parseQueue.value.find(f => f.id === selected.value) || null;
});

const stats = computed(() => [
  { label: "已上传", val: files.value.filter(f => f.status === "done").length, sub: "本次会话", cls: "" },
  { label: "数据库总量", val: databaseTaskTotal.value, sub: "当前账号", cls: "" },
  { label: "已解析", val: databaseParsedTotal.value, sub: "当前账号", cls: "ok" },
  { label: "待解析", val: parseQueue.value.filter(f => f.status === "pending").length, sub: "等待处理", cls: "accent" },
]);

function fmtSize(b) {
  return b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB";
}

function fmtDate(ms) {
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function now() {
  return new Date().toLocaleTimeString();
}


function unwrapPayload(payload) {
  if (!payload) return {};
  return payload.data || payload.result || payload;
}

function pickFirstArray(...items) {
  for (const item of items) {
    if (Array.isArray(item) && item.length) return item;
  }
  return [];
}

function pickFirstObject(...items) {
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length) return item;
  }
  return {};
}

function compactText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function formatValue(value, unit = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  const n = Number(value);
  const txt = Math.abs(n) >= 10 ? n.toFixed(2) : n.toFixed(3);
  return unit ? `${txt} ${unit}` : txt;
}

function extractVariableOptions(result) {
  const r = unwrapPayload(result);
  const info = r.weather_info || {};
  const meta = r.meta || {};
  const extra = r.extra || {};
  const metaJson = r.meta_json || {};

  return pickFirstArray(
    r.variable_options,
    info.variable_options,
    meta.variable_options,
    extra.variable_options,
    metaJson.variable_options,
    metaJson.weather_info?.variable_options,
    metaJson.meta?.variable_options
  );
}

function extractVariableLayers(result) {
  const r = unwrapPayload(result);
  const info = r.weather_info || {};
  const meta = r.meta || {};
  const extra = r.extra || {};
  const metaJson = r.meta_json || {};

  return pickFirstObject(
    r.variable_layers,
    info.variable_layers,
    meta.variable_layers,
    extra.variable_layers,
    metaJson.variable_layers,
    metaJson.weather_info?.variable_layers,
    metaJson.meta?.variable_layers
  );
}

function buildAllVariableText(result) {
  const options = extractVariableOptions(result);

  if (options.length) {
    return options
      .map(v => v.label || v.element || v.key)
      .filter(Boolean)
      .join("、");
  }

  const r = unwrapPayload(result);
  const info = r.weather_info || {};
  const meta = r.meta || {};

  return meta.vars || info.variables || "—";
}

function buildMetaFromParsed(parsed, fallbackFile) {
  const result = unwrapPayload(parsed);
  const panelMeta = result.meta || {};
  const info = result.weather_info || {};
  const extra = result.extra || {};
  const variableOptions = extractVariableOptions(result);
  const variableLayers = extractVariableLayers(result);

  const defaultVariable =
    result.default_variable ||
    info.default_variable ||
    panelMeta.default_variable ||
    extra.default_variable ||
    variableOptions[0]?.key ||
    Object.keys(variableLayers)[0];

  const defaultLayer =
    (defaultVariable && variableLayers?.[defaultVariable]) ||
    Object.values(variableLayers || {})[0] ||
    {};

  const currentElement =
    defaultLayer.element ||
    panelMeta.element ||
    info.element ||
    "—";

  const allVars = buildAllVariableText(result);
  const displayElement =
    allVars && allVars !== "—" && allVars !== currentElement
      ? `${currentElement}；全部要素：${allVars}`
      : currentElement;

  const unit =
    defaultLayer.unit ||
    defaultLayer.displayUnit ||
    panelMeta.unit ||
    info.unit ||
    "—";

  const stepStats = Array.isArray(defaultLayer.step_stats) ? defaultLayer.step_stats : [];
  const firstStepStat = stepStats[0] || {};
  const maxVal = firstStepStat.max ?? defaultLayer.max ?? panelMeta.max ?? info.max;
  const minVal = firstStepStat.min ?? defaultLayer.min ?? panelMeta.min ?? info.min;
  const meanVal = firstStepStat.mean ?? defaultLayer.mean ?? panelMeta.mean ?? info.mean;

  const gridObj = defaultLayer.grid || info.gridShape || panelMeta.gridShape || {};
  const gridText =
    defaultLayer.gridText ||
    gridObj.text ||
    panelMeta.grid ||
    info.grid ||
    (gridObj.ny && gridObj.nx ? `${gridObj.ny} × ${gridObj.nx}` : "—");

  const missingText =
    defaultLayer.missingText ||
    panelMeta.missing ||
    info.missing ||
    "—";

  return {
    file: result.file_name || panelMeta.file || fallbackFile.name || "—",
    element: displayElement,
    time: defaultLayer.time || panelMeta.time || info.time || "—",
    level: defaultLayer.level || panelMeta.level || info.level || "—",
    range: defaultLayer.range || panelMeta.range || info.range || "—",
    grid: gridText,
    missing: missingText,
    unit,
    vars: allVars,
    steps: defaultLayer.steps || panelMeta.steps || info.steps || "—",
    status: panelMeta.status || info.status || result.status || "解析成功",
    quality: defaultLayer.quality || panelMeta.quality || info.quality || "—",
    max: maxVal,
    min: minVal,
    mean: meanVal,
    alert: defaultLayer.alert || panelMeta.alert || info.alert || "无",
    maxText: formatValue(maxVal, unit === "—" ? "" : unit),
    minText: formatValue(minVal, unit === "—" ? "" : unit),
    meanText: formatValue(meanVal, unit === "—" ? "" : unit),
    extent: defaultLayer.extent || panelMeta.extent || info.extent || extra.extent || result.extent || "—",
    png_url:
      defaultLayer.png_url ||
      result.png_url ||
      extra.png_url ||
      panelMeta.png_url ||
      info.png_url ||
      "—",
    png_urls:
      defaultLayer.png_urls ||
      result.png_urls ||
      extra.png_urls ||
      panelMeta.png_urls ||
      info.png_urls ||
      [],
    grid_urls:
      defaultLayer.grid_urls ||
      panelMeta.grid_urls ||
      info.grid_urls ||
      [],
    times:
      defaultLayer.times ||
      result.times ||
      panelMeta.times ||
      info.times ||
      [],
  };
}

function inferDataType(file) {
  const name = String(file?.name || "");
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();
  const suffix = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  const result = (type, reason) => ({ type, reason });

  if (/^WRFOUT_D\d{2}_/i.test(name) || lower.includes("wrfout_")) {
    return result("WRF", "文件名符合 wrfout_dXX_ 时间格式");
  }
  if (/^FY3[A-Z]?[_-]/i.test(name) || lower.includes("fy-3") || lower.includes("fy3")) {
    return result("FY-3", "文件名包含 FY-3/FY3 卫星标识");
  }
  if (/^HS_H\d{2}_/i.test(name) || lower.includes("himawari") || lower.includes("ahi")) {
    return result("葵花", "文件名包含 Himawari/AHI 场景标识");
  }
  if (upper.includes("Z_RADR") || lower.includes("cinrad") || lower.includes("radar") || [".cinrad", ".radar"].includes(suffix)) {
    return result("雷达", "文件名或扩展名包含雷达产品标识");
  }
  if (lower.includes("ecmwf") || lower.includes("ifs") || /^ec[_-]/i.test(name)) {
    return result("ECMWF", "文件名包含 ECMWF/IFS 标识");
  }
  if (lower.includes("gfs") || lower.includes("pgrb") || lower.includes("gdas")) {
    return result("GFS", "文件名包含 GFS/PGRB/GDAS 标识");
  }
  if (lower.includes("era5")) {
    return result("ERA5", "文件名包含 ERA5 标识");
  }
  if (lower.includes("cma") || lower.includes("cra40") || upper.includes("Z_NAFP")) {
    return result("CMA", "文件名包含 CMA/CRA40 产品标识");
  }
  return result("", "仅凭文件名和扩展名无法可靠判断");
}

function markTypeManual(file) {
  file.typeDetected = false;
  file.detectionReason = file.dataType ? "用户手动指定" : "未指定";
}

function applyBatchType(dataType) {
  if (!dataType) return;
  batchTypeTargets.value.forEach(file => {
    file.dataType = dataType;
    file.typeDetected = false;
    file.detectionReason = "批量统一指定";
  });
}

function addFiles(list) {
  const incoming = [...list].map(file => file.name);
  const incomingSet = new Set(incoming);
  const hasDupInBatch = name => incoming.filter(n => n === name).length > 1;
  const existingNames = new Set(files.value.map(f => f.name));

  files.value.forEach(f => {
    if (incomingSet.has(f.name)) {
      f.dup = true;
    }
  });

  for (const file of list) {
    const detected = inferDataType(file);
    files.value.push({
      id: Date.now() + Math.random(),
      name: file.name,
      fmt: file.name.includes(".") ? file.name.split(".").pop().toUpperCase() : "—",
      size: fmtSize(file.size),
      created: "—",
      modified: file.lastModified ? fmtDate(file.lastModified) : "—",
      dataType: detected.type,
      typeDetected: Boolean(detected.type),
      detectionReason: detected.reason,
      status: "pending",
      checked: false,
      dup: existingNames.has(file.name) || hasDupInBatch(file.name),
      steps: [],
      meta: null,
      percent: 0,
      raw: file,
      uploadResult: null,
      parseResult: null,
    });
  }
}

function normalizeDataTypeForBackend(dataType, fileName = "") {
  const raw = String(dataType || "").trim();
  const upper = raw.toUpperCase();
  const name = String(fileName || "").toLowerCase();

  if (raw === "葵花" || upper === "HIMAWARI") return "Himawari";
  if (upper === "FY-3" || upper === "FY3" || name.includes("fy3") || name.includes("fy-3")) return "FY3";
  if (upper === "ECMWF" || upper === "EC" || upper === "IFS") return "ECMWF";
  if (upper === "GFS") return "GFS";

  // 兼容旧值：如果之前缓存了合并入口，尽量按文件名判断。
  if (upper === "GFS/ECMWF" || upper === "GFS·ECMWF" || upper === "GRIB") {
    if (name.includes("ecmwf") || name.includes("ifs") || name.startsWith("ec_") || name.startsWith("ec-")) {
      return "ECMWF";
    }
    return "GFS";
  }

  return raw;
}

function isSatelliteCollectionType(dataType) {
  return ["FY3", "Himawari"].includes(normalizeDataTypeForBackend(dataType));
}

function rawSceneToQueueItem(scene) {
  const businessType = normalizeDataTypeForBackend(scene.business_type || "");
  const status = scene.parsed ? "done" : (scene.complete ? "pending" : "error");
  const quality = scene.quality || {};
  const qualityRatio = Number(quality.valid_pixel_ratio);
  const qualityText = Number.isFinite(qualityRatio) ? `${(qualityRatio * 100).toFixed(2)}% 有效像素` : "—";
  const missing = scene.status === "no_coverage"
    ? (quality.warnings || ["轨迹未覆盖当前业务区域"])
    : (scene.missing || []);
  return {
    id: `${businessType}:${scene.scene_id}`,
    queueKind: "raw",
    sceneId: scene.scene_id,
    name: scene.scene_id,
    fmt: businessType === "FY3" ? "HDF" : "HSD",
    size: `${scene.file_count || 0} 个文件`,
    uploaded: compactText(scene.raw_dir),
    dataType: businessType,
    status,
    rawStatus: scene.status,
    missing,
    checked: false,
    progress: status === "done" ? 100 : 0,
    meta: {
      file: scene.scene_id,
      element: businessType === "FY3" ? "FY-3 MERSI-II" : "Himawari HSD",
      time: `${scene.date || ""} ${scene.time || ""}`.trim() || "—",
      level: "卫星观测",
      range: scene.status === "no_coverage" ? "当前业务区域无覆盖" : "按解析元数据确定",
      grid: scene.parsed ? "已生成" : "待解析",
      missing: missing.length ? missing.join("；") : "无",
      unit: "—",
      vars: businessType === "FY3" ? "MERSI-II 25 波段" : "HSD 通道",
      steps: `${scene.file_count || 0} 个 raw 文件`,
      status: parseStatusText({status, rawStatus: scene.status}),
      quality: qualityText,
      alert: missing.length ? missing.join("；") : "无",
    },
    steps: [
      {label: "上传", state: "已保存到 raw", t: "", ok: true},
      {label: "解析", state: parseStatusText({status, rawStatus: scene.status}), t: "", ok: status === "done", running: status === "parsing"},
      {label: "渲染 WEBP", state: scene.parsed ? "已完成" : "等待", t: "", ok: Boolean(scene.parsed)},
    ],
  };
}

function databaseTaskToQueueItem(task, previous = {}) {
  const statusMap = { waiting_collection: "pending", pending: "pending", running: "parsing", success: "done", failed: "error" };
  const status = statusMap[task.parse_status] || "error";
  const parseError = task.parse_error || "";
  const collection = task.collection || null;
  const collectionMissing = Array.isArray(collection?.missing_roles) ? collection.missing_roles : [];
  const item = {
    id: `database:${task.file_uuid}`,
    queueKind: "database",
    fileUuid: task.file_uuid,
    collectionUuid: task.collection_uuid || null,
    collectionStatus: collection?.status || null,
    name: task.file_name,
    fmt: task.file_type || "—",
    size: Number.isFinite(Number(task.file_size)) ? fmtSize(Number(task.file_size)) : "—",
    uploaded: task.create_time ? new Date(task.create_time).toLocaleString("zh-CN") : "—",
    dataType: task.data_type,
    status,
    rawStatus: task.parse_status,
    parseError,
    missing: collectionMissing,
    defaultWebpUrl: task.default_webp_url,
    checked: previous.checked || false,
    meta: {
      file: task.file_name,
      element: task.data_type || "—",
      time: task.create_time ? new Date(task.create_time).toLocaleString("zh-CN") : "—",
      level: "上传任务",
      range: status === "done" ? "已进入可展示数据目录" : "私有 raw 存储",
      grid: status === "done" ? `${Number(task.webp_count || 0)} 个 WebP` : "—",
      missing: isRawSourceMissing({queueKind: "database", parseError})
        ? "原始文件不在本机"
        : collectionMissing.length ? collectionMissing.join("、") : "—",
      status: parseStatusText({queueKind: "database", status, rawStatus: task.parse_status, parseError}),
      extraRows: [
        ["fileUuid", "任务 ID", task.file_uuid],
        ["collectionUuid", "集合 ID", task.collection_uuid || ""],
        ["collectionMissing", "集合缺失成员", collectionMissing.join("、")],
        ["parseAttempts", "解析次数", task.parse_attempts],
        ["finishedAt", "完成时间", task.parse_finished_at ? new Date(task.parse_finished_at).toLocaleString("zh-CN") : ""],
        ["renderResult", "渲染结果", status === "done" ? `${Number(task.webp_count || 0)} 个 WebP` : ""],
        ["parseError", "失败原因", parseError],
      ],
    },
  };
  if (!canQueueAction(item)) item.checked = false;
  return item;
}

function canQueueAction(item) {
  return (item.queueKind === "raw" && item.status === "pending")
    || (
      item.queueKind === "database"
      && item.status === "error"
      && !isRawSourceMissing(item)
      && (!item.collectionUuid || item.collectionStatus === "failed")
    );
}

function syncLocalFileStatus(tasks) {
  const byUuid = new Map(tasks.map(task => [task.fileUuid, task]));
  files.value.forEach(file => {
    const task = file.fileUuid && byUuid.get(file.fileUuid);
    if (!task || !file.steps?.length) return;
    const parseStep = file.steps[1];
    if (task.status === "pending") {
      parseStep.running = false;
      parseStep.ok = false;
      parseStep.state = "等待 Worker";
    } else if (task.status === "parsing") {
      parseStep.running = true;
      parseStep.ok = false;
      parseStep.state = "解析中";
    } else if (task.status === "done") {
      parseStep.running = false;
      parseStep.ok = true;
      parseStep.state = "成功";
      file.steps[2].ok = true;
      file.steps[2].state = "成功";
      file.steps[3].ok = true;
      file.steps[3].state = "可展示";
      file.meta = { ...file.meta, status: "解析成功", alert: task.defaultWebpUrl || "WebP 已生成" };
    } else if (task.status === "error") {
      parseStep.running = false;
      parseStep.ok = false;
      parseStep.state = task.parseError || "解析失败";
      file.meta = { ...file.meta, status: "解析失败", alert: task.parseError || "可在待解析列表中重试" };
    }
  });
}

async function refreshParseQueue() {
  const previous = new Map(parseQueue.value.map(item => [item.id, item]));
  const [databaseGroup, himawariGroup, fy3Group, fy3TasksGroup, himawariTasksGroup] = await Promise.allSettled([
    getUploadTasks(),
    getRawScenes("Himawari"),
    getRawScenes("FY3"),
    listSatelliteParseTasks("FY3", {activeOnly: true}),
    listSatelliteParseTasks("Himawari", {activeOnly: true}),
  ]);
  const rows = [];
  const databaseItems = [];
  if (databaseGroup.status === "fulfilled") {
    databaseTaskTotal.value = Number(databaseGroup.value.total || 0);
    (databaseGroup.value.items || []).forEach(task => {
      const id = `database:${task.file_uuid}`;
      databaseItems.push(databaseTaskToQueueItem(task, previous.get(id)));
    });
    databaseParsedTotal.value = databaseItems.filter(item => item.status === "done").length;
    rows.push(...databaseItems);
  } else {
    rows.push(...parseQueue.value.filter(item => item.queueKind === "database"));
  }

  [himawariGroup, fy3Group].forEach((group, index) => {
    const businessType = index === 0 ? "Himawari" : "FY3";
    if (group.status !== "fulfilled") {
      rows.push(...parseQueue.value.filter(item => item.queueKind === "raw" && item.dataType === businessType));
      return;
    }
    (group.value.scenes || []).forEach(scene => {
      const item = rawSceneToQueueItem(scene);
      item.checked = previous.get(item.id)?.checked || false;
      if (item.status !== "done") rows.push(item);
    });
  });
  const activeTasks = [fy3TasksGroup, himawariTasksGroup]
    .flatMap(group => group.status === "fulfilled" ? (group.value.tasks || []) : []);
  const activeByScene = new Map();
  activeTasks.forEach(task => {
    (task.scene_ids || []).forEach(sceneId => activeByScene.set(`${task.business_type}:${sceneId}`, task));
  });
  rows.forEach(row => {
    const task = activeByScene.get(row.id);
    if (!task) return;
    row.status = "parsing";
    row.rawStatus = task.stage;
    row.progress = Number(task.progress || 0);
    row.taskId = task.task_id;
    row.missing = [task.current_band ? `${task.current_scene || row.sceneId} · ${task.current_band}` : "后台解析中"];
    if (row.steps?.[1]) {
      row.steps[1] = {label: "解析", state: parseStatusText(row), t: "后台任务", ok: false, running: true};
    }
  });
  parseQueue.value = rows.sort((a, b) => String(b.uploaded || b.sceneId).localeCompare(String(a.uploaded || a.sceneId)));
  syncLocalFileStatus(databaseItems);
}

async function switchTab(nextTab) {
  if (nextTab === tab.value) return;
  try {
    await refreshParseQueue();
    if (nextTab === "upload") {
      const completedIds = new Set(files.value.filter(file => file.status === "done").map(file => file.id));
      if (completedIds.has(selected.value)) selected.value = null;
      files.value = files.value.filter(file => file.status !== "done");

      const nameCounts = {};
      files.value.forEach(file => {
        nameCounts[file.name] = (nameCounts[file.name] || 0) + 1;
      });
      files.value.forEach(file => {
        file.dup = nameCounts[file.name] > 1;
      });
    }
  } catch (err) {
    console.error("页签数据刷新失败：", err);
  } finally {
    tab.value = nextTab;
  }
}
async function run(f) {
  f.status = "uploading";
  f.percent = 0;
  const uploadType = normalizeDataTypeForBackend(f.dataType, f.name);
  const collectionUpload = isSatelliteCollectionType(uploadType);
  f.steps = [
    { label: "上传", state: "上传中 0%", t: "", ok: false, running: true },
    { label: "解析", state: collectionUpload ? "等待集合完整" : "待解析", t: "", ok: false, running: false },
    { label: "渲染 WEBP", state: "等待", t: "", ok: false, running: false },
    { label: "前端展示", state: "等待", t: "", ok: false, running: false },
  ];

  const controller = new AbortController();
  uploadControllers.set(f.id, controller);
  try {
    const uploadData = await uploadFileResumable(f.raw, uploadType, p => {
      f.percent = p;
      f.steps[0].state = `上传中 ${Math.floor(p)}%`;
    }, {
      signal: controller.signal,
      collectionUuid: f.collectionAssignment?.collection_uuid || null,
      collectionRole: f.collectionAssignment?.role || null,
    });

    f.steps[0].ok = true;
    f.steps[0].running = false;
    f.steps[0].state = "成功";
    f.steps[0].t = now();
    f.fileUuid = uploadData.file_uuid;
    if (uploadData.duplicate_content) {
      const duplicateCollection = uploadData.collection || null;
      const duplicateMissing = Array.isArray(duplicateCollection?.missing_roles)
        ? duplicateCollection.missing_roles
        : [];
      const parsedDuplicate = uploadData.parse_status === "success";
      const failedDuplicate = uploadData.parse_status === "failed";
      f.steps[1].ok = parsedDuplicate;
      f.steps[1].running = uploadData.parse_status === "running";
      f.steps[1].state = parsedDuplicate ? "复用已有结果" : failedDuplicate ? "原任务解析失败" : "复用已有任务";
      f.steps[1].t = now();
      f.steps[2].ok = parsedDuplicate;
      f.steps[2].state = parsedDuplicate ? "无需重复处理" : "跟随原任务";
      f.steps[3].ok = parsedDuplicate;
      f.steps[3].state = parsedDuplicate ? "已有数据可展示" : "等待原任务";
      f.meta = {
        file: f.name,
        element: uploadType,
        time: "—",
        level: "重复数据",
        range: duplicateCollection ? `集合 ${duplicateCollection.scene_key}` : "复用已有数据记录",
        grid: parsedDuplicate ? "无需重复解析" : "沿用原解析任务",
        missing: duplicateMissing.length ? duplicateMissing.join("、") : "—",
        unit: "—",
        vars: "—",
        steps: "—",
        status: "检测到重复数据",
        quality: parsedDuplicate ? "已复用" : "复用任务中",
        alert: duplicateCollection
          ? `集合 ${duplicateCollection.collection_uuid}`
          : "该数据已存在，系统已复用已有记录或解析结果。",
      };
      f.uploadResult = uploadData;
      f.status = "done";
      selected.value = f.id;
      ElNotification({
        title: "上传的是重复数据",
        message: `${f.name} 与已有数据重复，系统已复用已有记录或解析结果。`,
        type: "warning",
        position: "top-right",
        duration: 4500,
      });
      await refreshParseQueue();
      selected.value = `database:${f.fileUuid}`;
      tab.value = "parse";
      return;
    }
    const collection = uploadData.collection || null;
    const missingRoles = Array.isArray(collection?.missing_roles) ? collection.missing_roles : [];
    const waitingCollection = uploadData.parse_status === "waiting_collection" || collection?.status === "collecting";
    f.steps[1].running = uploadData.parse_status === "running";
    f.steps[1].state = waitingCollection
      ? `等待集合完整（缺 ${missingRoles.length}）`
      : uploadData.parse_status === "running" ? "解析中" : "等待 Worker";
    f.steps[2].state = "等待 Adapter";
    f.steps[3].state = "待解析完成";
    f.meta = {
      file: f.name,
      element: uploadType,
      time: "—",
      level: collectionUpload ? "卫星场景集合成员" : "原始单文件",
      range: collectionUpload ? `集合 ${collection?.scene_key || "—"}` : "私有 raw 存储",
      grid: "待解析",
      missing: missingRoles.length ? missingRoles.join("、") : "待 Adapter 检查",
      unit: "—",
      vars: "—",
      steps: "—",
      status: waitingCollection ? "已上传，等待集合其余成员" : "已上传，等待自动解析",
      quality: "待解析",
      alert: collectionUpload
        ? `集合 ${collection?.collection_uuid || f.collectionAssignment?.collection_uuid || "—"}`
        : `任务 ${uploadData.file_uuid}`,
    };
    f.uploadResult = uploadData;
    f.status = "done";
    selected.value = f.id;
    await refreshParseQueue();
    selected.value = `database:${f.fileUuid}`;
    tab.value = "parse";
  } catch (err) {
    const cancelled = err?.name === "AbortError" || controller.signal.aborted;
    const msg = cancelled ? "已由用户取消，可重新选择后断点续传" : (err?.message || "失败");

    const runningStep = f.steps.find(s => s.running);
    if (runningStep) {
      runningStep.ok = false;
      runningStep.running = false;
      runningStep.state = msg;
    } else {
      f.steps[0].ok = false;
      f.steps[0].running = false;
      f.steps[0].state = msg;
    }

    f.status = cancelled ? "cancelled" : "error";
    if (!cancelled) console.error("上传或解析失败：", err);
  } finally {
    uploadControllers.delete(f.id);
  }
}

async function queueUploads(items) {
  const pending = items.filter(file => file.status === "pending");
  const satelliteGroups = new Map();
  pending.forEach(file => {
    const type = normalizeDataTypeForBackend(file.dataType, file.name);
    if (!isSatelliteCollectionType(type)) return;
    if (!satelliteGroups.has(type)) satelliteGroups.set(type, []);
    satelliteGroups.get(type).push(file);
  });
  const rejected = new Set();
  await Promise.all([...satelliteGroups.entries()].map(async ([type, group]) => {
    try {
      const prepared = await prepareUploadCollections(group.map(file => file.raw), type);
      const assignments = new Map((prepared.assignments || []).map(item => [item.file_id, item]));
      group.forEach(file => {
        const fileId = `${file.name}-${file.raw.size}-${file.raw.lastModified}`;
        const assignment = assignments.get(fileId);
        if (!assignment) throw new Error(`${file.name} 未返回集合角色`);
        file.collectionAssignment = assignment;
      });
    } catch (error) {
      group.forEach(file => {
        rejected.add(file.id);
        file.checked = false;
        file.status = "error";
        file.steps = [{ label: "集合准备", state: error?.message || "集合准备失败", t: now(), ok: false, running: false }];
      });
      console.error("卫星集合准备失败：", error);
    }
  }));
  pending.forEach(f => {
    if (rejected.has(f.id)) return;
    if (f.status !== "pending") return;
    f.checked = false;
    f.status = "queued";
    uploadQueue.push(f);
  });
  pumpUploadQueue();
}

function pumpUploadQueue() {
  while (activeUploadCount < 2 && uploadQueue.length) {
    const file = uploadQueue.shift();
    if (!file || file.status !== "queued") continue;
    activeUploadCount += 1;
    run(file).finally(() => {
      activeUploadCount -= 1;
      pumpUploadQueue();
    });
  }
}

function cancelFileUpload(file) {
  const controller = uploadControllers.get(file.id);
  if (controller) {
    controller.abort();
    return;
  }
  const index = uploadQueue.findIndex(item => item.id === file.id);
  if (index >= 0) uploadQueue.splice(index, 1);
  file.status = "cancelled";
  file.steps = [{label: "上传", state: "已在开始前取消", t: now(), ok: false, running: false}];
}

function toggleAll(e) {
  files.value.forEach(f => {
    f.checked = e.target.checked;
  });
}

function togglePqAll(e) {
  parseQueue.value.forEach(f => {
    if (canQueueAction(f)) {
      f.checked = e.target.checked;
    }
  });
}

function deleteChecked() {
  const ids = new Set(checked.value.map(f => f.id));

  if (ids.has(selected.value)) {
    selected.value = null;
  }

  files.value = files.value.filter(f => !ids.has(f.id));

  const counts = {};
  files.value.forEach(f => {
    counts[f.name] = (counts[f.name] || 0) + 1;
  });

  files.value.forEach(f => {
    f.dup = counts[f.name] > 1;
  });
}

function uploadChecked() {
  const sel = files.value.filter(f => f.checked && f.status === "pending");
  const withType = sel.filter(f => f.dataType);
  const withoutType = sel.filter(f => !f.dataType);

  if (withoutType.length === 0) {
    queueUploads(withType);
    return;
  }

  missingTypeFiles.value = withoutType.map(f => f.name);
  pendingUpload.value = withType;
  dlgVisible.value = true;
}

function doUpload() {
  queueUploads(pendingUpload.value);

  pendingUpload.value = [];
  missingTypeFiles.value = [];
  dlgVisible.value = false;
}

function cancelUpload() {
  pendingUpload.value = [];
  missingTypeFiles.value = [];
  dlgVisible.value = false;
}

function deletePqChecked() {
  parseQueue.value.forEach(f => { f.checked = false; });
}

async function parsePqChecked() {
  const selectedRows = parseQueue.value.filter(f => f.checked && canQueueAction(f));
  if (!selectedRows.length) return;

  const rawRows = selectedRows.filter(f => f.queueKind === "raw");
  const databaseRows = selectedRows.filter(f => f.queueKind === "database");
  const collectionIds = [...new Set(databaseRows.map(row => row.collectionUuid).filter(Boolean))];
  const singleDatabaseRows = databaseRows.filter(row => !row.collectionUuid);
  const scenesByType = new Map();
  rawRows.forEach(row => {
    const type = normalizeDataTypeForBackend(row.dataType);
    if (!type || !row.sceneId) return;
    if (!scenesByType.has(type)) scenesByType.set(type, []);
    scenesByType.get(type).push(row.sceneId);
  });
  selectedRows.forEach(f => {
    f.checked = false;
    f.status = "parsing";
  });

  try {
    const [outcomes] = await Promise.all([
      Promise.all([...scenesByType.entries()].map(async ([type, sceneIds]) => {
        const task = await startSatelliteParseTask(type, sceneIds);
        selectedRows.forEach(row => {
          if (row.dataType === type && sceneIds.includes(row.sceneId)) row.taskId = task.task_id;
        });
        const finished = await waitForSatelliteParseTask(type, task.task_id, {
          onProgress(current) {
            selectedRows.forEach(row => {
              if (row.dataType !== type || !(current.scene_ids || []).includes(row.sceneId)) return;
              row.status = "parsing";
              row.rawStatus = current.stage;
              row.progress = Number(current.progress || 0);
              row.missing = [current.current_band ? `${current.current_scene || row.sceneId} · ${current.current_band}` : "后台解析中"];
              row.steps = row.steps || [];
              row.steps[1] = {label: "解析", state: parseStatusText(row), t: "后台任务", ok: false, running: true};
            });
          },
        });
        if (["failed", "interrupted", "cancelled"].includes(finished.state)) throw new Error(finished.error || `${type} 解析任务未完成`);
        return {type, task: finished, result: finished.result || {}};
      })),
      Promise.all([
        ...singleDatabaseRows.map(row => retryUploadTask(row.fileUuid)),
        ...collectionIds.map(collectionUuid => retryUploadCollection(collectionUuid)),
      ]),
    ]);
    await refreshParseQueue();
    outcomes.forEach(outcome => {
      (outcome.result?.results || [])
        .filter(item => item?.status === "error")
        .forEach(item => {
          const row = parseQueue.value.find(candidate => candidate.sceneId === item.scene_id && candidate.dataType === outcome.type);
          if (!row) return;
          row.status = "error";
          row.rawStatus = "parse_error";
          row.missing = [item.error || "解析失败"];
        });
    });
  } catch (err) {
    selectedRows.forEach(f => {
      f.status = "error";
      f.rawStatus = "parse_error";
      f.missing = [err?.message || "解析失败"];
    });
    console.error("解析或重试失败：", err);
  }
}

function onDrop(e) {
  dragging.value = false;
  addFiles(e.dataTransfer.files);
}

function onPick(e) {
  addFiles(e.target.files);
  e.target.value = "";
}

onMounted(() => {
  refreshParseQueue().catch(err => console.error("解析队列读取失败：", err));
  queueTimer = window.setInterval(() => {
    refreshParseQueue().catch(err => console.error("解析队列轮询失败：", err));
  }, 3000);
});

onBeforeUnmount(() => {
  uploadControllers.forEach(controller => controller.abort());
  if (queueTimer) window.clearInterval(queueTimer);
});
</script>

<style scoped>
.up {
  display: flex;
  gap: 10px;
  padding: 10px;
  height: 100%;
  min-height: 0;
}

.stats-row {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}

.stat-card {
  flex: 1;
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sc-label { font-size: 11px; color: var(--muted); }
.sc-val { font-size: 28px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
.sc-val.ok { color: var(--ok); }
.sc-val.accent { color: var(--accent); }
.sc-sub { font-size: 11px; color: var(--muted); }

.up-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drop-zone {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 22px 20px;
  border: 1.5px dashed var(--border);
  border-radius: 14px;
  background: var(--glass);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  cursor: pointer;
  transition: border-color 0.15s;
}
.drop-zone:hover, .drop-zone.over { border-color: var(--accent); }
.drop-zone:hover .dz-icon, .drop-zone.over .dz-icon { color: var(--accent); }
.dz-icon { font-size: 38px; color: var(--muted); transition: color 0.15s; }
.dz-title { margin: 0; font-size: 14px; color: var(--text); }
.dz-title em { color: var(--accent); font-style: normal; }
.dz-hint { font-size: 12px; color: var(--muted); }

.file-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
}

.sec-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.sec-info { flex: 1; font-size: 12px; color: var(--muted); }

.tabs { display: flex; gap: 2px; }
.tabs button {
  padding: 4px 12px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: 0.15s;
}
.tabs button:hover { color: var(--text); }
.tabs button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.bar-btns { display: flex; align-items: center; gap: 8px; }
.batch-type { display: flex; align-items: center; gap: 6px; }
.batch-type-select {
  width: 116px;
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: 0.15s;
  font: inherit;
}
.act:disabled { opacity: 0.35; cursor: not-allowed; pointer-events: none; }
.act.del:not(:disabled):hover { border-color: #ef4444; color: #ef4444; }
.act.up { border-color: var(--accent); color: var(--accent); }
.act.up:not(:disabled):hover { background: var(--accent); color: #fff; }
.act.parse { border-color: var(--ok); color: var(--ok); }
.act.parse:not(:disabled):hover { background: var(--ok); color: #fff; }

.tbl-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.tbl-wrap::-webkit-scrollbar { width: 5px; height: 5px; }
.tbl-wrap::-webkit-scrollbar-track { background: transparent; border-radius: 3px; }
.tbl-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; transition: background 0.15s; }
.tbl-wrap::-webkit-scrollbar-thumb:hover { background: var(--muted); }
.tbl-wrap::-webkit-scrollbar-corner { background: transparent; }

.tbl {
  width: 100%;
  min-width: 720px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 12px;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--glass-2);
  font-size: 11px;
  color: var(--muted);
  font-weight: 600;
  padding: 9px 8px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}

tbody td {
  padding: 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
}
tbody tr:last-child td { border-bottom: none; }

tbody tr:not(.hl):hover td:not(.pin-l):not(.pin-r) { background: rgba(128, 128, 128, 0.05); }
tbody tr.record-row { cursor: pointer; }
tbody tr.done { cursor: pointer; }
tbody tr.done:not(.hl):hover td:not(.pin-l):not(.pin-r) { background: var(--field); }
tbody tr.hl td:not(.pin-l):not(.pin-r) { background: var(--accent-soft); }

.pin-l {
  position: sticky;
  right: 76px;
  z-index: 1;
  background: var(--glass-2);
  box-shadow: -4px 0 8px rgba(0, 0, 0, 0.14);
}
.pin-r { position: sticky; right: 0; z-index: 1; background: var(--glass-2); }
thead .pin-l, thead .pin-r { z-index: 3; }

.tbl-empty { padding: 28px 14px; text-align: center; color: var(--muted); font-size: 13px; }

.td-name { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.dup-icon { flex-shrink: 0; font-size: 13px; color: #f59e0b; cursor: default; }
.trunc { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
input[type="checkbox"] { cursor: pointer; accent-color: var(--accent); }

.type-sel {
  width: 100%;
  font-size: 11px;
  padding: 3px 5px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--field);
  color: var(--text);
  cursor: pointer;
  outline: none;
  appearance: auto;
}
.type-sel:focus { border-color: var(--accent); }
.type-sel:disabled { opacity: 0.45; cursor: default; }
.type-sel option { background: var(--glass-2); color: var(--text); }
.type-cell { display: grid; gap: 3px; min-width: 0; }
.type-cell small { overflow: hidden; color: var(--accent); font-size: 9px; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
.type-cell small.unresolved { color: #b45309; }

.type-tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--border);
  color: var(--muted);
  white-space: nowrap;
}

.badge { display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
.badge.pending { border: 1px solid var(--border); color: var(--muted); }
.badge.queued { background: rgba(245, 158, 11, 0.14); color: #f59e0b; }
.badge.uploading { background: var(--accent-soft); color: var(--accent); }
.badge.done { background: rgba(52, 211, 153, 0.15); color: var(--ok); }
.badge.error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.badge.cancelled { border: 1px solid var(--border); color: var(--muted); }
.row-cancel {
  margin-left: 5px;
  padding: 1px 5px;
  border: 1px solid rgba(239, 68, 68, 0.55);
  border-radius: 5px;
  background: transparent;
  color: #ef4444;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.req { color: #ef4444; margin-left: 2px; font-weight: 700; }

.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dlg {
  width: 420px;
  max-width: calc(100vw - 40px);
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  background: var(--field);
  border: 1px solid var(--border);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  color: var(--text);
}

.dlg-head {
  flex-shrink: 0;
  padding: 0 20px;
  height: 52px;
  display: flex;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}

.dlg-body {
  padding: 18px 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dlg-desc { margin: 0; font-size: 13px; color: var(--text); }

.dlg-list {
  margin: 0;
  padding: 10px 14px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--border);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 160px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.dlg-list li {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 12px;
  position: relative;
}

.dlg-list li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ef4444;
}

.dlg-confirm { margin: 0; font-size: 13px; color: var(--text); }
.dlg-confirm b { color: var(--accent); }

.dlg-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border);
}

.dlg-cancel {
  padding: 6px 18px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--field);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
}
.dlg-cancel:hover { border-color: var(--muted); }

.dlg-ok {
  padding: 6px 18px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
}
.dlg-ok:hover { opacity: 0.88; }
</style>main.py
