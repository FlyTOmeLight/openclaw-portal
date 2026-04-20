import type { FastifyInstance } from 'fastify'
import { readdir, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

type SessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'toolResult'
  timestamp: string
  text: string
  thinking: string
  toolCalls: Array<{ id: string; name: string; arguments: any }>
  toolResults: Array<{ toolCallId: string; content: string }>
}

type SessionStats = {
  messageCount: number
  userCount: number
  assistantCount: number
  toolCallCount: number
  toolResultCount: number
}

function parseSessionMessage(event: any): SessionMessage {
  const message = event.message ?? {}
  const parts: any[] = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }]

  return {
    id: event.id,
    role: (message.role ?? 'assistant') as 'user' | 'assistant' | 'toolResult',
    timestamp: event.timestamp,
    text: parts.filter((part: any) => part.type === 'text').map((part: any) => part.text ?? '').join(''),
    thinking: parts.filter((part: any) => part.type === 'thinking').map((part: any) => part.thinking ?? '').join(''),
    toolCalls: parts
      .filter((part: any) => part.type === 'toolCall')
      .map((part: any) => ({ id: part.id, name: part.name, arguments: part.arguments })),
    toolResults: parts
      .filter((part: any) => part.type === 'toolResult')
      .map((part: any) => ({
        toolCallId: part.toolCallId,
        content: Array.isArray(part.content)
          ? part.content.map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk?.text ?? JSON.stringify(chunk))).join('')
          : String(part.content ?? ''),
      })),
  }
}

function createEmptyStats(): SessionStats {
  return {
    messageCount: 0,
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
  }
}

function updateStats(stats: SessionStats, message: SessionMessage) {
  stats.messageCount += 1
  if (message.role === 'user') stats.userCount += 1
  if (message.role === 'assistant') stats.assistantCount += 1
  if (message.role === 'toolResult') stats.toolResultCount += 1
  stats.toolCallCount += message.toolCalls.length
  stats.toolResultCount += message.toolResults.length
}

async function getSessionsForAgentDir(agentDir: string) {
  const sessionsDir = join(agentDir, 'sessions')
  if (!existsSync(sessionsDir)) return []
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true })
    // Sessions are .jsonl files; legacy code expected directories — handle both
    const sessionEntries = entries.filter(e =>
      (e.isFile() && e.name.endsWith('.jsonl')) || e.isDirectory()
    )
    const sessions = await Promise.all(sessionEntries.map(async entry => {
      const sessionPath = join(sessionsDir, entry.name)
      const id = entry.isFile() ? entry.name.replace(/\.jsonl$/, '') : entry.name
      let mtime = 0
      try {
        const s = await stat(sessionPath)
        mtime = s.mtimeMs
        if (entry.isDirectory()) {
          const files = await readdir(sessionPath)
          for (const f of files) {
            try {
              const fs2 = await stat(join(sessionPath, f))
              if (fs2.mtimeMs > mtime) mtime = fs2.mtimeMs
            } catch {}
          }
        }
      } catch {}
      return { id, mtime }
    }))
    return sessions.sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

export async function sessionsRoutes(app: FastifyInstance, openclawHome: string) {
  const agentsRoot = join(openclawHome, 'agents')

  async function listAgentDirs(): Promise<{ id: string; agentDir: string }[]> {
    if (!existsSync(agentsRoot)) return []
    try {
      const entries = await readdir(agentsRoot, { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory())
        .map(e => ({ id: e.name, agentDir: join(agentsRoot, e.name) }))
        .sort((a, b) => a.id === 'main' ? -1 : b.id === 'main' ? 1 : a.id.localeCompare(b.id))
    } catch {
      return []
    }
  }

  // GET /api/sessions — list all agents with their sessions
  app.get('/api/sessions', async () => {
    const agents = await listAgentDirs()
    return Promise.all(agents.map(async agent => {
      const sessions = await getSessionsForAgentDir(agent.agentDir)
      return {
        agentId: agent.id,
        sessions,
        sessionCount: sessions.length,
      }
    }))
  })

  // GET /api/sessions/:agentId/:sessionId — read parsed messages for a session
  app.get<{ Params: { agentId: string; sessionId: string }; Querystring: { tail?: string } }>(
    '/api/sessions/:agentId/:sessionId',
    async (req, reply) => {
      const { agentId, sessionId } = req.params
      if (agentId.includes('/') || agentId.includes('..') || sessionId.includes('/') || sessionId.includes('..')) {
        return reply.status(400).send({ error: 'Invalid id' })
      }

      const jsonlPath = join(agentsRoot, agentId, 'sessions', `${sessionId}.jsonl`)
      if (!existsSync(jsonlPath)) return reply.status(404).send({ error: 'Session not found' })

      // Look up session key from sessions.json
      let sessionKey: string | null = null
      try {
        const raw = await readFile(join(agentsRoot, agentId, 'sessions', 'sessions.json'), 'utf-8')
        const map: Record<string, { sessionId?: string }> = JSON.parse(raw)
        for (const [key, val] of Object.entries(map)) {
          if (val?.sessionId === sessionId) { sessionKey = key; break }
        }
      } catch {}

      const requestedTail = Number.parseInt(req.query.tail ?? '', 10)
      const tail = Number.isFinite(requestedTail) && requestedTail > 0 ? requestedTail : null

      // Parse JSONL
      const content = await readFile(jsonlPath, 'utf-8')
      const stats = createEmptyStats()
      const messages: SessionMessage[] = []
      let sessionEvent: any = null

      for (const line of content.split('\n')) {
        if (!line.trim()) continue

        let event: any
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }

        if (!sessionEvent && event.type === 'session') {
          sessionEvent = event
          continue
        }

        if (event.type !== 'message') continue

        const message = parseSessionMessage(event)
        updateStats(stats, message)

        if (tail) {
          messages.push(message)
          if (messages.length > tail) messages.shift()
          continue
        }

        messages.push(message)
      }

      return {
        sessionId,
        sessionKey,
        agentId,
        startedAt: sessionEvent?.timestamp ?? null,
        cwd: sessionEvent?.cwd ?? null,
        messages,
        stats,
        truncated: Boolean(tail && stats.messageCount > messages.length),
        loadedMessageCount: messages.length,
      }
    }
  )

  // GET /api/sessions/:agentId/:sessionId/export — Markdown dump for knowledge base / post-mortem
  app.get<{ Params: { agentId: string; sessionId: string } }>(
    '/api/sessions/:agentId/:sessionId/export',
    async (req, reply) => {
      const { agentId, sessionId } = req.params
      if (agentId.includes('/') || agentId.includes('..') || sessionId.includes('/') || sessionId.includes('..')) {
        return reply.status(400).send({ error: 'Invalid id' })
      }
      const jsonlPath = join(agentsRoot, agentId, 'sessions', `${sessionId}.jsonl`)
      if (!existsSync(jsonlPath)) return reply.status(404).send({ error: 'Session not found' })

      const content = await readFile(jsonlPath, 'utf-8')
      const messages: SessionMessage[] = []
      let sessionEvent: any = null
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        let event: any
        try { event = JSON.parse(line) } catch { continue }
        if (!sessionEvent && event.type === 'session') { sessionEvent = event; continue }
        if (event.type !== 'message') continue
        messages.push(parseSessionMessage(event))
      }

      const lines: string[] = []
      lines.push(`# Session \`${sessionId}\``)
      lines.push('')
      lines.push(`- **Agent**: ${agentId}`)
      if (sessionEvent?.timestamp) lines.push(`- **Started**: ${sessionEvent.timestamp}`)
      if (sessionEvent?.cwd) lines.push(`- **CWD**: \`${sessionEvent.cwd}\``)
      lines.push(`- **Messages**: ${messages.length}`)
      lines.push('')
      lines.push('---')
      lines.push('')

      for (const m of messages) {
        const roleLabel = m.role === 'assistant' ? '🤖 Assistant'
          : m.role === 'user' ? '👤 User'
          : '🔧 Tool Result'
        const ts = (m as any).timestamp ? ` · ${(m as any).timestamp}` : ''
        lines.push(`## ${roleLabel}${ts}`)
        lines.push('')
        const text = (m as any).text
        if (text) {
          lines.push(String(text))
          lines.push('')
        }
        for (const call of m.toolCalls) {
          lines.push(`### 🛠️ Tool Call: \`${call.name}\``)
          lines.push('')
          lines.push('```json')
          try { lines.push(JSON.stringify(call.arguments, null, 2)) } catch { lines.push(String(call.arguments)) }
          lines.push('```')
          lines.push('')
        }
        for (const r of m.toolResults) {
          lines.push(`### ✅ Tool Result (id=\`${r.toolCallId}\`)`)
          lines.push('')
          lines.push('```')
          lines.push(String(r.content).slice(0, 8000))
          lines.push('```')
          lines.push('')
        }
      }

      reply.header('content-type', 'text/markdown; charset=utf-8')
      reply.header('content-disposition', `attachment; filename="session-${agentId}-${sessionId}.md"`)
      return lines.join('\n')
    },
  )

  // DELETE /api/sessions/:agentId — clear all sessions for an agent
  app.delete<{ Params: { agentId: string } }>('/api/sessions/:agentId', async (req, reply) => {
    const agentDir = join(agentsRoot, req.params.agentId)
    if (!existsSync(agentDir)) return reply.status(404).send({ error: 'Agent not found' })

    const sessionsDir = join(agentDir, 'sessions')
    if (!existsSync(sessionsDir)) return { ok: true, deleted: 0 }

    const entries = await readdir(sessionsDir, { withFileTypes: true })
    const targets = entries.filter(e =>
      (e.isFile() && e.name.endsWith('.jsonl')) || e.isDirectory()
    )
    await Promise.all(targets.map(e => rm(join(sessionsDir, e.name), { recursive: true, force: true })))
    return { ok: true, deleted: targets.length }
  })

  // DELETE /api/sessions/:agentId/:sessionId — delete a single session
  app.delete<{ Params: { agentId: string; sessionId: string } }>(
    '/api/sessions/:agentId/:sessionId',
    async (req, reply) => {
      const { agentId, sessionId } = req.params
      // Basic path sanitization — reject anything with path separators
      if (agentId.includes('/') || agentId.includes('..') || sessionId.includes('/') || sessionId.includes('..')) {
        return reply.status(400).send({ error: 'Invalid id' })
      }
      // Try .jsonl file first, fall back to directory (legacy)
      const jsonlPath = join(agentsRoot, agentId, 'sessions', `${sessionId}.jsonl`)
      const dirPath   = join(agentsRoot, agentId, 'sessions', sessionId)
      const sessionPath = existsSync(jsonlPath) ? jsonlPath : dirPath
      if (!existsSync(sessionPath)) return reply.status(404).send({ error: 'Session not found' })
      await rm(sessionPath, { recursive: true, force: true })
      return { ok: true }
    }
  )
}
