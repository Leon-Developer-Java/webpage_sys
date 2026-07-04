<template>
  <ProjMap v-bind="$attrs">
    <slot />
  </ProjMap>
</template>

<script>
export default { inheritAttrs: false };
</script>

<script setup>
import ProjMap from "./ProjMap.vue";
</script>
