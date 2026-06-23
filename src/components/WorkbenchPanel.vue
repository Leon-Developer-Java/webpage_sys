<template>
  <aside class="workbench glass">
    <h3>工作台</h3>
    <button v-for="cmd in commands" :key="cmd" type="button" @click="emit('cmd', cmd)">
      {{ cmd }}
    </button>
  </aside>
</template>

<script setup>
const emit = defineEmits(["cmd"]);

const commands = [
  "/查询数据",
  "/调用模型",
  "/生成图表",
  "/生成报告",
];
</script>

<style scoped>
.workbench {
  width: 220px;
  flex-shrink: 0;
  padding: 14px;
  overflow: auto;
}

h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

button {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--field);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
