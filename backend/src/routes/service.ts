import type { FastifyInstance } from 'fastify'
import type { ProcessManager } from '../services/process-manager.js'
import type { StatusBroadcaster } from '../services/status-broadcaster.js'

export async function serviceRoutes(
  app: FastifyInstance,
  processManager: ProcessManager,
  broadcaster?: StatusBroadcaster,
) {
  app.get('/api/service', async () => {
    return processManager.getStatus()
  })

  app.post('/api/service/start', async (req, reply) => {
    try {
      await processManager.start()
      const status = await processManager.getStatus()
      broadcaster?.broadcastServiceStatus(status.state, status.pid)
      return { ok: true }
    } catch (err: any) {
      return reply.status(409).send({ error: err.message })
    }
  })

  app.post('/api/service/stop', async (req, reply) => {
    try {
      await processManager.stop()
      broadcaster?.broadcastServiceStatus('stopped')
      return { ok: true }
    } catch (err: any) {
      return reply.status(409).send({ error: err.message })
    }
  })

  app.post('/api/service/restart', async (req, reply) => {
    try {
      await processManager.restart()
      const status = await processManager.getStatus()
      broadcaster?.broadcastServiceStatus(status.state, status.pid)
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })
}
