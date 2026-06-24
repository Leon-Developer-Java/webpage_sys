<template>
  <div class="layer-card">
    <div class="lc-header">
      <span class="lc-badge">{{ badge }}</span>
      <span class="lc-file" :title="file">{{ file || '—' }}</span>
    </div>
    <div v-if="$slots.default" class="lc-controls">
      <slot />
    </div>
    <div class="lc-legend">
      <small v-if="legendTitle">{{ legendTitle }}</small>
      <div class="lc-bar" :style="{ background: gradient }"></div>
      <ul v-if="ticks && ticks.length">
        <li v-for="t in ticks" :key="t">{{ t }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
defineProps({
  badge:       { type: String, default: "" },
  file:        { type: String, default: "" },
  legendTitle: { type: String, default: "" },
  gradient:    { type: String, default: "" },
  ticks:       { type: Array,  default: () => [] },
});
</script>

<style scoped>
.layer-card {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 5;
  width: min(240px, calc(100% - 20px));
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--glass);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
}

/* ── 标题行 ── */
.lc-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
}

.lc-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.lc-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10.5px;
  cursor: default;
}

/* ── 控件区（slot） ── */
.lc-controls {
  border-bottom: 1px solid var(--border);
}

/* ── 图例 ── */
.lc-legend {
  display: grid;
  gap: 4px;
  padding: 7px 9px;
}

.lc-legend small {
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lc-bar {
  height: 8px;
  border-radius: 4px;
}

ul {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

ul li {
  flex: 1;
  min-width: 0;
  text-align: center;
}
</style>
