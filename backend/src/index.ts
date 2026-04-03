import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import { existsSync } from 'fs'
import { config } from './config.js'
import { ConfigManager } from './services/config-manager.js'
import { ProcessManager } from './services/process-manager.js'
import { SkillManager } from './services/skill-manager.js'
import { PluginManager } from './services/plugin-manager.js'
import { ChannelManager } from './services/channel-manager.js'
import { serviceRoutes } from './routes/service.js'
import { modelsRoutes } from './routes/models.js'
import { skillsRoutes } from './routes/skills.js'
import { pluginsRoutes } from './routes/plugins.js'
import { agentsRoutes } from './routes/agents.js'
import { channelsRoutes } from './routes/channels.js'
import { systemRoutes } from './routes/system.js'
import { chatRoutes } from './routes/chat.js'
import { join } from 'path'

const configPath = join(config.openclawHome, 'openclaw.json')

const configManager = new ConfigManager(configPath)
const processManager = new ProcessManager({ openclawBin: config.openclawBin, gatewayPort: config.gatewayPort })
const skillManager = new SkillManager(config.openclawHome)
const pluginManager = new PluginManager(config.openclawHome, config.openclawBin)
const channelManager = new ChannelManager(configPath, config.openclawBin)

const app = Fastify({ logger: true })

await app.register(fastifyCors, { origin: true })
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } })

if (existsSync(config.frontendDist)) {
  await app.register(fastifyStatic, { root: config.frontendDist, prefix: '/' })
  app.setNotFoundHandler(async (req, reply) => {
    if (!req.url.startsWith('/api/')) return reply.sendFile('index.html')
    reply.status(404).send({ error: 'Not found' })
  })
}

await serviceRoutes(app, processManager)
await modelsRoutes(app, configManager)
await skillsRoutes(app, skillManager)
await pluginsRoutes(app, pluginManager)
await agentsRoutes(app, config.openclawHome)
await channelsRoutes(app, channelManager)
await systemRoutes(app, configManager, processManager)
await chatRoutes(app, configManager, config.gatewayPort)

await app.listen({ port: config.portalPort, host: '127.0.0.1' })
