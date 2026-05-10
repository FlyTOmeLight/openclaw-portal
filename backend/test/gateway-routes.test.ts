import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const rpcRequestMock = vi.fn()

vi.mock('../src/services/gateway-rpc.js', () => ({
  getGatewayRpc: () => ({ request: rpcRequestMock }),
}))

import { gatewayRoutes } from '../src/routes/gateway.js'

describe('gatewayRoutes', () => {
  let tmpHome: string

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gateway-routes-test-'))
    await mkdir(join(tmpHome, 'devices'), { recursive: true })
    process.env.OPENCLAW_HOME = tmpHome
    rpcRequestMock.mockReset()
  })

  afterEach(async () => {
    delete process.env.OPENCLAW_HOME
    await rm(tmpHome, { recursive: true, force: true })
  })

  it('lists pending and paired devices from devices/*.json files', async () => {
    await writeFile(join(tmpHome, 'devices', 'pending.json'), JSON.stringify({
      'req-1': {
        requestId: 'req-1',
        deviceId: 'dev-pending',
        requestedRole: 'operator',
        requestedScopes: ['operator.read'],
        requestedAtMs: 123,
      },
    }))
    await writeFile(join(tmpHome, 'devices', 'paired.json'), JSON.stringify({
      'dev-paired': {
        deviceId: 'dev-paired',
        role: 'operator',
        roles: ['operator'],
        approvedScopes: ['operator.read', 'operator.write'],
        approvedAtMs: 456,
      },
    }))

    const configManager = {
      read: vi.fn().mockResolvedValue({ gateway: {} }),
      write: vi.fn(),
    }
    const app = Fastify()
    await gatewayRoutes(app, configManager as any, 'openclaw')

    const response = await app.inject({ method: 'GET', url: '/api/gateway/devices' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.pendingRequests).toHaveLength(1)
    expect(body.pendingRequests[0]).toMatchObject({
      requestId: 'req-1',
      deviceId: 'dev-pending',
      role: 'operator',
      scopes: ['operator.read'],
      requestedAtMs: 123,
    })
    expect(body.pairedDevices).toHaveLength(1)
    expect(body.pairedDevices[0]).toMatchObject({
      deviceId: 'dev-paired',
      role: 'operator',
      roles: ['operator'],
      scopes: ['operator.read', 'operator.write'],
      approvedAtMs: 456,
    })

    await app.close()
  })

  it('approves latest pending request when requestId is omitted', async () => {
    await writeFile(join(tmpHome, 'devices', 'pending.json'), JSON.stringify({
      'req-old': { requestId: 'req-old', requestedAtMs: 100 },
      'req-latest': { requestId: 'req-latest', requestedAtMs: 200 },
    }))
    rpcRequestMock.mockResolvedValueOnce({ ok: true, requestId: 'req-latest' })

    const configManager = {
      read: vi.fn().mockResolvedValue({ gateway: {} }),
      write: vi.fn(),
    }
    const app = Fastify()
    await gatewayRoutes(app, configManager as any, 'openclaw', 18789, tmpHome, 18800)

    const response = await app.inject({
      method: 'POST',
      url: '/api/gateway/devices/approve',
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, result: { ok: true, requestId: 'req-latest' } })
    expect(rpcRequestMock).toHaveBeenCalledWith('device.pair.approve', { requestId: 'req-latest' })

    await app.close()
  })
})
