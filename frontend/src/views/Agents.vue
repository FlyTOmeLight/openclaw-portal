<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">Agent 管理</h1>
        <p class="subtitle">统一管理 Agent 身份、模型、工作区与渠道绑定。</p>
      </div>
      <n-button type="primary" @click="openCreate">+ 新建 Agent</n-button>
    </div>

    <div v-if="!loading && agents.length" class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Agent 总数</div>
        <div class="metric-value">{{ agents.length }}</div>
        <div class="metric-meta">当前工作区内可用的 Agent 数量</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">默认 Agent</div>
        <div class="metric-value">{{ defaultCount }}</div>
        <div class="metric-meta">负责兜底路由与默认执行</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">已配置身份</div>
        <div class="metric-value">{{ configuredIdentityCount }}</div>
        <div class="metric-meta">具备名称或表情标识的 Agent</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">渠道绑定</div>
        <div class="metric-value">{{ boundRouteCount }}</div>
        <div class="metric-meta">已配置的渠道路由总数</div>
      </div>
    </div>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">Agent 列表</h2>
        <p class="section-desc">点击详情进入单个 Agent 的模型、技能、工具权限和渠道配置。</p>
      </div>

      <div v-if="loading" class="skeleton-grid">
        <div v-for="i in 2" :key="i" class="card skeleton-card">
          <div class="skel skel-title" />
          <div class="skel skel-line" />
          <div class="skel skel-line short" />
        </div>
      </div>

      <div v-else-if="agents.length === 0" class="empty-state rich-empty">
        <div class="empty-icon">🤖</div>
        <h3 class="empty-title">暂无 Agent</h3>
        <p class="empty-desc">创建一个 Agent 作为专用执行单元，随后可配置模型、技能与渠道。</p>
        <n-button type="primary" size="small" @click="openCreate">创建第一个 Agent</n-button>
      </div>

      <div v-else class="agent-grid">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="agent-card"
          :class="agent.enabled !== false ? 'agent-active' : 'agent-inactive'"
        >
          <!-- Header -->
          <div class="agent-header">
            <div class="agent-avatar">{{ agent.identityEmoji || '🤖' }}</div>

            <div class="agent-meta">
              <div class="agent-id-row">
                <span class="agent-id">{{ agent.id }}</span>
                <n-tag v-if="agent.isDefault" size="small" type="info" round>默认</n-tag>
              </div>
              <span class="agent-name">{{ agent.identityName || '未配置身份' }}</span>
            </div>

            <button
              class="toggle-pill-sm"
              :class="agent.enabled !== false ? 'toggle-sm-on' : 'toggle-sm-off'"
              :disabled="togglingAgent === agent.id"
              :title="agent.enabled !== false ? '点击禁用' : '点击启用'"
              @click.stop="toggleAgentEnabled(agent)"
            >
              <span class="toggle-knob-sm" />
            </button>
          </div>

          <!-- Info rows -->
          <div class="agent-info">
            <div class="info-row">
              <span class="info-label">模型</span>
              <span class="info-value mono">{{ formatModel(agent.model) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">会话数</span>
              <span class="info-value">{{ agent.sessionCount ?? 0 }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">累计 Token</span>
              <span class="info-value mono">{{ formatAgentNum(agent.totalTokens ?? 0) }}<span v-if="agent.todayTokens" class="today-hint"> · 今日 {{ formatAgentNum(agent.todayTokens) }}</span></span>
            </div>
            <div class="info-row">
              <span class="info-label">最近活动</span>
              <span class="info-value" :class="{ muted: !agent.lastActivityTs }">{{ formatAgentLastActive(agent.lastActivityTs) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">工作区</span>
              <span class="info-value mono truncate" :title="agent.workspace">{{ agent.workspace || '自动创建' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">渠道绑定</span>
              <span v-if="!agent.routes?.length" class="info-value muted">无绑定</span>
              <div v-else class="binding-badges">
                <n-tag v-for="route in agent.routes" :key="route" size="small" round>{{ formatRoute(route) }}</n-tag>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="agent-card-footer">
            <RouterLink :to="`/agents/${agent.id}`" class="btn btn-xs">查看详情</RouterLink>
            <button v-if="!agent.isDefault" class="btn btn-xs btn-danger" @click="confirmDelete(agent)">删除</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Create Modal -->
    <Teleport to="body">
      <div v-if="showCreate" class="ui-modal-overlay" @click.self="showCreate = false">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">新建 Agent</div>
              <div class="ui-modal-subtitle">创建独立工作区、身份和模型配置，用于承载专门任务流。</div>
            </div>
            <button class="ui-modal-close" @click="showCreate = false">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="form-group">
              <label class="form-label">Agent ID <span class="required-mark">*</span></label>
              <n-input v-model:value="createForm.id" placeholder="lowercase-id（字母、数字、-、_）" />
              <span v-if="createIdError" class="form-error">{{ createIdError }}</span>
            </div>
            <div class="form-group">
              <label class="form-label">名称</label>
              <n-input v-model:value="createForm.name" placeholder="显示名称（可选）" />
            </div>
            <div class="form-group">
              <label class="form-label">Emoji</label>
              <n-input v-model:value="createForm.emoji" placeholder="🤖" maxlength="8" />
            </div>
            <div class="form-group">
              <label class="form-label">模型</label>
              <n-select v-model:value="createForm.model" :options="modelOptions" placeholder="使用默认模型" clearable />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">工作区路径</label>
              <n-input v-model:value="createForm.workspace" placeholder="留空自动创建" />
            </div>
          </div>
          <div class="ui-modal-footer">
            <n-button @click="showCreate = false">取消</n-button>
            <n-button type="primary" :loading="creating" :disabled="creating" @click="submitCreate">
              {{ creating ? '创建中…' : '创建' }}
            </n-button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete Confirm Modal -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="ui-modal-overlay" @click.self="showDeleteConfirm = false">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">删除 Agent</div>
            </div>
            <button class="ui-modal-close" @click="showDeleteConfirm = false">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="delete-modal-hero">
              <div class="delete-modal-icon">⚠️</div>
              <div class="delete-modal-body-copy">
                <div class="delete-modal-title">确认删除 {{ deleteTarget?.id }}</div>
                <div class="delete-modal-desc">此操作会移除 Portal 中的 Agent 配置入口。删除后无法撤销，请确认当前不再需要该 Agent。</div>
              </div>
            </div>
            <div class="delete-modal-note">
              <div class="delete-note-label">影响范围</div>
              <div class="delete-note-text">会移除 Agent 列表入口，并清理与该 Agent 相关的 Portal 配置引用。</div>
            </div>
          </div>
          <div class="ui-modal-footer">
            <n-button @click="showDeleteConfirm = false">取消</n-button>
            <n-button type="error" :loading="deleting" :disabled="deleting" @click="submitDelete">
              {{ deleting ? '删除中…' : '删除' }}
            </n-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { NButton, NInput, NSelect, NTag } from 'naive-ui'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const toast = useNaiveToast()

const agents = ref<any[]>([])
const modelProviders = ref<Record<string, any>>({})
const loading = ref(true)

const showCreate = ref(false)
const createForm = ref({ id: '', name: '', emoji: '', model: '', workspace: '' })
const createIdError = ref('')
const creating = ref(false)

const showDeleteConfirm = ref(false)
const deleteTarget = ref<any>(null)
const deleting = ref(false)
const togglingAgent = ref('')

const defaultCount = computed(() => agents.value.filter(agent => agent.isDefault).length)
const configuredIdentityCount = computed(() =>
  agents.value.filter(agent => agent.identityName || agent.identityEmoji).length
)
const boundRouteCount = computed(() =>
  agents.value.reduce((count, agent) => count + (agent.routes?.length ?? 0), 0)
)

const modelOptions = computed(() => [
  ...Object.keys(modelProviders.value).map(id => ({ label: id, value: id })),
])

function formatAgentNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatAgentLastActive(ts: number): string {
  if (!ts) return '无'
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

function formatRoute(route: string): string {
  const parts = route.split(':')
  return parts.length >= 2 ? `${parts[0]} · ${parts.slice(1).join(':')}` : route
}

function formatModel(model: any): string {
  if (!model) return '默认'
  if (typeof model === 'string') return model
  if (typeof model === 'object') return model.primary || model.id || '默认'
  return String(model)
}

async function load() {
  loading.value = true
  try {
    const [agentList, modelsData, daily, activity] = await Promise.all([
      api.agents.list(),
      api.models.list().catch(() => ({ providers: {}, primary: '', fallbacks: [] })),
      api.usage.daily(1).catch(() => [] as any[]),
      api.activity.sessions().catch(() => ({ sessions: [] as any[] })),
    ])
    modelProviders.value = modelsData.providers

    // Per-agent totals + most-recent activity come from session-usage summary,
    // keyed by agent id (authoritative — activity stream buffer empties on
    // restart, summary always reflects on-disk sessions).
    const summary = await api.usage.summary().catch(() => null as any)
    const byAgent: Record<string, { tokens: number; lastTs?: number }> = summary?.byAgent ?? {}

    // Merge live activity-stream timestamps if fresher
    const lastByAgent = new Map<string, number>()
    for (const s of (activity.sessions || [])) {
      const prev = lastByAgent.get(s.agent) ?? 0
      if (s.lastTs > prev) lastByAgent.set(s.agent, s.lastTs)
    }

    agents.value = agentList.map((a: any) => {
      const bucket = byAgent[a.id]
      const lastTs = Math.max(bucket?.lastTs ?? 0, lastByAgent.get(a.id) ?? 0)
      return {
        ...a,
        totalTokens: bucket?.tokens ?? 0,
        lastActivityTs: lastTs,
      }
    })

    // Today's tokens — filter daily entries to today and split by model
    const today = new Date().toISOString().slice(0, 10)
    const todayRow = (daily as any[]).find(d => d.date === today)
    if (todayRow) {
      // daily doesn't break down per model; approximate by scaling total tokens
      // proportionally to each agent's all-time share. Acceptable for a glance.
      const totalAll = agents.value.reduce((s, a) => s + (a.totalTokens || 0), 0)
      if (totalAll > 0) {
        for (const a of agents.value) {
          a.todayTokens = Math.round(((a.totalTokens || 0) / totalAll) * todayRow.totalTokens)
        }
      }
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate() {
  createForm.value = { id: '', name: '', emoji: '', model: '', workspace: '' }
  createIdError.value = ''
  showCreate.value = true
}

async function submitCreate() {
  const { id, name, emoji, model, workspace } = createForm.value
  if (!id) { createIdError.value = 'ID 不能为空'; return }
  if (!/^[a-z0-9_-]+$/.test(id)) { createIdError.value = '只允许小写字母、数字、-、_'; return }
  createIdError.value = ''
  creating.value = true
  try {
    await api.agents.create(id, model || undefined, workspace || undefined)
    if (name || emoji) {
      await api.agents.updateIdentity(id, name || undefined, emoji || undefined)
    }
    toast.success(`Agent ${id} 创建成功`)
    showCreate.value = false
    await load()
  } catch (err: any) {
    toast.error(`创建失败: ${err.message}`)
  } finally {
    creating.value = false
  }
}

function confirmDelete(agent: any) {
  deleteTarget.value = agent
  showDeleteConfirm.value = true
}

async function toggleAgentEnabled(agent: any) {
  if (togglingAgent.value) return
  togglingAgent.value = agent.id
  const next = agent.enabled === false
  try {
    await api.agents.setEnabled(agent.id, next)
    agent.enabled = next
    toast.success(next ? `${agent.id} 已启用` : `${agent.id} 已禁用`)
  } catch (err: any) {
    toast.error(`切换失败: ${err.message}`)
  } finally {
    togglingAgent.value = ''
  }
}

async function submitDelete() {
  deleting.value = true
  try {
    await api.agents.remove(deleteTarget.value.id)
    toast.success(`Agent ${deleteTarget.value.id} 已删除`)
    showDeleteConfirm.value = false
    await load()
  } catch (err: any) {
    toast.error(`删除失败: ${err.message}`)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
/* Skeleton */
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
.skeleton-card { min-height: 160px; }
.skel { background: var(--border); border-radius: var(--radius-sm); animation: pulse 1.4s ease-in-out infinite; }
.skel-title { height: 20px; width: 60%; margin-bottom: var(--space-3); }
.skel-line { height: 14px; width: 90%; margin-bottom: var(--space-2); }
.skel-line.short { width: 50%; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }

.rich-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6) 0 var(--space-5);
}

.empty-icon { font-size: 28px; }
.empty-title { font-size: var(--text-md); color: var(--text-primary); }
.empty-desc { max-width: 420px; color: var(--text-secondary); line-height: 1.6; }

/* ── Agent grid ── */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--space-4);
}

.agent-card {
  background: var(--surface);
  border: 1px solid var(--tint-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}
.agent-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: rgba(99, 102, 241, 0.14);
}
.agent-active  { border-left: 3px solid #22c55e; }
.agent-inactive { border-left: 3px solid #94a3b8; opacity: 0.8; }

/* header */
.agent-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.agent-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(99,102,241,0.12), rgba(99,102,241,0.07));
  font-size: 20px;
  flex-shrink: 0;
}

.agent-meta { flex: 1; min-width: 0; }
.agent-id-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: 2px; }
.agent-id {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.agent-name {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* toggle */
.toggle-pill-sm {
  position: relative; width: 34px; height: 20px;
  border-radius: 10px; border: none; cursor: pointer;
  transition: background 180ms ease; padding: 0; flex-shrink: 0;
}
.toggle-pill-sm:disabled { opacity: 0.45; cursor: not-allowed; }
.toggle-sm-on  { background: #22c55e; }
.toggle-sm-off { background: var(--border-strong); }
.toggle-knob-sm {
  position: absolute; top: 3px; left: 3px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--surface); transition: transform 180ms ease; display: block;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.toggle-sm-on  .toggle-knob-sm { transform: translateX(14px); }
.toggle-sm-off .toggle-knob-sm { transform: translateX(0); }

/* info rows */
.agent-info { display: flex; flex-direction: column; gap: 6px; }
.info-row { display: flex; align-items: flex-start; gap: var(--space-2); }
.info-label {
  font-size: var(--text-xs); color: var(--text-muted);
  flex-shrink: 0; width: 52px; padding-top: 1px;
}
.info-value { font-size: var(--text-xs); color: var(--text-secondary); }
.info-value.mono { font-family: var(--font-mono); }
.info-value.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.info-value.muted { color: var(--text-muted); }
.today-hint { color: var(--text-muted); font-family: inherit; }

.binding-badges { display: flex; flex-wrap: wrap; gap: 4px; }

/* footer */
.agent-card-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
  margin-top: auto;
}

.required-mark { color: var(--error-text); margin-left: 2px; }
.form-error { font-size: var(--text-xs); color: var(--error-text); margin: 0; }

.delete-modal-hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--surface-2);
  border: 1px solid rgba(249,115,22,0.14);
}
.delete-modal-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(249,115,22,0.12);
  font-size: 20px;
  flex-shrink: 0;
}
.delete-modal-body-copy { min-width: 0; }
.delete-modal-title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--text-primary);
}
.delete-modal-desc {
  margin-top: 6px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.65;
}
.delete-modal-note {
  margin-top: var(--space-4);
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
  border: 1px solid var(--tint-medium);
}
.delete-note-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.delete-note-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-4);
}
.form-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}
</style>
