import type { FastifyInstance } from 'fastify'
import { getCommandLog, clearCommandLog } from '../services/cli-runner.js'

export async function commandLogRoutes(app: FastifyInstance) {
  app.get('/api/command-log', async () => {
    return { entries: getCommandLog() }
  })

  app.delete('/api/command-log', async () => {
    clearCommandLog()
    return { ok: true }
  })
}
