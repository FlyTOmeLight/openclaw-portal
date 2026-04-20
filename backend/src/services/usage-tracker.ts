import { readFileSync, existsSync } from 'fs'
import { writeFile, rename } from 'fs/promises'
import { randomBytes } from 'crypto'
import { join } from 'path'

export interface UsageEntry {
  timestamp: string
  sessionId: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface DailyUsage {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  sessions: number
}

export interface UsageSummary {
  totalTokens: number
  totalCost: number
  sessionCount: number
  dailyAvgTokens: number
  byModel: Record<string, { tokens: number; cost: number }>
  costs: Record<string, number>
}

interface UsageData {
  entries: UsageEntry[]
  costs: Record<string, number>
}

const FLUSH_DEBOUNCE_MS = 250

export class UsageTracker {
  private filePath: string
  private data: UsageData
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(openclawHome: string) {
    this.filePath = join(openclawHome, 'portal-usage.json')
    this.data = this.loadSync()
    this.prune()
  }

  private loadSync(): UsageData {
    if (existsSync(this.filePath)) {
      try {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'))
      } catch (err: any) {
        console.warn('[usage-tracker] Failed to parse usage file, starting fresh:', this.filePath, err?.message ?? err)
      }
    }
    return { entries: [], costs: {} }
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, FLUSH_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    const payload = JSON.stringify(this.data, null, 2)
    const next = this.writeQueue.then(async () => {
      const tmpPath = `${this.filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
      await writeFile(tmpPath, payload, 'utf-8')
      await rename(tmpPath, this.filePath)
    })
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  private prune() {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)
    const cutoffStr = cutoff.toISOString()
    const before = this.data.entries.length
    this.data.entries = this.data.entries.filter(e => e.timestamp >= cutoffStr)
    if (this.data.entries.length !== before) this.scheduleFlush()
  }

  record(entry: Omit<UsageEntry, 'timestamp'>) {
    this.data.entries.push({ ...entry, timestamp: new Date().toISOString() })
    this.scheduleFlush()
  }

  updateCosts(costs: Record<string, number>) {
    this.data.costs = { ...this.data.costs, ...costs }
    this.scheduleFlush()
  }

  private costFor(model: string, tokens: number): number {
    const rate = this.data.costs[model] ?? 0
    return (tokens / 1000) * rate
  }

  getDaily(days = 30): DailyUsage[] {
    const map = new Map<string, DailyUsage>()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    for (const entry of this.data.entries) {
      if (new Date(entry.timestamp) < cutoff) continue
      const date = entry.timestamp.slice(0, 10)
      const existing = map.get(date) ?? {
        date, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, sessions: 0,
      }
      existing.promptTokens += entry.promptTokens
      existing.completionTokens += entry.completionTokens
      existing.totalTokens += entry.totalTokens
      existing.cost += this.costFor(entry.model, entry.totalTokens)
      existing.sessions++
      map.set(date, existing)
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }

  getSummary(): UsageSummary {
    const byModel: Record<string, { tokens: number; cost: number }> = {}
    let totalTokens = 0
    let totalCost = 0
    const sessionIds = new Set<string>()

    for (const entry of this.data.entries) {
      totalTokens += entry.totalTokens
      const cost = this.costFor(entry.model, entry.totalTokens)
      totalCost += cost
      sessionIds.add(entry.sessionId)
      if (!byModel[entry.model]) byModel[entry.model] = { tokens: 0, cost: 0 }
      byModel[entry.model].tokens += entry.totalTokens
      byModel[entry.model].cost += cost
    }

    // Daily average over the last 30 days — use a fixed window size as the
    // denominator instead of the count of active days, otherwise one heavy day
    // after a long pause inflates the average.
    const WINDOW_DAYS = 30
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)
    const cutoffStr = cutoff.toISOString()
    const windowTokens = this.data.entries
      .filter(e => e.timestamp >= cutoffStr)
      .reduce((s, e) => s + e.totalTokens, 0)
    const dailyAvgTokens = Math.round(windowTokens / WINDOW_DAYS)

    return {
      totalTokens,
      totalCost,
      sessionCount: sessionIds.size,
      dailyAvgTokens,
      byModel,
      costs: this.data.costs,
    }
  }
}
