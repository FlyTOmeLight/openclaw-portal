import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { ChannelManager } from '../src/services/channel-manager.js'

vi.mock('child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }),
}))
import * as cp from 'child_process'

const BASE_CONFIG = {
  models: { providers: {} },
  agents: { defaults: { model: { primary: 'test/model', fallbacks: [] } } },
  gateway: {
    port: 18789, mode: 'local', bind: 'loopback',
    controlUi: { enabled: true, allowedOrigins: [] },
    auth: { mode: 'trusted-proxy', trustedProxy: { userHeader: 'x-forwarded-user', requiredHeaders: [], allowUsers: ['admin'] } },
    trustedProxies: ['127.0.0.1'],
  },
}

describe('ChannelManager', () => {
  let tmpDir: string
  let configPath: string
  let manager: ChannelManager

  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await mkdtemp(join(tmpdir(), 'channel-manager-test-'))
    configPath = join(tmpDir, 'openclaw.json')
    await writeFile(configPath, JSON.stringify(BASE_CONFIG, null, 2))
    manager = new ChannelManager(configPath, 'openclaw')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('listChannels() returns empty object when no channels configured', async () => {
    const channels = await manager.listChannels()
    expect(channels).toEqual({})
  })

  it('listChannels() returns configured channels', async () => {
    const cfg = { ...BASE_CONFIG, channels: { telegram: { enabled: true, botToken: 'tok' } } }
    await writeFile(configPath, JSON.stringify(cfg, null, 2))
    const channels = await manager.listChannels()
    expect(channels['telegram']).toMatchObject({ enabled: true, botToken: 'tok' })
  })

  it('upsertChannel() adds a new channel to openclaw.json', async () => {
    await manager.upsertChannel('telegram', { enabled: true, botToken: 'abc123', dmPolicy: 'pairing' })
    const channels = await manager.listChannels()
    expect(channels['telegram'].botToken).toBe('abc123')
  })

  it('upsertChannel() updates existing channel', async () => {
    await manager.upsertChannel('telegram', { enabled: true, botToken: 'old' })
    await manager.upsertChannel('telegram', { enabled: false, botToken: 'new' })
    const channels = await manager.listChannels()
    expect(channels['telegram'].enabled).toBe(false)
    expect(channels['telegram'].botToken).toBe('new')
  })

  it('removeChannel() deletes channel from config', async () => {
    await manager.upsertChannel('telegram', { enabled: true })
    await manager.removeChannel('telegram')
    const channels = await manager.listChannels()
    expect(channels['telegram']).toBeUndefined()
  })

  it('getStatus() calls openclaw channels status', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: Buffer.from('telegram: connected\n'),
      stderr: Buffer.from(''),
    } as any)
    const status = await manager.getStatus()
    expect(cp.spawnSync).toHaveBeenCalledWith('openclaw', ['channels', 'status'], expect.any(Object))
    expect(status).toContain('telegram')
  })
})
