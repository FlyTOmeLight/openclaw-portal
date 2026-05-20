import type { FastifyInstance } from 'fastify'
import { readFile, writeFile, unlink, rename, mkdir, stat } from 'fs/promises'
import { readdirSync, statSync, existsSync, createReadStream } from 'fs'
import { join, resolve, basename, dirname } from 'path'
import { homedir } from 'os'

const ROOT = homedir()

// Accept both home-relative ('/.openclaw') and home-absolute ('/root/.openclaw')
// inputs. The frontend has historically conflated the two — when navigating
// from a query param or symlinked subtree, currentPath can come back as the
// full absolute path, and naive resolve(ROOT, '/root/.openclaw') becomes
// '/root/root/.openclaw' (cause of the ENOENT 500 on /api/files/upload).
function safePath(relOrAbs: string): string | null {
  const root = resolve(ROOT)
  let rel = relOrAbs.replace(/^\/+/, '')

  // Strip a duplicate home-prefix if the caller already prepended it.
  const rootRel = root.replace(/^\/+/, '')
  if (rootRel) {
    if (rel === rootRel) rel = ''
    else if (rel.startsWith(rootRel + '/')) rel = rel.slice(rootRel.length + 1)
  }

  const abs = resolve(ROOT, rel)
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
  // Stream each part directly to disk via pipeline — buffering the whole file
  // with Buffer.concat() OOMs on big tarballs and adds latency. Errors are
  // surfaced verbatim so the frontend can show the real cause instead of 500.
  app.post<{ Querystring: { dir?: string } }>('/api/files/upload', async (req, reply) => {
    const targetDir = safePath(req.query.dir ?? '/')
    if (!targetDir) return reply.status(400).send({ error: 'Invalid path' })

    try {
      await mkdir(targetDir, { recursive: true })
    } catch (err: any) {
      req.log.error({ err, targetDir }, 'upload: mkdir failed')
      return reply.status(500).send({ error: `mkdir failed: ${err.message}` })
    }

    const { createWriteStream } = await import('fs')
    const { pipeline } = await import('stream/promises')

    const saved: string[] = []
    try {
      const parts = req.files()
      for await (const part of parts) {
        if (!part.filename) continue
        const name = basename(part.filename)
        const dest = join(targetDir, name)
        const destSafe = safePath(dest)
        if (!destSafe) {
          req.log.warn({ name, dest }, 'upload: rejected unsafe path')
          continue
        }
        await pipeline(part.file, createWriteStream(destSafe))
        // truncated = fileSize limit hit mid-stream. The partial file is on disk
        // but unusable; remove it and surface the limit to the caller.
        if (part.file.truncated) {
          await unlink(destSafe).catch(() => {})
          return reply.status(413).send({ error: `${name} 超过单文件大小限制(100MB)` })
        }
        saved.push(name)
      }
      return { ok: true, saved }
    } catch (err: any) {
      req.log.error({ err, targetDir }, 'upload: write failed')
      // Common shapes: RequestFileTooLargeError (413), EACCES/ENOSPC (500).
      const code = err?.code ?? ''
      const status = err?.statusCode ?? (code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 500)
      return reply.status(status).send({ error: `${code ? code + ': ' : ''}${err.message}` })
    }
  })
}
