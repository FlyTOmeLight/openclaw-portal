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
  const bundled = ref<any[]>([])
  const agents = ref<any[]>([])
  const sources = ref<RegistrySource[]>([])
  const activeSourceId = ref('')

  async function load() {
    skills.value = await api.skills.list()
  }

  async function loadRegistry(q = '', sourceId = activeSourceId.value) {
    registryLoading.value = true
    try {
      registry.value = await api.skills.registry(q, sourceId)
    } finally {
      registryLoading.value = false
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

  async function installRemote(downloadUrl: string, agent: string | null) {
    await api.skills.installRemote(downloadUrl, agent)
    await load()
    await loadRegistry()
  }

  async function installRegistry(slug: string, sourceUrl: string, sourceType: string, agent: string | null) {
    await api.skills.installRegistry(slug, sourceUrl, sourceType, agent)
    await load()
    await loadRegistry()
  }

  async function disable(name: string, agent: string) {
    await api.skills.disable(name, agent)
    await load()
  }

  async function enable(name: string, agent: string) {
    await api.skills.enable(name, agent)
    await load()
  }

  async function install(file: File, agent: string | null, skillName?: string) {
    await api.skills.install(file, agent, skillName)
    await load()
    await loadRegistry()
  }

  return {
    skills, registry, registryLoading, bundled, agents, sources, activeSourceId,
    load, loadRegistry, loadBundled, loadAgents, loadSources, saveSources,
    setActiveSource, deploy, installRemote, installRegistry, disable, enable, install,
  }
})
