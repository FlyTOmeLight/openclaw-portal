import type { FastifyInstance } from 'fastify'
import type { UpgradeManager } from '../services/upgrade-manager.js'

// Portal web self-upgrade endpoints. The heavy lifting (swap + restart +
// auto-rollback) runs in an independent root transient unit — see
// services/upgrade-manager.ts and offline-install-kylin/portal-upgrade-apply.sh.
export async function upgradeRoutes(app: FastifyInstance, upgrade: UpgradeManager) {
  // Current version + whether a rollback snapshot exists + last apply result.
  app.get('/api/system/version', async () => {
    const [ver, rb, last] = await Promise.all([
      upgrade.getCurrentVersion(),
      upgrade.rollbackInfo(),
      upgrade.readResult(),
    ])
    return {
      version: ver.version,
      builtAt: ver.builtAt,
      supported: upgrade.isSupported(),
      busy: upgrade.isBusy(),
      rollbackAvailable: rb.available,
      rollbackType: rb.type,
      lastResult: last,
    }
  })

  // Public liveness probe (authGuard-exempt): used by the apply script's
  // health-check and by the frontend's post-restart polling.
  app.get('/api/system/ping', async () => {
    const ver = await upgrade.getCurrentVersion()
    return { ok: true, version: ver.version }
  })

  // Upload a .tar.gz upgrade package. The frontend MUST append the `confirm`
  // field before the file part so it is parsed by the time req.file() returns.
  app.post('/api/system/upgrade', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: '未收到上传文件' })

    const confirm = (data.fields as any)?.confirm?.value
    if (confirm !== 'true' && confirm !== true) {
      data.file.resume()
      return reply.status(400).send({ error: '升级需要显式确认（confirm）' })
    }
    const filename = data.filename ?? ''
    if (!/\.(tar\.gz|tgz)$/i.test(filename)) {
      data.file.resume()
      return reply.status(400).send({ error: '升级包必须是 .tar.gz 文件' })
    }

    try {
      return await upgrade.stageAndApply(data.file)
    } catch (err: any) {
      const msg = err?.message ?? '升级失败'
      return reply.status(/进行中/.test(msg) ? 409 : 400).send({ error: msg })
    }
  })

  app.post('/api/system/upgrade/rollback', async (_req, reply) => {
    try {
      return await upgrade.rollback()
    } catch (err: any) {
      const msg = err?.message ?? '回滚失败'
      return reply.status(/进行中/.test(msg) ? 409 : 400).send({ error: msg })
    }
  })

  // Polled by the frontend during a backend upgrade to learn the outcome.
  app.get('/api/system/upgrade/status', async () => {
    return upgrade.getStatus()
  })
}
