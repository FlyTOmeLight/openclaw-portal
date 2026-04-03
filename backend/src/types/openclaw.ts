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

export interface TrustedProxyAuth {
  mode: 'trusted-proxy'
  trustedProxy: {
    userHeader: string
    requiredHeaders: string[]
    allowUsers: string[]
  }
}

export interface GatewayConfig {
  port: number
  mode: string
  bind: string
  controlUi: {
    enabled: boolean
    allowedOrigins: string[]
  }
  auth: TrustedProxyAuth
  trustedProxies: string[]
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
  }
  commands?: {
    native?: string
    nativeSkills?: string
    restart?: boolean
    ownerDisplay?: string
  }
  gateway: GatewayConfig
}
