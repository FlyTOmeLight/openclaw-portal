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
        <button @click="uninstall(p.name)" class="btn btn-sm btn-danger">卸载</button>
      </div>
    </div>

    <!-- Install from package name -->
    <div class="card">
      <h2>安装插件</h2>
      <p class="hint">输入 npm 包名（如 <code>@openclaw-china/channels</code>），需要网络访问或预置离线包。</p>
      <div class="install-row">
        <input v-model="packageName" placeholder="@openclaw-china/channels" @keyup.enter="doInstall" class="form-input" />
        <button @click="doInstall" :disabled="!packageName || store.loading" class="btn btn-primary">
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
h1 { font-size: var(--text-xl); font-weight: 700; margin-bottom: var(--space-6); letter-spacing: -.3px; }
h2 { font-size: var(--text-md); font-weight: 600; margin-bottom: var(--space-3); }
.section { margin-bottom: var(--space-8); }
.plugin-row { display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); margin-bottom: var(--space-2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); }
.plugin-name { font-weight: 600; font-size: var(--text-sm); }
.plugin-desc { font-size: var(--text-xs); color: var(--text-secondary); margin-top: 2px; }
.version { background: var(--surface-2); padding: 1px 6px; border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--text-muted); }
.hint { font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-3); }
.hint code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); }
.install-row { display: flex; gap: var(--space-2); }
.install-row input { flex: 1; }
.error-msg { color: var(--error-text); font-size: var(--text-sm); margin-top: var(--space-3); }
.empty { color: var(--text-muted); font-size: var(--text-sm); }
</style>
