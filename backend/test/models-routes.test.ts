import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelsRoutes } from '../src/routes/models.js'

const fetchMock = vi.fn()

describe('modelsRoutes', () => {
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('tests OpenAI-compatible providers via chat completions', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/test',
      payload: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        modelId: 'gpt-4o-mini',
        api: 'openai-completions',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      }),
    )

    await app.close()
  })

  it('tests OpenAI Responses providers via /responses', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/test',
      payload: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
        api: 'openai-responses',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      }),
    )

    await app.close()
  })

  it('tests Anthropic providers via /v1/messages and x-api-key', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/test',
      payload: {
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        modelId: 'claude-sonnet',
        api: 'anthropic-messages',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': 'sk-ant-test',
        },
      }),
    )

    await app.close()
  })

  it('tests Gemini providers via generateContent', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/test',
      payload: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIza-test',
        modelId: 'gemini-2.5-pro',
        api: 'google-generative-ai',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=AIza-test',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    await app.close()
  })

  it('tests Ollama providers via native /api/generate endpoint', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/test',
      payload: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        modelId: 'qwen2.5:7b',
        api: 'ollama',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )

    await app.close()
  })

  it('lists OpenAI-compatible remote models via /models', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
    }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/remote-list',
      payload: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ models: ['gpt-4o', 'gpt-4o-mini'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-test' },
      }),
    )

    await app.close()
  })

  it('updates default fallback models', async () => {
    const setFallbackModels = vi.fn().mockResolvedValue(undefined)
    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn(), setFallbackModels } as any)

    const response = await app.inject({
      method: 'PUT',
      url: '/api/models/fallbacks',
      payload: { fallbacks: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'] },
    })

    expect(response.statusCode).toBe(200)
    expect(setFallbackModels).toHaveBeenCalledWith(['openai/gpt-4o-mini', 'deepseek/deepseek-chat'])

    await app.close()
  })

  it('lists Gemini remote models and strips models/ prefix', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }],
    }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/remote-list',
      payload: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIza-test',
        api: 'google-generative-ai',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=AIza-test',
      expect.any(Object),
    )

    await app.close()
  })

  it('lists Ollama remote models via /api/tags', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'qwen2.5:7b' }, { name: 'llama3.2' }],
    }), { status: 200 }))

    const app = Fastify()
    await modelsRoutes(app, { read: vi.fn() } as any)

    const response = await app.inject({
      method: 'POST',
      url: '/api/models/remote-list',
      payload: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        api: 'ollama',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ models: ['llama3.2', 'qwen2.5:7b'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.any(Object),
    )

    await app.close()
  })
})
