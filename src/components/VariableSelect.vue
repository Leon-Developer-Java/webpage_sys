<template>
  <el-select :model-value="modelValue" size="small" @update:model-value="(v) => emit('update:modelValue', v)">
    <el-option v-for="item in options" :key="item" :label="item" :value="item" />
  </el-select>
</template>

<script setup>
defineProps({ modelValue: String, options: { type: Array, default: () => [] } });
const emit = defineEmits(["update:modelValue"]);
</script>
