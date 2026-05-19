import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { SsoService, normalizeCestcToken } from '../src/services/sso.js'

describe('normalizeCestcToken', () => {
  it('restores spaces to plus signs', () => {
    expect(normalizeCestcToken('ab cd ef')).toBe('ab+cd+ef')
  })
  it('trims surrounding whitespace', () => {
    expect(normalizeCestcToken('  tok  ')).toBe('tok')
  })
  it('handles empty input', () => {
    expect(normalizeCestcToken('')).toBe('')
  })
})

describe('SsoService', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'sso-')) })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('defaults to disabled', async () => {
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.isEnabled()).toBe(false)
  })

  it('PORTAL_SSO_ENABLED env override enables it', async () => {
    vi.stubEnv('PORTAL_SSO_ENABLED', 'true')
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.isEnabled()).toBe(true)
  })

  it('buildLoginUrl includes productCode and redirect', async () => {
    const sso = new SsoService(home)
    await sso.init()
    const url = new URL(sso.buildLoginUrl('https://portal.example/portal/login'))
    expect(url.searchParams.get('productCode')).toBe('ceai-license')
    expect(url.searchParams.get('redirect')).toBe('https://portal.example/portal/login')
  })

  it('verifyCestcToken returns the user on code 20000', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: {
        userName: 'zhangsan', deptNum: 'D01', deptName: '研发部', displayName: '张三',
      } }),
      { status: 200 },
    )))
    const sso = new SsoService(home)
    await sso.init()
    const user = await sso.verifyCestcToken('tok')
    expect(user.userName).toBe('zhangsan')
    expect(user.deptNum).toBe('D01')
    expect(user.deptName).toBe('研发部')
    expect(user.displayName).toBe('张三')
  })

  it('verifyCestcToken defaults missing dept fields to empty strings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { userName: 'zhangsan' } }),
      { status: 200 },
    )))
    const sso = new SsoService(home)
    await sso.init()
    const user = await sso.verifyCestcToken('tok')
    expect(user).toEqual({ userName: 'zhangsan', deptNum: '', deptName: '', displayName: '' })
  })

  it('verifyCestcToken throws when code is not 20000', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 40001, message: 'token 失效' }),
      { status: 200 },
    )))
    const sso = new SsoService(home)
    await sso.init()
    await expect(sso.verifyCestcToken('tok')).rejects.toThrow('token 失效')
  })

  it('verifyCestcToken throws on non-200 HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    const sso = new SsoService(home)
    await sso.init()
    await expect(sso.verifyCestcToken('tok')).rejects.toThrow('HTTP 502')
  })

  it('verifyCestcToken rejects empty token without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const sso = new SsoService(home)
    await sso.init()
    await expect(sso.verifyCestcToken('   ')).rejects.toThrow('缺少 cestcToken')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getConfig returns a copy, not a live reference', async () => {
    const sso = new SsoService(home)
    await sso.init()
    const cfg = sso.getConfig()
    cfg.productCode = 'tampered'
    expect(sso.getConfig().productCode).toBe('ceai-license')
  })

  it('file config overrides defaults', async () => {
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({ productCode: 'custom-code' }))
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.getConfig().productCode).toBe('custom-code')
  })

  it('corrupt config file falls back to defaults', async () => {
    writeFileSync(join(home, 'portal-sso.json'), '{ not valid json')
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.getConfig().productCode).toBe('ceai-license')
  })

  it('new fields default to disabled / empty', async () => {
    const sso = new SsoService(home)
    await sso.init()
    const cfg = sso.getConfig()
    expect(cfg.secretKey).toBe('')
    expect(cfg.permissionCheckEnabled).toBe(false)
    expect(cfg.orgCheckEnabled).toBe(false)
    expect(cfg.requiredPolicyUids).toEqual([])
    expect(cfg.allowedDeptNums).toEqual([])
  })

  it('comma-separated env lists are parsed and trimmed', async () => {
    vi.stubEnv('PORTAL_SSO_REQUIRED_POLICY_UIDS', 'p1, p2 ,, p3')
    vi.stubEnv('PORTAL_SSO_ALLOWED_DEPT_NUMS', 'D01,D02')
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.getConfig().requiredPolicyUids).toEqual(['p1', 'p2', 'p3'])
    expect(sso.getConfig().allowedDeptNums).toEqual(['D01', 'D02'])
  })

  // ── checkOrg ──────────────────────────────────────────────
  const mkUser = (deptNum: string) =>
    ({ userName: 'u', deptNum, deptName: '', displayName: '' })

  it('checkOrg allows anyone when org check is disabled', async () => {
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.checkOrg(mkUser('whatever'))).toBe(true)
  })

  it('checkOrg enforces the dept whitelist when enabled', async () => {
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({
      orgCheckEnabled: true, allowedDeptNums: ['D01', 'D02'],
    }))
    const sso = new SsoService(home)
    await sso.init()
    expect(sso.checkOrg(mkUser('D01'))).toBe(true)
    expect(sso.checkOrg(mkUser('D99'))).toBe(false)
    expect(sso.checkOrg(mkUser(''))).toBe(false)
  })

  // ── checkPermission ───────────────────────────────────────
  it('checkPermission allows anyone when permission check is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const sso = new SsoService(home)
    await sso.init()
    expect(await sso.checkPermission('zhangsan')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checkPermission signs productCode+secretKey+timestamp with SHA3-224', async () => {
    let capturedBody: any
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body)
      return new Response(JSON.stringify({ code: 20000, data: { allow: true } }), { status: 200 })
    }))
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({
      productCode: 'CESTC-TEST', secretKey: 'f0573cb56904441141a2',
      permissionCheckEnabled: true, requiredPolicyUids: ['p1'],
    }))
    const sso = new SsoService(home)
    await sso.init()
    expect(await sso.checkPermission('zhangsan')).toBe(true)
    const ts = capturedBody.timestamp
    const expectedSign = createHash('sha3-224')
      .update(`CESTC-TESTf0573cb56904441141a2${ts}`).digest('hex')
    expect(capturedBody.sign).toBe(expectedSign)
    expect(capturedBody.productCode).toBe('CESTC-TEST')
    expect(capturedBody.data).toEqual({ policyUids: ['p1'], userUid: 'zhangsan' })
  })

  it('checkPermission returns false when allow is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 20000, data: { allow: false } }), { status: 200 },
    )))
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({ permissionCheckEnabled: true }))
    const sso = new SsoService(home)
    await sso.init()
    expect(await sso.checkPermission('zhangsan')).toBe(false)
  })

  it('checkPermission throws on non-20000 / non-200 (caller fails closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 40001, message: '签名错误' }), { status: 200 },
    )))
    writeFileSync(join(home, 'portal-sso.json'), JSON.stringify({ permissionCheckEnabled: true }))
    const sso = new SsoService(home)
    await sso.init()
    await expect(sso.checkPermission('zhangsan')).rejects.toThrow('签名错误')
  })
})
