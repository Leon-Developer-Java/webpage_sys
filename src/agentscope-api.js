export const AGENTSCOPE_BASE = (import.meta.env?.VITE_AGENTSCOPE_BASE || "http://127.0.0.1:8012").replace(/\/$/, "");

const token = () => globalThis.localStorage?.getItem("token") || "";
const isLocalDebugUi = () => {
  const location = globalThis.location;
  return location?.port === "5173"
    && ["127.0.0.1", "localhost", "::1"].includes(location.hostname);
};
const headers = (json = false) => ({
  ...(json ? { "Content-Type": "application/json" } : {}),
  ...(token()
    ? { Authorization: `Bearer ${token()}` }
    : (isLocalDebugUi() ? { "X-User-ID": "webpage-debug" } : {})),
});
const refs = new Map();

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${AGENTSCOPE_BASE}${path}`, { ...options, headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) } });
  } catch {
    throw new Error(`AgentScope 服务连接失败（${AGENTSCOPE_BASE}）。`);
  }
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.detail || `AgentScope 请求失败（HTTP ${response.status}）`);
  return data;
}

async function bootstrap(logicalSessionId) {
  if (refs.has(logicalSessionId)) return refs.get(logicalSessionId);
  const browserStorage = globalThis.localStorage;
  const saved = JSON.parse(browserStorage?.getItem("weather_agentscope_refs") || "{}");
  // Refresh the persisted AgentScope configuration on each page load while
  // retaining the existing server-side session and its message history.
  const value = await request("/api/weather-agent/bootstrap", {
    method: "POST",
    body: JSON.stringify({ conversation_id: logicalSessionId.replace(/^wf_/, "").slice(0, 64) }),
  });
  const ref = { agent_id: value.agent_id, session_id: value.session_id };
  refs.set(logicalSessionId, ref);
  browserStorage?.setItem("weather_agentscope_refs", JSON.stringify({ ...saved, [logicalSessionId]: ref }));
  return ref;
}

function pseudoRun(logicalSessionId, replyId, text, confirmation = null) {
  return {
    origin: "weather_agentscope.agents.icing",
    runtime: "agentscope",
    run_id: `as_${replyId}`,
    session_id: logicalSessionId,
    status: confirmation ? "waiting_confirmation" : "answered",
    intent_id: "",
    template_id: "",
    recognition: { mode: "agentscope" },
    actions: [],
    result: confirmation ? { guardrail: { risk_level: "medium" }, plan: { target: "已冻结的业务工具参数" } } : {},
    response: {
      kind: confirmation ? "confirmation" : "answer",
      title: confirmation ? "需要确认" : "AgentScope 回复",
      direct_answer: text || (confirmation ? "请确认后执行该业务操作。" : "AgentScope 已返回。"),
      highlights: [], sections: [], tables: [], references: [], warnings: [], suggested_prompts: [],
    },
    _agentscope_confirmation: confirmation,
  };
}

function plainReply(text) {
  return { kind: "message", text: String(text || "").trim() || "暂时没有可展示的内容。" };
}

function attachAgentNarrative(weatherResult, text) {
  const narrative = String(text || "").trim();
  if (!weatherResult?.run || !narrative) {
    return weatherResult?.run ? { ...weatherResult.run, runtime: "agentscope", weather_result: weatherResult } : null;
  }
  // Tables and metric cards are derived from validated backend JSON. Do not
  // let an LLM rewrite or replace their factual summary.
  if (weatherResult.document?.tables?.length || weatherResult.document?.highlights?.length) {
    return { ...weatherResult.run, runtime: "agentscope", weather_result: weatherResult };
  }
  const response = { ...(weatherResult.run.response || {}), direct_answer: narrative };
  return {
    ...weatherResult.run,
    runtime: "agentscope",
    response,
    weather_result: {
      ...weatherResult,
      document: { ...(weatherResult.document || {}), direct_answer: narrative },
      run: { ...weatherResult.run, response },
    },
  };
}

async function readEvents(response, logicalSessionId, ref, expectedReplyId = "", knownReplyIds = new Set()) {
  if (!response.ok || !response.body) throw new Error(`AgentScope 事件流连接失败（HTTP ${response.status}）`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let activeReply = expectedReplyId;
  let text = "";
  let weatherResult = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("AgentScope 事件流提前结束。");
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split("\n").find(item => item.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (!activeReply && event.type === "REPLY_START" && !knownReplyIds.has(event.reply_id)) activeReply = event.reply_id;
        if (!activeReply || (event.reply_id && event.reply_id !== activeReply)) continue;
        if (event.type === "TEXT_BLOCK_DELTA") text += event.delta || "";
        if (event.type === "TOOL_RESULT_END" && event.metadata?.weather_result) weatherResult = event.metadata.weather_result;
        if (event.type === "REQUIRE_USER_CONFIRM") {
          return pseudoRun(logicalSessionId, activeReply, text, {
            agent_id: ref.agent_id,
            session_id: ref.session_id,
            reply_id: activeReply,
            tool_calls: event.tool_calls || [],
          });
        }
        if (event.type === "REPLY_END") {
          if (weatherResult?.run) return attachAgentNarrative(weatherResult, text);
          return plainReply(text);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

async function streamAndPost(logicalSessionId, ref, input, expectedReplyId = "") {
  const history = await request(
    `/sessions/${encodeURIComponent(ref.session_id)}/messages?agent_id=${encodeURIComponent(ref.agent_id)}&limit=200`,
  );
  const knownReplyIds = new Set((history.messages || []).filter(item => item.role === "assistant").map(item => item.id));
  const controller = new AbortController();
  const streamPromise = fetch(
    `${AGENTSCOPE_BASE}/sessions/${encodeURIComponent(ref.session_id)}/stream?agent_id=${encodeURIComponent(ref.agent_id)}`,
    { headers: headers(), signal: controller.signal },
  );
  const stream = await streamPromise;
  await request("/chat/", {
    method: "POST",
    body: JSON.stringify({ agent_id: ref.agent_id, session_id: ref.session_id, input }),
  });
  try {
    return await readEvents(stream, logicalSessionId, ref, expectedReplyId, knownReplyIds);
  } finally {
    controller.abort();
  }
}

export async function agentScopeChat(logicalSessionId, message) {
  const ref = await bootstrap(logicalSessionId);
  return streamAndPost(logicalSessionId, ref, {
    name: "user",
    role: "user",
    content: [{ type: "text", text: message }],
  });
}

async function agentScopeResolveConfirmation(run, logicalSessionId, confirmed) {
  const confirmation = run?._agentscope_confirmation;
  if (confirmation) {
    if (run.session_id !== logicalSessionId) throw new Error("AgentScope 确认请求已失效或不属于本会话。");
    const ref = { agent_id: confirmation.agent_id, session_id: confirmation.session_id };
    return streamAndPost(logicalSessionId, ref, {
      type: "USER_CONFIRM_RESULT",
      reply_id: confirmation.reply_id,
      confirm_results: confirmation.tool_calls.map(tool_call => ({ confirmed, tool_call })),
    }, confirmation.reply_id);
  }
  throw new Error("人工确认请求已失效或不属于当前 AgentScope 会话。");
}

export async function agentScopeConfirm(run, logicalSessionId) {
  return agentScopeResolveConfirmation(run, logicalSessionId, true);
}

export async function agentScopeReject(run, logicalSessionId) {
  return agentScopeResolveConfirmation(run, logicalSessionId, false);
}

export function agentScopeCanConfirm(run, logicalSessionId) {
  if (run?.runtime !== "agentscope" || run.status !== "waiting_confirmation") return false;
  if (run._agentscope_confirmation) {
    return Boolean(run.session_id === logicalSessionId && run._agentscope_confirmation.tool_calls?.length);
  }
  return false;
}

export function agentScopeCapabilities() {
  return request("/api/weather-agent/capabilities");
}

export function agentScopeGetRun(runId) {
  return request(`/api/weather-agent/runs/${encodeURIComponent(runId)}`).then(data => (
    data?.run ? { ...data.run, runtime: "agentscope", weather_result: data } : data
  ));
}

export async function agentScopeMessages(logicalSessionId) {
  const ref = await bootstrap(logicalSessionId);
  const data = await request(
    `/sessions/${encodeURIComponent(ref.session_id)}/messages?agent_id=${encodeURIComponent(ref.agent_id)}&limit=200`,
  );
  return (data.messages || []).flatMap(message => {
    const narrative = (message.content || []).filter(block => block.type === "text").map(block => block.text || "").filter(Boolean).join("\n");
    const text = (message.content || []).flatMap(block => {
      if (block.type === "text") return [block.text || ""];
      if (block.type === "tool_result" && typeof block.output === "string") return [block.output];
      if (block.type === "tool_result") return (block.output || []).filter(item => item.type === "text").map(item => item.text || "");
      return [];
    }).filter(Boolean).join("\n");
    const weather = (message.content || []).find(block => block.type === "tool_result" && block.metadata?.weather_result)?.metadata?.weather_result;
    const asking = (message.content || []).filter(block => block.type === "tool_call" && block.state === "asking");
    const pending = asking.length ? pseudoRun(logicalSessionId, message.id, text, {
      agent_id: ref.agent_id,
      session_id: ref.session_id,
      reply_id: message.id,
      tool_calls: asking,
    }) : null;
    if (!text && !weather && !pending) return [];
    return [{
      id: message.id,
      role: message.role,
      mode: "workflow",
      content: narrative || text,
      workflow: pending || attachAgentNarrative(weather, narrative),
      toolCalls: [], processEvents: [], images: [], paramPrompt: null, nowcast: null,
      nowcastAnalysis: null, icingModel: null, streaming: false,
    }];
  });
}
