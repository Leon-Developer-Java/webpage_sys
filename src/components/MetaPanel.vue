<template>
  <aside class="meta-panel glass">
    <div class="mp-header">
      <span class="mp-title">气象信息</span>
      <button v-if="closable" class="close-btn" type="button" @click="emit('close')">×</button>
    </div>

    <div class="mp-body">
      <slot v-if="!meta" name="empty">
        <div class="empty">暂无解析信息</div>
      </slot>

      <template v-else>
        <dl class="meta-list">
          <template v-for="row in rows" :key="row.key">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>

        <section v-if="statRows.length" class="stat-chart">
          <small>统计值</small>
          <div ref="chartEl" class="stat-chart-body"></div>
        </section>

        <section v-if="himawariStatus" class="auto-box">
          <div class="auto-head">
            <h4>自动处理</h4>
            <b :class="['auto-state', statusClass]">{{ statusLabel }}</b>
          </div>
          <dl class="auto-list">
            <template v-for="row in statusRows" :key="row.key">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
          <p v-if="firstErrorText" class="auto-error">{{ firstErrorText }}</p>
        </section>
      </template>
    </div>
  </aside>
</template>

<script setup>
import {computed, nextTick, onBeforeUnmount, ref, watch} from "vue";
import * as echarts from "echarts";

const props = defineProps({
  meta: Object,
  himawariStatus: Object,
  closable: Boolean,
});

const emit = defineEmits(["close"]);

function normalizeExtraRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (Array.isArray(row)) {
      const [key, label, value] = row;
      return [key, label, value];
    }
    return [row.key, row.label, row.value];
  });
}

function pickText(...items) {
  return items
      .map((item) => String(item || "").trim())
      .find(Boolean) || "";
}

function normalizeElementKey(info, meta) {
  const text = pickText(
      info.shortName,
      info.short_name,
      info.key,
      info.variable,
      info.element,
      info.long_name,
      info.mainVariableName,
      meta.shortName,
      meta.short_name,
      meta.variable,
      meta.element,
  ).toLowerCase();

  if (/(^|[^a-z0-9])(?:2t|t2m)([^a-z0-9]|$)|2\s*metre\s*temperature|2\s*meter\s*temperature|2米气温|2米温度/.test(text)) return "t2m";
  if (/(^|[^a-z0-9])(?:2d|d2m)([^a-z0-9]|$)|2\s*metre\s*dewpoint|2\s*meter\s*dewpoint|dewpoint|露点/.test(text)) return "d2m";
  if (/(^|[^a-z0-9])(?:tp|apcp)([^a-z0-9]|$)|total\s*precipitation|accumulated\s*precipitation|precipitation|累积降水|总降水|降水/.test(text)) return "tp";
  if (/(^|[^a-z0-9])(?:sp)([^a-z0-9]|$)|surface\s*pressure|地面气压|地表气压/.test(text)) return "sp";
  if (/(^|[^a-z0-9])(?:msl|prmsl)([^a-z0-9]|$)|mean\s*sea\s*level\s*pressure|sea\s*level\s*pressure|海平面气压|海平面压力/.test(text)) return "msl";
  if (/(^|[^a-z0-9])(?:u10)([^a-z0-9]|$)|10m\s*u|10\s*metre\s*u|10米u|东西风/.test(text)) return "u10";
  if (/(^|[^a-z0-9])(?:v10)([^a-z0-9]|$)|10m\s*v|10\s*metre\s*v|10米v|南北风/.test(text)) return "v10";
  if (/temperature|气温|温度/.test(text)) return "temperature";
  if (/pressure|气压|压力/.test(text)) return "pressure";

  return "";
}

function getElementMeaning(info, meta = {}) {
  const explicit = pickText(
      info.element_description,
      info.elementDescription,
      info.description_cn,
      info.description,
      meta.element_description,
      meta.elementDescription,
  );

  if (explicit) return explicit;

  const key = normalizeElementKey(info, meta);

  const mapping = {
    t2m: "表示距地面约 2 米高度处的空气温度，常用于判断近地面冷暖状况、热浪或低温风险；当前单位通常为 ℃。",
    d2m: "表示距地面约 2 米高度处空气达到饱和时的温度，可反映近地面水汽含量和湿度条件；露点越高，空气越湿，有利于降水发展。",
    tp: "表示从起报时刻到当前预报时效累计的降水量，用于判断降雨落区、强度和过程累计雨量；当前单位通常为 mm。",
    sp: "表示地面实际气压，会受到天气系统和地形高度共同影响；低压区常与上升运动、云雨发展有关，高压区通常对应较稳定天气。",
    msl: "表示订正到平均海平面的气压，适合分析大尺度高低压系统、锋面和气旋结构，较少受地形高度直接影响。",
    u10: "表示 10 米高度处东西方向风速分量，正值通常代表由西向东的风，负值代表由东向西的风。",
    v10: "表示 10 米高度处南北方向风速分量，正值通常代表由南向北的风，负值代表由北向南的风。",
    temperature: "表示空气温度场，用于分析冷暖分布、温度梯度和天气系统热力结构。",
    pressure: "表示气压场，用于识别高压、低压、槽脊等天气系统结构。",
  };

  return mapping[key] || "表示当前图层所展示的气象变量，用于描述该时次、该层级上的大气或地表状态。";
}

const allRows = computed(() => {
  const meta = props.meta || {};
  const info = meta.weather_info || meta;
  // 优先使用数据源提供的 elementMeaning，否则从关键字推断
  const elementMeaning = info.elementMeaning || getElementMeaning(info, meta);
  // 要素中文名后附加英文名
  const elementValue = info.element
    + (info.element_en ? ` · ${info.element_en}` : "");

  const baseRows = [
    ["file", "文件", info.file || meta.file?.name || meta.file_name || meta.source_file],
    ["element", "要素", elementValue],
    ["elementExplain", "含义", elementMeaning],
    ["time", "时间", info.time],
    ["level", "层级", info.level],
    ["range", "范围", info.range],
    ["grid", "网格", info.grid],
    ["resolution", "分辨率", info.resolution || info.spatial_resolution || meta.resolution || meta.spatial_resolution],
    ["timeResolution", "时间分辨率", info.timeResolution],
    ["spatialResolution", "空间分辨率", info.spatialResolution],
    ["unit", "单位", info.unit],
    ["missing", "缺测", info.missing],
    ["status", "状态", info.status],
  ];
  const extraRows = normalizeExtraRows(meta.extraRows || info.extraRows);

  return [...baseRows, ...extraRows]
      .filter(([, , value]) => value !== undefined && value !== null && value !== "")
      .map(([key, label, value]) => ({key, label, value: formatPanelValue(key, value)}));
});

const STAT_KEYS = ["min", "mean", "max"];

const rows = computed(() => allRows.value.filter(row => !STAT_KEYS.includes(row.key)));

const statRows = computed(() => {
  const byKey = {};
  for (const row of allRows.value) if (STAT_KEYS.includes(row.key)) byKey[row.key] = row;
  return STAT_KEYS.filter(key => byKey[key] && Number.isFinite(parseFloat(String(byKey[key].value)))).map(key => byKey[key]);
});

const chartEl = ref(null);
let chart = null;

function renderStatChart() {
  if (!statRows.value.length) {
    chart?.dispose();
    chart = null;
    return;
  }
  if (!chartEl.value) return;
  if (chart && chart.getDom() !== chartEl.value) {
    chart.dispose();
    chart = null;
  }
  if (!chart) chart = echarts.init(chartEl.value);
  const nums = statRows.value.map(row => parseFloat(String(row.value)));
  const span = Math.max(...nums) - Math.min(...nums);
  const pad = (span || Math.abs(nums[0]) || 1) * 0.18;
  const style = getComputedStyle(chartEl.value);
  const accent = style.getPropertyValue("--accent").trim() || "#4ea1ff";
  const textColor = style.getPropertyValue("--text").trim() || "#eaf1fb";
  const mutedColor = style.getPropertyValue("--muted").trim() || "rgba(234,241,251,0.56)";
  chart.setOption({
    grid: {left: 46, right: 60, top: 6, bottom: 6},
    xAxis: {type: "value", min: Math.min(...nums) - pad, max: Math.max(...nums) + pad * 0.4, show: false},
    yAxis: {
      type: "category",
      data: statRows.value.map(row => row.label),
      inverse: true,
      axisLine: {show: false},
      axisTick: {show: false},
      axisLabel: {color: mutedColor, fontSize: 10},
    },
    series: [{
      type: "bar",
      data: nums,
      barWidth: 10,
      itemStyle: {color: accent, borderRadius: [0, 5, 5, 0]},
      label: {
        show: true,
        position: "right",
        color: textColor,
        fontSize: 10,
        formatter: p => String(statRows.value[p.dataIndex]?.value ?? p.value),
      },
    }],
  }, true);
}

watch(statRows, () => nextTick(renderStatChart), {immediate: true, deep: true});

onBeforeUnmount(() => {
  chart?.dispose();
  chart = null;
});

const statusLabel = computed(() => {
  const state = props.himawariStatus?.state;
  if (state === "running") return "处理中";
  if (state === "completed") return "已完成";
  if (state === "waiting_credentials") return "待配置";
  if (state === "disabled") return "已关闭";
  if (state === "error") return "异常";
  return "待机";
});

const statusClass = computed(() => {
  const state = props.himawariStatus?.state;
  if (state === "running") return "running";
  if (state === "completed") return "ok";
  if (state === "waiting_credentials" || state === "disabled") return "warn";
  if (state === "error") return "error";
  return "";
});

const statusRows = computed(() => {
  return [
    ["download_scene", "正在下载", formatActiveItems(activeDownloads.value)],
    ["parse_scene", "正在解析", formatActiveItems(activeParses.value)],
  ]
      .filter(([, , value]) => value !== undefined && value !== null && value !== "")
      .map(([key, label, value]) => ({key, label, value}));
});

const activeDownloads = computed(() => {
  const status = props.himawariStatus || {};
  const items = normalizeActiveItems(status.active_downloads);
  if (items.length) return items;
  if (status.stage === "downloading" || status.stage === "listing") return normalizeActiveItems([status]);
  return [];
});

const activeParses = computed(() => {
  const status = props.himawariStatus || {};
  const items = normalizeActiveItems(status.active_parses);
  if (items.length) return items;
  if (status.stage === "processing_band" || status.stage === "parsing" || status.stage === "compositing" || status.stage === "writing_meta" || status.stage === "cleanup_raw") {
    return normalizeActiveItems([status]);
  }
  return [];
});

function normalizeActiveItems(items) {
  if (!Array.isArray(items)) return [];
  return items
      .map((item) => ({
        scene_id: item.scene_id || item.current_scene,
        queue_done: item.queue_done,
        queue_total: item.queue_total,
      }))
      .filter((item) => item.scene_id);
}

function formatActiveItems(items) {
  return items.map((item) => `${formatScene(item.scene_id)}${formatProgress(item)}`).join("、");
}

function formatProgress(item) {
  const total = Number(item.queue_total || 0);
  if (!total) return "";
  const done = Number(item.queue_done || 0);
  return ` (${done}/${total})`;
}

const firstErrorText = computed(() => {
  const status = props.himawariStatus || {};
  if (status.last_error) return status.last_error;
  const sample = status.last_result?.error_samples?.[0];
  if (!sample) return "";
  return `${sample.scene_id || "最近错误"}：${sample.error || "未知错误"}`;
});

function formatScene(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{8})_(\d{4})$/);
  if (!match) return text;
  const [, date, time] = match;
  const utcDate = new Date(Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
  ));
  return formatBeijingDate(utcDate);
}

function formatPanelValue(key, value) {
  if (key !== "time") return value;
  const text = (props.himawariStatus && formatBeijingTime(value)) || String(value || "");
  return text.replace(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[\sT]+/, "$1\n");
}

function formatBeijingTime(value) {
  if (!value) return "";
  const text = String(value);
  if (!/[TZ]|[+-]\d{2}:?\d{2}$/.test(text)) return "";
  const parsed = new Date(text.replace("Z", "+00:00"));
  if (Number.isNaN(parsed.getTime())) return "";
  return formatBeijingDate(parsed);
}

function formatBeijingDate(date) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijing.getUTCDate()).padStart(2, "0");
  const hour = String(beijing.getUTCHours()).padStart(2, "0");
  const minute = String(beijing.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
</script>

<style scoped>
.meta-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.mp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.3px;
}

.close-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.close-btn:hover {
  background: var(--field);
  color: var(--text);
}

.mp-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.mp-body::-webkit-scrollbar {
  width: 4px;
}

.mp-body::-webkit-scrollbar-track {
  background: transparent;
}

.mp-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.mp-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.22);
}

.meta-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
  margin: 0;
  font-size: 12px;
}

.meta-list dt {
  font-size: 11px;
  letter-spacing: 0.3px;
}

.meta-list dd {
  padding: 3px 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.meta-list dd:last-child {
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}

dt {
  color: var(--muted);
  white-space: nowrap;
}

dd {
  margin: 0;
  color: var(--text);
  line-height: 1.4;
  white-space: pre-line;
  word-break: break-word;
}

.stat-chart {
  margin-top: 12px;
  padding: 10px 8px 6px;
  border-radius: 12px;
  background: var(--field);
  border: 1px solid var(--border);
}

.meta-list + .stat-chart {
  margin-top: 16px;
  position: relative;
}

.meta-list + .stat-chart::before {
  content: '';
  position: absolute;
  top: -9px;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--border);
}

.stat-chart small {
  display: block;
  padding: 0 4px 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.3px;
}

.stat-chart-body {
  width: 100%;
  height: 96px;
}

.auto-box {
  margin-top: 16px;
  padding: 12px;
  border-radius: 12px;
  background: var(--field);
  border: 1px solid var(--border);
}

.auto-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.auto-head h4 {
  margin: 0;
  font-size: 12px;
  color: var(--text);
}

.auto-state {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--muted);
  background: rgba(148, 163, 184, 0.12);
}

.auto-state.ok {
  color: #86efac;
  background: rgba(34, 197, 94, 0.12);
}

.auto-state.running {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.12);
}

.auto-state.warn {
  color: #fde68a;
  background: rgba(234, 179, 8, 0.12);
}

.auto-state.error {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
}

.auto-list {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 7px 8px;
  margin: 0;
  font-size: 12px;
}

.auto-error {
  margin: 10px 0 0;
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.45;
}

.empty {
  color: var(--muted);
  font-size: 12px;
}
</style>
