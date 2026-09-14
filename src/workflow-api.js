// Business-page facade for the native AgentScope weather service.
import {
  AGENTSCOPE_BASE, agentScopeCanConfirm, agentScopeCapabilities, agentScopeChat,
  agentScopeConfirm, agentScopeGetRun, agentScopeReject,
} from "./agentscope-api.js";

export const WORKFLOW_RUNTIME = "agentscope";
export const WORKFLOW_BASE = AGENTSCOPE_BASE;
export const WORKFLOW_ORIGIN = "weather_agentscope.agents.icing";

export function workflowSessionId(session) { return `wf_${session.id}`; }
export function legacyMessages(messages) { return messages.filter(message => message.mode !== "workflow").map(({ role, content }) => ({ role, content })); }
export const workflowChat = (sessionId, message) => agentScopeChat(sessionId, message);
export const workflowCapabilities = () => agentScopeCapabilities();
export const workflowGetRun = runId => agentScopeGetRun(runId);
export const canConfirmWorkflow = (run, sessionId) => agentScopeCanConfirm(run, sessionId);
export const workflowConfirm = (run, sessionId) => agentScopeConfirm(run, sessionId);
export const workflowReject = (run, sessionId) => agentScopeReject(run, sessionId);
export function workflowSummary(run) { return run.response?.direct_answer || run.result?.summary || "AgentScope 已返回，请查看结果。"; }
export function workflowStatus(status) { return ({ succeeded: "完成", answered: "已回答", need_input: "待补充参数", waiting_confirmation: "待确认", failed: "失败", running: "执行中", waiting_external: "等待模型任务", planned: "待执行", blocked: "已阻止" })[status] || status; }
export function workflowImageUrls(run) { const result = run?.result || {}; return [...new Set([result.image_url, ...(result.image_urls || [])].filter(url => typeof url === "string" && /^https?:\/\//i.test(url)))].slice(0, 8); }
export function isWorkflowImage(url) { try { const parsed = new URL(url); return parsed.origin === new URL(WORKFLOW_BASE, "http://localhost").origin && parsed.pathname.startsWith("/outputs/"); } catch { return false; } }
