/**
 * useAgentChat — core streaming chat logic, shared by Chat.vue and AgentChatPanel.vue
 *
 * Talks to the OpenClaw gateway over the portal WebSocket RPC bridge
 * (`/api/chat/ws`) — same channel Chat.vue uses. The WS path carries
 * `event:'agent'` tool-call events, which the legacy HTTP `/v1/chat/completions`
 * channel did not, so tool steps can now be rendered here too.
 */
import { ref, reactive } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { extractGatewayText, extractGatewayReasoning } from '../utils/chat-stream.js'
import {
  mergeToolEvent,
  describeAgentStream,
  type ToolStep,
  type LiveStatus,
} from '../utils/chat-tools.js'

export type ChatMode = 'chat' | 'plan' | 'execute' | 'unlimited'
export type AgentPhase = 'sending' | 'thinking' | 'replying' | 'done' | 'aborted'

export interface TokenUsage { input: number; output: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  phase?: AgentPhase
  usage?: TokenUsage
  steps?: ToolStep[]            // tool-call step cards
  liveStatus?: LiveStatus       // transient run indicator (compaction/fallback)
  streaming?: boolean
  createdAt: number
}

// Mirrors backend chat.ts MODE_SYSTEM_PROMPTS. The WS `chat.send` RPC has no
// `mode` field, so chat/plan constraints are prefixed onto the first message.
const MODE_SYSTEM_PROMPTS: Partial<Record<ChatMode, string>> = {
  chat: '你只能进行对话和回答问题，不能使用任何工具，也不能修改文件。',
  plan: '你现在处于规划模式：只分析、拆解和规划，不执行工具，不修改文件。',
}

marked.setOptions({ breaks: true, gfm: true })

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
}

export function mkId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function useAgentChat() {
  const messages = reactive<ChatMessage[]>([])
  const streaming = ref(false)
  const conversationKey = ref('')

  let rafScheduled = false

  // ── scroll helpers ─────────────────────────────────────────────────────────
  let scrollEl: HTMLElement | null = null
  let autoFollow = true

  function attachScroll(el: HTMLElement) { scrollEl = el }

  function scheduleScroll() {
    if (!autoFollow || rafScheduled) return
    rafScheduled = true
    requestAnimationFrame(() => {
      rafScheduled = false
      if (scrollEl && autoFollow) scrollEl.scrollTop = scrollEl.scrollHeight
    })
  }

  function jumpToBottom() {
    autoFollow = true
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  }

  function onScroll() {
    if (!scrollEl) return
    autoFollow = (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) < 80
  }

  // ── WebSocket state ─────────────────────────────────────────────────────────
  let ws: WebSocket | null = null
  let wsReady = false
  let wsConnecting = false
  let connectTimeout: ReturnType<typeof setTimeout> | null = null
  const connectResolvers: (() => void)[] = []
  const connectRejectors: ((e: Error) => void)[] = []
  const pendingRpcs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const chatEventHandlers: Array<(payload: any) => void> = []
  const agentEventHandlers: Array<(payload: any) => void> = []
  let activeAbort: (() => void) | null = null

  function handleWsMessage(data: string) {
    let msg: any
    try { msg = JSON.parse(data) } catch { return }

    if (msg.type === 'event' && msg.event === 'portal.connected') {
      if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
      wsReady = true
      wsConnecting = false
      connectResolvers.splice(0).forEach(fn => fn())
      connectRejectors.splice(0)
      return
    }

    if (msg.type === 'event' && msg.event === 'portal.error') {
      wsReady = false
      wsConnecting = false
      const err = new Error(msg.payload?.message ?? 'WS portal error')
      connectRejectors.splice(0).forEach(fn => fn(err))
      connectResolvers.splice(0)
      return
    }

    if (msg.type === 'res' && msg.id) {
      const rpc = pendingRpcs.get(msg.id)
      if (rpc) {
        clearTimeout(rpc.timer)
        pendingRpcs.delete(msg.id)
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

  function ensureWs(): Promise<void> {
    if (wsReady && ws?.readyState === 1) return Promise.resolve()
    if (wsConnecting) return new Promise((res, rej) => { connectResolvers.push(res); connectRejectors.push(rej) })
    wsConnecting = true

    return new Promise((resolve, reject) => {
      connectResolvers.push(resolve)
      connectRejectors.push(reject)

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
      const url = `${protocol}//${location.host}${base}/api/chat/ws`
      const sock = new WebSocket(url)
      ws = sock

      connectTimeout = setTimeout(() => {
        connectTimeout = null
        wsConnecting = false
        const err = new Error('WS connect timeout')
        connectRejectors.splice(0).forEach(fn => fn(err))
        connectResolvers.splice(0)
        try { sock.close() } catch {}
      }, 12000)

      sock.onmessage = e => handleWsMessage(typeof e.data === 'string' ? e.data : String(e.data))
      sock.onopen = () => { /* wait for portal.connected */ }
      sock.onclose = () => {
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
        wsReady = false
        wsConnecting = false
        ws = null
        pendingRpcs.forEach(({ reject: rej, timer }) => { clearTimeout(timer); rej(new Error('WS closed')) })
        pendingRpcs.clear()
        if (connectResolvers.length) {
          const err = new Error('WS closed during connect')
          connectRejectors.splice(0).forEach(fn => fn(err))
          connectResolvers.splice(0)
        }
      }
      sock.onerror = () => {
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null }
        wsConnecting = false
        const err = new Error('WS connection failed')
        connectRejectors.splice(0).forEach(fn => fn(err))
        connectResolvers.splice(0)
      }
    })
  }

  async function wsRequest(method: string, params: object): Promise<any> {
    await ensureWs()
    const id = `req-${mkId()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpcs.delete(id)
        reject(new Error(`WS RPC timeout: ${method}`))
      }, 15000)
      pendingRpcs.set(id, { resolve, reject, timer })
      ws!.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  // ── send over WS ────────────────────────────────────────────────────────────
  function sendViaWs(assistantMsg: ChatMessage, sessionKey: string, messageText: string): Promise<void> {
    let currentRunId: string | null = null
    let resolved = false
    let safetyTimer: ReturnType<typeof setTimeout> | null = null

    return new Promise<void>((resolve, reject) => {
      function cleanup() {
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
        const ci = chatEventHandlers.indexOf(chatHandler)
        if (ci !== -1) chatEventHandlers.splice(ci, 1)
        const ai = agentEventHandlers.indexOf(agentHandler)
        if (ai !== -1) agentEventHandlers.splice(ai, 1)
      }

      function finish(err?: Error) {
        if (resolved) return
        resolved = true
        cleanup()
        assistantMsg.liveStatus = undefined
        if (err) reject(err)
        else resolve()
      }

      function resetSafety() {
        if (safetyTimer) clearTimeout(safetyTimer)
        safetyTimer = setTimeout(() => {
          if (!resolved) {
            console.warn('[useAgentChat] 流式超时（90s 无新事件），强制结束')
            finish()
          }
        }, 90_000)
      }

      activeAbort = () => {
        if (resolved) return
        try {
          ws?.send(JSON.stringify({
            type: 'req',
            id: `req-${mkId()}`,
            method: 'chat.abort',
            params: { sessionKey, ...(currentRunId ? { runId: currentRunId } : {}) },
          }))
        } catch {}
      }

      const chatHandler = (payload: any) => {
        if (resolved || !payload) return
        if (payload.sessionKey && payload.sessionKey !== sessionKey) return

        const { state: evtState, runId, message } = payload
        if (runId) currentRunId = runId

        if (evtState === 'delta') {
          resetSafety()
          const text = extractGatewayText(message)
          const reasoning = extractGatewayReasoning(message)
          if (reasoning && reasoning.length > (assistantMsg.reasoning?.length ?? 0)) {
            assistantMsg.reasoning = reasoning
            assistantMsg.phase = 'thinking'
            scheduleScroll()
          }
          if (text && text.length > assistantMsg.text.length) {
            assistantMsg.text = text
            assistantMsg.phase = 'replying'
            scheduleScroll()
          }
          return
        }

        if (evtState === 'final') {
          const text = extractGatewayText(message)
          const reasoning = extractGatewayReasoning(message)
          if (reasoning) assistantMsg.reasoning = reasoning
          if (text) { assistantMsg.text = text; scheduleScroll() }
          finish()
          return
        }

        if (evtState === 'aborted') {
          if (!assistantMsg.text) assistantMsg.text = '（已中断）'
          assistantMsg.phase = 'aborted'
          finish()
          return
        }

        if (evtState === 'error') {
          const errMsg = payload.errorMessage ?? payload.error?.message ?? '未知错误'
          if (assistantMsg.text) finish()
          else finish(new Error(errMsg))
          return
        }
      }

      const agentHandler = (payload: any) => {
        if (resolved || !payload) return
        if (payload.sessionKey && payload.sessionKey !== sessionKey) return
        if (currentRunId && payload.runId && payload.runId !== currentRunId) return
        if (payload.runId && !currentRunId) currentRunId = payload.runId
        resetSafety()

        if (payload.stream === 'tool') {
          if (!assistantMsg.steps) assistantMsg.steps = []
          mergeToolEvent(assistantMsg.steps, payload)
          scheduleScroll()
          return
        }

        const ls = describeAgentStream(payload)
        if (ls) { assistantMsg.liveStatus = ls; scheduleScroll() }
      }

      chatEventHandlers.push(chatHandler)
      agentEventHandlers.push(agentHandler)
      resetSafety()

      wsRequest('chat.send', {
        sessionKey,
        message: messageText,
        deliver: false,
        idempotencyKey: mkId(),
      }).catch((err: Error) => finish(err))
    })
  }

  // ── send ──────────────────────────────────────────────────────────────────
  async function send(text: string, agentId: string, mode: ChatMode = 'execute') {
    text = text.trim()
    if (!text || streaming.value) return

    const isFirstTurn = messages.length === 0
    messages.push({ id: mkId(), role: 'user', text, createdAt: Date.now() })
    autoFollow = true
    scheduleScroll()

    const assistantMsg: ChatMessage = {
      id: mkId(), role: 'assistant', text: '', phase: 'sending', streaming: true, createdAt: Date.now(),
    }
    messages.push(assistantMsg)
    streaming.value = true

    try {
      if (!conversationKey.value) conversationKey.value = mkId()
      const agent = agentId === 'main' ? 'main' : agentId
      const sessionKey = `agent:${agent}:portal:${conversationKey.value}`

      // mode → system prefix, applied once on the first turn of the conversation
      const sysPrompt = MODE_SYSTEM_PROMPTS[mode]
      const messageText = sysPrompt && isFirstTurn ? `${sysPrompt}\n\n${text}` : text

      await sendViaWs(assistantMsg, sessionKey, messageText)
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        assistantMsg.text = assistantMsg.text || '（已中断）'
        assistantMsg.phase = 'aborted'
      } else {
        assistantMsg.text = `连接失败: ${err.message}`
      }
    } finally {
      activeAbort = null
      assistantMsg.streaming = false
      if (assistantMsg.phase !== 'aborted') assistantMsg.phase = 'done'
      assistantMsg.liveStatus = undefined
      streaming.value = false
      autoFollow = true
      scheduleScroll()
    }
  }

  function abort() { activeAbort?.() }

  function clear() {
    messages.splice(0)
    conversationKey.value = ''
  }

  return {
    messages,
    streaming,
    conversationKey,
    send,
    abort,
    clear,
    attachScroll,
    scheduleScroll,
    jumpToBottom,
    onScroll,
    renderMarkdown,
  }
}
