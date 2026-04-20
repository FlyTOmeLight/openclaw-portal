<template>
  <div class="agent-dashboard">
    <div v-if="loading && !data" class="empty-state">加载中…</div>
    <div v-else-if="!data" class="empty-state">无数据</div>

    <template v-else>
      <!-- Top metric row -->
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-label">累计 Token</div>
          <div class="metric-value">{{ fmtNum(data.usage.totalTokens) }}</div>
          <div class="metric-meta">近 90 天</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">今日 Token</div>
          <div class="metric-value">{{ fmtNum(data.usage.todayTokens) }}</div>
          <div class="metric-meta">日均 {{ fmtNum(data.usage.dailyAvgTokens) }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">本月至今</div>
          <div class="metric-value">{{ fmtNum(data.usage.mtdTokens) }}</div>
          <div class="metric-meta">¥{{ data.usage.mtdCost.toFixed(2) }} · 预计 {{ fmtNum(data.usage.eomProjectedTokens) }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">会话数</div>
          <div class="metric-value">{{ data.agent.sessionCount }}</div>
          <div class="metric-meta">Top 5 见下方</div>
        </div>
      </div>

      <!-- 30-day sparkline chart -->
      <section class="section-card dash-section">
        <div class="section-header">
          <div class="section-head-row">
            <div>
              <h2 class="section-title">近 30 天 Token 趋势</h2>
              <p class="section-desc">
                {{ activeDays }} 天有活动 · 最大单日 {{ fmtNum(maxDay) }} token
                <span v-if="data.usage.estimated" class="estimated-inline">· 含估算</span>
              </p>
            </div>
          </div>
        </div>
        <div v-if="data.usage.daily30.length === 0" class="chart-empty">暂无数据</div>
        <svg v-else :viewBox="`0 0 ${chartW} ${chartH}`" class="agent-chart">
          <g v-for="(d, i) in data.usage.daily30" :key="d.date">
            <rect
              :x="barX(i)"
              :y="barY(d.totalTokens)"
              :width="barW"
              :height="barHeight(d.totalTokens)"
              :class="['chart-bar', d.estimated ? 'bar-estimated' : '']"
            />
            <text
              v-if="i === 0 || i === data.usage.daily30.length - 1 || i === Math.floor(data.usage.daily30.length / 2)"
              :x="barX(i) + barW / 2"
              :y="chartH - 4"
              text-anchor="middle"
              class="chart-label"
            >{{ d.date.slice(5) }}</text>
          </g>
        </svg>
      </section>

      <!-- Two columns: top sessions + tool usage -->
      <div class="dash-grid">
        <section class="section-card dash-col">
          <div class="section-header">
            <h2 class="section-title">Top 消耗会话</h2>
            <p class="section-desc">点击跳到 Sessions 页</p>
          </div>
          <div v-if="!data.topSessions.length" class="dash-empty">暂无会话</div>
          <div v-else class="topsess-list">
            <div
              v-for="s in data.topSessions"
              :key="s.sessionId"
              class="topsess-item"
              @click="goSessions()"
            >
              <div class="topsess-id mono">{{ s.sessionId.slice(0, 8) }}…</div>
              <div class="topsess-meta">
                {{ channelLabel(s.channel) }} · {{ s.messageCount }} 条 · {{ relTime(s.lastTs) }}
              </div>
              <div class="topsess-tokens">{{ fmtNum(s.tokens) }}</div>
            </div>
          </div>
        </section>

        <section class="section-card dash-col">
          <div class="section-header">
            <h2 class="section-title">工具调用</h2>
            <p class="section-desc">Top 工具 · 点击数</p>
          </div>
          <div v-if="!data.usage.byTool.length" class="dash-empty">暂无工具调用</div>
          <div v-else class="tool-list">
            <div v-for="t in data.usage.byTool.slice(0, 8)" :key="t.name" class="tool-row">
              <span class="tool-name mono">{{ t.name }}</span>
              <div class="tool-track">
                <div class="tool-fill" :style="{ width: (t.calls / topToolCalls * 100) + '%' }"></div>
              </div>
              <span class="tool-value">{{ t.calls }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Channel breakdown + bindings -->
      <div class="dash-grid">
        <section class="section-card dash-col">
          <div class="section-header">
            <h2 class="section-title">按来源</h2>
            <p class="section-desc">此 Agent 的请求来源分布</p>
          </div>
          <div v-if="channelEntries.length === 0" class="dash-empty">暂无数据</div>
          <div v-else class="chan-list">
            <div v-for="c in channelEntries" :key="c.name" class="chan-row">
              <span class="chan-label">{{ channelEmoji(c.name) }} {{ channelLabel(c.name) }}</span>
              <div class="chan-track">
                <div class="chan-fill" :style="{ width: (c.tokens / topChannelTokens * 100) + '%' }"></div>
              </div>
              <span class="chan-value">{{ fmtNum(c.tokens) }}</span>
              <span class="chan-sub">{{ c.sessions }} 会话</span>
            </div>
          </div>
        </section>

        <section class="section-card dash-col">
          <div class="section-header">
            <h2 class="section-title">路由绑定</h2>
            <p class="section-desc">配置的消息渠道</p>
          </div>
          <div v-if="!data.agent.routes.length" class="dash-empty">无渠道绑定</div>
          <div v-else class="route-list">
            <div v-for="r in data.agent.routes" :key="r" class="route-chip mono">{{ r }}</div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client.js'

const props = defineProps<{ agentId: string }>()

const router = useRouter()
const loading = ref(false)
const data = ref<any>(null)

const chartW = 600
const chartH = 120
const paddingX = 4

const maxDay = computed(() => {
  if (!data.value?.usage.daily30.length) return 0
  return Math.max(...data.value.usage.daily30.map((d: any) => d.totalTokens))
})
const activeDays = computed(() => data.value?.usage.daily30.filter((d: any) => d.totalTokens > 0).length ?? 0)

const topToolCalls = computed(() => {
  if (!data.value?.usage.byTool?.length) return 1
  return data.value.usage.byTool[0].calls
})

const channelEntries = computed<Array<{ name: string; tokens: number; sessions: number }>>(() => {
  if (!data.value?.usage.byChannel) return []
  return Object.entries(data.value.usage.byChannel)
    .map(([name, v]: any) => ({ name, tokens: v.tokens, sessions: v.sessions }))
    .sort((a, b) => b.tokens - a.tokens)
})
const topChannelTokens = computed(() => channelEntries.value[0]?.tokens || 1)

function barX(i: number): number {
  const n = data.value.usage.daily30.length || 1
  return paddingX + (i / n) * (chartW - paddingX * 2)
}
function barY(tokens: number): number {
  return (chartH - 24) - (tokens / Math.max(1, maxDay.value)) * (chartH - 40)
}
function barHeight(tokens: number): number {
  return (tokens / Math.max(1, maxDay.value)) * (chartH - 40)
}
const barW = computed(() => {
  const n = data.value?.usage.daily30.length || 1
  return Math.max(3, (chartW - paddingX * 2) / n - 2)
})

const CHANNEL_LABELS: Record<string, { emoji: string; label: string }> = {
  portal:  { emoji: '🖥️', label: 'Web 对话' },
  cron:    { emoji: '⏰', label: '定时任务' },
  main:    { emoji: '💬', label: '主会话' },
  api:     { emoji: '🔌', label: 'API' },
  openai:  { emoji: '🤖', label: 'OpenAI' },
  lansenger:         { emoji: '📨', label: '蓝信' },
  'openclaw-weixin': { emoji: '🟢', label: '微信' },
  wechat:            { emoji: '🟢', label: '微信' },
  feishu:            { emoji: '📘', label: '飞书' },
  telegram:          { emoji: '✈️', label: 'Telegram' },
  discord:           { emoji: '🎮', label: 'Discord' },
}
function channelEmoji(name: string): string { return CHANNEL_LABELS[name?.toLowerCase()]?.emoji ?? '🔗' }
function channelLabel(name: string): string { return CHANNEL_LABELS[name?.toLowerCase()]?.label ?? name }

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function relTime(ts: number): string {
  if (!ts) return '—'
  const d = Math.max(0, Date.now() - ts)
  const s = Math.floor(d / 1000)
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.floor(s / 60)}m 前`
  if (s < 86400) return `${Math.floor(s / 3600)}h 前`
  return `${Math.floor(s / 86400)}d 前`
}

function goSessions() {
  router.push('/history/sessions')
}

async function load() {
  loading.value = true
  try {
    data.value = await api.agents.dashboard(props.agentId)
  } catch { /* silent */ }
  finally { loading.value = false }
}

onMounted(load)
</script>

<style scoped>
.agent-dashboard { display: flex; flex-direction: column; gap: var(--space-4); }

.dash-section { padding: var(--space-5); }
.dash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
@media (max-width: 900px) {
  .dash-grid { grid-template-columns: 1fr; }
}
.dash-col { padding: var(--space-5); }
.dash-empty {
  padding: 30px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.estimated-inline {
  background: var(--warn-bg);
  color: var(--warn-text);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
  margin-left: 4px;
}

/* Chart */
.agent-chart {
  width: 100%;
  height: 120px;
  display: block;
}
.chart-bar {
  fill: var(--accent);
  opacity: 0.7;
  transition: opacity 0.15s;
}
.chart-bar.bar-estimated { fill: color-mix(in srgb, var(--accent) 70%, #f59e0b); }
.chart-bar:hover { opacity: 1; }
.chart-label {
  fill: var(--text-muted);
  font-size: 9px;
}
.chart-empty {
  padding: 30px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

/* Top sessions list */
.topsess-list { display: flex; flex-direction: column; gap: 4px; }
.topsess-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
  font-size: 12px;
}
.topsess-item:hover { background: var(--surface-2); }
.topsess-id { color: var(--text-secondary); font-size: 11px; }
.topsess-meta {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topsess-tokens {
  font-weight: 700;
  color: var(--accent-text);
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: nowrap;
}

/* Tool rows */
.tool-list { display: flex; flex-direction: column; gap: 6px; }
.tool-row {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.tool-name { color: var(--text-primary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool-track {
  height: 8px;
  background: var(--surface-2);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.tool-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, color-mix(in srgb, #f59e0b 60%, transparent));
  border-radius: var(--radius-full);
}
.tool-value {
  font-family: var(--font-mono);
  color: var(--text-primary);
  font-size: 12px;
  min-width: 30px;
  text-align: right;
}

/* Channel rows */
.chan-list { display: flex; flex-direction: column; gap: 6px; }
.chan-row {
  display: grid;
  grid-template-columns: 130px 1fr auto auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.chan-label { white-space: nowrap; }
.chan-track { height: 8px; background: var(--surface-2); border-radius: var(--radius-full); overflow: hidden; }
.chan-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, transparent));
}
.chan-value {
  font-family: var(--font-mono);
  color: var(--text-primary);
  min-width: 50px;
  text-align: right;
}
.chan-sub {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Routes */
.route-list { display: flex; flex-wrap: wrap; gap: 6px; }
.route-chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--accent-subtle);
  color: var(--accent-text);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
}

.empty-state { padding: 60px 20px; text-align: center; color: var(--text-muted); }
</style>
