<template>
  <div class="page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">审计日志</h1>
        <p class="subtitle">所有高权限操作的留痕记录（配置、插件、渠道、网关、终端命令等）</p>
      </div>
      <div class="header-actions">
        <button :class="['btn btn-sm', autoRefresh ? 'btn-primary' : '']" @click="toggleAutoRefresh">
          <span v-if="autoRefresh" class="live-dot pulse"></span>
          {{ autoRefresh ? '实时' : '自动刷新' }}
        </button>
        <button class="btn btn-sm" @click="load" :disabled="loading">刷新</button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">累计记录</div>
        <div class="metric-value">{{ total }}</div>
        <div class="metric-meta">文件中的全部审计条目</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">当前展示</div>
        <div class="metric-value">{{ entries.length }}</div>
        <div class="metric-meta">按筛选后最新 {{ limit }} 条</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">操作类型</div>
        <div class="metric-value">{{ actionList.length }}</div>
        <div class="metric-meta">已观察到的不同 action</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">最近刷新</div>
        <div class="metric-value metric-value-sm">{{ lastRefresh || '—' }}</div>
        <div class="metric-meta mono">admin / loopback</div>
      </div>
    </div>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">筛选</h2>
      </div>
      <div class="toolbar">
        <select v-model="actionFilter" class="form-select form-select-compact" @change="load">
          <option value="">全部类型</option>
          <option v-for="a in actionList" :key="a" :value="a">{{ a }}</option>
        </select>
        <select v-model="resultFilter" class="form-select form-select-compact" @change="load">
          <option value="">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
        </select>
        <div class="toolbar-divider"></div>
        <div class="search-wrap">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input
            v-model="searchQuery"
            @input="debouncedLoad"
            placeholder="搜索 target / url / 错误信息…"
            class="search-input"
          />
          <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''; load()">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <select v-model.number="limit" class="form-select form-select-compact" @change="load">
          <option :value="50">50 条</option>
          <option :value="200">200 条</option>
          <option :value="500">500 条</option>
          <option :value="1000">1000 条</option>
        </select>
      </div>
    </section>

    <section class="section-card">
      <div class="section-head-row">
        <div>
          <h2 class="section-title">事件流</h2>
          <p class="section-desc">按时间倒序展示。点击行查看详情。</p>
        </div>
      </div>

      <div v-if="loading && entries.length === 0" class="empty muted">加载中…</div>
      <div v-else-if="entries.length === 0" class="empty muted">
        暂无审计记录。执行任意敏感操作（改配置、装卸插件、执行命令等）后刷新。
      </div>
      <table v-else class="audit-table">
        <thead>
          <tr>
            <th class="col-time">时间</th>
            <th class="col-action">类型</th>
            <th class="col-actor">操作者</th>
            <th class="col-target">目标</th>
            <th class="col-method">方法</th>
            <th class="col-status">状态</th>
            <th class="col-dur">耗时</th>
            <th class="col-result">结果</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(e, i) in entries" :key="i">
            <tr
              :class="['audit-row', e.result === 'failure' ? 'row-fail' : '', { expanded: expandedIdx === i }]"
              @click="expandedIdx = expandedIdx === i ? null : i"
            >
              <td class="col-time mono">{{ formatTime(e.ts) }}</td>
              <td class="col-action"><span class="action-chip">{{ e.action }}</span></td>
              <td class="col-actor mono">{{ e.actor || '—' }}</td>
              <td class="col-target mono">{{ e.target || '—' }}</td>
              <td class="col-method mono">{{ e.method || '—' }}</td>
              <td class="col-status mono">{{ e.status ?? '—' }}</td>
              <td class="col-dur mono">{{ e.durationMs != null ? `${e.durationMs}ms` : '—' }}</td>
              <td class="col-result">
                <span :class="['result-badge', e.result === 'success' ? 'badge-ok' : 'badge-fail']">
                  {{ e.result === 'success' ? '成功' : '失败' }}
                </span>
              </td>
            </tr>
            <tr v-if="expandedIdx === i" class="detail-row">
              <td colspan="8">
                <div class="detail-body">
                  <div><span class="detail-k">URL:</span> <span class="mono">{{ e.url || '—' }}</span></div>
                  <div v-if="e.errorMessage"><span class="detail-k">Error:</span> <span class="mono err">{{ e.errorMessage }}</span></div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const toast = useNaiveToast()

const entries = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const actionFilter = ref('')
const resultFilter = ref('')
const searchQuery = ref('')
const limit = ref(200)
const actionList = ref<string[]>([])
const expandedIdx = ref<number | null>(null)
const autoRefresh = ref(false)
const lastRefresh = ref('')

let refreshTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function load() {
  loading.value = true
  try {
    const res = await api.audit.list({
      limit: limit.value,
      action: actionFilter.value || undefined,
      result: resultFilter.value || undefined,
      search: searchQuery.value || undefined,
    })
    entries.value = res.entries
    total.value = res.total
    lastRefresh.value = new Date().toLocaleTimeString('zh-CN')
  } catch (err: any) {
    toast.error(`加载审计日志失败: ${err.message}`)
  } finally {
    loading.value = false
  }
}

async function loadActions() {
  try {
    const res = await api.audit.actions()
    actionList.value = res.actions
  } catch {}
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value
  if (autoRefresh.value) {
    refreshTimer = setInterval(load, 3000)
  } else {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function debouncedLoad() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(load, 300)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(async () => {
  await loadActions()
  await load()
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<style scoped>
.metric-value-sm {
  font-size: var(--text-lg);
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  flex-shrink: 0;
}
.search-wrap {
  position: relative;
  flex: 1;
  min-width: 180px;
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}
.search-input {
  width: 100%;
  padding: 6px 28px 6px 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  background: var(--surface-2);
  color: var(--text-primary);
  outline: none;
}
.search-input:focus { border-color: var(--accent); }
.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
}
.form-select-compact {
  font-size: 12px;
  padding: 5px 8px;
}

.audit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.audit-table thead th {
  text-align: left;
  padding: 8px 10px;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border);
}
.audit-row {
  cursor: pointer;
  transition: background 0.12s ease;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.audit-row:hover { background: var(--surface-2); }
.audit-row.expanded { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.audit-row td { padding: 8px 10px; vertical-align: middle; }
.audit-row.row-fail td { color: color-mix(in srgb, #ef4444 80%, var(--text-primary)); }

.col-time  { white-space: nowrap; color: var(--text-muted); }
.col-action { white-space: nowrap; }
.col-actor { white-space: nowrap; font-weight: 600; color: var(--text-primary); }
.col-target { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-method { white-space: nowrap; color: var(--text-muted); }
.col-status { white-space: nowrap; color: var(--text-muted); }
.col-dur    { white-space: nowrap; color: var(--text-muted); }
.col-result { white-space: nowrap; }

.action-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  color: var(--accent);
}

.result-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.badge-ok   { background: color-mix(in srgb, #10b981 12%, transparent); color: #10b981; }
.badge-fail { background: color-mix(in srgb, #ef4444 12%, transparent); color: var(--error-text); }

.detail-row td {
  padding: 10px 14px 12px !important;
  background: color-mix(in srgb, var(--accent) 4%, var(--surface-2));
  border-bottom: 1px solid var(--border);
}
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.detail-k { color: var(--text-muted); margin-right: 6px; }
.detail-body .err { color: var(--error-text); }

.empty { padding: 48px 20px; text-align: center; }
</style>
