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
          <button class="hi-menu-btn" @click.stop="openMenu(s.id, $event)">···</button>
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
            <span v-if="m.role === 'user'" class="plain">{{ m.content }}</span>
            <span v-else class="md" v-html="renderMarkdown(m.content)"></span><span v-if="m.streaming" class="cursor"></span>
            <ToolCallCard v-for="tc in (m.toolCalls ?? [])" :key="tc.name" :tc="tc" />
            <a
              v-for="(im, i) in (m.images ?? [])" :key="i"
              :href="im.url" target="_blank" class="msg-img-link"
            >
              <img :src="im.url" :alt="im.caption || '生成图像'" class="msg-img" />
              <span v-if="im.caption" class="msg-img-cap">{{ im.caption }}</span>
            </a>
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

  <teleport to="body">
    <div
      v-if="menuId"
      class="hi-dd"
      :style="{ top: ddPos.top, left: ddPos.left }"
      @click.stop
    >
      <button class="hi-dd-item" @click="startRename(menuId)">改名</button>
      <button class="hi-dd-item hi-dd-del" @click="deleteSession(menuId); menuId = null">删除</button>
    </div>
  </teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowRight, Plus } from "@element-plus/icons-vue";
import { chatStream } from "../api.js";
import { renderMarkdown } from "../markdown.js";
import ToolCallCard from "../components/ToolCallCard.vue";
import WorkbenchPanel from "../components/WorkbenchPanel.vue";

const SKEY = "agent_sessions";

function initSessions() {
  const stored = localStorage.getItem(SKEY);
  if (stored) return JSON.parse(stored);
  return [{
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: Date.now(),
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
const menuId = ref(null);
const ddPos = ref({ top: "0px", left: "0px" });
const editingId = ref(null);
const editTitle = ref("");

const cur = computed(() => sessions.value.find(s => s.id === activeId.value));
const quickChips = ["/调用模型", "/查询数据", "/生成图表", "/生成报告"];

const infoIdx = ref(0);
const infoItems = computed(() => [
  "claude-sonnet-4-6",
  "上下文 200K tokens",
  `${sessions.value.length} 个会话`,
  `${sessions.value.reduce((a, s) => a + s.msgs.length, 0)} 条消息`,
  "流式输出 · SSE",
]);
let tickTimer = null;

function save() {
  localStorage.setItem(SKEY, JSON.stringify(sessions.value));
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
  const s = {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: Date.now(),
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
  const m = { id: crypto.randomUUID(), role, content, toolCalls: [], images: [], streaming: role === "assistant" };
  cur.value.msgs.push(m);
  scrollBottom();
  return cur.value.msgs[cur.value.msgs.length - 1];
}

function applyToolEvent(msg, ev) {
  let tc = msg.toolCalls.find(t => t.name === ev.name);
  if (!tc) {
    tc = { name: ev.name, label: ev.label ?? "", progress: 0, result: "" };
    msg.toolCalls.push(tc);
  }
  if (ev.label != null) tc.label = ev.label;
  if (ev.progress != null) tc.progress = ev.progress;
  if (ev.result != null) tc.result = ev.result;
}

async function send() {
  if (!inputText.value.trim() || streaming.value) return;
  const text = inputText.value.trim();
  inputText.value = "";
  if (cur.value.title === "新对话") cur.value.title = text.slice(0, 16);
  appendMsg("user", text);
  streaming.value = true;
  const aiMsg = appendMsg("assistant", "");
  try {
    for await (const ev of chatStream(
      cur.value.msgs.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
      {}
    )) {
      if (ev.type === "text") aiMsg.content += ev.value;
      else if (ev.type === "tool") applyToolEvent(aiMsg, ev);
      else if (ev.type === "image") aiMsg.images.push({ url: ev.url, caption: ev.caption });
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
onMounted(() => {
  document.addEventListener("click", onDocClick);
  tickTimer = setInterval(() => infoIdx.value++, 3000);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  clearInterval(tickTimer);
});
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

/* ── 三点下拉菜单（teleport 到 body）── */
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

/* ── Markdown ── */
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

/* ── 生成图像 ── */
.msg-img-link { display: block; margin-top: 8px; text-decoration: none; }
.msg-img { display: block; max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }
.msg-img-cap { display: block; margin-top: 4px; font-size: 11px; color: var(--muted); }

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
