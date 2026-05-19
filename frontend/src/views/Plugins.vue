<template>
  <div class="page-shell page-shell-compact">
    <div class="page-header">
      <div>
        <h1 class="page-title">插件管理</h1>
        <p class="subtitle">统一查看已安装插件，并通过 npm 包名扩展 OpenClaw 能力。</p>
      </div>
    </div>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">已安装插件</div>
        <div class="metric-value">{{ installedCount }}</div>
        <div class="metric-meta">当前通过 npm 安装到 OpenClaw 的插件总数</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">安装方式</div>
        <div class="metric-value metric-value-copy">npm</div>
        <div class="metric-meta">支持在线安装或使用离线预置包</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">最近结果</div>
        <div class="metric-value metric-value-copy">{{ lastActionLabel }}</div>
        <div class="metric-meta">{{ lastActionMeta }}</div>
      </div>
    </div>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">npm 源配置</h2>
        <p class="section-desc">插件从 npm 源安装。内网或离线环境可改为国内镜像(如淘宝源 <code>https://registry.npmmirror.com</code>)。</p>
      </div>
      <div class="install-row">
        <n-input v-model:value="registryInput" placeholder="https://registry.npmmirror.com" @keyup.enter="saveRegistry" />
        <n-button type="primary" :loading="registrySaving" :disabled="!registryInput.trim()" @click="saveRegistry">保存</n-button>
        <n-button :loading="registryPinging" :disabled="!registryInput.trim()" @click="pingRegistry">测试连通</n-button>
      </div>
      <div class="registry-meta">
        <span>当前生效:<code class="mono">{{ currentRegistry || '加载中…' }}</code></span>
        <span v-if="registryPingResult" class="registry-ping" :class="registryPingResult.ok ? 'ok' : 'fail'">
          {{ registryPingResult.ok ? `✓ ${registryPingResult.ms}ms` : `✗ ${registryPingResult.message}` }}
        </span>
      </div>
      <div v-if="registryError" class="error-msg">{{ registryError }}</div>
    </section>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">插件搜索</h2>
        <p class="section-desc">从当前 npm 源搜索 OpenClaw 插件并一键安装。</p>
      </div>
      <div class="install-row">
        <n-input v-model:value="searchQuery" placeholder="输入关键词,如 channels、feishu" @keyup.enter="doSearch" />
        <n-button type="primary" :loading="searchLoading" :disabled="!searchQuery.trim()" @click="doSearch">搜索</n-button>
      </div>
      <div v-if="searchError" class="error-msg">{{ searchError }}</div>
      <div v-if="searchLoading" class="install-placeholder">搜索中…</div>
      <div v-else-if="searched && searchResults.length === 0" class="install-placeholder">未找到匹配的 OpenClaw 插件。</div>
      <div v-else-if="searchResults.length > 0" class="plugin-list">
        <div v-for="r in searchResults" :key="r.name" class="plugin-row">
          <div class="plugin-main">
            <div class="plugin-name-row">
              <div class="plugin-name">{{ r.name }}</div>
              <n-tag size="small" round>v{{ r.version }}</n-tag>
            </div>
            <div class="plugin-desc">{{ r.description || '暂无描述' }}</div>
          </div>
          <n-button v-if="r.installed" size="small" disabled>已安装</n-button>
          <n-button
            v-else
            type="primary"
            size="small"
            :loading="installingSpec === r.npmSpec"
            @click="installFromSearch(r)"
          >安装</n-button>
        </div>
      </div>
    </section>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">已安装插件</h2>
        <p class="section-desc">建议仅保留当前确实在用的插件，减少维护负担。</p>
      </div>

      <div v-if="store.loading && store.plugins.length === 0" class="plugin-loading-shell">
        <div v-for="i in 2" :key="i" class="plugin-loading-card">
          <div class="plugin-loading-line title" />
          <div class="plugin-loading-line" />
          <div class="plugin-loading-line short" />
        </div>
      </div>

      <div v-else-if="store.plugins.length === 0" class="empty-state rich-empty">
        <div class="empty-icon">🧩</div>
        <h3 class="empty-title">暂无已安装插件</h3>
        <p class="empty-desc">下方输入 npm 包名即可安装，例如渠道扩展或内部工具插件。</p>
      </div>

      <div v-else class="plugin-list">
        <div v-for="p in store.plugins" :key="p.name" class="plugin-row">
          <div class="plugin-main">
            <div class="plugin-name-row">
              <div class="plugin-name">{{ p.name }}</div>
              <n-tag size="small" round>v{{ p.version }}</n-tag>
              <n-tag v-if="p.status" size="small" round type="info">{{ p.status }}</n-tag>
            </div>
            <div class="plugin-desc">{{ p.description || '暂无描述' }}</div>
            <div v-if="p.source" class="plugin-path mono">{{ p.source }}</div>
          </div>
          <n-button type="error" size="small" @click="uninstall(p.id ?? p.name)">卸载</n-button>
        </div>
      </div>
    </section>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">离线安装</h2>
        <p class="section-desc">上传本地 <code>.tgz</code> 或 <code>.tar.gz</code> 插件包（npm pack 产物），适用于离线或内网环境。</p>
      </div>
      <div class="offline-drop-zone"
        :class="{ 'drag-over': isDragOver, 'has-file': offlineFile }"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="onDrop"
        @click="triggerFileInput"
      >
        <input ref="fileInputRef" type="file" accept=".tgz,.tar.gz,.zip" class="file-input-hidden" @change="onFileChange">
        <div v-if="offlineFile" class="offline-file-info">
          <span class="offline-file-name">{{ offlineFile.name }}</span>
          <span class="offline-file-size">{{ (offlineFile.size / 1024).toFixed(1) }} KB</span>
          <button type="button" class="offline-file-clear" @click.stop="clearOfflineFile">✕</button>
        </div>
        <div v-else class="offline-drop-hint">
          <span class="offline-drop-icon">📦</span>
          <span>拖入或点击选择 <code>.tgz</code> 插件包</span>
        </div>
      </div>
      <div class="install-row" style="margin-top: 12px">
        <n-button
          type="primary"
          :disabled="!offlineFile || offlineLoading"
          :loading="offlineLoading"
          @click="doOfflineInstall"
        >{{ offlineLoading ? '安装中…' : '安装离线包' }}</n-button>
      </div>
      <div v-if="offlineError" class="error-msg">{{ offlineError }}</div>
      <div v-if="offlineOutput" class="install-status-card" style="margin-top: 12px">
        <div class="install-status-head">
          <div class="install-status-title">离线安装结果</div>
          <span class="install-status-badge" :class="offlineError ? 'error' : 'success'">{{ offlineError ? '失败' : '已完成' }}</span>
        </div>
        <pre class="install-log">{{ offlineOutput }}</pre>
      </div>
    </section>

    <section class="section-card">
      <div class="section-header">
        <h2 class="section-title">在线安装</h2>
        <p class="section-desc">输入 npm 包名，例如 <code>@openclaw-china/channels</code>。可直接追加版本号如 <code>@openclaw-china/channels@2026.4.9</code>；如果不写版本，将自动使用 <code>latest</code>。</p>
      </div>
      <div class="install-row">
        <n-input v-model:value="packageName" placeholder="@openclaw-china/channels 或 @openclaw-china/channels@2026.4.9" @keyup.enter="doInstall" />
        <n-button
          type="primary"
          @click="doInstall"
          :disabled="!packageName || store.loading"
          :loading="store.loading"
        >
          {{ store.loading ? '安装中...' : '安装' }}
        </n-button>
      </div>
      <div v-if="installError" class="error-msg">{{ installError }}</div>
      <div class="install-help">
        <div class="install-help-title">安装规则</div>
        <div class="install-help-text">支持 <code>包名</code> 或 <code>包名@版本</code>。不写版本时会自动使用 <code>latest</code>。</div>
        <div class="install-help-text">如果插件源限流或网络不可达，建议稍后重试，或改用离线包。</div>
      </div>
      <div class="install-status-card" :class="{ loading: store.loading }">
        <div class="install-status-head">
          <div class="install-status-title">安装过程与结果</div>
          <span class="install-status-badge" :class="store.loading ? 'pending' : installError ? 'error' : commandOutput ? 'success' : 'idle'">
            {{ store.loading ? '执行中' : installError ? '失败' : commandOutput ? '已完成' : '等待执行' }}
          </span>
        </div>
        <div v-if="store.loading" class="install-steps">
          <div class="install-step">1. 发送安装命令到 OpenClaw CLI…</div>
          <div class="install-step">2. 等待 npm / 插件注册完成…</div>
          <div class="install-step">3. 刷新插件列表并更新统计…</div>
        </div>
        <pre v-else-if="commandOutput" class="install-log">{{ commandOutput }}</pre>
        <div v-else class="install-placeholder">执行安装或卸载后，这里会展示命令、输出结果和刷新后的插件状态。</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { NButton, NInput, NTag } from 'naive-ui'
import { api } from '../api/client.js'
import type { PluginSearchResult } from '../api/client.js'
import { usePluginsStore } from '../stores/plugins.js'
import { useNaiveToast } from '../composables/useNaiveToast.js'
import { useConfirm } from '../composables/useConfirm.js'

const store = usePluginsStore()
const toast = useNaiveToast()
const confirm = useConfirm()
onMounted(() => store.load())

// 相对时间:卡片每 30s 重算一次,避免「刚刚」长期不刷新
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer) })

function relTime(at: number, ref: number): string {
  const s = Math.max(0, Math.floor((ref - at) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

// offline install
const fileInputRef = ref<HTMLInputElement | null>(null)
const offlineFile = ref<File | null>(null)
const offlineLoading = ref(false)
const offlineError = ref('')
const offlineOutput = ref('')
const isDragOver = ref(false)

function triggerFileInput() { fileInputRef.value?.click() }
function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) { offlineFile.value = file; offlineError.value = ''; offlineOutput.value = '' }
}
function onDrop(e: DragEvent) {
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) { offlineFile.value = file; offlineError.value = ''; offlineOutput.value = '' }
}
function clearOfflineFile() {
  offlineFile.value = null
  offlineOutput.value = ''
  offlineError.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}
async function doOfflineInstall() {
  if (!offlineFile.value) return
  offlineError.value = ''
  offlineOutput.value = ''
  offlineLoading.value = true
  try {
    const res = await api.plugins.installOffline(offlineFile.value)
    const cmd = res.result
    offlineOutput.value = [cmd.command, cmd.stdout, cmd.stderr].filter(Boolean).join('\n\n').trim()
    store.lastAction = { kind: 'install', pkg: offlineFile.value.name, at: Date.now() }
    await store.load()
    toast.success(`离线包 ${offlineFile.value.name} 安装成功，Gateway 正在重启以加载插件…`)
    clearOfflineFile()
  } catch (e: any) {
    offlineError.value = e.message
    toast.error(`安装失败: ${e.message}`)
  } finally {
    offlineLoading.value = false
  }
}

const installedCount = computed(() => store.plugins.length)
const lastActionLabel = computed(() => {
  if (store.loading) return '执行中'
  if (installError.value) return '失败'
  if (store.lastAction?.kind === 'uninstall') return '已卸载'
  if (store.lastAction?.kind === 'install') return '已安装'
  return '待执行'
})
const lastActionMeta = computed(() => {
  if (store.loading) return '正在执行插件操作…'
  const a = store.lastAction
  if (!a) return '展示最近一次安装或卸载操作的状态'
  return `${a.pkg} · ${relTime(a.at, now.value)}`
})
const commandOutput = computed(() => {
  const cmd = store.lastCommand
  if (!cmd) return ''
  return [cmd.command, cmd.stdout, cmd.stderr].filter(Boolean).join('\n\n').trim()
})
const packageName = ref('')
const installError = ref('')

async function doInstall() {
  installError.value = ''
  try {
    await store.install(packageName.value)
    toast.success(`插件 ${packageName.value} 安装成功，Gateway 正在重启以加载插件…`)
    packageName.value = ''
  } catch (e: any) {
    installError.value = e.message
    toast.error(`安装失败: ${e.message}`)
  }
}

async function uninstall(name: string) {
  const ok = await confirm({
    title: '卸载插件',
    message: `确认卸载 ${name}？卸载后 Gateway 会重启以应用变更。`,
    confirmText: '卸载',
    danger: true,
  })
  if (!ok) return
  try {
    await store.uninstall(name)
    toast.success(`插件 ${name} 已卸载，Gateway 正在重启…`)
  } catch (e: any) {
    toast.error(`卸载失败: ${e.message}`)
  }
}

// ── npm 源配置 ──
const currentRegistry = ref('')
const registryInput = ref('')
const registrySaving = ref(false)
const registryPinging = ref(false)
const registryError = ref('')
const registryPingResult = ref<{ ok: boolean; ms: number; message: string } | null>(null)

async function loadRegistry() {
  try {
    const r = await api.plugins.getNpmRegistry()
    currentRegistry.value = r.registry
    if (!registryInput.value) registryInput.value = r.registry
  } catch (e: any) {
    registryError.value = e.message
  }
}
onMounted(loadRegistry)

async function saveRegistry() {
  registryError.value = ''
  registrySaving.value = true
  try {
    const r = await api.plugins.setNpmRegistry(registryInput.value.trim())
    currentRegistry.value = r.registry
    toast.success(`npm 源已切换为 ${r.registry}`)
  } catch (e: any) {
    registryError.value = e.message
    toast.error(`保存失败: ${e.message}`)
  } finally {
    registrySaving.value = false
  }
}

async function pingRegistry() {
  registryError.value = ''
  registryPingResult.value = null
  registryPinging.value = true
  try {
    registryPingResult.value = await api.plugins.pingNpmRegistry(registryInput.value.trim())
  } catch (e: any) {
    registryPingResult.value = { ok: false, ms: 0, message: e.message }
  } finally {
    registryPinging.value = false
  }
}

// ── 插件搜索 ──
const searchQuery = ref('')
const searchResults = ref<PluginSearchResult[]>([])
const searchLoading = ref(false)
const searchError = ref('')
const searched = ref(false)
const installingSpec = ref('')

async function doSearch() {
  const q = searchQuery.value.trim()
  if (!q) return
  searchError.value = ''
  searchLoading.value = true
  try {
    const r = await api.plugins.search(q)
    searchResults.value = r.results
    searched.value = true
  } catch (e: any) {
    searchError.value = e.message
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

async function installFromSearch(r: PluginSearchResult) {
  installingSpec.value = r.npmSpec
  try {
    await store.install(r.npmSpec)
    toast.success(`插件 ${r.name} 安装成功，Gateway 正在重启以加载插件…`)
    r.installed = true
  } catch (e: any) {
    toast.error(`安装失败: ${e.message}`)
  } finally {
    installingSpec.value = ''
  }
}
</script>

<style scoped>
.metric-value-copy { font-size: clamp(24px, 3vw, 32px); letter-spacing: -0.02em; }

.rich-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) 0 var(--space-3);
}

.empty-icon { font-size: 28px; }
.empty-title { font-size: var(--text-md); color: var(--text-primary); }
.empty-desc { max-width: 460px; color: var(--text-secondary); line-height: 1.6; }

.plugin-list { display: flex; flex-direction: column; gap: var(--space-3); }

.plugin-loading-shell {
  display: grid;
  gap: var(--space-3);
}

.plugin-loading-card {
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
}

.plugin-loading-line {
  height: 14px;
  border-radius: 999px;
  background: var(--surface-2);
  background-size: 200% 100%;
  animation: plugin-shimmer 1.4s ease infinite;
  margin-bottom: 10px;
}

.plugin-loading-line.title { height: 18px; width: 38%; }
.plugin-loading-line.short { width: 56%; margin-bottom: 0; }

.plugin-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.plugin-main { min-width: 0; }

.plugin-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.plugin-name { font-weight: 700; font-size: var(--text-sm); }
.plugin-desc { font-size: var(--text-sm); color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
.plugin-path {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.section-desc code {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--font-mono);
}

.file-input-hidden { display: none; }

.offline-drop-zone {
  border: 2px dashed var(--tint-strong);
  border-radius: var(--radius-lg);
  padding: 24px 20px;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;
  background: var(--surface-2);
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.offline-drop-zone:hover,
.offline-drop-zone.drag-over {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.04);
}
.offline-drop-zone.has-file {
  border-style: solid;
  border-color: rgba(34, 197, 94, 0.4);
  background: var(--success-bg);
}
.offline-drop-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.offline-drop-icon { font-size: 20px; }
.offline-drop-hint code {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
.offline-file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.offline-file-name {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.offline-file-size {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}
.offline-file-clear {
  appearance: none;
  border: none;
  background: var(--error-bg);
  color: var(--warn-text);
  border-radius: 999px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 11px;
  flex-shrink: 0;
}
.offline-file-clear:hover { background: rgba(239,68,68,0.2); }

.install-row { display: flex; gap: var(--space-2); align-items: center; }
.install-row .n-input { flex: 1; }
.error-msg { color: var(--error-text); font-size: var(--text-sm); margin-top: var(--space-3); }

.install-help {
  margin-top: var(--space-3);
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
}

.install-help-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.install-help-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.65;
}

.install-help-text + .install-help-text {
  margin-top: 4px;
}

.install-status-card {
  margin-top: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--surface);
}

.install-status-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.install-status-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.install-status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
}

.install-status-badge.pending { background: rgba(99,102,241,0.1); color: var(--accent-text); }
.install-status-badge.success { background: var(--success-bg); color: var(--success-text); }
.install-status-badge.error { background: var(--error-bg); color: var(--error-text); }
.install-status-badge.idle { background: rgba(148,163,184,0.12); color: var(--text-secondary); }

.install-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.install-step {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--tint-medium);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.install-log {
  margin: 0;
  padding: 14px;
  border-radius: 14px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 340px;
  overflow: auto;
}

.install-placeholder {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
}

@keyframes plugin-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.registry-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-secondary, #9aa0a6);
}
.registry-ping.ok { color: #3fb950; }
.registry-ping.fail { color: #f85149; }
</style>
