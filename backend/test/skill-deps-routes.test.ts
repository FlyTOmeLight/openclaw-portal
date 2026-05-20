import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { skillDepsRoutes } from '../src/routes/skill-deps.js'

function makeApp(checker: any) {
  const app = Fastify()
  return skillDepsRoutes(app, checker as any).then(() => app)
}

describe('skillDepsRoutes', () => {
  it('GET /api/skills/health returns a summary list', async () => {
    const checker = {
      healthOverview: vi.fn().mockResolvedValue([
        { name: 'a', agent: 'finance', totalDeclared: 1, totalMissing: 0, status: 'ok', scannedAt: 1 },
      ]),
      invalidate: vi.fn(),
    }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().skills).toHaveLength(1)
    expect(checker.invalidate).not.toHaveBeenCalled()
    await app.close()
  })

  it('GET /api/skills/health?refresh=1 invalidates the cache first', async () => {
    const checker = {
      healthOverview: vi.fn().mockResolvedValue([]),
      invalidate: vi.fn(),
    }
    const app = await makeApp(checker)
    await app.inject({ method: 'GET', url: '/api/skills/health?refresh=1' })
    expect(checker.invalidate).toHaveBeenCalledOnce()
    await app.close()
  })

  it('GET /api/skills/:agent/:name/deps returns the per-skill report', async () => {
    const report = { name: 'alphaear', agent: 'finance', totalMissing: 0 }
    const checker = {
      checkSkill: vi.fn().mockResolvedValue(report),
      invalidate: vi.fn(),
    }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/finance/alphaear/deps' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject(report)
    expect(checker.checkSkill).toHaveBeenCalledWith('alphaear', 'finance')
    await app.close()
  })

  it('GET /api/skills/_global/:name/deps treats _global as null agent', async () => {
    const checker = {
      checkSkill: vi.fn().mockResolvedValue({ name: 'skill-creator', agent: null, totalMissing: 0 }),
      invalidate: vi.fn(),
    }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/_global/skill-creator/deps' })
    expect(res.statusCode).toBe(200)
    expect(checker.checkSkill).toHaveBeenCalledWith('skill-creator', null)
    await app.close()
  })

  it('GET /api/skills/:agent/:name/deps returns 404 when skill missing', async () => {
    const checker = {
      checkSkill: vi.fn().mockRejectedValue(new Error('Skill not found: finance/ghost')),
      invalidate: vi.fn(),
    }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/finance/ghost/deps' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('rejects invalid skill name with 400', async () => {
    const checker = { checkSkill: vi.fn(), invalidate: vi.fn() }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/finance/..%2Fetc/deps' })
    expect(res.statusCode).toBe(400)
    expect(checker.checkSkill).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects invalid agent name with 400', async () => {
    const checker = { checkSkill: vi.fn(), invalidate: vi.fn() }
    const app = await makeApp(checker)
    const res = await app.inject({ method: 'GET', url: '/api/skills/Bad%20Agent/foo/deps' })
    expect(res.statusCode).toBe(400)
    expect(checker.checkSkill).not.toHaveBeenCalled()
    await app.close()
  })
})
