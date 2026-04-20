<template>
  <div class="chat-panel">
    <!-- messages -->
    <div class="chat-messages" ref="messagesEl" @scroll="chat.onScroll()">
      <div v-if="chat.messages.length === 0" class="chat-empty">
        <div class="chat-empty-icon">{{ agentEmoji }}</div>
        <p>向 <strong>{{ agentName }}</strong> 发一条消息开始对话</p>
      </div>

      <div
        v-for="msg in chat.messages"
        :key="msg.id"
        :class="['cpanel-msg', msg.role]"
      >
        <div class="cpanel-bubble">
          <!-- thinking -->
          <details
            v-if="msg.reasoning"
            class="thinking-block"
            :open="msg.streaming && msg.phase === 'thinking'"
          >
            <summary class="thinking-summary">
              <span>💭 思考过程</span>
              <span v-if="msg.streaming && msg.phase === 'thinking'" class="thinking-live">推理中…</span>
              <span v-else class="thinking-tokens">{{ msg.reasoning.replace(/\s+/g,'').length }} 字</span>
            </summary>
            <pre class="thinking-content">{{ msg.reasoning }}</pre>
          </details>

          <!-- phase indicator -->
          <div v-if="msg.streaming && !msg.text" class="phase-row">
            <span :class="['phase-dot', msg.phase === 'thinking' ? 'ph-think' : 'ph-send']" />
            <span class="phase-label">{{ phaseLabel(msg.phase) }}</span>
          </div>

          <!-- text -->
          <div v-if="msg.text" v-html="chat.renderMarkdown(msg.text)" class="md-content" />
          <span v-if="msg.streaming && msg.text" class="cursor">▌</span>

          <!-- token usage -->
          <div v-if="msg.usage && !msg.streaming" class="token-row">
            <span>↑ {{ msg.usage.input.toLocaleString() }}</span>
            <span class="sep">·</span>
            <span>↓ {{ msg.usage.output.toLocaleString() }} tok</span>
          </div>
        </div>
        <div class="cpanel-meta">{{ msg.role === 'user' ? '你' : agentName }} · {{ formatTime(msg.createdAt) }}</div>
      </div>
    </div>

    <!-- toolbar -->
    <div class="chat-toolbar">
      <select v-model="mode" class="mode-select" :disabled="chat.streaming.value">
        <option value="chat">对话</option>
        <option value="execute">执行</option>
        <option value="plan">规划</option>
        <option value="unlimited">无限制</option>
      </select>
      <button class="tb-btn" @click="chat.clear()" :disabled="chat.streaming.value || chat.messages.length === 0">清空</button>
    </div>

    <!-- input -->
    <div class="chat-input-bar">
      <textarea
        v-model="draft"
        ref="textareaEl"
        class="chat-textarea"
        placeholder="发送消息… Enter 发送，Shift+Enter 换行"
        rows="1"
        :disabled="chat.streaming.value"
        @keydown="onKeydown"
        @input="autoResize"
      />
      <button v-if="chat.streaming.value" class="abort-btn" @click="chat.abort()">■</button>
      <button
        v-else
        class="send-btn"
        :disabled="!draft.trim()"
        @click="doSend"
      >发送</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useAgentChat } from '../composables/useAgentChat.js'
import type { ChatMode } from '../composables/useAgentChat.js'

const props = defineProps<{
  agentId: string
  agentName?: string
  agentEmoji?: string
}>()

const chat = useAgentChat()
const draft = ref('')
const mode = ref<ChatMode>('execute')
const messagesEl = ref<HTMLElement>()
const textareaEl = ref<HTMLTextAreaElement>()

const agentName = props.agentName || props.agentId
const agentEmoji = props.agentEmoji || '🤖'

function phaseLabel(phase?: string): string {
  if (phase === 'thinking') return '正在思考…'
  if (phase === 'replying') return '正在回复…'
  return '发送中…'
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(ts)
}

function autoResize() {
  if (!textareaEl.value) return
  textareaEl.value.style.height = 'auto'
  textareaEl.value.style.height = `${Math.min(textareaEl.value.scrollHeight, 120)}px`
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    doSend()
  }
}

async function doSend() {
  const text = draft.value.trim()
  if (!text || chat.streaming.value) return
  draft.value = ''
  await nextTick()
  autoResize()
  await chat.send(text, props.agentId, mode.value)
}

onMounted(() => {
  if (messagesEl.value) chat.attachScroll(messagesEl.value)
  chat.jumpToBottom()
})

onUnmounted(() => { chat.abort() })

// If the panel gets re-mounted for a different agent, clear state
watch(() => props.agentId, () => { chat.clear() })
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 560px;
  min-height: 360px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  scroll-behavior: smooth;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: var(--space-8) 0;
}
.chat-empty-icon { font-size: 32px; }

/* message bubbles */
.cpanel-msg { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }
.cpanel-msg.user { align-self: flex-end; align-items: flex-end; }
.cpanel-msg.assistant { align-self: flex-start; align-items: flex-start; }

.cpanel-bubble {
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: var(--text-sm);
  line-height: 1.6;
  word-break: break-word;
}
.cpanel-msg.user .cpanel-bubble {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.cpanel-msg.assistant .cpanel-bubble {
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-bottom-left-radius: 4px;
}

.cpanel-meta {
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 4px;
}

/* thinking */
.thinking-block {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.thinking-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  background: var(--surface);
  color: var(--text-muted);
  user-select: none;
  list-style: none;
}
.thinking-live { color: var(--accent); animation: pulse 1s infinite; }
.thinking-tokens { margin-left: auto; }
.thinking-content {
  font-size: 11px;
  color: var(--text-muted);
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg);
  max-height: 180px;
  overflow-y: auto;
  margin: 0;
  font-family: var(--font-mono);
}

/* phase indicator */
.phase-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
.phase-dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 1s infinite; }
.ph-think { background: #a78bfa; }
.ph-send  { background: var(--accent); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

.cursor { color: var(--accent); animation: blink .9s step-end infinite; }
@keyframes blink { 50% { opacity: 0 } }

/* token row */
.token-row {
  display: flex;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-soft);
}
.sep { color: var(--border); }

/* markdown */
.md-content :deep(p) { margin: 0 0 6px; }
.md-content :deep(p:last-child) { margin: 0; }
.md-content :deep(pre) {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  overflow-x: auto;
  font-size: 12px;
  margin: 6px 0;
}
.md-content :deep(code) { font-family: var(--font-mono); font-size: .9em; }
.md-content :deep(ul), .md-content :deep(ol) { padding-left: 18px; margin: 4px 0; }
.cpanel-msg.user .md-content :deep(a) { color: rgba(255,255,255,.85); }

/* toolbar */
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  border-top: 1px solid var(--border-soft);
  background: var(--surface);
}
.mode-select {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
}
.tb-btn {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: color .15s, border-color .15s;
}
.tb-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent); }
.tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* input bar */
.chat-input-bar {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.chat-textarea {
  flex: 1;
  resize: none;
  font-size: var(--text-sm);
  line-height: 1.5;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
  transition: border-color .15s;
  min-height: 38px;
  max-height: 120px;
}
.chat-textarea:focus { border-color: var(--accent); }
.chat-textarea:disabled { opacity: 0.5; }

.send-btn, .abort-btn {
  padding: 8px 16px;
  border-radius: var(--radius);
  border: none;
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity .15s;
}
.send-btn {
  background: var(--accent);
  color: #fff;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.abort-btn {
  background: var(--error-bg);
  color: var(--error-text);
}
</style>
