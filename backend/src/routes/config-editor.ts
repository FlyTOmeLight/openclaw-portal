import type { FastifyInstance } from 'fastify'
import { readFile, writeFile, readdir, copyFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const MAX_BACKUPS = 20
const SECTIONS = ['models', 'agents', 'gateway', 'channels', 'commands'] as const
type Section = typeof SECTIONS[number]

function backupDir(openclawHome: string): string {
  return join(openclawHome, 'config-backups')
}

function backupFilename(): string {
  // e.g. openclaw.2026-04-04T21-30-00-123.json
  return `openclaw.${new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')}.json`
}

async function createBackup(openclawHome: string, configPath: string): Promise<string> {
  const dir = backupDir(openclawHome)
  await mkdir(dir, { recursive: true })
  const dest = join(dir, backupFilename())
  await copyFile(configPath, dest)
  await pruneBackups(dir)
  return dest
}

async function pruneBackups(dir: string): Promise<void> {
  try {
    const files = (await readdir(dir))
      .filter(f => f.startsWith('openclaw.') && f.endsWith('.json'))
      .sort()  // ISO timestamps sort lexicographically = chronologically
    if (files.length > MAX_BACKUPS) {
      const { unlink } = await import('fs/promises')
      for (const f of files.slice(0, files.length - MAX_BACKUPS)) {
        await unlink(join(dir, f)).catch(() => {})
      }
    }
  } catch {}
}

async function listBackups(openclawHome: string) {
  const dir = backupDir(openclawHome)
  if (!existsSync(dir)) return []
  const files = (await readdir(dir))
    .filter(f => f.startsWith('openclaw.') && f.endsWith('.json'))
    .sort()
    .reverse()  // newest first
  return Promise.all(files.map(async filename => {
    const raw = await readFile(join(dir, filename), 'utf-8').catch(() => '{}')
    const ts = filename
      .replace('openclaw.', '')
      .replace('.json', '')
      .replace(/-(\d{2})-(\d{2})-(\d{3})$/, '.$3')  // restore ms dots
      .replace(/-(\d{2})-(\d{2})T/, 'T$1:$2:')       // restore colons in time
    return {
      filename,
      timestamp: ts,
      size: raw.length,
      preview: (() => {
        try { return JSON.parse(raw) } catch { return null }
      })(),
    }
  }))
}

export async function configEditorRoutes(
  app: FastifyInstance,
  configPath: string,
  openclawHome: string,
) {
  // ── Full config ─────────────────────────────────────────────────────────────

  app.get('/api/config/raw', async () => {
    const raw = await readFile(configPath, 'utf-8')
    return { raw, configPath }
  })

  app.put<{ Body: { raw: string } }>('/api/config/raw', async (req, reply) => {
    const { raw } = req.body
    try {
      JSON.parse(raw)  // validate
    } catch (e: any) {
      return reply.status(400).send({ error: `JSON 语法错误: ${e.message}` })
    }
    const backupPath = await createBackup(openclawHome, configPath)
    await writeFile(configPath, raw, 'utf-8')
    return { ok: true, backupPath }
  })

  // ── Section ──────────────────────────────────────────────────────────────────

  app.get<{ Params: { section: string } }>('/api/config/section/:section', async (req, reply) => {
    const { section } = req.params
    if (!SECTIONS.includes(section as Section)) {
      return reply.status(400).send({ error: `Unknown section: ${section}` })
    }
    const cfg = JSON.parse(await readFile(configPath, 'utf-8'))
    return { raw: JSON.stringify(cfg[section] ?? {}, null, 2), section }
  })

  app.put<{ Params: { section: string }; Body: { raw: string } }>(
    '/api/config/section/:section',
    async (req, reply) => {
      const { section } = req.params
      if (!SECTIONS.includes(section as Section)) {
        return reply.status(400).send({ error: `Unknown section: ${section}` })
      }
      let parsed: any
      try {
        parsed = JSON.parse(req.body.raw)
      } catch (e: any) {
        return reply.status(400).send({ error: `JSON 语法错误: ${e.message}` })
      }
      const backupPath = await createBackup(openclawHome, configPath)
      const cfg = JSON.parse(await readFile(configPath, 'utf-8'))
      cfg[section] = parsed
      await writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf-8')
      return { ok: true, backupPath }
    }
  )

  // ── Backups ───────────────────────────────────────────────────────────────────

  app.get('/api/config/backups', async () => {
    const backups = await listBackups(openclawHome)
    return { backups, backupDir: backupDir(openclawHome) }
  })

  app.post<{ Body: { filename: string } }>('/api/config/restore', async (req, reply) => {
    const { filename } = req.body
    if (!filename || !filename.startsWith('openclaw.') || !filename.endsWith('.json') || filename.includes('/')) {
      return reply.status(400).send({ error: 'Invalid filename' })
    }
    const src = join(backupDir(openclawHome), filename)
    if (!existsSync(src)) return reply.status(404).send({ error: 'Backup not found' })
    // Validate the backup file first
    try {
      JSON.parse(await readFile(src, 'utf-8'))
    } catch {
      return reply.status(400).send({ error: 'Backup file is corrupt' })
    }
    // Backup the *current* config before restoring
    const safeguard = await createBackup(openclawHome, configPath)
    await copyFile(src, configPath)
    return { ok: true, safeguard }
  })
}
