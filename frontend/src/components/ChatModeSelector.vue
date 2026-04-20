<template>
  <div class="mode-selector" role="group" aria-label="聊天模式">
    <button
      v-for="m in MODES"
      :key="m.value"
      :class="['mode-btn', { active: modelValue === m.value }]"
      :title="m.description"
      @click="$emit('update:modelValue', m.value)"
      type="button"
    >
      <span class="mode-icon">{{ m.icon }}</span>
      <span class="mode-label">{{ m.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
export type ChatMode = 'chat' | 'plan' | 'execute' | 'unlimited'

defineProps<{ modelValue: ChatMode }>()
defineEmits<{ 'update:modelValue': [value: ChatMode] }>()

const MODES: { value: ChatMode; label: string; icon: string; description: string }[] = [
  { value: 'chat',      label: '聊天',   icon: '💬', description: '仅对话，不使用工具' },
  { value: 'plan',      label: '规划',   icon: '📋', description: '分析规划，不修改文件' },
  { value: 'execute',   label: '执行',   icon: '⚡', description: '正常执行（默认）' },
  { value: 'unlimited', label: '自动',   icon: '🚀', description: '全自动，无需确认' },
]
</script>

<style scoped>
.mode-selector {
  display: flex;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 3px;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background .12s, color .12s;
  white-space: nowrap;
}

.mode-btn:hover { background: var(--surface); color: var(--text-primary); }

.mode-btn.active {
  background: var(--accent);
  color: #fff;
}

.mode-icon { font-size: 12px; }
</style>
