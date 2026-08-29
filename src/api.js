import { ElMessage } from "element-plus";
import router from "./router";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const UPLOAD_BASE = import.meta.env.VITE_UPLOAD_BASE ?? "http://127.0.0.1:8003";
const AGENT_BASE = import.meta.env.VITE_AGENT_BASE ?? "http://127.0.0.1:8004";
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE ?? "http://127.0.0.1:8005";
const MODEL_BASE = import.meta.env.VITE_MODEL_BASE ?? "http://127.0.0.1:8006";
const ERA5_HISTORY_BASE = import.meta.env.VITE_ERA5_HISTORY_API_BASE
  ?? (import.meta.env.DEV ? "http://127.0.0.1:8010" : "");
const WRF_BASE = import.meta.env.VITE_WRF_BASE ?? "http://127.0.0.1:8007";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export function getToken() {
  return localStorage.getItem("token") || "";
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function saveSession(data) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (router.currentRoute.value.path !== "/login") router.push("/login");
}

async function authRequest(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method: path.includes("password") ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok || payload.code !== 0) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : payload.message || "请求失败");
  }
  return payload.data;
}

export async function login(username, password) {
  const data = await authRequest("/api/auth/login", { username, password });
  saveSession(data);
  return data.user;
}

export async function register(form) {
  await authRequest("/api/auth/register", form);
  return login(form.username, form.password);
}

export async function changePassword(oldPassword, newPassword) {
  const data = await authRequest("/api/auth/me/password", { old_password: oldPassword, new_password: newPassword }, getToken());
  if (data?.token) saveSession(data);
  return data;
}

function tokenPayload(token) {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

let refreshPromise = null;

async function ensureFreshToken() {
  const token = getToken();
  const payload = token && tokenPayload(token);
  if (!payload?.iat || !payload?.exp) return;
  const now = Date.now() / 1000;
  if (now - payload.iat < (payload.exp - payload.iat) / 2) return;
  refreshPromise ??= fetch(`${AUTH_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async res => {
      const data = await res.json();
      if (!res.ok || data.code !== 0) throw new Error("refresh 失败");
      saveSession(data.data);
    })
    .catch(() => logout())
    .finally(() => { refreshPromise = null; });
  await refreshPromise;
}

export async function authedFetch(url, options = {}) {
  await ensureFreshToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) logout();
  if (res.status === 403) ElMessage.warning("权限不足，请联系管理员开通");
  return res;
}

export function withToken(url) {
  const value = String(url || "");
  if (!value.includes("/data/") && !value.includes("/outputs/")) return value;
  if (/(?:[?&])token=/.test(value)) return value;
  return `${value}${value.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken())}`;
}

function apiError(payload, fallback = "请求失败") {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail?.message === "string") return detail.message;
  if (Array.isArray(detail)) {
    const messages = detail.map(item => {
      const field = Array.isArray(item?.loc) ? item.loc.filter(part => part !== "body").join(".") : "";
      return `${field ? `${field}：` : ""}${item?.msg || "参数不合法"}`;
    }).filter(Boolean);
    if (messages.length) return messages.join("；");
  }
  if (typeof payload?.message === "string" && payload.message !== "success") return payload.message;
  return fallback;
}

async function wrfRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let response = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await authedFetch(`${WRF_BASE}${path}`, options);
      break;
    } catch (cause) {
      if (attempt + 1 < attempts) {
        await new Promise(resolve => globalThis.setTimeout(resolve, 350));
        continue;
      }
      const endpoint = WRF_BASE || globalThis.location?.origin || "http://127.0.0.1:8007";
      throw new Error(`WRF 服务暂时不可达（${endpoint}），服务可能正在重启或连接暂时中断`, { cause });
    }
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`WRF 服务返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload?.code !== 0) {
    throw new Error(apiError(payload, `WRF 服务请求失败（HTTP ${response.status}）`));
  }
  return payload.data;
}

export function wrfAssetUrl(path) {
  const value = String(path || "");
  if (!value || /^(data:|blob:)/i.test(value)) return value;
  const base = WRF_BASE || globalThis.location?.origin || "http://127.0.0.1:8007";
  const absolute = /^https?:/i.test(value) ? value : new URL(value, `${base.replace(/\/$/, "")}/`).toString();
  return withToken(absolute);
}

export function getWrfHealth() {
  return wrfRequest("/api/health");
}

export function getWrfOptions() {
  return wrfRequest("/api/wrf/options");
}

export function authenticateWrfHpc(password) {
  return wrfRequest("/api/wrf/hpc/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function getWrfDataStatus(dataSource = "gfs") {
  return wrfRequest(`/api/wrf/data-status?data_source=${encodeURIComponent(dataSource || "gfs")}`);
}

export function triggerWrfGfsDownload(cycle) {
  return wrfRequest("/api/wrf/gfs/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cycle }),
  });
}

export function syncLatestWrfGfs() {
  return wrfRequest("/api/wrf/gfs/sync-latest", { method: "POST" });
}

export function cleanupWrfGfs(paths) {
  return wrfRequest("/api/wrf/gfs/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, confirm: true }),
  });
}

export function triggerWrfForcingDownload(dataSource, cycle) {
  return wrfRequest(`/api/wrf/forcing/${encodeURIComponent(dataSource)}/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cycle }),
  });
}

export function syncLatestWrfForcing(dataSource) {
  return wrfRequest(`/api/wrf/forcing/${encodeURIComponent(dataSource)}/sync-latest`, { method: "POST" });
}

export function cleanupWrfForcing(dataSource, paths) {
  return wrfRequest(`/api/wrf/forcing/${encodeURIComponent(dataSource)}/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, confirm: true }),
  });
}

export function createWrfRecommendation(input) {
  return wrfRequest("/api/wrf/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getWrfRecommendation(jobId) {
  return wrfRequest(`/api/wrf/recommendations/${encodeURIComponent(jobId)}`);
}

export function createWrfTask(input) {
  return wrfRequest("/api/wrf/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function listWrfTasks(limit = 50) {
  const data = await wrfRequest(`/api/wrf/tasks?limit=${encodeURIComponent(limit)}`);
  return data?.items ?? [];
}

export function getWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}`);
}

export function getWrfTaskLogs(taskId, after = 0, attemptNo = null) {
  const attempt = attemptNo == null ? "" : `&attempt_no=${encodeURIComponent(attemptNo)}`;
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/logs?after=${encodeURIComponent(after)}${attempt}`);
}

export function cancelWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
}

export function getWrfTaskRestartPlan(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/restart-plan`);
}

export function restartWrfTask(taskId, request, attemptNo) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, confirm_task_id: taskId, confirm_attempt: attemptNo }),
  });
}

export function resumeWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" });
}

export function retryWrfTaskOutputs(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/retry-outputs`, { method: "POST" });
}

export function renderPartialWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/render-partial`, { method: "POST" });
}

export function deleteWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm_task_id: taskId }),
  });
}

export function getWrfTaskResult(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/result`);
}

export function getWrfDisplay(taskId = "") {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  return wrfRequest(`/api/wrf/display${query}`);
}

async function era5HistoryRequest(path, options = {}) {
  const response = await fetch(`${ERA5_HISTORY_BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.code !== 0) {
    const error = new Error(apiError(payload, `ERA5 历史服务请求失败（HTTP ${response.status}）`));
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

export function era5HistoryAssetUrl(path) {
  const value = String(path || "");
  if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
  return new URL(value, `${ERA5_HISTORY_BASE.replace(/\/$/, "")}/`).toString();
}

export async function getEra5HistoryStatus({ fresh = false } = {}) {
  return era5HistoryRequest(`/api/era5/history/status${fresh ? `?t=${Date.now()}` : ""}`);
}

export async function getEra5HistoryDisplay({ fresh = false } = {}) {
  return era5HistoryRequest(`/api/era5/history/display${fresh ? `?t=${Date.now()}` : ""}`);
}

export async function triggerEra5HistoryUpdate() {
  return era5HistoryRequest("/api/era5/history/run", { method: "POST" });
}

async function modelRequest(path, options = {}) {
  let response;
  try {
    response = await authedFetch(`${MODEL_BASE}${path}`, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("无法连接模型服务，请确认 backend_model 已启动并监听 8006 端口。");
    }
    throw error;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`模型服务返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload?.code !== 0) {
    throw new Error(apiError(payload, `模型服务请求失败（HTTP ${response.status}）`));
  }
  return payload.data;
}

export function modelAssetUrl(path) {
  const value = String(path || "");
  if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
  const base = MODEL_BASE || globalThis.location?.origin || "http://127.0.0.1:8006";
  return new URL(value, `${base.replace(/\/$/, "")}/`).toString();
}

export async function getModelHealth() {
  return modelRequest("/api/health");
}

export async function getDedicatedModels() {
  const data = await modelRequest("/api/models");
  return data?.items ?? [];
}

export async function getModelRun(runId) {
  return modelRequest(`/api/model-runs/${encodeURIComponent(runId)}`);
}

export async function getModelRunResult(runId) {
  const result = await modelRequest(`/api/model-runs/${encodeURIComponent(runId)}/result`);
  return {
    ...result,
    metrics_url: modelAssetUrl(result?.metrics_url),
    lead_metrics_url: modelAssetUrl(result?.lead_metrics_url),
    icing_forecast_url: modelAssetUrl(result?.icing_forecast_url),
    frames: (result?.frames ?? []).map(frame => ({
      ...frame,
      truth_url: modelAssetUrl(frame.truth_url),
      prediction_url: modelAssetUrl(frame.prediction_url),
      raster_url: modelAssetUrl(frame.raster_url),
      grid_url: modelAssetUrl(frame.grid_url),
    })),
  };
}

export async function getModelMetrics(url) {
  const response = await authedFetch(modelAssetUrl(url));
  const payload = await response.json();
  if (!response.ok) throw new Error(apiError(payload, "预报指标读取失败"));
  return payload;
}

export async function cancelModelRun(runId) {
  return modelRequest(`/api/model-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

export async function getIcingGrid(url) {
  const response = await authedFetch(modelAssetUrl(url));
  const payload = await response.json();
  if (!response.ok) throw new Error(apiError(payload, "覆冰网格查询数据读取失败"));
  return Array.isArray(payload) ? payload : [];
}

export async function submitGfsIcingRun() {
  return modelRequest("/api/model-runs/icing-gfs", { method: "POST" });
}

// 大文件上传使用 XHR 获取真实上传进度；任务入队后由状态接口继续异步轮询。
export async function submitModelRun({ modelId, runMode = "forecast", files, startTimestamp, onUploadProgress = () => {} }) {
  await ensureFreshToken();
  const body = new FormData();
  body.append("model_id", modelId);
  body.append("run_mode", runMode);
  if (startTimestamp) body.append("start_timestamp", startTimestamp);
  Array.from(files || []).forEach(file => body.append("files", file, file.name));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${MODEL_BASE}/api/model-runs`);
    xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onUploadProgress((event.loaded / event.total) * 100);
    };
    xhr.onerror = () => reject(new Error("无法连接模型服务，请确认 backend_model 已启动。"));
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText || "null");
      } catch {
        reject(new Error(`模型服务返回了无法解析的响应（HTTP ${xhr.status}）`));
        return;
      }
      if (xhr.status === 401) logout();
      if (xhr.status === 403) ElMessage.warning("权限不足，请联系管理员开通。");
      if (xhr.status < 200 || xhr.status >= 300 || payload?.code !== 0) {
        reject(new Error(apiError(payload, `任务提交失败（HTTP ${xhr.status}）`)));
        return;
      }
      onUploadProgress(100);
      resolve(payload.data);
    };
    xhr.send(body);
  });
}

// 与智能体后端的 NDJSON 流式对话：逐行解析，产出事件对象
// 事件类型：{type:"text",value} | {type:"tool",name,status,label,progress,result}
//          | {type:"image",url,caption} | {type:"done"} | {type:"error",message}
export async function* chatStream(messages, context) {
  const res = await authedFetch(`${AGENT_BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail);
}

// WRF Agent workflow: the Agent service validates/forwards the current user's
// token, while backend_wrf remains the authority that validates and owns tasks.
async function agentJson(path, options = {}) {
  const response = await authedFetch(`${AGENT_BASE}${path}`, options);
  const payload = await response.json();
  if (!response.ok || payload?.code !== 0) throw new Error(apiError(payload, `智能体请求失败（HTTP ${response.status}）`));
  return payload.data;
}

export function createAgentWrfConfirmation(request) {
  return agentJson("/api/agent/wrf/confirmations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }),
  });
}

export function submitAgentWrfTask(request) {
  return agentJson("/api/agent/wrf/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }),
  });
}

export function getAgentWrfDiagnosis(taskId) {
  return agentJson(`/api/agent/wrf/tasks/${encodeURIComponent(taskId)}/diagnosis`);
}

function abortError() {
  return new DOMException("上传已取消", "AbortError");
}

async function checkedJson(response, fallback) {
  let payload = null;
  try { payload = await response.json(); } catch { /* 由下面统一提示 */ }
  if (!response.ok || payload?.code !== 0) {
    const error = new Error(apiError(payload, `${fallback}（HTTP ${response.status}）`));
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

async function agentRequest(path, options = {}) {
  let response;
  try {
    response = await authedFetch(`${AGENT_BASE}${path}`, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("无法连接智能体服务，请确认 backend_agent 已启动并监听 8004 端口。");
    }
    throw error;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`智能体服务返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload?.code !== 0) {
    throw new Error(apiError(payload, `智能体服务请求失败（HTTP ${response.status}）`));
  }
  return payload.data;
}

export async function submitAgentNowcast(fileUuids) {
  return agentRequest("/api/agent/nowcast/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_uuids: Array.from(fileUuids || []) }),
  });
}

export async function getAgentNowcastRun(runId) {
  return agentRequest(`/api/agent/nowcast/runs/${encodeURIComponent(runId)}`);
}

export async function getAgentNowcastResult(runId) {
  const result = await agentRequest(`/api/agent/nowcast/runs/${encodeURIComponent(runId)}/result`);
  return {
    ...result,
    frames: (result?.frames ?? []).map(frame => ({
      ...frame,
      prediction_url: modelAssetUrl(frame.prediction_url),
    })),
  };
}

// 分片上传 + 断点续传。文件唯一标识用组合键（文件名+大小+修改时间）。
export async function uploadFileResumable(
  file,
  dataType,
  onProgress = () => {},
  { signal, collectionUuid = null, collectionRole = null } = {},
) {
  const baseFileId = `${file.name}-${file.size}-${file.lastModified}`;
  const fileId = collectionUuid
    ? `${baseFileId}-${collectionUuid}-${collectionRole || "member"}`
    : baseFileId;
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  if (signal?.aborted) throw abortError();
  const statusResponse = await authedFetch(
    `${UPLOAD_BASE}/api/upload/status?file_id=${encodeURIComponent(fileId)}`,
    { signal },
  );
  const status = await checkedJson(statusResponse, "上传状态读取失败");
  if (status.completed) {
    onProgress(100);
    return status.completed;
  }
  const done = new Set(status.uploaded ?? []);

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw abortError();
    if (!done.has(i)) {
      const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const fd = new FormData();
      fd.append("file_id", fileId);
      fd.append("chunk_index", i);
      fd.append("total_chunks", total);
      fd.append("chunk", blob);
      const response = await authedFetch(`${UPLOAD_BASE}/api/upload/chunk`, { method: "POST", body: fd, signal });
      await checkedJson(response, `分片 ${i} 上传失败`);
    }
    onProgress(((i + 1) / total) * 100);
  }

  if (signal?.aborted) throw abortError();
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      file_name: file.name,
      total_chunks: total,
      data_type: dataType,
      collection_uuid: collectionUuid,
      collection_role: collectionRole,
    }),
    signal,
  });
  return checkedJson(response, "合并失败");
}

export async function prepareUploadCollections(files, dataType, { signal } = {}) {
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/collections/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data_type: dataType,
      files: Array.from(files || []).map(file => ({
        file_id: `${file.name}-${file.size}-${file.lastModified}`,
        file_name: file.name,
        file_size: file.size,
        last_modified: file.lastModified || 0,
      })),
    }),
    signal,
  });
  return checkedJson(response, "卫星集合准备失败");
}

export async function getUploadCollections({ limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/collections?${params}`);
  return checkedJson(response, "卫星集合列表读取失败");
}

export async function getUploadCollection(collectionUuid) {
  const response = await authedFetch(
    `${UPLOAD_BASE}/api/upload/collections/${encodeURIComponent(collectionUuid)}`,
  );
  return checkedJson(response, "卫星集合详情读取失败");
}

export async function retryUploadCollection(collectionUuid) {
  const response = await authedFetch(
    `${UPLOAD_BASE}/api/upload/collections/${encodeURIComponent(collectionUuid)}/retry`,
    { method: "POST" },
  );
  return checkedJson(response, "卫星集合重试失败");
}

export async function uploadFilesResumable(fileOrFiles, dataType, onProgress = () => {}, options = {}) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const totalBytes = Math.max(1, files.reduce((sum, file) => sum + file.size, 0));
  const progress = new Map(files.map(file => [file, 0]));
  const receipts = new Array(files.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      const file = files[index];
      receipts[index] = await uploadFileResumable(file, dataType, value => {
        progress.set(file, value);
        const loaded = files.reduce((sum, item) => sum + item.size * (progress.get(item) || 0) / 100, 0);
        onProgress(Math.min(100, loaded / totalBytes * 100));
      }, options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
  onProgress(100);
  return receipts;
}

export async function getUploadTasks({ limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/tasks?${params}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "解析队列读取失败"));
  }
  return payload.data;
}

export async function getUploadTask(fileUuid) {
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/tasks/${encodeURIComponent(fileUuid)}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "解析状态读取失败"));
  }
  return payload.data;
}

export async function retryUploadTask(fileUuid) {
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/tasks/${encodeURIComponent(fileUuid)}/retry`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "任务重试失败"));
  }
  return payload.data;
}

async function catalogRequest(path, options = {}) {
  let response;
  try {
    response = await authedFetch(`${UPLOAD_BASE}/api/catalog${path}`, options);
  } catch (cause) {
    throw new Error(`数据目录服务无法连接（${UPLOAD_BASE || location.origin}），请检查目录服务是否启动。`, { cause });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`数据目录服务返回格式错误（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, `数据目录请求失败（HTTP ${response.status}）`));
  }
  return payload.data;
}

export async function getDisplayResources(dataType, { limit = 100, offset = 0, timeStart = "", timeEnd = "" } = {}) {
  const params = new URLSearchParams({
    data_type: dataType,
    limit: String(limit),
    offset: String(offset),
  });
  if (timeStart) params.set("time_start", timeStart);
  if (timeEnd) params.set("time_end", timeEnd);
  return catalogRequest(`/resources?${params}`);
}

export async function getDisplayResource(resource) {
  const fileUuids = Array.isArray(resource?.file_uuids) ? resource.file_uuids : [];
  if (fileUuids.length >= 1) {
    return catalogRequest("/series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_uuids: fileUuids }),
    });
  }
  const fileUuid = typeof resource === "string" ? resource : resource?.file_uuid;
  return catalogRequest(`/resources/${encodeURIComponent(fileUuid)}`);
}

export async function ingestUploadedFiles(receipts, dataType, { action = "parse", overwrite = false } = {}) {
  const response = await authedFetch(`${API_BASE}/api/files/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tickets: receipts.map(item => item.ticket),
      business_type: dataType,
      action,
      overwrite,
    }),
  });
  return checkedJson(response, action === "raw" ? "raw 入库失败" : "解析失败");
}

function inferredUploadType(files) {
  const names = files.map(file => String(file?.name || ""));
  if (names.every(name => /FY3|FY-3/i.test(name))) return "FY3";
  if (names.every(name => /^HS_H.*\.DAT(?:\.bz2)?$/i.test(name) || /Himawari|HSD/i.test(name))) return "Himawari";
  const name = names[0] || "";
  if (/ECMWF|\bIFS\b/i.test(name)) return "ECMWF";
  const key = displayKeyFromFileName(name);
  return ({ grib: "GFS", radar: "Radar", era5: "ERA5", wrf: "WRF", cma: "CMA", fy3: "FY3", himawari: "Himawari" })[key] || "";
}

async function directFileRequest(path, files, dataType, onProgress, { signal } = {}) {
  await ensureFreshToken();
  const body = new FormData();
  Array.from(files || []).forEach(file => body.append("files", file, file.name));
  body.append("business_type", dataType);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cancel = () => xhr.abort();
    xhr.open("POST", `${API_BASE}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onerror = () => reject(new Error("无法连接数据处理服务，请确认 backend_system 已启动。"));
    xhr.onabort = () => reject(abortError());
    xhr.onload = () => {
      signal?.removeEventListener("abort", cancel);
      let payload = null;
      try { payload = JSON.parse(xhr.responseText || "null"); } catch {
        reject(new Error(`数据处理服务返回了无法解析的响应（HTTP ${xhr.status}）`));
        return;
      }
      if (xhr.status === 401) logout();
      if (xhr.status < 200 || xhr.status >= 300 || payload?.code !== 0) {
        reject(new Error(apiError(payload, `文件处理失败（HTTP ${xhr.status}）`)));
        return;
      }
      onProgress(100);
      resolve(payload.data);
    };
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    xhr.send(body);
  });
}

export async function parseFile(fileOrFiles, onProgress = () => {}, options = {}) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const dataType = options.dataType || inferredUploadType(files);
  if (!dataType) throw new Error("无法自动识别数据类型，请前往数据上传页选择类型。");
  return directFileRequest("/api/files/parse", files, dataType, onProgress, options);
}

export async function uploadRawFiles(fileOrFiles, dataType, onProgress = () => {}, options = {}) {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  return directFileRequest("/api/files/raw-upload", files, dataType, onProgress, options);
}

export async function getRawScenes(dataType) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/raw-scenes`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "raw 场景读取失败");
  }
  return payload.data;
}

export async function updateDisplayFromRaw(dataType, { force = false, sceneIds = [] } = {}) {
  const params = new URLSearchParams({ force: force ? "true" : "false" });
  Array.from(new Set(sceneIds || [])).filter(Boolean).forEach(sceneId => {
    params.append("scene_id", sceneId);
  });
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/update?${params}`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "raw 解析失败");
  }
  const result = payload.data || {};
  const failures = Array.isArray(result.results)
    ? result.results.filter(item => item?.status === "error")
    : [];
  if (failures.length || Number(result.failed || 0) > 0) {
    const detail = failures
      .map(item => `${item.scene_id || "未知场景"}：${item.error || "解析失败"}`)
      .join("；");
    throw new Error(detail || `${dataType} raw 解析失败`);
  }
  return result;
}

export async function startSatelliteParseTask(dataType, sceneIds, { force = false } = {}) {
  const params = new URLSearchParams({ force: force ? "true" : "false" });
  Array.from(new Set(sceneIds || [])).filter(Boolean).forEach(sceneId => {
    params.append("scene_id", sceneId);
  });
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/parse-tasks?${params}`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, `${dataType} 解析任务创建失败`));
  }
  return payload.data;
}

export async function getSatelliteParseTask(dataType, taskId) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/parse-tasks/${encodeURIComponent(taskId)}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, `${dataType} 解析任务读取失败`));
  }
  return payload.data;
}

export async function listSatelliteParseTasks(dataType, { activeOnly = false } = {}) {
  const params = new URLSearchParams({ active_only: activeOnly ? "true" : "false" });
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/parse-tasks?${params}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, `${dataType} 解析任务列表读取失败`));
  }
  return payload.data;
}

export async function cancelSatelliteParseTask(dataType, taskId) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/parse-tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(apiError(payload, "取消解析任务失败"));
  return payload.data;
}

export async function retrySatelliteParseTask(dataType, taskId) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/parse-tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) throw new Error(apiError(payload, "重试解析任务失败"));
  return payload.data;
}

export async function waitForSatelliteParseTask(
  dataType, taskId,
  { onProgress = () => {}, intervalMs = 1000, timeoutMs = 60 * 60 * 1000 } = {},
) {
  const startedAt = Date.now();
  while (true) {
    const task = await getSatelliteParseTask(dataType, taskId);
    onProgress(task);
    if (["completed", "succeeded", "partial", "failed", "cancelled", "interrupted"].includes(task.state)) return task;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`${dataType} 解析仍在后台运行，请稍后在待解析队列查看结果。`);
    }
    await new Promise(resolve => globalThis.setTimeout(resolve, intervalMs));
  }
}

export function startFY3ParseTask(sceneIds, options = {}) { return startSatelliteParseTask("FY3", sceneIds, options); }
export function getFY3ParseTask(taskId) { return getSatelliteParseTask("FY3", taskId); }
export function listFY3ParseTasks(options = {}) { return listSatelliteParseTasks("FY3", options); }
export function waitForFY3ParseTask(taskId, options = {}) { return waitForSatelliteParseTask("FY3", taskId, options); }

export async function getHimawariAutoStatus() {
  const response = await authedFetch(`${API_BASE}/api/himawari/auto-status`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "Himawari 自动处理状态读取失败");
  }
  return payload.data;
}

export function displayKeyFromBusinessType(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("cma")) return "cma";
  if (text.includes("radar") || text.includes("雷达")) return "radar";
  if (text.includes("era5")) return "era5";
  if (text.includes("fy3") || text.includes("fy-3")) return "fy3";
  if (text.includes("himawari") || text.includes("葵花")) return "himawari";
  if (text.includes("wrf")) return "wrf";
  if (text.includes("gfs") || text.includes("ecmwf") || text.includes("grib")) return "grib";
  return "";
}

export function displayKeyFromFileName(filename) {
  const name = String(filename || "").toLowerCase();
  const suffix = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  if (name.startsWith("z_radr") || name.includes("z_radr")) return "radar";
  if (name.includes("cma")) return "cma";
  if (name.includes("era5")) return "era5";
  if (name.includes("gfs")) return "grib";
  if (name.includes("fy3") || name.includes("fy-3")) return "fy3";
  if (name.includes("himawari") || name.includes("hsd")) return "himawari";
  if (name.includes("radar") || name.includes("cinrad")) return "radar";
  if (name.includes("wrf")) return "wrf";

  if (suffix === ".grib" || suffix === ".grib2") return "grib";
  if (suffix === ".hdf" && (name.includes("fy3") || name.includes("fy-3"))) return "fy3";
  if (suffix === ".hsd") return "himawari";
  if (suffix === ".cinrad" || suffix === ".radar" || suffix === ".bz2") return "radar";
  if (suffix === ".nc") return "era5";
  return "";
}

export function displayKeyFromParseResult(result, fallbackName = "") {
  return displayKeyFromBusinessType(result?.business_type)
    || displayKeyFromBusinessType(result?.data_type)
    || displayKeyFromBusinessType(result?.meta?.data_type)
    || displayKeyFromBusinessType(result?.meta?.type)
    || displayKeyFromFileName(result?.file_name)
    || displayKeyFromFileName(result?.meta?.file)
    || displayKeyFromFileName(fallbackName);
}
