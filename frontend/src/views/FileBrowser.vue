<template>
  <div class="page-shell page-shell-wide">
    <div class="page-header">
      <div>
        <h1 class="page-title">文件管理</h1>
        <p class="page-desc">浏览和管理服务器文件系统</p>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="showMkdir = true">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          新建文件夹
        </button>
        <label class="action-btn action-btn-primary">
          <input type="file" multiple hidden @change="onFileInputChange" />
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 8.5V1.5M4 4 6.5 1.5 9 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 9.5v1A1.5 1.5 0 003 12h7a1.5 1.5 0 001.5-1.5v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          上传文件
        </label>
      </div>
    </div>

    <!-- Path bar -->
    <div class="path-bar">
      <div class="path-bar-inner">
        <template v-for="(seg, i) in pathSegments" :key="i">
          <svg v-if="i > 0" class="path-chevron" width="8" height="12" viewBox="0 0 8 12" fill="none">
            <path d="M2 2l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <button
            :class="['path-seg', { 'path-seg-active': i === pathSegments.length - 1 }]"
            @click="navigate(seg.path)"
          >{{ seg.name }}</button>
        </template>
        <span v-if="pathSegments.length === 0" class="path-seg path-seg-active">~</span>
      </div>
      <div class="path-meta" v-if="!loading">
        <span class="path-pill" v-if="dirCount > 0">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 3.5h8M1 3.5V8a.5.5 0 00.5.5h7A.5.5 0 009 8V3.5M1 3.5l.9-2h3.6l.6 1H9l-.9 1" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>
          {{ dirCount }} 个文件夹
        </span>
        <span class="path-pill" v-if="fileCount > 0">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 1h4l2.5 2.5V9a.5.5 0 01-.5.5h-6A.5.5 0 012 9V1.5A.5.5 0 012.5 1z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M6.5 1v2.5H9" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
          {{ fileCount }} 个文件
        </span>
      </div>
    </div>

    <!-- Search -->
    <div class="search-bar">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <input
        v-model="searchQuery"
        class="search-input"
        placeholder="搜索文件名…"
        @keyup.escape="searchQuery = ''"
      />
      <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    </div>

    <!-- File list -->
    <section class="file-section">
      <div v-if="loading" class="file-empty">
        <div class="spinner"></div>
        <span class="file-empty-title" style="font-weight:500;font-size:var(--text-sm)">加载中…</span>
      </div>

      <div v-else-if="items.length === 0" class="file-empty">
        <div class="file-empty-icon">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M6 14h28M6 14V32a2 2 0 002 2h24a2 2 0 002-2V14M6 14l2-6h10l2 3h12l2 3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="file-empty-title">目录为空</div>
        <div class="file-empty-desc">此目录下暂无文件或文件夹</div>
      </div>

      <div v-else-if="sortedItems.length === 0" class="file-empty">
        <div class="file-empty-icon">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="18" cy="18" r="11" stroke="currentColor" stroke-width="1.6"/>
            <path d="M27 27L37 37" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="file-empty-title">无匹配文件</div>
        <div class="file-empty-desc">没有文件名包含「{{ searchQuery }}」</div>
      </div>

      <div v-else>
        <!-- Column headers -->
        <div class="file-header-row">
          <div></div>
          <div>名称</div>
          <div>大小</div>
          <div>修改时间</div>
          <div></div>
        </div>

        <div class="file-list">
          <div
            v-for="item in sortedItems"
            :key="item.path"
            class="file-row"
            @dblclick="item.type === 'dir' ? navigate(item.path) : openFile(item)"
          >
            <!-- Icon -->
            <div class="file-icon-cell">
              <div :class="['file-icon', `file-icon-${fileIconTheme(item)}`]">
                <!-- Folder -->
                <svg v-if="item.type === 'dir'" width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 6h14M2 6v8a1 1 0 001 1h10a1 1 0 001-1V6M2 6l1-3h5l1 2h5l1 1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                </svg>
                <!-- Code file -->
                <svg v-else-if="isCodeFile(item.name)" width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 2.5h9.5L15 5v10.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-13A.5.5 0 013 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path d="M12.5 2.5V5H15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <path d="M6.5 8l-2 2 2 2M11.5 8l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <!-- Config file -->
                <svg v-else-if="isConfigFile(item.name)" width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 2.5h9.5L15 5v10.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-13A.5.5 0 013 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path d="M12.5 2.5V5H15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <circle cx="9" cy="10" r="1.5" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M9 7v1M9 12v1M6.2 8.5l.86.5M11.94 10.5l.86.5M6.2 11.5l.86-.5M11.94 9.5l.86-.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
                <!-- Text / generic file -->
                <svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 2.5h9.5L15 5v10.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-13A.5.5 0 013 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                  <path d="M12.5 2.5V5H15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <path d="M5.5 8h7M5.5 10.5h7M5.5 13h4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </div>
            </div>

            <!-- Name + badge -->
            <div class="file-info" @click="item.type === 'dir' ? navigate(item.path) : openFile(item)">
              <span :class="['file-name', { 'file-name-dir': item.type === 'dir' }]">{{ item.name }}</span>
              <span v-if="item.type === 'file' && fileExt(item.name)" :class="['file-ext-badge', `ext-${fileIconTheme(item)}`]">{{ fileExt(item.name).toUpperCase() }}</span>
            </div>

            <!-- Size -->
            <div class="file-size">
              <span v-if="item.type === 'file'">{{ item.sizeHuman }}</span>
              <span v-else class="file-size-dir">—</span>
            </div>

            <!-- Mtime -->
            <div class="file-mtime">{{ item.mtime ? formatDate(item.mtime) : '—' }}</div>

            <!-- Actions -->
            <div class="file-actions" @click.stop>
              <button v-if="item.type === 'file'" class="fa-btn" title="查看 / 编辑" @click="openFile(item)">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 6s2-4 5-4 5 4 5 4-2 4-5 4-5-4-5-4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>
              </button>
              <button v-if="item.type === 'file'" class="fa-btn" title="下载到本地" @click="downloadFile(item)">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v6M3.5 5.5L6 8l2.5-2.5M2 10.5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="fa-btn" title="重命名" @click="startRename(item)">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10h2.5L10 4.5 7.5 2 2 7.5V10zM7.5 2l2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button class="fa-btn fa-btn-danger" title="删除" @click="deleteItem(item)">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3.5h8M4.5 3.5V2.5h3v1M5 5.5v3.5M7 5.5v3.5M2.5 3.5l.5 7h6l.5-7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Preview / Edit modal ─────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="previewModal.show" class="ui-modal-overlay" @click.self="previewModal.show = false">
        <div class="ui-modal ui-modal-lg" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-title-row">
              <span v-if="fileExt(previewModal.name)" :class="['ui-modal-kicker', `ext-${fileExtTheme(previewModal.name)}`]">
                {{ fileExt(previewModal.name).toUpperCase() }}
              </span>
              <span class="ui-modal-title">{{ previewModal.name }}</span>
            </div>
            <button class="ui-modal-close" @click="previewModal.show = false">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="ui-modal-body">
            <div v-if="previewModal.loading" class="preview-loading">
              <div class="spinner"></div>加载文件内容…
            </div>
            <div v-else class="preview-editor-wrap">
              <div class="preview-editor-toolbar">
                <span class="preview-toolbar-dot" style="background:#ff5f57"></span>
                <span class="preview-toolbar-dot" style="background:#febc2e"></span>
                <span class="preview-toolbar-dot" style="background:#28c840"></span>
                <span class="preview-toolbar-label">{{ previewModal.name }}</span>
              </div>
              <textarea
                v-model="previewModal.content"
                class="preview-editor"
                spellcheck="false"
              />
            </div>
          </div>
          <div class="ui-modal-footer">
            <button class="modal-btn" @click="previewModal.show = false">取消</button>
            <button class="modal-btn" @click="downloadFile(previewModal)">下载到本地</button>
            <button class="modal-btn modal-btn-primary" @click="savePreview" :disabled="previewModal.saving">
              {{ previewModal.saving ? '保存中…' : '保存文件' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── Rename modal ─────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="renameModal.show" class="ui-modal-overlay" @click.self="renameModal.show = false">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-title-row">
              <span class="ui-modal-title">重命名</span>
            </div>
            <button class="ui-modal-close" @click="renameModal.show = false">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="ui-modal-body">
            <div class="form-field">
              <label class="form-label">新名称</label>
              <input v-model="renameModal.newName" class="form-input" placeholder="输入新名称…" @keyup.enter="doRename" autofocus />
            </div>
            <div class="form-hint-row" v-if="renameModal.item">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" stroke-width="1"/><path d="M5.5 5v3M5.5 3.5v.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              当前名称：{{ renameModal.item.name }}
            </div>
          </div>
          <div class="ui-modal-footer">
            <button class="modal-btn" @click="renameModal.show = false">取消</button>
            <button class="modal-btn modal-btn-primary" @click="doRename" :disabled="renameModal.loading">
              {{ renameModal.loading ? '重命名中…' : '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── New folder modal ─────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showMkdir" class="ui-modal-overlay" @click.self="showMkdir = false">
        <div class="ui-modal ui-modal-sm" role="dialog" aria-modal="true">
          <div class="ui-modal-header">
            <div class="ui-modal-title-row">
              <span class="ui-modal-title">新建文件夹</span>
            </div>
            <button class="ui-modal-close" @click="showMkdir = false">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="ui-modal-body">
            <div class="form-field">
              <label class="form-label">文件夹名称</label>
              <input v-model="mkdirName" class="form-input" placeholder="输入文件夹名称…" @keyup.enter="doMkdir" autofocus />
            </div>
          </div>
          <div class="ui-modal-footer">
            <button class="modal-btn" @click="showMkdir = false">取消</button>
            <button class="modal-btn modal-btn-primary" @click="doMkdir">创建</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useConfirm } from '../composables/useConfirm.js'

const route = useRoute()
const confirm = useConfirm()

const API_BASE = (import.meta.env.BASE_URL.replace(/\/$/, '') + '/api').replace(/\/{2,}/g, '/')

function apiFetch(path: string, init?: RequestInit) {
  const clean = path.replace(/^\/api/, '')
  return fetch(API_BASE + clean, init)
}

interface FileItem {
  name: string
  type: 'file' | 'dir'
  size: number
  sizeHuman: string
  mtime: string
  path: string
}

// ── State ──────────────────────────────────────────────────────────────────────

const currentPath = ref('/')
const items = ref<FileItem[]>([])
const loading = ref(false)

// ── Computed ────────────────────────────────────────────────────────────────

const pathSegments = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  return parts.map((p, i) => ({
    name: p,
    path: '/' + parts.slice(0, i + 1).join('/'),
  }))
})

const searchQuery = ref('')

const sortedItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const all = items.value.filter(i => !q || i.name.toLowerCase().includes(q))
  const dirs = all.filter(i => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  const files = all.filter(i => i.type === 'file').sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
})

const dirCount = computed(() => items.value.filter(i => i.type === 'dir').length)
const fileCount = computed(() => items.value.filter(i => i.type === 'file').length)

// ── Load ────────────────────────────────────────────────────────────────────

async function load(path: string) {
  loading.value = true
  try {
    const res = await apiFetch(`/api/files/list?path=${encodeURIComponent(path)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    currentPath.value = data.path
    items.value = data.items
  } catch (_e) { /* silent */ }
  finally { loading.value = false }
}

function navigate(path: string) { searchQuery.value = ''; load(path) }
onMounted(() => {
  const qp = route.query.path
  load(typeof qp === 'string' && qp ? qp : '/.openclaw')
})

// ── File type helpers ────────────────────────────────────────────────────────

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'sh', 'bash', 'zsh'])
const CONFIG_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'xml'])

// Theme maps to CSS class suffix
const EXT_THEME: Record<string, string> = {
  ts: 'blue', tsx: 'blue', js: 'yellow', jsx: 'yellow',
  py: 'green', go: 'cyan', rs: 'orange', swift: 'orange',
  json: 'amber', yaml: 'amber', yml: 'amber', toml: 'amber',
  md: 'purple', sh: 'slate', bash: 'slate', zsh: 'slate',
  css: 'pink', html: 'orange', env: 'red', log: 'slate',
}

function fileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : ''
}

function fileExtTheme(name: string): string {
  return EXT_THEME[fileExt(name)] ?? 'default'
}

function isCodeFile(name: string): boolean { return CODE_EXTS.has(fileExt(name)) }
function isConfigFile(name: string): boolean { return CONFIG_EXTS.has(fileExt(name)) }

function fileIconTheme(item: FileItem): string {
  if (item.type === 'dir') return 'folder'
  return EXT_THEME[fileExt(item.name)] ?? 'default'
}

function formatDate(mtime: string): string {
  const d = new Date(mtime)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (diffDays < 7) return `${diffDays} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ── Upload ──────────────────────────────────────────────────────────────────

async function onFileInputChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  const formData = new FormData()
  for (const f of files) formData.append('files', f)
  await fetch(`${API_BASE}/files/upload?dir=${encodeURIComponent(currentPath.value)}`, {
    method: 'POST', body: formData,
  })
  load(currentPath.value)
  ;(e.target as HTMLInputElement).value = ''
}

// ── Preview ─────────────────────────────────────────────────────────────────

const BINARY_EXTS = /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff|mp4|mp3|mov|avi|pdf|zip|tar|gz|xz|bz2|7z|rar|exe|bin|so|dylib|wasm|class|jar|war|ear)$/i

const previewModal = ref({ show: false, loading: false, saving: false, name: '', path: '', content: '' })

async function downloadFile(item: { name: string; path: string }) {
  const url = `${API_BASE}/files/download?path=${encodeURIComponent(item.path)}`
  // Chromium + secure context: let the user pick the target folder & name.
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({ suggestedName: item.name })
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`下载失败: ${res.status}`)
      const writable = await handle.createWritable()
      await res.body.pipeTo(writable)
      return
    } catch (e: any) {
      // User cancelled the picker — abort silently, do not fall back.
      if (e?.name === 'AbortError') return
      // Any other failure — fall through to the <a download> path.
    }
  }
  // Fallback: browser default download directory.
  const a = document.createElement('a')
  a.href = url
  a.download = item.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function openFile(item: FileItem) {
  if (BINARY_EXTS.test(item.name)) {
    downloadFile(item)
    return
  }
  previewModal.value = { show: true, loading: true, saving: false, name: item.name, path: item.path, content: '' }
  const res = await apiFetch(`/api/files/get?path=${encodeURIComponent(item.path)}`)
  const data = await res.json()
  previewModal.value.content = data.content ?? ''
  previewModal.value.loading = false
}

async function savePreview() {
  previewModal.value.saving = true
  const res = await apiFetch('/api/files/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: previewModal.value.path, content: previewModal.value.content }),
  })
  if (res.ok) previewModal.value.show = false
  previewModal.value.saving = false
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function deleteItem(item: FileItem) {
  if (!await confirm({ title: '删除文件', message: `确定删除「${item.name}」吗？此操作不可撤销。`, confirmText: '删除', danger: true })) return
  await apiFetch('/api/files/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: item.path }),
  })
  load(currentPath.value)
}

// ── Rename ───────────────────────────────────────────────────────────────────

const renameModal = ref({ show: false, loading: false, item: null as FileItem | null, newName: '' })

function startRename(item: FileItem) {
  renameModal.value = { show: true, loading: false, item, newName: item.name }
}

async function doRename() {
  const { item, newName } = renameModal.value
  if (!item || !newName.trim()) return
  const dir = item.path.split('/').slice(0, -1).join('/') || '/'
  const toPath = dir === '/' ? `/${newName}` : `${dir}/${newName}`
  renameModal.value.loading = true
  await apiFetch('/api/files/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: item.path, to: toPath }),
  })
  renameModal.value.show = false
  renameModal.value.loading = false
  load(currentPath.value)
}

// ── Mkdir ────────────────────────────────────────────────────────────────────

const showMkdir = ref(false)
const mkdirName = ref('')

async function doMkdir() {
  if (!mkdirName.value.trim()) return
  const path = currentPath.value === '/' ? `/${mkdirName.value}` : `${currentPath.value}/${mkdirName.value}`
  await apiFetch('/api/files/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  showMkdir.value = false
  mkdirName.value = ''
  load(currentPath.value)
}
</script>

<style scoped>
/* ── Header actions ──────────────────────────────────────────────────────── */

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: var(--font-sans);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast), transform var(--duration-fast), box-shadow var(--duration-fast);
}

.action-btn:hover {
  border-color: rgba(99, 102, 241, 0.28);
  background: var(--surface);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px var(--tint-medium);
}

.action-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.action-btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

/* ── Path bar ───────────────────────────────────────────────────────────── */

.path-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  padding: 10px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.path-bar-inner {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.path-seg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
  font-family: var(--font-sans);
  white-space: nowrap;
}

.path-seg:hover {
  background: rgba(99, 102, 241, 0.07);
  color: var(--accent-text);
}

.path-seg-root {
  color: var(--text-primary);
  font-weight: 600;
}

.path-seg-active {
  color: var(--text-primary);
  font-weight: 700;
  cursor: default;
  background: rgba(99, 102, 241, 0.06);
}

.path-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  margin: 0 1px;
}

.path-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.path-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--tint-medium);
  padding: 4px 9px;
  border-radius: var(--radius-full);
}

/* ── Search bar ─────────────────────────────────────────────────────────── */

.search-bar {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: var(--space-4);
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--text-muted);
  pointer-events: none;
  flex-shrink: 0;
}

.search-input {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 38px;
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 8px var(--tint-weak);
}

.search-input::placeholder { color: var(--text-muted); }

.search-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}

.search-clear {
  position: absolute;
  right: 10px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}

.search-clear:hover {
  background: var(--surface-2);
  border-color: rgba(210,63,49,0.2);
  color: var(--error-text);
}

/* ── File section ───────────────────────────────────────────────────────── */

.file-section {
  background: var(--surface);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow);
  min-height: 320px;
}

.file-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 320px;
  padding: 48px;
  text-align: center;
}

.file-empty-icon {
  color: var(--text-muted);
  opacity: 0.5;
}

.file-empty-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
}

.file-empty-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(99, 102, 241, 0.18);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Column headers ─────────────────────────────────────────────────────── */

.file-header-row {
  display: grid;
  grid-template-columns: 56px 1fr 90px 110px 160px;
  gap: var(--space-3);
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
}

/* ── File list ──────────────────────────────────────────────────────────── */

.file-list { display: flex; flex-direction: column; }

.file-row {
  display: grid;
  grid-template-columns: 56px 1fr 90px 110px 160px;
  align-items: center;
  gap: var(--space-3);
  padding: 9px 16px;
  border-bottom: 1px solid var(--border-soft);
  transition: background var(--duration-fast);
}

.file-row:last-child { border-bottom: none; }

.file-row:hover { background: rgba(99, 102, 241, 0.03); }

/* ── File icons ─────────────────────────────────────────────────────────── */

.file-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  border: 1px solid transparent;
  transition: transform var(--duration-fast);
}

.file-row:hover .file-icon { transform: scale(1.07); }

/* Icon themes */
.file-icon-folder { background: rgba(251, 191, 36, 0.14); border-color: rgba(251,191,36,0.2); color: var(--warn-text); }
.file-icon-blue   { background: rgba(59, 130, 246, 0.1);  border-color: rgba(59,130,246,0.16); color: var(--accent-text); }
.file-icon-yellow { background: rgba(234,179,8,0.1);       border-color: rgba(234,179,8,0.18);  color: var(--warn-text); }
.file-icon-green  { background: rgba(16,185,129,0.1);      border-color: rgba(16,185,129,0.18); color: #047857; }
.file-icon-cyan   { background: rgba(6,182,212,0.1);       border-color: rgba(6,182,212,0.18);  color: #0e7490; }
.file-icon-orange { background: rgba(249,115,22,0.1);      border-color: rgba(249,115,22,0.18); color: var(--warn-text); }
.file-icon-amber  { background: var(--warn-bg);      border-color: var(--warn-bg); color: var(--warn-text); }
.file-icon-purple { background: rgba(139,92,246,0.1);      border-color: rgba(139,92,246,0.18); color: #6d28d9; }
.file-icon-pink   { background: rgba(236,72,153,0.1);      border-color: rgba(236,72,153,0.18); color: #be185d; }
.file-icon-red    { background: var(--error-bg);       border-color: var(--error-bg);  color: var(--error-text); }
.file-icon-slate  { background: rgba(100,116,139,0.09);    border-color: rgba(100,116,139,0.16);color: var(--text-secondary); }
.file-icon-default{ background: rgba(107,114,128,0.08);    border-color: rgba(107,114,128,0.14);color: var(--text-secondary); }

/* ── File info ──────────────────────────────────────────────────────────── */

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
}

.file-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--duration-fast);
}

.file-name-dir { font-weight: 700; }

.file-info:hover .file-name { color: var(--accent-text); }

/* Extension badges */
.file-ext-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
}

.ext-blue   { background: rgba(59,130,246,0.1);  border-color: rgba(59,130,246,0.18);  color: var(--accent-text); }
.ext-yellow { background: rgba(234,179,8,0.1);   border-color: rgba(234,179,8,0.2);    color: var(--warn-text); }
.ext-green  { background: rgba(16,185,129,0.1);  border-color: rgba(16,185,129,0.2);   color: #047857; }
.ext-cyan   { background: rgba(6,182,212,0.1);   border-color: rgba(6,182,212,0.2);    color: #0e7490; }
.ext-orange { background: rgba(249,115,22,0.1);  border-color: rgba(249,115,22,0.2);   color: var(--warn-text); }
.ext-amber  { background: var(--warn-bg);  border-color: rgba(245,158,11,0.2);   color: var(--warn-text); }
.ext-purple { background: rgba(139,92,246,0.1);  border-color: rgba(139,92,246,0.2);   color: #6d28d9; }
.ext-pink   { background: rgba(236,72,153,0.1);  border-color: rgba(236,72,153,0.2);   color: #be185d; }
.ext-red    { background: var(--error-bg);   border-color: rgba(239,68,68,0.2);    color: var(--error-text); }
.ext-slate  { background: rgba(100,116,139,0.09);border-color: rgba(100,116,139,0.18); color: var(--text-secondary); }
.ext-default{ background: rgba(107,114,128,0.08);border-color: rgba(107,114,128,0.14); color: var(--text-muted); }

/* ── File meta ──────────────────────────────────────────────────────────── */

.file-size, .file-mtime {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.file-size-dir { opacity: 0.35; }

/* ── File actions ───────────────────────────────────────────────────────── */

.file-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.file-row:hover .file-actions { opacity: 1; }

.fa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast), transform var(--duration-fast);
  white-space: nowrap;
}

.fa-btn:hover {
  border-color: rgba(99, 102, 241, 0.28);
  color: var(--accent-text);
  background: var(--surface-2);
  transform: translateY(-1px);
}

.fa-btn-danger:hover {
  border-color: rgba(210, 63, 49, 0.28);
  color: var(--error-text);
  background: var(--surface-2);
}

/* ── Modals ─────────────────────────────────────────────────────────────── */

.ui-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(8px);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}

.ui-modal {
  background: var(--surface);
  border: 1px solid var(--card-border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  width: 100%;
  overflow: hidden;
}

.ui-modal-sm { max-width: 420px; }
.ui-modal-lg { max-width: 780px; }

.ui-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.ui-modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ui-modal-kicker {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
}

.ui-modal-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-modal-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast);
  flex-shrink: 0;
}

.ui-modal-close:hover {
  border-color: rgba(210, 63, 49, 0.28);
  color: var(--error-text);
  background: var(--surface-2);
}

.ui-modal-body {
  padding: var(--space-5) var(--space-6);
  overflow: auto;
  flex: 1;
}

.ui-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border-soft);
  flex-shrink: 0;
}

/* ── Preview editor ──────────────────────────────────────────────────────── */

.preview-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  min-height: 200px;
  justify-content: center;
}

.preview-editor-wrap {
  border: 1px solid var(--tint-stronger);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: #1e1e2e;
}

.preview-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #181825;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.preview-toolbar-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.preview-toolbar-label {
  margin-left: 8px;
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-editor {
  display: block;
  width: 100%;
  min-height: 380px;
  max-height: 58vh;
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  color: #cdd6f4;
  background: transparent;
  border: none;
  outline: none;
  resize: vertical;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  box-sizing: border-box;
  tab-size: 2;
}

/* ── Form fields ─────────────────────────────────────────────────────────── */

.form-field { display: flex; flex-direction: column; gap: var(--space-2); }

.form-label {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
}

.form-input {
  width: 100%;
  min-height: 40px;
  padding: 9px 13px;
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}

.form-hint-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 6px;
}

/* ── Modal buttons ──────────────────────────────────────────────────────── */

.modal-btn {
  padding: 9px 18px;
  font-size: var(--text-sm);
  font-weight: 600;
  font-family: var(--font-sans);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast), transform var(--duration-fast);
}

.modal-btn:hover {
  border-color: var(--tint-stronger);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.modal-btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.modal-btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */

@media (max-width: 720px) {
  .file-header-row,
  .file-row {
    grid-template-columns: 48px 1fr 100px;
  }

  .file-mtime,
  .file-size {
    display: none;
  }

  .file-header-row > :nth-child(3),
  .file-header-row > :nth-child(4),
  .file-header-row > :nth-child(5) {
    display: none;
  }

  .file-actions { opacity: 1; }
  .path-meta { display: none; }
}
</style>
