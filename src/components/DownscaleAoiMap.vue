<template>
  <section class="aoi-map" aria-label="降尺度发布范围空间工作台">
    <ProjMap projection="等经纬" basemap="影像底图" :grid="true" :vector="true">
      <DownscaleAoiEditor
        :aoi="aoi"
        :buffer-m="bufferM"
        :selected-terrain="selectedTerrain"
        @update:aoi="emit('update:aoi', $event)"
        @invalid="emit('invalid', $event)"
      />
    </ProjMap>
  </section>
</template>

<script setup>
import ProjMap from "./ProjMap.vue";
import DownscaleAoiEditor from "./DownscaleAoiEditor.vue";

defineProps({
  aoi: { type: Object, required: true },
  bufferM: { type: Number, default: 300 },
  selectedTerrain: { type: Object, default: null },
});
const emit = defineEmits(["update:aoi", "invalid"]);
</script>

<style scoped>
.aoi-map{position:relative;min-height:420px;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:#0a1420}@media(max-width:720px){.aoi-map{min-height:360px}}
</style>
