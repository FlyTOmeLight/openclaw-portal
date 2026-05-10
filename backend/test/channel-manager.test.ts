import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('child_process', () => ({
  execFile: vi.fn((_: string, __: string[], ___: any, cb: (err: any, stdout?: string, stderr?: string) => void) => {
    cb(null, '', '')
  }),
}))

import { ChannelManager } from '../src/services/channel-manager.js'

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

  it('listConfiguredPlatforms returns platform ids and account summaries', async () => {
    const cfg = {
      ...BASE_CONFIG,
      channels: {
        telegram: { enabled: true, botToken: 'tok' },
        feishu: {
          enabled: true,
          accounts: {
            teamA: { appId: 'cli-a', appSecret: 'sec-a' },
            teamB: { appId: 'cli-b', appSecret: 'sec-b' },
          },
        },
        'dingtalk-connector': { enabled: false, clientId: 'ding', clientSecret: 'sec' },
      },
    }
    await writeFile(configPath, JSON.stringify(cfg, null, 2))

    const platforms = await manager.listConfiguredPlatforms()
    expect(platforms).toEqual([
      { id: 'telegram', enabled: true, accounts: [] },
      { id: 'feishu', enabled: true, accounts: [{ accountId: 'teamA', appId: 'cli-a' }, { accountId: 'teamB', appId: 'cli-b' }] },
      { id: 'dingtalk', enabled: false, accounts: [] },
    ])
  })

  it('readPlatformConfig reads qqbot credentials from nested default account', async () => {
    const cfg = {
      ...BASE_CONFIG,
      channels: {
        qqbot: {
          enabled: true,
          accounts: {
            default: { appId: '10001', clientSecret: 'secret-1', token: '10001:secret-1' },
          },
        },
      },
    }
    await writeFile(configPath, JSON.stringify(cfg, null, 2))

    await expect(manager.readPlatformConfig('qqbot')).resolves.toEqual({
      exists: true,
      values: { appId: '10001', clientSecret: 'secret-1' },
    })
  })

  it('saveMessagingPlatform stores multi-account feishu entries under accounts', async () => {
    await manager.saveMessagingPlatform('feishu', { appId: 'cli-app', appSecret: 'app-secret', domain: 'lark' }, 'teamA')

    const written = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts.teamA).toMatchObject({
      enabled: true,
      appId: 'cli-app',
      appSecret: 'app-secret',
      domain: 'lark',
      connectionMode: 'websocket',
    })
  })

  it('saveMessagingPlatform writes Lansenger to accounts and derives accountId from appId when blank', async () => {
    const result = await manager.saveMessagingPlatform(
      'Lansenger',
      { appId: '123123-456789', appSecret: 'sec', apiGatewayUrl: 'https://gw.example.com' },
      null,
    )

    expect(result.accountId).toBe('bot_456789')

    const written = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(written.channels.Lansenger).toMatchObject({ enabled: true })
    expect(written.channels.Lansenger.accounts.bot_456789).toEqual({
      appId: '123123-456789',
      appSecret: 'sec',
      apiGatewayUrl: 'https://gw.example.com',
    })
  })

  it('saveMessagingPlatform respects explicit Lansenger accountId and keeps agentId when provided', async () => {
    const result = await manager.saveMessagingPlatform(
      'Lansenger',
      { appId: 'a-b', appSecret: 'sec', apiGatewayUrl: 'https://gw', agentId: 'coder' },
      'bot_custom',
    )

    expect(result.accountId).toBe('bot_custom')

    const written = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(written.channels.Lansenger.accounts.bot_custom).toEqual({
      appId: 'a-b',
      appSecret: 'sec',
      apiGatewayUrl: 'https://gw',
      agentId: 'coder',
    })
  })

  it('saveMessagingPlatform rejects Lansenger without required fields', async () => {
    await expect(
      manager.saveMessagingPlatform('Lansenger', { appId: '1-2' }, null),
    ).rejects.toThrow(/App Secret|API 网关/)
  })

  it('saveAgentBinding and listAllBindings operate on bindings array', async () => {
    await manager.saveAgentBinding('helper', 'telegram', null, { peer: { kind: 'group', id: 'group-1' } })
    await manager.saveAgentBinding('helper', 'telegram', null, { peer: { kind: 'group', id: 'group-1' } })

    const result = await manager.listAllBindings()
    expect(result.bindings).toHaveLength(1)
    expect(result.bindings[0]).toMatchObject({
      type: 'route',
      agentId: 'helper',
      match: { channel: 'telegram', peer: { kind: 'group', id: 'group-1' } },
    })
  })

  it('removeMessagingPlatform removes specific account bindings only', async () => {
    const cfg = {
      ...BASE_CONFIG,
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            teamA: { appId: 'a', appSecret: 'sa' },
            teamB: { appId: 'b', appSecret: 'sb' },
          },
        },
      },
      bindings: [
        { type: 'route', agentId: 'alpha', match: { channel: 'feishu', accountId: 'teamA' } },
        { type: 'route', agentId: 'beta', match: { channel: 'feishu', accountId: 'teamB' } },
      ],
    }
    await writeFile(configPath, JSON.stringify(cfg, null, 2))

    await manager.removeMessagingPlatform('feishu', 'teamA')

    const written = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts.teamA).toBeUndefined()
    expect(written.channels.feishu.accounts.teamB).toBeDefined()
    expect(written.bindings).toEqual([
      { type: 'route', agentId: 'beta', match: { channel: 'feishu', accountId: 'teamB' } },
    ])
  })
})
