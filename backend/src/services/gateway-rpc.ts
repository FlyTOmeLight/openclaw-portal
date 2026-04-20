/**
 * Gateway WebSocket RPC Client
 *
 * Implements the same connect handshake as ClawPanel:
 *  1. Connect ws://127.0.0.1:{port}/ws  (with portal Origin header)
 *  2. Receive connect.challenge (nonce)
 *  3. Sign v3 payload with Ed25519 device key
 *  4. Send connect frame → receive snapshot
 *  5. Send typed RPC requests / receive responses
 *
 * Before connecting, call patchGatewayAccess() once at portal startup so that:
 *  - The portal's origin is registered in gateway.controlUi.allowedOrigins
 *  - The device key is registered in ~/.openclaw/devices/paired.json
 *  Both are required for the gateway to accept our WebSocket connection.
 */

import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign as cryptoSign, randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { WebSocket } from 'ws'
import { gatewayWsBase, portalHttpBase } from '../config.js'

const SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing', 'operator.read', 'operator.write']
const KEY_FILE = 'portal-device-key.json'
const CONNECT_TIMEOUT = 12_000
const REQUEST_TIMEOUT = 15_000
const PING_INTERVAL = 25_000

interface DeviceKey {
  deviceId: string
  publicKeyB64: string   // base64url, 32 bytes raw Ed25519 public key
  privateKeyHex: string  // hex, 32 bytes raw Ed25519 private key
}

async function getOrCreateDeviceKey(openclawHome: string): Promise<DeviceKey> {
  const keyPath = join(openclawHome, KEY_FILE)
  if (existsSync(keyPath)) {
    try {
      const data = JSON.parse(await readFile(keyPath, 'utf-8'))
      if (data.deviceId && data.publicKey && data.secretKey) {
        return { deviceId: data.deviceId, publicKeyB64: data.publicKey, privateKeyHex: data.secretKey }
      }
    } catch {}
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pubSpki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const pubRaw = pubSpki.subarray(12) // skip 12-byte DER header
  const privJwk = privateKey.export({ format: 'jwk' }) as any
  const privRaw = Buffer.from(privJwk.d, 'base64url')

  const deviceId = createHash('sha256').update(pubRaw).digest('hex')
  const publicKeyB64 = pubRaw.toString('base64url')
  const privateKeyHex = privRaw.toString('hex')

  await writeFile(keyPath, JSON.stringify({ deviceId, publicKey: publicKeyB64, secretKey: privateKeyHex }, null, 2), 'utf-8')
  return { deviceId, publicKeyB64, privateKeyHex }
}

export { getOrCreateDeviceKey, buildConnectFrame, getGatewayAuthToken, buildGatewayAuthHeaders, sanitizeUser }

async function getGatewayAuthToken(configPath: string): Promise<string> {
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8'))
    const auth = config?.gateway?.auth
    return auth?.mode === 'token' && typeof auth?.token === 'string' ? auth.token : ''
  } catch {
    return ''
  }
}

const USER_SAFE_RE = /^[A-Za-z0-9_.-]{1,64}$/

function sanitizeUser(user: unknown): string {
  if (typeof user === 'string' && USER_SAFE_RE.test(user)) return user
  return 'admin'
}

/**
 * Build Gateway auth headers.
 * @param user Upstream user identity forwarded by nginx. Sanitized or defaults to 'admin'.
 *             Pass req.headers['x-forwarded-user'] for HTTP-request-bound calls;
 *             omit for background/service callers (uses portal service identity).
 */
async function buildGatewayAuthHeaders(configPath: string, user?: unknown): Promise<Record<string, string>> {
  const token = await getGatewayAuthToken(configPath)
  if (token) return { Authorization: `Bearer ${token}` }
  return {
    'x-forwarded-user': sanitizeUser(user),
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'localhost',
  }
}

function buildConnectFrame(deviceKey: DeviceKey, nonce: string, gatewayToken = ''): object {
  const signedAt = Date.now()
  const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  const scopesStr = SCOPES.join(',')
  const payloadStr = `v3|${deviceKey.deviceId}|openclaw-control-ui|ui|operator|${scopesStr}|${signedAt}|${gatewayToken}|${nonce}|${platform}|desktop`

  const privRaw = Buffer.from(deviceKey.privateKeyHex, 'hex')
  const pubRaw = Buffer.from(deviceKey.publicKeyB64, 'base64url')
  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: privRaw.toString('base64url'), x: pubRaw.toString('base64url') },
    format: 'jwk',
  })
  const sig = cryptoSign(null, Buffer.from(payloadStr), privateKey)
  const id = `connect-${(signedAt >>> 0).toString(16).padStart(8, '0')}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`

  return {
    type: 'req', id, method: 'connect',
    params: {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'openclaw-control-ui', version: '1.0.0', platform, deviceFamily: 'desktop', mode: 'ui' },
      role: 'operator', scopes: SCOPES, caps: ['tool-events'],
      auth: { token: gatewayToken },
      device: { id: deviceKey.deviceId, publicKey: deviceKey.publicKeyB64, signedAt, nonce, signature: sig.toString('base64url') },
      locale: 'zh-CN', userAgent: 'OpenClawPortal/1.0.0',
    },
  }
}

// ─── CLI device auto-pairing ──────────────────────────────────────────────────

/**
 * Read ~/.openclaw/identity/device.json (the CLI's own device key) and
 * ensure it is registered in paired.json with full operator scopes.
 * This mirrors what clawpanel does for itself, applied to the CLI identity
 * so that child-process `openclaw` invocations don't hit "pairing required".
 */
async function patchCliDevice(openclawHome: string): Promise<void> {
  const identityPath = join(openclawHome, 'identity', 'device.json')
  if (!existsSync(identityPath)) return

  try {
    const identity = JSON.parse(await readFile(identityPath, 'utf-8'))
    const { deviceId, publicKeyPem, createdAtMs } = identity
    if (!deviceId || !publicKeyPem) return

    // Convert PEM SPKI → raw 32-byte Ed25519 public key → base64url
    const pubKey = createPublicKey(publicKeyPem)
    const spki = pubKey.export({ type: 'spki', format: 'der' }) as Buffer
    const publicKeyB64 = spki.subarray(12).toString('base64url')

    const devicesDir = join(openclawHome, 'devices')
    const pairedPath = join(devicesDir, 'paired.json')
    await mkdir(devicesDir, { recursive: true })

    let paired: Record<string, any> = {}
    try { paired = JSON.parse(await readFile(pairedPath, 'utf-8')) } catch {}

    const CLI_SCOPES = [
      'operator.admin', 'operator.approvals', 'operator.pairing',
      'operator.read', 'operator.write', 'operator.talk.secrets',
    ]
    const nowMs = Date.now()
    const existing = paired[deviceId]

    // Only write if missing or scopes are incomplete
    const existingScopes: string[] = existing?.approvedScopes ?? []
    const needsUpdate = !existing || CLI_SCOPES.some(s => !existingScopes.includes(s)) || existing.clientMode !== 'cli'

    if (needsUpdate) {
      paired[deviceId] = {
        deviceId,
        publicKey: publicKeyB64,
        platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
        clientId: 'cli',
        clientMode: 'cli',
        role: 'operator',
        roles: ['operator'],
        scopes: CLI_SCOPES,
        approvedScopes: CLI_SCOPES,
        tokens: existing?.tokens ?? {},
        createdAtMs: createdAtMs ?? existing?.createdAtMs ?? nowMs,
        approvedAtMs: nowMs,
      }
      await writeFile(pairedPath, JSON.stringify(paired, null, 2), 'utf-8')
      console.log('[gateway-rpc] CLI device auto-paired:', deviceId.slice(0, 16) + '...')
    }
  } catch (e) {
    console.warn('[gateway-rpc] Failed to patch CLI device:', e)
  }
}

// ─── One-time setup: register portal origin + device key ─────────────────────

/**
 * Write the portal's origin into gateway.controlUi.allowedOrigins and
 * write the device entry into ~/.openclaw/devices/paired.json.
 *
 * Returns true if openclaw.json was modified (caller should restart gateway).
 */
export async function patchGatewayAccess(
  openclawHome: string,
  configPath: string,
  portalPort: number,
): Promise<boolean> {
  const origin = portalHttpBase(portalPort)
  let configChanged = false

  // 1. Patch allowedOrigins in openclaw.json
  try {
    let config: any = {}
    try { config = JSON.parse(await readFile(configPath, 'utf-8')) } catch {}

    config.gateway = config.gateway ?? {}
    config.gateway.controlUi = config.gateway.controlUi ?? {}
    const existing: string[] = config.gateway.controlUi.allowedOrigins ?? []
    if (config.gateway.controlUi.allowInsecureAuth !== true) {
      config.gateway.controlUi.allowInsecureAuth = true
      configChanged = true
    }
    if (!existing.includes(origin)) {
      config.gateway.controlUi.allowedOrigins = [...existing, origin]
      configChanged = true
    }
    if (configChanged) {
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    }
  } catch (e) {
    console.warn('[gateway-rpc] Failed to patch allowedOrigins:', e)
  }

  // 2. Write device entry to paired.json
  try {
    const deviceKey = await getOrCreateDeviceKey(openclawHome)
    const devicesDir = join(openclawHome, 'devices')
    const pairedPath = join(devicesDir, 'paired.json')
    await mkdir(devicesDir, { recursive: true })

    let paired: Record<string, any> = {}
    try { paired = JSON.parse(await readFile(pairedPath, 'utf-8')) } catch {}

    const { deviceId, publicKeyB64 } = deviceKey
    const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
    const nowMs = Date.now()

    if (!paired[deviceId] || paired[deviceId].platform !== platform) {
      paired[deviceId] = {
        deviceId, publicKey: publicKeyB64, platform, deviceFamily: 'desktop',
        clientId: 'openclaw-control-ui', clientMode: 'ui',
        role: 'operator', roles: ['operator'], scopes: SCOPES, approvedScopes: SCOPES,
        tokens: {}, createdAtMs: paired[deviceId]?.createdAtMs ?? nowMs, approvedAtMs: nowMs,
      }
      await writeFile(pairedPath, JSON.stringify(paired, null, 2), 'utf-8')
    }
  } catch (e) {
    console.warn('[gateway-rpc] Failed to write paired.json:', e)
  }

  // 3. Auto-pair the CLI device so child-process openclaw calls don't need manual pairing
  await patchCliDevice(openclawHome)

  return configChanged
}

// ─── RPC Client ───────────────────────────────────────────────────────────────

type PendingCall = {
  resolve: (val: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class GatewayRpcClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingCall>()
  private connectResolvers: Array<() => void> = []
  private connectRejecters: Array<(e: Error) => void> = []
  private ready = false
  private connecting = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private deviceKey: DeviceKey | null = null
  private gatewayPort: number
  private openclawHome: string
  private portalPort: number
  private gatewayToken = ''
  private eventListeners: Array<(msg: any) => void> = []
  snapshot: any = null

  constructor(gatewayPort: number, openclawHome: string, portalPort: number) {
    this.gatewayPort = gatewayPort
    this.openclawHome = openclawHome
    this.portalPort = portalPort
  }

  /** 订阅 Gateway 推送事件（connect.challenge 除外）。返回取消订阅函数。 */
  onGatewayEvent(callback: (msg: any) => void): () => void {
    this.eventListeners.push(callback)
    return () => {
      this.eventListeners = this.eventListeners.filter(fn => fn !== callback)
    }
  }

  /** 返回 gateway 提供的 mainSessionKey（从 snapshot），如无则返回默认 */
  getMainSessionKey(agentId = 'main'): string {
    const defaults = this.snapshot?.sessionDefaults
    if (defaults?.mainSessionKey) return defaults.mainSessionKey
    return `agent:${agentId}:main`
  }

  /** 向指定 session 发送聊天消息，返回 ACK。响应通过 onGatewayEvent 的 chat 事件推送。 */
  chatSend(sessionKey: string, message: string): Promise<any> {
    return this.request('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
    })
  }

  async request(method: string, params?: object, timeout = REQUEST_TIMEOUT): Promise<any> {
    await this.ensureConnected()
    const id = `req-${randomUUID()}`
    const msg = JSON.stringify({ type: 'req', id, method, params: params ?? {} })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Gateway RPC timeout: ${method}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.ws!.send(msg)
      } catch (e: any) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Gateway send failed: ${e.message}`))
      }
    })
  }

  close() { this._cleanup() }

  private async ensureConnected(): Promise<void> {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) return
    if (this.connecting) {
      return new Promise((resolve, reject) => {
        this.connectResolvers.push(resolve)
        this.connectRejecters.push(reject)
      })
    }
    return this._connect()
  }

  private async _connect(): Promise<void> {
    this.connecting = true
    this.ready = false

    if (!this.deviceKey) {
      this.deviceKey = await getOrCreateDeviceKey(this.openclawHome)
    }
    this.gatewayToken = await getGatewayAuthToken(join(this.openclawHome, 'openclaw.json'))

    return new Promise((resolve, reject) => {
      const connectTimer = setTimeout(() => {
        this._cleanup()
        const err = new Error('Gateway connection timeout')
        reject(err); this._rejectAll(err)
      }, CONNECT_TIMEOUT)

      // Mirror clawpanel: pass gateway token on the WS URL, then sign connect with the same token.
      const origin = portalHttpBase(this.portalPort)
      const tokenQuery = this.gatewayToken ? `?token=${encodeURIComponent(this.gatewayToken)}` : ''
      const ws = new WebSocket(`${gatewayWsBase(this.gatewayPort)}/ws${tokenQuery}`, {
        headers: { origin, 'x-forwarded-user': 'admin' },
      })
      this.ws = ws

      // Fallback: if no challenge arrives, send connect frame proactively
      let challengeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (!this.ready) ws.send(JSON.stringify(buildConnectFrame(this.deviceKey!, '', this.gatewayToken)))
      }, 4000)

      ws.on('open', () => { /* wait for challenge or fallback */ })

      ws.on('message', (raw: Buffer) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }

        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null }
          ws.send(JSON.stringify(buildConnectFrame(this.deviceKey!, msg.payload?.nonce ?? '', this.gatewayToken)))
          return
        }

        if (msg.type === 'res' && typeof msg.id === 'string' && msg.id.startsWith('connect-')) {
          if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null }
          clearTimeout(connectTimer)
          this.connecting = false
          if (!msg.ok || msg.error) {
            const err = new Error(msg.error?.message ?? 'Gateway handshake failed')
            this._cleanup(); reject(err); this._rejectAll(err)
            return
          }
          this.snapshot = msg.payload?.snapshot ?? null
          console.log('[gateway-rpc] connected, mainSessionKey:', this.getMainSessionKey())
          this.ready = true
          this._startPing()
          resolve(); this._resolveAll()
          return
        }

        if (msg.type === 'res' && msg.id) {
          const call = this.pending.get(msg.id)
          if (!call) return
          clearTimeout(call.timer)
          this.pending.delete(msg.id)
          if (!msg.ok || msg.error) call.reject(new Error(msg.error?.message ?? 'RPC error'))
          else call.resolve(msg.payload ?? msg.result)
        }

        // 将 Gateway 推送事件转发给所有订阅者
        if (msg.type === 'event' && msg.event !== 'connect.challenge') {
          if (msg.event === 'chat') {
            console.log('[gateway-rpc] chat event:', msg.payload?.state, 'sessionKey:', msg.payload?.sessionKey, 'listeners:', this.eventListeners.length)
          }
          for (const fn of this.eventListeners) {
            try { fn(msg) } catch {}
          }
        }
      })

      ws.on('close', () => {
        if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null }
        const wasConnecting = this.connecting
        this._cleanup()
        const err = new Error('Gateway connection closed')
        if (wasConnecting) { reject(err); this._rejectAll(err) }
        this.pending.forEach(call => { clearTimeout(call.timer); call.reject(err) })
        this.pending.clear()
      })

      ws.on('error', (e: Error) => {
        if (challengeTimer) { clearTimeout(challengeTimer); challengeTimer = null }
        clearTimeout(connectTimer)
        this.connecting = false
        this._cleanup()
        const err = new Error(`Gateway WebSocket error: ${e.message}`)
        reject(err); this._rejectAll(err)
      })
    })
  }

  private _resolveAll() {
    this.connectResolvers.forEach(fn => fn())
    this.connectResolvers = []; this.connectRejecters = []
  }
  private _rejectAll(err: Error) {
    this.connectRejecters.forEach(fn => fn(err))
    this.connectResolvers = []; this.connectRejecters = []
  }

  private _startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping()
    }, PING_INTERVAL)
  }

  private _cleanup() {
    this.ready = false
    this.connecting = false
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.ws) { try { this.ws.terminate() } catch {}; this.ws = null }
  }
}

let _instance: GatewayRpcClient | null = null

export function getGatewayRpc(gatewayPort: number, openclawHome: string, portalPort: number): GatewayRpcClient {
  if (!_instance) {
    _instance = new GatewayRpcClient(gatewayPort, openclawHome, portalPort)
  }
  return _instance
}
