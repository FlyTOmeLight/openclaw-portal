import { appendFile, readFile, stat, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export interface AuditEntry {
  ts: number
  actor: string
  action: string
  target?: string
  method?: string
  url?: string
  status?: number
  durationMs?: number
  result: 'success' | 'failure'
  errorMessage?: string
}

export interface AuditListOpts {
  limit?: number
  offset?: number
  action?: string
  result?: 'success' | 'failure'
  since?: number
  until?: number
  search?: string
}

const MAX_BYTES = 10 * 1024 * 1024  // 10 MB — rotate beyond this

export class AuditLog {
  private readonly filePath: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(openclawHome: string) {
    this.filePath = join(openclawHome, 'audit.log')
  }

  // Fire-and-forget. Writes are serialized via a promise chain to keep the
  // file append-only without interleaving. Errors are swallowed because an
  // audit failure must not break the business request.
  record(entry: AuditEntry): void {
    this.writeChain = this.writeChain.then(async () => {
      try {
        await this.rotateIfNeeded()
        await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')
      } catch {}
    })
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!existsSync(this.filePath)) return
    const s = await stat(this.filePath)
    if (s.size < MAX_BYTES) return
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    await rename(this.filePath, `${this.filePath}.${ts}`).catch(() => {})
  }

  async list(opts: AuditListOpts = {}): Promise<{ entries: AuditEntry[]; total: number }> {
    if (!existsSync(this.filePath)) return { entries: [], total: 0 }
    const raw = await readFile(this.filePath, 'utf-8')
    let entries: AuditEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      try { entries.push(JSON.parse(line)) } catch {}
    }

    if (opts.action) entries = entries.filter(e => e.action === opts.action)
    if (opts.result) entries = entries.filter(e => e.result === opts.result)
    if (opts.since != null) entries = entries.filter(e => e.ts >= opts.since!)
    if (opts.until != null) entries = entries.filter(e => e.ts <= opts.until!)
    if (opts.search) {
      const s = opts.search.toLowerCase()
      entries = entries.filter(e =>
        (e.target?.toLowerCase().includes(s))
        || (e.url?.toLowerCase().includes(s))
        || (e.errorMessage?.toLowerCase().includes(s))
        || e.action.toLowerCase().includes(s),
      )
    }

    entries.reverse()  // newest first
    const total = entries.length
    const offset = opts.offset ?? 0
    const limit = Math.min(opts.limit ?? 200, 1000)
    return { entries: entries.slice(offset, offset + limit), total }
  }

  async listActions(): Promise<string[]> {
    if (!existsSync(this.filePath)) return []
    const raw = await readFile(this.filePath, 'utf-8')
    const set = new Set<string>()
    for (const line of raw.split('\n')) {
      if (!line) continue
      try { set.add(JSON.parse(line).action) } catch {}
    }
    return [...set].sort()
  }
}
