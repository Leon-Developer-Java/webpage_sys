<template>
  <div class="ov">
    <aside class="rail glass">
      <button :class="{ on: dockOpen && tool === 'file' }" @click="openTool('file')"><el-icon><FolderOpened /></el-icon><span>文件</span></button>
      <button :class="{ on: dockOpen && tool === 'data' }" @click="openTool('data')"><el-icon><DataAnalysis /></el-icon><span>数据</span></button>
      <button :class="{ on: propsOpen }" @click="propsOpen = !propsOpen"><el-icon><Document /></el-icon><span>信息</span></button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')"><el-icon><Position /></el-icon><span>投影</span></button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')"><el-icon><MapLocation /></el-icon><span>底图</span></button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid"><el-icon><Grid /></el-icon><span>经纬网</span></button>
      <button :class="{ on: showVector }" @click="showVector = !showVector"><b class="dim-icon">界</b><span>边界</span></button>
      <button v-if="showVector" :class="{ on: mapDark }" @click="mapDark = !mapDark"><el-icon><Moon /></el-icon><span>暗色</span></button>
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

      <template v-if="tool === 'file'">
        <div class="path"><el-icon><FolderOpened /></el-icon><input :value="path" readonly /></div>
        <div class="list-head"><span>文件列表</span><el-icon><RefreshRight /></el-icon></div>
        <ul class="files">
          <li v-for="(f, i) in files" :key="f.name" :class="{ sel: selected === i }" @click="pickFile(i)">
            <i class="dot"></i>
            <div><b>{{ f.name }}</b><span>{{ f.time }} · {{ f.size }}</span></div>
          </li>
        </ul>
        <label class="upload"><input type="file" multiple hidden @change="choose" />{{ selectedFileLabel }}</label>
        <el-button type="primary" size="small" class="parse" @click="parse">打开并解析</el-button>
        <p class="hint">解析后生成 meta.json + PNG</p>
        <div class="vars">
          <VariableSelect v-model="variable" :options="variableOptions" />
          <VariableSelect v-model="level" :options="levels" />
        </div>
      </template>

      <template v-else-if="tool === 'data'">
        <p class="pick-hint">选择数据类型</p>
        <div class="picker">
          <button v-for="s in sources" :key="s.key" :class="{ on: active === s.key }" @click="selectSource(s.key)">
            <span>{{ s.btn }}</span><el-icon v-if="active === s.key"><Check /></el-icon>
          </button>
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
        <div :class="['cell', { 'cell-4': layout === '4' }]" v-for="(p, i) in panes" :key="layout + '-' + i">
          <MapBase
            :grid="showGrid"
            :dark="mapDark"
            :vector="showVector"
            :basemap="basemap"
            :projection="projection"
            :sync-view="linked && emitterIdx !== i ? syncView : null"
            @view-change="v => onViewChange(i, v)"
          >
            <component
              :key="`${layout}-${i}-${p.key}-${active}`"
              :is="p.comp"
              :parsed="layerParsed(p.key)"
              :time-index="layerTimeIndex"
              @display-loaded="payload => onLayerDisplayLoaded(p.key, payload)"
            />
          </MapBase>
        </div>
      </div>

      <div class="timebar glass">
        <div class="tb-head">
          <button class="tc-btn" @click="setTimeIndex(0)"><el-icon><DArrowLeft /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(Math.max(0, tIndex - 1))"><el-icon><ArrowLeft /></el-icon></button>
          <button class="tc-play" @click="playing = !playing"><el-icon><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(Math.min(axisTimes.length - 1, tIndex + 1))"><el-icon><ArrowRight /></el-icon></button>
          <button class="tc-btn" @click="setTimeIndex(axisTimes.length - 1)"><el-icon><DArrowRight /></el-icon></button>
          <div class="tc-speed">
            <button v-for="s in [0.5, 1, 2, 4]" :key="s" :class="{ on: speed === s }" @click="speed = s">{{ s }}x</button>
          </div>
        </div>
        <TimeAxis :times="axisTimes" :active="animPos" @update:active="v => setTimeIndex(v)" :dark="dark" />
      </div>
    </div>

    <MetaPanel v-if="propsOpen" :meta="meta" :steps="processing" closable @close="propsOpen = false">
      <div class="version">
        <h4>MVP 当前版本</h4>
        <p v-for="v in versions" :key="v"><el-icon class="ok"><CircleCheck /></el-icon>{{ v }}</p>
      </div>
    </MetaPanel>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { ArrowLeft, ArrowRight, Check, CircleCheck, Close, Connection, DArrowLeft, DArrowRight, DataAnalysis, Document, FolderOpened, Grid, MapLocation, Monitor, Moon, Operation, Position, RefreshRight, VideoPlay, VideoPause } from "@element-plus/icons-vue";
import { parseFile } from "../api";
import MapBase from "../components/MapBase.vue";
import MetaPanel from "../components/MetaPanel.vue";
import TimeAxis from "../components/TimeAxis.vue";
import VariableSelect from "../components/VariableSelect.vue";
import Era5Layer from "../layers/Era5Layer.vue";
import GribLayer from "../layers/GribLayer.vue";
import CmaLayer from "../layers/CmaLayer.vue";
import RadarLayer from "../layers/RadarLayer.vue";
import HimawariLayer from "../layers/HimawariLayer.vue";
import WrfLayer from "../layers/WrfLayer.vue";

const dark = inject("theme");

const sources = [
  { key: "grib", btn: "GFS·ECMWF", comp: GribLayer },
  { key: "cma", btn: "CMA", comp: CmaLayer },
  { key: "radar", btn: "雷达", comp: RadarLayer },
  { key: "himawari", btn: "葵花卫星", comp: HimawariLayer },
  { key: "wrf", btn: "WRF", comp: WrfLayer },
  { key: "era5", btn: "ERA5", comp: Era5Layer }
];

const infos = {
  radar: { file: "radar_xh_20250616_1000.cinrad", element: "组合反射率 DBZH、径向速度、谱宽", time: "2025-06-16 10:00", level: "0.5° 仰角", range: "73°E-135°E, 15°N-55°N", grid: "721 × 361", missing: "-9999", unit: "dBZ / m·s⁻¹", vars: "3", steps: "24" },
  himawari: { file: "himawari_20250616_1000.hsd", element: "红外亮温 B13、真彩色合成", time: "2025-06-16 10:00", level: "全圆盘 / 区域", range: "80°E-160°E, 0°N-60°N", grid: "5500 × 5500", missing: "-9999", unit: "°C", vars: "16", steps: "24" },
  era5: { file: "era5_t2m_20250616.nc", element: "2m 温度、位势、风场", time: "2025-06-16 09:00", level: "2m / 1000-200hPa", range: "73°E-135°E, 15°N-55°N", grid: "248 × 161", missing: "NaN", unit: "°C", vars: "5", steps: "24" },
  grib: { file: "gfs.t00z.pgrb2.0p25.f006", element: "500hPa 位势高度、温度", time: "2025-06-16 08:00", level: "500hPa / 850hPa", range: "73°E-135°E, 15°N-55°N", grid: "249 × 161", missing: "9999", unit: "gpm", vars: "8", steps: "40" },
  cma: { file: "cma_meso_20250616.grib2", element: "2m 温度、降水", time: "2025-06-16 08:00", level: "地面 / 多层", range: "70°E-140°E, 10°N-60°N", grid: "1025 × 801", missing: "9999", unit: "°C / mm", vars: "6", steps: "24" },
  wrf: { file: "wrf_radar_20250616.nc", element: "雷达反射率 (NC)", time: "2025-06-16 10:00", level: "多仰角", range: "73°E-135°E, 15°N-55°N", grid: "460 × 460", missing: "-9999", unit: "dBZ", vars: "2", steps: "12" }
};

const files = [
  { name: "radar_xh_20250616_1000.cinrad", time: "2025-06-16 10:00", size: "2.14 MB", key: "radar" },
  { name: "era5_t2m_20250616.nc", time: "2025-06-16 09:00", size: "1.28 GB", key: "era5" },
  { name: "gfs.t00z.pgrb2.0p25.f006", time: "2025-06-16 08:00", size: "524 MB", key: "grib" },
  { name: "himawari_20250616_1000.hsd", time: "2025-06-16 10:00", size: "380 MB", key: "himawari" }
];

const defaultProcessing = [
  { step: "下载", state: "成功", t: "06-16 09:58", ok: true },
  { step: "解析", state: "成功", t: "06-16 09:59", ok: true },
  { step: "渲染 PNG", state: "成功", t: "06-16 10:02", ok: true },
  { step: "前端展示", state: "服务中", t: "200 ms", ok: false }
];

const versions = ["文件存储：原始数据 + meta.json + PNG", "前端渲染：PNG 显示（后续升级 WebGL2）", "数据处理：后端完成、前端轻展示"];
const projections = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];
const levels = ["地面", "850hPa", "500hPa", "200hPa"];
const defaultTimes = ["00时", "02时", "04时", "06时", "08时", "10时", "12时", "14时", "16时", "18时", "20时", "22时"];

const tool = ref("file");
const dockOpen = ref(false);
const showGrid = ref(true);
const layout = ref("1");
const propsOpen = ref(true);
const active = ref("radar");
const selected = ref(0);
const file = ref([]);
const path = ref("D:/weather_data/radar/");
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const variable = ref("组合反射率 DBZH");
const level = ref("500hPa");
const tIndex = ref(5);
const parsed = ref(null);
const parsedLayerKey = ref(null);
const parseProcessing = ref(null);
const layerDisplays = ref({});
const playing = ref(false);
const speed = ref(1);
const animPos = ref(tIndex.value);
const linked = ref(false);
const syncView = ref(null);
const showVector = ref(false);
const mapDark = ref(dark.value);
const emitterIdx = ref(-1);
const latestView = {};
let animTimer = null;
let lastTs = null;

const selectedFileLabel = computed(() => {
  const files = Array.isArray(file.value) ? file.value : [];
  if (!files.length) return "选择本地文件…";
  if (files.length === 1) return files[0].name;
  return `已选择 ${files.length} 个文件`;
});

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

function onLayerDisplayLoaded(key, payload) {
  if (key !== "radar" || !payload) return;
  layerDisplays.value = { ...layerDisplays.value, [key]: payload };
}

function collectTimes(source) {
  const meta = source?.meta || source?.meta_json || source || {};
  const frames = source?.frames || meta.frames || [];
  const candidates = [
    source?.times,
    meta.times,
    source?.weather_info?.times,
    meta.weather_info?.times,
    Array.isArray(frames) ? frames.map((frame) => frame?.time || frame?.time_label).filter(Boolean) : [],
  ];
  return candidates.find((items) => Array.isArray(items) && items.length) || [];
}

function formatAxisTime(value) {
  const text = String(value || "");
  const match = text.match(/T(\d{2}):?(\d{2})?/) || text.match(/\s(\d{2}):?(\d{2})?/);
  if (match) return `${match[1]}:${match[2] || "00"}`;
  return text.slice(0, 16) || text;
}

const radarTimes = computed(() => {
  if (active.value !== "radar") return [];
  const values = collectTimes(parsed.value && parsedLayerKey.value === "radar" ? parsed.value : null)
    .concat(collectTimes(layerDisplays.value.radar))
    .filter(Boolean);
  return [...new Set(values.map(String))];
});

const axisTimes = computed(() => {
  if (active.value === "radar" && radarTimes.value.length > 1) {
    return radarTimes.value.map(formatAxisTime);
  }
  return defaultTimes;
});

const parsedFrameCount = computed(() => {
  if (active.value === "radar") {
    const radarFrameCount = collectTimes(layerDisplays.value.radar).length || collectTimes(parsed.value).length;
    if (radarFrameCount) return radarFrameCount;
  }

  if (!parsed.value || parsedLayerKey.value !== active.value) {
    return defaultTimes.length;
  }

  const pngUrls =
    parsed.value?.png_urls ||
    parsed.value?.meta?.png_urls ||
    parsed.value?.weather_info?.png_urls ||
    parsed.value?.meta_json?.meta?.png_urls ||
    parsed.value?.meta_json?.weather_info?.png_urls ||
    parsed.value?.extra?.png_urls ||
    [];

  if (Array.isArray(pngUrls) && pngUrls.length) {
    return pngUrls.length;
  }

  const parsedTimes =
    parsed.value?.times ||
    parsed.value?.meta?.times ||
    parsed.value?.weather_info?.times ||
    parsed.value?.meta_json?.meta?.times ||
    parsed.value?.meta_json?.weather_info?.times ||
    parsed.value?.extra?.times ||
    [];

  if (Array.isArray(parsedTimes) && parsedTimes.length) {
    return parsedTimes.length;
  }

  return defaultTimes.length;
});

const layerTimeIndex = computed(() => {
  const uiCount = axisTimes.value.length;
  const frameCount = parsedFrameCount.value;

  if (frameCount <= 1 || uiCount <= 1) {
    return 0;
  }

  const uiIndex = clampTimeIndex(tIndex.value);

  // 前端时间轴保持原始 12 个刻度：00时、02时、...、22时。
  // 这里把 12 个 UI 刻度映射到后端实际 N 张 PNG，
  // 例如 N=48 时：00时≈step000，02时≈step004，...，22时≈step047。
  return Math.round((uiIndex / (uiCount - 1)) * (frameCount - 1));
});

function clampTimeIndex(v) {
  const max = Math.max(0, axisTimes.value.length - 1);
  const n = Number.isFinite(Number(v)) ? Math.floor(Number(v)) : 0;
  return Math.min(max, Math.max(0, n));
}

function setTimeIndex(v) {
  tIndex.value = clampTimeIndex(v);
  animPos.value = tIndex.value;
}

function startAnim() {
  clearInterval(animTimer);
  lastTs = Date.now();
  animTimer = setInterval(() => {
    const now = Date.now();
    animPos.value += (now - lastTs) * speed.value / 600;
    lastTs = now;
    if (animPos.value >= axisTimes.value.length) animPos.value = 0;
    const floor = Math.floor(animPos.value);
    if (floor !== tIndex.value) tIndex.value = clampTimeIndex(floor);
  }, 16);
}

watch(playing, v => {
  if (v) {
    animPos.value = tIndex.value;
    startAnim();
  } else {
    clearInterval(animTimer);
    animPos.value = tIndex.value;
  }
});

watch(speed, () => {
  if (playing.value) lastTs = Date.now();
});

watch(tIndex, v => {
  if (!playing.value) animPos.value = clampTimeIndex(v);
});

watch(axisTimes, () => {
  setTimeIndex(Math.min(tIndex.value, axisTimes.value.length - 1));
});

onBeforeUnmount(() => clearInterval(animTimer));

function businessTypeToLayerKey(type) {
  const t = String(type || "").toUpperCase();

  if (t === "GFS" || t === "ECMWF" || t === "GFS/ECMWF") return "grib";
  if (t === "ERA5") return "era5";
  if (t === "CMA") return "cma";
  if (t === "RADAR") return "radar";
  if (t === "HIMAWARI") return "himawari";
  if (t === "WRF") return "wrf";

  return active.value;
}

function normalizeParsedMeta(result) {
  if (!result) return null;

  const panelMeta = result.meta || {};
  const info = result.weather_info || {};

  return {
    file: result.file_name || panelMeta.file || info.file || "—",
    element: panelMeta.element || info.element || "—",
    time: panelMeta.time || info.time || "—",
    level: panelMeta.level || info.level || "—",
    range: panelMeta.range || info.range || "—",
    grid: panelMeta.grid || info.grid || "—",
    missing: panelMeta.missing || info.missing || "—",
    unit: panelMeta.unit || info.unit || "—",
    vars: panelMeta.vars || info.variables || "—",
    steps: panelMeta.steps || info.steps || "—",
    status: panelMeta.status || info.status || "—",
    extent: panelMeta.extent || info.extent || result.extent || null,
    png_url: result.png_url || panelMeta.png_url || info.png_url || null,
    png_urls: result.png_urls || panelMeta.png_urls || info.png_urls || [],
    times: result.times || panelMeta.times || info.times || [],
  };
}

const meta = computed(() => {
  if (parsed.value && parsedLayerKey.value === active.value) {
    return normalizeParsedMeta(parsed.value);
  }
  if (active.value === "radar") {
    const radarDisplay = layerDisplays.value.radar;
    const radarMeta = radarDisplay?.meta || radarDisplay?.weather_info || null;
    if (radarMeta) return radarMeta;
  }
  return infos[active.value];
});

const processing = computed(() => {
  if (parsed.value && parsedLayerKey.value === active.value && parseProcessing.value) {
    return parseProcessing.value;
  }

  return defaultProcessing;
});

const variableOptions = computed(() => {
  const text = meta.value?.element || infos[active.value]?.element || "";
  return String(text).split("、").filter(Boolean);
});

function layerParsed(key) {
  if (parsed.value && parsedLayerKey.value === key) {
    return parsed.value;
  }

  return null;
}

const panes = computed(() => {
  if (layout.value === "1") return sources.filter(s => s.key === active.value);

  if (layout.value === "2") {
    const idx = sources.findIndex(s => s.key === active.value);
    return [sources[idx], sources[(idx + 1) % sources.length]];
  }

  const idx = sources.findIndex(s => s.key === active.value);
  return Array.from({ length: 4 }, (_, i) => sources[(idx + i) % sources.length]);
});

const mapsGrid = computed(() => {
  if (layout.value === "1") return { gridTemplate: "1fr / 1fr" };
  if (layout.value === "2") return { gridTemplate: "1fr / 1fr 1fr" };
  return { gridTemplate: "repeat(2, 1fr) / repeat(2, 1fr)" };
});

const dockTitle = computed(() => ({ file: "选择文件", data: "数据类型", proj: "投影方式", base: "底图图层" }[tool.value]));

function cycleLayout() {
  layout.value = layout.value === "1" ? "2" : layout.value === "2" ? "4" : "1";
  if (layout.value === "1") linked.value = false;
}

function openTool(name) {
  if (dockOpen.value && tool.value === name) dockOpen.value = false;
  else {
    tool.value = name;
    dockOpen.value = true;
  }
}

function selectSource(key) {
  active.value = key;
  parsed.value = null;
  parsedLayerKey.value = null;
  parseProcessing.value = null;
}

function pickFile(i) {
  selected.value = i;
  active.value = files[i].key;
  parsed.value = null;
  parsedLayerKey.value = null;
  parseProcessing.value = null;
}

function choose(e) {
  file.value = Array.from(e.target.files || []);
}

async function parse() {
  const uploadFiles = Array.isArray(file.value) ? file.value : [file.value].filter(Boolean);
  if (!uploadFiles.length) return;

  parseProcessing.value = [
    { step: "上传/读取", state: "本地文件", t: new Date().toLocaleTimeString(), ok: true },
    { step: "解析", state: "解析中", t: "", ok: false, running: true },
    { step: "渲染 PNG", state: "等待", t: "", ok: false },
    { step: "前端展示", state: "等待", t: "", ok: false },
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
      layerDisplays.value = { ...layerDisplays.value, radar: null };
    }

    parsed.value = result;
    parsedLayerKey.value = layerKey;
    active.value = layerKey;

    parseProcessing.value = [
      { step: "上传/读取", state: "成功", t: new Date().toLocaleTimeString(), ok: true },
      { step: "解析", state: "成功", t: new Date().toLocaleTimeString(), ok: true },
      { step: "渲染 PNG", state: "成功", t: new Date().toLocaleTimeString(), ok: true },
      { step: "前端展示", state: "完成", t: "实时", ok: true },
    ];

    setTimeIndex(0);
  } catch (err) {
    console.error("解析失败：", err);

    parseProcessing.value = [
      { step: "上传/读取", state: "成功", t: new Date().toLocaleTimeString(), ok: true },
      { step: "解析", state: err?.message || "失败", t: new Date().toLocaleTimeString(), ok: false },
      { step: "渲染 PNG", state: "未完成", t: "", ok: false },
      { step: "前端展示", state: "未完成", t: "", ok: false },
    ];
  }
}

watch(active, () => {
  const opts = variableOptions.value;
  variable.value = opts[0] || "";
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

.dock { flex-shrink: 0; width: 250px; display: flex; flex-direction: column; gap: 11px; padding: 15px; overflow-y: auto; scrollbar-width: none; }
.dock::-webkit-scrollbar { display: none; }
.dock-head { display: flex; align-items: center; justify-content: space-between; }
.dock-head h3 { margin: 0; font-size: 15px; }
.dock-head .el-icon { cursor: pointer; color: var(--muted); }
.path { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 10px; background: var(--field); color: var(--muted); }
.path input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; outline: none; }
.list-head { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 12px; }
.list-head .el-icon { cursor: pointer; }
.files { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.files li { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 10px; cursor: pointer; background: var(--field); border: 1px solid transparent; transition: 0.15s; }
.files li.sel { border-color: var(--accent); background: var(--accent-soft); }
.files .dot { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--muted); flex-shrink: 0; }
.files li.sel .dot { border-color: var(--accent); background: var(--accent); }
.files b { display: block; font-size: 12px; font-weight: 500; word-break: break-all; }
.files span { font-size: 11px; color: var(--muted); }
.upload { padding: 8px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); font-size: 12px; cursor: pointer; text-align: center; }
.parse { width: 100%; }
.hint { margin: 0; color: var(--muted); font-size: 11px; text-align: center; }
.vars { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vars :deep(.el-select) { width: 100%; }
.pick-hint { margin: 0; color: var(--muted); font-size: 12px; }
.picker { display: flex; flex-direction: column; gap: 6px; }
.picker button { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: 0.15s; }
.picker button:hover { border-color: var(--accent); }
.picker button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.picker button:disabled { opacity: 0.38; cursor: not-allowed; }
.picker button:disabled:hover { border-color: var(--border); background: var(--field); color: var(--text); }
.soon-tag { font-size: 10px; color: var(--muted); }
.picker button .el-icon { font-size: 15px; }

.center { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.maps { flex: 1; min-height: 0; display: grid; gap: 10px; }
.cell { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; }
.cell .map-base { position: absolute; inset: 0; }

.timebar { flex-shrink: 0; padding: 6px 14px 8px; overflow: hidden; }
.tb-head { display: flex; align-items: center; gap: 6px; padding: 0 0 6px; }
.tc-btn { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--muted); cursor: pointer; transition: 0.15s; }
.tc-btn:hover { color: var(--accent); border-color: var(--accent); }
.tc-play { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%; background: var(--accent); color: #fff; font-size: 13px; cursor: pointer; transition: 0.15s; flex-shrink: 0; }
.tc-play:hover { opacity: 0.85; }
.tc-speed { display: flex; gap: 3px; margin: 0 4px; }
.tc-speed button { padding: 3px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--field); color: var(--muted); font: inherit; font-size: 11px; cursor: pointer; transition: 0.15s; }
.tc-speed button:hover { color: var(--text); }
.tc-speed button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.version { margin-top: 18px; padding: 14px; border-radius: 12px; background: var(--field); }
.version p { display: flex; align-items: center; gap: 7px; margin: 0 0 9px; font-size: 12px; color: var(--muted); }
.version p:last-child { margin-bottom: 0; }
.ok { color: var(--ok); }
.run { color: var(--accent); }
</style>
