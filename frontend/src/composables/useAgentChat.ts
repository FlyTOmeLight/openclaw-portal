/**
 * useAgentChat — core streaming chat logic, shared by Chat.vue and AgentChatPanel.vue
 */
import { ref, reactive } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api/client.js'
import { mergeStreamText, normalizeGatewayField } from '../utils/chat-stream.js'

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
  streaming?: boolean
  createdAt: number
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

  let abortController: AbortController | null = null
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

  // ── stream parsing helpers ─────────────────────────────────────────────────
  async function readResponseError(res: Response): Promise<string> {
    const text = await res.text().catch(() => '')
    if (!text) return `${res.status} ${res.statusText}`
    try { return JSON.parse(text).error ?? JSON.parse(text).message ?? text } catch { return text }
  }

  function applySsePayload(raw: string, assistantMsg: ChatMessage) {
    const data = raw.trim()
    if (!data || data === '[DONE]') return

    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      return
    }

    if (json.usage) {
      const input = json.usage.prompt_tokens ?? json.usage.input_tokens
      const output = json.usage.completion_tokens ?? json.usage.output_tokens
      if (typeof input === 'number') assistantMsg.usage = { input, output: assistantMsg.usage?.output ?? 0 }
      if (typeof output === 'number') assistantMsg.usage = { input: assistantMsg.usage?.input ?? 0, output }
    }
    if (json.type === 'message_start' && json.message?.usage) {
      const input = json.message.usage.input_tokens
      if (typeof input === 'number') assistantMsg.usage = { input, output: assistantMsg.usage?.output ?? 0 }
    }
    if (json.type === 'message_delta' && json.usage) {
      const output = json.usage.output_tokens
      if (typeof output === 'number') assistantMsg.usage = { input: assistantMsg.usage?.input ?? 0, output }
    }

    const reasoningDelta =
      json.choices?.[0]?.delta?.reasoning_content ??
      json.delta?.reasoning_content ??
      (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta' ? json.delta.thinking : undefined) ?? ''

    const delta =
      json.delta?.text ??
      json.choices?.[0]?.delta?.content ??
      json.choices?.[0]?.delta?.text ??
      (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' ? json.delta.text : undefined) ?? ''

    const nextReasoning = mergeStreamText(
      assistantMsg.reasoning ?? '',
      normalizeGatewayField(reasoningDelta, 'reasoning'),
    )
    if (nextReasoning !== (assistantMsg.reasoning ?? '')) {
      assistantMsg.phase = 'thinking'
      assistantMsg.reasoning = nextReasoning
      scheduleScroll()
    }

    const nextText = mergeStreamText(
      assistantMsg.text,
      normalizeGatewayField(delta, 'text'),
    )
    if (nextText !== assistantMsg.text) {
      assistantMsg.phase = 'replying'
      assistantMsg.text = nextText
      scheduleScroll()
    }

    const errorMessage = json?.error?.message
    if (typeof errorMessage === 'string' && errorMessage) {
      assistantMsg.text = errorMessage
      assistantMsg.phase = 'done'
      scheduleScroll()
    }
  }

  // ── send ──────────────────────────────────────────────────────────────────
  async function send(text: string, agentId: string, mode: ChatMode = 'execute') {
    text = text.trim()
    if (!text || streaming.value) return

    messages.push({ id: mkId(), role: 'user', text, createdAt: Date.now() })
    autoFollow = true
    scheduleScroll()

    const assistantMsg: ChatMessage = {
      id: mkId(), role: 'assistant', text: '', phase: 'sending', streaming: true, createdAt: Date.now(),
    }
    messages.push(assistantMsg)
    streaming.value = true
    abortController = new AbortController()

    try {
      if (!conversationKey.value) conversationKey.value = mkId()

      const res = await api.chat.complete(
        [{ role: 'user', content: text }],
        mode,
        { agentId: agentId === 'main' ? undefined : agentId, conversationKey: conversationKey.value },
        abortController.signal,
      )

      if (!res.ok) {
        assistantMsg.text = `错误: ${await readResponseError(res)}`
        assistantMsg.streaming = false; assistantMsg.phase = 'done'
        return
      }

      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('text/event-stream') && !ct.includes('text/plain')) {
        const json = await res.json()
        const content = json?.choices?.[0]?.message?.content ?? ''
        assistantMsg.text = typeof content === 'string' ? content : JSON.stringify(content)
        assistantMsg.streaming = false; assistantMsg.phase = 'done'
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        assistantMsg.text = '错误: 上游未返回可读取的流'
        assistantMsg.streaming = false; assistantMsg.phase = 'done'
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const lines = frame.split(/\r?\n/)
          const dataLines = lines.filter(line => line.trim().startsWith('data:'))
          if (!dataLines.length) continue
          const data = dataLines
            .map(line => line.trim().slice(5).trim())
            .filter(part => part && part !== '[DONE]')
            .join('\n')
          if (!data) continue
          applySsePayload(data, assistantMsg)
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split(/\r?\n/)
        const dataLines = lines.filter(line => line.trim().startsWith('data:'))
        if (dataLines.length) {
          const data = dataLines
            .map(line => line.trim().slice(5).trim())
            .filter(part => part && part !== '[DONE]')
            .join('\n')
          if (data) applySsePayload(data, assistantMsg)
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        assistantMsg.text = assistantMsg.text || '（已中断）'
        assistantMsg.phase = 'aborted'
      } else {
        assistantMsg.text = `连接失败: ${err.message}`
      }
    } finally {
      assistantMsg.streaming = false
      if (assistantMsg.phase !== 'aborted') assistantMsg.phase = 'done'
      streaming.value = false
      abortController = null
      autoFollow = true
      scheduleScroll()
    }
  }

  function abort() { abortController?.abort() }

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
