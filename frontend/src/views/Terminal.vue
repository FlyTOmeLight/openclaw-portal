<template>
  <div class="terminal-page">
    <header class="page-header">
      <div>
        <h1>命令终端</h1>
        <p class="subtitle">非交互式命令执行（适合 openclaw / systemctl / journalctl / tail / ls 等运维命令）</p>
      </div>
      <div class="header-actions">
        <span class="status" :class="statusClass">{{ statusText }}</span>
        <button v-if="running" class="btn btn-sm btn-danger" @click="sendSignal('SIGINT')" title="发送 Ctrl+C (SIGINT)">
          中断
        </button>
        <button v-if="running" class="btn btn-sm" @click="sendSignal('SIGTERM')">
          终止
        </button>
        <button class="btn btn-sm" @click="clearTerm">清屏</button>
        <button class="btn btn-sm" @click="reconnect" :disabled="connecting">重连</button>
      </div>
    </header>

    <div ref="termHost" class="term-host"></div>

    <form class="prompt" @submit.prevent="submit">
      <span class="prompt-sigil">$</span>
      <input
        ref="promptInput"
        v-model="cmdText"
        :disabled="running || !connected"
        :placeholder="runningHint"
        autocomplete="off"
        spellcheck="false"
        @keydown.up.prevent="historyPrev"
        @keydown.down.prevent="historyNext"
      />
      <button type="submit" class="btn btn-sm btn-primary" :disabled="running || !connected || !cmdText.trim()">
        运行
      </button>
    </form>

    <details class="hint">
      <summary>允许的命令（共 {{ allowedCommands.length }} 条）</summary>
      <div class="hint-body">
        <code v-for="c in allowedCommands" :key="c" class="hint-chip">{{ c }}</code>
        <p class="hint-note">绝对路径（/...）或相对路径（./...）也可执行。不支持 vim/top 等交互式程序。</p>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, ref, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const termHost = ref<HTMLDivElement | null>(null)
const promptInput = ref<HTMLInputElement | null>(null)
const cmdText = ref('')
const running = ref(false)
const connected = ref(false)
const connecting = ref(false)
const allowedCommands = ref<string[]>([])

let term: Terminal | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null

const history = ref<string[]>(loadHistory())
let historyIdx = -1  // -1 means "fresh prompt", 0 = most recent

const runningHint = computed(() => running.value
  ? '命令执行中… 点击"中断"发送 Ctrl+C'
  : '输入命令，例如：openclaw status'
)

const statusText = computed(() => {
  if (connecting.value) return '连接中…'
  if (!connected.value) return '已断开'
  if (running.value) return '运行中'
  return '就绪'
})
const statusClass = computed(() => ({
  'status-ok': connected.value && !running.value,
  'status-run': running.value,
  'status-off': !connected.value && !connecting.value,
  'status-wait': connecting.value,
}))

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem('portal.terminal.history')
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, 100) : []
  } catch { return [] }
}
function saveHistory() {
  try {
    localStorage.setItem('portal.terminal.history', JSON.stringify(history.value.slice(0, 100)))
  } catch {}
}

function writeLine(text: string, color?: string) {
  if (!term) return
  const prefix = color ? `\x1b[${color}m` : ''
  const suffix = color ? '\x1b[0m' : ''
  term.writeln(`${prefix}${text}${suffix}`)
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  connecting.value = true
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}${base}/api/terminal/ws`
  ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    connecting.value = false
    connected.value = true
    writeLine('[已连接]', '32')
  })
  ws.addEventListener('close', () => {
    connecting.value = false
    connected.value = false
    running.value = false
    writeLine('[连接已关闭]', '33')
  })
  ws.addEventListener('error', () => {
    connecting.value = false
    connected.value = false
    running.value = false
    writeLine('[连接错误]', '31')
  })
  ws.addEventListener('message', (ev) => {
    let msg: any
    try { msg = JSON.parse(ev.data) } catch { return }
    switch (msg.type) {
      case 'hello':
        allowedCommands.value = msg.allowed || []
        if (msg.note) writeLine(msg.note, '90')
        break
      case 'started':
        running.value = true
        writeLine(`$ ${msg.cmd} ${(msg.args || []).join(' ')}`.trimEnd(), '36')
        break
      case 'stdout':
        term?.write(String(msg.data).replace(/\n/g, '\r\n'))
        break
      case 'stderr':
        term?.write(`\x1b[33m${String(msg.data).replace(/\n/g, '\r\n')}\x1b[0m`)
        break
      case 'exit':
        running.value = false
        const code = msg.code
        const signal = msg.signal
        const color = code === 0 ? '32' : '31'
        writeLine(signal ? `[exit signal=${signal}]` : `[exit ${code}]`, color)
        nextTick(() => promptInput.value?.focus())
        break
      case 'error':
        writeLine(`[错误] ${msg.message}`, '31')
        running.value = false
        break
    }
  })
}

function reconnect() {
  try { ws?.close() } catch {}
  ws = null
  connect()
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let buf = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote) {
      if (c === quote) { quote = null; continue }
      buf += c
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if (/\s/.test(c)) {
      if (buf) { tokens.push(buf); buf = '' }
      continue
    }
    buf += c
  }
  if (buf) tokens.push(buf)
  return tokens
}

function submit() {
  const text = cmdText.value.trim()
  if (!text || running.value || !connected.value || !ws) return
  const toks = tokenize(text)
  if (toks.length === 0) return
  const [cmd, ...args] = toks

  history.value = [text, ...history.value.filter(h => h !== text)].slice(0, 100)
  saveHistory()
  historyIdx = -1

  ws.send(JSON.stringify({ type: 'run', cmd, args }))
  cmdText.value = ''
}

function sendSignal(signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL') {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'signal', signal }))
}

function historyPrev() {
  if (history.value.length === 0) return
  historyIdx = Math.min(historyIdx + 1, history.value.length - 1)
  cmdText.value = history.value[historyIdx] || ''
}
function historyNext() {
  if (historyIdx <= 0) { historyIdx = -1; cmdText.value = ''; return }
  historyIdx -= 1
  cmdText.value = history.value[historyIdx] || ''
}

function clearTerm() {
  term?.clear()
}

onMounted(async () => {
  await nextTick()
  if (!termHost.value) return
  term = new Terminal({
    cursorBlink: false,
    disableStdin: true,       // output-only terminal
    convertEol: true,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#1a1a1a',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
    },
    scrollback: 5000,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termHost.value)
  fit.fit()

  resizeObserver = new ResizeObserver(() => { try { fit?.fit() } catch {} })
  resizeObserver.observe(termHost.value)

  writeLine('OpenClaw Portal Terminal', '36')
  writeLine('提示：↑↓ 历史命令 · Ctrl+C 等效"中断"按钮 · 命令需在白名单内', '90')

  connect()
  setTimeout(() => promptInput.value?.focus(), 100)
})

onBeforeUnmount(() => {
  try { ws?.close() } catch {}
  resizeObserver?.disconnect()
  term?.dispose()
})
</script>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 12px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.page-header h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text-primary);
}
.page-header .subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}
.header-actions { display: flex; align-items: center; gap: 8px; }
.status {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status-ok { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.status-run { background: color-mix(in srgb, #f59e0b 15%, transparent); color: var(--warn-text); }
.status-off { background: color-mix(in srgb, #ef4444 15%, transparent); color: var(--error-text); }
.status-wait { background: color-mix(in srgb, #6b7280 15%, transparent); color: var(--text-muted); }

.term-host {
  flex: 1;
  min-height: 300px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  background: var(--surface-3);
  overflow: hidden;
}
.term-host :deep(.xterm) { height: 100%; }
.term-host :deep(.xterm-viewport) { background: transparent !important; }

.prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.prompt-sigil {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
  font-size: 14px;
}
.prompt input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
}
.prompt input:disabled { opacity: 0.5; }

.hint { font-size: 12px; color: var(--text-muted); }
.hint summary { cursor: pointer; user-select: none; }
.hint-body { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.hint-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-2);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--text-primary);
}
.hint-note {
  flex-basis: 100%;
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}

.btn-danger { color: var(--error-text); border-color: color-mix(in srgb, #ef4444 30%, var(--border)); }
.btn-danger:hover { background: color-mix(in srgb, #ef4444 10%, transparent); }
</style>
