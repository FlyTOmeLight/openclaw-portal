import { readFile, writeFile } from 'fs/promises'
import { spawnSync } from 'child_process'
import type { OpenclawConfig, ChannelConfig, ChannelMap } from '../types/openclaw.js'

export class ChannelManager {
  constructor(
    private readonly configPath: string,
    private readonly openclawBin: string,
  ) {}

  private async readConfig(): Promise<OpenclawConfig> {
    const raw = await readFile(this.configPath, 'utf-8')
    return JSON.parse(raw) as OpenclawConfig
  }

  private async writeConfig(cfg: OpenclawConfig): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2), 'utf-8')
  }

  async listChannels(): Promise<ChannelMap> {
    const cfg = await this.readConfig()
    return cfg.channels ?? {}
  }

  async upsertChannel(name: string, config: ChannelConfig): Promise<void> {
    const cfg = await this.readConfig()
    cfg.channels = { ...(cfg.channels ?? {}), [name]: config }
    await this.writeConfig(cfg)
  }

  async removeChannel(name: string): Promise<void> {
    const cfg = await this.readConfig()
    if (cfg.channels) {
      delete cfg.channels[name]
      await this.writeConfig(cfg)
    }
  }

  async getStatus(): Promise<string> {
    const result = spawnSync(this.openclawBin, ['channels', 'status'], {
      stdio: 'pipe',
    })
    const stdout = result.stdout instanceof Buffer ? result.stdout.toString() : (result.stdout as string)
    const stderr = result.stderr instanceof Buffer ? result.stderr.toString() : (result.stderr as string)
    return stdout || stderr || ''
  }
}
