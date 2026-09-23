<template>
  <main class="downscale-page">
    <header class="hero glass">
      <div>
        <span>MICROSCALE DOWNSCALING</span>
        <h1>降尺度工作台</h1>
        <p>把 WRF 的中尺度背景场规范地交接给 1 m OpenFOAM 微尺度模拟。</p>
      </div>
      <div class="hero-actions">
        <el-button :loading="loading" @click="loadTasks">刷新 WRF 任务</el-button>
        <el-button type="primary" @click="saveDraft">保存方案草稿</el-button>
      </div>
    </header>

    <section class="workflow glass">
      <div class="section-title"><div><span>PIPELINE</span><h2>约 10 m → 1 m CFD 工程链</h2></div><small>已完成的 d08 WRF-LES forcing 作为入口；CFD 依据审核地形、建筑与湍流闭合生成微尺度结构。</small></div>
      <div class="chain" aria-label="降尺度流程">
        <template v-for="(stage, index) in stages" :key="stage.resolution">
          <article :class="['stage', { handoff: stage.handoff }]">
            <b>{{ stage.resolution }}</b><span>{{ stage.engine }}</span><small>{{ stage.note }}</small>
          </article>
          <i v-if="index < stages.length - 1">→</i>
        </template>
      </div>
      <div class="handoff-note"><b>WRF–CFD 交接点：12.345679 m（约 10 m）</b><span>传递已校验 d08 三维场与地表强迫，不把 WRF 栅格简单插值成 1 m。</span></div>
    </section>

    <div class="layout">
      <section class="panel glass">
        <div class="section-title"><div><span>01 · UPSTREAM</span><h2>WRF 输入场</h2></div><el-tag :type="sourceReady ? 'success' : 'info'">{{ sourceReady ? '已选择' : '待选择' }}</el-tag></div>
        <p class="hint">选择已完成的 WRF 任务。正式实验需要至少一个完整天气过程；3 小时结果仅适用于接口 smoke test。</p>
        <el-select v-model="form.wrfTaskId" filterable clearable placeholder="选择已完成 WRF 任务" @change="syncTask" class="wide">
          <el-option v-for="task in completedTasks" :key="task.id" :value="task.id" :label="taskLabel(task)" />
        </el-select>
        <div v-if="selectedTask" class="task-card">
          <b>{{ selectedTask.id }}</b>
          <span>{{ String(selectedTask.request?.data_source || 'gfs').toUpperCase() }} · {{ taskDuration(selectedTask) }} · {{ selectedTask.status }}</span>
          <small>需确认已完成约 10 m d08 forcing，并完成变量 QA。</small>
        </div>
        <el-alert v-else title="尚未关联 WRF 任务" type="warning" :closable="false" show-icon />
        <el-checkbox v-model="form.smokeOnly">这是接口 smoke test，不作为正式科学实验输入</el-checkbox>

        <div class="sub-title">交接变量</div>
        <div class="variables"><el-tag v-for="item in variables" :key="item" effect="plain">{{ item }}</el-tag></div>
        <p class="hint">处理顺序：U/V/W 去交错与风向旋转；p=P+PB；θ=T+300 后换算温度；z=(PH+PHB)/g；再插值到 CFD 边界。</p>
      </section>

      <section class="panel glass">
        <div class="section-title"><div><span>02 · CFD DESIGN</span><h2>1 m 微尺度域</h2></div><el-tag type="primary">{{ form.solver }}</el-tag></div>
        <el-form label-position="top" class="design-form">
          <div class="form-grid">
            <el-form-item label="核心评价区边长 (m)"><el-input-number v-model="form.coreSize" :min="100" :max="5000" :step="100" /></el-form-item>
            <el-form-item label="边界缓冲 (m)"><el-input-number v-model="form.bufferSize" :min="100" :max="5000" :step="100" /></el-form-item>
            <el-form-item label="核心网格 (m)"><el-input-number v-model="form.gridResolution" :min="0.5" :max="10" :step="0.5" /></el-form-item>
            <el-form-item label="湍流求解"><el-select v-model="form.solver"><el-option label="RANS · 平均风温场" value="RANS" /><el-option label="LES · 瞬态湍流结构" value="LES" /></el-select></el-form-item>
          </div>
          <el-form-item label="地形 / 建筑数据质量"><el-radio-group v-model="form.terrain"><el-radio-button label="high">1–5 m DTM/DSM 或 LiDAR + 建筑</el-radio-button><el-radio-button label="coarse">30 m DEM 重采样</el-radio-button></el-radio-group></el-form-item>
        </el-form>
        <div class="domain-preview"><div class="outer"><div class="core">核心区<br><b>{{ form.coreSize }} × {{ form.coreSize }} m</b></div></div><span>CFD 计算域：{{ totalDomainSize }} × {{ totalDomainSize }} m（含 {{ form.bufferSize }} m 边界缓冲）</span></div>
        <el-alert v-if="form.terrain === 'coarse'" title="30 m DEM 重采样不会增加地形信息；可用于接口验证，但需在成果中如实声明底层数据有效分辨率。" type="warning" :closable="false" show-icon />
      </section>
    </div>

    <section class="panel glass readiness">
      <div class="section-title"><div><span>03 · READINESS</span><h2>运行就绪检查</h2></div><el-tag :type="readyForProduction ? 'success' : 'warning'">{{ readyForProduction ? '可进入正式实验' : '需要补齐条件' }}</el-tag></div>
      <div class="checks">
        <article v-for="check in checks" :key="check.label" :class="check.ok ? 'ok' : 'pending'"><b>{{ check.ok ? '✓' : '!' }}</b><div><strong>{{ check.label }}</strong><span>{{ check.detail }}</span></div></article>
      </div>
      <div class="execution-note"><b>执行边界</b><span>CFD 任务必须从已通过质量门的约 10 m forcing 结果页创建；OpenFOAM 运行完成后回写 1 m 采样产品与可视化资产。</span></div>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { listWrfTasks } from "../api.js";

const DRAFT_KEY = "downscale-workbench-draft-v1";
const stages = [
  { resolution: "27 km", engine: "驱动资料", note: "GFS / ECMWF / ERA5" },
  { resolution: "9 km", engine: "WRF", note: "嵌套" },
  { resolution: "3 km", engine: "WRF", note: "嵌套" },
  { resolution: "1 km", engine: "WRF", note: "普通 WRF 最细域" },
  { resolution: "333.333 m", engine: "NDOWN / WRF-LES", note: "三维强迫" },
  { resolution: "111.111 m", engine: "NDOWN / WRF-LES", note: "三维强迫" },
  { resolution: "37.037 m", engine: "NDOWN / WRF-LES", note: "三维强迫" },
  { resolution: "12.346 m", engine: "WRF-LES", note: "约 10 m forcing", handoff: true },
  { resolution: "1 m", engine: "OpenFOAM", note: "微尺度结果" },
];
const variables = ["U / V / W", "T + P + PB", "PH + PHB", "QVAPOR", "TKE / UST", "HFX / LH", "PBLH"];
const tasks = ref([]);
const loading = ref(false);
const form = reactive({ wrfTaskId: "", smokeOnly: true, coreSize: 500, bufferSize: 500, gridResolution: 1, solver: "RANS", terrain: "high" });

try { Object.assign(form, JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}")); } catch { /* ignore malformed local draft */ }
const completedTasks = computed(() => tasks.value.filter(task => ["succeeded", "partial_success"].includes(task.status)));
const selectedTask = computed(() => completedTasks.value.find(task => task.id === form.wrfTaskId) || null);
const sourceReady = computed(() => Boolean(selectedTask.value));
const totalDomainSize = computed(() => Number(form.coreSize) + Number(form.bufferSize) * 2);
const checks = computed(() => [
  { ok: sourceReady.value, label: "已关联 WRF 成功任务", detail: sourceReady.value ? selectedTask.value.id : "从 WRF 工作台选择已完成的约 10 m forcing 任务" },
  { ok: !form.smokeOnly, label: "正式时间积分", detail: form.smokeOnly ? "当前标为 smoke test；不可作为论文实验最终输入" : "已声明为正式天气过程，请在任务产物中复核时次和 NaN" },
  { ok: form.terrain === "high", label: "地形与建筑资料", detail: form.terrain === "high" ? "采用 1–5 m DTM/DSM 或 LiDAR 与建筑数据" : "30 m DEM 只可表达粗地形，不能宣称 1 m 地形" },
  { ok: Number(form.bufferSize) >= 300, label: "CFD 边界缓冲", detail: `${form.bufferSize} m 缓冲；核心评价区不贴近入口、出口和侧边界` },
  { ok: form.solver === "RANS" || form.solver === "LES", label: "湍流方案已选定", detail: form.solver === "LES" ? "需合成湍流入口与足够 spin-up" : "适于平均风温场；需构造 k/ε 或等效入口湍流量" },
]);
const readyForProduction = computed(() => checks.value.every(check => check.ok));

function taskDuration(task) {
  const start = new Date(task.request?.start_time || 0); const end = new Date(task.request?.end_time || 0);
  const hours = (end - start) / 3600000;
  return Number.isFinite(hours) && hours > 0 ? `${hours} 小时` : "时段待核验";
}
function taskLabel(task) { return `${task.id} · ${String(task.request?.data_source || "gfs").toUpperCase()} · ${taskDuration(task)}`; }
function syncTask() { if (selectedTask.value) ElMessage.success("已关联 WRF 上游任务；请继续核验最细域和变量 QA。"); }
async function loadTasks() {
  loading.value = true;
  try { tasks.value = await listWrfTasks(100); }
  catch (error) { ElMessage.warning(`无法读取 WRF 任务：${error.message}`); }
  finally { loading.value = false; }
}
function saveDraft() { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form })); ElMessage.success("降尺度方案草稿已保存到此浏览器。"); }
onMounted(loadTasks);
</script>

<style scoped>
.downscale-page{min-height:calc(100vh - 62px);padding:18px;display:grid;gap:12px;background:radial-gradient(circle at 80% 0,#0e74901f,transparent 31%)}.glass{border:1px solid var(--border);border-radius:14px;background:var(--panel);box-shadow:0 8px 28px #0206170b}.hero{display:flex;justify-content:space-between;align-items:center;padding:18px 20px}.hero span,.section-title>div>span{font-size:10px;letter-spacing:1.2px;color:var(--accent);font-weight:700}.hero h1,.section-title h2{margin:4px 0 0;font-size:20px}.hero p,.hint{margin:6px 0 0;color:var(--muted);font-size:12px}.hero-actions{display:flex;gap:8px}.workflow,.panel{padding:16px}.section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.section-title small{max-width:480px;color:var(--muted);font-size:11px;text-align:right}.chain{display:flex;align-items:stretch;gap:5px;margin-top:14px;overflow-x:auto;padding-bottom:4px}.chain>i{align-self:center;color:var(--muted);font-style:normal}.stage{min-width:92px;display:grid;gap:4px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--field)}.stage b{font-size:15px}.stage span{font-size:10px;color:var(--accent);font-weight:700}.stage small{font-size:9px;color:var(--muted)}.stage.handoff{border-color:#22c55e99;background:#22c55e10}.handoff-note{display:flex;gap:9px;margin-top:11px;padding:9px 11px;border-radius:8px;background:#22c55e0c;color:var(--muted);font-size:11px}.handoff-note b{color:#16a34a}.layout{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wide{width:100%;margin:10px 0}.task-card{display:grid;gap:5px;padding:10px;margin-bottom:10px;border-radius:9px;background:var(--field);font-size:11px}.task-card span,.task-card small{color:var(--muted)}.panel :deep(.el-checkbox){margin-top:12px;font-size:11px}.sub-title{margin-top:17px;font-size:12px;font-weight:700}.variables{display:flex;flex-wrap:wrap;gap:6px;margin:9px 0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.domain-preview{display:grid;justify-items:center;gap:8px;margin:6px 0 15px;color:var(--muted);font-size:11px}.outer{display:grid;place-items:center;width:180px;height:125px;border:2px dashed #38bdf8;background:#38bdf80b}.core{display:grid;place-content:center;width:88px;height:62px;border:1px solid #22c55e;background:#22c55e18;text-align:center;font-size:9px}.core b{font-size:10px}.checks{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px}.checks article{display:flex;gap:8px;padding:10px;border:1px solid var(--border);border-radius:9px}.checks article>b{display:grid;place-items:center;flex:0 0 19px;height:19px;border-radius:50%;font-size:11px}.checks .ok>b{color:#15803d;background:#22c55e22}.checks .pending>b{color:#b45309;background:#f59e0b22}.checks strong,.checks span{display:block;font-size:10px}.checks span{margin-top:4px;color:var(--muted);line-height:1.4}.execution-note{display:flex;gap:10px;margin-top:12px;padding:10px;border-left:3px solid var(--accent);background:var(--field);font-size:11px;color:var(--muted)}.execution-note b{color:var(--text);white-space:nowrap}@media(max-width:1000px){.layout{grid-template-columns:1fr}.checks{grid-template-columns:1fr 1fr}.hero{align-items:flex-start;gap:12px;flex-direction:column}}@media(max-width:620px){.downscale-page{padding:10px}.hero-actions,.form-grid{display:grid;width:100%}.checks{grid-template-columns:1fr}.section-title small{display:none}.handoff-note{display:grid}}
</style>
