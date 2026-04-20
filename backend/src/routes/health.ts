import type { FastifyInstance } from 'fastify'
import { existsSync, readFileSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { execFileSync } from 'child_process'
import { join } from 'path'
import type { AuditLog } from '../services/audit-log.js'
import type { ProcessManager } from '../services/process-manager.js'
import type { ConfigManager } from '../services/config-manager.js'

export interface HealthDimension {
  key: string
  label: string
  score: number
  maxScore: number
  status: 'ok' | 'warn' | 'fail'
  message: string
  link?: string
}

export interface HealthScore {
  score: number
  maxScore: number
  rating: 'ok' | 'warn' | 'fail'
  dimensions: HealthDimension[]
  generatedAt: number
}

// ANSI-aware log error detection (same as notifications.ts)
const ANSI_RE = /\x1b\[[0-9;]*m/g
function isErrorLine(raw: string): boolean {
  try {
    const obj = JSON.parse(raw)
    return obj?.level >= 50
  } catch {}
  return /\x1b\[31m/.test(raw)
}
function parseLogTs(raw: string): number {
  try {
    const obj = JSON.parse(raw)
    if (typeof obj.time === 'number') return obj.time
  } catch {}
  const clean = raw.replace(ANSI_RE, '')
  const m = clean.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+\-]\d{2}:\d{2})/)
  return m ? new Date(m[1]).getTime() : 0
}
function findLogFile(pm: ProcessManager, status: { pid?: number }): string {
  if (existsSync(pm.logFile)) return pm.logFile
  if (!status.pid) return pm.logFile
  try {
    const out = execFileSync('lsof', ['-p', String(status.pid), '-F', 'n'], { encoding: 'utf-8' })
    const files = out.split('\n').filter(l => l.startsWith('n/')).map(l => l.slice(1))
    const found = files.find(f => f.endsWith('.log') && !f.includes('node_modules'))
    if (found && existsSync(found)) return found
  } catch {}
  return pm.logFile
}

export async function healthRoutes(
  app: FastifyInstance,
  processManager: ProcessManager,
  configManager: ConfigManager,
  audit: AuditLog,
  openclawHome: string,
) {
  app.get('/api/system/health-score', async (): Promise<HealthScore> => {
    const now = Date.now()
    const dimensions: HealthDimension[] = []

    // 1. Gateway state (30 pts)
    try {
      const svc = await processManager.getStatus()
      let score = 0
      let status: HealthDimension['status'] = 'fail'
      let message = ''
      if (svc.state === 'running') {
        score = 30; status = 'ok'; message = `PID ${svc.pid}，运行正常`
      } else if (svc.state === 'restarting') {
        score = 10; status = 'warn'; message = '正在重启'
      } else if (svc.state === 'stopped') {
        score = 0; status = 'fail'; message = '进程未运行，请在仪表盘启动'
      } else {
        score = 0; status = 'fail'; message = '进程异常'
      }
      dimensions.push({
        key: 'gateway', label: 'Gateway 状态',
        score, maxScore: 30, status, message, link: '/',
      })
    } catch (e: any) {
      dimensions.push({
        key: 'gateway', label: 'Gateway 状态',
        score: 0, maxScore: 30, status: 'fail',
        message: `无法读取状态: ${e.message}`,
      })
    }

    // 2. Error rate in the last 1 hour (20 pts)
    try {
      const svcStatus = await processManager.getStatus()
      const logFile = findLogFile(processManager, svcStatus)
      let errorCount = 0
      if (existsSync(logFile)) {
        const content = readFileSync(logFile, 'utf-8')
        const cutoff = now - 3600_000
        const lines = content.split('\n').filter(l => l.trim()).slice(-500)
        for (const line of lines) {
          if (!isErrorLine(line)) continue
          const ts = parseLogTs(line)
          if (ts > 0 && ts < cutoff) continue
          errorCount += 1
        }
      }
      let score = 20, status: HealthDimension['status'] = 'ok', message = `近 1 小时 0 条错误`
      if (errorCount > 5) { score = 0; status = 'fail'; message = `近 1 小时 ${errorCount} 条错误` }
      else if (errorCount > 0) { score = 10; status = 'warn'; message = `近 1 小时 ${errorCount} 条错误` }
      dimensions.push({
        key: 'errors', label: '运行错误',
        score, maxScore: 20, status, message, link: '/diagnose/logs',
      })
    } catch (e: any) {
      dimensions.push({
        key: 'errors', label: '运行错误',
        score: 10, maxScore: 20, status: 'warn',
        message: `无法读取日志: ${e.message}`,
      })
    }

    // 3. Memory usage (15 pts)
    try {
      const os = await import('os')
      const total = os.totalmem()
      const free = os.freemem()
      const usedPct = Math.round(((total - free) / total) * 100)
      let score = 15, status: HealthDimension['status'] = 'ok'
      let message = `${usedPct}% 占用 · ${Math.round((total - free) / 1024 / 1024)} MB / ${Math.round(total / 1024 / 1024)} MB`
      if (usedPct >= 90) { score = 0; status = 'fail' }
      else if (usedPct >= 80) { score = 8; status = 'warn' }
      dimensions.push({
        key: 'memory', label: '内存占用',
        score, maxScore: 15, status, message, link: '/monitor',
      })
    } catch (e: any) {
      dimensions.push({
        key: 'memory', label: '内存占用',
        score: 8, maxScore: 15, status: 'warn',
        message: '无法读取',
      })
    }

    // 4. Audit failure rate in last 24h (15 pts)
    try {
      const cutoff = now - 24 * 3600_000
      const { entries } = await audit.list({ since: cutoff, limit: 1000 })
      const total = entries.length
      const failures = entries.filter(e => e.result === 'failure').length
      const rate = total === 0 ? 0 : Math.round((failures / total) * 100)
      let score = 15, status: HealthDimension['status'] = 'ok'
      let message = total === 0 ? '24h 无敏感操作' : `${failures} 失败 / ${total} 总操作 · ${rate}%`
      if (total > 0 && rate >= 20) { score = 0; status = 'fail' }
      else if (total > 0 && rate >= 5) { score = 8; status = 'warn' }
      dimensions.push({
        key: 'audit', label: '审计通过率',
        score, maxScore: 15, status, message, link: '/insights/audit',
      })
    } catch {
      dimensions.push({
        key: 'audit', label: '审计通过率',
        score: 15, maxScore: 15, status: 'ok',
        message: '暂无审计数据',
      })
    }

    // 5. Provider key configured (10 pts)
    try {
      const cfg = await configManager.read()
      const providers = cfg?.models?.providers ?? {}
      const names = Object.keys(providers)
      if (names.length === 0) {
        dimensions.push({
          key: 'keys', label: 'Provider 密钥',
          score: 0, maxScore: 10, status: 'fail',
          message: '未配置任何 provider', link: '/models',
        })
      } else {
        const missing: string[] = []
        for (const [name, p] of Object.entries(providers) as [string, any][]) {
          const hasKey = p?.apiKey || p?.envKey || p?.key
          // Some providers (local, ollama) may legitimately not need a key
          const keylessOk = /^(local|ollama)/i.test(name) || p?.keyless === true
          if (!hasKey && !keylessOk) missing.push(name)
        }
        if (missing.length === 0) {
          dimensions.push({
            key: 'keys', label: 'Provider 密钥',
            score: 10, maxScore: 10, status: 'ok',
            message: `${names.length} 个 provider 均已配置`, link: '/models',
          })
        } else {
          dimensions.push({
            key: 'keys', label: 'Provider 密钥',
            score: 5, maxScore: 10, status: 'warn',
            message: `${missing.length} 个 provider 缺少密钥: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
            link: '/models',
          })
        }
      }
    } catch (e: any) {
      dimensions.push({
        key: 'keys', label: 'Provider 密钥',
        score: 5, maxScore: 10, status: 'warn',
        message: `读取失败: ${e.message}`,
      })
    }

    // 6. Session activity in last 7d (10 pts)
    try {
      const agentsRoot = join(openclawHome, 'agents')
      let hasRecentActivity = false
      let lastActive = 0
      if (existsSync(agentsRoot)) {
        const agents = await readdir(agentsRoot, { withFileTypes: true })
        const cutoff = now - 7 * 86400_000
        for (const a of agents) {
          if (!a.isDirectory()) continue
          const sessionsDir = join(agentsRoot, a.name, 'sessions')
          if (!existsSync(sessionsDir)) continue
          const files = await readdir(sessionsDir, { withFileTypes: true })
          for (const f of files) {
            if (!f.isFile() || !f.name.endsWith('.jsonl')) continue
            try {
              const s = await stat(join(sessionsDir, f.name))
              if (s.mtimeMs > lastActive) lastActive = s.mtimeMs
              if (s.mtimeMs >= cutoff) { hasRecentActivity = true }
            } catch {}
          }
          if (hasRecentActivity) break
        }
      }
      let score = 0, status: HealthDimension['status'] = 'fail', message = '7 天内无会话活动'
      if (hasRecentActivity) {
        score = 10; status = 'ok'
        const hoursAgo = Math.round((now - lastActive) / 3600_000)
        message = hoursAgo < 1 ? '最近 1 小时内有活动' : `${hoursAgo} 小时前有活动`
      } else if (lastActive > 0) {
        const daysAgo = Math.round((now - lastActive) / 86400_000)
        score = 3; status = 'warn'
        message = `最近活动 ${daysAgo} 天前`
      }
      dimensions.push({
        key: 'activity', label: '会话活跃度',
        score, maxScore: 10, status, message, link: '/history/sessions',
      })
    } catch {
      dimensions.push({
        key: 'activity', label: '会话活跃度',
        score: 5, maxScore: 10, status: 'warn',
        message: '无法读取',
      })
    }

    const totalScore = dimensions.reduce((s, d) => s + d.score, 0)
    const maxScore = dimensions.reduce((s, d) => s + d.maxScore, 0)
    const rating: 'ok' | 'warn' | 'fail' =
      totalScore >= Math.round(maxScore * 0.8) ? 'ok'
      : totalScore >= Math.round(maxScore * 0.6) ? 'warn'
      : 'fail'

    return { score: totalScore, maxScore, rating, dimensions, generatedAt: now }
  })
}
