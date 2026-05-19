import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import type { PluginManager } from '../services/plugin-manager.js'
import type { ProcessManager } from '../services/process-manager.js'
import { PLATFORM_PLUGIN_PACKAGES } from '../services/channel-diagnostics.js'

// Reverse map: plugin package name → platform keys that need it
const PLUGIN_TO_PLATFORMS: Record<string, string[]> = {}
for (const [platform, pkg] of Object.entries(PLATFORM_PLUGIN_PACKAGES)) {
  ;(PLUGIN_TO_PLATFORMS[pkg] ??= []).push(platform)
}

export async function pluginsRoutes(app: FastifyInstance, pluginManager: PluginManager, processManager: ProcessManager) {
  const configPath = join(pluginManager.openclawHome, 'openclaw.json')

  /** Check if any enabled channel depends on the plugin being uninstalled */
  async function checkChannelDependency(pluginName: string): Promise<string | null> {
    // Find which platforms this plugin serves
    const installed = await pluginManager.listInstalled(true)
    const plugin = installed.find(p => p.id === pluginName || p.name === pluginName)
    const resolvedName = plugin?.name ?? pluginName

    // Match against PLATFORM_PLUGIN_PACKAGES values
    let dependentPlatforms: string[] = []
    for (const [pkg, platforms] of Object.entries(PLUGIN_TO_PLATFORMS)) {
      const shortName = pkg.includes('/') ? pkg.split('/').pop()! : pkg
      if (resolvedName === pkg || resolvedName === shortName || pluginName === shortName) {
        dependentPlatforms.push(...platforms)
      }
    }
    if (dependentPlatforms.length === 0) return null

    // Check if any of those platforms have enabled channels in config
    try {
      const raw = await readFile(configPath, 'utf-8')
      const cfg = JSON.parse(raw)
      const channels = cfg.channels ?? {}
      for (const platform of dependentPlatforms) {
        const channelCfg = channels[platform]
        if (channelCfg && typeof channelCfg === 'object' && channelCfg.enabled !== false) {
          return platform
        }
      }
    } catch {}
    return null
  }
  app.get('/api/plugins', async () => {
    return pluginManager.listInstalled()
  })

  app.post<{ Body: { packageName: string } }>(
    '/api/plugins/install',
    async (req, reply) => {
      try {
        const result = await pluginManager.install(req.body.packageName)
        const plugins = await pluginManager.listInstalled()
        processManager.restart().catch(e => app.log.warn(e, 'Gateway restart after plugin install failed'))
        return { ok: true, result, plugins, restarted: true }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      }
    }
  )

  app.post(
    '/api/plugins/install-offline',
    async (req, reply) => {
      const data = await req.file()
      if (!data) return reply.status(400).send({ error: 'No file uploaded' })

      const { filename } = data
      if (!/\.(tgz|tar\.gz|zip)$/i.test(filename)) {
        // drain the stream to avoid memory leak
        data.file.resume()
        return reply.status(400).send({ error: 'Only .tgz / .tar.gz / .zip files are supported' })
      }

      const tmpPath = join(tmpdir(), `openclaw-plugin-${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      try {
        await pipeline(data.file, createWriteStream(tmpPath))
        const result = await pluginManager.installFromFile(tmpPath)
        const plugins = await pluginManager.listInstalled()
        processManager.restart().catch(e => app.log.warn(e, 'Gateway restart after offline plugin install failed'))
        return { ok: true, result, plugins, restarted: true }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      } finally {
        try {
          await unlink(tmpPath)
        } catch (err: any) {
          if (err?.code !== 'ENOENT') {
            app.log.warn({ err, tmpPath }, 'Failed to remove plugin upload tmpfile')
          }
        }
      }
    },
  )

  app.delete<{ Params: { name: string } }>(
    '/api/plugins/:name',
    async (req, reply) => {
      const name = decodeURIComponent(req.params.name)
      try {
        const dependentPlatform = await checkChannelDependency(name)
        if (dependentPlatform) {
          return reply.status(409).send({
            error: `无法卸载：渠道「${dependentPlatform}」正在使用此插件。请先禁用或删除该渠道后再卸载。`,
          })
        }
        const result = await pluginManager.uninstall(name)
        const plugins = await pluginManager.listInstalled()
        processManager.restart().catch(e => app.log.warn(e, 'Gateway restart after plugin uninstall failed'))
        return { ok: true, result, plugins, restarted: true }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      }
    }
  )

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/plugins/search',
    async (req, reply) => {
      const q = (req.query.q ?? '').trim()
      if (!q) return { results: [] }
      const parsedLimit = Number.parseInt(req.query.limit ?? '', 10)
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 25
      try {
        const results = await pluginManager.search(q, limit)
        return { results }
      } catch (err: any) {
        return reply.status(500).send({ error: err.message })
      }
    },
  )

  app.get('/api/plugins/npm-registry', async (_req, reply) => {
    try {
      return { registry: await pluginManager.getNpmRegistry() }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  app.post<{ Body: { registry?: string } }>(
    '/api/plugins/npm-registry',
    async (req, reply) => {
      const registry = (req.body?.registry ?? '').trim()
      if (!registry) {
        return reply.status(400).send({ error: 'registry 不能为空' })
      }
      try {
        return { registry: await pluginManager.setNpmRegistry(registry) }
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    },
  )

  app.post<{ Body: { registry?: string } }>(
    '/api/plugins/npm-registry/ping',
    async (req, reply) => {
      const registry = (req.body?.registry ?? '').trim()
      if (!registry) {
        return reply.status(400).send({ error: 'registry 不能为空' })
      }
      try {
        return await pluginManager.pingNpmRegistry(registry)
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    },
  )
}
