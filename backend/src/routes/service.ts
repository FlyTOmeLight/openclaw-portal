import type { FastifyInstance } from 'fastify'
import type { ProcessManager } from '../services/process-manager.js'

export async function serviceRoutes(app: FastifyInstance, processManager: ProcessManager) {
  app.get('/api/service', async () => {
    return processManager.getStatus()
  })

  app.post('/api/service/start', async (req, reply) => {
    try {
      await processManager.start()
      return { ok: true }
    } catch (err: any) {
      return reply.status(409).send({ error: err.message })
    }
  })

  app.post('/api/service/stop', async (req, reply) => {
    try {
      await processManager.stop()
      return { ok: true }
    } catch (err: any) {
      return reply.status(409).send({ error: err.message })
    }
  })

  app.post('/api/service/restart', async () => {
    await processManager.restart()
    return { ok: true }
  })
}
