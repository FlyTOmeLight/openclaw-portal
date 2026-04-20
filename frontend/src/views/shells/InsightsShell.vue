<template>
  <TabShell
    title="留痕"
    subtitle="Token 用量历史与所有高权限操作的审计记录"
    :tabs="[
      { path: '/insights/usage', label: 'Token 用量' },
      { path: '/insights/audit', label: '操作审计' },
    ]"
  />
</template>
<script setup lang="ts">
import TabShell from './TabShell.vue'
</script>
