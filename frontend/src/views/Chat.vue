<template>
  <div class="chat-page page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">聊天</h1>
        <p class="subtitle">直接与 OpenClaw Agent 对话，支持为不同 Agent 保留独立会话、附件与上下文。</p>
      </div>
      <div class="header-actions">
        <div class="agent-switcher">
          <label for="chat-agent-select" class="agent-switcher-label">Agent</label>
          <div class="agent-switcher-field">
            <span class="agent-switcher-icon">{{ currentAgentEmoji }}</span>
            <select
              id="chat-agent-select"
              v-model="selectedAgentId"
              class="agent-select"
              :disabled="streaming || loadingAgents"
            >
              <option v-for="agent in agentOptions" :key="agent.id" :value="agent.id">
                {{ formatAgentOption(agent) }}
              </option>
            </select>
          </div>
        </div>
        <ChatModeSelector v-model="currentMode" />
        <button @click="loadAgents" class="btn btn-sm" :disabled="loadingAgents || streaming">
          {{ loadingAgents ? '刷新中…' : '刷新' }}
        </button>
        <button @click="clearChat" class="btn btn-sm" :disabled="streaming">新对话</button>
      </div>
    </div>

    <div class="chat-root">
      <!-- Top bar: agent info + role filter -->
      <div class="conversation-bar">
        <div class="agent-chip">
          <span class="agent-chip-icon">{{ currentAgentEmoji }}</span>
          <div>
            <div class="agent-chip-title">{{ currentAgentName }}</div>
            <p class="agent-chip-subtitle">
              {{ currentAgent.id === 'main' ? '默认主 Agent' : `Agent：${currentAgent.id}` }}
              <span v-if="filteredMessages.length !== messages.length" class="filter-count">
                · 显示 {{ filteredMessages.length }}/{{ messages.length }}
              </span>
            </p>
          </div>
        </div>

        <div class="bar-right">
          <p v-if="agentsError" class="conversation-warning">{{ agentsError }}</p>
          <!-- Role filter -->
          <div class="role-filter">
            <button
              v-for="f in ROLE_FILTERS"
              :key="f.value"
              :class="['rf-btn', roleFilter === f.value && 'active']"
              @click="roleFilter = f.value"
            >{{ f.label }}</button>
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div class="messages" ref="messagesEl" @scroll="onScroll">
        <div v-if="filteredMessages.length === 0" class="empty-hint">
          <p v-if="messages.length === 0">向 {{ currentAgentName }} 发送第一条消息</p>
          <p v-else>当前过滤器无匹配消息</p>
          <p class="sub">输入 <code>/</code> 查看可用命令</p>
        </div>

        <div
          v-for="msg in filteredMessages"
          :key="msg.id"
          :class="['msg', msg.role]"
          @mouseenter="hoverMsgId = msg.id"
          @mouseleave="hoverMsgId = ''"
        >
          <!-- Tool-call step cards (independent of the text bubble) -->
          <details
            v-for="step in msg.steps"
            :key="step.id"
            class="tool-step-card"
            :open="step.status === 'running'"
          >
            <summary class="tool-step-summary">
              <span class="tool-step-icon">⚡</span>
              <span class="tool-step-name">{{ step.name }}</span>
              <span :class="['tool-step-status', step.status]">{{ toolStatusLabel(step.status) }}</span>
              <span v-if="step.ts" class="tool-step-time">{{ formatTime(step.ts) }}</span>
            </summary>
            <div class="tool-step-body">
              <div v-if="step.input !== undefined" class="tool-step-section">
                <div class="tool-step-section-label">入参</div>
                <pre class="tool-step-pre">{{ formatToolValue(step.input) }}</pre>
              </div>
              <div v-if="step.output !== undefined" class="tool-step-section">
                <div class="tool-step-section-label">输出</div>
                <pre class="tool-step-pre">{{ formatToolValue(step.output) }}</pre>
              </div>
            </div>
          </details>

          <!-- Transient run-status indicator (compaction / fallback) -->
          <div v-if="msg.liveStatus" :class="['live-status', { done: msg.liveStatus.done }]">
            <span class="live-status-dot" />
            <span>{{ msg.liveStatus.text }}</span>
          </div>

          <div
            v-if="msg.text || msg.reasoning || msg.attachments?.length || msg.streaming || msg.usage"
            class="msg-bubble"
          >
            <!-- Attachments -->
            <div v-if="msg.attachments?.length" class="attachments">
              <div
                v-for="(a, index) in msg.attachments"
                :key="`${msg.id}:${a.filename}:${index}`"
                class="attachment-card"
                :class="a.type"
              >
                <img v-if="a.type === 'image'" :src="a.dataUrl" class="img-preview" />
                <div v-else class="file-card">
                  <span class="file-icon">📄</span>
                  <span class="file-name">{{ a.filename }}</span>
                </div>
              </div>
            </div>

            <!-- Thinking / reasoning -->
            <details v-if="msg.reasoning" class="thinking-block" :open="msg.streaming && msg.phase === 'thinking'">
              <summary class="thinking-summary">
                <span class="thinking-icon">💭</span>
                思考过程
                <span v-if="msg.streaming && msg.phase === 'thinking'" class="thinking-live">推理中…</span>
                <span v-else class="thinking-tokens">{{ wordCount(msg.reasoning) }} 字</span>
              </summary>
              <div class="thinking-content">{{ msg.reasoning }}</div>
            </details>

            <!-- Phase indicator (before text arrives) -->
            <div v-if="msg.streaming && !msg.text" class="phase-indicator">
              <span :class="['phase-dot', msg.phase === 'thinking' ? 'thinking' : 'sending']"></span>
              <span class="phase-label">{{ phaseLabel(msg.phase) }}</span>
            </div>

            <!-- Message text -->
            <div v-if="msg.text" v-html="renderMarkdown(msg.text)" class="md-content" />
            <span v-if="msg.streaming && msg.text" class="cursor">▌</span>

            <!-- Token usage -->
            <div v-if="msg.usage && !msg.streaming" class="msg-usage">
              <span>输入 {{ msg.usage.input.toLocaleString() }} tok</span>
              <span class="usage-sep">·</span>
              <span>输出 {{ msg.usage.output.toLocaleString() }} tok</span>
            </div>
          </div>

          <!-- Message actions (hover) -->
          <div :class="['msg-actions', hoverMsgId === msg.id && 'visible']">
            <button class="ma-btn" @click="copyMsg(msg)" title="复制">复制</button>
            <button class="ma-btn" @click="saveQuickReply(msg)" title="保存为快捷回复">⚡保存</button>
          </div>

          <div class="msg-meta">
            <span class="msg-author">{{ msg.role === 'user' ? '你' : currentAgentName }}</span>
            <span class="msg-time">{{ formatTime(msg.createdAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Scroll-to-bottom -->
      <button v-if="!autoFollow && streaming" class="scroll-down-btn" @click="jumpToBottom">
        ↓ 新消息
      </button>

      <!-- Quick replies panel -->
      <div v-if="quickRepliesOpen" class="qr-panel">
        <div class="qr-header">
          <span class="qr-title">⚡ 快捷回复</span>
          <input
            v-model="qrSearch"
            class="qr-search"
            placeholder="搜索…"
          />
          <button class="qr-close" @click="quickRepliesOpen = false">✕</button>
        </div>
        <div class="qr-list">
          <div v-if="filteredQuickReplies.length === 0" class="qr-empty">
            暂无快捷回复，悬停消息点击「⚡保存」添加
          </div>
          <div
            v-for="(qr, i) in filteredQuickReplies"
            :key="qr.id"
            class="qr-item"
            @click="applyQuickReply(qr.text)"
          >
            <span class="qr-text">{{ qr.text }}</span>
            <button class="qr-del" @click.stop="deleteQuickReply(i)" title="删除">✕</button>
          </div>
        </div>
      </div>

      <!-- Pending files -->
      <div v-if="pendingFiles.length" class="pending-files">
        <div
          v-for="(f, i) in pendingFiles"
          :key="`${currentAgent.id}:${f.filename}:${i}`"
          :class="['pf-item', f.uploading && 'pf-uploading', f.error && 'pf-error']"
        >
          <img v-if="f.type === 'image' && f.dataUrl" :src="f.dataUrl" class="pf-thumb" />
          <div v-else class="pf-file">
            <span class="file-icon">{{ f.error ? '⚠️' : (f.uploading ? '⏳' : '📄') }}</span>
            <span class="pf-name">{{ f.filename }}</span>
            <span v-if="f.uploading" class="pf-status">上传中…</span>
            <span v-else-if="f.error" class="pf-status pf-status-error">{{ f.error }}</span>
            <span v-else-if="f.size" class="pf-status">{{ formatBytes(f.size) }}</span>
          </div>
          <button @click="removePending(i)" class="pf-remove" :disabled="streaming">✕</button>
        </div>
      </div>

      <!-- Slash command menu -->
      <Transition name="slash">
        <div v-if="slashMenuVisible" class="slash-menu" ref="slashMenuEl">
          <div
            v-for="(cmd, i) in filteredSlashCmds"
            :key="cmd.name"
            :class="['slash-item', slashIndex === i && 'active']"
            @mousedown.prevent="applySlash(cmd)"
          >
            <span class="slash-cmd">{{ cmd.name }}</span>
            <span class="slash-desc">{{ cmd.desc }}</span>
          </div>
        </div>
      </Transition>

      <!-- Input bar -->
      <div class="input-bar">
        <label class="attach-btn" title="附件">
          📎
          <input
            type="file"
            multiple
            @change="onFilePick"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.ts,.js,.py,.go,.json,.yaml,.yml,.sh,.csv,.xml,.html,.css,.sql,.log,.conf,.ini,.toml,.rs,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.r,.m,.tex,.bib,.zip,.tar,.gz,.tgz"
            hidden
            :disabled="streaming"
          />
        </label>
        <div class="textarea-wrap">
          <textarea
            v-model="inputText"
            @keydown="onTextareaKeydown"
            @input="onTextareaInput"
            placeholder="输入消息… Enter 发送，Shift+Enter 换行，/ 查看命令"
            rows="1"
            ref="textareaEl"
            :disabled="streaming"
          />
        </div>
        <button class="qr-toggle-btn" @click="quickRepliesOpen = !quickRepliesOpen" title="快捷回复" :class="quickRepliesOpen && 'active'">⚡</button>
        <button v-if="streaming" @click="abort" class="abort-btn">■ 中断</button>
        <button v-else @click="send" :disabled="(!inputText.trim() && !pendingFiles.length)" class="send-btn">发送</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
defineOptions({ name: 'Chat' })
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api/client.js'
import ChatModeSelector from '../components/ChatModeSelector.vue'
import type { ChatMode } from '../components/ChatModeSelector.vue'
import {
  extractGatewayText,
  extractGatewayReasoning,
  mergeStreamText,
  normalizeGatewayField,
} from '../utils/chat-stream.js'
import {
  saveMessage,
  saveMessages,
  getLocalMessages,
  clearSessionMessages,
  type StoredMessage,
} from '../utils/message-db.js'
import {
  mergeToolEvent,
  describeAgentStream,
  extractToolStepsFromHistory,
  toolStatusLabel,
  formatToolValue,
  type ToolStep,
  type LiveStatus,
} from '../utils/chat-tools.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentPhase = 'sending' | 'thinking' | 'replying' | 'done' | 'aborted'
type RoleFilterValue = 'all' | 'user' | 'assistant'

interface Attachment {
  type: 'image' | 'text' | 'file'
  filename: string
  mimeType: string
  size?: number
  dataUrl?: string
  content?: string
  path?: string
  uploading?: boolean
  error?: string
}

interface AgentOption {
  id: string
  identityName?: string
  identityEmoji?: string
  isDefault?: boolean
}

interface TokenUsage { input: number; output: number }

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  phase?: AgentPhase
  usage?: TokenUsage
  attachments?: Attachment[]
  steps?: ToolStep[]            // persisted tool-call step cards
  liveStatus?: LiveStatus       // transient run indicator (not persisted)
  streaming?: boolean
  createdAt: number
}

interface AgentConversationState {
  messages: Message[]
  conversationKey: string
  rawSessionKey?: string   // set when resuming an existing gateway session
  draft: string
  pendingFiles: Attachment[]
}

interface SlashCommand { name: string; desc: string; action: () => void }
interface QuickReply { id: string; text: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_AGENT: AgentOption = { id: 'main', identityName: 'OpenClaw', identityEmoji: '🤖', isDefault: true }
const QR_STORAGE_KEY = 'openclaw-portal-quick-replies'
const CHAT_SESSION_KEY = 'openclaw-portal-chat-session'
const ROLE_FILTERS: { label: string; value: RoleFilterValue }[] = [
  { label: '全部', value: 'all' },
  { label: '用户', value: 'user' },
  { label: '助手', value: 'assistant' },
]

// ─── State ────────────────────────────────────────────────────────────────────

const route = useRoute()

const agentOptions = ref<AgentOption[]>([MAIN_AGENT])
const selectedAgentId = ref('main')
const agentStates = reactive<Record<string, AgentConversationState>>({})
const streaming = ref(false)
const loadingAgents = ref(false)
const agentsError = ref('')
const messagesEl = ref<HTMLElement>()
const textareaEl = ref<HTMLTextAreaElement>()
const currentMode = ref<ChatMode>('chat')
const autoFollow = ref(true)
const hoverMsgId = ref('')
const roleFilter = ref<RoleFilterValue>('all')

// Slash commands
const slashMenuVisible = ref(false)
const slashIndex = ref(0)
const slashMenuEl = ref<HTMLElement>()

// Quick replies
const quickRepliesOpen = ref(false)
const quickReplies = ref<QuickReply[]>(loadQuickReplies())
const qrSearch = ref('')

let rafScheduled = false

// ─── WebSocket state ─────────────────────────────────────────────────────────

let chatWs: WebSocket | null = null
let chatWsReady = false
let chatWsConnecting = false
let chatConnectTimeout: ReturnType<typeof setTimeout> | null = null
const chatConnectResolvers: (() => void)[] = []
const chatConnectRejectors: ((e: Error) => void)[] = []
let chatMainSessionKey = 'agent:main:main'
const chatPendingRpcs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const chatEventHandlers: Array<(payload: any) => void> = []
const agentEventHandlers: Array<(payload: any) => void> = []
let activeAbort: (() => void) | null = null

function handleWsMessage(data: string) {
  let msg: any
  try { msg = JSON.parse(data) } catch { return }

  if (msg.type === 'event' && msg.event === 'portal.connected') {
    if (chatConnectTimeout) { clearTimeout(chatConnectTimeout); chatConnectTimeout = null }
    chatWsReady = true
    chatWsConnecting = false
    const snap = msg.payload?.snapshot
    if (snap?.sessionDefaults?.mainSessionKey) chatMainSessionKey = snap.sessionDefaults.mainSessionKey
    chatConnectResolvers.splice(0).forEach(fn => fn())
    chatConnectRejectors.splice(0)
    return
  }

  if (msg.type === 'event' && msg.event === 'portal.error') {
    chatWsReady = false
    chatWsConnecting = false
    const err = new Error(msg.payload?.message ?? 'WS portal error')
    chatConnectRejectors.splice(0).forEach(fn => fn(err))
    chatConnectResolvers.splice(0)
    return
  }

  if (msg.type === 'res' && msg.id) {
    const rpc = chatPendingRpcs.get(msg.id)
    if (rpc) {
      clearTimeout(rpc.timer)
      chatPendingRpcs.delete(msg.id)
      if (!msg.ok || msg.error) rpc.reject(new Error(msg.error?.message ?? 'RPC error'))
      else rpc.resolve(msg.payload ?? msg.result)
    }
  }

  if (msg.type === 'event' && msg.event === 'chat') {
    for (const fn of chatEventHandlers) try { fn(msg.payload) } catch {}
  }

  if (msg.type === 'event' && msg.event === 'agent') {
    for (const fn of agentEventHandlers) try { fn(msg.payload) } catch {}
  }
}

function ensureChatWs(): Promise<void> {
  if (chatWsReady && chatWs?.readyState === 1) return Promise.resolve()
  if (chatWsConnecting) return new Promise((res, rej) => { chatConnectResolvers.push(res); chatConnectRejectors.push(rej) })
  chatWsConnecting = true

  return new Promise((resolve, reject) => {
    chatConnectResolvers.push(resolve)
    chatConnectRejectors.push(reject)

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
    const url = `${protocol}//${location.host}${base}/api/chat/ws`
    const sock = new WebSocket(url)
    chatWs = sock

    chatConnectTimeout = setTimeout(() => {
      chatConnectTimeout = null
      chatWsConnecting = false
      const err = new Error('WS connect timeout')
      chatConnectRejectors.splice(0).forEach(fn => fn(err))
      chatConnectResolvers.splice(0)
      try { sock.close() } catch {}
    }, 12000)

    sock.onmessage = e => handleWsMessage(typeof e.data === 'string' ? e.data : String(e.data))
    sock.onopen = () => { /* wait for portal.connected */ }
    sock.onclose = () => {
      if (chatConnectTimeout) { clearTimeout(chatConnectTimeout); chatConnectTimeout = null }
      chatWsReady = false
      chatWsConnecting = false
      chatWs = null
      chatPendingRpcs.forEach(({ reject: rej, timer }) => { clearTimeout(timer); rej(new Error('WS closed')) })
      chatPendingRpcs.clear()
      if (chatConnectResolvers.length) {
        const err = new Error('WS closed during connect')
        chatConnectRejectors.splice(0).forEach(fn => fn(err))
        chatConnectResolvers.splice(0)
      }
    }
    sock.onerror = () => {
      if (chatConnectTimeout) { clearTimeout(chatConnectTimeout); chatConnectTimeout = null }
      chatWsConnecting = false
      const err = new Error('WS connection failed')
      chatConnectRejectors.splice(0).forEach(fn => fn(err))
      chatConnectResolvers.splice(0)
    }
  })
}

async function chatRequest(method: string, params: object): Promise<any> {
  await ensureChatWs()
  const id = `req-${crypto.randomUUID()}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chatPendingRpcs.delete(id)
      reject(new Error(`WS RPC timeout: ${method}`))
    }, 15000)
    chatPendingRpcs.set(id, { resolve, reject, timer })
    chatWs!.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}

marked.setOptions({ breaks: true, gfm: true })

// ─── Slash commands definition ────────────────────────────────────────────────

const SLASH_CMDS: SlashCommand[] = [
  { name: '/new',    desc: '开启新对话（清空历史）',  action: () => clearChat() },
  { name: '/clear',  desc: '清空当前对话',            action: () => clearChat() },
  { name: '/user',   desc: '只看用户消息',             action: () => { roleFilter.value = 'user' } },
  { name: '/ai',     desc: '只看助手消息',             action: () => { roleFilter.value = 'assistant' } },
  { name: '/all',    desc: '显示全部消息',             action: () => { roleFilter.value = 'all' } },
]

// ─── Computed ─────────────────────────────────────────────────────────────────

const currentState = computed(() => ensureAgentState(selectedAgentId.value))
const messages = computed(() => currentState.value.messages)
const pendingFiles = computed(() => currentState.value.pendingFiles)
const inputText = computed({
  get: () => currentState.value.draft,
  set: (v: string) => { currentState.value.draft = v },
})
const currentAgent = computed(() =>
  agentOptions.value.find(a => a.id === selectedAgentId.value) ?? MAIN_AGENT,
)
const currentAgentName = computed(() => getAgentDisplayName(currentAgent.value))
const currentAgentEmoji = computed(() =>
  currentAgent.value.identityEmoji?.trim() || (currentAgent.value.id === 'main' ? '🤖' : '🧠'),
)
const filteredMessages = computed(() => {
  if (roleFilter.value === 'all') return messages.value
  return messages.value.filter(m => m.role === roleFilter.value)
})
const filteredSlashCmds = computed(() => {
  const raw = inputText.value
  if (!raw.startsWith('/')) return []
  const q = raw.toLowerCase()
  return SLASH_CMDS.filter(c => c.name.startsWith(q))
})
const filteredQuickReplies = computed(() => {
  if (!qrSearch.value.trim()) return quickReplies.value
  const q = qrSearch.value.toLowerCase()
  return quickReplies.value.filter(qr => qr.text.toLowerCase().includes(q))
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function phaseLabel(phase?: AgentPhase): string {
  switch (phase) {
    case 'thinking': return '正在思考…'
    case 'replying': return '正在回复…'
    default: return '思考中'
  }
}

function wordCount(text: string): number {
  return text.replace(/\s+/g, '').length
}

function createAgentState(): AgentConversationState {
  return { messages: [], conversationKey: '', rawSessionKey: undefined, draft: '', pendingFiles: [] }
}

function ensureAgentState(agentId: string): AgentConversationState {
  if (!agentStates[agentId]) agentStates[agentId] = createAgentState()
  return agentStates[agentId]
}

function mkId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function getAgentDisplayName(agent: AgentOption): string {
  return agent.identityName?.trim() || (agent.id === 'main' ? 'OpenClaw' : agent.id)
}

function normalizeAgents(list: any[]): AgentOption[] {
  const seen = new Map<string, AgentOption>([[MAIN_AGENT.id, MAIN_AGENT]])
  for (const item of list) {
    if (!item?.id) continue
    seen.set(item.id, { id: item.id, identityName: item.identityName, identityEmoji: item.identityEmoji, isDefault: Boolean(item.isDefault) })
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.id === 'main') return -1
    if (b.id === 'main') return 1
    return getAgentDisplayName(a).localeCompare(getAgentDisplayName(b), 'zh-CN')
  })
}

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(ts)
}

function formatAgentOption(agent: AgentOption): string {
  const emoji = agent.identityEmoji?.trim()
  const name = getAgentDisplayName(agent)
  const suffix = agent.id === 'main' ? '（默认）' : `（${agent.id}）`
  return `${emoji ? `${emoji} ` : ''}${name}${suffix}`
}

// ─── Quick replies ─────────────────────────────────────────────────────────────

function loadQuickReplies(): QuickReply[] {
  try {
    return JSON.parse(localStorage.getItem(QR_STORAGE_KEY) ?? '[]')
  } catch { return [] }
}

function persistQuickReplies() {
  localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(quickReplies.value))
}

function saveQuickReply(msg: Message) {
  const text = msg.text.trim()
  if (!text) return
  if (quickReplies.value.some(qr => qr.text === text)) return
  quickReplies.value.unshift({ id: mkId(), text })
  if (quickReplies.value.length > 30) quickReplies.value.pop()
  persistQuickReplies()
  quickRepliesOpen.value = true
}

function deleteQuickReply(i: number) {
  quickReplies.value.splice(i, 1)
  persistQuickReplies()
}

function applyQuickReply(text: string) {
  currentState.value.draft = text
  quickRepliesOpen.value = false
  nextTick(() => { textareaEl.value?.focus(); autoResizeTextarea() })
}

// ─── Slash commands ───────────────────────────────────────────────────────────

function applySlash(cmd: SlashCommand) {
  slashMenuVisible.value = false
  currentState.value.draft = ''
  autoResizeTextarea()
  cmd.action()
}

function onTextareaInput() {
  autoResizeTextarea()
  const raw = currentState.value.draft
  slashMenuVisible.value = raw.startsWith('/') && filteredSlashCmds.value.length > 0
  slashIndex.value = 0
}

function onTextareaKeydown(e: KeyboardEvent) {
  if (slashMenuVisible.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      slashIndex.value = (slashIndex.value + 1) % filteredSlashCmds.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      slashIndex.value = (slashIndex.value - 1 + filteredSlashCmds.value.length) % filteredSlashCmds.value.length
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const cmd = filteredSlashCmds.value[slashIndex.value]
      if (cmd) applySlash(cmd)
      return
    }
    if (e.key === 'Escape') {
      slashMenuVisible.value = false
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  } else if (e.key === 'Enter' && e.shiftKey) {
    // allow newline
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadAgents() {
  loadingAgents.value = true
  agentsError.value = ''
  try {
    agentOptions.value = normalizeAgents(await api.agents.list())
    if (!agentOptions.value.some(a => a.id === selectedAgentId.value)) selectedAgentId.value = 'main'
    ensureAgentState(selectedAgentId.value)
  } catch (err: any) {
    agentsError.value = `Agent 列表加载失败：${err.message ?? '未知错误'}`
    agentOptions.value = [MAIN_AGENT]
    selectedAgentId.value = 'main'
    ensureAgentState('main')
  } finally {
    loadingAgents.value = false
  }
}

// ─── File handling ────────────────────────────────────────────────────────────

async function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  // Snapshot files before clearing the input — FileList is live and resetting
  // input.value drops references, leaving Array.from() empty if read afterward.
  const fileArr = Array.from(input.files)
  if (!fileArr.length) return

  // Push placeholders, then re-read them back as reactive proxies — mutating
  // the raw objects bypasses Vue's reactivity and the UI will not refresh.
  const startIdx = currentState.value.pendingFiles.length
  for (const file of fileArr) {
    currentState.value.pendingFiles.push({
      type: 'file',
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploading: true,
    })
  }
  const reactivePhs = fileArr.map((_, i) => currentState.value.pendingFiles[startIdx + i])

  input.value = ''
  await nextTick()
  autoResizeTextarea()

  await Promise.all(fileArr.map(async (file, idx) => {
    const ph = reactivePhs[idx]
    try {
      const result = await api.chat.uploadFile(file) as Attachment
      Object.assign(ph, result, { uploading: false })
    } catch (err: any) {
      ph.uploading = false
      ph.error = err?.message || '上传失败'
    }
  }))
}

function removePending(i: number) {
  currentState.value.pendingFiles.splice(i, 1)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ─── Message copy ─────────────────────────────────────────────────────────────

async function copyMsg(msg: Message) {
  const text = msg.text || msg.reasoning || ''
  await navigator.clipboard.writeText(text).catch(() => {})
}

// ─── Scroll management ────────────────────────────────────────────────────────

function scheduleScroll() {
  if (!autoFollow.value || rafScheduled) return
  rafScheduled = true
  requestAnimationFrame(() => {
    rafScheduled = false
    if (messagesEl.value && autoFollow.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight
    }
  })
}

function jumpToBottom() {
  autoFollow.value = true
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

function onScroll() {
  const el = messagesEl.value
  if (!el) return
  autoFollow.value = (el.scrollHeight - el.scrollTop - el.clientHeight) < 80
}

// ─── Sending ──────────────────────────────────────────────────────────────────

function autoResizeTextarea() {
  if (!textareaEl.value) return
  textareaEl.value.style.height = 'auto'
  textareaEl.value.style.height = `${Math.min(textareaEl.value.scrollHeight, 160)}px`
}

function abort() {
  activeAbort?.()
}

async function readResponseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text) return `${res.status} ${res.statusText}`
  try { return JSON.parse(text).error ?? JSON.parse(text).message ?? text } catch { return text }
}

function applyHttpSsePayload(raw: string, assistantMsg: Message) {
  const data = raw.trim()
  if (!data || data === '[DONE]') return

  let json: any
  try {
    json = JSON.parse(data)
  } catch {
    return
  }

  const reasoningDelta =
    json.choices?.[0]?.delta?.reasoning_content ??
    json.delta?.reasoning_content ??
    (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta' ? json.delta.thinking : undefined) ?? ''

  const textDelta =
    json.delta?.text ??
    json.choices?.[0]?.delta?.content ??
    json.choices?.[0]?.delta?.text ??
    (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' ? json.delta.text : undefined) ?? ''

  const nextReasoning = mergeStreamText(
    assistantMsg.reasoning ?? '',
    normalizeGatewayField(reasoningDelta, 'reasoning'),
  )
  if (nextReasoning !== (assistantMsg.reasoning ?? '')) {
    assistantMsg.reasoning = nextReasoning
    assistantMsg.phase = 'thinking'
    scheduleScroll()
  }

  const nextText = mergeStreamText(
    assistantMsg.text,
    normalizeGatewayField(textDelta, 'text'),
  )
  if (nextText !== assistantMsg.text) {
    assistantMsg.text = nextText
    if (!reasoningDelta) assistantMsg.phase = 'replying'
    scheduleScroll()
  }

  const errorText = json?.error?.message
  if (typeof errorText === 'string' && errorText) {
    assistantMsg.text = errorText
    assistantMsg.phase = 'done'
    scheduleScroll()
  }
}

async function sendViaHttp(
  state: AgentConversationState,
  assistantMsg: Message,
  messageText: string,
  agentId: string,
) {
  if (!state.conversationKey) state.conversationKey = mkId()

  const controller = new AbortController()
  activeAbort = () => controller.abort()

  const res = await api.chat.complete(
    [{ role: 'user', content: messageText }],
    currentMode.value,
    {
      agentId: agentId === 'main' ? undefined : agentId,
      conversationKey: state.conversationKey,
    },
    controller.signal,
  )

  if (!res.ok) throw new Error(await readResponseError(res))

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content ?? json?.error?.message ?? ''
    assistantMsg.text = typeof content === 'string' ? content : JSON.stringify(content)
    assistantMsg.phase = 'done'
    return
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('上游未返回可读取的流')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const dataLines = frame
        .split(/\r?\n/)
        .filter(line => line.trim().startsWith('data:'))
      if (!dataLines.length) continue
      const data = dataLines
        .map(line => line.trim().slice(5).trim())
        .filter(part => part && part !== '[DONE]')
        .join('\n')
      if (data) applyHttpSsePayload(data, assistantMsg)
    }
  }

  if (buffer.trim()) {
    const dataLines = buffer
      .split(/\r?\n/)
      .filter(line => line.trim().startsWith('data:'))
    const data = dataLines
      .map(line => line.trim().slice(5).trim())
      .filter(part => part && part !== '[DONE]')
      .join('\n')
    if (data) applyHttpSsePayload(data, assistantMsg)
  }
}

function buildWsSessionKey(agentId: string, conversationKey: string): string {
  const agent = agentId === 'main' ? 'main' : agentId
  return `agent:${agent}:portal:${conversationKey}`
}

function msgToStored(msg: Message, sessionKey: string): StoredMessage {
  return {
    id: msg.id, sessionKey, role: msg.role, text: msg.text,
    reasoning: msg.reasoning,
    steps: msg.steps?.length ? msg.steps : undefined,
    createdAt: msg.createdAt,
  }
}

function storedToMsg(s: StoredMessage): Message {
  return {
    id: s.id, role: s.role, text: s.text, reasoning: s.reasoning,
    steps: s.steps?.length ? s.steps : undefined,
    phase: 'done', createdAt: s.createdAt,
  }
}

async function loadSessionHistory(state: AgentConversationState, agentId: string) {
  if (!state.conversationKey) return
  const sessionKey = buildWsSessionKey(agentId, state.conversationKey)

  // 1. Show local IndexedDB messages immediately
  const local = await getLocalMessages(sessionKey)
  if (local.length && !state.messages.length) {
    state.messages = local.map(storedToMsg).filter(m => m.text || m.steps?.length)
    await nextTick(); jumpToBottom()
  }

  // 2. Fetch from gateway (source of truth), overwrite local display
  try {
    await ensureChatWs()
    const result = await chatRequest('chat.history', { sessionKey, limit: 200 })
    const rawMsgs: any[] = result?.messages ?? []
    const stepsMap = extractToolStepsFromHistory(rawMsgs)
    // Gateway history puts text/reasoning inside content[] blocks; tool-result
    // messages fold into their owning assistant turn's step cards, so they are
    // not surfaced as standalone chat bubbles.
    const msgs: Message[] = rawMsgs
      .map((m: any, i: number) => {
        const isTool = m.role === 'tool' || m.role === 'toolResult'
        return {
          id: m.id || mkId(),
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          text: isTool ? '' : extractGatewayText(m),
          reasoning: extractGatewayReasoning(m) || (typeof m.thinking === 'string' ? m.thinking : undefined),
          steps: stepsMap.get(i),
          phase: 'done' as AgentPhase,
          createdAt: m.timestamp ?? Date.now(),
          _isTool: isTool,
        }
      })
      .filter(m => !m._isTool && (m.text || m.steps?.length))
      .map(({ _isTool, ...m }): Message => m)

    // Backfill from the raw session JSONL (authoritative on-disk source) when
    // the gateway's chat.history projection returned an empty assistant turn.
    // The gateway's sanitizeAssistantPhasedContentBlocks drops text blocks
    // whose phase signature is not "final_answer", which strips Qwen3-style
    // commentary turns that were visible during streaming. The raw JSONL is
    // unprojected, so its text is what the model actually emitted.
    if (msgs.length) {
      try {
        const rawSession = await api.sessions.byKey(agentId, sessionKey)
        const rawById = new Map<string, typeof rawSession.messages[number]>()
        for (const rm of rawSession.messages) {
          if (rm.id) rawById.set(rm.id, rm)
        }
        for (const m of msgs) {
          if (m.role !== 'assistant') continue
          const raw = rawById.get(m.id)
          if (!raw) continue
          if ((!m.text || !m.text.trim()) && raw.text) m.text = raw.text
          if (!m.reasoning && raw.thinking) m.reasoning = raw.thinking
        }
      } catch {
        // Raw JSONL unavailable (no sessions.json mapping, or remote gateway
        // not co-located with portal). Fall through to IndexedDB backfill.
      }
    }

    // Final fallback: preserve text/reasoning/steps from IndexedDB when both
    // the projected gateway history and the raw JSONL backfill came up empty
    // (matched by role + nearest createdAt within 5 min). This covers the
    // case where the gateway is on a different host and we have no JSONL
    // access, but the same browser saw the response during streaming.
    if (msgs.length && local.length) {
      const localCached = local.map(storedToMsg).filter(m => m.text || m.steps?.length)
      const TOLERANCE_MS = 5 * 60 * 1000
      for (const m of msgs) {
        if (m.role !== 'assistant') continue
        if (m.text && m.text.trim()) continue
        if (m.steps?.length) continue
        const localMatch = localCached
          .filter(l => l.role === 'assistant' && (l.text || l.steps?.length))
          .map(l => ({ l, delta: Math.abs((l.createdAt || 0) - (m.createdAt || 0)) }))
          .filter(({ delta }) => delta <= TOLERANCE_MS)
          .sort((a, b) => a.delta - b.delta)[0]?.l
        if (!localMatch) continue
        if (!m.text && localMatch.text) m.text = localMatch.text
        if (!m.reasoning && localMatch.reasoning) m.reasoning = localMatch.reasoning
        if (!m.steps?.length && localMatch.steps?.length) m.steps = localMatch.steps
      }
    }

    // Drop assistant turns that ended up with no displayable content even after
    // re-merging from local cache, so the UI doesn't render blank bubbles.
    const visible = msgs.filter(m => m.role === 'user' || m.text || m.steps?.length)
    if (visible.length) {
      state.messages = visible
      await saveMessages(visible.map(m => msgToStored(m, sessionKey)))
      await nextTick(); jumpToBottom()
    }
  } catch (e) {
    // Gateway unavailable or no history — local cache is fine
  }
}

function persistSessionKeys() {
  try {
    const keys: Record<string, string> = {}
    for (const [id, s] of Object.entries(agentStates)) {
      if (s.conversationKey) keys[id] = s.conversationKey
    }
    localStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(keys))
  } catch {}
}

async function sendViaWs(
  state: AgentConversationState,
  assistantMsg: Message,
  messageText: string,
  agentId: string,
) {
  if (!state.rawSessionKey && !state.conversationKey) { state.conversationKey = mkId(); persistSessionKeys() }
  await ensureChatWs()

  const sessionKey = state.rawSessionKey ?? buildWsSessionKey(agentId, state.conversationKey)
  let currentRunId: string | null = null
  let resolved = false
  let safetyTimer: ReturnType<typeof setTimeout> | null = null

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
      cancelSettle()
      const idx = chatEventHandlers.indexOf(eventHandler)
      if (idx !== -1) chatEventHandlers.splice(idx, 1)
      const aidx = agentEventHandlers.indexOf(agentHandler)
      if (aidx !== -1) agentEventHandlers.splice(aidx, 1)
    }

    function finish(err?: Error) {
      if (resolved) return
      resolved = true
      cleanup()
      assistantMsg.liveStatus = undefined   // transient — never persists
      if (err) reject(err)
      else resolve()
    }

    function resetSafety() {
      if (safetyTimer) clearTimeout(safetyTimer)
      safetyTimer = setTimeout(() => {
        if (!resolved) {
          console.warn('[chat/ws] 流式超时（90s 无新事件），强制结束')
          finish()
        }
      }, 90_000)
    }

    activeAbort = () => {
      if (resolved) return
      try {
        chatWs?.send(JSON.stringify({
          type: 'req',
          id: `req-${crypto.randomUUID()}`,
          method: 'chat.abort',
          params: { sessionKey, ...(currentRunId ? { runId: currentRunId } : {}) },
        }))
      } catch {}
    }

    // ── Multi-run accumulation ────────────────────────────────────────────────
    // Gateway broadcasts one chat:final per runId. An agentic turn that calls
    // tools spans MULTIPLE runIds: commentary run → tool call run → tool
    // result digestion run → final answer run. Treating the first chat:final
    // as conversation end (the previous behaviour) cut off the bubble while
    // the gateway was still emitting tool events for the next run — the bug
    // the user observed where control-ui kept streaming but portal looked
    // interrupted. Track text per runId in observation order and concatenate.
    const textByRun = new Map<string, string>()
    const reasoningByRun = new Map<string, string>()
    const runOrder: string[] = []
    function rememberRun(runId: string | undefined): string {
      const key = runId || '__norun__'
      if (!runOrder.includes(key)) runOrder.push(key)
      return key
    }
    function flushAccumulatedText() {
      const text = runOrder.map(r => textByRun.get(r) || '').filter(Boolean).join('\n\n')
      const reasoning = runOrder.map(r => reasoningByRun.get(r) || '').filter(Boolean).join('\n\n')
      if (text && text.length >= assistantMsg.text.length) assistantMsg.text = text
      if (reasoning && reasoning.length >= (assistantMsg.reasoning?.length ?? 0)) {
        assistantMsg.reasoning = reasoning
      }
    }

    // After a chat:final, schedule a short idle settle. If no further chat or
    // agent events arrive in this window the run is truly done; otherwise the
    // next event cancels the settle and we keep streaming. This replaces the
    // old finish-on-first-final behaviour without losing the natural end.
    const POST_FINAL_IDLE_MS = 8_000
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    function cancelSettle() {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
    }
    function scheduleSettle() {
      cancelSettle()
      settleTimer = setTimeout(() => {
        settleTimer = null
        if (!resolved) {
          flushAccumulatedText()
          finish()
        }
      }, POST_FINAL_IDLE_MS)
    }

    const eventHandler = (payload: any) => {
      if (resolved || !payload) return
      // sessionKey 过滤
      if (payload.sessionKey && payload.sessionKey !== sessionKey) return

      const { state: evtState, runId, message } = payload
      if (runId) currentRunId = runId
      const runKey = rememberRun(runId)
      cancelSettle()

      if (evtState === 'delta') {
        resetSafety()
        const text = extractGatewayText(message)
        const reasoning = extractGatewayReasoning(message)
        if (reasoning) {
          reasoningByRun.set(runKey, reasoning)
          assistantMsg.phase = 'thinking'
        }
        if (text) {
          textByRun.set(runKey, text)
          assistantMsg.phase = 'replying'
        }
        flushAccumulatedText()
        scheduleScroll()
        return
      }

      if (evtState === 'final') {
        const text = extractGatewayText(message)
        const reasoning = extractGatewayReasoning(message)
        if (reasoning) reasoningByRun.set(runKey, reasoning)
        if (text) textByRun.set(runKey, text)
        flushAccumulatedText()
        scheduleScroll()
        // Don't finish() — the agent may still run more turns (tool follow-up
        // runs). Start an idle settle that finalises only if no further
        // chat/agent events show up within POST_FINAL_IDLE_MS.
        scheduleSettle()
        return
      }

      if (evtState === 'aborted') {
        flushAccumulatedText()
        if (!assistantMsg.text) assistantMsg.text = '（已中断）'
        assistantMsg.phase = 'aborted'
        finish()
        return
      }

      if (evtState === 'error') {
        flushAccumulatedText()
        const errMsg = payload.errorMessage ?? payload.error?.message ?? '未知错误'
        if (assistantMsg.text) {
          // 已有部分输出，不报错，直接结束
          finish()
        } else {
          finish(new Error(errMsg))
        }
        return
      }
    }

    // event:'agent' — tool steps (persistent) + run-status hints (transient)
    const agentHandler = (payload: any) => {
      if (resolved || !payload) return
      if (payload.sessionKey && payload.sessionKey !== sessionKey) return
      // Allow tool events from new sub-runs (tool follow-up turns) — previously
      // mismatched runIds were dropped, which silenced the tool step cards.
      if (payload.runId) currentRunId = payload.runId
      resetSafety()
      // A tool event after chat:final means the run is not actually idle yet,
      // so abort any pending post-final settle that would have closed the
      // bubble.
      cancelSettle()

      if (payload.stream === 'tool') {
        if (!assistantMsg.steps) assistantMsg.steps = []
        mergeToolEvent(assistantMsg.steps, payload)
        scheduleScroll()
        return
      }

      const ls = describeAgentStream(payload)
      if (ls) { assistantMsg.liveStatus = ls; scheduleScroll() }
    }

    chatEventHandlers.push(eventHandler)
    agentEventHandlers.push(agentHandler)
    resetSafety()

    chatRequest('chat.send', {
      sessionKey,
      message: messageText,
      deliver: false,
      idempotencyKey: mkId(),
    }).catch((err: Error) => {
      finish(err)
    })
  })
}

async function send() {
  const state = currentState.value
  const text = state.draft.trim()
  const attachments = [...state.pendingFiles]
  if (!text && attachments.length === 0) return
  if (streaming.value) return
  if (attachments.some(a => a.uploading)) return  // wait for in-flight uploads
  const failed = attachments.filter(a => a.error)
  if (failed.length) return  // user must remove failed entries first

  slashMenuVisible.value = false

  const userMsg: Message = { id: mkId(), role: 'user', text, attachments, createdAt: Date.now() }
  state.messages.push(userMsg)
  state.draft = ''
  state.pendingFiles = []
  await nextTick()
  autoResizeTextarea()
  autoFollow.value = true
  scheduleScroll()

  const rawMsg: Message = {
    id: mkId(), role: 'assistant', text: '', phase: 'sending', streaming: true, createdAt: Date.now(),
  }
  state.messages.push(rawMsg)
  // Must use the reactive proxy (not the raw object) so Vue's set trap fires on mutations
  const assistantMsg = state.messages[state.messages.length - 1] as Message
  streaming.value = true

  // Build message text. Text attachments inline as fenced blocks; binary
  // attachments embed a path so the agent can read them via tools.
  const textParts: string[] = []
  for (const a of attachments) {
    if (a.type === 'text' && a.content) textParts.push(`\`\`\`${a.filename}\n${a.content}\n\`\`\``)
    else if (a.type === 'image') textParts.push(`[图片附件: ${a.filename}]`)
    else if (a.type === 'file' && a.path) textParts.push(`[文件附件: ${a.filename}] 路径: ${a.path}`)
  }
  if (text) textParts.push(text)
  const messageText = textParts.join('\n')

  const agentId = selectedAgentId.value
  const sessionKey = buildWsSessionKey(agentId, state.conversationKey || '')
  try {
    await sendViaWs(state, assistantMsg, messageText, agentId)
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (!assistantMsg.text) assistantMsg.text = '（已中断）'
      assistantMsg.phase = 'aborted'
    } else {
      assistantMsg.text = `发送失败: ${e.message}`
      assistantMsg.phase = 'done'
    }
  } finally {
    activeAbort = null
    assistantMsg.streaming = false
    if (!assistantMsg.phase || assistantMsg.phase === 'sending' || assistantMsg.phase === 'replying' || assistantMsg.phase === 'thinking') {
      assistantMsg.phase = 'done'
    }
    streaming.value = false
    autoFollow.value = true
    scheduleScroll()
    // Persist user + assistant messages to IndexedDB
    const sk = buildWsSessionKey(agentId, state.conversationKey)
    void saveMessages([msgToStored(userMsg, sk), msgToStored(assistantMsg, sk)])
  }
}

function clearChat() {
  const state = currentState.value
  const oldSessionKey = state.conversationKey
    ? buildWsSessionKey(selectedAgentId.value, state.conversationKey) : null
  state.messages = []; state.conversationKey = ''; state.draft = ''; state.pendingFiles = []
  if (oldSessionKey) void clearSessionMessages(oldSessionKey)
  void nextTick().then(autoResizeTextarea)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Restore last session keys from localStorage so we can reload history from IndexedDB/gateway
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_SESSION_KEY) ?? '{}')
    for (const [agentId, conversationKey] of Object.entries(saved)) {
      if (typeof conversationKey === 'string' && conversationKey) {
        ensureAgentState(agentId).conversationKey = conversationKey
      }
    }
  } catch {}

  // Handle session resume from Sessions page (?agentId=...&resumeKey=...&resumeSessionId=...)
  const resumeKey = route.query.resumeKey as string | undefined
  const resumeAgentId = (route.query.agentId as string | undefined) ?? 'main'
  const resumeSessionId = route.query.resumeSessionId as string | undefined
  if (resumeKey) {
    selectedAgentId.value = resumeAgentId
    const state = ensureAgentState(resumeAgentId)
    state.rawSessionKey = resumeKey
    state.messages = []
    state.conversationKey = ''
    await loadAgents()
    // Load historical messages from the session JSONL
    if (resumeSessionId) {
      try {
        const detail = await api.sessions.getDetail(resumeAgentId, resumeSessionId)
        const stepsMap = extractToolStepsFromHistory(detail.messages)
        state.messages = detail.messages
          .map((m, i) => ({ m, steps: stepsMap.get(i) }))
          .filter(({ m, steps }) =>
            (m.role === 'user' || m.role === 'assistant') && (Boolean(m.text) || Boolean(steps?.length)))
          .map(({ m, steps }) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            text: m.text ?? '',
            reasoning: m.thinking || undefined,
            steps,
            phase: 'done' as const,
            createdAt: new Date(m.timestamp).getTime() || Date.now(),
          }))
      } catch {}
    }
    jumpToBottom()
    autoResizeTextarea()
    return
  }

  const state = ensureAgentState(selectedAgentId.value)
  await loadAgents()
  jumpToBottom()
  autoResizeTextarea()
  // Load history for current agent
  void loadSessionHistory(state, selectedAgentId.value)
})

onUnmounted(() => {
  activeAbort?.()
  try { chatWs?.close() } catch {}
})

watch(selectedAgentId, async (agentId) => {
  const state = ensureAgentState(agentId)
  await nextTick()
  jumpToBottom()
  autoResizeTextarea()
  void loadSessionHistory(state, agentId)
})

watch(filteredSlashCmds, (cmds) => {
  if (!inputText.value.startsWith('/')) { slashMenuVisible.value = false; return }
  slashMenuVisible.value = cmds.length > 0
  slashIndex.value = 0
})
</script>

<style scoped>
.chat-page { min-height: 0; }

/* Header */
.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.agent-switcher {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 4px 4px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--tint-strong);
  box-shadow: 0 6px 20px var(--tint-medium);
}
.agent-switcher-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.08);
  color: var(--accent);
  font-weight: 600;
  font-size: var(--text-xs);
}
.agent-switcher-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 198px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--tint-strong);
  transition: border-color .15s, box-shadow .15s;
}
.agent-switcher-field:focus-within {
  border-color: rgba(37, 99, 235, 0.35);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
.agent-switcher-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 16px; flex: 0 0 auto; }
.agent-select {
  min-width: 0; width: 100%; height: 100%;
  appearance: none; -webkit-appearance: none;
  border: none; outline: none; background: transparent;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%236b7280' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center; background-size: 12px 12px;
  color: var(--text-primary); font-size: var(--text-sm); font-weight: 600; font-family: var(--font-sans);
  cursor: pointer; padding: 0 20px 0 0;
}
.agent-select:disabled { color: var(--text-muted); cursor: not-allowed; }

/* Chat root */
.chat-root {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 620px;
  height: calc(100dvh - 180px);
  background: var(--surface-2);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

/* Conversation bar */
.conversation-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--tint-strong);
  background: var(--surface);
  flex-shrink: 0;
}
.agent-chip { display: flex; align-items: center; gap: 10px; }
.agent-chip-icon {
  width: 34px; height: 34px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px; background: rgba(37, 99, 235, 0.1); font-size: 17px;
}
.agent-chip-title { font-size: var(--text-sm); font-weight: 700; color: var(--text-primary); }
.agent-chip-subtitle { margin: 1px 0 0; font-size: var(--text-xs); color: var(--text-muted); }
.filter-count { color: var(--accent); }
.bar-right { display: flex; align-items: center; gap: var(--space-3); }
.conversation-warning { margin: 0; font-size: var(--text-xs); color: var(--warning-text, #92400e); }

/* Role filter */
.role-filter { display: flex; gap: 4px; }
.rf-btn {
  padding: 4px 10px;
  border: 1px solid var(--tint-strong);
  border-radius: 999px;
  background: transparent;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all .15s;
}
.rf-btn:hover { background: var(--tint-medium); }
.rf-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }

/* Messages */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background: var(--surface-2);
}
.empty-hint { text-align: center; color: var(--text-muted); padding-top: 72px; line-height: 2; }
.empty-hint .sub { font-size: var(--text-sm); }
.empty-hint code { background: var(--tint-strong); padding: 1px 6px; border-radius: 4px; font-size: 13px; }

.msg {
  display: flex;
  flex-direction: column;
  max-width: 84%;
  animation: msg-in .18s ease-out;
}
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.assistant { align-self: flex-start; align-items: flex-start; }

.msg-bubble {
  width: 100%;
  padding: 12px 14px;
  border-radius: 16px;
  font-size: var(--text-sm);
  line-height: 1.65;
  word-break: break-word;
}
.msg.user .msg-bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
.msg.assistant .msg-bubble {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--tint-strong);
  border-bottom-left-radius: 4px;
}

/* Message actions */
.msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity .15s;
  pointer-events: none;
}
.msg-actions.visible { opacity: 1; pointer-events: all; }
.msg.user .msg-actions { flex-direction: row-reverse; }
.ma-btn {
  padding: 3px 9px;
  border: 1px solid var(--tint-strong);
  border-radius: 999px;
  background: var(--surface);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s;
}
.ma-btn:hover { background: var(--surface); color: var(--accent); border-color: rgba(37,99,235,0.25); }

.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-weight: 500;
}
.msg.user .msg-meta { justify-content: flex-end; }
.msg.assistant .msg-meta { justify-content: flex-start; }
.msg-author { color: var(--text-secondary); }

/* Thinking block */
.thinking-block {
  margin-bottom: 10px;
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(139, 92, 246, 0.04);
}
.thinking-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: 600;
  color: #7c3aed;
  user-select: none;
  list-style: none;
}
.thinking-summary::-webkit-details-marker { display: none; }
.thinking-icon { font-size: 13px; }
.thinking-live { margin-left: auto; font-weight: 400; color: #a78bfa; animation: blink .9s step-end infinite; }
.thinking-tokens { margin-left: auto; font-weight: 400; color: #a78bfa; }
.thinking-content {
  padding: 8px 12px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  color: #6d28d9;
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 1px solid rgba(139, 92, 246, 0.12);
  max-height: 220px;
  overflow-y: auto;
}

/* Tool-call step cards */
.tool-step-card {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2, var(--surface));
  max-width: 100%;
}
.tool-step-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  user-select: none;
  list-style: none;
}
.tool-step-summary::-webkit-details-marker { display: none; }
.tool-step-icon { font-size: 13px; }
.tool-step-name { font-family: var(--font-mono); color: var(--text-primary); }
.tool-step-status {
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
}
.tool-step-status.running { color: var(--accent); background: var(--tint-strong, rgba(0,0,0,.06)); }
.tool-step-status.ok { color: #15803d; background: rgba(34,197,94,.12); }
.tool-step-status.error { color: #b91c1c; background: rgba(239,68,68,.12); }
.tool-step-time { margin-left: auto; font-weight: 400; color: var(--text-muted); }
.tool-step-body {
  border-top: 1px solid var(--border-soft, var(--border));
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-step-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 3px;
}
.tool-step-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}

/* Transient run-status indicator */
.live-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  background: var(--tint-strong, rgba(0,0,0,.05));
  width: fit-content;
}
.live-status-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent);
  animation: pulse-dot .8s ease-in-out infinite alternate;
}
.live-status.done { color: var(--text-secondary); }
.live-status.done .live-status-dot { background: #22c55e; animation: none; }

/* Phase indicator */
.phase-indicator { display: flex; align-items: center; gap: 8px; padding: 6px 0 2px; }
.phase-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.phase-dot.thinking { background: #7c3aed; animation: pulse-dot .8s ease-in-out infinite alternate; }
.phase-dot.sending { background: var(--accent); animation: pulse-dot .6s ease-in-out infinite alternate; }
.phase-label { font-size: var(--text-xs); color: var(--text-muted); }
@keyframes pulse-dot { from { opacity:.4; transform:scale(.85); } to { opacity:1; transform:scale(1); } }

/* Token usage */
.msg-usage {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--tint-strong);
  font-size: 11px; color: var(--text-muted);
}
.usage-sep { color: rgba(15,23,42,.2); }

/* Scroll-to-bottom */
.scroll-down-btn {
  position: absolute; bottom: 90px; left: 50%; transform: translateX(-50%);
  padding: 6px 16px; background: var(--accent); color: #fff;
  border: none; border-radius: 999px; font-size: var(--text-xs); font-weight: 600;
  cursor: pointer; box-shadow: 0 4px 12px rgba(37,99,235,.35); z-index: 10;
  transition: transform .15s, box-shadow .15s;
}
.scroll-down-btn:hover { transform: translateX(-50%) translateY(-2px); box-shadow: 0 6px 16px rgba(37,99,235,.45); }

/* Quick replies panel */
.qr-panel {
  border-top: 1px solid var(--tint-strong);
  background: var(--surface);
  max-height: 180px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.qr-header {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 8px 12px;
  border-bottom: 1px solid var(--tint-medium);
}
.qr-title { font-size: var(--text-xs); font-weight: 700; color: var(--text-secondary); white-space: nowrap; }
.qr-search {
  flex: 1; border: 1px solid rgba(15,23,42,.1); border-radius: 8px;
  padding: 4px 10px; font-size: var(--text-xs); outline: none;
  background: var(--surface-2); color: var(--text-primary);
  transition: border-color .15s;
}
.qr-search:focus { border-color: rgba(37,99,235,.4); }
.qr-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; padding: 2px 6px; }
.qr-list { flex: 1; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.qr-empty { text-align: center; color: var(--text-muted); font-size: var(--text-xs); padding: 16px 0; }
.qr-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 8px; cursor: pointer;
  transition: background .12s;
}
.qr-item:hover { background: rgba(37,99,235,.06); }
.qr-text { flex: 1; font-size: var(--text-xs); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qr-del { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 1px 4px; opacity: 0; transition: opacity .12s; }
.qr-item:hover .qr-del { opacity: 1; }

/* Attachments */
.attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.attachment-card { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 12px; }
.attachment-card.image { background: var(--tint-medium); }
.attachment-card.text, .file-card {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--tint-medium); border: 1px solid var(--border);
  padding: 8px 10px; border-radius: 12px;
}
.msg.user .file-card { background: var(--surface-2); border-color: rgba(255,255,255,.18); }
.file-name { font-size: var(--text-xs); }
.file-icon { line-height: 1; }
.img-preview { max-width: 220px; max-height: 168px; display: block; object-fit: cover; }

/* Markdown */
.md-content { font-size: var(--text-sm); line-height: 1.65; }
.md-content :deep(p) { margin: 0 0 8px; }
.md-content :deep(p:last-child) { margin-bottom: 0; }
.md-content :deep(h1),.md-content :deep(h2),.md-content :deep(h3),.md-content :deep(h4) { margin: 14px 0 8px; font-weight: 700; line-height: 1.35; }
.md-content :deep(h1) { font-size: 1.18em; }
.md-content :deep(h2) { font-size: 1.1em; }
.md-content :deep(h3) { font-size: 1.02em; }
.md-content :deep(ul),.md-content :deep(ol) { margin: 6px 0; padding-left: 22px; }
.md-content :deep(li) { margin: 4px 0; }
.md-content :deep(a) { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.msg.assistant .md-content :deep(a) { color: var(--accent); }
.md-content :deep(blockquote) { margin: 10px 0; padding: 8px 12px; border-left: 3px solid rgba(37,99,235,.35); background: rgba(37,99,235,.06); color: var(--text-secondary); }
.md-content :deep(table) { width: 100%; display: block; overflow-x: auto; border-collapse: collapse; margin: 10px 0; font-size: var(--text-xs); }
.md-content :deep(th),.md-content :deep(td) { border: 1px solid var(--border); padding: 8px 10px; text-align: left; background: var(--surface); }
.md-content :deep(th) { background: var(--tint-medium); font-weight: 700; }
.md-content :deep(pre) { margin: 10px 0; border-radius: 12px; overflow: hidden; background: #111827; color: #e5e7eb; }
.md-content :deep(pre code) { display: block; padding: 12px 14px; overflow-x: auto; font-size: 12px; line-height: 1.55; font-family: var(--font-mono); background: transparent; }
.md-content :deep(code) { background: var(--tint-strong); padding: 2px 6px; border-radius: 6px; font-size: 12px; font-family: var(--font-mono); }
.msg.user .md-content :deep(code) { background: var(--surface-2); }
.md-content :deep(hr) { border: none; border-top: 1px solid rgba(15,23,42,.1); margin: 12px 0; }

/* Pending files */
.pending-files {
  display: flex; flex-wrap: wrap; gap: 10px;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--tint-strong);
  background: var(--surface);
  flex-shrink: 0;
}
.pf-item { position: relative; display: flex; align-items: center; border-radius: 14px; overflow: hidden; background: var(--tint-medium); border: 1px solid var(--border); }
.pf-thumb { width: 56px; height: 56px; object-fit: cover; display: block; }
.pf-file { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 56px; }
.pf-name { font-size: var(--text-xs); color: var(--text-secondary); }
.pf-remove { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; background: rgba(15,23,42,.72); color: white; border: none; border-radius: 999px; cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center; }
.pf-remove:disabled { cursor: not-allowed; opacity: .5; }
.pf-status { font-size: var(--text-xs); color: var(--text-muted); margin-left: 4px; }
.pf-status-error { color: var(--error-text); }
.pf-item.pf-uploading { opacity: .75; }
.pf-item.pf-uploading::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: pf-progress 1.2s linear infinite;
}
.pf-item.pf-error { border-color: var(--error-border, #fca5a5); background: var(--error-tint, #fee2e2); }
@keyframes pf-progress { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

/* Slash command menu */
.slash-menu {
  position: absolute;
  bottom: 60px;
  left: var(--space-4);
  right: var(--space-4);
  max-width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 8px 24px var(--tint-strong);
  overflow: hidden;
  z-index: 20;
}
.slash-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background .1s;
}
.slash-item:hover, .slash-item.active { background: rgba(37,99,235,.06); }
.slash-cmd { font-size: var(--text-sm); font-weight: 700; color: var(--accent); font-family: var(--font-mono); min-width: 80px; }
.slash-desc { font-size: var(--text-xs); color: var(--text-secondary); }

/* Slash transition */
.slash-enter-active, .slash-leave-active { transition: opacity .12s, transform .12s; }
.slash-enter-from, .slash-leave-to { opacity: 0; transform: translateY(4px); }

/* Input bar */
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--tint-strong);
  background: var(--surface);
  flex-shrink: 0;
}
.attach-btn {
  cursor: pointer; font-size: 18px; padding: 8px; border-radius: 12px;
  display: flex; align-items: center; color: var(--text-secondary); transition: background .15s;
}
.attach-btn:hover { background: var(--tint-medium); }
.textarea-wrap { flex: 1; position: relative; }
textarea {
  display: block; width: 100%;
  resize: none;
  border: 1px solid var(--border); border-radius: 14px;
  padding: 10px 12px;
  font-size: var(--text-sm); font-family: var(--font-sans); line-height: 1.6;
  min-height: 44px; max-height: 160px; overflow-y: auto;
  outline: none; background: var(--surface); color: var(--text-primary);
  transition: border-color .15s, box-shadow .15s;
  box-sizing: border-box;
}
textarea:focus { border-color: rgba(37,99,235,.5); box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
.qr-toggle-btn {
  padding: 9px 11px; border: 1px solid rgba(15,23,42,.1); border-radius: 12px;
  background: transparent; font-size: 16px; cursor: pointer; color: var(--text-secondary);
  transition: background .15s, border-color .15s;
  flex-shrink: 0;
}
.qr-toggle-btn:hover { background: var(--tint-medium); }
.qr-toggle-btn.active { background: rgba(37,99,235,.08); border-color: rgba(37,99,235,.25); color: var(--accent); }
.send-btn {
  padding: 10px 18px; background: var(--accent); color: white;
  border: none; border-radius: 14px; cursor: pointer;
  font-size: var(--text-sm); font-weight: 600; font-family: var(--font-sans);
  transition: transform .15s, background .15s; white-space: nowrap;
}
.send-btn:hover { transform: translateY(-1px); }
.send-btn:disabled { opacity: .4; cursor: not-allowed; }
.abort-btn {
  padding: 10px 16px; background: #dc2626; color: white;
  border: none; border-radius: 14px; cursor: pointer;
  font-size: var(--text-sm); font-weight: 600; font-family: var(--font-sans);
  transition: transform .15s, background .15s; white-space: nowrap;
}
.abort-btn:hover { background: #b91c1c; transform: translateY(-1px); }

/* Animations */
@keyframes msg-in { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes blink { 50% { opacity:0; } }
.cursor { display: inline-block; animation: blink .7s step-end infinite; color: var(--accent); }

/* Responsive */
@media (max-width: 960px) {
  .header-actions, .conversation-bar { align-items: flex-start; }
  .msg { max-width: 100%; }
  .agent-switcher { width: 100%; justify-content: space-between; }
  .agent-switcher-field { min-width: 0; flex: 1; }
  .bar-right { flex-wrap: wrap; }
}
</style>
