import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h

interface AuthStore {
  enabled: boolean
  passwordHash: string | null  // hex(salt):hex(hash), null when never set
  secretKey: string            // HMAC signing key for session tokens
}

export class AuthService {
  private readonly storePath: string
  private store: AuthStore | null = null

  constructor(openclawHome: string) {
    this.storePath = join(openclawHome, 'portal-auth.json')
  }

  async init(): Promise<void> {
    if (existsSync(this.storePath)) {
      try {
        const raw = JSON.parse(await readFile(this.storePath, 'utf-8'))
        // Auth defaults to OFF. Honor an explicit `enabled: true` if it was set,
        // otherwise keep it disabled. We preserve `passwordHash` so that a later
        // enable() can reuse it (admin doesn't have to retype).
        this.store = {
          enabled: raw.enabled === true,
          passwordHash: raw.passwordHash ?? null,
          secretKey: raw.secretKey ?? randomBytes(32).toString('hex'),
        }
        return
      } catch { /* corrupt file, reinit */ }
    }
    // First run: auth is disabled by default. Portal is open.
    this.store = {
      enabled: false,
      passwordHash: null,
      secretKey: randomBytes(32).toString('hex'),
    }
    await this.save()
  }

  isEnabled(): boolean {
    return Boolean(this.store?.enabled)
  }

  async verifyPassword(password: string): Promise<boolean> {
    if (!this.store) await this.init()
    if (!this.store!.passwordHash) return false
    return verifyPasswordHash(password, this.store!.passwordHash)
  }

  /** Enable auth with a freshly chosen password. Can also be used to reset
   * from an unrecoverable state (e.g. forgot password file was deleted).
   * Callers must check isEnabled() upstream to decide whether this counts as
   * initial setup or a reset. */
  async enable(newPassword: string): Promise<boolean> {
    if (!this.store) await this.init()
    if (!newPassword || newPassword.length < 6) return false
    this.store!.enabled = true
    this.store!.passwordHash = hashPassword(newPassword)
    // Rotate secret so old tokens (if any) are invalidated
    this.store!.secretKey = randomBytes(32).toString('hex')
    await this.save()
    return true
  }

  /** Disable auth. Requires proving the current password first. */
  async disable(currentPassword: string): Promise<boolean> {
    if (!this.store) await this.init()
    if (!this.store!.enabled) return true  // already disabled, no-op success
    if (!await this.verifyPassword(currentPassword)) return false
    this.store!.enabled = false
    // Rotate secret so any outstanding session cookie is immediately invalid
    this.store!.secretKey = randomBytes(32).toString('hex')
    await this.save()
    return true
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    if (!this.store) await this.init()
    if (!this.store!.enabled) return false  // can't change what isn't set
    if (!await this.verifyPassword(oldPassword)) return false
    this.store!.passwordHash = hashPassword(newPassword)
    this.store!.secretKey = randomBytes(32).toString('hex')
    await this.save()
    return true
  }

  issueToken(): string {
    if (!this.store) throw new Error('AuthService not initialized')
    const payload = `${Date.now()}:${randomBytes(16).toString('hex')}`
    const sig = createHmac('sha256', this.store.secretKey).update(payload).digest('hex')
    return `${payload}:${sig}`
  }

  verifyToken(token: string): boolean {
    if (!this.store || !token) return false
    const parts = token.split(':')
    if (parts.length !== 3) return false
    const [tsStr, nonce, sig] = parts
    const ts = parseInt(tsStr, 10)
    if (isNaN(ts) || Date.now() - ts > TOKEN_TTL_MS) return false
    const expected = createHmac('sha256', this.store.secretKey).update(`${tsStr}:${nonce}`).digest('hex')
    if (expected.length !== sig.length) return false
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  }

  private async save(): Promise<void> {
    await writeFile(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8')
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, 64)
  return timingSafeEqual(expected, actual)
}
