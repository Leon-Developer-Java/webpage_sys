<template>
  <div class="agent">
    <div :class="['sidebar glass', { collapsed: leftCollapsed }]">
      <button class="side-toggle left" type="button" @click="leftCollapsed = !leftCollapsed">
        {{ leftCollapsed ? '>' : '<' }}
      </button>
      <template v-if="!leftCollapsed">
      <button class="new-btn" @click="newSession">
        <el-icon><Plus /></el-icon>新建对话
      </button>
      <div class="hist-list">
        <div class="hist-sep">历史对话</div>
        <div
          v-for="s in sessions" :key="s.id"
          :class="['hist-item', { on: s.id === activeId }]"
          @click="activeId = s.id"
        >
          <div class="hi-body">
            <input
              v-if="editingId === s.id"
              class="hi-input"
              v-model="editTitle"
              @blur="finishRename"
              @keydown.enter.prevent="finishRename"
              @keydown.escape.prevent="editingId = null"
              @click.stop
            />
            <div v-else class="hi-title">{{ s.title }}</div>
            <div class="hi-date">{{ fmtDay(s.createdAt) }}</div>
          </div>
          <button class="hi-menu-btn" @click.stop="openMenu(s.id, $event)">⋯</button>
        </div>
      </div>
      <div class="sb-foot">
        <span class="sdot"></span>
        <div class="sb-ticker-wrap">
          <Transition name="tick">
            <span class="sb-ticker" :key="infoIdx">{{ infoItems[infoIdx % infoItems.length] }}</span>
          </Transition>
        </div>
      </div>
      </template>
    </div>

    <div class="chat glass">
      <div class="chat-head">
        <span class="ch-title">{{ cur.title }}</span>
        <label class="agent-mode">
          对话模式
          <select v-model="cur.mode" :disabled="streaming" @change="save">
            <option value="legacy">原智能体</option>
            <option value="workflow">气象智能体（AgentScope）</option>
          </select>
        </label>
        <span class="badge">{{ cur.mode === 'workflow' ? 'AgentScope 覆冰 Agent' : 'backend_agent' }}</span>
      </div>
      <div v-if="cur.mode === 'workflow'" class="workflow-hint">
        当前消息只发给 AgentScope 气象 Agent，不调用旧智能体。可用日常语言描述需求，缺少信息会追问；副作用操作执行前需要确认。
        <a :href="`${WORKFLOW_BASE}/api/weather-agent/capabilities`" target="_blank" rel="noopener noreferrer">能力清单</a>
      </div>
      <div class="msgs" ref="msgsEl">
        <div
          v-for="m in cur.msgs" :key="m.id"
          :class="['msg', { u: m.role === 'user', 'workflow-msg': !!m.workflow }]"
        >
          <div :class="['av', m.role === 'user' ? 'av-u' : 'av-ai']">
            {{ m.role === 'user' ? '我' : 'AI' }}
          </div>
          <div :class="['bub', m.role === 'user' ? 'bub-u' : 'bub-ai']">
            <span v-if="m.role === 'user'" class="plain">{{ m.content }}</span>
            <template v-else-if="m.mode === 'workflow'"><span v-if="!m.workflow" class="md" v-html="renderMarkdown(m.content)"></span></template>
            <span v-else class="md" v-html="renderMarkdown(m.content)"></span><span v-if="m.streaming" class="cursor"></span>
            <div v-if="m.mode" class="message-origin">{{ m.mode === 'workflow' ? 'AgentScope 气象 Agent' : '原智能体 · backend_agent' }}</div>
            <AgentWorkflowResult
              v-if="m.workflow"
              :run="m.workflow"
              :session-id="workflowSessionId(cur)"
              :busy="streaming"
              :locked="!!m.workflowConfirmationPending"
              :error="m.workflowError || ''"
              :image-url="url => messageImageUrl(m, url)"
              :query-enabled="cur.mode === 'workflow'"
              @confirm="confirmWorkflow(m)"
              @reject="rejectWorkflow(m)"
              @refresh="refreshWorkflow(m)"
              @query="fillWorkflowQuery"
            />
            <ToolCallCard v-for="tc in (m.toolCalls ?? [])" :key="tc.name" :tc="tc" />
            <div v-if="(m.processEvents ?? []).length" class="agent-process">
              <div class="ap-head">
                <span>Agent 过程</span>
                <b>{{ m.processEvents.length }} 步</b>
              </div>
              <div v-for="(ev, index) in m.processEvents" :key="index" class="ap-item">
                <div class="ap-title">
                  <span>{{ processTitle(ev) }}</span>
                  <b :class="['ap-status', processStatusClass(ev)]">{{ processStatus(ev) }}</b>
                </div>
                <p v-if="ev.summary">{{ ev.summary }}</p>
                <div v-if="ev.guardrail && Object.keys(ev.guardrail).length" class="guardrail-box">
                  <div class="guardrail-row">
                    <span>Guardrail</span>
                    <b :class="ev.guardrail.allowed ? 'ok' : 'blocked'">{{ ev.guardrail.allowed ? '通过' : '阻止' }}</b>
                  </div>
                  <div class="mini-grid">
                    <span>风险</span><b>{{ ev.guardrail.risk_level || 'unknown' }}</b>
                    <span>需确认</span><b>{{ ev.guardrail.requires_confirmation ? '是' : '否' }}</b>
                    <span>已确认</span><b>{{ ev.guardrail.confirmed ? '是' : '否' }}</b>
                  </div>
                  <ul v-if="(ev.guardrail.blockers ?? []).length">
                    <li v-for="item in ev.guardrail.blockers" :key="item">{{ item }}</li>
                  </ul>
                </div>
                <div v-if="(ev.plan?.steps ?? []).length" class="plan-box">
                  <div class="plan-title">执行计划</div>
                  <ol>
                    <li v-for="step in ev.plan.steps" :key="step">{{ step }}</li>
                  </ol>
                </div>
                <div v-if="canConfirmAction(ev)" class="action-confirm-box">
                  <div>
                    <b>需要确认</b>
                    <span>{{ ev.action.confirm_prompt || '确认后执行该 Action' }}</span>
                  </div>
                  <button
                    class="action-confirm-btn"
                    type="button"
                    :disabled="streaming || ev.confirming || ev.confirmed || cur.mode === 'workflow'"
                    @click="confirmAction(ev)"
                  >
                    {{ ev.confirmed ? '已提交' : ev.confirming ? '提交中' : '确认执行' }}
                  </button>
                </div>
                <div v-if="(ev.sources ?? []).length" class="source-line">
                  来源：{{ compactSources(ev.sources) }}
                </div>
              </div>
            </div>
            <a
              v-for="(im, i) in (m.workflow ? [] : (m.images ?? []))" :key="i"
              :href="messageImageUrl(m, im.url)" target="_blank" rel="noopener noreferrer" class="msg-img-link"
            >
              <img :src="messageImageUrl(m, im.url)" :alt="im.caption || '生成图像'" class="msg-img" />
              <span v-if="im.caption" class="msg-img-cap">{{ im.caption }}</span>
            </a>
            <div v-if="m.paramPrompt" class="pc">
              <div class="pc-head">补全参数 · {{ m.paramPrompt.modelName }}</div>
              <div v-for="f in m.paramPrompt.fields" :key="f.name" class="pc-field">
                <div class="pc-label">{{ f.label }}<span v-if="f.required" class="pc-req">*</span></div>
                <div v-if="(f.options || []).length" class="pc-opts">
                  <button
                    v-for="o in f.options" :key="o" class="pc-opt"
                    :disabled="streaming || cur.mode === 'workflow'" @click="answerParam(f, o)"
                  >{{ o }}</button>
                </div>
                <div class="pc-input-row">
                  <input
                    class="pc-input" v-model="paramDraft[f.name]"
                    :placeholder="f.placeholder || ('输入' + f.label)"
                    :disabled="streaming || cur.mode === 'workflow'"
                    @keydown.enter.prevent="answerParam(f, paramDraft[f.name])"
                  />
                  <button class="pc-ok" :disabled="streaming || cur.mode === 'workflow'" @click="answerParam(f, paramDraft[f.name])">确定</button>
                </div>
              </div>
            </div>
            <AgentNowcastCard
              v-if="m.nowcast"
              :state="m.nowcast"
              @change="save"
            />
            <AgentNowcastAnalysisCard
              v-if="m.nowcastAnalysis"
              :analysis="m.nowcastAnalysis"
            />
            <AgentIcingModelCard
              v-if="m.icingModel"
              :state="m.icingModel"
              @expand="openIcingModel(m.icingModel)"
              @change="save"
            />
          </div>
        </div>
      </div>
      <div class="input-area">
        <div class="chips">
          <button v-for="c in quickChips" :key="c" class="chip" @click="inputText += c + ' '">{{ c }}</button>
        </div>
        <div class="input-row">
          <textarea
            class="input-box"
            v-model="inputText"
            rows="1"
            :placeholder="cur.mode === 'workflow' ? '例如：帮我盘点一下现有数据；也可以直接回答上一条追问' : '输入问题，或点击快捷指令...'"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <button
            :class="['send-btn', { on: inputText.trim() && !streaming }]"
            :disabled="!inputText.trim() || streaming"
            @click="send"
          >
            <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>
    </div>

    <div :class="['workbench-shell', { collapsed: rightCollapsed }]">
      <button class="side-toggle right" type="button" @click="rightCollapsed = !rightCollapsed">
        {{ rightCollapsed ? '<' : '>' }}
      </button>
      <div v-if="!rightCollapsed && cur.mode === 'workflow'" class="workflow-help glass">
        <b>AgentScope 覆冰能力</b>
        <p>直接输入下方示例，不需要额外的模式前缀。</p>
        <button v-for="prompt in workflowChips" :key="prompt" class="chip" @click="inputText = prompt">{{ prompt }}</button>
        <p v-if="workflowCapabilityError" class="failed">{{ workflowCapabilityError }}</p>
        <p>同一对话内可说“这个文件”或“刚才结果”。新建对话不会引用其他对话的产物。</p>
        <p>结构化结果保留数据来源和执行状态；下载、解析或模型提交前必须由当前用户确认。</p>
        <p>正式页面沿用登录身份，会话和确认状态由 AgentScope 服务恢复。</p>
      </div>
      <WorkbenchPanel v-else-if="!rightCollapsed" @cmd="runCommand" />
    </div>
  </div>

  <teleport to="body">
    <div
      v-if="menuId"
      class="hi-dd"
      :style="{ top: ddPos.top, left: ddPos.left }"
      @click.stop
    >
      <button class="hi-dd-item" @click="startRename(menuId)">重命名</button>
      <button class="hi-dd-item hi-dd-del" @click="deleteSession(menuId); menuId = null">删除</button>
    </div>
  </teleport>

  <el-dialog v-model="icingModelDialog" fullscreen class="icing-model-dialog" :show-close="true" destroy-on-close>
    <AgentIcingModelCard
      v-if="expandedIcingModel"
      :state="expandedIcingModel"
      :expanded="true"
      @expand="icingModelDialog = false"
      @change="save"
    />
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowRight, Plus } from "@element-plus/icons-vue";
import { chatStream, withToken } from "../api.js";
import { renderMarkdown } from "../markdown.js";
import AgentNowcastAnalysisCard from "../components/AgentNowcastAnalysisCard.vue";
import AgentNowcastCard from "../components/AgentNowcastCard.vue";
import AgentIcingModelCard from "../components/AgentIcingModelCard.vue";
import ToolCallCard from "../components/ToolCallCard.vue";
import WorkbenchPanel from "../components/WorkbenchPanel.vue";
import AgentWorkflowResult from "../components/AgentWorkflowResult.vue";
import {
  WORKFLOW_BASE, WORKFLOW_RUNTIME, workflowChat, workflowConfirm, workflowReject, workflowGetRun, workflowSessionId,
  workflowSummary, workflowImageUrls, workflowCapabilities, legacyMessages, canConfirmWorkflow, isWorkflowImage,
} from "../workflow-api.js";
import { agentScopeMessages } from "../agentscope-api.js";

const SKEY = "agent_sessions";

function initialSession() {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    mode: "workflow",
    createdAt: Date.now(),
    msgs: [{
      id: "0",
      role: "assistant",
      mode: "workflow",
      content: "您好，我是 AgentScope 覆冰 Agent。您可以直接查询数据和覆冰结果；下载、解析或模型提交会先请您确认。",
      toolCalls: [],
    }],
  };
}

function initState() {
  try {
    const stored = localStorage.getItem(SKEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const storedSessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      if (Array.isArray(storedSessions) && storedSessions.length) {
        const sessions = storedSessions.map(session => ({ ...session, mode: session.mode === 'workflow' ? 'workflow' : 'legacy' }));
        const requestedActiveId = Array.isArray(parsed) ? "" : parsed.activeSessionId;
        return {
          sessions,
          activeId: sessions.some(session => session.id === requestedActiveId) ? requestedActiveId : sessions[0].id,
        };
      }
    }
  } catch (error) {
    console.warn("Agent conversation history could not be read", error);
  }
  const session = initialSession();
  return { sessions: [session], activeId: session.id };
}

const savedState = initState();
const sessions = ref(savedState.sessions);
const activeId = ref(savedState.activeId);
const inputText = ref("");
const streaming = ref(false);
const msgsEl = ref(null);
const paramDraft = ref({});
const menuId = ref(null);
const ddPos = ref({ top: "0px", left: "0px" });
const editingId = ref(null);
const editTitle = ref("");
const leftCollapsed = ref(localStorage.getItem("agent_left_collapsed") === "1");
const rightCollapsed = ref(localStorage.getItem("agent_right_collapsed") === "1");
const icingModelDialog = ref(false);
const expandedIcingModel = ref(null);

const cur = computed(() => sessions.value.find(s => s.id === activeId.value));
const workflowChips = ref(["列出功能清单", "巡检数据资产", "查询 ERA5 数据集"]);
const workflowCapabilityError = ref("");
const restoredAgentScopeSessions = new Set();
const quickChips = computed(() => cur.value.mode === 'workflow' ? workflowChips.value : ["查看数据库里最新的 WRF 解析任务", "统计最新 WRF T2 按分辨率分组", "重试解析失败任务"]);

const infoIdx = ref(0);
const infoItems = computed(() => cur.value.mode === 'workflow' ? [
  "自然语言理解，执行仅限已登记能力",
  "工作流计划、步骤与运行记录",
  `${sessions.value.length} 个会话`,
  "AgentScope 原生服务 · 8012",
] : [
  "DeepSeek 自然语言理解",
  "Agent 工具调用与过程展示",
  `${sessions.value.length} 个会话`,
  `${sessions.value.reduce((a, s) => a + s.msgs.length, 0)} 条消息`,
  "流式输出 · SSE",
]);
let tickTimer = null;

function compactWorkflowResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  const fields = [
    "model_id", "external_run_id", "archive_id", "selected_range", "approved_inputs", "guardrail", "plan",
    "analysis", "risk_assessment", "control_recommendations", "process_analysis", "key_days",
  ];
  return Object.fromEntries(fields.filter(field => result[field] !== undefined).map(field => [field, result[field]]));
}

function compactWorkflowRun(run) {
  if (!run || typeof run !== "object") return run ?? null;
  const { result, action_results, events, ...rest } = run;
  return {
    ...rest,
    result: compactWorkflowResult(result),
    action_results: Array.isArray(action_results) ? action_results.slice(-12) : action_results,
    events: Array.isArray(events) ? events.slice(-24) : events,
  };
}

function compactMessageForStorage(message) {
  return {
    ...message,
    workflow: compactWorkflowRun(message.workflow),
    icingModel: message.icingModel ? { ...message.icingModel, result: null } : null,
  };
}

function storageState(sessionList = sessions.value) {
  return {
    version: 2,
    activeSessionId: activeId.value,
    sessions: sessionList.map(session => ({
      ...session,
      msgs: (session.msgs || []).map(compactMessageForStorage),
    })),
  };
}

function save() {
  try {
    localStorage.setItem(SKEY, JSON.stringify(storageState()));
    return;
  } catch (error) { /* fall through to a smaller, current-session copy */ }
  const active = sessions.value.find(session => session.id === activeId.value) || sessions.value[0];
  try {
    localStorage.setItem(SKEY, JSON.stringify(storageState([{ ...active, msgs: active.msgs.slice(-48) }])));
  } catch (error) {
    console.warn("Agent conversation history was not saved locally", error);
  }
}

function scrollBottom() {
  nextTick(() => { if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight; });
}

function fmtDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return '今天';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openMenu(id, e) {
  const rect = e.currentTarget.getBoundingClientRect();
  ddPos.value = { top: rect.bottom + 4 + "px", left: rect.left - 60 + "px" };
  menuId.value = menuId.value === id ? null : id;
}

function startRename(id) {
  editingId.value = id;
  editTitle.value = sessions.value.find(s => s.id === id)?.title ?? '';
  menuId.value = null;
  nextTick(() => {
    const el = document.querySelector('.hi-input');
    if (el) { el.focus(); el.select(); }
  });
}

function finishRename() {
  if (!editingId.value) return;
  const s = sessions.value.find(s => s.id === editingId.value);
  if (s && editTitle.value.trim()) s.title = editTitle.value.trim();
  editingId.value = null;
  save();
}

function deleteSession(id) {
  if (sessions.value.length === 1) newSession();
  const idx = sessions.value.findIndex(s => s.id === id);
  sessions.value.splice(idx, 1);
  if (activeId.value === id)
    activeId.value = sessions.value[Math.min(idx, sessions.value.length - 1)].id;
  save();
}

function newSession() {
  const mode = "workflow";
  const s = {
    id: crypto.randomUUID(),
    title: "新对话",
    mode,
    createdAt: Date.now(),
    msgs: [{
      id: crypto.randomUUID(),
      role: "assistant",
      mode,
      content: "当前为 AgentScope 覆冰 Agent。可以说“帮我盘点一下现有数据”，缺少信息时我会追问；解析必须先预演，再通过确认按钮执行。",
      toolCalls: [],
    }],
  };
  sessions.value.unshift(s);
  activeId.value = s.id;
  save();
}

function appendMsg(role, content, session = cur.value, mode = "legacy") {
  const m = { id: crypto.randomUUID(), role, content, mode, toolCalls: [], processEvents: [], images: [], paramPrompt: null, nowcast: null, nowcastAnalysis: null, icingModel: null, streaming: role === "assistant" };
  session.msgs.push(m);
  scrollBottom();
  return session.msgs[session.msgs.length - 1];
}

function messageImageUrl(message, url) {
  if (message.mode !== "workflow") return withToken(url);
  if (isWorkflowImage(url)) return url;
  // Only the configured legacy data host may receive its existing auth token.
  try {
    const parsed = new URL(url);
    const dataBase = new URL(import.meta.env.VITE_API_BASE || "http://127.0.0.1:8002", window.location.origin);
    if (parsed.origin === dataBase.origin && parsed.pathname.startsWith("/data/")) return withToken(url);
  } catch { /* Keep invalid or unrelated URLs free of authentication data. */ }
  return url;
}

function applyWorkflowRun(message, run) {
  message.workflow = run;
  message.content = workflowSummary(run);
  message.images = workflowImageUrls(run).map(url => ({ url, caption: "AgentScope 覆冰结果" }));
  const modelRunId = run?.result?.external_run_id;
  if (run?.result?.model_id === "icing_prediction" && /^run_[A-Za-z0-9]+$/.test(String(modelRunId || ""))) {
    const selected = run.result.selected_range;
    const requested_range = selected?.start && selected?.end ? { start: selected.start, end: selected.end } : null;
    message.icingModel = {
      run_id: modelRunId,
      result: null,
      winterArchive: run.result.archive_id || "",
      requested_range,
      // A historical replay has an explicit requested range but no fixed
      // winter archive view.  It should open the generic icing result map.
      map_visible: ["season", "range"].includes(run.result.view) || Boolean(requested_range),
    };
  }
}

async function restoreAgentScopeSession(session) {
  if (session.mode !== "workflow" || restoredAgentScopeSessions.has(session.id)) return;
  restoredAgentScopeSessions.add(session.id);
  try {
    const remote = await agentScopeMessages(workflowSessionId(session));
    if (!remote.length) return;
    for (const message of remote) {
      if (message.workflow) applyWorkflowRun(message, message.workflow);
    }
    session.msgs = remote;
    save();
    scrollBottom();
  } catch (error) {
    restoredAgentScopeSessions.delete(session.id);
    workflowCapabilityError.value = `AgentScope 对话恢复失败：${error.message}`;
  }
}

async function loadWorkflowCapabilities() {
  try {
    const data = await workflowCapabilities();
    const prompts = Array.isArray(data.suggested_prompts) ? data.suggested_prompts.filter(item => typeof item === "string" && item.trim()) : [];
    workflowChips.value = ["列出功能清单", ...prompts].slice(0, 7);
    workflowCapabilityError.value = "";
  } catch (error) {
    workflowCapabilityError.value = "能力清单暂时无法读取，以上为基础示例。";
  }
}

function fillWorkflowQuery(command) {
  if (streaming.value || cur.value.mode !== "workflow") return;
  inputText.value = command;
}

async function refreshWorkflow(message) {
  if (streaming.value) return;
  const sessionId = workflowSessionId(cur.value);
  if (message.workflow.session_id !== sessionId) return;
  streaming.value = true;
  message.workflowError = "";
  try {
    const run = await workflowGetRun(message.workflow.run_id, sessionId);
    applyWorkflowRun(message, run);
    message.workflowConfirmationPending = false;
  } catch (error) {
    message.workflowError = error.message;
  } finally {
    streaming.value = false;
    save();
  }
}

async function confirmWorkflow(message) {
  const sessionId = workflowSessionId(cur.value);
  if (streaming.value || message.workflowConfirmationPending || !canConfirmWorkflow(message.workflow, sessionId)) return;
  streaming.value = true;
  message.workflowError = "";
  // Persist the uncertainty marker before sending a write request. Never retry it automatically.
  message.workflowConfirmationPending = true;
  try {
    save();
    const run = await workflowConfirm(message.workflow, sessionId);
    applyWorkflowRun(message, run);
    message.workflowConfirmationPending = false;
  } catch (error) {
    message.workflowError = `${error.message} 请先刷新运行状态，核对是否已执行。`;
  } finally {
    streaming.value = false;
    save();
    scrollBottom();
  }
}

async function rejectWorkflow(message) {
  const sessionId = workflowSessionId(cur.value);
  if (streaming.value || message.workflowConfirmationPending || !canConfirmWorkflow(message.workflow, sessionId)) return;
  streaming.value = true;
  message.workflowError = "";
  message.workflowConfirmationPending = true;
  try {
    save();
    const reply = await workflowReject(message.workflow, sessionId);
    if (reply?.kind === "message") {
      message.workflow = null;
      message.content = reply.text;
    } else {
      applyWorkflowRun(message, reply);
    }
    message.workflowConfirmationPending = false;
  } catch (error) {
    message.workflowError = `${error.message} 请刷新会话确认当前状态。`;
  } finally {
    streaming.value = false;
    save();
    scrollBottom();
  }
}

function latestNowcastRunId() {
  for (let index = cur.value.msgs.length - 1; index >= 0; index -= 1) {
    const message = cur.value.msgs[index];
    const runId = message.nowcast?.task?.run_id || message.nowcastAnalysis?.run_id;
    if (/^run_[A-Za-z0-9]+$/.test(String(runId || ""))) return runId;
  }
  return "";
}

function latestIcingRunId() {
  for (let index = cur.value.msgs.length - 1; index >= 0; index -= 1) {
    const runId = cur.value.msgs[index].icingModel?.run_id;
    if (/^run_[A-Za-z0-9]+$/.test(String(runId || ""))) return runId;
  }
  return "";
}

function applyToolEvent(msg, ev) {
  let tc = msg.toolCalls.find(t => t.name === ev.name);
  if (!tc) {
    tc = { name: ev.name, label: ev.label ?? "", status: ev.status ?? "", progress: 0, result: "" };
    msg.toolCalls.push(tc);
  }
  if (ev.status != null) tc.status = ev.status;
  if (ev.label != null) tc.label = ev.label;
  if (ev.progress != null) tc.progress = ev.progress;
  if (ev.result != null) tc.result = ev.result;
}

function applyAnalysisResult(msg, ev) {
  const item = {
    name: ev.name,
    label: ev.label,
    status: ev.status,
    summary: ev.summary,
    guardrail: ev.guardrail || null,
    plan: ev.plan || null,
    action: ev.action || null,
    sources: ev.sources || [],
    warnings: ev.warnings || [],
    records: ev.records || [],
    timeRange: ev.time_range || null,
    confirming: false,
    confirmed: false,
  };
  msg.processEvents.push(item);
  const tc = msg.toolCalls.find(t => t.name === ev.name);
  if (tc) {
    tc.analysis = item;
    if (ev.summary) tc.result = ev.summary;
  }
}

function applyModelView(msg, ev) {
  if (ev.model_id !== "icing_prediction" || !ev.run_id) return;
  msg.icingModel = { run_id: ev.run_id, result: null, map_visible: true };
}

function openIcingModel(state) {
  state.map_visible = true;
  save();
  expandedIcingModel.value = state;
  icingModelDialog.value = true;
}

function processTitle(ev) {
  if (ev.name === "run_action_dry_run") return "Action 预演";
  if (ev.name === "run_action_confirmed") return "Action 执行";
  if (ev.name === "portable_run_logic") return "业务逻辑";
  if (ev.name?.startsWith?.("db_")) return "数据库分析";
  return ev.label || ev.name || "分析结果";
}

function processStatus(ev) {
  if (ev.guardrail?.allowed === false) return "已阻止";
  if (ev.status === "ok") return "完成";
  return ev.status || "完成";
}

function processStatusClass(ev) {
  if (ev.guardrail?.allowed === false || ev.status === "blocked") return "blocked";
  if (ev.status === "ok") return "ok";
  return "";
}

function compactSources(sources) {
  return sources.map(item => {
    if (typeof item === "string") return item;
    if (item.database) return [item.database, ...(item.tables || [])].join(" / ");
    if (item.table) return [item.database, item.table].filter(Boolean).join(" / ");
    if (item.meta_file) return item.meta_file;
    return JSON.stringify(item);
  }).join("；");
}

function runCommand(prompt) {
  inputText.value += prompt + ' ';
}

function canConfirmAction(ev) {
  return ev?.name === "run_action_dry_run"
    && ev?.guardrail?.allowed === true
    && ev?.guardrail?.requires_confirmation === true
    && ev?.guardrail?.confirmed !== true
    && ev?.action?.action_id
    && ev?.action?.parameters;
}

async function confirmAction(ev) {
  if (!canConfirmAction(ev) || streaming.value || cur.value.mode === "workflow") return;
  ev.confirming = true;
  inputText.value = ev.action.confirm_prompt || buildConfirmPrompt(ev.action);
  await send();
  ev.confirming = false;
  ev.confirmed = true;
}

function buildConfirmPrompt(action) {
  if (action.action_id === "retry_failed_parse" && action.parameters?.file_uuid) {
    return `确认重试解析 file_uuid ${action.parameters.file_uuid}`;
  }
  if (action.action_id === "parse_existing_file" && action.parameters?.file_path) {
    return `确认解析 ${action.parameters.file_path}`;
  }
  return `确认执行 action ${action.action_id}`;
}

function answerParam(field, value) {
  const v = (value ?? "").toString().trim();
  if (!v || streaming.value || cur.value.mode === "workflow") return;
  for (let i = cur.value.msgs.length - 1; i >= 0; i--) {
    if (cur.value.msgs[i].paramPrompt) { cur.value.msgs[i].paramPrompt = null; break; }
  }
  paramDraft.value = {};
  inputText.value = `${field.label}：${v}`;
  send();
}

async function send() {
  if (!inputText.value.trim() || streaming.value) return;
  const text = inputText.value.trim();
  const session = cur.value;
  const mode = session.mode || "legacy";
  inputText.value = "";
  if (cur.value.title === "新对话") cur.value.title = text.slice(0, 16);
  appendMsg("user", text, session, mode);
  streaming.value = true;
  const aiMsg = appendMsg("assistant", "", session, mode);
  if (mode === "workflow") {
    aiMsg.content = "正在理解需求并检查可用覆冰能力…";
    try {
      const reply = await workflowChat(workflowSessionId(session), text);
      if (reply?.kind === "message") aiMsg.content = reply.text;
      else applyWorkflowRun(aiMsg, reply);
    } catch (error) {
      aiMsg.content = error.message;
    } finally {
      aiMsg.streaming = false;
      streaming.value = false;
      save();
      scrollBottom();
    }
    return;
  }
  try {
    for await (const ev of chatStream(
      legacyMessages(session.msgs.slice(0, -1)),
      {
        session_id: session.id,
        nowcast_run_id: latestNowcastRunId(),
        icing_run_id: latestIcingRunId(),
      }
    )) {
      if (ev.type === "text") aiMsg.content += ev.value;
      else if (ev.type === "tool") applyToolEvent(aiMsg, ev);
      else if (ev.type === "analysis_result") applyAnalysisResult(aiMsg, ev);
      else if (ev.type === "model_view") applyModelView(aiMsg, ev);
      else if (ev.type === "image") aiMsg.images.push({ url: ev.url, caption: ev.caption });
      else if (ev.type === "need_params") aiMsg.paramPrompt = { model: ev.model, modelName: ev.model_name, fields: ev.fields };
      else if (ev.type === "nowcast_confirmation") {
        aiMsg.nowcast = {
          confirmation: ev,
          task: null,
          result: null,
          collapsed: false,
        };
      }
      else if (ev.type === "nowcast_analysis") {
        aiMsg.nowcastAnalysis = ev.analysis;
      }
      else if (ev.type === "error") aiMsg.content += `\n⚠️ ${ev.message}`;
      scrollBottom();
    }
  } catch (e) {
    aiMsg.content += `\n⚠️ 连接智能体后端失败：${e.message}`;
  }
  aiMsg.streaming = false;
  streaming.value = false;
  save();
}

function onDocClick() { menuId.value = null; }
watch(leftCollapsed, value => localStorage.setItem("agent_left_collapsed", value ? "1" : "0"));
watch(rightCollapsed, value => localStorage.setItem("agent_right_collapsed", value ? "1" : "0"));
watch(activeId, () => save());
watch(activeId, () => restoreAgentScopeSession(cur.value));
onMounted(() => {
  // Rewrite legacy array storage into the versioned, compact form after it loads.
  save();
  document.addEventListener("click", onDocClick);
  tickTimer = setInterval(() => infoIdx.value++, 3000);
  loadWorkflowCapabilities();
  restoreAgentScopeSession(cur.value);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  clearInterval(tickTimer);
});
</script>

<style scoped>
.agent-mode { display: flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.agent-mode select { background: var(--field); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px; font: inherit; }
.agent-mode option { background: var(--panel, #172334); color: var(--text); }
.workflow-hint { padding: 8px 14px; font-size: 12px; line-height: 1.6; color: var(--muted); border-bottom: 1px solid var(--border); }
.workflow-hint a { color: var(--accent); margin-left: 6px; }
.message-origin { color: var(--muted); font-size: 10px; margin-top: 6px; }
.workflow-help { padding: 14px; font-size: 12px; line-height: 1.7; width: 100%; overflow-y: auto; }
.workflow-help .chip { display: block; margin: 7px 0; text-align: left; }
.workflow-help p { color: var(--muted); }
.agent {
  display: flex;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
  position: relative;
}

/* 鈹€鈹€ sidebar 鈹€鈹€ */
.sidebar {
  position: relative;
  width: 196px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width .18s ease, padding .18s ease, border-color .18s ease;
}

.sidebar.collapsed {
  width: 42px;
  padding: 0;
  border-color: rgba(78, 161, 255, .22);
}

.workbench-shell {
  position: relative;
  width: 220px;
  flex-shrink: 0;
  display: flex;
  min-width: 0;
  transition: width .18s ease;
}

.workbench-shell.collapsed {
  width: 42px;
}

.workbench-shell :deep(.workbench) {
  width: 100%;
}

.side-toggle {
  position: absolute;
  z-index: 20;
  top: 50%;
  width: 24px;
  height: 52px;
  transform: translateY(-50%);
  border: 1px solid rgba(78, 161, 255, .28);
  border-radius: 8px;
  background: rgba(17, 27, 44, .92);
  color: var(--accent);
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(0, 0, 0, .26);
}

.side-toggle:hover {
  border-color: rgba(78, 161, 255, .55);
  background: rgba(31, 48, 76, .98);
}

.side-toggle.left {
  right: 8px;
}

.sidebar.collapsed .side-toggle.left {
  right: 8px;
}

.side-toggle.right {
  left: 8px;
}

.workbench-shell.collapsed .side-toggle.right {
  left: 8px;
}

.new-btn {
  flex-shrink: 0;
  margin: 14px 12px 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: background 0.15s;
}

.agent-process {
  display: grid;
  gap: 9px;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: 8px;
  background: rgba(15, 23, 42, .18);
}

.ap-head,
.ap-title,
.guardrail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ap-head {
  color: var(--muted);
  font-size: 11px;
}

.ap-head span,
.plan-title {
  color: #93c5fd;
  font-weight: 700;
}

.ap-item {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 7px;
  background: rgba(255, 255, 255, .035);
}

.ap-title span {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.ap-status {
  color: var(--muted);
  font-size: 11px;
}

.ap-status.ok,
.guardrail-row b.ok {
  color: #22c55e;
}

.ap-status.blocked,
.guardrail-row b.blocked {
  color: #f87171;
}

.ap-item p {
  margin: 0;
  color: rgba(226, 232, 240, .86);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.guardrail-box,
.plan-box {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 7px;
  background: rgba(2, 6, 23, .16);
}

.guardrail-row {
  color: var(--muted);
  font-size: 11px;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(3, auto 1fr);
  gap: 6px 8px;
  color: var(--muted);
  font-size: 11px;
}

.mini-grid b {
  color: var(--text);
}

.guardrail-box ul,
.plan-box ol {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.source-line {
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.action-confirm-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px;
  border: 1px solid rgba(59, 130, 246, .28);
  border-radius: 7px;
  background: rgba(59, 130, 246, .08);
}

.action-confirm-box div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.action-confirm-box b {
  color: #93c5fd;
  font-size: 11px;
}

.action-confirm-box span {
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.action-confirm-btn {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 11px;
  border: 1px solid rgba(96, 165, 250, .5);
  border-radius: 7px;
  background: rgba(37, 99, 235, .22);
  color: #dbeafe;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.action-confirm-btn:disabled {
  cursor: default;
  opacity: .55;
}
.new-btn:hover { background: rgba(255, 255, 255, 0.16); }
.new-btn .el-icon { color: var(--accent); font-size: 15px; }

.hist-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px;
  scrollbar-width: none;
}
.hist-list::-webkit-scrollbar { display: none; }

.hist-sep {
  font-size: 10px;
  color: var(--muted);
  padding: 8px 8px 5px;
  letter-spacing: 0.5px;
}

.hist-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  transition: 0.12s;
  margin-bottom: 4px;
}
.hist-item:hover { background: var(--field); }
.hist-item.on { background: var(--accent-soft); }

.hi-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hi-title {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hi-date { font-size: 10px; color: var(--muted); opacity: 0.55; }

.hist-item:hover .hi-title,
.hist-item:hover .hi-date { color: var(--text); opacity: 1; }
.hist-item.on .hi-title { color: var(--accent); opacity: 1; }
.hist-item.on .hi-date { color: var(--accent); opacity: 0.65; }

.hi-input {
  width: 100%;
  font: inherit;
  font-size: 12px;
  background: var(--field);
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 2px 6px;
  color: var(--text);
  outline: none;
}

.hi-menu-btn {
  flex-shrink: 0;
  visibility: hidden;
  display: flex;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  transition: 0.12s;
  padding: 0;
}
.hist-item:hover .hi-menu-btn { visibility: visible; }
.hi-menu-btn:hover { background: rgba(255, 255, 255, 0.12); color: var(--text); }

.sb-foot {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
}
.sdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  flex-shrink: 0;
}
.sb-ticker-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
  height: 1.2em;
  overflow: hidden;
}
.sb-ticker {
  position: absolute;
  inset: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tick-enter-active { transition: opacity 0.35s, transform 0.35s; }
.tick-leave-active { transition: opacity 0.25s, transform 0.25s; position: absolute; }
.tick-enter-from { opacity: 0; transform: translateY(8px); }
.tick-leave-to   { opacity: 0; transform: translateY(-8px); }

/* 鈹€鈹€ 涓夌偣涓嬫媺鑿滃崟锛坱eleport 鍒?body锛夆攢鈹€ */
.hi-dd {
  position: fixed;
  z-index: 300;
  min-width: 96px;
  background: var(--field);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.hi-dd-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  border-radius: 7px;
  cursor: pointer;
  transition: 0.12s;
}
.hi-dd-item:hover { background: var(--glass); }
.hi-dd-del { color: #ef4444; }
.hi-dd-del:hover { background: rgba(239, 68, 68, 0.12); }

/* 鈹€鈹€ chat 鈹€鈹€ */
.chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-head {
  flex-shrink: 0;
  height: 52px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
.ch-title { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge {
  font-size: 10px;
  padding: 2px 9px;
  border-radius: 20px;
  background: rgba(78, 161, 255, 0.12);
  border: 1px solid rgba(78, 161, 255, 0.22);
  color: var(--accent);
}

.msgs {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.msg { display: flex; gap: 10px; max-width: 88%; }
.msg.u { align-self: flex-end; flex-direction: row-reverse; }
.msg.workflow-msg { width: 100%; max-width: 100%; }
.workflow-msg .bub { min-width: 0; flex: 1; }

.av {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}
.av-ai { background: rgba(78, 161, 255, 0.18); color: var(--accent); border: 1px solid rgba(78, 161, 255, 0.28); }
.av-u  { background: rgba(52, 211, 153, 0.18); color: var(--ok);    border: 1px solid rgba(52, 211, 153, 0.28); }

.bub {
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.bub-ai { background: var(--field); border: 1px solid var(--border); border-radius: 4px 13px 13px 13px; }
.bub-u  { background: rgba(78, 161, 255, 0.13); border: 1px solid rgba(78, 161, 255, 0.22); border-radius: 13px 4px 13px 13px; }

/* 鈹€鈹€ Markdown 鈹€鈹€ */
.md { white-space: normal; }
.md :deep(> *:first-child) { margin-top: 0; }
.md :deep(> *:last-child) { margin-bottom: 0; }
.md :deep(p) { margin: 6px 0; }
.md :deep(h1), .md :deep(h2), .md :deep(h3), .md :deep(h4) {
  margin: 12px 0 6px; font-size: 14px; font-weight: 600; line-height: 1.4;
}
.md :deep(ul), .md :deep(ol) { margin: 6px 0; padding-left: 20px; }
.md :deep(li) { margin: 2px 0; }
.md :deep(strong) { font-weight: 600; color: var(--text); }
.md :deep(a) { color: var(--accent); text-decoration: none; }
.md :deep(a:hover) { text-decoration: underline; }
.md :deep(code) {
  font-family: monospace; font-size: 12px;
  background: rgba(127, 127, 127, 0.16); padding: 1px 5px; border-radius: 4px;
}
.md :deep(pre) {
  background: rgba(0, 0, 0, 0.22); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 8px 0;
}
.md :deep(pre code) { background: none; padding: 0; }
.md :deep(blockquote) {
  margin: 8px 0; padding: 2px 12px; color: var(--muted);
  border-left: 3px solid var(--border);
}
.md :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
.md :deep(table) {
  border-collapse: collapse; margin: 8px 0; font-size: 12px; display: block;
  overflow-x: auto; max-width: 100%;
}
.md :deep(th), .md :deep(td) { border: 1px solid var(--border); padding: 5px 9px; text-align: left; }
.md :deep(th) { background: rgba(127, 127, 127, 0.12); font-weight: 600; }

.cursor {
  display: inline-block;
  width: 2px;
  height: 13px;
  background: var(--accent);
  animation: blink 1s infinite;
  vertical-align: middle;
  margin-left: 2px;
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* 鈹€鈹€ 鐢熸垚鍥惧儚 鈹€鈹€ */
.msg-img-link { display: block; margin-top: 8px; text-decoration: none; }
.msg-img { display: block; max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }
.msg-img-cap { display: block; margin-top: 4px; font-size: 11px; color: var(--muted); }

/* 鈹€鈹€ 鍙傛暟琛ュ叏鍗?鈹€鈹€ */
.pc {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(78, 161, 255, 0.06);
  border: 1px solid rgba(78, 161, 255, 0.22);
  border-radius: 10px;
}
.pc-head { font-size: 11.5px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }
.pc-field { margin-bottom: 10px; }
.pc-field:last-child { margin-bottom: 0; }
.pc-label { font-size: 12px; color: var(--text); margin-bottom: 5px; }
.pc-req { color: #f87171; margin-left: 2px; }
.pc-opts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.pc-opt {
  padding: 3px 11px; border-radius: 20px; font: inherit; font-size: 11.5px;
  border: 1px solid var(--border); background: var(--field); color: var(--text);
  cursor: pointer; transition: 0.12s;
}
.pc-opt:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pc-opt:disabled { opacity: 0.5; cursor: default; }
.pc-input-row { display: flex; gap: 6px; }
.pc-input {
  flex: 1; min-width: 0; background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px;
  font: inherit; font-size: 12px; color: var(--text); outline: none;
}
.pc-input:focus { border-color: rgba(78, 161, 255, 0.4); }
.pc-ok {
  padding: 5px 14px; border-radius: 8px; font: inherit; font-size: 12px;
  border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer;
}
.pc-ok:disabled { opacity: 0.5; cursor: default; }

/* 鈹€鈹€ input 鈹€鈹€ */
.input-area {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
}
.chips { display: flex; gap: 5px; margin-bottom: 8px; flex-wrap: wrap; }
.chip {
  padding: 3px 11px;
  border-radius: 20px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: var(--field);
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  transition: 0.12s;
}
.chip:hover { border-color: var(--accent); color: var(--accent); }

.input-row { display: flex; gap: 8px; align-items: flex-end; }

.input-box {
  flex: 1;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 13px;
  font-size: 13px;
  color: var(--text);
  resize: none;
  outline: none;
  font-family: inherit;
  line-height: 1.5;
  min-height: 38px;
  max-height: 120px;
  transition: border-color 0.15s;
}
.input-box::placeholder { color: var(--muted); }
.input-box:focus { border-color: rgba(78, 161, 255, 0.4); }

.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--field);
  border: 1px solid var(--border);
  color: var(--muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  font-size: 16px;
  transition: 0.15s;
}
.send-btn.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.send-btn:disabled { cursor: default; opacity: 0.4; }
</style>
