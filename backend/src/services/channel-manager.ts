import { readFile } from 'fs/promises'
import type {
  AccountSummary,
  AgentRouteBinding,
  AgentRouteMatch,
  BindingMap,
  ChannelConfig,
  ChannelMap,
  ConfiguredPlatform,
  OpenclawConfig,
} from '../types/openclaw.js'
import { runCli } from './cli-runner.js'
import { serializePath, atomicWriteFile } from './file-lock.js'

const QQBOT_DEFAULT_ACCOUNT_ID = 'default'

// Match the Lansenger plugin's own derivation:
//   dist/index.js → `bot_${appId.split('-')[1]}` (see @lansenger/openclaw-channel-lansenger README)
function deriveLansengerAccountId(appId: string | undefined): string {
  const raw = String(appId ?? '').trim()
  if (!raw) return `bot_${Math.floor(Math.random() * 10000)}`
  const parts = raw.split('-')
  const tail = parts[1] || parts[0]
  return `bot_${tail}`
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function platformStorageKey(platform: string): string {
  switch (platform) {
    case 'dingtalk':
    case 'dingtalk-connector':
      return 'dingtalk-connector'
    case 'weixin':
      return 'openclaw-weixin'
    default:
      return platform
  }
}

function platformListId(platform: string): string {
  switch (platform) {
    case 'dingtalk-connector':
      return 'dingtalk'
    case 'openclaw-weixin':
      return 'weixin'
    default:
      return platform
  }
}

function platformBindingChannel(platform: string): string {
  const storageKey = platformStorageKey(platform)
  if (storageKey === 'dingtalk-connector') return 'dingtalk-connector'
  if (storageKey === 'openclaw-weixin') return 'openclaw-weixin'
  return platformListId(storageKey)
}

function channelHasQqbotCredentials(entry: Record<string, any> | undefined): boolean {
  return !!(entry && (entry.appId || entry.clientSecret || entry.appSecret || entry.token))
}

function resolvePlatformConfigEntry(
  channelRoot: Record<string, any> | undefined,
  platform: string,
  accountId?: string | null,
): Record<string, any> | null {
  if (!channelRoot || typeof channelRoot !== 'object') return null
  const accountKey = typeof accountId === 'string' ? accountId.trim() : ''
  if (accountKey) return channelRoot.accounts?.[accountKey] ?? channelRoot
  if (platformStorageKey(platform) === 'qqbot' && !channelHasQqbotCredentials(channelRoot)) {
    return channelRoot.accounts?.[QQBOT_DEFAULT_ACCOUNT_ID] ?? channelRoot
  }
  return channelRoot
}

function listPlatformAccounts(channelRoot: Record<string, any> | undefined): AccountSummary[] {
  if (!channelRoot || typeof channelRoot !== 'object' || !channelRoot.accounts || typeof channelRoot.accounts !== 'object') {
    return []
  }
  return Object.entries(channelRoot.accounts)
    .map(([accountId, value]: [string, any]) => {
      const entry: AccountSummary = { accountId }
      const displayId = value?.appId || value?.clientId || value?.account || null
      if (displayId) entry.appId = displayId
      return entry
    })
    .sort((a, b) => (a.accountId || '').localeCompare(b.accountId || ''))
}

function normalizeBindingMatchValue(value: any): JsonValue | undefined {
  if (Array.isArray(value)) {
    const normalized = value.map(item => normalizeBindingMatchValue(item)).filter(item => item !== undefined) as JsonValue[]
    if (normalized.every(item => typeof item === 'string')) {
      return [...normalized].sort() as JsonValue
    }
    return normalized as JsonValue
  }
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    for (const key of Object.keys(value).sort()) {
      if (key === 'peer') {
        const peer = value[key]
        if (typeof peer === 'string' && peer.trim()) {
          result.peer = { kind: 'direct', id: peer.trim() }
        } else if (peer && typeof peer === 'object' && typeof peer.id === 'string' && peer.id.trim()) {
          result.peer = {
            kind: typeof peer.kind === 'string' && peer.kind.trim() ? peer.kind.trim() : 'direct',
            id: peer.id.trim(),
          }
        }
        continue
      }
      const normalized = normalizeBindingMatchValue(value[key])
      if (normalized === undefined) continue
      if (key === 'accountId' && (normalized === '' || normalized === null)) continue
      if (typeof normalized === 'string' && !normalized.trim()) continue
      result[key] = normalized
    }
    return result
  }
  if (typeof value === 'string') return value.trim()
  return value as JsonValue
}

function jsonValueEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => jsonValueEquals(item, right[index]))
  }
  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && jsonValueEquals((left as any)[key], (right as any)[key]))
  }
  return false
}

function buildBindingMatch(channel: string, accountId?: string | null, bindingConfig?: Record<string, any>): AgentRouteMatch {
  const match: AgentRouteMatch = {
    channel,
    ...(accountId ? { accountId } : {}),
  }
  if (bindingConfig && typeof bindingConfig === 'object') {
    for (const [key, value] of Object.entries(bindingConfig)) {
      if (key === 'peer') {
        if (typeof value === 'string' && value.trim()) {
          match.peer = { kind: 'direct', id: value.trim() }
        } else if (value && typeof value === 'object' && (value as any).id) {
          match.peer = { kind: (value as any).kind || 'direct', id: (value as any).id }
        }
      } else if (key !== 'accountId' && key !== 'channel' && value !== undefined && value !== null) {
        match[key] = value
      }
    }
  }
  return (normalizeBindingMatchValue(match) as AgentRouteMatch) ?? match
}

function bindingIdentityMatches(binding: AgentRouteBinding, agentId: string, targetMatch: AgentRouteMatch): boolean {
  if ((binding?.agentId || 'main') !== (agentId || 'main')) return false
  return jsonValueEquals(
    normalizeBindingMatchValue(binding?.match || {}),
    normalizeBindingMatchValue(targetMatch || {}),
  )
}

export class ChannelManager {
  constructor(
    private readonly configPath: string,
    private readonly openclawBin: string,
  ) {}

  private async readConfig(): Promise<OpenclawConfig> {
    try {
      const raw = await readFile(this.configPath, 'utf-8')
      return JSON.parse(raw) as OpenclawConfig
    } catch (err: any) {
      // ENOENT on first run is expected; other errors (permission, malformed JSON) signal config damage.
      if (err?.code !== 'ENOENT') {
        console.warn('[channel-manager] Failed to read config, using defaults:', this.configPath, err?.message ?? err)
      }
      return {
        models: { providers: {} },
        agents: { defaults: { model: { primary: '', fallbacks: [] } } },
        gateway: {} as any,
      }
    }
  }

  private async writeConfig(cfg: OpenclawConfig): Promise<void> {
    await atomicWriteFile(this.configPath, JSON.stringify(cfg, null, 2))
  }

  /**
   * Run a read-modify-write operation under a shared file lock (serializePath).
   * Both ConfigManager and ChannelManager write to openclaw.json — the shared
   * lock prevents cross-service interleaving races.
   */
  private mutate<T>(fn: (cfg: OpenclawConfig) => T | Promise<T>): Promise<T> {
    return serializePath(this.configPath, async () => {
      const cfg = await this.readConfig()
      const result = await fn(cfg)
      await this.writeConfig(cfg)
      return result
    })
  }

  private triggerReload(): void {
    runCli(this.openclawBin, ['reload']).catch(() => {})
  }

  private getBindingsArray(cfg: OpenclawConfig): AgentRouteBinding[] {
    if (Array.isArray(cfg.bindings)) return cfg.bindings
    if (!cfg.bindings || typeof cfg.bindings !== 'object') return []
    return Object.entries(cfg.bindings as BindingMap).flatMap(([key, agentId]) => {
      const [platform = '', accountId = '', scope = ''] = key.split('/')
      const match: AgentRouteMatch = { channel: platform }
      if (accountId) match.accountId = accountId
      if (scope === 'private') match.peer = { kind: 'direct' }
      if (scope === 'group') match.peer = { kind: 'group' }
      return [{ type: 'route', agentId, match }]
    })
  }

  async listChannels(): Promise<ChannelMap> {
    const cfg = await this.readConfig()
    return cfg.channels ?? {}
  }

  async upsertChannel(name: string, config: ChannelConfig): Promise<void> {
    await this.mutate(cfg => {
      cfg.channels = { ...(cfg.channels ?? {}), [name]: config }
    })
    this.triggerReload()
  }

  async removeChannel(name: string): Promise<void> {
    let changed = false
    await this.mutate(cfg => {
      if (cfg.channels && name in cfg.channels) {
        delete cfg.channels[name]
        changed = true
      }
    })
    if (changed) this.triggerReload()
  }

  async getStatus(): Promise<string> {
    try {
      return await runCli(this.openclawBin, ['channels', 'status'])
    } catch (e: any) {
      return e.stdout?.toString() || e.stderr?.toString() || ''
    }
  }

  async listBindings(): Promise<BindingMap> {
    const cfg = await this.readConfig()
    if (!Array.isArray(cfg.bindings) && cfg.bindings && typeof cfg.bindings === 'object') {
      return cfg.bindings as BindingMap
    }
    const result: BindingMap = {}
    for (const binding of this.getBindingsArray(cfg)) {
      const match = binding.match ?? {}
      const channel = match.channel
      if (!channel || typeof channel !== 'string') continue
      const accountId = typeof match.accountId === 'string' ? match.accountId : channel
      const peerKind = typeof match.peer === 'string' ? 'direct' : (match.peer?.kind || '')
      const scope = peerKind === 'group' ? 'group' : peerKind === 'direct' ? 'private' : 'all'
      result[`${channel}/${accountId}/${scope}`] = binding.agentId || 'main'
    }
    return result
  }

  async setBinding(platform: string, accountId: string, scope: string, agentId: string | null): Promise<void> {
    await this.mutate(cfg => {
      if (!Array.isArray(cfg.bindings) && cfg.bindings && typeof cfg.bindings === 'object') {
        const bindings = { ...(cfg.bindings as BindingMap) }
        const key = `${platform}/${accountId}/${scope}`
        if (agentId === null) delete bindings[key]
        else bindings[key] = agentId
        cfg.bindings = bindings
        return
      }

      const channel = platform
      const bindingConfig = scope === 'private'
        ? { peer: { kind: 'direct' } }
        : scope === 'group'
          ? { peer: { kind: 'group' } }
          : {}
      const targetMatch = buildBindingMatch(channel, accountId || null, bindingConfig)
      const bindings = this.getBindingsArray(cfg)
      const sameTarget = (binding: AgentRouteBinding) => jsonValueEquals(
        normalizeBindingMatchValue(binding?.match || {}),
        normalizeBindingMatchValue(targetMatch || {}),
      )
      cfg.bindings = agentId === null
        ? bindings.filter(binding => !sameTarget(binding))
        : [
            ...bindings.filter(binding => !sameTarget(binding)),
            { type: 'route', agentId, match: targetMatch },
          ]
    })
    this.triggerReload()
  }

  async listConfiguredPlatforms(): Promise<ConfiguredPlatform[]> {
    const cfg = await this.readConfig()
    const channels = cfg.channels ?? {}
    return Object.entries(channels).map(([id, val]) => ({
      id: platformListId(id),
      enabled: val?.enabled !== false,
      accounts: listPlatformAccounts(val as Record<string, any>),
    }))
  }

  async readPlatformConfig(platform: string, accountId?: string | null): Promise<{ exists: boolean; values?: Record<string, any> }> {
    const cfg = await this.readConfig()
    const storageKey = platformStorageKey(platform)
    const channelRoot = cfg.channels?.[storageKey]
    const saved = resolvePlatformConfigEntry(channelRoot as Record<string, any> | undefined, platform, accountId)
    if (!saved) return { exists: false }

    const form: Record<string, any> = {}
    if (platform === 'qqbot') {
      const token = saved.token || ''
      const [appIdFromToken, ...rest] = String(token).split(':')
      const appId = saved.appId || appIdFromToken || ''
      const clientSecret = saved.clientSecret || saved.appSecret || (rest.length ? rest.join(':') : '')
      if (!appId && !clientSecret) return { exists: false }
      if (appId) form.appId = appId
      if (clientSecret) form.clientSecret = clientSecret
    } else if (platform === 'telegram') {
      if (saved.botToken) form.botToken = saved.botToken
      if (saved.allowFrom) form.allowedUsers = Array.isArray(saved.allowFrom) ? saved.allowFrom.join(', ') : saved.allowFrom
    } else if (platform === 'discord') {
      if (saved.token) form.token = saved.token
      const guildId = saved.guilds && typeof saved.guilds === 'object' ? Object.keys(saved.guilds)[0] : ''
      if (guildId) form.guildId = guildId
    } else if (platform === 'feishu') {
      if (saved.appId) form.appId = saved.appId
      if (saved.appSecret) form.appSecret = saved.appSecret
      if (saved.domain) form.domain = saved.domain
    } else {
      for (const [key, value] of Object.entries(saved)) {
        if (key !== 'enabled' && key !== 'accounts' && typeof value === 'string') form[key] = value
      }
    }

    return { exists: true, values: form }
  }

  async saveMessagingPlatform(platform: string, form: Record<string, any>, accountId?: string | null): Promise<{ accountId: string | null }> {
    let effectiveAccountId: string | null = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null
    await this.mutate(cfg => {
    cfg.channels = cfg.channels ?? {}
    const storageKey = platformStorageKey(platform)
    const normalizedAccountId = typeof accountId === 'string' ? accountId.trim() : ''

    const setRootChannelEntry = (entry: ChannelConfig) => {
      const current = cfg.channels?.[storageKey]
      if (current && typeof current === 'object' && current.accounts && typeof current.accounts === 'object') {
        entry.accounts = current.accounts
      }
      cfg.channels![storageKey] = entry as ChannelConfig
    }

    const setAccountChannelEntry = (entry: ChannelConfig) => {
      const current = cfg.channels?.[storageKey] && typeof cfg.channels[storageKey] === 'object'
        ? (cfg.channels[storageKey] as Record<string, any>)
        : { enabled: true }
      current.enabled = true
      if (!current.accounts || typeof current.accounts !== 'object') current.accounts = {}
      current.accounts[normalizedAccountId] = entry
      cfg.channels![storageKey] = current as ChannelConfig
    }

    const entry: ChannelConfig = { enabled: true }

    if (platform === 'qqbot') {
      const clientSecret = form.clientSecret || form.appSecret
      if (!form.appId || !clientSecret) throw new Error('AppID 和 ClientSecret 不能为空')
      const current = cfg.channels.qqbot && typeof cfg.channels.qqbot === 'object'
        ? (cfg.channels.qqbot as Record<string, any>)
        : { enabled: true }
      current.enabled = true
      delete current.appId
      delete current.clientSecret
      delete current.appSecret
      delete current.token
      if (!current.accounts || typeof current.accounts !== 'object') current.accounts = {}
      const accountKey = normalizedAccountId || QQBOT_DEFAULT_ACCOUNT_ID
      current.accounts[accountKey] = {
        appId: form.appId,
        clientSecret,
        token: `${form.appId}:${clientSecret}`,
        enabled: true,
      }
      cfg.channels.qqbot = current as ChannelConfig
    } else if (platform === 'telegram') {
      entry.botToken = form.botToken
      if (form.allowedUsers) entry.allowFrom = String(form.allowedUsers).split(',').map((s: string) => s.trim()).filter(Boolean)
    } else if (platform === 'discord') {
      entry.token = form.token
      entry.groupPolicy = 'allowlist'
      if (form.guildId) {
        const channelKey = form.channelId || '*'
        entry.guilds = {
          [form.guildId]: { users: ['*'], requireMention: true, channels: { [channelKey]: { allow: true, requireMention: true } } },
        }
      }
    } else if (platform === 'feishu') {
      entry.appId = form.appId
      entry.appSecret = form.appSecret
      entry.connectionMode = 'websocket'
      if (form.domain) entry.domain = form.domain
      if (normalizedAccountId) setAccountChannelEntry(entry)
      else setRootChannelEntry(entry)
    } else if (platform === 'dingtalk' || platform === 'dingtalk-connector') {
      Object.assign(entry, form)
      if (normalizedAccountId) setAccountChannelEntry(entry)
      else setRootChannelEntry(entry)
    } else if (platform === 'Lansenger') {
      // Per @lansenger/openclaw-channel-lansenger schema: config must live under
      //   channels.Lansenger.accounts.<accountId>.{ appId, appSecret, apiGatewayUrl, agentId? }
      // If the caller didn't pick an accountId, derive it the same way the
      // plugin's CLI does (bot_<appId-suffix>) so the runtime binding matches.
      if (!form.appId || !form.appSecret || !form.apiGatewayUrl) {
        throw new Error('Lansenger 需要 App ID、App Secret 和 API 网关地址')
      }
      const resolvedAccountId = normalizedAccountId || deriveLansengerAccountId(form.appId)
      const account: Record<string, any> = {
        appId: form.appId,
        appSecret: form.appSecret,
        apiGatewayUrl: form.apiGatewayUrl,
      }
      if (typeof form.agentId === 'string' && form.agentId.trim()) account.agentId = form.agentId.trim()
      const current = cfg.channels?.Lansenger && typeof cfg.channels.Lansenger === 'object'
        ? (cfg.channels.Lansenger as Record<string, any>)
        : { enabled: true }
      current.enabled = current.enabled !== false
      if (!current.accounts || typeof current.accounts !== 'object') current.accounts = {}
      current.accounts[resolvedAccountId] = account
      cfg.channels.Lansenger = current as ChannelConfig
      effectiveAccountId = resolvedAccountId
    } else {
      Object.assign(entry, form)
      setRootChannelEntry(entry)
    }

    // telegram / discord / slack etc. don't invoke the helper setters above,
    // so they still need this direct assignment. Platforms with per-account
    // nesting (qqbot/feishu/dingtalk/Lansenger) already persisted themselves
    // and would have their accounts map wiped if we hit this line.
    if (!['qqbot', 'feishu', 'dingtalk', 'dingtalk-connector', 'Lansenger'].includes(platform)) {
      cfg.channels[storageKey] = entry
    }
    })
    this.triggerReload()
    return { accountId: effectiveAccountId }
  }

  async removeMessagingPlatform(platform: string, accountId?: string | null): Promise<void> {
    await this.mutate(cfg => {
      const storageKey = platformStorageKey(platform)
      const bindingChannel = platformBindingChannel(platform)
      const normalizedAccountId = typeof accountId === 'string' ? accountId.trim() : ''

      if (normalizedAccountId) {
        if (cfg.channels?.[storageKey]?.accounts && typeof cfg.channels[storageKey].accounts === 'object') {
          delete (cfg.channels[storageKey] as Record<string, any>).accounts[normalizedAccountId]
        }
      } else if (cfg.channels) {
        delete cfg.channels[storageKey]
      }

      const bindings = this.getBindingsArray(cfg)
      cfg.bindings = bindings.filter(binding => {
        if (binding.match?.channel !== bindingChannel) return true
        if (normalizedAccountId) return (binding.match?.accountId || '') !== normalizedAccountId
        return false
      })
    })
    this.triggerReload()
  }

  async toggleMessagingPlatform(platform: string, enabled: boolean): Promise<void> {
    await this.mutate(cfg => {
      const storageKey = platformStorageKey(platform)
      if (!cfg.channels?.[storageKey]) throw new Error(`平台 ${platform} 未配置`)
      ;(cfg.channels[storageKey] as Record<string, any>).enabled = enabled
    })
    this.triggerReload()
  }

  async listAllBindings(): Promise<{ bindings: AgentRouteBinding[] }> {
    const cfg = await this.readConfig()
    return { bindings: this.getBindingsArray(cfg) }
  }

  async saveAgentBinding(agentId: string, channel: string, accountId?: string | null, bindingConfig?: Record<string, any>): Promise<void> {
    await this.mutate(cfg => {
      const bindings = this.getBindingsArray(cfg)
      const targetMatch = buildBindingMatch(channel, accountId, bindingConfig)
      const nextBinding: AgentRouteBinding = { type: 'route', agentId, match: targetMatch }

      let found = false
      const nextBindings = bindings.map(binding => {
        if (bindingIdentityMatches(binding, agentId, targetMatch)) {
          found = true
          return nextBinding
        }
        return binding
      })
      if (!found) nextBindings.push(nextBinding)
      cfg.bindings = nextBindings
    })
    this.triggerReload()
  }

  async deleteAgentBinding(agentId: string, channel: string, accountId?: string | null, bindingConfig?: Record<string, any>): Promise<{ ok: true; removed: number }> {
    const removed = await this.mutate(cfg => {
      const bindings = this.getBindingsArray(cfg)
      const targetMatch = buildBindingMatch(channel, accountId, bindingConfig)
      const nextBindings = bindings.filter(binding => !bindingIdentityMatches(binding, agentId, targetMatch))
      const n = bindings.length - nextBindings.length
      cfg.bindings = nextBindings
      return n
    })
    this.triggerReload()
    return { ok: true, removed }
  }
}
