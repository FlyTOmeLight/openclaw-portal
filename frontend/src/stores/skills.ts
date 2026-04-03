import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client.js'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<any[]>([])

  async function load() {
    skills.value = await api.skills.list()
  }

  async function disable(name: string, agent: string) {
    await api.skills.disable(name, agent)
    await load()
  }

  async function enable(name: string, agent: string) {
    await api.skills.enable(name, agent)
    await load()
  }

  async function install(file: File, agent: string | null) {
    await api.skills.install(file, agent)
    await load()
  }

  return { skills, load, disable, enable, install }
})
