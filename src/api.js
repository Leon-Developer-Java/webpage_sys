import { ElMessage } from "element-plus";
import router from "./router";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const UPLOAD_BASE = import.meta.env.VITE_UPLOAD_BASE ?? "http://127.0.0.1:8003";
const AGENT_BASE = import.meta.env.VITE_AGENT_BASE ?? "http://127.0.0.1:8004";
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE ?? "http://127.0.0.1:8005";
const MODEL_BASE = import.meta.env.VITE_MODEL_BASE ?? "http://127.0.0.1:8006";
const ERA5_HISTORY_BASE = import.meta.env.VITE_ERA5_HISTORY_API_BASE ?? "http://127.0.0.1:8010";
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
  return `${value}${value.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken())}`;
}

function apiError(payload, fallback = "请求失败") {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail?.message === "string") return detail.message;
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

export function getWrfDataStatus() {
  return wrfRequest("/api/wrf/data-status");
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

export function getWrfTaskLogs(taskId, after = 0) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/logs?after=${encodeURIComponent(after)}`);
}

export function cancelWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
}

export function retryWrfTask(taskId) {
  return wrfRequest(`/api/wrf/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
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
export async function uploadFileResumable(file, dataType, onProgress = () => {}) {
  const fileId = `${file.name}-${file.size}-${file.lastModified}`;
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  // 1. 查询已传分片，断点续传跳过
  const statusRes = await authedFetch(
    `${UPLOAD_BASE}/api/upload/status?file_id=${encodeURIComponent(fileId)}`
  );
  const statusPayload = await statusRes.json();
  if (!statusRes.ok || statusPayload.code !== 0) {
    throw new Error(apiError(statusPayload, "上传状态读取失败"));
  }
  const { data } = statusPayload;
  if (data?.completed) {
    onProgress(100);
    return {
      ...data.completed,
      duplicate_content: true,
      duplicate_reason: "existing_upload",
    };
  }
  const done = new Set(data?.uploaded ?? []);

  // 2. 顺序上传缺失分片，按分片粒度聚合进度
  for (let i = 0; i < total; i++) {
    if (!done.has(i)) {
      const blob = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const fd = new FormData();
      fd.append("file_id", fileId);
      fd.append("chunk_index", i);
      fd.append("total_chunks", total);
      fd.append("chunk", blob);
      const res = await authedFetch(`${UPLOAD_BASE}/api/upload/chunk`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`分片 ${i} 上传失败`);
    }
    onProgress(((i + 1) / total) * 100);
  }

  // 3. 合并落盘
  const res = await authedFetch(`${UPLOAD_BASE}/api/upload/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, file_name: file.name, total_chunks: total, data_type: dataType }),
  });
  const payload = await res.json();
  if (!res.ok || payload.code !== 0) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : "合并失败");
  }
  return payload.data;
}

export async function getUploadTasks({ limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await authedFetch(`${UPLOAD_BASE}/api/upload/tasks?${params}`);
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

export async function getDisplayResources(dataType, { limit = 100, offset = 0, timeStart = "", timeEnd = "" } = {}) {
  const params = new URLSearchParams({
    data_type: dataType,
    limit: String(limit),
    offset: String(offset),
  });
  if (timeStart) params.set("time_start", timeStart);
  if (timeEnd) params.set("time_end", timeEnd);
  const response = await authedFetch(`${UPLOAD_BASE}/api/catalog/resources?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "可展示数据读取失败"));
  }
  return payload.data;
}

export async function getDisplayResource(resource) {
  const fileUuids = Array.isArray(resource?.file_uuids) ? resource.file_uuids : [];
  if (fileUuids.length >= 1) {
    const response = await authedFetch(`${UPLOAD_BASE}/api/catalog/series`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_uuids: fileUuids }),
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(apiError(payload, "时间序列读取失败"));
    }
    return payload.data;
  }
  const fileUuid = typeof resource === "string" ? resource : resource?.file_uuid;
  const response = await authedFetch(`${UPLOAD_BASE}/api/catalog/resources/${encodeURIComponent(fileUuid)}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "数据详情读取失败"));
  }
  return payload.data;
}

export async function uploadRawFiles(fileOrFiles, dataType, onProgress = () => {}) {
  const body = new FormData();
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  if (files.length === 1) {
    body.append("file", files[0]);
  } else {
    files.forEach(file => body.append("files", file));
  }
  body.append("business_type", dataType);
  body.append("data_type", dataType);
  await ensureFreshToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/files/raw-upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(100, event.loaded / event.total * 100));
    };
    xhr.onerror = () => reject(new Error("无法连接数据解析服务，请确认 backend_system 已启动。"));
    xhr.onabort = () => reject(new Error("raw 上传已取消。"));
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText || "null");
      } catch {
        reject(new Error(`raw 上传返回了无法解析的响应（HTTP ${xhr.status}）`));
        return;
      }
      if (xhr.status === 401) logout();
      if (xhr.status === 403) ElMessage.warning("权限不足，请联系管理员开通");
      if (xhr.status < 200 || xhr.status >= 300 || payload?.code !== 0) {
        reject(new Error(apiError(payload, "raw 上传失败")));
        return;
      }
      onProgress(100);
      resolve(payload.data);
    };
    xhr.send(body);
  });
}

export async function getRawScenes(dataType) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/raw-scenes`);
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

export async function startFY3ParseTask(sceneIds, { force = false } = {}) {
  const params = new URLSearchParams({ force: force ? "true" : "false" });
  Array.from(new Set(sceneIds || [])).filter(Boolean).forEach(sceneId => {
    params.append("scene_id", sceneId);
  });
  const response = await authedFetch(`${API_BASE}/api/display/FY3/parse-tasks?${params}`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "FY-3 解析任务创建失败"));
  }
  return payload.data;
}

export async function getFY3ParseTask(taskId) {
  const response = await authedFetch(`${API_BASE}/api/display/FY3/parse-tasks/${encodeURIComponent(taskId)}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "FY-3 解析任务读取失败"));
  }
  return payload.data;
}

export async function listFY3ParseTasks({ activeOnly = false } = {}) {
  const params = new URLSearchParams({ active_only: activeOnly ? "true" : "false" });
  const response = await authedFetch(`${API_BASE}/api/display/FY3/parse-tasks?${params}`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(apiError(payload, "FY-3 解析任务列表读取失败"));
  }
  return payload.data;
}

export async function waitForFY3ParseTask(
  taskId,
  { onProgress = () => {}, intervalMs = 1000, timeoutMs = 60 * 60 * 1000 } = {},
) {
  const startedAt = Date.now();
  while (true) {
    const task = await getFY3ParseTask(taskId);
    onProgress(task);
    if (["completed", "partial", "failed"].includes(task.state)) return task;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("FY-3 解析仍在后台运行，请稍后在待解析队列查看结果。");
    }
    await new Promise(resolve => globalThis.setTimeout(resolve, intervalMs));
  }
}

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
