import type { FastifyInstance } from 'fastify'
import { existsSync, statSync, accessSync, constants as fsConst } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { createConnection } from 'net'
import type { ProcessManager } from '../services/process-manager.js'
import type { SettingsManager } from '../services/settings-manager.js'

const execFileAsync = promisify(execFile)

export interface Probe {
  id: string
  category: string
  title: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  message: string
  details?: string
  fix?: { label: string; actionId: string }
}

function statusFromCondition(ok: boolean, warnMsg?: string): 'ok' | 'warn' | 'fail' {
  return ok ? 'ok' : warnMsg ? 'warn' : 'fail'
}

// Is the given TCP port currently open/listening on localhost?
function portInUse(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin], { timeout: 2000 })
    return stdout.trim() || null
  } catch { return null }
}

async function httpHead(url: string, timeoutMs = 3000): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
    clearTimeout(timer)
    return { ok: res.ok, status: res.status }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export async function envcheckRoutes(
  app: FastifyInstance,
  processManager: ProcessManager,
  settingsManager: SettingsManager,
  openclawHome: string,
  openclawBin: string,
  gatewayPort: number,
  portalPort: number,
) {
  app.get('/api/envcheck/probes', async () => {
    const probes: Probe[] = []

    // ── Runtime ───────────────────────────────────────────────
    probes.push({
      id: 'node-version',
      category: '运行时',
      title: 'Node.js 版本',
      ...(() => {
        const m = process.version.match(/^v(\d+)/)
        const major = m ? parseInt(m[1], 10) : 0
        if (major >= 22) return { status: 'ok' as const, message: `${process.version}（≥ 22 推荐）` }
        if (major >= 20) return { status: 'warn' as const, message: `${process.version}，建议升级到 ≥ 22` }
        return { status: 'fail' as const, message: `${process.version}，OpenClaw 需要 ≥ 20` }
      })(),
    })

    // ── Binaries ──────────────────────────────────────────────
    const openclawPath = existsSync(openclawBin) ? openclawBin : await which('openclaw')
    probes.push({
      id: 'openclaw-bin',
      category: '依赖',
      title: 'openclaw CLI',
      status: openclawPath ? 'ok' : 'fail',
      message: openclawPath ? openclawPath : '未找到，请 npm install -g openclaw',
    })
    if (openclawPath) {
      try {
        const { stdout } = await execFileAsync(openclawPath, ['--version'], { timeout: 3000 })
        const version = stdout.trim().split('\n')[0]
        probes.push({
          id: 'openclaw-version',
          category: '依赖',
          title: 'OpenClaw 版本',
          status: 'ok',
          message: version || '版本信息不可用',
        })
      } catch (e: any) {
        probes.push({
          id: 'openclaw-version',
          category: '依赖',
          title: 'OpenClaw 版本',
          status: 'warn',
          message: `无法执行 --version: ${e.message}`,
        })
      }
    }

    // ── Ports ─────────────────────────────────────────────────
    const gatewayUp = await portInUse(gatewayPort)
    probes.push({
      id: 'gateway-port',
      category: '网络',
      title: `Gateway 端口 ${gatewayPort}`,
      status: gatewayUp ? 'ok' : 'warn',
      message: gatewayUp ? '端口在监听（Gateway 运行中）' : '端口无监听（Gateway 可能未启动）',
      fix: gatewayUp ? undefined : { label: '启动 Gateway', actionId: 'start-gateway' },
    })
    // Portal self-check — if we responded, the port is obviously up
    probes.push({
      id: 'portal-port',
      category: '网络',
      title: `Portal 端口 ${portalPort}`,
      status: 'ok',
      message: '端口在监听（Portal 正在响应）',
    })

    // ── Directory permissions ─────────────────────────────────
    const paths = [
      { id: 'openclaw-home', title: '~/.openclaw 可写', path: openclawHome },
      { id: 'agents-dir',    title: 'agents/ 可写',    path: join(openclawHome, 'agents') },
      { id: 'logs-dir',      title: 'logs/ 可写',      path: join(openclawHome, 'logs') },
    ]
    for (const p of paths) {
      if (!existsSync(p.path)) {
        probes.push({
          id: p.id, category: '权限', title: p.title,
          status: 'warn', message: `目录不存在: ${p.path}`,
        })
        continue
      }
      try {
        accessSync(p.path, fsConst.R_OK | fsConst.W_OK)
        probes.push({ id: p.id, category: '权限', title: p.title, status: 'ok', message: `${p.path}` })
      } catch {
        probes.push({
          id: p.id, category: '权限', title: p.title,
          status: 'fail', message: `无读写权限: ${p.path}`,
        })
      }
    }

    // ── Disk space ────────────────────────────────────────────
    try {
      const { stdout } = await execFileAsync('df', ['-kP', openclawHome], { timeout: 3000 })
      const line = stdout.split('\n')[1] || ''
      const parts = line.split(/\s+/)
      if (parts.length >= 5) {
        const avail = parseInt(parts[3], 10)
        const usedPct = parseInt((parts[4] || '0').replace('%', ''), 10)
        const availGb = (avail / 1024 / 1024).toFixed(1)
        let status: Probe['status'] = 'ok'
        if (usedPct >= 95) status = 'fail'
        else if (usedPct >= 85) status = 'warn'
        probes.push({
          id: 'disk-space',
          category: '资源',
          title: '磁盘空间',
          status,
          message: `可用 ${availGb} GB · 占用 ${usedPct}%`,
        })
      }
    } catch { /* df not available (e.g. windows), skip */ }

    // ── Memory ────────────────────────────────────────────────
    try {
      const os = await import('os')
      const total = os.totalmem()
      const free = os.freemem()
      const usedPct = Math.round(((total - free) / total) * 100)
      let status: Probe['status'] = 'ok'
      if (usedPct >= 90) status = 'fail'
      else if (usedPct >= 80) status = 'warn'
      probes.push({
        id: 'memory-usage',
        category: '资源',
        title: '系统内存',
        status,
        message: `占用 ${usedPct}% · ${Math.round((total - free) / 1024 / 1024)} MB / ${Math.round(total / 1024 / 1024)} MB`,
      })
    } catch {}

    // ── Gateway HTTP health ───────────────────────────────────
    if (gatewayUp) {
      const res = await httpHead(`http://127.0.0.1:${gatewayPort}/`)
      probes.push({
        id: 'gateway-http',
        category: '网络',
        title: 'Gateway HTTP 响应',
        status: res.ok ? 'ok' : (res.status ? 'warn' : 'fail'),
        message: res.ok
          ? `HTTP ${res.status}`
          : res.error ? `无响应: ${res.error}` : `HTTP ${res.status}`,
      })
    }

    // ── NPM registry reachability ─────────────────────────────
    try {
      const s = await settingsManager.read()
      const registry = s.npmRegistry || 'https://registry.npmjs.org'
      const res = await httpHead(registry)
      probes.push({
        id: 'npm-registry',
        category: '网络',
        title: 'NPM Registry 可达',
        status: res.ok ? 'ok' : 'warn',
        message: res.ok ? `${registry} → ${res.status}` : `${registry} → ${res.error ?? res.status ?? '失败'}`,
        details: '影响插件安装',
      })
    } catch {}

    // ── HTTP proxy probe (if configured) ──────────────────────
    try {
      const s = await settingsManager.read()
      const proxy = s.httpProxy || s.httpsProxy
      if (proxy) {
        // Proxy is a URL like http://127.0.0.1:7897; probe its TCP port
        try {
          const u = new URL(proxy)
          const port = parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10)
          const reachable = await portInUse(port, 1000)
          probes.push({
            id: 'http-proxy',
            category: '网络',
            title: `HTTP 代理 ${u.host}`,
            status: reachable ? 'ok' : 'warn',
            message: reachable ? '代理端口在监听' : '代理端口无响应（可能未启动）',
          })
        } catch {}
      }
    } catch {}

    // ── Gateway process from portal's point of view ───────────
    try {
      const svc = await processManager.getStatus()
      const ok = svc.state === 'running'
      probes.push({
        id: 'gateway-process',
        category: '运行时',
        title: 'Gateway 进程',
        status: ok ? 'ok' : (svc.state === 'stopped' ? 'warn' : 'fail'),
        message: ok
          ? `PID ${svc.pid}，状态 ${svc.state}`
          : `状态 ${svc.state}，请在仪表盘启动`,
        fix: ok ? undefined : { label: '启动 Gateway', actionId: 'start-gateway' },
      })
    } catch {}

    // Sort by category, then status (fail first)
    const severity = { fail: 0, warn: 1, ok: 2, skip: 3 }
    probes.sort((a, b) => {
      const s = severity[a.status] - severity[b.status]
      if (s !== 0) return s
      return a.category.localeCompare(b.category)
    })

    const counts = {
      ok: probes.filter(p => p.status === 'ok').length,
      warn: probes.filter(p => p.status === 'warn').length,
      fail: probes.filter(p => p.status === 'fail').length,
      skip: probes.filter(p => p.status === 'skip').length,
      total: probes.length,
    }

    return { probes, counts, generatedAt: Date.now() }
  })

  // Known fix actions. Add more over time as we learn safe one-click remedies.
  app.post<{ Params: { actionId: string } }>('/api/envcheck/fix/:actionId', async (req, reply) => {
    const { actionId } = req.params
    if (actionId === 'start-gateway') {
      try {
        await processManager.start()
        return { ok: true, message: '已发送启动请求' }
      } catch (e: any) {
        return reply.status(500).send({ ok: false, error: e.message })
      }
    }
    return reply.status(400).send({ ok: false, error: `未知修复项: ${actionId}` })
  })
}
