import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { PluginManager } from '../src/services/plugin-manager.js'

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}))

import * as cp from 'child_process'

describe('PluginManager', () => {
  let manager: PluginManager
  let tmpHome: string

  beforeEach(async () => {
    vi.clearAllMocks()
    tmpHome = await mkdtemp(join(tmpdir(), 'plugin-mgr-test-'))
    manager = new PluginManager(tmpHome, 'openclaw')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(tmpHome, { recursive: true, force: true })
  })

  it('listInstalled() reads plugins from openclaw.json config', async () => {
    await writeFile(join(tmpHome, 'openclaw.json'), JSON.stringify({
      plugins: {
        installs: {
          'openclaw-lark': {
            resolvedName: '@larksuite/openclaw-lark',
            resolvedVersion: '1.2.0',
            source: 'global',
            installPath: join(tmpHome, 'extensions/openclaw-lark'),
            resolvedSpec: '/Users/test/.openclaw/extensions/openclaw-lark/index.js',
          },
        },
        entries: { 'openclaw-lark': { enabled: true } },
      },
    }))

    const plugins = await manager.listInstalled()
    expect(plugins).toEqual([
      {
        id: 'openclaw-lark',
        name: '@larksuite/openclaw-lark',
        version: '1.2.0',
        description: '',
        status: 'active',
        origin: 'global',
        enabled: true,
        source: '/Users/test/.openclaw/extensions/openclaw-lark/index.js',
      },
    ])
  })

  it('install() returns command output with npm: prefix', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'installed ok',
      stderr: '',
    } as any)

    const result = await manager.install('@openclaw/test-plugin')
    expect(result).toEqual({
      command: 'openclaw plugins install npm:@openclaw/test-plugin@latest',
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
    expect(result.command).toBe('openclaw plugins install npm:@openclaw/test-plugin@2026.4.9')
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'openclaw',
      ['plugins', 'install', 'npm:@openclaw/test-plugin@2026.4.9', '--dangerously-force-unsafe-install'],
      expect.any(Object),
    )
  })

  it('install() defaults unscoped packages to latest with npm: prefix', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'installed latest',
      stderr: '',
    } as any)

    const result = await manager.install('left-pad')
    expect(result.command).toBe('openclaw plugins install npm:left-pad@latest')
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'openclaw',
      ['plugins', 'install', 'npm:left-pad@latest', '--dangerously-force-unsafe-install'],
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
    expect(result.command).toBe('openclaw plugins install npm:@dingtalk-real-ai/dingtalk-connector@0.8.14-beta.5')
    expect(vi.mocked(cp.spawnSync)).toHaveBeenNthCalledWith(
      2,
      'openclaw',
      ['plugins', 'install', 'npm:@dingtalk-real-ai/dingtalk-connector@0.8.14-beta.5', '--dangerously-force-unsafe-install'],
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

  it('install() keeps an explicit npm: prefix without doubling it', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ status: 0, stdout: 'ok', stderr: '' } as any)
    const result = await manager.install('npm:left-pad')
    expect(result.command).toBe('openclaw plugins install npm:left-pad@latest')
  })

  it('install() passes a clawhub: spec through untouched', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({ status: 0, stdout: 'ok', stderr: '' } as any)
    const result = await manager.install('clawhub:some-plugin')
    expect(result.command).toBe('openclaw plugins install clawhub:some-plugin')
  })

  it('install() retries prerelease correctly when openclaw echoes the npm: prefix', async () => {
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Resolved npm:@dingtalk-real-ai/dingtalk-connector@latest to prerelease version 0.8.14-beta.5, but prereleases are only installed when explicitly requested.',
      } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'installed beta', stderr: '' } as any)

    const result = await manager.install('@dingtalk-real-ai/dingtalk-connector')
    expect(result.command).toBe('openclaw plugins install npm:@dingtalk-real-ai/dingtalk-connector@0.8.14-beta.5')
  })

  it('getNpmRegistry() returns the trimmed npm config value', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'https://registry.npmmirror.com/\n',
      stderr: '',
    } as any)
    expect(await manager.getNpmRegistry()).toBe('https://registry.npmmirror.com/')
  })

  it('setNpmRegistry() rejects a non-http(s) URL', async () => {
    await expect(manager.setNpmRegistry('ftp://example.com')).rejects.toThrow('http')
  })

  it('setNpmRegistry() rejects an unparseable URL', async () => {
    await expect(manager.setNpmRegistry('not a url')).rejects.toThrow('Invalid registry URL')
  })

  it('setNpmRegistry() writes a valid URL and returns the new value', async () => {
    vi.mocked(cp.spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as any)
      .mockReturnValueOnce({ status: 0, stdout: 'https://registry.npmmirror.com/\n', stderr: '' } as any)
    const result = await manager.setNpmRegistry('https://registry.npmmirror.com')
    expect(result).toBe('https://registry.npmmirror.com/')
    expect(cp.spawnSync).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['config', 'set', 'registry', 'https://registry.npmmirror.com/'],
      expect.any(Object),
    )
  })

  it('pingNpmRegistry() reports ok with parsed latency', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: '',
      stderr: 'npm notice PING https://registry.npmmirror.com/\nnpm notice PONG 142ms\n',
    } as any)
    const result = await manager.pingNpmRegistry('https://registry.npmmirror.com')
    expect(result.ok).toBe(true)
    expect(result.ms).toBe(142)
  })

  it('pingNpmRegistry() reports failure on non-zero exit', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'npm error network request failed',
    } as any)
    const result = await manager.pingNpmRegistry('https://registry.npmmirror.com')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('network')
  })

  it('getNpmRegistry() throws when npm cannot be spawned', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: null,
      stdout: null,
      stderr: null,
      error: new Error('spawnSync npm ENOENT'),
    } as any)
    await expect(manager.getNpmRegistry()).rejects.toThrow('npm 不可用')
  })

  it('search() returns only packages whose manifest has an openclaw field', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0,
      stdout: 'https://registry.npmmirror.com/\n',
      stderr: '',
    } as any) // getNpmRegistry

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({
          objects: [
            { package: { name: 'plugin-a', version: '1.0.0', description: 'desc a' } },
            { package: { name: 'not-a-plugin', version: '2.0.0', description: 'desc b' } },
          ],
        }), { status: 200 })
      }
      if (url.includes('/plugin-a/latest')) {
        return new Response(JSON.stringify({
          name: 'plugin-a', version: '1.0.0', description: 'desc a',
          openclaw: { install: { npmSpec: 'plugin-a' } },
        }), { status: 200 })
      }
      if (url.includes('/not-a-plugin/latest')) {
        return new Response(JSON.stringify({ name: 'not-a-plugin', version: '2.0.0' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await manager.search('plugin')
    expect(results).toEqual([
      { name: 'plugin-a', version: '1.0.0', description: 'desc a', npmSpec: 'plugin-a', installed: false },
    ])
    // the npm search query is biased toward OpenClaw packages
    const searchCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/-/v1/search'))
    expect(String(searchCall?.[0])).toContain('text=plugin%20openclaw')
  })

  it('search() returns empty array for a blank query', async () => {
    expect(await manager.search('   ')).toEqual([])
  })

  it('search() throws a friendly error when the registry is unreachable', async () => {
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0, stdout: 'https://registry.npmmirror.com/\n', stderr: '',
    } as any)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
    await expect(manager.search('plugin')).rejects.toThrow('无法连接 npm 源')
  })

  it('search() marks a result installed when it is already in the config', async () => {
    await writeFile(join(tmpHome, 'openclaw.json'), JSON.stringify({
      plugins: {
        installs: {
          'plugin-a': {
            resolvedName: 'plugin-a',
            resolvedVersion: '1.0.0',
            source: 'npm',
            installPath: join(tmpHome, 'extensions/plugin-a'),
          },
        },
        entries: { 'plugin-a': { enabled: true } },
      },
    }))
    vi.mocked(cp.spawnSync).mockReturnValue({
      status: 0, stdout: 'https://registry.npmmirror.com/\n', stderr: '',
    } as any)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/-/v1/search')) {
        return new Response(JSON.stringify({
          objects: [{ package: { name: 'plugin-a', version: '1.0.0', description: 'desc a' } }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        name: 'plugin-a', version: '1.0.0', description: 'desc a',
        openclaw: { install: { npmSpec: 'plugin-a' } },
      }), { status: 200 })
    }))
    const results = await manager.search('plugin')
    expect(results).toEqual([
      { name: 'plugin-a', version: '1.0.0', description: 'desc a', npmSpec: 'plugin-a', installed: true },
    ])
  })
})
