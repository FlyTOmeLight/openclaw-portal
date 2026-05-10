<template>
  <div class="terminal-page">
    <header class="page-header">
      <div>
        <h1>命令终端</h1>
        <p class="subtitle">完整 PTY 终端：vim / top / less / htop / sudo / openclaw 交互式命令均可使用。</p>
      </div>
      <div class="header-actions">
        <span class="status" :class="statusClass">{{ statusText }}</span>
        <span v-if="shellPath" class="shell-tag">{{ shellPath }}<span v-if="shellPid"> · pid {{ shellPid }}</span></span>
        <button class="btn btn-sm" @click="sendSignal('SIGINT')" :disabled="!connected" title="发送 Ctrl+C">中断</button>
        <button class="btn btn-sm" @click="clearTerm">清屏</button>
        <button class="btn btn-sm" @click="reconnect" :disabled="connecting">重连</button>
      </div>
    </header>

    <div ref="termHost" class="term-host" @click="focusTerm"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, nextTick, ref, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const termHost = ref<HTMLDivElement | null>(null)
const connected = ref(false)
const connecting = ref(false)
const shellPath = ref('')
const shellPid = ref<number | null>(null)

let term: Terminal | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let resizeObserver: ResizeObserver | null = null
let lastSize = { cols: 0, rows: 0 }

const statusText = computed(() => {
  if (connecting.value) return '连接中…'
  if (!connected.value) return '已断开'
  return '已连接'
})
const statusClass = computed(() => ({
  'status-ok': connected.value,
  'status-off': !connected.value && !connecting.value,
  'status-wait': connecting.value,
}))

function writeBanner(text: string, color = '36') {
  if (!term) return
  term.writeln(`\x1b[${color}m${text}\x1b[0m`)
}

function sendResize() {
  if (!term || !ws || ws.readyState !== WebSocket.OPEN) return
  const cols = term.cols
  const rows = term.rows
  if (cols === lastSize.cols && rows === lastSize.rows) return
  lastSize = { cols, rows }
  ws.send(JSON.stringify({ type: 'resize', cols, rows }))
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
    // Send initial size as soon as the channel is up.
    nextTick(() => { try { fit?.fit() } catch {}; sendResize() })
  })
  ws.addEventListener('close', () => {
    connecting.value = false
    connected.value = false
    writeBanner('[连接已关闭]', '33')
  })
  ws.addEventListener('error', () => {
    connecting.value = false
    connected.value = false
    writeBanner('[连接错误]', '31')
  })
  ws.addEventListener('message', (ev) => {
    let msg: any
    try { msg = JSON.parse(ev.data) } catch { return }
    switch (msg.type) {
      case 'hello':
        shellPath.value = msg.shell || ''
        shellPid.value = typeof msg.pid === 'number' ? msg.pid : null
        if (msg.note) writeBanner(msg.note, '90')
        break
      case 'data':
        // PTY output is already raw terminal stream; write as-is.
        term?.write(String(msg.data))
        break
      case 'exit':
        connected.value = false
        writeBanner(msg.signal ? `[shell exit signal=${msg.signal}]` : `[shell exit ${msg.code}]`, msg.code === 0 ? '32' : '31')
        break
      case 'error':
        writeBanner(`[error] ${msg.message}`, '31')
        break
    }
  })
}

function reconnect() {
  try { ws?.close() } catch {}
  ws = null
  if (term) term.clear()
  connect()
}

function sendSignal(signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL') {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'signal', signal }))
}

function clearTerm() {
  term?.clear()
}

function focusTerm() {
  term?.focus()
}

onMounted(async () => {
  await nextTick()
  if (!termHost.value) return
  term = new Terminal({
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#1a1a1a',
      foreground: '#e5e5e5',
      cursor: '#e5e5e5',
    },
    scrollback: 10000,
    allowProposedApi: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termHost.value)
  fit.fit()

  // Forward keystrokes / paste to backend.
  term.onData(data => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'input', data }))
  })

  resizeObserver = new ResizeObserver(() => {
    try { fit?.fit() } catch {}
    sendResize()
  })
  resizeObserver.observe(termHost.value)

  writeBanner('OpenClaw Portal Terminal — 完整 PTY', '36')
  writeBanner('提示：直接键入命令，支持 Tab 补全 / Ctrl+C / vim / top 等交互式程序。', '90')

  connect()
  setTimeout(() => term?.focus(), 100)
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
.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.status {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status-ok { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.status-off { background: color-mix(in srgb, #ef4444 15%, transparent); color: var(--error-text); }
.status-wait { background: color-mix(in srgb, #6b7280 15%, transparent); color: var(--text-muted); }
.shell-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-2);
  padding: 2px 8px;
  border-radius: 6px;
}

.term-host {
  flex: 1;
  min-height: 360px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  background: var(--surface-3);
  overflow: hidden;
  cursor: text;
}
.term-host :deep(.xterm) { height: 100%; }
.term-host :deep(.xterm-viewport) { background: transparent !important; }
</style>
