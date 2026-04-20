<template>
  <div class="page-shell page-shell-wide activity-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">活动追踪</h1>
        <p class="subtitle">实时订阅 Gateway 事件流，展示各会话的消息和工具调用时间线。</p>
      </div>
      <div class="header-actions">
        <span class="status-chip" :class="statusClass">{{ statusText }}</span>
        <button class="btn btn-sm" @click="clearView">清空视图</button>
        <button class="btn btn-sm" @click="reconnect" :disabled="connecting">重连</button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">活跃会话</div>
        <div class="metric-value">{{ sessions.length }}</div>
        <div class="metric-meta">最近有事件推送的会话</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">事件总数</div>
        <div class="metric-value">{{ events.length }}</div>
        <div class="metric-meta">本次会话中显示的事件</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">工具调用</div>
        <div class="metric-value">{{ toolEventCount }}</div>
        <div class="metric-meta">在所有会话中累计</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">最近活动</div>
        <div class="metric-value metric-value-sm">{{ lastEventRelative || '—' }}</div>
        <div class="metric-meta mono">{{ lastEvent?.event || '等待事件…' }}</div>
      </div>
    </div>

    <div class="activity-layout">
      <!-- Sessions panel -->
      <aside class="sessions-panel section-card">
        <div class="section-header">
          <h2 class="section-title">会话列表</h2>
          <p class="section-desc">按 sessionKey 聚合</p>
        </div>
        <div class="session-list">
          <button
            :class="['session-item', { active: !sessionFilter }]"
            @click="sessionFilter = ''"
          >
            <div class="session-top">
              <span class="session-name">所有会话</span>
              <span class="session-count">{{ sessions.length }}</span>
            </div>
            <div class="session-meta">合并展示所有事件</div>
          </button>
          <button
            v-for="s in sessions"
            :key="s.sessionKey"
            :class="['session-item', { active: sessionFilter === s.sessionKey }]"
            @click="sessionFilter = s.sessionKey"
          >
            <div class="session-top">
              <span class="session-name">{{ s.agent }}</span>
              <span class="session-badge">{{ timeAgo(s.lastTs) }}</span>
            </div>
            <div class="session-key mono">{{ shortKey(s.sessionKey) }}</div>
            <div class="session-meta">
              <span>消息 {{ s.messageCount }}</span>
              <span>·</span>
              <span>工具 {{ s.toolCount }}</span>
            </div>
          </button>
          <div v-if="sessions.length === 0" class="session-empty">暂无活跃会话</div>
        </div>
      </aside>

      <!-- Timeline -->
      <section class="timeline-panel section-card">
        <div class="section-head-row">
          <div>
            <h2 class="section-title">时间线</h2>
            <p class="section-desc">
              {{ sessionFilter ? `会话: ${shortKey(sessionFilter)}` : '全部会话' }}
              · {{ filteredEvents.length }} / {{ events.length }} 条事件
            </p>
          </div>
          <label class="follow-switch">
            <input type="checkbox" v-model="followLatest" />
            <span>自动跟随最新</span>
          </label>
        </div>

        <div v-if="filteredEvents.length === 0" class="timeline-empty">
          <p v-if="!connected">等待 Portal 连接 Gateway 事件流…</p>
          <p v-else-if="sessionFilter">所选会话暂无匹配事件</p>
          <p v-else>暂无事件。去 Chat 页跟 Agent 发条消息就能在这里看到。</p>
        </div>

        <ul v-else ref="timelineEl" class="timeline">
          <li
            v-for="e in filteredEvents"
            :key="e.id"
            :class="['timeline-item', classifyEvent(e)]"
          >
            <div class="timeline-dot"></div>
            <div class="timeline-body">
              <div class="timeline-head">
                <span class="timeline-time mono">{{ formatTime(e.ts) }}</span>
                <span class="timeline-event">{{ displayEventName(e) }}</span>
                <span v-if="e.payload?.sessionKey" class="timeline-agent mono">{{ pickAgent(e.payload.sessionKey) }}</span>
              </div>
              <div v-if="describeEvent(e)" class="timeline-desc">{{ describeEvent(e) }}</div>
              <details v-if="hasDetails(e)" class="timeline-details">
                <summary>查看 payload</summary>
                <pre class="timeline-payload">{{ prettyPayload(e.payload) }}</pre>
              </details>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { api } from '../api/client.js'

interface ActivityEvent {
  id: number
  ts: number
  event: string
  payload: any
}

const events = ref<ActivityEvent[]>([])
const sessions = ref<Array<{ sessionKey: string; agent: string; messageCount: number; toolCount: number; lastTs: number; lastEvent: string }>>([])
const sessionFilter = ref('')
const followLatest = ref(true)
const connected = ref(false)
const connecting = ref(false)
const timelineEl = ref<HTMLElement | null>(null)

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const statusText = computed(() => connecting.value ? '连接中…' : connected.value ? '实时' : '已断开')
const statusClass = computed(() => ({
  'ok':   connected.value && !connecting.value,
  'wait': connecting.value,
  'off':  !connected.value && !connecting.value,
}))

const filteredEvents = computed(() => {
  const arr = sessionFilter.value
    ? events.value.filter(e => e.payload?.sessionKey === sessionFilter.value)
    : events.value
  return arr
})

const lastEvent = computed(() => events.value[events.value.length - 1])
const lastEventRelative = computed(() => lastEvent.value ? timeAgo(lastEvent.value.ts) : '')
const toolEventCount = computed(() =>
  sessions.value.reduce((s, x) => s + x.toolCount, 0),
)

function pickAgent(sessionKey: string): string {
  const m = sessionKey?.match(/^agent:([^:]+)/)
  return m ? m[1] : (sessionKey || '—')
}
function shortKey(sk: string): string {
  if (!sk) return ''
  return sk.length > 40 ? sk.slice(0, 20) + '…' + sk.slice(-15) : sk
}
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`
  return `${Math.floor(s / 86400)}d 前`
}

function classifyEvent(e: ActivityEvent): string {
  const ev = e.event
  const st = e.payload?.state
  if (ev === 'chat' && st === 'userMessage') return 'evt-user'
  if (ev === 'chat' && st === 'assistantMessage') return 'evt-assistant'
  if (ev === 'chat' && typeof st === 'string' && st.startsWith('tool')) return 'evt-tool'
  if (ev === 'chat' && st === 'done') return 'evt-done'
  if (ev === 'chat' && st === 'error') return 'evt-error'
  if (ev === 'tool' || ev === 'toolCall' || ev === 'toolResult') return 'evt-tool'
  if (ev === 'error') return 'evt-error'
  return 'evt-default'
}

function displayEventName(e: ActivityEvent): string {
  const ev = e.event
  const st = e.payload?.state
  if (ev === 'chat' && st) return `chat · ${st}`
  return ev
}

function describeEvent(e: ActivityEvent): string {
  const p = e.payload
  if (!p) return ''
  // Short human-readable summary without dumping full payload
  if (p.text && typeof p.text === 'string') return truncate(p.text, 160)
  if (p.message && typeof p.message === 'string') return truncate(p.message, 160)
  if (p.toolName) {
    const args = p.arguments ? ` (${JSON.stringify(p.arguments).slice(0, 80)})` : ''
    return `${p.toolName}${args}`
  }
  if (p.tool && typeof p.tool === 'string') return p.tool
  return ''
}
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }

function hasDetails(e: ActivityEvent): boolean {
  return !!e.payload && Object.keys(e.payload).length > 0
}
function prettyPayload(p: any): string {
  try { return JSON.stringify(p, null, 2) } catch { return String(p) }
}

function addEvent(e: ActivityEvent) {
  events.value.push(e)
  if (events.value.length > 500) events.value.splice(0, events.value.length - 500)
  updateSessions()
}

function updateSessions() {
  // Rebuild from in-memory events
  const map = new Map<string, typeof sessions.value[number]>()
  for (const e of events.value) {
    const sk = e.payload?.sessionKey
    if (!sk) continue
    const agent = pickAgent(sk)
    const existing = map.get(sk) ?? { sessionKey: sk, agent, messageCount: 0, toolCount: 0, lastTs: 0, lastEvent: '' }
    existing.lastTs = e.ts
    existing.lastEvent = e.event
    const st = e.payload?.state
    if (e.event === 'chat' && (st === 'userMessage' || st === 'assistantMessage')) existing.messageCount += 1
    if (e.event === 'chat' && typeof st === 'string' && st.startsWith('tool')) existing.toolCount += 1
    if (e.event === 'tool' || e.event === 'toolCall' || e.event === 'toolResult') existing.toolCount += 1
    map.set(sk, existing)
  }
  sessions.value = [...map.values()].sort((a, b) => b.lastTs - a.lastTs)
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  connecting.value = true
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}${base}/api/activity/ws`)
  ws.addEventListener('open', () => {
    connecting.value = false
    connected.value = true
  })
  ws.addEventListener('close', () => {
    connecting.value = false
    connected.value = false
    // Auto-reconnect after short delay
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 2500)
    }
  })
  ws.addEventListener('error', () => {
    connecting.value = false
    connected.value = false
  })
  ws.addEventListener('message', (ev) => {
    let msg: any
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type === 'snapshot') {
      events.value = msg.entries || []
      sessions.value = msg.sessions || []
    } else if (msg.type === 'activity' && msg.data) {
      addEvent(msg.data)
    }
  })
}

function reconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  try { ws?.close() } catch {}
  ws = null
  connect()
}

function clearView() {
  events.value = []
  sessions.value = []
}

watch(filteredEvents, async () => {
  if (!followLatest.value) return
  await nextTick()
  if (timelineEl.value) timelineEl.value.scrollTop = timelineEl.value.scrollHeight
})

onMounted(async () => {
  // Fetch initial buffer via HTTP (fast), then attach WS for live updates
  try {
    const res = await api.activity.recent({ limit: 100 })
    events.value = res.entries
    updateSessions()
  } catch {}
  connect()
})

onBeforeUnmount(() => {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  try { ws?.close() } catch {}
})
</script>

<style scoped>
.activity-page { display: flex; flex-direction: column; gap: var(--space-4); min-height: 0; height: 100%; }

.metric-value-sm { font-size: var(--text-lg); font-weight: 720; color: var(--text-primary); }

.status-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.status-chip.ok   { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; }
.status-chip.wait { background: color-mix(in srgb, #f59e0b 15%, transparent); color: var(--warn-text); }
.status-chip.off  { background: color-mix(in srgb, #ef4444 15%, transparent); color: var(--error-text); }

/* ── Layout: left sessions, right timeline ──────────────────── */
.activity-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: var(--space-4);
  min-height: 0;
  flex: 1;
}
@media (max-width: 900px) {
  .activity-layout { grid-template-columns: 1fr; }
}

.sessions-panel { overflow: hidden; display: flex; flex-direction: column; }
.session-list {
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto;
  max-height: 640px;
}
.session-item {
  text-align: left;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.session-item:hover { background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); }
.session-item.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }
.session-top { display: flex; justify-content: space-between; align-items: center; }
.session-name { font-weight: 600; font-size: 13px; color: var(--text-primary); }
.session-badge, .session-count { font-size: 10px; color: var(--text-muted); }
.session-count { background: var(--surface-1); padding: 1px 6px; border-radius: 8px; }
.session-key { font-size: 10px; color: var(--text-muted); word-break: break-all; }
.session-meta { display: flex; gap: 6px; font-size: 10px; color: var(--text-muted); }
.session-empty { padding: 20px 0; text-align: center; color: var(--text-muted); font-size: 12px; }

/* ── Timeline ───────────────────────────────────────────────── */
.timeline-panel { display: flex; flex-direction: column; overflow: hidden; }

.follow-switch {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-muted);
  cursor: pointer;
}
.follow-switch input { cursor: pointer; }

.timeline-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 13px; }

.timeline {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 300px;
}
.timeline-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--border) 40%, transparent);
  position: relative;
}
.timeline-item:last-child { border-bottom: none; }

.timeline-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent);
  margin-top: 6px;
  flex-shrink: 0;
}
.evt-user .timeline-dot      { background: #6366f1; }
.evt-assistant .timeline-dot { background: #10b981; }
.evt-tool .timeline-dot      { background: #f59e0b; }
.evt-done .timeline-dot      { background: #06b6d4; }
.evt-error .timeline-dot     { background: #ef4444; }
.evt-default .timeline-dot   { background: var(--accent); }

.timeline-body { flex: 1; min-width: 0; }
.timeline-head {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
}
.timeline-time { font-size: 11px; color: var(--text-muted); }
.timeline-event {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}
.evt-user .timeline-event      { background: color-mix(in srgb, #6366f1 12%, transparent); color: #6366f1; }
.evt-assistant .timeline-event { background: color-mix(in srgb, #10b981 12%, transparent); color: #10b981; }
.evt-tool .timeline-event      { background: color-mix(in srgb, #f59e0b 12%, transparent); color: var(--warn-text); }
.evt-error .timeline-event     { background: color-mix(in srgb, #ef4444 12%, transparent); color: var(--error-text); }
.timeline-agent { font-size: 10px; color: var(--text-muted); }
.timeline-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.timeline-details {
  margin-top: 6px;
  font-size: 11px;
}
.timeline-details summary {
  cursor: pointer;
  color: var(--text-muted);
  user-select: none;
}
.timeline-payload {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-x: auto;
  max-height: 240px;
  overflow-y: auto;
  color: var(--text-primary);
}
</style>
