const API_BASE = "http://127.0.0.1:8002";

export async function parseFile(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/api/files/parse`, { method: "POST", body });
  const payload = await response.json();
  return payload.data;
}
