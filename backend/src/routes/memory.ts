import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'
import { readFile, writeFile, access, unlink, mkdir, readdir } from 'fs/promises'
import { readdirSync, statSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { constants } from 'fs'

interface MemoryFile {
  path: string       // relative to openclawHome
  name: string       // display name
  category: 'core' | 'memory' | 'archive'
  sizeBytes: number
  modifiedAt: string
}

interface AgentInfo { id: string; workspace: string }

function safeRelPath(openclawHome: string, relPath: string): string | null {
  const resolved = resolve(openclawHome, relPath)
  if (!resolved.startsWith(resolve(openclawHome) + '/') && resolved !== resolve(openclawHome)) {
    return null
  }
  return resolved
}

// Resolve category directory for a given workspace path (mirrors clawpanel's memory_dir_for_agent)
function categoryDir(workspace: string, category: string): string {
  switch (category) {
    case 'memory':  return join(workspace, 'memory')
    case 'archive': return join(resolve(workspace, '..'), 'workspace-memory')
    case 'core':    return workspace
    default:        return join(workspace, 'memory')
  }
}

function scanDir(dir: string, openclawHome: string, category: 'core' | 'memory' | 'archive', recursive: boolean): MemoryFile[] {
  const results: MemoryFile[] = []
  if (!existsSync(dir)) return results
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory() && recursive) {
        results.push(...scanDir(abs, openclawHome, category, true))
      } else if (e.isFile() && e.name.endsWith('.md')) {
        try {
          const st = statSync(abs)
          const rel = resolve(abs).slice(resolve(openclawHome).length + 1)
          results.push({ path: rel, name: e.name, category, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() })
        } catch {}
      }
    }
  } catch {}
  return results
}

let _agentCache: AgentInfo[] | null = null
let _agentCacheTs = 0

async function getAgents(openclawHome: string, configManager: ConfigManager): Promise<AgentInfo[]> {
  const now = Date.now()
  if (_agentCache && now - _agentCacheTs < 15_000) return _agentCache

  const agentsRoot = join(openclawHome, 'agents')
  let ids: string[] = []
  try {
    const entries = await readdir(agentsRoot, { withFileTypes: true })
    ids = entries.filter(e => e.isDirectory()).map(e => e.name)
      .sort((a, b) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b))
  } catch { return [] }

  const cfg = await configManager.read().catch(() => null)
  const defaultWorkspace = join(openclawHome, 'workspace')

  _agentCache = ids.map(id => {
    const configEntry = cfg?.agents?.list?.find((e: any) => e.id === id)
    const workspace = (configEntry?.workspace as string | undefined)
      ?? (id === 'main' ? defaultWorkspace : join(openclawHome, `workspace-${id}`))
    return { id, workspace }
  })
  _agentCacheTs = now
  return _agentCache
}

export async function memoryRoutes(app: FastifyInstance, openclawHome: string, configManager: ConfigManager) {
  // GET /api/memory/agents — list agents with their workspaces
  app.get('/api/memory/agents', async () => {
    return getAgents(openclawHome, configManager)
  })

  // GET /api/memory/files?agent=main&category=core
  app.get<{ Querystring: { agent?: string; category?: string } }>('/api/memory/files', async (req) => {
    const agentId = req.query.agent || 'main'
    const category = (req.query.category || 'core') as 'core' | 'memory' | 'archive'

    const agents = await getAgents(openclawHome, configManager)
    const agent = agents.find(a => a.id === agentId)
    if (!agent) return []

    const dir = categoryDir(agent.workspace, category)
    return scanDir(dir, openclawHome, category, category !== 'core')
  })

  // Read a memory file (path relative to openclawHome)
  app.get<{ Querystring: { path: string } }>('/api/memory/file', async (req, reply) => {
    const relPath = req.query.path
    if (!relPath) return reply.status(400).send({ error: 'path required' })
    const abs = safeRelPath(openclawHome, relPath)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    try {
      await access(abs, constants.R_OK)
      const content = await readFile(abs, 'utf-8')
      return { path: relPath, content }
    } catch (err: any) {
      if (err.code === 'ENOENT') return reply.status(404).send({ error: 'File not found' })
      return reply.status(500).send({ error: err.message })
    }
  })

  // Write a memory file
  app.put<{ Body: { path: string; content: string } }>('/api/memory/file', async (req, reply) => {
    const { path: relPath, content } = req.body
    if (!relPath) return reply.status(400).send({ error: 'path required' })
    if (typeof content !== 'string') return reply.status(400).send({ error: 'content must be a string' })
    const abs = safeRelPath(openclawHome, relPath)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    if (!abs.endsWith('.md')) return reply.status(400).send({ error: 'Only .md files allowed' })
    try {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf-8')
      _agentCache = null  // bust cache so file list refreshes
      return { ok: true }
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // Delete a memory file
  app.delete<{ Querystring: { path: string } }>('/api/memory/file', async (req, reply) => {
    const relPath = req.query.path
    if (!relPath) return reply.status(400).send({ error: 'path required' })
    const abs = safeRelPath(openclawHome, relPath)
    if (!abs) return reply.status(400).send({ error: 'Invalid path' })
    if (!abs.endsWith('.md')) return reply.status(400).send({ error: 'Only .md files allowed' })
    try {
      await unlink(abs)
      return { ok: true }
    } catch (err: any) {
      if (err.code === 'ENOENT') return reply.status(404).send({ error: 'File not found' })
      return reply.status(500).send({ error: err.message })
    }
  })
}
