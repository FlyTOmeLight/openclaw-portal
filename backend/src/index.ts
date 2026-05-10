import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import fastifyWebsocket from '@fastify/websocket'
import { existsSync } from 'fs'
import { config } from './config.js'
import { ConfigManager } from './services/config-manager.js'
import { ProcessManager } from './services/process-manager.js'
import { SkillManager } from './services/skill-manager.js'
import { PluginManager } from './services/plugin-manager.js'
import { ChannelManager } from './services/channel-manager.js'
import { UsageTracker } from './services/usage-tracker.js'
import { DiagnosisService } from './services/diagnosis.js'
import { StatusBroadcaster } from './services/status-broadcaster.js'
import { serviceRoutes } from './routes/service.js'
import { modelsRoutes } from './routes/models.js'
import { skillsRoutes } from './routes/skills.js'
import { pluginsRoutes } from './routes/plugins.js'
import { agentsRoutes } from './routes/agents.js'
import { channelsRoutes } from './routes/channels.js'
import { systemRoutes } from './routes/system.js'
import { chatRoutes } from './routes/chat.js'
import { memoryRoutes } from './routes/memory.js'
import { usageRoutes } from './routes/usage.js'
import { diagnosisRoutes } from './routes/diagnosis.js'
import { logsRoutes } from './routes/logs.js'
import { settingsRoutes } from './routes/settings.js'
import { gatewayRoutes } from './routes/gateway.js'
import { configEditorRoutes } from './routes/config-editor.js'
import { cronRoutes } from './routes/cron.js'
import { commandLogRoutes } from './routes/command-log.js'
import { filesRoutes } from './routes/files.js'
import { sessionsRoutes } from './routes/sessions.js'
import { terminalRoutes } from './routes/terminal.js'
import { auditRoutes } from './routes/audit.js'
import { AuditLog } from './services/audit-log.js'
import { matchAuditRule } from './services/audit-mapper.js'
import { activityRoutes } from './routes/activity.js'
import { ActivityStream } from './services/activity-stream.js'
import { backupRoutes } from './routes/backup.js'
import { mcpRoutes } from './routes/mcp.js'
import { notificationsRoutes } from './routes/notifications.js'
import { healthRoutes } from './routes/health.js'
import { envcheckRoutes } from './routes/envcheck.js'
import { operatorOverviewRoutes } from './routes/operator-overview.js'
import { patchGatewayAccess, getGatewayRpc } from './services/gateway-rpc.js'
import { SettingsManager } from './services/settings-manager.js'
import { AuthService } from './services/auth.js'
import { recordRequest } from './services/request-log.js'
import { authRoutes, authGuard } from './routes/auth.js'
import fastifyCookie from '@fastify/cookie'
import { join } from 'path'

const configPath = join(config.openclawHome, 'openclaw.json')
const settingsPath = join(config.openclawHome, 'portal-settings.json')

const configManager = new ConfigManager(configPath)
const processManager = new ProcessManager({ openclawBin: config.openclawBin, gatewayPort: config.gatewayPort, openclawHome: config.openclawHome })
const skillManager = new SkillManager(config.openclawHome)
const pluginManager = new PluginManager(config.openclawHome, config.openclawBin)
const channelManager = new ChannelManager(configPath, config.openclawBin)
const usageTracker = new UsageTracker(config.openclawHome)
const diagnosis = new DiagnosisService(configManager, config.openclawBin, config.openclawHome, config.gatewayPort)
const broadcaster = new StatusBroadcaster()
const settingsManager = new SettingsManager(settingsPath)
const authService = new AuthService(config.openclawHome)
await authService.init()
const auditLog = new AuditLog(config.openclawHome)
const activityStream = new ActivityStream()
activityStream.attach(getGatewayRpc(config.gatewayPort, config.openclawHome, config.portalPort))

const app = Fastify({ logger: true, trustProxy: false })

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

app.addHook('onRequest', async (req, reply) => {
  if (!LOOPBACK_IPS.has(req.ip)) {
    req.log.warn({ ip: req.ip, url: req.url }, 'Rejected non-loopback request')
    return reply.code(403).send({ error: 'Forbidden: Portal must be accessed via nginx' })
  }
})

await app.register(fastifyCors, { origin: true })
await app.register(fastifyCookie)
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } })
await app.register(fastifyWebsocket)

// Auto-mirror every /api/* route as /portal/api/* so direct-access (without
// nginx prefix-strip) skips the 307 and serves the response in one hop.
// Uses onRoute hook to register a duplicate after each /api/* is declared.
const _mirrored = new Set<string>()
app.addHook('onRoute', (routeOptions) => {
  const url = routeOptions.url
  if (typeof url !== 'string') return
  if (!url.startsWith('/api/')) return
  if (url.startsWith('/api/ws')) return
  const method = Array.isArray(routeOptions.method) ? routeOptions.method.join(',') : routeOptions.method
  const key = `${method} ${url}`
  if (_mirrored.has(key)) return
  _mirrored.add(key)
  queueMicrotask(() => {
    try { app.route({ ...routeOptions, url: '/portal' + url } as any) } catch {}
  })
})

// Auth routes (login/logout/check/change-password) — must be before auth guard
await authRoutes(app, authService)
// Auth guard — blocks unauthenticated API requests (except /api/auth/*)
app.addHook('onRequest', authGuard(authService))

// Request log middleware (only track /api/* calls, skip WS and static)
app.addHook('onResponse', (req, reply, done) => {
  if ((req.url.startsWith('/api/') || req.url.startsWith('/portal/api/')) && !req.url.includes('/api/ws')) {
    recordRequest({
      ts: Date.now(),
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    })
    // Audit trail: only record state-changing operations matching a declared rule
    const rule = matchAuditRule(req.method, req.url)
    if (rule) {
      auditLog.record({
        ts: Date.now(),
        actor: 'admin',
        action: rule.action,
        target: rule.target,
        method: req.method,
        url: req.url.replace(/^\/portal/, ''),
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        result: reply.statusCode < 400 ? 'success' : 'failure',
      })
    }
  }
  done()
})


if (existsSync(config.frontendDist)) {
  await app.register(fastifyStatic, { root: config.frontendDist, prefix: '/' })
  app.setNotFoundHandler(async (req, reply) => {
    if (!req.url.startsWith('/api/')) return reply.sendFile('index.html')
    reply.status(404).send({ error: 'Not found' })
  })
}

await serviceRoutes(app, processManager, broadcaster)
await modelsRoutes(app, configManager)
await skillsRoutes(app, skillManager, settingsManager)
await pluginsRoutes(app, pluginManager, processManager)
await agentsRoutes(app, config.openclawHome, config.openclawBin, configManager)
await channelsRoutes(app, channelManager, pluginManager, config.gatewayPort, config.openclawBin)
await systemRoutes(app, configManager, processManager)
await chatRoutes(app, config.gatewayPort, config.openclawHome, config.portalPort, usageTracker)
await memoryRoutes(app, config.openclawHome, configManager)
await usageRoutes(app, usageTracker, config.openclawHome)
await diagnosisRoutes(app, diagnosis, processManager, configManager)
await logsRoutes(app, processManager)
await settingsRoutes(app, settingsManager)
await gatewayRoutes(app, configManager, config.openclawBin, config.gatewayPort, config.openclawHome, config.portalPort)
await configEditorRoutes(app, configPath, config.openclawHome)
await cronRoutes(app, config.gatewayPort, config.openclawHome, config.portalPort)
await commandLogRoutes(app)
await filesRoutes(app)
await sessionsRoutes(app, config.openclawHome)
await terminalRoutes(app, auditLog)
await auditRoutes(app, auditLog)
await activityRoutes(app, activityStream)
await backupRoutes(app, config.openclawHome)
await mcpRoutes(app, config.openclawHome, config.openclawBin)
await notificationsRoutes(app, auditLog, processManager, config.openclawHome)
await healthRoutes(app, processManager, configManager, auditLog, config.openclawHome)
await envcheckRoutes(app, processManager, settingsManager, config.openclawHome, config.openclawBin, config.gatewayPort, config.portalPort)
await operatorOverviewRoutes(app, channelManager, authService, config.openclawBin, config.openclawHome, config.gatewayPort, config.portalPort)

// WebSocket endpoint for real-time service status
app.get('/api/ws', { websocket: true }, (socket) => {
  broadcaster.addClient(socket)
  socket.on('close', () => broadcaster.removeClient(socket))
})

// Support direct backend access at http://127.0.0.1:18800/portal/.
// Nginx strips the /portal prefix, but direct access does not.
app.get('/portal/assets/*', async (req, reply) => {
  const target = req.raw.url?.slice('/portal'.length) ?? '/assets'
  return reply.code(307).redirect(target)
})

app.get('/portal/api/ws', { websocket: true }, (socket) => {
  broadcaster.addClient(socket)
  socket.on('close', () => broadcaster.removeClient(socket))
})

app.all('/portal/api/*', async (req, reply) => {
  const target = req.raw.url?.slice('/portal'.length) ?? '/api'
  return reply.code(307).redirect(target)
})

// Register portal as a trusted WebSocket client in Gateway config.
// This writes allowedOrigins + paired.json so cron RPC works without manual pairing.
// If the config changed, restart the gateway in the background (non-blocking).
patchGatewayAccess(config.openclawHome, configPath, config.portalPort).then(changed => {
  if (changed) {
    console.log('[portal] Gateway config updated (allowedOrigins). Restarting gateway in background...')
    processManager.restart().catch(e => console.warn('[portal] Gateway restart failed:', e))
  }
}).catch(e => console.warn('[portal] patchGatewayAccess failed:', e))

await app.listen({ port: config.portalPort, host: '127.0.0.1' })
