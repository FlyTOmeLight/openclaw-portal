import type { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'

// Files and directories included in a backup. Chosen to cover configuration
// and operational history while excluding large volatile data (sessions, logs,
// workspaces) that can be regenerated.
const BACKUP_ITEMS = [
  'openclaw.json',         // core gateway config
  'portal-auth.json',      // admin password hash (scrypt-hashed, not plaintext)
  'portal-device-key.json',// Ed25519 device identity for gateway pairing
  'portal-settings.json',  // portal preferences
  'portal-usage.json',     // token/cost history
  'audit.log',             // audit trail
  'config-backups',        // historical config snapshots
  'cron',                  // cron jobs
  'memory',                // memory files
  'SOUL.md',               // agent persona
] as const

interface BackupManifestEntry {
  path: string
  exists: boolean
  size: number
  kind: 'file' | 'directory' | 'missing'
}

function inspect(home: string): BackupManifestEntry[] {
  return BACKUP_ITEMS.map(rel => {
    const abs = join(home, rel)
    if (!existsSync(abs)) return { path: rel, exists: false, size: 0, kind: 'missing' as const }
    const st = statSync(abs)
    return {
      path: rel,
      exists: true,
      size: st.isDirectory() ? 0 : st.size,
      kind: st.isDirectory() ? ('directory' as const) : ('file' as const),
    }
  })
}

export async function backupRoutes(app: FastifyInstance, openclawHome: string) {
  // Manifest endpoint — lets the frontend preview what would be included
  app.get('/api/backup/manifest', async () => {
    const items = inspect(openclawHome)
    const present = items.filter(i => i.exists)
    const totalFileSize = present.reduce((s, i) => s + i.size, 0)
    return {
      home: openclawHome,
      items,
      fileCount: present.filter(i => i.kind === 'file').length,
      dirCount: present.filter(i => i.kind === 'directory').length,
      totalFileSize,
    }
  })

  // Stream a tar.gz archive. We shell out to `tar` so we don't pull in a
  // js-tar dependency; it's portable across macOS/Linux and the Kylin target.
  app.get('/api/backup/export', async (req, reply) => {
    const items = inspect(openclawHome)
    const present = items.filter(i => i.exists).map(i => i.path)
    if (present.length === 0) {
      return reply.status(404).send({ error: '没有可备份的文件' })
    }

    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `openclaw-backup-${date}.tar.gz`

    reply.header('content-type', 'application/gzip')
    reply.header('content-disposition', `attachment; filename="${filename}"`)
    reply.header('cache-control', 'no-store')
    reply.hijack()

    const proc = spawn('tar', ['-czf', '-', '-C', openclawHome, ...present])
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.stdout.on('data', chunk => reply.raw.write(chunk))
    proc.on('close', code => {
      if (code !== 0) {
        app.log.warn({ code, stderr }, 'tar backup failed')
      }
      reply.raw.end()
    })
    proc.on('error', err => {
      app.log.error({ err }, 'tar spawn failed')
      try { reply.raw.end() } catch {}
    })

    // Client disconnected — kill tar
    reply.raw.on('close', () => {
      if (!proc.killed) {
        try { proc.kill('SIGTERM') } catch {}
      }
    })
  })
}
