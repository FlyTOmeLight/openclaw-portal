import { readFile, writeFile } from 'fs/promises'
import type { OpenclawConfig, ModelProvider } from '../types/openclaw.js'

export class ConfigManager {
  constructor(private readonly configPath: string) {}

  async read(): Promise<OpenclawConfig> {
    const raw = await readFile(this.configPath, 'utf-8')
    return JSON.parse(raw) as OpenclawConfig
  }

  async write(config: OpenclawConfig): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  async updateProvider(id: string, provider: ModelProvider): Promise<void> {
    const cfg = await this.read()
    cfg.models.providers[id] = provider
    await this.write(cfg)
  }

  async removeProvider(id: string): Promise<void> {
    const cfg = await this.read()
    delete cfg.models.providers[id]
    await this.write(cfg)
  }

  async setPrimaryModel(primary: string): Promise<void> {
    const cfg = await this.read()
    cfg.agents.defaults.model.primary = primary
    await this.write(cfg)
  }
}
