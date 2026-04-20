<template>
  <div class="page-shell">
    <div class="page-header">
      <div>
        <h1 class="page-title">MCP 服务</h1>
        <p class="subtitle">
          Model Context Protocol —— 为 Agent 接入文件系统、知识图谱、GitHub、浏览器等外部能力
        </p>
      </div>
      <div class="header-actions">
        <n-button size="small" @click="load" :loading="loading">刷新</n-button>
        <n-button type="primary" @click="openNewDialog">+ 添加 MCP Server</n-button>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">已配置</div>
        <div class="metric-value">{{ servers.length }}</div>
        <div class="metric-meta">MCP servers 总数</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">启用中</div>
        <div class="metric-value">{{ enabledCount }}</div>
        <div class="metric-meta">未标记为 disabled 的 server</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">传输类型</div>
        <div class="metric-value metric-value-sm">{{ transportSummary }}</div>
        <div class="metric-meta">stdio · http / sse 分布</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">最近测试</div>
        <div class="metric-value metric-value-sm">{{ lastTestLabel }}</div>
        <div class="metric-meta">最近一次连通性测试结果</div>
      </div>
    </div>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">Server 列表</h2>
        <p class="section-desc">
          每个 server 是一个独立的外部能力进程或 URL，配置保存在 ~/.openclaw/openclaw.json 的 mcp.servers 字段
        </p>
      </div>

      <div v-if="loading && !servers.length" class="empty-state">加载中…</div>
      <div v-else-if="!servers.length" class="empty-state rich-empty">
        <div class="empty-icon">🔌</div>
        <h3 class="empty-title">暂无 MCP server</h3>
        <p class="empty-desc">从模板快速添加，或手动填写 command/args</p>
        <div class="template-grid">
          <button
            v-for="t in templates"
            :key="t.name"
            class="template-card"
            @click="openTemplateDialog(t)"
          >
            <div class="template-category">{{ t.category }}</div>
            <div class="template-name mono">{{ t.name }}</div>
            <div class="template-desc">{{ t.description }}</div>
          </button>
        </div>
      </div>

      <div v-else class="server-grid">
        <div v-for="s in servers" :key="s.name" class="mcp-card">
          <div class="mcp-card-head">
            <div class="mcp-card-name">
              <span class="mcp-name mono">{{ s.name }}</span>
              <span :class="['transport-badge', `transport-${s.transport}`]">{{ s.transport }}</span>
              <span v-if="s.disabled" class="badge badge-muted">已禁用</span>
            </div>
            <div class="mcp-card-actions">
              <button class="icon-btn" @click="testServer(s)" :disabled="testing[s.name]" title="测试连通">
                <svg v-if="!testing[s.name]" width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" class="spin">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-dasharray="40 20" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="icon-btn" @click="openEditDialog(s)" title="编辑">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="icon-btn icon-btn-danger" @click="confirmDelete(s)" title="删除">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 4h10M6 4V2h4v2M5 4v10h6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="s.description" class="mcp-description">{{ s.description }}</div>

          <div v-if="s.command" class="mcp-cmd mono">
            <span class="mcp-cmd-label">$</span>
            <code>{{ s.command }}{{ s.args.length ? ' ' + s.args.join(' ') : '' }}</code>
          </div>
          <div v-if="s.url" class="mcp-cmd mono">
            <span class="mcp-cmd-label">🌐</span>
            <code>{{ s.url }}</code>
          </div>

          <div v-if="Object.keys(s.env).length" class="mcp-env">
            <div class="mcp-env-label">环境变量</div>
            <div class="mcp-env-list">
              <span v-for="(v, k) in s.env" :key="k" class="mcp-env-chip mono">
                {{ k }}={{ v ? '●●●●' : '(empty)' }}
              </span>
            </div>
          </div>

          <div class="mcp-agents-row">
            <span class="mcp-env-label">允许 Agent</span>
            <template v-if="!s.allowedAgents?.length">
              <span class="agents-all">全部 Agent 可用</span>
            </template>
            <template v-else>
              <span v-for="id in s.allowedAgents" :key="id" class="agent-chip mono">{{ id }}</span>
            </template>
            <span v-if="s.allowedAgents?.length" class="agent-note">
              （约定字段，gateway 当前仍全局加载）
            </span>
          </div>

          <div v-if="testResults[s.name]" :class="['mcp-result', testResults[s.name].ok ? 'result-ok' : 'result-fail']">
            <div class="mcp-result-head">
              {{ testResults[s.name].ok ? '✓ 连通' : '✗ 未通' }}
              <span v-if="testResults[s.name].note" class="mcp-result-note">{{ testResults[s.name].note }}</span>
              <span v-if="testResults[s.name].error" class="mcp-result-note">{{ testResults[s.name].error }}</span>
            </div>
            <details v-if="testResults[s.name].stdout || testResults[s.name].stderr" class="mcp-result-detail">
              <summary>输出详情</summary>
              <pre v-if="testResults[s.name].stdout" class="mcp-result-out">{{ testResults[s.name].stdout }}</pre>
              <pre v-if="testResults[s.name].stderr" class="mcp-result-err">{{ testResults[s.name].stderr }}</pre>
            </details>
          </div>
        </div>
      </div>

      <div v-if="servers.length && templates.length" class="templates-section">
        <div class="templates-title">从模板添加</div>
        <div class="template-grid">
          <button
            v-for="t in templates"
            :key="t.name"
            class="template-card"
            @click="openTemplateDialog(t)"
            :disabled="servers.some(s => s.name === t.name)"
          >
            <div class="template-category">{{ t.category }}</div>
            <div class="template-name mono">{{ t.name }}</div>
            <div class="template-desc">{{ t.description }}</div>
          </button>
        </div>
      </div>
    </section>

    <!-- Reverse: expose OpenClaw as MCP server -->
    <section v-if="serveInfo" class="section-card">
      <div class="section-header">
        <h2 class="section-title">把 OpenClaw 暴露为 MCP Server</h2>
        <p class="section-desc">
          外部 MCP 客户端（Claude Desktop、Cursor、Continue）可通过
          <code class="mono">openclaw mcp serve</code> 调用 OpenClaw 的 channel 能力。下面是复制即用的配置片段。
        </p>
      </div>

      <div class="serve-cli">
        <span class="serve-cli-label">命令行</span>
        <code class="mono">{{ serveInfo.commandLine }}</code>
        <button class="copy-btn" @click="copy(serveInfo.commandLine, 'cli')">
          {{ copied === 'cli' ? '已复制' : '复制' }}
        </button>
        <button class="copy-btn btn-verify" @click="verifyServe" :disabled="verifying">
          {{ verifying ? '自检中…' : '自检 serve' }}
        </button>
      </div>

      <div v-if="verifyResult" :class="['serve-verify-result', verifyResult.ok ? 'result-ok' : 'result-fail']">
        <div class="verify-head">
          <span class="verify-badge">{{ verifyResult.ok ? '✓ serve 正常' : '✗ serve 失败' }}</span>
          <span v-if="verifyResult.ok && verifyResult.serverInfo" class="verify-note">
            {{ verifyResult.serverInfo.name }} {{ verifyResult.serverInfo.version }} · 协议 {{ verifyResult.protocolVersion }}
          </span>
          <span v-if="!verifyResult.ok" class="verify-note">{{ verifyResult.error }}</span>
        </div>

        <div v-if="verifyResult.ok && verifyResult.tools?.length" class="verify-tools">
          <div class="verify-section-label">暴露的 {{ verifyResult.tools.length }} 个工具</div>
          <div class="verify-tool-grid">
            <div v-for="t in verifyResult.tools" :key="t.name" class="verify-tool-chip" :title="t.description">
              <code class="mono">{{ t.name }}</code>
            </div>
          </div>
        </div>

        <details v-if="verifyResult.stderr" class="verify-details">
          <summary>stderr 输出（{{ (verifyResult.stderr || '').length }} 字节）</summary>
          <pre class="verify-stderr mono">{{ verifyResult.stderr }}</pre>
        </details>
      </div>

      <div class="serve-client-grid">
        <div v-for="entry in clientEntries" :key="entry[0]" class="serve-client">
          <div class="serve-client-head">
            <span class="serve-client-name">{{ clientLabels[entry[0]] || entry[0] }}</span>
            <span class="serve-client-path mono">{{ entry[1].path }}</span>
          </div>
          <pre class="serve-json mono">{{ JSON.stringify(entry[1].json, null, 2) }}</pre>
          <button class="copy-btn" @click="copy(JSON.stringify(entry[1].json, null, 2), entry[0])">
            {{ copied === entry[0] ? '已复制' : '复制配置' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Add/Edit Dialog -->
    <Teleport to="body">
      <div v-if="dialog.open" class="ui-modal-overlay" @click.self="dialog.open = false">
        <div class="ui-modal ui-modal-md" role="dialog">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">{{ dialog.mode === 'edit' ? '编辑' : '添加' }} MCP Server</div>
              <div class="ui-modal-subtitle">{{ dialog.form.name || '未命名' }}</div>
            </div>
            <button class="ui-modal-close" @click="dialog.open = false">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="form-group">
              <label class="form-label">名称 <span class="required-mark">*</span></label>
              <n-input v-model:value="dialog.form.name" placeholder="filesystem" :disabled="dialog.mode === 'edit'" />
              <p class="form-hint">必须以字母开头，只含字母/数字/-/_</p>
            </div>
            <div class="form-group">
              <label class="form-label">传输类型</label>
              <n-radio-group v-model:value="dialog.form.transport">
                <n-radio value="stdio">stdio（子进程）</n-radio>
                <n-radio value="http">HTTP / SSE（远程）</n-radio>
              </n-radio-group>
            </div>
            <template v-if="dialog.form.transport === 'stdio'">
              <div class="form-group">
                <label class="form-label">命令 <span class="required-mark">*</span></label>
                <n-input v-model:value="dialog.form.command" placeholder="npx / node / uvx ..." />
              </div>
              <div class="form-group">
                <label class="form-label">参数（每行一个）</label>
                <n-input
                  v-model:value="dialog.form.argsText"
                  type="textarea"
                  placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/tmp"
                  :autosize="{ minRows: 3, maxRows: 8 }"
                />
              </div>
            </template>
            <template v-else>
              <div class="form-group">
                <label class="form-label">URL <span class="required-mark">*</span></label>
                <n-input v-model:value="dialog.form.url" placeholder="https://example.com/mcp" />
              </div>
            </template>
            <div class="form-group">
              <label class="form-label">环境变量（KEY=VALUE，每行一个）</label>
              <n-input
                v-model:value="dialog.form.envText"
                type="textarea"
                placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx"
                :autosize="{ minRows: 2, maxRows: 6 }"
              />
            </div>
            <div class="form-group">
              <label class="form-label">工作目录 (cwd)</label>
              <n-input v-model:value="dialog.form.cwd" placeholder="默认 $HOME" />
            </div>
            <div class="form-group">
              <label class="form-label">描述</label>
              <n-input v-model:value="dialog.form.description" placeholder="可选，仅 portal 展示用" />
            </div>
            <div class="form-group">
              <label class="form-label">允许的 Agent</label>
              <p class="form-hint" style="margin-top:-4px; margin-bottom:6px">
                留空 = 全部 Agent 可用。当前是 portal 层的约定字段，gateway 未来升级后生效。
              </p>
              <div class="agent-picker">
                <label v-for="a in availableAgents" :key="a.id" class="agent-pick-item">
                  <input
                    type="checkbox"
                    :checked="dialog.form.allowedAgents.includes(a.id)"
                    @change="toggleAgent(a.id)"
                  />
                  <span class="mono">{{ a.id }}</span>
                  <small v-if="a.identityName" class="agent-pick-name">· {{ a.identityName }}</small>
                </label>
                <div v-if="!availableAgents.length" class="agent-pick-empty">没有可用 Agent</div>
              </div>
            </div>
            <div class="form-group">
              <n-checkbox v-model:checked="dialog.form.disabled">暂时禁用此 server</n-checkbox>
            </div>
          </div>
          <div class="ui-modal-footer">
            <n-button @click="dialog.open = false">取消</n-button>
            <n-button type="primary" :loading="dialog.saving" @click="saveDialog">
              {{ dialog.saving ? '保存中…' : '保存' }}
            </n-button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Delete Confirm -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="ui-modal-overlay" @click.self="deleteTarget = null">
        <div class="ui-modal ui-modal-sm" role="dialog">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">删除 MCP Server</div>
            </div>
          </div>
          <div class="ui-modal-body">
            确认删除 <code class="mono">{{ deleteTarget.name }}</code>？此操作会从 openclaw.json 移除配置。
          </div>
          <div class="ui-modal-footer">
            <n-button @click="deleteTarget = null">取消</n-button>
            <n-button type="error" :loading="deleting" @click="performDelete">删除</n-button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { NButton, NInput, NRadio, NRadioGroup, NCheckbox } from 'naive-ui'
import { api } from '../api/client.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'

const toast = useNaiveToast()

const loading = ref(false)
const servers = ref<any[]>([])
const templates = ref<any[]>([])
const testing = reactive<Record<string, boolean>>({})
const testResults = reactive<Record<string, any>>({})

const enabledCount = computed(() => servers.value.filter(s => !s.disabled).length)
const transportSummary = computed(() => {
  const counts: Record<string, number> = {}
  for (const s of servers.value) counts[s.transport] = (counts[s.transport] ?? 0) + 1
  const parts = Object.entries(counts).map(([k, v]) => `${k} ${v}`)
  return parts.join(' · ') || '—'
})
const lastTestLabel = computed(() => {
  const keys = Object.keys(testResults)
  if (!keys.length) return '—'
  const last = testResults[keys[keys.length - 1]]
  return last.ok ? '✓ 通' : '✗ 失败'
})

// ── Dialog state ──────────────────────────────────────────
const deleteTarget = ref<any | null>(null)
const deleting = ref(false)

interface DialogForm {
  name: string
  transport: 'stdio' | 'http'
  command: string
  argsText: string
  url: string
  envText: string
  cwd: string
  description: string
  disabled: boolean
  allowedAgents: string[]
}
const dialog = reactive({
  open: false,
  mode: 'new' as 'new' | 'edit',
  saving: false,
  form: freshForm(),
})
function freshForm(): DialogForm {
  return { name: '', transport: 'stdio', command: '', argsText: '', url: '', envText: '', cwd: '', description: '', disabled: false, allowedAgents: [] }
}

const availableAgents = ref<any[]>([])
function toggleAgent(id: string) {
  const idx = dialog.form.allowedAgents.indexOf(id)
  if (idx >= 0) dialog.form.allowedAgents.splice(idx, 1)
  else dialog.form.allowedAgents.push(id)
}

function openNewDialog() {
  dialog.mode = 'new'
  dialog.form = freshForm()
  dialog.open = true
}
function openTemplateDialog(t: any) {
  dialog.mode = 'new'
  dialog.form = freshForm()
  dialog.form.name = t.name
  dialog.form.command = t.command ?? ''
  dialog.form.argsText = (t.args ?? []).join('\n')
  dialog.form.description = t.description ?? ''
  if (t.env) dialog.form.envText = Object.entries(t.env).map(([k, v]) => `${k}=${v}`).join('\n')
  if (t.url) { dialog.form.transport = 'http'; dialog.form.url = t.url }
  dialog.open = true
}
function openEditDialog(s: any) {
  dialog.mode = 'edit'
  dialog.form = {
    name: s.name,
    transport: s.url ? 'http' : 'stdio',
    command: s.command ?? '',
    argsText: (s.args ?? []).join('\n'),
    url: s.url ?? '',
    envText: Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    cwd: s.cwd ?? '',
    description: s.description ?? '',
    disabled: Boolean(s.disabled),
    allowedAgents: Array.isArray(s.allowedAgents) ? [...s.allowedAgents] : [],
  }
  dialog.open = true
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1)
  }
  return out
}

async function saveDialog() {
  const f = dialog.form
  if (!f.name) return toast.error('请填写名称')
  if (f.transport === 'stdio' && !f.command) return toast.error('stdio 模式需要命令')
  if (f.transport === 'http' && !f.url) return toast.error('HTTP 模式需要 URL')

  dialog.saving = true
  try {
    const body: any = {
      transport: f.transport,
      env: parseEnv(f.envText),
      disabled: f.disabled,
    }
    if (f.transport === 'stdio') {
      body.command = f.command
      body.args = f.argsText.split('\n').map(s => s.trim()).filter(Boolean)
    } else {
      body.url = f.url
    }
    if (f.cwd) body.cwd = f.cwd
    if (f.description) body.description = f.description
    body.allowedAgents = f.allowedAgents

    await api.mcp.save(f.name, body)
    toast.success(dialog.mode === 'edit' ? '已更新' : '已添加')
    dialog.open = false
    await load()
  } catch (e: any) {
    toast.error(`保存失败: ${e.message}`)
  } finally {
    dialog.saving = false
  }
}

function confirmDelete(s: any) { deleteTarget.value = s }
async function performDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.mcp.remove(deleteTarget.value.name)
    toast.success('已删除')
    deleteTarget.value = null
    await load()
  } catch (e: any) {
    toast.error(`删除失败: ${e.message}`)
  } finally {
    deleting.value = false
  }
}

async function testServer(s: any) {
  testing[s.name] = true
  try {
    const res = await api.mcp.test(s.name)
    testResults[s.name] = res
  } catch (e: any) {
    testResults[s.name] = { ok: false, error: e.message, transport: s.transport }
  } finally {
    testing[s.name] = false
  }
}

const serveInfo = ref<any>(null)
const copied = ref<string | null>(null)
const verifying = ref(false)
const verifyResult = ref<any | null>(null)

async function verifyServe() {
  verifying.value = true
  verifyResult.value = null
  try {
    const res = await api.mcp.serveVerify()
    verifyResult.value = res
    if (res.ok) toast.success(`serve 正常，暴露 ${res.tools?.length ?? 0} 个工具`)
    else toast.error(`自检失败：${res.error}`)
  } catch (e: any) {
    verifyResult.value = { ok: false, error: e.message }
    toast.error(`自检失败：${e.message}`)
  } finally {
    verifying.value = false
  }
}
const clientEntries = computed<Array<[string, any]>>(() =>
  serveInfo.value?.clients ? Object.entries(serveInfo.value.clients) : [],
)
const clientLabels: Record<string, string> = {
  claudeDesktop: 'Claude Desktop',
  cursor: 'Cursor',
  continue: 'Continue',
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = null }, 1500)
  } catch {
    toast.error('复制失败，请手动选中')
  }
}

async function load() {
  loading.value = true
  try {
    const [list, tpl, agentList, info] = await Promise.all([
      api.mcp.list(),
      api.mcp.templates(),
      api.agents.list().catch(() => []),
      api.mcp.serveInfo().catch(() => null),
    ])
    servers.value = list.servers
    templates.value = tpl.templates
    availableAgents.value = agentList
    serveInfo.value = info
  } catch (e: any) {
    toast.error(`加载失败: ${e.message}`)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.metric-value-sm { font-size: var(--text-md); font-weight: 700; }

.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--space-4);
}

.mcp-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-4);
  background: var(--card-fill);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.mcp-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.mcp-card-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mcp-name { font-size: var(--text-md); font-weight: 700; color: var(--text-primary); }
.transport-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--surface-2);
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.transport-stdio { background: color-mix(in srgb, #6366f1 12%, var(--surface-2)); color: var(--accent); }
.transport-http  { background: color-mix(in srgb, #10b981 12%, var(--surface-2)); color: #10b981; }
.transport-sse   { background: color-mix(in srgb, #06b6d4 12%, var(--surface-2)); color: #06b6d4; }

.mcp-card-actions { display: flex; gap: 4px; }
.icon-btn {
  width: 26px; height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
}
.icon-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-subtle); }
.icon-btn-danger:hover { border-color: var(--error-text); color: var(--error-text); background: var(--error-bg); }
.icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.mcp-description {
  font-size: 12px;
  color: var(--text-secondary);
}
.mcp-cmd {
  display: flex;
  gap: 8px;
  font-size: 11px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: 6px;
  overflow-x: auto;
}
.mcp-cmd-label { color: var(--text-muted); flex-shrink: 0; }
.mcp-cmd code {
  color: var(--text-primary);
  white-space: nowrap;
}

.mcp-env-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.mcp-env-list { display: flex; flex-wrap: wrap; gap: 4px; }
.mcp-env-chip {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text-secondary);
}

.mcp-result {
  font-size: 11px;
  padding: 8px 10px;
  border-radius: 6px;
  border-left: 3px solid transparent;
}
.result-ok   { background: var(--success-bg); color: var(--success-text); border-left-color: var(--success-text); }
.result-fail { background: var(--error-bg);   color: var(--error-text);   border-left-color: var(--error-text); }
.mcp-result-head { font-weight: 600; }
.mcp-result-note { font-weight: 400; opacity: 0.85; margin-left: 6px; }
.mcp-result-detail { margin-top: 4px; }
.mcp-result-detail summary { cursor: pointer; }
.mcp-result-out, .mcp-result-err {
  margin: 6px 0 0;
  padding: 6px 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  background: var(--surface);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 140px;
  overflow-y: auto;
}

/* Templates */
.templates-section { margin-top: var(--space-5); padding-top: var(--space-5); border-top: 1px dashed var(--border); }
.templates-title { font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; }
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.template-card {
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.template-card:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-subtle);
}
.template-card:disabled { opacity: 0.4; cursor: not-allowed; }
.template-category {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.template-name { font-size: 13px; font-weight: 700; color: var(--text-primary); margin-top: 2px; }
.template-desc { font-size: 11px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }

/* ── Agent binding row on card ── */
.mcp-agents-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
.agents-all { color: var(--text-secondary); font-style: italic; }
.agent-chip {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--accent-subtle);
  color: var(--accent-text);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
}
.agent-note { color: var(--text-muted); opacity: 0.7; }

/* ── Agent picker in dialog ── */
.agent-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  max-height: 200px;
  overflow-y: auto;
}
.agent-pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.agent-pick-item:hover { background: var(--surface-3); }
.agent-pick-name { color: var(--text-muted); }
.agent-pick-empty { color: var(--text-muted); text-align: center; padding: 12px; font-size: 12px; }

/* ── Reverse serve section ── */
.serve-cli {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: var(--space-4);
}
.serve-cli-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  flex-shrink: 0;
}
.serve-cli code {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}
.copy-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.12s;
}
.copy-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-subtle); }

.btn-verify {
  background: var(--accent-subtle);
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  font-weight: 600;
}
.btn-verify:hover:not(:disabled) {
  background: var(--accent);
  color: var(--on-accent);
  border-color: var(--accent);
}
.btn-verify:disabled { opacity: 0.5; cursor: not-allowed; }

.serve-verify-result {
  margin-bottom: var(--space-4);
  padding: 12px 14px;
  border-radius: var(--radius);
  border-left: 3px solid transparent;
}
.serve-verify-result.result-ok   { background: var(--success-bg); border-left-color: var(--success-text); }
.serve-verify-result.result-fail { background: var(--error-bg);   border-left-color: var(--error-text); }
.verify-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.verify-badge {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}
.result-ok .verify-badge   { color: var(--success-text); }
.result-fail .verify-badge { color: var(--error-text); }
.verify-note { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
.verify-tools { margin-top: 10px; }
.verify-section-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.verify-tool-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.verify-tool-chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  background: var(--surface);
  border: 1px solid var(--border);
}
.verify-details { margin-top: 10px; font-size: 11px; }
.verify-details summary { cursor: pointer; color: var(--text-muted); }
.verify-stderr {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: 4px;
  font-size: 10px;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
}

.serve-client-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.serve-client {
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.serve-client-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.serve-client-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.serve-client-path { font-size: 10px; color: var(--text-muted); word-break: break-all; text-align: right; }
.serve-json {
  margin: 0;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-primary);
  overflow-x: auto;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.rich-empty { display: flex; flex-direction: column; gap: 10px; padding: 40px 20px; align-items: center; }
.empty-icon { font-size: 40px; opacity: 0.5; }
.empty-title { font-size: var(--text-md); font-weight: 600; color: var(--text-primary); }
.empty-desc { color: var(--text-muted); font-size: var(--text-sm); }
.required-mark { color: var(--error-text); }
</style>
