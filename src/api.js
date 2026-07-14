import { ElMessage } from "element-plus";
import router from "./router";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8002";
const UPLOAD_BASE = import.meta.env.VITE_UPLOAD_BASE ?? "http://127.0.0.1:8003";
const AGENT_BASE = import.meta.env.VITE_AGENT_BASE ?? "http://127.0.0.1:8004";
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE ?? "http://127.0.0.1:8005";
const MODEL_BASE = import.meta.env.VITE_MODEL_BASE ?? "http://127.0.0.1:8006";
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

async function modelRequest(path, options = {}) {
  const response = await authedFetch(`${MODEL_BASE}${path}`, options);
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
    frames: (result?.frames ?? []).map(frame => ({
      ...frame,
      truth_url: modelAssetUrl(frame.truth_url),
      prediction_url: modelAssetUrl(frame.prediction_url),
      points_url: modelAssetUrl(frame.points_url),
    })),
  };
}

export async function getModelMetrics(url) {
  const response = await authedFetch(modelAssetUrl(url));
  const payload = await response.json();
  if (!response.ok) throw new Error(apiError(payload, "预报指标读取失败"));
  return payload;
}

export async function getModelPoints(url) {
  const response = await authedFetch(modelAssetUrl(url));
  const payload = await response.json();
  if (!response.ok) throw new Error(apiError(payload, "覆冰点位读取失败"));
  return Array.isArray(payload) ? payload : [];
}

export async function cancelModelRun(runId) {
  return modelRequest(`/api/model-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

// 大文件上传使用 XHR 获取真实上传进度；任务入队后由状态接口继续异步轮询。
export async function submitModelRun({ modelId, files, startTimestamp, onUploadProgress = () => {} }) {
  await ensureFreshToken();
  const body = new FormData();
  body.append("model_id", modelId);
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

// 分片上传 + 断点续传。文件唯一标识用组合键（文件名+大小+修改时间）。
export async function uploadFileResumable(file, dataType, onProgress = () => {}) {
  const fileId = `${file.name}-${file.size}-${file.lastModified}`;
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  // 1. 查询已传分片，断点续传跳过
  const statusRes = await authedFetch(
    `${UPLOAD_BASE}/api/upload/status?file_id=${encodeURIComponent(fileId)}`
  );
  const { data } = await statusRes.json();
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

export async function parseFile(fileOrFiles) {
  const body = new FormData();
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  if (files.length === 1) {
    body.append("file", files[0]);
  } else {
    files.forEach(file => body.append("files", file));
  }
  const response = await authedFetch(`${API_BASE}/api/files/parse`, { method: "POST", body });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "解析失败");
  }
  return payload.data;
}

export async function uploadRawFiles(fileOrFiles, dataType) {
  const body = new FormData();
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  if (files.length === 1) {
    body.append("file", files[0]);
  } else {
    files.forEach(file => body.append("files", file));
  }
  body.append("business_type", dataType);
  body.append("data_type", dataType);
  const response = await authedFetch(`${API_BASE}/api/files/raw-upload`, { method: "POST", body });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "raw 上传失败");
  }
  return payload.data;
}

export async function getRawScenes(dataType) {
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/raw-scenes`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "raw 场景读取失败");
  }
  return payload.data;
}

export async function updateDisplayFromRaw(dataType, { force = false } = {}) {
  const params = new URLSearchParams({ force: force ? "true" : "false" });
  const response = await authedFetch(`${API_BASE}/api/display/${encodeURIComponent(dataType)}/update?${params}`, {
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "raw 解析失败");
  }
  return payload.data;
}

export async function getHimawariAutoStatus() {
  const response = await authedFetch(`${API_BASE}/api/himawari/auto-status`);
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.detail || payload.message || "Himawari 自动处理状态读取失败");
  }
  return payload.data;
}

export async function parseFiles(files) {
  return parseFile(Array.from(files || []));
}

export function displayKeyFromBusinessType(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("cma")) return "cma";
  if (text.includes("radar") || text.includes("雷达")) return "radar";
  if (text.includes("era5")) return "era5";
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
  if (name.includes("himawari") || name.includes("hsd")) return "himawari";
  if (name.includes("radar") || name.includes("cinrad")) return "radar";
  if (name.includes("wrf")) return "wrf";

  if (suffix === ".grib" || suffix === ".grib2") return "grib";
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
