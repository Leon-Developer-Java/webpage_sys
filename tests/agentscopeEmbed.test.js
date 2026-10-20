import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentScopeAuthContext,
  buildIcingMapEmbedUrl,
  isTrustedAgentScopeMessage,
  resolveAgentScopeEmbedConfig,
} from "../src/utils/agentscopeEmbed.js";

test("development defaults target the AgentScope UI and API", () => {
  const config = resolveAgentScopeEmbedConfig({}, { origin: "http://127.0.0.1:5177", dev: true });
  assert.equal(config.error, "");
  assert.equal(config.webUrl, "http://127.0.0.1:5173/chat");
  assert.equal(config.webOrigin, "http://127.0.0.1:5173");
  assert.equal(config.apiUrl, "http://127.0.0.1:8012");
});

test("icing map embeds preserve archive and selected dates without routing the conversation", () => {
  const url = new URL(buildIcingMapEmbedUrl({
    runId: "run/a", archiveId: "jilin_2025_winter",
    selectedRange: { start: "2026-01-16", end: "2026-01-16" },
  }, "https://weather.example"));
  assert.equal(url.origin, "https://weather.example");
  assert.equal(url.pathname, "/agent/icing-map");
  assert.equal(url.searchParams.get("run_id"), "run/a");
  assert.equal(url.searchParams.get("archive_id"), "jilin_2025_winter");
  assert.equal(url.searchParams.get("start_date"), "2026-01-16");
  assert.equal(url.searchParams.get("end_date"), "2026-01-16");
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(buildIcingMapEmbedUrl({}, "https://weather.example"), "");
});

test("production requires explicit AgentScope addresses", () => {
  const config = resolveAgentScopeEmbedConfig({}, { origin: "https://weather.example", dev: false });
  assert.match(config.error, /VITE_AGENTSCOPE_WEB_URL/);
});

test("relative deployment addresses resolve against the host origin", () => {
  const config = resolveAgentScopeEmbedConfig({
    VITE_AGENTSCOPE_WEB_URL: "/agentscope-ui/chat",
    VITE_AGENTSCOPE_BASE: "/agentscope-api",
  }, { origin: "https://weather.example", dev: false });
  assert.equal(config.webUrl, "https://weather.example/agentscope-ui/chat");
  assert.equal(config.apiUrl, "https://weather.example/agentscope-api");
});

test("embedded messages must match both iframe window and origin", () => {
  const frameWindow = {};
  const trusted = {
    source: frameWindow,
    origin: "http://127.0.0.1:5173",
    data: { type: "weather-agent-auth-ready" },
  };
  assert.equal(isTrustedAgentScopeMessage(trusted, frameWindow, trusted.origin), true);
  assert.equal(isTrustedAgentScopeMessage({ ...trusted, origin: "https://evil.example" }, frameWindow, trusted.origin), false);
  assert.equal(isTrustedAgentScopeMessage({ ...trusted, source: {} }, frameWindow, trusted.origin), false);
});

test("host context carries the current bearer token without persisting it", () => {
  assert.deepEqual(buildAgentScopeAuthContext({
    token: "token-value",
    apiUrl: "http://127.0.0.1:8012",
    user: { id: 7, username: "weather-user" },
    dark: true,
  }), {
    type: "weather-agent-auth-context",
    token: "token-value",
    serverUrl: "http://127.0.0.1:8012",
    userId: "7",
    theme: "dark",
  });
});
