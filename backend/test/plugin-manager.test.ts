import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { PluginManager } from '../src/services/plugin-manager.js'

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('')),
}))
import * as cp from 'child_process'

describe('PluginManager', () => {
  let tmpDir: string
  let pluginsDir: string
  let manager: PluginManager

  beforeEach(async () => {
    vi.clearAllMocks()
    tmpDir = await mkdtemp(join(tmpdir(), 'plugin-manager-test-'))
    pluginsDir = join(tmpDir, 'plugins')
    await mkdir(pluginsDir, { recursive: true })
    const pkgDir = join(pluginsDir, '@openclaw-china', 'channels')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@openclaw-china/channels',
      version: '1.2.0',
      description: 'OpenClaw channel integrations',
    }))
    manager = new PluginManager(tmpDir, 'openclaw')
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('listInstalled() returns plugins from plugins dir', async () => {
    const plugins = await manager.listInstalled()
    expect(plugins).toHaveLength(1)
    expect(plugins[0].name).toBe('@openclaw-china/channels')
    expect(plugins[0].version).toBe('1.2.0')
  })

  it('install() calls openclaw plugins install', async () => {
    await manager.install('@openclaw-china/dingtalk')
    expect(cp.execSync).toHaveBeenCalledWith(
      'openclaw plugins install @openclaw-china/dingtalk',
      expect.any(Object)
    )
  })

  it('uninstall() calls openclaw plugins uninstall', async () => {
    await manager.uninstall('@openclaw-china/channels')
    expect(cp.execSync).toHaveBeenCalledWith(
      'openclaw plugins uninstall @openclaw-china/channels',
      expect.any(Object)
    )
  })

  it('listInstalled() handles empty plugins dir', async () => {
    const pkgDir = join(pluginsDir, '@openclaw-china')
    await rm(pkgDir, { recursive: true })
    const plugins = await manager.listInstalled()
    expect(plugins).toHaveLength(0)
  })
})
