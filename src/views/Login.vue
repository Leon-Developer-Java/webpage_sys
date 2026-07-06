<template>
  <div class="login-page">
    <div class="login-card glass">
      <div class="login-brand">
        <el-icon :size="28"><Cloudy /></el-icon>
        <b>智慧气象</b>
      </div>
      <div class="login-tabs">
        <button :class="{ on: tab === 'login' }" @click="tab = 'login'">登录</button>
        <button :class="{ on: tab === 'register' }" @click="tab = 'register'">注册</button>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="3-32 个字符" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <template v-if="tab === 'register'">
          <el-form-item label="确认密码">
            <el-input v-model="form.confirm" type="password" show-password />
          </el-form-item>
          <div class="login-grid">
            <el-form-item label="姓名（选填）">
              <el-input v-model="form.real_name" />
            </el-form-item>
            <el-form-item label="单位（选填）">
              <el-input v-model="form.organization" />
            </el-form-item>
            <el-form-item label="邮箱（选填）">
              <el-input v-model="form.email" />
            </el-form-item>
            <el-form-item label="电话（选填）">
              <el-input v-model="form.phone" />
            </el-form-item>
          </div>
        </template>
        <p v-if="error" class="login-error">{{ error }}</p>
        <el-button type="primary" class="login-btn" :loading="busy" native-type="submit">
          {{ tab === 'login' ? '登 录' : '注册并登录' }}
        </el-button>
      </el-form>
      <p v-if="tab === 'register'" class="login-hint">注册账号默认为普通用户（仅可浏览数据），上传/智能体权限请联系管理员开通。</p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Cloudy } from "@element-plus/icons-vue";
import { login, register } from "../api";

const router = useRouter();
const tab = ref("login");
const busy = ref(false);
const error = ref("");
const form = reactive({
  username: "", password: "", confirm: "",
  real_name: "", organization: "", email: "", phone: "",
});

async function submit() {
  error.value = "";
  if (form.username.length < 3) return (error.value = "用户名至少 3 个字符");
  if (form.password.length < 8) return (error.value = "密码至少 8 位");
  if (tab.value === "register" && form.password !== form.confirm) return (error.value = "两次密码不一致");
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
