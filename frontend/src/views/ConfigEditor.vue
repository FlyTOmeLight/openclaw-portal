<template>
  <div class="config-editor-page page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">配置文件编辑</h1>
        <p class="subtitle">{{ configPath }}</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-sm" @click="showBackups = !showBackups">
          {{ showBackups ? '隐藏备份' : `查看备份 (${backups.length})` }}
        </button>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">当前分区</span>
        <span class="info-value">{{ activeTab }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">JSON 状态</span>
        <span class="info-value">{{ jsonError ? `错误: ${jsonError}` : '格式有效，可直接保存' }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">备份历史</span>
        <span class="info-value">{{ backups.length }} 份{{ backupDir ? ` · ${backupDir}` : '' }}</span>
      </div>
    </div>

    <div class="editor-layout" :class="{ 'with-backups': showBackups }">
      <!-- Main editor panel -->
      <div class="editor-panel section-card">
        <!-- Section tabs -->
        <div class="ui-tabbar">
          <button
            v-for="tab in TABS"
            :key="tab.value"
            @click="switchTab(tab.value)"
            type="button"
            :class="['ui-tab', { 'is-active': activeTab === tab.value }]"
          >
            <span class="tab-icon">{{ tab.icon }}</span>
            {{ tab.label }}
          </button>
        </div>

        <!-- Editor toolbar -->
        <div class="editor-toolbar">
          <div class="editor-status">
            <span :class="['json-status', jsonError ? 'status-error' : 'status-ok']">
              {{ jsonError ? '✗ ' + jsonError : '✓ 有效 JSON' }}
            </span>
          </div>
          <div class="toolbar-actions">
            <button class="btn btn-sm" @click="formatJson" :disabled="!!jsonError">格式化</button>
            <button class="btn btn-sm" @click="loadTab(activeTab)">重置</button>
            <button
              class="btn btn-primary btn-sm"
              @click="saveTab"
              :disabled="saving || !!jsonError"
            >
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <!-- Textarea editor -->
        <div class="editor-wrap">
          <textarea
            ref="editorEl"
            v-model="editorContent"
            @input="validateJson"
            @keydown.tab.prevent="insertTab"
            spellcheck="false"
            class="code-editor"
            :class="{ 'has-error': !!jsonError }"
          ></textarea>
          <div v-if="jsonError" class="error-bar">{{ jsonError }}</div>
        </div>

        <div class="editor-footer">
          <span class="hint">Tab 键插入 2 空格 · Ctrl+S 保存（需焦点在编辑器内）</span>
          <span v-if="lastSavedAt" class="hint">上次保存: {{ lastSavedAt }}</span>
        </div>
      </div>

      <!-- Backups panel -->
      <div v-if="showBackups" class="backups-panel section-card">
        <div class="backups-header">
          <h3>备份历史</h3>
          <span class="backups-dir">{{ backupDir }}</span>
        </div>

        <div v-if="loadingBackups" class="backups-empty">加载中…</div>
        <div v-else-if="backups.length === 0" class="backups-empty">暂无备份</div>

        <div v-else class="backups-list">
          <div
            v-for="b in backups"
            :key="b.filename"
            :class="['backup-item', { 'selected': previewBackup?.filename === b.filename }]"
            @click="selectBackup(b)"
          >
            <div class="backup-meta">
              <span class="backup-time">{{ formatBackupTime(b.filename) }}</span>
              <span class="backup-size">{{ (b.size / 1024).toFixed(1) }} KB</span>
            </div>
            <div class="backup-actions">
              <button
                class="btn btn-xs"
                @click.stop="previewBackupItem(b)"
              >预览</button>
              <button
                class="btn btn-xs btn-danger"
                @click.stop="restoreBackup(b)"
                :disabled="restoring === b.filename"
              >{{ restoring === b.filename ? '还原中…' : '还原' }}</button>
            </div>
          </div>
        </div>

        <!-- Backup preview -->
        <div v-if="previewBackup" class="backup-preview">
          <div class="backup-preview-header">
            <span>预览: {{ formatBackupTime(previewBackup.filename) }}</span>
            <button class="btn btn-xs" @click="loadBackupIntoEditor(previewBackup)">加载到编辑器</button>
            <button class="icon-btn" @click="previewBackup = null">✕</button>
          </div>
          <pre class="preview-code">{{ previewContent }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'
import { useConfirm } from '../composables/useConfirm.js'

const toast = useToastStore()
const confirm = useConfirm()

const TABS = [
  { value: 'all',      icon: '📄', label: '全部' },
  { value: 'gateway',  icon: '🔌', label: 'gateway' },
  { value: 'models',   icon: '🤖', label: 'models' },
  { value: 'agents',   icon: '🧠', label: 'agents' },
  { value: 'channels', icon: '📡', label: 'channels' },
  { value: 'commands', icon: '⌨️',  label: 'commands' },
]

const activeTab = ref('all')
const editorContent = ref('')
const jsonError = ref('')
const saving = ref(false)
const configPath = ref('')
const lastSavedAt = ref('')
const editorEl = ref<HTMLTextAreaElement | null>(null)

const showBackups = ref(false)
const backups = ref<any[]>([])
const backupDir = ref('')
const loadingBackups = ref(false)
const restoring = ref('')
const previewBackup = ref<any | null>(null)
const previewContent = ref('')

function validateJson() {
  try {
    JSON.parse(editorContent.value)
    jsonError.value = ''
  } catch (e: any) {
    // Extract short message
    jsonError.value = e.message.replace(/^JSON Parse error: /, '').slice(0, 120)
  }
}

function formatJson() {
  try {
    editorContent.value = JSON.stringify(JSON.parse(editorContent.value), null, 2)
    jsonError.value = ''
  } catch {}
}

function insertTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const start = el.selectionStart
  const end = el.selectionEnd
  editorContent.value = editorContent.value.slice(0, start) + '  ' + editorContent.value.slice(end)
  // Restore cursor
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + 2
  })
}

async function loadTab(tab: string) {
  try {
    if (tab === 'all') {
      const res = await api.configEditor.getRaw()
      editorContent.value = JSON.stringify(JSON.parse(res.raw), null, 2)
      configPath.value = res.configPath
    } else {
      const res = await api.configEditor.getSection(tab)
      editorContent.value = res.raw
    }
    jsonError.value = ''
  } catch (e: any) {
    toast.error(`加载失败: ${e.message}`)
  }
}

async function switchTab(tab: string) {
  activeTab.value = tab
  await loadTab(tab)
}

async function saveTab() {
  if (jsonError.value) return
  saving.value = true
  try {
    let res: { ok: boolean; backupPath: string }
    if (activeTab.value === 'all') {
      res = await api.configEditor.saveRaw(editorContent.value)
    } else {
      res = await api.configEditor.saveSection(activeTab.value, editorContent.value)
    }
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN')
    toast.success(`已保存，备份: ${res.backupPath.split('/').pop()}`)
    await loadBackupList()
  } catch (e: any) {
    toast.error(`保存失败: ${e.message}`)
  } finally {
    saving.value = false
  }
}

async function loadBackupList() {
  loadingBackups.value = true
  try {
    const res = await api.configEditor.listBackups()
    backups.value = res.backups
    backupDir.value = res.backupDir
  } catch {}
  finally { loadingBackups.value = false }
}

async function selectBackup(b: any) {
  previewBackup.value = b
  previewContent.value = JSON.stringify(b.preview, null, 2)
}

async function previewBackupItem(b: any) {
  previewBackup.value = b
  previewContent.value = JSON.stringify(b.preview, null, 2)
}

function loadBackupIntoEditor(b: any) {
  if (activeTab.value === 'all') {
    editorContent.value = JSON.stringify(b.preview, null, 2)
  } else {
    const section = b.preview?.[activeTab.value]
    if (section !== undefined) {
      editorContent.value = JSON.stringify(section, null, 2)
    } else {
      toast.error(`该备份中无 ${activeTab.value} 节点`)
      return
    }
  }
  validateJson()
  previewBackup.value = null
  toast.success(`已加载备份到编辑器，确认后点保存生效`)
}

async function restoreBackup(b: any) {
  if (!await confirm({ title: '还原配置备份', message: `确认还原到 ${formatBackupTime(b.filename)}？当前配置将自动备份。`, confirmText: '还原', danger: true })) return
  restoring.value = b.filename
  try {
    const res = await api.configEditor.restore(b.filename)
    toast.success(`已还原，当前配置已备份为 ${res.safeguard.split('/').pop()}`)
    await loadTab(activeTab.value)
    await loadBackupList()
    previewBackup.value = null
  } catch (e: any) {
    toast.error(`还原失败: ${e.message}`)
  } finally {
    restoring.value = ''
  }
}

function formatBackupTime(filename: string): string {
  // openclaw.2026-04-04T21-30-00-123Z.json
  try {
    const ts = filename
      .replace('openclaw.', '')
      .replace('.json', '')
    // Parse: 2026-04-04T21-30-00-123Z → 2026-04-04T21:30:00.123Z
    const iso = ts.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z/, 'T$1:$2:$3.$4Z')
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ts
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return filename
  }
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && document.activeElement === editorEl.value) {
    e.preventDefault()
    saveTab()
  }
}

onMounted(async () => {
  await loadTab('all')
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

// Load backups when panel opens
import { watch } from 'vue'
watch(showBackups, v => { if (v) loadBackupList() })
</script>

<style scoped>
.subtitle { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); }
.header-actions { display: flex; gap: 8px; }

.editor-layout {
  display: flex;
  gap: var(--space-4);
  height: calc(100vh - 140px);
  min-height: 400px;
}
.editor-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.backups-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

/* Section tabs */
.section-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
}
.section-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: var(--text-xs);
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background .12s, color .12s;
}
.section-tab:hover  { background: var(--surface-3); color: var(--text-primary); }
.section-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.tab-icon { font-size: 13px; }

/* Toolbar */
.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.toolbar-actions { display: flex; gap: 6px; }
.json-status { font-size: var(--text-xs); font-weight: 500; font-family: var(--font-mono); }
.status-ok    { color: #A6E3A1; }
.status-error { color: #F38BA8; }

/* Editor */
.editor-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.code-editor {
  flex: 1;
  width: 100%;
  resize: none;
  background: #1C1917;
  color: #E7E5E4;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  padding: 14px 16px;
  border: 1px solid #292524;
  border-radius: var(--radius);
  outline: none;
  box-sizing: border-box;
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  transition: border-color .15s;
}
.code-editor:focus { border-color: var(--accent); }
.code-editor.has-error { border-color: #F38BA8; }
.error-bar {
  background: #3D0000;
  color: #F38BA8;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 5px 12px;
  border-radius: 0 0 var(--radius) var(--radius);
  border: 1px solid #7C0000;
  border-top: none;
  word-break: break-all;
}
.editor-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
}
.hint { font-size: 11px; color: var(--text-muted); }

/* Backups */
.backups-header { margin-bottom: 12px; }
.backups-header h3 { font-size: 13px; font-weight: 600; margin: 0 0 2px; color: var(--text-primary); }
.backups-dir { font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); word-break: break-all; }
.backups-empty { font-size: 12px; color: var(--text-muted); text-align: center; padding: 20px 0; }

.backups-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.backup-item {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background .1s, border-color .1s;
}
.backup-item:hover { background: var(--surface-2); }
.backup-item.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.backup-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
}
.backup-time { font-size: 12px; font-weight: 500; color: var(--text-primary); font-family: var(--font-mono); }
.backup-size { font-size: 11px; color: var(--text-muted); }
.backup-actions { display: flex; gap: 4px; }

.backup-preview {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  flex-shrink: 0;
  max-height: 220px;
  display: flex;
  flex-direction: column;
}
.backup-preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.backup-preview-header span { flex: 1; }
.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}
.icon-btn:hover { color: var(--text-primary); }
.preview-code {
  flex: 1;
  overflow-y: auto;
  background: #1C1917;
  color: #A6E3A1;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px solid #292524;
  white-space: pre;
  margin: 0;
}

.btn-xs {
  padding: 2px 8px;
  font-size: 11px;
}
</style>
