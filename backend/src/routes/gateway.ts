import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'
import type { GatewayConfig } from '../types/openclaw.js'
import { runCli } from '../services/cli-runner.js'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// requestId / deviceId are untrusted user input passed as CLI positional args.
// Restrict charset and reject leading dash to prevent CLI flag injection.
const ID_SAFE_RE = /^[A-Za-z0-9_.:-]{1,128}$/
function isSafeId(s: unknown): s is string {
  return typeof s === 'string' && ID_SAFE_RE.test(s) && !s.startsWith('-')
}

function pickString(source: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function pickNestedString(source: any, paths: string[][]): string | null {
  for (const path of paths) {
    let current = source
    for (const segment of path) current = current?.[segment]
    if (typeof current === 'string' && current.trim()) return current
  }
  return null
}

function pickArray(source: any, keys: string[]): string[] {
  for (const key of keys) {
    const value = source?.[key]
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  }
  return []
}

function pickNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function normalizePendingRequest(entry: any) {
  return {
    requestId: pickString(entry, ['requestId', 'id']) ?? pickNestedString(entry, [['request', 'id']]) ?? '',
    deviceId: pickString(entry, ['deviceId']) ?? pickNestedString(entry, [['device', 'id']]) ?? '',
    publicKey: pickString(entry, ['publicKey']) ?? pickNestedString(entry, [['device', 'publicKey']]),
    role: pickString(entry, ['requestedRole', 'role']) ?? pickNestedString(entry, [['request', 'role']]) ?? '',
    scopes: pickArray(entry, ['requestedScopes', 'scopes']).length
      ? pickArray(entry, ['requestedScopes', 'scopes'])
      : pickArray(entry?.request ?? {}, ['scopes']),
    requestedAtMs: pickNumber(entry, ['requestedAtMs', 'createdAtMs', 'ts']) ?? pickNumber(entry?.request ?? {}, ['requestedAtMs', 'createdAtMs']),
    raw: entry,
  }
}

function normalizePairedDevice(entry: any) {
  return {
    deviceId: pickString(entry, ['deviceId', 'id']) ?? '',
    publicKey: pickString(entry, ['publicKey']),
    platform: pickString(entry, ['platform']),
    deviceFamily: pickString(entry, ['deviceFamily']),
    role: pickString(entry, ['role']) ?? '',
    roles: pickArray(entry, ['roles', 'approvedRoles']),
    scopes: pickArray(entry, ['scopes', 'approvedScopes']),
    approvedAtMs: pickNumber(entry, ['approvedAtMs', 'createdAtMs']),
    raw: entry,
  }
}

function parseDevicesPayload(raw: string): { pendingRequests: any[]; pairedDevices: any[] } {
  let parsed: any = {}
  try { parsed = JSON.parse(raw) } catch {}

  const pendingCandidates = [
    parsed?.pendingRequests,
    parsed?.pending,
    parsed?.requests,
    parsed?.data?.pendingRequests,
    parsed?.data?.pending,
  ]
  const pairedCandidates = [
    parsed?.pairedDevices,
    parsed?.paired,
    parsed?.devices,
    parsed?.approved,
    parsed?.data?.pairedDevices,
    parsed?.data?.paired,
  ]

  const pendingRequests = (pendingCandidates.find(Array.isArray) ?? []).map(normalizePendingRequest)
  const pairedDevices = (pairedCandidates.find(Array.isArray) ?? []).map(normalizePairedDevice)

  return { pendingRequests, pairedDevices }
}

async function gatewayAuthArgs(_configManager: ConfigManager, _gatewayPort?: number): Promise<string[]> {
  // openclaw devices subcommands don't accept --port or --token flags
  return []
}

async function readDevicesFromFiles(): Promise<{ pendingRequests: any[]; pairedDevices: any[] }> {
  const devicesDir = join(process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw'), 'devices')
  const pairedPath = join(devicesDir, 'paired.json')
  const pendingPath = join(devicesDir, 'pending.json')

  let paired: Record<string, any> = {}
  let pending: Record<string, any> = {}

  try { if (existsSync(pairedPath)) paired = JSON.parse(await readFile(pairedPath, 'utf-8')) } catch {}
  try { if (existsSync(pendingPath)) pending = JSON.parse(await readFile(pendingPath, 'utf-8')) } catch {}

  const pairedDevices = Object.values(paired).map(normalizePairedDevice)
  const pendingRequests = Object.values(pending).map(normalizePendingRequest)
  return { pendingRequests, pairedDevices }
}

export async function gatewayRoutes(
  app: FastifyInstance,
  configManager: ConfigManager,
  openclawBin: string,
  gatewayPort?: number,
) {
  app.get('/api/gateway', async () => {
    const cfg = await configManager.read()
    return cfg.gateway ?? {}
  })

  app.put<{ Body: Partial<GatewayConfig> }>('/api/gateway', async (req) => {
    const cfg = await configManager.read()
    const patch = req.body

    // Deep-merge top-level gateway fields
    cfg.gateway = {
      ...cfg.gateway,
      ...(patch.port !== undefined     ? { port: patch.port }     : {}),
      ...(patch.mode !== undefined     ? { mode: patch.mode }     : {}),
      ...(patch.bind !== undefined     ? { bind: patch.bind }     : {}),
      ...(patch.controlUi !== undefined ? {
        controlUi: { ...cfg.gateway.controlUi, ...patch.controlUi },
      } : {}),
      ...(patch.auth !== undefined ? { auth: patch.auth as any } : {}),
      ...(patch.trustedProxies !== undefined ? { trustedProxies: patch.trustedProxies } : {}),
    }

    await configManager.write(cfg)
    return { ok: true }
  })

  app.get('/api/gateway/devices', async (_req, reply) => {
    try {
      return await readDevicesFromFiles()
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || '设备列表加载失败' })
    }
  })

  app.post<{ Body: { requestId?: string } }>('/api/gateway/devices/approve', async (req, reply) => {
    try {
      if (req.body?.requestId && !isSafeId(req.body.requestId)) {
        return reply.status(400).send({ error: 'invalid requestId' })
      }
      const authArgs = await gatewayAuthArgs(configManager, gatewayPort)
      const args = ['devices', 'approve']
      if (req.body?.requestId) args.push(req.body.requestId)
      else args.push('--latest')
      args.push('--json', ...authArgs)
      const output = await runCli(openclawBin, args, { timeout: 15000 })
      return { ok: true, result: (() => { try { return JSON.parse(output) } catch { return output.trim() } })() }
    } catch (err: any) {
      return reply.status(500).send({ error: err.stderr || err.message || '批准设备失败' })
    }
  })

  app.post<{ Body: { requestId: string } }>('/api/gateway/devices/reject', async (req, reply) => {
    try {
      if (!isSafeId(req.body?.requestId)) {
        return reply.status(400).send({ error: 'invalid requestId' })
      }
      const authArgs = await gatewayAuthArgs(configManager, gatewayPort)
      const output = await runCli(openclawBin, ['devices', 'reject', req.body.requestId, '--json', ...authArgs], { timeout: 15000 })
      return { ok: true, result: (() => { try { return JSON.parse(output) } catch { return output.trim() } })() }
    } catch (err: any) {
      return reply.status(500).send({ error: err.stderr || err.message || '拒绝设备失败' })
    }
  })

  app.delete<{ Params: { deviceId: string } }>('/api/gateway/devices/:deviceId', async (req, reply) => {
    try {
      if (!isSafeId(req.params.deviceId)) {
        return reply.status(400).send({ error: 'invalid deviceId' })
      }
      const authArgs = await gatewayAuthArgs(configManager, gatewayPort)
      const output = await runCli(openclawBin, ['devices', 'remove', req.params.deviceId, '--json', ...authArgs], { timeout: 15000 })
      return { ok: true, result: (() => { try { return JSON.parse(output) } catch { return output.trim() } })() }
    } catch (err: any) {
      return reply.status(500).send({ error: err.stderr || err.message || '移除设备失败' })
    }
  })
}
