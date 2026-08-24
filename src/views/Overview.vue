<template>
  <div class="ov">
    <aside class="rail glass">
      <button :class="{ on: dockOpen && tool === 'select' }" @click="openTool('select')"><el-icon><Collection /></el-icon><span>数据源</span></button>
      <button :class="{ on: propsOpen }" @click="propsOpen = !propsOpen"><el-icon><Document /></el-icon><span>信息</span></button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')"><el-icon><Position /></el-icon><span>投影</span></button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')"><el-icon><MapLocation /></el-icon><span>底图</span></button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid"><el-icon><Grid /></el-icon><span>经纬网</span></button>
      <button :class="{ on: showVector }" @click="toggleVector"><b class="dim-icon">界</b><span>边界</span></button>
      <button v-if="showVector" @click="mapDark = !mapDark">
        <el-icon><Sunny v-if="mapDark" /><Moon v-else /></el-icon>
        <span>{{ mapDark ? '亮' : '暗' }}</span>
      </button>
      <button @click="cycleLayout">
        <el-icon><Monitor v-if="layout === '1'" /><Operation v-else-if="layout === '2'" /><Grid v-else /></el-icon>
        <span>{{ { '1': '单屏', '2': '双屏', '4': '四屏' }[layout] }}</span>
      </button>
      <button v-if="layout !== '1'" :class="{ on: linked }" @click="linked = !linked">
        <el-icon><Connection /></el-icon><span>联动</span>
      </button>
    </aside>

    <section v-if="dockOpen" class="dock glass">
      <div class="dock-head"><h3>{{ dockTitle }}</h3><el-icon @click="dockOpen = false"><Close /></el-icon></div>

      <template v-if="tool === 'select'">
        <div class="resource-filter">
          <label class="filter-label">数据类型</label>
          <div class="data-type-grid">
            <button
              v-for="source in sources"
              :key="source.key"
              type="button"
              :class="{ on: catalogSourceKey === source.key }"
              :disabled="switching && catalogSourceKey !== source.key"
              @click="selectCatalogSource(source.key)"
            >{{ source.btn }}</button>
          </div>

          <div class="time-filter-row">
            <label class="filter-field">
              <span class="filter-label">开始时间</span>
              <el-date-picker
                v-model="resourceStartTime"
                class="resource-time"
                type="datetime"
                size="small"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="选择开始"
                :clearable="true"
                @change="onResourceStartChange"
              />
            </label>
            <label class="filter-field">
              <span class="filter-label">结束时间</span>
              <el-date-picker
                v-model="resourceEndTime"
                class="resource-time"
                type="datetime"
                size="small"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="选择结束"
                :disabled="!resourceStartTime"
                :disabled-date="disableResourceEndDate"
                :clearable="true"
                @change="onResourceEndChange"
              />
            </label>
          </div>

        </div>

        <div class="resource-head">
          <span>{{ resourceListLabel }} · {{ filteredDataResources.length }}</span>
          <button type="button" title="刷新数据" :disabled="resourcesLoading" @click="refreshDataResources">
            <el-icon :class="{ rotating: resourcesLoading }"><RefreshRight /></el-icon>
          </button>
        </div>
        <div class="resource-results">
          <p v-if="resourcesError" class="resource-state error">{{ resourcesError }}</p>
          <p v-else-if="resourcesLoading && !dataResources.length" class="resource-state">正在读取数据...</p>
          <p v-else-if="!dataResources.length" class="resource-state">暂无已解析数据</p>
          <p v-else-if="!filteredDataResources.length" class="resource-state">当前条件下暂无数据</p>
          <ul v-else class="resource-list">
            <li
              v-for="item in filteredDataResources"
              :key="item.file_uuid"
              :class="{ sel: catalogSelectedResourceUuid === item.file_uuid }"
              @click="selectDataResource(item)"
            >
              <div class="resource-title">
                <b :title="item.file_name">{{ item.file_name }}</b>
                <span :class="['continuity', { gap: !item.continuous }]">{{ resourceStatus(item) }}</span>
              </div>
              <span>{{ resourceTimeRange(item) }}</span>
              <span>{{ formatFileSize(item.file_size) }} · {{ item.elements.length }} 个要素</span>
            </li>
          </ul>
        </div>
      </template>

      <template v-else-if="tool === 'proj'">
        <p class="pick-hint">选择地图投影方式</p>
        <div class="picker">
          <button
            v-for="p in projections" :key="p"
            :class="{ on: projection === p }"
            @click="projection = p"
          >
            <span>{{ p }}</span>
            <el-icon v-if="projection === p"><Check /></el-icon>
          </button>
        </div>
      </template>

      <template v-else>
        <p class="pick-hint">选择底图图层（实时切换）</p>
        <div class="picker">
          <button v-for="b in basemaps" :key="b" :class="{ on: basemap === b }" @click="basemap = b">
            <span>{{ b }}</span><el-icon v-if="basemap === b"><Check /></el-icon>
          </button>
        </div>
      </template>
    </section>

    <div class="center">
      <div class="maps" :style="mapsGrid">
        <div
          :class="['cell', { 'cell-4': layout === '4', sel: layout !== '1' && selectedPane === i }]"
          v-for="(p, i) in panes" :key="layout + '-' + i"
          @pointerdown="onPaneDown"
          @click="onPaneClick(i, $event)"
        >
          <span class="cell-tag">{{ paneLabels[i] || p.btn }}</span>
          <span v-if="layout !== '1' && selectedPane === i" class="cell-sel-tag"><i></i>SELECTED</span>
          <ProjMap
            :grid="showGrid"
            :dark="mapDark"
            :vector="showVector"
            :basemap="basemap"
            :projection="projection"
            :sync-view="linked && emitterIdx !== i ? syncView : null"
            @view-change="v => onViewChange(i, v)"
          >
            <component
              :key="`${layout}-${i}-${p.key}-${p.variantIndex}-${resourceRenderKey(p.key, i)}`"
              :is="p.comp"
              :parsed="layerParsed(p.key, i)"
              :time-index="layerTimeIndex"
              :variant-index="p.variantIndex"
              v-bind="layerProps(p.key)"
              @display-loaded="payload => onLayerDisplayLoaded(i, p.key, payload)"
              @display-error="message => onLayerDisplayError(i, p.key, message)"
              @variable-change="payload => onLayerVariableChange(i, p.key, payload)"
            />
          </ProjMap>
        </div>
      </div>

      <div class="timebar glass">
        <div class="tb-head">
          <button class="tc-btn" @click="setTimeIndex(0)"><el-icon><DArrowLeft /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(Math.max(0, tIndex - 1))"><el-icon><ArrowLeft /></el-icon></button>
          <button class="tc-play" :disabled="playingPreparing" @click="togglePlaying"><el-icon><Loading v-if="playingPreparing" class="is-loading" /><VideoPause v-else-if="playing" /><VideoPlay v-else /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(Math.min(axisTimes.length - 1, tIndex + 1))"><el-icon><ArrowRight /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(axisTimes.length - 1)"><el-icon><DArrowRight /></el-icon></button>
          <div class="tc-speed">
            <button v-for="s in [0.5, 1, 2, 4]" :key="s" :class="{ on: speed === s }" @click="speed = s">{{ s }}x</button>
          </div>
          <span class="tc-time">{{ activeTimeLabel }}</span>
        </div>
        <TimeAxis
          :key="timeAxisKey"
          :times="axisTimes"
          :active="animPos"
          :tick-mode="usesCompactTimeAxis ? 'all' : 'sampled'"
          :compact-labels="usesCompactTimeAxis"
          @update:active="v => setTimeIndex(v)"
          :dark="dark"
        />
      </div>
    </div>

    <MetaPanel
      v-if="propsOpen"
      :meta="meta"
      :steps="processing"
      :himawari-status="active === 'himawari' ? himawariStatus : null"
      closable
      @close="propsOpen = false"
    >
      <div class="version">
        <h4>MVP 当前版本</h4>
        <p v-for="v in versions" :key="v"><el-icon class="ok"><CircleCheck /></el-icon>{{ v }}</p>
      </div>
    </MetaPanel>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { ElNotification } from "element-plus";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Close, Collection, Connection, DArrowLeft, DArrowRight, DataAnalysis, Document, FolderOpened, Grid, Loading, MapLocation, Monitor, Moon, Operation, Position, RefreshRight, Sunny, VideoPlay, VideoPause } from "@element-plus/icons-vue";
import {
  getDisplayResource,
  getDisplayResources,
  getHimawariAutoStatus,
  parseFile,
  startSatelliteParseTask,
  uploadRawFiles,
  waitForSatelliteParseTask,
} from "../api";
import { preloadFrames } from "../utils/frameImageCache";
import ProjMap from "../components/ProjMap.vue";
import MetaPanel from "../components/MetaPanel.vue";
import TimeAxis from "../components/TimeAxis.vue";
import Era5Layer from "../layers/Era5Layer.vue";
import GribLayer from "../layers/GribLayer.vue";
import CmaLayer from "../layers/CmaLayer.vue";
import RadarLayer from "../layers/RadarWebpLayer.vue";
import HimawariLayer from "../layers/HimawariLayer.vue";
import FY3Layer from "../layers/FY3Layer.vue";
import WrfLayer from "../layers/WrfLayer.vue";

const dark = inject("theme");

const sources = [
  {key: "gfs", btn: "GFS", comp: GribLayer, dataType: "GFS"},
  {key: "ecmwf", btn: "ECMWF", comp: GribLayer, dataType: "ECMWF"},
  {key: "cma", btn: "CMA", comp: CmaLayer},
  {key: "radar", btn: "雷达", comp: RadarLayer},
  {key: "himawari", btn: "Himawari", comp: HimawariLayer},
  {key: "fy3", btn: "FY-3", comp: FY3Layer},
  {key: "wrf", btn: "WRF", comp: WrfLayer},
  {key: "era5", btn: "ERA5", comp: Era5Layer}
];

const attributeLabels = {
  levels: "层次",
  level_types: "层次类型",
  resolutions: "分辨率",
  datasets: "数据集",
  product_types: "产品类型",
  product_names: "产品名称",
  data_streams: "数据流",
  step_types: "步长类型",
  grid_types: "网格类型",
  run_times: "起报时间",
  cycle_hours: "起报时次",
  forecast_hours: "预报时效",
  product_categories: "产品类别",
  streams: "数据流",
  product_classes: "产品级别",
  radar_names: "雷达名称",
  station_codes: "站号",
  radar_types: "雷达类型",
  product_codes: "产品代码",
  elevations: "仰角",
  domains: "计算区域",
  forecast_reference_times: "预报基准时间",
  source_resolutions: "源分辨率",
  satellites: "卫星",
  instruments: "仪器",
  bands: "波段",
  file_roles: "文件角色",
  regions: "区域",
};

const typeAttributeOrder = {
  era5: ["levels", "level_types", "resolutions", "product_types", "data_streams", "step_types", "grid_types", "datasets"],
  gfs: ["levels", "level_types", "resolutions", "run_times", "cycle_hours", "forecast_hours", "step_types", "product_categories", "datasets"],
  ecmwf: ["levels", "level_types", "resolutions", "run_times", "cycle_hours", "forecast_hours", "step_types", "streams", "product_classes", "datasets"],
  cma: ["levels", "level_types", "resolutions", "product_types", "product_names", "datasets"],
  radar: ["levels", "resolutions", "radar_names", "station_codes", "radar_types", "product_codes", "elevations", "datasets"],
  wrf: ["levels", "resolutions", "domains", "forecast_reference_times", "forecast_hours", "source_resolutions", "datasets"],
  fy3: ["resolutions", "satellites", "instruments", "bands", "source_resolutions", "file_roles", "datasets"],
  himawari: ["resolutions", "satellites", "regions", "bands", "datasets"],
};

const infos = {
  radar: { file: "radar_xh_20250616_1000.cinrad", element: "组合反射率 DBZH、径向速度、谱宽", time: "2025-06-16 10:00", level: "0.5° 仰角", range: "73°E-135°E, 15°N-55°N", grid: "721 × 361", missing: "-9999", unit: "dBZ / m·s⁻¹", vars: "3", steps: "24" },
  himawari: { file: "himawari_20250616_1000.hsd", element: "B01-B16 全通道、真彩色合成", time: "2025-06-16 10:00", level: "全圆盘 / 区域", range: "80°E-160°E, 0°N-60°N", grid: "5500 × 5500", missing: "-9999", unit: "°C / %", vars: "16", steps: "25" },
  fy3: { file: "FY3D_MERSI_GBAL_L1_20260701_0055_1000M_MS.HDF", element: "MERSI-II 25 波段", time: "2026-07-01 08:55", level: "极轨卫星观测", range: "按实际轨迹自动映射", grid: "随轨迹变化", missing: "NaN", unit: "% / K", vars: "25", steps: "12" },
  era5: { file: "era5_t2m_20250616.nc", element: "2m 温度、位势、风场", time: "2025-06-16 09:00", level: "2m / 1000-200hPa", range: "73°E-135°E, 15°N-55°N", grid: "248 × 161", missing: "NaN", unit: "°C", vars: "5", steps: "24" },
  grib: { file: "gfs.t00z.pgrb2.0p25.f006", element: "500hPa 位势高度、温度", time: "2025-06-16 08:00", level: "500hPa / 850hPa", range: "73°E-135°E, 15°N-55°N", grid: "249 × 161", missing: "9999", unit: "gpm", vars: "8", steps: "40" },
  cma: { file: "cma_meso_20250616.grib2", element: "2m 温度、降水", time: "2025-06-16 08:00", level: "地面 / 多层", range: "70°E-140°E, 10°N-60°N", grid: "1025 × 801", missing: "9999", unit: "°C / mm", vars: "6", steps: "24" },
  wrf: { file: "wrf_radar_20250616.nc", element: "雷达反射率 (NC)", time: "2025-06-16 10:00", level: "多仰角", range: "73°E-135°E, 15°N-55°N", grid: "460 × 460", missing: "-9999", unit: "dBZ", vars: "2", steps: "12" }
};

const defaultProcessing = [
  {step: "下载", state: "成功", t: "06-16 09:58", ok: true},
  {step: "解析", state: "成功", t: "06-16 09:59", ok: true},
  {step: "渲染 WEBP", state: "成功", t: "06-16 10:02", ok: true},
  {step: "前端展示", state: "服务中", t: "200 ms", ok: false}
];

const versions = ["文件存储：原始数据 + meta.json + WEBP", "前端渲染：GFS/ECMWF 独立入口 + WEBP 优先显示", "数据处理：后端完成、前端轻展示"];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];
const defaultTimes = ["00时", "02时", "04时", "06时", "08时", "10时", "12时", "14时", "16时", "18时", "20时", "22时"];

function isGribLayerKey(key) {
  return key === "gfs" || key === "ecmwf";
}

function sourceFallbackInfo(key) {
  return infos[key] || (isGribLayerKey(key) ? infos.grib : {});
}

const tool = ref("select");
const dockOpen = ref(false);
const showGrid = ref(true);
const layout = ref("1");
const propsOpen = ref(true);
const active = ref("radar");
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const tIndex = ref(0);
const parsed = ref(null);
const parsedLayerKey = ref(null);
const parseProcessing = ref(null);
const dataResources = ref([]);
const selectedResource = ref(null);
const selectedResourceUuid = ref("");
const resourcesLoading = ref(false);
const resourcesError = ref("");
const resourceStartTime = ref("");
const resourceEndTime = ref("");
const attributeFilters = ref({});
const layerDisplays = ref({});
const layerRefreshKeys = ref({himawari: 0, fy3: 0});
const himawariStatus = ref(null);
let himawariStatusTimer = null;
const focusedFY3SceneId = ref("");
const fy3FocusApplied = ref(false);
const pendingHimawariSceneId = ref("");
const layerResolutions = ref({cma: "native", fy3: "original", himawari: "original"});
const himawariTimeline = ref([]);
const playing = ref(false);
const playingPreparing = ref(false);
const speed = ref(1);
const animPos = ref(tIndex.value);
const cmaPlaybackWaiting = ref(false);
const linked = ref(false);
const syncView = ref(null);
const showVector = ref(false);
const mapDark = ref(dark.value);
const emitterIdx = ref(-1);
const switching = ref(false);
const paneLabels = ref({});
const selectedPane = ref(-1);
const paneSources = ref({});
const paneDisplays = ref({});
const paneParsed = ref({});
let paneDownAt = null;
let switchingTarget = { pane: 0, key: "" };
const latestView = {};
let animTimer = null;
let switchingTimer = null;
let resourceRequestId = 0;
const paneFramePreloads = new Map();
const PLAYBACK_BASE_INTERVAL_MS = 900;
const PLAYBACK_MIN_INTERVAL_MS = 120;
const CMA_PLAYBACK_MIN_INTERVAL_MS = 200;
const RADAR_PLAYBACK_BASE_INTERVAL_MS = 1200;
const RADAR_PLAYBACK_MIN_INTERVAL_MS = 250;

function playbackIntervalMs(baseInterval = PLAYBACK_BASE_INTERVAL_MS, minInterval = PLAYBACK_MIN_INTERVAL_MS) {
  const multiplier = Math.max(0.1, Number(speed.value) || 1);
  return Math.max(minInterval, baseInterval / multiplier);
}

const catalogSourceKey = computed(() =>
  layout.value !== "1" && selectedPane.value >= 0
    ? (paneSources.value[selectedPane.value] || active.value)
    : active.value,
);

const activeSourceLabel = computed(() => sources.find(item => item.key === catalogSourceKey.value)?.btn || catalogSourceKey.value.toUpperCase());
const singleFrameCatalogSources = new Set(["radar", "himawari", "fy3"]);
const resourceListLabel = computed(() =>
  resourceStartTime.value && resourceEndTime.value
    ? `${activeSourceLabel.value} 搜索结果`
    : `${activeSourceLabel.value} ${singleFrameCatalogSources.has(catalogSourceKey.value) ? "最近数据" : "最近连续数据"}`,
);
const catalogSelectedResourceUuid = computed(() => {
  if (layout.value !== "1" && selectedPane.value >= 0) {
    return paneParsed.value[selectedPane.value]?.fileUuid || "";
  }
  return selectedResourceUuid.value;
});

const attributeOptions = computed(() => {
  const values = {};
  dataResources.value.forEach(item => {
    Object.entries(item.attributes || {}).forEach(([key, options]) => {
      if (!Array.isArray(options)) return;
      if (!values[key]) values[key] = new Set();
      options.forEach(option => {
        if (option !== null && option !== undefined && String(option).trim()) values[key].add(String(option));
      });
    });
  });
  return Object.fromEntries(
    Object.entries(values).map(([key, options]) => [key, [...options].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))]),
  );
});

const availableAttributeFilters = computed(() => {
  const preferred = typeAttributeOrder[catalogSourceKey.value] || [];
  const keys = [...preferred, ...Object.keys(attributeOptions.value).filter(key => !preferred.includes(key))];
  return keys
    .filter(key => key !== "elements" && attributeOptions.value[key]?.length)
    .map(key => ({ key, label: attributeLabels[key] || key, options: attributeOptions.value[key] }));
});

const layerCardFilters = computed(() => ({
  filters: availableAttributeFilters.value,
  values: attributeFilters.value,
}));

provide("layerCardFilters", layerCardFilters);

function timestamp(value) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const text = String(value);
  const beijing = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const parsed = beijing
    ? Date.UTC(Number(beijing[1]), Number(beijing[2]) - 1, Number(beijing[3]), Number(beijing[4]) - 8, Number(beijing[5]), Number(beijing[6]))
    : new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function overlapsSelectedTime(item) {
  if (!resourceStartTime.value || !resourceEndTime.value) return true;
  const selectedStart = timestamp(resourceStartTime.value);
  const selectedEnd = timestamp(resourceEndTime.value);
  const itemStart = timestamp(item?.time_start);
  const itemEnd = timestamp(item?.time_end || item?.time_start);
  if (![selectedStart, selectedEnd, itemStart, itemEnd].every(Number.isFinite)) return false;
  return itemStart <= selectedEnd && itemEnd >= selectedStart;
}

const filteredDataResources = computed(() => {
  const selectedAttributes = Object.entries(attributeFilters.value).filter(([key, value]) => key !== "elements" && value !== "" && value !== null && value !== undefined);
  const matches = dataResources.value.filter(item => {
    if (!overlapsSelectedTime(item)) return false;
    return selectedAttributes.every(([key, value]) =>
      (item.attributes?.[key] || []).some(option => String(option) === String(value)),
    );
  });
  matches.sort((left, right) => timestamp(right.time_end || right.time_start) - timestamp(left.time_end || left.time_start));
  if (!resourceStartTime.value || !resourceEndTime.value) {
    return matches.filter(item =>
      item.continuous
      || (singleFrameCatalogSources.has(catalogSourceKey.value) && Number(item.frame_count) >= 1),
    );
  }
  return matches;
});

function onResourceStartChange(value) {
  if (!value) {
    resourceEndTime.value = "";
    refreshDataResources();
    return;
  }
  if (resourceEndTime.value && timestamp(resourceEndTime.value) < timestamp(value)) {
    resourceEndTime.value = "";
  }
  refreshDataResources();
}

function onResourceEndChange(value) {
  if (value && resourceStartTime.value && timestamp(value) < timestamp(resourceStartTime.value)) {
    resourceEndTime.value = "";
    ElNotification({ title: "时间范围无效", message: "结束时间不能早于开始时间。", type: "warning", duration: 2500, position: "top-right" });
    refreshDataResources();
    return;
  }
  refreshDataResources();
}

function disableResourceEndDate(date) {
  if (!resourceStartTime.value) return false;
  const start = new Date(String(resourceStartTime.value).replace(" ", "T"));
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  return date.getTime() < startDay;
}

function onPaneDown(e) {
  paneDownAt = [e.clientX, e.clientY];
}

function onPaneClick(i, e) {
  if (layout.value === "1") return;
  if (e.target.closest(".layer-card")) return;
  if (paneDownAt && Math.hypot(e.clientX - paneDownAt[0], e.clientY - paneDownAt[1]) > 5) return;
  const deselecting = selectedPane.value === i;
  if (deselecting) {
    clearPaneOverride(i);
    selectedPane.value = -1;
  } else {
    selectedPane.value = i;
  }
  if (dockOpen.value && tool.value === "select") {
    resetCatalogFilters();
    dataResources.value = [];
    refreshDataResources();
  }
}

function clearPaneOverride(pane) {
  const nextPaneSources = { ...paneSources.value };
  const nextPaneParsed = { ...paneParsed.value };
  const nextPaneDisplays = { ...paneDisplays.value };
  const nextPaneLabels = { ...paneLabels.value };
  delete nextPaneSources[pane];
  delete nextPaneParsed[pane];
  delete nextPaneDisplays[pane];
  delete nextPaneLabels[pane];
  paneSources.value = nextPaneSources;
  paneParsed.value = nextPaneParsed;
  paneDisplays.value = nextPaneDisplays;
  paneLabels.value = nextPaneLabels;
  paneFramePreloads.delete(pane);

  // 取消独立屏时，忽略它尚未返回的资源请求。
  resourceRequestId += 1;
  resourcesLoading.value = false;
}

function onViewChange(i, view) {
  latestView[i] = view;
  if (!linked.value) return;
  emitterIdx.value = i;
  syncView.value = view;
}

watch(linked, v => {
  if (v && latestView[0]) {
    emitterIdx.value = 0;
    syncView.value = latestView[0];
  }
});

function extractLabel(payload) {
  return payload?.product?.label || payload?.meta?.weather_info?.element || payload?.meta?.element || payload?.element || payload?.variable || payload?.meta?.variable || "";
}

function updatePaneLabel(paneIndex, key, payload) {
  const label = extractLabel(payload);
  if (label) {
    const src = sources.find(s => s.key === key);
    paneLabels.value = {...paneLabels.value, [paneIndex]: `${src?.btn || key} · ${label}`};
  }
}

function collectFrameImageUrls(payload) {
  const urls = new Set();
  const add = value => {
    if (typeof value !== "string") return;
    const url = value.trim();
    if (/\.(?:webp|png|jpe?g)(?:[?#].*)?$/i.test(url) || url.startsWith("data:image/")) urls.add(url);
  };
  const scanContainer = container => {
    if (!container || typeof container !== "object") return;
    [container.image_url, container.webp_url, container.png_url, container.image, container.webp].forEach(add);
    [container.image_urls, container.webp_urls, container.png_urls].forEach(items => {
      if (Array.isArray(items)) items.forEach(add);
    });
    if (Array.isArray(container.frames)) {
      container.frames.forEach(frame => {
        if (!frame || typeof frame !== "object") return;
        [frame.url, frame.image_url, frame.webp_url, frame.png_url, frame.image, frame.webp].forEach(add);
      });
    }
  };

  scanContainer(payload);
  scanContainer(payload?.meta);
  scanContainer(payload?.meta_json);
  scanContainer(payload?.weather_info);
  scanContainer(preferredVariableLayer(payload));
  return [...urls];
}

function schedulePaneFramePreload(paneIndex, payload) {
  const urls = collectFrameImageUrls(payload);
  const imageJob = preloadFrames(urls);
  const sourceJob = payload?.frame_preload_promise;
  const job = Promise.all([
    imageJob,
    sourceJob && typeof sourceJob.then === "function" ? sourceJob : Promise.resolve(),
  ]).catch(error => {
    console.warn("Frame preload failed:", error);
    return [{ total: urls.length, loaded: 0, failed: urls.length }];
  });
  paneFramePreloads.set(paneIndex, job);
  return job;
}

async function waitForCurrentPaneFrames() {
  const paneCount = Math.max(1, Number(layout.value) || 1);
  const jobs = Array.from({ length: paneCount }, (_, index) => paneFramePreloads.get(index)).filter(Boolean);
  await Promise.all(jobs);
}

function onLayerDisplayLoaded(paneIndex, key, payload) {
  if (!payload) return;
  updatePaneLabel(paneIndex, key, payload);
  paneDisplays.value = { ...paneDisplays.value, [paneIndex]: payload };

  const fileName =
    resolveOverviewFileName(payload) ||
    payload.file_name ||
    payload.filename ||
    payload.file ||
    "";

  const normalizedPayload = {
    ...payload,
    file_name: fileName || payload.file_name,
    file: fileName || payload.file,
    meta: payload.meta
      ? {
          ...payload.meta,
          file_name: fileName || payload.meta.file_name,
          file: fileName || payload.meta.file,
        }
      : payload.meta,
    weather_info: payload.weather_info
      ? {
          ...payload.weather_info,
          file_name: fileName || payload.weather_info.file_name,
          file: fileName || payload.weather_info.file,
        }
      : payload.weather_info,
  };

  updatePaneLabel(paneIndex, key, normalizedPayload);
  schedulePaneFramePreload(paneIndex, normalizedPayload);

  if (
    switching.value &&
    paneIndex === switchingTarget.pane &&
    key === switchingTarget.key
  ) {
    switching.value = false;
    clearTimeout(switchingTimer);
  }

  if (paneIndex === 0) {
    const previousDisplay = layerDisplays.value[key];
    if (key === "himawari") {
      updateHimawariTimeline(normalizedPayload);
    }

    layerDisplays.value = {
      ...layerDisplays.value,
      [key]: normalizedPayload,
    };

    if (key === "fy3") {
      updateFY3Selection(normalizedPayload, previousDisplay);
    }
    if (key === "cma") {
      animPos.value = tIndex.value;
      cmaPlaybackWaiting.value = false;
    }
  }
}

function onLayerDisplayError(paneIndex, key, message) {
  const text = String(message || "图层数据加载失败");
  paneLabels.value = {...paneLabels.value, [paneIndex]: `${sources.find(item => item.key === key)?.btn || key} · 加载失败`};
  if (paneIndex !== 0) return;
  parseProcessing.value = [
    {step: "读取展示数据", state: text, t: new Date().toLocaleTimeString(), ok: false},
    {step: "前端展示", state: "请检查登录状态、后端服务或数据完整性", t: "", ok: false},
  ];
}

function onLayerVariableChange(paneIndex, key, payload) {
  if (!payload) return;

  updatePaneLabel(paneIndex, key, payload);
  schedulePaneFramePreload(paneIndex, payload);
  paneDisplays.value = {
    ...paneDisplays.value,
    [paneIndex]: {
      ...(paneDisplays.value[paneIndex] || {}),
      meta: {
        ...(paneDisplays.value[paneIndex]?.meta || {}),
        weather_info: payload,
        ...payload,
      },
      weather_info: payload,
    },
  };

  if (paneIndex !== 0) return;

  const previous = layerDisplays.value[key] || {};

  const currentFileName =
    resolveOverviewFileName(payload) ||
    resolveOverviewFileName(previous) ||
    payload.file_name ||
    payload.filename ||
    payload.file ||
    previous.file_name ||
    previous.file ||
    "";

  const normalizedWeatherInfo = {
    ...(previous.weather_info || {}),
    ...payload,
    file_name: currentFileName || payload.file_name,
    file: currentFileName || payload.file,
  };

  const nextDisplay = {
    ...previous,
    file_name: currentFileName || previous.file_name,
    file: currentFileName || previous.file,
    meta: {
      ...(previous.meta || {}),
      ...payload,
      file_name: currentFileName || payload.file_name,
      file: currentFileName || payload.file,
      weather_info: normalizedWeatherInfo,
    },
    weather_info: normalizedWeatherInfo,
    times: payload.times || previous.times,
    forecast_hours: payload.forecast_hours || previous.forecast_hours,
    forecast_labels: payload.forecast_labels || previous.forecast_labels,
    valid_hours:
      payload.valid_hours ||
      payload.validHours ||
      payload.valid_time_hours ||
      previous.valid_hours,
    valid_time_hours:
      payload.valid_time_hours ||
      payload.validTimeHours ||
      payload.valid_hours ||
      previous.valid_time_hours,
    axis_times: payload.axis_times || previous.axis_times,
  };

  if (isGribLayerKey(key)) {
    nextDisplay.image_url = payload.image_url || previous.image_url;
    nextDisplay.image_urls = payload.image_urls || previous.image_urls;
    nextDisplay.frames = payload.frames || previous.frames;
    nextDisplay.image_format = "webp";
    nextDisplay.render_mode = "webp";

    // GFS / ECMWF 已切换为 WebP-only，清除旧兼容字段。
    delete nextDisplay.png_url;
    delete nextDisplay.png_urls;
    delete nextDisplay.grid_url;
    delete nextDisplay.grid_urls;
    delete nextDisplay.binary_layer;
    delete nextDisplay.binary_layers;
  } else {
    // 其他图层暂时保留团队原有兼容字段。
    nextDisplay.png_urls = payload.png_urls || previous.png_urls;
    nextDisplay.webp_urls = payload.webp_urls || previous.webp_urls;
    nextDisplay.image_urls = payload.image_urls || previous.image_urls;
    nextDisplay.frames = payload.frames || previous.frames;
  }

  layerDisplays.value = {
    ...layerDisplays.value,
    [key]: nextDisplay,
  };
}

function onLayerResolutionChange(key, value) {
  if (!key) return;
  const defaultValue = key === "cma" ? "native" : "original";
  layerResolutions.value = {
    ...layerResolutions.value,
    [key]: value || defaultValue,
  };
}

function firstArray(...items) {
  return items.find((item) => Array.isArray(item) && item.length) || [];
}

function collectTimes(source) {
  const meta = source?.meta || source?.meta_json || source || {};
  const layer = preferredVariableLayer(source);
  const frames = firstArray(
    source?.frames,
    meta.frames,
    source?.weather_info?.frames,
    meta.weather_info?.frames,
    layer?.frames,
  );

  const frameTimes = frames
    .map(frame => frame?.valid_time || frame?.time || frame?.time_label)
    .filter(Boolean);

  const candidates = [
    frameTimes,
    source?.times,
    meta.times,
    source?.weather_info?.times,
    meta.weather_info?.times,
    layer?.times,
    layer?.valid_times,
  ];

  return candidates.find(items => Array.isArray(items) && items.length) || [];
}

function formatAxisTime(value) {
  const text = String(value || "");
  if (/^\d{10}$/.test(text)) return `${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:00`;
  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) return formatBeijingTime(parsedDate);
  const match = text.match(/T(\d{2}):?(\d{2})?/) || text.match(/\s(\d{2}):?(\d{2})?/);
  if (match) return `${match[1]}:${match[2] || "00"}`;
  return text.slice(0, 16) || text;
}

const selectedResourceTimes = computed(() => {
  if (!selectedResource.value || parsedLayerKey.value !== active.value) return [];
  return Array.isArray(selectedResource.value.times) ? selectedResource.value.times : [];
});

const activeLayerTimes = computed(() => {
  // 当前图层选择（例如从 t2m 切换到 tp）优先，避免与上传解析快照混合后帧数错位。
  const displayTimes = collectTimes(layerDisplays.value[active.value]);
  if (displayTimes.length) {
    return [...new Set(displayTimes.map(String))];
  }

  const parsedTimes = collectTimes(
    parsed.value && parsedLayerKey.value === active.value
      ? parsed.value
      : null
  );

  return [...new Set(parsedTimes.map(String))];
});

const axisTimes = computed(() => {
  if (selectedResource.value && parsedLayerKey.value === active.value) {
    const times = selectedResourceTimes.value;
    return times.length ? times.map(formatAxisTime) : ["无有效时间"];
  }

  if (active.value === "himawari" && himawariTimeline.value.length) {
    return himawariTimeline.value.map(item => item.label);
  }

  // GFS / ECMWF 直接使用后端 frames 的真实有效时间：
  // GFS 为逐小时 25 帧，ECMWF 为每 3 小时 9 帧。
  if (isGribLayerKey(active.value) && activeLayerTimes.value.length) {
    return activeLayerTimes.value.map(formatAxisTime);
  }

  // 其他图层继续沿用原有时间轴逻辑。
  if (activeLayerTimes.value.length > 1) {
    return activeLayerTimes.value.map(formatAxisTime);
  }

  return defaultTimes;
});

const timeAxisKey = computed(() => {
  const first = axisTimes.value[0] || "";
  const last = axisTimes.value[axisTimes.value.length - 1] || "";
  return `${active.value}-${axisTimes.value.length}-${first}-${last}`;
});

const activeTimeLabel = computed(() => {
  const index = Math.min(Math.max(Math.round(Number(animPos.value) || 0), 0), axisTimes.value.length - 1);
  return axisTimes.value[index] || "";
});

const usesCompactTimeAxis = computed(() => ["himawari", "fy3", "cma"].includes(active.value));

function parseAxisHour(text, index = 0) {
  const raw = String(text || "");

  const m1 = raw.match(/(\d{1,2})时/);
  if (m1) return Number(m1[1]);

  const m2 = raw.match(/(\d{1,2}):\d{2}/);
  if (m2) return Number(m2[1]);

  return index * 2;
}

function parseForecastHour(value, fallbackIndex = 0) {
  if (value === undefined || value === null || value === "") {
    return fallbackIndex;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value);

  const m1 = text.match(/F\s*(\d{1,3})/i);
  if (m1) return Number(m1[1]);

  const m2 = text.match(/(\d{1,3})\s*h/i);
  if (m2) return Number(m2[1]);

  const m3 = text.match(/(\d{1,3})/);
  if (m3) return Number(m3[1]);

  return fallbackIndex;
}

function allVariableLayers(source) {
  const meta = source?.meta || source?.meta_json || {};
  const weather = source?.weather_info || meta.weather_info || {};
  const layers =
      source?.variable_layers ||
      weather.variable_layers ||
      meta.variable_layers ||
      meta.weather_info?.variable_layers ||
      source?.extra?.variable_layers ||
      meta.extra?.variable_layers ||
      {};

  return layers && typeof layers === "object" ? layers : {};
}

function preferredVariableLayer(source) {
  if (!source) return null;

  const layers = allVariableLayers(source);
  const keys = Object.keys(layers);
  if (!keys.length) return null;

  const productKey =
      source?.product?.key ||
      source?.product?.code ||
      source?.level?.layerKey ||
      source?.default_variable ||
      source?.meta?.default_variable ||
      source?.weather_info?.default_variable;

  if (productKey && layers[productKey]) {
    return layers[productKey];
  }

  return layers[keys[0]];
}

function collectFrameCount(source) {
  if (!source) return 0;

  const meta = source?.meta || source?.meta_json || source || {};
  const layer = preferredVariableLayer(source);

  const frames = firstArray(
    source?.frames,
    meta.frames,
    source?.weather_info?.frames,
    meta.weather_info?.frames,
    layer?.frames,
  );

  const candidates = [
    frames,
    source?.image_urls,
    meta.image_urls,
    source?.weather_info?.image_urls,
    meta.weather_info?.image_urls,
    layer?.image_urls,
    layer?.times,
    layer?.valid_times,
    layer?.forecast_hours,
    layer?.forecast_labels,
    source?.forecast_hours,
    source?.forecast_labels,
    collectTimes(source),

    // 非 GRIB 图层的历史兼容。
    source?.png_urls,
    meta.png_urls,
    source?.weather_info?.png_urls,
    layer?.png_urls,
    layer?.grid_urls,
  ];

  return firstArray(...candidates).length || 0;
}

function currentLayerForecastHours() {
  const display = layerDisplays.value[active.value];
  const meta = display?.meta || display?.meta_json || display || {};
  const weather = meta.weather_info || display?.weather_info || {};
  const layer = preferredVariableLayer(display);
  const parsedLayer = parsedLayerKey.value === active.value ? preferredVariableLayer(parsed.value) : null;

  const frameCandidates = [
    display?.frames,
    meta.frames,
    weather.frames,
    layer?.frames,
    parsedLayer?.frames,
  ];

  for (const frames of frameCandidates) {
    if (Array.isArray(frames) && frames.length) {
      const values = frames
        .map((frame, index) => parseForecastHour(frame?.forecast_hour ?? frame?.forecast_label, index));
      if (values.length) return values;
    }
  }

  const candidates = [
    display?.forecast_hours,
    display?.forecastHours,
    meta.forecast_hours,
    meta.forecastHours,
    weather.forecast_hours,
    weather.forecastHours,
    layer?.forecast_hours,
    layer?.forecastHours,
    parsedLayer?.forecast_hours,
    parsedLayer?.forecastHours,
    parsed.value?.forecast_hours,
    parsed.value?.forecastHours,
  ];

  for (const item of candidates) {
    if (Array.isArray(item) && item.length) {
      return item.map((v, i) => parseForecastHour(v, i));
    }
  }

  const labelCandidates = [
    display?.forecast_labels,
    display?.forecastLabels,
    meta.forecast_labels,
    meta.forecastLabels,
    weather.forecast_labels,
    weather.forecastLabels,
    layer?.forecast_labels,
    layer?.forecastLabels,
    parsedLayer?.forecast_labels,
    parsedLayer?.forecastLabels,
    display?.axis_times,
    meta.axis_times,
    weather.axis_times,
  ];

  for (const item of labelCandidates) {
    if (Array.isArray(item) && item.length) {
      return item.map((v, i) => parseForecastHour(v, i));
    }
  }

  return [];
}

function parseValidHour(value, fallbackIndex = null) {
  if (value === undefined || value === null || value === "") {
    return fallbackIndex === null ? null : fallbackIndex * 2;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return ((Math.floor(value) % 24) + 24) % 24;
  }

  const text = String(value);

  // ISO 时间：2026-06-30T12:00:00
  const iso = text.match(/T(\d{1,2}):\d{2}/);
  if (iso) return Number(iso[1]);

  // 普通时间：06-30 12:00 / F006 · 06-30 12:00
  const hm = text.match(/(\d{1,2}):\d{2}/);
  if (hm) return Number(hm[1]);

  // 中文刻度：12时
  const cn = text.match(/(\d{1,2})时/);
  if (cn) return Number(cn[1]);

  return fallbackIndex === null ? null : fallbackIndex * 2;
}

function currentLayerValidHours() {
  const display = layerDisplays.value[active.value];
  const meta = display?.meta || display?.meta_json || display || {};
  const weather = meta.weather_info || display?.weather_info || {};
  const layer = preferredVariableLayer(display);
  const parsedLayer = parsedLayerKey.value === active.value ? preferredVariableLayer(parsed.value) : null;

  const frameCandidates = [
    display?.frames,
    meta.frames,
    weather.frames,
    layer?.frames,
    parsedLayer?.frames,
  ];

  for (const frames of frameCandidates) {
    if (Array.isArray(frames) && frames.length) {
      const values = frames
        .map((frame, index) => parseValidHour(frame?.valid_time || frame?.time, index))
        .filter(Number.isFinite);
      if (values.length) return values;
    }
  }

  const hourCandidates = [
    display?.valid_hours,
    display?.validHours,
    display?.valid_time_hours,
    display?.validTimeHours,
    meta.valid_hours,
    meta.validHours,
    meta.valid_time_hours,
    meta.validTimeHours,
    weather.valid_hours,
    weather.validHours,
    weather.valid_time_hours,
    weather.validTimeHours,
    layer?.valid_hours,
    layer?.validHours,
    layer?.valid_time_hours,
    layer?.validTimeHours,
    parsedLayer?.valid_hours,
    parsedLayer?.validHours,
    parsedLayer?.valid_time_hours,
    parsedLayer?.validTimeHours,
  ];

  for (const item of hourCandidates) {
    if (Array.isArray(item) && item.length) {
      const parsedHours = item.map((v, i) => parseValidHour(v, i)).filter(v => Number.isFinite(v));
      if (parsedHours.length) return parsedHours;
    }
  }

  const timeCandidates = [
    display?.times,
    meta.times,
    weather.times,
    layer?.times,
    layer?.valid_times,
    layer?.validTimes,
    parsedLayer?.times,
    parsedLayer?.valid_times,
    parsedLayer?.validTimes,
    parsed.value?.times,
    parsed.value?.meta?.times,
    parsed.value?.weather_info?.times,
  ];

  for (const item of timeCandidates) {
    if (Array.isArray(item) && item.length) {
      const parsedHours = item.map((v, i) => parseValidHour(v, i)).filter(v => Number.isFinite(v));
      if (parsedHours.length) return parsedHours;
    }
  }

  return [];
}

function snapTimeIndexForActive(value) {
  return clampTimeIndex(value);
}

const parsedFrameCount = computed(() => {
  if (isGribLayerKey(active.value)) {
    const validHours = currentLayerValidHours();
    if (validHours.length) return validHours.length;

    const forecastHours = currentLayerForecastHours();
    if (forecastHours.length) return forecastHours.length;
  }

  const displayCount = collectFrameCount(layerDisplays.value[active.value]);
  if (displayCount) return displayCount;

  if (parsed.value && parsedLayerKey.value === active.value) {
    const parsedCount = collectFrameCount(parsed.value);
    if (parsedCount) return parsedCount;
  }

  return defaultTimes.length;
});

const layerTimeIndex = computed(() => {
  if (active.value === "himawari" && himawariTimeline.value.length) {
    return clampTimeIndex(tIndex.value);
  }

  const frameCount = parsedFrameCount.value;
  if (frameCount <= 1) return 0;

  const uiIndex = clampTimeIndex(tIndex.value);

  // GFS / ECMWF 的时间轴与 frames 一一对应，不再按小时做环形近邻匹配。
  if (isGribLayerKey(active.value)) {
    return Math.min(uiIndex, frameCount - 1);
  }

  // 其他图层继续使用比例映射。
  const uiCount = axisTimes.value.length;
  if (uiCount <= 1) return 0;

  return Math.round((uiIndex / (uiCount - 1)) * (frameCount - 1));
});

function clampTimeIndex(v) {
  const max = Math.max(0, axisTimes.value.length - 1);
  const n = Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0;
  return Math.min(max, Math.max(0, n));
}

function setTimeIndex(v) {
  const next = snapTimeIndexForActive(v);
  tIndex.value = next;
  animPos.value = next;
  cmaPlaybackWaiting.value = false;
}

async function togglePlaying() {
  if (playing.value) {
    playing.value = false;
    return;
  }

  if (playingPreparing.value) return;

  if (selectedResource.value && parsedLayerKey.value === active.value && !selectedResource.value.playable) {
    const firstGap = selectedResource.value.gaps?.[0];
    const gapDetail = firstGap
      ? `缺少 ${formatAxisTime(firstGap.after)} 与 ${formatAxisTime(firstGap.before)} 之间的时次。`
      : selectedResource.value.reason;
    ElNotification({
      title: "无法播放",
      message: gapDetail || "时间序列不连续，请补齐数据后再播放。",
      type: "warning",
      position: "top-right",
      duration: 3200,
    });
    return;
  }

  playingPreparing.value = true;
  try {
    await waitForCurrentPaneFrames();
  } finally {
    playingPreparing.value = false;
  }

  if (!playing.value && active.value === "cma" && layerResolutions.value.cma !== "native") {
    layerResolutions.value = {
      ...layerResolutions.value,
      cma: "native",
    };
  }
  playing.value = true;
}

function resetTimebar() {
  clearInterval(animTimer);
  playing.value = false;
  playingPreparing.value = false;
  tIndex.value = 0;
  animPos.value = 0;
  cmaPlaybackWaiting.value = false;
  himawariTimeline.value = [];
}

function nextTimeIndexForActive() {
  const count = Math.max(1, axisTimes.value.length);
  return (clampTimeIndex(tIndex.value) + 1) % count;
}

function advanceTimeIndex() {
  setTimeIndex(nextTimeIndexForActive());
}

function startAnim() {
  clearInterval(animTimer);

  if (active.value === "cma") {
    cmaPlaybackWaiting.value = false;
    animTimer = setInterval(() => {
      const count = parsedFrameCount.value;
      if (count <= 1 || cmaPlaybackWaiting.value) return;

      const next = (Number(tIndex.value) + 1) % count;
      cmaPlaybackWaiting.value = true;
      tIndex.value = next;
    }, Math.max(200, 900 / Math.max(0.1, speed.value)));
    return;
  }

  // 只保留一个定时器，避免旧代码同时创建两个 interval 导致播放加速和内存泄漏。
  animTimer = setInterval(
    advanceTimeIndex,
    Math.max(120, 900 / Math.max(0.1, speed.value))
  );
}

watch(playing, v => {
  if (v) {
    animPos.value = tIndex.value;
    startAnim();
  } else {
    clearInterval(animTimer);
    cmaPlaybackWaiting.value = false;
    animPos.value = tIndex.value;
  }
});

watch(speed, () => {
  if (playing.value) startAnim();
});

watch(tIndex, v => {
  if (!playing.value) animPos.value = clampTimeIndex(v);
});

watch(axisTimes, () => {
  setTimeIndex(Math.min(tIndex.value, axisTimes.value.length - 1));
});

watch(
    () => [
      active.value,
      currentLayerValidHours().join(","),
      currentLayerForecastHours().join(","),
    ],
    () => {
      setTimeIndex(tIndex.value);
      if (playing.value) startAnim();
    }
);


onBeforeUnmount(() => {
  clearInterval(animTimer);
  if (himawariStatusTimer) clearInterval(himawariStatusTimer);
  cmaPlaybackWaiting.value = false;
  clearTimeout(switchingTimer);
});

async function refreshHimawariStatus() {
  try {
    himawariStatus.value = await getHimawariAutoStatus();
  } catch (error) {
    himawariStatus.value = {state: "error", last_error: error?.message || "自动处理状态读取失败"};
  }
}

onMounted(() => {
  refreshHimawariStatus();
  himawariStatusTimer = window.setInterval(refreshHimawariStatus, 5000);
});

function businessTypeToLayerKey(type) {
  const t = String(type || "").toUpperCase();

  if (t === "GFS") return "gfs";
  if (t === "ECMWF" || t === "EC" || t === "IFS") return "ecmwf";
  // 历史兼容：旧接口仍返回 GFS/ECMWF 时，默认放到 GFS 页面。
  if (t === "GFS/ECMWF" || t === "GRIB") return "gfs";
  if (t === "ERA5") return "era5";
  if (t === "CMA") return "cma";
  if (t === "RADAR") return "radar";
  if (t === "FY3" || t === "FY-3") return "fy3";
  if (t === "HIMAWARI") return "himawari";
  if (t === "WRF") return "wrf";

  return active.value;
}

function extractOverviewGribFileName(value) {
  if (!value) return "";

  let text = String(value)
    .replaceAll("\\", "/")
    .split("?")[0]
    .split("#")[0];

  try {
    text = decodeURIComponent(text);
  } catch {
    // URL 解码失败时继续使用原字符串。
  }

  let name = text.split("/").pop() || "";
  name = name.replace(/\.meta\.json$/i, "");

  const match = name.match(/^(.+\.(?:grib2|grib|grb2|grb))/i);
  if (match) return match[1];

  if (/\.(?:grib2|grib|grb2|grb)$/i.test(name)) {
    return name;
  }

  return "";
}

function resolveOverviewFileName(source) {
  if (!source) return "";

  const meta =
    source.meta ||
    source.meta_json ||
    {};

  const info =
    source.weather_info ||
    meta.weather_info ||
    {};

  const layer =
    preferredVariableLayer(source) ||
    {};

  const candidates = [
    source.file_name,
    source.filename,
    source.file,

    meta.file_name,
    meta.filename,
    meta.file,

    info.file_name,
    info.filename,
    info.file,

    source.meta_url,
    meta.meta_url,

    source.image_url,
    source.image_urls?.[0],

    layer.image_url,
    layer.image_urls?.[0],
    layer.frames?.[0]?.url,

    source.frames?.[0]?.url,
  ];

  for (const candidate of candidates) {
    const fileName = extractOverviewGribFileName(candidate);
    if (fileName) return fileName;
  }

  return "";
}

function normalizeParsedMeta(result) {
  if (!result) return null;

  const panelMeta = result.meta || result.meta_json || {};
  const info =
    result.weather_info ||
    panelMeta.weather_info ||
    {};

  const frames = firstArray(
    result.frames,
    panelMeta.frames,
    info.frames,
  );

  const imageUrls = firstArray(
    result.image_urls,
    panelMeta.image_urls,
    info.image_urls,

    // 仅作为非 GRIB 历史数据的输入兼容，不再向外暴露旧字段名。
    result.webp_urls,
    panelMeta.webp_urls,
    info.webp_urls,
    result.png_urls,
    panelMeta.png_urls,
    info.png_urls,
  );

  const imageUrl =
    result.image_url ||
    panelMeta.image_url ||
    info.image_url ||
    result.webp_url ||
    panelMeta.webp_url ||
    info.webp_url ||
    result.png_url ||
    panelMeta.png_url ||
    info.png_url ||
    imageUrls[0] ||
    null;

  return {
    file:
      resolveOverviewFileName(result) ||
      result.file_name ||
      result.filename ||
      result.file ||
      panelMeta.file_name ||
      panelMeta.filename ||
      panelMeta.file ||
      info.file_name ||
      info.filename ||
      info.file ||
      "—",
    file_name:
      resolveOverviewFileName(result) ||
      result.file_name ||
      result.filename ||
      result.file ||
      panelMeta.file_name ||
      panelMeta.filename ||
      panelMeta.file ||
      info.file_name ||
      info.filename ||
      info.file ||
      "—",
    element: panelMeta.element || info.element || "—",
    time: panelMeta.time || info.time || "—",
    level: panelMeta.level || info.level || "—",
    range: panelMeta.range || info.range || "—",
    grid: panelMeta.grid || info.grid || "—",
    resolution:
      panelMeta.resolution ||
      info.resolution ||
      panelMeta.spatial_resolution ||
      info.spatial_resolution ||
      "—",
    missing: panelMeta.missing || info.missing || "—",
    unit: panelMeta.unit || info.unit || "—",
    vars: panelMeta.vars || info.variables || "—",
    steps: panelMeta.steps || info.steps || String(frames.length || imageUrls.length || "—"),
    status: panelMeta.status || info.status || "—",
    variable_key: panelMeta.variable_key || info.variable_key || "",
    element_desc_zh: panelMeta.element_desc_zh || info.element_desc_zh || "",
    element_desc_en: panelMeta.element_desc_en || info.element_desc_en || "",
    extent: panelMeta.extent || info.extent || result.extent || null,
    image_url: imageUrl,
    image_urls: imageUrls,
    image_format:
      result.image_format ||
      panelMeta.image_format ||
      info.image_format ||
      (String(imageUrl || "").toLowerCase().endsWith(".webp") ? "webp" : ""),
    render_mode:
      result.render_mode ||
      panelMeta.render_mode ||
      info.render_mode ||
      (String(imageUrl || "").toLowerCase().endsWith(".webp") ? "webp" : ""),
    frames,
    times: firstArray(
      result.times,
      panelMeta.times,
      info.times,
      frames.map(frame => frame?.valid_time).filter(Boolean),
    ),
  };
}

const meta = computed(() => {
  if (layout.value !== "1" && selectedPane.value >= 0) {
    const paneDisplay = paneDisplays.value[selectedPane.value];
    const paneMeta = paneDisplay?.meta || paneDisplay?.weather_info || null;
    if (paneMeta) return paneMeta;
    const paneResource = paneParsed.value[selectedPane.value];
    if (paneResource?.parsed) return normalizeParsedMeta(paneResource.parsed);
    return sourceFallbackInfo(catalogSourceKey.value);
  }

  const display = layerDisplays.value[active.value];
  const rawDisplayMeta =
    display?.meta ||
    display?.weather_info ||
    null;

  const displayFileName =
    resolveOverviewFileName(display) ||
    resolveOverviewFileName(rawDisplayMeta) ||
    "";

  const displayMeta = rawDisplayMeta
    ? {
        ...rawDisplayMeta,
        file:
          displayFileName ||
          rawDisplayMeta.file ||
          rawDisplayMeta.file_name ||
          "—",
        file_name:
          displayFileName ||
          rawDisplayMeta.file_name ||
          rawDisplayMeta.file ||
          "—",
      }
    : null;

  // CMA 面板跟随卡片中选中的要素。
  if (active.value === "cma" && displayMeta) {
    return displayMeta;
  }

  // 本地上传解析结果。
  if (parsed.value && parsedLayerKey.value === active.value) {
    return normalizeParsedMeta(parsed.value);
  }

  // 在线 GFS / ECMWF 以及其他图层。
  if (displayMeta) {
    return displayMeta;
  }

  return sourceFallbackInfo(active.value);
});

const processing = computed(() => {
  if (layout.value !== "1" && selectedPane.value >= 0) {
    const paneResource = paneParsed.value[selectedPane.value];
    if (paneResource?.processing) return paneResource.processing;
  }
  if (parseProcessing.value) {
    return parseProcessing.value;
  }

  return defaultProcessing;
});

function layerParsed(key, paneIndex = 0) {
  const paneResource = layout.value !== "1" ? paneParsed.value[paneIndex] : null;
  const source = paneResource?.key === key ? paneResource.parsed : parsed.value;
  const sourceKey = paneResource?.key === key ? paneResource.key : parsedLayerKey.value;
  if (!source || sourceKey !== key) {
    return null;
  }

  // GFS / ECMWF 上传接口外层是 { file_name, business_type, meta, weather_info }。
  // GribLayer 需要直接读取 compact meta v2，因此只对这两个数据源解包。
  if (isGribLayerKey(key) && source?.meta?.variable_layers) {
    return {
      ...source.meta,
      file_name:
        resolveOverviewFileName(source) ||
        source.file_name ||
        source.filename ||
        source.file ||
        source.meta.file_name ||
        source.meta.filename ||
        source.meta.file,
      file:
        resolveOverviewFileName(source) ||
        source.file ||
        source.file_name ||
        source.meta.file ||
        source.meta.file_name,
      business_type:
        source.business_type ||
        source.meta.business_type,
      data_type:
        source.data_type ||
        source.meta.data_type,
      source:
        source.source ||
        source.meta.source,
      weather_info:
        source.weather_info ||
        source.meta.weather_info,
    };
  }

  return source;
}

const selectedHimawariSceneId = computed(() => {
  if (pendingHimawariSceneId.value) return pendingHimawariSceneId.value;
  const items = himawariTimeline.value;
  if (!items.length) return "";
  const index = active.value === "himawari" ? clampTimeIndex(tIndex.value) : items.length - 1;
  return items[index]?.scene_id || "";
});

function layerProps(key) {
  if (key === "gfs") return {dataType: "GFS"};
  if (key === "ecmwf") return {dataType: "ECMWF"};
  if (key === "himawari") return {
    sceneId: selectedHimawariSceneId.value,
    resolution: layerResolutions.value.himawari || "original",
    refreshKey: layerRefreshKeys.value.himawari || 0,
    onResolutionChange: value => onLayerResolutionChange(key, value),
  };
  if (key === "fy3") return {
    sceneId: focusedFY3SceneId.value,
    resolution: layerResolutions.value.fy3 || "original",
    refreshKey: layerRefreshKeys.value.fy3 || 0,
    onResolutionChange: value => onLayerResolutionChange(key, value),
  };
  if (key === "cma") {
    return {
      resolution: layerResolutions.value.cma || "native",
      playing: playing.value,
      onResolutionChange: value => onLayerResolutionChange(key, value),
    };
  }
  return {};
}

function updateHimawariTimeline(data) {
  const items = normalizeHimawariTimeline(data);
  if (!items.length) return;

  const previous = himawariTimeline.value;
  const previousIndex = previous.length ? clampTimeIndex(tIndex.value) : -1;
  const previousSceneId = previous[previousIndex]?.scene_id || "";
  const wasAtLatest = previous.length > 0 && previousIndex >= previous.length - 1;

  himawariTimeline.value = items;

  if (active.value !== "himawari") return;

  if (pendingHimawariSceneId.value) {
    const focusedIndex = items.findIndex(item => item.scene_id === pendingHimawariSceneId.value);
    if (focusedIndex >= 0) {
      pendingHimawariSceneId.value = "";
      setTimeIndex(focusedIndex);
      return;
    }
  }

  if (!previous.length) {
    setTimeIndex(items.length - 1);
    return;
  }

  const preservedIndex = previousSceneId
      ? items.findIndex((item) => item.scene_id === previousSceneId)
      : -1;
  const nextIndex = wasAtLatest
      ? items.length - 1
      : preservedIndex >= 0
          ? preservedIndex
          : Math.min(Math.max(previousIndex, 0), items.length - 1);

  setTimeIndex(nextIndex);
}

function updateFY3Selection(data, previousData) {
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  if (!frames.length || active.value !== "fy3") return;

  if (focusedFY3SceneId.value && !fy3FocusApplied.value) {
    const focusedIndex = frames.findIndex(item => item?.scene_id === focusedFY3SceneId.value);
    if (focusedIndex >= 0) {
      fy3FocusApplied.value = true;
      setTimeIndex(focusedIndex);
      return;
    }
  }

  const previousFrames = Array.isArray(previousData?.frames) ? previousData.frames : [];
  if (!previousFrames.length) {
    setTimeIndex(frames.length - 1);
    return;
  }

  const previousIndex = Math.min(Math.max(tIndex.value, 0), previousFrames.length - 1);
  const previousSceneId = previousFrames[previousIndex]?.scene_id || "";
  const wasAtLatest = previousIndex >= previousFrames.length - 1;
  const preservedIndex = previousSceneId
    ? frames.findIndex(item => item?.scene_id === previousSceneId)
    : -1;
  setTimeIndex(wasAtLatest ? frames.length - 1 : (preservedIndex >= 0 ? preservedIndex : previousIndex));
}

function normalizeHimawariTimeline(data) {
  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  if (timeline.length) {
    return timeline
        .map((item) => {
          const sceneId = item?.scene_id || item?.id || "";
          const timeValue = item?.observation_time || item?.time || item?.utc_time || item?.label || sceneId;
          return {
            scene_id: sceneId,
            time: timeValue,
            label: formatObservationTime(timeValue) || item?.label || sceneId,
          };
        })
        .filter((item) => item.scene_id);
  }

  const metaJson = data?.meta_json || data?.meta || {};
  const sceneId = metaJson.scene_id || data?.scene_id || "";
  if (!sceneId) return [];

  const timeValue = metaJson.observation_time || data?.observation_time || metaJson.time || sceneId;
  return [{
    scene_id: sceneId,
    time: timeValue,
    label: formatObservationTime(timeValue) || sceneId,
  }];
}

function formatObservationTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})$/);
  if (compact) {
    const date = new Date(Date.UTC(
        Number(compact[1]),
        Number(compact[2]) - 1,
        Number(compact[3]),
        Number(compact[4]),
        Number(compact[5]),
    ));
    return formatBeijingTime(date);
  }

  const parsedDate = new Date(text);
  if (!Number.isNaN(parsedDate.getTime())) {
    return formatBeijingTime(parsedDate);
  }

  const hm = text.match(/(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (hm) return `${hm[1]}-${hm[2]} ${hm[3]}:${hm[4]}`;

  return text.slice(0, 16);
}

function formatBeijingTime(date) {
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const mm = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(bj.getUTCDate()).padStart(2, "0");
  const hh = String(bj.getUTCHours()).padStart(2, "0");
  const mi = String(bj.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

const panes = computed(() => {
  const base = sources.find(source => source.key === active.value);
  if (!base) return [];

  if (layout.value === "1") {
    return [{ ...base, variantIndex: 0 }];
  }

  const count = layout.value === "2" ? 2 : 4;

  return Array.from({ length: count }, (_, index) => {
    const overrideKey = paneSources.value[index];
    const source = overrideKey
      ? sources.find(item => item.key === overrideKey) || base
      : base;

    return {
      ...source,
      variantIndex: overrideKey ? 0 : index,
    };
  });
});

const mapsGrid = computed(() => {
  if (layout.value === "1") return {gridTemplate: "1fr / 1fr"};
  if (layout.value === "2") return {gridTemplate: "1fr / 1fr 1fr"};
  return {gridTemplate: "repeat(2, 1fr) / repeat(2, 1fr)"};
});

const dockTitle = computed(() => ({
  select: "数据源",
  proj: "投影方式",
  base: "底图图层"
}[tool.value]));

function toggleVector() {
  showVector.value = !showVector.value;
  if (showVector.value) mapDark.value = false;
}

function cycleLayout() {
  layout.value = layout.value === "1" ? "2" : layout.value === "2" ? "4" : "1";
  if (layout.value === "1") linked.value = false;
  paneLabels.value = {};
  selectedPane.value = -1;
  paneSources.value = {};
  paneDisplays.value = {};
  paneParsed.value = {};
}

function openTool(name) {
  if (dockOpen.value && tool.value === name) dockOpen.value = false;
  else {
    tool.value = name;
    dockOpen.value = true;
    if (name === "select") refreshDataResources({ autoSelect: true });
  }
}

function sourceDataType(key = active.value) {
  const source = sources.find(item => item.key === key);
  return source?.dataType || ({ radar: "Radar", himawari: "Himawari", fy3: "FY3" }[key] || key.toUpperCase());
}

function formatFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function resourceTimeRange(item) {
  if (!item?.time_start) return "无有效时间";
  const start = formatAxisTime(item.time_start);
  const end = formatAxisTime(item.time_end);
  return start === end ? start : `${start} 至 ${end}`;
}

function resourceStatus(item) {
  if (item.frame_count < 2) return `${item.frame_count || 0} 帧`;
  return item.continuous ? `${item.frame_count} 帧连续` : `${item.frame_count} 帧有断点`;
}

function resourceRenderKey(key, paneIndex = 0) {
  const paneResource = layout.value !== "1" ? paneParsed.value[paneIndex] : null;
  if (paneResource?.key === key) return paneResource.fileUuid;
  return parsedLayerKey.value === key ? selectedResourceUuid.value : "latest";
}

function clearSelectedResource() {
  selectedResource.value = null;
  selectedResourceUuid.value = "";
  parsed.value = null;
  parsedLayerKey.value = null;
  parseProcessing.value = null;
}

function resetCatalogFilters() {
  resourceStartTime.value = "";
  resourceEndTime.value = "";
  attributeFilters.value = {};
}

function selectCatalogSource(key) {
  resetCatalogFilters();
  if (key === catalogSourceKey.value) {
    clearCatalogResourceSelection();
    dataResources.value = [];
    refreshDataResources({ autoSelect: true });
    return;
  }
  selectSource(key);
}

function clearCatalogResourceSelection() {
  resetTimebar();
  if (layout.value !== "1" && selectedPane.value >= 0) {
    const pane = selectedPane.value;
    const nextPaneParsed = { ...paneParsed.value };
    delete nextPaneParsed[pane];
    paneParsed.value = nextPaneParsed;
    paneDisplays.value = { ...paneDisplays.value, [pane]: null };
    return;
  }

  clearSelectedResource();
  layerDisplays.value = { ...layerDisplays.value, [catalogSourceKey.value]: null };
}

function resourceRequest(item) {
  if (!Array.isArray(item?.members) || item.members.length === 0 || !resourceStartTime.value || !resourceEndTime.value) return item;
  const fileUuids = item.members
    .filter(member => overlapsSelectedTime(member))
    .map(member => member.file_uuid)
    .filter(Boolean);
  return { ...item, file_uuids: fileUuids };
}

function resourceWithSelectionDefaults(resource) {
  const defaultResolution = attributeFilters.value.resolutions;
  if (!defaultResolution) return resource;
  return {
    ...resource,
    meta: {
      ...(resource.meta || {}),
      default_resolution: defaultResolution,
    },
  };
}

async function refreshDataResources(options = {}) {
  const requestId = ++resourceRequestId;
  resourcesLoading.value = true;
  resourcesError.value = "";
  try {
    const hasTimeRange = resourceStartTime.value && resourceEndTime.value;
    const result = await getDisplayResources(sourceDataType(catalogSourceKey.value), {
      timeStart: hasTimeRange ? new Date(timestamp(resourceStartTime.value)).toISOString().slice(0, 19) : "",
      timeEnd: hasTimeRange ? new Date(timestamp(resourceEndTime.value)).toISOString().slice(0, 19) : "",
    });
    if (requestId !== resourceRequestId) return;
    dataResources.value = result.items || [];
    if (layout.value === "1" && selectedResourceUuid.value && !dataResources.value.some(item => item.file_uuid === selectedResourceUuid.value)) {
      clearSelectedResource();
    }
    const defaultResource = options.autoSelect && !hasTimeRange && !catalogSelectedResourceUuid.value
      ? filteredDataResources.value[0]
      : null;
    if (defaultResource) {
      // 先结束列表请求状态，否则 selectDataResource 会因加载中而直接返回。
      resourcesLoading.value = false;
      await selectDataResource(defaultResource);
    }
  } catch (err) {
    if (requestId !== resourceRequestId) return;
    dataResources.value = [];
    resourcesError.value = err?.message || "数据读取失败";
  } finally {
    if (requestId === resourceRequestId) resourcesLoading.value = false;
  }
}

function parsedResourcePayload(resource, sourceKey = catalogSourceKey.value) {
  const meta = resource.meta || {};
  const common = {
    file_name: resource.file_name,
    file: resource.file_name,
    business_type: resource.data_type,
    data_type: resource.data_type,
    meta_file: resource.meta_path,
    meta,
    meta_json: meta,
  };
  return isGribLayerKey(sourceKey) ? { ...common, meta } : { ...meta, ...common };
}

async function selectDataResource(item) {
  if (!item?.file_uuid || resourcesLoading.value) return;
  const targetPane = layout.value !== "1" && selectedPane.value >= 0 ? selectedPane.value : -1;
  const targetSource = catalogSourceKey.value;
  if (targetPane < 0) selectedResourceUuid.value = item.file_uuid;
  resourcesLoading.value = true;
  resourcesError.value = "";
  const requestId = ++resourceRequestId;
  try {
    const resource = resourceWithSelectionDefaults(await getDisplayResource(resourceRequest(item)));
    if (requestId !== resourceRequestId) return;
    resetTimebar();
    const nextProcessing = [
      {step: "上传/下载", state: "已入库", t: resource.create_time || "", ok: true},
      {step: "解析", state: "成功", t: resource.parse_finished_at || "", ok: true},
      {step: "渲染 WEBP", state: `${resource.webp_count || 0} 个资源`, t: "", ok: true},
      {step: "前端展示", state: "已加载首帧", t: "实时", ok: true},
    ];
    const nextParsed = parsedResourcePayload(resource, targetSource);
    if (targetPane >= 0) {
      paneParsed.value = {
        ...paneParsed.value,
        [targetPane]: {
          key: targetSource,
          parsed: nextParsed,
          resource,
          fileUuid: item.file_uuid,
          processing: nextProcessing,
        },
      };
      paneDisplays.value = { ...paneDisplays.value, [targetPane]: null };
    } else {
      selectedResource.value = resource;
      parsed.value = nextParsed;
      parsedLayerKey.value = targetSource;
      layerDisplays.value = { ...layerDisplays.value, [targetSource]: null };
      parseProcessing.value = nextProcessing;
    }
    setTimeIndex(0);
  } catch (err) {
    if (requestId !== resourceRequestId) return;
    if (targetPane < 0) clearSelectedResource();
    resourcesError.value = err?.message || "数据加载失败";
  } finally {
    if (requestId === resourceRequestId) resourcesLoading.value = false;
  }
}

function selectSource(key) {
  if (layout.value !== "1" && selectedPane.value >= 0) {
    const pane = selectedPane.value;
    const current = paneSources.value[pane] || active.value;
    if (current === key) return;
    paneSources.value = { ...paneSources.value, [pane]: key };
    paneLabels.value = { ...paneLabels.value, [pane]: "" };
    paneDisplays.value = { ...paneDisplays.value, [pane]: null };
    const nextPaneParsed = { ...paneParsed.value };
    delete nextPaneParsed[pane];
    paneParsed.value = nextPaneParsed;
    dataResources.value = [];
    switching.value = true;
    clearTimeout(switchingTimer);
    switchingTimer = setTimeout(() => { switching.value = false; }, 10000);
    switchingTarget = { pane, key };
    if (dockOpen.value && tool.value === "select") refreshDataResources({ autoSelect: true });
    return;
  }
  if (key === active.value) return;
  if (key === "fy3") {
    focusedFY3SceneId.value = "";
    fy3FocusApplied.value = false;
  }
  if (key === "himawari") pendingHimawariSceneId.value = "";
  resetTimebar();
  switching.value = true;
  clearTimeout(switchingTimer);
  switchingTimer = setTimeout(() => { switching.value = false; }, 10000);
  switchingTarget = { pane: 0, key };
  active.value = key;
  clearSelectedResource();
  dataResources.value = [];
  paneLabels.value = {};
  paneSources.value = {};
  paneDisplays.value = {};
  paneParsed.value = {};
  if (dockOpen.value && tool.value === "select") refreshDataResources({ autoSelect: true });
}

function pickFile(i) {
  selected.value = i;
  resetTimebar();
  active.value = files[i].key;
  if (active.value === "fy3") {
    focusedFY3SceneId.value = "";
    fy3FocusApplied.value = false;
  }
  if (active.value === "himawari") pendingHimawariSceneId.value = "";
  parsed.value = null;
  parsedLayerKey.value = null;
  parseProcessing.value = null;
}

function choose(e) {
  file.value = Array.from(e.target.files || []);
}

function rawBusinessType(files) {
  const names = files.map(item => String(item?.name || ""));
  const isFY3 = name => /^FY3[A-Z]_MERSI_GBAL_L1_\d{8}_\d{4}_(?:1000M_MS|GEO1K_MS)\.HDF$/i.test(name);
  const isHimawari = name => /^HS_H\d{2}_\d{8}_\d{4}_B\d{2}_[A-Z0-9]+_R\d{2}_S\d{4}\.DAT(?:_\d+)?(?:\.bz2)?$/i.test(name);

  if (names.length && names.every(isFY3)) return "FY3";
  if (names.length && names.every(isHimawari)) return "Himawari";
  if (names.some(isFY3) || names.some(isHimawari)) {
    throw new Error("FY-3、Himawari 原始文件不能与其他类型混合上传，请分别提交。");
  }
  return "";
}

async function parse() {
  const uploadFiles = Array.isArray(file.value) ? file.value : [file.value].filter(Boolean);
  if (!uploadFiles.length) return;

  let rawType = "";
  try {
    rawType = rawBusinessType(uploadFiles);
  } catch (err) {
    parseProcessing.value = [
      {step: "上传/读取", state: err?.message || "文件类型不一致", t: new Date().toLocaleTimeString(), ok: false},
      {step: "解析", state: "未开始", t: "", ok: false},
      {step: "渲染 WEBP", state: "未开始", t: "", ok: false},
      {step: "前端展示", state: "未开始", t: "", ok: false},
    ];
    return;
  }

  if (rawType) {
    let rawUploadSucceeded = false;
    let uploadedFileCount = 0;
    parseProcessing.value = [
      {step: "上传/读取", state: "上传原始数据中", t: "", ok: false, running: true},
      {step: "解析", state: "等待上传完成", t: "", ok: false},
      {step: "渲染 WEBP", state: "等待解析", t: "", ok: false},
      {step: "前端展示", state: "等待解析完成", t: "", ok: false},
    ];

    try {
      const result = await uploadRawFiles(uploadFiles, rawType);
      rawUploadSucceeded = true;
      uploadedFileCount = Number(result.file_count || 0);
      const scenes = Array.isArray(result?.scenes) ? result.scenes : [];
      const readyScenes = scenes.filter(scene => scene?.complete);
      const incompleteScenes = scenes.filter(scene => !scene?.complete);
      if (!readyScenes.length) {
        const detail = incompleteScenes
          .map(scene => `${scene.scene_id} 缺少 ${(scene.missing || []).join("、")}`)
          .join("；");
        throw new Error(detail || "原始文件尚未组成完整场景");
      }

      parseProcessing.value = [
        {step: "上传/读取", state: `成功：${uploadedFileCount} 个原始文件`, t: new Date().toLocaleTimeString(), ok: true},
        {step: "解析", state: "解析中", t: "", ok: false, running: true},
        {step: "渲染 WEBP", state: "等待解析", t: "", ok: false},
        {step: "前端展示", state: "等待解析完成", t: "", ok: false},
      ];

      const sceneIds = readyScenes.map(scene => scene.scene_id).filter(Boolean);
      let updateResult;
      let taskState = "completed";
      {
        const task = await startSatelliteParseTask(rawType, sceneIds);
        const finishedTask = await waitForSatelliteParseTask(rawType, task.task_id, {
          onProgress(current) {
            const progress = Number(current?.progress || 0).toFixed(1);
            const detail = [current?.current_scene, current?.current_band].filter(Boolean).join(" · ");
            parseProcessing.value = [
              {step: "上传/读取", state: `成功：${uploadedFileCount} 个原始文件`, t: new Date().toLocaleTimeString(), ok: true},
              {step: "解析", state: `${progress}%${detail ? ` · ${detail}` : ""}`, t: "后台任务", ok: false, running: true},
              {step: "渲染 WEBP", state: "随波段生成", t: "", ok: false, running: true},
              {step: "前端展示", state: "等待任务完成", t: "", ok: false},
            ];
          },
        });
        taskState = finishedTask.state;
        updateResult = finishedTask.result || {};
        if (["failed", "interrupted", "cancelled"].includes(taskState) || (!updateResult.results?.length && finishedTask.error)) {
          throw new Error(finishedTask.error || `${rawType} 解析任务未完成`);
        }
      }

      const completedIds = (updateResult.results || [])
        .filter(item => item?.status === "ok" || item?.status === "cached")
        .map(item => item.scene_id)
        .filter(Boolean);
      const displayableIds = Array.isArray(updateResult.displayable_scene_ids)
        ? updateResult.displayable_scene_ids
        : (updateResult.results || [])
          .filter(item => (item?.status === "ok" || item?.status === "cached") && item?.displayable !== false)
          .map(item => item.scene_id)
          .filter(Boolean);
      const noCoverageIds = Array.isArray(updateResult.no_coverage_scene_ids)
        ? updateResult.no_coverage_scene_ids
        : completedIds.filter(sceneId => !displayableIds.includes(sceneId));
      const focusedSceneId = displayableIds.at(-1) || completedIds.at(-1) || sceneIds.at(-1) || "";
      const layerKey = businessTypeToLayerKey(rawType);

      parsed.value = null;
      parsedLayerKey.value = null;
      resetTimebar();
      active.value = layerKey;
      if (layerKey === "himawari") pendingHimawariSceneId.value = focusedSceneId;
      if (layerKey === "fy3") {
        focusedFY3SceneId.value = focusedSceneId;
        fy3FocusApplied.value = false;
      }
      layerRefreshKeys.value = {
        ...layerRefreshKeys.value,
        [layerKey]: (layerRefreshKeys.value[layerKey] || 0) + 1,
      };
      parseProcessing.value = [
        {step: "上传/读取", state: `成功：${uploadedFileCount} 个原始文件`, t: new Date().toLocaleTimeString(), ok: true},
        {
          step: "解析",
          state: `${taskState === "partial" ? "部分完成" : "成功"}：${completedIds.length || readyScenes.length} 个场景${noCoverageIds.length ? `，${noCoverageIds.length} 个无区域覆盖` : ""}`,
          t: new Date().toLocaleTimeString(),
          ok: taskState !== "partial",
        },
        {step: "渲染 WEBP", state: displayableIds.length ? "成功" : "无有效覆盖图像", t: new Date().toLocaleTimeString(), ok: Boolean(displayableIds.length)},
        {step: "前端展示", state: focusedSceneId ? `显示 ${focusedSceneId}` : "无可展示场景", t: "实时", ok: Boolean(focusedSceneId)},
      ];
    } catch (err) {
      console.error("raw 上传或解析失败：", err);
      parseProcessing.value = [
        {
          step: "上传/读取",
          state: rawUploadSucceeded ? `成功：${uploadedFileCount} 个原始文件` : (err?.message || "上传失败"),
          t: new Date().toLocaleTimeString(),
          ok: rawUploadSucceeded,
        },
        {
          step: "解析",
          state: rawUploadSucceeded ? (err?.message || "解析失败") : "未开始",
          t: rawUploadSucceeded ? new Date().toLocaleTimeString() : "",
          ok: false,
        },
        {step: "渲染 WEBP", state: "未生成", t: "", ok: false},
        {step: "前端展示", state: "未生成", t: "", ok: false},
      ];
    }
    return;
  }

  parseProcessing.value = [
    {step: "上传/读取", state: "本地文件", t: new Date().toLocaleTimeString(), ok: true},
    {step: "解析", state: "解析中", t: "", ok: false, running: true},
    {step: "渲染 WEBP", state: "等待", t: "", ok: false},
    {step: "前端展示", state: "等待", t: "", ok: false},
  ];

  try {
    const result = await parseFile(uploadFiles);

    const businessType =
        result?.business_type ||
        result?.data_type ||
        result?.meta?.business_type ||
        result?.meta?.data_type;

    const layerKey = businessTypeToLayerKey(businessType);
    if (layerKey === "radar") {
      layerDisplays.value = {...layerDisplays.value, radar: null};
    }

    parsed.value = result;
    parsedLayerKey.value = layerKey;
    resetTimebar();
    active.value = layerKey;

    parseProcessing.value = [
      {step: "上传/读取", state: "成功", t: new Date().toLocaleTimeString(), ok: true},
      {step: "解析", state: "成功", t: new Date().toLocaleTimeString(), ok: true},
      {step: "渲染 WEBP", state: "成功", t: new Date().toLocaleTimeString(), ok: true},
      {step: "前端展示", state: "完成", t: "实时", ok: true},
    ];

    setTimeIndex(0);
  } catch (err) {
    console.error("解析失败：", err);

    parseProcessing.value = [
      {step: "上传/读取", state: "成功", t: new Date().toLocaleTimeString(), ok: true},
      {step: "解析", state: err?.message || "失败", t: new Date().toLocaleTimeString(), ok: false},
      {step: "渲染 WEBP", state: "未完成", t: "", ok: false},
      {step: "前端展示", state: "未完成", t: "", ok: false},
    ];
  }
}

watch(active, () => {
  cmaPlaybackWaiting.value = false;
  setTimeIndex(tIndex.value);
  if (playing.value) startAnim();
});
</script>

<style scoped>
.ov {
  display: flex;
  gap: 10px;
  padding: 10px;
  height: 100%;
  min-height: 0;
  background: var(--backdrop);
}

.rail { flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 8px; }
.rail button { display: grid; place-items: center; gap: 3px; width: 50px; height: 50px; border: 0; border-radius: 12px; background: transparent; color: var(--muted); font: inherit; font-size: 11px; cursor: pointer; transition: 0.15s; }
.rail button .el-icon { font-size: 19px; }
.dim-icon { font-size: 14px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
.rail button:hover { color: var(--text); background: var(--field); }
.rail button.on { color: #fff; background: var(--accent); }

.dock { flex-shrink: 0; width: 300px; display: flex; flex-direction: column; gap: 11px; padding: 15px; overflow: hidden; }
.dock-head { display: flex; align-items: center; justify-content: space-between; }
.dock-head h3 { margin: 0; font-size: 15px; }
.dock-head .el-icon { cursor: pointer; color: var(--muted); }
.resource-filter { display: grid; gap: 9px; padding-bottom: 11px; border-bottom: 1px solid var(--border); }
.filter-label { color: var(--muted); font-size: 11px; }
.filter-field { display: grid; gap: 5px; min-width: 0; }
.time-filter-row { display: grid; gap: 7px; }
.data-type-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
.data-type-grid button { min-width: 0; height: 30px; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; background: var(--field); color: var(--text); font: inherit; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.data-type-grid button:hover { border-color: var(--accent); }
.data-type-grid button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.data-type-grid button:disabled { opacity: 0.4; cursor: not-allowed; }
.resource-filter :deep(.el-date-editor),
.resource-filter :deep(.el-select) { width: 100%; }
.resource-filter :deep(.el-date-editor) { --el-date-editor-width: 100%; }
.resource-filter :deep(.el-input__wrapper),
.resource-filter :deep(.el-select__wrapper) { min-height: 30px; background: var(--field); box-shadow: 0 0 0 1px var(--border) inset; }
.resource-filter :deep(.resource-time .el-input__wrapper) { min-height: 24px; }
.resource-filter :deep(.el-range-input),
.resource-filter :deep(.el-range-separator),
.resource-filter :deep(.el-select__placeholder),
.resource-filter :deep(.el-select__selected-item) { color: var(--text); font-size: 11px; }
.resource-filter :deep(.el-date-editor .el-input__inner) { min-width: 0; font-size: 11px; }
.resource-head { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 12px; }
.resource-head button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.resource-head button:hover { color: var(--text); background: var(--field); }
.resource-head button:disabled { cursor: wait; opacity: 0.55; }
.resource-head .rotating { animation: resource-spin 0.8s linear infinite; }
.resource-results { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.resource-results::-webkit-scrollbar { width: 5px; }
.resource-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.resource-state { margin: 0; padding: 18px 8px; color: var(--muted); font-size: 12px; text-align: center; }
.resource-state.error { color: var(--danger, #dc2626); }
.resource-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.resource-list li { display: grid; gap: 5px; min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); cursor: pointer; transition: 0.15s; }
.resource-list li:hover { border-color: var(--accent); }
.resource-list li.sel { border-color: var(--accent); background: var(--accent-soft); }
.resource-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 7px; min-width: 0; }
.resource-title b { min-width: 0; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.resource-list li > span { color: var(--muted); font-size: 11px; }
.continuity { flex-shrink: 0; color: #15803d; font-size: 10px; }
.continuity.gap { color: #b45309; }
@keyframes resource-spin { to { transform: rotate(360deg); } }
.pick-hint {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--field);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
}

.picker button:hover {
  border-color: var(--accent);
}

.picker button.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.picker button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.picker button:disabled:hover {
  border-color: var(--border);
  background: var(--field);
  color: var(--text);
}

.soon-tag {
  font-size: 10px;
  color: var(--muted);
}

.picker button .el-icon {
  font-size: 15px;
}

.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.maps {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 10px;
}

.cell {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  transition: border-color 0.18s, box-shadow 0.18s;
}

.cell.sel {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 60%, transparent);
}

.app.dark .cell.sel {
  box-shadow: inset 0 0 0 1.5px var(--accent), 0 0 0 1px rgba(150, 205, 255, 0.6), 0 0 22px rgba(150, 205, 255, 0.8);
}

.cell-tag {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 6;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 7px;
  background: rgba(16, 24, 38, 0.68);
  backdrop-filter: blur(10px);
  color: #eaf1fb;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  pointer-events: none;
}

.cell-sel-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 7px;
  background: rgba(16, 24, 38, 0.68);
  backdrop-filter: blur(10px);
  color: #eaf1fb;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  pointer-events: none;
}

.cell-sel-tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}

.cell :deep(.projmap) {
  position: absolute;
  inset: 0;
}

.timebar {
  flex-shrink: 0;
  padding: 6px 14px 8px;
  overflow: hidden;
}

.tb-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 6px;
}

.tc-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--field);
  color: var(--muted);
  cursor: pointer;
  transition: 0.15s;
}

.tc-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.tc-play {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: 0.15s;
  flex-shrink: 0;
}

.tc-play:hover {
  opacity: 0.85;
}

.tc-speed {
  display: flex;
  gap: 3px;
  margin: 0 4px;
}

.tc-speed button {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--field);
  color: var(--muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: 0.15s;
}

.tc-speed button:hover {
  color: var(--text);
}

.tc-speed button.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.tc-time {
  margin-left: auto;
  min-width: 92px;
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.version {
  margin-top: 18px;
  padding: 14px;
  border-radius: 12px;
  background: var(--field);
}

.version p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 9px;
  font-size: 12px;
  color: var(--muted);
}

.version p:last-child {
  margin-bottom: 0;
}

.ok {
  color: var(--ok);
}

.run {
  color: var(--accent);
}
</style>
