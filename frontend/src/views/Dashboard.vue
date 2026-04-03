<template>
  <div>
    <h1>仪表盘</h1>
    <div class="card">
      <div class="card-header">
        <span class="title">OpenClaw 服务</span>
        <StatusBadge :state="store.state" />
      </div>
      <p v-if="store.pid" class="detail">PID: {{ store.pid }}</p>
      <p v-if="store.error" class="error-msg">{{ store.error }}</p>
      <div class="actions">
        <button @click="store.start()" :disabled="store.state === 'running' || store.loading" class="btn primary">启动</button>
        <button @click="store.stop()" :disabled="store.state !== 'running' || store.loading" class="btn danger">停止</button>
        <button @click="store.restart()" :disabled="store.loading" class="btn">重启</button>
        <a :href="chatUrl" target="_blank" class="btn chat">进入聊天 →</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useServiceStore } from '../stores/service.js'
import StatusBadge from '../components/StatusBadge.vue'

const store = useServiceStore()
onMounted(() => store.refresh())

const chatUrl = computed(() => {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `https://${host}:8080/`
})
</script>

<style scoped>
h1 { font-size: 22px; margin-bottom: 24px; }
.card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); max-width: 480px; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.title { font-size: 16px; font-weight: 600; }
.detail { color: #6b7280; font-size: 13px; margin: 4px 0 16px; }
.error-msg { color: #ef4444; font-size: 13px; margin-bottom: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.danger  { background: #ef4444; color: white; border-color: #ef4444; }
.btn.chat    { background: #059669; color: white; border-color: #059669; text-decoration: none; }
</style>
