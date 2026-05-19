import { spawn, execFileSync } from 'child_process'
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

// systemd unit installed by the Kylin offline installer. When present, the
// portal controls the gateway through `systemctl` (matching uid) instead of
// signalling the pid directly — the latter fails with EPERM whenever the
// gateway runs under a different user than the portal.
const GATEWAY_UNIT = 'openclaw-gateway'

export class ProcessManager {
  private _statusCache: ProcessStatus | null = null
  private _statusTs = 0
  private _inFlight: Promise<ProcessStatus> | null = null
  private _restarting = false
  private _systemdChecked = false
  private _systemdUnit = false

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
    // 1) Port-anchored lookup — most reliable, independent of cmdline shape.
    const port = this.opts.gatewayPort
    try {
      const out = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()
      const pid = parseInt(out.split('\n')[0], 10)
      if (!isNaN(pid)) return pid
    } catch { /* lsof missing or no match */ }
    try {
      const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], {
        encoding: 'utf-8',
        timeout: 3000,
      })
      const m = out.match(/pid=(\d+)/)
      if (m) {
        const pid = parseInt(m[1], 10)
        if (!isNaN(pid)) return pid
      }
    } catch { /* ss missing or no listener */ }
    // 2) Cmdline fallback — covers the legacy nohup launcher.
    for (const pattern of ['openclaw-gateway', 'gateway run --port', 'openclaw gateway run']) {
      try {
        const out = execFileSync('pgrep', ['-f', pattern], {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()
        const pid = parseInt(out.split('\n')[0], 10)
        if (!isNaN(pid)) return pid
      } catch { /* pgrep no match */ }
    }
    return undefined
  }

  /** True when the gateway is managed by a systemd unit. Result is cached. */
  private hasSystemdUnit(): boolean {
    if (this._systemdChecked) return this._systemdUnit
    this._systemdChecked = true
    try {
      // `systemctl cat` is a read-only query — no sudo needed.
      execFileSync('systemctl', ['cat', GATEWAY_UNIT], { stdio: 'ignore', timeout: 3000 })
      this._systemdUnit = true
    } catch {
      this._systemdUnit = false
    }
    return this._systemdUnit
  }

  /** Control the gateway unit via sudo. Relies on the NOPASSWD sudoers grant
   *  (/etc/sudoers.d/openclaw-gateway) the offline installer drops. */
  private runSystemctl(verb: 'start' | 'stop' | 'restart'): void {
    try {
      execFileSync('sudo', ['-n', 'systemctl', verb, GATEWAY_UNIT], {
        timeout: 20000,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
    } catch (err: any) {
      const detail = (err?.stderr || err?.message || '').toString().trim().slice(0, 300)
      throw new Error(
        `systemctl ${verb} ${GATEWAY_UNIT} 失败: ${detail || '未知错误'}` +
        `（确认 portal 用户已获 /etc/sudoers.d/openclaw-gateway 授权）`,
      )
    }
  }

  private signalPid(pid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean {
    try {
      process.kill(pid, signal)
      return true
    } catch (err: any) {
      if (err?.code === 'ESRCH') return true
      if (err?.code === 'EPERM') {
        // Different uid — try sudo -n only if explicitly opted in.
        return false
      }
      return false
    }
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

    // systemd-managed gateway: hand off to the unit so uid/ownership stays
    // consistent and `Restart=on-failure` keeps applying.
    if (this.hasSystemdUnit()) {
      this.runSystemctl('start')
      const started = await this.waitForState('running')
      if (started.state !== 'running') {
        throw new Error(`OpenClaw failed to start. Check: journalctl -u ${GATEWAY_UNIT} -n 50`)
      }
      this.invalidateStatusCache()
      return
    }

    const errors: string[] = []

    // Try CLI start (daemon-aware) — best-effort, may not be wired on Kylin.
    try {
      const output = await runCli(this.opts.openclawBin, ['gateway', 'start'], { timeout: 10000 })
      if (!this.serviceManagerUnavailable(output)) {
        const started = await this.waitForState('running')
        if (started.state === 'running') { this.invalidateStatusCache(); return }
      }
    } catch (err: any) {
      const msg = (err?.stderr || err?.message || '').toString().trim()
      if (msg) errors.push(`cli start: ${msg.slice(0, 300)}`)
    }

    // Fallback: detached spawn.
    const logsDir = join(this.openclawHome, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const logFd = openSync(this.logFile, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.opts.openclawBin,
        ['gateway', 'run', '--port', String(this.opts.gatewayPort), '--force'],
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
      const detail = errors.length ? ` [${errors.join(' | ')}]` : ''
      throw new Error(`OpenClaw failed to start.${detail} Check logs: ${this.logFile}`)
    }
    this.invalidateStatusCache()
  }

  async stop(): Promise<void> {
    let status = await this.getStatus()
    if (status.state !== 'running') throw new Error('OpenClaw is not running')

    // systemd-managed gateway: a clean `systemctl stop` will not be undone by
    // `Restart=on-failure` (only failures trigger respawn).
    if (this.hasSystemdUnit()) {
      this.runSystemctl('stop')
      const stopped = await this.waitForState('stopped', 10000)
      if (stopped.state !== 'stopped') {
        throw new Error(`OpenClaw failed to stop. Check: journalctl -u ${GATEWAY_UNIT} -n 50`)
      }
      this.invalidateStatusCache()
      return
    }

    const errors: string[] = []

    // Try CLI stop (graceful, daemon-aware).
    try {
      await runCli(this.opts.openclawBin, ['gateway', 'stop'], { timeout: 10000 })
      const stopped = await this.waitForState('stopped', 5000)
      if (stopped.state === 'stopped') { this.invalidateStatusCache(); return }
    } catch (err: any) {
      const msg = (err?.stderr || err?.message || '').toString().trim()
      if (msg) errors.push(`cli stop: ${msg.slice(0, 300)}`)
    }

    // Force a fresh PID lookup — port-anchored fallback handles the case where
    // pgrep cmdline patterns missed the process.
    if (!status.pid) status = await this.getStatus(true)

    if (status.pid) {
      const termed = this.signalPid(status.pid, 'SIGTERM')
      if (!termed) errors.push(`SIGTERM ${status.pid}: EPERM (uid mismatch?)`)
      const stopped = await this.waitForState('stopped', 5000)
      if (stopped.state === 'stopped') { this.invalidateStatusCache(); return }

      // Escalate to SIGKILL.
      const killed = this.signalPid(status.pid, 'SIGKILL')
      if (!killed) errors.push(`SIGKILL ${status.pid}: EPERM`)
      const dead = await this.waitForState('stopped', 3000)
      if (dead.state === 'stopped') { this.invalidateStatusCache(); return }
    } else {
      errors.push('no pid found via lsof/ss/pgrep — gateway likely owned by another uid')
    }

    this.invalidateStatusCache()
    const detail = errors.length ? ` [${errors.join(' | ')}]` : ''
    throw new Error(`OpenClaw failed to stop.${detail} Check logs: ${this.logFile}`)
  }

  async restart(): Promise<void> {
    this._restarting = true
    this.invalidateStatusCache()
    try {
      // systemd-managed gateway: a single `systemctl restart` is atomic.
      if (this.hasSystemdUnit()) {
        this.runSystemctl('restart')
        const restarted = await this.waitForState('running')
        if (restarted.state !== 'running') {
          throw new Error(`OpenClaw failed to restart. Check: journalctl -u ${GATEWAY_UNIT} -n 50`)
        }
        this.invalidateStatusCache()
        return
      }

      // Try CLI restart first — gateway uses SIGUSR1 sentinel internally.
      try {
        await runCli(this.opts.openclawBin, ['gateway', 'restart'], { timeout: 15000 })
        const restarted = await this.waitForState('running')
        if (restarted.state === 'running') return
      } catch (err: any) {
        console.warn('[process-manager] CLI restart failed, falling back to stop+start:', err?.stderr ?? err?.message ?? err)
      }

      // Manual stop + start.
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
