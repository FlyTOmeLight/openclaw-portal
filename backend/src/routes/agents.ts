import type { FastifyInstance } from 'fastify'
import type { ConfigManager } from '../services/config-manager.js'
import type { AgentRouteBinding, OpenclawConfig } from '../types/openclaw.js'
import { readFile, writeFile, readdir, stat, mkdir, rm } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { getGatewayRpc } from '../services/gateway-rpc.js'

const FILE_DESCRIPTIONS: Record<string, string> = {
  'SOUL.md':         'Agent 人格与行为准则',
  'IDENTITY.md':     '名称与 Emoji 配置',
  'KNOWLEDGE.md':    '背景知识与专业领域',
  'INSTRUCTIONS.md': '自定义指令',
  'CONTEXT.md':      '上下文信息',
  'RULES.md':        '行为规则约束',
}

export interface AgentInfo {
  id: string
  workspace: string
  agentDir: string
  model: string | { primary: string; fallbacks?: string[] }
  bindings: number
  isDefault: boolean
  routes: string[]
  routeBindings?: AgentRouteBinding[]
  identityName?: string
  identityEmoji?: string
  soul?: string
  sessionCount?: number
  thinkingDefault?: string
  enabled?: boolean
}

// TTL cache: scanning disk is fast but no need to repeat on every request
let _agentListCache: AgentInfo[] | null = null
let _agentListTs = 0
const AGENT_CACHE_TTL = 10_000

function normalizeAgentBindings(cfg: OpenclawConfig): AgentRouteBinding[] {
  if (Array.isArray(cfg.bindings)) return cfg.bindings
  if (!cfg.bindings || typeof cfg.bindings !== 'object') return []
  return Object.entries(cfg.bindings).map(([key, agentId]) => {
    const [channel = '', accountId = '', scope = ''] = key.split('/')
    const match: Record<string, unknown> = { channel }
    if (accountId && accountId !== channel) match.accountId = accountId
    if (scope === 'private') match.peer = { kind: 'direct' }
    if (scope === 'group') match.peer = { kind: 'group' }
    return {
      type: 'route',
      agentId,
      match: match as AgentRouteBinding['match'],
    }
  })
}

function formatBindingRoute(binding: AgentRouteBinding): string {
  const match = binding.match || {}
  const parts = [String(match.channel || '')]
  if (typeof match.accountId === 'string' && match.accountId) parts.push(match.accountId)
  const peer = match.peer
  if (peer && typeof peer === 'object' && peer.id) {
    parts.push(`${peer.kind || 'direct'}:${peer.id}`)
  } else if (typeof peer === 'string' && peer) {
    parts.push(`direct:${peer}`)
  }
  return parts.filter(Boolean).join(':')
}

/**
 * List agents by scanning the agents directory on disk — no CLI spawn needed.
 * workspace / model fall back to sensible defaults when not overridden in config.
 */
async function listAgentsFromDisk(openclawHome: string, cfg: OpenclawConfig): Promise<AgentInfo[]> {
  const agentsRoot = join(openclawHome, 'agents')
  let agentIds: string[] = []
  try {
    const entries = await readdir(agentsRoot, { withFileTypes: true })
    agentIds = entries.filter(e => e.isDirectory()).map(e => e.name)
      .sort((a, b) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b))
  } catch {
    return []
  }

  const defaultWorkspace = join(openclawHome, 'workspace')

  return agentIds.map(id => {
    const configEntry = cfg.agents.list?.find(e => e.id === id)
    const agentDir = join(agentsRoot, id)
    const workspace = (configEntry?.workspace as string | undefined)
      ?? (id === 'main' ? defaultWorkspace : join(openclawHome, `workspace-${id}`))
    const model = configEntry?.model ?? cfg.agents.defaults.model.primary

    return {
      id,
      workspace,
      agentDir,
      model: model as string | { primary: string; fallbacks?: string[] },
      bindings: 0,
      isDefault: id === 'main',
      routes: [],
    }
  })
}

async function listAgents(openclawHome: string, cfg: OpenclawConfig, bustCache = false): Promise<AgentInfo[]> {
  const now = Date.now()
  if (!bustCache && _agentListCache && now - _agentListTs < AGENT_CACHE_TTL) {
    return _agentListCache
  }
  _agentListCache = await listAgentsFromDisk(openclawHome, cfg)
  _agentListTs = now
  return _agentListCache
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x3040 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef)
    ) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

function estimateTokensForMessage(message: any): { input: number; output: number } {
  if (!message) return { input: 0, output: 0 }
  const parts = Array.isArray(message.content) ? message.content : []
  let text = ''
  for (const p of parts) {
    if (typeof p === 'string') text += p
    else if (p && typeof p === 'object') text += (p.text ?? p.thinking ?? '')
  }
  if (!text && typeof message.content === 'string') text = message.content
  const t = estimateTokensFromText(text)
  return message.role === 'assistant' ? { input: 0, output: t } : { input: t, output: 0 }
}

function parseIdentity(content: string): { name?: string; emoji?: string } {
  // Match inline first: `**Name:** 小虾米` (same line); fall back to next line
  // for the older multi-line format. `[ \t]*` avoids jumping to the next list
  // item when the inline value is empty.
  const inlineName = content.match(/\*\*Name:\*\*[ \t]*([^\n]+)/)
  const inlineEmoji = content.match(/\*\*Emoji:\*\*[ \t]*([^\n]+)/)
  const name = inlineName?.[1]?.trim()
  const emoji = inlineEmoji?.[1]?.trim()
  // Strip a leading list marker the user might have included by mistake
  const cleanName = name?.replace(/^-\s*/, '')
  const cleanEmoji = emoji?.replace(/^-\s*/, '')
  return {
    name: cleanName && !cleanName.startsWith('_') ? cleanName : undefined,
    emoji: cleanEmoji && !cleanEmoji.startsWith('_') && cleanEmoji.length <= 8 ? cleanEmoji : undefined,
  }
}

async function enrichAgent(agent: AgentInfo, cfg: OpenclawConfig): Promise<AgentInfo> {
  const workspaceDir = agent.workspace

  const soulPath = join(workspaceDir, 'SOUL.md')
  if (existsSync(soulPath)) {
    agent.soul = await readFile(soulPath, 'utf-8')
  }

  // Identity: prefer config (clawpanel pattern), fall back to IDENTITY.md
  const cfgIdentity = (cfg.agents.list?.find(e => e.id === agent.id) as any)?.identity
  if (cfgIdentity?.name || cfgIdentity?.emoji) {
    agent.identityName = cfgIdentity.name
    agent.identityEmoji = cfgIdentity.emoji
  } else {
    const identityPath = join(workspaceDir, 'IDENTITY.md')
    if (existsSync(identityPath)) {
      const content = await readFile(identityPath, 'utf-8')
      const { name, emoji } = parseIdentity(content)
      agent.identityName = name
      agent.identityEmoji = emoji
    }
  }

  const sessionsDir = join(agent.agentDir, 'sessions')
  if (existsSync(sessionsDir)) {
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true })
      agent.sessionCount = entries.filter(e =>
        (e.isFile() && e.name.endsWith('.jsonl')) || e.isDirectory()
      ).length
    } catch {
      agent.sessionCount = 0
    }
  } else {
    agent.sessionCount = 0
  }

  const entry = cfg.agents.list?.find(e => e.id === agent.id)
  if (entry) {
    if (entry.thinking) agent.thinkingDefault = entry.thinking
    agent.enabled = entry.enabled !== false
    if (entry.model) agent.model = entry.model
  } else {
    agent.enabled = true
  }

  const bindings = normalizeAgentBindings(cfg).filter(binding => (binding.agentId || 'main') === agent.id)
  agent.bindings = bindings.length
  agent.routeBindings = bindings
  agent.routes = bindings.map(formatBindingRoute)

  return agent
}

export async function agentsRoutes(
  app: FastifyInstance,
  openclawHome: string,
  _openclawBin: string,
  configManager: ConfigManager,
  gatewayPort: number,
  portalPort: number,
) {
  const rpc = () => getGatewayRpc(gatewayPort, openclawHome, portalPort)
  // GET /api/agents — list all agents
  app.get('/api/agents', async () => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    return Promise.all(agents.map(a => enrichAgent(a, cfg)))
  })

  // GET /api/agents/:id — get single agent detail
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    const agent = agents.find(a => a.id === req.params.id)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })
    return enrichAgent(agent, cfg)
  })

  // POST /api/agents — create a new agent
  app.post<{ Body: { id: string; model?: string; workspace?: string } }>(
    '/api/agents',
    async (req, reply) => {
      const { id, model, workspace } = req.body
      if (!id || !/^[a-z0-9_-]+$/.test(id)) {
        return reply.status(400).send({ error: 'Invalid agent id (lowercase alphanumeric, underscore, hyphen only)' })
      }

      const cfg = await configManager.read()
      if (!cfg.agents.list) cfg.agents.list = []
      if (cfg.agents.list.some(e => e.id === id)) {
        return reply.status(400).send({ error: `Agent "${id}" 已存在` })
      }

      const agentDir = join(openclawHome, 'agents', id)
      const workspacePath = workspace ?? join(agentDir, 'workspace')
      await mkdir(agentDir, { recursive: true })
      await mkdir(workspacePath, { recursive: true })

      const entry: any = { id, workspace: workspacePath }
      if (model) entry.model = { primary: model }
      cfg.agents.list.push(entry)
      await configManager.write(cfg)
      _agentListCache = null
      return { ok: true }
    }
  )

  // DELETE /api/agents/:id — delete an agent
  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const { id } = req.params
    if (id === 'main') return reply.status(400).send({ error: 'Cannot delete default agent' })

    try {
      const cfg = await configManager.read()
      if (cfg.agents.list) {
        cfg.agents.list = cfg.agents.list.filter(e => e.id !== id)
      }
      await configManager.write(cfg)

      const agentDir = join(openclawHome, 'agents', id)
      if (existsSync(agentDir)) await rm(agentDir, { recursive: true, force: true })

      _agentListCache = null
      return { ok: true }
    } catch (e: any) {
      return reply.status(500).send({ error: e.message ?? 'Failed to delete agent' })
    }
  })

  // PUT /api/agents/:id/identity — update agent identity (name + emoji)
  app.put<{ Params: { id: string }; Body: { name?: string; emoji?: string } }>(
    '/api/agents/:id/identity',
    async (req, reply) => {
      const { id } = req.params
      const { name, emoji } = req.body

      const cfg = await configManager.read()
      if (!cfg.agents.list) cfg.agents.list = []
      let entry = cfg.agents.list.find(e => e.id === id) as any
      if (!entry) {
        entry = { id }
        cfg.agents.list.push(entry)
      }
      if (!entry.identity || typeof entry.identity !== 'object') entry.identity = {}
      if (name !== undefined) { if (name) entry.identity.name = name; else delete entry.identity.name }
      if (emoji !== undefined) { if (emoji) entry.identity.emoji = emoji; else delete entry.identity.emoji }
      if (!Object.keys(entry.identity).length) delete entry.identity

      await configManager.write(cfg)

      // Delete IDENTITY.md if it exists (config is now the source of truth)
      const agents = await listAgents(openclawHome, cfg, true)
      const agent = agents.find(a => a.id === id)
      if (agent) {
        const identityPath = join(agent.workspace, 'IDENTITY.md')
        if (existsSync(identityPath)) await rm(identityPath).catch(() => {})
      }

      _agentListCache = null
      return { ok: true }
    }
  )

  // PUT /api/agents/:id/model — update agent model (+ optional fallbacks)
  app.put<{ Params: { id: string }; Body: { model?: string; fallbacks?: string[] } }>(
    '/api/agents/:id/model',
    async (req, reply) => {
      const { model, fallbacks } = req.body
      if (!model) return reply.status(400).send({ error: 'model is required' })

      try {
        const modelValue = (fallbacks && fallbacks.length > 0)
          ? { primary: model, fallbacks }
          : model
        await configManager.setAgentModel(req.params.id, modelValue)
        _agentListCache = null
        return { ok: true }
      } catch (e: any) {
        return reply.status(500).send({ error: e.message ?? 'Failed to update model' })
      }
    }
  )

  // PUT /api/agents/:id/thinking — update thinking strength
  app.put<{ Params: { id: string }; Body: { thinking?: string } }>(
    '/api/agents/:id/thinking',
    async (req, reply) => {
      const { id } = req.params
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      if (!agents.find(a => a.id === id)) return reply.status(404).send({ error: 'Agent not found' })
      try {
        await configManager.setAgentThinking(id, req.body.thinking || undefined)
        _agentListCache = null
        return { ok: true }
      } catch (e: any) {
        return reply.status(500).send({ error: e.message ?? 'Failed to update thinking' })
      }
    }
  )

  // PUT /api/agents/:id/enabled — enable or disable agent
  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/agents/:id/enabled',
    async (req, reply) => {
      const { id } = req.params
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      if (!agents.find(a => a.id === id)) return reply.status(404).send({ error: 'Agent not found' })
      try {
        await configManager.setAgentEnabled(id, req.body.enabled)
        _agentListCache = null
        return { ok: true }
      } catch (e: any) {
        return reply.status(500).send({ error: e.message ?? 'Failed to update enabled' })
      }
    }
  )

  // PUT /api/agents/:id/soul — write SOUL.md
  app.put<{ Params: { id: string }; Body: { soul: string } }>(
    '/api/agents/:id/soul',
    async (req, reply) => {
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      const agent = agents.find(a => a.id === req.params.id)
      if (!agent) return reply.status(404).send({ error: 'Agent not found' })
      await writeFile(join(agent.workspace, 'SOUL.md'), req.body.soul, 'utf-8')
      return { ok: true }
    }
  )

  // GET /api/agents/:id/files — list all .md files in workspace
  app.get<{ Params: { id: string } }>('/api/agents/:id/files', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    const agent = agents.find(a => a.id === req.params.id)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const workspace = agent.workspace
    const knownFiles = Object.keys(FILE_DESCRIPTIONS)
    const extraFiles: string[] = []
    if (existsSync(workspace)) {
      const entries = await readdir(workspace)
      for (const f of entries) {
        if (f.endsWith('.md') && !knownFiles.includes(f)) extraFiles.push(f)
      }
    }
    const allFiles = [...knownFiles, ...extraFiles.sort()]

    const result = await Promise.all(allFiles.map(async (name) => {
      const filePath = join(workspace, name)
      const exists = existsSync(filePath)
      let size = 0, mtime = 0
      if (exists) {
        const s = await stat(filePath)
        size = s.size
        mtime = s.mtimeMs
      }
      return { name, desc: FILE_DESCRIPTIONS[name] ?? '', exists, size, mtime }
    }))

    return result
  })

  // GET /api/agents/:id/files/:filename — read a file
  app.get<{ Params: { id: string; filename: string } }>(
    '/api/agents/:id/files/:filename',
    async (req, reply) => {
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      const agent = agents.find(a => a.id === req.params.id)
      if (!agent) return reply.status(404).send({ error: 'Agent not found' })
      const filename = basename(req.params.filename)
      if (!filename.endsWith('.md')) return reply.status(400).send({ error: 'Only .md files allowed' })
      const filePath = join(agent.workspace, filename)
      if (!existsSync(filePath)) return { name: filename, content: '' }
      const content = await readFile(filePath, 'utf-8')
      return { name: filename, content }
    }
  )

  // PUT /api/agents/:id/files/:filename — write a file
  app.put<{ Params: { id: string; filename: string }; Body: { content: string } }>(
    '/api/agents/:id/files/:filename',
    async (req, reply) => {
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      const agent = agents.find(a => a.id === req.params.id)
      if (!agent) return reply.status(404).send({ error: 'Agent not found' })
      const filename = basename(req.params.filename)
      if (!filename.endsWith('.md')) return reply.status(400).send({ error: 'Only .md files allowed' })
      await writeFile(join(agent.workspace, filename), req.body.content ?? '', 'utf-8')
      return { ok: true }
    }
  )

  // GET /api/agents/:id/tools — read per-agent tools config
  app.get<{ Params: { id: string } }>('/api/agents/:id/tools', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    if (!agents.find(a => a.id === req.params.id)) return reply.status(404).send({ error: 'Agent not found' })
    const toolsCfg = await configManager.getAgentToolsConfig(req.params.id)
    return { profile: toolsCfg.profile ?? '', allow: toolsCfg.allow ?? [], alsoAllow: toolsCfg.alsoAllow ?? [], deny: toolsCfg.deny ?? [] }
  })

  // GET /api/agents/:id/tools/catalog — proxy to gateway `tools.catalog`.
  // Returns the runtime-authoritative tool inventory (groups + tools + profile
  // options) for this agent. The portal UI uses this to populate the tool
  // pickers; without it we'd have to ship a hard-coded list that drifts from
  // the gateway every release and uses the wrong naming convention
  // (PascalCase vs the snake_case OpenClaw expects, e.g. Bash → exec).
  app.get<{
    Params: { id: string }
    Querystring: { includePlugins?: string }
  }>('/api/agents/:id/tools/catalog', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    if (!agents.find(a => a.id === req.params.id)) return reply.status(404).send({ error: 'Agent not found' })
    const includePlugins = req.query.includePlugins !== 'false'
    try {
      const r = await rpc().request('tools.catalog', {
        agentId: req.params.id,
        includePlugins,
      })
      return r ?? { agentId: req.params.id, profiles: [], groups: [] }
    } catch (err: any) {
      return reply.status(502).send({ error: `网关 RPC 失败: ${err?.message ?? err}` })
    }
  })

  // PUT /api/agents/:id/tools — write per-agent tools config
  app.put<{
    Params: { id: string }
    Body: { profile?: string; allow?: string[]; alsoAllow?: string[]; deny?: string[] }
  }>('/api/agents/:id/tools', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    if (!agents.find(a => a.id === req.params.id)) return reply.status(404).send({ error: 'Agent not found' })
    _agentListCache = null
    const { profile, allow, alsoAllow, deny } = req.body
    await configManager.setAgentToolsConfig(req.params.id, {
      profile: profile || undefined,
      allow: allow?.length ? allow : undefined,
      alsoAllow: alsoAllow?.length ? alsoAllow : undefined,
      deny: deny?.length ? deny : undefined,
    })
    return { ok: true }
  })

  // GET /api/agents/:id/subagents — get subagent policy
  app.get<{ Params: { id: string } }>('/api/agents/:id/subagents', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    if (!agents.find(a => a.id === req.params.id)) return reply.status(404).send({ error: 'Agent not found' })
    const policy = await configManager.getAgentSubagents(req.params.id)
    return { allowAgents: policy.allowAgents ?? [] }
  })

  // PUT /api/agents/:id/subagents — set subagent policy
  app.put<{ Params: { id: string }; Body: { allowAgents?: string[] } }>(
    '/api/agents/:id/subagents',
    async (req, reply) => {
      const { id } = req.params
      const cfg = await configManager.read()
      const agents = await listAgents(openclawHome, cfg)
      if (!agents.find(a => a.id === id)) return reply.status(404).send({ error: 'Agent not found' })
      const { allowAgents } = req.body
      await configManager.setAgentSubagents(id, {
        allowAgents: allowAgents?.length ? allowAgents : undefined,
      })
      _agentListCache = null
      return { ok: true }
    }
  )

  // GET /api/agents/:id/dashboard — aggregated per-agent metrics for the
  // deep-dive dashboard view. Joins agent config + session-based usage stats.
  app.get<{ Params: { id: string } }>('/api/agents/:id/dashboard', async (req, reply) => {
    const { aggregateSessionUsage } = await import('../services/session-usage.js')
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    const agent = agents.find(a => a.id === req.params.id)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    // Enrich config-side info (identity, routes, subagents, etc.)
    await enrichAgent(agent, cfg)

    // Per-agent session aggregation (last 90 days, daily buckets)
    const costs: Record<string, number> = {}  // no user-provided pricing for dashboard
    const { daily, summary } = await aggregateSessionUsage(openclawHome, costs, 90, agent.id)

    // Top sessions limited to this agent — already filtered since agentDirs was
    // restricted to this agent, but double-check field
    const topSessions = summary.topSessions.filter(s => s.agentId === agent.id).slice(0, 10)

    // Today's tokens from daily buckets
    const today = new Date().toISOString().slice(0, 10)
    const todayRow = daily.find(d => d.date === today)
    const todayTokens = todayRow?.totalTokens ?? 0

    // 30-day window for sparkline
    const cutoff30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
    const daily30 = daily.filter(d => d.date >= cutoff30)

    return {
      agent: {
        id: agent.id,
        identityName: agent.identityName,
        identityEmoji: agent.identityEmoji,
        model: agent.model,
        isDefault: agent.isDefault,
        enabled: agent.enabled !== false,
        workspace: agent.workspace,
        routes: agent.routes ?? [],
        routeBindings: agent.routeBindings ?? [],
        sessionCount: agent.sessionCount ?? 0,
      },
      usage: {
        totalTokens: summary.totalTokens,
        todayTokens,
        dailyAvgTokens: summary.dailyAvgTokens,
        mtdTokens: summary.mtdTokens,
        mtdCost: summary.mtdCost,
        eomProjectedTokens: summary.eomProjectedTokens,
        cacheReadTokens: summary.cacheReadTokens,
        cacheWriteTokens: summary.cacheWriteTokens,
        estimated: summary.estimated,
        daily30,
        byModel: summary.byModel,
        byChannel: summary.byChannel,
        byTool: summary.byTool,
      },
      topSessions,
      generatedAt: Date.now(),
    }
  })

  // GET /api/agents/:id/stats — token usage + last active from session files
  app.get<{ Params: { id: string } }>('/api/agents/:id/stats', async (req, reply) => {
    const cfg = await configManager.read()
    const agents = await listAgents(openclawHome, cfg)
    const agent = agents.find(a => a.id === req.params.id)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const sessionsDir = join(agent.agentDir, 'sessions')
    if (!existsSync(sessionsDir)) return { sessionCount: 0, tokenInput: 0, tokenOutput: 0, lastActive: null }

    let files: string[]
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true })
      files = entries
        .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
        .map(e => join(sessionsDir, e.name))
    } catch {
      return { sessionCount: 0, tokenInput: 0, tokenOutput: 0, lastActive: null }
    }

    let tokenInput = 0, tokenOutput = 0, lastActive = 0, estimatedFlag = false
    const MAX_SESSIONS = 50

    for (const filePath of files.slice(-MAX_SESSIONS)) {
      try {
        const s = await stat(filePath)
        if (s.mtimeMs > lastActive) lastActive = s.mtimeMs

        const content = await readFile(filePath, 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const rec = JSON.parse(line)
            if (rec.type !== 'message') continue
            const usage = rec?.message?.usage
            const reportedIn  = Number(usage?.input)  || 0
            const reportedOut = Number(usage?.output) || 0
            if (reportedIn > 0 || reportedOut > 0) {
              tokenInput  += reportedIn
              tokenOutput += reportedOut
            } else {
              // Fallback: estimate from content length when provider didn't
              // report usage. CJK ≈ 1 token/char, ASCII ≈ 1 token/4 chars.
              const est = estimateTokensForMessage(rec.message)
              if (est.input || est.output) {
                tokenInput  += est.input
                tokenOutput += est.output
                estimatedFlag = true
              }
            }
          } catch { /* skip malformed lines */ }
        }
      } catch { /* skip unreadable files */ }
    }

    return {
      sessionCount: files.length,
      tokenInput,
      tokenOutput,
      lastActive: lastActive > 0 ? lastActive : null,
      estimated: estimatedFlag,
    }
  })
}
