<template>
  <TabShell
    title="对话历史"
    subtitle="浏览历史会话，实时观察 Agent 的工具调用"
    :tabs="[
      { path: '/history/sessions', label: '历史会话' },
      { path: '/history/activity', label: '实时活动' },
    ]"
  />
</template>
<script setup lang="ts">
import TabShell from './TabShell.vue'
</script>
