<template>
  <Teleport to="body">
    <div v-if="show" class="ui-modal-overlay" @click.self="close">
      <div class="ui-modal skill-files-modal" role="dialog" aria-modal="true">
        <div class="ui-modal-header">
          <div class="ui-modal-copy">
            <div class="ui-modal-title">技能文件 · {{ skill?.name }}</div>
            <div class="ui-modal-subtitle">{{ currentPath || '—' }}</div>
          </div>
          <button class="ui-modal-close" @click="close">✕</button>
        </div>

        <div class="sfm-body">
          <!-- 左:文件列表 -->
          <div class="sfm-files">
            <div class="sfm-crumbs">
              <template v-for="(c, i) in crumbs" :key="c.path">
                <span v-if="i > 0" class="sfm-crumb-sep">/</span>
                <button
                  :class="['sfm-crumb', { active: c.path === currentPath }]"
                  @click="loadDir(c.path)"
                >{{ c.name }}</button>
              </template>
            </div>
            <div v-if="loading" class="sfm-hint">加载中…</div>
            <ul v-else class="sfm-list">
              <li
                v-for="it in sortedItems"
                :key="it.path"
                :class="['sfm-item', { active: selectedFile?.path === it.path }]"
                @click="openItem(it)"
              >
                <span class="sfm-icon">{{ it.type === 'dir' ? '📁' : '📄' }}</span>
                <span class="sfm-name">{{ it.name }}</span>
              </li>
              <li v-if="!sortedItems.length" class="sfm-hint">空目录</li>
            </ul>
          </div>

          <!-- 右:内容预览 / 编辑 -->
          <div class="sfm-content">
            <div v-if="fileLoading" class="sfm-hint">加载文件内容…</div>
            <div v-else-if="!selectedFile" class="sfm-empty">← 选择左侧文件查看内容</div>
            <template v-else>
              <div class="sfm-actions">
                <span class="sfm-actions-name">{{ selectedFile.name }}</span>
                <span v-if="dirty" class="sfm-actions-dirty">未保存</span>
                <span v-if="saveError" class="sfm-actions-error">{{ saveError }}</span>
                <div class="sfm-actions-spacer" />
                <button
                  v-if="!editing"
                  class="btn btn-sm"
                  :disabled="!isEditable"
                  :title="isEditable ? '编辑当前文件' : '该文件类型不支持在线编辑'"
                  @click="startEdit"
                >编辑</button>
                <template v-else>
                  <button class="btn btn-sm" :disabled="saving" @click="cancelEdit">取消</button>
                  <button class="btn btn-sm btn-primary" :disabled="saving || !dirty" @click="saveEdit">
                    {{ saving ? '保存中…' : '保存' }}
                  </button>
                </template>
              </div>

              <textarea
                v-if="editing"
                v-model="draft"
                class="sfm-edit"
                spellcheck="false"
                @keydown.meta.s.prevent="saveEdit"
                @keydown.ctrl.s.prevent="saveEdit"
              />
              <div v-else-if="isMarkdown" class="sfm-md" v-html="renderedMd"></div>
              <pre v-else class="sfm-pre">{{ selectedFile.content }}</pre>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{ show: boolean; skill: any }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const API_BASE = (import.meta.env.BASE_URL.replace(/\/$/, '') + '/api').replace(/\/{2,}/g, '/')

interface FileItem { name: string; type: 'file' | 'dir'; path: string }

const rootPath = ref('')
const currentPath = ref('')
const items = ref<FileItem[]>([])
const loading = ref(false)
const selectedFile = ref<{ name: string; content: string; path: string } | null>(null)
const fileLoading = ref(false)

// Edit state. We keep the original content on `selectedFile` and the working
// draft on `draft`, so cancel restores cleanly without re-fetching, and the
// dirty indicator only lights up when the user actually changed something.
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const saveError = ref('')

// Whitelist of in-place-editable text file extensions. Binary files (images,
// archives) intentionally cannot be edited through the browser textarea —
// they'd be corrupted by the round trip through a string.
const EDITABLE_EXT = /\.(md|markdown|txt|json|ya?ml|toml|sh|py|js|mjs|cjs|ts|tsx|css|html|conf|ini|env)$/i

const isEditable = computed(() => !!selectedFile.value && EDITABLE_EXT.test(selectedFile.value.name))
const dirty = computed(() => editing.value && selectedFile.value !== null && draft.value !== selectedFile.value.content)

function startEdit() {
  if (!selectedFile.value || !isEditable.value) return
  draft.value = selectedFile.value.content
  saveError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
  saveError.value = ''
}

async function saveEdit() {
  if (!selectedFile.value || saving.value || !dirty.value) return
  saving.value = true
  saveError.value = ''
  try {
    const r = await fetch(`${API_BASE}/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: selectedFile.value.path, content: draft.value }),
    })
    const d = await r.json().catch(() => ({} as any))
    if (!r.ok) {
      saveError.value = d?.error || `HTTP ${r.status}`
      return
    }
    selectedFile.value = { ...selectedFile.value, content: draft.value }
    editing.value = false
    draft.value = ''
  } catch (e: any) {
    saveError.value = e?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.show, (v) => {
  if (v && props.skill) {
    rootPath.value = props.skill.relPath || props.skill.path || ''
    selectedFile.value = null
    items.value = []
    // Reset edit state on (re)open so a stale draft from a previous skill
    // can't leak into the new session.
    editing.value = false
    draft.value = ''
    saveError.value = ''
    void loadDir(rootPath.value)
  }
})

async function loadDir(path: string) {
  loading.value = true
  try {
    const r = await fetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`)
    const d = await r.json()
    if (r.ok) {
      currentPath.value = d.path
      items.value = Array.isArray(d.items) ? d.items : []
    }
  } catch { /* silent */ }
  finally { loading.value = false }
}

async function openItem(item: FileItem) {
  if (item.type === 'dir') { void loadDir(item.path); return }
  // Switching files mid-edit silently discards the draft. Warn first so a
  // long edit is not lost by an accidental click on the sidebar.
  if (editing.value && dirty.value) {
    if (!window.confirm('当前文件有未保存的修改,切换文件将丢弃。继续?')) return
  }
  editing.value = false
  draft.value = ''
  saveError.value = ''
  fileLoading.value = true
  try {
    const r = await fetch(`${API_BASE}/files/get?path=${encodeURIComponent(item.path)}`)
    const d = await r.json()
    if (r.ok) selectedFile.value = { name: item.name, content: d.content ?? '', path: item.path }
  } catch { /* silent */ }
  finally { fileLoading.value = false }
}

const sortedItems = computed(() => {
  const dirs = items.value.filter(i => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const files = items.value.filter(i => i.type === 'file').sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
})

// 面包屑限制在 skill 根目录内,无法越级到目录外
const crumbs = computed(() => {
  const root = rootPath.value
  if (!root || !currentPath.value.startsWith(root)) {
    return [{ name: props.skill?.name ?? 'skill', path: root }]
  }
  const rel = currentPath.value.slice(root.length).split('/').filter(Boolean)
  let acc = root
  return [
    { name: props.skill?.name ?? 'skill', path: root },
    ...rel.map(seg => { acc += '/' + seg; return { name: seg, path: acc } }),
  ]
})

const isMarkdown = computed(() => /\.(md|markdown)$/i.test(selectedFile.value?.name ?? ''))

const renderedMd = computed(() => {
  if (!isMarkdown.value || !selectedFile.value) return ''
  // 剥离 YAML frontmatter,只渲染正文
  const body = selectedFile.value.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  return DOMPurify.sanitize(marked.parse(body) as string)
})

function close() {
  if (editing.value && dirty.value) {
    if (!window.confirm('有未保存的修改,关闭后将丢失。确认?')) return
  }
  emit('update:show', false)
}
</script>

<style scoped>
.skill-files-modal {
  width: min(900px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
}

.sfm-body {
  display: flex;
  gap: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 左栏:文件列表 */
.sfm-files {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sfm-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-xs);
}

.sfm-crumb {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}
.sfm-crumb:hover { color: var(--accent-text); background: var(--surface-2); }
.sfm-crumb.active { color: var(--text-primary); font-weight: 700; }
.sfm-crumb-sep { color: var(--text-muted); }

.sfm-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
}

/* Edit action bar over the preview/edit pane */
.sfm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2, var(--surface));
  font-size: var(--text-xs);
}
.sfm-actions-name {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-primary);
}
.sfm-actions-dirty {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #b45309;
}
.sfm-actions-error {
  color: var(--error-text);
  font-size: 11px;
}
.sfm-actions-spacer { flex: 1; }

.sfm-edit {
  flex: 1;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  border: none;
  outline: none;
  resize: none;
  background: var(--bg);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  tab-size: 2;
}

.sfm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.sfm-item:hover { background: var(--surface-2); }
.sfm-item.active { background: var(--accent-subtle, rgba(99,102,241,0.1)); color: var(--accent-text); }
.sfm-icon { flex-shrink: 0; }
.sfm-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 右栏:内容 */
.sfm-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px 22px;
}

.sfm-hint,
.sfm-empty {
  color: var(--text-muted);
  font-size: var(--text-sm);
  padding: 16px;
}
.sfm-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.sfm-pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* markdown 预览(v-html 内容需用 :deep) */
.sfm-md { font-size: var(--text-sm); line-height: 1.7; color: var(--text-primary); }
.sfm-md :deep(h1) { font-size: 20px; font-weight: 700; margin: 16px 0 10px; }
.sfm-md :deep(h2) { font-size: 17px; font-weight: 700; margin: 14px 0 8px; }
.sfm-md :deep(h3) { font-size: 15px; font-weight: 600; margin: 12px 0 6px; }
.sfm-md :deep(p) { margin: 8px 0; }
.sfm-md :deep(ul),
.sfm-md :deep(ol) { margin: 8px 0; padding-left: 22px; }
.sfm-md :deep(li) { margin: 3px 0; }
.sfm-md :deep(a) { color: var(--accent-text); text-decoration: underline; }
.sfm-md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
}
.sfm-md :deep(pre) {
  background: #1c1917;
  color: #e7e5e4;
  padding: 12px 14px;
  border-radius: var(--radius);
  overflow-x: auto;
  margin: 10px 0;
}
.sfm-md :deep(pre code) { background: none; padding: 0; color: inherit; }
.sfm-md :deep(blockquote) {
  border-left: 3px solid var(--border);
  margin: 10px 0;
  padding: 2px 12px;
  color: var(--text-secondary);
}
.sfm-md :deep(table) { border-collapse: collapse; margin: 10px 0; }
.sfm-md :deep(th),
.sfm-md :deep(td) { border: 1px solid var(--border); padding: 5px 10px; font-size: var(--text-xs); }
.sfm-md :deep(img) { max-width: 100%; }

@media (max-width: 640px) {
  .sfm-body { flex-direction: column; height: 70vh; }
  .sfm-files { width: 100%; height: 38%; border-right: none; border-bottom: 1px solid var(--border); }
}
</style>
