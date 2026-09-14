import test from "node:test";
import assert from "node:assert/strict";


function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("AgentScope adapter subscribes before chat and returns weather_result run", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const calls = [];
  const weatherRun = {
    run_id: "run_weather1",
    status: "succeeded",
    response: { direct_answer: "完成" },
    result: { model_id: "icing_prediction", external_run_id: "run_model1" },
  };
  const frames = [
    { type: "REPLY_START", reply_id: "reply-1" },
    { type: "TOOL_RESULT_END", reply_id: "reply-1", metadata: { weather_result: { run: weatherRun } } },
    { type: "TEXT_BLOCK_DELTA", reply_id: "reply-1", delta: "巡检完成，资产总体正常。" },
    { type: "REPLY_END", reply_id: "reply-1" },
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join("");
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/weather-agent/bootstrap")) {
      return jsonResponse({ agent_id: "agent-1", session_id: "session-1" });
    }
    if (url.includes("/messages?")) return jsonResponse({ messages: [], is_running: false });
    if (url.includes("/stream?")) {
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(frames));
      } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/chat/")) return jsonResponse({ status: "started", session_id: "session-1" });
    throw new Error(`unexpected URL ${url}`);
  };

  const api = await import(`../src/agentscope-api.js?test=${Date.now()}`);
  const result = await api.agentScopeChat("wf-conversation", "查看吉林2025年12月覆冰变化");
  assert.equal(result.run_id, "run_weather1");
  assert.equal(result.runtime, "agentscope");
  assert.equal(result.response.direct_answer, "巡检完成，资产总体正常。");
  assert.ok(calls[2].url.includes("/stream?"));
  assert.ok(calls[3].url.endsWith("/chat/"));
  assert.deepEqual(JSON.parse(calls[0].options.body), { conversation_id: "wf-conversation" });
  assert.equal(calls[0].options.headers["X-User-ID"], undefined);
});

test("side-effect uses the native AgentScope confirmation event", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const calls = [];
  const frames = [
    { type: "REPLY_START", reply_id: "reply-pending" },
    {
      type: "REQUIRE_USER_CONFIRM", reply_id: "reply-pending",
      tool_calls: [{ id: "call-1", name: "weather_prepare_jilin_winter_icing", input: "{}" }],
    },
    { type: "REPLY_END", reply_id: "reply-pending" },
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join("");
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/weather-agent/bootstrap")) {
      return jsonResponse({ agent_id: "agent-2", session_id: "session-2" });
    }
    if (url.includes("/messages?")) return jsonResponse({ messages: [], is_running: false });
    if (url.includes("/stream?")) {
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(frames));
        controller.close();
      } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/chat/")) return jsonResponse({ status: "started", session_id: "session-2" });
    throw new Error(`unexpected URL ${url}`);
  };

  const api = await import(`../src/agentscope-api.js?manual=${Date.now()}`);
  const result = await api.agentScopeChat("wf-manual", "准备吉林冬季覆冰档案");
  assert.equal(api.agentScopeCanConfirm(result, "wf-manual"), true);
  await assert.rejects(api.agentScopeConfirm(result, "other"), /不属于本会话/);
  await api.agentScopeReject(result, "wf-manual");
  const rejection = calls.filter(item => String(item.url).endsWith("/chat/")).at(-1);
  const decision = JSON.parse(rejection.options.body).input.confirm_results[0];
  assert.equal(decision.confirmed, false);
  assert.equal(calls.filter(item => String(item.url).includes("/runs/")).length, 0);
});

test("ordinary AgentScope replies do not create a workflow result card", async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const frames = [
    { type: "REPLY_START", reply_id: "reply-text" },
    { type: "TEXT_BLOCK_DELTA", reply_id: "reply-text", delta: "可用功能包括数据查询和覆冰分析。" },
    { type: "REPLY_END", reply_id: "reply-text" },
  ].map(item => `data: ${JSON.stringify(item)}\n\n`).join("");
  globalThis.fetch = async (url) => {
    if (url.endsWith("/api/weather-agent/bootstrap")) return jsonResponse({ agent_id: "agent-3", session_id: "session-3" });
    if (url.includes("/messages?")) return jsonResponse({ messages: [], is_running: false });
    if (url.includes("/stream?")) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frames)); } }), { status: 200 });
    if (url.endsWith("/chat/")) return jsonResponse({ status: "started" });
    throw new Error(`unexpected URL ${url}`);
  };
  const api = await import(`../src/agentscope-api.js?plain=${Date.now()}`);
  const result = await api.agentScopeChat("wf-plain", "列出功能清单");
  assert.deepEqual(result, { kind: "message", text: "可用功能包括数据查询和覆冰分析。" });
});
