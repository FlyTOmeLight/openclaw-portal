<template>
  <div class="fb-root">
    <div class="fb-header">
      <span class="fb-title">📁 文件管理</span>
      <div class="fb-actions">
        <a :href="fbUrl" target="_blank" class="btn sm">在新标签打开</a>
        <button @click="reload" class="btn sm">刷新</button>
      </div>
    </div>

    <div v-if="status === 'checking'" class="state-msg">检查 FileBrowser 可用性…</div>

    <div v-else-if="status === 'unavailable'" class="state-msg error">
      <p>⚠️ FileBrowser 未运行（端口 {{ fbPort }} 未响应）</p>
      <p class="sub">请确认 FileBrowser 服务已启动：<code>systemctl status filebrowser</code></p>
    </div>

    <iframe
      v-else
      :src="fbUrl"
      :key="iframeKey"
      class="fb-frame"
      allow="clipboard-read; clipboard-write"
      sandbox="allow-same-origin allow-scripts allow-forms allow-downloads allow-popups"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

// FileBrowser runs at /files/ (proxied via Nginx) or direct port 8081
const fbUrl = computed(() => window.location.origin.replace(':3000', ':8080') + '/files/')
const fbPort = 8081
const status = ref<'checking' | 'available' | 'unavailable'>('checking')
const iframeKey = ref(0)

onMounted(async () => {
  // Check if FileBrowser is reachable via the portal backend's Nginx proxy
  try {
    const res = await fetch(fbUrl.value, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
    status.value = res.ok || res.status === 302 || res.status === 401 ? 'available' : 'unavailable'
  } catch {
    status.value = 'unavailable'
  }
})

function reload() { iframeKey.value++ }
</script>

<style scoped>
.fb-root { display: flex; flex-direction: column; height: calc(100vh - 64px); background: white; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
.fb-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid #e5e7eb; }
.fb-title { font-weight: 600; font-size: 16px; }
.fb-actions { display: flex; gap: 8px; }
.fb-frame { flex: 1; border: none; width: 100%; }
.state-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #6b7280; font-size: 14px; text-align: center; }
.state-msg.error { color: #b91c1c; }
.state-msg .sub { font-size: 13px; margin-top: 8px; color: #6b7280; }
.state-msg code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
.btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 13px; background: white; text-decoration: none; }
.btn.sm { padding: 4px 10px; font-size: 12px; }
</style>
