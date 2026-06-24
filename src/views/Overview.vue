<template>
  <div class="ov">
    <aside class="rail glass">
      <button :class="{ on: dockOpen && tool === 'file' }" @click="openTool('file')"><el-icon><FolderOpened /></el-icon><span>文件</span></button>
      <button :class="{ on: dockOpen && tool === 'data' }" @click="openTool('data')"><el-icon><DataAnalysis /></el-icon><span>数据</span></button>
      <button :class="{ on: propsOpen }" @click="propsOpen = !propsOpen"><el-icon><Document /></el-icon><span>信息</span></button>
      <button :class="{ on: dockOpen && tool === 'proj' }" @click="openTool('proj')"><el-icon><Position /></el-icon><span>投影</span></button>
      <button :class="{ on: dockOpen && tool === 'base' }" @click="openTool('base')"><el-icon><MapLocation /></el-icon><span>底图</span></button>
      <button :class="{ on: showGrid }" @click="showGrid = !showGrid"><el-icon><Grid /></el-icon><span>网格</span></button>
      <button @click="cycleLayout">
        <el-icon><Monitor v-if="layout === '1'" /><Operation v-else-if="layout === '2'" /><Grid v-else /></el-icon>
        <span>{{ { '1': '单屏', '2': '双屏', '4': '四屏' }[layout] }}</span>
      </button>
      <button v-if="layout !== '1'" :class="{ on: linked }" @click="linked = !linked">
        <el-icon><Connection /></el-icon><span>联动</span>
      </button>
      <button @click="sceneMode = sceneMode === '2D' ? '3D' : '2D'">
        <b class="dim-icon">{{ sceneMode }}</b><span>视角</span>
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
        <button class="upload" type="button" @click="openLocalPicker">{{ fileLabel || "选择本地文件…" }}</button>
        <input ref="fileInput" type="file" hidden multiple @change="choose" />
        <input ref="directoryInput" type="file" hidden multiple webkitdirectory @change="choose" />
        <el-button type="primary" size="small" class="parse" :loading="parseBusy" :disabled="!filesToParse.length" @click="parse">打开并解析</el-button>
        <p class="hint">{{ parseError || "解析后生成 meta.json + PNG" }}</p>
        <div class="vars">
          <VariableSelect v-model="variable" :options="variableOptions" />
          <VariableSelect v-model="level" :options="levels" />
        </div>
      </template>

      <template v-else-if="tool === 'data'">
        <p class="pick-hint">选择数据类型</p>
        <div class="picker">
          <button v-for="s in sources" :key="s.key" :class="{ on: active === s.key }" @click="active = s.key">
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
            :disabled="!PROJ_SUPPORTED.has(p)"
            @click="projection = p"
          >
            <span>{{ p }}</span>
            <el-icon v-if="projection === p"><Check /></el-icon>
            <span v-else-if="!PROJ_SUPPORTED.has(p)" class="soon-tag">暂不支持</span>
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
        <div :class="['cell', { 'cell-4': layout === '4' }]" v-for="(p, i) in panes" :key="layout + '-' + p.key">
          <MapBase
            :grid="showGrid"
            :dark="dark"
            :basemap="basemap"
            :mode="sceneMode"
            :projection="projection"
            :syncRect="linked && emitterIdx !== i ? syncRect : null"
            @camera-change="cam => onCameraChange(i, cam)"
          >
            <component :is="p.comp" v-bind="layerProps(p.key)" @display-loaded="data => onLayerDisplayLoaded(p.key, data)" />
          </MapBase>
          <div v-if="layout !== '4'" class="map-info">
            <span><b>{{ p.btn }}</b></span>
            <span><b>{{ infos[p.key].file }}</b></span>
            <span>{{ projection }}</span>
          </div>
        </div>
      </div>
      <div class="timebar glass">
        <div class="tb-head">
          <button class="tc-btn" @click="tIndex = 0"><el-icon><DArrowLeft /></el-icon></button>
          <button class="tc-btn" @click="tIndex = Math.max(0, tIndex - 1)"><el-icon><ArrowLeft /></el-icon></button>
          <button class="tc-play" @click="playing = !playing"><el-icon><VideoPause v-if="playing" /><VideoPlay v-else /></el-icon></button>
          <button class="tc-btn" @click="tIndex = Math.min(times.length - 1, tIndex + 1)"><el-icon><ArrowRight /></el-icon></button>
          <button class="tc-btn" @click="tIndex = times.length - 1"><el-icon><DArrowRight /></el-icon></button>
          <div class="tc-speed">
            <button v-for="s in [0.5, 1, 2, 4]" :key="s" :class="{ on: speed === s }" @click="speed = s">{{ s }}x</button>
          </div>
        </div>
        <TimeAxis :times="times" :active="animPos" @update:active="v => { tIndex = v; animPos = v; }" :dark="dark" />
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
import { ArrowLeft, ArrowRight, Check, CircleCheck, Close, Connection, DArrowLeft, DArrowRight, DataAnalysis, Document, FolderOpened, Grid, MapLocation, Monitor, Operation, Position, RefreshRight, VideoPlay, VideoPause } from "@element-plus/icons-vue";
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

const processing = [
  { step: "下载", state: "成功", t: "06-16 09:58", ok: true },
  { step: "解析", state: "成功", t: "06-16 09:59", ok: true },
  { step: "渲染 PNG", state: "成功", t: "06-16 10:02", ok: true },
  { step: "前端展示", state: "服务中", t: "200 ms", ok: false }
];

const versions = ["文件存储：原始数据 + meta.json + PNG", "前端渲染：PNG 显示（后续升级 WebGL2）", "数据处理：后端完成、前端轻展示"];
const projections = ["墨卡托", "等经纬", "兰博托", "罗宾逊", "正弦", "卫星正视"];
const PROJ_SUPPORTED = new Set(["墨卡托", "等经纬"]);
const basemaps = ["矢量底图", "影像底图", "地形晕渲", "全球境界"];
const levels = ["地面", "850hPa", "500hPa", "200hPa"];
const times = ["00时", "02时", "04时", "06时", "08时", "10时", "12时", "14时", "16时", "18时", "20时", "22时"];

const tool = ref("file");
const dockOpen = ref(false);
const showGrid = ref(true);
const layout = ref("1");
const propsOpen = ref(true);
const active = ref("radar");
const selected = ref(0);
const file = ref(null);
const fileInput = ref(null);
const directoryInput = ref(null);
const filesToParse = ref([]);
const parseBusy = ref(false);
const parseError = ref("");
const path = ref("D:/weather_data/radar/");
const projection = ref("等经纬");
const basemap = ref("矢量底图");
const variable = ref("组合反射率 DBZH");
const level = ref("500hPa");
const tIndex = ref(5);
const parsed = ref(null);
const layerDisplays = ref({});
const displayRefresh = ref({ himawari: 0 });
const playing = ref(false);
const speed = ref(1);
const animPos = ref(tIndex.value);
const linked = ref(false);
const syncRect = ref(null);
const sceneMode = ref('2D');
const emitterIdx = ref(-1);
const latestCam = {};
let animTimer = null;
let lastTs = null;

function onCameraChange(i, cam) {
  latestCam[i] = cam;
  if (!linked.value) return;
  emitterIdx.value = i;
  syncRect.value = cam;
}

watch(linked, v => {
  if (v && latestCam[0]) { emitterIdx.value = 0; syncRect.value = latestCam[0]; }
});

function startAnim() {
  clearInterval(animTimer);
  lastTs = Date.now();
  animTimer = setInterval(() => {
    const now = Date.now();
    animPos.value += (now - lastTs) * speed.value / 600;
    lastTs = now;
    if (animPos.value >= times.length) animPos.value = 0;
    const floor = Math.floor(animPos.value);
    if (floor !== tIndex.value) tIndex.value = floor;
  }, 16);
}

watch(playing, v => {
  if (v) { animPos.value = tIndex.value; startAnim(); }
  else { clearInterval(animTimer); animPos.value = tIndex.value; }
});
watch(speed, () => { if (playing.value) lastTs = Date.now(); });
watch(tIndex, v => { if (!playing.value) animPos.value = v; });
onBeforeUnmount(() => clearInterval(animTimer));

const meta = computed(() => {
  const display = layerDisplays.value[active.value];
  if (active.value === "himawari" && display?.meta_json) {
    const firstVariable = display.variables?.[0] || display.meta_json.variables?.[0] || {};
    const grid = display.grid || display.meta_json.grid;
    const extent = display.extent || display.meta_json.extent;
    return {
      file: display.meta_json.scene_id,
      element: firstVariable.name_zh || firstVariable.key,
      time: display.meta_json.observation_time,
      level: "等经纬网格 / EPSG:4326",
      range: Array.isArray(extent) ? `${extent[0]}°E-${extent[2]}°E, ${extent[1]}°N-${extent[3]}°N` : undefined,
      grid: grid ? `${grid.nx} × ${grid.ny}` : undefined,
      unit: firstVariable.display_unit || firstVariable.unit,
      missing: "NaN",
      status: "解析完成",
    };
  }
  return parsed.value || infos[active.value];
});
const fileLabel = computed(() => {
  if (!filesToParse.value.length) return "";
  if (filesToParse.value.length === 1) return filesToParse.value[0].name;
  return `已选择 ${filesToParse.value.length} 个文件`;
});
const variableOptions = computed(() => {
  if (active.value === "himawari") {
    const display = layerDisplays.value.himawari;
    const items = [...(display?.composites || []), ...(display?.variables || [])];
    if (items.length) return items.map(item => item.name_zh || item.key);
  }
  return infos[active.value].element.split("、");
});

const panes = computed(() => {
  if (layout.value === "1") return sources.filter(s => s.key === active.value);
  if (layout.value === "2") {
    const idx = sources.findIndex(s => s.key === active.value);
    return [sources[idx], sources[(idx + 1) % sources.length]];
  }
  return ["radar", "himawari", "era5", "grib"].map(k => sources.find(s => s.key === k));
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
  else { tool.value = name; dockOpen.value = true; }
}

function pickFile(i) {
  selected.value = i;
  active.value = files[i].key;
  parsed.value = null;
}

function choose(e) {
  const selectedFiles = Array.from(e.target.files || []);
  filesToParse.value = selectedFiles;
  file.value = selectedFiles[0] || null;
  parseError.value = "";
  if (selectedFiles.length) {
    const relativePath = selectedFiles[0].webkitRelativePath;
    path.value = relativePath ? `本地目录：${relativePath.split("/")[0]}` : `本地选择：${selectedFiles.length} 个文件`;
  }
}

function openLocalPicker() {
  if (active.value === "himawari") directoryInput.value?.click();
  else fileInput.value?.click();
}

async function parse() {
  if (!filesToParse.value.length) return;
  parseBusy.value = true;
  parseError.value = "";
  try {
    const result = await parseFile(filesToParse.value);
    parsed.value = result.weather_info || result.meta?.weather_info || result.meta || null;
    const typeMap = { Himawari: "himawari", Radar: "radar", ERA5: "era5", GFS: "grib", CMA: "cma", WRF: "wrf" };
    active.value = typeMap[result.business_type] || active.value;
    if (result.business_type === "Himawari") {
      displayRefresh.value = { ...displayRefresh.value, himawari: displayRefresh.value.himawari + 1 };
    }
  } catch (err) {
    parseError.value = err.message || "解析失败";
  } finally {
    parseBusy.value = false;
  }
}

function onLayerDisplayLoaded(key, data) {
  layerDisplays.value = { ...layerDisplays.value, [key]: data };
}

function layerProps(key) {
  if (key === "himawari") return { refreshKey: displayRefresh.value.himawari };
  return {};
}

watch(active, () => { variable.value = variableOptions.value[0]; });
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
.upload { width: 100%; padding: 8px; border: 1px dashed var(--border); border-radius: 10px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; text-align: center; }
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
.map-info {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 9px;
  border-radius: 9px;
  background: var(--glass);
  backdrop-filter: blur(14px) saturate(150%);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  border: 1px solid var(--border);
  font-size: 10px;
  color: var(--muted);
  pointer-events: none;
  width: 180px;
}
.map-info span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.map-info b { color: var(--text); font-weight: 600; }

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
