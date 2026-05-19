import type { FastifyInstance } from 'fastify'
import { readFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import type { ProcessManager } from '../services/process-manager.js'

// Whitelisted systemd units — only these can be queried via journalctl to
// prevent arbitrary unit names from being passed to the shell.
const JOURNAL_UNITS = new Set([
  'openclaw-portal',
  'nginx',
  'openclaw-gateway',
])

type Source =
  | { kind: 'file';    label: string; file: string }
  | { kind: 'journal'; label: string; unit: string }

function resolveSource(
  source: string | undefined,
  processManager: ProcessManager,
): Source {
  if (!source || source === 'gateway') {
    return { kind: 'file', label: 'Gateway 进程日志', file: processManager.logFile }
  }
  if (source.startsWith('journal:')) {
    const unit = source.slice('journal:'.length)
    if (!JOURNAL_UNITS.has(unit)) {
      throw new Error(`不支持的 systemd 单元: ${unit}`)
    }
    return { kind: 'journal', label: `journalctl · ${unit}`, unit }
  }
  throw new Error(`未知的日志源: ${source}`)
}

function readJournal(unit: string, maxLines: number): string {
  // Journald json-lines output — one JSON object per line.
  // Use --no-pager to avoid blocking, --output=json for structured parsing.
  // Limit lines server-side via -n.
  const out = execFileSync(
    'journalctl',
    ['-u', unit, '-n', String(maxLines * 3), '--no-pager', '-o', 'json'],
    { encoding: 'utf-8', timeout: 5000, maxBuffer: 32 * 1024 * 1024 },
  )
  return out
}

function parseJournalLine(raw: string): LogEntry {
  try {
    const obj = JSON.parse(raw)
    // journald priority: 0=emerg 1=alert 2=crit 3=err 4=warn 5=notice 6=info 7=debug
    const prio = parseInt(obj.PRIORITY ?? '6', 10)
    const level: LogEntry['level'] =
      prio <= 3 ? 'error' : prio === 4 ? 'warn' : prio === 7 ? 'debug' : 'info'
    // __REALTIME_TIMESTAMP is microseconds since epoch
    const ts = obj.__REALTIME_TIMESTAMP
      ? Math.floor(Number(obj.__REALTIME_TIMESTAMP) / 1000)
      : Date.now()
    return {
      ts,
      level,
      msg: obj.MESSAGE ?? '',
      raw: obj.MESSAGE ?? raw,
    }
  } catch {
    return { ts: Date.now(), level: 'unknown', msg: raw, raw }
  }
}

export interface LogEntry {
  ts: number       // unix ms
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'unknown'
  msg: string
  raw: string
  [key: string]: any
}

const PINO_LEVEL: Record<number, LogEntry['level']> = {
  10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
}

// Strip ANSI escape codes
const ANSI_RE = /\x1b\[[0-9;]*m/g

// Detect level from ANSI color codes in openclaw plain-text log lines.
// Format: [90m]TIMESTAMP[39m] [color][MODULE][39m] [color]MESSAGE[39m]
// Colors: 31=red(error), 33=yellow(warn), 32/35/36=green/magenta/cyan(info)
function levelFromAnsi(raw: string): LogEntry['level'] {
  // Find color codes that appear after the timestamp section (after first [39m])
  const afterTimestamp = raw.replace(/^\x1b\[\d+m[^\x1b]+\x1b\[39m\s*/, '')
  const codes = [...afterTimestamp.matchAll(/\x1b\[(\d+)m/g)].map(m => parseInt(m[1]))
  if (codes.includes(31)) return 'error'
  if (codes.includes(33)) return 'warn'
  return 'info'
}

// Detect an explicit textual level tag like "[INFO]" / "[ERROR]" embedded in
// the line. Subprocess (channel/bot) output is forwarded with red (error) ANSI
// regardless of its real severity, so the tag the process wrote itself is more
// trustworthy than the color. Returns null when no tag is present.
const TEXT_LEVEL_RE = /\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/i
function levelFromTag(clean: string): LogEntry['level'] | null {
  const m = clean.match(TEXT_LEVEL_RE)
  if (!m) return null
  const tag = m[1].toUpperCase()
  return tag === 'WARNING' ? 'warn' : (tag.toLowerCase() as LogEntry['level'])
}

function parseLine(raw: string): LogEntry {
  // Try JSON first (pino format)
  try {
    const obj = JSON.parse(raw)
    const level = PINO_LEVEL[obj.level] ?? 'info'
    return {
      ts: typeof obj.time === 'number' ? obj.time : Date.now(),
      level,
      msg: obj.msg ?? obj.message ?? '',
      raw,
      ...obj,
    }
  } catch {}

  // OpenClaw plain-text log with ANSI codes
  const clean = raw.replace(ANSI_RE, '')
  // Explicit textual tag wins over ANSI color (see levelFromTag).
  const level = levelFromTag(clean) ?? levelFromAnsi(raw)

  // Extract ISO timestamp at start
  const tsMatch = clean.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+\-]\d{2}:\d{2})/)
  const ts = tsMatch ? new Date(tsMatch[1]).getTime() : 0

  // Extract message: everything after "[MODULE] "
  const msgMatch = clean.match(/^[^\s]+\s+\[[\w-]+\]\s+(.+)$/)
  const msg = msgMatch ? msgMatch[1].trim() : clean.trim()

  return { ts, level, msg, raw: clean }
}

function findActualLogFile(defaultPath: string, pid?: number): string {
  if (existsSync(defaultPath)) return defaultPath
  // Try to find log file via lsof on the gateway process
  if (pid) {
    try {
      const out = execFileSync('lsof', ['-p', String(pid), '-F', 'n'], { encoding: 'utf-8' })
      // lsof -F n outputs "n<filename>" lines
      const files = out.split('\n').filter(l => l.startsWith('n/')).map(l => l.slice(1))
      const logFile = files.find(f => f.endsWith('.log') && !f.includes('node_modules'))
      if (logFile && existsSync(logFile)) return logFile
    } catch {}
  }
  return defaultPath
}

export async function logsRoutes(app: FastifyInstance, processManager: ProcessManager) {
  // GET /api/logs/sources — list available log sources (for frontend tab picker)
  app.get('/api/logs/sources', async () => {
    const sources: Array<{ id: string; label: string; available: boolean; reason?: string }> = [
      { id: 'gateway', label: 'Gateway 进程日志', available: true },
    ]
    // journald is Linux-only; detect by trying `journalctl --version`
    let journalAvailable = false
    try {
      execFileSync('journalctl', ['--version'], { stdio: 'ignore', timeout: 1000 })
      journalAvailable = true
    } catch {}

    for (const unit of JOURNAL_UNITS) {
      sources.push({
        id: `journal:${unit}`,
        label: `${unit} · systemd`,
        available: journalAvailable,
        reason: journalAvailable ? undefined : 'journalctl 不可用（需 Linux/systemd 环境）',
      })
    }
    return { sources }
  })

  // GET /api/logs?lines=500&level=all&search=foo&source=gateway|journal:<unit>
  app.get<{
    Querystring: { lines?: string; level?: string; search?: string; source?: string }
  }>('/api/logs', async (req, reply) => {
    const maxLines = Math.min(parseInt(req.query.lines ?? '500', 10), 2000)
    const levelFilter = req.query.level ?? 'all'
    const search = (req.query.search ?? '').toLowerCase()

    let source: Source
    try {
      source = resolveSource(req.query.source, processManager)
    } catch (e: any) {
      return reply.status(400).send({ error: e.message })
    }

    let lines: string[] = []
    let logFile = ''

    if (source.kind === 'file') {
      const status = await processManager.getStatus()
      logFile = findActualLogFile(source.file, status.pid)
      if (!existsSync(logFile)) {
        return { entries: [], total: 0, logFile, source: source.label }
      }
      lines = readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim().length > 0)
    } else {
      logFile = `journalctl -u ${source.unit}`
      try {
        const raw = readJournal(source.unit, maxLines)
        lines = raw.split('\n').filter(l => l.trim().length > 0)
      } catch (e: any) {
        return reply.status(500).send({ error: `读取 journal 失败: ${e.message}` })
      }
    }

    const slice = lines.slice(-maxLines * 3)
    let entries = source.kind === 'file' ? slice.map(parseLine) : slice.map(parseJournalLine)

    if (levelFilter !== 'all') {
      entries = entries.filter(e => e.level === levelFilter)
    }
    if (search) {
      entries = entries.filter(e => e.msg.toLowerCase().includes(search) || e.raw.toLowerCase().includes(search))
    }

    const result = entries.slice(-maxLines)
    return { entries: result, total: lines.length, logFile, source: source.label }
  })

  // DELETE /api/logs — clear log file (only applicable to file-based sources)
  app.delete<{ Querystring: { source?: string } }>('/api/logs', async (req, reply) => {
    let source: Source
    try {
      source = resolveSource(req.query.source, processManager)
    } catch (e: any) {
      return reply.status(400).send({ error: e.message })
    }
    if (source.kind !== 'file') {
      return reply.status(400).send({ error: 'journald 日志无法清空，请使用系统工具' })
    }
    if (existsSync(source.file)) {
      const { writeFileSync } = await import('fs')
      writeFileSync(source.file, '')
    }
    return { ok: true }
  })
}
