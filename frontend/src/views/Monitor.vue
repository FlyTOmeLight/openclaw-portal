<template>
  <div class="monitor page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">系统监控</h1>
        <p class="subtitle">实时查看主机资源占用，每 5 秒自动刷新。</p>
      </div>
      <div class="header-actions">
        <span class="refresh-hint">自动刷新中</span>
        <n-button size="small" @click="load">立即刷新</n-button>
      </div>
    </div>

    <div class="metric-grid">
      <!-- CPU Load -->
      <div class="metric-card">
        <div class="metric-label">CPU 负载均值</div>
        <div class="load-row">
          <div class="load-item">
            <span class="load-val">{{ stats?.system?.loadAvg?.[0]?.toFixed(2) ?? '—' }}</span>
            <span class="load-period">1分钟</span>
          </div>
          <div class="load-item">
            <span class="load-val">{{ stats?.system?.loadAvg?.[1]?.toFixed(2) ?? '—' }}</span>
            <span class="load-period">5分钟</span>
          </div>
          <div class="load-item">
            <span class="load-val">{{ stats?.system?.loadAvg?.[2]?.toFixed(2) ?? '—' }}</span>
            <span class="load-period">15分钟</span>
          </div>
        </div>
        <div class="metric-meta">{{ cpuCount }} 核 · 负载 > 核数表示繁忙</div>
        <div class="gauge-bar">
          <div class="gauge-fill" :style="cpuGaugeStyle"></div>
        </div>
      </div>

      <!-- Memory -->
      <div class="metric-card">
        <div class="metric-label">内存使用</div>
        <div class="metric-value">{{ memUsed }}%</div>
        <div class="metric-meta">
          已用 {{ memUsedMb }} MB / 总计 {{ memTotal }} MB（{{ memFree }} MB 可用）
        </div>
        <div class="gauge-bar">
          <div class="gauge-fill" :style="memGaugeStyle"></div>
        </div>
      </div>

      <!-- Disk -->
      <div class="metric-card" v-if="stats?.system?.disk">
        <div class="metric-label">磁盘使用</div>
        <div class="metric-value">{{ stats.system.disk.usedPercent }}%</div>
        <div class="metric-meta">
          可用 {{ stats.system.disk.freeGb }} GB / 总计 {{ stats.system.disk.totalGb }} GB
          <span class="mount-tag">{{ stats.system.disk.mountPoint }}</span>
        </div>
        <div class="gauge-bar">
          <div class="gauge-fill" :style="diskGaugeStyle"></div>
        </div>
      </div>

      <!-- Uptime -->
      <div class="metric-card">
        <div class="metric-label">系统运行时间</div>
        <div class="metric-value metric-value-sm">{{ uptimeText }}</div>
        <div class="metric-meta">{{ platform }}</div>
      </div>

      <!-- Gateway -->
      <div class="metric-card">
        <div class="metric-top">
          <span class="metric-label">Gateway 进程</span>
          <span class="status-dot" :class="gwState"></span>
        </div>
        <div class="metric-value metric-value-sm">{{ gwState === 'running' ? '运行中' : '已停止' }}</div>
        <div class="metric-meta">{{ stats?.service?.pid ? 'PID: ' + stats.service.pid : '未启动' }}</div>
      </div>

      <!-- Channel count -->
      <div class="metric-card">
        <div class="metric-label">已启用渠道</div>
        <div class="metric-value">{{ stats?.channelCount ?? 0 }}</div>
        <div class="metric-meta">已接入消息渠道</div>
      </div>
    </div>

    <!-- History chart (load avg sparkline) -->
    <section class="section-card chart-section">
      <div class="section-header">
        <h2 class="section-title">负载历史（1 分钟均值）</h2>
        <p class="section-desc">最近 {{ history.length }} 次采样，每 5 秒一次。</p>
      </div>
      <div class="sparkline-wrap">
        <svg class="sparkline" :viewBox="`0 0 ${sparkW} ${sparkH}`" preserveAspectRatio="none">
          <defs>
            <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <path v-if="areaPath" :d="areaPath" fill="url(#spark-grad)"/>
          <path v-if="linePath" :d="linePath" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
        </svg>
        <div class="sparkline-labels">
          <span class="spark-label-max">{{ sparkMax.toFixed(2) }}</span>
          <span class="spark-label-zero">0</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { NButton } from 'naive-ui'
import { api } from '../api/client.js'

type Stats = Awaited<ReturnType<typeof api.system.stats>>

const stats = ref<Stats | null>(null)
const history = ref<number[]>([])

const sparkW = 600
const sparkH = 80
const MAX_HISTORY = 60

// ── Computed ──────────────────────────────────────────────────────────────────

const cpuCount = computed(() => stats.value?.system?.cpuCount ?? 1)

const memUsed = computed(() => stats.value?.system?.memory?.usedPercent ?? 0)
const memFree = computed(() => stats.value?.system?.memory?.freeMb ?? 0)
const memTotal = computed(() => stats.value?.system?.memory?.totalMb ?? 0)
const memUsedMb = computed(() => memTotal.value - memFree.value)

const gwState = computed(() => stats.value?.service?.state ?? 'stopped')
const platform = computed(() => stats.value?.system?.platform ?? '')

const uptimeText = computed(() => {
  const s = stats.value?.system?.uptimeSeconds ?? 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
})

function gaugeColor(pct: number) {
  if (pct > 85) return '#ef4444'
  if (pct > 65) return '#f59e0b'
  return 'var(--accent)'
}

const cpuLoadPct = computed(() => {
  const load1 = stats.value?.system?.loadAvg?.[0] ?? 0
  const cores = cpuCount.value
  return Math.min(100, Math.round((load1 / cores) * 100))
})

const cpuGaugeStyle = computed(() => ({
  width: cpuLoadPct.value + '%',
  background: gaugeColor(cpuLoadPct.value),
}))

const memGaugeStyle = computed(() => ({
  width: memUsed.value + '%',
  background: gaugeColor(memUsed.value),
}))

const diskGaugeStyle = computed(() => {
  const pct = stats.value?.system?.disk?.usedPercent ?? 0
  return { width: pct + '%', background: gaugeColor(pct) }
})

// ── Sparkline ─────────────────────────────────────────────────────────────────

const sparkMax = computed(() => Math.max(1, ...history.value))

function toPoints(): [number, number][] {
  const vals = history.value
  if (vals.length < 2) return []
  const max = sparkMax.value
  return vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * sparkW
    const y = sparkH - (v / max) * (sparkH - 4) - 2
    return [x, y]
  })
}

const linePath = computed(() => {
  const pts = toPoints()
  if (pts.length < 2) return ''
  return pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ')
})

const areaPath = computed(() => {
  const pts = toPoints()
  if (pts.length < 2) return ''
  const line = pts.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ')
  const last = pts[pts.length - 1]
  const first = pts[0]
  return `${line} L ${last[0]} ${sparkH} L ${first[0]} ${sparkH} Z`
})

// ── Data loading ──────────────────────────────────────────────────────────────

async function load() {
  try {
    stats.value = await api.system.stats()
    const load1 = stats.value?.system?.loadAvg?.[0] ?? 0
    history.value = [...history.value, load1].slice(-MAX_HISTORY)
  } catch {}
}

let timer: ReturnType<typeof setInterval> | undefined

function startPolling() {
  if (timer !== undefined) clearInterval(timer)
  load()
  timer = setInterval(load, 5000)
}

function stopPolling() {
  if (timer !== undefined) { clearInterval(timer); timer = undefined }
}

onMounted(startPolling)
onUnmounted(stopPolling)
onActivated(startPolling)   // keep-alive 重新激活时立即刷新
onDeactivated(stopPolling)  // keep-alive 离开时停掉计时器
</script>

<style scoped>
.monitor {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.refresh-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
}
.refresh-hint::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 2px #22c55e33;
  animation: pulse-dot 1.6s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* ── Metric cards ── */
.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
}
.status-dot.running { background: #22c55e; box-shadow: 0 0 0 2px #22c55e33; animation: pulse-dot 1.4s ease-in-out infinite; }
.status-dot.stopped,
.status-dot.error   { background: var(--text-muted); }

.metric-value-sm {
  font-size: clamp(18px, 2.5vw, 24px);
}

/* ── Load row ── */
.load-row {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  flex-wrap: wrap;
}

.load-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 0;
}

.load-val {
  font-size: clamp(16px, 1.8vw, 24px);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.load-period {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .06em;
}

/* ── Gauge bar ── */
.gauge-bar {
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}
.gauge-fill {
  height: 100%;
  border-radius: 2px;
  transition: width .6s ease, background .4s;
}

.mount-tag {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface-2);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text-muted);
}

/* ── Sparkline ── */
.chart-section {
  padding: var(--space-5);
}

.sparkline-wrap {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
  margin-top: var(--space-3);
}

.sparkline {
  flex: 1;
  height: 80px;
  border-radius: var(--radius-sm);
  overflow: visible;
}

.sparkline-labels {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-align: right;
  min-width: 36px;
}

.spark-label-max { color: var(--accent); }
</style>
