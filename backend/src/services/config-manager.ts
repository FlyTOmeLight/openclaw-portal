import { readFile } from 'fs/promises'
import { serializePath, atomicWriteFile } from './file-lock.js'
import type { OpenclawConfig, ModelProvider, AgentToolsConfig, AgentSubagentPolicy, AgentListEntry } from '../types/openclaw.js'

export class ConfigManager {
  constructor(private readonly configPath: string) {}

  async read(): Promise<OpenclawConfig> {
    const raw = await readFile(this.configPath, 'utf-8')
    return JSON.parse(raw) as OpenclawConfig
  }

  async write(config: OpenclawConfig): Promise<void> {
    await atomicWriteFile(this.configPath, JSON.stringify(config, null, 2))
  }

  private async mutate(apply: (cfg: OpenclawConfig) => void | Promise<void>): Promise<void> {
    return serializePath(this.configPath, async () => {
      const cfg = await this.read()
      await apply(cfg)
      await this.write(cfg)
    })
  }

  async updateProvider(id: string, provider: ModelProvider): Promise<void> {
    await this.mutate(cfg => { cfg.models.providers[id] = provider })
  }

  async removeProvider(id: string): Promise<void> {
    await this.mutate(cfg => { delete cfg.models.providers[id] })
  }

  async setPrimaryModel(primary: string): Promise<void> {
    await this.mutate(cfg => { cfg.agents.defaults.model.primary = primary })
  }

  async setFallbackModels(fallbacks: string[]): Promise<void> {
    await this.mutate(cfg => { cfg.agents.defaults.model.fallbacks = fallbacks })
  }

  private patchAgentEntryIn(cfg: OpenclawConfig, agentId: string, patch: Partial<AgentListEntry>): void {
    if (!cfg.agents.list) cfg.agents.list = []
    const entry = cfg.agents.list.find((e: AgentListEntry) => e.id === agentId)
    if (entry) {
      Object.assign(entry, patch)
    } else {
      cfg.agents.list.push({ id: agentId, ...patch })
    }
  }

  async setAgentModel(agentId: string, model: string | { primary: string; fallbacks?: string[] }): Promise<void> {
    await this.mutate(cfg => this.patchAgentEntryIn(cfg, agentId, { model }))
  }

  async setAgentThinking(agentId: string, thinking: string | undefined): Promise<void> {
    await this.mutate(cfg => {
      if (!cfg.agents.list) cfg.agents.list = []
      const entry = cfg.agents.list.find((e: AgentListEntry) => e.id === agentId)
      if (entry) {
        if (thinking) { entry.thinking = thinking } else { delete entry.thinking }
      } else if (thinking) {
        cfg.agents.list.push({ id: agentId, thinking })
      }
    })
  }

  async setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    await this.mutate(cfg => this.patchAgentEntryIn(cfg, agentId, { enabled }))
  }

  async getAgentToolsConfig(agentId: string): Promise<AgentToolsConfig> {
    const cfg = await this.read()
    return cfg.agents?.list?.find(e => e.id === agentId)?.tools ?? {}
  }

  async setAgentToolsConfig(agentId: string, tools: AgentToolsConfig): Promise<void> {
    await this.mutate(cfg => this.patchAgentEntryIn(cfg, agentId, { tools }))
  }

  async getAgentSubagents(agentId: string): Promise<AgentSubagentPolicy> {
    const cfg = await this.read()
    return cfg.agents?.list?.find(e => e.id === agentId)?.subagents ?? {}
  }

  async setAgentSubagents(agentId: string, policy: AgentSubagentPolicy): Promise<void> {
    await this.mutate(cfg => {
      if (!cfg.agents.list) cfg.agents.list = []
      const entry = cfg.agents.list.find(e => e.id === agentId)
      const hasPolicy = !!policy.allowAgents?.length
      if (entry) {
        if (hasPolicy) entry.subagents = policy
        else delete entry.subagents
      } else if (hasPolicy) {
        cfg.agents.list.push({ id: agentId, subagents: policy })
      }
    })
  }
}
