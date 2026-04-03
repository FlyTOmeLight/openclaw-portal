<template>
  <span :class="['badge', cls]">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ state: 'running' | 'stopped' | 'error' }>()
const label = { running: '运行中', stopped: '已停止', error: '异常' }[props.state]
const cls = { running: 'badge-success', stopped: 'badge-muted', error: 'badge-error' }[props.state]
</script>
