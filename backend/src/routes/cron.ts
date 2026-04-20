/**
 * Cron routes — backed by Gateway WebSocket RPC (same as ClawPanel).
 *
 * Method mapping:
 *   GET    /api/cron           → cron.list  { includeDisabled: true }
 *   POST   /api/cron           → cron.add   { name, enabled, schedule, payload, agentId?, delivery? }
 *   PUT    /api/cron/:id       → cron.update { jobId, patch }
 *   DELETE /api/cron/:id       → cron.remove { jobId }
 *   POST   /api/cron/:id/run   → cron.run   { jobId }
 *   POST   /api/cron/:id/enable  → cron.update { jobId, patch: { enabled: true } }
 *   POST   /api/cron/:id/disable → cron.update { jobId, patch: { enabled: false } }
 *   GET    /api/cron/status       → cron.status {}
 *   GET    /api/cron/:id/runs     → cron.runs   { jobId, limit? }
 */

import type { FastifyInstance } from 'fastify'
import { getGatewayRpc } from '../services/gateway-rpc.js'

function isGwOffline(msg: string): boolean {
  const lower = msg.toLowerCase()
  return lower.includes('econnrefused') || lower.includes('connection timeout') || lower.includes('websocket error')
}

export async function cronRoutes(app: FastifyInstance, gatewayPort: number, openclawHome: string, portalPort: number) {
  const rpc = () => getGatewayRpc(gatewayPort, openclawHome, portalPort)

  // Scheduler status
  app.get('/api/cron/status', async (_req, reply) => {
    try {
      const result = await rpc().request('cron.status', {})
      return result ?? {}
    } catch (err: any) {
      if (isGwOffline(err.message)) return reply.status(503).send({ error: 'Gateway not available' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // List all cron jobs
  app.get('/api/cron', async (_req, reply) => {
    try {
      const result = await rpc().request('cron.list', { includeDisabled: true })
      // Gateway returns { jobs: [...] } or just [...]
      return Array.isArray(result) ? result : (result?.jobs ?? [])
    } catch (err: any) {
      if (isGwOffline(err.message)) {
        return reply.status(503).send({ error: 'Gateway not available — cron requires a running gateway' })
      }
      return reply.status(500).send({ error: err.message })
    }
  })

  // Add a cron job
  app.post<{
    Body: {
      name: string
      message: string
      schedule: string        // cron expr or "every:10m"
      agentId?: string
      enabled?: boolean
      description?: string
      channel?: string
      accountId?: string      // multi-account channel target
      to?: string             // specific destination (phone, chatId, etc.)
    }
  }>('/api/cron', async (req, reply) => {
    const { name, message, schedule, agentId, enabled = true, description, channel, accountId, to } = req.body
    if (!name) return reply.status(400).send({ error: 'name required' })
    if (!message) return reply.status(400).send({ error: 'message required' })
    if (!schedule) return reply.status(400).send({ error: 'schedule required' })

    const params: any = {
      name,
      enabled,
      schedule: parseSchedule(schedule),
      payload: { kind: 'agentTurn', message },
    }
    if (agentId) params.agentId = agentId
    if (description) params.description = description
    if (channel) {
      params.delivery = { mode: 'announce', channel }
      if (accountId) params.delivery.accountId = accountId
      if (to) params.delivery.to = to
    }

    try {
      const result = await rpc().request('cron.add', params)
      return result ?? { ok: true }
    } catch (err: any) {
      if (isGwOffline(err.message)) return reply.status(503).send({ error: 'Gateway not available' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // Edit a cron job
  app.put<{
    Params: { id: string }
    Body: {
      name?: string
      message?: string
      schedule?: string
      agentId?: string
      description?: string
      channel?: string
      accountId?: string
      to?: string
      enabled?: boolean
    }
  }>('/api/cron/:id', async (req, reply) => {
    const { name, message, schedule, agentId, description, channel, accountId, to, enabled } = req.body
    const patch: any = {}

    if (name !== undefined) patch.name = name
    if (enabled !== undefined) patch.enabled = enabled
    if (schedule) patch.schedule = parseSchedule(schedule)
    if (message) patch.payload = { kind: 'agentTurn', message }
    if (agentId !== undefined) patch.agentId = agentId
    if (description !== undefined) patch.description = description
    if (channel !== undefined) {
      if (!channel) {
        patch.delivery = undefined
      } else {
        patch.delivery = { mode: 'announce', channel }
        if (accountId) patch.delivery.accountId = accountId
        if (to) patch.delivery.to = to
      }
    }

    try {
      const result = await rpc().request('cron.update', { jobId: req.params.id, patch })
      return result ?? { ok: true }
    } catch (err: any) {
      if (isGwOffline(err.message)) return reply.status(503).send({ error: 'Gateway not available' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // Enable a cron job
  app.post<{ Params: { id: string } }>('/api/cron/:id/enable', async (req, reply) => {
    try {
      await rpc().request('cron.update', { jobId: req.params.id, patch: { enabled: true } })
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Disable a cron job
  app.post<{ Params: { id: string } }>('/api/cron/:id/disable', async (req, reply) => {
    try {
      await rpc().request('cron.update', { jobId: req.params.id, patch: { enabled: false } })
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Run a cron job now
  app.post<{ Params: { id: string } }>('/api/cron/:id/run', async (req, reply) => {
    try {
      await rpc().request('cron.run', { jobId: req.params.id })
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Run history for a job
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/cron/:id/runs', async (req, reply) => {
    try {
      const limit = parseInt(req.query.limit ?? '50', 10)
      const result = await rpc().request('cron.runs', { jobId: req.params.id, limit })
      return Array.isArray(result) ? result : (result?.entries ?? result?.runs ?? [])
    } catch (err: any) {
      if (isGwOffline(err.message)) return reply.status(503).send({ error: 'Gateway not available' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // Remove a cron job
  app.delete<{ Params: { id: string } }>('/api/cron/:id', async (req, reply) => {
    try {
      await rpc().request('cron.remove', { jobId: req.params.id })
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })
}

/** Convert portal schedule string to Gateway schedule object */
function parseSchedule(raw: string): object {
  if (raw.startsWith('every:')) {
    // e.g. "every:10m", "every:1h", "every:30s"
    const part = raw.slice(6)
    const ms = parseDurationMs(part)
    return { kind: 'every', everyMs: ms }
  }
  return { kind: 'cron', expr: raw }
}

function parseDurationMs(s: string): number {
  const n = parseFloat(s)
  if (s.endsWith('ms')) return n
  if (s.endsWith('s')) return n * 1000
  if (s.endsWith('m')) return n * 60_000
  if (s.endsWith('h')) return n * 3_600_000
  if (s.endsWith('d')) return n * 86_400_000
  return n * 60_000 // default: minutes
}
