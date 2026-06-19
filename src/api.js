const API_BASE = "http://127.0.0.1:8002";
const UPLOAD_BASE = "http://127.0.0.1:8003";
const AGENT_BASE = "http://127.0.0.1:8004";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// 与智能体后端的 NDJSON 流式对话：逐行解析，产出事件对象
// 事件类型：{type:"text",value} | {type:"tool",name,status,label,progress,result}
//          | {type:"image",url,caption} | {type:"done"} | {type:"error",message}
export async function* chatStream(messages, context) {
  const res = await fetch(`${AGENT_BASE}/api/agent/chat`, {
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
  const statusRes = await fetch(
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
      const res = await fetch(`${UPLOAD_BASE}/api/upload/chunk`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`分片 ${i} 上传失败`);
    }
    onProgress(((i + 1) / total) * 100);
  }

  // 3. 合并落盘
  const res = await fetch(`${UPLOAD_BASE}/api/upload/complete`, {
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

export async function parseFile(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/api/files/parse`, { method: "POST", body });
  const payload = await response.json();
  return payload.data;
}
