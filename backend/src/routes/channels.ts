import type { FastifyInstance } from 'fastify'
import type { ChannelManager } from '../services/channel-manager.js'
import type { ChannelConfig } from '../types/openclaw.js'

export async function channelsRoutes(app: FastifyInstance, channelManager: ChannelManager) {
  app.get('/api/channels', async () => {
    const channels = await channelManager.listChannels()
    return channels
  })

  app.put<{ Params: { name: string }; Body: ChannelConfig }>(
    '/api/channels/:name',
    async (req) => {
      await channelManager.upsertChannel(req.params.name, req.body)
      return { ok: true }
    }
  )

  app.delete<{ Params: { name: string } }>(
    '/api/channels/:name',
    async (req) => {
      await channelManager.removeChannel(req.params.name)
      return { ok: true }
    }
  )

  app.get('/api/channels/status', async () => {
    const raw = await channelManager.getStatus()
    return { raw }
  })
}
