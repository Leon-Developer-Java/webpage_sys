<template>
  <section class="analysis-card">
    <header>
      <div>
        <b>短临预报结果解读</b>
        <span>{{ analysis.accuracy_available ? "实况检验" : "预测特征分析" }}</span>
      </div>
      <i :class="{ strong: analysis.strong_echo_signal, quiet: !analysis.echo_signal }">
        {{ signalLabel }}
      </i>
    </header>

    <p class="headline">{{ analysis.headline }}</p>

    <div class="metrics">
      <article v-for="item in analysis.key_metrics || []" :key="item.key">
        <span>{{ item.label }}</span>
        <b>{{ item.value }}</b>
        <small>{{ formatDetail(item.detail) }}</small>
      </article>
    </div>

    <div class="notice">
      <b>解释边界</b>
      <span>{{ (analysis.notices || [])[0] }}</span>
    </div>

    <div class="actions">
      <button type="button" @click="showTable = !showTable">
        {{ showTable ? "收起逐帧表格" : "查看逐帧表格" }}
      </button>
      <button type="button" @click="downloadCsv">下载 CSV</button>
      <span>任务 {{ analysis.run_id }}</span>
    </div>

    <div v-if="showTable" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key">
              {{ column.label }}<small v-if="column.unit">（{{ column.unit }}）</small>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="`${row.index}-${row.valid_time}`">
            <td v-for="column in columns" :key="column.key">
              {{ formatCell(column.key, row[column.key]) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  analysis: { type: Object, required: true },
});

const showTable = ref(Boolean(props.analysis.show_table));
const columns = computed(() => props.analysis.table?.columns || []);
const rows = computed(() => props.analysis.table?.rows || []);
const signalLabel = computed(() => {
  if (props.analysis.strong_echo_signal) return "存在较强回波";
  if (props.analysis.echo_signal) return "存在降水信号";
  return "无明显回波";
});

function formatTime(value) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const date = new Date(text.includes("T") ? text : text.replace(" ", "T"));
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDetail(value) {
  return String(value || "").includes("T") ? formatTime(value) : value || "—";
}

function formatCell(key, value) {
  if (key === "valid_time") return formatTime(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value ?? "—";
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv() {
  if (!columns.value.length || !rows.value.length) return;
  const header = columns.value.map(column => csvCell(
    column.unit ? `${column.label}(${column.unit})` : column.label,
  )).join(",");
  const body = rows.value.map(row => columns.value.map(
    column => csvCell(row[column.key]),
  ).join(","));
  const blob = new Blob([`\uFEFF${[header, ...body].join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${props.analysis.run_id || "nowcast"}_逐帧分析.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.analysis-card { width: min(760px, 72vw); margin-top: 10px; overflow: hidden; border: 1px solid color-mix(in srgb, #38bdf8 36%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--panel) 94%, transparent); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
header div { display: flex; flex-direction: column; gap: 2px; }
header b { color: var(--text); font-size: 13px; }
header span { color: var(--muted); font-size: 10px; }
header i { padding: 4px 7px; border-radius: 999px; background: rgba(56,189,248,.14); color: #38bdf8; font-size: 9px; font-style: normal; }
header i.strong { background: rgba(239,68,68,.14); color: #ef4444; }
header i.quiet { background: rgba(34,197,94,.14); color: #22c55e; }
.headline { margin: 0; padding: 11px 13px 3px; color: var(--text); font-size: 11px; line-height: 1.6; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 7px; padding: 8px 13px; }
.metrics article { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 8px; border-radius: 8px; background: color-mix(in srgb, var(--panel) 82%, #38bdf8 5%); }
.metrics span, .metrics small { overflow: hidden; color: var(--muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.metrics b { overflow: hidden; color: var(--text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.notice { display: flex; gap: 7px; margin: 0 13px 8px; padding: 7px 9px; border-left: 2px solid #f59e0b; border-radius: 5px; background: rgba(245,158,11,.08); font-size: 9px; line-height: 1.5; }
.notice b { flex-shrink: 0; color: #f59e0b; }
.notice span { color: var(--muted); }
.actions { display: flex; align-items: center; gap: 6px; padding: 0 13px 10px; }
.actions button { padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text); font-size: 10px; cursor: pointer; }
.actions button:hover { border-color: #38bdf8; color: #38bdf8; }
.actions span { min-width: 0; margin-left: auto; overflow: hidden; color: var(--muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.table-wrap { max-height: 330px; overflow: auto; border-top: 1px solid var(--border); }
table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 9px; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--border); color: var(--muted); text-align: left; white-space: nowrap; }
th { position: sticky; top: 0; z-index: 1; background: var(--panel); color: var(--text); font-weight: 700; }
th small { color: var(--muted); font-size: 8px; font-weight: 400; }
tbody tr:hover { background: color-mix(in srgb, #38bdf8 6%, transparent); }
@media (max-width: 900px) {
  .analysis-card { width: 100%; }
  .metrics { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
</style>
