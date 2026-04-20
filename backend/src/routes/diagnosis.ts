import type { FastifyInstance } from 'fastify'
import type { DiagnosisService } from '../services/diagnosis.js'
import type { ProcessManager } from '../services/process-manager.js'
import type { ConfigManager } from '../services/config-manager.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { config } from '../config.js'
import { getLog, clearLog } from '../services/request-log.js'

const execFileAsync = promisify(execFile)

async function tryExec(bin: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 5000, encoding: 'utf-8' })
    return stdout.trim()
  } catch {
    return ''
  }
}

export async function diagnosisRoutes(
  app: FastifyInstance,
  diagnosis: DiagnosisService,
  processManager: ProcessManager,
  configManager: ConfigManager,
) {
  // Run all checks
  app.get('/api/diagnosis', async () => {
    return diagnosis.runAll()
  })

  // Run a single named check
  app.get<{ Params: { check: string } }>('/api/diagnosis/:check', async (req, reply) => {
    const { check } = req.params
    const checkMap: Record<string, () => Promise<any>> = {
      config: () => diagnosis.checkConfig(),
      gateway: () => diagnosis.checkGateway(),
      models: () => diagnosis.checkModels(),
      binaries: () => diagnosis.checkBinaries(),
      disk: () => diagnosis.checkDisk(),
      ssl: () => diagnosis.checkSSL(),
    }
    const fn = checkMap[check]
    if (!fn) return reply.status(404).send({ error: `Unknown check: ${check}` })
    return fn()
  })

  // Attempt auto-repair
  app.post<{ Params: { check: string } }>('/api/diagnosis/repair/:check', async (req, reply) => {
    const { check } = req.params

    if (check === 'gateway') {
      try {
        await processManager.start()
        // Re-run gateway check after a short wait
        await new Promise(r => setTimeout(r, 2000))
        const result = await diagnosis.checkGateway()
        return { ok: result.status === 'ok', result }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      }
    }

    return reply.status(400).send({ error: `No repair available for check: ${check}` })
  })

  // GET /api/diagnosis/service-info — detailed service/config/version info
  app.get('/api/diagnosis/service-info', async () => {
    const [openclawVersion, agentBrowserVersion, serviceStatus] = await Promise.all([
      tryExec(config.openclawBin, ['--version']),
      tryExec('agent-browser', ['--version']),
      processManager.getStatus(),
    ])
    const nodeVersion = process.version

    let configSummary: Record<string, string> = {}
    try {
      const cfg = await configManager.read()
      configSummary = {
        gatewayPort: String(cfg.gateway?.port ?? config.gatewayPort),
        authMode:    cfg.gateway?.auth?.mode ?? 'unknown',
        primaryModel: cfg.agents?.defaults?.model?.primary ?? '(未设置)',
        providerCount: String(Object.keys(cfg.models?.providers ?? {}).length),
      }
    } catch {
      configSummary = { error: '配置读取失败' }
    }

    return {
      service: {
        state:   serviceStatus.state,
        pid:     serviceStatus.pid ?? null,
        binary:  config.openclawBin,
      },
      versions: {
        openclaw:    openclawVersion || '(未知)',
        node:        nodeVersion     || '(未知)',
        agentBrowser: agentBrowserVersion || '(未安装)',
      },
      config: configSummary,
      gatewayPort: config.gatewayPort,
      portalPort:  config.portalPort,
      openclawHome: config.openclawHome,
    }
  })

  // GET /api/diagnosis/network-log — recent portal API requests
  app.get('/api/diagnosis/network-log', async () => {
    return { entries: getLog() }
  })

  // DELETE /api/diagnosis/network-log — clear log
  app.delete('/api/diagnosis/network-log', async () => {
    clearLog()
    return { ok: true }
  })

  // Run openclaw doctor (read-only diagnosis)
  app.get('/api/diagnosis/doctor', async (req, reply) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        config.openclawBin, ['doctor'], { timeout: 30_000, encoding: 'utf-8' }
      )
      return { output: (stdout + stderr).trim() }
    } catch (e: any) {
      // doctor may exit non-zero when issues found — treat as normal output
      const output = ((e.stdout ?? '') + (e.stderr ?? '')).trim()
      if (output) return { output }
      return reply.status(500).send({ error: e.message })
    }
  })

  // Run openclaw doctor --fix (auto repair)
  app.post('/api/diagnosis/doctor/fix', async (req, reply) => {
    try {
      const { stdout, stderr } = await execFileAsync(
        config.openclawBin, ['doctor', '--fix'], { timeout: 60_000, encoding: 'utf-8' }
      )
      return { output: (stdout + stderr).trim() }
    } catch (e: any) {
      const output = ((e.stdout ?? '') + (e.stderr ?? '')).trim()
      if (output) return { output }
      return reply.status(500).send({ error: e.message })
    }
  })
}
