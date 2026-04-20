import { spawn, execSync, execFileSync } from 'child_process'
import { createConnection } from 'net'
import { mkdirSync, openSync, constants } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { runCli } from './cli-runner.js'

export interface ProcessStatus {
  state: 'running' | 'stopped' | 'error' | 'restarting'
  pid?: number
  uptimeSeconds?: number
}

interface ProcessManagerOptions {
  openclawBin: string
  gatewayPort: number
  openclawHome?: string
}

const STATE_POLL_INTERVAL_MS = 250
const STATE_POLL_TIMEOUT_MS = 15000

const STATUS_CACHE_TTL_MS = 5000

export class ProcessManager {
  private _statusCache: ProcessStatus | null = null
  private _statusTs = 0
  private _inFlight: Promise<ProcessStatus> | null = null
  private _restarting = false

  constructor(private readonly opts: ProcessManagerOptions) {}

  get isRestarting(): boolean { return this._restarting }

  private get openclawHome(): string {
    return this.opts.openclawHome ?? join(homedir(), '.openclaw')
  }

  get logFile(): string {
    return join(this.openclawHome, 'logs', 'gateway.log')
  }

  private serviceManagerUnavailable(output: string): boolean {
    const text = output.toLowerCase()
    return text.includes('service not loaded') || text.includes('start with:')
  }

  private invalidateStatusCache() {
    this._statusCache = null
    this._statusTs = 0
    this._inFlight = null
  }

  private async waitForState(expected: ProcessStatus['state'], timeoutMs = STATE_POLL_TIMEOUT_MS): Promise<ProcessStatus> {
    const deadline = Date.now() + timeoutMs
    let status = await this.getStatus(true)
    while (Date.now() < deadline) {
      if (status.state === expected) return status
      await new Promise(resolve => setTimeout(resolve, STATE_POLL_INTERVAL_MS))
      status = await this.getStatus(true)
    }
    return status
  }

  async getStatus(bustCache = false): Promise<ProcessStatus> {
    const now = Date.now()
    if (!bustCache && this._statusCache && now - this._statusTs < STATUS_CACHE_TTL_MS) {
      return this._statusCache
    }
    if (!bustCache && this._inFlight) return this._inFlight

    const probe = this.probeStatus().then(status => {
      this._statusCache = status
      this._statusTs = Date.now()
      return status
    }).finally(() => {
      if (this._inFlight === probe) this._inFlight = null
    })

    if (!bustCache) this._inFlight = probe
    return probe
  }

  private async probeStatus(): Promise<ProcessStatus> {
    let status: ProcessStatus

    // Ground truth: gateway is only "running" if something is actually
    // accepting connections on its port. pgrep on cmdlines is unreliable —
    // transient CLI invocations (logs tail, status probes, etc.) can carry
    // the port/binary name in argv and cause false positives.
    const portAlive = await this.probeGatewayPort()

    if (!portAlive) {
      status = { state: this._restarting ? 'restarting' : 'stopped' }
      this._statusCache = status
      this._statusTs = Date.now()
      return status
    }

    // Port is accepting connections — attach pid best-effort via narrow
    // pgrep patterns. Missing pid is fine; state is already authoritative.
    status = { state: 'running', pid: this.findGatewayPid() }
    this._statusCache = status
    this._statusTs = Date.now()
    return status
  }

  private findGatewayPid(): number | undefined {
    for (const pattern of ['openclaw-gateway', 'openclaw gateway run']) {
      try {
        const out = execFileSync('pgrep', ['-f', pattern], {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()
        const pid = parseInt(out.split('\n')[0], 10)
        if (!isNaN(pid)) return pid
      } catch {
        // pgrep exits non-zero when nothing found — try next pattern
      }
    }
    return undefined
  }

  private probeGatewayPort(): Promise<boolean> {
    return new Promise(resolve => {
      const sock = createConnection({ host: '127.0.0.1', port: this.opts.gatewayPort })
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        sock.destroy()
        resolve(ok)
      }
      sock.setTimeout(500)
      sock.once('connect', () => finish(true))
      sock.once('error',   () => finish(false))
      sock.once('timeout', () => finish(false))
    })
  }

  async start(): Promise<void> {
    const status = await this.getStatus()
    if (status.state === 'running') throw new Error('OpenClaw is already running')

    // Try CLI start (daemon-aware)
    try {
      const output = await runCli(this.opts.openclawBin, ['gateway', 'start'], { timeout: 10000 })

      if (!this.serviceManagerUnavailable(output)) {
        const started = await this.waitForState('running')
        if (started.state === 'running') return
      }
    } catch {
      // CLI 'start' not available — fall back to detached spawn
    }

    const logsDir = join(this.openclawHome, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const logFd = openSync(this.logFile, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.opts.openclawBin,
        ['gateway', 'run', '--port', String(this.opts.gatewayPort)],
        { detached: true, stdio: ['ignore', logFd, logFd] }
      )
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })

    const started = await this.waitForState('running')
    if (started.state !== 'running') {
      throw new Error(`OpenClaw failed to start. Check logs: ${this.logFile}`)
    }
    this.invalidateStatusCache()
  }

  async stop(): Promise<void> {
    let status = await this.getStatus()
    if (status.state !== 'running') throw new Error('OpenClaw is not running')

    // Try CLI stop (graceful, daemon-aware)
    try {
      await runCli(this.opts.openclawBin, ['gateway', 'stop'], { timeout: 10000 })
      const stopped = await this.waitForState('stopped')
      if (stopped.state === 'stopped') return
      status = stopped
    } catch {
      // CLI stop not available — fall back to kill
    }

    // direct-run 模式下 CLI 可能只报告 running 而不给 pid，这里强制刷新一次兜底扫描。
    if (!status.pid) {
      status = await this.getStatus(true)
      if (status.state === 'stopped') return
    }

    if (status.pid) {
      execSync(`kill ${status.pid}`)
      const stopped = await this.waitForState('stopped')
      if (stopped.state === 'stopped') return
    }

    this.invalidateStatusCache()
    throw new Error(`OpenClaw failed to stop. Check logs: ${this.logFile}`)
  }

  async restart(): Promise<void> {
    this._restarting = true
    this.invalidateStatusCache()
    try {
      // Try CLI restart first
      try {
        await runCli(this.opts.openclawBin, ['gateway', 'restart'], { timeout: 15000 })
        const restarted = await this.waitForState('running')
        if (restarted.state === 'running') return
      } catch (err: any) {
        console.warn('[process-manager] CLI restart failed, falling back to stop+start:', err?.message ?? err)
      }

      // Manual stop + start
      const s = await this.getStatus(true)
      if (s.state === 'running' || s.state === 'restarting') {
        await this.stop()
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      await this.start()
      this.invalidateStatusCache()
    } finally {
      this._restarting = false
      this.invalidateStatusCache()
    }
  }
}
