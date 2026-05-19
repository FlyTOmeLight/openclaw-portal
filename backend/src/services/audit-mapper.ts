// URL → audit action mapping. Declarative so all sensitive operations live in
// one place. Keep ordered by specificity (most specific first) since the first
// match wins.

interface Rule {
  methods: string[]
  pattern: RegExp
  action: string
  target?: (m: RegExpMatchArray) => string
}

const RULES: Rule[] = [
  // Config
  { methods: ['PUT'],    pattern: /^\/api\/config\/raw(?:\?|$)/,               action: 'config.raw_update' },
  { methods: ['PUT'],    pattern: /^\/api\/config\/section\/([^/?]+)/,         action: 'config.section_update', target: m => m[1] },
  { methods: ['POST'],   pattern: /^\/api\/config\/restore(?:\?|$)/,           action: 'config.restore' },

  // Plugins
  { methods: ['POST'],   pattern: /^\/api\/plugins\/install(?:\?|$)/,          action: 'plugin.install' },
  { methods: ['POST'],   pattern: /^\/api\/plugins(?:\?|$)/,                   action: 'plugin.install' },
  { methods: ['DELETE'], pattern: /^\/api\/plugins\/([^/?]+)/,                 action: 'plugin.uninstall', target: m => decodeURIComponent(m[1]) },

  // Channels
  { methods: ['POST'],   pattern: /^\/api\/channels(?:\?|$)/,                  action: 'channel.create' },
  { methods: ['PUT', 'PATCH'], pattern: /^\/api\/channels\/([^/?]+)/,          action: 'channel.update', target: m => m[1] },
  { methods: ['DELETE'], pattern: /^\/api\/channels\/([^/?]+)/,                action: 'channel.delete', target: m => m[1] },

  // Agents
  { methods: ['POST'],   pattern: /^\/api\/agents(?:\?|$)/,                    action: 'agent.create' },
  { methods: ['PUT', 'PATCH'], pattern: /^\/api\/agents\/([^/?]+)/,            action: 'agent.update', target: m => m[1] },
  { methods: ['DELETE'], pattern: /^\/api\/agents\/([^/?]+)/,                  action: 'agent.delete', target: m => m[1] },

  // Skills
  { methods: ['POST'],   pattern: /^\/api\/skills\/([^/?]+)\/install/,         action: 'skill.install', target: m => decodeURIComponent(m[1]) },
  { methods: ['POST'],   pattern: /^\/api\/skills(?:\?|$)/,                    action: 'skill.install' },
  { methods: ['DELETE'], pattern: /^\/api\/skills\/([^/?]+)/,                  action: 'skill.uninstall', target: m => decodeURIComponent(m[1]) },

  // Gateway lifecycle
  { methods: ['POST'],   pattern: /^\/api\/service\/(start|stop|restart)/,     action: 'gateway.lifecycle', target: m => m[1] },
  { methods: ['PUT'],    pattern: /^\/api\/gateway/,                           action: 'gateway.update' },
  { methods: ['POST'],   pattern: /^\/api\/gateway\/devices\/approve/,         action: 'gateway.device_approve' },

  // Models
  { methods: ['POST'],   pattern: /^\/api\/models(?:\?|$)/,                    action: 'model.create' },
  { methods: ['PUT', 'PATCH'], pattern: /^\/api\/models\/([^/?]+)/,            action: 'model.update', target: m => m[1] },
  { methods: ['DELETE'], pattern: /^\/api\/models\/([^/?]+)/,                  action: 'model.delete', target: m => m[1] },

  // Cron
  { methods: ['POST'],   pattern: /^\/api\/cron(?:\?|$)/,                      action: 'cron.create' },
  { methods: ['PUT', 'PATCH'], pattern: /^\/api\/cron\/([^/?]+)/,              action: 'cron.update', target: m => m[1] },
  { methods: ['DELETE'], pattern: /^\/api\/cron\/([^/?]+)/,                    action: 'cron.delete', target: m => m[1] },

  // Memory
  { methods: ['PUT', 'POST'], pattern: /^\/api\/memory/,                       action: 'memory.update' },
  { methods: ['DELETE'], pattern: /^\/api\/memory/,                            action: 'memory.delete' },

  // Auth
  { methods: ['POST'],   pattern: /^\/api\/auth\/change-password/,             action: 'auth.password_change' },

  // Logs
  { methods: ['DELETE'], pattern: /^\/api\/logs/,                              action: 'logs.clear' },

  // Settings
  { methods: ['PUT', 'POST'], pattern: /^\/api\/settings/,                     action: 'settings.update' },

  // Portal web self-upgrade (rollback rule first — it is the more specific path)
  { methods: ['POST'],   pattern: /^\/api\/system\/upgrade\/rollback/,         action: 'portal.rollback' },
  { methods: ['POST'],   pattern: /^\/api\/system\/upgrade(?:\?|$)/,           action: 'portal.upgrade' },
]

export function matchAuditRule(method: string, url: string): { action: string; target?: string } | null {
  // Strip /portal prefix and query string for consistent matching
  const normalized = url.replace(/^\/portal/, '')
  for (const rule of RULES) {
    if (!rule.methods.includes(method)) continue
    const m = normalized.match(rule.pattern)
    if (!m) continue
    return { action: rule.action, target: rule.target ? rule.target(m) : undefined }
  }
  return null
}
