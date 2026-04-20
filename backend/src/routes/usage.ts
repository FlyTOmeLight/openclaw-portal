import type { FastifyInstance } from 'fastify'
import type { UsageTracker } from '../services/usage-tracker.js'
import { aggregateSessionUsage } from '../services/session-usage.js'

export async function usageRoutes(app: FastifyInstance, usageTracker: UsageTracker, openclawHome: string) {
  // Cache briefly so dashboard polls don't re-scan JSONL every request.
  const CACHE_TTL_MS = 15_000
  let cached: { ts: number; daily: any[]; summary: any } | null = null

  async function getAggregated() {
    const now = Date.now()
    if (cached && now - cached.ts < CACHE_TTL_MS) return cached
    const costs = usageTracker.getSummary().costs
    const { daily, summary } = await aggregateSessionUsage(openclawHome, costs, 90)
    cached = { ts: now, daily, summary }
    return cached
  }

  app.get('/api/usage/summary', async () => {
    const { summary } = await getAggregated()
    const costs = usageTracker.getSummary().costs
    return { ...summary, costs }
  })

  app.get<{ Querystring: { days?: string } }>('/api/usage/daily', async (req) => {
    const days = Math.min(parseInt(req.query.days ?? '30', 10), 90)
    const { daily } = await getAggregated()
    const cutoffDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
    return daily.filter(d => d.date >= cutoffDate)
  })

  app.put<{ Body: Record<string, number> }>('/api/usage/costs', async (req) => {
    usageTracker.updateCosts(req.body)
    cached = null
    return { ok: true }
  })

  // Context pressure: which sessions' latest turn is closest to model context limit.
  // Thresholds: warn ≥ 60%, critical ≥ 85%.
  app.get('/api/usage/pressure', async () => {
    const { summary } = await getAggregated()
    return {
      sessions: summary.pressureSessions,
      thresholds: { warn: 60, critical: 85 },
    }
  })
}
