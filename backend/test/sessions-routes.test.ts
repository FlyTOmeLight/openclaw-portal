import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { sessionsRoutes } from '../src/routes/sessions.js'

const workdirs: string[] = []

async function createSessionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'openclaw-sessions-'))
  workdirs.push(root)

  const sessionsDir = join(root, 'agents', 'main', 'sessions')
  await mkdir(sessionsDir, { recursive: true })

  await writeFile(join(sessionsDir, 'sessions.json'), JSON.stringify({
    'agent:main:main': { sessionId: 'session-1' },
  }), 'utf-8')

  const lines = [
    JSON.stringify({ type: 'session', id: 'sess-meta', timestamp: '2026-04-14T10:00:00.000Z', cwd: '/tmp/workspace' }),
    JSON.stringify({
      type: 'message',
      id: 'm1',
      timestamp: '2026-04-14T10:00:01.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    }),
    JSON.stringify({
      type: 'message',
      id: 'm2',
      timestamp: '2026-04-14T10:00:02.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'working' },
          { type: 'thinking', thinking: 'internal' },
          { type: 'toolCall', id: 'tool-1', name: 'web_search', arguments: { q: 'x' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'message',
      id: 'm3',
      timestamp: '2026-04-14T10:00:03.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'done' },
          { type: 'toolResult', toolCallId: 'tool-1', content: [{ text: 'ok' }] },
        ],
      },
    }),
  ]

  await writeFile(join(sessionsDir, 'session-1.jsonl'), `${lines.join('\n')}\n`, 'utf-8')
  return root
}

afterEach(async () => {
  while (workdirs.length) {
    const dir = workdirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('sessionsRoutes', () => {
  it('returns a truncated tail preview with aggregate stats', async () => {
    const openclawHome = await createSessionFixture()
    const app = Fastify()
    await sessionsRoutes(app, openclawHome)

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/main/session-1?tail=2',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      agentId: 'main',
      sessionId: 'session-1',
      sessionKey: 'agent:main:main',
      truncated: true,
      loadedMessageCount: 2,
      stats: {
        messageCount: 3,
        userCount: 1,
        assistantCount: 2,
        toolCallCount: 1,
        toolResultCount: 1,
      },
    })
    expect(response.json().messages.map((message: any) => message.id)).toEqual(['m2', 'm3'])

    await app.close()
  })

  it('returns the full session when no tail query is provided', async () => {
    const openclawHome = await createSessionFixture()
    const app = Fastify()
    await sessionsRoutes(app, openclawHome)

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/main/session-1',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      truncated: false,
      loadedMessageCount: 3,
      cwd: '/tmp/workspace',
    })
    expect(response.json().messages.map((message: any) => message.id)).toEqual(['m1', 'm2', 'm3'])

    await app.close()
  })
})
