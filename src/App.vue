<template>
  <div :class="['app', dark ? 'dark' : 'light']">
    <header v-if="!standalonePage" class="topbar glass">
      <div class="brand">
        <el-icon><Cloudy /></el-icon>
        <b>智慧气象</b>
      </div>
      <nav v-if="user">
        <router-link to="/">数据总览</router-link>
        <router-link to="/era5-history">ERA5 历史</router-link>
        <router-link v-if="user.role >= 2" to="/upload">数据上传</router-link>
        <router-link v-if="user.role >= 2" to="/agent">智能体</router-link>
        <router-link v-if="user.role >= 2" to="/model">专用模型调用</router-link>
        <router-link v-if="user.role >= 2" to="/wrf">WRF 工作台</router-link>
      </nav>
      <div class="top-actions">
        <span class="status"><i></i>{{ webgl ? "运行正常" : "WebGL2 不可用" }}</span>
        <el-badge :value="12"><el-icon class="bell"><Bell /></el-icon></el-badge>
        <el-dropdown v-if="user" @command="onUserCommand">
          <span class="user"><el-avatar :size="26">{{ (user.real_name || user.username)[0] }}</el-avatar>{{ user.real_name || user.username }}</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="theme" @click="dark = !dark"><el-icon><Moon v-if="dark" /><Sunny v-else /></el-icon></button>
      </div>
    </header>
    <router-view />

    <el-dialog v-model="pwdVisible" title="修改密码" width="360px">
      <el-form v-if="pwdVisible" label-position="top">
        <el-form-item label="旧密码">
          <el-input v-model="pwd.old" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="新密码（至少 8 位）">
          <el-input v-model="pwd.next" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdBusy" @click="submitPassword">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, provide, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { Bell, Cloudy, Moon, Sunny } from "@element-plus/icons-vue";
import { changePassword, getUser, logout } from "./api";

const route = useRoute();
const standalonePage = computed(() => route.path === "/login");
const user = computed(() => (route.path, getUser()));
const pwdVisible = ref(false);
const pwdBusy = ref(false);
const pwd = reactive({ old: "", next: "" });

function onUserCommand(command) {
  if (command === "logout") logout();
  if (command === "password") {
    pwd.old = "";
    pwd.next = "";
    pwdVisible.value = true;
  }
}

async function submitPassword() {
  if (pwd.next.length < 8) return ElMessage.error("新密码至少 8 位");
  pwdBusy.value = true;
  try {
    await changePassword(pwd.old, pwd.next);
    pwdVisible.value = false;
    ElMessage.success("密码已修改");
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    pwdBusy.value = false;
  }
}

const dark = ref(localStorage.getItem("zhihui-theme") !== "light");
const webgl = !!document.createElement("canvas").getContext("webgl2");
provide("theme", dark);
provide("webgl", webgl);
watch(dark, value => {
  document.documentElement.classList.toggle("dark", value);
  document.documentElement.classList.toggle("light", !value);
  document.documentElement.style.colorScheme = value ? "dark" : "light";
  localStorage.setItem("zhihui-theme", value ? "dark" : "light");
}, { immediate: true });
</script>
