import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<any[]>([])
  const loading = ref(false)
  const lastCommand = ref<{ command: string; stdout: string; stderr: string } | null>(null)
  const lastAction = ref<{ kind: 'install' | 'uninstall'; pkg: string; at: number } | null>(null)

  async function load() {
    plugins.value = await api.plugins.list()
  }

  async function install(packageName: string) {
    loading.value = true
    try {
      const res = await api.plugins.install(packageName)
      plugins.value = res.plugins
      lastCommand.value = res.result
      lastAction.value = { kind: 'install', pkg: packageName, at: Date.now() }
      return res
    } finally {
      loading.value = false
    }
  }

  async function uninstall(name: string) {
    const res = await api.plugins.uninstall(name)
    plugins.value = res.plugins
    lastCommand.value = res.result
    lastAction.value = { kind: 'uninstall', pkg: name, at: Date.now() }
    return res
  }

  return { plugins, loading, lastCommand, lastAction, load, install, uninstall }
})
