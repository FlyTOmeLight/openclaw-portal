<template>
  <div>
    <h1>插件管理</h1>

    <!-- Installed plugins -->
    <div class="section">
      <h2>已安装插件</h2>
      <div v-if="store.plugins.length === 0" class="empty">暂无已安装插件</div>
      <div v-for="p in store.plugins" :key="p.name" class="plugin-row">
        <div>
          <div class="plugin-name">{{ p.name }}</div>
          <div class="plugin-desc">{{ p.description }} <span class="version">v{{ p.version }}</span></div>
        </div>
        <button @click="uninstall(p.name)" class="btn sm danger">卸载</button>
      </div>
    </div>

    <!-- Install from package name -->
    <div class="card">
      <h2>安装插件</h2>
      <p class="hint">输入 npm 包名（如 <code>@openclaw-china/channels</code>），需要网络访问或预置离线包。</p>
      <div class="install-row">
        <input v-model="packageName" placeholder="@openclaw-china/channels" @keyup.enter="doInstall" />
        <button @click="doInstall" :disabled="!packageName || store.loading" class="btn primary">
          {{ store.loading ? '安装中...' : '安装' }}
        </button>
      </div>
      <div v-if="installError" class="error-msg">{{ installError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePluginsStore } from '../stores/plugins.js'

const store = usePluginsStore()
onMounted(() => store.load())

const packageName = ref('')
const installError = ref('')

async function doInstall() {
  installError.value = ''
  try {
    await store.install(packageName.value)
    packageName.value = ''
  } catch (e: any) {
    installError.value = e.message
  }
}

async function uninstall(name: string) {
  if (confirm(`确认卸载 ${name}？`)) {
    await store.uninstall(name)
  }
}
</script>

<style scoped>
h1 { font-size: 22px; margin-bottom: 24px; }
h2 { font-size: 15px; margin-bottom: 14px; }
.section { margin-bottom: 32px; }
.plugin-row { display: flex; justify-content: space-between; align-items: center; background: white; border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.plugin-name { font-weight: 600; font-size: 14px; }
.plugin-desc { font-size: 13px; color: #6b7280; margin-top: 2px; }
.version { background: #f3f4f6; padding: 1px 6px; border-radius: 8px; font-size: 11px; }
.card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); max-width: 560px; }
.hint { font-size: 13px; color: #6b7280; margin-bottom: 14px; }
.hint code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.install-row { display: flex; gap: 8px; }
.install-row input { flex: 1; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }
.btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #d1d5db; cursor: pointer; font-size: 14px; background: white; }
.btn.primary { background: #2563eb; color: white; border-color: #2563eb; }
.btn.danger { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.btn.sm { padding: 5px 10px; font-size: 12px; }
.btn:disabled { opacity: .4; }
.error-msg { color: #dc2626; font-size: 13px; margin-top: 10px; }
.empty { color: #9ca3af; font-size: 14px; }
</style>
