<template>
  <div :class="['tool-call', statusClass]">
    <div class="tool-head">
      <div>
        <b>{{ title }}</b>
        <small v-if="subtitle">{{ subtitle }}</small>
      </div>
      <span>{{ status }}</span>
    </div>
    <div v-if="tc.progress != null && tc.progress < 100" class="progress">
      <i :style="{ width: `${Math.max(4, Math.min(100, tc.progress || 0))}%` }"></i>
    </div>
    <div v-if="analysisSummary" class="analysis-summary">{{ analysisSummary }}</div>
    <div v-if="guardrail" class="guardrail">
      <span>Guardrail</span>
      <b :class="{ blocked: !guardrail.allowed }">{{ guardrail.allowed ? "通过" : "阻止" }}</b>
      <em>{{ guardrail.risk_level || "unknown" }}</em>
    </div>
    <ol v-if="planSteps.length" class="plan">
      <li v-for="step in planSteps" :key="step">{{ step }}</li>
    </ol>
    <div v-if="recordCount" class="records">返回记录 {{ recordCount }} 条</div>
    <pre v-if="detail">{{ detail }}</pre>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  tc: { type: Object, default: () => ({}) },
});

const title = computed(() => props.tc.name || props.tc.tool || "工具调用");
const status = computed(() => props.tc.status || props.tc.state || "完成");
const subtitle = computed(() => props.tc.label || "");
const analysisSummary = computed(() => props.tc.analysis?.summary || "");
const guardrail = computed(() => props.tc.analysis?.guardrail || null);
const planSteps = computed(() => props.tc.analysis?.plan?.steps || []);
const recordCount = computed(() => props.tc.analysis?.records?.length || 0);
const statusClass = computed(() => {
  if (guardrail.value?.allowed === false || props.tc.status === "blocked") return "blocked";
  if (props.tc.status === "running") return "running";
  if (props.tc.status === "done" || props.tc.status === "ok") return "ok";
  return "";
});
const detail = computed(() => {
  if (props.tc.analysis?.guardrail || props.tc.analysis?.plan) return "";
  const data = props.tc.args || props.tc.input || props.tc.result || props.tc.output;
  if (!data) return "";
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
});
</script>

<style scoped>
.tool-call {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--field);
}

.tool-call.ok {
  border-color: rgba(34, 197, 94, .28);
}

.tool-call.running {
  border-color: rgba(59, 130, 246, .35);
}

.tool-call.blocked {
  border-color: rgba(248, 113, 113, .38);
}

.tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.tool-head > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.tool-head small {
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.tool-head span {
  color: var(--muted);
}

.progress {
  height: 4px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,.08);
}

.progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #3b82f6;
}

.analysis-summary {
  margin-top: 8px;
  color: var(--text);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.guardrail {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  color: var(--muted);
  font-size: 11px;
}

.guardrail b {
  color: #22c55e;
}

.guardrail b.blocked {
  color: #f87171;
}

.guardrail em {
  margin-left: auto;
  font-style: normal;
}

.plan {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.records {
  margin-top: 7px;
  color: var(--muted);
  font-size: 11px;
}

pre {
  margin: 8px 0 0;
  max-height: 180px;
  overflow: auto;
  color: var(--muted);
  font: 11px/1.5 Consolas, Monaco, monospace;
  white-space: pre-wrap;
}
</style>
