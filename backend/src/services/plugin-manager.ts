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

const PKG_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[\w.-]+)?$/

function normalizeInstallSpec(input: string): string {
  const trimmed = input.trim()
  if (!PKG_NAME_RE.test(trimmed)) {
    throw new Error(`Invalid package name: ${input}`)
  }

  if (trimmed.startsWith('@')) {
    const slashIndex = trimmed.indexOf('/')
    const versionIndex = trimmed.indexOf('@', slashIndex + 1)
    return versionIndex === -1 ? `${trimmed}@latest` : trimmed
  }

  return trimmed.includes('@') ? trimmed : `${trimmed}@latest`
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
  const match = raw.match(/Resolved\s+(@?[^@\s]+(?:\/[^@\s]+)?)(?:@latest)?\s+to prerelease version\s+([^\s,]+)/i)
  if (!match) return null
  return {
    packageName: match[1],
    version: match[2],
  }
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
    const installs: Record<string, any> = cfg.plugins?.installs ?? {}
    const entries: Record<string, any> = cfg.plugins?.entries ?? {}

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
        const explicitSpec = `${prerelease.packageName}@${prerelease.version}`
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
