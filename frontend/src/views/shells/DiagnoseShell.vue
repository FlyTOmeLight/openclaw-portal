<template>
  <TabShell
    title="诊断中心"
    subtitle="运行日志 + 健康诊断，一个页面排障"
    :tabs="[
      { path: '/diagnose/logs', label: '运行日志' },
      { path: '/diagnose/health', label: '系统诊断' },
    ]"
  />
</template>
<script setup lang="ts">
import TabShell from './TabShell.vue'
</script>
