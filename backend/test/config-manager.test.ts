import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { ConfigManager } from '../src/services/config-manager.js'
import type { OpenclawConfig } from '../src/types/openclaw.js'

const MINIMAL_CONFIG: OpenclawConfig = {
  models: {
    providers: {
      'test-provider': {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        models: [{
          id: 'test-model',
          name: 'Test Model',
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 8192,
        }],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: 'test-provider/test-model', fallbacks: [] },
    },
  },
  gateway: {
    port: 18789,
    mode: 'local',
    bind: 'loopback',
    controlUi: { enabled: true, allowedOrigins: [] },
    auth: {
      mode: 'trusted-proxy',
      trustedProxy: {
        userHeader: 'x-forwarded-user',
        requiredHeaders: ['x-forwarded-proto', 'x-forwarded-host'],
        allowUsers: ['admin'],
      },
    },
    trustedProxies: ['127.0.0.1'],
  },
}

describe('ConfigManager', () => {
  let tmpDir: string
  let configPath: string
  let manager: ConfigManager

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'openclaw-portal-test-'))
    configPath = join(tmpDir, 'openclaw.json')
    await writeFile(configPath, JSON.stringify(MINIMAL_CONFIG, null, 2))
    manager = new ConfigManager(configPath)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('read() returns parsed config', async () => {
    const cfg = await manager.read()
    expect(cfg.gateway.port).toBe(18789)
    expect(Object.keys(cfg.models.providers)).toContain('test-provider')
  })

  it('write() persists changes', async () => {
    const cfg = await manager.read()
    cfg.gateway.port = 19999
    await manager.write(cfg)
    const raw = JSON.parse(await readFile(configPath, 'utf-8'))
    expect(raw.gateway.port).toBe(19999)
  })

  it('updateProvider() adds a new provider', async () => {
    await manager.updateProvider('new-provider', {
      baseUrl: 'https://new.example.com/v1',
      apiKey: 'sk-new',
      api: 'openai-completions',
      models: [{
        id: 'new-model', name: 'New Model', reasoning: false,
        input: ['text'], contextWindow: 32768, maxTokens: 4096,
      }],
    })
    const cfg = await manager.read()
    expect(cfg.models.providers['new-provider'].baseUrl).toBe('https://new.example.com/v1')
  })

  it('removeProvider() deletes a provider', async () => {
    await manager.removeProvider('test-provider')
    const cfg = await manager.read()
    expect(cfg.models.providers['test-provider']).toBeUndefined()
  })

  it('setPrimaryModel() updates agents.defaults.model.primary', async () => {
    await manager.setPrimaryModel('test-provider/test-model')
    const cfg = await manager.read()
    expect(cfg.agents.defaults.model.primary).toBe('test-provider/test-model')
  })
})
