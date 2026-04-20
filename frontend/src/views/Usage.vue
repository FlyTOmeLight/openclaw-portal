<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">用量统计</h1>
        <p class="subtitle">Token 消耗、成本预估、Agent / 渠道分布（最近 90 天，从 session JSONL 聚合）</p>
      </div>
      <div class="header-actions">
        <span v-if="summary.estimated" class="estimated-badge" title="Provider 未返 usage，按字符数估算">
          🧮 含估算数据
        </span>
      </div>
    </div>

    <div v-if="loading" class="loading-grid">
      <Skeleton v-for="i in 4" :key="i" variant="card" class="sk-card" />
    </div>

    <template v-else>
      <!-- Summary cards -->
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-label">总 Token</div>
          <div class="metric-value">{{ fmtNum(summary.totalTokens) }}</div>
          <div class="metric-meta">近 90 天 · {{ summary.sessionCount }} 个会话</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">日均 Token</div>
          <div class="metric-value">{{ fmtNum(summary.dailyAvgTokens) }}</div>
          <div class="metric-meta">按 90 天窗口平均</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">本月至今 (MTD)</div>
          <div class="metric-value">{{ fmtNum(summary.mtdTokens) }}</div>
          <div class="metric-meta">¥{{ summary.mtdCost.toFixed(2) }} · 当月消耗</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">月底预计 (EOM)</div>
          <div class="metric-value">{{ fmtNum(summary.eomProjectedTokens) }}</div>
          <div class="metric-meta">按当前速率线性外推</div>
        </div>
      </div>

      <!-- Cache tokens (only when provider reports them, e.g. Anthropic) -->
      <div v-if="summary.cacheReadTokens || summary.cacheWriteTokens" class="metric-grid cache-grid">
        <div class="metric-card cache-card">
          <div class="metric-label">Cache Read</div>
          <div class="metric-value">{{ fmtNum(summary.cacheReadTokens) }}</div>
          <div class="metric-meta">缓存命中（通常 ~10x 便宜）</div>
        </div>
        <div class="metric-card cache-card">
          <div class="metric-label">Cache Write</div>
          <div class="metric-value">{{ fmtNum(summary.cacheWriteTokens) }}</div>
          <div class="metric-meta">首次写缓存（比 normal 稍贵）</div>
        </div>
      </div>

      <!-- Daily bar chart -->
      <div class="card chart-card">
        <div class="card-header">
          <span class="card-title">每日 Token 使用量（最近 30 天）</span>
          <select v-model="chartDays" @change="loadDaily" class="form-select form-select-compact small-select">
            <option :value="7">近 7 天</option>
            <option :value="30">近 30 天</option>
            <option :value="90">近 90 天</option>
          </select>
        </div>
        <div v-if="daily.length === 0" class="chart-empty">暂无数据</div>
        <div v-else class="chart-wrap">
          <svg :viewBox="`0 0 ${chartW} ${chartH}`" width="100%" :height="chartH" class="chart-svg">
            <g v-for="(d, i) in daily" :key="d.date">
              <!-- Completion tokens (top) -->
              <rect
                :x="barX(i)"
                :y="barY(d.completionTokens + d.promptTokens)"
                :width="barW"
                :height="barHeight(d.promptTokens)"
                fill="var(--accent)"
                opacity=".75"
              />
              <!-- Prompt tokens (bottom) -->
              <rect
                :x="barX(i)"
                :y="barY(d.promptTokens)"
                :width="barW"
                :height="barHeight(d.completionTokens)"
                fill="var(--accent)"
                opacity=".35"
              />
              <!-- Date label -->
              <text
                v-if="i % Math.ceil(daily.length / 10) === 0"
                :x="barX(i) + barW / 2"
                :y="chartH - 4"
                text-anchor="middle"
                font-size="9"
                fill="var(--text-muted)"
              >{{ d.date.slice(5) }}</text>
            </g>
          </svg>
          <div class="chart-legend">
            <span class="legend-dot" style="background:var(--accent);opacity:.35"></span> 输入
            <span class="legend-dot ml" style="background:var(--accent);opacity:.75"></span> 输出
          </div>
        </div>
      </div>

      <!-- Agent breakdown -->
      <div v-if="agentsRanked.length" class="card breakdown-card">
        <div class="card-header">
          <span class="card-title">按 Agent 聚合</span>
          <span class="card-sub">谁在烧 token</span>
        </div>
        <div class="bar-list">
          <div v-for="a in agentsRanked" :key="a.name" class="bar-row">
            <span class="bar-label mono">{{ a.name }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-agent" :style="{ width: (a.tokens / agentMax * 100) + '%' }"></div></div>
            <span class="bar-value">{{ fmtNum(a.tokens) }}</span>
            <span class="bar-sub">{{ a.sessions }} 会话 · ¥{{ a.cost.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <!-- Source breakdown (session entry point) -->
      <div v-if="channelsRanked.length" class="card breakdown-card">
        <div class="card-header">
          <div>
            <div class="card-title">按会话来源聚合</div>
            <div class="card-sub">请求从哪发起：Web Chat / 定时任务 / 消息渠道 等</div>
          </div>
        </div>
        <div class="bar-list">
          <div v-for="c in channelsRanked" :key="c.name" class="bar-row">
            <span class="bar-label">{{ channelEmoji(c.name) }} {{ channelLabel(c.name) }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-channel" :style="{ width: (c.tokens / channelMax * 100) + '%' }"></div></div>
            <span class="bar-value">{{ fmtNum(c.tokens) }}</span>
            <span class="bar-sub">{{ c.sessions }} 会话 · ¥{{ c.cost.toFixed(2) }}</span>
          </div>
        </div>
      </div>

      <!-- Context pressure -->
      <div v-if="summary.pressureSessions?.length" class="card breakdown-card">
        <div class="card-header">
          <span class="card-title">上下文压力</span>
          <span class="card-sub">会话最近一轮占用的上下文比例，越高越接近模型上限</span>
        </div>
        <div class="pressure-list">
          <div
            v-for="s in summary.pressureSessions"
            :key="s.sessionId"
            class="pressure-row"
            :class="pressureClass(s.pressurePct)"
            @click="openSession(s)"
          >
            <div class="pressure-meta">
              <span class="mono pressure-id">{{ s.sessionId.slice(0, 12) }}…</span>
              <span class="pressure-agent">{{ s.agentId }}</span>
              <span class="pressure-model mono">{{ pressureModelLabel(s.model) }}</span>
            </div>
            <div class="pressure-track">
              <div class="pressure-fill" :style="{ width: Math.min(100, s.pressurePct) + '%' }"></div>
            </div>
            <div class="pressure-stats">
              <strong class="pressure-pct">{{ s.pressurePct?.toFixed(1) ?? '0' }}%</strong>
              <span class="pressure-nums">{{ fmtNum(s.latestCtxTokens) }} / {{ fmtNum(s.contextWindow) }}</span>
              <span class="pressure-time">{{ relTime(s.lastTs) }}</span>
            </div>
          </div>
        </div>
        <div class="pressure-legend">
          <span class="legend-item legend-ok">&lt; 60% 健康</span>
          <span class="legend-item legend-warn">60–85% 关注</span>
          <span class="legend-item legend-crit">≥ 85% 接近上限，考虑换新会话</span>
        </div>
      </div>

      <!-- Top consuming sessions -->
      <div v-if="summary.topSessions?.length" class="card breakdown-card">
        <div class="card-header">
          <span class="card-title">Top 消耗会话</span>
          <span class="card-sub">找出烧 token 的元凶</span>
        </div>
        <table class="topsess-table">
          <thead>
            <tr>
              <th>会话</th>
              <th>Agent</th>
              <th>渠道</th>
              <th class="r">消息数</th>
              <th class="r">Tokens</th>
              <th class="r">费用</th>
              <th class="r">最近活动</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in summary.topSessions"
              :key="s.sessionId"
              class="topsess-row"
              @click="openSession(s)"
            >
              <td class="mono topsess-id">{{ s.sessionId.slice(0, 12) }}…</td>
              <td>{{ s.agentId }}</td>
              <td>{{ channelEmoji(s.channel) }} {{ channelLabel(s.channel) }}</td>
              <td class="r">{{ s.messageCount }}</td>
              <td class="r"><strong>{{ fmtNum(s.tokens) }}</strong></td>
              <td class="r">¥{{ s.cost.toFixed(2) }}</td>
              <td class="r topsess-time">{{ relTime(s.lastTs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Tool invocation breakdown -->
      <div v-if="summary.byTool?.length" class="card breakdown-card">
        <div class="card-header">
          <span class="card-title">按工具调用</span>
          <span class="card-sub">哪些 tool 被调得最频繁</span>
        </div>
        <div class="bar-list">
          <div v-for="t in summary.byTool" :key="t.name" class="bar-row">
            <span class="bar-label mono">{{ t.name }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-tool" :style="{ width: (t.calls / toolMax * 100) + '%' }"></div></div>
            <span class="bar-value">{{ t.calls }} 次</span>
            <span class="bar-sub">{{ t.outputTokens > 0 ? '≈ ' + fmtNum(t.outputTokens) + ' output tokens' : '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Model breakdown -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">模型用量明细</span>
          <button @click="showCostEditor = !showCostEditor" class="btn btn-sm">
            {{ showCostEditor ? '关闭' : '配置费率' }}
          </button>
        </div>

        <!-- Cost rate editor -->
        <div v-if="showCostEditor" class="cost-editor">
          <p class="cost-hint">设置每个模型每 1000 Token 的费用（元）：</p>
          <div v-for="(_, model) in summary.byModel" :key="model" class="cost-row">
            <span class="cost-model">{{ model }}</span>
            <input
              type="number"
              :value="costs[model] ?? 0"
              @change="costs[model] = parseFloat(($event.target as HTMLInputElement).value) || 0"
              step="0.001"
              min="0"
              class="form-input cost-input"
              placeholder="0.00"
            />
            <span class="cost-unit">元/K token</span>
          </div>
          <button @click="saveCosts" :disabled="savingCosts" class="btn btn-primary btn-sm mt">
            {{ savingCosts ? '保存中…' : '保存费率' }}
          </button>
        </div>

        <div v-if="Object.keys(summary.byModel).length === 0" class="empty-hint">暂无模型用量数据</div>
        <table v-else class="model-table">
          <thead>
            <tr>
              <th>模型</th>
              <th class="r">Token 总量</th>
              <th class="r">估算费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(info, model) in summary.byModel" :key="model">
              <td class="model-name">{{ model }}</td>
              <td class="r">{{ fmtNum(info.tokens) }}</td>
              <td class="r">¥{{ info.cost.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client.js'

const router = useRouter()
import { useToastStore } from '../stores/toast.js'
import Skeleton from '../components/Skeleton.vue'

const toast = useToastStore()
const loading = ref(true)
const summary = ref<any>({
  totalTokens: 0, totalCost: 0, sessionCount: 0, dailyAvgTokens: 0,
  mtdTokens: 0, mtdCost: 0, eomProjectedTokens: 0, eomProjectedCost: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0,
  byModel: {}, byAgent: {}, byChannel: {},
  topSessions: [], pressureSessions: [], byTool: [],
  costs: {}, estimated: false,
})

const toolMax = computed(() => Math.max(1, ...(summary.value.byTool ?? []).map((t: any) => t.calls)))

function openSession(s: any) {
  // Sessions page is nested under /history/sessions
  router.push(`/history/sessions`)
  // Fallback: just navigate; picking the exact session requires a deep-link
  // that the Sessions page doesn't expose yet.
}

function relTime(ts: number): string {
  if (!ts) return '—'
  const diff = Math.max(0, Date.now() - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`
  return `${Math.floor(s / 86400)}d 前`
}

const agentsRanked = computed(() => {
  const arr: any[] = []
  for (const [name, v] of Object.entries(summary.value.byAgent ?? {})) {
    const info = v as any
    arr.push({ name, tokens: info.tokens, cost: info.cost, sessions: info.sessions })
  }
  return arr.sort((a, b) => b.tokens - a.tokens)
})
const agentMax = computed(() => Math.max(1, ...agentsRanked.value.map(a => a.tokens)))

const channelsRanked = computed(() => {
  const arr: any[] = []
  for (const [name, v] of Object.entries(summary.value.byChannel ?? {})) {
    const info = v as any
    arr.push({ name, tokens: info.tokens, cost: info.cost, sessions: info.sessions })
  }
  return arr.sort((a, b) => b.tokens - a.tokens)
})
const channelMax = computed(() => Math.max(1, ...channelsRanked.value.map(c => c.tokens)))

// Session sources fall into two families:
//   (a) internal entry points — portal Web Chat, cron jobs, direct CLI, API calls
//   (b) real messaging platforms — wechat, lansenger, feishu, etc.
const CHANNEL_META: Record<string, { emoji: string; label: string }> = {
  // internal
  portal:  { emoji: '🖥️', label: 'Web 对话' },
  cron:    { emoji: '⏰', label: '定时任务' },
  main:    { emoji: '💬', label: '主会话（直接对话）' },
  api:     { emoji: '🔌', label: 'API 调用' },
  openai:  { emoji: '🤖', label: 'OpenAI 兼容接口' },
  // real messaging platforms
  lansenger:         { emoji: '📨', label: '蓝信' },
  wechat:            { emoji: '🟢', label: '微信' },
  'openclaw-weixin': { emoji: '🟢', label: '微信' },
  feishu:            { emoji: '📘', label: '飞书' },
  lark:              { emoji: '📘', label: '飞书（Lark）' },
  telegram:          { emoji: '✈️', label: 'Telegram' },
  discord:           { emoji: '🎮', label: 'Discord' },
  whatsapp:          { emoji: '📱', label: 'WhatsApp' },
  slack:             { emoji: '🧡', label: 'Slack' },
  dingtalk:          { emoji: '🔷', label: '钉钉' },
  qq:                { emoji: '🐧', label: 'QQ' },
  email:             { emoji: '📧', label: '邮件' },
}
function channelEmoji(name: string): string {
  return CHANNEL_META[name?.toLowerCase()]?.emoji ?? '🔗'
}
function channelLabel(name: string): string {
  return CHANNEL_META[name?.toLowerCase()]?.label ?? name
}
const daily = ref<any[]>([])
const chartDays = ref(30)
const showCostEditor = ref(false)
const costs = ref<Record<string, number>>({})
const savingCosts = ref(false)

// Chart dimensions
const chartW = 640
const chartH = 160
const paddingX = 8
const paddingY = 16
const maxTok = computed(() => Math.max(...daily.value.map((d: any) => d.totalTokens), 1))
const barW = computed(() => Math.max((chartW - paddingX * 2) / (daily.value.length || 1) - 2, 4))

function barX(i: number) { return paddingX + i * ((chartW - paddingX * 2) / (daily.value.length || 1)) }
function barY(tokens: number) { return paddingY + (1 - tokens / maxTok.value) * (chartH - paddingY - 20) }
function barHeight(tokens: number) { return (tokens / maxTok.value) * (chartH - paddingY - 20) }

onMounted(async () => {
  await Promise.all([loadSummary(), loadDaily()])
  loading.value = false
})

async function loadSummary() {
  try {
    summary.value = await api.usage.summary()
    costs.value = { ...summary.value.costs }
  } catch (err: any) {
    toast.error(`加载统计失败: ${err.message}`)
  }
}

async function loadDaily() {
  try {
    const raw = await api.usage.daily(chartDays.value)
    // Pad missing days with zeros so a "近 30 天" view actually shows 30 bars.
    const map = new Map<string, any>((raw as any[]).map(d => [d.date, d]))
    const out: any[] = []
    const today = new Date()
    for (let i = chartDays.value - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push(map.get(key) ?? {
        date: key, promptTokens: 0, completionTokens: 0, totalTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, sessions: 0, estimated: false,
      })
    }
    daily.value = out
  } catch (err: any) {
    toast.error(`加载日统计失败: ${err.message}`)
  }
}

async function saveCosts() {
  savingCosts.value = true
  try {
    await api.usage.updateCosts(costs.value)
    await loadSummary()
    toast.success('费率已更新')
  } catch (err: any) {
    toast.error(`保存费率失败: ${err.message}`)
  } finally {
    savingCosts.value = false
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pressureClass(pct: number): string {
  if (pct >= 85) return 'pressure-critical'
  if (pct >= 60) return 'pressure-warn'
  return 'pressure-ok'
}

function pressureModelLabel(model?: string): string {
  if (!model) return '未知'
  const m = model.split('/').pop() ?? model
  return m.length > 24 ? m.slice(0, 24) + '…' : m
}
</script>

<style scoped>
.page-desc { color: var(--text-muted); font-size: var(--text-sm); margin: 4px 0 0; }

.estimated-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--warn-bg);
  color: var(--warn-text);
}

.loading-grid { display: flex; gap: var(--space-4); flex-wrap: wrap; margin-bottom: var(--space-5); }
.sk-card { flex: 1; min-width: 160px; height: 80px; }

/* ── Cache grid (slim) ── */
.cache-grid { grid-template-columns: repeat(2, 1fr) !important; margin-top: -8px; }
.cache-card { background: color-mix(in srgb, #06b6d4 5%, var(--card-fill)); }

/* ── Breakdown by agent/channel ── */
.breakdown-card { margin-bottom: var(--space-5); padding: var(--space-5); }
.card-sub { font-size: 11px; color: var(--text-muted); }
.bar-list { display: flex; flex-direction: column; gap: 10px; }
.bar-row {
  display: grid;
  grid-template-columns: 140px 1fr auto auto;
  gap: 12px;
  align-items: center;
  font-size: 13px;
}
.bar-label { color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track {
  height: 10px;
  background: var(--surface-2);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.bar-fill { height: 100%; border-radius: var(--radius-full); transition: width 0.3s ease; }
.bar-fill-agent { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, transparent)); }
.bar-fill-channel { background: linear-gradient(90deg, #3b82f6, color-mix(in srgb, #3b82f6 60%, transparent)); }
.bar-fill-tool { background: linear-gradient(90deg, #f59e0b, color-mix(in srgb, #f59e0b 60%, transparent)); }

/* ── Top consuming sessions table ── */
.topsess-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.topsess-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.topsess-table th.r { text-align: right; }
.topsess-row {
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  transition: background 0.12s;
}
.topsess-row:hover { background: var(--accent-subtle); }
.topsess-row:last-child { border-bottom: none; }
.topsess-row td {
  padding: 10px 12px;
  color: var(--text-primary);
  vertical-align: middle;
}
.topsess-row td.r { text-align: right; }
.topsess-id { color: var(--text-secondary); }
.topsess-time { color: var(--text-muted); font-size: 11px; }
.bar-value { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); white-space: nowrap; min-width: 60px; text-align: right; }
.bar-sub { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

.chart-card { margin-bottom: var(--space-5); }
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); }
.card-title { font-size: var(--text-md); font-weight: 600; }
.small-select { width: 108px; }
.chart-empty { color: var(--text-muted); font-size: var(--text-sm); text-align: center; padding: var(--space-6); }
.chart-wrap { }
.chart-svg { display: block; width: 100%; }
.chart-legend { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-secondary); margin-top: 8px; }
.legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.ml { margin-left: 10px; }

.empty-hint { color: var(--text-muted); font-size: var(--text-sm); padding: var(--space-3) 0; }

.model-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.model-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.model-table td { padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-primary); }
.model-table tr:last-child td { border-bottom: none; }
.r { text-align: right; }
.model-name { font-family: var(--font-mono); font-size: var(--text-xs); }

.cost-editor { background: var(--surface-2); border-radius: var(--radius-lg); padding: var(--space-4); margin-bottom: var(--space-4); }
.cost-hint { font-size: var(--text-xs); color: var(--text-secondary); margin-bottom: var(--space-3); }
.cost-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.cost-model { font-family: var(--font-mono); font-size: var(--text-xs); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cost-input { width: 90px; padding: 4px 8px; font-size: var(--text-xs); }
.cost-unit { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
.mt { margin-top: var(--space-2); }
.btn-sm { padding: 5px 12px; font-size: var(--text-xs); }

/* ── Context pressure ── */
.pressure-list { display: flex; flex-direction: column; gap: 10px; }
.pressure-row {
  display: grid;
  grid-template-columns: minmax(200px, 260px) 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.pressure-row:hover { background: var(--surface-3, var(--surface-2)); }
.pressure-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pressure-id { font-size: 12px; color: var(--text-secondary); }
.pressure-agent { font-size: 13px; color: var(--text-primary); font-weight: 500; }
.pressure-model { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pressure-track {
  height: 12px;
  background: var(--surface-1, var(--bg));
  border-radius: var(--radius-full);
  overflow: hidden;
  position: relative;
}
.pressure-fill {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
}
.pressure-ok .pressure-fill { background: linear-gradient(90deg, #10b981, #34d399); }
.pressure-ok { border-color: color-mix(in srgb, #10b981 25%, transparent); }
.pressure-warn .pressure-fill { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.pressure-warn { border-color: color-mix(in srgb, #f59e0b 30%, transparent); }
.pressure-critical .pressure-fill { background: linear-gradient(90deg, #ef4444, #f87171); }
.pressure-critical { border-color: color-mix(in srgb, #ef4444 40%, transparent); background: color-mix(in srgb, #ef4444 6%, var(--surface-2)); }
.pressure-stats { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; min-width: 130px; }
.pressure-pct { font-size: 14px; font-variant-numeric: tabular-nums; }
.pressure-ok .pressure-pct { color: #059669; }
.pressure-warn .pressure-pct { color: #d97706; }
.pressure-critical .pressure-pct { color: #dc2626; }
.pressure-nums { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.pressure-time { font-size: 10px; color: var(--text-muted); }
.pressure-legend { display: flex; gap: 16px; margin-top: 12px; font-size: 11px; flex-wrap: wrap; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); }
.legend-item::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.legend-ok::before { background: #10b981; }
.legend-warn::before { background: #f59e0b; }
.legend-crit::before { background: #ef4444; }
</style>
