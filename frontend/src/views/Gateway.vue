<template>
  <div class="page-shell page-shell-compact">
    <div class="page-header">
      <div>
        <h1 class="page-title">网关配置</h1>
        <p class="subtitle">修改 openclaw.json 中的 gateway 节点，重启后生效</p>
      </div>
      <div class="header-actions">
        <span v-if="dirty" class="dirty-hint">● 有未保存更改</span>
        <button class="btn btn-sm" @click="load" :disabled="loading">重置</button>
        <button class="btn btn-primary" @click="saveAll" :disabled="saving || loading">
          {{ saving ? '保存中…' : '保存全部' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">加载中…</div>

    <template v-else>
      <div class="metric-grid gateway-metrics">
        <div class="metric-card">
          <div class="metric-label">监听端口</div>
          <div class="metric-value">{{ form.port }}</div>
          <div class="metric-meta">{{ form.bind === 'loopback' ? '仅本机访问' : '监听所有网卡' }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">运行模式</div>
          <div class="metric-value gateway-metric-copy">{{ form.mode === 'local' ? 'Local' : 'Cloud' }}</div>
          <div class="metric-meta">适配 {{ form.mode === 'local' ? '单机部署' : '多用户云端' }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">认证方式</div>
          <div class="metric-value gateway-metric-copy">{{ authModeLabel }}</div>
          <div class="metric-meta">{{ authModeMeta }}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">控制台与接口</div>
          <div class="metric-value gateway-metric-copy">{{ form.controlUiEnabled ? 'UI 开启' : 'UI 关闭' }}</div>
          <div class="metric-meta">Chat 端点 {{ form.chatCompletionsEnabled ? '已启用' : '已关闭' }}</div>
        </div>
      </div>

      <!-- 重启提示 -->
      <div v-if="needsRestart" class="restart-notice">
        <span>⚠ 端口或 bind 已修改，需重启网关才能生效</span>
        <button class="btn btn-sm" @click="restart" :disabled="restarting">
          {{ restarting ? '重启中…' : '立即重启' }}
        </button>
      </div>

      <div class="gateway-stack">
      <!-- 基础设置 -->
      <section class="section-card gateway-section">
        <div class="section-header">
          <h2 class="section-title">基础设置</h2>
          <p class="section-desc">网关监听端口、部署模式与绑定地址</p>
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">端口 <span class="restart-tag">重启生效</span></label>
            <input class="form-input" type="number" v-model.number="form.port" @change="dirty=true" min="1024" max="65535" />
          </div>
          <div class="form-group">
            <label class="form-label">部署模式</label>
            <select class="form-select" v-model="form.mode" @change="dirty=true">
              <option value="local">local（本地单用户）</option>
              <option value="cloud">cloud（云端多用户）</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Bind <span class="restart-tag">重启生效</span></label>
            <select class="form-select" v-model="form.bind" @change="dirty=true">
              <option value="loopback">loopback（仅本机 127.0.0.1）</option>
              <option value="all">all（监听所有网卡 0.0.0.0）</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 认证 -->
      <section class="section-card gateway-section">
        <div class="section-header">
          <h2 class="section-title">认证模式</h2>
          <p class="section-desc">控制谁可以访问网关 API</p>
        </div>

        <div class="form-group">
          <label class="form-label">模式</label>
          <div class="radio-group">
            <label class="radio-item" v-for="m in AUTH_MODES" :key="m.value">
              <input type="radio" :value="m.value" v-model="form.authMode" @change="dirty=true" />
              <span class="radio-label">
                <span class="radio-name">{{ m.label }}</span>
                <span class="radio-desc">{{ m.desc }}</span>
              </span>
            </label>
          </div>
        </div>

        <!-- trusted-proxy sub-config -->
        <template v-if="form.authMode === 'trusted-proxy'">
          <div class="form-group">
            <label class="form-label">用户 Header</label>
            <input class="form-input" v-model="form.trustedProxy.userHeader" @input="dirty=true" placeholder="X-Forwarded-User" />
          </div>
          <div class="form-group">
            <label class="form-label">必需 Headers（逗号分隔）</label>
            <input class="form-input" v-model="requiredHeadersStr" @input="dirty=true" placeholder="X-Forwarded-User" />
          </div>
          <div class="form-group">
            <label class="form-label">允许的用户（逗号分隔，空=全部）</label>
            <input class="form-input" v-model="allowUsersStr" @input="dirty=true" placeholder="admin,alice" />
          </div>
          <div class="form-group">
            <label class="form-label">可信代理 IP（逗号分隔）</label>
            <input class="form-input" v-model="trustedProxiesStr" @input="dirty=true" placeholder="127.0.0.1,::1" />
          </div>
        </template>

        <template v-else-if="form.authMode === 'token'">
          <div class="form-group">
            <label class="form-label">Gateway Token</label>
            <div class="secret-row">
              <input
                class="form-input"
                :type="showToken ? 'text' : 'password'"
                v-model="form.token"
                @input="dirty=true"
                placeholder="输入或生成 Gateway Token"
              />
              <button class="btn btn-sm" @click="showToken = !showToken" type="button">
                {{ showToken ? '隐藏' : '显示' }}
              </button>
              <button class="btn btn-sm" @click="copySecret(form.token, 'Gateway Token 已复制')" type="button" :disabled="!form.token">
                复制
              </button>
              <button class="btn btn-sm btn-secondary" @click="regenerateToken" type="button">
                重新生成
              </button>
            </div>
            <p class="hint">ClawPanel、Portal Chat WS 和原生 Control UI 都可复用这个 token。</p>
          </div>
        </template>

        <template v-else-if="form.authMode === 'password'">
          <div class="form-group">
            <label class="form-label">Gateway Password</label>
            <div class="secret-row">
              <input
                class="form-input"
                :type="showPassword ? 'text' : 'password'"
                v-model="form.password"
                @input="dirty=true"
                placeholder="输入 Gateway Password"
              />
              <button class="btn btn-sm" @click="showPassword = !showPassword" type="button">
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
              <button class="btn btn-sm" @click="copySecret(form.password, 'Gateway Password 已复制')" type="button" :disabled="!form.password">
                复制
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- 控制台 UI -->
      <section class="section-card gateway-section">
        <div class="section-header">
          <h2 class="section-title">控制台 UI</h2>
          <p class="section-desc">内置 Web 控制台的访问设置</p>
        </div>
        <div class="form-group toggle-row">
          <span class="form-label">启用控制台 UI</span>
          <label class="toggle">
            <input type="checkbox" v-model="form.controlUiEnabled" @change="dirty=true" />
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">允许的 Origins（逗号分隔，* = 全部）</label>
          <input class="form-input" v-model="allowedOriginsStr" @input="dirty=true" placeholder="*" />
          <p class="hint">Nginx 反代时通常填 * 或具体域名</p>
        </div>
        <n-card size="small" class="control-ui-card" embedded :bordered="false">
          <div class="control-ui-card-body">
            <div class="control-ui-card-main">
              <div class="control-ui-link-title">官方 Control UI</div>
              <a class="control-ui-link" :href="officialControlUiUrl" target="_blank" rel="noreferrer">{{ officialControlUiUrl }}</a>
              <p class="hint">这是 OpenClaw 原生 Control UI 入口。Token 模式下使用 `#token=...` 注入认证；远程浏览器首次访问通常仍需要设备批准。</p>
            </div>
            <n-space vertical size="small" class="control-ui-card-actions">
              <n-button size="small" @click="copySecret(officialControlUiUrl, '官方 Control UI 链接已复制')">
                复制链接
              </n-button>
              <n-button size="small" secondary tag="a" :href="officialDocsUrl" target="_blank" rel="noreferrer">
                官方文档
              </n-button>
            </n-space>
          </div>
        </n-card>
      </section>

      <section class="section-card gateway-section">
        <div class="section-header">
          <div>
            <h2 class="section-title">设备配对管理</h2>
            <p class="section-desc">审批原生 Control UI 的待配对浏览器设备，并管理已授权设备。</p>
          </div>
          <n-button size="small" secondary @click="loadDevices" :loading="loadingDevices" :disabled="devicesBusy">
            刷新设备列表
          </n-button>
        </div>

        <n-alert v-if="devicesError" type="error" class="devices-alert" :show-icon="false">
          {{ devicesError }}
        </n-alert>

        <div class="pairing-grid">
          <n-card size="small" class="pairing-panel-card" :bordered="false">
            <template #header>
              <div class="pairing-panel-header">
                <h3>待审批</h3>
                <n-tag size="small" round>{{ pendingRequests.length }}</n-tag>
              </div>
            </template>
            <n-spin :show="loadingDevices">
              <n-empty v-if="pendingRequests.length === 0" description="当前没有待审批的设备请求。" class="pairing-empty" />
              <n-scrollbar v-else x-scrollable class="pairing-scroll">
                <div class="pairing-list">
                  <n-card
                    v-for="request in pendingRequests"
                    :key="request.requestId || request.deviceId"
                    size="small"
                    embedded
                    class="pairing-item-card"
                    :bordered="false"
                  >
                    <div class="pairing-item-header">
                      <strong class="pairing-device-id">{{ request.deviceId || request.requestId || '未命名设备' }}</strong>
                      <n-tag size="small" type="warning" round>{{ request.role || 'operator' }}</n-tag>
                    </div>
                    <div class="pairing-meta-list">
                      <p class="pairing-meta mono">Request ID: {{ request.requestId || '未知' }}</p>
                      <p v-if="request.publicKey" class="pairing-meta mono">Key: {{ request.publicKey }}</p>
                      <p v-if="request.scopes?.length" class="pairing-meta">Scopes: {{ request.scopes.join(', ') }}</p>
                      <p v-if="request.requestedAtMs" class="pairing-meta">请求时间: {{ formatTimestamp(request.requestedAtMs) }}</p>
                    </div>
                    <n-space size="small" class="pairing-actions">
                      <n-button type="primary" size="small" @click="approveDevice(request.requestId)" :disabled="devicesBusy">
                        批准
                      </n-button>
                      <n-button size="small" @click="rejectDevice(request.requestId)" :disabled="devicesBusy || !request.requestId">
                        拒绝
                      </n-button>
                    </n-space>
                  </n-card>
                </div>
              </n-scrollbar>
            </n-spin>
          </n-card>

          <n-card size="small" class="pairing-panel-card" :bordered="false">
            <template #header>
              <div class="pairing-panel-header">
                <h3>已授权设备</h3>
                <n-tag size="small" round type="success">{{ pairedDevices.length }}</n-tag>
              </div>
            </template>
            <n-spin :show="loadingDevices">
              <n-empty v-if="pairedDevices.length === 0" description="当前没有已授权的 Control UI 设备。" class="pairing-empty" />
              <n-scrollbar v-else x-scrollable class="pairing-scroll">
                <div class="pairing-list">
                  <n-card
                    v-for="device in pairedDevices"
                    :key="device.deviceId"
                    size="small"
                    embedded
                    class="pairing-item-card"
                    :bordered="false"
                  >
                    <div class="pairing-item-header">
                      <strong class="pairing-device-id">{{ device.deviceId || '未知设备' }}</strong>
                      <n-tag size="small" round>{{ device.role || device.roles?.join(', ') || 'operator' }}</n-tag>
                    </div>
                    <div class="pairing-meta-list">
                      <p v-if="device.platform || device.deviceFamily" class="pairing-meta">
                        {{ [device.platform, device.deviceFamily].filter(Boolean).join(' · ') }}
                      </p>
                      <p v-if="device.publicKey" class="pairing-meta mono">Key: {{ device.publicKey }}</p>
                      <p v-if="device.scopes?.length" class="pairing-meta">Scopes: {{ device.scopes.join(', ') }}</p>
                      <p v-if="device.approvedAtMs" class="pairing-meta">授权时间: {{ formatTimestamp(device.approvedAtMs) }}</p>
                    </div>
                    <n-space size="small" class="pairing-actions">
                      <n-button size="small" tertiary @click="removeDevice(device.deviceId)" :disabled="devicesBusy || !device.deviceId">
                        移除
                      </n-button>
                    </n-space>
                  </n-card>
                </div>
              </n-scrollbar>
            </n-spin>
          </n-card>
        </div>
      </section>

      <!-- HTTP 端点 -->
      <section class="section-card gateway-section">
        <div class="section-header">
          <h2 class="section-title">HTTP 端点</h2>
          <p class="section-desc">网关对外暴露的 HTTP 接口开关</p>
        </div>
        <div class="form-group toggle-row">
          <span class="form-label">Chat Completions（/v1/chat/completions）</span>
          <label class="toggle">
            <input type="checkbox" v-model="form.chatCompletionsEnabled" @change="dirty=true" />
            <span class="toggle-track"></span>
          </label>
        </div>
      </section>

      <!-- 原始 JSON 预览 -->
      <section class="section-card gateway-section">
        <div class="section-header collapsible" @click="showRaw = !showRaw">
          <h2 class="section-title">原始 JSON 预览</h2>
          <span class="chevron">{{ showRaw ? '▲' : '▼' }}</span>
        </div>
        <pre v-if="showRaw" class="raw-json">{{ rawPreview }}</pre>
      </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NScrollbar, NSpace, NSpin, NTag } from 'naive-ui'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'

const toast = useToastStore()

const AUTH_MODES = [
  { value: 'none',           label: '无认证',       desc: '任何人都可访问（适合本地 loopback 部署）' },
  { value: 'token',          label: 'Token',        desc: '客户端通过 gateway token 建立 WS / HTTP 连接（ClawPanel 推荐）' },
  { value: 'password',       label: 'Password',     desc: '客户端使用密码访问网关' },
  { value: 'trusted-proxy',  label: 'Trusted Proxy', desc: '通过 Nginx 反代注入用户 Header（生产推荐）' },
]

const loading = ref(true)
const saving = ref(false)
const restarting = ref(false)
const dirty = ref(false)
const showRaw = ref(false)
const needsRestart = ref(false)
const loadingDevices = ref(false)
const devicesBusy = ref(false)
const devicesError = ref('')
const showToken = ref(false)
const showPassword = ref(false)
const pendingRequests = ref<any[]>([])
const pairedDevices = ref<any[]>([])

const form = reactive({
  port: 18789,
  mode: 'local',
  bind: 'loopback',
  authMode: 'none',
  token: '',
  password: '',
  trustedProxy: {
    userHeader: 'X-Forwarded-User',
    requiredHeaders: [] as string[],
    allowUsers: [] as string[],
  },
  trustedProxies: [] as string[],
  controlUiEnabled: true,
  allowedOrigins: ['*'] as string[],
  chatCompletionsEnabled: true,
})

// CSV helpers
const requiredHeadersStr = computed({
  get: () => form.trustedProxy.requiredHeaders.join(', '),
  set: (v: string) => { form.trustedProxy.requiredHeaders = v.split(',').map(s => s.trim()).filter(Boolean); dirty.value = true },
})
const allowUsersStr = computed({
  get: () => form.trustedProxy.allowUsers.join(', '),
  set: (v: string) => { form.trustedProxy.allowUsers = v.split(',').map(s => s.trim()).filter(Boolean); dirty.value = true },
})
const trustedProxiesStr = computed({
  get: () => form.trustedProxies.join(', '),
  set: (v: string) => { form.trustedProxies = v.split(',').map(s => s.trim()).filter(Boolean); dirty.value = true },
})
const allowedOriginsStr = computed({
  get: () => form.allowedOrigins.join(', '),
  set: (v: string) => { form.allowedOrigins = v.split(',').map(s => s.trim()).filter(Boolean); dirty.value = true },
})
const authModeLabel = computed(() => AUTH_MODES.find(m => m.value === form.authMode)?.label ?? form.authMode)
const authModeMeta = computed(() => {
  if (form.authMode === 'trusted-proxy') return '适合 Nginx 反代到 Gateway 的场景'
  if (form.authMode === 'token') return '推荐给 ClawPanel、Portal Chat 和 Control UI 使用'
  if (form.authMode === 'password') return '通过共享密码访问网关'
  return '按当前配置直接控制访问策略'
})
const officialControlUiUrl = computed(() => {
  if (typeof window === 'undefined') return '/'
  const loc = window.location
  const isLoopback = loc.hostname === '127.0.0.1' || loc.hostname === 'localhost' || loc.hostname === '::1'
  // Dev: portal runs on its own port, gateway on a different one — link straight
  // to the gateway port. Prod (nginx): portal and gateway share one origin via
  // path routing, so the origin root already is the gateway Control UI.
  const devDirect = isLoopback && !!loc.port && loc.port !== String(form.port)
  const base = devDirect
    ? `${loc.protocol}//${loc.hostname}:${form.port}/`
    : `${loc.origin}/`
  if (form.authMode === 'token' && form.token.trim()) {
    return `${base}#token=${encodeURIComponent(form.token.trim())}`
  }
  return base
})
const officialDocsUrl = 'https://docs.openclaw.ai/control-ui'

const rawPreview = computed(() => {
  return JSON.stringify(buildPayload(), null, 2)
})

function applyGateway(gw: any) {
  form.port = gw.port ?? 18789
  form.mode = gw.mode ?? 'local'
  form.bind = gw.bind ?? 'loopback'
  form.controlUiEnabled = gw.controlUi?.enabled ?? true
  form.allowedOrigins = gw.controlUi?.allowedOrigins ?? ['*']
  form.chatCompletionsEnabled = gw.http?.endpoints?.chatCompletions?.enabled ?? true
  form.authMode = gw.auth?.mode ?? 'none'
  form.token = gw.auth?.token ?? ''
  form.password = gw.auth?.password ?? ''
  if (gw.auth?.trustedProxy) {
    form.trustedProxy = {
      userHeader: gw.auth.trustedProxy.userHeader ?? 'X-Forwarded-User',
      requiredHeaders: gw.auth.trustedProxy.requiredHeaders ?? [],
      allowUsers: gw.auth.trustedProxy.allowUsers ?? [],
    }
  }
  form.trustedProxies = gw.trustedProxies ?? []
}

function buildPayload(): any {
  const auth: any = { mode: form.authMode }
  if (form.authMode === 'token') {
    auth.token = form.token.trim()
  } else if (form.authMode === 'password') {
    auth.password = form.password
  } else if (form.authMode === 'trusted-proxy') {
    auth.trustedProxy = {
      userHeader: form.trustedProxy.userHeader,
      requiredHeaders: form.trustedProxy.requiredHeaders,
      allowUsers: form.trustedProxy.allowUsers,
    }
  }
  return {
    port: form.port,
    mode: form.mode,
    bind: form.bind,
    controlUi: {
      enabled: form.controlUiEnabled,
      allowedOrigins: form.allowedOrigins,
    },
    auth,
    trustedProxies: form.trustedProxies,
    http: {
      endpoints: {
        chatCompletions: { enabled: form.chatCompletionsEnabled },
      },
    },
  }
}

let originalPort = 18789
let originalBind = 'loopback'
let originalAuthFingerprint = ''

function currentAuthFingerprint(): string {
  return JSON.stringify({
    authMode: form.authMode,
    token: form.token,
    password: form.password,
    trustedProxy: form.trustedProxy,
    trustedProxies: form.trustedProxies,
    allowedOrigins: form.allowedOrigins,
  })
}

function generateSecret(length = 48): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function regenerateToken() {
  form.token = generateSecret()
  dirty.value = true
}

async function copySecret(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(successMessage)
  } catch (e: any) {
    toast.error(`复制失败: ${e.message ?? '未知错误'}`)
  }
}

async function load() {
  loading.value = true
  dirty.value = false
  needsRestart.value = false
  try {
    const gw = await api.gateway.get()
    applyGateway(gw)
    originalPort = form.port
    originalBind = form.bind
    originalAuthFingerprint = currentAuthFingerprint()
    await loadDevices()
  } catch (e: any) {
    toast.error(`加载失败: ${e.message}`)
  } finally {
    loading.value = false
  }
}

function formatTimestamp(ts: number) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

async function loadDevices() {
  loadingDevices.value = true
  devicesError.value = ''
  try {
    const result = await api.gateway.listDevices()
    pendingRequests.value = result.pendingRequests ?? []
    pairedDevices.value = result.pairedDevices ?? []
  } catch (e: any) {
    devicesError.value = e.message ?? '设备列表加载失败'
  } finally {
    loadingDevices.value = false
  }
}

async function approveDevice(requestId?: string) {
  devicesBusy.value = true
  try {
    await api.gateway.approveDevice(requestId)
    toast.success('设备已批准')
    await loadDevices()
  } catch (e: any) {
    toast.error(`批准失败: ${e.message}`)
  } finally {
    devicesBusy.value = false
  }
}

async function rejectDevice(requestId?: string) {
  if (!requestId) return
  devicesBusy.value = true
  try {
    await api.gateway.rejectDevice(requestId)
    toast.success('设备请求已拒绝')
    await loadDevices()
  } catch (e: any) {
    toast.error(`拒绝失败: ${e.message}`)
  } finally {
    devicesBusy.value = false
  }
}

async function removeDevice(deviceId?: string) {
  if (!deviceId) return
  devicesBusy.value = true
  try {
    await api.gateway.removeDevice(deviceId)
    toast.success('设备已移除')
    await loadDevices()
  } catch (e: any) {
    toast.error(`移除失败: ${e.message}`)
  } finally {
    devicesBusy.value = false
  }
}

async function saveAll() {
  saving.value = true
  try {
    await api.gateway.update(buildPayload())
    toast.success('网关配置已保存')
    dirty.value = false
    if (form.port !== originalPort || form.bind !== originalBind || currentAuthFingerprint() !== originalAuthFingerprint) {
      needsRestart.value = true
    }
    originalPort = form.port
    originalBind = form.bind
    originalAuthFingerprint = currentAuthFingerprint()
  } catch (e: any) {
    toast.error(`保存失败: ${e.message}`)
  } finally {
    saving.value = false
  }
}

async function restart() {
  restarting.value = true
  try {
    await api.service.restart()
    toast.success('网关重启成功')
    needsRestart.value = false
  } catch (e: any) {
    toast.error(`重启失败: ${e.message}`)
  } finally {
    restarting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.dirty-hint { font-size: var(--text-xs); color: var(--accent); font-weight: 500; }

.gateway-metrics {
  margin-top: calc(var(--space-2) * -1);
}

.gateway-metric-copy {
  font-size: clamp(20px, 3vw, 30px);
}

.gateway-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.restart-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  background: linear-gradient(180deg, rgba(92, 51, 2, 0.12), rgba(125, 76, 0, 0.16));
  border: 1px solid rgba(124, 74, 0, 0.28);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  font-size: var(--text-sm);
  color: #FAB387;
}

.gateway-section {
  padding: var(--space-5);
}

.section-header.collapsible {
  cursor: pointer;
  margin-bottom: 0;
  border-bottom: none;
  padding-bottom: 0;
}
.section-header.collapsible:hover .section-title { color: var(--accent); }

.chevron { font-size: 11px; color: var(--text-muted); }

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.form-group { margin-bottom: 16px; }
.form-group:last-child { margin-bottom: 0; }

.form-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: .05em;
  margin-bottom: 6px;
}
.restart-tag {
  font-size: 10px;
  font-weight: 600;
  background: #2D1B00;
  color: #FAB387;
  border-radius: 3px;
  padding: 1px 5px;
  letter-spacing: 0;
  text-transform: none;
}

.hint { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; }

.devices-alert { margin-bottom: 16px; }

.control-ui-card :deep(.n-card__content) { padding: 16px 18px; }

.control-ui-card-body {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
}

.control-ui-card-main {
  min-width: 0;
  flex: 1;
}

.control-ui-link-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.control-ui-link {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
}

.control-ui-card-actions { flex-shrink: 0; }

.pairing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}

.pairing-panel-card :deep(.n-card__content) { padding-top: 0; }
.pairing-panel-card :deep(.n-card-header) { padding-bottom: 10px; }

.pairing-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pairing-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pairing-scroll {
  max-height: 520px;
  padding-right: 4px;
}

.pairing-item-card :deep(.n-card__content) {
  padding: 14px;
}

.pairing-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.pairing-device-id {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.pairing-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.pairing-meta-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pairing-actions {
  margin-top: 14px;
}

.pairing-empty {
  padding: 28px 0 18px;
}

@media (max-width: 900px) {
  .control-ui-card-body {
    flex-direction: column;
  }

  .control-ui-card-actions {
    width: 100%;
  }

  .control-ui-card-actions :deep(.n-space-item),
  .control-ui-card-actions :deep(.n-button) {
    width: 100%;
  }
}

/* Radio group */
.radio-group { display: flex; flex-direction: column; gap: 10px; }
.radio-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color .12s, background .12s;
}
.radio-item:has(input:checked) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.radio-item input { margin-top: 2px; accent-color: var(--accent); }
.radio-label { display: flex; flex-direction: column; gap: 2px; }
.radio-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.radio-desc { font-size: 12px; color: var(--text-muted); }

.secret-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.secret-row .form-input {
  flex: 1;
}

/* Toggle */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.toggle-row .form-label { margin-bottom: 0; }
.toggle { position: relative; display: inline-block; width: 38px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-track {
  position: absolute;
  inset: 0;
  background: var(--surface-3);
  border-radius: 11px;
  transition: background .2s;
  cursor: pointer;
}
.toggle-track::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 3px;
  top: 3px;
  background: var(--surface);
  border-radius: 50%;
  transition: transform .2s;
}
.toggle input:checked + .toggle-track { background: var(--accent); }
.toggle input:checked + .toggle-track::before { transform: translateX(16px); }

/* Raw JSON */
.raw-json {
  margin-top: 14px;
  background: #1C1917;
  color: #A6E3A1;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid #292524;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
