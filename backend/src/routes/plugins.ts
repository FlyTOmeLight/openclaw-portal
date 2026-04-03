import type { FastifyInstance } from 'fastify'
import type { PluginManager } from '../services/plugin-manager.js'

export async function pluginsRoutes(app: FastifyInstance, pluginManager: PluginManager) {
  app.get('/api/plugins', async () => {
    return pluginManager.listInstalled()
  })

  app.post<{ Body: { packageName: string } }>(
    '/api/plugins/install',
    async (req, reply) => {
      try {
        await pluginManager.install(req.body.packageName)
        return { ok: true }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      }
    }
  )

  app.delete<{ Params: { name: string } }>(
    '/api/plugins/:name',
    async (req) => {
      await pluginManager.uninstall(decodeURIComponent(req.params.name))
      return { ok: true }
    }
  )
}
