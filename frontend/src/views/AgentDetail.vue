<template>
  <div v-if="agent" class="agent-detail-page page-shell">
    <!-- Page header -->
    <div class="page-header">
      <div>
        <RouterLink to="/agents" class="agent-back-link">← Agent 列表</RouterLink>
        <h1 class="page-title">
          <span v-if="agent.identityEmoji" class="title-emoji">{{ agent.identityEmoji }}</span>
          {{ agent.identityName || agent.id }}
          <span v-if="agent.isDefault" class="badge badge-accent" style="vertical-align: middle; font-size: 12px; margin-left: 8px;">默认</span>
        </h1>
        <p class="subtitle">工作区：{{ agent.workspace }} · 渠道绑定 {{ agent.routes?.length ?? 0 }} 个</p>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="ui-tabbar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="ui-tab"
        :class="{ 'is-active': activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >{{ tab.label }}
        <span v-if="tab.key === 'skills' && agentSkills.length" class="tab-badge">{{ agentSkills.length }}</span>
      </button>
    </div>

    <!-- ── 概览 Tab ── -->
    <div v-if="activeTab === 'overview'" class="tab-content">
      <!-- Stats bar -->
      <div class="stats-bar" v-if="stats">
        <div class="stat-item">
          <span class="stat-label">会话数</span>
          <span class="stat-value">{{ stats.sessionCount }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-label">Token 输入</span>
          <span class="stat-value">{{ fmtTokens(stats.tokenInput) }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-label">Token 输出</span>
          <span class="stat-value">{{ fmtTokens(stats.tokenOutput) }}</span>
        </div>
        <div class="stat-divider" />
        <div class="stat-item">
          <span class="stat-label">最近活跃</span>
          <span class="stat-value">{{ stats.lastActive ? formatTime(stats.lastActive) : '—' }}</span>
        </div>
      </div>

      <section class="agent-section section-card">
        <h3 class="agent-section-title">基本信息</h3>
        <div class="agent-form-grid">
          <div class="form-group">
            <label class="form-label">Agent ID</label>
            <input class="form-input" :value="agent.id" readonly />
          </div>
          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" v-model="ovForm.name" placeholder="未设置" />
          </div>
          <div class="form-group">
            <label class="form-label">Emoji</label>
            <input class="form-input emoji-input" v-model="ovForm.emoji" placeholder="🤖" maxlength="8" />
          </div>
          <div class="form-group">
            <label class="form-label">工作区</label>
            <input class="form-input mono-input" :value="agent.workspace" readonly />
          </div>
        </div>
        <div class="enabled-row">
          <div class="enabled-info">
            <span class="form-label" style="margin:0">启用状态</span>
            <span class="enabled-hint">禁用后 Agent 不参与路由，但配置保留</span>
          </div>
          <div class="enabled-toggle-wrap">
            <span class="enabled-label" :class="ovForm.enabled ? 'label-on' : 'label-off'">
              {{ ovForm.enabled ? '已启用' : '已禁用' }}
            </span>
            <button
              class="toggle-pill"
              :class="ovForm.enabled ? 'toggle-on' : 'toggle-off'"
              :disabled="togglingEnabled"
              @click="toggleEnabled"
            >
              <span class="toggle-knob" />
            </button>
          </div>
        </div>
      </section>

      <section class="agent-section section-card">
        <h3 class="agent-section-title">模型配置</h3>
        <div class="form-group" style="max-width: 480px">
          <label class="form-label">主模型</label>
          <select v-if="modelOptions.length" class="form-select" v-model="ovForm.model">
            <option value="">使用默认</option>
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
          </select>
          <input v-else class="form-input" v-model="ovForm.model" placeholder="provider/model-id" />
        </div>

        <div class="form-group">
          <label class="form-label">备选模型</label>
          <div class="fallback-list">
            <div v-for="(fb, i) in ovForm.fallbacks" :key="i" class="fallback-row">
              <span class="fallback-index">{{ i + 1 }}</span>
              <select v-if="modelOptions.length" class="form-select" v-model="ovForm.fallbacks[i]">
                <option value="">（选择模型）</option>
                <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
              </select>
              <input v-else class="form-input" v-model="ovForm.fallbacks[i]" placeholder="provider/model-id" />
              <button class="fallback-remove" @click="ovForm.fallbacks.splice(i, 1)" title="移除">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <button class="fallback-add" @click="ovForm.fallbacks.push('')">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
              {{ ovForm.fallbacks.length === 0 ? '添加备选模型' : '再加一个' }}
            </button>
          </div>
          <p class="form-hint">主模型失败时按顺序切换到备选，留空表示没有备选</p>
        </div>

        <div class="form-group" style="max-width: 240px">
          <label class="form-label">思考强度</label>
          <select class="form-select" v-model="ovForm.thinking">
            <option value="">不设置</option>
            <option v-for="lv in thinkingLevels" :key="lv" :value="lv">{{ lv }}</option>
          </select>
        </div>
      </section>

      <section class="agent-section section-card">
        <h3 class="agent-section-title">Subagent 策略</h3>
        <p class="agent-section-desc">控制哪些 Agent 可以被此 Agent 调用（agent-to-agent 调用权限）。留空表示继承 <code>agents.defaults.subagents.allowAgents</code>。</p>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">
            允许调用 <span class="field-badge allow">{{ subagentsForm.allowAgents.length }}</span>
          </label>
          <ToolTagInput
            v-model="subagentsForm.allowAgents"
            variant="allow"
            placeholder="输入 Agent ID，Enter 确认…"
            :suggestions="agentSuggestions"
          />
          <p class="form-hint">填 <code>*</code> 放开所有；留空继承默认（未设则仅允许自身）</p>
        </div>
        <div style="margin-top: var(--space-3)">
          <button class="btn btn-sm btn-primary" :disabled="savingSubagents" @click="saveSubagents">
            {{ savingSubagents ? '保存中…' : '保存 Subagent 策略' }}
          </button>
        </div>
      </section>

      <div class="agent-save-bar">
        <button class="btn btn-primary" :disabled="savingOverview" @click="saveOverview">
          {{ savingOverview ? '保存中…' : '保存基本配置' }}
        </button>
      </div>
    </div>

    <!-- ── 数据 Tab ── -->
    <div v-if="activeTab === 'dashboard'" class="tab-content">
      <AgentDashboard :agent-id="agentId" :key="agentId" />
    </div>

    <!-- ── 聊天 Tab ── -->
    <div v-if="activeTab === 'chat'" class="tab-content">
      <AgentChatPanel
        :agent-id="agentId"
        :agent-name="agent.identityName || agent.id"
        :agent-emoji="agent.identityEmoji || '🤖'"
      />
    </div>

    <!-- ── 文件 Tab ── -->
    <div v-if="activeTab === 'files'" class="tab-content">
      <div v-if="filesLoading" class="skeleton-block"></div>
      <div v-else>
        <div v-for="file in files" :key="file.name" class="agent-file-card">
          <div class="agent-file-header">
            <div class="agent-file-info">
              <span class="agent-file-name">{{ file.name }}</span>
              <span class="agent-file-status" :class="file.exists ? 'file-exists' : 'file-missing'">
                {{ file.exists ? '已存在' : '未创建' }}
              </span>
            </div>
            <div class="agent-file-actions">
              <button
                class="btn btn-sm"
                :class="file.exists ? 'btn-secondary' : 'btn-primary'"
                @click="openFileEditor(file)"
              >{{ file.exists ? '编辑' : '创建' }}</button>
            </div>
          </div>
          <div v-if="file.desc" class="agent-file-desc">{{ file.desc }}</div>
          <div v-if="file.exists" class="agent-file-meta">
            {{ formatSize(file.size) }} · 更新于 {{ formatTime(file.mtime) }}
          </div>
        </div>
        <div v-if="files.length === 0" class="agent-hint">暂无文件</div>
      </div>
    </div>

    <!-- ── 工具 Tab ── -->
    <div v-if="activeTab === 'tools'" class="tab-content">
      <section class="agent-section section-card">
        <h3 class="agent-section-title">工具权限</h3>
        <p class="agent-section-desc">
          配置写入 <code class="inline-code">openclaw.json</code>，网关热重载，保存后立即生效。
        </p>

        <!-- Profile quick-select -->
        <div class="form-group">
          <label class="form-label">工具集 Profile</label>
          <div class="profile-pills">
            <button
              v-for="p in TOOL_PROFILES"
              :key="p.value"
              class="profile-pill"
              :class="toolsForm.profile === p.value && 'active'"
              @click="toolsForm.profile = toolsForm.profile === p.value ? '' : p.value"
            >
              <span class="pp-icon">{{ p.icon }}</span>
              <span class="pp-name">{{ p.name }}</span>
              <span class="pp-desc">{{ p.desc }}</span>
            </button>
          </div>
          <p class="form-hint">Profile 决定基础工具集；allow 可完全覆盖它，alsoAllow 在其上追加，deny 始终优先</p>
        </div>

        <!-- allow -->
        <div class="form-group">
          <label class="form-label">
            允许 <code class="inline-code">allow</code>
            <span class="field-badge allow">{{ toolsForm.allow.length }}</span>
          </label>
          <ToolTagInput
            v-model="toolsForm.allow"
            variant="allow"
            placeholder="搜索或输入工具名，Enter 确认…"
          />
          <p class="form-hint">完全替换 profile 的工具列表（留空则沿用 profile 默认值）</p>
        </div>

        <!-- alsoAllow -->
        <div class="form-group">
          <label class="form-label">
            追加允许 <code class="inline-code">alsoAllow</code>
            <span class="field-badge also">{{ toolsForm.alsoAllow.length }}</span>
          </label>
          <ToolTagInput
            v-model="toolsForm.alsoAllow"
            variant="also"
            placeholder="在 profile 基础上额外允许的工具…"
          />
          <p class="form-hint">不替换 profile，只在其上追加</p>
        </div>

        <!-- deny -->
        <div class="form-group">
          <label class="form-label">
            拒绝 <code class="inline-code">deny</code>
            <span class="field-badge deny">{{ toolsForm.deny.length }}</span>
          </label>
          <ToolTagInput
            v-model="toolsForm.deny"
            variant="deny"
            placeholder="始终禁止的工具，优先级最高…"
          />
          <p class="form-hint">deny 优先级高于所有 allow，无论 profile 如何设置</p>
        </div>
      </section>

      <div class="agent-save-bar">
        <button class="btn btn-primary" :disabled="savingTools" @click="saveTools">
          {{ savingTools ? '保存中…' : '保存工具配置' }}
        </button>
        <div class="check-row">
          <span class="check-icon" :class="toolsForm.profile || toolsForm.allow.length ? 'check-ok' : 'check-neutral'">
            {{ toolsForm.profile || toolsForm.allow.length ? '✓' : '○' }}
          </span>
          <span class="check-label">
            {{ toolsForm.profile ? `Profile: ${toolsForm.profile}` : '未设置 Profile（继承全局默认）' }}
          </span>
        </div>
      </div>
    </div>

    <!-- ── 技能 Tab ── -->
    <div v-if="activeTab === 'skills'" class="tab-content">
      <div v-if="skillsLoading" class="skeleton-block"></div>
      <template v-else>
        <section class="agent-section section-card">
          <h3 class="agent-section-title">技能管理</h3>
          <p class="agent-section-desc">此 Agent 工作区安装的技能（skills）。可从技能库部署或上传安装。</p>
          <div v-if="agentSkills.length === 0" class="agent-hint" style="padding: 12px 0">
            此 Agent 工作区暂无技能。前往
            <RouterLink to="/skills" class="inline-link">技能管理</RouterLink>
            安装。
          </div>
          <div v-else class="skill-list">
            <div v-for="skill in agentSkills" :key="skill.name" class="skill-card">
              <div class="skill-card-main">
                <div class="skill-name">{{ skill.name }}</div>
                <div v-if="skill.description" class="skill-desc">{{ skill.description }}</div>
              </div>
              <div class="skill-card-actions">
                <span class="skill-status" :class="skill.enabled ? 'skill-enabled' : 'skill-disabled'">
                  {{ skill.enabled ? '已启用' : '已禁用' }}
                </span>
                <button
                  class="btn btn-sm"
                  :class="skill.enabled ? 'btn-secondary' : 'btn-primary'"
                  :disabled="togglingSkill === skill.name"
                  @click="toggleSkill(skill)"
                >{{ skill.enabled ? '禁用' : '启用' }}</button>
              </div>
            </div>
          </div>
        </section>
        <div class="section-footer">
          <RouterLink to="/skills" class="btn btn-sm btn-secondary">前往技能库 →</RouterLink>
        </div>
      </template>
    </div>

    <!-- ── 渠道 Tab ── -->
    <div v-if="activeTab === 'channels'" class="tab-content">
      <div class="agent-section-header">
        <div>
          <h3 class="agent-section-title">渠道绑定</h3>
          <p class="agent-section-desc">此 Agent 绑定的接入渠道</p>
        </div>
        <button type="button" class="btn btn-sm btn-primary" @click="openChannelsBindingPage">管理渠道 →</button>
      </div>
      <div v-if="agent.routeBindings?.length" class="binding-list">
        <div v-for="binding in agent.routeBindings" :key="bindingCardKey(binding)" class="binding-card">
          <div class="binding-card-main">
            <span class="binding-channel">{{ formatBindingSummary(binding.match) }}</span>
            <div class="binding-meta-row">
              <span class="binding-type-badge">{{ binding.type === 'acp' ? 'ACP' : 'Route' }}</span>
              <span class="binding-meta mono">{{ binding.match.channel }}</span>
              <span v-if="binding.match.accountId" class="binding-meta mono">{{ binding.match.accountId }}</span>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-danger" @click="removeBinding(binding)">移除</button>
        </div>
      </div>
      <div v-else class="agent-hint">该 Agent 暂无渠道绑定</div>
    </div>

    <!-- File editor modal -->
    <Teleport to="body">
      <div v-if="editor.open" class="ui-modal-overlay" @click.self="editor.open = false" @keydown.esc="editor.open = false">
        <div class="ui-modal ui-modal-xl modal-editor">
          <div v-if="editor.loading" class="editor-loading">读取文件中…</div>
          <MarkdownEditor
            v-else
            v-model="editor.content"
            :filename="editor.filename"
            @save="saveFile"
          >
            <template #actions>
              <button class="btn btn-sm" @click="editor.open = false">取消</button>
              <button class="btn btn-sm btn-primary" :disabled="editor.saving" @click="saveFile">
                {{ editor.saving ? '保存中…' : '保存' }}
              </button>
            </template>
          </MarkdownEditor>
        </div>
      </div>
    </Teleport>
  </div>

  <div v-else-if="loading" class="empty-state">加载中…</div>
  <div v-else class="empty-state">Agent 不存在</div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import AgentChatPanel from '../components/AgentChatPanel.vue'
import ToolTagInput from '../components/ToolTagInput.vue'
import AgentDashboard from '../components/AgentDashboard.vue'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const TOOL_PROFILES = [
  { value: 'minimal',   icon: '🔒', name: 'minimal',   desc: '最小权限' },
  { value: 'coding',    icon: '💻', name: 'coding',    desc: '编码工具' },
  { value: 'messaging', icon: '💬', name: 'messaging', desc: '消息推送' },
  { value: 'full',      icon: '🚀', name: 'full',      desc: '全部工具' },
]

// 保持 agentId 与当前路由参数同步，避免详情页组件复用时继续读旧 ID。
const agentId = computed(() => String(route.params.id ?? ''))
const agent = ref<any>(null)
const loading = ref(true)

const tabs = [
  { key: 'overview',  label: '概览' },
  { key: 'dashboard', label: '数据' },
  { key: 'chat',      label: '聊天' },
  { key: 'files',     label: '文件' },
  { key: 'tools',     label: '工具' },
  { key: 'skills',    label: '技能' },
  { key: 'channels',  label: '渠道' },
]
const activeTab = ref('overview')

// Overview form
const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']
const modelProviders = ref<Record<string, any>>({})
const modelOptions = computed(() => {
  const opts: string[] = []
  for (const [pid, prov] of Object.entries(modelProviders.value)) {
    for (const m of (prov as any).models ?? []) {
      opts.push(`${pid}/${m.id}`)
    }
  }
  return opts
})

const ovForm = reactive({
  name: '',
  emoji: '',
  model: '',
  fallbacks: [] as string[],
  thinking: '',
  enabled: true,
})
const savingOverview = ref(false)
const togglingEnabled = ref(false)

// Stats
const stats = ref<{ sessionCount: number; tokenInput: number; tokenOutput: number; lastActive: number | null } | null>(null)

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// Files
const files = ref<any[]>([])
const filesLoading = ref(false)

// Subagents
const subagentsForm = reactive({ allowAgents: [] as string[] })
const subagentsLoaded = ref(false)
const savingSubagents = ref(false)
const agentSuggestions = ref<{ value: string; label: string }[]>([])

// Tools
const toolsForm = reactive({ profile: '', allow: [] as string[], alsoAllow: [] as string[], deny: [] as string[] })
const savingTools = ref(false)
const toolsLoaded = ref(false)

// Skills
const allSkills = ref<any[]>([])
const skillsLoading = ref(false)
const togglingSkill = ref('')
const agentSkills = computed(() => allSkills.value.filter(s => s.agent === agentId.value))
const editor = reactive({
  open: false,
  filename: '',
  content: '',
  loading: false,
  saving: false,
})

function switchTab(tab: string) {
  activeTab.value = tab
  if (tab === 'files' && files.value.length === 0 && !filesLoading.value) loadFiles()
  if (tab === 'tools' && !toolsLoaded.value) loadTools()
  if (tab === 'skills' && allSkills.value.length === 0 && !skillsLoading.value) loadSkills()
  if (tab === 'overview' && !subagentsLoaded.value) loadSubagents()
}

function formatRoute(r: string): string {
  const parts = r.split(':')
  return parts.length >= 2 ? `${parts[0]} · ${parts.slice(1).join(':')}` : r
}

function formatBindingSummary(match: Record<string, any>): string {
  const parts = [formatRoute(String(match.channel || ''))]
  if (match.accountId) parts.push(`账号 ${match.accountId}`)
  const peer = match.peer
  if (peer && typeof peer === 'object' && peer.id) {
    parts.push(`${peer.kind === 'group' ? '群聊' : '私聊'} ${peer.id}`)
  } else if (typeof peer === 'string' && peer) {
    parts.push(`私聊 ${peer}`)
  }
  return parts.join(' · ')
}

function bindingCardKey(binding: any): string {
  return JSON.stringify([binding.agentId || 'main', binding.type || 'route', binding.match || {}])
}

function extractBindingConfig(match: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  if (match.peer) result.peer = match.peer
  for (const [key, value] of Object.entries(match)) {
    if (key !== 'channel' && key !== 'accountId' && key !== 'peer') result[key] = value
  }
  return result
}

function openChannelsBindingPage() {
  router.push({
    path: '/channels',
    query: { tab: 'agents', action: 'bind', agent: agentId.value },
  })
}

async function removeBinding(binding: any) {
  const summary = formatBindingSummary(binding.match || {})
  if (!window.confirm(`确定移除绑定「${summary}」吗？`)) return
  try {
    await api.channels.deleteAgentBinding(
      agentId.value,
      binding.match?.channel,
      binding.match?.accountId || null,
      extractBindingConfig(binding.match || {}),
    )
    toast.success('绑定已移除')
    await loadAgent()
  } catch (err: any) {
    toast.error(err.message || '移除失败')
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function loadAgent() {
  if (!agentId.value) return
  loading.value = true
  try {
    const [a, modelsData] = await Promise.all([
      api.agents.get(agentId.value),
      api.models.list().catch(() => ({ providers: {}, primary: '', fallbacks: [] })),
    ])
    agent.value = a
    modelProviders.value = modelsData.providers
    // Populate overview form
    ovForm.name = a.identityName || ''
    ovForm.emoji = a.identityEmoji || ''
    if (typeof a.model === 'string') {
      ovForm.model = a.model
      ovForm.fallbacks = []
    } else if (a.model && typeof a.model === 'object') {
      ovForm.model = a.model.primary || ''
      ovForm.fallbacks = [...(a.model.fallbacks || [])]
    } else {
      ovForm.model = ''
      ovForm.fallbacks = []
    }
    ovForm.thinking = a.thinkingDefault || ''
    ovForm.enabled = a.enabled !== false
    // load stats in background (non-blocking)
    api.agents.stats(agentId.value).then(s => { stats.value = s }).catch(() => {})
    loadSubagents()
  } finally {
    loading.value = false
  }
}

async function loadFiles() {
  if (!agentId.value) return
  filesLoading.value = true
  try {
    files.value = await api.agents.listFiles(agentId.value)
  } finally {
    filesLoading.value = false
  }
}

async function loadTools() {
  if (!agentId.value) return
  try {
    const cfg = await api.agents.getTools(agentId.value)
    toolsForm.profile   = cfg.profile ?? ''
    toolsForm.allow     = cfg.allow     ?? []
    toolsForm.alsoAllow = cfg.alsoAllow ?? []
    toolsForm.deny      = cfg.deny      ?? []
    toolsLoaded.value = true
  } catch {}
}

async function saveTools() {
  savingTools.value = true
  try {
    await api.agents.saveTools(agentId.value, {
      profile:    toolsForm.profile    || undefined,
      allow:      toolsForm.allow.length     ? toolsForm.allow     : undefined,
      alsoAllow:  toolsForm.alsoAllow.length ? toolsForm.alsoAllow : undefined,
      deny:       toolsForm.deny.length      ? toolsForm.deny      : undefined,
    })
    toast.success('工具配置已保存')
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    savingTools.value = false
  }
}

async function loadSkills() {
  skillsLoading.value = true
  try {
    allSkills.value = await api.skills.list()
  } catch {}
  finally {
    skillsLoading.value = false
  }
}

async function toggleSkill(skill: any) {
  togglingSkill.value = skill.name
  try {
    if (skill.enabled) {
      await api.skills.disable(skill.name, agentId.value)
    } else {
      await api.skills.enable(skill.name, agentId.value)
    }
    await loadSkills()
    toast.success(skill.enabled ? `${skill.name} 已禁用` : `${skill.name} 已启用`)
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    togglingSkill.value = ''
  }
}

async function saveOverview() {
  savingOverview.value = true
  try {
    const nameChanged = ovForm.name !== (agent.value?.identityName || '')
    const emojiChanged = ovForm.emoji !== (agent.value?.identityEmoji || '')
    if (nameChanged || emojiChanged) {
      await api.agents.updateIdentity(agentId.value, ovForm.name || undefined, ovForm.emoji || undefined)
    }

    const currentModelPrimary = typeof agent.value?.model === 'string'
      ? agent.value.model
      : (agent.value?.model as any)?.primary || ''
    const currentFallbacks: string[] = typeof agent.value?.model === 'object'
      ? ((agent.value?.model as any)?.fallbacks ?? [])
      : []
    const cleanFallbacks = ovForm.fallbacks.filter(Boolean)
    const modelChanged = ovForm.model !== currentModelPrimary
    const fallbacksChanged = JSON.stringify(cleanFallbacks) !== JSON.stringify(currentFallbacks)
    if (modelChanged || fallbacksChanged) {
      await api.agents.updateModel(agentId.value, ovForm.model || undefined, cleanFallbacks.length ? cleanFallbacks : undefined)
    }

    const thinkingChanged = ovForm.thinking !== (agent.value?.thinkingDefault || '')
    if (thinkingChanged) {
      await api.agents.updateThinking(agentId.value, ovForm.thinking || undefined)
    }

    toast.success('已保存')
    await loadAgent()
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    savingOverview.value = false
  }
}

async function loadSubagents() {
  if (!agentId.value || subagentsLoaded.value) return
  try {
    const [p, agents] = await Promise.all([
      api.agents.getSubagents(agentId.value),
      api.agents.list().catch(() => [] as any[]),
    ])
    subagentsForm.allowAgents = p.allowAgents ?? []
    agentSuggestions.value = (agents ?? [])
      .map((a: any) => {
        const id = String(a.id ?? '')
        const name = String(a.identityName ?? '')
        const emoji = String(a.identityEmoji ?? '').trim() || '🤖'
        const label = name || id
        return { value: id, label, icon: emoji }
      })
      .filter(a => a.value && a.value !== agentId.value)
    subagentsLoaded.value = true
  } catch {}
}

async function saveSubagents() {
  savingSubagents.value = true
  try {
    await api.agents.saveSubagents(agentId.value, {
      allowAgents: subagentsForm.allowAgents.length ? subagentsForm.allowAgents : undefined,
    })
    toast.success('Subagent 策略已保存')
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    savingSubagents.value = false
  }
}

async function toggleEnabled() {
  togglingEnabled.value = true
  const next = !ovForm.enabled
  try {
    await api.agents.setEnabled(agentId.value, next)
    ovForm.enabled = next
    toast.success(next ? 'Agent 已启用' : 'Agent 已禁用')
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    togglingEnabled.value = false
  }
}

async function openFileEditor(file: any) {
  // Open modal immediately, load content async
  editor.filename = file.name
  editor.content = ''
  editor.loading = true
  editor.saving = false
  editor.open = true

  try {
    const res = await api.agents.readFile(agentId.value, file.name)
    editor.content = res.content || ''
  } catch (e: any) {
    toast.error('读取文件失败: ' + e.message)
    editor.open = false
    return
  } finally {
    editor.loading = false
  }
}

async function saveFile() {
  if (editor.saving || editor.loading) return
  editor.saving = true
  try {
    await api.agents.saveFile(agentId.value, editor.filename, editor.content)
    toast.success(`${editor.filename} 已保存`)
    editor.open = false
    await loadFiles()
  } catch (err: any) {
    toast.error(err.message)
  } finally {
    editor.saving = false
  }
}

// 切换到其他 Agent 时先清空瞬态状态，避免上一位 Agent 的文件/技能残留在页面上。
function resetAgentState() {
  agent.value = null
  loading.value = true
  activeTab.value = 'overview'
  togglingEnabled.value = false
  ovForm.enabled = true
  stats.value = null
  files.value = []
  filesLoading.value = false
  allSkills.value = []
  skillsLoading.value = false
  togglingSkill.value = ''
  toolsLoaded.value = false
  toolsForm.profile   = ''
  toolsForm.allow     = []
  toolsForm.alsoAllow = []
  toolsForm.deny      = []
  subagentsForm.allowAgents = []
  subagentsLoaded.value = false
  editor.open = false
  editor.filename = ''
  editor.content = ''
  editor.loading = false
  editor.saving = false
}

// 首次进入和同页切换 Agent 都走同一套加载流程，避免路由复用导致状态不刷新。
watch(
  () => route.params.id,
  async (nextId, prevId) => {
    if (!nextId) return
    if (nextId !== prevId) resetAgentState()
    await loadAgent()
  },
  { immediate: true },
)
</script>

<style scoped>
.agent-detail-page { display: flex; flex-direction: column; gap: var(--space-4); }

.agent-back-link {
  display: inline-block;
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-decoration: none;
  margin-bottom: var(--space-2);
}
.agent-back-link:hover { color: var(--accent); }

.page-title { font-size: var(--text-xl); font-weight: 700; display: flex; align-items: center; gap: 6px; }
.title-emoji { font-size: 1.1em; }

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 9px 18px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s, border-color .15s;
  user-select: none;
}
.tab:hover { color: var(--text-primary); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.tab-content { display: flex; flex-direction: column; gap: var(--space-4); padding-top: var(--space-2); }

/* Sections */
.agent-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.agent-section-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.agent-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}

.agent-section-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin: 4px 0 0;
}

.agent-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.emoji-input { max-width: 80px; font-size: 18px; }
.mono-input { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }

/* Fallbacks */
.fallback-list { display: flex; flex-direction: column; gap: 6px; }
.fallback-row { display: flex; gap: 8px; align-items: center; }
.fallback-row .form-input { flex: 1; }

.agent-hint { font-size: var(--text-sm); color: var(--text-muted); padding: 4px 0; }

/* ── Fallback model list ─────────────────────────────────────── */
.fallback-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.fallback-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.fallback-row .form-select,
.fallback-row .form-input { flex: 1; }
.fallback-index {
  flex-shrink: 0;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}
.fallback-remove {
  flex-shrink: 0;
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.fallback-remove:hover {
  border-color: var(--error-text);
  color: var(--error-text);
  background: var(--error-bg);
}
.fallback-add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.fallback-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-subtle);
  border-style: solid;
}

/* Save bar */
.agent-save-bar {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}

/* File cards */
.agent-file-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.agent-file-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.agent-file-name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.agent-file-status {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 8px;
  border-radius: var(--radius-full);
}
.file-exists { background: var(--success-bg); color: var(--success-text); }
.file-missing { background: var(--surface-2); color: var(--text-muted); }

.agent-file-desc { font-size: var(--text-xs); color: var(--text-muted); }
.agent-file-meta { font-size: 11px; color: var(--text-muted); }
.agent-file-actions { flex-shrink: 0; }

/* Channels */
.binding-list { display: flex; flex-direction: column; gap: var(--space-2); }
.binding-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.binding-card-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.binding-channel { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text-primary); }
.binding-meta-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.binding-meta { font-size: var(--text-xs); color: var(--text-muted); }
.binding-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  background: rgba(99, 102, 241, 0.08);
  color: var(--accent-text);
}

/* Skeleton */
.skeleton-block {
  height: 180px;
  background: var(--surface-2);
  border-radius: var(--radius);
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: .5; }
}

/* Editor modal */
.modal-editor {
  min-width: unset;
  max-width: 900px;
  width: 92vw;
  height: 82vh;
  max-height: 82vh;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: var(--space-8);
}


.btn-secondary { background: var(--surface-2); color: var(--text-primary); border: 1px solid var(--border); }
.btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

/* Tab badge */
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  margin-left: 4px;
  vertical-align: middle;
}

/* Tool profiles */
.profile-pills {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.profile-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: var(--space-3) var(--space-2);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: pointer;
  transition: border-color .15s, background .15s;
  text-align: center;
}
.profile-pill:hover { border-color: var(--accent); }
.profile-pill.active { border-color: var(--accent); background: var(--accent-bg, rgba(99,102,241,.08)); }
.pp-icon  { font-size: 18px; }
.pp-name  { font-size: 12px; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); }
.pp-desc  { font-size: 10px; color: var(--text-muted); }

/* field badge (count indicator) */
.field-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px; font-weight: 700;
  margin-left: 6px;
  vertical-align: middle;
}
.field-badge.allow { background: #dcfce7; color: var(--success-text); }
.field-badge.also  { background: #dbeafe; color: var(--accent-text); }
.field-badge.deny  { background: #fee2e2; color: var(--error-text); }

.form-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* Skills */
.skill-list { display: flex; flex-direction: column; gap: var(--space-2); }
.skill-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 12px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.skill-card-main { flex: 1; min-width: 0; }
.skill-name { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
.skill-desc { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; word-break: break-all; }
.skill-card-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.skill-status { font-size: 10px; font-weight: 500; padding: 1px 8px; border-radius: var(--radius-full); }
.skill-enabled  { background: var(--success-bg); color: var(--success-text); }
.skill-disabled { background: var(--surface-2); color: var(--text-muted); }

.section-footer { padding-top: var(--space-2); }
.inline-link { color: var(--accent); text-decoration: none; }
.inline-link:hover { text-decoration: underline; }

.inline-code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
}
.help-link {
  color: var(--accent);
  text-decoration: none;
  font-size: 11px;
  margin-left: 6px;
}
.help-link:hover { text-decoration: underline; }

/* Stats bar */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  gap: 2px;
}
.stat-label { font-size: 11px; color: var(--text-muted); }
.stat-value { font-size: var(--text-md); font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.stat-divider { width: 1px; height: 36px; background: var(--border); flex-shrink: 0; }

/* Enabled toggle row */
.enabled-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-2);
  border-radius: var(--radius);
  margin-top: var(--space-2);
  gap: var(--space-4);
}
.enabled-info { display: flex; flex-direction: column; gap: 2px; }
.enabled-hint { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.enabled-toggle-wrap { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.enabled-label { font-size: var(--text-xs); font-weight: 600; }
.label-on  { color: #22c55e; }
.label-off { color: var(--text-muted); }

.toggle-pill {
  position: relative;
  width: 40px; height: 22px;
  border-radius: 11px;
  border: none;
  cursor: pointer;
  transition: background .2s;
  padding: 0;
  flex-shrink: 0;
}
.toggle-pill:disabled { opacity: 0.5; cursor: not-allowed; }
.toggle-on  { background: #22c55e; }
.toggle-off { background: var(--border); }
.toggle-knob {
  position: absolute;
  top: 3px; left: 3px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform .2s;
  display: block;
  box-shadow: 0 1px 3px rgba(0,0,0,.2);
}
.toggle-on .toggle-knob  { transform: translateX(18px); }
.toggle-off .toggle-knob { transform: translateX(0); }

.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-xs);
  padding: var(--space-2) 0;
}
.check-icon { font-size: 14px; font-weight: 700; }
.check-ok { color: #22c55e; }
.check-neutral { color: var(--text-muted); }
.check-label { color: var(--text-secondary); }
</style>
