<template>
  <section class="wrf-evidence-card">
    <h4>WRF 文献候选 <small v-if="event.kb_version">知识库 v{{ event.kb_version }}</small></h4>
    <p>仅供配置参考 · 尚未运行 WRF · 来源未经独立原文核验</p>
    <p v-if="!event.candidates?.length">{{ event.summary || '当前条件下证据不足。' }}</p>
    <div v-if="event.literature_search">
      <h5>联网文献线索（待核验，不是配置推荐）</h5>
      <p>{{ event.literature_search.message }} · {{ event.literature_search.status }}{{ event.literature_search.cached ? ' · 缓存结果' : '' }}</p>
      <article v-for="paper in event.literature_search.papers || []" :key="paper.doi">
        <strong>{{ paper.title }}</strong>
        <p>DOI：{{ paper.doi }} · 未核验适用区域、网格及物理参数</p>
        <a v-if="safeUrl(paper.source_url)" :href="safeUrl(paper.source_url)" target="_blank" rel="noopener noreferrer">查看论文来源</a>
      </article>
    </div>
    <article v-for="candidate in event.candidates || []" :key="`${candidate.paper_id}:${candidate.member_id}:${candidate.domain_id}`">
      <strong>{{ candidate.title }}</strong>
      <p>{{ candidate.matched?.region }} · {{ candidate.matched?.dx_km }} km · {{ candidate.member_id }} / {{ candidate.domain_id }}</p>
      <dl>
        <template v-for="(value, key) in candidate.physics_proposal" :key="key">
          <dt>{{ key }}</dt><dd>{{ value }}</dd>
        </template>
      </dl>
      <p v-if="candidate.unresolved_parameters?.length">未确定：{{ candidate.unresolved_parameters.join('、') }}</p>
      <p>原文 WRF 版本：{{ candidate.paper_wrf_version || '未说明' }}；同域评价记录 {{ candidate.performance?.length || 0 }} 条。</p>
      <a v-if="safeUrl(candidate.source_url)" :href="safeUrl(candidate.source_url)" target="_blank" rel="noopener noreferrer">查看论文来源</a>
      <details>
        <summary>证据与评价范围</summary>
        <p v-for="evidence in candidate.evidence || []" :key="evidence.evidence_id">
          {{ evidence.source_locator_table_figure_page || '缺少精确原文定位' }} · {{ evidence.verification_note || '待核验' }}
        </p>
        <p v-for="metric in candidate.performance || []" :key="metric.performance_id">
          {{ metric.target_variable_raw }}：{{ metric.metric_name_standard }} = {{ metric.metric_value }} {{ metric.metric_unit }}
          （{{ metric.metric_scope || metric.rank_context || '范围未明确' }}；{{ metric.source_locator || '待定位' }}）
        </p>
        <p>数据定位：{{ candidate.provenance?.file }}，记录 {{ candidate.provenance?.row }}。</p>
      </details>
    </article>
    <p>单域候选不是完整运行配置，不同研究指标不可直接横向排名。</p>
    <RouterLink to="/wrf?view=new">前往 WRF 工作台核对完整配置</RouterLink>
    <p><RouterLink to="/agent/wrf-evidence">录入与审核文献证据</RouterLink></p>
  </section>
</template>

<script setup>
defineProps({ event: { type: Object, required: true } });
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
</script>

<style scoped>
.wrf-evidence-card { margin: 12px 0; padding: 14px; border: 1px solid #64748b66; border-radius: 10px; overflow-wrap: anywhere; }
h4 { margin: 0 0 8px; } small { font-weight: normal; }
article { padding: 12px 0; border-top: 1px solid #64748b44; }
p { font-size: 12px; line-height: 1.6; } a { color: #60a5fa; }
dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; font-size: 12px; }
dd { margin: 0; } summary { cursor: pointer; margin-top: 8px; }
</style>
