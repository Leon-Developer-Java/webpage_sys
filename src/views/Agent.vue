<template>
  <div class="agent">
    <div class="sidebar glass">
      <button class="new-btn" @click="newSession">
        <el-icon><Plus /></el-icon>新建对话
      </button>
      <div class="hist-list">
        <div class="hist-sep">历史对话</div>
        <div
          v-for="s in sessions" :key="s.id"
          :class="['hist-item', { on: s.id === activeId }]"
          @click="activeId = s.id"
        >{{ s.title }}</div>
      </div>
      <div class="sb-foot">
        <span class="sdot"></span>claude-sonnet-4-6
      </div>
    </div>

    <div class="chat glass">
      <div class="chat-head">
        <span class="ch-title">{{ cur.title }}</span>
        <span class="badge">数据库已连接</span>
      </div>
      <div class="msgs" ref="msgsEl">
        <div
          v-for="m in cur.msgs" :key="m.id"
          :class="['msg', { u: m.role === 'user' }]"
        >
          <div :class="['av', m.role === 'user' ? 'av-u' : 'av-ai']">
            {{ m.role === 'user' ? '我' : 'AI' }}
          </div>
          <div :class="['bub', m.role === 'user' ? 'bub-u' : 'bub-ai']">
            {{ m.content }}<span v-if="m.streaming" class="cursor"></span>
            <ToolCallCard v-for="tc in (m.toolCalls ?? [])" :key="tc.name" :tc="tc" />
          </div>
        </div>
      </div>
      <div class="input-area">
        <div class="chips">
          <button v-for="c in quickChips" :key="c" class="chip" @click="inputText = c + ' '">{{ c }}</button>
        </div>
        <div class="input-row">
          <textarea
            class="input-box"
            v-model="inputText"
            rows="1"
            placeholder="输入问题，或点击快捷指令…"
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

    <WorkbenchPanel @cmd="c => inputText = c + ' '" />
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import { ArrowRight, Plus } from "@element-plus/icons-vue";
import { chatStream } from "../api.js";
import ToolCallCard from "../components/ToolCallCard.vue";
import WorkbenchPanel from "../components/WorkbenchPanel.vue";

const SKEY = "agent_sessions";

function initSessions() {
  const stored = localStorage.getItem(SKEY);
  if (stored) return JSON.parse(stored);
  return [{
    id: crypto.randomUUID(),
    title: "新对话",
    msgs: [{
      id: "0",
      role: "assistant",
      content: "您好！当前数据库已连接，WRF / ERA5 / 雷达外推 / 葵花云图模型均在线。\n\n请问有什么需要？可以直接提问，或使用下方快捷指令调用气象模型。",
      toolCalls: [],
    }],
  }];
}

const sessions = ref(initSessions());
const activeId = ref(sessions.value[0].id);
const inputText = ref("");
const streaming = ref(false);
const msgsEl = ref(null);

const cur = computed(() => sessions.value.find(s => s.id === activeId.value));

const quickChips = ["/调用模型", "/查询数据", "/生成图表", "/生成报告"];

function save() {
  localStorage.setItem(SKEY, JSON.stringify(sessions.value));
}

function scrollBottom() {
  nextTick(() => { if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight; });
}

function newSession() {
  const s = {
    id: crypto.randomUUID(),
    title: "新对话",
    msgs: [{
      id: crypto.randomUUID(),
      role: "assistant",
      content: "您好！当前数据库已连接，可用模型：WRF、ERA5、雷达外推、葵花云图。请问有什么需要？",
      toolCalls: [],
    }],
  };
  sessions.value.unshift(s);
  activeId.value = s.id;
  save();
}

function appendMsg(role, content) {
  const m = { id: crypto.randomUUID(), role, content, toolCalls: [], streaming: role === "assistant" };
  cur.value.msgs.push(m);
  scrollBottom();
  return m;
}

async function send() {
  if (!inputText.value.trim() || streaming.value) return;
  const text = inputText.value.trim();
  inputText.value = "";
  if (cur.value.title === "新对话") cur.value.title = text.slice(0, 16);
  appendMsg("user", text);
  streaming.value = true;
  const aiMsg = appendMsg("assistant", "");
  for await (const chunk of chatStream(
    cur.value.msgs.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
    {}
  )) {
    aiMsg.content += chunk;
    scrollBottom();
  }
  aiMsg.streaming = false;
  streaming.value = false;
  save();
}
</script>

<style scoped>
.agent {
  display: flex;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}

/* ── sidebar ── */
.sidebar {
  width: 196px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: 0.12s;
}
.hist-item:hover { background: var(--field); color: var(--text); }
.hist-item.on { background: var(--accent-soft); color: var(--accent); }

.sb-foot {
  flex-shrink: 0;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 7px;
}
.sdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  flex-shrink: 0;
}

/* ── chat ── */
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
.ch-title { font-size: 14px; font-weight: 600; flex: 1; }
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

/* ── input ── */
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
