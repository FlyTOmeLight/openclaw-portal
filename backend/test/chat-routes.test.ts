import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatRoutes } from '../src/routes/chat.js'

describe('chatRoutes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * 生成一个最小可用的 SSE 响应，避免每个测试重复拼接流式文本。
   */
  function createSseResponse(content = '你好') {
    return new Response(
      `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      },
    )
  }

  it('默认不指定 agentId 时，仍转发到 openclaw 顶层 agent 模型', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createSseResponse())
    vi.stubGlobal('fetch', fetchMock)

    const app = Fastify()
    await chatRoutes(app, 18789, '/tmp/.openclaw', 18800)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      payload: {
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
        mode: 'execute',
      },
    })

    // 断言 portal 始终通过 Gateway 进入 OpenClaw agent 会话链路。
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18789/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: 'openclaw',
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
      max_tokens: 8192,
    })
    expect(requestInit.headers).toMatchObject({
      'x-forwarded-user': 'admin',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'localhost',
    })
    expect(requestInit.headers).not.toHaveProperty('x-openclaw-session-key')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.body).toContain('"content":"你好"')

    await app.close()
  })

  it('指定 agentId 与 conversationKey 时，转发到对应 agent 并透传稳定 session key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createSseResponse('pong'))
    vi.stubGlobal('fetch', fetchMock)

    const app = Fastify()
    await chatRoutes(app, 18789, '/tmp/.openclaw', 18800)

    await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      payload: {
        messages: [{ role: 'user', content: '1+1=' }],
        agentId: 'mathmaster',
        conversationKey: 'abc123',
      },
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body))

    expect(payload.model).toBe('openclaw/mathmaster')
    expect(requestInit.headers).toMatchObject({
      'x-openclaw-session-key': 'agent:mathmaster:portal:abc123',
    })

    await app.close()
  })

  it('将上游 404 错误原样透传给前端，便于定位真实故障', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const app = Fastify()
    await chatRoutes(app, 18789, '/tmp/.openclaw', 18800)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      payload: {
        messages: [{ role: 'user', content: 'ping' }],
      },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'Not Found' })

    await app.close()
  })

  it('将模式提示作为 system message 注入，而不是顶层 system 字段', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createSseResponse('hi'))
    vi.stubGlobal('fetch', fetchMock)

    const app = Fastify()
    await chatRoutes(app, 18789, '/tmp/.openclaw', 18800)

    await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      payload: {
        messages: [{ role: 'user', content: 'ping' }],
        mode: 'chat',
      },
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body))

    expect(payload.system).toBeUndefined()
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: '你只能进行对话和回答问题，不能使用任何工具，也不能修改文件。',
    })
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'ping' })

    await app.close()
  })
})
