/**
 * Dreaming routes tests.
 *
 * 重点覆盖 `/api/dreaming/status` 的 timeout-retry-initializing 路径 —
 * 这是用户在 portal Dreaming 页报「状态加载失败:Gateway RPC timeout:
 * doctor.memory.status」的根因修复(冷启动时 memory-core lazy-init 慢于
 * 默认 RPC timeout)。
 */
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const rpcRequestMock = vi.fn()

vi.mock('../src/services/gateway-rpc.js', () => ({
  getGatewayRpc: () => ({ request: rpcRequestMock }),
}))

import { dreamingRoutes } from '../src/routes/dreaming.js'

function buildApp(tmpHome: string) {
  const app = Fastify()
  const processManager = { restart: vi.fn() } as any
  // dreamingRoutes(app, gatewayPort, openclawHome, portalPort, processManager)
  return dreamingRoutes(app, 18789, tmpHome, 18800, processManager).then(() => app)
}

describe('dreamingRoutes /api/dreaming/status', () => {
  let tmpHome: string

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'dreaming-routes-test-'))
    await mkdir(join(tmpHome, 'devices'), { recursive: true })
    rpcRequestMock.mockReset()
  })

  afterEach(async () => {
    await rm(tmpHome, { recursive: true, force: true })
  })

  it('returns dreaming payload on first success', async () => {
    rpcRequestMock.mockResolvedValueOnce({
      agentId: 'main',
      dreaming: { enabled: true, phases: { light: {}, deep: {}, rem: {} } },
    })

    const app = await buildApp(tmpHome)
    const res = await app.inject({ method: 'GET', url: '/api/dreaming/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.agentId).toBe('main')
    expect(body.dreaming.enabled).toBe(true)
    expect(body.initializing).toBeUndefined()
    expect(rpcRequestMock).toHaveBeenCalledTimes(1)
    // 现在路由用 30s timeout 显式传给 RPC client
    expect(rpcRequestMock).toHaveBeenCalledWith('doctor.memory.status', {}, 30_000)
    await app.close()
  })

  it('retries once when first call hits Gateway RPC timeout', async () => {
    rpcRequestMock
      .mockRejectedValueOnce(new Error('Gateway RPC timeout: doctor.memory.status'))
      .mockResolvedValueOnce({ agentId: 'main', dreaming: { enabled: false } })

    const app = await buildApp(tmpHome)
    const res = await app.inject({ method: 'GET', url: '/api/dreaming/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.dreaming.enabled).toBe(false)
    expect(body.initializing).toBeUndefined()
    expect(rpcRequestMock).toHaveBeenCalledTimes(2)
    await app.close()
  }, 10_000)

  it('returns 200 + initializing:true when both attempts timeout', async () => {
    rpcRequestMock
      .mockRejectedValueOnce(new Error('Gateway RPC timeout: doctor.memory.status'))
      .mockRejectedValueOnce(new Error('Gateway RPC timeout: doctor.memory.status'))

    const app = await buildApp(tmpHome)
    const res = await app.inject({ method: 'GET', url: '/api/dreaming/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.initializing).toBe(true)
    expect(body.dreaming).toBeNull()
    expect(body.agentId).toBe('main')
    expect(typeof body.error).toBe('string')
    expect(rpcRequestMock).toHaveBeenCalledTimes(2)
    await app.close()
  }, 10_000)

  it('does not retry on non-timeout RPC errors; returns 502', async () => {
    rpcRequestMock.mockRejectedValueOnce(new Error('connection refused'))

    const app = await buildApp(tmpHome)
    const res = await app.inject({ method: 'GET', url: '/api/dreaming/status' })
    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.error).toContain('connection refused')
    expect(rpcRequestMock).toHaveBeenCalledTimes(1)
    await app.close()
  })
})
