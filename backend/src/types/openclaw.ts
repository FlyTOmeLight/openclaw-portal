export interface ModelSpec {
  id: string
  name: string
  reasoning: boolean
  input: string[]
  contextWindow: number
  maxTokens: number
}

export interface ModelProvider {
  baseUrl: string
  apiKey: string
  api: string
  models: ModelSpec[]
}

export interface AgentDefaults {
  model: {
    primary: string
    fallbacks: string[]
  }
}

export interface AgentToolsConfig {
  profile?: string
  allow?: string[]
  alsoAllow?: string[]
  deny?: string[]
}

export interface AgentSubagentPolicy {
  allowAgents?: string[]
}

export interface AgentListEntry {
  id: string
  workspace?: string
  agentDir?: string
  model?: string | { primary: string; fallbacks?: string[] }
  thinking?: string
  enabled?: boolean
  tools?: AgentToolsConfig
  subagents?: AgentSubagentPolicy
  [key: string]: unknown
}

export interface TrustedProxyAuth {
  mode: 'trusted-proxy'
  trustedProxy: {
    userHeader: string
    requiredHeaders: string[]
    allowUsers: string[]
  }
}

export interface TokenAuth {
  mode: 'token'
  token: string
}

export interface PasswordAuth {
  mode: 'password'
  password: string
}

export interface NoAuth {
  mode: 'none'
}

export type GatewayAuth = TrustedProxyAuth | TokenAuth | PasswordAuth | NoAuth | {
  mode: string
  token?: string
  password?: string
  trustedProxy?: {
    userHeader?: string
    requiredHeaders?: string[]
    allowUsers?: string[]
  }
}

export interface GatewayConfig {
  port: number
  mode: string
  bind: string
  controlUi: {
    enabled: boolean
    allowedOrigins: string[]
    allowInsecureAuth?: boolean
  }
  auth: GatewayAuth
  trustedProxies: string[]
}

export interface ChannelConfig {
  enabled: boolean
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled'
  allowFrom?: (string | number)[]
  accounts?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type ChannelMap = Record<string, ChannelConfig>

// legacy key = "<platform>/<accountId>/<scope>" where scope is "private" | "group" | "all"
export type BindingMap = Record<string, string>

export type AgentRouteMatch = {
    channel: string
    accountId?: string
    peer?: string | { kind?: string; id?: string }
    [key: string]: unknown
  }

export interface AgentRouteBinding {
  type?: string
  agentId: string
  match: AgentRouteMatch
  [key: string]: unknown
}

export interface AccountSummary {
  accountId: string
  appId?: string
}

export interface ConfiguredPlatform {
  id: string
  enabled: boolean
  accounts: AccountSummary[]
}

export interface OpenclawConfig {
  meta?: {
    lastTouchedVersion?: string
    lastTouchedAt?: string
  }
  models: {
    providers: Record<string, ModelProvider>
  }
  agents: {
    defaults: AgentDefaults
    list?: AgentListEntry[]
  }
  channels?: ChannelMap
  bindings?: BindingMap | AgentRouteBinding[]
  commands?: {
    native?: string
    nativeSkills?: string
    restart?: boolean
    ownerDisplay?: string
  }
  gateway: GatewayConfig
}
