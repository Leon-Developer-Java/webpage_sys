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
import { computed } from "vue";

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

const rows = computed(() => {
  const meta = props.meta || {};
  const info = meta.weather_info || meta;
  const baseRows = [
    ["file", "文件", info.file || meta.file?.name || meta.file_name || meta.source_file],
    ["element", "要素", info.element],
    ["time", "时间", info.time],
    ["level", "层级", info.level],
    ["range", "范围", info.range],
    ["grid", "网格", info.grid],
    ["unit", "单位", info.unit],
    ["missing", "缺测", info.missing],
    ["status", "状态", info.status],
  ];
  const extraRows = normalizeExtraRows(meta.extraRows || info.extraRows);

  return [...baseRows, ...extraRows]
    .filter(([, , value]) => value !== undefined && value !== null && value !== "")
    .map(([key, label, value]) => ({ key, label, value: formatPanelValue(key, value) }));
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
    .map(([key, label, value]) => ({ key, label, value }));
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

function formatTime(value) {
  return formatBeijingTime(value) || value;
}

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
  if (key !== "time" || !props.himawariStatus) return value;
  return formatBeijingTime(value) || value;
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

/* ── 固定标题栏 ── */
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

/* ── 滚动内容区 ── */
.mp-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;

  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

/* Chrome / Edge / Safari */
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

/* ── 数据列表 ── */
.meta-list {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 7px 8px;
  margin: 0;
  font-size: 12px;
}

dt {
  color: var(--muted);
  white-space: nowrap;
}

dd {
  margin: 0;
  color: var(--text);
  word-break: break-word;
  line-height: 1.4;
}

.auto-box {
  display: grid;
  gap: 9px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.auto-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.auto-head h4 {
  margin: 0;
  font-size: 13px;
}

.auto-state {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--field);
  color: var(--muted);
  font-size: 10px;
}

.auto-state.ok { color: #42e695; }
.auto-state.running { color: var(--accent); }
.auto-state.warn { color: #f5a524; }
.auto-state.error { color: #ff6b6b; }

.auto-list {
  display: grid;
  grid-template-columns: 58px 1fr;
  gap: 6px 8px;
  margin: 0;
  font-size: 11px;
}

.auto-error {
  margin: 0;
  color: #ff9b9b;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
}

/* ── 空态 ── */
.empty {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
</style>
