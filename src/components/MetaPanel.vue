<template>
  <aside class="meta-panel glass">
    <div class="mp-head">
      <h4>气象信息</h4>
      <button v-if="closable" class="mp-close" @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </button>
    </div>
    <div class="mp-body" v-if="meta">
      <dl>
        <div v-for="[k, v] in rows" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></div>
      </dl>
      <h4 class="mp-sec">处理步骤</h4>
      <ul class="proc">
        <li v-for="s in steps" :key="s.step || s.label">
          <el-icon :class="s.ok ? 'ok' : s.running !== false ? 'run' : 'dim'">
            <CircleCheck v-if="s.ok" /><Loading v-else-if="s.running !== false" /><Clock v-else />
          </el-icon>
          <span>{{ s.step || s.label }}</span>
          <em :class="s.ok ? 'ok' : s.running !== false ? 'run' : ''">{{ s.state }}</em>
          <time>{{ s.t }}</time>
        </li>
      </ul>
      <slot />
    </div>
    <div class="mp-empty" v-else>
      <slot name="empty">
        <el-icon><Document /></el-icon>
        <p>暂无气象信息</p>
      </slot>
    </div>
  </aside>
</template>

<script setup>
import { computed } from "vue";
import { CircleCheck, Clock, Close, Document, Loading } from "@element-plus/icons-vue";

const props = defineProps({
  meta: { type: Object, default: null },
  steps: { type: Array, default: () => [] },
  closable: Boolean,
});

defineEmits(["close"]);

const rows = computed(() => {
  const m = props.meta;
  if (!m) return [];
  return [
    ["当前文件", m.file], ["气象要素", m.element], ["时次", m.time], ["层级/高度", m.level],
    ["空间范围", m.range], ["有效网格", m.grid], ["缺测值", m.missing],
    ["单位", m.unit], ["变量数", m.vars], ["时间步", m.steps],
  ];
});
</script>

<style scoped>
.meta-panel {
  flex-shrink: 0;
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mp-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 52px;
  border-bottom: 1px solid var(--border);
}
.mp-head h4 { margin: 0; font-size: 14px; }

.mp-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--field);
  color: var(--muted);
  cursor: pointer;
}
.mp-close:hover { color: var(--text); }

.mp-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px 16px;
  scrollbar-width: none;
}
.mp-body::-webkit-scrollbar { display: none; }

.mp-body dl { margin: 0; }
.mp-body dl div { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.mp-body dt { color: var(--muted); font-size: 12px; white-space: nowrap; flex-shrink: 0; }
.mp-body dd { margin: 0; font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mp-sec { margin: 18px 0 8px; font-size: 13px; }

.proc { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
.proc li { display: flex; align-items: center; gap: 8px; padding: 7px 0; font-size: 12px; }
.proc em { font-style: normal; }
.proc time { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11px; }

.mp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
}
.mp-empty :deep(.el-icon) { font-size: 36px; }
.mp-empty p { font-size: 13px; margin: 0; }

.ok { color: var(--ok); }
.run { color: var(--accent); }
.dim { color: var(--muted); }
</style>
