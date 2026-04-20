import type { FastifyInstance } from 'fastify'
import { readFile, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createConnection } from 'net'
import { join } from 'path'
import type { ChannelManager } from '../services/channel-manager.js'
import type { AuthService } from '../services/auth.js'

const execFileAsync = promisify(execFile)

type StatusLevel = 'ok' | 'warn' | 'fail'

interface ConnectionItem {
  key: string
  label: string
  status: StatusLevel
  detail: string
}

interface RiskItem {
  key: string
  label: string
  severity: 'low' | 'medium' | 'high'
  ok: boolean
  hint?: string
}

interface OperatorOverview {
  connection: {
    items: ConnectionItem[]
    onlineCount: number
    totalCount: number
    rating: StatusLevel
  }
  version: {
    openclawCurrent: string | null
    openclawLatest: string | null
    lastCheckedAt: string | null
    updateAvailable: boolean
    portalVersion: string
  }
  risk: {
    level: 'low' | 'medium' | 'high'
    items: RiskItem[]
  }
  generatedAt: number
}

function portInUse(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ port, host })
    const done = (v: boolean) => { sock.destroy(); resolve(v) }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(timeoutMs, () => done(false))
  })
}

function parseSemver(v: string | null): number[] | null {
  if (!v) return null
  const m = v.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] ?? '0', 10)]
}

function compareVersion(a: string | null, b: string | null): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

async function getOpenclawVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 3000 })
    const line = stdout.trim().split('\n')[0]
    const m = line.match(/(\d+\.\d+(?:\.\d+)?)/)
    return m ? m[1] : line.trim() || null
  } catch {
    return null
  }
}

async function readUpdateCheck(openclawHome: string): Promise<{ latest: string | null; lastCheckedAt: string | null }> {
  const p = join(openclawHome, 'update-check.json')
  if (!existsSync(p)) return { latest: null, lastCheckedAt: null }
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw)
    return {
      latest: j.lastAvailableVersion ?? null,
      lastCheckedAt: j.lastCheckedAt ?? null,
    }
  } catch {
    return { latest: null, lastCheckedAt: null }
  }
}

function readPortalVersion(): string {
  try {
    // Portal backend package.json sits next to dist/
    const here = new URL('../../package.json', import.meta.url)
    const j = JSON.parse(readFileSync(here, 'utf-8'))
    return j.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function operatorOverviewRoutes(
  app: FastifyInstance,
  channelManager: ChannelManager,
  authService: AuthService,
  openclawBin: string,
  openclawHome: string,
  gatewayPort: number,
  portalPort: number,
) {
  app.get('/api/system/operator-overview', async (): Promise<OperatorOverview> => {
    // ── Connection items ─────────────────────────────────────
    const items: ConnectionItem[] = []

    // Portal — if we responded, port is up
    items.push({
      key: 'portal',
      label: 'Portal 服务',
      status: 'ok',
      detail: `端口 ${portalPort} 正在响应`,
    })

    // Gateway
    const gatewayUp = await portInUse(gatewayPort)
    items.push({
      key: 'gateway',
      label: 'OpenClaw Gateway',
      status: gatewayUp ? 'ok' : 'fail',
      detail: gatewayUp ? `端口 ${gatewayPort} 监听中` : `端口 ${gatewayPort} 无响应 — Gateway 未启动`,
    })

    // Nginx reverse proxy (port 8080)
    const nginxUp = await portInUse(8080)
    items.push({
      key: 'nginx',
      label: 'Nginx 反向代理',
      status: nginxUp ? 'ok' : 'warn',
      detail: nginxUp ? '端口 8080 监听中' : '未检测到 8080 监听（非内网部署可忽略）',
    })

    // Model providers (from openclaw.json -> models.providers)
    try {
      const cfgPath = join(openclawHome, 'openclaw.json')
      let providerCount = 0
      let modelCount = 0
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        const providers = cfg?.models?.providers ?? {}
        providerCount = Object.keys(providers).length
        for (const p of Object.values(providers) as any[]) {
          modelCount += Array.isArray(p?.models) ? p.models.length : 0
        }
      }
      // Also count legacy channel bindings if present
      const legacyChannels = await channelManager.listChannels().catch(() => ({}))
      const legacyCount = Object.keys(legacyChannels).length
      if (providerCount === 0 && legacyCount === 0) {
        items.push({ key: 'providers', label: '模型 Provider', status: 'warn', detail: '未配置任何 provider' })
      } else {
        const detail = providerCount > 0
          ? `${providerCount} 个 provider，${modelCount} 个模型`
          : `${legacyCount} 条渠道绑定`
        items.push({ key: 'providers', label: '模型 Provider', status: 'ok', detail })
      }
    } catch {
      items.push({ key: 'providers', label: '模型 Provider', status: 'warn', detail: '无法读取模型配置' })
    }

    const onlineCount = items.filter(i => i.status === 'ok').length
    const totalCount = items.length
    const hasFail = items.some(i => i.status === 'fail')
    const hasWarn = items.some(i => i.status === 'warn')
    const rating: StatusLevel = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok'

    // ── Version info ────────────────────────────────────────
    const [openclawCurrent, updateCheck] = await Promise.all([
      getOpenclawVersion(openclawBin),
      readUpdateCheck(openclawHome),
    ])
    const updateAvailable = compareVersion(openclawCurrent, updateCheck.latest) < 0

    // ── Risk assessment ─────────────────────────────────────
    const riskItems: RiskItem[] = []

    const authEnabled = authService.isEnabled()
    if (!authEnabled) {
      riskItems.push({
        key: 'login-auth',
        label: '登录保护',
        severity: 'high',
        ok: false,
        hint: '未启用 — 仅依赖 loopback + nginx 信任边界；跨机访问时建议开启密码',
      })
    }

    // Gateway auth mode — inspect openclaw.json. token / trusted-proxy / password
    // are all valid trust anchors (combined with loopback binding). Only raise a
    // risk item when the mode is missing/none OR token mode has a weak token.
    let authMode = ''
    let tokenLen = 0
    try {
      const cfgPath = join(openclawHome, 'openclaw.json')
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
        authMode = String(cfg?.gateway?.auth?.mode ?? '')
        const tok = cfg?.gateway?.auth?.token
        tokenLen = typeof tok === 'string' ? tok.length : 0
      }
    } catch {}
    const validMode = authMode === 'trusted-proxy' || authMode === 'password'
      || (authMode === 'token' && tokenLen >= 16)
    if (!validMode) {
      riskItems.push({
        key: 'trust-boundary',
        label: 'Gateway 认证',
        severity: 'high',
        ok: false,
        hint: authMode === 'token'
          ? 'token 模式但 token 过短或缺失，建议在 openclaw.json 重新生成'
          : `Gateway 认证未配置（mode=${authMode || '未设置'}）— 仅 loopback 边界不足以防护`,
      })
    }

    // Disk free space — only surface when usage is actually concerning
    try {
      const { stdout } = await execFileAsync('df', ['-kP', openclawHome], { timeout: 2000 })
      const parts = (stdout.split('\n')[1] || '').split(/\s+/)
      const usedPct = parseInt((parts[4] || '0').replace('%', ''), 10)
      if (usedPct >= 80) {
        riskItems.push({
          key: 'disk-space',
          label: '磁盘空间',
          severity: usedPct >= 90 ? 'high' : 'medium',
          ok: false,
          hint: `OpenClaw Home 所在磁盘已用 ${usedPct}%`,
        })
      }
    } catch {}

    // Update available flag as low-severity risk
    if (updateAvailable) {
      riskItems.push({
        key: 'update',
        label: 'OpenClaw 版本',
        severity: 'medium',
        ok: false,
        hint: `当前 ${openclawCurrent}，最新 ${updateCheck.latest}`,
      })
    }

    const highCount = riskItems.filter(r => !r.ok && r.severity === 'high').length
    const medCount = riskItems.filter(r => !r.ok && r.severity === 'medium').length
    const riskLevel: 'low' | 'medium' | 'high' = highCount > 0 ? 'high' : medCount > 0 ? 'medium' : 'low'

    // Portal own version
    const portalVersion = readPortalVersion()

    // Touch stat to keep tsc happy about the import
    void stat

    return {
      connection: { items, onlineCount, totalCount, rating },
      version: {
        openclawCurrent,
        openclawLatest: updateCheck.latest,
        lastCheckedAt: updateCheck.lastCheckedAt,
        updateAvailable,
        portalVersion,
      },
      risk: { level: riskLevel, items: riskItems },
      generatedAt: Date.now(),
    }
  })
}
