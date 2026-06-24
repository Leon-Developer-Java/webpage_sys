<template>
  <div class="tool-call">
    <div class="tool-head">
      <b>{{ title }}</b>
      <span>{{ status }}</span>
    </div>
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
const detail = computed(() => {
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

.tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.tool-head span {
  color: var(--muted);
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
