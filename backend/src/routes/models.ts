import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'
import type { ModelProvider } from '../types/openclaw.js'

type SupportedModelApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'ollama'

function normalizeApiType(api?: string): SupportedModelApi {
  const value = (api ?? '').toLowerCase()
  if (value === 'anthropic' || value === 'anthropic-messages') return 'anthropic-messages'
  if (value === 'openai-responses') return 'openai-responses'
  if (value === 'google' || value === 'gemini' || value === 'google-gemini' || value === 'google-generative-ai') return 'google-generative-ai'
  if (value === 'ollama') return 'ollama'
  return 'openai-completions'
}

// Resolve ${VAR} and $VAR placeholders from process.env — mirrors how the
// openclaw gateway expands secrets at runtime. Unknown vars stay as-is so the
// caller can tell them apart from empty values.
function expandEnv(value: string | undefined): string {
  if (!value) return ''
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/gi, (match, a, b) => {
    const name = a ?? b
    const resolved = process.env[name]
    return resolved ?? match
  })
}

function normalizeBaseUrl(baseUrl: string, api: SupportedModelApi): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (api === 'anthropic-messages' && !/\/v1$/i.test(normalized)) return `${normalized}/v1`
  if (api === 'ollama') return normalized.replace(/\/v1$/i, '')
  return normalized
}

async function parseProviderError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (!text) return `Provider returned ${res.status}`
  try {
    const parsed = JSON.parse(text)
    return parsed.error?.message ?? parsed.message ?? `Provider returned ${res.status}`
  } catch {
    return text.slice(0, 200)
  }
}

function parseRemoteModelIds(payload: any): string[] {
  const ids = [
    ...((payload?.data ?? []).map((item: any) => item?.id)),
    ...((payload?.models ?? []).map((item: any) => item?.name ?? item?.id)),
  ]
    .map((id: string | undefined) => (id ?? '').replace(/^models\//, ''))
    .filter(Boolean)

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

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

  app.put<{ Body: { fallbacks: string[] } }>(
    '/api/models/fallbacks',
    async (req) => {
      await configManager.setFallbackModels(req.body.fallbacks ?? [])
      return { ok: true }
    }
  )

  // Connectivity test: sends a minimal request to the provider
  app.post<{ Body: { baseUrl: string; apiKey: string; modelId: string; api?: string } }>(
    '/api/models/test',
    async (req, reply) => {
      const { api } = req.body
      const apiType = normalizeApiType(api)
      // Resolve ${VAR} placeholders like the gateway does at runtime, otherwise
      // the test would send the literal `${OPENAI_API_KEY}` as a Bearer token.
      const baseUrl = expandEnv(req.body.baseUrl)
      const apiKey = expandEnv(req.body.apiKey)
      const modelId = expandEnv(req.body.modelId)
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl, apiType)
      try {
        let res: Response

        if (apiType === 'anthropic-messages') {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          }
          if (apiKey) headers['x-api-key'] = apiKey
          res = await fetch(`${normalizedBaseUrl}/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 16,
            }),
            signal: AbortSignal.timeout(8000),
          })
        } else if (apiType === 'openai-responses') {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`
          res = await fetch(`${normalizedBaseUrl}/responses`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: modelId,
              input: 'ping',
              max_output_tokens: 16,
            }),
            signal: AbortSignal.timeout(8000),
          })
        } else if (apiType === 'google-generative-ai') {
          res = await fetch(
            `${normalizedBaseUrl}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey ?? '')}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              }),
              signal: AbortSignal.timeout(8000),
            },
          )
        } else if (apiType === 'ollama') {
          res = await fetch(`${normalizedBaseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelId,
              prompt: 'ping',
              stream: false,
            }),
            signal: AbortSignal.timeout(8000),
          })
        } else {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`
          res = await fetch(`${normalizedBaseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 16,
            }),
            signal: AbortSignal.timeout(8000),
          })
        }

        if (!res.ok) return reply.status(502).send({ error: await parseProviderError(res) })
        return { ok: true }
      } catch (err: any) {
        return reply.status(502).send({ error: err.message })
      }
    }
  )

  app.post<{ Body: { baseUrl: string; apiKey: string; api?: string } }>(
    '/api/models/remote-list',
    async (req, reply) => {
      const { api } = req.body
      const apiType = normalizeApiType(api)
      const baseUrl = expandEnv(req.body.baseUrl)
      const apiKey = expandEnv(req.body.apiKey)
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl, apiType)

      try {
        let res: Response

        if (apiType === 'anthropic-messages') {
          const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
          if (apiKey) headers['x-api-key'] = apiKey
          res = await fetch(`${normalizedBaseUrl}/models`, {
            headers,
            signal: AbortSignal.timeout(15000),
          })
        } else if (apiType === 'google-generative-ai') {
          res = await fetch(
            `${normalizedBaseUrl}/models?key=${encodeURIComponent(apiKey ?? '')}`,
            { signal: AbortSignal.timeout(15000) },
          )
        } else if (apiType === 'ollama') {
          res = await fetch(`${normalizedBaseUrl}/api/tags`, {
            signal: AbortSignal.timeout(15000),
          })
        } else {
          const headers: Record<string, string> = {}
          if (apiKey) headers.Authorization = `Bearer ${apiKey}`
          res = await fetch(`${normalizedBaseUrl}/models`, {
            headers,
            signal: AbortSignal.timeout(15000),
          })
        }

        if (!res.ok) return reply.status(502).send({ error: await parseProviderError(res) })
        const data = await res.json()
        const models = parseRemoteModelIds(data)
        if (!models.length) return reply.status(502).send({ error: '该服务商返回了空的模型列表' })
        return { models }
      } catch (err: any) {
        return reply.status(502).send({ error: err.message })
      }
    },
  )
}
