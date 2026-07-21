<template>
  <section class="task-config">
    <header class="panel-head">
      <div><span>NEW WRF RUN</span><h2>新建模拟任务</h2></div>
      <div class="head-actions"><el-tag>GFS · HPC</el-tag><el-button text @click="emit('cancel')">取消</el-button></div>
    </header>

    <div class="config-grid">
      <div class="form-column">
        <el-form label-position="top" @submit.prevent>
          <div class="basic-grid">
            <el-form-item label="开始时间（UTC）"><el-input v-model="form.startTime" type="datetime-local" /></el-form-item>
            <el-form-item label="结束时间（UTC）"><el-input v-model="form.endTime" type="datetime-local" /></el-form-item>
            <el-form-item label="中心纬度"><el-input-number v-model="form.center.lat" :min="-85" :max="85" :precision="3" /></el-form-item>
            <el-form-item label="中心经度"><el-input-number v-model="form.center.lon" :min="-180" :max="180" :precision="3" /></el-form-item>
            <el-form-item label="GFS 文件间隔">
              <el-select v-model="form.interval"><el-option v-for="value in intervals" :key="value" :label="`${value} 小时`" :value="value" /></el-select>
            </el-form-item>
            <el-form-item label="同化方案">
              <el-select v-model="form.assimilation"><el-option v-for="item in assimilationOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
            </el-form-item>
            <el-form-item label="预报关注点">
              <el-select v-model="form.forecastFocus"><el-option v-for="item in focusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
            </el-form-item>
            <el-form-item label="Spin-up">
              <div class="spinup-control">
                <el-select v-model="form.spinupMode">
                  <el-option label="自动推荐" value="auto" /><el-option label="关闭（兼容旧任务）" value="off" /><el-option label="自定义" value="custom" />
                </el-select>
                <el-select v-if="form.spinupMode === 'custom'" v-model="form.spinupHours"><el-option v-for="value in spinupHours" :key="value" :label="`${value} 小时`" :value="value" /></el-select>
              </div>
            </el-form-item>
          </div>

          <div class="sub-head">
            <div><h3>嵌套域参数</h3><span>地图范围为配置预览，最终范围以 wrfout 为准</span></div>
            <el-select v-model="domainCount" size="small" @change="resetDomains"><el-option v-for="n in 4" :key="n" :label="`${n} 层`" :value="n" /></el-select>
          </div>
          <div class="domain-cards">
            <article
              v-for="(domain, index) in form.domains"
              :key="domain.id"
              :class="{ active: activeDomain === index, outer: index === 0 }"
              @click="activeDomain = index"
            >
              <b>{{ domain.id.toUpperCase() }}</b>
              <label>网格距
                <el-select :model-value="domain.dx" size="small" @update:model-value="value => setDomainDx(index, value)">
                  <el-option v-for="value in domainDxOptions(index)" :key="value" :label="formatResolution(value)" :value="value" />
                </el-select>
              </label>
              <label>e_we<el-input-number v-model="domain.e_we" :min="10" :max="500" size="small" controls-position="right" /></label>
              <label>e_sn<el-input-number v-model="domain.e_sn" :min="10" :max="500" size="small" controls-position="right" /></label>
              <template v-if="index > 0">
                <label>i start<el-input-number v-model="domain.i_parent_start" :min="1" size="small" controls-position="right" /></label>
                <label>j start<el-input-number v-model="domain.j_parent_start" :min="1" size="small" controls-position="right" /></label>
              </template>
            </article>
          </div>
        </el-form>
      </div>

      <div class="map-column">
        <div class="map-title"><div><b>区域与嵌套域</b><span>选择域后可拖动位置或重画矩形</span></div><span>D{{ String(activeDomain + 1).padStart(2, '0') }}</span></div>
        <div class="domain-map">
          <ProjMap basemap="矢量底图" projection="等经纬" grid vector dark>
            <WrfDomainEditor
              :domains="form.domains"
              :center="form.center"
              :active-index="activeDomain"
              @update:domains="value => form.domains = value"
              @update:center="updateCenter"
              @update:active-index="value => activeDomain = value"
              @invalid="message => ElMessage.warning(message)"
            />
          </ProjMap>
        </div>
      </div>
    </div>

    <section class="physics-panel">
      <div class="sub-head physics-head">
        <div><h3>物理方案</h3><span>常用配置使用预设，必要时展开专家参数</span></div>
        <div class="physics-actions">
          <el-button type="primary" plain :loading="recommending" @click="requestRecommendation">{{ recommending ? 'geogrid 分析中' : '根据区域推荐' }}</el-button>
          <el-select v-model="form.preset" size="small" @change="applyPreset"><el-option v-for="(_, name) in physicsPresets" :key="name" :label="name" :value="name" /></el-select>
          <el-button text @click="expertOpen = !expertOpen">{{ expertOpen ? '收起专家参数' : '展开专家参数' }}</el-button>
        </div>
      </div>
      <div v-if="recommendation" class="recommendation-note">
        <div class="recommendation-summary">
          <b>推荐置信度 {{ Math.round((recommendation.confidence || 0) * 100) }}%</b>
          <span v-if="recommendation.factors">{{ recommendationFactorSummary }}</span>
        </div>
        <ul><li v-for="reason in recommendation.reasons" :key="reason">{{ reason }}</li></ul>
        <el-button size="small" type="primary" @click="applyRecommendation">确认应用推荐</el-button>
      </div>
      <el-collapse-transition>
        <div v-show="expertOpen" class="physics-grid">
          <label v-for="field in physicsFields" :key="field.key">{{ field.label }}<el-input-number v-model="form.physics[field.key]" :min="0" controls-position="right" /></label>
        </div>
      </el-collapse-transition>
    </section>

    <footer class="config-footer">
      <div><b>预计 {{ form.domains.length }} 个嵌套域</b><span>{{ form.startTime }} 至 {{ form.endTime }} · UTC</span></div>
      <el-button type="primary" size="large" :loading="submitting" @click="submit">提交至超算并行队列（最多 {{ maxConcurrentTasks }} 个）</el-button>
    </footer>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { createWrfRecommendation, getWrfRecommendation } from "../api.js";
import ProjMap from "./ProjMap.vue";
import WrfDomainEditor from "./WrfDomainEditor.vue";

const props = defineProps({ options: Object, submitting: Boolean });
const emit = defineEmits(["submit", "cancel"]);

const fallbackDomains = [
  { id: "d01", dx: 27000, dy: 27000, e_we: 100, e_sn: 79, parent_id: 0, parent_grid_ratio: 1, i_parent_start: 1, j_parent_start: 1 },
  { id: "d02", dx: 9000, dy: 9000, e_we: 79, e_sn: 61, parent_id: 1, parent_grid_ratio: 3, i_parent_start: 11, j_parent_start: 11 },
  { id: "d03", dx: 3000, dy: 3000, e_we: 64, e_sn: 46, parent_id: 2, parent_grid_ratio: 3, i_parent_start: 6, j_parent_start: 6 },
  { id: "d04", dx: 1000, dy: 1000, e_we: 55, e_sn: 40, parent_id: 3, parent_grid_ratio: 3, i_parent_start: 6, j_parent_start: 6 },
];
const fallbackPhysics = { mp_physics: 8, cu_physics: 0, ra_lw_physics: 4, ra_sw_physics: 4, bl_pbl_physics: 1, sf_sfclay_physics: 1, sf_surface_physics: 2, sf_urban_physics: 0, num_soil_layers: 4, num_land_cat: 21, radt: 5 };

function utcInput(date) { return date.toISOString().slice(0, 13) + ":00"; }
const now = new Date();
now.setUTCMinutes(0, 0, 0);
now.setUTCHours(Math.floor(now.getUTCHours() / 6) * 6);
const later = new Date(now.getTime() + 6 * 3600 * 1000);

const form = reactive({
  startTime: utcInput(now), endTime: utcInput(later), center: { lat: 32.048, lon: 118.825 },
  interval: 1, assimilation: "off", preset: "默认通用", forecastFocus: "general",
  spinupMode: "auto", spinupHours: 6,
  domains: fallbackDomains.slice(0, 2).map(item => ({ ...item })), physics: { ...fallbackPhysics },
});
const domainCount = ref(2);
const activeDomain = ref(0);
const expertOpen = ref(false);
const recommending = ref(false);
const recommendation = ref(null);
const intervals = computed(() => props.options?.forecast_intervals || [1, 3, 6, 12, 24]);
const focusOptions = computed(() => props.options?.forecast_focuses || [{ value: "general", label: "通用预报" }]);
const spinupHours = computed(() => props.options?.spinup_hours || [0, 3, 6, 12, 18, 24]);
const assimilationOptions = computed(() => props.options?.assimilation_schemes || [
  { value: "off", label: "关闭" }, { value: "fdda_weak", label: "弱网格松弛" },
  { value: "fdda_standard", label: "标准网格松弛" }, { value: "fdda_strong", label: "强网格松弛" },
]);
const physicsPresets = computed(() => props.options?.physics_presets || { "默认通用": fallbackPhysics });
const maxConcurrentTasks = computed(() => Number(props.options?.capabilities?.max_concurrent_tasks) || 3);
const recommendationFactorSummary = computed(() => {
  const value = recommendation.value?.factors;
  if (!value) return "";
  const terrain = value.complex_terrain ? "复杂地形" : "平缓地形";
  const coast = value.coastal ? "海陆过渡" : "单一下垫面";
  return `${value.season} · ${terrain} · ${coast} · 最细网格 ${formatResolution(value.finest_dx_m)}`;
});
const physicsFields = [
  { key: "mp_physics", label: "微物理" }, { key: "cu_physics", label: "积云对流" },
  { key: "ra_lw_physics", label: "长波辐射" }, { key: "ra_sw_physics", label: "短波辐射" },
  { key: "bl_pbl_physics", label: "边界层" }, { key: "sf_sfclay_physics", label: "近地层" },
  { key: "sf_surface_physics", label: "陆面过程" }, { key: "sf_urban_physics", label: "城市冠层" },
  { key: "num_soil_layers", label: "土壤层数" }, { key: "num_land_cat", label: "土地类型" },
  { key: "radt", label: "辐射间隔" },
];

watch(() => props.options, value => {
  if (!value) return;
  resetDomains();
  applyPreset();
}, { immediate: true });

function resetDomains() {
  const defaults = props.options?.default_domains || fallbackDomains;
  form.domains = defaults.slice(0, domainCount.value).map(item => ({ ...item }));
  activeDomain.value = Math.min(activeDomain.value, form.domains.length - 1);
}
function applyPreset() { form.physics = { ...(physicsPresets.value[form.preset] || fallbackPhysics) }; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function requestRecommendation() {
  recommending.value = true;
  recommendation.value = null;
  try {
    const job = await createWrfRecommendation({
      center: { ...form.center }, domains: form.domains.map(item => ({ ...item })),
      forecast_focus: form.forecastFocus, start_time: `${form.startTime}:00Z`,
    });
    let current = job;
    for (let attempt = 0; attempt < 120 && !["succeeded", "failed"].includes(current.status); attempt += 1) {
      await wait(5000); current = await getWrfRecommendation(job.id);
    }
    if (current.status !== "succeeded") throw new Error(current.error || "参数推荐超时，请稍后重试");
    recommendation.value = current.result;
    await ElMessageBox.confirm(
      `${current.result.reasons?.join("\n") || "推荐已生成"}\n\n该方案是规则化起点，是否应用到当前任务？`,
      "WRF 参数建议",
      { type: "info", confirmButtonText: "确认应用", cancelButtonText: "仅查看" },
    );
    applyRecommendation();
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message || String(error));
  } finally { recommending.value = false; }
}
function applyRecommendation() {
  if (!recommendation.value) return;
  const value = recommendation.value;
  form.physics = { ...value.physics };
  form.preset = value.physics?.preset || "规则推荐";
  form.spinupMode = value.spinup?.mode || "custom";
  form.spinupHours = Number(value.spinup?.hours || 0);
  form.assimilation = value.assimilation_scheme || "off";
  ElMessage.success("推荐参数已应用，提交前仍可继续调整");
}
function updateCenter(value) { form.center.lat = Number(value.lat.toFixed(3)); form.center.lon = Number(value.lon.toFixed(3)); }
function domainDxOptions(index) {
  if (index === 0) return [27000, 15000, 9000];
  const parent = Number(form.domains[index - 1]?.dx || 0);
  return [parent / 3, parent / 5].filter(value => Number.isInteger(value) && value > 0);
}
function setDomainDx(index, value) {
  const domain = form.domains[index];
  domain.dx = Number(value); domain.dy = Number(value);
  if (index > 0) domain.parent_grid_ratio = Math.round(form.domains[index - 1].dx / domain.dx);
  for (let child = index + 1; child < form.domains.length; child += 1) {
    const parent = form.domains[child - 1];
    const next = form.domains[child];
    next.dx = parent.dx / 3; next.dy = next.dx; next.parent_grid_ratio = 3;
  }
}
function formatResolution(value) { return Number(value) >= 1000 ? `${Number(value / 1000)} km` : `${value} m`; }
function submit() {
  if (!form.startTime || !form.endTime || new Date(form.endTime) <= new Date(form.startTime)) {
    ElMessage.warning("结束时间必须晚于开始时间"); return;
  }
  emit("submit", {
    start_time: `${form.startTime}:00Z`, end_time: `${form.endTime}:00Z`, center: { ...form.center },
    forecast_interval_hours: form.interval,
    domains: form.domains.map((item, index) => ({ ...item, dy: item.dx, parent_id: index ? index : 0 })),
    physics: { preset: form.preset, ...form.physics }, assimilation_scheme: form.assimilation,
    forecast_focus: form.forecastFocus,
    spinup: { mode: form.spinupMode, hours: form.spinupMode === "off" ? 0 : form.spinupHours },
  });
}
</script>

<style scoped>
.task-config { min-height: 100%; display: flex; flex-direction: column; padding: 18px; color: var(--text); }
.panel-head, .sub-head, .map-title, .config-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.panel-head { padding-bottom: 14px; border-bottom: 1px solid var(--border); }.panel-head span { color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: 1.4px; }.panel-head h2 { margin: 4px 0 0; font-size: 20px; }.head-actions { display: flex; align-items: center; }
.config-grid { display: grid; grid-template-columns: minmax(380px, .86fr) minmax(460px, 1.14fr); gap: 16px; padding: 16px 0; }.form-column, .map-column, .physics-panel { border: 1px solid var(--border); border-radius: 13px; background: var(--field); }.form-column { min-width: 0; padding: 14px; }.basic-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }.basic-grid > :deep(.el-form-item) { min-width: 0; }.basic-grid :deep(.el-input), .basic-grid :deep(.el-input-number), .basic-grid :deep(.el-select) { width: 100%; min-width: 0; }.basic-grid :deep(.el-input__wrapper) { min-width: 0; padding-right: 9px; padding-left: 9px; }.basic-grid :deep(input[type="datetime-local"]) { width: 100%; min-width: 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.sub-head { margin: 5px 0 10px; padding-top: 12px; border-top: 1px solid var(--border); }.sub-head h3 { margin: 0; font-size: 13px; }.sub-head span { display: block; margin-top: 3px; color: var(--muted); font-size: 9px; }.sub-head :deep(.el-select) { width: 88px; }
.domain-cards { display: grid; grid-template-columns: 1fr; gap: 8px; }.domain-cards article { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--glass); cursor: pointer; }.domain-cards article.outer { grid-template-columns: repeat(3, minmax(0, 1fr)); }.domain-cards article.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft); }.domain-cards b { grid-column: 1/-1; color: var(--accent); font-size: 12px; }.domain-cards label { display: grid; gap: 3px; min-width: 0; color: var(--muted); font-size: 9px; }.domain-cards :deep(.el-input-number), .domain-cards :deep(.el-select) { width: 100%; }
.map-column { min-width: 0; padding: 12px; }.map-title { height: 38px; }.map-title div { display: grid; gap: 2px; }.map-title b { font-size: 12px; }.map-title span { color: var(--muted); font-size: 9px; }.map-title > span { color: var(--accent); font: 700 11px monospace; }.domain-map { position: relative; height: 430px; overflow: hidden; border-radius: 10px; background: #07101e; }
.physics-panel { padding: 12px 14px; }.physics-head { margin: 0; padding: 0; border: 0; }.physics-actions { display: flex; align-items: center; }.physics-actions :deep(.el-select) { width: 150px; }.physics-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding-top: 12px; }.physics-grid label { display: grid; gap: 4px; color: var(--muted); font-size: 9px; }.physics-grid :deep(.el-input-number) { width: 100%; }
.config-footer { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }.config-footer div { display: grid; gap: 3px; }.config-footer b { font-size: 12px; }.config-footer span { color: var(--muted); font-size: 10px; }.config-footer .el-button { min-width: 220px; }
.spinup-control { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }.recommendation-note { display: grid; grid-template-columns: minmax(160px, .7fr) minmax(320px, 2fr) auto; align-items: center; gap: 12px; margin-top: 10px; padding: 10px; border: 1px solid var(--accent); border-radius: 9px; background: var(--accent-soft); }.recommendation-summary { display: grid; gap: 4px; }.recommendation-note b { color: var(--accent); font-size: 10px; }.recommendation-note span { color: var(--text); font-size: 9px; line-height: 1.45; }.recommendation-note ul { max-height: 84px; margin: 0; padding-left: 16px; overflow-y: auto; color: var(--muted); font-size: 9px; line-height: 1.5; }
@media (max-width: 1500px) { .config-grid { grid-template-columns: 1fr; }.physics-grid { grid-template-columns: repeat(3, 1fr); }.recommendation-note { grid-template-columns: 1fr auto; }.recommendation-note ul { grid-column: 1/-1; grid-row: 2; } }
@media (max-width: 720px) { .basic-grid { grid-template-columns: 1fr; }.domain-cards article, .domain-cards article.outer { grid-template-columns: repeat(2, minmax(0, 1fr)); }.physics-grid { grid-template-columns: repeat(2, 1fr); }.config-footer { align-items: stretch; flex-direction: column; }.config-footer .el-button { width: 100%; } }
</style>
