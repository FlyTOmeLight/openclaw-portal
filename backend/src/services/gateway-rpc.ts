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

import { createHash, generateKeyPairSync, createPrivateKey, sign as cryptoSign, randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { WebSocket } from 'ws'
import { gatewayWsBase, portalHttpBase } from '../config.js'

const SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing', 'operator.read', 'operator.write']
// Device key for the gateway-client backend connection. A distinct filename
// (not the legacy portal-device-key.json) guarantees a fresh deviceId, so the
// connect does not collide with any stale paired-device entry left under the
// old `openclaw-control-ui` client identity — which would trip the gateway's
// "device identity changed" rejection.
const KEY_FILE = 'portal-gateway-key.json'
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
  // Protocol 4 device signature payload — must match the gateway's verifier:
  // v2|deviceId|clientId|clientMode|role|scopes|signedAt|token|nonce.
  // clientId/clientMode here MUST match the `client` block below.
  const payloadStr = `v2|${deviceKey.deviceId}|gateway-client|cli|operator|${scopesStr}|${signedAt}|${gatewayToken}|${nonce}`

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
      minProtocol: 4, maxProtocol: 4,
      client: { id: 'gateway-client', version: '1.0.0', platform, deviceFamily: 'server', mode: 'cli' },
      role: 'operator', scopes: SCOPES, caps: ['tool-events'],
      auth: { token: gatewayToken },
      device: { id: deviceKey.deviceId, publicKey: deviceKey.publicKeyB64, signedAt, nonce, signature: sig.toString('base64url') },
      locale: 'zh-CN', userAgent: 'OpenClawPortal/1.0.0',
    },
  }
}

// ─── One-time setup: register portal origin ──────────────────────────────────

/**
 * Register the portal's origin in gateway.controlUi.allowedOrigins.
 *
 * The portal's own device and any child-process `openclaw` CLI both connect as
 * header-free shared-secret loopback clients (see GatewayRpcClient._connect) and
 * are silently auto-paired by the gateway on connect — nothing is pre-seeded
 * into paired.json.
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

      // Connect as a trusted shared-secret loopback client: gateway token on the
      // WS URL, signed connect frame with the same token, and NO origin /
      // x-forwarded-user headers. Any forwarded-header or browser-Origin evidence
      // disqualifies the gateway's shared-secret-loopback path and forces device
      // pairing approval — which deadlocks (approving needs operator.approvals,
      // which the unpaired portal lacks). Header-free → gateway silently auto-pairs.
      const tokenQuery = this.gatewayToken ? `?token=${encodeURIComponent(this.gatewayToken)}` : ''
      const ws = new WebSocket(`${gatewayWsBase(this.gatewayPort)}/ws${tokenQuery}`)
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
