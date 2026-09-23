<template>
  <main class="evidence-page">
    <RouterLink to="/agent">返回 Agent</RouterLink>
    <h1>WRF 文献证据</h1>
    <p>普通用户查看自己的草稿，管理员查看审核队列。审核通过不代表可运行或最优，不会创建 WRF 任务。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <section>
      <h2>证据记录</h2>
      <button :disabled="busy" @click="loadPage(offset)">刷新</button>
      <p v-if="!items.length">暂无可见记录</p>
      <ul><li v-for="item in items" :key="item.id">
        <button :disabled="busy" @click="open(item.id)">{{ item.doi }} · {{ item.region }} / {{ item.domain_id }} · {{ labels[item.status] }}</button>
      </li></ul>
      <button :disabled="busy || offset === 0" @click="loadPage(Math.max(0, offset - 20))">上一页</button>
      <button :disabled="busy || !hasMore" @click="loadPage(offset + 20)">下一页</button>
    </section>
    <section v-if="selected">
      <h2>证据详情 · {{ labels[selected.status] }}</h2>
      <p>记录 {{ selected.id }}；内容摘要 {{ selected.digest }}</p>
      <p v-for="warning in selected.warnings" :key="warning">{{ warning }}</p>
      <p>缺失参数：{{ selected.missing_parameters.join('、') || '无' }}</p>
      <pre>{{ JSON.stringify(selected.draft, null, 2) }}</pre>
      <p v-if="selected.review">审核意见：{{ selected.review.note }}</p>
      <form v-if="selected.can_review" @submit.prevent="review">
        <h3>审核当前不可变版本</h3>
        <label>结论<select v-model="decision"><option value="reject">驳回</option><option value="approve">通过原文证据审核</option></select></label>
        <label><input type="checkbox" v-model="sourceChecked">我已核对原文及实验范围</label>
        <label><input type="checkbox" v-model="mappingChecked">我已核对方案名称与编号映射</label>
        <label>审核意见<textarea v-model="reviewNote" required maxlength="2000" /></label>
        <button :disabled="busy || (decision === 'approve' && (!sourceChecked || !mappingChecked || selected.missing_parameters.length > 0))">提交审核（不可覆盖）</button>
      </form>
    </section>
    <section>
      <h2>新建证据草稿</h2>
      <p>仅填写有合法来源的摘录。未知物理参数保持未勾选；不要猜测。原文哈希由提交者提供，系统不上传或读取本地文件。</p>
      <form @submit.prevent="create">
        <div class="fields"><label v-for="field in fields" :key="field.key">{{ field.label }}
          <input v-model="form[field.key]" required :maxlength="field.max" />
        </label></div>
        <label>合法访问依据<select v-model="form.access_basis"><option value="open_access">开放获取</option><option value="user_authorized_excerpt">用户有权提供的摘录</option></select></label>
        <label>目标变量<select v-model="form.target"><option v-for="target in targets" :key="target" :value="target">{{ target }}</option></select></label>
        <label>网格距（km）<input type="number" v-model.number="form.dx_km" required min="0.000001" step="any" /></label>
        <label>范围依据页码/表号<input v-model="form.context_evidence.locator" required maxlength="200" /></label>
        <label>范围依据原文摘录<textarea v-model="form.context_evidence.excerpt" required maxlength="3000" /></label>
        <fieldset v-for="(param, key) in parameters" :key="key">
          <legend><label><input type="checkbox" v-model="param.enabled">有证据的 {{ key }}</label></legend>
          <template v-if="param.enabled">
            <label>方案编号<input type="number" v-model.number="param.option" required min="0" max="999" step="1" /></label>
            <label>方案名称<input v-model="param.scheme_name" required maxlength="200" /></label>
            <label>页码/表号<input v-model="param.locator" required maxlength="200" /></label>
            <label>原文摘录<textarea v-model="param.excerpt" required maxlength="3000" /></label>
          </template>
        </fieldset>
        <label>适用限制<textarea v-model="form.limitations" required maxlength="2000" /></label>
        <button :disabled="busy">保存新草稿（不启动计算）</button>
      </form>
    </section>
  </main>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { listWrfEvidence, getWrfEvidence, createWrfEvidence, reviewWrfEvidence } from '../api';
const items = ref([]), selected = ref(null), busy = ref(false), error = ref(''), notice = ref('');
const offset = ref(0), hasMore = ref(false), decision = ref('reject'), reviewNote = ref('');
const sourceChecked = ref(false), mappingChecked = ref(false);
const labels = { pending_review: '待审核', reviewed_evidence: '原文证据已审核，未运行校验', rejected: '已驳回' };
const fields = [
  ['doi', '论文 DOI', 210], ['source_sha256', '原文 SHA-256（64 位小写十六进制）', 64],
  ['source_version', '原文版本', 200], ['wrf_version', '论文 WRF 版本', 80], ['region', '区域', 200],
  ['season', '季节或研究时段', 100], ['member_id', '实验成员', 100], ['domain_id', '域', 100],
].map(([key, label, max]) => ({ key, label, max }));
const targets = ['precipitation', 'wind', 'thermodynamics_pbl', 'solar_radiation', 'tropical_cyclone', 'snow_ice', 'urban_climate', 'land_surface', 'hydrology'];
const form = reactive({ ...Object.fromEntries(fields.map(f => [f.key, ''])), access_basis: 'user_authorized_excerpt', target: 'precipitation', dx_km: '', context_evidence: { locator: '', excerpt: '' }, limitations: '' });
const parameters = reactive(Object.fromEntries(['mp_physics', 'cu_physics', 'bl_pbl_physics', 'sf_sfclay_physics', 'sf_surface_physics', 'ra_sw_physics', 'ra_lw_physics'].map(key => [key, { enabled: false, option: '', scheme_name: '', locator: '', excerpt: '' }])));
async function action(fn) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await fn(); } catch (cause) { error.value = cause.message || '操作失败'; }
  finally { busy.value = false; }
}
async function page(next) {
  const data = await listWrfEvidence(next);
  items.value = data.items; hasMore.value = data.has_more; offset.value = next;
}
function loadPage(next) { return action(() => page(next)); }
function resetReview() { decision.value = 'reject'; reviewNote.value = ''; sourceChecked.value = false; mappingChecked.value = false; }
function open(id) { return action(async () => { selected.value = null; resetReview(); selected.value = await getWrfEvidence(id); }); }
function create() { return action(async () => {
  const params = Object.fromEntries(Object.entries(parameters).filter(([, p]) => p.enabled).map(([key, { enabled, ...p }]) => [key, p]));
  selected.value = await createWrfEvidence({ ...form, parameters: params });
  resetReview();
  notice.value = `已保存草稿 ${selected.value.id}，不会启动任务。`;
  // Keep entered evidence in memory only, never persist excerpts in localStorage.
  await page(0);
}); }
function review() { return action(async () => {
  const current = selected.value;
  selected.value = await reviewWrfEvidence(current.id, { decision: decision.value, expected_digest: current.digest, note: reviewNote.value, source_checked: sourceChecked.value, mapping_checked: mappingChecked.value });
  resetReview(); notice.value = '审核结论已保存；尚未完成运行兼容性校验。'; await page(offset.value);
}); }
onMounted(() => loadPage(0));
</script>

<style scoped>
.evidence-page { max-width: 1000px; margin: auto; padding: 24px; overflow-wrap: anywhere; }
section { border: 1px solid #64748b66; border-radius: 10px; padding: 18px; margin: 18px 0; }
label { display: block; margin: 10px 0; } input:not([type=checkbox]), textarea, select { display: block; width: 100%; box-sizing: border-box; padding: 8px; }
textarea { min-height: 80px; } button { padding: 8px 12px; margin: 4px; cursor: pointer; } button:disabled { cursor: default; opacity: .5; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
pre { white-space: pre-wrap; max-height: 480px; overflow: auto; } [role=alert] { color: #dc2626; }
</style>
