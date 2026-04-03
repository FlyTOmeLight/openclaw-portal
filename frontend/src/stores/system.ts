import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useSystemStore = defineStore('system', () => {
  const stats = ref<any>(null)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try { stats.value = await api.system.stats() }
    finally { loading.value = false }
  }

  return { stats, loading, load }
})
