import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentScopeAuthContext,
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
