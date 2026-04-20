<template>
  <div class="diagnosis-page page-shell">
    <!-- Header -->
    <div class="page-header">
      <div>
        <h1 class="page-title">系统诊断</h1>
        <p class="subtitle">环境依赖 + OpenClaw 组件健康 + Doctor 一键修复</p>
      </div>
      <div class="header-actions">
        <button @click="runAll" :disabled="running" class="btn">
          <span v-if="running" class="spin">⟳</span>{{ running ? '检查中…' : '刷新状态' }}
        </button>
        <button @click="runDoctor" :disabled="doctorRunning" class="btn">{{ doctorRunning ? '诊断中…' : '运行 Doctor' }}</button>
        <button @click="runDoctorFix" :disabled="doctorFixRunning" class="btn btn-primary">{{ doctorFixRunning ? '修复中…' : '自动修复' }}</button>
        <button @click="startWsTest" :disabled="wsRunning" class="btn">{{ wsRunning ? '测试中…' : '测试 WebSocket' }}</button>
        <button @click="toggleNetLog" class="btn" :class="{ 'btn-active': showNetLog }">网络日志</button>
      </div>
    </div>

    <!-- Environment probes (Node/bin/ports/perms/resources/network) -->
    <EnvProbeList />

    <!-- Status Banner -->
    <div v-if="results.length" class="status-banner" :class="bannerClass">
      <span class="banner-icon">{{ bannerIcon }}</span>
      <div class="banner-body">
        <span class="banner-title">{{ bannerTitle }}</span>
        <span class="banner-counts">
          <span v-if="counts.error" class="cpill cerr">{{ counts.error }} 个错误</span>
          <span v-if="counts.warn"  class="cpill cwarn">{{ counts.warn }} 个警告</span>
          <span v-if="counts.ok"   class="cpill cok">{{ counts.ok }} 项正常</span>
        </span>
      </div>
      <span class="banner-time" v-if="lastRun">{{ lastRun }}</span>
    </div>

    <!-- Check results grid -->
    <div class="section-label">检查项</div>
    <div v-if="running && !results.length" class="check-grid">
      <div v-for="i in 6" :key="i" class="card check-card">
        <div class="skel skel-h" /><div class="skel skel-l" /><div class="skel skel-l short" />
      </div>
    </div>
    <div v-else class="check-grid">
      <div v-for="r in results" :key="r.name" class="card check-card" :class="`s-${r.status}`">
        <div class="cc-head">
          <span class="cc-dot" :class="`d-${r.status}`"></span>
          <span class="cc-label">{{ r.label }}</span>
          <span class="cc-badge" :class="`b-${r.status}`">{{ ST[r.status] }}</span>
        </div>
        <p class="cc-msg">{{ r.message }}</p>
        <p v-if="r.detail" class="cc-detail">{{ r.detail }}</p>
        <div v-if="r.repairable" class="cc-foot">
          <button @click="repair(r.name)" :disabled="repairing === r.name" class="btn btn-sm">
            {{ repairing === r.name ? '修复中…' : '自动修复' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Info cards -->
    <div v-if="svcInfo" class="section-label">运行时信息</div>
    <div v-if="svcInfo" class="info-grid">
      <!-- Service status -->
      <div class="card info-card">
        <div class="ic-title">服务状态</div>
        <table class="dtable">
          <tr>
            <td class="dtd-label">运行状态</td>
            <td class="dtd-val">
              <span class="status-dot" :class="svcInfo.service.state === 'running' ? 'dot-ok' : 'dot-err'"></span>
              {{ svcInfo.service.state === 'running' ? '运行中' : '已停止' }}
            </td>
          </tr>
          <tr>
            <td class="dtd-label">进程 PID</td>
            <td class="dtd-val mono">{{ svcInfo.service.pid ?? '—' }}</td>
          </tr>
          <tr>
            <td class="dtd-label">二进制</td>
            <td class="dtd-val mono small">{{ svcInfo.service.binary }}</td>
          </tr>
          <tr>
            <td class="dtd-label">数据目录</td>
            <td class="dtd-val mono small">{{ svcInfo.openclawHome }}</td>
          </tr>
        </table>
      </div>

      <!-- Config summary -->
      <div class="card info-card">
        <div class="ic-title">网关配置</div>
        <table class="dtable">
          <tr>
            <td class="dtd-label">网关端口</td>
            <td class="dtd-val mono">{{ svcInfo.gatewayPort }}</td>
          </tr>
          <tr>
            <td class="dtd-label">Portal 端口</td>
            <td class="dtd-val mono">{{ svcInfo.portalPort }}</td>
          </tr>
          <tr>
            <td class="dtd-label">认证模式</td>
            <td class="dtd-val mono">{{ svcInfo.config.authMode ?? '—' }}</td>
          </tr>
          <tr>
            <td class="dtd-label">主模型</td>
            <td class="dtd-val mono small">{{ svcInfo.config.primaryModel }}</td>
          </tr>
          <tr>
            <td class="dtd-label">模型提供商</td>
            <td class="dtd-val">{{ svcInfo.config.providerCount }} 个</td>
          </tr>
        </table>
      </div>

      <!-- Version info -->
      <div class="card info-card">
        <div class="ic-title">版本信息</div>
        <table class="dtable">
          <tr>
            <td class="dtd-label">OpenClaw</td>
            <td class="dtd-val mono small">{{ svcInfo.versions.openclaw }}</td>
          </tr>
          <tr>
            <td class="dtd-label">Node.js</td>
            <td class="dtd-val mono">
              <span v-if="svcInfo.versions.node !== '(未知)'" class="status-dot dot-ok"></span>
              <span v-else class="status-dot dot-err"></span>
              {{ svcInfo.versions.node }}
            </td>
          </tr>
          <tr>
            <td class="dtd-label">agent-browser</td>
            <td class="dtd-val mono small">{{ svcInfo.versions.agentBrowser }}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Doctor output -->
    <div v-if="doctorOutput !== null" class="card output-panel">
      <div class="op-head">
        <span class="op-title mono">{{ doctorFixUsed ? 'openclaw doctor --fix' : 'openclaw doctor' }}</span>
        <button class="btn btn-xs btn-ghost" @click="doctorOutput = null">关闭</button>
      </div>
      <pre class="op-pre">{{ doctorOutput || '（无输出）' }}</pre>
    </div>

    <!-- WebSocket test log -->
    <div v-if="wsLog.length || wsRunning" class="card output-panel">
      <div class="op-head">
        <span class="op-title mono">WebSocket 连接测试</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-xs btn-ghost" @click="wsLog = []">清除</button>
        </div>
      </div>
      <pre ref="wsLogEl" class="op-pre ws-pre">{{ wsLog.join('\n') }}</pre>
    </div>

    <!-- Network log -->
    <div v-if="showNetLog" class="card output-panel">
      <div class="op-head">
        <span class="op-title">网络请求日志</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="net-stat">共 {{ netEntries.length }} 条</span>
          <span class="net-stat">
            均耗时 {{ netEntries.length ? Math.round(netEntries.reduce((s,e)=>s+e.durationMs,0)/netEntries.length) : 0 }} ms
          </span>
          <button class="btn btn-xs" @click="loadNetLog">刷新</button>
          <button class="btn btn-xs btn-ghost" @click="clearNetLog">清除</button>
        </div>
      </div>
      <div class="net-table-wrap">
        <table class="net-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>方法</th>
              <th>路径</th>
              <th class="th-r">状态</th>
              <th class="th-r">耗时</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!netEntries.length">
              <td colspan="5" class="net-empty">暂无记录</td>
            </tr>
            <tr v-for="e in netEntries" :key="e.ts" class="net-row">
              <td class="mono small">{{ fmtTime(e.ts) }}</td>
              <td class="mono small">{{ e.method }}</td>
              <td class="mono small net-url" :title="e.url">{{ e.url }}</td>
              <td class="th-r" :class="statusClass(e.status)">{{ e.status }}</td>
              <td class="th-r mono small" :class="durationClass(e.durationMs)">{{ e.durationMs }}ms</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'
import EnvProbeList from '../components/EnvProbeList.vue'

interface CheckResult {
  name: string; label: string; status: 'ok' | 'warn' | 'error'
  message: string; detail?: string; repairable?: boolean
}

const toast = useToastStore()
const results  = ref<CheckResult[]>([])
const running  = ref(false)
const repairing = ref<string | null>(null)
const lastRun  = ref('')
const svcInfo  = ref<any>(null)

const doctorOutput   = ref<string | null>(null)
const doctorRunning  = ref(false)
const doctorFixRunning = ref(false)
const doctorFixUsed  = ref(false)

const wsRunning = ref(false)
const wsLog     = ref<string[]>([])
const wsLogEl   = ref<HTMLPreElement | null>(null)

const showNetLog  = ref(false)
const netEntries  = ref<any[]>([])

const ST = { ok: '正常', warn: '警告', error: '错误' }

const counts = computed(() => ({
  ok:    results.value.filter(r => r.status === 'ok').length,
  warn:  results.value.filter(r => r.status === 'warn').length,
  error: results.value.filter(r => r.status === 'error').length,
}))
const bannerClass = computed(() =>
  counts.value.error ? 'banner-error' : counts.value.warn ? 'banner-warn' : 'banner-ok')
const bannerIcon  = computed(() =>
  counts.value.error ? '✕' : counts.value.warn ? '⚠' : '✓')
const bannerTitle = computed(() =>
  counts.value.error ? '发现错误，请处理后重试' :
  counts.value.warn  ? '存在警告，建议检查' : '所有检查项正常')

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function statusClass(s: number) {
  return s >= 500 ? 'td-err' : s >= 400 ? 'td-warn' : 'td-ok'
}
function durationClass(ms: number) {
  return ms > 1000 ? 'td-err' : ms > 500 ? 'td-warn' : ''
}

onMounted(async () => {
  await Promise.all([runAll(), loadSvcInfo()])
})

async function runAll() {
  running.value = true
  try {
    results.value = await api.diagnosis.runAll()
    lastRun.value = new Date().toLocaleTimeString('zh-CN')
  } catch (err: any) {
    toast.error(`诊断失败: ${err.message}`)
  } finally {
    running.value = false
  }
}

async function loadSvcInfo() {
  try { svcInfo.value = await api.diagnosis.serviceInfo() } catch { /* ignore */ }
}

async function repair(name: string) {
  repairing.value = name
  try {
    const result = await api.diagnosis.repair(name)
    toast.success(result.ok ? '修复成功' : '修复完成，请重新检查')
    const updated = await api.diagnosis.runCheck(name)
    const idx = results.value.findIndex(r => r.name === name)
    if (idx >= 0) results.value[idx] = updated
  } catch (err: any) {
    toast.error(`修复失败: ${err.message}`)
  } finally {
    repairing.value = null
  }
}

async function runDoctor() {
  doctorRunning.value = true; doctorFixUsed.value = false
  try {
    const { output } = await api.diagnosis.doctor()
    doctorOutput.value = output
  } catch (err: any) {
    toast.error(`Doctor 运行失败: ${err.message}`)
  } finally {
    doctorRunning.value = false }
}

async function runDoctorFix() {
  doctorFixRunning.value = true; doctorFixUsed.value = true
  try {
    const { output } = await api.diagnosis.doctorFix()
    doctorOutput.value = output
    toast.success('Doctor --fix 执行完成')
    await runAll()
  } catch (err: any) {
    toast.error(`Doctor Fix 失败: ${err.message}`)
  } finally {
    doctorFixRunning.value = false }
}

// WebSocket test — connects to portal's /api/ws
function wsAppend(msg: string) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  wsLog.value.push(`[${ts}] ${msg}`)
  nextTick(() => {
    if (wsLogEl.value) wsLogEl.value.scrollTop = wsLogEl.value.scrollHeight
  })
}

async function startWsTest() {
  wsRunning.value = true
  wsLog.value = []
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/ws`
  wsAppend(`▶ 连接到 ${wsUrl}`)

  const ws = new WebSocket(wsUrl)

  const timeout = setTimeout(() => {
    wsAppend('✕ 连接超时（10s）')
    ws.close()
    wsRunning.value = false
  }, 10_000)

  ws.onopen = () => {
    wsAppend('✓ WebSocket 已连接')
    wsAppend('  等待服务器消息…')
  }
  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      wsAppend(`← 收到消息: type=${data.type ?? '?'} state=${data.state ?? '?'}`)
      clearTimeout(timeout)
      wsAppend('✓ 握手成功，连接正常')
      ws.close(1000, 'test complete')
    } catch {
      wsAppend(`← 收到原始数据: ${String(e.data).slice(0, 120)}`)
    }
  }
  ws.onerror = () => {
    wsAppend('✕ WebSocket 连接错误')
  }
  ws.onclose = (e) => {
    clearTimeout(timeout)
    wsAppend(`■ 连接关闭 (code=${e.code}${e.reason ? ' reason=' + e.reason : ''})`)
    wsRunning.value = false
  }
}

async function loadNetLog() {
  try {
    const { entries } = await api.diagnosis.networkLog()
    netEntries.value = entries
  } catch { /* ignore */ }
}

async function toggleNetLog() {
  showNetLog.value = !showNetLog.value
  if (showNetLog.value) await loadNetLog()
}

async function clearNetLog() {
  await api.diagnosis.clearNetworkLog()
  netEntries.value = []
}
</script>

<style scoped>
.subtitle { color: var(--text-secondary); font-size: var(--text-sm); margin-top: 2px; }
.header-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
.btn-active { background: var(--accent-subtle); border-color: var(--accent); color: var(--accent); }

/* Banner */
.status-banner {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg); border: 1px solid transparent;
  margin-bottom: var(--space-2);
}
.banner-ok    { background: var(--success-bg); border-color: #bbf7d0; color: var(--success-text); }
.banner-warn  { background: var(--warn-bg);    border-color: #fde68a; color: var(--warn-text); }
.banner-error { background: var(--error-bg);   border-color: #fecaca; color: var(--error-text); }
.banner-icon  { font-size: 20px; font-weight: 700; flex-shrink: 0; }
.banner-body  { flex: 1; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.banner-title { font-size: var(--text-sm); font-weight: 600; }
.banner-counts { display: flex; gap: var(--space-2); }
.cpill { font-size: 11px; font-weight: 500; padding: 1px 8px; border-radius: var(--radius-full); background: rgba(0,0,0,.07); }
.banner-time { font-size: var(--text-xs); opacity: .7; flex-shrink: 0; }

/* Section label */
.section-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .07em; color: var(--text-muted);
  margin: var(--space-5) 0 var(--space-3);
}

/* Skeleton */
.skel { background: var(--border); border-radius: var(--radius-sm); animation: shimmer 1.4s ease-in-out infinite; }
.skel-h  { height: 16px; width: 50%; margin-bottom: var(--space-3); }
.skel-l  { height: 12px; width: 85%; margin-bottom: var(--space-2); }
.skel-l.short { width: 55%; }
@keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:.35} }

/* Check grid */
.check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-2); }
.check-card { padding: var(--space-4); border-left: 3px solid var(--border); }
.s-ok    { border-left-color: #22c55e; }
.s-warn  { border-left-color: var(--warn-text); }
.s-error { border-left-color: var(--error-text); }

.cc-head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.cc-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.d-ok    { background: #22c55e; }
.d-warn  { background: #f59e0b; }
.d-error { background: var(--error-text); }
.cc-label { flex: 1; font-size: var(--text-sm); font-weight: 600; }
.cc-badge { font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-full); }
.b-ok    { background: var(--success-bg); color: var(--success-text); }
.b-warn  { background: var(--warn-bg);    color: var(--warn-text); }
.b-error { background: var(--error-bg);   color: var(--error-text); }
.cc-msg  { font-size: var(--text-sm); color: var(--text-secondary); margin: 0; line-height: 1.5; }
.cc-detail { font-size: var(--text-xs); color: var(--text-muted); font-family: var(--font-mono); margin: var(--space-2) 0 0; }
.cc-foot { margin-top: var(--space-3); }

/* Info cards */
.info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-2); }
.info-card { padding: var(--space-4); }
.ic-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); margin-bottom: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--border); }

.dtable { width: 100%; border-collapse: collapse; }
.dtable tr + tr td { padding-top: 6px; }
.dtd-label { font-size: var(--text-xs); color: var(--text-muted); width: 90px; vertical-align: top; padding-top: 1px; }
.dtd-val { font-size: var(--text-xs); color: var(--text-primary); }
.dtd-val.mono { font-family: var(--font-mono); }
.dtd-val.small { font-size: 11px; word-break: break-all; }

.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
.dot-ok  { background: #22c55e; }
.dot-err { background: var(--error-text); }

/* Output panels */
.output-panel { padding: 0; overflow: hidden; margin-top: var(--space-4); }
.op-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.op-title { font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary); }
.op-title.mono { font-family: var(--font-mono); }
.op-pre {
  font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
  color: var(--text-primary); background: var(--surface);
  padding: var(--space-4); margin: 0;
  max-height: 300px; overflow-y: auto;
  white-space: pre-wrap; word-break: break-all;
}
.ws-pre { max-height: 360px; }

/* Network log */
.net-stat { font-size: var(--text-xs); color: var(--text-muted); }
.net-table-wrap { overflow-x: auto; max-height: 400px; overflow-y: auto; }
.net-table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); }
.net-table th { padding: 6px 12px; text-align: left; font-weight: 600; color: var(--text-muted); background: var(--surface-2); border-bottom: 1px solid var(--border); position: sticky; top: 0; }
.th-r { text-align: right !important; }
.net-table td { padding: 5px 12px; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
.net-table tr:last-child td { border-bottom: none; }
.net-row:hover td { background: var(--surface-2); }
.net-url { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.net-empty { text-align: center; color: var(--text-muted); padding: var(--space-4) !important; }
.td-ok   { color: var(--success-text); }
.td-warn { color: var(--warn-text); }
.td-err  { color: var(--error-text); }
.mono  { font-family: var(--font-mono); }
.small { font-size: 11px; }

.spin { display: inline-block; animation: spin .8s linear infinite; margin-right: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
