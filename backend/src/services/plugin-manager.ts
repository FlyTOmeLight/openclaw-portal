import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'child_process'

export interface Plugin {
  id?: string
  name: string
  version: string
  description: string
  status?: string
  origin?: string
  enabled?: boolean
  source?: string
}

export interface PluginCommandResult {
  command: string
  stdout: string
  stderr: string
}

export interface PluginSearchResult {
  name: string
  version: string
  description: string
  npmSpec: string
  installed: boolean
}

const PKG_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[\w.-]+)?$/
const SOURCE_PREFIX_RE = /^(npm|clawhub|git|npm-pack):/i

/** Normalize a bare npm package spec: validate name, default to @latest. */
function normalizeBareNpmSpec(spec: string): string {
  if (!PKG_NAME_RE.test(spec)) {
    throw new Error(`Invalid package name: ${spec}`)
  }
  if (spec.startsWith('@')) {
    const slashIndex = spec.indexOf('/')
    const versionIndex = spec.indexOf('@', slashIndex + 1)
    return versionIndex === -1 ? `${spec}@latest` : spec
  }
  return spec.includes('@') ? spec : `${spec}@latest`
}

/**
 * Normalize an install spec for `openclaw plugins install`.
 * Bare npm package names get a forced `npm:` prefix so installs never probe
 * ClawHub (the target deployment cannot reach clawhub.ai). Specs that already
 * carry an explicit source prefix or look like a filesystem path are left as-is.
 */
function normalizeInstallSpec(input: string): string {
  const trimmed = input.trim()

  // Explicit source prefix already present.
  if (SOURCE_PREFIX_RE.test(trimmed)) {
    const scheme = trimmed.slice(0, trimmed.indexOf(':') + 1)
    if (scheme.toLowerCase() === 'npm:') {
      return `npm:${normalizeBareNpmSpec(trimmed.slice(scheme.length))}`
    }
    return trimmed // clawhub: / git: / npm-pack: — pass through
  }

  // Looks like a filesystem path or archive — pass through.
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    /\.(tgz|tar\.gz|zip)$/i.test(trimmed)
  ) {
    return trimmed
  }

  // Bare npm package name — force npm: prefix.
  return `npm:${normalizeBareNpmSpec(trimmed)}`
}


function cleanPluginOutput(raw: string): string {
  return raw
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() && !line.startsWith('[plugins] plugins.allow is empty;'))
    .join('\n')
    .trim()
}

function normalizePluginFailure(stdoutRaw: string, stderrRaw: string): string {
  const stdout = cleanPluginOutput(stdoutRaw)
  const stderr = cleanPluginOutput(stderrRaw)
  const combined = [stderr, stdout].filter(Boolean).join('\n')

  if (combined.includes('Rate limit exceeded') || combined.includes('(429)')) {
    return 'ClawHub 插件源限流（429）。请稍后重试；如果持续失败，请换可用网络、改用离线包，或直接安装可访问的 npm 源包。'
  }

  if (combined.includes('ENOTFOUND clawhub.ai') || combined.includes('getaddrinfo ENOTFOUND clawhub.ai')) {
    return '无法连接 ClawHub（clawhub.ai 网络/DNS 不可达）。请检查网络、代理或 DNS；如果是离线环境，请改用离线包。'
  }

  if (combined.includes('fetch failed')) {
    return `插件源请求失败：${combined}`
  }

  return combined || 'Plugin install failed'
}

function detectResolvedPrerelease(raw: string): { packageName: string; version: string } | null {
  const match = raw.match(
    /Resolved\s+(?:npm:|clawhub:|npm-pack:|git:)?(@?[^@\s]+(?:\/[^@\s]+)?)(?:@[\w.-]+)?\s+to prerelease version\s+([^\s,]+)/i,
  )
  if (!match) return null
  return {
    packageName: match[1],
    version: match[2],
  }
}

/** Validate and canonicalize an npm registry URL. */
function validateRegistryUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error(`Invalid registry URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Registry URL must use http or https: ${input}`)
  }
  return url.toString()
}

/** Fetch JSON with an abort timeout. Throws on non-2xx or network error. */
async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Map over items with a bounded concurrency. Preserves input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }
  const workerCount = Math.min(Math.max(limit, 1), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/** Registry document path for a package name (scoped packages encode the slash). */
function registryDocPath(name: string): string {
  // Valid npm scoped names have exactly one slash; replace() replaces only the first.
  return name.startsWith('@') ? name.replace('/', '%2F') : name
}

const LIST_CACHE_TTL_MS = 30_000

export class PluginManager {
  private listCache: { plugins: Plugin[]; expiresAt: number } | null = null
  private readonly configPath: string

  constructor(
    readonly openclawHome: string,
    private readonly openclawBin: string,
  ) {
    this.configPath = join(openclawHome, 'openclaw.json')
  }

  private async readFromConfig(): Promise<Plugin[]> {
    const raw = await readFile(this.configPath, 'utf-8')
    const cfg = JSON.parse(raw)
    const entries: Record<string, any> = cfg.plugins?.entries ?? {}

    // Newer openclaw keeps install records in plugins/installs.json
    // (installRecords); older versions inline them under openclaw.json
    // plugins.installs. Prefer the dedicated file, fall back to legacy config.
    let installs: Record<string, any> = {}
    try {
      const installsRaw = await readFile(join(this.openclawHome, 'plugins', 'installs.json'), 'utf-8')
      installs = JSON.parse(installsRaw)?.installRecords ?? {}
    } catch {
      installs = cfg.plugins?.installs ?? {}
    }

    const plugins: Plugin[] = await Promise.all(
      Object.entries(installs).map(async ([id, install]) => {
        const enabled = entries[id]?.enabled !== false
        let description = ''
        try {
          const pkgRaw = await readFile(join(install.installPath, 'package.json'), 'utf-8')
          description = JSON.parse(pkgRaw).description ?? ''
        } catch {}
        return {
          id,
          name: install.resolvedName ?? id,
          version: install.resolvedVersion ?? install.version ?? '0.0.0',
          description,
          status: enabled ? 'active' : 'disabled',
          origin: install.source ?? 'npm',
          enabled,
          source: install.resolvedSpec ?? install.spec ?? '',
        }
      })
    )
    return plugins.sort((a, b) => a.name.localeCompare(b.name))
  }

  async listInstalled(bustCache = false): Promise<Plugin[]> {
    const now = Date.now()
    if (!bustCache && this.listCache && now < this.listCache.expiresAt) {
      return this.listCache.plugins
    }
    const plugins = await this.readFromConfig()
    this.listCache = { plugins, expiresAt: now + LIST_CACHE_TTL_MS }
    return plugins
  }

  async install(packageName: string): Promise<PluginCommandResult> {
    const installSpec = normalizeInstallSpec(packageName)
    let result = spawnSync(this.openclawBin, ['plugins', 'install', installSpec, '--dangerously-force-unsafe-install'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    })
    let stdout = String(result.stdout || '')
    let stderr = String(result.stderr || '')

    if (result.status !== 0) {
      const combined = [stdout, stderr].filter(Boolean).join('\n')
      const prerelease = detectResolvedPrerelease(combined)
      if (prerelease) {
        const explicitSpec = `npm:${prerelease.packageName}@${prerelease.version}`
        result = spawnSync(this.openclawBin, ['plugins', 'install', explicitSpec, '--dangerously-force-unsafe-install'], {
          stdio: 'pipe',
          encoding: 'utf-8',
          maxBuffer: 8 * 1024 * 1024,
        })
        stdout = String(result.stdout || '')
        stderr = String(result.stderr || '')
        if (result.status === 0) {
          this.listCache = null
          return {
            command: `${this.openclawBin} plugins install ${explicitSpec}`,
            stdout: cleanPluginOutput(stdout),
            stderr: cleanPluginOutput(stderr),
          }
        }
      }
    }

    if (result.status !== 0) {
      throw new Error(normalizePluginFailure(stdout, stderr))
    }
    this.listCache = null
    return {
      command: `${this.openclawBin} plugins install ${installSpec}`,
      stdout: cleanPluginOutput(stdout),
      stderr: cleanPluginOutput(stderr),
    }
  }

  async installFromFile(filePath: string): Promise<PluginCommandResult> {
    const result = spawnSync(this.openclawBin, ['plugins', 'install', filePath, '--dangerously-force-unsafe-install'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    })
    const stdout = String(result.stdout || '')
    const stderr = String(result.stderr || '')
    if (result.status !== 0) {
      throw new Error(normalizePluginFailure(stdout, stderr))
    }
    this.listCache = null
    return {
      command: `${this.openclawBin} plugins install ${filePath}`,
      stdout: cleanPluginOutput(stdout),
      stderr: cleanPluginOutput(stderr),
    }
  }

  async getNpmRegistry(): Promise<string> {
    const result = spawnSync('npm', ['config', 'get', 'registry'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    if (result.error || result.status === null) {
      throw new Error(`npm 不可用,无法读取 registry 配置${result.error ? ': ' + result.error.message : ''}`)
    }
    const value = String(result.stdout || '').trim()
    return value || 'https://registry.npmjs.org/'
  }

  async setNpmRegistry(url: string): Promise<string> {
    const canonical = validateRegistryUrl(url)
    const result = spawnSync('npm', ['config', 'set', 'registry', canonical], {
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || 'npm config set failed').trim())
    }
    return this.getNpmRegistry()
  }

  async pingNpmRegistry(url: string): Promise<{ ok: boolean; ms: number; message: string }> {
    const canonical = validateRegistryUrl(url)
    const result = spawnSync('npm', ['ping', '--registry', canonical], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 15_000,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (result.status === 0) {
      const m = output.match(/PONG\s+(\d+)\s*ms/i)
      return { ok: true, ms: m ? Number(m[1]) : 0, message: '连通正常' }
    }
    const message = output.split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim()
    return { ok: false, ms: 0, message: message || 'npm ping 失败' }
  }

  async search(query: string, limit = 25): Promise<PluginSearchResult[]> {
    const q = query.trim()
    if (!q) return []
    const size = Math.min(Math.max(limit, 1), 50)
    const registry = (await this.getNpmRegistry()).replace(/\/+$/, '')

    // Bias the npm search toward OpenClaw packages: a bare generic term
    // (e.g. "channels") otherwise ranks unrelated popular packages first,
    // and they all get dropped by the openclaw-field filter below.
    const searchText = /\bopenclaw\b/i.test(q) ? q : `${q} openclaw`

    let searchData: any
    try {
      searchData = await fetchJsonWithTimeout(
        `${registry}/-/v1/search?text=${encodeURIComponent(searchText)}&size=${size}`,
        10_000,
      )
    } catch (err: any) {
      throw new Error(`无法连接 npm 源(${registry}):${err?.message ?? err}`)
    }

    const objects: any[] = Array.isArray(searchData?.objects) ? searchData.objects : []
    const installedNames = new Set(
      await this.listInstalled().then(ps => ps.map(p => p.name)).catch(() => [] as string[]),
    )

    const verified = await mapWithConcurrency(objects, 6, async (obj): Promise<PluginSearchResult | null> => {
      const name: string | undefined = obj?.package?.name
      if (!name) return null
      try {
        const manifest = await fetchJsonWithTimeout(`${registry}/${registryDocPath(name)}/latest`, 8_000)
        if (!manifest || typeof manifest.openclaw !== 'object' || manifest.openclaw === null) return null
        return {
          name,
          version: String(manifest.version ?? obj.package.version ?? ''),
          description: String(manifest.description ?? obj.package.description ?? ''),
          npmSpec: String(manifest.openclaw?.install?.npmSpec ?? name),
          installed: installedNames.has(name),
        }
      } catch {
        return null
      }
    })

    return verified.filter((r): r is PluginSearchResult => r !== null)
  }

  async uninstall(packageName: string): Promise<PluginCommandResult> {
    // Uninstall receives an id from the already-installed plugin list, not raw user input.
    // Block shell metacharacters, path traversal, and leading dash (CLI flag injection).
    if (!packageName.trim() || /[;&|`$<>'"\\]/.test(packageName) || packageName.includes('..') || packageName.startsWith('-')) {
      throw new Error(`Invalid package name: ${packageName}`)
    }
    const result = spawnSync(this.openclawBin, ['plugins', 'uninstall', packageName], {
      input: 'y\n',
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    })
    const stdout = String(result.stdout || '')
    const stderr = String(result.stderr || '')
    if (result.status !== 0) {
      throw new Error(normalizePluginFailure(stdout, stderr))
    }
    this.listCache = null
    return {
      command: `${this.openclawBin} plugins uninstall ${packageName}`,
      stdout: cleanPluginOutput(stdout),
      stderr: cleanPluginOutput(stderr),
    }
  }
}
