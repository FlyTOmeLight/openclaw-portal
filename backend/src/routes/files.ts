import type { FastifyInstance } from 'fastify'
import { readFile, writeFile, unlink, rename, mkdir, stat } from 'fs/promises'
import { readdirSync, statSync, existsSync, createReadStream } from 'fs'
import { join, resolve, basename, dirname } from 'path'
import { homedir } from 'os'

const ROOT = homedir()

function safePath(relOrAbs: string): string | null {
  const abs = resolve(ROOT, relOrAbs.replace(/^\/+/, ''))
  const root = resolve(ROOT)
  if (abs !== root && !abs.startsWith(root + '/')) return null
  return abs
}

function relPath(abs: string): string {
  return abs.slice(resolve(ROOT).length) || '/'
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function filesRoutes(app: FastifyInstance) {
  // GET /api/files/list?path=/some/dir
  app.get<{ Querystring: { path?: string } }>('/api/files/list', async (req, reply) => {
    const abs = safePath(req.query.path ?? '/')
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    if (!existsSync(abs)) return reply.status(404).send({ error: 'Not found' })
    const st = statSync(abs)
    if (!st.isDirectory()) return reply.status(400).send({ error: 'Not a directory' })

    try {
      const entries = readdirSync(abs, { withFileTypes: true })
      const items = entries
        .map(e => {
          const childAbs = join(abs, e.name)
          let size = 0
          let mtime = ''
          try {
            const s = statSync(childAbs)
            size = s.size
            mtime = s.mtime.toISOString()
          } catch {}
          return {
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size,
            sizeHuman: e.isFile() ? humanSize(size) : '',
            mtime,
            path: relPath(childAbs),
          }
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      return { path: relPath(abs), items }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // GET /api/files/get?path=/file.txt  — returns text content
  app.get<{ Querystring: { path: string } }>('/api/files/get', async (req, reply) => {
    const abs = safePath(req.query.path)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    try {
      const content = await readFile(abs, 'utf-8')
      return { path: relPath(abs), content }
    } catch (err: any) {
      if (err.code === 'ENOENT') return reply.status(404).send({ error: 'Not found' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // GET /api/files/download?path=/file.txt  — streams file
  app.get<{ Querystring: { path: string } }>('/api/files/download', async (req, reply) => {
    const abs = safePath(req.query.path)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    if (!existsSync(abs)) return reply.status(404).send({ error: 'Not found' })
    const name = basename(abs)
    const encoded = encodeURIComponent(name)
    reply.header('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encoded}`)
    reply.header('Content-Type', 'application/octet-stream')
    return reply.send(createReadStream(abs))
  })

  // POST /api/files/write  — body: { path, content }
  app.post<{ Body: { path: string; content: string } }>('/api/files/write', async (req, reply) => {
    const { path: p, content } = req.body
    const abs = safePath(p)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    try {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf-8')
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // POST /api/files/mkdir  — body: { path }
  app.post<{ Body: { path: string } }>('/api/files/mkdir', async (req, reply) => {
    const abs = safePath(req.body.path)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    try {
      await mkdir(abs, { recursive: true })
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // POST /api/files/delete  — body: { path }
  app.post<{ Body: { path: string } }>('/api/files/delete', async (req, reply) => {
    const abs = safePath(req.body.path)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    try {
      await unlink(abs)
      return { ok: true }
    } catch (err: any) {
      if (err.code === 'EISDIR') {
        const { rm } = await import('fs/promises')
        await rm(abs, { recursive: true, force: true })
        return { ok: true }
      }
      if (err.code === 'ENOENT') return reply.status(404).send({ error: 'Not found' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // POST /api/files/rename  — body: { from, to }
  app.post<{ Body: { from: string; to: string } }>('/api/files/rename', async (req, reply) => {
    const absFrom = safePath(req.body.from)
    const absTo = safePath(req.body.to)
    if (!absFrom || !absTo) return reply.status(400).send({ error: 'Invalid path' })
    try {
      await rename(absFrom, absTo)
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // POST /api/files/upload?dir=/target/dir  — multipart
  app.post<{ Querystring: { dir?: string } }>('/api/files/upload', async (req, reply) => {
    const targetDir = safePath(req.query.dir ?? '/')
    if (!targetDir) return reply.status(400).send({ error: 'Invalid path' })
    await mkdir(targetDir, { recursive: true })

    const parts = req.files()
    const saved: string[] = []
    for await (const part of parts) {
      const name = basename(part.filename)
      const dest = join(targetDir, name)
      const destSafe = safePath(dest)
      if (!destSafe) continue
      const chunks: Buffer[] = []
      for await (const chunk of part.file) chunks.push(chunk)
      await writeFile(destSafe, Buffer.concat(chunks))
      saved.push(name)
    }
    return { ok: true, saved }
  })
}
