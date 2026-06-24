<template>
  <aside class="meta-panel glass">
    <button v-if="closable" class="close-btn" type="button" @click="emit('close')">×</button>

    <slot v-if="!meta" name="empty">
      <div class="empty">暂无解析信息</div>
    </slot>

    <template v-else>
      <h3>气象信息</h3>
      <dl class="meta-list">
        <template v-for="row in rows" :key="row.key">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>

      <div v-if="steps.length" class="steps">
        <h4>处理流程</h4>
        <div v-for="(step, index) in steps" :key="index" class="step">
          <span :class="['dot', { ok: step.ok, running: step.running }]"></span>
          <span>{{ step.step || step.label }}</span>
          <small>{{ step.state }} {{ step.t }}</small>
        </div>
      </div>

      <slot />
    </template>
  </aside>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  meta: Object,
  steps: { type: Array, default: () => [] },
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
  position: relative;
  width: 286px;
  flex-shrink: 0;
  padding: 16px;
  overflow: auto;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

h3,
h4 {
  margin: 0 0 12px;
  font-size: 15px;
}

h4 {
  margin-top: 16px;
  font-size: 13px;
}

.meta-list {
  display: grid;
  grid-template-columns: 66px 1fr;
  gap: 8px 10px;
  margin: 0;
  font-size: 12px;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  color: var(--text);
  word-break: break-word;
}

.steps {
  border-top: 1px solid var(--border);
  margin-top: 14px;
  padding-top: 12px;
}

.step {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12px;
}

.step small {
  color: var(--muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}

.dot.ok {
  background: var(--ok);
}

.dot.running {
  background: var(--accent);
}

.empty {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
</style>
