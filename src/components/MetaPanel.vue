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

      </template>
    </div>
  </aside>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  meta: Object,
  closable: Boolean,
});

const emit = defineEmits(["close"]);

const rows = computed(() => {
  const meta = props.meta || {};
  const info = meta.weather_info || meta;
  return [
    ["file", "文件", info.file || meta.file?.name || meta.file_name || meta.source_file],
    ["element", "要素", info.element],
    ["time", "时间", info.time],
    ["level", "层级", info.level],
    ["range", "范围", info.range],
    ["grid", "网格", info.grid],
    ["unit", "单位", info.unit],
    ["missing", "缺测", info.missing],
    ["status", "状态", info.status],
  ]
    .filter(([, , value]) => value !== undefined && value !== null && value !== "")
    .map(([key, label, value]) => ({ key, label, value }));
});
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
  grid-template-columns: 58px 1fr;
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
