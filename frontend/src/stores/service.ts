import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useServiceStore = defineStore('service', () => {
  const state = ref<'running' | 'stopped' | 'error' | 'restarting'>('stopped')
  const pid = ref<number | undefined>()
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    try {
      const status = await api.service.status()
      state.value = status.state as any
      pid.value = status.pid
    } catch {
      state.value = 'error'
    }
  }

  async function start() {
    loading.value = true; error.value = null
    try { await api.service.start(); await refresh() }
    catch (e: any) { error.value = e.message }
    finally { loading.value = false }
  }

  async function stop() {
    loading.value = true; error.value = null
    try { await api.service.stop(); await refresh() }
    catch (e: any) { error.value = e.message }
    finally { loading.value = false }
  }

  async function restart() {
    loading.value = true; error.value = null
    try { await api.service.restart(); await refresh() }
    catch (e: any) { error.value = e.message }
    finally { loading.value = false }
  }

  return { state, pid, loading, error, refresh, start, stop, restart }
})
