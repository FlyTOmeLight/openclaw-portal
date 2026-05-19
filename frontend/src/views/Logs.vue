<template>
  <div class="page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">运行日志</h1>
        <p class="subtitle">多源日志聚合（Gateway 进程 / systemd 单元），支持级别筛选、全文检索和自动刷新。</p>
      </div>
      <div class="header-actions">
        <button :class="['btn btn-sm', autoRefresh ? 'btn-primary' : '']" @click="toggleAutoRefresh">
          <span v-if="autoRefresh" class="live-dot pulse"></span>
          {{ autoRefresh ? '实时' : '自动刷新' }}
        </button>
        <button class="btn btn-sm" @click="load" :disabled="loading">
          <svg v-if="!loading" width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.65 2.35A8 8 0 1 0 15 8h-2a6 6 0 1 1-1.05-3.35L9 7h6V1l-1.35 1.35Z" fill="currentColor"/></svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="spin"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40 20" stroke-linecap="round"/></svg>
          刷新
        </button>
        <button class="btn btn-sm btn-danger" @click="clearLogs">清空</button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">原始日志总数</div>
        <div class="metric-value">{{ total }}</div>
        <div class="metric-meta">当前文件中的记录总量</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">当前展示</div>
        <div class="metric-value">{{ entries.length }}</div>
        <div class="metric-meta">{{ activeLevelLabel }} · 最多 {{ maxLines }} 行</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">刷新策略</div>
        <div class="metric-value metric-value-sm">{{ autoRefresh ? '实时轮询' : '手动刷新' }}</div>
        <div class="metric-meta">{{ autoRefresh ? '每 1.5 秒拉取一次' : '由你手动触发刷新' }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">最近刷新</div>
        <div class="metric-value metric-value-sm">{{ lastRefresh || '—' }}</div>
        <div class="metric-meta mono metric-path" :title="logFile">{{ logFile || 'Gateway 进程日志' }}</div>
      </div>
    </div>

    <section class="section-card logs-toolbar-card">
      <div class="section-header">
        <h2 class="section-title">筛选与检索</h2>
        <p class="section-desc">按日志级别、关键词和行数限制快速收敛问题范围。</p>
      </div>

      <div class="toolbar">
        <div class="source-tabs" v-if="sources.length > 1">
          <button
            v-for="s in sources"
            :key="s.id"
            :class="['btn btn-xs source-tab-btn', { 'btn-active': sourceFilter === s.id, 'source-disabled': !s.available }]"
            :title="s.available ? s.label : s.reason || '不可用'"
            :disabled="!s.available"
            @click="sourceFilter = s.id; load()"
          >{{ s.label }}</button>
        </div>
        <div class="toolbar-divider" v-if="sources.length > 1"></div>
        <div class="level-tabs">
          <button
            v-for="lvl in LEVELS"
            :key="lvl.value"
            :class="['btn btn-xs level-tab-btn', { 'btn-active': levelFilter === lvl.value }]"
            @click="levelFilter = lvl.value; load()"
          >{{ lvl.label }}</button>
        </div>
        <div class="toolbar-divider"></div>
        <div class="search-wrap">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input
            v-model="searchQuery"
            @input="debouncedLoad"
            placeholder="搜索日志…"
            class="search-input"
          />
          <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''; load()">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <select v-model="maxLines" class="form-select form-select-compact" @change="load()">
          <option :value="200">200 行</option>
          <option :value="500">500 行</option>
          <option :value="1000">1000 行</option>
          <option :value="2000">2000 行</option>
        </select>
      </div>
    </section>

    <section class="section-card log-panel">
      <div class="section-head-row log-panel-head">
        <div>
          <h2 class="section-title">日志流</h2>
          <p class="section-desc">原样保留时间戳和级别色彩，便于和后端进程输出快速对照。</p>
        </div>
        <span class="log-file-chip">{{ logFile || 'Gateway 进程日志' }}</span>
      </div>

      <div class="log-container" ref="logContainer">
        <div v-if="loading && entries.length === 0" class="empty muted">加载中…</div>
        <div v-else-if="entries.length === 0" class="empty muted">
          暂无日志。启动 OpenClaw 后日志将出现在此处。
        </div>
        <table v-else class="log-table">
          <tbody>
            <tr
              v-for="(entry, i) in entries"
              :key="i"
              :class="['log-row', `level-${entry.level}`]"
            >
              <td class="col-level">
                <span :class="['level-badge', `badge-${entry.level}`]">{{ entry.level.toUpperCase() }}</span>
              </td>
              <td class="col-time">{{ formatTime(entry.ts) }}</td>
              <td class="col-msg">{{ entry.msg || entry.raw }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'
import { useConfirm } from '../composables/useConfirm.js'

const toast = useNaiveToast()
const confirm = useConfirm()

const LEVELS = [
  { value: 'all',   label: '全部' },
  { value: 'debug', label: 'DEBUG' },
  { value: 'info',  label: 'INFO' },
  { value: 'warn',  label: 'WARN' },
  { value: 'error', label: 'ERROR' },
]

const entries = ref<any[]>([])
const total = ref(0)
const logFile = ref('')
const loading = ref(false)
const levelFilter = ref('all')
const sourceFilter = ref('gateway')
const sources = ref<Array<{ id: string; label: string; available: boolean; reason?: string }>>([])
const searchQuery = ref('')
const maxLines = ref(500)
const autoRefresh = ref(false)
const lastRefresh = ref('')
const logContainer = ref<HTMLElement | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const activeLevelLabel = computed(() => LEVELS.find(lvl => lvl.value === levelFilter.value)?.label ?? '全部')

async function load() {
  loading.value = true
  try {
    const res = await api.logs.list({
      lines: maxLines.value,
      level: levelFilter.value === 'all' ? undefined : levelFilter.value,
      search: searchQuery.value || undefined,
      source: sourceFilter.value,
    })
    entries.value = res.entries
    total.value = res.total
    logFile.value = res.logFile
    lastRefresh.value = new Date().toLocaleTimeString('zh-CN')
    await nextTick()
    scrollToBottom()
  } catch (err: any) {
    toast.error(`加载日志失败: ${err.message}`)
  } finally {
    loading.value = false
  }
}

function scrollToBottom() {
  if (logContainer.value) {
    logContainer.value.scrollTop = logContainer.value.scrollHeight
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    refreshTimer = setInterval(load, 1500)
  } else {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function debouncedLoad() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(load, 300)
}

async function clearLogs() {
  if (sourceFilter.value !== 'gateway') {
    toast.error('仅 Gateway 日志文件可清空，systemd journal 需通过系统工具管理')
    return
  }
  if (!await confirm({ title: '清空日志', message: '确认清空日志文件？', confirmText: '清空', danger: true })) return
  try {
    await api.logs.clear(sourceFilter.value)
    entries.value = []
    total.value = 0
    toast.success('日志已清空')
  } catch (err: any) {
    toast.error(`清空失败: ${err.message}`)
  }
}

async function loadSources() {
  try {
    const res = await api.logs.sources()
    sources.value = res.sources
  } catch {}
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

onMounted(async () => {
  await loadSources()
  await load()
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
/* ── Metric cards ── */
.metric-value-sm {
  font-size: var(--text-lg);
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

/* ── Header live dot ── */
.live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--surface);
  flex-shrink: 0;
}

/* ── Toolbar ── */
.logs-toolbar-card,
.log-panel {
  padding: var(--space-5);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.level-tabs,
.source-tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.level-tab-btn,
.source-tab-btn {
  font-size: 11px;
  letter-spacing: 0.02em;
}

.source-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
}

/* ── Search input ── */
.search-wrap {
  position: relative;
  flex: 1;
  min-width: 160px;
  max-width: 280px;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-muted);
  pointer-events: none;
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  padding: 6px 28px 6px 30px;
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
  box-shadow: inset 0 1px 2px var(--tint-weak);
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12), inset 0 1px 2px var(--tint-weak);
}

.search-input::placeholder { color: var(--text-muted); }

.search-clear {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--border);
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  transition: background .12s, color .12s;
}

.search-clear:hover { background: var(--border-strong); color: var(--text-primary); }

/* ── Log panel header ── */
.log-panel-head {
  margin-bottom: var(--space-4);
}

.log-file-chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  background: var(--tint-medium);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

/* ── Log container ── */
.log-container {
  background: #161412;
  border: 1px solid #2A2523;
  border-radius: var(--radius-lg);
  height: min(72vh, 760px);
  min-height: 400px;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.log-container::-webkit-scrollbar { width: 4px; }
.log-container::-webkit-scrollbar-track { background: transparent; }
.log-container::-webkit-scrollbar-thumb { background: #3D3935; border-radius: 2px; }
.log-container::-webkit-scrollbar-thumb:hover { background: #524E4A; }

.empty {
  padding: var(--space-8) var(--space-6);
  text-align: center;
  color: #6B6460;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}

/* ── Log table ── */
.log-table { width: 100%; border-collapse: collapse; }

.log-row {
  border-bottom: 1px solid rgba(255,255,255,0.03);
  transition: background .08s;
}

.log-row:hover { background: var(--surface-2); }

/* Left accent stripe for error/warn rows */
.level-error { border-left: 2px solid #7F1D1D; }
.level-warn  { border-left: 2px solid #78350F; }
.level-info  { border-left: 2px solid transparent; }
.level-debug { border-left: 2px solid transparent; }
.level-trace { border-left: 2px solid transparent; }

.col-level { padding: 5px 8px; width: 64px; vertical-align: top; }
.col-time   { padding: 5px 8px; width: 110px; white-space: nowrap; color: #635D59; vertical-align: top; font-size: 11px; }
.col-msg    { padding: 5px 8px 5px 0; color: #D6D3D1; word-break: break-word; vertical-align: top; }

/* Row text color by level */
.level-error .col-msg { color: #FDA4AF; }
.level-warn  .col-msg { color: #FBD17A; }
.level-debug .col-msg { color: #6C7086; }
.level-trace .col-msg { color: #504D5C; }

/* ── Level badges ── */
.level-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 4px;
  letter-spacing: .04em;
}

.badge-info    { background: rgba(30, 64, 120, 0.6);  color: #93C5FD; }
.badge-debug   { background: rgba(30, 30, 46, 0.7);   color: #6C7086; }
.badge-trace   { background: rgba(20, 20, 30, 0.7);   color: #45475A; }
.badge-warn    { background: rgba(78, 52, 0,  0.7);   color: #FBD17A; }
.badge-error   { background: rgba(80, 10, 10, 0.7);   color: #FDA4AF; }
.badge-fatal   { background: rgba(120, 0, 0,  0.8);   color: #FF7070; }
.badge-unknown { background: rgba(40, 36, 34, 0.7);   color: #A8A29E; }

/* ── Spin animation for loading ── */
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin .7s linear infinite; }

.mono { font-family: var(--font-mono); }

.metric-path {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
  display: block;
}
</style>
