<template>
  <div class="pt">
    <div class="pt-bar glass">
      <button
        v-for="p in projList" :key="p"
        :class="{ on: projection === p }"
        @click="projection = p"
      >{{ p }}</button>
      <span class="pt-sep"></span>
      <button
        v-for="b in baseList" :key="b"
        :class="['pt-base', { on: baseType === b }]"
        @click="baseType = b"
      >{{ b }}</button>
      <span class="pt-sep"></span>
      <label class="pt-chk"><input type="checkbox" v-model="vector" />矢量边界</label>
      <label class="pt-chk"><input type="checkbox" v-model="grid" />经纬网</label>
      <label class="pt-chk"><input type="checkbox" v-model="darkTheme" />暗色</label>
    </div>
    <div class="pt-map">
      <ProjMap
        :projection="projection"
        :tile-url="tileUrl"
        :vector="vector"
        :grid="grid"
        :dark="darkTheme"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import ProjMap from "../components/ProjMap.vue";

const projList = ["等经纬", "墨卡托", "正弦", "罗宾逊", "兰博托", "卫星正视", "北极", "南极"];
const baseList = ["矢量底图", "影像底图", "地形晕渲", "全球境界", "无"];

const TILE_URLS = {
  "矢量底图": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  "影像底图": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "地形晕渲": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
  "全球境界": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
};

const projection = ref("等经纬");
const baseType = ref("影像底图");
const vector = ref(true);
const grid = ref(true);
const darkTheme = ref(true);

const tileUrl = computed(() => TILE_URLS[baseType.value] || "");
</script>

<style scoped>
.pt { display: flex; flex-direction: column; gap: 10px; padding: 10px; height: 100%; min-height: 0; }
.pt-bar { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; }
.pt-bar button { padding: 6px 13px; border: 1px solid var(--border); border-radius: 9px; background: var(--field); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: 0.15s; }
.pt-bar button:hover { border-color: var(--accent); }
.pt-bar button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.pt-base.on { border-color: var(--ok); color: var(--ok); background: rgba(52, 211, 153, 0.12); }
.pt-sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 4px; }
.pt-chk { display: flex; align-items: center; gap: 5px; margin-left: 4px; font-size: 12px; color: var(--muted); cursor: pointer; }
.pt-map { flex: 1; min-height: 0; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
</style>
