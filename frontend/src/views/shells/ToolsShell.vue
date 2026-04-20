<template>
  <TabShell
    title="系统工具"
    subtitle="命令终端与文件管理，日常运维场景"
    :tabs="[
      { path: '/tools/terminal', label: '命令终端' },
      { path: '/tools/files', label: '文件管理' },
    ]"
  />
</template>
<script setup lang="ts">
import TabShell from './TabShell.vue'
</script>
