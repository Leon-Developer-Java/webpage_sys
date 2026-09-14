<template>
  <div class="native-agent-page">
    <iframe
      ref="frame"
      class="native-agent"
      :src="nativeAgentUrl"
      title="AgentScope 原生智能体页面"
      allow="clipboard-read; clipboard-write"
      @load="sendAuthContext"
    ></iframe>

    <el-dialog v-model="icingMapDialog" fullscreen class="icing-model-dialog" :show-close="true" destroy-on-close>
      <AgentIcingModelCard
        v-if="icingMapState"
        :state="icingMapState"
        :expanded="true"
        @expand="icingMapDialog = false"
      />
    </el-dialog>

    <el-dialog v-model="dataVisualizationDialog" fullscreen class="agent-data-dialog" :show-close="true" destroy-on-close>
      <AgentDataVisualization
        v-if="dataVisualizationState"
        :file-uuid="dataVisualizationState.fileUuid"
        :data-type="dataVisualizationState.dataType"
        :name="dataVisualizationState.name"
        :initial-expanded="true"
        @close="dataVisualizationDialog = false"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from "element-plus";
import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getDisplayResources } from "../api";
import AgentDataVisualization from "../components/AgentDataVisualization.vue";
import AgentIcingModelCard from "../components/AgentIcingModelCard.vue";

const nativeAgentUrl = import.meta.env.VITE_AGENTSCOPE_WEB_URL || "http://127.0.0.1:5173/chat";
const nativeAgentOrigin = new URL(nativeAgentUrl).origin;
const agentScopeBase = import.meta.env.VITE_AGENTSCOPE_BASE || "http://127.0.0.1:8012";
const frame = ref(null);
const icingMapDialog = ref(false);
const icingMapState = ref(null);
const dataVisualizationDialog = ref(false);
const dataVisualizationState = ref(null);
const dark = inject("theme", ref(true));
const visualizationTypes = new Set(["CMA", "ERA5", "GFS", "ECMWF", "WRF", "RADAR", "HIMAWARI", "FY3"]);
const fileUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return String(user?.uuid || user?.id || user?.username || "");
  } catch {
    return "";
  }
}

function sendAuthContext() {
  const target = frame.value?.contentWindow;
  const token = localStorage.getItem("token") || "";
  if (!target || !token) return;
  target.postMessage({
    type: "weather-agent-auth-context",
    token,
    serverUrl: agentScopeBase,
    userId: currentUserId(),
    theme: dark.value ? "dark" : "light",
  }, nativeAgentOrigin);
}

async function openDataVisualization(message) {
  const dataType = String(message.dataType || "").toUpperCase();
  const name = String(message.name || "").trim().slice(0, 512);
  let fileUuid = String(message.fileUuid || "").trim();
  if (!visualizationTypes.has(dataType) || (!fileUuid && !name)) return;
  if (fileUuid && !fileUuidPattern.test(fileUuid)) return;
  if (!fileUuid) {
    try {
      const result = await getDisplayResources(dataType, { limit: 100 });
      const matches = (result?.items || []).filter(item => item.original_file_name === name);
      if (matches.length !== 1 || !fileUuidPattern.test(String(matches[0]?.file_uuid || ""))) {
        ElMessage.warning(matches.length > 1
          ? "数据目录中存在同名文件，请先复制文件引用并指定 file_uuid。"
          : "该文件尚未登记到数据总览，暂时只能查看静态解析图。");
        return;
      }
      fileUuid = matches[0].file_uuid;
    } catch (cause) {
      ElMessage.error(cause?.message || "数据目录读取失败，暂时无法打开系统可视化。");
      return;
    }
  }
  dataVisualizationState.value = { fileUuid, dataType, name };
  dataVisualizationDialog.value = true;
}

function handleMessage(event) {
  if (event.origin !== nativeAgentOrigin || event.source !== frame.value?.contentWindow) return;
  if (event.data?.type === "weather-agent-auth-ready") sendAuthContext();
  if (event.data?.type === "weather-agent-open-data-visualization") {
    void openDataVisualization(event.data);
  }
  if (event.data?.type === "weather-agent-open-icing-map") {
    const runId = String(event.data.runId || "");
    if (!/^run_[A-Za-z0-9]+$/.test(runId)) return;
    const selected = event.data.selectedRange;
    const requestedRange = selected?.start && selected?.end
      ? { start: String(selected.start), end: String(selected.end) }
      : null;
    icingMapState.value = {
      run_id: runId,
      result: null,
      winterArchive: String(event.data.archiveId || ""),
      requested_range: requestedRange,
      map_visible: true,
    };
    icingMapDialog.value = true;
  }
}

onMounted(() => window.addEventListener("message", handleMessage));
onBeforeUnmount(() => window.removeEventListener("message", handleMessage));
watch(dark, sendAuthContext);
</script>

<style scoped>
.native-agent-page {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.native-agent {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: #0f172a;
}

.agent-data-dialog :deep(.el-dialog__body) {
  display: grid;
  place-items: start center;
  padding: 12px 20px 24px;
}

.agent-data-dialog :deep(.data-map-card) {
  width: min(1180px, 96vw);
}
</style>
