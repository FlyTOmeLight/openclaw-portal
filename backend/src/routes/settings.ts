import type { FastifyInstance } from 'fastify'
import type { SettingsManager, PortalSettings } from '../services/settings-manager.js'
import { config } from '../config.js'

export async function settingsRoutes(app: FastifyInstance, settingsManager: SettingsManager) {
  app.get('/api/settings', async () => {
    const s = await settingsManager.read()
    return {
      httpProxy: s.httpProxy,
      httpsProxy: s.httpsProxy,
      npmRegistry: s.npmRegistry,
      skillRegistrySources: s.skillRegistrySources,
      activeSkillRegistrySourceId: s.activeSkillRegistrySourceId,
      // Read-only runtime info
      gatewayPort: config.gatewayPort,
      portalPort: config.portalPort,
      openclawHome: config.openclawHome,
    }
  })

  app.put('/api/settings', async (req) => {
    const body = req.body as Partial<PortalSettings>
    const current = await settingsManager.read()
    const updated: PortalSettings = {
      httpProxy: body.httpProxy !== undefined ? body.httpProxy : current.httpProxy,
      httpsProxy: body.httpsProxy !== undefined ? body.httpsProxy : current.httpsProxy,
      npmRegistry: body.npmRegistry !== undefined ? body.npmRegistry : current.npmRegistry,
      skillRegistrySources: body.skillRegistrySources !== undefined
        ? body.skillRegistrySources
        : current.skillRegistrySources,
      activeSkillRegistrySourceId: (body as any).activeSkillRegistrySourceId !== undefined
        ? (body as any).activeSkillRegistrySourceId
        : current.activeSkillRegistrySourceId,
    }
    await settingsManager.write(updated)
    return { ok: true }
  })
}
