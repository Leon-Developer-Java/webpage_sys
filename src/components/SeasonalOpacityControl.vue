<template>
  <label class="seasonal-opacity-control" @pointerdown.stop @click.stop @wheel.stop>
    <span>降水图层不透明度</span>
    <input type="range" min="0" max="100" step="1" :value="modelValue" aria-label="降水图层不透明度"
      @input="$emit('update:modelValue',Number($event.target.value))"/>
    <output>{{ modelValue }}%</output>
  </label>
</template>
<script setup>
defineProps({modelValue:{type:Number,default:65}});
defineEmits(['update:modelValue']);
</script>
<style scoped>
.seasonal-opacity-control {display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--text);pointer-events:auto;}
input {width:130px;max-width:100%;margin:0;accent-color:var(--accent);cursor:pointer;}
output {min-width:34px;text-align:right;font-variant-numeric:tabular-nums;}
</style>
