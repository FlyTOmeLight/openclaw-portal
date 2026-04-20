import type { FastifyInstance } from 'fastify'
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import type { AuditLog } from '../services/audit-log.js'
import type { ProcessManager } from '../services/process-manager.js'

export interface NotificationItem {
  id: string
  type: 'audit-failure' | 'log-error' | 'service-error' | 'memory-warn' | 'cron-failure'
  title: string
  message: string
  severity: 'warn' | 'error'
  ts: number
  link?: string
}

// ANSI-aware log level detection (copied from logs.ts — simple heuristic)
const ANSI_RE = /\x1b\[[0-9;]*m/g
function isErrorLine(raw: string): boolean {
  // JSON (pino)
  try {
    const obj = JSON.parse(raw)
    return obj?.level >= 50  // error=50, fatal=60
  } catch {}
  // ANSI red (code 31) in OpenClaw plain-text logs
  return /\x1b\[31m/.test(raw)
}

function parseLogTimestamp(raw: string): number {
  try {
    const obj = JSON.parse(raw)
    if (typeof obj.time === 'number') return obj.time
  } catch {}
  const clean = raw.replace(ANSI_RE, '')
  const m = clean.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+\-]\d{2}:\d{2})/)
  return m ? new Date(m[1]).getTime() : 0
}

function extractMessage(raw: string, maxLen = 200): string {
  try {
    const obj = JSON.parse(raw)
    const msg = obj?.msg ?? obj?.message ?? raw
    return String(msg).slice(0, maxLen)
  } catch {}
  const clean = raw.replace(ANSI_RE, '').trim()
  // Strip leading timestamp/module prefix
  const m = clean.match(/^[^\s]+\s+\[[\w-]+\]\s+(.+)$/)
  return (m ? m[1] : clean).slice(0, maxLen)
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

/**
 * State for hysteresis-style alerts. Without this, continuous high memory
 * (or a persistently stopped gateway) would emit the same notification on
 * every 30-second poll — pure noise.
 *
 * Rules:
 *   - memory: fires once when usage crosses from < 80% to ≥ 90%. After that
 *     it stays silent until usage drops below 80%, then may fire again.
 *   - service: fires once on state transition (running → stopped/error).
 *     Stays silent while the state is unchanged.
 */
interface AlertState {
  memoryFiredAt: number | null
  memoryLastPct: number
  serviceFiredState: string | null
}
const alertState: AlertState = {
  memoryFiredAt: null,
  memoryLastPct: 0,
  serviceFiredState: null,
}

export async function notificationsRoutes(
  app: FastifyInstance,
  audit: AuditLog,
  processManager: ProcessManager,
  openclawHome: string,
) {
  app.get('/api/notifications', async () => {
    const now = Date.now()
    const windows = {
      audit: now - 24 * 60 * 60 * 1000,   // 24h
      logs:  now - 60 * 60 * 1000,         // 1h
    }
    const items: NotificationItem[] = []

    // 1. Audit failures in last 24h
    try {
      const { entries } = await audit.list({ result: 'failure', limit: 50, since: windows.audit })
      for (const e of entries) {
        items.push({
          id: `audit-${e.ts}-${e.action}`,
          type: 'audit-failure',
          title: `审计失败：${e.action}`,
          message: `${e.target ? e.target + ' · ' : ''}${e.method ?? ''} ${e.url ?? ''}  ${e.status ?? ''}`,
          severity: 'error',
          ts: e.ts,
          link: '/insights/audit',
        })
      }
    } catch {}

    // 2. Gateway log errors in last 1h (read the tail, quick scan)
    try {
      const svcStatus = await processManager.getStatus()
      const logFile = findLogFile(processManager, svcStatus)
      if (existsSync(logFile)) {
        // Tail last ~4KB of the file to avoid reading multi-MB logs
        const content = readFileSync(logFile, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim()).slice(-300)
        let errorCount = 0
        const firstErrors: Array<{ ts: number; msg: string }> = []
        for (const line of lines) {
          if (!isErrorLine(line)) continue
          const ts = parseLogTimestamp(line)
          if (ts > 0 && ts < windows.logs) continue
          errorCount += 1
          if (firstErrors.length < 5) firstErrors.push({ ts: ts || now, msg: extractMessage(line) })
        }
        // Collapse into one notification if many errors; one each if few
        if (errorCount > 5) {
          items.push({
            id: `log-errors-summary-${windows.logs}`,
            type: 'log-error',
            title: `网关日志：近 1 小时 ${errorCount} 条错误`,
            message: firstErrors.length ? firstErrors[0].msg : '前往日志页查看详情',
            severity: 'error',
            ts: firstErrors[0]?.ts ?? now,
            link: '/diagnose/logs',
          })
        } else {
          for (const e of firstErrors) {
            items.push({
              id: `log-error-${e.ts}`,
              type: 'log-error',
              title: '网关日志错误',
              message: e.msg,
              severity: 'error',
              ts: e.ts,
              link: '/diagnose/logs',
            })
          }
        }
      }
    } catch {}

    // 3. Gateway service status — fires on state transition only.
    try {
      const svc = await processManager.getStatus()
      const bad = svc.state === 'stopped' || svc.state === 'error'
      if (bad) {
        if (alertState.serviceFiredState !== svc.state) {
          alertState.serviceFiredState = svc.state
          items.push({
            id: `svc-${svc.state}-${now}`,
            type: 'service-error',
            title: svc.state === 'stopped' ? 'Gateway 已停止' : 'Gateway 异常',
            message: svc.state === 'stopped'
              ? '网关进程未运行，请在仪表盘启动或检查配置。'
              : '网关进程疑似异常，建议检查日志。',
            severity: 'error',
            ts: now,
            link: '/',
          })
        }
      } else {
        // Reset so next transition to stopped/error will re-fire
        alertState.serviceFiredState = null
      }
    } catch {}

    // 4. Memory pressure — hysteresis: fires once on < 80% → ≥ 90% crossing,
    // stays silent until usage drops below 80%.
    try {
      const os = await import('os')
      const total = os.totalmem()
      const free = os.freemem()
      const usedPct = Math.round(((total - free) / total) * 100)
      const prev = alertState.memoryLastPct
      alertState.memoryLastPct = usedPct

      if (usedPct >= 90 && alertState.memoryFiredAt === null) {
        // Rising edge: cross threshold
        alertState.memoryFiredAt = now
        items.push({
          id: `memory-${now}`,
          type: 'memory-warn',
          title: `系统内存 ${usedPct}%`,
          message: `已用 ${Math.round((total - free) / 1024 / 1024)} MB / ${Math.round(total / 1024 / 1024)} MB · 首次触发时间 ${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}`,
          severity: 'warn',
          ts: now,
          link: '/monitor',
        })
      } else if (usedPct < 80) {
        // Release: allow future crossings to trigger again
        alertState.memoryFiredAt = null
      }
      // else: usedPct in [80, 90) — cool-down zone, silent either way
      void prev  // suppress unused warning
    } catch {}

    // Newest first
    items.sort((a, b) => b.ts - a.ts)

    return {
      items,
      total: items.length,
      errorCount: items.filter(i => i.severity === 'error').length,
      warnCount: items.filter(i => i.severity === 'warn').length,
    }
  })
}
