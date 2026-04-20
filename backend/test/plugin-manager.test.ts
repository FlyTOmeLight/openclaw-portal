import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginManager } from '../src/services/plugin-manager.js'

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

import * as cp from 'child_process'

describe('PluginManager', () => {
  let manager: PluginManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new PluginManager('/tmp/openclaw-home', 'openclaw')
  })

  it('listInstalled() parses json output and filters bundled plugins', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: `[plugins] warning\n${JSON.stringify({ plugins: [
        { name: '@openclaw/discord', version: '1.0.0', description: 'bundled', origin: 'bundled' },
        { id: 'openclaw-lark', name: '@larksuite/openclaw-lark', version: '1.2.0', description: 'lark', origin: 'global', status: 'loaded', enabled: true, source: '/Users/test/.openclaw/extensions/openclaw-lark/index.js' },
      ] })}`,
      stderr: '',
    } as any)

    const plugins = await manager.listInstalled()
    expect(plugins).toEqual([
      {
        id: 'openclaw-lark',
        name: '@larksuite/openclaw-lark',
        version: '1.2.0',
        description: 'lark',
        status: 'loaded',
        origin: 'global',
        enabled: true,
        source: '/Users/test/.openclaw/extensions/openclaw-lark/index.js',
      },
    ])
  })

  it('install() returns command output', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'installed ok',
      stderr: '',
    } as any)

    const result = await manager.install('@openclaw/test-plugin')
    expect(result).toEqual({
      command: 'openclaw plugins install @openclaw/test-plugin@latest',
      stdout: 'installed ok',
      stderr: '',
    })
  })

  it('install() keeps explicit version or tag', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'installed fixed version',
      stderr: '',
    } as any)

    const result = await manager.install('@openclaw/test-plugin@2026.4.9')
    expect(result.command).toBe('openclaw plugins install @openclaw/test-plugin@2026.4.9')
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'openclaw',
      ['plugins', 'install', '@openclaw/test-plugin@2026.4.9'],
      expect.any(Object),
    )
  })

  it('install() defaults unscoped packages to latest', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'installed latest',
      stderr: '',
    } as any)

    const result = await manager.install('left-pad')
    expect(result.command).toBe('openclaw plugins install left-pad@latest')
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'openclaw',
      ['plugins', 'install', 'left-pad@latest'],
      expect.any(Object),
    )
  })

  it('install() retries with explicit prerelease when latest resolves to beta', async () => {
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Resolved @dingtalk-real-ai/dingtalk-connector@latest to prerelease version 0.8.14-beta.5, but prereleases are only installed when explicitly requested.',
      } as any)
      .mockReturnValueOnce({
        status: 0,
        stdout: 'installed prerelease explicitly',
        stderr: '',
      } as any)

    const result = await manager.install('@dingtalk-real-ai/dingtalk-connector')
    expect(result.command).toBe('openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.14-beta.5')
    expect(vi.mocked(cp.spawnSync)).toHaveBeenNthCalledWith(
      2,
      'openclaw',
      ['plugins', 'install', '@dingtalk-real-ai/dingtalk-connector@0.8.14-beta.5'],
      expect.any(Object),
    )
  })

  it('uninstall() returns command output', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'removed ok',
      stderr: '',
    } as any)

    const result = await manager.uninstall('@openclaw/test-plugin')
    expect(result).toEqual({
      command: 'openclaw plugins uninstall @openclaw/test-plugin',
      stdout: 'removed ok',
      stderr: '',
    })
  })

  it('install() rejects invalid package names', async () => {
    await expect(manager.install('bad package')).rejects.toThrow('Invalid package name')
  })
})
