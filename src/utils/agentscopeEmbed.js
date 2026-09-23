const DEV_WEB_URL = "http://127.0.0.1:5173/chat";
const DEV_API_URL = "http://127.0.0.1:8012";

function httpUrl(value, origin) {
  if (!value) return null;
  const url = new URL(value, origin);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`不支持的 URL 协议：${url.protocol}`);
  }
  return url;
}

export function resolveAgentScopeEmbedConfig(env, { origin, dev = false }) {
  const webValue = String(env?.VITE_AGENTSCOPE_WEB_URL || (dev ? DEV_WEB_URL : "")).trim();
  const apiValue = String(env?.VITE_AGENTSCOPE_BASE || (dev ? DEV_API_URL : "")).trim();

  if (!webValue || !apiValue) {
    return {
      error: "缺少 VITE_AGENTSCOPE_WEB_URL 或 VITE_AGENTSCOPE_BASE，无法加载 AgentScope。",
      webUrl: "",
      webOrigin: "",
      apiUrl: "",
    };
  }

  try {
    const webUrl = httpUrl(webValue, origin);
    const apiUrl = httpUrl(apiValue, origin);
    return {
      error: "",
      webUrl: webUrl.href,
      webOrigin: webUrl.origin,
      apiUrl: apiUrl.href.replace(/\/$/, ""),
    };
  } catch (error) {
    return {
      error: `AgentScope 地址无效：${error.message}`,
      webUrl: "",
      webOrigin: "",
      apiUrl: "",
    };
  }
}

export function isTrustedAgentScopeMessage(event, frameWindow, webOrigin) {
  return Boolean(
    frameWindow
    && webOrigin
    && event?.source === frameWindow
    && event?.origin === webOrigin
    && event?.data
    && typeof event.data.type === "string"
  );
}

export function buildAgentScopeAuthContext({ token, apiUrl, user, dark }) {
  return {
    type: "weather-agent-auth-context",
    token: String(token || ""),
    serverUrl: apiUrl,
    userId: String(user?.id ?? user?.username ?? ""),
    theme: dark ? "dark" : "light",
  };
}
