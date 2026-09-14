<template>
  <section ref="rootEl" class="workflow-result" aria-label="通用工作流运行结果">
    <div class="workflow-heading">
      <b>{{ view.title }}</b>
      <span :class="{ failed: ['failed', 'rejected', 'unsupported', 'interrupted'].includes(run.status) }">{{ workflowStatus(run.status) }}</span>
    </div>
    <div class="agent-answer">
      <p class="agent-answer-intro">{{ friendlyAnswer.intro }}</p>
      <ul v-if="friendlyAnswer.points.length" class="agent-answer-points">
        <li v-for="(point, index) in friendlyAnswer.points" :key="index" :class="`tone-${point.tone}`">
          <span class="agent-answer-icon">{{ point.icon }}</span>
          <span><b v-if="point.label">{{ point.label }}：</b>{{ point.text }}</span>
        </li>
      </ul>
    </div>
    <section v-if="view.understanding.goal_summary || view.normalizedParameters.length" class="workflow-understanding">
      <b>理解到的目标</b>
      <p v-if="view.understanding.goal_summary">{{ view.understanding.goal_summary }}</p>
      <div v-for="item in view.normalizedParameters" :key="`${item.action_id}-${item.parameter}`" class="workflow-normalized">
        <span>{{ item.parameter }}</span>
        <code>{{ displayValue(item.raw_value) }}</code><span>→</span><code>{{ displayValue(item.normalized_value) }}</code>
        <small>{{ item.note }}</small>
      </div>
    </section>
    <section v-if="view.sections.length" class="workflow-sections">
      <article v-for="(section, index) in view.sections" :key="`${section.heading}-${index}`" class="workflow-section">
        <div class="workflow-section-head"><b>{{ section.heading }}</b><span v-if="section.status">{{ workflowStatus(section.status) }}</span></div>
        <p v-for="(paragraph, pIndex) in (section.paragraphs || [])" :key="pIndex">{{ paragraph }}</p>
        <ul v-if="section.bullets?.length"><li v-for="(item, bIndex) in section.bullets" :key="bIndex">{{ item }}</li></ul>
      </article>
    </section>
    <div v-if="view.filters.length" class="workflow-filters">
      <span v-for="filter in view.filters" :key="filter.label">{{ filter.label }}：{{ filter.value }}</span>
    </div>
    <dl v-if="view.metrics.length" class="workflow-metrics">
      <div v-for="metric in view.metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}<small v-if="metric.value !== '未提供'">{{ metric.unit }}</small></dd></div>
    </dl>
    <div v-if="view.notes.length" class="workflow-notes">
      <b>结果说明</b><p v-for="(note, index) in view.notes" :key="index">{{ note }}</p>
    </div>
    <ul v-if="view.warnings.length" class="workflow-warnings">
      <li v-for="(warning, index) in view.warnings" :key="index">{{ warning }}</li>
    </ul>
    <section v-if="(run.actions || []).length > 1" class="workflow-actions">
      <h4>执行计划</h4>
      <ol><li v-for="action in run.actions" :key="action.action_id">
        <b>{{ action.action_id }} · {{ actionTitle(action) }} <em v-if="action.origin === 'agent'">Agent 补充的只读步骤</em></b><span>{{ workflowStatus(action.status) }}</span>
        <small>{{ action.step_ids.join(' → ') }}</small>
      </li></ol>
    </section>
    <section v-for="table in view.tables" :key="table.id" class="workflow-table-section">
      <h4>{{ table.title }}</h4>
      <p v-if="table.note" class="workflow-note">{{ table.note }}</p>
      <div v-if="table.rows.length" class="workflow-table-scroll" tabindex="0" :aria-label="table.title">
        <table>
          <thead><tr><th v-for="column in table.columns" :key="column.key" scope="col">{{ column.label }}</th></tr></thead>
          <tbody><tr v-for="(row, index) in table.rows.slice(0, rowLimits[table.id] || 10)" :key="index">
            <td v-for="column in table.columns" :key="column.key">
              <button v-if="row[column.key]?.fileId" class="file-reference" type="button" @click="focusFile(row[column.key].fileId)">{{ row[column.key].label }}</button>
              <span v-else>{{ row[column.key] ?? '未提供' }}</span>
            </td>
          </tr></tbody>
        </table>
      </div>
      <p v-else class="workflow-note">本次没有返回这类明细。</p>
      <div v-if="table.rows.length" class="workflow-table-footer">
        <span>已显示 {{ Math.min(rowLimits[table.id] || 10, table.rows.length) }} / {{ table.rows.length }} 条已返回记录</span>
        <button v-if="(rowLimits[table.id] || 10) < table.rows.length" type="button" @click="rowLimits[table.id] = (rowLimits[table.id] || 10) + 10">再显示 10 条</button>
      </div>
    </section>
    <section v-if="view.files.length" class="workflow-files">
      <h4>文件与数据集引用 · {{ view.files.length }} 项</h4>
      <p class="workflow-note">编号只在这条回复内有效。文件标识用于查询，路径用于定位文件。“填入查询”仅准备指令，需要你再点击发送。</p>
      <article v-for="file in view.files.slice(0, filesExpanded ? view.files.length : 5)" :key="file.id" :data-file-id="file.id" class="workflow-file">
        <b>[{{ file.kind }} {{ file.id }}] {{ file.name }}</b>
        <span v-if="file.dataType">{{ file.dataType }}<template v-if="file.status !== '未提供'"> · {{ file.status }}</template></span>
        <div v-if="file.uuid" class="workflow-file-id">文件标识：<code>{{ file.uuid }}</code></div>
        <div class="workflow-file-actions">
          <button v-if="file.uuid" type="button" @click="copy(file.uuid)">复制标识</button>
          <button v-if="fileQuery(file)" type="button" :disabled="busy || !queryEnabled" :title="queryEnabled ? '填入指令，不自动执行' : '请先切换到通用工作流模式'" @click="$emit('query', fileQuery(file))">填入查询</button>
          <button v-if="canEmbedVisualization(file) && activeVisualizationId !== file.id" type="button" @click="toggleVisualization(file)">在对话中查看</button>
          <a v-if="link(file.previewUrl)" :href="link(file.previewUrl)" target="_blank" rel="noopener noreferrer">查看默认图像</a>
        </div>
        <details><summary>查看路径与登记信息</summary>
          <dl class="workflow-ids">
            <template v-if="file.datasetId"><dt>数据集标识</dt><dd>{{ file.datasetId }}</dd></template>
            <dt>源路径</dt><dd>{{ file.path || '接口未返回源路径；不会根据文件名推测' }} <button v-if="file.path" type="button" @click="copy(file.path)">复制路径</button></dd>
            <dt>元数据</dt><dd>{{ file.meta || '未提供' }} <button v-if="file.meta" type="button" @click="copy(file.meta)">复制路径</button></dd>
            <template v-if="file.created"><dt>入库时间</dt><dd>{{ file.created }}</dd></template>
            <template v-if="file.finished"><dt>解析完成</dt><dd>{{ file.finished }}</dd></template>
            <template v-if="file.variables"><dt>变量清单</dt><dd>{{ file.variables }}</dd></template>
          </dl>
        </details>
      </article>
      <button v-if="view.files.length > 5" type="button" @click="filesExpanded = !filesExpanded">{{ filesExpanded ? '收起引用目录' : `展开全部 ${view.files.length} 项引用` }}</button>
      <AgentDataVisualization
        v-if="activeVisualizationFile"
        :file-uuid="activeVisualizationFile.uuid"
        :data-type="activeVisualizationFile.dataType"
        :name="activeVisualizationFile.name"
        @close="activeVisualizationId = null"
      />
      <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
    </section>
    <figure v-for="url in images" :key="url" class="workflow-image">
      <a :href="link(url)" target="_blank" rel="noopener noreferrer"><img :src="link(url)" :alt="view.title" loading="lazy" /></a>
      <figcaption>{{ view.imageCaption }}</figcaption>
    </figure>
    <div v-if="run.status === 'waiting_confirmation'" class="workflow-confirm">
      <b>{{ isAgentScope ? (isWinterArchive ? '冬季覆冰档案预演完成，等待人工确认' : '业务操作预演完成，等待人工确认') : (isWinterArchive ? '冬季覆冰档案预演完成，尚未执行' : '解析预演完成，尚未执行') }}</b>
      <span>目标：{{ isAgentScope ? '已冻结的业务工具参数' : (isWinterArchive ? '吉林 2025-10-01 至 2026-02-28 连续覆冰档案' : (run.result?.approved_inputs?.file_path || run.result?.plan?.target)) }}</span>
      <span>{{ isAgentScope ? '确认后服务端才会执行下载或模型任务，仅可确认一次。' : `风险：${riskLabel}；票据到期：${run.ticket?.expires_at}` }}</span>
      <ol><li v-for="(step, index) in (run.result?.plan?.steps || [])" :key="index">{{ step }}</li></ol>
      <p>{{ isAgentScope ? '确认只使用预演时冻结的参数；重复确认、跨用户/会话确认或改动参数都会被拒绝。' : (isWinterArchive ? '确认会复用已有 ERA5 缓存（缓存缺失时才下载）并提交整冬连续覆冰回算；网络响应不确定时请刷新任务状态，不会自动重试。' : '确认会写入或刷新解析输出，请只用可丢弃测试文件。当前旧解析服务可能缺少兼容接口，失败不会自动重试。') }}</p>
      <div class="workflow-confirm-actions">
        <button type="button" :disabled="busy || locked || !canConfirm" @click="$emit('confirm')">{{ busy ? '处理中…' : (isAgentScope ? '确认执行' : (isWinterArchive ? '确认回放冬季覆冰档案' : '确认执行解析')) }}</button>
        <button v-if="isAgentScope" type="button" :disabled="busy || locked || !canConfirm" @click="$emit('reject')">拒绝执行</button>
      </div>
      <span v-if="locked">上次确认的响应未能核实。请先刷新状态，勿重复提交。</span>
      <span v-else-if="!canConfirm">票据已失效或不可用，请刷新状态或重新预演。</span>
    </div>
    <p v-if="error" role="alert" class="failed">{{ error }}</p>
    <p v-if="view.sources.length" class="workflow-note">数据来源：{{ view.sources.join('；') }}</p>
    <div v-if="view.suggestedPrompts.length" class="workflow-suggestions">
      <b>{{ run.response?.kind === 'clarification' ? '你可以这样补充' : '你还可以继续问' }}</b>
      <button v-for="prompt in view.suggestedPrompts" :key="prompt" type="button" :disabled="busy || !queryEnabled" @click="$emit('query', prompt)">{{ prompt }}</button>
    </div>
    <button v-if="!isAgentScope || run.weather_result" type="button" :disabled="busy" @click="$emit('refresh')">刷新运行状态</button>
    <details>
      <summary>技术详情：运行记录、步骤与原始返回</summary>
      <dl class="workflow-ids">
        <dt>来源</dt><dd>{{ run.origin === 'weather_agentscope.agents.icing' ? 'AgentScope 覆冰 Agent' : run.origin }}</dd>
        <template v-if="run.recognition?.mode"><dt>意图识别</dt><dd>{{ run.recognition.mode === 'agentscope' ? 'AgentScope ReAct' : run.recognition.mode === 'llm' ? `LLM · ${run.recognition.model}` : run.recognition.mode === 'session_replay' ? '本会话结果回看（未调用模型）' : '离线规则' }}</dd></template>
        <dt>模板</dt><dd>{{ run.template_id || '未匹配模板' }}</dd>
        <template v-if="view.referenceRunId"><dt>引用运行</dt><dd>{{ view.referenceRunId }}</dd></template>
      </dl>
      <ol class="workflow-steps"><li v-for="step in (run.plan?.steps || [])" :key="step.step_id">{{ step.step_id }} · {{ step.capability_id }}.{{ step.operation_id }} · {{ workflowStatus(step.status) }}<p v-if="step.error" class="failed">{{ step.error }}</p></li></ol>
      <pre>{{ JSON.stringify(run, null, 2) }}</pre>
    </details>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { canConfirmWorkflow, workflowStatus, workflowImageUrls, WORKFLOW_BASE } from "../workflow-api.js";
import { presentWorkflow, formatNumber, fileQuery, resourceUrl } from "../workflow-presentation.js";
import { canEmbedVisualization } from "../agent-visualization.js";
import AgentDataVisualization from "./AgentDataVisualization.vue";

const props = defineProps({
  run: { type: Object, required: true }, sessionId: { type: String, required: true },
  busy: Boolean, locked: Boolean, error: { type: String, default: "" },
  imageUrl: { type: Function, default: url => url },
  queryEnabled: { type: Boolean, default: true },
});
defineEmits(["confirm", "reject", "refresh", "query"]);
const view = computed(() => {
  const response = props.run.response;
  if (!response) return { ...presentWorkflow(props.run), sections: [], suggestedPrompts: [],
                          understanding: {}, normalizedParameters: [] };
  return {
    title: response.title || "工作流结果",
    headline: response.direct_answer || "工作流已返回。",
    metrics: (response.highlights || []).map(item => ({ ...item, value: typeof item.value === "number" ? formatNumber(item.value) : displayValue(item.value) })),
    sections: response.sections || [], notes: [], tables: response.tables || [],
    files: (response.references || []).map((item, index) => ({
      id: item.id || index + 1, kind: "数据文件", uuid: item.file_uuid || "", path: item.source_path || "",
      meta: item.meta_path || "", name: item.name || "未返回文件名", dataType: item.data_type || "",
      status: item.parse_status || "未提供", previewUrl: item.preview_url || "", datasetId: "", created: "", finished: "", variables: item.variables || "",
    })),
    filters: [], sources: [], warnings: response.warnings || [],
    imageCaption: "分析图表；请结合表格中的单位和统计口径查看。",
    suggestedPrompts: response.suggested_prompts || [], referenceRunId: response.source_run_id || "",
    understanding: response.understanding || {},
    normalizedParameters: response.understanding?.normalized_parameters || [],
  };
});
const friendlyAnswer = computed(() => formatFriendlyAnswer(view.value.headline));
const rowLimits = ref({}), filesExpanded = ref(false), copyMessage = ref(""), rootEl = ref(null);
const activeVisualizationId = ref(null);
const activeVisualizationFile = computed(() => view.value.files.find(file => file.id === activeVisualizationId.value) || null);
const dataBase = import.meta.env?.VITE_API_BASE || "http://127.0.0.1:8002";
function link(url) {
  const safe = resourceUrl(url, dataBase, WORKFLOW_BASE);
  return safe ? props.imageUrl(safe) : "";
}
const images = computed(() => workflowImageUrls(props.run).filter(url => link(url)));
const riskLabel = computed(() => ({ low: "低", medium: "中等", high: "高" })[props.run.result?.guardrail?.risk_level] || "未标明");
function actionTitle(action) {
  return (view.value.sections || []).find(section => section.action_id === action.action_id)?.heading || action.intent_id;
}
function displayValue(value) {
  if (Array.isArray(value)) return value.join("、");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ?? "未提供";
}
function cleanHeadline(value) {
  return String(value || "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
    .replace(/^\|(.+)\|\s*$/gm, (_, cells) => cells.split("|").map(cell => cell.trim()).filter(Boolean).join(" · "))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function formatFriendlyAnswer(value) {
  const lines = cleanHeadline(value).split("\n").map(line => line.trim()).filter(Boolean);
  const intro = [];
  const points = [];
  let pendingLabel = "";
  for (const line of lines) {
    const labelOnly = line.match(/^(结果|范围(?:\/依据)?|依据|提醒|下一步)[:：]?$/);
    if (labelOnly) { pendingLabel = labelOnly[1]; continue; }
    const bullet = line.match(/^[•·\-]\s*(?:(结果|范围(?:\/依据)?|依据|提醒|下一步)[:：])?\s*(.*)$/);
    if (bullet) {
      const label = bullet[1] || pendingLabel;
      const text = bullet[2] || "";
      if (text) points.push(friendlyPoint(label, text));
      pendingLabel = "";
      continue;
    }
    if (pendingLabel) {
      points.push(friendlyPoint(pendingLabel, line));
      pendingLabel = "";
    } else if (!points) intro.push(line);
    else points.push(friendlyPoint("", line));
  }
  return {
    intro: intro.join(" ") || "结果已整理好，您可以直接查看下面的重点。",
    points: points.slice(0, 4),
  };
}
function friendlyPoint(label, text) {
  if (label === "提醒") return { label, text, tone: "warning", icon: "!" };
  if (label === "下一步") return { label, text, tone: "action", icon: "→" };
  if (label === "范围/依据" || label === "依据") return { label, text, tone: "neutral", icon: "•" };
  return { label, text, tone: "result", icon: "•" };
}
async function focusFile(id) {
  filesExpanded.value = true;
  await nextTick();
  rootEl.value?.querySelector(`[data-file-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); copyMessage.value = "已复制，可粘贴到输入框或其他位置。"; }
  catch { copyMessage.value = "未能访问剪贴板，请选中文字后手动复制。"; }
}
function toggleVisualization(file) {
  activeVisualizationId.value = activeVisualizationId.value === file.id ? null : file.id;
}
const now = ref(Date.now());
let timer;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onBeforeUnmount(() => clearInterval(timer));
const canConfirm = computed(() => canConfirmWorkflow(props.run, props.sessionId, now.value));
const isWinterArchive = computed(() => String(props.run?.result?.archive_id || '').startsWith('jilin_2025_winter_era5_'));
const isAgentScope = computed(() => props.run?.runtime === 'agentscope');
</script>

<style scoped>
.workflow-result { padding: 4px; font-size: 12px; overflow-wrap: anywhere; white-space: normal; min-width: 0; }
.agent-answer { margin: 10px 0 12px; }
.agent-answer-intro { margin: 0; color: var(--text); font-size: 14px; line-height: 1.8; }
.agent-answer-points { display: grid; gap: 7px; margin: 10px 0 0; padding: 0; list-style: none; }
.agent-answer-points li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 6px; align-items: start; line-height: 1.65; }
.agent-answer-icon { width: 18px; height: 18px; display: inline-grid; place-items: center; border-radius: 50%; color: #2563eb; background: rgba(37, 99, 235, .10); font-size: 12px; font-weight: 700; }
.agent-answer-points b { color: #1d4ed8; font-weight: 650; }
.agent-answer-points .tone-warning .agent-answer-icon { color: #b45309; background: rgba(245, 158, 11, .14); }
.agent-answer-points .tone-warning b { color: #b45309; }
.agent-answer-points .tone-action .agent-answer-icon { color: #0f766e; background: rgba(20, 184, 166, .13); }
.agent-answer-points .tone-action b { color: #0f766e; }
.agent-answer-points .tone-neutral .agent-answer-icon { color: #64748b; background: rgba(100, 116, 139, .12); }
.agent-answer-points .tone-neutral b { color: #475569; }
.workflow-understanding { border: 1px solid var(--border); border-radius: 8px; padding: 9px 10px; margin: 10px 0; }
.workflow-understanding p { margin: 5px 0 0; line-height: 1.7; }
.workflow-normalized { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 7px; }
.workflow-normalized small { color: var(--muted); }
.workflow-filters { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); }
.workflow-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.workflow-metrics > div { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.workflow-metrics dt { color: var(--muted); }
.workflow-metrics dd { font-size: 22px; color: var(--accent); margin: 4px 0 0; }
.workflow-metrics small { font-size: 11px; color: var(--muted); margin-left: 6px; }
.workflow-notes { border-left: 3px solid var(--accent); padding: 8px 10px; background: var(--field); margin: 12px 0; }
.workflow-notes p { margin: 4px 0; line-height: 1.7; }
.workflow-sections { display: grid; gap: 8px; margin: 12px 0; }
.workflow-section { border-left: 3px solid var(--accent); padding: 8px 10px; background: var(--field); }
.workflow-section p { margin: 5px 0; line-height: 1.7; }
.workflow-section ul { margin: 6px 0; padding-left: 20px; }
.workflow-section-head { display: flex; justify-content: space-between; gap: 10px; }
.workflow-section-head span { color: var(--muted); }
.workflow-table-section { margin: 16px 0; }
h4 { margin: 8px 0; font-size: 13px; }
.workflow-table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--border); min-width: 65px; vertical-align: top; }
th { background: var(--field); color: var(--muted); font-weight: 500; }
.file-reference { max-width: 240px; min-width: 150px; padding: 0; border: 0; background: transparent; text-align: left; color: var(--accent); overflow-wrap: anywhere; }
.workflow-table-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 6px; color: var(--muted); }
.workflow-actions ol { display: grid; gap: 6px; padding-left: 22px; }
.workflow-actions li { padding: 7px; border: 1px solid var(--border); border-radius: 7px; }
.workflow-actions li span { float: right; color: var(--accent); }
.workflow-actions em { color: var(--muted); font-size: 11px; font-style: normal; font-weight: 400; }
.workflow-actions small { display: block; margin-top: 4px; color: var(--muted); overflow-wrap: anywhere; }
.workflow-file { display: grid; gap: 5px; border: 1px solid var(--border); border-radius: 8px; margin: 8px 0; padding: 10px; }
.workflow-file-id { color: var(--muted); }
.workflow-file-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.workflow-file a { color: var(--accent); }
.workflow-image { margin: 16px 0; }
.workflow-image img { max-width: 100%; max-height: 420px; object-fit: contain; border-radius: 8px; }
.workflow-image figcaption { color: var(--muted); }
.workflow-heading { display: flex; justify-content: space-between; gap: 12px; color: var(--accent); }
.workflow-ids { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 6px; }
.workflow-ids dt { color: var(--muted); }
.workflow-ids dd { margin: 0; user-select: text; }
.workflow-steps { padding-left: 20px; line-height: 1.8; }
.workflow-steps span { margin-left: 10px; color: var(--accent); }
.workflow-confirm { display: grid; gap: 8px; border: 1px solid rgba(245, 158, 11, .4); border-radius: 8px; padding: 10px; margin: 10px 0; }
.workflow-confirm-actions { display: flex; gap: 8px; }
.workflow-confirm p, .workflow-steps p { margin: 0; }
.workflow-warnings { color: #d99a39; padding-left: 20px; }
.workflow-note { color: var(--muted); line-height: 1.7; }
.workflow-suggestions { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin: 12px 0; }
.failed { color: #f87171; }
button { color: var(--text); background: var(--field); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; cursor: pointer; font: inherit; }
button:disabled { opacity: .5; cursor: default; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--accent); }
pre { max-height: 360px; overflow: auto; white-space: pre-wrap; font-size: 11px; }
</style>
