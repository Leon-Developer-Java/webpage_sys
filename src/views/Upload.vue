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
        <small class="dz-hint">支持 .cinrad / .nc / .grib2 / .hsd 等格式，可多选</small>
        <input ref="input" type="file" multiple hidden @change="onPick" />
      </div>

      <div class="file-section glass">
        <div class="sec-bar">
          <div class="tabs">
            <button :class="{ on: tab === 'upload' }" @click="tab = 'upload'">待上传</button>
            <button :class="{ on: tab === 'parse' }" @click="tab = 'parse'">待解析</button>
          </div>
          <span class="sec-info">
            {{ tab === 'upload'
              ? (checked.length ? `已选 ${checked.length} 个` : `共 ${files.length} 个`)
              : (pqChecked.length ? `已选 ${pqChecked.length} 个` : `共 ${parseQueue.length} 个`) }}
          </span>
          <div class="bar-btns">
            <template v-if="tab === 'upload'">
              <button class="act del" :disabled="!checked.length" @click="deleteChecked">
                <el-icon><Delete /></el-icon>删除
              </button>
              <button class="act up" :disabled="!checked.length" @click="uploadChecked">
                <el-icon><Upload /></el-icon>上传选中
              </button>
            </template>
            <template v-else>
              <button class="act del" :disabled="!pqChecked.length" @click="deletePqChecked">
                <el-icon><Delete /></el-icon>删除
              </button>
              <button class="act parse" :disabled="!pqChecked.length" @click="parsePqChecked">
                <el-icon><DataAnalysis /></el-icon>解析选中
              </button>
            </template>
          </div>
        </div>

        <div class="tbl-wrap" v-if="tab === 'upload'">
          <table class="tbl">
            <colgroup>
              <col style="width:36px"><col>
              <col style="width:68px"><col style="width:90px">
              <col style="width:130px"><col style="width:124px"><col style="width:76px">
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
                  <select class="type-sel" v-model="f.dataType" @click.stop :disabled="f.status !== 'pending'">
                    <option value="">选择类型</option>
                    <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="pin-r">
                  <span :class="['badge', f.status]">{{ STATUS[f.status] }}</span>
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
                <th><input type="checkbox" :checked="pqAllChecked" @change="togglePqAll" :disabled="!parseQueue.length" /></th>
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
                <td colspan="7" class="tbl-empty">待解析队列为空</td>
              </tr>
              <tr v-for="f in parseQueue" :key="f.id" :class="{ done: f.status === 'done' }">
                <td><input type="checkbox" v-model="f.checked" :disabled="f.status !== 'pending'" @click.stop /></td>
                <td><span class="trunc" :title="f.name">{{ f.name }}</span></td>
                <td>{{ f.fmt }}</td>
                <td>{{ f.size }}</td>
                <td>{{ f.uploaded }}</td>
                <td class="pin-l"><span class="type-tag">{{ f.dataType }}</span></td>
                <td class="pin-r">
                  <span :class="['badge', f.status === 'parsing' ? 'uploading' : f.status]">{{ PARSE_STATUS[f.status] }}</span>
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
import { computed, ref } from "vue";
import { DataAnalysis, Delete, Upload, WarningFilled } from "@element-plus/icons-vue";
import MetaPanel from "../components/MetaPanel.vue";
import { uploadFileResumable } from "../api.js";

const files = ref([]);
const selected = ref(null);
const dragging = ref(false);
const input = ref(null);
const tab = ref('upload');
const dlgVisible = ref(false);
const missingTypeFiles = ref([]);
const pendingUpload = ref([]);

const TYPES = ["ERA5", "GFS/ECMWF", "CMA", "雷达", "葵花", "WRF"];
const STATUS = { pending: "待上传", uploading: "上传中", done: "完成", error: "失败" };
const PARSE_STATUS = { pending: "待解析", parsing: "解析中", done: "已解析", error: "失败" };

const parseQueue = ref([
  { id: 101, name: "era5_t2m_20250610.nc", fmt: "NC", size: "1.28 GB", uploaded: "06-15 09:28", dataType: "ERA5", status: "pending", checked: false },
  { id: 102, name: "radar_xh_20250611_1000.cinrad", fmt: "CINRAD", size: "2.14 MB", uploaded: "06-15 10:15", dataType: "雷达", status: "pending", checked: false },
  { id: 103, name: "himawari_20250612_0000.hsd", fmt: "HSD", size: "380 MB", uploaded: "06-16 07:45", dataType: "葵花", status: "pending", checked: false },
  { id: 104, name: "gfs.t00z.pgrb2.0p25.f012", fmt: "GRIB2", size: "524 MB", uploaded: "06-16 08:10", dataType: "GFS/ECMWF", status: "pending", checked: false },
]);

const checked = computed(() => files.value.filter(f => f.checked));
const allChecked = computed(() => files.value.length > 0 && files.value.every(f => f.checked));
const pqChecked = computed(() => parseQueue.value.filter(f => f.checked));
const pqAllChecked = computed(() => parseQueue.value.length > 0 && parseQueue.value.every(f => f.checked));
const cur = computed(() => {
  const f = files.value.find(f => f.id === selected.value);
  return f?.status === 'done' ? f : null;
});
const stats = computed(() => [
  { label: "已上传", val: files.value.filter(f => f.status === 'done').length, sub: "本次会话", cls: "" },
  { label: "数据库总量", val: "1,284", sub: "42.3 GB", cls: "" },
  { label: "已解析", val: 847 + files.value.filter(f => f.status === 'done').length, sub: "36.1 GB", cls: "ok" },
  { label: "待解析", val: parseQueue.value.filter(f => f.status === 'pending').length, sub: "等待处理", cls: "accent" },
]);

function fmtSize(b) { return b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
function fmtDate(ms) {
  return new Date(ms).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function now() { return new Date().toLocaleTimeString(); }

function addFiles(list) {
  const incoming = [...list].map(file => file.name);
  const incomingSet = new Set(incoming);
  const hasDupInBatch = name => incoming.filter(n => n === name).length > 1;
  const existingNames = new Set(files.value.map(f => f.name));

  files.value.forEach(f => { if (incomingSet.has(f.name)) f.dup = true; });

  for (const file of list) {
    files.value.push({
      id: Date.now() + Math.random(),
      name: file.name,
      fmt: file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : '—',
      size: fmtSize(file.size),
      created: '—',
      modified: file.lastModified ? fmtDate(file.lastModified) : '—',
      dataType: '',
      status: 'pending',
      checked: false,
      dup: existingNames.has(file.name) || hasDupInBatch(file.name),
      steps: [],
      meta: null,
      percent: 0,
      raw: file,
    });
  }
}

async function run(f) {
  f.status = "uploading";
  f.percent = 0;
  f.steps = [
    { label: "上传", state: "上传中 0%", t: "", ok: false, running: true },
    { label: "解析", state: "待解析", t: "", ok: false, running: false },
    { label: "渲染 PNG", state: "等待", t: "", ok: false, running: false },
    { label: "前端展示", state: "等待", t: "", ok: false, running: false },
  ];

  try {
    const data = await uploadFileResumable(f.raw, f.dataType, p => {
      f.percent = p;
      f.steps[0].state = `上传中 ${Math.floor(p)}%`;
    });
    f.steps[0].ok = true; f.steps[0].running = false; f.steps[0].state = "成功"; f.steps[0].t = now();
    f.meta = {
      file: data?.file_name ?? f.name,
      element: "—", time: "—", level: "—", range: "—", grid: "—", unit: "—", missing: "—", vars: "—",
      steps: `已上传至 ${data?.directory ?? "wait_process/"}`,
    };
    f.status = "done";
    if (!selected.value) selected.value = f.id;
  } catch (err) {
    f.steps[0].ok = false; f.steps[0].running = false; f.steps[0].state = "失败";
    f.status = "error";
    console.error("上传失败：", err);
  }
}

function toggleAll(e) { files.value.forEach(f => { f.checked = e.target.checked; }); }
function togglePqAll(e) { parseQueue.value.forEach(f => { if (f.status === 'pending') f.checked = e.target.checked; }); }

function deleteChecked() {
  const ids = new Set(checked.value.map(f => f.id));
  if (ids.has(selected.value)) selected.value = null;
  files.value = files.value.filter(f => !ids.has(f.id));
  const counts = {};
  files.value.forEach(f => { counts[f.name] = (counts[f.name] || 0) + 1; });
  files.value.forEach(f => { f.dup = counts[f.name] > 1; });
}

function uploadChecked() {
  const sel = files.value.filter(f => f.checked && f.status === 'pending');
  const withType = sel.filter(f => f.dataType);
  const withoutType = sel.filter(f => !f.dataType);
  if (withoutType.length === 0) {
    withType.forEach(f => { f.checked = false; run(f); });
    return;
  }
  missingTypeFiles.value = withoutType.map(f => f.name);
  pendingUpload.value = withType;
  dlgVisible.value = true;
}

function doUpload() {
  pendingUpload.value.forEach(f => { f.checked = false; run(f); });
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
  parseQueue.value = parseQueue.value.filter(f => !f.checked);
}

function parsePqChecked() {
  parseQueue.value.filter(f => f.checked && f.status === 'pending').forEach(f => { f.checked = false; f.status = 'parsing'; });
}

function onDrop(e) { dragging.value = false; addFiles(e.dataTransfer.files); }
function onPick(e) { addFiles(e.target.files); e.target.value = ""; }
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

.bar-btns { display: flex; gap: 8px; }
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
.badge.uploading { background: var(--accent-soft); color: var(--accent); }
.badge.done { background: rgba(52, 211, 153, 0.15); color: var(--ok); }
.badge.error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

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
</style>
