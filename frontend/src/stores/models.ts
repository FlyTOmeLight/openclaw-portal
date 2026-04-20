import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useModelsStore = defineStore('models', () => {
  const providers = ref<Record<string, any>>({})
  const primary = ref('')
  const fallbacks = ref<string[]>([])
  const loading = ref(false)
  const testResult = ref<'idle' | 'ok' | 'fail'>('idle')
  const testError = ref('')

  async function load() {
    const data = await api.models.list()
    providers.value = data.providers
    primary.value = data.primary
    fallbacks.value = data.fallbacks ?? []
  }

  async function saveProvider(id: string, provider: any) {
    loading.value = true
    try {
      await api.models.updateProvider(id, provider)
      providers.value = { ...providers.value, [id]: provider }
    } finally { loading.value = false }
  }

  async function deleteProvider(id: string) {
    await api.models.deleteProvider(id)
    const next = { ...providers.value }
    delete next[id]
    providers.value = next
  }

  async function setPrimary(p: string) {
    await api.models.setPrimary(p); primary.value = p
  }

  async function setFallbacks(values: string[]) {
    await api.models.setFallbacks(values)
    fallbacks.value = values
  }

  async function testProvider(baseUrl: string, apiKey: string, modelId: string, apiType?: string) {
    testResult.value = 'idle'; testError.value = ''
    try { await api.models.test(baseUrl, apiKey, modelId, apiType); testResult.value = 'ok' }
    catch (e: any) { testResult.value = 'fail'; testError.value = e.message }
  }

  return { providers, primary, fallbacks, loading, testResult, testError, load, saveProvider, deleteProvider, setPrimary, setFallbacks, testProvider }
})
