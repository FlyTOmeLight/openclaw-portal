import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'
import type { ModelProvider } from '../types/openclaw.js'

export async function modelsRoutes(app: FastifyInstance, configManager: ConfigManager) {
  app.get('/api/models', async () => {
    const cfg = await configManager.read()
    return {
      providers: cfg.models.providers,
      primary: cfg.agents.defaults.model.primary,
      fallbacks: cfg.agents.defaults.model.fallbacks,
    }
  })

  app.put<{ Params: { id: string }; Body: ModelProvider }>(
    '/api/models/providers/:id',
    async (req, reply) => {
      await configManager.updateProvider(req.params.id, req.body)
      return { ok: true }
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/api/models/providers/:id',
    async (req) => {
      await configManager.removeProvider(req.params.id)
      return { ok: true }
    }
  )

  app.put<{ Body: { primary: string } }>(
    '/api/models/primary',
    async (req) => {
      await configManager.setPrimaryModel(req.body.primary)
      return { ok: true }
    }
  )

  // Connectivity test: sends a minimal request to the provider
  app.post<{ Body: { baseUrl: string; apiKey: string; modelId: string } }>(
    '/api/models/test',
    async (req, reply) => {
      const { baseUrl, apiKey, modelId } = req.body
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return reply.status(502).send({ error: `Provider returned ${res.status}` })
        return { ok: true }
      } catch (err: any) {
        return reply.status(502).send({ error: err.message })
      }
    }
  )
}
