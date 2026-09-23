<template>
  <section class="agentscope-host">
    <div v-if="config.error" class="config-error glass" role="alert">
      <strong>AgentScope 尚未配置</strong>
      <p>{{ config.error }}</p>
      <code>VITE_AGENTSCOPE_WEB_URL</code>
      <code>VITE_AGENTSCOPE_BASE</code>
    </div>
    <div v-else class="frame-shell">
      <iframe
        ref="agentFrame"
        :class="['agentscope-frame', { ready: frameReady }]"
        :src="config.webUrl"
        title="智慧气象 AgentScope"
        allow="clipboard-read; clipboard-write"
        @load="handleFrameLoad"
      />
      <div v-if="!frameReady" class="frame-status glass" role="status">
        <strong>{{ frameError ? 'AgentScope UI 未就绪' : '正在连接 AgentScope' }}</strong>
        <p>{{ frameError || '等待嵌入页面完成身份握手…' }}</p>
        <code>{{ config.webUrl }}</code>
      </div>
    </div>
  </section>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getToken, getUser } from "../api.js";
import {
  buildAgentScopeAuthContext,
  isTrustedAgentScopeMessage,
  resolveAgentScopeEmbedConfig,
} from "../utils/agentscopeEmbed.js";

const router = useRouter();
const dark = inject("theme", ref(true));
const agentFrame = ref(null);
const frameReady = ref(false);
const frameError = ref("");
let handshakeTimer = null;
const config = resolveAgentScopeEmbedConfig(import.meta.env, {
  origin: window.location.origin,
  dev: import.meta.env.DEV,
});

function sendAuthContext() {
  const frameWindow = agentFrame.value?.contentWindow;
  const token = getToken();
  if (!frameWindow || !token || config.error) return;
  frameWindow.postMessage(
    buildAgentScopeAuthContext({
      token,
      apiUrl: config.apiUrl,
      user: getUser(),
      dark: Boolean(dark.value),
    }),
    config.webOrigin,
  );
}

function clearHandshakeTimer() {
  if (handshakeTimer) window.clearTimeout(handshakeTimer);
  handshakeTimer = null;
}

function handleFrameLoad() {
  if (frameReady.value) {
    sendAuthContext();
    return;
  }
  clearHandshakeTimer();
  frameError.value = "";
  handshakeTimer = window.setTimeout(() => {
    frameError.value = "5173 未返回 AgentScope 嵌入握手；请确认该端口运行的是 AgentScope Web UI，而不是 webpage_sys。";
  }, 2500);
}

function openModelRun(runId) {
  const value = String(runId || "").trim();
  if (!value) return;
  localStorage.setItem("weather-model-last-run", value);
  router.push("/model");
}

function handleAgentScopeMessage(event) {
  if (!isTrustedAgentScopeMessage(event, agentFrame.value?.contentWindow, config.webOrigin)) return;
  const payload = event.data;
  if (payload.type === "weather-agent-auth-ready") {
    clearHandshakeTimer();
    frameError.value = "";
    frameReady.value = true;
    sendAuthContext();
    return;
  }
  if (payload.type === "weather-agent-open-nowcast-map" || payload.type === "weather-agent-open-icing-map") {
    openModelRun(payload.runId);
    return;
  }
  if (payload.type === "weather-agent-open-data-visualization") {
    router.push({
      path: "/",
      query: {
        data_type: String(payload.dataType || ""),
        file_uuid: String(payload.fileUuid || ""),
      },
    });
  }
}

watch(dark, sendAuthContext);
onMounted(() => window.addEventListener("message", handleAgentScopeMessage));
onBeforeUnmount(() => {
  clearHandshakeTimer();
  window.removeEventListener("message", handleAgentScopeMessage);
});
</script>

<style scoped>
.agentscope-host {
  min-width: 0;
  min-height: 0;
  padding: 10px;
  background: var(--bg);
}

.agentscope-frame {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  opacity: 0;
  pointer-events: none;
}

.agentscope-frame.ready {
  opacity: 1;
  pointer-events: auto;
}

.frame-shell {
  position: relative;
  width: 100%;
  height: 100%;
}

.frame-status {
  display: grid;
  place-content: center;
  justify-items: center;
  position: absolute;
  inset: 0;
  gap: 10px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}

.frame-status strong {
  color: var(--text);
  font-size: 18px;
}

.frame-status p {
  max-width: 620px;
  margin: 0;
}

.frame-status code {
  color: var(--accent);
}

.config-error {
  display: grid;
  place-content: center;
  justify-items: center;
  height: 100%;
  gap: 10px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}

.config-error strong {
  color: var(--text);
  font-size: 18px;
}

.config-error p {
  margin: 0 0 8px;
}

.config-error code {
  color: var(--accent);
}
</style>
