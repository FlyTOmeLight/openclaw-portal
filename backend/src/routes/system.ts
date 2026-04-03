import type { FastifyInstance } from 'fastify'
import { getSystemStats } from '../services/system-stats.js'
import type { ConfigManager } from '../services/config-manager.js'
import type { ProcessManager } from '../services/process-manager.js'

export async function systemRoutes(
  app: FastifyInstance,
  configManager: ConfigManager,
  processManager: ProcessManager,
) {
  app.get('/api/system/stats', async () => {
    const [sys, svcStatus, cfg] = await Promise.all([
      getSystemStats(),
      processManager.getStatus(),
      configManager.read(),
    ])
    return {
      system: sys,
      service: svcStatus,
      model: cfg.agents?.defaults?.model?.primary ?? null,
      channelCount: Object.keys(cfg.channels ?? {}).filter(k => cfg.channels![k].enabled).length,
    }
  })
}
