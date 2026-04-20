import { readFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export interface DailyUsageRow {
  date: string              // YYYY-MM-DD (UTC)
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  sessions: number
  estimated: boolean
}

export interface AgentUsage {
  agentId: string
  tokens: number
  cost: number
  sessions: number
  lastActive: number | null
}

export interface ChannelUsage {
  channel: string
  tokens: number
  cost: number
  sessions: number
}

export interface TopSession {
  sessionId: string
  agentId: string
  channel: string
  tokens: number
  cost: number
  lastTs: number
  messageCount: number
  model?: string
  latestCtxTokens?: number   // input + cacheRead + cacheWrite of latest assistant turn
  contextWindow?: number     // inferred max window for the model
  pressurePct?: number       // latestCtxTokens / contextWindow * 100
}

export interface ToolUsageEntry {
  name: string
  calls: number
  outputTokens: number
}

/** Best-effort context window lookup. Default 131072 (Qwen3 128K). */
export function modelContextWindow(model?: string | null): number {
  if (!model) return 131072
  const m = model.toLowerCase()
  if (m.includes('claude-opus') || m.includes('claude-sonnet') || m.includes('claude-haiku')) return 200000
  if (m.includes('gpt-4o') || m.includes('gpt-4.1')) return 128000
  if (m.includes('gpt-4-turbo')) return 128000
  if (m.includes('qwen3') || m.includes('qwen-3')) return 131072
  if (m.includes('qwen2')) return 32768
  if (m.includes('deepseek')) return 131072
  if (m.includes('minimax')) return 1000000
  if (m.includes('glm-4')) return 128000
  if (m.includes('kimi') || m.includes('moonshot')) return 200000
  return 131072
}

export interface SessionUsageSummary {
  totalTokens: number
  totalCost: number
  sessionCount: number
  dailyAvgTokens: number
  mtdTokens: number          // Month-to-date
  mtdCost: number
  eomProjectedTokens: number // Linearly extrapolated month-end total
  eomProjectedCost: number
  cacheReadTokens: number
  cacheWriteTokens: number
  byModel: Record<string, { tokens: number; cost: number }>
  byAgent: Record<string, { tokens: number; cost: number; sessions: number; lastTs: number }>
  byChannel: Record<string, { tokens: number; cost: number; sessions: number }>
  topSessions: TopSession[]
  pressureSessions: TopSession[]  // sorted by pressurePct desc (only sessions with ctx data)
  byTool: ToolUsageEntry[]
  estimated: boolean
}

/** Rough tokenizer. CJK 1 char ≈ 1 token, ASCII 4 chars ≈ 1 token. */
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

function estimateFromMessage(message: any): { input: number; output: number } {
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

/** Parse channel from sessionKey like "agent:main:portal:uuid" → "portal". */
function parseChannel(sessionKey: string): string {
  if (!sessionKey) return 'unknown'
  const parts = sessionKey.split(':')
  // agent:<agentId>:<channel>[:...]
  if (parts[0] === 'agent' && parts.length >= 3) {
    return parts[2] || 'unknown'
  }
  return sessionKey.split(':')[0] || 'unknown'
}

/** Read first few lines to discover the session's primary model (assistant
 * messages have provider+model; user/tool messages don't). */
function detectSessionModel(raw: string): string | null {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec.type === 'message' && rec.message?.role === 'assistant' && rec.message?.provider) {
        return `${rec.message.provider}/${rec.message.model || 'unknown'}`
      }
    } catch { /* ignore */ }
  }
  return null
}

/** Find sessionKey by scanning sessions.json in the same directory. Otherwise
 * fall back to a guess based on file name. */
async function loadSessionKeyMap(sessionsDir: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const jsonPath = join(sessionsDir, 'sessions.json')
  if (!existsSync(jsonPath)) return result
  try {
    const raw = await readFile(jsonPath, 'utf-8')
    const obj: Record<string, { sessionId?: string }> = JSON.parse(raw)
    for (const [key, val] of Object.entries(obj)) {
      if (val?.sessionId) result.set(val.sessionId, key)
    }
  } catch { /* ignore */ }
  return result
}

interface Bucket {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  estimated: boolean
  sessionIds: Set<string>
}

export async function aggregateSessionUsage(
  openclawHome: string,
  costMap: Record<string, number>,
  windowDays = 90,
  agentFilter?: string,  // optional: only aggregate this agent's sessions
): Promise<{ daily: DailyUsageRow[]; summary: SessionUsageSummary }> {
  const agentsRoot = join(openclawHome, 'agents')
  if (!existsSync(agentsRoot)) return emptyResult()

  let agentDirs: { id: string; path: string }[] = []
  try {
    const entries = await readdir(agentsRoot, { withFileTypes: true })
    agentDirs = entries.filter(e => e.isDirectory()).map(e => ({ id: e.name, path: join(agentsRoot, e.name) }))
    if (agentFilter) agentDirs = agentDirs.filter(a => a.id === agentFilter)
  } catch { return emptyResult() }

  const cutoff = Date.now() - windowDays * 86400_000
  const byDay = new Map<string, Bucket>()
  const byModel: Record<string, { tokens: number; cost: number }> = {}
  const byAgent: Record<string, { tokens: number; cost: number; sessions: Set<string>; lastTs: number }> = {}
  const byChannel: Record<string, { tokens: number; cost: number; sessions: Set<string> }> = {}
  const perSession = new Map<string, { sessionId: string; agentId: string; channel: string; tokens: number; cost: number; lastTs: number; messageCount: number; model?: string; latestCtxTokens: number; latestCtxTs: number }>()
  const byToolName: Record<string, { calls: number; outputTokens: number }> = {}
  // Track last-seen tool name per session so toolResult messages can be
  // credited to the matching tool (toolCall and toolResult come in pairs).
  const sessionLastToolName = new Map<string, string>()
  let totalTokens = 0
  let totalCost = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let estimatedFlag = false

  for (const agent of agentDirs) {
    const sessionsDir = join(agent.path, 'sessions')
    if (!existsSync(sessionsDir)) continue

    const keyMap = await loadSessionKeyMap(sessionsDir)

    let files: string[]
    try {
      const list = await readdir(sessionsDir, { withFileTypes: true })
      files = list.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => join(sessionsDir, e.name))
    } catch { continue }

    for (const filePath of files) {
      let recent: boolean
      try {
        const s = await stat(filePath)
        recent = s.mtimeMs >= cutoff
      } catch { continue }
      if (!recent) continue

      let raw: string
      try { raw = await readFile(filePath, 'utf-8') } catch { continue }
      const sessionId = filePath.split('/').pop()!.replace('.jsonl', '')
      const sessionKey = keyMap.get(sessionId) ?? ''
      const channel = parseChannel(sessionKey) || 'main'
      const sessionModel = detectSessionModel(raw) ?? 'unknown/unknown'

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let rec: any
        try { rec = JSON.parse(line) } catch { continue }
        if (rec.type !== 'message') continue

        const ts = typeof rec.message?.timestamp === 'number'
          ? rec.message.timestamp
          : (rec.timestamp ? Date.parse(rec.timestamp) : Date.now())
        if (ts < cutoff) continue

        // Track tool calls / results separately (for per-tool breakdown).
        // toolCall lives in assistant messages as content parts (type=toolCall/tool_use).
        // toolResult is a dedicated message with role="toolResult" (OpenClaw session format)
        // or a content part of type "tool_result" (Anthropic format).
        const parts = Array.isArray(rec.message?.content) ? rec.message.content : []
        const msgRole = rec.message?.role
        if (msgRole === 'toolResult' || msgRole === 'tool_result') {
          const name = String(rec.message?.toolName || rec.message?.name || sessionLastToolName.get(sessionId) || 'unknown')
          if (!byToolName[name]) byToolName[name] = { calls: 0, outputTokens: 0 }
          const content = rec.message?.content
          const text = typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('')
              : ''
          byToolName[name].outputTokens += estimateTokensFromText(text)
        } else {
          for (const part of parts) {
            if (!part || typeof part !== 'object') continue
            const t = part.type
            if (t === 'toolCall' || t === 'tool_use' || t === 'toolUse') {
              const name = String(part.name || part.toolName || 'unknown')
              if (!byToolName[name]) byToolName[name] = { calls: 0, outputTokens: 0 }
              byToolName[name].calls += 1
              sessionLastToolName.set(sessionId, name)
            } else if (t === 'toolResult' || t === 'tool_result') {
              const content = part.content ?? part.text ?? ''
              const text = typeof content === 'string'
                ? content
                : Array.isArray(content)
                  ? content.map((c: any) => c?.text ?? '').join('')
                  : ''
              const est = estimateTokensFromText(text)
              const lastToolName = sessionLastToolName.get(sessionId)
              if (lastToolName && byToolName[lastToolName]) {
                byToolName[lastToolName].outputTokens += est
              }
            }
          }
        }

        const rawUsage = rec.message?.usage ?? {}
        const reportedIn  = Number(rawUsage.input)  || 0
        const reportedOut = Number(rawUsage.output) || 0
        const cacheRead   = Number(rawUsage.cacheRead)  || 0
        const cacheWrite  = Number(rawUsage.cacheWrite) || 0

        const hasReported = reportedIn > 0 || reportedOut > 0
        const { input, output } = hasReported
          ? { input: reportedIn, output: reportedOut }
          : estimateFromMessage(rec.message)
        const total = input + output
        if (total <= 0 && cacheRead <= 0 && cacheWrite <= 0) continue
        const estimated = !hasReported
        if (estimated) estimatedFlag = true

        // Inherit session-level model for user/tool messages that don't carry one
        const msgModel = (rec.message?.provider && rec.message?.model)
          ? `${rec.message.provider}/${rec.message.model}`
          : sessionModel
        const rate = costMap[msgModel] ?? 0
        const cost = (total / 1000) * rate

        totalTokens += total
        totalCost += cost
        totalCacheRead += cacheRead
        totalCacheWrite += cacheWrite

        if (!byModel[msgModel]) byModel[msgModel] = { tokens: 0, cost: 0 }
        byModel[msgModel].tokens += total
        byModel[msgModel].cost += cost

        if (!byAgent[agent.id]) byAgent[agent.id] = { tokens: 0, cost: 0, sessions: new Set(), lastTs: 0 }
        byAgent[agent.id].tokens += total
        byAgent[agent.id].cost += cost
        byAgent[agent.id].sessions.add(sessionId)
        if (ts > byAgent[agent.id].lastTs) byAgent[agent.id].lastTs = ts

        if (!byChannel[channel]) byChannel[channel] = { tokens: 0, cost: 0, sessions: new Set() }
        byChannel[channel].tokens += total
        byChannel[channel].cost += cost
        byChannel[channel].sessions.add(sessionId)

        const sessEntry = perSession.get(sessionId) ?? {
          sessionId, agentId: agent.id, channel,
          tokens: 0, cost: 0, lastTs: 0, messageCount: 0,
          latestCtxTokens: 0, latestCtxTs: 0,
        }
        sessEntry.tokens += total
        sessEntry.cost += cost
        sessEntry.messageCount += 1
        if (ts > sessEntry.lastTs) sessEntry.lastTs = ts
        // Track the most recent assistant turn's context size.
        // input + cacheRead + cacheWrite ≈ what the model saw at that moment.
        if (msgRole === 'assistant' && hasReported && ts >= sessEntry.latestCtxTs) {
          const ctxAtTurn = reportedIn + cacheRead + cacheWrite
          if (ctxAtTurn > 0) {
            sessEntry.latestCtxTokens = ctxAtTurn
            sessEntry.latestCtxTs = ts
            sessEntry.model = msgModel
          }
        }
        perSession.set(sessionId, sessEntry)

        const dateKey = new Date(ts).toISOString().slice(0, 10)
        const bucket = byDay.get(dateKey) ?? {
          date: dateKey,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0,
          estimated: false,
          sessionIds: new Set<string>(),
        }
        bucket.promptTokens += input
        bucket.completionTokens += output
        bucket.totalTokens += total
        bucket.cacheReadTokens += cacheRead
        bucket.cacheWriteTokens += cacheWrite
        bucket.cost += cost
        if (estimated) bucket.estimated = true
        bucket.sessionIds.add(sessionId)
        byDay.set(dateKey, bucket)
      }
    }
  }

  const daily: DailyUsageRow[] = [...byDay.values()]
    .map(b => ({
      date: b.date,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      totalTokens: b.totalTokens,
      cacheReadTokens: b.cacheReadTokens,
      cacheWriteTokens: b.cacheWriteTokens,
      cost: b.cost,
      sessions: b.sessionIds.size,
      estimated: b.estimated,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Use the size of perSession — one entry per unique session id — so a single
  // session spanning multiple days isn't double-counted (daily.sessions is
  // per-day cardinality, which would sum incorrectly).
  const sessionCount = perSession.size
  const dailyAvgTokens = Math.round(totalTokens / Math.max(1, windowDays))

  // MTD + EOM projection
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - monthStart.getTime()) / 86400_000))
  const monthStartKey = monthStart.toISOString().slice(0, 10)
  const mtd = daily.filter(d => d.date >= monthStartKey)
  const mtdTokens = mtd.reduce((s, d) => s + d.totalTokens, 0)
  const mtdCost = mtd.reduce((s, d) => s + d.cost, 0)
  const eomProjectedTokens = Math.round((mtdTokens / daysElapsed) * daysInMonth)
  const eomProjectedCost = (mtdCost / daysElapsed) * daysInMonth

  const flattenAgent: Record<string, { tokens: number; cost: number; sessions: number; lastTs: number }> = {}
  for (const [k, v] of Object.entries(byAgent)) {
    flattenAgent[k] = { tokens: v.tokens, cost: v.cost, sessions: v.sessions.size, lastTs: v.lastTs }
  }
  const flattenChannel: Record<string, { tokens: number; cost: number; sessions: number }> = {}
  for (const [k, v] of Object.entries(byChannel)) {
    flattenChannel[k] = { tokens: v.tokens, cost: v.cost, sessions: v.sessions.size }
  }

  const toTopSession = (s: { sessionId: string; agentId: string; channel: string; tokens: number; cost: number; lastTs: number; messageCount: number; model?: string; latestCtxTokens: number; latestCtxTs: number }): TopSession => {
    const contextWindow = modelContextWindow(s.model)
    const pressurePct = s.latestCtxTokens > 0
      ? Math.min(100, (s.latestCtxTokens / contextWindow) * 100)
      : 0
    return {
      sessionId: s.sessionId,
      agentId: s.agentId,
      channel: s.channel,
      tokens: s.tokens,
      cost: s.cost,
      lastTs: s.lastTs,
      messageCount: s.messageCount,
      model: s.model,
      latestCtxTokens: s.latestCtxTokens,
      contextWindow,
      pressurePct: Math.round(pressurePct * 10) / 10,
    }
  }

  const pressureSessions: TopSession[] = [...perSession.values()]
    .filter(s => s.latestCtxTokens > 0)
    .map(toTopSession)
    .sort((a, b) => (b.pressurePct ?? 0) - (a.pressurePct ?? 0))
    .slice(0, 20)

  const topSessions: TopSession[] = [...perSession.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)
    .map(toTopSession)

  const byTool: ToolUsageEntry[] = Object.entries(byToolName)
    .map(([name, v]) => ({ name, calls: v.calls, outputTokens: v.outputTokens }))
    .sort((a, b) => b.calls - a.calls)

  return {
    daily,
    summary: {
      totalTokens, totalCost, sessionCount, dailyAvgTokens,
      mtdTokens, mtdCost, eomProjectedTokens, eomProjectedCost,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      byModel, byAgent: flattenAgent, byChannel: flattenChannel,
      topSessions, pressureSessions, byTool,
      estimated: estimatedFlag,
    },
  }
}

function emptyResult() {
  return {
    daily: [] as DailyUsageRow[],
    summary: {
      totalTokens: 0, totalCost: 0, sessionCount: 0, dailyAvgTokens: 0,
      mtdTokens: 0, mtdCost: 0, eomProjectedTokens: 0, eomProjectedCost: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0,
      byModel: {}, byAgent: {}, byChannel: {},
      topSessions: [] as TopSession[], pressureSessions: [] as TopSession[], byTool: [] as ToolUsageEntry[],
      estimated: false,
    },
  }
}
