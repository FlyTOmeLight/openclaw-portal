<template>
  <div class="page-shell page-shell-compact">
    <div class="page-header">
      <div>
        <h1 class="page-title">门户升级</h1>
        <p class="subtitle">上传新版升级包,在线完成门户升级,无需登录服务器手动操作。</p>
      </div>
    </div>

    <div v-if="loading" class="loading-state">加载中…</div>

    <template v-else>
      <!-- 不支持提示 -->
      <div v-if="!info.supported" class="section-card upgrade-unsupported">
        <h2 class="section-title">网页升级尚未启用</h2>
        <p class="section-desc">
          当前部署缺少升级执行脚本。请先用新版离线安装包跑一次
          <code>offline-install-kylin.sh --only portal</code>
          （会安装升级脚本、staging 目录与 sudoers 授权),之后即可在此页面在线升级。
        </p>
      </div>

      <!-- 当前版本 -->
      <div class="section-card settings-section">
        <div class="section-header">
          <div class="section-head-row">
            <div>
              <h2 class="section-title">当前版本</h2>
              <p class="section-desc">门户后端当前运行的版本与构建时间。</p>
            </div>
            <button
              v-if="info.rollbackAvailable"
              class="btn"
              :disabled="phase === 'applying'"
              @click="askRollback"
            >回滚上一版本</button>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">版本号</span>
            <span class="info-value mono">{{ info.version || '未知' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">构建时间</span>
            <span class="info-value mono">{{ formatTime(info.builtAt) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">可回滚版本</span>
            <span class="info-value">{{ info.rollbackAvailable ? (typeLabel(info.rollbackType) + ' · 已保留') : '无' }}</span>
          </div>
        </div>

        <!-- 上次升级结果 -->
        <div v-if="info.lastResult" :class="['last-result', info.lastResult.ok ? 'lr-ok' : 'lr-fail']">
          <span class="lr-dot"></span>
          <span class="lr-text">
            上次{{ info.lastResult.action === 'rollback' ? '回滚' : '升级' }}:
            {{ info.lastResult.ok ? '成功' : '失败' }} —— {{ info.lastResult.message || '' }}
          </span>
          <button
            v-if="info.lastResult.ok && info.lastResult.type === 'frontend'"
            class="btn btn-sm"
            @click="reloadPage"
          >刷新页面</button>
        </div>
      </div>

      <!-- 升级中 -->
      <div v-if="phase === 'applying'" class="section-card apply-card">
        <div class="apply-spinner"></div>
        <div class="apply-text">
          <strong>{{ applyMsg }}</strong>
          <p>请勿关闭此页面。后端包升级时门户会短暂重启,失败会自动回滚到旧版。</p>
        </div>
      </div>

      <!-- 上传升级包 -->
      <div v-else class="section-card settings-section">
        <div class="section-header">
          <h2 class="section-title">上传升级包</h2>
          <p class="section-desc">
            支持三类 <code>.tar.gz</code> 包:前端包(免重启)、后端代码包(小、快)、完整后端包(含依赖)。
            类型由包内 manifest 自动识别。
          </p>
        </div>

        <label
          class="dropzone"
          :class="{ 'dropzone-active': dragOver, 'dropzone-filled': !!selectedFile }"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <input type="file" accept=".tar.gz,.tgz" class="dropzone-input" @change="pickFile" />
          <template v-if="selectedFile">
            <div class="dz-filename mono">{{ selectedFile.name }}</div>
            <div class="dz-meta">{{ formatBytes(selectedFile.size) }} · 点击可重新选择</div>
          </template>
          <template v-else>
            <div class="dz-icon">⬆</div>
            <div class="dz-hint">拖拽 .tar.gz 升级包到此处,或点击选择文件</div>
          </template>
        </label>

        <div v-if="selectedFile" class="section-actions">
          <button class="btn btn-primary" @click="askUpgrade">开始升级</button>
          <button class="btn" @click="selectedFile = null">重新选择</button>
        </div>

        <p class="upgrade-disk-note">
          离线提示:升级包需在有网环境用 <code>make pack-quick</code>(前端 + 后端代码包)或
          <code>make pack</code>(完整后端包)生成后再上传。
        </p>
      </div>
    </template>

    <!-- 确认弹窗 -->
    <Teleport to="body">
      <div v-if="confirmDlg.open" class="ui-modal-overlay" @click.self="confirmDlg.open = false">
        <div class="ui-modal ui-modal-sm">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">{{ confirmDlg.mode === 'rollback' ? '确认回滚' : '确认升级' }}</div>
              <div class="ui-modal-subtitle">
                <template v-if="confirmDlg.mode === 'rollback'">
                  将把门户回滚到上一版本（{{ typeLabel(info.rollbackType) }}）。后端回滚会重启门户,约 10–30 秒不可用。
                </template>
                <template v-else>
                  升级包类型由后端自动识别。若为后端包,门户会重启,约 10–30 秒不可用;新版本若启动失败会自动回滚到旧版。
                </template>
              </div>
            </div>
            <button class="ui-modal-close" @click="confirmDlg.open = false">✕</button>
          </div>
          <div class="ui-modal-footer">
            <button class="btn" @click="confirmDlg.open = false">取消</button>
            <button class="btn btn-primary" @click="doConfirm">
              {{ confirmDlg.mode === 'rollback' ? '确认回滚' : '确认升级' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { api } from '../api/client'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()
const loading = ref(true)
const phase = ref<'idle' | 'applying'>('idle')
const applyMsg = ref('')
const selectedFile = ref<File | null>(null)
const dragOver = ref(false)
const confirmDlg = reactive({ open: false, mode: 'upgrade' as 'upgrade' | 'rollback' })

const info = reactive({
  version: '',
  builtAt: null as string | null,
  supported: false,
  busy: false,
  rollbackAvailable: false,
  rollbackType: null as 'frontend' | 'backend-dist' | 'backend-full' | null,
  lastResult: null as { ok: boolean; action?: string; type?: string; version?: string; message?: string } | null,
})

const TYPE_LABEL: Record<string, string> = {
  frontend: '前端', 'backend-dist': '后端代码', 'backend-full': '完整后端',
}
function typeLabel(t: string | null | undefined): string {
  return t ? (TYPE_LABEL[t] ?? t) : '—'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function formatTime(iso: string | null): string {
  if (!iso) return '未知'
  try {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return iso }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollDeadline = 0

async function loadVersion() {
  try {
    Object.assign(info, await api.system.version())
    // A web upgrade left running (e.g. page reopened mid-restart) — resume.
    if (info.busy && phase.value === 'idle') {
      phase.value = 'applying'
      applyMsg.value = '检测到正在进行的升级,等待完成…'
      startPolling()
    }
  } catch {
    // portal may be mid-restart — ignore
  } finally {
    loading.value = false
  }
}

function pickFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) selectedFile.value = f
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) selectedFile.value = f
}

function askUpgrade() {
  if (!selectedFile.value) return
  if (!/\.(tar\.gz|tgz)$/i.test(selectedFile.value.name)) {
    toast.error('升级包必须是 .tar.gz 文件')
    return
  }
  confirmDlg.mode = 'upgrade'
  confirmDlg.open = true
}
function askRollback() {
  confirmDlg.mode = 'rollback'
  confirmDlg.open = true
}

async function doConfirm() {
  confirmDlg.open = false
  if (confirmDlg.mode === 'rollback') await runRollback()
  else await runUpgrade()
}

async function runUpgrade() {
  if (!selectedFile.value) return
  phase.value = 'applying'
  applyMsg.value = '上传并校验升级包…'
  try {
    const res = await api.system.upgrade(selectedFile.value)
    applyMsg.value = res.restarting
      ? `已识别${typeLabel(res.type)}升级包,门户正在重启…`
      : `已识别${typeLabel(res.type)}升级包,正在应用…`
    selectedFile.value = null
    startPolling()
  } catch (e: any) {
    phase.value = 'idle'
    toast.error(e?.message ?? '升级失败')
  }
}

async function runRollback() {
  phase.value = 'applying'
  applyMsg.value = '正在回滚到上一版本…'
  try {
    const res = await api.system.rollback()
    applyMsg.value = res.restarting ? '门户正在重启以完成回滚…' : '正在回滚…'
    startPolling()
  } catch (e: any) {
    phase.value = 'idle'
    toast.error(e?.message ?? '回滚失败')
  }
}

function startPolling() {
  pollDeadline = Date.now() + 100_000   // 100s ceiling
  schedulePoll(2500)
}
function schedulePoll(delay: number) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, delay)
}
async function poll() {
  if (Date.now() > pollDeadline) {
    phase.value = 'idle'
    toast.error('升级超时,请检查门户状态(staging 目录下的 apply.log)')
    await loadVersion()
    return
  }
  try {
    const st = await api.system.upgradeStatus()
    if (st.state === 'done') {
      phase.value = 'idle'
      const r = st.result
      if (r?.ok) toast.success(r.message ?? '升级完成')
      else toast.error(r?.message ?? '升级失败,已自动回滚')
      await loadVersion()
      return
    }
    applyMsg.value = '正在应用升级,请稍候…'
  } catch {
    // portal unreachable — restarting; keep polling
    applyMsg.value = '门户重启中,等待恢复…'
  }
  schedulePoll(2500)
}

function reloadPage() {
  window.location.reload()
}

onMounted(loadVersion)
onUnmounted(() => { if (pollTimer) clearTimeout(pollTimer) })
</script>

<style scoped>
.settings-section { padding: var(--space-6); }
.section-head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-4); }
.mono { font-family: var(--font-mono); }

.upgrade-unsupported {
  padding: var(--space-6);
  border-left: 3px solid #f59e0b;
}
.upgrade-unsupported code,
.upgrade-disk-note code,
.section-desc code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-label { font-size: 11px; color: var(--text-muted); }
.info-value { font-size: 13px; color: var(--text-primary); font-weight: 500; }

/* ── Last result banner ── */
.last-result {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: var(--space-4);
  padding: 8px 12px;
  border-radius: var(--radius-md, 6px);
  font-size: 12px;
}
.lr-ok   { background: color-mix(in srgb, #10b981 10%, transparent); color: var(--text-secondary); }
.lr-fail { background: color-mix(in srgb, #ef4444 10%, transparent); color: var(--text-secondary); }
.lr-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.lr-ok   .lr-dot { background: #10b981; }
.lr-fail .lr-dot { background: #ef4444; }
.lr-text { flex: 1; }
.btn-sm { padding: 3px 10px; font-size: 11px; }

/* ── Dropzone ── */
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--space-6);
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
  text-align: center;
}
.dropzone:hover,
.dropzone-active { border-color: var(--accent, #6366f1); background: color-mix(in srgb, var(--accent, #6366f1) 6%, transparent); }
.dropzone-filled { border-style: solid; }
.dropzone-input { display: none; }
.dz-icon { font-size: 24px; color: var(--text-muted); }
.dz-hint { font-size: 13px; color: var(--text-secondary); }
.dz-filename { font-size: 13px; color: var(--text-primary); font-weight: 600; word-break: break-all; }
.dz-meta { font-size: 11px; color: var(--text-muted); }

.upgrade-disk-note { margin-top: var(--space-4); font-size: 11px; color: var(--text-muted); line-height: 1.6; }

/* ── Applying card ── */
.apply-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6);
  border-left: 3px solid var(--accent, #6366f1);
}
.apply-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent, #6366f1);
  border-radius: 50%;
  flex-shrink: 0;
  animation: upg-spin 0.8s linear infinite;
}
@keyframes upg-spin { to { transform: rotate(360deg); } }
.apply-text strong { font-size: 14px; color: var(--text-primary); }
.apply-text p { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
</style>
