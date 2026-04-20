<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">定时任务</h1>
        <p class="subtitle">通过 Gateway 调度器管理定时任务</p>
      </div>
      <div class="header-actions">
        <n-button size="small" @click="load">刷新</n-button>
        <n-button type="primary" @click="openDialog(null)">+ 新建任务</n-button>
      </div>
    </div>

    <!-- Stats + scheduler status -->
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">全部任务</div>
        <div class="metric-value">{{ jobs.length }}</div>
        <div class="metric-meta">当前 Agent 工作区内的任务总数</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">运行中</div>
        <div class="metric-value green">{{ jobs.filter(j => j.enabled).length }}</div>
        <div class="metric-meta">按计划触发的活跃任务</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">已暂停</div>
        <div class="metric-value muted">{{ jobs.filter(j => !j.enabled).length }}</div>
        <div class="metric-meta">被手动关闭、不再触发</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">上次失败</div>
        <div class="metric-value" :class="failedCount > 0 ? 'red' : 'muted'">{{ failedCount }}</div>
        <div class="metric-meta">最近一次执行失败的任务</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">调度器</div>
        <div class="metric-value scheduler-status">
          <span
            class="status-dot"
            :class="schedulerEnabled === null ? 'dot-muted' : schedulerEnabled ? 'dot-green' : 'dot-red'"
          />
          <span class="status-text">{{ schedulerEnabled === null ? '—' : schedulerEnabled ? '运行中' : '已停止' }}</span>
        </div>
        <div class="metric-meta">
          <template v-if="nextWakeMs">下次唤醒：{{ timeUntil(new Date(nextWakeMs)) }}后</template>
          <template v-else>Gateway 后台调度进程</template>
        </div>
      </div>
    </div>

    <!-- Gateway offline hint -->
    <div v-if="gwOffline" class="alert alert-warn">
      无法连接 Gateway — 定时任务需要 Gateway 在线且 CLI 已配对。请先在<RouterLink to="/"> 仪表盘</RouterLink>确认 Gateway 已运行，然后在终端执行 <code>openclaw pair</code> 完成配对。
    </div>

    <!-- Future 24h gantt view -->
    <CronGantt v-if="!gwOffline && !loading && jobs.length > 0" :jobs="jobs" />

    <section v-if="!gwOffline" class="section-card">
      <div class="section-header">
        <div>
          <h2 class="section-title">任务列表</h2>
          <p class="section-desc">按时间顺序管理各 Agent 的定时任务。点击展开查看消息内容，或通过右侧图标运行 / 暂停 / 查看历史。</p>
        </div>
      </div>

      <!-- Search + filter bar -->
      <div v-if="!loading && jobs.length > 0" class="filter-bar">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input v-model="search" class="search-input" placeholder="搜索任务名称…" />
          <button v-if="search" class="search-clear" @click="search = ''">✕</button>
        </div>
        <div class="filter-chips">
          <button
            v-for="f in STATUS_FILTERS"
            :key="f.value"
            class="filter-chip"
            :class="{ active: statusFilter === f.value }"
            @click="statusFilter = f.value"
          >{{ f.label }}</button>
        </div>
        <span v-if="filteredJobs.length !== jobs.length" class="filter-count">
          {{ filteredJobs.length }} / {{ jobs.length }}
        </span>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="job-list">
        <div v-for="i in 3" :key="i" class="job-card skeleton-card" />
      </div>

      <!-- Empty -->
      <div v-else-if="!filteredJobs.length" class="empty-state">
        <svg viewBox="0 0 24 24" class="empty-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>{{ jobs.length ? '没有符合条件的任务' : '还没有定时任务' }}</p>
        <button v-if="!jobs.length" class="btn btn-primary btn-sm" @click="openDialog(null)">创建第一个</button>
        <button v-else class="btn btn-sm" @click="search = ''; statusFilter = 'all'">清除过滤</button>
      </div>

      <!-- Job list -->
      <div v-else class="job-list">
      <div
        v-for="job in filteredJobs"
        :key="job.id"
        class="job-card"
        :class="{ disabled: !job.enabled, expanded: expanded[job.id], 'has-errors': hasConsecutiveErrors(job) }"
      >
        <div class="job-main">
          <div class="job-info">
            <div class="job-title-row">
              <span class="job-name">{{ job.name }}</span>
              <span class="badge" :class="job.enabled ? 'badge-green' : 'badge-gray'">
                {{ job.enabled ? '运行中' : '已暂停' }}
              </span>
              <span v-if="lastRunStatus(job) === 'ok'" class="badge badge-green-soft">上次成功</span>
              <span v-else-if="lastRunStatus(job) === 'error'" class="badge badge-red">上次失败</span>
              <span v-else-if="lastRunStatus(job) === 'skipped'" class="badge badge-yellow">上次跳过</span>
              <span v-if="hasConsecutiveErrors(job)" class="badge badge-red">连续失败 {{ job.state.consecutiveErrors }}次</span>
            </div>

            <!-- Schedule + timing -->
            <div class="job-timing-row">
              <div class="job-schedule">
                <svg viewBox="0 0 24 24" class="tiny-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {{ describeSched(job.schedule) }}
                <span v-if="job.agentId" class="muted-dot">· {{ job.agentId }}</span>
              </div>
              <div v-if="job.enabled && nextRunTime(job)" class="next-run">
                <svg viewBox="0 0 24 24" class="tiny-icon"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                {{ nextRunTime(job) }}后
              </div>
              <div v-if="lastRunAt(job)" class="last-run-time">
                <svg viewBox="0 0 24 24" class="tiny-icon"><polyline points="20 6 9 17 4 12"/></svg>
                {{ lastRunAt(job) }}前
                <span v-if="job.state?.lastDurationMs" class="muted-dot">· {{ formatDuration(job.state.lastDurationMs) }}</span>
                <span v-if="deliveryBadge(job)" :class="['delivery-badge', deliveryBadge(job)!.cls]">{{ deliveryBadge(job)!.text }}</span>
                <span v-if="runCount(job)" class="muted-dot">· {{ runCount(job) }}次</span>
              </div>
            </div>

            <!-- Message preview -->
            <div
              class="job-message"
              :class="{ 'expanded-text': expanded[job.id] }"
              @click="toggleExpand(job.id)"
            >{{ jobMessage(job) }}</div>

            <div v-if="job.state?.lastError" class="job-error">{{ job.state.lastError }}</div>
          </div>

          <div class="job-actions">
            <!-- Run -->
            <button
              class="icon-btn"
              :class="{ 'icon-btn-running': running[job.id] }"
              title="立即执行"
              @click="triggerRun(job)"
              :disabled="running[job.id]"
            >
              <svg v-if="!running[job.id]" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <svg v-else viewBox="0 0 24 24" class="spin"><circle cx="12" cy="12" r="9" stroke-dasharray="28 57"/></svg>
            </button>

            <!-- Toggle enable/disable — always uses power icon to avoid confusion with run -->
            <button class="icon-btn" :title="job.enabled ? '暂停' : '启用'" @click="toggleJob(job)" :disabled="toggling[job.id]">
              <svg viewBox="0 0 24 24"><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            </button>

            <!-- History -->
            <button class="icon-btn" title="执行历史" @click="openHistory(job)">
              <svg viewBox="0 0 24 24"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>
            </button>

            <!-- Duplicate -->
            <button class="icon-btn" title="复制任务" @click="duplicateJob(job)">
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>

            <!-- Edit -->
            <button class="icon-btn" title="编辑" @click="openDialog(job)">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>

            <!-- Delete (inline confirm) -->
            <template v-if="confirmDelete[job.id]">
              <button class="icon-btn icon-btn-danger-active" title="确认删除" @click="removeJob(job)">
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button class="icon-btn" title="取消" @click="delete confirmDelete[job.id]">
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </template>
            <button v-else class="icon-btn icon-btn-danger" title="删除" @click="confirmDelete[job.id] = true">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>

        <!-- Expanded detail -->
        <div v-if="expanded[job.id]" class="job-detail">
          <div class="detail-row">
            <span class="detail-label">任务 ID</span>
            <code class="detail-value mono">{{ job.id }}</code>
          </div>
          <div v-if="job.delivery?.channel" class="detail-row">
            <span class="detail-label">播报渠道</span>
            <span class="detail-value">{{ job.delivery.channel }}</span>
          </div>
          <div v-if="nextRunAbsolute(job)" class="detail-row">
            <span class="detail-label">下次运行</span>
            <span class="detail-value">{{ nextRunAbsolute(job) }}</span>
          </div>
          <div v-if="job.state?.lastRunAtMs" class="detail-row">
            <span class="detail-label">上次运行</span>
            <span class="detail-value">{{ fmtDateTime(job.state.lastRunAtMs) }}</span>
          </div>
          <div class="detail-row full-message">
            <span class="detail-label">消息内容</span>
            <span class="detail-value">{{ jobMessage(job) }}</span>
          </div>
        </div>
      </div>
    </div>
    </section>

    <!-- Edit/Create Dialog -->
    <Teleport to="body">
      <div v-if="dialog" class="ui-modal-overlay" @click.self="dialog = false">
        <div class="ui-modal ui-modal-md">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <h2 class="ui-modal-title">{{ editing ? '编辑任务' : '新建定时任务' }}</h2>
              <p class="ui-modal-subtitle">配置消息内容、目标 Agent 和调度计划，Gateway 保存后立即生效。</p>
            </div>
            <button class="ui-modal-close" @click="dialog = false">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="form-group">
              <label>任务名称</label>
              <input v-model="form.name" class="form-input" placeholder="每日报告" autofocus />
            </div>
            <div class="form-group">
              <label>描述（可选）</label>
              <input v-model="form.description" class="form-input" placeholder="简要说明任务用途…" />
            </div>
            <div class="form-group">
              <label>消息内容</label>
              <textarea v-model="form.message" class="form-input" rows="3" placeholder="需要 Agent 执行的任务描述…" />
            </div>
            <div class="form-group">
              <label>Agent（可选）</label>
              <select v-model="form.agentId" class="form-select">
                <option value="">默认 Agent</option>
                <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>播报渠道（可选）</label>
              <select v-model="form.channel" class="form-select" @change="form.accountId = ''; form.to = ''">
                <option value="">不播报</option>
                <option v-for="ch in channels" :key="ch" :value="ch">{{ ch }}</option>
              </select>
              <div v-if="channels.length === 0" class="form-hint">暂无已配置渠道，可在「渠道」页面添加后再绑定。</div>
            </div>

            <!-- Multi-account and destination (only when channel selected) -->
            <template v-if="form.channel">
              <div v-if="channelAccounts.length > 1" class="form-group">
                <label>账号（可选）</label>
                <select v-model="form.accountId" class="form-select">
                  <option value="">默认账号</option>
                  <option v-for="acc in channelAccounts" :key="acc.accountId" :value="acc.accountId">
                    {{ acc.displayId || acc.accountId }}
                  </option>
                </select>
                <div class="form-hint">多账号渠道，可指定由哪个账号播报</div>
              </div>
              <div class="form-group">
                <label>目标（可选）</label>
                <input v-model="form.to" class="form-input" placeholder="手机号 / ChatID / 频道 ID…" />
                <div class="form-hint">留空时推送到渠道默认会话；填写可指定推送到特定联系人或群组</div>
              </div>
            </template>

            <!-- Schedule section -->
            <div class="form-group">
              <label>调度计划</label>
              <div class="schedule-mode-tabs">
                <button type="button" class="mode-tab" :class="{ active: schedMode === 'cron' }" @click="schedMode = 'cron'">Cron 表达式</button>
                <button type="button" class="mode-tab" :class="{ active: schedMode === 'interval' }" @click="schedMode = 'interval'">固定间隔</button>
              </div>
              <template v-if="schedMode === 'cron'">
                <div class="shortcut-pills">
                  <button
                    v-for="s in CRON_SHORTCUTS"
                    :key="s.expr"
                    type="button"
                    class="pill"
                    :class="{ active: form.schedule === s.expr }"
                    @click="form.schedule = s.expr"
                  >{{ s.label }}</button>
                </div>
                <input v-model="form.schedule" class="form-input" placeholder="0 9 * * *（Cron 表达式）" />
                <div class="form-hint">{{ schedPreview }}</div>
              </template>
              <template v-else>
                <div class="interval-row">
                  <span class="interval-label">每</span>
                  <input v-model.number="intervalValue" type="number" min="1" class="form-input interval-num" />
                  <select v-model="intervalUnit" class="form-select interval-unit">
                    <option value="m">分钟</option>
                    <option value="h">小时</option>
                    <option value="d">天</option>
                  </select>
                  <span class="interval-label">执行一次</span>
                </div>
                <div class="form-hint">{{ intervalPreview }}</div>
              </template>
            </div>

            <div class="form-group toggle-row">
              <label>立即启用</label>
              <label class="toggle">
                <input type="checkbox" v-model="form.enabled" />
                <span class="toggle-track" />
              </label>
            </div>
          </div>
          <div class="ui-modal-footer">
            <button class="btn btn-sm" @click="dialog = false">取消</button>
            <button class="btn btn-sm btn-primary" @click="saveJob" :disabled="saving">
              {{ saving ? '保存中…' : (editing ? '保存修改' : '创建任务') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- History Modal -->
    <Teleport to="body">
      <div v-if="historyJob" class="ui-modal-overlay" @click.self="historyJob = null">
        <div class="ui-modal ui-modal-lg">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <h2 class="ui-modal-title">执行历史 · {{ historyJob.name }}</h2>
              <p class="ui-modal-subtitle">最近 {{ historyRuns.length }} 次执行记录</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-sm" :disabled="running[historyJob.id]" @click="rerunFromHistory">
                {{ running[historyJob.id] ? '执行中…' : '重新执行' }}
              </button>
              <button class="ui-modal-close" @click="historyJob = null">✕</button>
            </div>
          </div>
          <div class="ui-modal-body history-body">
            <div v-if="historyLoading" class="history-loading">
              <div v-for="i in 4" :key="i" class="history-row skeleton-row" />
            </div>
            <div v-else-if="!historyRuns.length" class="history-empty">暂无执行记录</div>
            <div v-else class="history-list">
              <div v-for="run in historyRuns" :key="run.id ?? run.runAtMs" class="history-row" :class="'run-' + runStatusClass(run)">
                <div class="run-status-dot" :class="'dot-' + runStatusClass(run)" />
                <div class="run-info">
                  <div class="run-top">
                    <span class="run-status-text">{{ runStatusLabel(run) }}</span>
                    <span v-if="run.durationMs" class="run-dur">{{ formatDuration(run.durationMs) }}</span>
                    <span v-if="run.deliveryStatus && run.deliveryStatus !== 'not-requested'" :class="['run-delivery', 'delivery-' + run.deliveryStatus]">
                      {{ deliveryLabel(run.deliveryStatus) }}
                    </span>
                    <span v-if="run.tokenCount" class="run-tokens">{{ fmtTokens(run.tokenCount) }} tokens</span>
                  </div>
                  <div
                    v-if="run.summary"
                    class="run-summary"
                    :class="{ 'run-summary-expanded': expandedRuns[runKey(run)] }"
                    @click="toggleRunExpand(run, $event)"
                    title="点击展开/收起"
                  >{{ run.summary }}</div>
                  <div v-if="run.error" class="run-error">{{ run.error }}</div>
                  <div class="run-time">{{ fmtDateTime(run.runAtMs ?? run.ts ?? run.startedAtMs) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NButton } from 'naive-ui'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'
import { CronExpressionParser } from 'cron-parser'
import CronGantt from '../components/CronGantt.vue'

const toast = useToastStore()

const jobs = ref<any[]>([])
const loading = ref(true)
const gwOffline = ref(false)
const agents = ref<any[]>([])
const running = ref<Record<string, boolean>>({})
const toggling = ref<Record<string, boolean>>({})
const confirmDelete = ref<Record<string, boolean>>({})
const expanded = ref<Record<string, boolean>>({})

// Scheduler status
const schedulerEnabled = ref<boolean | null>(null)
const nextWakeMs = ref<number | null>(null)

// Search + filter
const search = ref('')
const statusFilter = ref('all')
const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '运行中' },
  { value: 'disabled', label: '已暂停' },
  { value: 'error', label: '失败' },
]

// History modal
const historyJob = ref<any>(null)
const historyRuns = ref<any[]>([])
const historyLoading = ref(false)
const expandedRuns = ref<Record<string, boolean>>({})

// Dialog state
const dialog = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const schedMode = ref<'cron' | 'interval'>('cron')
const intervalValue = ref(10)
const intervalUnit = ref<'m' | 'h' | 'd'>('m')
const form = ref({ name: '', description: '', message: '', schedule: '0 9 * * *', agentId: '', channel: '', accountId: '', to: '', enabled: true })
const channels = ref<string[]>([])
const channelAccounts = ref<{ accountId: string; displayId?: string }[]>([])

const CRON_SHORTCUTS = [
  { expr: '*/5 * * * *',  label: '每5分钟' },
  { expr: '0 * * * *',   label: '每小时' },
  { expr: '0 9 * * *',   label: '每天9点' },
  { expr: '0 18 * * *',  label: '每天18点' },
  { expr: '0 9 * * 1',   label: '每周一9点' },
  { expr: '0 9 1 * *',   label: '每月1日' },
]

const UNIT_LABELS: Record<string, string> = { m: '分钟', h: '小时', d: '天' }

const failedCount = computed(() =>
  jobs.value.filter(j => lastRunStatus(j) === 'error').length
)

const filteredJobs = computed(() => {
  let list = jobs.value
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(j => j.name?.toLowerCase().includes(q) || j.description?.toLowerCase().includes(q))
  }
  if (statusFilter.value === 'enabled') list = list.filter(j => j.enabled)
  else if (statusFilter.value === 'disabled') list = list.filter(j => !j.enabled)
  else if (statusFilter.value === 'error') list = list.filter(j => lastRunStatus(j) === 'error')
  return list
})

const schedPreview = computed(() => describeSched(form.value.schedule))
const intervalPreview = computed(() => {
  const v = intervalValue.value
  const u = UNIT_LABELS[intervalUnit.value]
  return v && v > 0 ? `每 ${v} ${u}执行一次` : '请填写间隔数量'
})

watch(() => form.value.channel, (ch) => loadChannelAccounts(ch))

watch([intervalValue, intervalUnit], () => {
  if (schedMode.value === 'interval' && intervalValue.value > 0)
    form.value.schedule = `every:${intervalValue.value}${intervalUnit.value}`
})

watch(schedMode, () => {
  if (schedMode.value === 'interval') form.value.schedule = `every:${intervalValue.value}${intervalUnit.value}`
  else form.value.schedule = '0 9 * * *'
})

onMounted(async () => {
  await load()
  loadAgents()
  loadChannels()
  loadStatus()
})

async function load() {
  loading.value = true
  gwOffline.value = false
  try {
    jobs.value = await api.cron.list()
  } catch (err: any) {
    if (err.message?.includes('Gateway not available')) {
      gwOffline.value = true
      jobs.value = []
    } else {
      toast.error(`加载失败: ${err.message}`)
      jobs.value = []
    }
  } finally {
    loading.value = false
  }
}

async function loadStatus() {
  try {
    const s = await api.cron.status()
    schedulerEnabled.value = s?.enabled ?? s?.schedulerEnabled ?? null
    nextWakeMs.value = s?.nextWakeAtMs ?? s?.nextWakeMs ?? null
  } catch {}
}

async function loadAgents() {
  try { agents.value = await api.agents.list() } catch {}
}

async function loadChannels() {
  try {
    const data = await api.channels.list()
    channels.value = Object.keys(data).filter(k => k !== 'defaults')
  } catch {}
}

async function loadChannelAccounts(channel: string) {
  if (!channel) { channelAccounts.value = []; return }
  try {
    const platforms = await api.channels.listConfiguredPlatforms()
    const p = platforms.find((p: any) => p.id === channel || channel.includes(p.id))
    channelAccounts.value = (p?.accounts ?? []).map((a: any) => ({
      accountId: a.accountId,
      displayId: a.appId || a.displayId || a.accountId,
    }))
  } catch { channelAccounts.value = [] }
}

async function openHistory(job: any) {
  historyJob.value = job
  historyRuns.value = []
  historyLoading.value = true
  expandedRuns.value = {}
  try {
    historyRuns.value = await api.cron.runs(job.id)
  } catch (err: any) {
    toast.error(`加载历史失败: ${err.message}`)
  } finally {
    historyLoading.value = false
  }
}

function runKey(run: any): string {
  return String(run.ts ?? run.runAtMs ?? run.id ?? '')
}

function toggleRunExpand(run: any, event: MouseEvent) {
  const key = runKey(run)
  const opening = !expandedRuns.value[key]
  expandedRuns.value = { ...expandedRuns.value, [key]: opening }
  if (opening) {
    // Scroll the clicked element into view within the modal body after DOM update
    const el = (event.currentTarget as HTMLElement)?.closest('.history-row')
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30)
  }
}

async function rerunFromHistory() {
  if (!historyJob.value) return
  const job = historyJob.value
  running.value[job.id] = true
  try {
    await api.cron.run(job.id)
    toast.success('已触发重新执行')
    let polls = 0
    const poll = setInterval(async () => {
      await openHistory(job)
      polls++
      if (polls >= 3) clearInterval(poll)
    }, 2000)
  } catch (err: any) {
    toast.error(`触发失败: ${err.message}`)
  } finally {
    delete running.value[job.id]
  }
}

// ─── Field accessors ─────────────────────────────────────────────────────────

function lastRunStatus(job: any): string | null {
  return job.state?.lastRunStatus ?? job.state?.lastStatus ?? null
}

function jobMessage(job: any): string {
  return job.payload?.message ?? job.payload?.text ?? ''
}

function runCount(job: any): number | null {
  const c = job.state?.runCount ?? job.state?.count
  return c != null && c > 0 ? c : null
}

function lastRunAt(job: any): string | null {
  const ts = job.state?.lastRunAtMs ?? job.state?.lastRunAt ?? job.state?.lastAt
  if (!ts) return null
  return timeAgo(ts)
}

function hasConsecutiveErrors(job: any): boolean {
  return (job.state?.consecutiveErrors ?? 0) >= 2
}

function deliveryBadge(job: any): { text: string; cls: string } | null {
  const s = job.state?.lastDeliveryStatus
  if (!s || s === 'not-requested') return null
  if (s === 'delivered') return { text: '已送达', cls: 'delivery-ok' }
  if (s === 'not-delivered') return { text: '未送达', cls: 'delivery-fail' }
  return null
}

function nextRunTime(job: any): string | null {
  if (!job.enabled) return null
  const sched = job.schedule
  try {
    if (typeof sched === 'string' && !sched.startsWith('every:')) {
      return timeUntil(CronExpressionParser.parse(sched).next().toDate())
    }
    if (typeof sched === 'object') {
      if (sched.kind === 'cron' && sched.expr)
        return timeUntil(CronExpressionParser.parse(sched.expr).next().toDate())
      if (sched.kind === 'every' && sched.everyMs)
        return formatMs(sched.everyMs) + '一次'
    }
  } catch {}
  return null
}

function nextRunAbsolute(job: any): string | null {
  if (!job.enabled) return null
  const sched = job.schedule
  try {
    if (typeof sched === 'string' && !sched.startsWith('every:'))
      return fmtDateTime(CronExpressionParser.parse(sched).next().toDate())
    if (typeof sched === 'object' && sched.kind === 'cron' && sched.expr)
      return fmtDateTime(CronExpressionParser.parse(sched.expr).next().toDate())
  } catch {}
  return null
}

function describeSched(raw: any): string {
  if (!raw) return '未设置'
  if (typeof raw === 'string') {
    if (raw.startsWith('every:')) {
      const part = raw.slice(6); const n = parseFloat(part)
      if (part.endsWith('m')) return `每 ${n} 分钟`
      if (part.endsWith('h')) return `每 ${n} 小时`
      if (part.endsWith('d')) return `每 ${n} 天`
      if (part.endsWith('s')) return `每 ${n} 秒`
    }
    const hit = CRON_SHORTCUTS.find(s => s.expr === raw)
    if (hit) return hit.label
    return raw
  }
  if (typeof raw === 'object') {
    if (raw.kind === 'cron' && raw.expr) return describeSched(raw.expr)
    if (raw.kind === 'every' && raw.everyMs) return `每${formatMs(raw.everyMs)}`
    if (raw.kind === 'at' && raw.at) return `一次性: ${fmtDateTime(raw.at)}`
    if (raw.expr) return raw.expr
  }
  return String(raw)
}

// ─── Run history helpers ──────────────────────────────────────────────────────

function runStatusClass(run: any): string {
  const s = run.status ?? run.runStatus ?? run.action
  if (s === 'ok' || s === 'finished') return 'ok'
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'skipped') return 'skipped'
  return 'unknown'
}

function runStatusLabel(run: any): string {
  const s = run.status ?? run.runStatus ?? run.action
  if (s === 'ok' || s === 'finished') return '成功'
  if (s === 'error' || s === 'failed') return '失败'
  if (s === 'skipped') return '已跳过'
  return '未知'
}

function deliveryLabel(s: string): string {
  if (s === 'delivered') return '已送达'
  if (s === 'not-delivered') return '未送达'
  if (s === 'unknown') return '送达未知'
  return s
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`
  if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟`
  if (ms < 86400000) return `${Math.round(ms / 3600000)} 小时`
  return `${Math.round(ms / 86400000)} 天`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m`
}

function timeAgo(ts: any): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return `${Math.round(diff / 1000)} 秒`
  if (diff < 3600000) return `${Math.round(diff / 60000)} 分钟`
  if (diff < 86400000) return `${Math.round(diff / 3600000)} 小时`
  return `${Math.round(diff / 86400000)} 天`
}

function timeUntil(d: Date): string {
  const diff = d.getTime() - Date.now()
  if (diff < 0) return '即将'
  if (diff < 60000) return `${Math.round(diff / 1000)} 秒`
  if (diff < 3600000) return `${Math.round(diff / 60000)} 分钟`
  if (diff < 86400000) return `${Math.round(diff / 3600000)} 小时`
  return `${Math.round(diff / 86400000)} 天`
}

function fmtDateTime(ts: any): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function toggleExpand(id: string) {
  expanded.value[id] = !expanded.value[id]
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function openDialog(job: any) {
  editing.value = job
  schedMode.value = 'cron'
  if (job) {
    const sched = job.schedule
    let schedStr = ''
    if (typeof sched === 'string') schedStr = sched
    else if (sched?.kind === 'cron') schedStr = sched.expr ?? ''
    else if (sched?.kind === 'every' && sched.everyMs) {
      schedMode.value = 'interval'
      const ms = sched.everyMs
      if (ms % 86400000 === 0) { intervalValue.value = ms / 86400000; intervalUnit.value = 'd' }
      else if (ms % 3600000 === 0) { intervalValue.value = ms / 3600000; intervalUnit.value = 'h' }
      else { intervalValue.value = Math.round(ms / 60000); intervalUnit.value = 'm' }
      schedStr = `every:${intervalValue.value}${intervalUnit.value}`
    }
    const ch = job.delivery?.channel ?? ''
    form.value = {
      name: job.name ?? '',
      description: job.description ?? '',
      message: job.payload?.message ?? '',
      schedule: schedStr || '0 9 * * *',
      agentId: job.agentId ?? '',
      channel: ch,
      accountId: job.delivery?.accountId ?? '',
      to: job.delivery?.to ?? '',
      enabled: job.enabled !== false,
    }
    if (ch) loadChannelAccounts(ch)
  } else {
    intervalValue.value = 10; intervalUnit.value = 'm'
    channelAccounts.value = []
    form.value = { name: '', description: '', message: '', schedule: '0 9 * * *', agentId: '', channel: '', accountId: '', to: '', enabled: true }
  }
  dialog.value = true
}

async function saveJob() {
  if (!form.value.name) { toast.warning('请填写任务名称'); return }
  if (!form.value.message) { toast.warning('请填写消息内容'); return }
  const finalSchedule = schedMode.value === 'interval'
    ? `every:${intervalValue.value}${intervalUnit.value}`
    : form.value.schedule
  if (!finalSchedule) { toast.warning('请设置调度计划'); return }

  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description || undefined,
      message: form.value.message,
      schedule: finalSchedule,
      agentId: form.value.agentId || undefined,
      channel: form.value.channel || undefined,
      accountId: form.value.accountId || undefined,
      to: form.value.to || undefined,
      enabled: form.value.enabled,
    }
    if (editing.value) {
      await api.cron.edit(editing.value.id, payload)
      toast.success('任务已更新')
    } else {
      await api.cron.add(payload)
      toast.success('任务已创建')
    }
    dialog.value = false
    await load()
  } catch (err: any) {
    toast.error(`保存失败: ${err.message}`)
  } finally {
    saving.value = false
  }
}

async function toggleJob(job: any) {
  toggling.value[job.id] = true
  try {
    if (job.enabled) { await api.cron.disable(job.id); toast.info('已暂停') }
    else { await api.cron.enable(job.id); toast.success('已启用') }
    await load()
  } catch (err: any) {
    toast.error(`操作失败: ${err.message}`)
  } finally {
    delete toggling.value[job.id]
  }
}

async function triggerRun(job: any) {
  running.value[job.id] = true
  try {
    await api.cron.run(job.id)
    toast.success('已触发执行，稍后刷新可查看结果')
    let polls = 0
    const poll = setInterval(async () => {
      await load()
      polls++
      if (polls >= 3) clearInterval(poll)
    }, 2000)
  } catch (err: any) {
    toast.error(`触发失败: ${err.message}`)
  } finally {
    delete running.value[job.id]
  }
}

async function removeJob(job: any) {
  try {
    await api.cron.remove(job.id)
    toast.info('已删除')
    delete confirmDelete.value[job.id]
    await load()
  } catch (err: any) {
    toast.error(`删除失败: ${err.message}`)
  }
}

function duplicateJob(job: any) {
  openDialog(null)
  const sched = job.schedule
  let schedStr = ''
  if (typeof sched === 'string') schedStr = sched
  else if (sched?.kind === 'cron') schedStr = sched.expr ?? ''
  const ch = job.delivery?.channel ?? ''
  form.value = {
    name: `${job.name}（副本）`,
    description: job.description ?? '',
    message: jobMessage(job),
    schedule: schedStr || '0 9 * * *',
    agentId: job.agentId ?? '',
    channel: ch,
    accountId: job.delivery?.accountId ?? '',
    to: job.delivery?.to ?? '',
    enabled: false,
  }
  if (ch) loadChannelAccounts(ch)
}
</script>

<style scoped>
h1 { font-size: var(--text-xl); font-weight: 700; margin-bottom: 4px; letter-spacing: -.3px; }
.subtitle { color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: 0; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--space-5); }
.header-actions { display: flex; gap: var(--space-2); }

.metric-value.green { color: #22C55E; }
.metric-value.red { color: var(--error-text); }
.metric-value.muted { color: var(--text-muted); }

/* Scheduler status — dot + status text, sized to match numeric metric cards */
.metric-value.scheduler-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: clamp(22px, 3vw, 28px);
  font-weight: 720;
  letter-spacing: -0.02em;
}
.metric-value.scheduler-status .status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.metric-value.scheduler-status .status-dot.dot-green { background: #22C55E; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.metric-value.scheduler-status .status-dot.dot-red   { background: var(--error-text); box-shadow: 0 0 0 3px rgba(239,68,68,.18); }
.metric-value.scheduler-status .status-dot.dot-muted { background: var(--text-muted); }
.metric-value.scheduler-status .status-text { color: var(--text-primary); }

/* Alert */
.alert { padding: 12px 16px; border-radius: var(--radius); margin-bottom: var(--space-4); font-size: var(--text-sm); }
.alert-warn { background: var(--warn-bg); border: 1px solid rgba(245,158,11,.3); color: var(--warn-text); }
.alert-warn a { color: var(--accent); }
.alert-warn code { font-family: var(--font-mono); font-size: var(--text-xs); background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; }

/* Filter bar */
.filter-bar {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: var(--space-4); flex-wrap: wrap;
}
.search-wrap {
  position: relative; display: flex; align-items: center;
  flex: 1; min-width: 180px; max-width: 280px;
}
.search-icon {
  position: absolute; left: 9px; width: 14px; height: 14px;
  stroke: var(--text-muted); fill: none; stroke-width: 2; pointer-events: none;
}
.search-input {
  width: 100%; padding: 6px 28px 6px 30px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); font-size: var(--text-sm);
  color: var(--text-primary); outline: none;
}
.search-input:focus { border-color: var(--accent); }
.search-clear {
  position: absolute; right: 8px;
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 12px; line-height: 1;
}
.filter-chips { display: flex; gap: 4px; }
.filter-chip {
  padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 20px; font-size: var(--text-xs);
  background: transparent; cursor: pointer; color: var(--text-secondary);
  transition: all .12s;
}
.filter-chip:hover { border-color: var(--border-strong); color: var(--text-primary); }
.filter-chip.active { background: var(--accent); border-color: var(--accent); color: white; }
.filter-count { font-size: var(--text-xs); color: var(--text-muted); margin-left: auto; }

/* Empty */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 0; color: var(--text-muted); gap: 12px;
}
.empty-icon { width: 48px; height: 48px; stroke: currentColor; fill: none; stroke-width: 1.5; }

/* Job list */
.job-list { display: flex; flex-direction: column; gap: var(--space-3); }
.job-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 16px 20px; transition: border-color .12s;
}
.job-card:hover { border-color: var(--border-strong); }
.job-card.disabled { opacity: .6; }
.job-card.has-errors { border-left: 3px solid #EF4444; }
.skeleton-card { height: 88px; }

.job-main { display: flex; align-items: flex-start; gap: 12px; }
.job-info { flex: 1; min-width: 0; }
.job-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.job-name { font-weight: 600; font-size: var(--text-sm); }

.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
.badge-green { background: var(--success-bg); color: var(--success-text); }
.badge-green-soft { background: var(--success-bg); color: #22C55E; }
.badge-gray { background: rgba(107,114,128,.12); color: var(--text-muted); }
.badge-red { background: var(--error-bg); color: var(--error-text); }
.badge-yellow { background: var(--warn-bg); color: var(--warn-text); }

/* Timing row */
.job-timing-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 5px; }
.job-schedule { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-secondary); }
.next-run { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--accent-text); }
.last-run-time { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-muted); flex-wrap: wrap; }
.tiny-icon { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; flex-shrink: 0; }
.muted-dot { color: var(--text-muted); }

.delivery-badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; }
.delivery-ok { background: var(--success-bg); color: var(--success-text); }
.delivery-fail { background: var(--error-bg); color: var(--error-text); }

.job-message {
  font-size: var(--text-xs); color: var(--text-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 600px; cursor: pointer;
}
.job-message:hover { color: var(--text-primary); }
.job-message.expanded-text { white-space: pre-wrap; word-break: break-word; }

.job-error { margin-top: 4px; font-size: var(--text-xs); color: var(--error-text); background: var(--error-bg); padding: 3px 8px; border-radius: 4px; }

/* Expanded detail */
.job-detail { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.detail-row { display: flex; align-items: baseline; gap: 10px; font-size: var(--text-xs); }
.detail-label { flex-shrink: 0; width: 72px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.detail-value { color: var(--text-secondary); word-break: break-all; }
.detail-value.mono { font-family: var(--font-mono); font-size: 11px; }
.full-message { align-items: flex-start; }
.full-message .detail-value { white-space: pre-wrap; word-break: break-word; }

/* Actions */
.job-actions { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
.icon-btn {
  width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius);
  background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--text-secondary); transition: all .12s;
}
.icon-btn:hover { background: var(--surface-2); color: var(--text-primary); }
.icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.icon-btn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; }
.icon-btn-danger:hover { background: var(--error-bg); color: var(--error-text); border-color: rgba(239,68,68,.3); }
.icon-btn-danger-active { background: var(--error-bg); color: var(--error-text); border-color: rgba(239,68,68,.4); }
.icon-btn-running { opacity: .7; }
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; transform-origin: center; }

/* History modal */
.history-body { padding: 0 !important; max-height: 60vh; overflow-y: auto; }
.history-loading { padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
.skeleton-row { height: 60px; border-radius: var(--radius); }
.history-empty { padding: 40px; text-align: center; color: var(--text-muted); font-size: var(--text-sm); }
.history-list { display: flex; flex-direction: column; }
.history-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 20px; border-bottom: 1px solid var(--border);
  transition: background .1s;
}
.history-row:last-child { border-bottom: none; }
.history-row:hover { background: var(--surface-2); }
.run-status-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px;
}
.dot-ok { background: #22C55E; }
.dot-error { background: #EF4444; }
.dot-skipped { background: #F59E0B; }
.dot-unknown { background: var(--border-strong); }
.run-info { flex: 1; min-width: 0; }
.run-top { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap; }
.run-status-text { font-size: var(--text-xs); font-weight: 600; }
.run-ok .run-status-text { color: var(--success-text); }
.run-error .run-status-text { color: var(--error-text); }
.run-skipped .run-status-text { color: var(--warn-text); }
.run-unknown .run-status-text { color: var(--text-muted); }
.run-dur { font-size: var(--text-xs); color: var(--text-muted); }
.run-delivery { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.delivery-delivered { background: var(--success-bg); color: var(--success-text); }
.delivery-not-delivered { background: var(--error-bg); color: var(--error-text); }
.delivery-unknown { background: rgba(107,114,128,.1); color: var(--text-muted); }
.run-tokens { font-size: var(--text-xs); color: var(--text-muted); }
.run-summary {
  font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer; max-width: 520px;
}
.run-summary:hover { color: var(--text-primary); }
.run-summary-expanded { white-space: pre-wrap; word-break: break-word; text-overflow: unset; overflow: visible; }
.run-error { font-size: var(--text-xs); color: var(--error-text); margin-bottom: 2px; }
.run-time { font-size: var(--text-xs); color: var(--text-muted); }

/* Schedule mode */
.schedule-mode-tabs { display: flex; gap: 0; margin-bottom: 10px; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.mode-tab { flex: 1; padding: 6px 12px; font-size: var(--text-xs); font-weight: 600; background: transparent; border: none; cursor: pointer; color: var(--text-muted); transition: all .12s; }
.mode-tab:not(:last-child) { border-right: 1px solid var(--border); }
.mode-tab.active { background: var(--accent); color: white; }
.mode-tab:not(.active):hover { background: var(--surface-2); color: var(--text-primary); }
.interval-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.interval-label { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; }
.interval-num { width: 80px !important; text-align: center; }
.interval-unit { width: 90px !important; }

/* Cron shortcuts */
.shortcut-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pill { padding: 4px 10px; border: 1px solid var(--border); border-radius: 20px; font-size: var(--text-xs); background: transparent; cursor: pointer; color: var(--text-secondary); transition: all .12s; }
.pill:hover { border-color: var(--border-strong); color: var(--text-primary); }
.pill.active { background: var(--accent); border-color: var(--accent); color: white; }

/* Form */
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .05em; }
.form-hint { font-size: var(--text-xs); color: var(--text-muted); }
.toggle-row { flex-direction: row !important; align-items: center; justify-content: space-between; }
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { display: none; }
.toggle-track { position: absolute; inset: 0; background: var(--border-strong); border-radius: 11px; cursor: pointer; transition: background .2s; }
.toggle-track::before { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); top: 3px; left: 3px; transition: transform .2s; }
.toggle input:checked + .toggle-track { background: #22C55E; }
.toggle input:checked + .toggle-track::before { transform: translateX(18px); }

/* Modal lg */
.ui-modal-lg { max-width: 640px !important; }
</style>
