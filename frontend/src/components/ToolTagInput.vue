<template>
  <div class="tti-root">
    <!-- selected chips -->
    <div class="tti-chips" @click="focusInput">
      <span
        v-for="(t, i) in modelValue"
        :key="t"
        class="tti-chip"
        :class="variant"
      >
        {{ t }}
        <button class="tti-chip-del" @click.stop="remove(i)">×</button>
      </span>
      <input
        ref="inputEl"
        v-model="query"
        class="tti-input"
        :placeholder="modelValue.length ? '' : placeholder"
        @keydown="onKeydown"
        @focus="open = true"
        @blur="onBlur"
      />
    </div>

    <!-- suggestions dropdown -->
    <div v-if="open && filtered.length" class="tti-dropdown">
      <button
        v-for="item in filtered"
        :key="item.value"
        class="tti-suggestion"
        :class="{ 'is-group': item.isGroup }"
        @mousedown.prevent="pick(item.value)"
      >
        <span class="sug-icon">{{ item.icon || (item.isGroup ? '📦' : '🔧') }}</span>
        <span class="sug-value">{{ item.value }}</span>
        <span class="sug-label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface SugItem { value: string; label: string; isGroup?: boolean; icon?: string }

// Fallback list used ONLY when no `:suggestions` prop is supplied. Mirrors
// OpenClaw 2026.5's runtime tools.catalog: snake_case core tool ids and
// `group:<sectionId>` groups. Callers SHOULD pass `:suggestions` from the
// gateway's `tools.catalog` so the list reflects the running deployment
// (core + enabled plugins). The previous fallback shipped Claude-Code-style
// PascalCase names (Read, Write, Bash, WebSearch) and a non-existent
// `group:agents` — the gateway silently ignores both.
const ALL_TOOLS: SugItem[] = [
  // groups (core sectionIds from gateway tools.catalog)
  { value: 'group:fs',        label: '文件系统工具集',     isGroup: true },
  { value: 'group:runtime',   label: '代码执行工具集',     isGroup: true },
  { value: 'group:web',       label: '网络 / 搜索工具集',  isGroup: true },
  { value: 'group:memory',    label: '记忆工具集',         isGroup: true },
  { value: 'group:sessions',  label: '会话管理工具集',     isGroup: true },
  { value: 'group:messaging', label: '消息推送工具集',     isGroup: true },
  { value: 'group:ui',        label: 'UI 交互工具集',      isGroup: true },
  { value: 'group:openclaw',  label: 'OpenClaw 集成工具集', isGroup: true },
  // individual tools — canonical snake_case ids
  { value: 'read',             label: '读取文件' },
  { value: 'write',            label: '写入文件' },
  { value: 'edit',             label: '精准编辑' },
  { value: 'apply_patch',      label: '应用补丁' },
  { value: 'exec',             label: '执行 Shell 命令' },
  { value: 'process',          label: '管理 exec 会话' },
  { value: 'code_execution',   label: '远程沙箱代码' },
  { value: 'web_search',       label: '网页搜索' },
  { value: 'web_fetch',        label: '抓取网页内容' },
  { value: 'x_search',         label: '搜索 X 帖子' },
  { value: 'memory_search',    label: '语义搜索记忆' },
  { value: 'memory_get',       label: '读取记忆文件' },
  { value: 'sessions_list',    label: '列出会话' },
  { value: 'sessions_history', label: '读取会话历史' },
  { value: 'sessions_send',    label: '向会话发消息' },
  { value: 'sessions_spawn',   label: '派生子 Agent' },
  { value: 'session_status',   label: '会话状态' },
  { value: 'browser',          label: '浏览器控制' },
  { value: 'canvas',           label: 'Canvas 表面控制' },
  { value: 'message',          label: '发送消息(渠道)' },
]

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
  variant?: 'allow' | 'deny' | 'also'
  suggestions?: SugItem[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>()

const query = ref('')
const open = ref(false)
const inputEl = ref<HTMLInputElement>()

const filtered = computed(() => {
  const q = query.value.toLowerCase()
  const pool = props.suggestions ?? ALL_TOOLS
  return pool.filter(t =>
    !props.modelValue.includes(t.value) &&
    (t.value.toLowerCase().includes(q) || t.label.includes(q))
  ).slice(0, 14)
})

function pick(val: string) {
  if (!props.modelValue.includes(val)) {
    emit('update:modelValue', [...props.modelValue, val])
  }
  query.value = ''
  open.value = true
  inputEl.value?.focus()
}

function remove(i: number) {
  const next = [...props.modelValue]
  next.splice(i, 1)
  emit('update:modelValue', next)
}

function focusInput() { inputEl.value?.focus() }

function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && query.value.trim()) {
    e.preventDefault()
    pick(query.value.trim())
    return
  }
  if (e.key === 'Backspace' && !query.value && props.modelValue.length) {
    const next = [...props.modelValue]
    next.pop()
    emit('update:modelValue', next)
  }
  if (e.key === 'Escape') { open.value = false }
}
</script>

<style scoped>
.tti-root { position: relative; }

.tti-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 38px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  cursor: text;
  transition: border-color .15s;
}
.tti-chips:focus-within { border-color: var(--accent); }

.tti-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-family: var(--font-mono);
  font-weight: 500;
  line-height: 1.6;
}
.tti-chip.allow  { background: #dcfce7; color: var(--success-text); }
.tti-chip.also   { background: #dbeafe; color: var(--accent-text); }
.tti-chip.deny   { background: #fee2e2; color: var(--error-text); }
/* dark mode fallback */
:root.dark .tti-chip.allow { background: var(--success-bg); color: #4ade80; }
:root.dark .tti-chip.also  { background: rgba(59,130,246,.15); color: var(--accent-text); }
:root.dark .tti-chip.deny  { background: var(--error-bg);  color: #f87171; }

.tti-chip-del {
  background: none; border: none; cursor: pointer;
  font-size: 14px; line-height: 1; opacity: .5;
  padding: 0; margin-left: 2px;
  transition: opacity .1s;
}
.tti-chip-del:hover { opacity: 1; }

.tti-input {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  padding: 2px 0;
}
.tti-input::placeholder { color: var(--text-muted); font-family: inherit; }

/* dropdown */
.tti-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-hover);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
}
.tti-suggestion {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background .1s;
  font-size: 13px;
}
.tti-suggestion:hover { background: var(--surface-2); }
.tti-suggestion.is-group { border-bottom: 1px solid var(--border-soft); }
.sug-icon { font-size: 14px; flex-shrink: 0; }
.sug-value { font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.sug-label { font-size: 11px; color: var(--text-muted); margin-left: auto; }
</style>
