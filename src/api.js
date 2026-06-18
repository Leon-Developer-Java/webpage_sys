const API_BASE = "http://127.0.0.1:8002";

export async function* chatStream(messages, context) {
  const res = await fetch(`${API_BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield dec.decode(value, { stream: true });
  }
}

export function uploadFile(file, onProgress) {
  const body = new FormData();
  body.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total * 100);
    xhr.onload = () => resolve(JSON.parse(xhr.responseText).data);
    xhr.onerror = reject;
    xhr.open("POST", `${API_BASE}/api/files/upload`);
    xhr.send(body);
  });
}

export async function parseFile(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/api/files/parse`, { method: "POST", body });
  const payload = await response.json();
  return payload.data;
}
