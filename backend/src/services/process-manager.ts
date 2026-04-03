import { spawn, execSync } from 'child_process'

export interface ProcessStatus {
  state: 'running' | 'stopped' | 'error'
  pid?: number
  uptimeSeconds?: number
}

interface ProcessManagerOptions {
  openclawBin: string
  gatewayPort: number
}

export class ProcessManager {
  constructor(private readonly opts: ProcessManagerOptions) {}

  async getStatus(): Promise<ProcessStatus> {
    try {
      const out = execSync(
        `pgrep -f "openclaw gateway run" || pgrep -f "openclaw.*${this.opts.gatewayPort}"`,
        { encoding: 'buffer' }
      ).toString().trim()
      const pid = parseInt(out.split('\n')[0], 10)
      if (isNaN(pid)) return { state: 'stopped' }
      return { state: 'running', pid }
    } catch {
      return { state: 'stopped' }
    }
  }

  async start(): Promise<void> {
    const status = await this.getStatus()
    if (status.state === 'running') {
      throw new Error('OpenClaw is already running')
    }
    const child = spawn(this.opts.openclawBin, ['gateway', 'run'], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  }

  async stop(): Promise<void> {
    const status = await this.getStatus()
    if (status.state !== 'running' || !status.pid) {
      throw new Error('OpenClaw is not running')
    }
    execSync(`kill ${status.pid}`)
  }

  async restart(): Promise<void> {
    const status = await this.getStatus()
    if (status.state === 'running') {
      await this.stop()
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    await this.start()
  }
}
