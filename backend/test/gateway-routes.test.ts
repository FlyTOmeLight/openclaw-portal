import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatewayRoutes } from '../src/routes/gateway.js'

const runCliMock = vi.fn()

vi.mock('../src/services/cli-runner.js', () => ({
  runCli: (...args: any[]) => runCliMock(...args),
}))

describe('gatewayRoutes', () => {
  afterEach(() => {
    runCliMock.mockReset()
  })

  it('lists pending and paired devices from openclaw devices list', async () => {
    runCliMock.mockResolvedValue(JSON.stringify({
      pendingRequests: [
        {
          requestId: 'req-1',
          deviceId: 'dev-pending',
          requestedRole: 'operator',
          requestedScopes: ['operator.read'],
          requestedAtMs: 123,
        },
      ],
      pairedDevices: [
        {
          deviceId: 'dev-paired',
          role: 'operator',
          roles: ['operator'],
          approvedScopes: ['operator.read', 'operator.write'],
          approvedAtMs: 456,
        },
      ],
    }))

    const configManager = {
      read: vi.fn().mockResolvedValue({
        gateway: { auth: { mode: 'token', token: 'gw-token' } },
      }),
      write: vi.fn(),
    }

    const app = Fastify()
    await gatewayRoutes(app, configManager as any, 'openclaw')

    const response = await app.inject({ method: 'GET', url: '/api/gateway/devices' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      pendingRequests: [
        expect.objectContaining({
          requestId: 'req-1',
          deviceId: 'dev-pending',
          role: 'operator',
          scopes: ['operator.read'],
          requestedAtMs: 123,
        }),
      ],
      pairedDevices: [
        expect.objectContaining({
          deviceId: 'dev-paired',
          role: 'operator',
          roles: ['operator'],
          scopes: ['operator.read', 'operator.write'],
          approvedAtMs: 456,
        }),
      ],
    })
    expect(runCliMock).toHaveBeenCalledWith('openclaw', ['devices', 'list', '--json', '--token', 'gw-token'], { timeout: 15000 })

    await app.close()
  })

  it('approves latest pending request when requestId is omitted', async () => {
    runCliMock.mockResolvedValue(JSON.stringify({ ok: true, requestId: 'req-latest' }))

    const configManager = {
      read: vi.fn().mockResolvedValue({
        gateway: { auth: { mode: 'token', token: 'gw-token' } },
      }),
      write: vi.fn(),
    }

    const app = Fastify()
    await gatewayRoutes(app, configManager as any, 'openclaw')

    const response = await app.inject({
      method: 'POST',
      url: '/api/gateway/devices/approve',
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, result: { ok: true, requestId: 'req-latest' } })
    expect(runCliMock).toHaveBeenCalledWith('openclaw', ['devices', 'approve', '--latest', '--json', '--token', 'gw-token'], { timeout: 15000 })

    await app.close()
  })
})
