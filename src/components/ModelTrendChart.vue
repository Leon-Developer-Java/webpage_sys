<template>
  <div v-if="normalizedSeries.length" class="trend-chart">
    <div class="series-tabs">
      <button
        v-for="item in normalizedSeries"
        :key="item.key"
        :class="{ on: selectedKey === item.key }"
        type="button"
        @click="selectedKey = item.key"
      >{{ item.label }}</button>
    </div>
    <div ref="chartEl" class="chart-canvas"></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";

const props = defineProps({
  series: { type: Array, default: () => [] },
  frames: { type: Array, default: () => [] },
  active: { type: Number, default: 0 },
});

const chartEl = ref(null);
const selectedKey = ref("");
let chart = null;
let resizeObserver = null;

const normalizedSeries = computed(() => (props.series || []).filter(item => Array.isArray(item?.values) && item.values.length));
const selectedSeries = computed(() => normalizedSeries.value.find(item => item.key === selectedKey.value) || normalizedSeries.value[0] || null);
const labels = computed(() => props.frames.map(frame => formatTime(frame?.valid_time)));

function formatTime(value) {
  const text = String(value || "");
  const matched = text.match(/(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return matched ? `${matched[1]}-${matched[2]} ${matched[3]}:${matched[4]}` : text;
}

function renderChart() {
  if (!chartEl.value || !selectedSeries.value) return;
  chart ||= echarts.init(chartEl.value);
  const item = selectedSeries.value;
  const activeLabel = labels.value[Math.min(Math.max(props.active, 0), Math.max(0, labels.value.length - 1))];
  chart.setOption({
    animationDuration: 220,
    grid: { left: 38, right: 12, top: 15, bottom: 28 },
    tooltip: {
      trigger: "axis",
      formatter(params) {
        const point = params?.[0];
        return point ? `${point.axisValue}<br/>${item.label}：<b>${Number(point.value).toFixed(2)} ${item.unit || ""}</b>` : "";
      },
    },
    xAxis: {
      type: "category",
      data: labels.value,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(148,163,184,.28)" } },
      axisTick: { show: false },
      axisLabel: { color: "#94a3b8", fontSize: 8, interval: Math.max(0, Math.ceil(labels.value.length / 5) - 1) },
    },
    yAxis: {
      type: "value",
      name: item.unit || "",
      nameTextStyle: { color: "#94a3b8", fontSize: 8 },
      splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } },
      axisLabel: { color: "#94a3b8", fontSize: 8 },
    },
    series: [{
      name: item.label,
      type: "line",
      data: item.values,
      smooth: true,
      connectNulls: false,
      symbol: "none",
      lineStyle: { width: 2, color: item.color || "#3b82f6" },
      areaStyle: { color: `${item.color || "#3b82f6"}22` },
      markLine: activeLabel ? {
        symbol: "none",
        silent: true,
        label: { show: false },
        lineStyle: { color: "#f59e0b", width: 1, type: "dashed" },
        data: [{ xAxis: activeLabel }],
      } : undefined,
    }],
  }, true);
}

watch(normalizedSeries, value => {
  if (!value.some(item => item.key === selectedKey.value)) selectedKey.value = value[0]?.key || "";
}, { immediate: true });
watch([selectedSeries, labels, () => props.active], () => nextTick(renderChart), { deep: true });

onMounted(() => {
  renderChart();
  resizeObserver = new ResizeObserver(() => chart?.resize());
  if (chartEl.value) resizeObserver.observe(chartEl.value);
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.trend-chart { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--field); }
.series-tabs { display: flex; gap: 3px; padding: 6px 6px 0; overflow-x: auto; scrollbar-width: none; }
.series-tabs::-webkit-scrollbar { display: none; }
.series-tabs button { flex-shrink: 0; padding: 4px 7px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 8px; cursor: pointer; }
.series-tabs button.on { color: #fff; background: var(--accent); }
.chart-canvas { width: 100%; height: 128px; }
</style>
