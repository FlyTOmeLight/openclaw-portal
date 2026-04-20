<template>
  <div class="dashboard page-shell">
    <div class="page-header dashboard-header">
      <div>
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="subtitle">OpenClaw 服务状态总览，集中查看网关、模型、渠道和最近日志。</p>
      </div>
      <div class="header-actions">
        <RouterLink to="/logs">
          <n-button size="small">查看日志</n-button>
        </RouterLink>
        <n-button size="small" @click="poll" :loading="refreshing">刷新概览</n-button>
      </div>
    </div>

    <HealthScoreCard />

    <div class="metric-grid stagger-in">
      <div class="metric-card dashboard-metric card-accent-top card-green">
        <div class="metric-top">
          <span class="metric-label">网关</span>
          <span class="status-dot" :class="svc.state"></span>
        </div>
        <div class="metric-value dashboard-metric-copy">{{ svc.state === 'running' ? '运行中' : svc.state === 'restarting' ? '重启中…' : '已停止' }}</div>
        <div class="metric-meta">{{ svc.pid ? 'PID: ' + svc.pid : '未启动' }}</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top">
        <div class="metric-label">主模型</div>
        <div class="metric-value dashboard-metric-copy">{{ primaryModelName || '未配置' }}</div>
        <div class="metric-meta">{{ providerCount }} 个 Provider</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top card-sky">
        <div class="metric-label">Agent 数量</div>
        <div class="metric-value" :class="{ 'loading-placeholder': initialLoading }">{{ initialLoading ? '—' : agents.length }}</div>
        <div class="metric-meta">默认: {{ defaultAgentName }}</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top card-amber">
        <div class="metric-label">已启用渠道</div>
        <div class="metric-value" :class="{ 'loading-placeholder': initialLoading }">{{ initialLoading ? '—' : channelCount }}</div>
        <div class="metric-meta">已接入消息渠道</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top card-purple">
        <div class="metric-label">内存使用</div>
        <div class="metric-value">{{ memUsed }}%</div>
        <div class="metric-meta">{{ memFree }} MB 可用 / {{ memTotal }} MB</div>
        <div class="stat-mini-bar">
          <div class="stat-mini-bar-fill"
            :style="{ width: memUsed + '%', background: memUsed > 85 ? 'var(--error-text)' : memUsed > 65 ? '#f59e0b' : '#8b5cf6' }">
          </div>
        </div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top card-slate">
        <div class="metric-label">系统运行时间</div>
        <div class="metric-value dashboard-metric-copy">{{ uptimeText }}</div>
        <div class="metric-meta">{{ platform }} · {{ cpuCount }} 核</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top card-teal">
        <div class="metric-label">今日 Token</div>
        <div class="metric-value dashboard-metric-copy">{{ formatNum(todayTokens) }}</div>
        <div class="metric-meta">日均 {{ formatNum(avgTokens) }} · 近 30 天</div>
      </div>

      <div class="metric-card dashboard-metric card-accent-top" :class="last1hErrorCount > 0 ? 'card-rose' : 'card-green'">
        <div class="metric-label">最近 1 小时错误</div>
        <div class="metric-value dashboard-metric-copy">{{ last1hErrorCount }}</div>
        <div class="metric-meta">{{ last1hErrorCount > 0 ? '点击查看日志定位问题' : '系统健康' }}</div>
      </div>
    </div>

    <section class="section-card dashboard-section">
      <div class="section-header">
        <div class="section-head-row">
          <div>
            <h2 class="section-title">实时观测</h2>
            <p class="section-desc">Token 趋势、最近敏感操作、错误摘要，一屏看完关键动态。</p>
          </div>
        </div>
      </div>
      <div class="observability-grid">
        <!-- Token 趋势 sparkline -->
        <div class="obs-panel">
          <div class="obs-head">
            <span class="obs-title">Token 用量趋势</span>
            <RouterLink to="/usage" class="obs-link">详情 ›</RouterLink>
          </div>
          <div class="obs-metric-row">
            <span class="obs-metric-value">{{ formatNum(last7dTokens) }}</span>
            <span class="obs-metric-label">近 7 天</span>
            <span class="obs-cost">≈ ¥{{ last7dCost.toFixed(2) }}</span>
          </div>
          <svg v-if="sparkPath" class="sparkline" viewBox="0 0 200 60" preserveAspectRatio="none">
            <path :d="sparkAreaPath" fill="var(--accent)" fill-opacity="0.12" />
            <path :d="sparkPath" fill="none" stroke="var(--accent)" stroke-width="1.5" />
          </svg>
          <div v-else class="obs-empty">暂无数据</div>
        </div>

        <!-- 最近审计 -->
        <div class="obs-panel">
          <div class="obs-head">
            <span class="obs-title">最近敏感操作</span>
            <RouterLink to="/audit" class="obs-link">详情 ›</RouterLink>
          </div>
          <ul v-if="recentAudits.length" class="obs-list">
            <li v-for="(a, i) in recentAudits" :key="i" class="obs-item">
              <span class="obs-item-time">{{ timeAgo(a.ts) }}</span>
              <span class="obs-item-action">{{ a.action }}</span>
              <span class="obs-item-target mono">{{ a.target || '—' }}</span>
              <span :class="['obs-item-dot', a.result === 'success' ? 'dot-ok' : 'dot-fail']"></span>
            </li>
          </ul>
          <div v-else class="obs-empty">暂无审计记录</div>
        </div>

        <!-- 错误日志 -->
        <div class="obs-panel">
          <div class="obs-head">
            <span class="obs-title">最近错误</span>
            <RouterLink to="/logs" class="obs-link">详情 ›</RouterLink>
          </div>
          <ul v-if="recentErrors.length" class="obs-list">
            <li v-for="(e, i) in recentErrors" :key="i" class="obs-item obs-item-error">
              <span class="obs-item-time">{{ timeAgo(e.ts) }}</span>
              <span class="obs-item-msg" :title="e.msg || e.raw">{{ e.msg || e.raw }}</span>
            </li>
          </ul>
          <div v-else class="obs-empty">无错误日志</div>
        </div>
      </div>
    </section>

    <section class="section-card dashboard-section">
      <div class="section-header">
        <div class="section-head-row">
          <div>
            <h2 class="section-title">快捷入口</h2>
            <p class="section-desc">将最常用的配置和运维入口保持在同一组卡片语言里，减少页面跳转成本。</p>
          </div>
          <div class="section-actions">
            <RouterLink to="/chat">
              <n-button type="primary" size="small">进入对话</n-button>
            </RouterLink>
          </div>
        </div>
      </div>

      <div class="overview-grid stagger-in">
      <!-- Gateway -->
      <div class="overview-card">
        <div class="overview-card-icon" :style="{ color: svc.state === 'running' ? 'var(--accent)' : 'var(--text-muted)' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">网关服务</div>
          <div class="overview-card-value"
            :style="{ color: svc.state === 'running' ? 'var(--success-text, #166534)' : svc.state === 'restarting' ? '#d97706' : 'var(--error-text)' }">
            {{ svc.state === 'running' ? '运行中' : svc.state === 'restarting' ? '重启中…' : '已停止' }}
          </div>
          <div class="overview-card-meta">端口 {{ gatewayPort }}{{ svc.pid ? ' · PID ' + svc.pid : '' }}</div>
        </div>
        <div class="overview-card-actions">
          <template v-if="svc.state !== 'running'">
            <n-button type="primary" size="tiny" @click="startService" :disabled="svc.loading">启动</n-button>
          </template>
          <template v-else>
            <n-button type="error" size="tiny" @click="stopService" :disabled="svc.loading">停止</n-button>
            <n-button size="tiny" @click="restartService" :disabled="svc.loading">重启</n-button>
          </template>
        </div>
      </div>

      <!-- Primary model -->
      <RouterLink to="/models" class="overview-card overview-card-link">
        <div class="overview-card-icon" style="color: var(--accent)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">主模型</div>
          <div class="overview-card-value overview-value-sm">{{ primaryModelName || '未配置' }}</div>
          <div class="overview-card-meta">{{ modelCount }} 个模型 · {{ providerCount }} 个 Provider</div>
        </div>
      </RouterLink>

      <!-- Agents -->
      <RouterLink to="/agents" class="overview-card overview-card-link">
        <div class="overview-card-icon" style="color: #10b981">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">Agent 舰队</div>
          <div class="overview-card-value" :class="{ 'loading-placeholder': initialLoading }">{{ initialLoading ? '—' : agents.length }}</div>
          <div class="overview-card-meta">默认: {{ defaultAgentName }}</div>
        </div>
      </RouterLink>

      <!-- Channels -->
      <RouterLink to="/channels" class="overview-card overview-card-link">
        <div class="overview-card-icon" style="color: var(--warn-text)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">接入渠道</div>
          <div class="overview-card-value" :class="{ 'loading-placeholder': initialLoading }">{{ initialLoading ? '—' : channelCount }}</div>
          <div class="overview-card-meta">已启用 Channel</div>
        </div>
      </RouterLink>

      <!-- Memory -->
      <div class="overview-card">
        <div class="overview-card-icon" style="color: #8b5cf6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <path d="M6 6V4M10 6V4M14 6V4M18 6V4M6 18v2M10 18v2M14 18v2M18 18v2"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">内存使用</div>
          <div class="overview-card-value">{{ memUsed }}%</div>
          <div class="overview-card-meta">{{ memFree }} MB 可用 / {{ memTotal }} MB</div>
          <div class="overview-progress">
            <div class="overview-progress-fill"
              :style="{ width: memUsed + '%', background: memUsed > 85 ? 'var(--error-text)' : memUsed > 65 ? '#f59e0b' : '#10b981' }">
            </div>
          </div>
        </div>
      </div>

      <!-- Chat entry -->
      <RouterLink to="/chat" class="overview-card overview-card-link overview-card-accent">
        <div class="overview-card-icon" style="color: var(--accent)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div class="overview-card-body">
          <div class="overview-card-title">开始对话</div>
          <div class="overview-card-value overview-value-sm">{{ svc.state === 'running' ? '网关在线，立即聊天' : '网关未启动' }}</div>
          <div class="overview-card-meta">进入聊天界面 →</div>
        </div>
      </RouterLink>
      </div>
    </section>

    <section class="log-section section-card">
      <div class="section-head-row log-section-header">
        <div>
          <h2 class="section-title">最近日志</h2>
          <p class="section-desc">保留最近 15 条输出，便于先看概况，再进入完整日志页深入排查。</p>
        </div>
        <RouterLink to="/logs" class="log-more-link">查看全部</RouterLink>
      </div>
      <div v-if="recentLogs.length === 0" class="log-empty">暂无日志</div>
      <div v-else class="log-viewer">
        <div v-for="(entry, i) in recentLogs" :key="i" class="log-line" :class="entry.level">
          <span class="log-ts">{{ formatTs(entry.ts) }}</span>
          <span class="log-level-badge" :class="entry.level">{{ entry.level }}</span>
          <span class="log-msg">{{ entry.msg }}</span>
        </div>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton } from 'naive-ui'
import { useServiceStore } from '../stores/service.js'
import { useSystemStore } from '../stores/system.js'
import { useModelsStore } from '../stores/models.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'
import { useServiceSocket } from '../composables/useServiceSocket.js'
import { api } from '../api/client.js'
import HealthScoreCard from '../components/HealthScoreCard.vue'

const svc = useServiceStore()
const sys = useSystemStore()
const models = useModelsStore()
const toast = useNaiveToast()

useServiceSocket()

const agents = ref<any[]>([])
const recentLogs = ref<any[]>([])
const initialLoading = ref(true)
const refreshing = ref(false)

// ── Observability aggregates ───────────────────────────────────────────────
const usageDaily = ref<any[]>([])
const usageSummary = ref<any>(null)
const recentAudits = ref<any[]>([])
const recentErrors = ref<any[]>([])

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6)  return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})

// Derived system stats
const memUsed = computed(() => sys.stats?.system?.memory?.usedPercent ?? 0)
const memFree = computed(() => sys.stats?.system?.memory?.freeMb ?? 0)
const memTotal = computed(() => sys.stats?.system?.memory?.totalMb ?? 0)
const cpuCount = computed(() => sys.stats?.system?.cpuCount ?? 0)
const platform = computed(() => sys.stats?.system?.platform ?? '')
const channelCount = computed(() => sys.stats?.channelCount ?? 0)
const gatewayPort = computed(() => 18789)

const uptimeText = computed(() => {
  const s = sys.stats?.system?.uptimeSeconds ?? 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
})

// Models
const primaryModelName = computed(() => {
  const p = models.primary
  if (!p) return ''
  // primary is "providerId/modelId" — extract provider then get model name
  const slashIdx = p.indexOf('/')
  if (slashIdx < 0) return p
  const providerId = p.slice(0, slashIdx)
  const modelId = p.slice(slashIdx + 1)
  const provider = models.providers[providerId]
  const m = provider?.models?.find((x: any) => x.id === modelId)
  return m?.name || modelId
})

const providerCount = computed(() => Object.keys(models.providers).length)
const modelCount = computed(() =>
  Object.values(models.providers).reduce((acc: number, p: any) => acc + (p.models?.length ?? 0), 0)
)

// Agents
const todayTokens = computed(() => {
  if (!usageDaily.value.length) return 0
  const today = new Date().toISOString().slice(0, 10)
  const row = usageDaily.value.find((d: any) => d.date === today)
  return row ? row.totalTokens : 0
})
const avgTokens = computed(() => usageSummary.value?.dailyAvgTokens ?? 0)
const last7dTokens = computed(() => {
  const last7 = usageDaily.value.slice(-7)
  return last7.reduce((s: number, d: any) => s + (d.totalTokens || 0), 0)
})
const last7dCost = computed(() => {
  const last7 = usageDaily.value.slice(-7)
  return last7.reduce((s: number, d: any) => s + (d.cost || 0), 0)
})
const last1hErrorCount = computed(() => {
  const cutoff = Date.now() - 60 * 60 * 1000
  return recentLogs.value.filter((l: any) => l.level === 'error' && l.ts >= cutoff).length
})

// Build sparkline path from last 14 days of totalTokens
const sparkPath = computed(() => {
  const series = usageDaily.value.slice(-14).map((d: any) => d.totalTokens || 0)
  if (series.length < 2) return ''
  const max = Math.max(...series, 1)
  const w = 200, h = 60
  const step = w / (series.length - 1)
  return series.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * (h - 6) - 3).toFixed(1)}`).join(' ')
})
const sparkAreaPath = computed(() => {
  if (!sparkPath.value) return ''
  const series = usageDaily.value.slice(-14)
  const w = 200, h = 60
  const step = w / (series.length - 1)
  return `${sparkPath.value} L${((series.length - 1) * step).toFixed(1)},${h} L0,${h} Z`
})

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const defaultAgentName = computed(() => {
  const main = agents.value.find((a: any) => a.id === 'main')
  return main?.name || 'main'
})

async function startService() {
  await svc.start()
  if (!svc.error) toast.success('服务已启动')
  else toast.error(svc.error)
}

async function stopService() {
  await svc.stop()
  if (!svc.error) toast.success('服务已停止')
  else toast.error(svc.error)
}

async function restartService() {
  await svc.restart()
  if (!svc.error) toast.success('服务已重启')
  else toast.error(svc.error)
}

async function loadLogs() {
  try {
    const r = await api.logs.list({ lines: 20 })
    recentLogs.value = r.entries.slice(-15).reverse()
  } catch {}
}

function formatTs(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

async function loadObservability() {
  await Promise.allSettled([
    api.usage.summary().then(r => { usageSummary.value = r }).catch(() => {}),
    api.usage.daily(30).then(r => { usageDaily.value = r }).catch(() => {}),
    api.audit.list({ limit: 5 }).then(r => { recentAudits.value = r.entries }).catch(() => {}),
    api.logs.list({ lines: 300, level: 'error' }).then(r => { recentErrors.value = (r.entries || []).slice(-5).reverse() }).catch(() => {}),
  ])
}

async function poll() {
  refreshing.value = true
  // Phase 1: fire everything in parallel — don't block stats/models on svc.refresh()
  await Promise.allSettled([
    svc.refresh(),
    sys.load(),
    models.load(),
    loadObservability(),
  ])
  initialLoading.value = false
  refreshing.value = false
  // Phase 2: gateway-dependent data (agents + logs) — only if running
  if (svc.state === 'running') {
    await Promise.allSettled([
      api.agents.list().then(r => { agents.value = r }).catch(() => {}),
      loadLogs(),
    ])
  }
}

let pollTimer: ReturnType<typeof setInterval>

onMounted(() => {
  poll()
  pollTimer = setInterval(poll, 15000)
})

onUnmounted(() => clearInterval(pollTimer))
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.dashboard-metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dashboard-metric-copy {
  font-size: clamp(20px, 3vw, 30px);
  word-break: break-word;
}

.metric-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.running    { background: #22c55e; box-shadow: 0 0 0 2px #22c55e33; animation: pulse-dot 1.4s ease-in-out infinite; }
.status-dot.restarting { background: #fbbf24; box-shadow: 0 0 0 2px #fbbf2433; animation: pulse-dot 0.8s ease-in-out infinite; }
.status-dot.stopped    { background: var(--text-muted); }

.loading-placeholder {
  color: var(--text-muted);
  animation: blink-fade 1s ease-in-out infinite;
}

@keyframes blink-fade {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.stat-mini-bar {
  height: 3px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 6px;
}
.stat-mini-bar-fill { height: 100%; border-radius: 2px; transition: width .4s; }

/* ── Overview grid ── */
.dashboard-section {
  padding: var(--space-5);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

/* ── Observability panels ─────────────────────────────────────────────── */
.observability-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}
.obs-panel {
  background: var(--card-fill-soft);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 180px;
}
.obs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.obs-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.obs-link {
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
}
.obs-link:hover { text-decoration: underline; }
.obs-metric-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.obs-metric-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.obs-metric-label {
  font-size: 11px;
  color: var(--text-muted);
}
.obs-cost {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.sparkline {
  width: 100%;
  height: 60px;
}
.obs-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.obs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
}
.obs-item:last-child { border-bottom: none; }
.obs-item-time {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  min-width: 34px;
}
.obs-item-action {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  padding: 1px 6px;
  border-radius: 10px;
  white-space: nowrap;
}
.obs-item-target {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 11px;
}
.obs-item-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok { background: #10b981; }
.dot-fail { background: #ef4444; }
.obs-item-error .obs-item-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: color-mix(in srgb, #ef4444 85%, var(--text-primary));
  font-size: 11px;
}
.obs-empty {
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
}
.card-teal { --card-accent: #14b8a6; }
.card-rose { --card-accent: #ef4444; }

.overview-card {
  background: var(--card-fill-soft);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  box-shadow: var(--shadow-md);
  transition: transform var(--duration-normal) var(--ease-out), border-color .15s, box-shadow .15s;
}

.overview-card-link {
  text-decoration: none;
  cursor: pointer;
}

.overview-card-link:hover {
  transform: translateY(-2px);
  border-color: rgba(99, 102, 241, 0.2);
  box-shadow: var(--shadow-hover), 0 0 0 1px rgba(99,102,241,0.06);
}

.overview-card-accent {
  border-color: var(--active-border);
  background: var(--accent-subtle);
}

.overview-card-icon {
  flex-shrink: 0;
  margin-top: 2px;
  opacity: .9;
}

.overview-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.overview-card-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted);
}

.overview-card-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.overview-value-sm {
  font-size: 13px;
  font-weight: 600;
  word-break: break-word;
}

.overview-card-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 1px;
}

.overview-card-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  align-self: center;
}

.overview-progress {
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}
.overview-progress-fill { height: 100%; border-radius: 2px; transition: width .4s; }

/* ── Log section ── */
.log-section {
  padding: var(--space-5);
}

.log-section-header {
  margin-bottom: var(--space-3);
}

.log-more-link {
  font-size: var(--text-sm);
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
}

.log-viewer {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
}

.log-empty {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--space-3) 0;
  text-align: center;
}

.log-line {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 2px 4px;
  border-radius: 3px;
  line-height: 1.5;
}
.log-line:hover { background: var(--tint-weak); }
.log-line.error { background: var(--error-bg); }
.log-line.warn  { background: rgba(181,127,16,0.06); }

.log-ts {
  color: var(--text-muted);
  flex-shrink: 0;
}

.log-level-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  letter-spacing: .04em;
}
.log-level-badge.info  { background: rgba(99,102,241,0.1); color: var(--accent); }
.log-level-badge.warn  { background: var(--warn-bg); color: var(--warn-text); }
.log-level-badge.error { background: var(--error-bg); color: var(--error-text); }
.log-level-badge.debug { background: var(--tint-medium); color: var(--text-muted); }
.log-level-badge.trace { background: var(--tint-medium); color: var(--text-muted); }
.log-level-badge.fatal { background: var(--error-bg); color: var(--error-text); font-weight: 900; }

.log-msg {
  color: var(--text-secondary);
  word-break: break-all;
  flex: 1;
}

/* ── Buttons ── */
.btn-secondary { background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { border-color: rgba(99,102,241,0.24); color: var(--accent); }

/* ── Command log section ── */
.cmd-log-section {
  padding: var(--space-5);
}

.cmd-log-header {
  margin-bottom: var(--space-3);
}

.cmd-log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
}

.cmd-log-row {
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--card-fill-soft);
  border: 1px solid transparent;
}
.cmd-log-row.cmd-error {
  background: var(--error-bg, var(--error-bg));
  border-color: var(--error-bg);
}
.cmd-log-row:hover { border-color: var(--border); }

.cmd-log-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.cmd-log-ts {
  color: var(--text-muted);
  flex-shrink: 0;
}

.cmd-log-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.cmd-log-badge.ok  { background: var(--success-bg); color: var(--success-text); }
.cmd-log-badge.err { background: var(--error-bg); color: var(--error-text); }

.cmd-log-dur {
  color: var(--text-muted);
  flex-shrink: 0;
}

.cmd-log-cmd {
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.cmd-log-stderr {
  margin-top: 4px;
  color: var(--error-text);
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 10px;
  padding-left: 4px;
  border-left: 2px solid var(--error-text);
  opacity: 0.8;
}
</style>
