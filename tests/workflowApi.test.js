import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WORKFLOW_BASE, WORKFLOW_ORIGIN, WORKFLOW_RUNTIME, workflowSessionId, legacyMessages,
  workflowSummary, workflowImageUrls, workflowStatus, isWorkflowImage,
} from "../src/workflow-api.js";

test("business facade is permanently bound to AgentScope", () => {
  assert.equal(WORKFLOW_RUNTIME, "agentscope");
  assert.equal(WORKFLOW_ORIGIN, "weather_agentscope.agents.icing");
  assert.match(WORKFLOW_BASE, /8012$/);
  assert.equal(workflowSessionId({ id: "chat-1" }), "wf_chat-1");
});

test("new Agent conversations default to the native icing Agent", () => {
  const source = readFileSync(new URL("../src/views/Agent.vue", import.meta.url), "utf8");
  assert.match(source, /function initialSession\(\)[\s\S]*?mode: "workflow"/);
  assert.match(source, /function newSession\(\)[\s\S]*?const mode = "workflow"/);
  assert.match(source, /@reject="rejectWorkflow\(m\)"/);
  assert.doesNotMatch(source, /独立 Demo|通用工作流/);
});

test("the business route delegates only the Agent page to the native Web UI", () => {
  const router = readFileSync(new URL("../src/router.js", import.meta.url), "utf8");
  const nativeView = readFileSync(new URL("../src/views/NativeAgent.vue", import.meta.url), "utf8");
  assert.match(router, /import NativeAgent from "\.\/views\/NativeAgent\.vue"/);
  assert.match(router, /path: "\/agent", component: NativeAgent/);
  assert.match(nativeView, /VITE_AGENTSCOPE_WEB_URL \|\| "http:\/\/127\.0\.0\.1:5173\/chat"/);
  assert.match(nativeView, /type: "weather-agent-auth-context"/);
  assert.match(nativeView, /AgentDataVisualization/);
  assert.match(nativeView, /:initial-expanded="true"/);
  assert.match(nativeView, /weather-agent-open-data-visualization/);
  assert.match(nativeView, /getDisplayResources\(dataType, \{ limit: 100 \}\)/);
  assert.match(nativeView, /matches\.length !== 1/);
  assert.match(nativeView, /target\.postMessage\([\s\S]*?nativeAgentOrigin\)/);
  assert.doesNotMatch(nativeView, /postMessage\([\s\S]*?,\s*["']\*["']\s*\)/);
  assert.doesNotMatch(router, /import Agent from "\.\/views\/Agent\.vue"/);
});

test("only non-AgentScope messages are retained for the legacy agent pane", () => {
  assert.deepEqual(legacyMessages([
    { role: "assistant", content: "old" }, { mode: "workflow", role: "user", content: "weather" }, { mode: "legacy", role: "user", content: "legacy" },
  ]), [{ role: "assistant", content: "old" }, { role: "user", content: "legacy" }]);
});

test("result display keeps v2 summaries and safe images", () => {
  assert.equal(workflowSummary({ response: { direct_answer: "结构化回答" }, result: { summary: "raw" } }), "结构化回答");
  assert.equal(workflowSummary({ result: { summary: "assets" } }), "assets");
  assert.equal(workflowStatus("waiting_external"), "等待模型任务");
  const url = `${WORKFLOW_BASE}/outputs/chart.png`;
  assert.deepEqual(workflowImageUrls({ result: { image_url: url, image_urls: [url, "javascript:alert(1)"] } }), [url]);
  assert.equal(isWorkflowImage(url), true);
  assert.equal(isWorkflowImage("http://untrusted.example/outputs/chart.png"), false);
});
