<template>
  <div class="sessions page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">会话管理</h1>
        <p class="subtitle">查看、回溯并清理各 Agent 的历史对话记录。</p>
      </div>
      <div class="header-actions">
        <n-button size="small" @click="load" :loading="loading">刷新</n-button>
      </div>
    </div>

    <div v-if="loading && agents.length === 0" class="empty-state">
      <span class="empty-icon">⟳</span>
      <p>加载中…</p>
    </div>

    <div v-else-if="agents.length === 0" class="empty-state">
      <p>未找到任何 Agent 或会话数据。</p>
    </div>

    <template v-else>
      <div class="metric-grid sessions-metric-grid">
        <div class="metric-card">
          <div class="metric-label">Agent 数</div>
          <div class="metric-value">{{ agents.length }}</div>
          <div class="metric-meta">当前有历史会话记录的 Agent 数量</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">总会话数</div>
          <div class="metric-value">{{ totalSessionCount }}</div>
          <div class="metric-meta">支持回溯、继续对话与逐条清理</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">最近活跃</div>
          <div class="metric-value metric-value-compact">{{ latestSessionTimeLabel }}</div>
          <div class="metric-meta">{{ latestSessionAbsLabel }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">预览状态</div>
          <div class="metric-value metric-value-compact">{{ detailPreviewLabel }}</div>
          <div class="metric-meta">{{ detailPreviewMeta }}</div>
        </div>
      </div>

      <div class="agent-list">
        <div v-for="agent in agents" :key="agent.agentId" class="agent-card section-card">
          <div class="agent-header">
            <div class="agent-info">
              <div class="agent-id">{{ agent.agentId }}</div>
              <div class="agent-meta">
                <span>{{ agent.sessionCount }} 个会话</span>
                <span v-if="agent.sessions[0]">· 最近活跃 {{ formatTime(agent.sessions[0].mtime) }}</span>
              </div>
            </div>
            <div class="agent-actions">
              <n-button
                v-if="agent.sessionCount > 0"
                size="small"
                type="error"
                :loading="clearingAgent === agent.agentId"
                @click="clearAgent(agent)"
              >
                清空全部
              </n-button>
            </div>
          </div>

          <div v-if="agent.sessions.length === 0" class="no-sessions">
            暂无会话记录
          </div>

          <div v-else class="session-stack">
            <div
              v-for="(session, index) in agent.sessions"
              :key="session.id"
              :class="['session-row', 'clickable', { active: detailOpen && detailAgentId === agent.agentId && detailSessionId === session.id }]"
              @click="openDetail(agent.agentId, session.id)"
            >
              <div class="session-main">
                <div class="session-line">
                  <span class="session-order">#{{ index + 1 }}</span>
                  <span class="session-id mono">{{ formatSessionId(session.id) }}</span>
                </div>
                <div class="session-subline">
                  <span class="session-pill">最近活动 · {{ formatTime(session.mtime) }}</span>
                  <span class="session-pill subtle">{{ formatAbsTime(session.mtime) }}</span>
                </div>
              </div>
              <div class="session-row-actions" @click.stop>
                <button class="session-preview-btn" @click.stop="openDetail(agent.agentId, session.id)">
                  预览会话
                </button>
                <n-button
                  size="tiny"
                  type="error"
                  ghost
                  :loading="deletingSession === agent.agentId + '/' + session.id"
                  @click.stop="deleteSession(agent.agentId, session.id)"
                >
                  删除
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="detailOpen" class="detail-overlay" @click.self="closeDetail">
        <div class="detail-dialog">
          <div class="detail-header">
            <div class="detail-title-block">
              <div class="detail-kicker">Session Preview</div>
              <div class="detail-title">会话详情</div>
              <div class="detail-subtitle">
                <span class="mono">{{ formatSessionId(detailSessionId) }}</span>
                <span v-if="detail?.startedAt" class="detail-date">· 启动于 {{ formatAbsTime(detail.startedAt) }}</span>
              </div>
            </div>
            <div class="detail-actions">
              <n-button
                v-if="detail"
                size="small"
                @click="exportSession"
              >
                导出 Markdown
              </n-button>
              <n-button
                v-if="detail?.sessionKey"
                size="small"
                type="primary"
                @click="resumeSession"
              >
                继续对话
              </n-button>
              <button class="close-btn" @click="closeDetail" aria-label="关闭详情">✕</button>
            </div>
          </div>

          <div v-if="detailLoading" class="detail-loading">加载中…</div>
          <div v-else-if="detailError" class="detail-error">{{ detailError }}</div>
          <div v-else-if="detail" ref="detailBodyRef" class="detail-body">
          <section class="detail-summary-shell">
            <div class="detail-section-head">
              <div>
                <div class="detail-section-kicker">Overview</div>
                <h3 class="detail-section-title">会话概览</h3>
              </div>
              <div class="detail-status-pills">
                <span class="detail-status-pill">{{ detail.truncated ? '快速预览' : '完整会话' }}</span>
                <span class="detail-status-pill subtle">{{ detail.loadedMessageCount }} / {{ detailStats.messageCount }} 条</span>
              </div>
            </div>

          <div class="metric-grid detail-metric-grid">
            <div class="metric-card">
              <div class="metric-label">消息总数</div>
              <div class="metric-value">{{ detailStats.messageCount }}</div>
              <div class="metric-meta">按时间顺序还原完整会话</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">角色分布</div>
              <div class="metric-value metric-value-compact">{{ detailStats.userCount }} / {{ detailStats.assistantCount }}</div>
              <div class="metric-meta">用户 {{ detailStats.userCount }} · Assistant {{ detailStats.assistantCount }}</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">工具调用</div>
              <div class="metric-value">{{ detailStats.toolCallCount }}</div>
              <div class="metric-meta">返回结果 {{ detailStats.toolResultCount }} 次</div>
            </div>
            <div class="metric-card">
              <div class="metric-label">会话上下文</div>
              <div :class="['metric-value', 'metric-value-compact', 'metric-value-context']">{{ detail.sessionKey ? '可继续' : '只读' }}</div>
              <div class="metric-meta detail-path" :title="detail.cwd || '未记录工作目录'">{{ formatPath(detail.cwd) }}</div>
            </div>
          </div>

          <div class="detail-facts">
            <div class="detail-fact">
              <span class="detail-fact-label">Agent</span>
              <span class="detail-fact-value mono">{{ detail.agentId }}</span>
            </div>
            <div class="detail-fact">
              <span class="detail-fact-label">Session Key</span>
              <span class="detail-fact-value mono">{{ detail.sessionKey || '未记录' }}</span>
            </div>
            <div class="detail-fact detail-fact-wide">
              <span class="detail-fact-label">工作目录</span>
              <span class="detail-fact-value mono detail-path" :title="detail.cwd || '未记录工作目录'">{{ formatPath(detail.cwd) }}</span>
            </div>
          </div>
          </section>

          <div v-if="detail.truncated" class="detail-preview-banner">
            <div class="detail-preview-copy">
              <div class="detail-preview-title">当前仅加载最近 {{ detail.loadedMessageCount }} 条消息</div>
              <div class="detail-preview-desc">
                该会话共 {{ detailStats.messageCount }} 条消息。先展示尾部预览，避免大体量会话一次性渲染导致卡顿。
              </div>
            </div>
            <n-button size="small" :loading="detailExpanding" @click="loadFullDetail">
              加载全部 {{ detailStats.messageCount }} 条
            </n-button>
          </div>

          <div v-if="detail.messages.length > 0" class="detail-section-head detail-section-head-messages">
            <div>
              <div class="detail-section-kicker">Timeline</div>
              <h3 class="detail-section-title">对话时间线</h3>
            </div>
            <div class="detail-section-side">
              <div class="detail-search-wrap">
                <input
                  v-model.trim="detailSearchQuery"
                  class="detail-search-input"
                  placeholder="搜索正文 / 思考 / 工具输出…"
                />
                <button v-if="detailSearchQuery" class="detail-search-clear" @click="detailSearchQuery = ''">清空</button>
              </div>
              <div class="detail-filter-bar">
                <button
                  v-for="option in messageFilterOptions"
                  :key="option.key"
                  :class="['detail-filter-chip', { active: detailMessageFilter === option.key }]"
                  @click="detailMessageFilter = option.key"
                >
                  {{ option.label }}
                  <span class="detail-filter-count">{{ option.count }}</span>
                </button>
              </div>
              <div class="detail-section-caption">
                {{
                  detailSearchQuery
                    ? `关键词：${detailSearchQuery} · 命中 ${filteredDetailMessages.length} 条`
                    : detailMessageFilter === 'all'
                      ? '按时间顺序展示已解析消息、工具调用与结果。'
                      : `当前筛选：${messageFilterLabel}`
                }}
              </div>
            </div>
          </div>

          <div v-if="detail.messages.length === 0" class="no-messages">暂无消息记录</div>
          <div v-else-if="filteredDetailMessages.length === 0" class="no-messages">
            {{ detailSearchQuery ? '没有匹配该关键词的消息' : '当前筛选下暂无匹配消息' }}
          </div>
          <div v-else class="message-list">
            <div
              v-for="(msg, index) in filteredDetailMessages"
              :key="msg.id"
              :class="['timeline-entry', msg.role]"
            >
              <div :class="['timeline-node', msg.role]"></div>
              <article :class="['message-card', msg.role]">
                <div class="message-card-header">
                  <div class="message-head-main">
                    <span :class="['message-role-badge', msg.role]">{{ roleLabel(msg.role) }}</span>
                    <span class="message-index">第 {{ index + 1 }} 条</span>
                    <span class="message-time">{{ formatAbsTime(msg.timestamp) }}</span>
                  </div>
                  <div class="message-head-meta">
                    <span v-for="hint in messageMatchHints(msg)" :key="hint" class="message-meta-chip match">{{ hint }}</span>
                    <span v-if="msg.toolCalls.length" class="message-meta-chip">调用 {{ msg.toolCalls.length }} 个工具</span>
                    <span v-if="msg.toolResults.length" class="message-meta-chip">返回 {{ msg.toolResults.length }} 个结果</span>
                  </div>
                </div>

                <details
                  v-if="msg.thinking"
                  class="message-thinking"
                  :open="isSectionShown(sectionKey('thinking', msg.id), msg.thinking)"
                  @toggle="syncSectionOpen(sectionKey('thinking', msg.id), $event)"
                >
                  <summary>思考过程</summary>
                  <pre v-if="isSectionShown(sectionKey('thinking', msg.id), msg.thinking)" class="thinking-pre">{{ msg.thinking }}</pre>
                </details>

                <div v-if="msg.text" class="message-rich" v-html="renderMarkdown(msg.text)"></div>

                <div v-for="tc in msg.toolCalls" :key="tc.id" class="tool-block">
                  <details :open="isSectionShown(sectionKey('tool-call', tc.id), toolCallContent(tc.arguments), tc.name)" @toggle="syncSectionOpen(sectionKey('tool-call', tc.id), $event)">
                    <summary class="tool-summary">
                      <span class="tool-summary-main">
                        <span class="tool-kicker">工具调用</span>
                        <span class="tool-name">{{ tc.name }}</span>
                        <span class="tool-state-chip">{{ isSectionShown(sectionKey('tool-call', tc.id), toolCallContent(tc.arguments), tc.name) ? '展开中' : '已折叠' }}</span>
                      </span>
                      <span class="tool-summary-actions" @click.stop>
                        <button
                          class="tool-action-btn"
                          @click.prevent.stop="copyToolContent(sectionKey('tool-call', tc.id), toolCallContent(tc.arguments))"
                        >
                          {{ copiedKey === sectionKey('tool-call', tc.id) ? '已复制' : '复制' }}
                        </button>
                      </span>
                    </summary>
                    <div v-if="!isSectionShown(sectionKey('tool-call', tc.id), toolCallContent(tc.arguments), tc.name)" class="tool-preview">
                      {{ collapseToolContent(toolCallContent(tc.arguments)) }}
                    </div>
                    <pre v-else class="tool-pre" v-html="renderToolOutputHtml(toolCallContent(tc.arguments), 'call')"></pre>
                  </details>
                </div>

                <div v-for="tr in msg.toolResults" :key="tr.toolCallId" class="tool-result-block">
                  <details :open="isSectionShown(sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`), tr.content, tr.toolCallId)" @toggle="syncSectionOpen(sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`), $event)">
                    <summary class="tool-summary result">
                      <span class="tool-summary-main">
                        <span class="tool-kicker">工具结果</span>
                        <span class="tool-name">{{ tr.toolCallId }}</span>
                        <span class="tool-state-chip">{{ isSectionShown(sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`), tr.content, tr.toolCallId) ? '展开中' : '已折叠' }}</span>
                      </span>
                      <span class="tool-summary-actions" @click.stop>
                        <button
                          class="tool-action-btn"
                          @click.prevent.stop="copyToolContent(sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`), tr.content)"
                        >
                          {{ copiedKey === sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`) ? '已复制' : '复制' }}
                        </button>
                      </span>
                    </summary>
                    <div v-if="!isSectionShown(sectionKey('tool-result', `${msg.id}:${tr.toolCallId}`), tr.content, tr.toolCallId)" class="tool-preview result">
                      {{ collapseToolContent(tr.content) }}
                    </div>
                    <pre v-else class="tool-pre" v-html="renderToolOutputHtml(tr.content, 'result')"></pre>
                  </details>
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton } from 'naive-ui'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const toast = useNaiveToast()
const router = useRouter()
const DETAIL_PREVIEW_TAIL = 16

marked.setOptions({ breaks: true, gfm: true })

// ─── List state ───────────────────────────────────────────────────────────────

const loading = ref(false)
const clearingAgent = ref<string | null>(null)
const deletingSession = ref<string | null>(null)
const agents = ref<{ agentId: string; sessions: { id: string; mtime: number }[]; sessionCount: number }[]>([])

// ─── Detail drawer state ──────────────────────────────────────────────────────

type SessionDetail = Awaited<ReturnType<typeof api.sessions.getDetail>>
type DetailMessageFilter = 'all' | 'user' | 'assistant' | 'tool'

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detailAgentId = ref('')
const detailSessionId = ref('')
const detail = ref<SessionDetail | null>(null)
const detailExpanding = ref(false)
const detailMessageFilter = ref<DetailMessageFilter>('all')
const detailSearchQuery = ref('')
const openSections = ref<Set<string>>(new Set())
const detailBodyRef = ref<HTMLElement | null>(null)
const markdownCache = new Map<string, string>()
const toolHtmlCache = new Map<string, string>()
const copiedKey = ref<string | null>(null)
let copiedKeyTimer: ReturnType<typeof setTimeout> | null = null
let bodyOverflowBeforeModal = ''

const totalSessionCount = computed(() => agents.value.reduce((sum, agent) => sum + agent.sessionCount, 0))
const latestSessionTimestamp = computed(() => {
  const timestamps = agents.value.flatMap(agent => agent.sessions.map(session => session.mtime)).filter(Boolean)
  return timestamps.length ? Math.max(...timestamps) : null
})
const latestSessionTimeLabel = computed(() => latestSessionTimestamp.value ? formatTime(latestSessionTimestamp.value) : '暂无')
const latestSessionAbsLabel = computed(() => latestSessionTimestamp.value ? formatAbsTime(latestSessionTimestamp.value) : '还没有历史会话')
const detailPreviewLabel = computed(() => {
  if (!detail.value) return '未打开'
  return detail.value.truncated ? `最近 ${detail.value.loadedMessageCount} 条` : `${detail.value.messages.length} 条消息`
})
const detailPreviewMeta = computed(() => {
  if (!detail.value) return '点击任意会话即可预览详情'
  return detail.value.truncated
    ? `${detail.value.agentId} · 快速预览模式`
    : `${detail.value.agentId} · 完整会话已加载`
})
const detailStats = computed(() => {
  if (!detail.value) {
    return { messageCount: 0, userCount: 0, assistantCount: 0, toolCallCount: 0, toolResultCount: 0 }
  }
  return detail.value.stats
})
const normalizedDetailSearch = computed(() => detailSearchQuery.value.trim().toLowerCase())
const filteredDetailMessages = computed(() => {
  if (!detail.value) return []
  let messages = detail.value.messages
  switch (detailMessageFilter.value) {
    case 'user':
      messages = messages.filter(msg => msg.role === 'user')
      break
    case 'assistant':
      messages = messages.filter(msg => msg.role === 'assistant')
      break
    case 'tool':
      messages = messages.filter(msg => msg.role === 'toolResult' || msg.toolCalls.length > 0 || msg.toolResults.length > 0)
      break
  }
  if (!normalizedDetailSearch.value) return messages
  return messages.filter(msg => messageMatchHints(msg).length > 0)
})
const messageFilterOptions = computed(() => {
  const messages = detail.value?.messages ?? []
  const counts = {
    all: messages.length,
    user: messages.filter(msg => msg.role === 'user').length,
    assistant: messages.filter(msg => msg.role === 'assistant').length,
    tool: messages.filter(msg => msg.role === 'toolResult' || msg.toolCalls.length > 0 || msg.toolResults.length > 0).length,
  }
  return [
    { key: 'all' as const, label: '全部', count: counts.all },
    { key: 'user' as const, label: '用户', count: counts.user },
    { key: 'assistant' as const, label: 'Assistant', count: counts.assistant },
    { key: 'tool' as const, label: '工具', count: counts.tool },
  ]
})
const messageFilterLabel = computed(() => messageFilterOptions.value.find(option => option.key === detailMessageFilter.value)?.label ?? '全部')

// ─── List actions ─────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    agents.value = await api.sessions.list()
  } catch (e: any) {
    toast.error(e.message ?? '加载失败')
  } finally {
    loading.value = false
  }
}

async function clearAgent(agent: { agentId: string; sessionCount: number }) {
  if (!confirm(`确认清空 Agent "${agent.agentId}" 的所有 ${agent.sessionCount} 个会话？此操作不可撤销。`)) return
  clearingAgent.value = agent.agentId
  try {
    const r = await api.sessions.clearAgent(agent.agentId)
    toast.success(`已删除 ${r.deleted} 个会话`)
    await load()
  } catch (e: any) {
    toast.error(e.message ?? '删除失败')
  } finally {
    clearingAgent.value = null
  }
}

async function deleteSession(agentId: string, sessionId: string) {
  deletingSession.value = agentId + '/' + sessionId
  try {
    await api.sessions.delete(agentId, sessionId)
    const agent = agents.value.find(a => a.agentId === agentId)
    if (agent) {
      agent.sessions = agent.sessions.filter(s => s.id !== sessionId)
      agent.sessionCount = agent.sessions.length
    }
    if (detailOpen.value && detailSessionId.value === sessionId) closeDetail()
  } catch (e: any) {
    toast.error(e.message ?? '删除失败')
  } finally {
    deletingSession.value = null
  }
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

async function openDetail(agentId: string, sessionId: string) {
  detailAgentId.value = agentId
  detailSessionId.value = sessionId
  detail.value = null
  detailError.value = ''
  detailOpen.value = true
  detailLoading.value = true
  detailExpanding.value = false
  detailMessageFilter.value = 'all'
  detailSearchQuery.value = ''
  openSections.value = new Set()
  markdownCache.clear()
  toolHtmlCache.clear()
  try {
    detail.value = await api.sessions.getDetail(agentId, sessionId, { tail: DETAIL_PREVIEW_TAIL })
    await resetDetailScroll()
  } catch (e: any) {
    detailError.value = e.message ?? '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detailOpen.value = false
  detailExpanding.value = false
  detailMessageFilter.value = 'all'
  detailSearchQuery.value = ''
  openSections.value = new Set()
  copiedKey.value = null
  toolHtmlCache.clear()
  if (copiedKeyTimer) {
    clearTimeout(copiedKeyTimer)
    copiedKeyTimer = null
  }
}

async function loadFullDetail() {
  if (!detailAgentId.value || !detailSessionId.value || detailExpanding.value || !detail.value?.truncated) return
  detailExpanding.value = true
  detailError.value = ''
  try {
    detail.value = await api.sessions.getDetail(detailAgentId.value, detailSessionId.value)
    toast.success('已加载完整会话')
    await resetDetailScroll()
  } catch (e: any) {
    detailError.value = e.message ?? '加载完整会话失败'
    toast.error(detailError.value)
  } finally {
    detailExpanding.value = false
  }
}

function exportSession() {
  if (!detail.value) return
  window.location.assign(api.sessions.exportUrl(detailAgentId.value, detailSessionId.value))
}

function resumeSession() {
  if (!detail.value?.sessionKey) return
  router.push({
    path: '/chat',
    query: {
      agentId: detailAgentId.value,
      resumeKey: detail.value.sessionKey,
      resumeSessionId: detailSessionId.value,
    },
  })
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatSessionId(id: string) {
  if (id.length > 20) return id.slice(0, 8) + '…' + id.slice(-6)
  return id
}

function formatTime(ts: number) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} 小时前`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD} 天前`
  return d.toLocaleDateString('zh-CN')
}

function formatAbsTime(ts: string | number | null) {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ts))
}

function formatPath(path: string | null) {
  if (!path) return '未记录工作目录'
  return path.length > 56 ? `${path.slice(0, 22)}…${path.slice(-28)}` : path
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  const cached = markdownCache.get(text)
  if (cached) return cached
  const rendered = DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
  markdownCache.set(text, rendered)
  return rendered
}

function formatJson(val: any): string {
  try { return JSON.stringify(val, null, 2) } catch { return String(val) }
}

function toolCallContent(val: any) {
  return formatJson(val)
}

function collapseToolContent(text: string) {
  const compact = text.replace(/\s+$/g, '')
  const lines = compact.split('\n')
  const preview = lines.slice(0, 6).join('\n')
  const clipped = preview.length > 420 ? `${preview.slice(0, 420)}…` : preview
  return lines.length > 6 || compact.length > 420 ? `${clipped}\n…` : compact
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderToolOutputHtml(text: string, kind: 'call' | 'result') {
  const cacheKey = `${kind}:${text}`
  const cached = toolHtmlCache.get(cacheKey)
  if (cached) return cached

  const source = escapeHtml(text)
  const looksJson = /^[\s[{]/.test(text.trim())

  let html = source

  if (looksJson) {
    html = html
      .replace(/^(\s*)"([^"]+)"(?=\s*:)/gm, '$1<span class="tok-key">"$2"</span>')
      .replace(/:\s*"([^"]*)"/g, ': <span class="tok-string">"$1"</span>')
      .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="tok-number">$1</span>')
      .replace(/:\s*(true|false)\b/g, ': <span class="tok-boolean">$1</span>')
      .replace(/:\s*(null)\b/g, ': <span class="tok-null">$1</span>')
  } else {
    html = html
      .replace(/\b(true|false)\b/g, '<span class="tok-boolean">$1</span>')
      .replace(/\b(null)\b/g, '<span class="tok-null">$1</span>')
      .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>')
      .replace(/^([A-Z_][A-Z0-9_ -]{2,}|total \d+|drwx[^\n]*|-[rwx-]{9}[^\n]*)$/gm, '<span class="tok-logline">$1</span>')
  }

  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<span class="tok-url">$1</span>')

  toolHtmlCache.set(cacheKey, html)
  return html
}

async function copyToolContent(key: string, text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      throw new Error('clipboard-unavailable')
    }
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!ok) throw new Error('execCommand failed')
    } catch {
      toast.error('复制失败')
      return
    }
  }
  try {
    copiedKey.value = key
    if (copiedKeyTimer) clearTimeout(copiedKeyTimer)
    copiedKeyTimer = setTimeout(() => {
      copiedKey.value = null
      copiedKeyTimer = null
    }, 1600)
    toast.success('已复制到剪贴板')
  } catch {}
}

function messageMatchHints(msg: SessionDetail['messages'][number]) {
  const query = normalizedDetailSearch.value
  if (!query) return []
  const hints: string[] = []
  if (msg.text?.toLowerCase().includes(query)) hints.push('命中正文')
  if (msg.thinking?.toLowerCase().includes(query)) hints.push('命中思考')
  if (msg.toolCalls.some(tc => toolCallContent(tc.arguments).toLowerCase().includes(query) || tc.name.toLowerCase().includes(query))) hints.push('命中工具调用')
  if (msg.toolResults.some(tr => tr.content.toLowerCase().includes(query) || tr.toolCallId.toLowerCase().includes(query))) hints.push('命中工具结果')
  return [...new Set(hints)]
}

function roleLabel(role: string) {
  if (role === 'user') return '用户'
  if (role === 'toolResult') return '工具结果'
  return 'Assistant'
}

function sectionKey(kind: string, id: string) {
  return `${kind}:${id}`
}

function isSectionOpen(key: string) {
  return openSections.value.has(key)
}

function searchMatchesText(...parts: Array<string | null | undefined>) {
  const query = normalizedDetailSearch.value
  if (!query) return false
  return parts.some(part => (part ?? '').toLowerCase().includes(query))
}

function isSectionShown(key: string, ...parts: Array<string | null | undefined>) {
  return isSectionOpen(key) || searchMatchesText(...parts)
}

function syncSectionOpen(key: string, event: Event) {
  const target = event.currentTarget as HTMLDetailsElement | null
  const next = new Set(openSections.value)
  if (target?.open) next.add(key)
  else next.delete(key)
  openSections.value = next
}

async function resetDetailScroll() {
  await nextTick()
  if (detailBodyRef.value) detailBodyRef.value.scrollTop = 0
}

watch(detailOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    bodyOverflowBeforeModal = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    void resetDetailScroll()
  } else {
    document.body.style.overflow = bodyOverflowBeforeModal
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = bodyOverflowBeforeModal
  }
})

onMounted(load)
</script>

<style scoped>
.sessions {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.sessions-metric-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.metric-value-compact {
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.15;
}

/* ── List ── */
.empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.empty-icon {
  display: block;
  font-size: 28px;
  margin-bottom: 10px;
  opacity: 0.5;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.agent-card {
  padding: var(--space-5);
  background: var(--surface);
}
.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  gap: var(--space-4);
}
.agent-id {
  font-size: var(--text-base);
  font-weight: 660;
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.agent-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 4px;
}
.agent-actions { display: flex; gap: var(--space-2); }

.no-sessions {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: center;
  padding: var(--space-6) 0;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
}

.session-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
}
.session-row.clickable { cursor: pointer; }
.session-row.clickable:hover {
  transform: translateY(-1px);
  border-color: rgba(99, 102, 241, 0.22);
  box-shadow: 0 14px 30px var(--tint-strong);
}
.session-row.active {
  border-color: rgba(99, 102, 241, 0.28);
  background: var(--surface-2);
  box-shadow: 0 16px 36px rgba(99, 102, 241, 0.12);
}
.session-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.session-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.session-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  background: var(--tint-medium);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.session-id {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-subline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.session-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface);
  border: 1px solid rgba(148, 163, 184, 0.18);
}
.session-pill.subtle {
  color: var(--text-muted);
  background: var(--tint-weak);
}
.session-row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}
.session-preview-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(99, 102, 241, 0.16);
  background: var(--surface-2);
  color: var(--accent-text);
  font-size: var(--text-xs);
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}
.session-preview-btn:hover {
  background: var(--surface-2);
  border-color: rgba(99, 102, 241, 0.28);
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(99, 102, 241, 0.12);
}

/* ── Detail dialog ── */
.detail-overlay {
  position: fixed;
  inset: 0;
  background: var(--tint-deep);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 3vw, 32px);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.detail-dialog {
  width: min(1120px, 100%);
  max-height: calc(100vh - 40px);
  background: var(--surface);
  border: 1px solid var(--card-border);
  border-radius: 28px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}
.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6) var(--space-4);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: var(--space-4);
  background: var(--surface);
}
.detail-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-text);
}
.detail-title {
  margin-top: 6px;
  font-size: clamp(24px, 3vw, 30px);
  font-weight: 760;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}
.detail-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mono { font-family: var(--font-mono); }
.detail-date { color: var(--text-muted); }
.detail-actions { display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0; }
.close-btn {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
  color: var(--text-muted);
  font-size: 16px;
  padding: 0;
  border-radius: 999px;
  line-height: 1;
  background: var(--surface);
}
.close-btn:hover { background: var(--surface-2); color: var(--text-primary); }

.detail-loading,
.detail-error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--space-6);
}
.detail-error { color: var(--error, #e53e3e); }

.detail-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.no-messages { color: var(--text-muted); font-size: var(--text-sm); text-align: center; padding: 40px 0; }

/* ── Messages ── */
.detail-summary-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.detail-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.detail-section-head-messages {
  margin-top: 2px;
  padding: 0 2px;
}

.detail-section-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.detail-search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(360px, 100%);
}

.detail-search-input {
  width: 100%;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.detail-search-input:focus {
  border-color: rgba(99, 102, 241, 0.22);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);
  background: var(--surface);
}

.detail-search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.detail-section-kicker {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 6px;
}

.detail-section-title {
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.detail-section-caption {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.55;
}

.detail-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.detail-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}

.detail-filter-chip:hover {
  background: var(--surface);
  border-color: rgba(99, 102, 241, 0.16);
  transform: translateY(-1px);
}

.detail-filter-chip.active {
  background: var(--surface-2);
  border-color: rgba(99, 102, 241, 0.24);
  color: var(--accent-text);
}

.detail-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--tint-medium);
  color: inherit;
  font-size: 10px;
  font-weight: 700;
}

.detail-status-pills {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  background: var(--surface-2);
  border: 1px solid rgba(99, 102, 241, 0.16);
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 700;
}

.detail-status-pill.subtle {
  background: var(--tint-weak);
  border-color: rgba(148, 163, 184, 0.14);
  color: var(--text-secondary);
}

.detail-metric-grid {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.detail-metric-grid :deep(.metric-card),
.detail-metric-grid .metric-card {
  padding: 14px 16px;
  border-radius: 20px;
}

.detail-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-fact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: var(--surface-2);
}

.detail-fact-wide {
  grid-column: 1 / -1;
}

.detail-fact-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.detail-fact-value {
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
}

.detail-preview-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 12px 14px;
  border-radius: 20px;
  border: 1px solid rgba(99, 102, 241, 0.16);
  background: var(--surface-2);
}

.detail-preview-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-preview-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.detail-preview-desc {
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-secondary);
}

.detail-path {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.metric-value-context {
  font-size: clamp(18px, 2.4vw, 24px);
}

.message-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 24px;
}
.message-list::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.18), rgba(148, 163, 184, 0.1));
}
.timeline-entry {
  position: relative;
  display: flex;
  align-items: flex-start;
}
.timeline-entry.user {
  justify-content: flex-start;
}
.timeline-entry.assistant {
  justify-content: flex-end;
}
.timeline-entry.toolResult {
  justify-content: center;
}
.timeline-node {
  position: absolute;
  left: -24px;
  top: 18px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 4px rgba(255,255,255,0.66);
  z-index: 1;
}
.timeline-node.user {
  background: #2563eb;
}
.timeline-node.assistant {
  background: #0f172a;
}
.timeline-node.toolResult {
  background: #0ea5e9;
}
.message-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
  width: min(100%, 840px);
}
.message-card.user {
  background: var(--surface-2);
  border-color: rgba(59, 130, 246, 0.16);
}
.message-card.assistant {
  background: var(--surface);
}
.message-card.toolResult {
  width: min(100%, 760px);
  background: var(--surface-2);
  border-color: rgba(14, 165, 233, 0.16);
}

.message-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.message-head-main,
.message-head-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.message-role-badge,
.message-meta-chip,
.message-index {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.message-role-badge.user {
  background: rgba(37, 99, 235, 0.14);
  color: var(--accent-text);
}
.message-role-badge.assistant {
  background: var(--tint-strong);
  color: var(--text-primary);
}
.message-role-badge.toolResult {
  background: rgba(14, 165, 233, 0.12);
  color: #0f766e;
}
.message-index {
  background: var(--surface);
  color: var(--text-secondary);
}
.message-meta-chip {
  background: var(--tint-medium);
  color: var(--text-secondary);
}
.message-meta-chip.match {
  background: var(--surface-2);
  color: var(--accent-text);
}
.message-time {
  font-size: 12px;
  color: var(--text-muted);
}

.message-rich {
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid rgba(148, 163, 184, 0.14);
  font-size: var(--text-sm);
  line-height: 1.7;
  word-break: break-word;
}
.message-rich :deep(p + p),
.message-rich :deep(ul),
.message-rich :deep(ol),
.message-rich :deep(pre),
.message-rich :deep(blockquote) {
  margin-top: 12px;
}
.message-rich :deep(p:last-child) { margin-bottom: 0; }
.message-rich :deep(pre) {
  background: var(--tint-medium);
  padding: 12px 14px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 12px;
}
.message-rich :deep(code),
.thinking-pre,
.tool-pre {
  font-family: var(--font-mono);
}
.message-rich :deep(code) {
  background: var(--tint-medium);
  padding: 2px 6px;
  border-radius: 8px;
  font-size: .92em;
}
.message-rich :deep(ul),
.message-rich :deep(ol) {
  padding-left: 20px;
}

.message-thinking {
  font-size: 12px;
  color: var(--text-secondary);
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  background: var(--surface-2);
  padding: 10px 14px;
}
.message-thinking summary { cursor: pointer; user-select: none; padding: 2px 0; font-weight: 600; }
.thinking-pre {
  margin: 6px 0 0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 240px;
  overflow-y: auto;
}

/* Tool blocks */
.tool-block,
.tool-result-block {
  font-size: 12px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  overflow: hidden;
}

.tool-block {
  background: var(--surface);
}

.tool-result-block {
  background: var(--surface-2);
  border-color: rgba(14, 165, 233, 0.16);
}

.tool-block details,
.tool-result-block details {
  display: block;
}
.tool-summary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  background: transparent;
  color: var(--text-secondary);
  border: 0;
}
.tool-summary.result {
  color: #0f766e;
}

.tool-summary::marker,
.tool-summary::-webkit-details-marker {
  display: none;
}
.tool-kicker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  background: rgba(37, 99, 235, 0.1);
  border: 1px solid rgba(37, 99, 235, 0.12);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-text);
}
.tool-result-block .tool-kicker {
  background: rgba(14, 165, 233, 0.12);
  border-color: rgba(14, 165, 233, 0.16);
  color: #0f766e;
}
.tool-summary-main,
.tool-summary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tool-summary-main {
  min-width: 0;
}
.tool-name { font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
.tool-state-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  background: var(--tint-medium);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.tool-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.tool-action-btn:hover {
  background: var(--surface);
  border-color: rgba(99, 102, 241, 0.2);
  transform: translateY(-1px);
}
.tool-preview {
  margin: 0 12px 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-preview.result {
  background: var(--tint-strong);
  border-color: rgba(14, 165, 233, 0.18);
}
.tool-pre {
  margin: 0 12px 12px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-2);
  border-radius: 14px;
  padding: 12px 14px;
  max-height: 240px;
  overflow-y: auto;
  color: var(--text-secondary);
  border: 1px solid rgba(148, 163, 184, 0.14);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.66);
}

.tool-result-block .tool-pre {
  background: linear-gradient(180deg, rgba(15,23,42,0.9), rgba(15,23,42,0.82));
  color: rgba(241,245,249,0.96);
  border-color: rgba(15, 23, 42, 0.2);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.tool-pre :deep(.tok-key),
.tool-pre .tok-key {
  color: var(--accent-text);
  font-weight: 700;
}
.tool-pre :deep(.tok-string),
.tool-pre .tok-string {
  color: #047857;
}
.tool-pre :deep(.tok-number),
.tool-pre .tok-number {
  color: #7c3aed;
}
.tool-pre :deep(.tok-boolean),
.tool-pre .tok-boolean {
  color: var(--warn-text);
  font-weight: 600;
}
.tool-pre :deep(.tok-null),
.tool-pre .tok-null {
  color: var(--text-muted);
  font-style: italic;
}
.tool-pre :deep(.tok-url),
.tool-pre .tok-url {
  color: #0f766e;
  text-decoration: underline;
  text-decoration-style: dotted;
}
.tool-pre :deep(.tok-path),
.tool-pre .tok-path {
  color: var(--accent-text);
}
.tool-pre :deep(.tok-logline),
.tool-pre .tok-logline {
  color: var(--text-secondary);
  font-weight: 600;
}

.tool-result-block .tool-pre :deep(.tok-key),
.tool-result-block .tool-pre .tok-key {
  color: #93c5fd;
}
.tool-result-block .tool-pre :deep(.tok-string),
.tool-result-block .tool-pre .tok-string {
  color: #86efac;
}
.tool-result-block .tool-pre :deep(.tok-number),
.tool-result-block .tool-pre .tok-number {
  color: #c4b5fd;
}
.tool-result-block .tool-pre :deep(.tok-boolean),
.tool-result-block .tool-pre .tok-boolean {
  color: #fcd34d;
}
.tool-result-block .tool-pre :deep(.tok-null),
.tool-result-block .tool-pre .tok-null {
  color: rgba(226,232,240,0.78);
}
.tool-result-block .tool-pre :deep(.tok-url),
.tool-result-block .tool-pre .tok-url {
  color: #67e8f9;
}
.tool-result-block .tool-pre :deep(.tok-path),
.tool-result-block .tool-pre .tok-path {
  color: #bfdbfe;
}
.tool-result-block .tool-pre :deep(.tok-logline),
.tool-result-block .tool-pre .tok-logline {
  color: rgba(241,245,249,0.96);
  font-weight: 700;
}

@media (max-width: 960px) {
  .detail-header,
  .detail-body {
    padding: 18px;
  }
}

@media (max-width: 720px) {
  .session-row,
  .detail-header,
  .detail-preview-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .session-row-actions,
  .detail-actions {
    justify-content: space-between;
  }

  .session-preview-btn {
    flex: 1;
  }

  .message-list {
    padding-left: 18px;
  }

  .tool-summary {
    flex-direction: column;
    align-items: stretch;
  }

  .tool-summary-actions {
    justify-content: flex-end;
  }

  .message-list::before {
    left: 8px;
  }

  .timeline-node {
    left: -18px;
  }

  .detail-overlay {
    padding: 12px;
  }

  .detail-dialog {
    max-height: calc(100vh - 24px);
    border-radius: 24px;
  }

  .detail-facts {
    grid-template-columns: 1fr;
  }

  .detail-section-side {
    align-items: stretch;
  }

  .detail-filter-bar {
    justify-content: flex-start;
  }

  .detail-search-wrap {
    width: 100%;
  }
}
</style>
