<template>
  <div class="md-editor" :class="`mode-${mode}`">
    <!-- Toolbar -->
    <div class="md-toolbar">
      <span class="md-filename">{{ filename }}</span>
      <div class="md-mode-tabs">
        <button
          v-for="m in MODES"
          :key="m.key"
          :class="['md-mode-btn', { active: mode === m.key }]"
          @click="mode = m.key"
        >{{ m.label }}</button>
      </div>
      <div class="md-toolbar-actions">
        <slot name="actions" />
      </div>
    </div>

    <!-- Editor body -->
    <div class="md-body">
      <!-- Edit pane -->
      <div v-if="mode !== 'preview'" class="md-edit-pane">
        <textarea
          ref="textareaRef"
          class="md-textarea"
          :value="modelValue"
          spellcheck="false"
          @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
          @keydown.tab.prevent="onTab"
          @keydown.ctrl.s.prevent="$emit('save')"
          @keydown.meta.s.prevent="$emit('save')"
        />
      </div>

      <!-- Preview pane -->
      <div v-if="mode !== 'edit'" class="md-preview-pane">
        <div class="md-preview-content prose" v-html="rendered" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  modelValue: string
  filename?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
  'save': []
}>()

type Mode = 'edit' | 'split' | 'preview'
const MODES: { key: Mode; label: string }[] = [
  { key: 'edit',    label: '编辑' },
  { key: 'split',   label: '分屏' },
  { key: 'preview', label: '预览' },
]
const mode = ref<Mode>('edit')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const rendered = computed(() => {
  const html = marked.parse(props.modelValue || '', { async: false }) as string
  return DOMPurify.sanitize(html)
})

function onTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const start = el.selectionStart
  const end = el.selectionEnd
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  const newVal = before + '  ' + after
  // Trigger input manually since we're bypassing v-model
  el.value = newVal
  el.dispatchEvent(new Event('input'))
  nextTick(() => { el.selectionStart = el.selectionEnd = start + 2 })
}

defineExpose({ focus: () => textareaRef.value?.focus() })
</script>

<style scoped>
.md-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.md-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
  padding: 8px 16px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  flex-shrink: 0;
  background: var(--surface, #fff);
}

.md-filename {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1C1917);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.md-mode-tabs {
  display: flex;
  gap: 2px;
  background: var(--surface-2, #F5F4EF);
  border-radius: 7px;
  padding: 3px;
}

.md-mode-btn {
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary, #78716C);
  cursor: pointer;
  transition: background .12s, color .12s;
  white-space: nowrap;
}
.md-mode-btn:hover { color: var(--text-primary, #1C1917); }
.md-mode-btn.active {
  background: var(--surface, #fff);
  color: var(--text-primary, #1C1917);
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
}

.md-toolbar-actions {
  display: flex;
  gap: var(--space-2, 8px);
  flex-shrink: 0;
}

/* Body */
.md-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* Edit pane */
.md-edit-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.mode-split .md-edit-pane {
  border-right: 1px solid var(--border, #E7E5E4);
}

.md-textarea {
  flex: 1;
  width: 100%;
  padding: 20px;
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary, #1C1917);
  background: var(--surface, #fff);
  border: none;
  outline: none;
  resize: none;
  tab-size: 2;
  box-sizing: border-box;
  overflow-y: auto;
}

/* Preview pane */
.md-preview-pane {
  flex: 1;
  overflow-y: auto;
  background: var(--surface, #fff);
  min-width: 0;
}

.md-preview-content {
  padding: 20px 24px;
}

/* Prose styles for markdown preview */
.prose {
  font-size: 14px;
  line-height: 1.75;
  color: var(--text-primary, #1C1917);
  max-width: none;
}

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4) {
  font-weight: 700;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: .5em;
  color: var(--text-primary, #1C1917);
}
.prose :deep(h1) { font-size: 1.5em; border-bottom: 1px solid var(--border, #E7E5E4); padding-bottom: .3em; }
.prose :deep(h2) { font-size: 1.25em; border-bottom: 1px solid var(--border, #E7E5E4); padding-bottom: .2em; }
.prose :deep(h3) { font-size: 1.1em; }

.prose :deep(p) { margin: .75em 0; }

.prose :deep(ul),
.prose :deep(ol) {
  padding-left: 1.6em;
  margin: .5em 0;
}
.prose :deep(li) { margin: .25em 0; }

.prose :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: .875em;
  background: var(--surface-2, #F5F4EF);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--accent, #D97706);
}

.prose :deep(pre) {
  background: #1C1917;
  border-radius: 8px;
  padding: 14px 18px;
  overflow-x: auto;
  margin: 1em 0;
}
.prose :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: #E7E5E4;
}

.prose :deep(blockquote) {
  border-left: 3px solid var(--accent, #D97706);
  padding-left: 1em;
  margin: .75em 0;
  color: var(--text-secondary, #78716C);
  font-style: italic;
}

.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--border, #E7E5E4);
  margin: 1.5em 0;
}

.prose :deep(a) {
  color: var(--accent, #D97706);
  text-decoration: none;
}
.prose :deep(a:hover) { text-decoration: underline; }

.prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 1em 0;
}
.prose :deep(th),
.prose :deep(td) {
  border: 1px solid var(--border, #E7E5E4);
  padding: 6px 12px;
  text-align: left;
}
.prose :deep(th) {
  background: var(--surface-2, #F5F4EF);
  font-weight: 600;
}

.prose :deep(strong) { font-weight: 700; }
.prose :deep(em) { font-style: italic; }
</style>
