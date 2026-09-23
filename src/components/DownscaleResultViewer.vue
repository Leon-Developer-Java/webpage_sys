<template>
  <section class="downscale-result">
    <header>
      <div><span>HIGH-RESOLUTION SCIENTIFIC PRODUCT</span><h2>{{ task?.id }}</h2><small>{{ publicationLabel }}</small></div>
      <el-button @click="emit('back')">返回任务列表</el-button>
    </header>
    <el-alert :type="isLes ? 'warning' : 'info'" :closable="false" show-icon>
      <template #title>{{ semantics }}</template>
    </el-alert>
    <div class="result-grid">
      <section class="selector-card">
        <h3>{{ isLes ? 'LES 统计时段' : 'RANS 代表有效时次' }}</h3>
        <button v-for="(item, index) in selections" :key="selectionKey(item, index)" :class="{ active: index === selectedIndex }" @click="selectedIndex = index">
          <b>{{ selectionLabel(item) }}</b><small>{{ selectionDetail(item) }}</small>
        </button>
        <dl><div><dt>计算方案</dt><dd>{{ task?.runtime?.parameterization?.label || task?.request?.parameterization_profile_id || '标准业务 RANS' }}<br />{{ task?.runtime?.parameterization?.version || 'v1' }} · {{ task?.runtime?.parameterization?.configuration_status === 'customized_research' ? '自定义研究配置' : '方案默认参数' }}</dd></div><div><dt>地表模型</dt><dd>{{ surfaceModel.mode === 'auto_flat' ? '理想化平坦地表' : '审核真实地形' }}<br />{{ surfaceDetail }}</dd></div><div><dt>发布 AOI</dt><dd>{{ task?.request?.aoi?.width_m }} m × {{ task?.request?.aoi?.height_m }} m</dd></div><div><dt>高度</dt><dd>{{ task?.request?.cfd?.publication_heights_agl_m?.join(' / ') }} m AGL</dd></div><div><dt>认证 / 质量</dt><dd>{{ task?.certification?.status }}{{ task?.certification?.profile_id ? ` · ${task.certification.profile_id}` : '' }}<br />{{ task?.quality?.status || 'pending' }} · {{ publicationLabel }}</dd></div></dl>
      </section>
      <section class="scene-card">
        <div class="surface-head"><div><span>2D SAMPLING LAYER</span><h3>{{ activeLabel }} · {{ selectedHeight }} m AGL</h3></div><el-select v-model="selectedHeight" size="small" class="height-select"><el-option v-for="height in availableHeights" :key="height" :label="`${height} m AGL`" :value="height" /></el-select></div>
        <div class="layer-tabs"><button v-for="variable in availableVariables" :key="variable" :class="{ active: selectedVariable === variable }" @click="selectedVariable = variable">{{ layerLabel(variable) }}</button></div>
        <div class="surface-preview"><img v-if="previewUrl" :src="previewUrl" :alt="`${selectedHeight} m AGL ${layerLabel(selectedVariable)}`" /><template v-else><b>等待轻量二维预览</b><p>受管运行器将生成经质量门校验的 WebP/PNG 图层；GeoTIFF 仍作为标准科学数据包下载。</p></template></div>
        <div class="scene-head"><div><span>3D SCENE</span><h3>地形、剖面与分层风流线</h3></div><el-tag>{{ task?.request?.cfd?.thermal_mode === 'thermal' ? '热力' : '中性' }}</el-tag></div>
        <div class="scene-placeholder"><i>3D</i><b>{{ activeLabel }}</b><p>浏览器仅加载轻量场景清单、地形、剖面、掩膜和降采样 U/V/W 向量；不传输完整 1 m CFD 体数据。</p><p v-if="sceneError" class="warning">{{ sceneError }}</p><a v-if="activePreview.scene_manifest || result?.scene_3d_url" :href="assetHref(activePreview.scene_manifest || result.scene_3d_url)" target="_blank" rel="noopener">打开场景清单</a><span v-else>受管运行器完成后将在此提供场景清单。</span></div>
        <div class="downloads"><h4>标准科学数据包</h4><template v-if="standardProducts"><template v-for="(value, key) in standardProducts" :key="key"><template v-if="Array.isArray(value)"><a v-for="(asset, index) in value" :key="`${key}-${index}`" :href="assetHref(asset)" target="_blank" rel="noopener">{{ labelForProduct(key, index) }}</a></template><a v-else :href="assetHref(value)" target="_blank" rel="noopener">{{ labelForProduct(key) }}</a></template></template><span v-else>CF-NetCDF、GeoTIFF、VTK 和质量报告将在产品通过质量门后可用。</span></div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { getDownscaleTaskResult } from "../api.js";

const props = defineProps({ task: { type: Object, required: true } });
const emit = defineEmits(["back"]);
const result = ref(null);
const sceneError = ref("");
const selectedIndex = ref(0);
const selectedHeight = ref(10);
const selectedVariable = ref("wind_speed");
const sampling = computed(() => props.task?.runtime?.microscale_sampling || {});
const isLes = computed(() => sampling.value.solver_family === "les");
const selections = computed(() => isLes.value ? sampling.value.episodes || [] : sampling.value.selected_valid_times || []);
const activeSelection = computed(() => selections.value[selectedIndex.value] || null);
const activeLabel = computed(() => selectionLabel(activeSelection.value));
const standardProducts = computed(() => result.value?.standard_products || null);
const surfaceModel = computed(() => result.value?.surface_model || props.task?.runtime?.surface || {});
const surfaceDetail = computed(() => {
  const snapshots = Object.values(surfaceModel.value.snapshots || {});
  if (snapshots.length) {
    const roughness = snapshots.map(item => Number(item.roughness_length_m)).filter(Number.isFinite);
    if (roughness.length) return `WRF 推导 z0 ${Math.min(...roughness).toFixed(3)}–${Math.max(...roughness).toFixed(3)} m`;
  }
  return surfaceModel.value.roughness?.method || surfaceModel.value.vertical_reference || "—";
});
const activePreview = computed(() => {
  const item = activeSelection.value;
  const validTime = typeof item === "string" ? item : item?.forcing_valid_time;
  return result.value?.browser_previews?.[validTime] || result.value?.browser_preview || {};
});
const previewLayers = computed(() => activePreview.value.layers || {});
const availableHeights = computed(() => {
  const declared = props.task?.request?.cfd?.publication_heights_agl_m || [10, 40, 80, 120, 200];
  const previewed = Object.keys(previewLayers.value).map(Number).filter(Number.isFinite);
  return (previewed.length ? previewed : declared).sort((left, right) => left - right);
});
const availableVariables = computed(() => {
  const values = previewLayers.value[String(selectedHeight.value)] || {};
  const keys = Object.keys(values);
  return keys.length ? keys : ["wind_speed", "wind_direction", "temperature", "p_rgh"];
});
const previewUrl = computed(() => assetHref(previewLayers.value[String(selectedHeight.value)]?.[selectedVariable.value]));
const publicationLabel = computed(() => props.task?.publication?.status === "published" ? "已正式发布" : "内部预览：尚未冻结为认证配置");
const forcingDurationHours = computed(() => {
  const runtimeDuration = Number(props.task?.runtime?.mesoscale_window?.duration_hours);
  if (Number.isInteger(runtimeDuration) && runtimeDuration > 0) return runtimeDuration;
  const start = Date.parse(props.task?.request?.start_time || "");
  const end = Date.parse(props.task?.request?.end_time || "");
  const derived = (end - start) / 3600000;
  return Number.isInteger(derived) && derived > 0 ? derived : 48;
});
const semantics = computed(() => isLes.value ? "LES 是有限物理时段的统计产品；禁止将时段之间插值或播放为连续 1 m 预报。" : `RANS 各代表时次是独立稳态解；禁止把它们串接成连续 ${forcingDurationHours.value} h 的 1 m 预报。`);
function selectionKey(item, index) { return typeof item === "string" ? item : `${item?.forcing_valid_time || item?.forcing_hour || 'episode'}-${index}`; }
function selectionLabel(item) { if (!item) return "等待产品"; if (typeof item === "string") return item.replace("T", " ").replace("Z", " UTC"); return `forcing +${String(item.forcing_hour ?? "—").padStart(2, "0")} h`; }
function selectionDetail(item) { if (!item || typeof item === "string") return isLes.value ? "统计时段" : "精确匹配 WRF forcing"; return `${item.inflow_method === "precursor_abl" ? "前驱 ABL" : "合成湍流"} · 统计 ${item.statistics_window_seconds}s`; }
function layerLabel(value) { return ({ wind_speed: "风速", wind_direction: "风向", temperature: "温度", p_rgh: "p_rgh (Pa)", u: "U 风速", v: "V 风速", w: "W 风速" })[value] || value; }
function labelForProduct(value, index = null) { const labels = { cf_netcdf: "下载 CF-NetCDF", geotiff_layers: "下载 GeoTIFF 图层", vtk_scene: "下载 VTK 场景", quality_report: "下载质量报告" }; const label = labels[value] || value; return index == null ? label : `${label} ${index + 1}`; }
function assetHref(value) { const path = Array.isArray(value) ? value[0] : value; const base = String(result.value?.downscale_product_url || "").replace(/downscale\.product\.json$/, ""); return path && !String(path).startsWith("http") ? `${base}${path}` : path; }
async function load() { selectedIndex.value = 0; sceneError.value = ""; try { result.value = await getDownscaleTaskResult(props.task.id); selectedHeight.value = availableHeights.value[0] || 10; selectedVariable.value = availableVariables.value[0] || "wind_speed"; } catch (error) { sceneError.value = error.message || "产品清单尚不可用"; } }
watch(availableVariables, values => { if (!values.includes(selectedVariable.value)) selectedVariable.value = values[0] || "wind_speed"; });
watch(() => props.task?.id, load);
onMounted(load);
</script>

<style scoped>
.downscale-result{min-height:100%;padding:20px;color:var(--text)}header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--border)}header span,.scene-head span,.surface-head span{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:1.3px}h2{margin:4px 0;font:17px "SFMono-Regular",Consolas,monospace}header small{color:var(--muted)}.downscale-result :deep(.el-alert){margin:14px 0}.result-grid{display:grid;grid-template-columns:minmax(240px,.55fr) minmax(420px,1.45fr);gap:14px}.selector-card,.scene-card{padding:14px;border:1px solid var(--border);border-radius:13px;background:var(--field)}h3{margin:0 0 11px;font-size:14px}.selector-card>button{display:grid;width:100%;gap:3px;margin:7px 0;padding:9px;text-align:left;border:1px solid var(--border);border-radius:8px;background:var(--glass);color:var(--text);cursor:pointer}.selector-card>button.active{border-color:var(--accent);background:var(--accent-soft)}.selector-card small{color:var(--muted);font-size:10px}dl{display:grid;gap:7px;margin:14px 0 0}dl div{padding:8px;border-radius:7px;background:var(--glass)}dt{color:var(--muted);font-size:10px}dd{margin:3px 0 0;font-size:11px}.surface-head,.scene-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.height-select{width:126px}.layer-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.layer-tabs button{padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--glass);color:var(--muted);font:inherit;font-size:11px;cursor:pointer}.layer-tabs button.active{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.surface-preview{display:grid;min-height:190px;place-items:center;overflow:hidden;border:1px dashed var(--border);border-radius:10px;background:linear-gradient(135deg,var(--accent-soft),transparent);text-align:center}.surface-preview img{display:block;width:100%;max-height:320px;object-fit:contain}.surface-preview b{font-size:12px}.surface-preview p{max-width:360px;color:var(--muted);font-size:11px;line-height:1.55}.scene-head{margin-top:16px}.scene-placeholder{display:grid;place-items:center;min-height:265px;padding:18px;border:1px dashed var(--border);border-radius:10px;background:linear-gradient(135deg,var(--accent-soft),transparent);text-align:center}.scene-placeholder i{display:grid;place-items:center;width:52px;height:52px;border-radius:12px;background:#0f3f73;color:#93c5fd;font-weight:900;font-style:normal}.scene-placeholder p{max-width:500px;color:var(--muted);font-size:11px;line-height:1.55}.scene-placeholder a,.downloads a{color:var(--accent)}.warning{color:#f59e0b!important}.downloads{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}.downloads h4{width:100%;margin:0;font-size:12px}.downloads span{color:var(--muted);font-size:11px}@media(max-width:900px){.result-grid{grid-template-columns:1fr}}
</style>
