<template>
  <n-tag :type="tagType" size="small" round>
    <template v-if="props.state === 'running'" #icon>
      <span class="dot pulse" />
    </template>
    {{ label }}
  </n-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'

const props = defineProps<{ state: 'running' | 'stopped' | 'error' }>()

const label = { running: '运行中', stopped: '已停止', error: '异常' }[props.state]

const tagType = computed(() => {
  if (props.state === 'running') return 'success'
  if (props.state === 'error') return 'error'
  return 'default'
})
</script>

<style scoped>
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}
</style>
