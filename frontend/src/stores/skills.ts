import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export interface RegistrySource {
  id: string
  name: string
  type: 'local' | 'remote'
  url: string
}

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<any[]>([])
  const registry = ref<any[]>([])
  const registryLoading = ref(false)
  const registryLoadingMore = ref(false)
  const registryHasMore = ref(false)

  const REGISTRY_PAGE_SIZE = 30
  let registryPage = 1
  let lastRegistryQuery = { q: '', sourceId: '', category: '' }
  const bundled = ref<any[]>([])
  const agents = ref<any[]>([])
  const sources = ref<RegistrySource[]>([])
  const activeSourceId = ref('')

  async function load() {
    skills.value = await api.skills.list()
  }

  async function loadRegistry(q = '', sourceId = activeSourceId.value, category = '') {
    registryLoading.value = true
    registryPage = 1
    lastRegistryQuery = { q, sourceId, category }
    try {
      const batch = await api.skills.registry(q, sourceId, category, 1)
      registry.value = batch
      registryHasMore.value = batch.length >= REGISTRY_PAGE_SIZE
    } finally {
      registryLoading.value = false
    }
  }

  // 瀑布式加载下一页,结果追加到现有列表。仅当 registryHasMore 为真时有效。
  async function loadMoreRegistry() {
    if (!registryHasMore.value || registryLoading.value || registryLoadingMore.value) return
    registryLoadingMore.value = true
    try {
      const next = registryPage + 1
      const { q, sourceId, category } = lastRegistryQuery
      const batch = await api.skills.registry(q, sourceId, category, next)
      registry.value = [...registry.value, ...batch]
      registryPage = next
      registryHasMore.value = batch.length >= REGISTRY_PAGE_SIZE
    } finally {
      registryLoadingMore.value = false
    }
  }

  async function loadBundled() {
    const res = await api.skills.listBundled()
    bundled.value = res.skills
  }

  async function loadAgents() {
    agents.value = await api.agents.list()
  }

  async function loadSources() {
    const s = await api.settings.get()
    sources.value = s.skillRegistrySources ?? []
    activeSourceId.value = s.activeSkillRegistrySourceId || sources.value[0]?.id || ''
  }

  async function saveSources(newSources: RegistrySource[]) {
    const nextActive = newSources.some(src => src.id === activeSourceId.value)
      ? activeSourceId.value
      : (newSources[0]?.id || '')
    await api.settings.update({ skillRegistrySources: newSources, activeSkillRegistrySourceId: nextActive })
    sources.value = newSources
    activeSourceId.value = nextActive
    await loadRegistry()
  }

  async function setActiveSource(sourceId: string) {
    activeSourceId.value = sourceId
    await api.settings.update({ activeSkillRegistrySourceId: sourceId })
    await loadRegistry()
  }

  async function deploy(name: string, agent: string) {
    await api.skills.deploy(name, agent)
    await load()
  }

  // 安装后只刷新已安装列表;registry 列表保持不动,「已有安装」标记靠
  // isInstalled() 响应式自动更新,避免整列表重拉造成的页面强刷。
  async function installRemote(downloadUrl: string, agent: string | null) {
    await api.skills.installRemote(downloadUrl, agent)
    await load()
  }

  async function installRegistry(slug: string, sourceUrl: string, sourceType: string, agent: string | null) {
    await api.skills.installRegistry(slug, sourceUrl, sourceType, agent)
    await load()
  }

  async function disable(name: string, agent: string) {
    await api.skills.disable(name, agent)
    await load()
  }

  async function enable(name: string, agent: string) {
    await api.skills.enable(name, agent)
    await load()
  }

  async function deleteSkill(name: string, agent: string | null) {
    await api.skills.delete(name, agent)
    await load()
  }

  async function install(file: File, agent: string | null, skillName?: string) {
    await api.skills.install(file, agent, skillName)
    await load()
  }

  return {
    skills, registry, registryLoading, registryLoadingMore, registryHasMore,
    bundled, agents, sources, activeSourceId,
    load, loadRegistry, loadMoreRegistry, loadBundled, loadAgents, loadSources, saveSources,
    setActiveSource, deploy, installRemote, installRegistry, disable, enable, deleteSkill, install,
  }
})
