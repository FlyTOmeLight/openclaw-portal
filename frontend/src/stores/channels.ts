import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useChannelsStore = defineStore('channels', () => {
  const channels = ref<Record<string, any>>({})
  const bindings = ref<Record<string, string>>({})
  const pluginStatus = ref<Record<string, { required: string; installed: boolean }>>({})
  const statusRaw = ref('')
  const loading = ref(false)

  async function load() {
    try {
      const [ch, bi, ps] = await Promise.all([
        api.channels.list(),
        api.channels.listBindings(),
        api.channels.pluginStatus(),
      ])
      channels.value = ch
      bindings.value = bi
      pluginStatus.value = ps
    } catch {
      channels.value = {}
      bindings.value = {}
      pluginStatus.value = {}
    }
  }

  async function save(name: string, config: any) {
    await api.channels.upsert(name, config)
    // Optimistic update — avoid a round-trip reload.
    channels.value = { ...channels.value, [name]: config }
  }

  async function remove(name: string) {
    await api.channels.remove(name)
    const next = { ...channels.value }
    delete next[name]
    channels.value = next
  }

  async function fetchStatus() {
    loading.value = true
    try {
      const res = await api.channels.status()
      statusRaw.value = res.raw
    } finally {
      loading.value = false
    }
  }

  async function setBinding(platform: string, accountId: string, scope: string, agentId: string) {
    await api.channels.setBinding(platform, accountId, scope, agentId)
    const key = `${platform}/${accountId}/${scope}`
    bindings.value = { ...bindings.value, [key]: agentId }
  }

  async function deleteBinding(platform: string, accountId: string, scope: string) {
    await api.channels.deleteBinding(platform, accountId, scope)
    const key = `${platform}/${accountId}/${scope}`
    const next = { ...bindings.value }
    delete next[key]
    bindings.value = next
  }

  async function refreshPluginStatus() {
    pluginStatus.value = await api.channels.pluginStatus()
  }

  return {
    channels, bindings, pluginStatus, statusRaw, loading,
    load, save, remove, fetchStatus, setBinding, deleteBinding, refreshPluginStatus,
  }
})
