<template>
  <div class="page-shell page-shell-compact">
    <div class="page-header">
      <div>
        <h1 class="page-title">梦境模式</h1>
        <p class="subtitle">
          Dreaming 是 memory-core 的后台记忆固化系统:把短期信号经 Light / REM / Deep
          三阶段提升为长期记忆。默认关闭。
        </p>
      </div>
      <button class="btn" :disabled="loading" @click="refreshAll">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="loading && !status" class="loading-state">加载中…</div>

    <template v-else>
      <!-- ── 运行状态 ───────────────────────────────────────────── -->
      <div class="section-card dreaming-section">
        <div class="section-header">
          <div class="section-head-row">
            <div>
              <h2 class="section-title">运行状态</h2>
              <p class="section-desc">来自网关 doctor.memory.status(Agent: {{ agentId }})</p>
            </div>
            <span :class="['status-pill', dreamingEnabled ? 'pill-on' : 'pill-off']">
              {{ dreamingEnabled ? '已启用' : '未启用' }}
            </span>
          </div>
        </div>

        <div v-if="!status && initializing" class="empty-hint">网关 memory 子系统初始化中,自动重试…</div>
        <div v-else-if="!status" class="empty-hint">无法获取状态 — 网关未响应。</div>
        <template v-else>
          <!-- 计数卡片 -->
          <div class="stat-grid">
            <div class="stat-card">
              <span class="stat-value">{{ status.shortTermCount ?? 0 }}</span>
              <span class="stat-label">短期信号</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ status.totalSignalCount ?? 0 }}</span>
              <span class="stat-label">信号总数</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ status.groundedSignalCount ?? 0 }}</span>
              <span class="stat-label">grounded 信号</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ status.promotedToday ?? 0 }}</span>
              <span class="stat-label">今日已固化</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ status.promotedTotal ?? 0 }}</span>
              <span class="stat-label">累计已固化</span>
            </div>
          </div>

          <!-- 三阶段 -->
          <div class="phase-grid">
            <div v-for="p in phaseList" :key="p.key" class="phase-row">
              <span class="phase-name">{{ p.label }}</span>
              <span :class="['phase-dot', p.cfg?.enabled ? 'dot-on' : 'dot-off']"></span>
              <span class="phase-state">{{ p.cfg?.enabled ? '启用' : '停用' }}</span>
              <span class="phase-cron mono">{{ p.cfg?.cron ?? '—' }}</span>
              <span :class="['phase-cron-tag', p.cfg?.managedCronPresent ? 'tag-ok' : 'tag-miss']">
                {{ p.cfg?.managedCronPresent ? '托管任务在线' : '无托管任务' }}
              </span>
            </div>
          </div>
        </template>
      </div>

      <!-- ── 配置 ──────────────────────────────────────────────── -->
      <div class="section-card dreaming-section">
        <div class="section-header">
          <h2 class="section-title">配置</h2>
          <p class="section-desc">
            写入 <code class="mono">plugins.entries.memory-core.config.dreaming</code>。
            <strong>启用梦境会触发网关重启。</strong>
          </p>
        </div>

        <div class="form-row">
          <label class="form-label">梦境开关</label>
          <label class="switch">
            <input type="checkbox" v-model="form.enabled" />
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-text">{{ form.enabled ? '开启' : '关闭' }}</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">扫描频率(cron 表达式)</label>
          <input class="form-input mono" v-model="form.frequency" placeholder="0 3 * * *" />
          <p class="field-hint">完整梦境扫描的调度节奏。默认每日 03:00。</p>
        </div>

        <div class="form-group">
          <label class="form-label">Dream Diary 模型(可选)</label>
          <select v-if="modelOptions.length" class="form-select mono" v-model="form.model">
            <option value="">默认模型</option>
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
          </select>
          <input v-else class="form-input mono" v-model="form.model" placeholder="anthropic/claude-sonnet-4-6" />
          <p class="field-hint">
            梦境日记子代理的模型覆盖,从已配置的 Provider 模型中选择。选定后会自动打开
            <code class="mono">memory-core.subagent.allowModelOverride</code>。选「默认模型」则用默认。
          </p>
        </div>

        <div class="section-actions">
          <button class="btn btn-primary" :disabled="saving || !dirty" @click="onSave">
            {{ saving ? '保存中…' : '保存配置' }}
          </button>
          <button class="btn" :disabled="saving || !dirty" @click="resetForm">撤销改动</button>
        </div>
      </div>

      <!-- ── 手动执行 ──────────────────────────────────────────── -->
      <div class="section-card dreaming-section">
        <div class="section-header">
          <h2 class="section-title">手动执行</h2>
          <p class="section-desc">立即触发一次梦境扫描(运行托管任务「Memory Dreaming Promotion」)。</p>
        </div>
        <div class="section-actions">
          <button class="btn btn-primary" :disabled="running || !dreamingEnabled" @click="onRun">
            {{ running ? '执行中…' : '立即执行一次' }}
          </button>
          <span v-if="!dreamingEnabled" class="field-hint">需先启用梦境模式。</span>
        </div>
      </div>

      <!-- ── 梦境日记 ──────────────────────────────────────────── -->
      <div class="section-card dreaming-section">
        <div class="section-header">
          <div class="section-head-row">
            <div>
              <h2 class="section-title">梦境日记 DREAMS.md</h2>
              <p class="section-desc">主 Agent 工作区的人读梦境叙事输出。</p>
            </div>
            <button class="btn btn-sm" :disabled="diaryLoading" @click="loadDiary">
              {{ diaryLoading ? '加载中…' : '重新加载' }}
            </button>
          </div>
        </div>
        <div v-if="diary && diary.exists" class="diary-box">
          <pre class="diary-content">{{ diary.content }}</pre>
        </div>
        <div v-else class="empty-hint">暂无梦境日记 — 梦境扫描尚未产出 DREAMS.md。</div>
      </div>
    </template>

    <!-- 重启确认弹窗 -->
    <Teleport to="body">
      <div v-if="restartDialog.open" class="ui-modal-overlay" @click.self="restartDialog.open = false">
        <div class="ui-modal ui-modal-sm">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <div class="ui-modal-title">保存梦境配置</div>
              <div class="ui-modal-subtitle">
                保存会写入配置并重启网关 —— memory-core 需在网关启动时重新对账梦境托管任务,
                仅热重载不会生成任务。重启期间渠道与会话短暂中断,通常数秒内恢复。
              </div>
            </div>
            <button class="ui-modal-close" @click="restartDialog.open = false">✕</button>
          </div>
          <div class="ui-modal-footer">
            <button class="btn" :disabled="saving" @click="restartDialog.open = false">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="doSave">
              {{ saving ? '保存中…' : '确认保存并重启' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '../api/client'
import { useToastStore } from '../stores/toast'

const toast = useToastStore()

const loading = ref(true)
const saving = ref(false)
const running = ref(false)
const diaryLoading = ref(false)

const agentId = ref('main')
const status = ref<any | null>(null)
// memory-core 冷启动时网关首调 doctor.memory.status 超时,backend 会返回
// `{ initializing: true }`,UI 在此态自动轮询,不弹 toast.error。
const initializing = ref(false)
let initRetryTimer: ReturnType<typeof setTimeout> | null = null
const INIT_RETRY_DELAY_MS = 4000
const INIT_RETRY_MAX = 5
const diary = ref<{ exists: boolean; name: string; content: string } | null>(null)

// 表单 + 已保存基线(用于 dirty 判断)
const form = reactive({ enabled: false, frequency: '0 3 * * *', model: '' })
const saved = reactive({ enabled: false, frequency: '0 3 * * *', model: '' })

const restartDialog = reactive({ open: false })

// 已配置 Provider 的模型,供 Dream Diary 模型下拉选择
const modelProviders = ref<Record<string, any>>({})
const modelOptions = computed(() => {
  const opts: string[] = []
  for (const [pid, prov] of Object.entries(modelProviders.value)) {
    for (const m of (prov as any).models ?? []) opts.push(`${pid}/${m.id}`)
  }
  // 保留历史手填值,避免老配置切到下拉后选不中
  if (form.model && !opts.includes(form.model)) opts.unshift(form.model)
  return opts
})

const dreamingEnabled = computed(() => Boolean(status.value?.enabled))
const dirty = computed(() =>
  form.enabled !== saved.enabled ||
  form.frequency !== saved.frequency ||
  form.model !== saved.model,
)

const phaseList = computed(() => [
  { key: 'light', label: 'Light 阶段', cfg: status.value?.phases?.light },
  { key: 'deep',  label: 'Deep 阶段',  cfg: status.value?.phases?.deep },
  { key: 'rem',   label: 'REM 阶段',   cfg: status.value?.phases?.rem },
])

async function loadStatus(retryCount = 0) {
  if (initRetryTimer) {
    clearTimeout(initRetryTimer)
    initRetryTimer = null
  }
  try {
    const r = await api.dreaming.status()
    agentId.value = r.agentId
    if (r.initializing) {
      // 网关 memory 子系统冷启动,backend 返回 200 + initializing:true。
      // 静默轮询直到拿到真实状态;超过 INIT_RETRY_MAX 次仍未就绪才提示。
      initializing.value = true
      status.value = null
      if (retryCount < INIT_RETRY_MAX) {
        initRetryTimer = setTimeout(() => void loadStatus(retryCount + 1), INIT_RETRY_DELAY_MS)
      } else {
        toast.error('网关 memory 子系统初始化耗时过长,请稍后手动刷新')
      }
      return
    }
    initializing.value = false
    status.value = r.dreaming
  } catch (err: any) {
    initializing.value = false
    status.value = null
    toast.error(`状态加载失败: ${err.message}`)
  }
}

async function loadConfig() {
  try {
    const c = await api.dreaming.getConfig()
    saved.enabled = c.enabled
    saved.frequency = c.frequency
    saved.model = c.model
    resetForm()
  } catch (err: any) {
    toast.error(`配置加载失败: ${err.message}`)
  }
}

async function loadDiary() {
  diaryLoading.value = true
  try {
    diary.value = await api.dreaming.diary()
  } catch (err: any) {
    toast.error(`日记加载失败: ${err.message}`)
  } finally {
    diaryLoading.value = false
  }
}

async function loadModels() {
  try {
    const r = await api.models.list()
    modelProviders.value = r.providers ?? {}
  } catch {
    // 静默:拉取失败时下拉退化为手动输入框
  }
}

async function refreshAll() {
  loading.value = true
  try {
    await Promise.all([loadStatus(), loadConfig(), loadDiary(), loadModels()])
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.enabled = saved.enabled
  form.frequency = saved.frequency
  form.model = saved.model
}

function onSave() {
  // 梦境为启用态时,保存会触发网关重启(memory-core 需在网关启动时
  // 重新对账托管 cron 任务),先确认。关闭梦境则直接保存,不重启。
  if (form.enabled) {
    restartDialog.open = true
    return
  }
  void doSave()
}

async function doSave() {
  saving.value = true
  try {
    await api.dreaming.saveConfig({
      enabled: form.enabled,
      frequency: form.frequency,
      model: form.model,
    })
    saved.enabled = form.enabled
    saved.frequency = form.frequency
    saved.model = form.model
    restartDialog.open = false
    toast.success(form.enabled ? '配置已保存,网关重启中…' : '配置已保存')
    // 重启需数秒,延后刷新状态以反映托管任务对账结果
    setTimeout(() => { void loadStatus() }, 2500)
    if (form.enabled) setTimeout(() => { void refreshAll() }, 9000)
  } catch (err: any) {
    toast.error(`保存失败: ${err.message}`)
  } finally {
    saving.value = false
  }
}

async function onRun() {
  running.value = true
  try {
    const r = await api.dreaming.run()
    toast.success(`已触发梦境扫描(任务:${r.jobName}）`)
    setTimeout(() => { void loadStatus() }, 2500)
  } catch (err: any) {
    toast.error(`触发失败: ${err.message}`)
  } finally {
    running.value = false
  }
}

onMounted(refreshAll)
onBeforeUnmount(() => {
  if (initRetryTimer) {
    clearTimeout(initRetryTimer)
    initRetryTimer = null
  }
})
</script>

<style scoped>
.dreaming-section { padding: var(--space-6); margin-bottom: var(--space-4); }

.section-head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
}

.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.pill-on  { background: color-mix(in srgb, #10b981 15%, transparent); color: #059669; }
.pill-off { background: var(--muted-bg); color: var(--text-muted); }

/* 计数卡片 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.stat-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
}
.stat-label { font-size: 11px; color: var(--text-muted); }

/* 三阶段 */
.phase-grid { display: flex; flex-direction: column; gap: 6px; }
.phase-row {
  display: grid;
  grid-template-columns: 90px 10px 48px 1fr auto;
  gap: 10px;
  align-items: center;
  font-size: 12px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-radius: 6px;
}
.phase-name { font-weight: 600; color: var(--text-primary); }
.phase-dot { width: 8px; height: 8px; border-radius: 50%; }
.dot-on  { background: #10b981; }
.dot-off { background: var(--text-muted); }
.phase-state { color: var(--text-secondary); }
.phase-cron { color: var(--text-secondary); }
.phase-cron-tag { font-size: 11px; font-weight: 600; }
.tag-ok   { color: #059669; }
.tag-miss { color: var(--text-muted); }

/* 表单 */
.form-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.field-hint { font-size: 11px; color: var(--text-muted); margin: 4px 0 0; }

/* 开关 */
.switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.switch input { display: none; }
.switch-track {
  width: 38px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--muted-bg);
  position: relative;
  transition: background 160ms ease;
}
.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  transition: transform 160ms ease;
}
.switch input:checked + .switch-track { background: #10b981; }
.switch input:checked + .switch-track .switch-thumb { transform: translateX(16px); }
.switch-text { font-size: 13px; color: var(--text-secondary); }

/* 日记 */
.diary-box {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  max-height: 420px;
  overflow: auto;
}
.diary-content {
  margin: 0;
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.empty-hint { font-size: 13px; color: var(--text-muted); padding: 12px 0; }
.mono { font-family: var(--font-mono); }
code.mono {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.92em;
}
</style>
