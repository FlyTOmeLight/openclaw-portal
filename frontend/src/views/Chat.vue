<template>
  <div class="chat-root">
    <!-- Header -->
    <div class="chat-header">
      <span class="chat-title">💬 OpenClaw 聊天</span>
      <button @click="clearChat" class="btn sm">清空对话</button>
    </div>

    <!-- Message list -->
    <div class="messages" ref="messagesEl">
      <div v-if="messages.length === 0" class="empty-hint">
        <p>发送消息开始对话</p>
        <p class="sub">支持文本、图片、代码文件等</p>
      </div>

      <div v-for="(msg, i) in messages" :key="i" :class="['msg', msg.role]">
        <div class="msg-meta">{{ msg.role === 'user' ? '你' : 'OpenClaw' }}</div>
        <div class="msg-bubble">
          <!-- File attachments preview -->
          <div v-if="msg.attachments?.length" class="attachments">
            <div v-for="a in msg.attachments" :key="a.filename" class="attachment">
              <img v-if="a.type === 'image'" :src="a.dataUrl" class="img-preview" />
              <span v-else class="file-badge">📄 {{ a.filename }}</span>
            </div>
          </div>
          <!-- Text content -->
          <div v-if="msg.text" v-html="renderMarkdown(msg.text)" class="md-content" />
          <!-- Streaming indicator -->
          <span v-if="msg.streaming" class="cursor">▌</span>
        </div>
      </div>
    </div>

    <!-- Attachment preview bar -->
    <div v-if="pendingFiles.length" class="pending-files">
      <div v-for="(f, i) in pendingFiles" :key="i" class="pf-item">
        <img v-if="f.type === 'image'" :src="f.dataUrl" class="pf-thumb" />
        <span v-else class="pf-name">📄 {{ f.filename }}</span>
        <button @click="removePending(i)" class="pf-remove">✕</button>
      </div>
    </div>

    <!-- Input bar -->
    <div class="input-bar">
      <label class="attach-btn" title="附件">
        📎
        <input type="file" multiple @change="onFilePick" accept="image/*,.txt,.md,.ts,.js,.py,.go,.json,.yaml,.yml,.sh,.csv" hidden />
      </label>
      <textarea
        v-model="inputText"
        @keydown.enter.exact.prevent="send"
        @keydown.enter.shift.exact="inputText += '\n'"
        placeholder="输入消息… Enter 发送，Shift+Enter 换行"
        rows="1"
        ref="textareaEl"
        :disabled="streaming"
      />
      <button @click="send" :disabled="(!inputText.trim() && !pendingFiles.length) || streaming" class="send-btn">
        {{ streaming ? '⏳' : '发送' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api/client.js'

interface Attachment {
  type: 'image' | 'text'
  filename: string
  mimeType: string
  dataUrl?: string
  content?: string
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  attachments?: Attachment[]
  streaming?: boolean
}

const messages = ref<Message[]>([])
const inputText = ref('')
const streaming = ref(false)
const pendingFiles = ref<Attachment[]>([])
const messagesEl = ref<HTMLElement>()
const textareaEl = ref<HTMLTextAreaElement>()

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  return DOMPurify.sanitize(raw)
}

async function onFilePick(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    const result = await api.chat.uploadFile(file)
    pendingFiles.value.push(result)
  }
  ;(e.target as HTMLInputElement).value = ''
}

function removePending(i: number) { pendingFiles.value.splice(i, 1) }

async function send() {
  const text = inputText.value.trim()
  if (!text && pendingFiles.value.length === 0) return
  if (streaming.value) return

  // Build user message content for OpenClaw API
  const content: any[] = []
  for (const f of pendingFiles.value) {
    if (f.type === 'image' && f.dataUrl) {
      content.push({ type: 'image_url', image_url: { url: f.dataUrl } })
    } else if (f.type === 'text' && f.content) {
      content.push({ type: 'text', text: `\`\`\`${f.filename}\n${f.content}\n\`\`\`` })
    }
  }
  if (text) content.push({ type: 'text', text })

  // Add to display
  const userMsg: Message = {
    role: 'user',
    text,
    attachments: [...pendingFiles.value],
  }
  messages.value.push(userMsg)
  inputText.value = ''
  pendingFiles.value = []
  await scrollToBottom()

  // Add streaming assistant placeholder
  const assistantMsg: Message = { role: 'assistant', text: '', streaming: true }
  messages.value.push(assistantMsg)

  streaming.value = true
  try {
    // Build history for API
    const apiMessages = messages.value
      .slice(0, -1) // exclude the empty assistant placeholder
      .map(m => ({
        role: m.role,
        content: m.role === 'user' && (m.attachments?.length ?? 0) > 0
          ? buildApiContent(m)
          : m.text,
      }))

    const res = await api.chat.complete(apiMessages)
    if (!res.ok) {
      assistantMsg.text = `错误: ${res.status} ${res.statusText}`
      assistantMsg.streaming = false
      return
    }

    // Read SSE stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content ?? ''
          if (delta) {
            assistantMsg.text += delta
            await scrollToBottom()
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  } catch (err: any) {
    assistantMsg.text = `连接失败: ${err.message}`
  } finally {
    assistantMsg.streaming = false
    streaming.value = false
    await scrollToBottom()
  }
}

function buildApiContent(msg: Message): any[] {
  const parts: any[] = []
  for (const a of msg.attachments ?? []) {
    if (a.type === 'image' && a.dataUrl) {
      parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
    } else if (a.type === 'text' && a.content) {
      parts.push({ type: 'text', text: `\`\`\`${a.filename}\n${a.content}\n\`\`\`` })
    }
  }
  if (msg.text) parts.push({ type: 'text', text: msg.text })
  return parts
}

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

function clearChat() { messages.value = [] }
</script>

<style scoped>
.chat-root { display: flex; flex-direction: column; height: calc(100vh - 64px); background: white; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
.chat-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #e5e7eb; background: white; }
.chat-title { font-weight: 600; font-size: 16px; }
.messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.empty-hint { text-align: center; color: #9ca3af; padding-top: 60px; }
.empty-hint .sub { font-size: 13px; margin-top: 6px; }
.msg { display: flex; flex-direction: column; }
.msg.user { align-items: flex-end; }
.msg.assistant { align-items: flex-start; }
.msg-meta { font-size: 11px; color: #9ca3af; margin-bottom: 4px; }
.msg-bubble { max-width: 75%; }
.msg.user .msg-bubble { background: #2563eb; color: white; border-radius: 16px 16px 4px 16px; padding: 10px 14px; }
.msg.assistant .msg-bubble { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 16px 16px 16px 4px; padding: 10px 14px; }
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.img-preview { max-width: 200px; max-height: 150px; border-radius: 8px; object-fit: cover; }
.file-badge { font-size: 12px; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 6px; }
.md-content { font-size: 14px; line-height: 1.6; }
.md-content :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; margin: 8px 0; }
.md-content :deep(code) { background: rgba(0,0,0,.08); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
.md-content :deep(p) { margin: 4px 0; }
.msg.user .md-content :deep(code) { background: rgba(255,255,255,.2); }
.cursor { display: inline-block; animation: blink .7s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.pending-files { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 16px; border-top: 1px solid #e5e7eb; background: #fafafa; }
.pf-item { position: relative; display: flex; align-items: center; gap: 4px; }
.pf-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }
.pf-name { font-size: 12px; background: #f3f4f6; padding: 4px 8px; border-radius: 6px; }
.pf-remove { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; background: #ef4444; color: white; border: none; border-radius: 50%; cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center; }
.input-bar { display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #e5e7eb; background: white; }
.attach-btn { cursor: pointer; font-size: 20px; padding: 6px; border-radius: 8px; display: flex; align-items: center; }
.attach-btn:hover { background: #f3f4f6; }
textarea { flex: 1; resize: none; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px 12px; font-size: 14px; font-family: inherit; line-height: 1.5; max-height: 160px; overflow-y: auto; outline: none; }
textarea:focus { border-color: #2563eb; }
.send-btn { padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 500; white-space: nowrap; }
.send-btn:disabled { opacity: .4; cursor: not-allowed; }
.btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 13px; background: white; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
</style>
