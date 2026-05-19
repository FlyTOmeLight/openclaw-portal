import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AuthService } from '../src/services/auth.js'
import { SsoService } from '../src/services/sso.js'
import { AuditLog } from '../src/services/audit-log.js'
import { authRoutes } from '../src/routes/auth.js'

async function buildApp(home: string) {
  const app = Fastify()
  await app.register(fastifyCookie)
  const auth = new AuthService(home)
  await auth.init()
  const sso = new SsoService(home)
  await sso.init()
  const auditLog = new AuditLog(home)
  await authRoutes(app, auth, sso, auditLog)
  return { app, auth, sso, auditLog }
}

describe('SSO auth routes', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sso-routes-'))
    vi.stubEnv('PORTAL_SSO_ENABLED', 'true')
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('status reports ssoEnabled', async () => {
    const { app } = await buildApp(home)
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' })
    expect(res.json()).toMatchObject({ enabled: false, ssoEnabled: true })
  })

  it('login-url builds 蓝信 URL with backend-derived redirect', async () => {
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/sso/login-url',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'portal.example' },
    })
    expect(res.statusCode).toBe(200)
    const u = new URL(res.json().loginUrl)
    expect(u.searchParams.get('redirect')).toBe('https://portal.example/portal/login')
    expect(u.searchParams.get('productCode')).toBe('ceai-license')
  })

  it('sso/login sets session cookie on a valid token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }), { status: 200 },
    )))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.cookies.find(c => c.name === 'openclaw_session')).toBeTruthy()
  })

  it('sso/login returns 401 on a rejected token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 40001, message: 'token 失效' }), { status: 200 },
    )))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('sso/login returns 400 when cestcToken is missing', async () => {
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('check returns 401 when sso enabled and no cookie present', async () => {
    const { app } = await buildApp(home)
    const res = await app.inject({ method: 'GET', url: '/api/auth/check' })
    expect(res.statusCode).toBe(401)
  })

  // ── 组织校验闸 ──────────────────────────────────────────────
  it('sso/login returns 403 when org check enabled and dept not whitelisted', async () => {
    vi.stubEnv('PORTAL_SSO_ORG_CHECK_ENABLED', 'true')
    vi.stubEnv('PORTAL_SSO_ALLOWED_DEPT_NUMS', 'D01')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { userName: 'zhangsan', deptNum: 'D99' } }), { status: 200 },
    )))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('sso/login succeeds when org check enabled and dept whitelisted', async () => {
    vi.stubEnv('PORTAL_SSO_ORG_CHECK_ENABLED', 'true')
    vi.stubEnv('PORTAL_SSO_ALLOWED_DEPT_NUMS', 'D01,D02')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { userName: 'zhangsan', deptNum: 'D02' } }), { status: 200 },
    )))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(200)
  })

  // ── 权限校验闸 ──────────────────────────────────────────────
  it('sso/login returns 403 when permission check enabled and allow is false', async () => {
    vi.stubEnv('PORTAL_SSO_PERMISSION_CHECK_ENABLED', 'true')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('permissionCheck')) {
        return new Response(JSON.stringify({ code: 20000, data: { allow: false } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }), { status: 200 })
    }))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('sso/login succeeds when permission check enabled and allow is true', async () => {
    vi.stubEnv('PORTAL_SSO_PERMISSION_CHECK_ENABLED', 'true')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('permissionCheck')) {
        return new Response(JSON.stringify({ code: 20000, data: { allow: true } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }), { status: 200 })
    }))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('sso/login returns 403 when permission check service errors (fail closed)', async () => {
    vi.stubEnv('PORTAL_SSO_PERMISSION_CHECK_ENABLED', 'true')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('permissionCheck')) {
        return new Response('upstream down', { status: 502 })
      }
      return new Response(JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }), { status: 200 })
    }))
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('sso/login writes an audit entry attributed to the SSO user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }), { status: 200 },
    )))
    const { app, auditLog } = await buildApp(home)
    await app.inject({ method: 'POST', url: '/api/auth/sso/login', payload: { cestcToken: 'tok' } })
    await new Promise(r => setTimeout(r, 50))  // audit writes are fire-and-forget
    const { entries } = await auditLog.list({ action: 'login' })
    const e = entries.find(x => x.target === 'sso')
    expect(e).toBeTruthy()
    expect(e!.actor).toBe('zhangsan')
    expect(e!.result).toBe('success')
  })

  it('disabling password login is rejected while SSO is enabled', async () => {
    const { app, auth } = await buildApp(home)  // PORTAL_SSO_ENABLED=true via beforeEach
    await auth.enable('admin-pass')
    const res = await app.inject({
      method: 'POST', url: '/api/auth/disable', payload: { password: 'admin-pass' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('SSO config routes', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'sso-cfg-')) })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('GET /api/sso/config returns config without plaintext secretKey', async () => {
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({
      enabled: true, productCode: 'pc', secretKey: 'super-secret',
    }))
    const { app } = await buildApp(home)
    const res = await app.inject({ method: 'GET', url: '/api/sso/config' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.secretKey).toBeUndefined()
    expect(body.secretKeySet).toBe(true)
    expect(body.productCode).toBe('pc')
    expect(body.enabled).toBe(true)
    expect(Array.isArray(body.envLocked)).toBe(true)
  })

  it('PUT /api/sso/config persists changes and they take effect immediately', async () => {
    const { app, sso, auth } = await buildApp(home)
    expect(sso.isEnabled()).toBe(false)
    await auth.enable('admin-pass')  // SSO 启用前必须先有密码登录兜底
    const res = await app.inject({
      method: 'PUT', url: '/api/sso/config',
      payload: { enabled: true, orgCheckEnabled: true, allowedDeptNums: ['D01', 'D02'] },
    })
    expect(res.statusCode).toBe(200)
    expect(sso.isEnabled()).toBe(true)
    expect(sso.getConfig().orgCheckEnabled).toBe(true)
    expect(sso.getConfig().allowedDeptNums).toEqual(['D01', 'D02'])
  })

  it('PUT with empty secretKey keeps the existing one', async () => {
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({ secretKey: 'keep-me' }))
    const { app, sso } = await buildApp(home)
    const res = await app.inject({
      method: 'PUT', url: '/api/sso/config', payload: { productCode: 'pc2', secretKey: '' },
    })
    expect(res.statusCode).toBe(200)
    expect(sso.getConfig().secretKey).toBe('keep-me')
    expect(sso.getConfig().productCode).toBe('pc2')
  })

  it('PUT updates secretKey when a non-empty value is given; GET never echoes it', async () => {
    const { app, sso } = await buildApp(home)
    await app.inject({
      method: 'PUT', url: '/api/sso/config', payload: { secretKey: 'new-key' },
    })
    expect(sso.getConfig().secretKey).toBe('new-key')
    const get = await app.inject({ method: 'GET', url: '/api/sso/config' })
    expect(get.json().secretKey).toBeUndefined()
    expect(get.json().secretKeySet).toBe(true)
  })

  it('envLocked lists keys overridden by environment variables', async () => {
    vi.stubEnv('PORTAL_SSO_ENABLED', 'true')
    const { app } = await buildApp(home)
    const res = await app.inject({ method: 'GET', url: '/api/sso/config' })
    expect(res.json().envLocked).toContain('enabled')
  })

  it('PUT enabled=true is rejected when password login is off', async () => {
    const { app } = await buildApp(home)
    const res = await app.inject({
      method: 'PUT', url: '/api/sso/config', payload: { enabled: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT enabled=true succeeds once password login is on', async () => {
    const { app, auth } = await buildApp(home)
    await auth.enable('admin-pass')
    const res = await app.inject({
      method: 'PUT', url: '/api/sso/config', payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
  })
})
