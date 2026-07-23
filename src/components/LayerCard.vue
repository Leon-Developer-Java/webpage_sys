<template>
  <div class="layer-card" :class="{ collapsed }">
    <div class="lc-body">
      <div class="lc-header">
        <span class="lc-badge">{{ badge }}</span>
        <span class="lc-file" :title="file">{{ file || '—' }}</span>
      </div>

      <!-- 信息区 -->
      <div v-if="$slots.default" class="lc-controls">
        <slot />
      </div>
      <div v-if="layerCardFilters?.filters?.length" class="lc-resource-filters">
        <label v-for="filter in layerCardFilters.filters" :key="filter.key">
          <span>{{ filter.label }}</span>
          <el-select v-model="layerCardFilters.values[filter.key]" size="small" clearable filterable placeholder="全部">
            <el-option v-for="option in filter.options" :key="option" :label="option" :value="option" />
          </el-select>
        </label>
      </div>
      <div v-if="showLegend" class="lc-legend">
        <small v-if="legendTitle">{{ legendTitle }}</small>
        <div class="lc-bar" :style="{ background: gradient }"></div>
        <ul v-if="ticks && ticks.length">
          <li v-for="t in ticks" :key="t">{{ t }}</li>
        </ul>
      </div>

      <!-- 工具区 -->
      <div v-if="controls" class="lc-tools">
        <button title="放大" @click="controls.zoomIn()"><el-icon><Plus /></el-icon></button>
        <button title="缩小" @click="controls.zoomOut()"><el-icon><Minus /></el-icon></button>
        <button title="复位" @click="controls.home()"><el-icon><Aim /></el-icon></button>
        <button title="全屏" @click="controls.full()"><el-icon><FullScreen /></el-icon></button>
      </div>
    </div>

    <!-- 右侧中部的收起/展开把手 -->
    <button class="lc-tab" :title="collapsed ? '展开图层面板' : '收起图层面板'" @click="collapsed = !collapsed">
      <span class="lc-tab-caret">{{ collapsed ? '▶' : '◀' }}</span>
    </button>
  </div>
</template>

<script setup>
import { inject, ref } from "vue";
import { Aim, FullScreen, Minus, Plus } from "@element-plus/icons-vue";

const props = defineProps({
  badge:       { type: String, default: "" },
  file:        { type: String, default: "" },
  legendTitle: { type: String, default: "" },
  gradient:    { type: String, default: "" },
  ticks:       { type: Array,  default: () => [] },
  showLegend:  { type: Boolean, default: true },
  initialCollapsed: { type: Boolean, default: true },
});

const collapsed = ref(props.initialCollapsed);
const controls = inject("mapControls", null);
const layerCardFilters = inject("layerCardFilters", null);
</script>

<style scoped>
/* 定位容器：负责贴左、下移、滑入滑出动画；把手可以溢出到右侧 */
.layer-card {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}

.layer-card.collapsed {
}

/* 卡片主体：玻璃质感 + 左侧直角，内容裁切 */
.lc-body {
  position: absolute;
  top: 50%;
  left: 0;
  width: min(240px, calc(100% - 10px));
  max-height: calc(100% - 16px);
  display: block;
  transform: translateY(-50%);
  transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 10px 10px 0;
  background: var(--glass);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  font-size: 11px;
  color: var(--text);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  pointer-events: auto;
}

.layer-card.collapsed .lc-body {
  transform: translate(-100%, -50%);
}

.lc-body::-webkit-scrollbar {
  display: none;
}

/* ── 右侧中部把手（突出、强调色） ── */
.lc-tab {
  position: absolute;
  left: min(240px, calc(100% - 10px));
  /* 把手居中于卡片：卡片中心又对齐底图中线，所以把手始终在正中且固定 */
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 17px;
  height: 50px;
  padding: 0;
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 9px 9px 0;
  background: var(--glass);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  color: var(--muted);
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: color 0.15s, left 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
  pointer-events: auto;
}

.layer-card.collapsed .lc-tab {
  left: 0;
}

.lc-tab:hover { color: var(--accent); }

.lc-tab-caret {
  font-size: 11px;
  line-height: 1;
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
  position: absolute;
  top: 8px;
  right: 9px;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  pointer-events: auto;
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

.lc-resource-filters {
  display: grid;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
}

.lc-resource-filters label {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.lc-resource-filters label > span {
  color: var(--muted);
  font-size: 10px;
}

.lc-resource-filters :deep(.el-select) {
  width: 100%;
}

.lc-resource-filters :deep(.el-select__wrapper) {
  min-height: 24px;
  background: var(--field);
  box-shadow: 0 0 0 1px var(--border) inset;
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

/* ── 工具区（与信息区用上边框区分） ── */
.lc-tools {
  display: flex;
  gap: 5px;
  padding: 7px 9px;
  border-top: 1px solid var(--border);
  background: var(--field);
}

.lc-tools button {
  flex: 1;
  display: grid;
  place-items: center;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--glass);
  color: var(--text);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.lc-tools button:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.lc-tools button.on {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.lc-tools .el-icon {
  font-size: 15px;
}

.lc-dim {
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
}
</style>
