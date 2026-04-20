<template>
  <div class="page-shell page-shell-compact">
    <div class="page-header">
      <div>
        <h1 class="page-title">系统设置</h1>
        <p class="subtitle">管理访问密码、网络代理、npm 镜像以及运行时环境。</p>
      </div>
    </div>

    <div v-if="loading" class="loading-state">加载中…</div>

    <template v-else>
      <!-- 操作员概览三卡 -->
      <div v-if="overview" class="operator-grid">
        <!-- 连接健康 -->
        <div class="operator-card" :class="`card-${overview.connection.rating}`">
          <div class="operator-head">
            <span class="operator-title">连接健康</span>
            <span class="operator-pill" :class="`pill-${overview.connection.rating}`">
              {{ overview.connection.onlineCount }}/{{ overview.connection.totalCount }} 正常
            </span>
          </div>
          <ul class="operator-list">
            <li v-for="it in overview.connection.items" :key="it.key" :class="`row-${it.status}`">
              <span class="operator-dot"></span>
              <span class="operator-label">{{ it.label }}</span>
              <span class="operator-detail">{{ it.detail }}</span>
            </li>
          </ul>
        </div>

        <!-- 版本与更新 -->
        <div class="operator-card" :class="overview.version.updateAvailable ? 'card-warn' : 'card-ok'">
          <div class="operator-head">
            <span class="operator-title">版本与更新</span>
            <span class="operator-pill" :class="overview.version.updateAvailable ? 'pill-warn' : 'pill-ok'">
              {{ overview.version.updateAvailable ? '有新版本' : '已是最新' }}
            </span>
          </div>
          <ul class="operator-list">
            <li class="row-ok">
              <span class="operator-dot"></span>
              <span class="operator-label">OpenClaw 当前</span>
              <span class="operator-detail mono">{{ overview.version.openclawCurrent ?? '未知' }}</span>
            </li>
            <li :class="overview.version.updateAvailable ? 'row-warn' : 'row-ok'">
              <span class="operator-dot"></span>
              <span class="operator-label">OpenClaw 最新</span>
              <span class="operator-detail mono">{{ overview.version.openclawLatest ?? '—' }}</span>
            </li>
            <li class="row-ok">
              <span class="operator-dot"></span>
              <span class="operator-label">Portal 版本</span>
              <span class="operator-detail mono">{{ overview.version.portalVersion }}</span>
            </li>
            <li v-if="overview.version.lastCheckedAt" class="row-ok">
              <span class="operator-dot"></span>
              <span class="operator-label">最近检查</span>
              <span class="operator-detail">{{ formatDate(overview.version.lastCheckedAt) }}</span>
            </li>
          </ul>
        </div>

        <!-- 安全风险摘要 -->
        <div class="operator-card" :class="`card-${riskClass(overview.risk.level)}`">
          <div class="operator-head">
            <span class="operator-title">安全风险摘要</span>
            <span class="operator-pill" :class="`pill-${riskClass(overview.risk.level)}`">
              {{ riskLevelLabel(overview.risk.level) }}
            </span>
          </div>
          <ul class="operator-list">
            <li
              v-for="r in overview.risk.items"
              :key="r.key"
              :class="r.ok ? 'row-ok' : `row-risk-${r.severity}`"
            >
              <span class="operator-dot"></span>
              <span class="operator-label">{{ r.label }}</span>
              <span class="operator-detail">{{ r.hint }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 登录保护 -->
      <div class="section-card settings-section">
        <div class="section-header">
          <div class="section-head-row">
            <div>
              <h2 class="section-title">登录保护</h2>
              <p class="section-desc">
                <template v-if="authEnabled">已启用 — 访问 Portal 前需要输入密码。你可以在下面修改或关闭。</template>
                <template v-else>未启用 — Portal 当前开放访问（依赖 nginx + loopback 绑定作为访问边界）。开启后每次访问都需要密码。</template>
              </p>
            </div>
            <span :class="['auth-status-pill', authEnabled ? 'auth-on' : 'auth-off']">
              {{ authEnabled ? '已启用' : '未启用' }}
            </span>
          </div>
        </div>

        <!-- 已启用：修改密码 + 关闭 -->
        <template v-if="authEnabled">
          <div class="form-group pw-field">
            <label class="form-label">当前密码</label>
            <div class="pw-input-wrap">
              <input class="form-input" :type="showPw.old ? 'text' : 'password'" v-model="pw.old" placeholder="输入当前密码" autocomplete="current-password" />
              <button type="button" class="eye-btn" @click="showPw.old = !showPw.old" tabindex="-1"><EyeIcon :off="showPw.old" /></button>
            </div>
          </div>
          <div class="form-group pw-field">
            <label class="form-label">新密码</label>
            <div class="pw-input-wrap">
              <input class="form-input" :type="showPw.new1 ? 'text' : 'password'" v-model="pw.new1" placeholder="至少 6 个字符" autocomplete="new-password" />
              <button type="button" class="eye-btn" @click="showPw.new1 = !showPw.new1" tabindex="-1"><EyeIcon :off="showPw.new1" /></button>
            </div>
          </div>
          <div class="form-group pw-field">
            <label class="form-label">确认新密码</label>
            <div class="pw-input-wrap">
              <input class="form-input" :type="showPw.new2 ? 'text' : 'password'" v-model="pw.new2" placeholder="再次输入新密码" autocomplete="new-password" />
              <button type="button" class="eye-btn" @click="showPw.new2 = !showPw.new2" tabindex="-1"><EyeIcon :off="showPw.new2" /></button>
            </div>
          </div>
          <div class="section-actions">
            <button class="btn btn-primary" @click="changePassword" :disabled="saving.pw || !pw.old || !pw.new1 || !pw.new2">
              {{ saving.pw ? '修改中…' : '修改密码' }}
            </button>
            <button class="btn" @click="openDisable">关闭登录保护…</button>
          </div>
        </template>

        <!-- 未启用：首次启用表单 -->
        <template v-else>
          <div class="form-group pw-field">
            <label class="form-label">设置密码</label>
            <div class="pw-input-wrap">
              <input class="form-input" :type="showPw.new1 ? 'text' : 'password'" v-model="enableForm.password" placeholder="至少 6 个字符" autocomplete="new-password" />
              <button type="button" class="eye-btn" @click="showPw.new1 = !showPw.new1" tabindex="-1"><EyeIcon :off="showPw.new1" /></button>
            </div>
          </div>
          <div class="form-group pw-field">
            <label class="form-label">确认密码</label>
            <div class="pw-input-wrap">
              <input class="form-input" :type="showPw.new2 ? 'text' : 'password'" v-model="enableForm.confirm" placeholder="再次输入密码" autocomplete="new-password" />
              <button type="button" class="eye-btn" @click="showPw.new2 = !showPw.new2" tabindex="-1"><EyeIcon :off="showPw.new2" /></button>
            </div>
          </div>
          <div class="section-actions">
            <button
              class="btn btn-primary"
              @click="enableAuth"
              :disabled="saving.enable || !enableForm.password || enableForm.password !== enableForm.confirm || enableForm.password.length < 6"
            >
              {{ saving.enable ? '启用中…' : '启用登录保护' }}
            </button>
          </div>
        </template>
      </div>

      <!-- Disable confirm modal -->
      <Teleport to="body">
        <div v-if="disableDialog.open" class="ui-modal-overlay" @click.self="disableDialog.open = false">
          <div class="ui-modal ui-modal-sm">
            <div class="ui-modal-header">
              <div class="ui-modal-copy">
                <div class="ui-modal-title">关闭登录保护</div>
                <div class="ui-modal-subtitle">关闭后任何能访问 Portal URL 的人都能操作，仅依赖网络层边界。</div>
              </div>
              <button class="ui-modal-close" @click="disableDialog.open = false">✕</button>
            </div>
            <div class="ui-modal-body">
              <div class="form-group pw-field">
                <label class="form-label">输入当前密码以确认</label>
                <div class="pw-input-wrap">
                  <input class="form-input" :type="showPw.old ? 'text' : 'password'" v-model="disableDialog.password" autocomplete="current-password" />
                  <button type="button" class="eye-btn" @click="showPw.old = !showPw.old" tabindex="-1"><EyeIcon :off="showPw.old" /></button>
                </div>
              </div>
            </div>
            <div class="ui-modal-footer">
              <button class="btn" @click="disableDialog.open = false">取消</button>
              <button class="btn btn-danger" @click="disableAuth" :disabled="disableDialog.busy || !disableDialog.password">
                {{ disableDialog.busy ? '关闭中…' : '确认关闭' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- 网络代理 -->
      <div class="section-card settings-section">
        <div class="section-header">
          <h2 class="section-title">网络代理</h2>
          <p class="section-desc">配置 HTTP/HTTPS 代理，用于 npm 安装插件等网络操作</p>
        </div>
        <div class="form-group">
          <label class="form-label">HTTP 代理</label>
          <input class="form-input" v-model="form.httpProxy" placeholder="http://127.0.0.1:7897" />
        </div>
        <div class="form-group">
          <label class="form-label">HTTPS 代理</label>
          <input class="form-input" v-model="form.httpsProxy" placeholder="http://127.0.0.1:7897" />
        </div>
        <div class="section-actions">
          <button class="btn btn-primary" @click="saveProxy" :disabled="saving.proxy">
            {{ saving.proxy ? '保存中…' : '保存' }}
          </button>
          <button class="btn" @click="clearProxy" :disabled="saving.proxy">清除代理</button>
        </div>
      </div>

      <!-- 配置备份 -->
      <div class="section-card settings-section">
        <div class="section-header">
          <h2 class="section-title">配置备份</h2>
          <p class="section-desc">一键打包 ~/.openclaw 下的核心配置为 tar.gz，用于迁移、恢复或定期归档。不包含会话历史、运行日志和工作区。</p>
        </div>
        <div v-if="backup.manifest" class="backup-summary">
          <div class="backup-stats">
            <span class="backup-stat"><strong>{{ backup.manifest.fileCount }}</strong> 文件</span>
            <span class="backup-stat"><strong>{{ backup.manifest.dirCount }}</strong> 目录</span>
            <span class="backup-stat"><strong>{{ formatBytes(backup.manifest.totalFileSize) }}</strong> 纯文件体积</span>
          </div>
          <ul class="backup-items">
            <li
              v-for="item in backup.manifest.items"
              :key="item.path"
              :class="['backup-item', item.exists ? 'item-present' : 'item-missing']"
            >
              <span class="backup-item-name mono">{{ item.path }}</span>
              <span class="backup-item-meta">
                <template v-if="!item.exists">不存在</template>
                <template v-else-if="item.kind === 'directory'">目录</template>
                <template v-else>{{ formatBytes(item.size) }}</template>
              </span>
            </li>
          </ul>
        </div>
        <div v-else class="backup-loading">加载备份清单…</div>
        <div class="backup-warning">
          备份包含 <code>portal-auth.json</code>（admin 密码 scrypt 哈希）和 <code>portal-device-key.json</code>（设备私钥），请妥善保管。
        </div>
        <div class="section-actions">
          <button class="btn btn-primary" @click="downloadBackup">下载备份</button>
          <button class="btn" @click="refreshBackupManifest">刷新清单</button>
        </div>
      </div>

      <!-- 运行时信息 -->
      <div class="section-card settings-section">
        <div class="section-header">
          <h2 class="section-title">运行时信息</h2>
          <p class="section-desc">当前服务配置（只读，通过环境变量或启动参数修改）</p>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">网关端口</span>
            <span class="info-value mono">{{ info.gatewayPort }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Portal 端口</span>
            <span class="info-value mono">{{ info.portalPort }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">OpenClaw 目录</span>
            <span class="info-value mono">{{ info.openclawHome }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { useToastStore } from '../stores/toast'
import { clearAuthCache } from '../router/auth-cache.js'

const EyeIcon = (props: { off?: boolean }) => {
  if (!props.off) return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', width: 18, height: 18 }, [
    h('path', { d: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z' }),
    h('circle', { cx: '12', cy: '12', r: '3' }),
  ])
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', width: 18, height: 18 }, [
    h('path', { d: 'M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88' }),
  ])
}

const toast = useToastStore()
const router = useRouter()
const loading = ref(true)
const overview = ref<any>(null)

function riskClass(level: 'low' | 'medium' | 'high'): 'ok' | 'warn' | 'fail' {
  if (level === 'high') return 'fail'
  if (level === 'medium') return 'warn'
  return 'ok'
}
function riskLevelLabel(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return '高风险'
  if (level === 'medium') return '需关注'
  return '低风险'
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return iso }
}
async function loadOverview() {
  try {
    overview.value = await api.system.operatorOverview()
  } catch {
    overview.value = null
  }
}

const info = reactive({
  gatewayPort: 0,
  portalPort: 0,
  openclawHome: '',
  httpProxy: '',
  httpsProxy: '',
  npmRegistry: '',
})

const form = reactive({
  httpProxy: '',
  httpsProxy: '',
  npmRegistry: '',
})

const saving = reactive({ proxy: false, pw: false, enable: false })

// ── Auth enable/disable ──────────────────────────────────────────────────
const authEnabled = ref(false)
const enableForm = reactive({ password: '', confirm: '' })
const disableDialog = reactive({ open: false, password: '', busy: false })

async function refreshAuthStatus() {
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/status`)
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      authEnabled.value = Boolean(data.enabled)
    }
  } catch {}
}

async function enableAuth() {
  saving.enable = true
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: enableForm.password, confirmPassword: enableForm.confirm }),
    })
    if (res.ok) {
      toast.success('登录保护已启用')
      enableForm.password = ''
      enableForm.confirm = ''
      authEnabled.value = true
      clearAuthCache()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || '启用失败')
    }
  } catch (e: any) {
    toast.error(e.message)
  } finally {
    saving.enable = false
  }
}

function openDisable() {
  disableDialog.open = true
  disableDialog.password = ''
}

async function disableAuth() {
  disableDialog.busy = true
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: disableDialog.password }),
    })
    if (res.ok) {
      toast.success('登录保护已关闭')
      disableDialog.open = false
      authEnabled.value = false
      clearAuthCache()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || '关闭失败')
    }
  } catch (e: any) {
    toast.error(e.message)
  } finally {
    disableDialog.busy = false
  }
}

// ── Backup ────────────────────────────────────────────────────────────────
const backup = reactive<{ manifest: Awaited<ReturnType<typeof api.backup.manifest>> | null }>({ manifest: null })

async function refreshBackupManifest() {
  try {
    backup.manifest = await api.backup.manifest()
  } catch (err: any) {
    toast.error(`加载备份清单失败: ${err.message}`)
  }
}

function downloadBackup() {
  // Let the browser handle the download via cookies — the URL is relative
  // so the auth cookie is sent.
  window.location.assign(api.backup.exportUrl())
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const pw = reactive({ old: '', new1: '', new2: '' })
const showPw = reactive({ old: false, new1: false, new2: false })

async function changePassword() {
  if (pw.new1 !== pw.new2) { toast.error('两次输入的新密码不一致'); return }
  if (pw.new1.length < 6) { toast.error('新密码至少 6 个字符'); return }
  saving.pw = true
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: pw.old, newPassword: pw.new1 }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || '修改失败'); return }
    toast.success('密码已修改，请重新登录')
    clearAuthCache()
    setTimeout(() => router.replace('/login'), 1000)
  } catch (e: any) {
    toast.error(e.message)
  } finally {
    saving.pw = false
  }
}

async function loadSettings() {
  loading.value = true
  try {
    const s = await api.settings.get()
    Object.assign(info, s)
    form.httpProxy = s.httpProxy
    form.httpsProxy = s.httpsProxy
    form.npmRegistry = s.npmRegistry
  } finally {
    loading.value = false
  }
}

async function saveProxy() {
  saving.proxy = true
  try {
    await api.settings.update({ httpProxy: form.httpProxy, httpsProxy: form.httpsProxy })
    toast.success('代理设置已保存')
  } catch (e: any) {
    toast.error(e.message)
  } finally {
    saving.proxy = false
  }
}

async function clearProxy() {
  form.httpProxy = ''
  form.httpsProxy = ''
  await saveProxy()
}

onMounted(async () => {
  await loadSettings()
  void refreshBackupManifest()
  void refreshAuthStatus()
  void loadOverview()
})
</script>

<style scoped>
.settings-section { padding: var(--space-6); }

.auth-status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.auth-on  { background: var(--success-bg); color: var(--success-text); }
.auth-off { background: var(--muted-bg);   color: var(--text-muted); }

/* ── Backup panel ─────────────────────────────────────────────── */
.backup-summary { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
.backup-stats { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--text-secondary); }
.backup-stat strong { font-weight: 700; color: var(--text-primary); font-family: var(--font-mono); margin-right: 4px; }
.backup-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 4px 12px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--surface-2);
  border-radius: 4px;
  border: 1px solid transparent;
}
.backup-item.item-missing { opacity: 0.4; text-decoration: line-through; }
.backup-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backup-item-meta { color: var(--text-muted); font-size: 11px; font-family: var(--font-mono); flex-shrink: 0; margin-left: 8px; }
.backup-warning {
  font-size: 11px;
  color: color-mix(in srgb, #f59e0b 85%, var(--text-secondary));
  background: color-mix(in srgb, #f59e0b 8%, transparent);
  border-left: 3px solid #f59e0b;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
}
.backup-warning code {
  font-family: var(--font-mono);
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
}
.backup-loading { color: var(--text-muted); font-size: 13px; padding: 16px 0; }
.mono { font-family: var(--font-mono); }

.pw-input-wrap {
  position: relative;
  width: 100%;
}
.pw-input-wrap .form-input {
  width: 100%;
  padding-right: 42px;
  box-sizing: border-box;
}
.eye-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted, #a8a29e);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 160ms ease;
}
.eye-btn:hover {
  color: var(--text-secondary, #57534e);
}

/* ── Operator overview 三卡 ── */
.operator-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.operator-card {
  background: var(--card-fill, var(--surface-2));
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.operator-card.card-ok { border-left: 3px solid #10b981; }
.operator-card.card-warn { border-left: 3px solid #f59e0b; }
.operator-card.card-fail { border-left: 3px solid #ef4444; }
.operator-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.operator-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.operator-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  letter-spacing: 0.04em;
}
.pill-ok { background: color-mix(in srgb, #10b981 15%, transparent); color: #059669; }
.pill-warn { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #d97706; }
.pill-fail { background: color-mix(in srgb, #ef4444 15%, transparent); color: #dc2626; }
.operator-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.operator-list li {
  display: grid;
  grid-template-columns: 12px minmax(80px, auto) 1fr;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  line-height: 1.4;
}
.operator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-left: 2px;
}
.row-ok .operator-dot { background: #10b981; }
.row-warn .operator-dot { background: #f59e0b; }
.row-fail .operator-dot { background: #ef4444; }
.row-risk-high .operator-dot { background: #ef4444; }
.row-risk-medium .operator-dot { background: #f59e0b; }
.row-risk-low .operator-dot { background: #10b981; }
.operator-label {
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
}
.operator-detail {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.operator-detail.mono { font-family: var(--font-mono); }
</style>
