<template>
  <div class="tc">
    <div class="tc-head">
      <el-icon><Loading v-if="tc.progress < 100" /><CircleCheck v-else /></el-icon>
      {{ tc.name }}
    </div>
    <template v-if="tc.progress < 100">
      <div class="prog-bar"><div class="prog-fill" :style="{ width: tc.progress + '%' }"></div></div>
      <div class="prog-label"><span>{{ tc.label }}</span><span>{{ tc.progress }}%</span></div>
    </template>
    <div v-else class="tc-result">{{ tc.result }}</div>
  </div>
</template>

<script setup>
import { CircleCheck, Loading } from "@element-plus/icons-vue";
defineProps({ tc: Object });
</script>

<style scoped>
.tc {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
}
.tc-head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 500;
  margin-bottom: 6px;
}
.prog-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 2px;
  overflow: hidden;
  margin: 4px 0 5px;
}
.prog-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
.prog-label { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--muted); }
.tc-result { font-size: 11.5px; color: var(--ok); }
</style>
