export type PortalModelApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'ollama'

export interface ModelPreset {
  id: string
  name: string
  contextWindow: number
  maxTokens?: number
  reasoning?: boolean
}

export interface ProviderPreset {
  key: string
  label: string
  api: PortalModelApi
  baseUrl: string
  desc?: string
  apiKeyPlaceholder?: string
  modelPlaceholder?: string
  models?: ModelPreset[]
}

export const API_OPTIONS: Array<{ value: PortalModelApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI 兼容 / Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama 原生' },
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'qtcool',
    label: '晴辰云',
    api: 'openai-completions',
    baseUrl: 'https://gpt.qt.cool/v1',
    desc: '聚合型 OpenAI 兼容平台，适合快速接入多模型。',
  },
  {
    key: 'shengsuanyun',
    label: '胜算云',
    api: 'openai-completions',
    baseUrl: 'https://router.shengsuanyun.com/api/v1',
    desc: '聚合型 OpenAI 兼容平台，支持多家模型厂商。',
  },
  {
    key: 'siliconflow',
    label: '硅基流动',
    api: 'openai-completions',
    baseUrl: 'https://api.siliconflow.cn/v1',
    desc: '高性价比推理平台，常见开源模型较全。',
  },
  {
    key: 'volcengine',
    label: '火山引擎',
    api: 'openai-completions',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    desc: '豆包等模型常见接入方式，注意不是 /v1。',
  },
  {
    key: 'aliyun',
    label: '阿里云百炼',
    api: 'openai-completions',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    desc: '通义千问系列常见入口。',
    models: [
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768, maxTokens: 8192 },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, maxTokens: 8192 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000, maxTokens: 8192 },
    ],
  },
  {
    key: 'zhipu',
    label: '智谱 AI',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    desc: 'GLM 系列常见入口。',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4-Plus', contextWindow: 128000, maxTokens: 8192 },
      { id: 'glm-4-air', name: 'GLM-4-Air', contextWindow: 128000, maxTokens: 8192 },
      { id: 'glm-4-flash', name: 'GLM-4-Flash', contextWindow: 128000, maxTokens: 8192 },
    ],
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    api: 'openai-completions',
    baseUrl: 'https://api.minimax.io/v1',
    desc: '兼容 OpenAI 的国产多模态模型平台。',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 1000000, maxTokens: 8192 },
      { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 204000, maxTokens: 8192 },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI 官方',
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    desc: '默认优先推荐 Responses API。',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384 },
      { id: 'o3-mini', name: 'o3 Mini', contextWindow: 200000, maxTokens: 100000, reasoning: true },
    ],
  },
  {
    key: 'anthropic',
    label: 'Anthropic 官方',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    desc: '会自动补齐 /v1 并走 Messages 协议。',
    apiKeyPlaceholder: 'sk-ant-…',
    models: [
      { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 8192 },
      { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', contextWindow: 200000, maxTokens: 8192 },
    ],
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    desc: 'DeepSeek 官方 OpenAI 兼容入口。',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 64000, maxTokens: 8192 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 64000, maxTokens: 8192, reasoning: true },
    ],
  },
  {
    key: 'google',
    label: 'Google Gemini',
    api: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    desc: '通过 Google Generative Language API 接入 Gemini。',
    apiKeyPlaceholder: 'AIza…',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxTokens: 8192, reasoning: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxTokens: 8192 },
    ],
  },
  {
    key: 'nvidia',
    label: 'NVIDIA NIM',
    api: 'openai-completions',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    desc: 'NVIDIA 推理平台，兼容 OpenAI Chat Completions。',
  },
  {
    key: 'ollama',
    label: 'Ollama（本地）',
    api: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    desc: '走 Ollama 原生 API，本地部署通常无需 API Key。',
    apiKeyPlaceholder: '可留空',
    models: [
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768, maxTokens: 4096 },
      { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 8192, maxTokens: 4096 },
      { id: 'gemma3', name: 'Gemma 3', contextWindow: 32768, maxTokens: 4096 },
    ],
  },
]

export function getProviderPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.key === key)
}

export function detectProviderPreset(
  providerId: string,
  provider: { api?: string; baseUrl?: string },
): ProviderPreset | undefined {
  const normalizedId = providerId.toLowerCase()
  const normalizedApi = (provider.api ?? '').toLowerCase()
  const normalizedBaseUrl = (provider.baseUrl ?? '').replace(/\/+$/, '').toLowerCase()

  return PROVIDER_PRESETS.find((preset) =>
    preset.key === normalizedId
    || (
      preset.api === normalizedApi
      && preset.baseUrl.replace(/\/+$/, '').toLowerCase() === normalizedBaseUrl
    ))
}
