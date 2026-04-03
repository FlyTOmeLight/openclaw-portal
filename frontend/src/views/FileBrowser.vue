<template>
  <div class="fb-root">
    <div class="fb-header">
      <span class="fb-title">📁 文件管理</span>
      <div class="fb-actions">
        <a :href="fbUrl" target="_blank" class="btn btn-sm">在新标签打开</a>
        <button @click="reload" class="btn btn-sm">刷新</button>
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
.fb-root { display: flex; flex-direction: column; height: calc(100vh - 96px); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow); overflow: hidden; }
.fb-header { display: flex; justify-content: space-between; align-items: center; padding: 13px 20px; border-bottom: 1px solid var(--border); }
.fb-title { font-weight: 600; font-size: var(--text-md); }
.fb-actions { display: flex; gap: var(--space-2); }
.fb-frame { flex: 1; border: none; width: 100%; }
.state-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); font-size: var(--text-sm); gap: var(--space-2); }
.state-msg.error { color: var(--error-text); }
.state-msg code { background: var(--surface-2); padding: 2px 6px; border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-xs); }
</style>
