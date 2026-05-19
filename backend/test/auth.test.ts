import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AuthService } from '../src/services/auth.js'

describe('AuthService session map', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'auth-')) })
  afterEach(() => { rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })

  it('issueToken records a resolvable session', async () => {
    const a = new AuthService(home)
    await a.init()
    const token = a.issueToken('zhangsan', 'sso')
    const s = a.getSession(token)
    expect(s).toBeTruthy()
    expect(s!.user).toBe('zhangsan')
    expect(s!.method).toBe('sso')
    expect(typeof s!.loginAt).toBe('number')
  })

  it('getSession returns null for invalid or empty tokens', async () => {
    const a = new AuthService(home)
    await a.init()
    expect(a.getSession('bogus')).toBeNull()
    expect(a.getSession('')).toBeNull()
    expect(a.getSession('a:b:c')).toBeNull()
  })

  it('revokeToken drops the session record (token stays HMAC-valid)', async () => {
    const a = new AuthService(home)
    await a.init()
    const token = a.issueToken('zhangsan', 'sso')
    expect(a.getSession(token)).toBeTruthy()
    a.revokeToken(token)
    expect(a.getSession(token)).toBeNull()
    expect(a.verifyToken(token)).toBe(true)
  })

  it('sessions persist across an AuthService reload', async () => {
    const a1 = new AuthService(home)
    await a1.init()
    const token = a1.issueToken('lisi', 'password')
    await new Promise(r => setTimeout(r, 50))  // let the fire-and-forget persist flush
    const a2 = new AuthService(home)
    await a2.init()
    expect(a2.getSession(token)?.user).toBe('lisi')
  })

  it('changePassword clears all sessions', async () => {
    const a = new AuthService(home)
    await a.init()
    await a.enable('initpass')
    const token = a.issueToken('admin', 'password')
    expect(a.getSession(token)).toBeTruthy()
    await a.changePassword('initpass', 'newpass1')
    expect(a.getSession(token)).toBeNull()
  })
})
