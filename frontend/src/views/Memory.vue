<template>
  <div class="page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">记忆文件</h1>
        <p class="subtitle">管理 Agent 工作区内的 Markdown 记忆文件。</p>
      </div>
      <div class="header-right">
        <label class="agent-label">Agent</label>
        <select class="form-select form-select-compact agent-select" v-model="selectedAgent" @change="onAgentChange">
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.id }}</option>
        </select>
      </div>
    </div>

    <!-- Category tabs -->
    <div class="ui-tabbar">
      <button
        v-for="c in CATEGORIES"
        :key="c.key"
        :class="['ui-tab', { 'is-active': selectedCategory === c.key }]"
        @click="onCategoryChange(c.key)"
      >{{ c.label }}</button>
    </div>
    <p class="category-desc">{{ currentCategory.desc }}</p>

    <div class="layout">
      <!-- Sidebar -->
      <div class="sidebar">
        <div class="sidebar-actions">
          <button class="btn btn-sm btn-primary" style="flex:1" @click="showNewDialog = true">+ 新建文件</button>
          <button class="btn btn-sm btn-danger-soft" style="flex:1" :disabled="!selectedPath" @click="deleteFile">删除</button>
        </div>

        <div v-if="loadingFiles" class="sidebar-list">
          <div v-for="i in 4" :key="i" class="skel-item" />
        </div>
        <div v-else-if="files.length === 0" class="sidebar-empty">暂无文件</div>
        <div v-else class="sidebar-list">
          <button
            v-for="file in files"
            :key="file.path"
            :class="['file-item', { active: selectedPath === file.path }]"
            @click="selectFile(file)"
          >{{ file.name }}</button>
        </div>
      </div>

      <!-- Editor -->
      <div class="editor-panel">
        <div v-if="!selectedPath" class="editor-empty">
          <div class="empty-hint">从左侧选择文件进行查看或编辑</div>
        </div>
        <template v-else>
          <div class="editor-toolbar">
            <span class="editor-path">{{ selectedPath }}</span>
            <div class="toolbar-btns">
              <button class="btn btn-sm" :disabled="!selectedPath || loadingContent" @click="downloadFile">下载</button>
              <button class="btn btn-sm" :disabled="loadingContent" @click="togglePreview">{{ preview ? '编辑' : '预览' }}</button>
              <button class="btn btn-sm btn-primary" :disabled="saving || content === originalContent" @click="saveFile">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
          <div v-if="loadingContent" class="editor-loading"><div class="skel-block" /></div>
          <div v-else-if="preview" class="md-preview" v-html="renderedMd" />
          <textarea
            v-else
            v-model="content"
            class="editor-textarea"
            placeholder="在此输入内容，保存后写入文件…"
            spellcheck="false"
          />
          <div v-if="content !== originalContent && !preview" class="unsaved-badge">未保存</div>
        </template>
      </div>
    </div>

    <!-- New file dialog -->
    <Teleport to="body">
      <div v-if="showNewDialog" class="ui-modal-overlay" @click.self="showNewDialog = false">
        <div class="ui-modal ui-modal-sm">
          <div class="ui-modal-header">
            <div class="ui-modal-copy">
              <h3 class="ui-modal-title">新建文件</h3>
              <p class="ui-modal-subtitle">将在「{{ selectedAgent }} / {{ currentCategory.label }}」中创建</p>
            </div>
            <button class="ui-modal-close" @click="showNewDialog = false">✕</button>
          </div>
          <div class="ui-modal-body">
            <div class="form-group">
              <label class="form-label">文件名</label>
              <input v-model="newFileName" class="form-input" placeholder="NOTES.md" autofocus @keydown.enter="createFile" />
              <div class="form-hint">仅支持 .md 文件</div>
            </div>
          </div>
          <div class="ui-modal-footer">
            <button class="btn btn-sm" @click="showNewDialog = false">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="!newFileName" @click="createFile">创建</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client.js'
import { useToastStore } from '../stores/toast.js'

const CATEGORIES = [
  { key: 'core',    label: '核心文件', desc: 'Agent 核心配置文件，如 SOUL.md、IDENTITY.md、AGENTS.md 等' },
  { key: 'memory',  label: '工作记忆', desc: '当前活跃的工作上下文、决策记录和进度追踪（workspace/memory/）' },
  { key: 'archive', label: '记忆归档', desc: '已归档的历史记忆文件，按时间周期整理（workspace-memory/）' },
]

interface Agent { id: string; workspace: string }
interface MemFile { path: string; name: string; category: string; sizeBytes: number; modifiedAt: string }

const toast = useToastStore()
const agents = ref<Agent[]>([])
const selectedAgent = ref('main')
const selectedCategory = ref('core')
const files = ref<MemFile[]>([])
const loadingFiles = ref(false)
const selectedPath = ref<string | null>(null)
const content = ref('')
const originalContent = ref('')
const loadingContent = ref(false)
const saving = ref(false)
const preview = ref(false)
const showNewDialog = ref(false)
const newFileName = ref('')

const currentCategory = computed(() => CATEGORIES.find(c => c.key === selectedCategory.value)!)
const renderedMd = computed(() => renderMarkdown(content.value))

onMounted(async () => {
  try {
    agents.value = await api.memory.listAgents()
    if (agents.value.length) selectedAgent.value = agents.value[0].id
  } catch {}
  await loadFiles()
})

async function loadFiles() {
  loadingFiles.value = true
  resetEditor()
  try {
    files.value = await api.memory.listFiles(selectedAgent.value, selectedCategory.value)
  } catch (err: any) {
    toast.error(`加载失败: ${err.message}`)
    files.value = []
  } finally {
    loadingFiles.value = false
  }
}

function onAgentChange() { loadFiles() }
function onCategoryChange(cat: string) {
  if (content.value !== originalContent.value && !confirm('有未保存修改，确认切换？')) return
  selectedCategory.value = cat
  loadFiles()
}

function resetEditor() {
  selectedPath.value = null
  content.value = ''
  originalContent.value = ''
  preview.value = false
}

async function selectFile(file: MemFile) {
  if (content.value !== originalContent.value && !confirm('有未保存修改，确认放弃？')) return
  selectedPath.value = file.path
  preview.value = false
  loadingContent.value = true
  try {
    const result = await api.memory.readFile(file.path)
    content.value = result.content
    originalContent.value = result.content
  } catch (err: any) {
    content.value = ''
    originalContent.value = ''
    if (!err.message?.includes('404')) toast.error(`读取失败: ${err.message}`)
  } finally {
    loadingContent.value = false
  }
}

async function saveFile() {
  if (!selectedPath.value) return
  saving.value = true
  try {
    await api.memory.saveFile(selectedPath.value, content.value)
    originalContent.value = content.value
    toast.success('已保存')
    await loadFiles()
    // Re-select current file after refresh
    if (selectedPath.value) {
      const f = files.value.find(f => f.path === selectedPath.value)
      if (f) selectedPath.value = f.path
    }
  } catch (err: any) {
    toast.error(`保存失败: ${err.message}`)
  } finally {
    saving.value = false
  }
}

async function deleteFile() {
  if (!selectedPath.value) return
  const name = selectedPath.value.split('/').pop()
  if (!confirm(`确认删除「${name}」？`)) return
  try {
    await api.memory.deleteFile(selectedPath.value)
    toast.success(`已删除 ${name}`)
    resetEditor()
    await loadFiles()
  } catch (err: any) {
    toast.error(`删除失败: ${err.message}`)
  }
}

async function createFile() {
  let name = newFileName.value.trim()
  if (!name) return
  if (!name.endsWith('.md')) name += '.md'

  // Build path relative to openclawHome based on category
  const agent = agents.value.find(a => a.id === selectedAgent.value)
  if (!agent) return

  // Find the workspace path relative to openclawHome
  // workspace is an absolute path; we need relative to openclawHome
  // Convention: workspace paths end with workspace name (e.g. ~/.openclaw/workspace → "workspace")
  const wsName = agent.workspace.split('/').pop()!
  let relDir: string
  if (selectedCategory.value === 'core') relDir = wsName
  else if (selectedCategory.value === 'memory') relDir = `${wsName}/memory`
  else relDir = 'workspace-memory' // archive is always workspace-memory

  const path = `${relDir}/${name}`

  try {
    await api.memory.saveFile(path, `# ${name.replace('.md', '')}\n\n`)
    toast.success(`已创建 ${name}`)
    showNewDialog.value = false
    newFileName.value = ''
    await loadFiles()
    const file = files.value.find(f => f.path === path)
    if (file) selectFile(file)
  } catch (err: any) {
    toast.error(`创建失败: ${err.message}`)
  }
}

function downloadFile() {
  if (!selectedPath.value) return
  const name = selectedPath.value.split('/').pop() ?? 'file.md'
  const blob = new Blob([content.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function togglePreview() { preview.value = !preview.value }

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>')
}
</script>

<style scoped>
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: var(--space-4); }
.header-right { display: flex; align-items: center; gap: var(--space-2); }
.agent-label { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
.agent-select { width: auto; min-width: 160px; }

/* Tabs */
.tab-bar { display: flex; gap: 4px; margin-bottom: var(--space-2); }
.tab-btn {
  padding: 6px 16px; border: 1px solid var(--border); border-radius: var(--radius-full);
  background: transparent; cursor: pointer; font-size: var(--text-sm);
  color: var(--text-secondary); transition: all .12s;
}
.tab-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }
.tab-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }

.category-desc { font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-4); }

.layout { display: flex; gap: var(--space-4); height: calc(100vh - 210px); }

/* Sidebar */
.sidebar {
  width: 200px; flex-shrink: 0;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: var(--space-3);
  display: flex; flex-direction: column; gap: var(--space-2); overflow: hidden;
}
.sidebar-actions { display: flex; gap: 6px; }
.btn-danger-soft { background: transparent; border-color: var(--border); color: var(--text-secondary); }
.btn-danger-soft:not(:disabled):hover { background: var(--error-bg); color: var(--error-text); border-color: rgba(239,68,68,.3); }
.btn-danger-soft:disabled { opacity: .4; cursor: not-allowed; }

.sidebar-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.sidebar-empty { flex: 1; display: flex; align-items: center; justify-content: center; font-size: var(--text-xs); color: var(--text-muted); }

.file-item {
  display: block; width: 100%; text-align: left; padding: 7px 10px;
  border: none; border-radius: var(--radius); background: transparent; cursor: pointer;
  font-size: var(--text-sm); color: var(--text-primary);
  font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  transition: background .1s;
}
.file-item:hover { background: var(--surface-2); }
.file-item.active { background: var(--accent); color: #fff; }

.skel-item { height: 30px; background: var(--border); border-radius: var(--radius); animation: pulse 1.4s infinite; margin-bottom: 2px; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }

/* Editor */
.editor-panel {
  flex: 1; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-xl); overflow: hidden; position: relative; min-width: 0;
}
.editor-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-hint { font-size: var(--text-sm); color: var(--text-muted); }

.editor-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  background: var(--surface-2); flex-shrink: 0;
}
.editor-path { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbar-btns { display: flex; gap: var(--space-2); flex-shrink: 0; }

.skel-block { height: 300px; background: var(--border); border-radius: var(--radius); animation: pulse 1.4s infinite; margin: var(--space-4); }

.editor-textarea {
  flex: 1; resize: none; border: none; outline: none;
  padding: var(--space-4); font-family: var(--font-mono); font-size: 13px; line-height: 1.6;
  background: var(--surface); color: var(--text-primary); min-height: 0;
}

.md-preview { flex: 1; overflow-y: auto; padding: var(--space-5); line-height: 1.8; color: var(--text-primary); font-size: var(--text-sm); }
.md-preview :deep(h1) { font-size: 1.5em; font-weight: 700; margin: 1em 0 .5em; }
.md-preview :deep(h2) { font-size: 1.25em; font-weight: 600; margin: 1em 0 .5em; }
.md-preview :deep(h3) { font-size: 1.1em; font-weight: 600; margin: .8em 0 .4em; }
.md-preview :deep(code) { background: var(--surface-2); padding: 2px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: .9em; }
.md-preview :deep(li) { margin-left: 20px; }

.unsaved-badge {
  position: absolute; bottom: 12px; right: 12px;
  background: var(--accent); color: white; font-size: 10px; font-weight: 600;
  padding: 2px 8px; border-radius: 10px; pointer-events: none;
}
</style>
