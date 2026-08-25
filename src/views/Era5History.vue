<template>
  <main class="history-page" @keydown="onKeydown" tabindex="0">
    <section class="history-workspace">
      <aside class="variable-panel panel">
        <div class="panel-heading">
          <span>VARIABLES</span>
          <small>{{ variables.length }}/4</small>
        </div>
        <button
          v-for="item in variables"
          :key="item.name"
          :class="['variable-card', { active: selectedVariable === item.name }]"
          @click="selectVariable(item.name)"
        >
          <span class="variable-code">{{ item.name.toUpperCase() }}</span>
          <span class="variable-copy">
            <strong>{{ variableName(item.name, item.label) }}</strong>
            <small>{{ variableDescription(item.name) }}</small>
          </span>
          <em>{{ formatUnit(item.unit) || "—" }}</em>
        </button>

        <div class="dataset-card">
          <span>DATASET</span>
          <strong>{{ display?.dataset_id || "等待首次更新" }}</strong>
          <dl>
            <div><dt>范围</dt><dd>{{ coverageLabel }}</dd></div>
            <div><dt>空间分辨率</dt><dd>{{ resolutionLabel }}</dd></div>
            <div><dt>网格尺寸</dt><dd>{{ spatialGridSize }}</dd></div>
            <div><dt>坐标系统</dt><dd>{{ display?.spatial?.crs || "EPSG:4326" }}</dd></div>
            <div><dt>时间分辨率</dt><dd>{{ temporalIntervalLabel }}</dd></div>
            <div><dt>数据完整性</dt><dd :class="['quality-value', { complete: dataComplete }]">{{ qualityLabel }}</dd></div>
          </dl>
        </div>
      </aside>

      <section class="map-stage panel">
        <ProjMap
          :grid="true"
          :dark="true"
          :vector="false"
          basemap="矢量底图"
          projection="等经纬"
        >
          <WebglLayer
            v-if="currentImageUrl"
            :src="currentImageUrl"
            :extent="currentLayer?.extent || display?.extent"
          />
        </ProjMap>

        <div class="map-chrome map-top-left">
          <span>{{ mapCoverageLabel }}</span>
          <strong>{{ currentVariableLabel }}</strong>
        </div>
        <div class="map-chrome map-top-right">
          <span>{{ display?.temporal?.timezone || "UTC" }}</span>
          <strong>{{ currentTimeText }}</strong>
        </div>

        <div v-if="loading && !display" class="map-message">
          <div class="loader"></div>
          <strong>正在读取 ERA5 历史数据</strong>
          <span>加载最新成功日期与 24 小时图层</span>
        </div>
        <div v-else-if="error" class="map-message error-message">
          <b>!</b>
          <strong>{{ errorTitle }}</strong>
          <span>{{ error }}</span>
          <button @click="loadData">重新加载</button>
        </div>

        <div v-if="display && currentLayer" class="legend-card">
          <div><strong>{{ currentVariableLabel }}</strong><span>{{ formatUnit(currentLayer.unit) }}</span></div>
          <div class="legend-gradient"></div>
          <div class="legend-labels"><span>低</span><span>中</span><span>高</span></div>
        </div>

        <div class="map-hint">拖动平移 · 滚轮缩放 · ← → 切换时次 · Space 播放</div>
      </section>

      <aside class="detail-panel panel">
        <div class="panel-heading"><span>FRAME INFO</span><small>UTC</small></div>
        <div class="status-strip">
          <div :class="['run-state', statusTone]">
            <i></i>{{ statusLabel }}
          </div>
          <button class="icon-button" :disabled="loading" title="刷新 ERA5 数据" @click="loadData">
            <span :class="{ spinning: loading }">↻</span>
          </button>
        </div>
        <div class="frame-clock">
          <span>{{ display?.active_date || "---- -- --" }}</span>
          <strong>{{ currentHourLabel }}</strong>
          <small>{{ frameIndex + 1 }} / {{ times.length || 24 }}</small>
        </div>
        <div class="detail-list">
          <div><span>气象要素</span><strong>{{ currentVariableLabel }}</strong></div>
          <div><span>变量代码</span><strong>{{ selectedVariable.toUpperCase() || "—" }}</strong></div>
          <div><span>单位</span><strong>{{ formatUnit(currentLayer?.unit) || "—" }}</strong></div>
          <div><span>网格尺寸</span><strong>{{ gridSize }}</strong></div>
          <div><span>覆盖范围</span><strong>{{ extentLabel }}</strong></div>
        </div>

        <section class="statistics-card">
          <div class="statistics-title">
            <span>CURRENT FRAME</span>
            <small>{{ currentFrameStats ? "逐时统计" : "暂无统计" }}</small>
          </div>
          <div v-if="currentFrameStats" class="statistics-grid">
            <div><span>最小值</span><strong>{{ formatStatistic(currentFrameStats.min, currentLayer?.unit) }}</strong></div>
            <div><span>最大值</span><strong>{{ formatStatistic(currentFrameStats.max, currentLayer?.unit) }}</strong></div>
            <div><span>平均值</span><strong>{{ formatStatistic(currentFrameStats.mean, currentLayer?.unit) }}</strong></div>
            <div><span>面积加权均值</span><strong>{{ formatStatistic(currentFrameStats.area_weighted_mean, currentLayer?.unit) }}</strong></div>
            <div><span>标准差</span><strong>{{ formatStatistic(currentFrameStats.std, currentLayer?.unit) }}</strong></div>
            <div><span>缺测率</span><strong>{{ formatPercent(currentFrameStats.missing_ratio) }}</strong></div>
          </div>
          <div v-if="currentFrameStats" class="extreme-list">
            <div><span>最低值位置</span><strong>{{ formatLocation(currentFrameStats.min_location) }}</strong></div>
            <div><span>最高值位置</span><strong>{{ formatLocation(currentFrameStats.max_location) }}</strong></div>
          </div>
          <p v-else>当前数据版本未包含逐时统计，地图和时间轴仍可正常使用。</p>
        </section>

        <section class="statistics-card">
          <div class="statistics-title">
            <span>DAILY SUMMARY</span>
            <small>{{ currentDailyStats?.time_count ? `${currentDailyStats.time_count} 时次` : "暂无统计" }}</small>
          </div>
          <div v-if="currentDailyStats" class="statistics-grid">
            <div><span>当日最低</span><strong>{{ formatStatistic(currentDailyStats.min, currentLayer?.unit) }}</strong></div>
            <div><span>当日最高</span><strong>{{ formatStatistic(currentDailyStats.max, currentLayer?.unit) }}</strong></div>
            <div><span>当日平均</span><strong>{{ formatStatistic(currentDailyStats.mean, currentLayer?.unit) }}</strong></div>
            <div><span>缺测率</span><strong>{{ formatPercent(currentDailyStats.missing_ratio) }}</strong></div>
          </div>
          <div v-if="currentDailyStats" class="extreme-list">
            <div><span>最低值时刻</span><strong>{{ formatFrameTime(currentDailyStats.min_time) }}</strong></div>
            <div><span>最高值时刻</span><strong>{{ formatFrameTime(currentDailyStats.max_time) }}</strong></div>
          </div>
          <p v-else>旧版数据可能没有每日统计，重新解析的新数据会自动显示。</p>
        </section>

        <section v-if="showWindStatistics" class="statistics-card wind-card">
          <div class="statistics-title">
            <span>10M WIND SPEED</span>
            <small>{{ formatUnit(windDerived?.unit) }}</small>
          </div>
          <div v-if="currentWindStats" class="statistics-grid">
            <div><span>平均风速</span><strong>{{ formatStatistic(currentWindStats.mean, windDerived?.unit) }}</strong></div>
            <div><span>最大风速</span><strong>{{ formatStatistic(currentWindStats.max, windDerived?.unit) }}</strong></div>
            <div><span>静风区域</span><strong>{{ formatPercent(currentWindStats.calm_below_0_5_ratio) }}</strong></div>
            <div><span>强风区域</span><strong>{{ formatPercent(currentWindStats.strong_above_10_ratio) }}</strong></div>
            <div><span>大风区域</span><strong>{{ formatPercent(currentWindStats.gale_above_17_2_ratio) }}</strong></div>
          </div>
          <p v-else>当前数据版本未包含派生风速统计。</p>
        </section>
        <div class="update-card">
          <span>最近检查</span>
          <strong>{{ formatDateTime(status?.last_checked_at) }}</strong>
          <p v-if="updateError">{{ updateError }}</p>
          <p v-else-if="status?.running">{{ phaseLabel }}，本次更新完成后将自动刷新。</p>
          <p v-else-if="status?.last_error">最近一次更新失败，当前仍展示上一版成功数据。</p>
          <p v-else>当前展示最近一次完整校验并成功发布的数据。</p>
        </div>
      </aside>
    </section>

    <footer class="timeline-panel panel">
      <div class="play-controls">
        <button title="第一帧" @click="setFrame(0)">|‹</button>
        <button title="上一帧" @click="stepFrame(-1)">‹</button>
        <button class="play-button" :disabled="!times.length" @click="togglePlayback">
          {{ playing ? "Ⅱ" : "▶" }}
        </button>
        <button title="下一帧" @click="stepFrame(1)">›</button>
        <button title="最后一帧" @click="setFrame(times.length - 1)">›|</button>
      </div>

      <div class="timeline-track">
        <div class="timeline-date"><span>{{ display?.active_date || "ERA5" }}</span><small>UTC 小时</small></div>
        <div class="hour-grid">
          <button
            v-for="(time, index) in times"
            :key="time"
            :class="{ active: frameIndex === index, passed: index < frameIndex }"
            :title="formatFullTime(time)"
            @click="setFrame(index)"
          >
            <i></i><span>{{ hourOf(time) }}</span>
          </button>
        </div>
      </div>

      <div class="speed-control">
        <span>播放速度</span>
        <div>
          <button v-for="item in [0.5, 1, 2, 4]" :key="item" :class="{ active: speed === item }" @click="speed = item">
            {{ item }}×
          </button>
        </div>
      </div>
    </footer>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ProjMap from "../components/ProjMap.vue";
import WebglLayer from "../components/WebglLayer.vue";
import {
  era5HistoryAssetUrl,
  getEra5HistoryDisplay,
  getEra5HistoryStatus,
} from "../api";

const display = ref(null);
const status = ref(null);
const selectedVariable = ref("");
const frameIndex = ref(0);
const playing = ref(false);
const speed = ref(1);
const loading = ref(false);
const error = ref("");
const updateError = ref("");
let playTimer = null;
let pollTimer = null;
let lastActiveDate = "";

const variables = computed(() => display.value?.variables || []);
const times = computed(() => display.value?.times || []);
const currentLayer = computed(() => display.value?.variable_layers?.[selectedVariable.value] || null);
const currentVariable = computed(() => variables.value.find(item => item.name === selectedVariable.value));
const currentVariableLabel = computed(() => variableName(selectedVariable.value, currentVariable.value?.label));
const currentImageUrl = computed(() => era5HistoryAssetUrl(currentLayer.value?.webp_urls?.[frameIndex.value]));
const currentFrameStats = computed(() => currentLayer.value?.frame_stats?.[frameIndex.value] || null);
const currentDailyStats = computed(() => currentLayer.value?.daily_stats || null);
const windDerived = computed(() => display.value?.derived_variables?.ws10 || null);
const currentWindStats = computed(() => windDerived.value?.frame_stats?.[frameIndex.value] || null);
const showWindStatistics = computed(() => ["u10", "v10"].includes(selectedVariable.value) && windDerived.value);
const currentTimeText = computed(() => formatFullTime(times.value[frameIndex.value]));
const currentHourLabel = computed(() => times.value.length ? `${hourOf(times.value[frameIndex.value])}:00` : "--:--");
const gridSize = computed(() => currentLayer.value?.width && currentLayer.value?.height
  ? `${currentLayer.value.width} × ${currentLayer.value.height}`
  : "—");
const coverageLabel = computed(() => display.value?.spatial?.coverage === "global" ? "全球" : display.value?.spatial?.coverage || "全球");
const resolutionLabel = computed(() => {
  const spatial = display.value?.spatial;
  if (!spatial?.longitude_resolution || !spatial?.latitude_resolution) return "0.25° × 0.25°";
  return `${formatNumber(spatial.longitude_resolution, 3)}° × ${formatNumber(spatial.latitude_resolution, 3)}°`;
});
const spatialGridSize = computed(() => {
  const spatial = display.value?.spatial;
  return spatial?.width && spatial?.height ? `${spatial.width} × ${spatial.height}` : gridSize.value;
});
const temporalIntervalLabel = computed(() => {
  const interval = display.value?.temporal?.interval_hours;
  return interval ? `${interval} 小时` : "1 小时";
});
const dataComplete = computed(() => display.value?.quality_summary?.all_frames_complete ?? display.value?.temporal?.complete ?? false);
const qualityLabel = computed(() => {
  const quality = display.value?.quality_summary;
  if (!quality) return "待确认";
  const counts = `${quality.actual_time_count}/${quality.expected_time_count} · ${quality.actual_variable_count}/${quality.expected_variable_count}`;
  return quality.all_frames_complete ? `完整 · ${counts}` : `不完整 · ${counts}`;
});
const mapCoverageLabel = computed(() => `${String(display.value?.spatial?.coverage || "GLOBAL").toUpperCase()} · ${resolutionLabel.value.split(" × ")[0]}`);
const extentLabel = computed(() => {
  const extent = display.value?.spatial?.extent || display.value?.extent;
  if (!Array.isArray(extent) || extent.length !== 4) return "90°S — 90°N";
  return `${formatCoordinate(extent[0], "lon")} — ${formatCoordinate(extent[2], "lon")} · ${formatCoordinate(extent[1], "lat")} — ${formatCoordinate(extent[3], "lat")}`;
});
const errorTitle = computed(() => status.value?.display_available ? "历史图层暂时无法读取" : "暂无可展示的历史数据");
const statusTone = computed(() => status.value?.running ? "running" : status.value?.state === "error" ? "warning" : "ready");
const statusLabel = computed(() => {
  if (!status.value) return "状态读取中";
  if (status.value.running) return "数据更新中";
  if (status.value.state === "error" && status.value.display_available) return "沿用上一版";
  if (status.value.state === "error") return "更新失败";
  if (status.value.display_available) return "数据已就绪";
  return "等待首次更新";
});
const phaseLabel = computed(() => ({
  probing: "正在探测最新日期",
  downloading: "正在下载数据",
  preparing: "正在准备 NetCDF",
  parsing: "正在生成图层",
  validating: "正在校验完整性",
  promoting: "正在发布数据",
  cleanup: "正在清理旧数据",
})[status.value?.current_phase] || "正在更新数据");

async function loadData() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    status.value = await getEra5HistoryStatus();
    try {
      const nextDisplay = await getEra5HistoryDisplay({ fresh: true });
      display.value = nextDisplay;
      lastActiveDate = nextDisplay.active_date;
      const available = nextDisplay.variables?.map(item => item.name) || [];
      if (!available.includes(selectedVariable.value)) {
        selectedVariable.value = nextDisplay.default_variable || available[0] || "";
      }
      frameIndex.value = Math.min(frameIndex.value, Math.max(0, (nextDisplay.times?.length || 1) - 1));
      await nextTick();
      preloadNearby();
    } catch (displayError) {
      if (displayError.status !== 404 || !display.value) throw displayError;
      error.value = "后端尚未完成第一次 ERA5 历史数据更新。完成更新后刷新本页即可展示。";
    }
  } catch (requestError) {
    error.value = requestError.message || "无法连接 ERA5 历史数据服务。";
  } finally {
    loading.value = false;
  }
}

async function pollStatus() {
  try {
    const nextStatus = await getEra5HistoryStatus({ fresh: true });
    const wasRunning = status.value?.running;
    status.value = nextStatus;
    if ((wasRunning && !nextStatus.running) || (nextStatus.active_date && nextStatus.active_date !== lastActiveDate)) {
      await loadData();
    }
  } catch {
    // Polling failures do not replace an already visible frame with an error.
  }
}

function selectVariable(name) {
  selectedVariable.value = name;
  preloadNearby();
}

function setFrame(index) {
  if (!times.value.length) return;
  frameIndex.value = Math.max(0, Math.min(Number(index) || 0, times.value.length - 1));
  preloadNearby();
}

function stepFrame(delta) {
  if (!times.value.length) return;
  setFrame((frameIndex.value + delta + times.value.length) % times.value.length);
}

function togglePlayback() {
  playing.value = !playing.value;
}

function restartPlayback() {
  clearInterval(playTimer);
  playTimer = null;
  if (!playing.value || !times.value.length) return;
  playTimer = setInterval(() => stepFrame(1), Math.max(160, 1000 / speed.value));
}

function preloadNearby() {
  const urls = currentLayer.value?.webp_urls || [];
  for (const offset of [-2, -1, 1, 2]) {
    if (!urls.length) break;
    const index = (frameIndex.value + offset + urls.length) % urls.length;
    const image = new Image();
    image.src = era5HistoryAssetUrl(urls[index]);
  }
}

function onKeydown(event) {
  if (event.target?.matches?.("button, a, input, select")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "ArrowLeft") {
    stepFrame(-1);
  } else if (event.key === "ArrowRight") {
    stepFrame(1);
  }
}

function hourOf(value) {
  const match = String(value || "").match(/T(\d{2})/);
  return match?.[1] || "--";
}

function formatFullTime(value) {
  if (!value) return "--";
  return `${String(value).slice(0, 10)} ${hourOf(value)}:00`;
}

function formatDateTime(value) {
  if (!value) return "尚未检查";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function formatUnit(value) {
  const unit = String(value || "").trim();
  if (unit.toLowerCase() === "m s**-1" || unit.toLowerCase() === "m s-1") return "m/s";
  return unit;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatStatistic(value, unit) {
  const formatted = formatNumber(value);
  return formatted === "—" ? formatted : `${formatted} ${formatUnit(unit)}`.trim();
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${formatNumber(Number(value) * 100, 2)}%`;
}

function formatCoordinate(value, axis) {
  if (!Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (number === 0) return "0°";
  const suffix = axis === "lat" ? (number > 0 ? "N" : "S") : (number > 0 ? "E" : "W");
  return `${formatNumber(Math.abs(number), 2)}°${suffix}`;
}

function formatLocation(location) {
  if (!location) return "—";
  return `${formatCoordinate(location.longitude, "lon")}, ${formatCoordinate(location.latitude, "lat")}`;
}

function formatFrameTime(value) {
  if (!value) return "—";
  return `${hourOf(value)}:00 UTC`;
}

function variableName(name, fallback) {
  return ({ t2m: "2 米气温", sp: "地表气压", u10: "10 米纬向风", v10: "10 米经向风" })[name] || fallback || name || "ERA5";
}

function variableDescription(name) {
  return ({
    t2m: "近地面空气温度",
    sp: "地表大气压力",
    u10: "东西方向风速分量",
    v10: "南北方向风速分量",
  })[name] || "历史再分析变量";
}

watch([playing, speed], restartPlayback);
watch(selectedVariable, preloadNearby);

onMounted(() => {
  void loadData();
  pollTimer = setInterval(pollStatus, 15000);
});

onBeforeUnmount(() => {
  clearInterval(playTimer);
  clearInterval(pollTimer);
});
</script>

<style scoped>
.history-page {
  --panel: var(--glass);
  --line: var(--border);
  --cyan: var(--accent);
  --cyan-soft: var(--accent-soft);
  --blue: #5c91ff;
  --text-main: var(--text);
  --text-dim: var(--muted);
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 112px;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
  outline: none;
  color: var(--text-main);
  background: transparent;
}

.panel {
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
}
.run-state { display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 11px; border: 1px solid var(--line); border-radius: 8px; color: var(--text-dim); font-size: 11px; }
.run-state i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.run-state.ready { color: #48d9a1; }
.run-state.running { color: #55b8ff; }
.run-state.warning { color: #ffbd66; }
.icon-button { height: 32px; border: 1px solid var(--line); border-radius: 8px; color: var(--text-main); background: rgba(255,255,255,.035); }
.icon-button { width: 34px; cursor: pointer; font-size: 20px; }
.icon-button:disabled { opacity: .5; }
.spinning { display: inline-block; animation: spin .8s linear infinite; }

.history-workspace { display: grid; grid-template-columns: 218px minmax(0, 1fr) 218px; gap: 10px; min-height: 0; }
.variable-panel, .detail-panel { border-radius: 12px; padding: 14px; overflow: auto; scrollbar-width: thin; }
.detail-panel { display: flex; flex-direction: column; }
.panel-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--text-dim); font: 700 10px/1 ui-monospace, monospace; letter-spacing: 1.5px; }
.panel-heading small { color: var(--cyan); }
.status-strip { display: flex; align-items: center; gap: 7px; }
.status-strip .run-state { flex: 1; min-width: 0; justify-content: center; padding: 0 7px; white-space: nowrap; }
.status-strip .icon-button { flex-shrink: 0; }
.variable-card { width: 100%; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 9px; align-items: center; margin-bottom: 7px; padding: 10px; border: 1px solid transparent; border-radius: 9px; color: var(--text-main); background: rgba(255,255,255,.025); text-align: left; cursor: pointer; transition: .18s ease; }
.variable-card:hover { background: rgba(255,255,255,.045); border-color: var(--line); }
.variable-card.active { border-color: rgba(59,216,208,.38); background: var(--cyan-soft); box-shadow: inset 2px 0 var(--cyan); }
.variable-code { color: var(--cyan); font: 750 11px/1 ui-monospace, monospace; }
.variable-copy { min-width: 0; }
.variable-copy strong, .variable-copy small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.variable-copy strong { font-size: 12px; font-weight: 600; }
.variable-copy small { margin-top: 4px; color: var(--text-dim); font-size: 9px; }
.variable-card em { color: var(--text-dim); font: normal 9px/1 ui-monospace, monospace; }
.dataset-card, .update-card { margin-top: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; background: rgba(0,0,0,.13); }
.dataset-card > span, .update-card > span { color: var(--text-dim); font: 700 9px/1 ui-monospace, monospace; letter-spacing: 1px; }
.dataset-card > strong { display: block; margin: 8px 0 11px; overflow-wrap: anywhere; color: #b9ccd9; font: 500 9px/1.45 ui-monospace, monospace; }
.dataset-card dl { margin: 0; }
.dataset-card dl div { display: flex; justify-content: space-between; padding: 6px 0; border-top: 1px solid var(--line); font-size: 9px; }
.dataset-card dt { color: var(--text-dim); }
.dataset-card dd { margin: 0; }
.quality-value.complete { color: #48d9a1; }

.map-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; border-radius: 12px; background: #071a2b; }
.map-stage :deep(.projmap) { position: absolute; inset: 0; }
.map-chrome { position: absolute; z-index: 4; top: 14px; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: rgba(5,14,23,.76); backdrop-filter: blur(10px); pointer-events: none; }
.map-top-left { left: 14px; }
.map-top-right { right: 14px; text-align: right; }
.map-chrome span { color: var(--cyan); font: 650 8px/1 ui-monospace, monospace; letter-spacing: 1px; }
.map-chrome strong { font-size: 12px; }
.legend-card { position: absolute; z-index: 4; right: 14px; bottom: 35px; width: 190px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: rgba(5,14,23,.8); backdrop-filter: blur(10px); }
.legend-card > div:first-child { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 10px; }
.legend-card span { color: var(--text-dim); }
.legend-gradient { height: 8px; border-radius: 4px; background: linear-gradient(90deg, #253b9f, #208bd2, #33c5ad, #f2d95c, #eb6b39, #a81d3d); }
.legend-labels { display: flex; justify-content: space-between; margin-top: 4px; font-size: 8px; }
.map-hint { position: absolute; z-index: 4; left: 50%; bottom: 12px; transform: translateX(-50%); color: rgba(220,238,248,.5); font-size: 9px; pointer-events: none; white-space: nowrap; }
.map-message { position: absolute; z-index: 8; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: rgba(5,14,23,.84); text-align: center; }
.map-message strong { font-size: 14px; }
.map-message span { max-width: 390px; color: var(--text-dim); font-size: 11px; line-height: 1.6; }
.map-message button { margin-top: 5px; padding: 7px 14px; border: 1px solid rgba(59,216,208,.35); border-radius: 7px; color: var(--cyan); background: var(--cyan-soft); cursor: pointer; }
.error-message b { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid rgba(255,189,102,.5); border-radius: 50%; color: #ffbd66; }
.loader { width: 28px; height: 28px; border: 2px solid rgba(59,216,208,.16); border-top-color: var(--cyan); border-radius: 50%; animation: spin .8s linear infinite; }

.frame-clock { padding: 14px 0 18px; border-bottom: 1px solid var(--line); text-align: center; }
.frame-clock span, .frame-clock small { display: block; color: var(--text-dim); font: 550 9px/1 ui-monospace, monospace; letter-spacing: 1px; }
.frame-clock strong { display: block; margin: 8px 0; color: var(--cyan); font: 300 36px/1 ui-monospace, monospace; }
.detail-list { padding: 8px 0; }
.detail-list div { padding: 8px 0; border-bottom: 1px solid rgba(143,184,211,.09); }
.detail-list span, .detail-list strong { display: block; }
.detail-list span { color: var(--text-dim); font-size: 9px; }
.detail-list strong { margin-top: 4px; font-size: 11px; font-weight: 550; }
.statistics-card { margin-top: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 9px; background: rgba(0,0,0,.13); }
.statistics-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.statistics-title span { color: var(--cyan); font: 700 9px/1 ui-monospace, monospace; letter-spacing: .8px; }
.statistics-title small { color: var(--text-dim); font-size: 8px; }
.statistics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.statistics-grid div { min-width: 0; padding: 7px; border-radius: 6px; background: rgba(255,255,255,.025); }
.statistics-grid span, .statistics-grid strong { display: block; }
.statistics-grid span { color: var(--text-dim); font-size: 8px; }
.statistics-grid strong { margin-top: 4px; overflow: hidden; color: var(--text-main); font: 600 9px/1.25 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.extreme-list { margin-top: 6px; }
.extreme-list div { display: flex; justify-content: space-between; gap: 7px; padding: 5px 1px; border-top: 1px solid rgba(143,184,211,.09); font-size: 8px; }
.extreme-list span { color: var(--text-dim); }
.extreme-list strong { font-weight: 550; text-align: right; }
.statistics-card p { margin: 0; color: var(--text-dim); font-size: 8px; line-height: 1.55; }
.wind-card { border-color: rgba(85,184,255,.24); }
.update-card { margin-top: auto; }
.update-card strong { display: block; margin-top: 7px; font: 550 10px/1.4 ui-monospace, monospace; }
.update-card p { margin: 8px 0 0; color: var(--text-dim); font-size: 9px; line-height: 1.55; }

.timeline-panel { display: grid; grid-template-columns: 190px minmax(0, 1fr) 190px; align-items: center; gap: 18px; min-width: 0; padding: 14px 18px; border-radius: 12px; }
.play-controls { display: flex; align-items: center; gap: 5px; }
.play-controls button, .speed-control button { border: 1px solid var(--line); color: var(--text-dim); background: rgba(255,255,255,.025); cursor: pointer; }
.play-controls button { width: 28px; height: 28px; border-radius: 7px; }
.play-controls button:hover, .speed-control button:hover { color: var(--cyan); }
.play-controls .play-button { width: 38px; height: 38px; border-color: rgba(59,216,208,.4); color: #07111c; background: var(--cyan); font-size: 13px; }
.timeline-track { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; }
.timeline-date span, .timeline-date small { display: block; }
.timeline-date span { font: 650 11px/1 ui-monospace, monospace; }
.timeline-date small { margin-top: 6px; color: var(--text-dim); font-size: 9px; }
.hour-grid { position: relative; display: grid; grid-template-columns: repeat(24, minmax(12px, 1fr)); min-width: 0; }
.hour-grid::before { content: ""; position: absolute; left: 1%; right: 1%; top: 8px; height: 1px; background: var(--line); }
.hour-grid button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 0; border: 0; color: var(--text-dim); background: transparent; cursor: pointer; font: 500 8px/1 ui-monospace, monospace; }
.hour-grid i { z-index: 1; width: 7px; height: 7px; border: 1px solid #527086; border-radius: 50%; background: #0a1826; }
.hour-grid button.passed i { border-color: var(--cyan); background: rgba(59,216,208,.45); }
.hour-grid button.active { color: var(--cyan); }
.hour-grid button.active i { width: 11px; height: 11px; margin-top: -2px; border: 2px solid #d9fffd; background: var(--cyan); box-shadow: 0 0 11px var(--cyan); }
.speed-control { justify-self: end; }
.speed-control > span { display: block; margin-bottom: 7px; color: var(--text-dim); font-size: 9px; text-align: right; }
.speed-control div { display: flex; gap: 4px; }
.speed-control button { min-width: 34px; height: 25px; border-radius: 6px; font: 600 9px/1 ui-monospace, monospace; }
.speed-control button.active { color: var(--cyan); border-color: rgba(59,216,208,.45); background: var(--cyan-soft); }

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1050px) {
  .history-workspace { grid-template-columns: 190px minmax(0, 1fr); }
  .detail-panel { display: none; }
  .timeline-panel { grid-template-columns: 170px minmax(0, 1fr); }
  .speed-control { display: none; }
}

@media (max-width: 720px) {
  .history-page { grid-template-rows: minmax(0, 1fr) 118px; padding: 6px; gap: 6px; }
  .history-workspace { grid-template-columns: 1fr; }
  .variable-panel { position: absolute; z-index: 12; left: 12px; top: 12px; width: 164px; padding: 8px; background: rgba(7,17,28,.9); }
  .panel-heading, .dataset-card, .variable-copy small, .variable-card em { display: none; }
  .variable-card { grid-template-columns: 34px 1fr; padding: 7px; margin-bottom: 3px; }
  .timeline-panel { grid-template-columns: 1fr; padding: 9px; }
  .play-controls { justify-content: center; }
  .timeline-track { grid-template-columns: 1fr; }
  .timeline-date { display: none; }
  .hour-grid button span { display: none; }
  .legend-card { width: 150px; }
  .map-hint { display: none; }
}
</style>
