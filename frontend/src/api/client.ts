import { clearAuthCache } from '../router/auth-cache.js'

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const BASE = `${APP_BASE}/api`.replace(/\/{2,}/g, '/')

// TTL cache with in-flight dedup — avoids redundant calls on repeated navigation
const _cache = new Map<string, { data: unknown; ts: number }>()
const _inflight = new Map<string, Promise<unknown>>()

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = _cache.get(key)
  if (hit && now - hit.ts < ttlMs) return Promise.resolve(hit.data as T)
  const inflight = _inflight.get(key)
  if (inflight) return inflight as Promise<T>
  const p = fn()
    .then(data => { _cache.set(key, { data, ts: Date.now() }); _inflight.delete(key); return data })
    .catch(err => { _inflight.delete(key); throw err })
  _inflight.set(key, p)
  return p
}

function bust(...keys: string[]) {
  for (const k of keys) _cache.delete(k)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // Session expired — redirect to login (skip if already there)
    if (!window.location.pathname.endsWith('/login')) {
      clearAuthCache()
      window.location.href = import.meta.env.BASE_URL + 'login'
    }
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Request failed')
  }
  return res.json()
}

export type ChatMode = 'chat' | 'plan' | 'execute' | 'unlimited'
export interface ChatCompleteOptions {
  agentId?: string
  conversationKey?: string
}

export interface DepItem {
  name: string
  declaredIn?: string
  present: boolean
  detail?: string
}
export interface DepCategoryResult {
  declared: number
  missing: number
  present: number
  items: DepItem[]
}
export interface SkillDepsReport {
  name: string
  agent: string | null
  path: string
  scannedAt: number
  openclaw: DepCategoryResult
  system: DepCategoryResult
  node: DepCategoryResult
  python: DepCategoryResult
  totalMissing: number
}
export interface SkillHealthSummary {
  name: string
  agent: string | null
  totalDeclared: number
  totalMissing: number
  status: 'ok' | 'missing' | 'unknown'
  scannedAt: number
}

export interface PluginSearchResult {
  name: string
  version: string
  description: string
  npmSpec: string
  installed: boolean
}

export const api = {
  service: {
    status: () => req<{ state: string; pid?: number }>('GET', '/service'),
    start: () => req<{ ok: boolean }>('POST', '/service/start'),
    stop: () => req<{ ok: boolean }>('POST', '/service/stop'),
    restart: () => req<{ ok: boolean }>('POST', '/service/restart'),
  },
  models: {
    list: () => req<{ providers: Record<string, any>; primary: string; fallbacks: string[] }>('GET', '/models'),
    updateProvider: (id: string, provider: unknown) => req<{ ok: boolean }>('PUT', `/models/providers/${id}`, provider),
    deleteProvider: (id: string) => req<{ ok: boolean }>('DELETE', `/models/providers/${id}`),
    setPrimary: (primary: string) => req<{ ok: boolean }>('PUT', '/models/primary', { primary }),
    setFallbacks: (fallbacks: string[]) => req<{ ok: boolean }>('PUT', '/models/fallbacks', { fallbacks }),
    test: (baseUrl: string, apiKey: string, modelId: string, api?: string) =>
      req<{ ok: boolean }>('POST', '/models/test', { baseUrl, apiKey, modelId, api }),
    listRemote: (baseUrl: string, apiKey: string, api?: string) =>
      req<{ models: string[] }>('POST', '/models/remote-list', { baseUrl, apiKey, api }),
  },
  skills: {
    list: () => cached('skills/list', 15_000, () => req<any[]>('GET', '/skills')),
    listBundled: () => cached('skills/bundled', 30_000, () => req<{ skills: any[]; skillsDir: string | null }>('GET', '/skills/bundled')),
    registry: (q = '', sourceId = '', category = '', page = 1) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (sourceId) params.set('sourceId', sourceId)
      if (category) params.set('category', category)
      if (page > 1) params.set('page', String(page))
      return req<any[]>('GET', `/skills/registry${params.toString() ? `?${params.toString()}` : ''}`)
    },
    deploy: (name: string, agent: string) => req<any>('POST', `/skills/registry/${encodeURIComponent(name)}/deploy`, { agent })
      .then(r => { bust('skills/list'); return r }),
    installRemote: (downloadUrl: string, agent: string | null) =>
      req<any>('POST', '/skills/install-remote', { downloadUrl, agent })
        .then(r => { bust('skills/list', 'skills/bundled'); return r }),
    installRegistry: (slug: string, sourceUrl: string, sourceType: string, agent: string | null) =>
      req<any>('POST', '/skills/install-registry', { slug, sourceUrl, sourceType, agent })
        .then(r => { bust('skills/list', 'skills/bundled'); return r }),
    disable: (name: string, agent: string) => req<{ ok: boolean }>('POST', `/skills/${encodeURIComponent(name)}/disable`, { agent })
      .then(r => { bust('skills/list'); return r }),
    enable: (name: string, agent: string) => req<{ ok: boolean }>('POST', `/skills/${encodeURIComponent(name)}/enable`, { agent })
      .then(r => { bust('skills/list'); return r }),
    delete: (name: string, agent: string | null) => req<{ ok: boolean }>('POST', `/skills/${encodeURIComponent(name)}/delete`, { agent })
      .then(r => { bust('skills/list', 'skills/bundled'); return r }),
    install: (file: File, agent: string | null, skillName?: string) => {
      const form = new FormData()
      form.append('file', file)
      if (agent) form.append('agent', agent)
      if (skillName) form.append('skillName', skillName)
      return fetch(`${BASE}/skills/install`, { method: 'POST', body: form }).then(async r => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.error ?? 'Install failed')
        bust('skills/list', 'skills/bundled')
        return json
      })
    },
  },
  skillDeps: {
    // Overview across every installed skill. `refresh=true` busts the server-side
    // cache and forces a re-scan.
    health: (refresh = false) =>
      req<{ skills: Array<{
        name: string; agent: string | null; totalDeclared: number; totalMissing: number;
        status: 'ok' | 'missing' | 'unknown'; scannedAt: number
      }> }>('GET', `/skills/health${refresh ? '?refresh=1' : ''}`),

    // Per-skill deep scan (4 dimensions).
    checkSkill: (agent: string | null, name: string, refresh = false) => {
      const a = encodeURIComponent(agent ?? '_global')
      const n = encodeURIComponent(name)
      return req<{
        name: string; agent: string | null; path: string; scannedAt: number;
        openclaw: DepCategoryResult; system: DepCategoryResult; node: DepCategoryResult;
        python: DepCategoryResult; totalMissing: number
      }>('GET', `/skills/${a}/${n}/deps${refresh ? '?refresh=1' : ''}`)
    },
  },
  plugins: {
    list: () => cached('plugins/list', 15_000, () => req<any[]>('GET', '/plugins')),
    install: (packageName: string) =>
      req<{ ok: boolean; result: { command: string; stdout: string; stderr: string }; plugins: any[] }>('POST', '/plugins/install', { packageName })
        .then(r => { bust('plugins/list', 'ch/plugin-status'); return r }),
    installOffline: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/plugins/install-offline`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((err as any).error ?? 'Upload failed')
      }
      bust('plugins/list', 'ch/plugin-status')
      return res.json() as Promise<{ ok: boolean; result: { command: string; stdout: string; stderr: string }; plugins: any[] }>
    },
    search: (q: string, limit = 25) =>
      req<{ results: PluginSearchResult[] }>(
        'GET',
        `/plugins/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      ),
    getNpmRegistry: () => req<{ registry: string }>('GET', '/plugins/npm-registry'),
    setNpmRegistry: (registry: string) =>
      req<{ registry: string }>('POST', '/plugins/npm-registry', { registry }),
    pingNpmRegistry: (registry: string) =>
      req<{ ok: boolean; ms: number; message: string }>(
        'POST',
        '/plugins/npm-registry/ping',
        { registry },
      ),
    uninstall: (name: string) =>
      req<{ ok: boolean; result: { command: string; stdout: string; stderr: string }; plugins: any[] }>('DELETE', `/plugins/${encodeURIComponent(name)}`)
        .then(r => { bust('plugins/list', 'ch/plugin-status'); return r }),
  },
  agents: {
    list: () => cached('agents/list', 10_000, () => req<any[]>('GET', '/agents')),
    get: (id: string) => req<any>('GET', `/agents/${id}`),
    // Runtime-authoritative tool catalog from the gateway (proxied through
    // backend). Used to populate the tool pickers so the names always match
    // what the gateway actually accepts (snake_case, current plugin set).
    toolsCatalog: (id: string, includePlugins = true) =>
      req<{
        agentId: string
        profiles: { id: string; label: string }[]
        groups: { sectionId: string; label?: string; tools: { id: string; label?: string; description?: string }[] }[]
      }>('GET', `/agents/${encodeURIComponent(id)}/tools/catalog${includePlugins ? '' : '?includePlugins=false'}`),
    create: (id: string, model?: string, workspace?: string) =>
      req<{ ok: boolean }>('POST', '/agents', { id, model, workspace })
        .then(r => { bust('agents/list'); return r }),
    remove: (id: string) =>
      req<{ ok: boolean }>('DELETE', `/agents/${id}`)
        .then(r => { bust('agents/list'); return r }),
    updateIdentity: (id: string, name?: string, emoji?: string) =>
      req<{ ok: boolean }>('PUT', `/agents/${id}/identity`, { name, emoji })
        .then(r => { bust('agents/list'); return r }),
    updateSoul: (id: string, soul: string) => req<{ ok: boolean }>('PUT', `/agents/${id}/soul`, { soul }),
    updateModel: (id: string, model?: string, fallbacks?: string[]) => req<{ ok: boolean }>('PUT', `/agents/${id}/model`, { model, fallbacks }),
    updateThinking: (id: string, thinking?: string) => req<{ ok: boolean }>('PUT', `/agents/${id}/thinking`, { thinking }),
    setEnabled: (id: string, enabled: boolean) => req<{ ok: boolean }>('PUT', `/agents/${id}/enabled`, { enabled }),
    listFiles: (id: string) => req<{ name: string; desc: string; exists: boolean; size: number; mtime: number }[]>('GET', `/agents/${id}/files`),
    readFile: (id: string, filename: string) => req<{ name: string; content: string }>('GET', `/agents/${id}/files/${encodeURIComponent(filename)}`),
    saveFile: (id: string, filename: string, content: string) => req<{ ok: boolean }>('PUT', `/agents/${id}/files/${encodeURIComponent(filename)}`, { content }),
    stats: (id: string) => req<{ sessionCount: number; tokenInput: number; tokenOutput: number; lastActive: number | null }>('GET', `/agents/${id}/stats`),
    dashboard: (id: string) => req<any>('GET', `/agents/${id}/dashboard`),
    getSubagents: (id: string) => req<{ allowAgents: string[] }>('GET', `/agents/${id}/subagents`),
    saveSubagents: (id: string, policy: { allowAgents?: string[] }) => req<{ ok: boolean }>('PUT', `/agents/${id}/subagents`, policy),
    getTools: (id: string) => req<{ profile: string; allow: string[]; alsoAllow: string[]; deny: string[] }>('GET', `/agents/${id}/tools`),
    saveTools: (id: string, cfg: { profile?: string; allow?: string[]; alsoAllow?: string[]; deny?: string[] }) => req<{ ok: boolean }>('PUT', `/agents/${id}/tools`, cfg),
  },
  channels: {
    list: () => req<Record<string, any>>('GET', '/channels'),
    upsert: (name: string, config: any) => req<{ ok: boolean }>('PUT', `/channels/${encodeURIComponent(name)}`, config),
    remove: (name: string) => req<{ ok: boolean }>('DELETE', `/channels/${encodeURIComponent(name)}`),
    status: () => req<{ raw: string }>('GET', '/channels/status'),
    listBindings: () => req<Record<string, string>>('GET', '/channels/bindings'),
    setBinding: (platform: string, accountId: string, scope: string, agentId: string) =>
      req<{ ok: boolean }>('PUT', '/channels/bindings', { platform, accountId, scope, agentId }),
    deleteBinding: (platform: string, accountId: string, scope: string) =>
      req<{ ok: boolean }>('DELETE', '/channels/bindings', { platform, accountId, scope }),
    listConfiguredPlatforms: () => cached('ch/platforms', 10_000, () =>
      req<Array<{ id: string; enabled: boolean; accounts: Array<{ accountId: string; appId?: string }> }>>('GET', '/channels/platforms')),
    readPlatformConfig: (platform: string, accountId?: string | null) => {
      const q = new URLSearchParams({ platform })
      if (accountId) q.set('accountId', accountId)
      return req<{ exists: boolean; values?: Record<string, any> }>('GET', `/channels/platform-config?${q.toString()}`)
    },
    saveMessagingPlatform: (platform: string, form: Record<string, any>, accountId?: string | null) =>
      req<{ ok: boolean; accountId: string | null }>('POST', '/channels/platform-config', { platform, form, accountId })
        .then(r => { bust('ch/platforms', 'ch/agent-bindings'); return r }),
    removeMessagingPlatform: (platform: string, accountId?: string | null) =>
      req<{ ok: boolean }>('DELETE', '/channels/platform-config', { platform, accountId })
        .then(r => { bust('ch/platforms', 'ch/agent-bindings'); return r }),
    toggleMessagingPlatform: (platform: string, enabled: boolean) =>
      req<{ ok: boolean }>('POST', '/channels/platform-toggle', { platform, enabled })
        .then(r => { bust('ch/platforms'); return r }),
    listAllBindings: () => cached('ch/agent-bindings', 10_000, () =>
      req<{ bindings: Array<{ type?: string; agentId: string; match: Record<string, any> }> }>('GET', '/channels/agent-bindings')),
    saveAgentBinding: (agentId: string, channel: string, accountId?: string | null, bindingConfig?: Record<string, any>) =>
      req<{ ok: boolean }>('POST', '/channels/agent-bindings', { agentId, channel, accountId, bindingConfig })
        .then(r => { bust('ch/agent-bindings'); return r }),
    deleteAgentBinding: (agentId: string, channel: string, accountId?: string | null, bindingConfig?: Record<string, any>) =>
      req<{ ok: boolean; removed: number }>('DELETE', '/channels/agent-bindings', { agentId, channel, accountId, bindingConfig })
        .then(r => { bust('ch/agent-bindings'); return r }),
    verify: (platform: string, form: Record<string, any>) =>
      req<{ valid: boolean; errors: string[]; details: string[] }>('POST', '/channels/verify', { platform, form }),
    diagnose: (platform: string, config?: Record<string, any>) =>
      req<{ platform: string; checks: { id: string; title: string; ok: boolean; detail: string }[]; overallReady: boolean; hints: string[] }>('POST', '/channels/diagnose', { platform, config }),
    pluginStatus: () => cached('ch/plugin-status', 30_000, () =>
      req<Record<string, { required: string; installed: boolean }>>('GET', '/channels/plugin-status')),
    action: (platform: string, action: string) =>
      req<{ output: string; ok: boolean }>('POST', '/channels/action', { platform, action })
        .then(r => { bust('ch/plugin-status'); return r }),
  },
  system: {
    health: () => req<{
      score: number
      maxScore: number
      rating: 'ok' | 'warn' | 'fail'
      generatedAt: number
      dimensions: Array<{
        key: string
        label: string
        score: number
        maxScore: number
        status: 'ok' | 'warn' | 'fail'
        message: string
        link?: string
      }>
    }>('GET', '/system/health-score'),
    stats: () => cached('system/stats', 5_000, () => req<{
      system: {
        cpuCount: number
        platform: string
        uptimeSeconds: number
        loadAvg: [number, number, number]
        memory: { totalMb: number; freeMb: number; usedPercent: number }
        disk?: { totalGb: number; freeGb: number; usedPercent: number; mountPoint: string }
      }
      service: { state: string; pid?: number }
      model: string | null
      channelCount: number
    }>('GET', '/system/stats')),
    operatorOverview: () => req<{
      connection: {
        items: Array<{ key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }>
        onlineCount: number
        totalCount: number
        rating: 'ok' | 'warn' | 'fail'
      }
      version: {
        openclawCurrent: string | null
        openclawLatest: string | null
        lastCheckedAt: string | null
        updateAvailable: boolean
        portalVersion: string
      }
      risk: {
        level: 'low' | 'medium' | 'high'
        items: Array<{ key: string; label: string; severity: 'low' | 'medium' | 'high'; ok: boolean; hint?: string }>
      }
      generatedAt: number
    }>('GET', '/system/operator-overview'),
    // ── Portal web self-upgrade ──────────────────────────────────────────
    version: () => req<{
      version: string
      builtAt: string | null
      supported: boolean
      busy: boolean
      rollbackAvailable: boolean
      rollbackType: 'frontend' | 'backend-dist' | 'backend-full' | null
      lastResult: { ok: boolean; action?: string; type?: string; version?: string; message?: string; ts?: number } | null
    }>('GET', '/system/version'),
    ping: () => req<{ ok: boolean; version: string }>('GET', '/system/ping'),
    upgrade: (file: File) => {
      const form = new FormData()
      form.append('confirm', 'true')   // MUST precede the file part so it parses
      form.append('file', file)
      // The backend may be killed by systemd-run BEFORE the response is flushed
      // for backend-* upgrades. Fetch can resolve with a non-JSON body (nginx
      // 502 HTML) or reject outright. Treat any non-JSON response as a probable
      // mid-restart success — let the caller fall through to polling, which is
      // the authoritative source of the actual outcome.
      return fetch(`${BASE}/system/upgrade`, { method: 'POST', body: form })
        .then(async r => {
          const text = await r.text()
          // Try JSON first; if it parses, trust it.
          try {
            const json = JSON.parse(text)
            if (!r.ok) throw new Error(json.error ?? '升级失败')
            return json as { type: string; version: string; restarting: boolean }
          } catch (e) {
            // Body is HTML / empty / partial. If status looks like a real error
            // (4xx that isn't an in-flight restart) surface it; otherwise assume
            // the backend started the upgrade and got killed mid-response.
            if (r.status >= 400 && r.status < 500 && r.status !== 408) {
              throw new Error(`升级失败 (HTTP ${r.status})`)
            }
            return { type: 'unknown', version: '', restarting: true }
          }
        })
        .catch(err => {
          // Network error mid-restart — also a probable success.
          if (err instanceof TypeError) {
            return { type: 'unknown', version: '', restarting: true }
          }
          throw err
        })
    },
    rollback: () => req<{ type: string; restarting: boolean }>('POST', '/system/upgrade/rollback'),
    upgradeStatus: () => req<{
      state: 'idle' | 'in_progress' | 'done'
      result?: { ok: boolean; action?: string; type?: string; version?: string; message?: string; ts?: number }
    }>('GET', '/system/upgrade/status'),
  },
  sessions: {
    list: () => req<{ agentId: string; sessions: { id: string; mtime: number }[]; sessionCount: number }[]>('GET', '/sessions'),
    getDetail: (agentId: string, sessionId: string, options?: { tail?: number }) => req<{
      sessionId: string
      sessionKey: string | null
      agentId: string
      startedAt: string | null
      cwd: string | null
      messages: Array<{
        id: string
        role: 'user' | 'assistant' | 'toolResult'
        timestamp: string
        text: string
        thinking: string
        toolCalls: Array<{ id: string; name: string; arguments: any }>
        toolResults: Array<{ toolCallId: string; content: string }>
      }>
      stats: {
        messageCount: number
        userCount: number
        assistantCount: number
        toolCallCount: number
        toolResultCount: number
      }
      truncated: boolean
      loadedMessageCount: number
    }>('GET', `/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}${options?.tail ? `?tail=${encodeURIComponent(String(options.tail))}` : ''}`),
    // Look up a session by its gateway-side session key (e.g.
    // `agent:main:portal:<uuid>`). Returns the same shape as getDetail above.
    // Used by Chat.vue to backfill assistant text that the gateway's
    // chat.history projection strips (non-final_answer phase text blocks).
    byKey: (agentId: string, sessionKey: string, options?: { tail?: number }) => req<{
      sessionId: string
      sessionKey: string | null
      agentId: string
      startedAt: string | null
      cwd: string | null
      messages: Array<{
        id: string
        role: 'user' | 'assistant' | 'toolResult'
        timestamp: string
        text: string
        thinking: string
        toolCalls: Array<{ id: string; name: string; arguments: any }>
        toolResults: Array<{ toolCallId: string; content: string }>
      }>
      stats: {
        messageCount: number
        userCount: number
        assistantCount: number
        toolCallCount: number
        toolResultCount: number
      }
      truncated: boolean
      loadedMessageCount: number
    }>('GET', `/sessions/by-key?agentId=${encodeURIComponent(agentId)}&sessionKey=${encodeURIComponent(sessionKey)}${options?.tail ? `&tail=${encodeURIComponent(String(options.tail))}` : ''}`),
    exportUrl: (agentId: string, sessionId: string) =>
      `${BASE}/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}/export`,
    clearAgent: (agentId: string) => req<{ ok: boolean; deleted: number }>('DELETE', `/sessions/${encodeURIComponent(agentId)}`),
    delete: (agentId: string, sessionId: string) => req<{ ok: boolean }>('DELETE', `/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`),
  },
  chat: {
    // Returns a raw Response for streaming
    complete: (messages: any[], mode: ChatMode = 'execute', options: ChatCompleteOptions = {}, signal?: AbortSignal) => fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: true, mode, ...options }),
      signal,
    }),
    uploadFile: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return fetch(`${BASE}/chat/file`, { method: 'POST', body: form }).then(r => r.json()) as
        Promise<{ type: 'image' | 'text'; filename: string; mimeType: string; dataUrl?: string; content?: string }>
    },
  },
  memory: {
    listAgents: () => req<{ id: string; workspace: string }[]>('GET', '/memory/agents'),
    listFiles: (agent: string, category: string) => req<any[]>('GET', `/memory/files?agent=${encodeURIComponent(agent)}&category=${encodeURIComponent(category)}`),
    readFile: (path: string) => req<{ path: string; content: string }>('GET', `/memory/file?path=${encodeURIComponent(path)}`),
    saveFile: (path: string, content: string) => req<{ ok: boolean }>('PUT', '/memory/file', { path, content }),
    deleteFile: (path: string) => req<{ ok: boolean }>('DELETE', `/memory/file?path=${encodeURIComponent(path)}`),
  },
  cron: {
    status: () => req<any>('GET', '/cron/status'),
    list: () => req<any[]>('GET', '/cron'),
    add: (job: { name: string; message: string; schedule: string; agentId?: string; enabled?: boolean; description?: string; channel?: string; accountId?: string; to?: string }) =>
      req<any>('POST', '/cron', job),
    edit: (id: string, patch: { name?: string; message?: string; schedule?: string; agentId?: string; description?: string; channel?: string; accountId?: string; to?: string; enabled?: boolean }) =>
      req<any>('PUT', `/cron/${encodeURIComponent(id)}`, patch),
    remove: (id: string) => req<{ ok: boolean }>('DELETE', `/cron/${encodeURIComponent(id)}`),
    run: (id: string) => req<{ ok: boolean }>('POST', `/cron/${encodeURIComponent(id)}/run`),
    enable: (id: string) => req<{ ok: boolean }>('POST', `/cron/${encodeURIComponent(id)}/enable`),
    disable: (id: string) => req<{ ok: boolean }>('POST', `/cron/${encodeURIComponent(id)}/disable`),
    runs: (id: string, limit = 50) => req<any[]>('GET', `/cron/${encodeURIComponent(id)}/runs?limit=${limit}`),
  },
  dreaming: {
    // initializing/error 字段仅在 memory-core 冷启动 timeout 时由 backend 返回,
    // UI 收到 initializing=true 时静默轮询而不弹 toast.error。
    status: () =>
      req<{ agentId: string; dreaming: any | null; initializing?: boolean; error?: string }>(
        'GET',
        '/dreaming/status',
      ),
    getConfig: () => req<{ enabled: boolean; frequency: string; model: string; allowModelOverride: boolean }>('GET', '/dreaming/config'),
    saveConfig: (patch: { enabled?: boolean; frequency?: string; model?: string }) =>
      req<{ ok: boolean; result: any }>('PUT', '/dreaming/config', patch),
    diary: () => req<{ exists: boolean; name: string; content: string }>('GET', '/dreaming/diary'),
    run: () => req<{ ok: boolean; jobId: string; jobName: string }>('POST', '/dreaming/run'),
  },
  usage: {
    summary: () => req<any>('GET', '/usage/summary'),
    daily: (days = 30) => req<any[]>('GET', `/usage/daily?days=${days}`),
    pressure: () => req<{ sessions: any[]; thresholds: { warn: number; critical: number } }>('GET', '/usage/pressure'),
    updateCosts: (costs: Record<string, number>) => req<{ ok: boolean }>('PUT', '/usage/costs', costs),
  },
  diagnosis: {
    runAll: () => req<any[]>('GET', '/diagnosis'),
    runCheck: (name: string) => req<any>('GET', `/diagnosis/${name}`),
    repair: (name: string) => req<any>('POST', `/diagnosis/repair/${name}`),
    doctor: () => req<{ output: string }>('GET', '/diagnosis/doctor'),
    doctorFix: () => req<{ output: string }>('POST', '/diagnosis/doctor/fix'),
    serviceInfo: () => req<any>('GET', '/diagnosis/service-info'),
    networkLog: () => req<{ entries: any[] }>('GET', '/diagnosis/network-log'),
    clearNetworkLog: () => req<{ ok: boolean }>('DELETE', '/diagnosis/network-log'),
  },
  envcheck: {
    probes: () => req<{
      probes: Array<{
        id: string
        category: string
        title: string
        status: 'ok' | 'warn' | 'fail' | 'skip'
        message: string
        details?: string
        fix?: { label: string; actionId: string }
      }>
      counts: { ok: number; warn: number; fail: number; skip: number; total: number }
      generatedAt: number
    }>('GET', '/envcheck/probes'),
    runFix: (actionId: string) => req<{ ok: boolean; message?: string; error?: string }>('POST', `/envcheck/fix/${encodeURIComponent(actionId)}`),
  },
  notifications: {
    list: () => req<{
      items: Array<{
        id: string
        type: string
        title: string
        message: string
        severity: 'warn' | 'error'
        ts: number
        link?: string
      }>
      total: number
      errorCount: number
      warnCount: number
    }>('GET', '/notifications'),
  },
  mcp: {
    list: () => req<{ servers: Array<{
      name: string; command: string; args: string[]; env: Record<string, string>;
      cwd: string; url: string; transport: string; description: string; disabled: boolean;
    }> }>('GET', '/mcp/servers'),
    get: (name: string) => req<any>('GET', `/mcp/servers/${encodeURIComponent(name)}`),
    save: (name: string, body: any) => req<{ ok: boolean }>('PUT', `/mcp/servers/${encodeURIComponent(name)}`, body),
    remove: (name: string) => req<{ ok: boolean }>('DELETE', `/mcp/servers/${encodeURIComponent(name)}`),
    test: (name: string) => req<{ ok: boolean; transport: string; note?: string; stdout?: string; stderr?: string; error?: string }>('POST', `/mcp/servers/${encodeURIComponent(name)}/test`),
    templates: () => req<{ templates: Array<{ name: string; description: string; command?: string; args?: string[]; env?: Record<string, string>; category: string }> }>('GET', '/mcp/templates'),
    serveInfo: () => req<{
      openclawBin: string
      openclawHome: string
      commandLine: string
      stdioEntry: { command: string; args: string[]; env: Record<string, string> }
      clients: Record<string, { path: string; json: any }>
    }>('GET', '/mcp/serve-info'),
    serveVerify: () => req<{
      ok: boolean
      error?: string
      serverInfo?: { name?: string; version?: string } | null
      protocolVersion?: string | null
      capabilities?: any
      tools?: Array<{ name: string; description?: string }>
      stdout?: string
      stderr?: string
    }>('POST', '/mcp/serve/verify'),
  },
  backup: {
    manifest: () => req<{
      home: string
      items: Array<{ path: string; exists: boolean; size: number; kind: 'file' | 'directory' | 'missing' }>
      fileCount: number
      dirCount: number
      totalFileSize: number
    }>('GET', '/backup/manifest'),
    exportUrl: () => `${BASE}/backup/export`,
  },
  activity: {
    recent: (params?: { limit?: number; session?: string; since?: number }) => {
      const q = new URLSearchParams()
      if (params?.limit  != null) q.set('limit',  String(params.limit))
      if (params?.session)        q.set('session', params.session)
      if (params?.since  != null) q.set('since',  String(params.since))
      return req<{ entries: any[]; bufferSize: number }>('GET', `/activity/recent?${q}`)
    },
    sessions: () => req<{ sessions: Array<{ sessionKey: string; agent: string; messageCount: number; toolCount: number; lastTs: number; lastEvent: string }> }>('GET', '/activity/sessions'),
  },
  audit: {
    list: (params?: { limit?: number; offset?: number; action?: string; result?: string; since?: number; until?: number; search?: string }) => {
      const q = new URLSearchParams()
      if (params?.limit  != null) q.set('limit',  String(params.limit))
      if (params?.offset != null) q.set('offset', String(params.offset))
      if (params?.action) q.set('action', params.action)
      if (params?.result) q.set('result', params.result)
      if (params?.since  != null) q.set('since',  String(params.since))
      if (params?.until  != null) q.set('until',  String(params.until))
      if (params?.search) q.set('search', params.search)
      return req<{ entries: any[]; total: number }>('GET', `/audit?${q}`)
    },
    actions: () => req<{ actions: string[] }>('GET', '/audit/actions'),
  },
  logs: {
    sources: () => req<{ sources: Array<{ id: string; label: string; available: boolean; reason?: string }> }>('GET', '/logs/sources'),
    list: (params?: { lines?: number; level?: string; search?: string; source?: string }) => {
      const q = new URLSearchParams()
      if (params?.lines)  q.set('lines', String(params.lines))
      if (params?.level)  q.set('level', params.level)
      if (params?.search) q.set('search', params.search)
      if (params?.source) q.set('source', params.source)
      return req<{ entries: any[]; total: number; logFile: string; source?: string }>('GET', `/logs?${q}`)
    },
    clear: (source?: string) => {
      const q = source ? `?source=${encodeURIComponent(source)}` : ''
      return req<{ ok: boolean }>('DELETE', `/logs${q}`)
    },
  },
  gateway: {
    get: () => cached('gateway', 10_000, () => req<any>('GET', '/gateway')),
    update: (patch: any) => req<{ ok: boolean }>('PUT', '/gateway', patch)
      .then(r => { bust('gateway'); return r }),
    listDevices: () => req<{ pendingRequests: any[]; pairedDevices: any[] }>('GET', '/gateway/devices'),
    approveDevice: (requestId?: string) => req<{ ok: boolean; result?: any }>('POST', '/gateway/devices/approve', requestId ? { requestId } : {}),
    rejectDevice: (requestId: string) => req<{ ok: boolean; result?: any }>('POST', '/gateway/devices/reject', { requestId }),
    removeDevice: (deviceId: string) => req<{ ok: boolean; result?: any }>('DELETE', `/gateway/devices/${encodeURIComponent(deviceId)}`),
  },
  configEditor: {
    getRaw: () => req<{ raw: string; configPath: string }>('GET', '/config/raw'),
    saveRaw: (raw: string) => req<{ ok: boolean; backupPath: string }>('PUT', '/config/raw', { raw }),
    getSection: (section: string) => req<{ raw: string; section: string }>('GET', `/config/section/${section}`),
    saveSection: (section: string, raw: string) => req<{ ok: boolean; backupPath: string }>('PUT', `/config/section/${section}`, { raw }),
    listBackups: () => req<{ backups: any[]; backupDir: string }>('GET', '/config/backups'),
    restore: (filename: string) => req<{ ok: boolean; safeguard: string }>('POST', '/config/restore', { filename }),
  },
  settings: {
    get: () => cached('settings', 30_000, () => req<{
      httpProxy: string
      httpsProxy: string
      npmRegistry: string
      skillRegistrySources: { id: string; name: string; type: 'local' | 'remote'; url: string }[]
      activeSkillRegistrySourceId: string
      gatewayPort: number
      portalPort: number
      openclawHome: string
    }>('GET', '/settings')),
    update: (patch: {
      httpProxy?: string
      httpsProxy?: string
      npmRegistry?: string
      skillRegistrySources?: { id: string; name: string; type: 'local' | 'remote'; url: string }[]
      activeSkillRegistrySourceId?: string
    }) => req<{ ok: boolean }>('PUT', '/settings', patch)
      .then(r => { bust('settings'); return r }),
  },
  commandLog: {
    list: () => req<{ entries: any[] }>('GET', '/command-log'),
    clear: () => req<{ ok: boolean }>('DELETE', '/command-log'),
  },
}
