const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Request failed')
  }
  return res.json()
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
    test: (baseUrl: string, apiKey: string, modelId: string) =>
      req<{ ok: boolean }>('POST', '/models/test', { baseUrl, apiKey, modelId }),
  },
  skills: {
    list: () => req<any[]>('GET', '/skills'),
    disable: (name: string, agent: string) => req<{ ok: boolean }>('POST', `/skills/${name}/disable`, { agent }),
    enable: (name: string, agent: string) => req<{ ok: boolean }>('POST', `/skills/${name}/enable`, { agent }),
    install: (file: File, agent: string | null) => {
      const form = new FormData()
      form.append('file', file)
      if (agent) form.append('agent', agent)
      return fetch('/api/skills/install', { method: 'POST', body: form }).then(r => r.json())
    },
  },
  plugins: {
    list: () => req<any[]>('GET', '/plugins'),
    install: (packageName: string) => req<{ ok: boolean }>('POST', '/plugins/install', { packageName }),
    uninstall: (name: string) => req<{ ok: boolean }>('DELETE', `/plugins/${encodeURIComponent(name)}`),
  },
  agents: {
    list: () => req<any[]>('GET', '/agents'),
    updateSoul: (name: string, soul: string) => req<{ ok: boolean }>('PUT', `/agents/${name}/soul`, { soul }),
  },
}
