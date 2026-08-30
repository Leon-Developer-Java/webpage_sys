<template>
  <div class="login-page">
    <div class="login-card glass">
      <div class="login-brand">
        <el-icon :size="28"><Cloudy /></el-icon>
        <b>智慧气象</b>
      </div>
      <div class="login-tabs">
        <button type="button" :class="{ on: tab === 'login' }" @click="selectTab('login')">登录</button>
        <button type="button" :class="{ on: tab === 'register' }" @click="selectTab('register')">注册</button>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input
            v-model="activeForm.username"
            :name="tab === 'login' ? 'login_username' : 'register_username'"
            :autocomplete="tab === 'login' ? 'username' : 'off'"
            placeholder="3-32 个字符"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="activeForm.password"
            :name="tab === 'login' ? 'login_password' : 'register_password'"
            type="password"
            show-password
            :autocomplete="tab === 'login' ? 'current-password' : 'new-password'"
            placeholder="至少 8 位"
          />
        </el-form-item>
        <template v-if="tab === 'register'">
          <el-form-item label="确认密码">
            <el-input v-model="activeForm.confirm" name="register_password_confirm" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <div class="login-grid">
            <el-form-item label="姓名（选填）">
              <el-input v-model="activeForm.real_name" maxlength="64" />
            </el-form-item>
            <el-form-item label="单位/部门（选填）">
              <el-input v-model="activeForm.organization" maxlength="128" />
            </el-form-item>
            <el-form-item label="邮箱（选填）">
              <el-input v-model="activeForm.email" maxlength="128" />
            </el-form-item>
            <el-form-item label="手机号（选填）">
              <el-input v-model="activeForm.phone" maxlength="32" />
            </el-form-item>
          </div>
        </template>
        <p v-if="error" class="login-error">{{ error }}</p>
        <el-button type="primary" class="login-btn" :loading="busy" native-type="submit">
          {{ tab === 'login' ? '登 录' : '注册并登录' }}
        </el-button>
      </el-form>
      <p v-if="tab === 'register'" class="login-hint">注册账号可以浏览系统数据并上传气象文件。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Cloudy } from "@element-plus/icons-vue";
import { login, register } from "../api";

const router = useRouter();
const tab = ref("login");
const busy = ref(false);
const error = ref("");
const loginForm = reactive({ username: "", password: "" });
const registerForm = reactive({
  username: "", password: "", confirm: "",
  real_name: "", organization: "", email: "", phone: "",
});
const activeForm = computed(() => tab.value === "login" ? loginForm : registerForm);

function selectTab(nextTab) {
  tab.value = nextTab;
  error.value = "";
}

async function submit() {
  const form = activeForm.value;
  error.value = "";
  if (form.username.length < 3) return (error.value = "用户名至少 3 个字符");
  if (form.password.length < 8) return (error.value = "密码至少 8 位");
  if (tab.value === "register" && form.password !== form.confirm) return (error.value = "两次密码不一致");
  if (tab.value === "register" && form.real_name.length > 64) return (error.value = "姓名不能超过 64 个字符");
  if (tab.value === "register" && form.organization.length > 128) return (error.value = "单位/部门不能超过 128 个字符");
  if (tab.value === "register" && form.email.length > 128) return (error.value = "邮箱不能超过 128 个字符");
  if (tab.value === "register" && form.phone.length > 32) return (error.value = "手机号不能超过 32 个字符");
  busy.value = true;
  try {
    if (tab.value === "login") {
      await login(form.username, form.password);
    } else {
      await register({
        username: form.username, password: form.password,
        real_name: form.real_name || null, organization: form.organization || null,
        email: form.email || null, phone: form.phone || null,
      });
    }
    router.push("/");
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-card {
  width: 420px;
  padding: 28px 36px;
  border-radius: 14px;
}
.login-card :deep(.el-form-item) {
  margin-bottom: 12px;
}
.login-card :deep(.el-form-item__label) {
  margin-bottom: 2px;
}
.login-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: 20px;
  margin-bottom: 18px;
}
.login-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}
.login-tabs button {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.65;
}
.login-tabs button.on {
  background: var(--el-color-primary);
  color: #fff;
  opacity: 1;
}
.login-btn {
  width: 100%;
  margin-top: 4px;
}
.login-error {
  color: var(--el-color-danger);
  font-size: 13px;
  margin: 0 0 8px;
}
.login-hint {
  margin-top: 14px;
  font-size: 12px;
  opacity: 0.6;
}
</style>
