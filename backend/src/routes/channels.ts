import { spawn } from 'child_process'
import type { FastifyInstance } from 'fastify'
import type { ChannelManager } from '../services/channel-manager.js'
import type { PluginManager } from '../services/plugin-manager.js'
import type { ChannelConfig } from '../types/openclaw.js'
import { ChannelVerifier } from '../services/channel-verifier.js'
import { ChannelDiagnostics, PLATFORM_PLUGIN_PACKAGES, buildInstalledKeySet } from '../services/channel-diagnostics.js'

export async function channelsRoutes(
  app: FastifyInstance,
  channelManager: ChannelManager,
  pluginManager: PluginManager,
  gatewayPort: number,
  openclawBin: string,
) {
  const verifier = new ChannelVerifier()
  const diagnostics = new ChannelDiagnostics(gatewayPort)

  app.get('/api/channels', async () => {
    return channelManager.listChannels()
  })

  app.get('/api/channels/platforms', async () => {
    return channelManager.listConfiguredPlatforms()
  })

  app.get<{ Querystring: { platform: string; accountId?: string } }>('/api/channels/platform-config', async (req, reply) => {
    const { platform, accountId } = req.query
    if (!platform) return reply.status(400).send({ error: 'platform required' })
    return channelManager.readPlatformConfig(platform, accountId)
  })

  app.post<{ Body: { platform: string; form: Record<string, any>; accountId?: string | null } }>('/api/channels/platform-config', async (req, reply) => {
    const { platform, form, accountId } = req.body
    if (!platform || !form) return reply.status(400).send({ error: 'platform and form required' })
    await channelManager.saveMessagingPlatform(platform, form, accountId)
    return { ok: true }
  })

  app.delete<{ Body: { platform: string; accountId?: string | null } }>('/api/channels/platform-config', async (req, reply) => {
    const { platform, accountId } = req.body
    if (!platform) return reply.status(400).send({ error: 'platform required' })
    await channelManager.removeMessagingPlatform(platform, accountId)
    return { ok: true }
  })

  app.post<{ Body: { platform: string; enabled: boolean } }>('/api/channels/platform-toggle', async (req, reply) => {
    const { platform, enabled } = req.body
    if (!platform || typeof enabled !== 'boolean') return reply.status(400).send({ error: 'platform and enabled required' })
    await channelManager.toggleMessagingPlatform(platform, enabled)
    return { ok: true }
  })

  app.get('/api/channels/agent-bindings', async () => {
    return channelManager.listAllBindings()
  })

  app.post<{ Body: { agentId: string; channel: string; accountId?: string | null; bindingConfig?: Record<string, any> } }>('/api/channels/agent-bindings', async (req, reply) => {
    const { agentId, channel, accountId, bindingConfig } = req.body
    if (!agentId || !channel) return reply.status(400).send({ error: 'agentId and channel required' })
    await channelManager.saveAgentBinding(agentId, channel, accountId, bindingConfig)
    return { ok: true }
  })

  app.delete<{ Body: { agentId: string; channel: string; accountId?: string | null; bindingConfig?: Record<string, any> } }>('/api/channels/agent-bindings', async (req, reply) => {
    const { agentId, channel, accountId, bindingConfig } = req.body
    if (!agentId || !channel) return reply.status(400).send({ error: 'agentId and channel required' })
    return channelManager.deleteAgentBinding(agentId, channel, accountId, bindingConfig)
  })

  app.get('/api/channels/status', async () => {
    const raw = await channelManager.getStatus()
    return { raw }
  })

  app.get('/api/channels/bindings', async () => {
    return channelManager.listBindings()
  })

  app.put<{ Body: { platform: string; accountId: string; scope: string; agentId: string } }>(
    '/api/channels/bindings',
    async (req) => {
      const { platform, accountId, scope, agentId } = req.body
      await channelManager.setBinding(platform, accountId, scope, agentId)
      return { ok: true }
    },
  )

  app.delete<{ Body: { platform: string; accountId: string; scope: string } }>(
    '/api/channels/bindings',
    async (req) => {
      const { platform, accountId, scope } = req.body
      await channelManager.setBinding(platform, accountId, scope, null)
      return { ok: true }
    },
  )

  app.post<{ Body: { platform: string; form: Record<string, any> } }>(
    '/api/channels/verify',
    async (req, reply) => {
      const { platform, form } = req.body
      if (!platform || !form) return reply.status(400).send({ error: 'platform and form required' })
      const result = await verifier.verify(platform, form)
      return result
    },
  )

  app.post<{ Body: { platform: string; config?: Record<string, any> } }>(
    '/api/channels/diagnose',
    async (req, reply) => {
      const { platform, config } = req.body
      if (!platform) return reply.status(400).send({ error: 'platform required' })
      const plugins = await pluginManager.listInstalled(true)
      const result = await diagnostics.diagnose(platform, config ?? null, plugins)
      return result
    },
  )

  app.get('/api/channels/plugin-status', async () => {
    const plugins = await pluginManager.listInstalled(true)
    const installedKeys = buildInstalledKeySet(plugins)
    const status: Record<string, { required: string; installed: boolean }> = {}
    for (const [platform, pkg] of Object.entries(PLATFORM_PLUGIN_PACKAGES)) {
      const base = pkg.replace(/@[^/@]+$/, '')
      const shortName = base.includes('/') ? base.split('/').pop()! : base
      const installed = installedKeys.has(pkg) || installedKeys.has(base) || installedKeys.has(shortName)
      status[platform] = { required: pkg, installed }
    }
    if (status['qq-bot']) status.qqbot = status['qq-bot']
    if (status.teams) status.msteams = status.teams
    return status
  })

  app.post<{ Body: { platform: string; action: string } }>(
    '/api/channels/action',
    async (req, reply) => {
      const { platform, action } = req.body
      if (!platform || !action) return reply.status(400).send({ error: 'platform and action required' })

      if ((platform === 'wechat' || platform === 'weixin') && action === 'install') {
        return new Promise<{ output: string; ok: boolean }>(resolve => {
          const chunks: string[] = []
          const proc = spawn('npx', ['-y', '@tencent-weixin/openclaw-weixin-cli@latest', 'install'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
          proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))
          const timeout = setTimeout(() => {
            proc.kill()
            resolve({ output: chunks.join(''), ok: true })
          }, 120000)
          proc.on('close', (code) => {
            clearTimeout(timeout)
            resolve({ output: chunks.join(''), ok: code === 0 })
          })
          proc.on('error', (e) => {
            clearTimeout(timeout)
            resolve({ output: e.message, ok: false })
          })
        })
      }

      if ((platform === 'wechat' || platform === 'weixin') && action === 'login') {
        return new Promise<{ output: string; ok: boolean }>(resolve => {
          const chunks: string[] = []
          const proc = spawn(openclawBin, ['channels', 'login', '--channel', 'openclaw-weixin'], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
          proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))
          const timeout = setTimeout(() => {
            proc.kill()
            resolve({ output: chunks.join(''), ok: true })
          }, 20000)
          proc.on('close', () => {
            clearTimeout(timeout)
            resolve({ output: chunks.join(''), ok: true })
          })
          proc.on('error', (e) => {
            clearTimeout(timeout)
            resolve({ output: e.message, ok: false })
          })
        })
      }

      return reply.status(400).send({ error: `Unknown action: ${action} for platform: ${platform}` })
    },
  )

  app.put<{ Params: { name: string }; Body: ChannelConfig }>(
    '/api/channels/:name',
    async (req) => {
      await channelManager.upsertChannel(req.params.name, req.body)
      return { ok: true }
    },
  )

  app.delete<{ Params: { name: string } }>(
    '/api/channels/:name',
    async (req) => {
      await channelManager.removeChannel(req.params.name)
      return { ok: true }
    },
  )
}
