import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useChannelsStore = defineStore('channels', () => {
  const channels = ref<Record<string, any>>({})
  const statusRaw = ref('')
  const loading = ref(false)

  async function load() {
    channels.value = await api.channels.list()
  }

  async function save(name: string, config: any) {
    await api.channels.upsert(name, config)
    await load()
  }

  async function remove(name: string) {
    await api.channels.remove(name)
    await load()
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

  return { channels, statusRaw, loading, load, save, remove, fetchStatus }
})
