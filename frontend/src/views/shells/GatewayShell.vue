<template>
  <TabShell
    title="网关 & 配置"
    subtitle="Gateway 端口、设备、原始 openclaw.json 编辑"
    :tabs="[
      { path: '/gateway-config/gateway', label: '网关' },
      { path: '/gateway-config/raw', label: 'JSON 编辑器' },
    ]"
  />
</template>
<script setup lang="ts">
import TabShell from './TabShell.vue'
</script>
