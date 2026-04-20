import type { FastifyInstance } from 'fastify'
import type { ActivityStream } from '../services/activity-stream.js'

export async function activityRoutes(app: FastifyInstance, stream: ActivityStream) {
  app.get<{ Querystring: { limit?: string; session?: string; since?: string } }>(
    '/api/activity/recent',
    async (req) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined
      return {
        entries: stream.recent(Math.min(limit, 500), req.query.session, since),
        bufferSize: stream.bufferSize(),
      }
    },
  )

  app.get('/api/activity/sessions', async () => {
    return { sessions: stream.sessions() }
  })

  const wsHandler = (socket: any) => {
    stream.addClient(socket)
    try {
      socket.send(JSON.stringify({
        type: 'snapshot',
        entries: stream.recent(100),
        sessions: stream.sessions(),
      }))
    } catch {}
    socket.on('close', () => stream.removeClient(socket))
    socket.on('error', () => stream.removeClient(socket))
  }

  app.get('/api/activity/ws',        { websocket: true }, wsHandler)
  app.get('/portal/api/activity/ws', { websocket: true }, wsHandler)
}
