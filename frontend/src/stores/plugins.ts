import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<any[]>([])
  const loading = ref(false)

  async function load() {
    plugins.value = await api.plugins.list()
  }

  async function install(packageName: string) {
    loading.value = true
    try {
      await api.plugins.install(packageName)
      await load()
    } finally {
      loading.value = false
    }
  }

  async function uninstall(name: string) {
    await api.plugins.uninstall(name)
    await load()
  }

  return { plugins, loading, load, install, uninstall }
})
