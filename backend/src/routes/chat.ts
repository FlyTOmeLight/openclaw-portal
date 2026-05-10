import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { getOrCreateDeviceKey, buildConnectFrame, buildGatewayAuthHeaders, getGatewayAuthToken, getGatewayRpc, sanitizeUser } from '../services/gateway-rpc.js'
import { gatewayHttpBase, gatewayWsBase, portalHttpBase } from '../config.js'
import type { UsageTracker } from '../services/usage-tracker.js'
import { join, extname } from 'path'
import { mkdir, writeFile } from 'fs/promises'

// Extract usage from an arbitrary payload shape. Gateway, OpenAI, Anthropic
// and our own events all differ — be forgiving about field names.
function findUsageInPayload(p: any): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
  if (!p || typeof p !== 'object') return null
  const u = p.usage || p.metrics?.usage || p.tokens || p.tokenUsage || p.metrics?.tokens
  if (!u || typeof u !== 'object') return null
  const prompt = Number(u.prompt_tokens ?? u.promptTokens ?? u.input_tokens ?? u.inputTokens ?? 0) || 0
  const completion = Number(u.completion_tokens ?? u.completionTokens ?? u.output_tokens ?? u.outputTokens ?? 0) || 0
  const total = Number(u.total_tokens ?? u.totalTokens ?? (prompt + completion)) || 0
  if (total <= 0) return null
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}

// Scan SSE buffer for OpenAI-compatible `usage` field. Providers emit it on
// the final chunk before `data: [DONE]` when stream_options.include_usage=true
// is set on the request. Non-streaming responses carry usage at the top level.
function extractUsage(text: string): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
  // Try non-streaming JSON first
  try {
    const obj = JSON.parse(text)
    if (obj?.usage?.total_tokens != null) {
      return {
        promptTokens: obj.usage.prompt_tokens ?? 0,
        completionTokens: obj.usage.completion_tokens ?? 0,
        totalTokens: obj.usage.total_tokens,
      }
    }
  } catch {}

  // SSE: scan from the end for the last data: {...} with usage
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj?.usage?.total_tokens != null) {
        return {
          promptTokens: obj.usage.prompt_tokens ?? 0,
          completionTokens: obj.usage.completion_tokens ?? 0,
          totalTokens: obj.usage.total_tokens,
        }
      }
    } catch {}
  }
  return null
}

type ChatMode = 'chat' | 'plan' | 'execute' | 'unlimited'

interface ChatCompletionsBody {
  messages?: Array<{ role?: string; content?: unknown }>
  stream?: boolean
  mode?: ChatMode
  agentId?: string
  conversationKey?: string
}

const MODE_SYSTEM_PROMPTS: Partial<Record<ChatMode, string>> = {
  chat: '你只能进行对话和回答问题，不能使用任何工具，也不能修改文件。',
  plan: '你现在处于规划模式：只分析、拆解和规划，不执行工具，不修改文件。',
}

function normalizeMessages(messages: ChatCompletionsBody['messages'], mode: ChatMode): Array<{ role: string; content: unknown }> {
  const normalized = Array.isArray(messages)
    ? messages
        .filter((message): message is { role?: string; content?: unknown } => Boolean(message))
        .map(message => ({
          role: typeof message.role === 'string' ? message.role : 'user',
          content: message.content ?? '',
        }))
    : []

  const systemPrompt = MODE_SYSTEM_PROMPTS[mode]
  return systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...normalized]
    : normalized
}

function buildSessionKey(agentId?: string, conversationKey?: string): string | undefined {
  if (!conversationKey) return undefined
  const targetAgent = agentId && agentId !== 'main' ? agentId : 'main'
  return `agent:${targetAgent}:portal:${conversationKey}`
}

/**
 * Chat routes — WebSocket proxy architecture (mirrors clawpanel):
 *
 *   Browser WS ↔  /api/chat/ws  ↔  Gateway /ws
 *
 * The backend handles Ed25519 auth (connect.challenge / connect response)
 * transparently, then forwards all messages bidirectionally.
 *
 * Special events injected by the proxy (sent to browser, never forwarded):
 *   { type:'event', event:'portal.connected', payload:{ snapshot } }
 *   { type:'event', event:'portal.error',     payload:{ message } }
 */
export async function chatRoutes(
  app: FastifyInstance,
  gatewayPort: number,
  openclawHome: string,
  portalPort: number,
  usageTracker?: UsageTracker,
) {
  // ─── HTTP chat completions proxy (used by Agent detail chat panel) ──────────
  app.post<{ Body: ChatCompletionsBody }>('/api/chat/completions', async (req, reply) => {
    const mode = req.body?.mode ?? 'execute'
    const agentId = req.body?.agentId
    const model = agentId && agentId !== 'main' ? `openclaw/${agentId}` : 'openclaw'
    const sessionKey = buildSessionKey(agentId, req.body?.conversationKey)
    const messages = normalizeMessages(req.body?.messages, mode)

    const headers: Record<string, string> = {
      ...(await buildGatewayAuthHeaders(join(openclawHome, 'openclaw.json'), req.headers['x-forwarded-user'])),
      'content-type': 'application/json',
    }
    if (sessionKey) headers['x-openclaw-session-key'] = sessionKey

    const streaming = req.body?.stream ?? true
    const upstream = await fetch(`${gatewayHttpBase(gatewayPort)}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: streaming,
        max_tokens: 8192,
        // Force provider to include usage on the final streaming chunk.
        // Harmless when ignored; most OpenAI-compatible gateways support it.
        ...(streaming ? { stream_options: { include_usage: true } } : {}),
      }),
      // @ts-expect-error Node fetch streaming duplex
      duplex: 'half',
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => upstream.statusText)
      return reply.status(upstream.status).send({ error: errText || upstream.statusText })
    }

    reply.hijack()
    reply.raw.statusCode = upstream.status
    reply.raw.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
    reply.raw.setHeader('cache-control', 'no-cache')
    reply.raw.setHeader('x-accel-buffering', 'no')

    if (!upstream.body) {
      reply.raw.end('')
      return
    }

    const reader = upstream.body.getReader()
    reply.raw.on('close', () => {
      void reader.cancel().catch(() => {})
    })

    // Tee the stream to the client while buffering a tail window large enough
    // to catch the final usage chunk. 64 KB covers even the largest SSE frames.
    const decoder = new TextDecoder('utf-8', { fatal: false })
    const TAIL_MAX = 64 * 1024
    let tail = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      reply.raw.write(value)
      if (usageTracker && value) {
        tail += decoder.decode(value, { stream: true })
        if (tail.length > TAIL_MAX) tail = tail.slice(-TAIL_MAX)
      }
    }
    reply.raw.end()

    if (usageTracker) {
      tail += decoder.decode()
      const usage = extractUsage(tail)
      if (usage && usage.totalTokens > 0) {
        usageTracker.record({
          sessionId: sessionKey || `anon:${Date.now()}`,
          model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        })
      }
    }
  })

  // Diagnostic: remember which (event, state) combos we've logged, to avoid
  // spamming the console on every chunk.
  const _seenEventShapes = new Set<string>()

  // Deduplicate usage records across WS sessions. Same (sessionKey + runId +
  // totalTokens) tuple is recorded at most once within a short window; gateway
  // may emit multiple events per turn but usage appears in only one of them.
  const recentUsageKeys = new Set<string>()
  function recordUsageOnce(sessionKey: string, runId: string, model: string, u: { promptTokens: number; completionTokens: number; totalTokens: number }) {
    if (!usageTracker) return
    const key = `${sessionKey}:${runId}:${u.totalTokens}`
    if (recentUsageKeys.has(key)) return
    recentUsageKeys.add(key)
    // Bound the set to avoid unbounded growth
    if (recentUsageKeys.size > 500) {
      const first = recentUsageKeys.values().next().value
      if (first) recentUsageKeys.delete(first)
    }
    usageTracker.record({
      sessionId: sessionKey || `ws:${Date.now()}`,
      model: model || 'openclaw',
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      totalTokens: u.totalTokens,
    })
  }

  // ─── WebSocket proxy ──────────────────────────────────────────────────────────
  async function handleChatWs(socket: any, req: any) {
    let deviceKey: Awaited<ReturnType<typeof getOrCreateDeviceKey>>
    const gatewayToken = await getGatewayAuthToken(join(openclawHome, 'openclaw.json'))
    try {
      deviceKey = await getOrCreateDeviceKey(openclawHome)
    } catch (e: any) {
      try { socket.send(JSON.stringify({ type: 'event', event: 'portal.error', payload: { message: `Device key error: ${e.message}` } })) } catch {}
      socket.close()
      return
    }

    const origin = portalHttpBase(portalPort)
    const tokenQuery = gatewayToken ? `?token=${encodeURIComponent(gatewayToken)}` : ''
    const forwardedUser = sanitizeUser(req?.headers?.['x-forwarded-user'])
    const gws = new WebSocket(`${gatewayWsBase(gatewayPort)}/ws${tokenQuery}`, {
      headers: { origin, 'x-forwarded-user': forwardedUser },
    })

    let authenticated = false
    const pending: string[] = []

    function markAuthenticated(snapshot: any) {
      authenticated = true
      const mainKey = snapshot?.sessionDefaults?.mainSessionKey
      console.log('[chat/ws] Authenticated. mainSessionKey:', mainKey)
      try { socket.send(JSON.stringify({ type: 'event', event: 'portal.connected', payload: { snapshot: snapshot ?? null } })) } catch {}
      for (const m of pending) { try { gws.send(m) } catch {} }
      pending.length = 0
    }

    // Clawpanel-compatible path: if challenge never arrives, proactively send connect.
    let fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      fallbackTimer = null
      if (!authenticated && gws.readyState === WebSocket.OPEN) {
        gws.send(JSON.stringify(buildConnectFrame(deviceKey, '', gatewayToken)))
      }
    }, 2000)

    // Overall auth timeout — forcibly terminate stalled handshake to avoid resource leaks.
    let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      authTimer = null
      if (!authenticated) {
        try { socket.send(JSON.stringify({ type: 'event', event: 'portal.error', payload: { message: 'Gateway auth timeout' } })) } catch {}
        try { socket.close() } catch {}
        try { gws.close() } catch {}
      }
    }, 30000)

    let cleanedUp = false
    function cleanup() {
      if (cleanedUp) return
      cleanedUp = true
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      if (authTimer) { clearTimeout(authTimer); authTimer = null }
    }

    // ── Gateway → Browser ──────────────────────────────────────────────────────
    gws.on('message', (raw: Buffer) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // Handle auth challenge (device-key mode)
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
        gws.send(JSON.stringify(buildConnectFrame(deviceKey, msg.payload?.nonce ?? '', gatewayToken)))
        return
      }

      // Handle connect response (device-key mode)
      if (msg.type === 'res' && typeof msg.id === 'string' && msg.id.startsWith('connect-')) {
        cleanup()
        if (!msg.ok || msg.error) {
          const errMsg = msg.error?.message ?? 'Gateway auth failed'
          console.error('[chat/ws] Auth failed:', errMsg)
          try { socket.send(JSON.stringify({ type: 'event', event: 'portal.error', payload: { message: errMsg } })) } catch {}
          socket.close()
          return
        }
        markAuthenticated(msg.payload?.snapshot)
        return
      }

      // Sniff token usage on the way through — payload shape is gateway-defined,
      // findUsageInPayload tolerates multiple common layouts.
      if (usageTracker && msg?.type === 'event' && msg.payload) {
        const u = findUsageInPayload(msg.payload)
        if (u) {
          const sk = msg.payload.sessionKey || ''
          const runId = msg.payload.runId || msg.payload.messageId || ''
          const model = msg.payload.model || 'openclaw'
          recordUsageOnce(sk, runId, model, u)
        }
        // Diagnostic: log event shapes once per event/state combo so we can
        // figure out which one carries usage data.
        const stateKey = `${msg.event}:${msg.payload?.state ?? ''}`
        if (!_seenEventShapes.has(stateKey)) {
          _seenEventShapes.add(stateKey)
          const keys = Object.keys(msg.payload || {})
          const preview = JSON.stringify(msg.payload, (k, v) => {
            if (typeof v === 'string' && v.length > 80) return v.slice(0, 80) + '…'
            return v
          }).slice(0, 600)
          console.log(`[chat/ws diag] first ${stateKey} keys=${keys.join(',')} payload=${preview}`)
        }
      }

      // Forward everything else to browser
      if (socket.readyState === 1 /* OPEN */) {
        try { socket.send(raw.toString()) } catch {}
      }
    })

    // ── Browser → Gateway ──────────────────────────────────────────────────────
    socket.on('message', (raw: Buffer) => {
      const msgStr = Buffer.isBuffer(raw) ? raw.toString() : String(raw)
      if (!authenticated) { pending.push(msgStr); return }
      try { gws.send(msgStr) } catch {}
    })

    socket.on('close', () => { cleanup(); try { gws.close() } catch {} })
    gws.on('close', () => { cleanup(); try { socket.close() } catch {} })
    gws.on('error', (e: Error) => {
      cleanup()
      console.error('[chat/ws] Gateway WS error:', e.message)
      try { socket.send(JSON.stringify({ type: 'event', event: 'portal.error', payload: { message: e.message } })) } catch {}
      try { socket.close() } catch {}
    })
  }

  // Register under both paths: /api/chat/ws (dev proxy) and /portal/api/chat/ws (prod built)
  app.get('/api/chat/ws', { websocket: true }, handleChatWs)
  app.get('/portal/api/chat/ws', { websocket: true }, handleChatWs)

  // ─── Diagnostic ───────────────────────────────────────────────────────────────
  app.get('/api/chat/gateway-test', async (_req, reply) => {
    const rpc = getGatewayRpc(gatewayPort, openclawHome, portalPort)
    const report: Record<string, any> = {
      connected: false, mainSessionKey: null, snapshot: null,
      chatSendAck: null, chatSendError: null, eventsReceived: [] as any[],
    }
    const events: any[] = []
    const TERMINAL_STATES = new Set(['done', 'complete', 'error', 'cancelled', 'failed'])
    let terminalResolve: (() => void) | null = null
    const terminalReached = new Promise<void>(resolve => { terminalResolve = resolve })

    const unsub = rpc.onGatewayEvent((msg: any) => {
      events.push({ event: msg.event, state: msg.payload?.state, sessionKey: msg.payload?.sessionKey, runId: msg.payload?.runId })
      if (TERMINAL_STATES.has(msg.payload?.state)) terminalResolve?.()
    })
    try {
      await rpc.request('ping', {}).catch(() => {})
      report.connected = true
      report.mainSessionKey = rpc.getMainSessionKey()
      report.snapshot = rpc.snapshot?.sessionDefaults ?? null
      const ack = await rpc.chatSend(rpc.getMainSessionKey(), 'hi')
      report.chatSendAck = ack
    } catch (e: any) {
      report.chatSendError = e.message
    }
    // Wait for terminal event or cap at 3s — whichever comes first.
    await Promise.race([
      terminalReached,
      new Promise<void>(r => setTimeout(r, 3000)),
    ])
    unsub()
    report.eventsReceived = events
    return reply.send(report)
  })

  // ─── File upload ──────────────────────────────────────────────────────────────
  // Allow inlining as text only for true text content; everything else (PDF,
  // docx, xlsx, archives, …) is persisted to the agent workspace and the
  // chat carries a path reference instead of raw bytes — embedding raw bytes
  // produces "message must not contain null bytes" at the gateway.
  const TEXT_EXT = new Set([
    '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv',
    '.log', '.html', '.htm', '.xml', '.svg', '.css', '.js', '.mjs', '.cjs', '.ts',
    '.tsx', '.jsx', '.vue', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
    '.c', '.h', '.cpp', '.hpp', '.sh', '.bash', '.zsh', '.fish', '.sql', '.ini',
    '.conf', '.env',
  ])
  const isTextLike = (mime: string, name: string): boolean => {
    if (mime.startsWith('text/')) return true
    if (mime === 'application/json' || mime === 'application/xml') return true
    return TEXT_EXT.has(extname(name).toLowerCase())
  }
  const sanitizeFilename = (name: string): string => {
    const base = name.replace(/[\\/]/g, '_').replace(/^\.+/, '')
    return base.slice(0, 200) || 'upload.bin'
  }

  app.post('/api/chat/file', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 50 * 1024 * 1024 } })
    if (!data) return reply.status(400).send({ error: 'No file' })

    const mimeType = data.mimetype || 'application/octet-stream'
    const filename = data.filename || 'upload.bin'
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    if (mimeType.startsWith('image/')) {
      return { type: 'image', filename, mimeType, size: buffer.length, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
    }

    if (isTextLike(mimeType, filename)) {
      // Reject inline content that still contains null bytes (defensive).
      const content = buffer.slice(0, 100 * 1024).toString('utf-8').replace(/\u0000/g, '')
      return { type: 'text', filename, mimeType, size: buffer.length, content }
    }

    // Binary: save to ~/.openclaw/workspace/uploads/<ts>-<filename>
    const uploadsDir = join(openclawHome, 'workspace', 'uploads')
    await mkdir(uploadsDir, { recursive: true })
    const safeName = `${Date.now()}-${sanitizeFilename(filename)}`
    const dest = join(uploadsDir, safeName)
    await writeFile(dest, buffer)
    return { type: 'file', filename, mimeType, size: buffer.length, path: dest }
  })
}
