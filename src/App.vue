<template>
  <div :class="['app', dark ? 'dark' : 'light']">
    <header class="topbar glass">
      <div class="brand">
        <el-icon><Cloudy /></el-icon>
        <b>智慧气象</b>
      </div>
      <nav>
        <router-link to="/">数据总览</router-link>
        <router-link to="/upload">数据上传</router-link>
        <router-link to="/agent">智能体</router-link>
      </nav>
      <div class="top-actions">
        <el-input v-model="search" size="small" placeholder="搜索数据、变量、地区...">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <span class="loc"><el-icon><Location /></el-icon>北京 06-16 10:30</span>
        <span class="status"><i></i>{{ webgl ? "运行正常" : "WebGL2 不可用" }}</span>
        <el-badge :value="12"><el-icon class="bell"><Bell /></el-icon></el-badge>
        <span class="user"><el-avatar :size="26">张</el-avatar>张伟</span>
        <button class="theme" @click="dark = !dark"><el-icon><Moon v-if="dark" /><Sunny v-else /></el-icon></button>
      </div>
    </header>
    <router-view />
  </div>
</template>

<script setup>
import { provide, ref, watch } from "vue";
import { Bell, Cloudy, Location, Moon, Search, Sunny } from "@element-plus/icons-vue";

const dark = ref(true);
const search = ref("");
const webgl = !!document.createElement("canvas").getContext("webgl2");
provide("theme", dark);
provide("webgl", webgl);
watch(dark, v => document.documentElement.classList.toggle("light", !v), { immediate: true });
</script>
