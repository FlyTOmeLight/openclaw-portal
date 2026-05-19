import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginsRoutes } from '../src/routes/plugins.js'

function makeApp(pluginManager: any) {
  const app = Fastify()
  const processManager = { restart: vi.fn().mockResolvedValue(undefined) }
  return pluginsRoutes(app, pluginManager as any, processManager as any).then(() => app)
}

describe('pluginsRoutes — search & npm-registry', () => {
  afterEach(() => vi.clearAllMocks())

  it('GET /api/plugins/search returns results', async () => {
    const pluginManager = {
      openclawHome: '/tmp',
      listInstalled: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([
        { name: 'plugin-a', version: '1.0.0', description: 'd', npmSpec: 'plugin-a', installed: false },
      ]),
    }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'GET', url: '/api/plugins/search?q=plugin' })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toHaveLength(1)
    expect(pluginManager.search).toHaveBeenCalledWith('plugin', 25)
    await app.close()
  })

  it('GET /api/plugins/search with blank q returns empty without calling search', async () => {
    const pluginManager = { openclawHome: '/tmp', listInstalled: vi.fn(), search: vi.fn() }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'GET', url: '/api/plugins/search?q=' })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([])
    expect(pluginManager.search).not.toHaveBeenCalled()
    await app.close()
  })

  it('GET /api/plugins/search returns 500 on search failure', async () => {
    const pluginManager = {
      openclawHome: '/tmp',
      listInstalled: vi.fn(),
      search: vi.fn().mockRejectedValue(new Error('无法连接 npm 源')),
    }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'GET', url: '/api/plugins/search?q=plugin' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toContain('无法连接 npm 源')
    await app.close()
  })

  it('GET /api/plugins/npm-registry returns the current registry', async () => {
    const pluginManager = {
      openclawHome: '/tmp',
      listInstalled: vi.fn(),
      getNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmmirror.com/'),
    }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'GET', url: '/api/plugins/npm-registry' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ registry: 'https://registry.npmmirror.com/' })
    await app.close()
  })

  it('POST /api/plugins/npm-registry rejects an empty body', async () => {
    const pluginManager = { openclawHome: '/tmp', listInstalled: vi.fn(), setNpmRegistry: vi.fn() }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'POST', url: '/api/plugins/npm-registry', payload: { registry: '' } })
    expect(res.statusCode).toBe(400)
    expect(pluginManager.setNpmRegistry).not.toHaveBeenCalled()
    await app.close()
  })

  it('POST /api/plugins/npm-registry returns 400 when the manager rejects the URL', async () => {
    const pluginManager = {
      openclawHome: '/tmp',
      listInstalled: vi.fn(),
      setNpmRegistry: vi.fn().mockRejectedValue(new Error('Invalid registry URL: bad')),
    }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'POST', url: '/api/plugins/npm-registry', payload: { registry: 'bad' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Invalid registry URL')
    await app.close()
  })

  it('POST /api/plugins/npm-registry/ping returns the ping result', async () => {
    const pluginManager = {
      openclawHome: '/tmp',
      listInstalled: vi.fn(),
      pingNpmRegistry: vi.fn().mockResolvedValue({ ok: true, ms: 142, message: '连通正常' }),
    }
    const app = await makeApp(pluginManager)
    const res = await app.inject({
      method: 'POST', url: '/api/plugins/npm-registry/ping',
      payload: { registry: 'https://registry.npmmirror.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, ms: 142, message: '连通正常' })
    await app.close()
  })

  it('POST /api/plugins/npm-registry/ping rejects an empty body', async () => {
    const pluginManager = { openclawHome: '/tmp', listInstalled: vi.fn(), pingNpmRegistry: vi.fn() }
    const app = await makeApp(pluginManager)
    const res = await app.inject({ method: 'POST', url: '/api/plugins/npm-registry/ping', payload: { registry: '' } })
    expect(res.statusCode).toBe(400)
    expect(pluginManager.pingNpmRegistry).not.toHaveBeenCalled()
    await app.close()
  })
})
