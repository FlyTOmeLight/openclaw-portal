import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

export interface Plugin {
  name: string
  version: string
  description: string
}

export class PluginManager {
  private readonly pluginsDir: string

  constructor(
    private readonly openclawHome: string,
    private readonly openclawBin: string
  ) {
    this.pluginsDir = join(openclawHome, 'plugins')
  }

  async listInstalled(): Promise<Plugin[]> {
    if (!existsSync(this.pluginsDir)) return []
    const plugins: Plugin[] = []
    const entries = await readdir(this.pluginsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      if (entry.name.startsWith('@')) {
        const scopeDir = join(this.pluginsDir, entry.name)
        const pkgs = await readdir(scopeDir, { withFileTypes: true })
        for (const pkg of pkgs) {
          if (!pkg.isDirectory()) continue
          const plugin = await this.readPackageJson(join(scopeDir, pkg.name))
          if (plugin) plugins.push(plugin)
        }
      } else {
        const plugin = await this.readPackageJson(join(this.pluginsDir, entry.name))
        if (plugin) plugins.push(plugin)
      }
    }
    return plugins
  }

  private async readPackageJson(dir: string): Promise<Plugin | null> {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return null
    try {
      const raw = JSON.parse(await readFile(pkgPath, 'utf-8'))
      return { name: raw.name ?? '', version: raw.version ?? '0.0.0', description: raw.description ?? '' }
    } catch {
      return null
    }
  }

  async install(packageName: string): Promise<void> {
    execSync(`${this.openclawBin} plugins install ${packageName}`, { stdio: 'pipe' })
  }

  async uninstall(packageName: string): Promise<void> {
    execSync(`${this.openclawBin} plugins uninstall ${packageName}`, { stdio: 'pipe' })
  }
}
