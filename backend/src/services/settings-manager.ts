import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

export interface RegistrySource {
  id: string
  name: string
  type: 'local' | 'remote'
  url: string
}

export interface PortalSettings {
  httpProxy: string
  httpsProxy: string
  npmRegistry: string
  skillRegistrySources: RegistrySource[]
  activeSkillRegistrySourceId: string
}

const DEFAULT_SETTINGS: PortalSettings = {
  httpProxy: '',
  httpsProxy: '',
  npmRegistry: 'https://registry.npmjs.org',
  skillRegistrySources: [
    {
      id: 'safeskill',
      name: 'SafeSkill',
      type: 'remote',
      url: 'https://safeskill.cn',
    },
    {
      id: 'clawhub-cn',
      name: 'ClawHub 中国镜像',
      type: 'remote',
      url: 'https://cn.clawhub-mirror.com',
    },
  ],
  activeSkillRegistrySourceId: 'safeskill',
}

function normalizeSources(sources: RegistrySource[]): RegistrySource[] {
  const seen = new Set<string>()
  const normalized: RegistrySource[] = []
  for (const src of sources) {
    if (!src?.url || !src?.id) continue
    const key = `${src.type}:${src.url.trim().replace(/\/+$/, '')}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      id: src.id,
      name: src.name || src.id,
      type: src.type,
      url: src.url.trim().replace(/\/+$/, ''),
    })
  }
  return normalized
}

function mergeDefaultSources(sources: RegistrySource[]): RegistrySource[] {
  const merged = [...sources]
  const byId = new Set(merged.map(src => src.id))
  for (const src of DEFAULT_SETTINGS.skillRegistrySources) {
    if (!byId.has(src.id)) merged.push(src)
  }
  return normalizeSources(merged)
}

export class SettingsManager {
  constructor(private readonly settingsPath: string) {}

  async read(): Promise<PortalSettings> {
    if (!existsSync(this.settingsPath)) {
      return {
        ...DEFAULT_SETTINGS,
        httpProxy: process.env.HTTP_PROXY ?? process.env.http_proxy ?? '',
        httpsProxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '',
      }
    }
    try {
      const raw = await readFile(this.settingsPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const merged = { ...DEFAULT_SETTINGS, ...parsed }
      merged.skillRegistrySources = Array.isArray(merged.skillRegistrySources) && merged.skillRegistrySources.length > 0
        ? mergeDefaultSources(merged.skillRegistrySources)
        : [...DEFAULT_SETTINGS.skillRegistrySources]
      // 迁移:移除已废弃的 SkillHub(skillhub.cn)源
      merged.skillRegistrySources = merged.skillRegistrySources.filter(
        (s: RegistrySource) => s.id !== 'skillhub-cn' && !/skillhub\.cn/i.test(s.url),
      )
      // SafeSkill 源始终排在最前
      merged.skillRegistrySources.sort((a: RegistrySource, b: RegistrySource) =>
        (a.id === 'safeskill' ? 0 : 1) - (b.id === 'safeskill' ? 0 : 1))
      if (!merged.activeSkillRegistrySourceId || !merged.skillRegistrySources.some((s: RegistrySource) => s.id === merged.activeSkillRegistrySourceId)) {
        merged.activeSkillRegistrySourceId = merged.skillRegistrySources[0]?.id ?? DEFAULT_SETTINGS.activeSkillRegistrySourceId
      }
      return merged
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async write(settings: PortalSettings): Promise<void> {
    const normalizedSettings: PortalSettings = {
      ...settings,
      skillRegistrySources: mergeDefaultSources(settings.skillRegistrySources),
      activeSkillRegistrySourceId: settings.activeSkillRegistrySourceId,
    }
    if (!normalizedSettings.skillRegistrySources.some(src => src.id === normalizedSettings.activeSkillRegistrySourceId)) {
      normalizedSettings.activeSkillRegistrySourceId = normalizedSettings.skillRegistrySources[0]?.id ?? DEFAULT_SETTINGS.activeSkillRegistrySourceId
    }
    await writeFile(this.settingsPath, JSON.stringify(normalizedSettings, null, 2), 'utf-8')
    if (settings.httpProxy) {
      process.env.HTTP_PROXY = settings.httpProxy
      process.env.http_proxy = settings.httpProxy
    } else {
      delete process.env.HTTP_PROXY
      delete process.env.http_proxy
    }
    if (settings.httpsProxy) {
      process.env.HTTPS_PROXY = settings.httpsProxy
      process.env.https_proxy = settings.httpsProxy
    } else {
      delete process.env.HTTPS_PROXY
      delete process.env.https_proxy
    }
  }
}
