<template>
  <div class="notif-root" @click.stop>
    <button
      :class="['notif-btn', { 'has-unread': unread > 0 }]"
      @click="toggleOpen"
      :title="unread > 0 ? `${unread} 条未读通知` : '通知中心'"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
      </svg>
      <span v-if="unread > 0" class="notif-count">{{ unread > 99 ? '99+' : unread }}</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="notif-backdrop" @click="close"></div>
      <Transition name="notif-fade">
        <div v-if="open" class="notif-panel" ref="panelEl" @click.stop>
          <div class="notif-head">
            <div class="notif-head-title">通知中心</div>
            <div class="notif-head-actions">
              <button v-if="unread > 0" class="notif-link" @click="markAllRead">全部标记为已读</button>
              <button class="notif-link" @click="refresh" :disabled="loading">{{ loading ? '…' : '刷新' }}</button>
            </div>
          </div>

          <div v-if="loading && !items.length" class="notif-empty">加载中…</div>
          <div v-else-if="items.length === 0" class="notif-empty">
            <div class="notif-empty-icon">✨</div>
            <div>一切正常，无未读通知</div>
          </div>
          <div v-else class="notif-list">
            <div
              v-for="it in visibleItems"
              :key="it.id"
              :class="['notif-item', it.severity, { unread: isUnread(it) }]"
              @click="onClick(it)"
            >
              <div class="notif-item-icon">{{ severityEmoji(it.severity, it.type) }}</div>
              <div class="notif-item-body">
                <div class="notif-item-title">{{ it.title }}</div>
                <div class="notif-item-msg">{{ it.message }}</div>
                <div class="notif-item-time">{{ relTime(it.ts) }}</div>
              </div>
              <button
                class="notif-dismiss"
                @click.stop="dismiss(it)"
                title="标记为已处理，不再显示"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="notif-foot">
            <span class="notif-foot-hint">显示最近 24h 审计失败、1h 网关错误、服务状态</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client.js'

const router = useRouter()
const open = ref(false)
const loading = ref(false)
const items = ref<any[]>([])
const lastReadAt = ref<number>(loadLastRead())
const panelEl = ref<HTMLElement | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

// Dismissed notifications are hidden locally (not sent to the server — they're
// just "I've seen this, don't show me again"). Cleaned up after 7 days so
// ids that may legitimately recur aren't suppressed forever.
const DISMISS_KEY = 'portal.notif.dismissed'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const dismissedIds = ref<Set<string>>(loadDismissed())

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return new Set()
    const arr: Array<{ id: string; ts: number }> = JSON.parse(raw)
    const now = Date.now()
    const fresh = arr.filter(e => now - e.ts < DISMISS_TTL_MS)
    if (fresh.length !== arr.length) {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(fresh))
    }
    return new Set(fresh.map(e => e.id))
  } catch { return new Set() }
}

function persistDismissed(id: string) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    const arr: Array<{ id: string; ts: number }> = raw ? JSON.parse(raw) : []
    if (!arr.find(e => e.id === id)) arr.push({ id, ts: Date.now() })
    localStorage.setItem(DISMISS_KEY, JSON.stringify(arr))
  } catch {}
}

function dismiss(it: any) {
  dismissedIds.value.add(it.id)
  dismissedIds.value = new Set(dismissedIds.value)  // trigger reactivity
  persistDismissed(it.id)
}

const visibleItems = computed(() => items.value.filter(it => !dismissedIds.value.has(it.id)))
const unread = computed(() => visibleItems.value.filter(isUnread).length)

function isUnread(it: any): boolean {
  return it.ts > lastReadAt.value
}

function loadLastRead(): number {
  try {
    const v = localStorage.getItem('portal.notif.lastReadAt')
    return v ? parseInt(v, 10) || 0 : 0
  } catch { return 0 }
}
function persistLastRead(ts: number) {
  try { localStorage.setItem('portal.notif.lastReadAt', String(ts)) } catch {}
}

function markAllRead() {
  const maxTs = visibleItems.value.reduce((m, it) => Math.max(m, it.ts), lastReadAt.value)
  lastReadAt.value = maxTs
  persistLastRead(maxTs)
}

async function refresh() {
  loading.value = true
  try {
    const res = await api.notifications.list()
    items.value = res.items
  } catch {
    // silent — notification center should never block UI
  } finally {
    loading.value = false
  }
}

async function toggleOpen() {
  if (open.value) { close(); return }
  open.value = true
  await refresh()
  await nextTick()
}

function close() {
  open.value = false
}

function onClick(it: any) {
  if (it.link) {
    // Mark items of the same type read up to this ts
    lastReadAt.value = Math.max(lastReadAt.value, it.ts)
    persistLastRead(lastReadAt.value)
    router.push(it.link)
  }
  close()
}

function relTime(ts: number): string {
  const d = Math.max(0, Date.now() - ts)
  const s = Math.floor(d / 1000)
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`
  return `${Math.floor(s / 86400)}d 前`
}

function severityEmoji(severity: string, type: string): string {
  if (type === 'service-error') return '🔴'
  if (type === 'memory-warn') return '💾'
  if (type === 'audit-failure') return '🛡️'
  if (type === 'log-error') return '⚠️'
  if (type === 'cron-failure') return '⏰'
  return severity === 'error' ? '🔴' : '⚠️'
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

onMounted(() => {
  refresh()
  pollTimer = setInterval(refresh, 30_000)
  window.addEventListener('keydown', handleEscape)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('keydown', handleEscape)
})
</script>

<style scoped>
.notif-root { display: inline-flex; position: relative; }

.notif-btn {
  position: relative;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  color: rgba(255,255,255,0.60);
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.notif-btn:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.9);
  border-color: rgba(255,255,255,0.18);
}
.notif-btn.has-unread {
  background: color-mix(in srgb, #ef4444 20%, transparent);
  color: #fff;
  border-color: color-mix(in srgb, #ef4444 50%, transparent);
  animation: notif-pulse 2s ease-in-out infinite;
}
.notif-btn.has-unread:hover {
  background: color-mix(in srgb, #ef4444 30%, transparent);
}
@keyframes notif-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50%      { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
}

.notif-count {
  font-size: 10px;
  font-weight: 700;
  min-width: 14px;
  text-align: center;
  line-height: 14px;
  color: currentColor;
}

.notif-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.notif-panel {
  /* Fixed to bottom-left, anchored to where the sidebar ends.
     Sidebar is 256px wide; panel pops up-and-right from the bell. */
  position: fixed;
  left: 264px;
  bottom: 56px;
  width: 360px;
  max-height: 520px;
  max-width: calc(100vw - 280px);
  background: var(--bg-solid);
  background-image: var(--card-fill);
  border: 1px solid var(--card-border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Small viewport: stack on top */
@media (max-width: 768px) {
  .notif-panel {
    left: 12px;
    right: 12px;
    width: auto;
    bottom: 70px;
  }
}

.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.notif-head-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.notif-head-actions { display: flex; gap: 10px; }
.notif-link {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  color: var(--accent);
}
.notif-link:hover { text-decoration: underline; }
.notif-link:disabled { opacity: 0.5; cursor: not-allowed; }

.notif-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
.notif-empty-icon { font-size: 28px; margin-bottom: 8px; opacity: 0.5; }

.notif-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.notif-item {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  cursor: pointer;
  transition: background 0.1s ease;
  position: relative;
}
.notif-item:hover { background: var(--ghost-hover-bg); }
.notif-item:last-child { border-bottom: none; }
.notif-item.unread::before {
  content: '';
  position: absolute;
  left: 4px; top: 50%;
  transform: translateY(-50%);
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.notif-dismiss {
  align-self: flex-start;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.notif-item:hover .notif-dismiss { opacity: 1; }
.notif-dismiss:hover {
  background: var(--surface-2);
  color: var(--text-primary);
}

.notif-item-icon { font-size: 16px; line-height: 1.3; flex-shrink: 0; }
.notif-item-body { flex: 1; min-width: 0; }
.notif-item-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-item.error .notif-item-title { color: var(--error-text); }
.notif-item-msg {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.notif-item-time {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 3px;
  font-family: var(--font-mono);
}

.notif-foot {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.notif-foot-hint { font-size: 10px; color: var(--text-muted); }

.notif-fade-enter-active,
.notif-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.notif-fade-enter-from,
.notif-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
