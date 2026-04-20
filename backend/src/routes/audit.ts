import type { FastifyInstance } from 'fastify'
import type { AuditLog } from '../services/audit-log.js'

export async function auditRoutes(app: FastifyInstance, audit: AuditLog) {
  app.get<{
    Querystring: {
      limit?: string
      offset?: string
      action?: string
      result?: 'success' | 'failure'
      since?: string
      until?: string
      search?: string
    }
  }>('/api/audit', async (req) => {
    return audit.list({
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 200,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
      action: req.query.action,
      result: req.query.result,
      since: req.query.since ? parseInt(req.query.since, 10) : undefined,
      until: req.query.until ? parseInt(req.query.until, 10) : undefined,
      search: req.query.search,
    })
  })

  app.get('/api/audit/actions', async () => {
    return { actions: await audit.listActions() }
  })
}
