<template>
  <span :class="['badge', state]">{{ label }}</span>
</template>

<script setup lang="ts">
const props = defineProps<{ state: 'running' | 'stopped' | 'error' }>()
const label = { running: '运行中', stopped: '已停止', error: '异常' }[props.state]
</script>

<style scoped>
.badge { padding: 3px 10px; border-radius: 12px; font-size: 13px; font-weight: 500; }
.running { background: #d1fae5; color: #065f46; }
.stopped { background: #f3f4f6; color: #6b7280; }
.error   { background: #fee2e2; color: #991b1b; }
</style>
