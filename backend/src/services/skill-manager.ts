import { readdir, readFile, writeFile, rename, mkdir, cp, rm } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import type { RegistrySource } from './settings-manager.js'
import { spawnSync } from 'child_process'

export interface Skill {
  name: string
  description: string
  agent: string | null
  enabled: boolean
  path: string
}

export interface RegistrySkill extends Skill {
  source: string
  downloadUrl?: string
  slug?: string
  sourceType?: 'clawhub' | 'json' | 'skillhub'
  sourceUrl?: string
  installable?: boolean
}

export class SkillManager {
  constructor(
    private readonly openclawHome: string,
  ) {}

  /** Discover all agents with their actual workspace paths — reads disk directly, no CLI spawn */
  private async discoverAgents(): Promise<Array<{ id: string; workspace: string }>> {
    const agentsRoot = join(this.openclawHome, 'agents')
    let ids: string[] = []
    try {
      const entries = await readdir(agentsRoot, { withFileTypes: true })
      ids = entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {}

    let configList: Array<{ id: string; workspace?: string }> = []
    try {
      const raw = await readFile(join(this.openclawHome, 'openclaw.json'), 'utf-8')
      configList = JSON.parse(raw)?.agents?.list ?? []
    } catch {}

    const defaultWorkspace = join(this.openclawHome, 'workspace')
    return ids.map(id => {
      const entry = configList.find(e => e.id === id)
      const workspace = entry?.workspace ?? (id === 'main' ? defaultWorkspace : join(this.openclawHome, `workspace-${id}`))
      return { id, workspace }
    })
  }

  /** Resolve the actual workspace path for a given agent id */
  private async resolveAgentWorkspace(agentId: string): Promise<string> {
    const agents = await this.discoverAgents()
    const found = agents.find(a => a.id === agentId)
    return found?.workspace ?? join(this.openclawHome, `workspace-${agentId}`)
  }

  /** List installed skills: global registry + all per-agent workspace dirs */
  async listSkills(): Promise<Skill[]> {
    const skills: Skill[] = []

    // Global registry skills (agent = null)
    const globalDir = join(this.openclawHome, 'skills')
    const globalDisabled = join(globalDir, 'disabled')
    if (existsSync(globalDir)) {
      skills.push(...await this.readSkillDir(globalDir, null, true))
    }
    if (existsSync(globalDisabled)) {
      skills.push(...await this.readSkillDir(globalDisabled, null, false))
    }

    // Per-agent workspace skills — use actual workspace paths
    const agents = await this.discoverAgents()
    for (const { id, workspace } of agents) {
      const skillsDir = join(workspace, 'skills')
      const disabledDir = join(skillsDir, 'disabled')
      if (existsSync(skillsDir)) {
        skills.push(...await this.readSkillDir(skillsDir, id, true))
      }
      if (existsSync(disabledDir)) {
        skills.push(...await this.readSkillDir(disabledDir, id, false))
      }
    }
    return skills
  }

  /**
   * List registry skills from all configured sources.
   * If sources is empty, falls back to the built-in global skills dir.
   */
  async listRegistry(sources: RegistrySource[], query = '', sourceId?: string): Promise<RegistrySkill[]> {
    const selectedSources = sourceId
      ? sources.filter(src => src.id === sourceId)
      : sources
    const all: RegistrySkill[] = []
    for (const src of selectedSources) {
      const skills = await this.readRegistrySource(src, query)
      all.push(...skills)
    }
    return all
  }

  private isClawHubSource(url: string): boolean {
    return /clawhub|clawhub-mirror/i.test(url)
  }

  private clawHubApiBase(url: string): string {
    return 'https://skills.volces.com/api/v1'
  }

  private isSkillHubSource(url: string): boolean {
    return /skillhub\.cn/i.test(url)
  }

  private parseJsonFromMixedOutput(raw: string): any {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const firstJson = Math.min(
      ...['[', '{']
        .map(ch => trimmed.indexOf(ch))
        .filter(idx => idx >= 0),
    )
    if (!Number.isFinite(firstJson)) return null
    try {
      return JSON.parse(trimmed.slice(firstJson))
    } catch {
      return null
    }
  }

  private async readClawHubSource(src: RegistrySource, query = ''): Promise<RegistrySkill[]> {
    try {
      const apiBase = this.clawHubApiBase(src.url)
      const search = new URLSearchParams({
        q: query,
        limit: query ? '50' : '100',
      })
      const resp = await fetch(`${apiBase}/search?${search.toString()}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return []
      const parsed = await resp.json() as { results?: any[] }
      const items = Array.isArray(parsed?.results) ? parsed.results : []
      return items.map((item: any): RegistrySkill => ({
        name: item.displayName ?? item.name ?? item.slug ?? '',
        slug: item.slug ?? item.name ?? '',
        description: item.summary ?? item.description ?? item.metaContent?.DisplayDescription ?? '',
        agent: null,
        enabled: true,
        path: '',
        source: src.name,
        sourceType: 'clawhub',
        sourceUrl: src.url,
        installable: true,
      })).filter((s: RegistrySkill) => Boolean(s.slug))
    } catch {
      return []
    }
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
  }

  private async readSkillHubSource(src: RegistrySource, query = ''): Promise<RegistrySkill[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    // Reject leading dash to prevent CLI flag injection.
    if (trimmed.startsWith('-')) return []
    const result = spawnSync('npx', ['-y', 'skillhub', 'search', trimmed, '-l', '30'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: '/tmp',
        XDG_CONFIG_HOME: '/tmp',
      },
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.status !== 0) return []
    const stdout = this.stripAnsi(String(result.stdout || ''))
    const lines = stdout.split('\n')
    const skills: RegistrySkill[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd()
      const match = line.match(/^\[(\d+)\]\s+([^\s]+)\s+/)
      if (!match) continue
      const slug = match[2]
      const name = slug.split('/').pop() || slug
      const descLine = (lines[i + 1] || '').trim()
      const description = descLine
        .replace(/^⬇\s*\d+\s*⭐\s*[\d.kK]+\s*/u, '')
        .replace(/^⬇.*?\s{2,}/, '')
        .trim()
      skills.push({
        name,
        slug,
        description,
        agent: null,
        enabled: true,
        path: '',
        source: src.name,
        sourceType: 'skillhub',
        sourceUrl: src.url,
        installable: true,
      })
    }
    return skills
  }

  private async readRegistrySource(src: RegistrySource, query = ''): Promise<RegistrySkill[]> {
    if (src.type === 'local') {
      if (!existsSync(src.url)) return []
      const skills = await this.readSkillDir(src.url, null, true)
      const normalized = skills.map(s => ({ ...s, source: src.name }))
      if (!query) return normalized
      const q = query.toLowerCase()
      return normalized.filter(skill =>
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q),
      )
    }

    if (src.type === 'remote') {
      if (this.isClawHubSource(src.url)) {
        return this.readClawHubSource(src, query)
      }
      if (this.isSkillHubSource(src.url)) {
        return this.readSkillHubSource(src, query)
      }
      try {
        const resp = await fetch(src.url, { signal: AbortSignal.timeout(8000) })
        if (!resp.ok) return []
        const items = await resp.json() as Array<{
          name: string
          description?: string
          downloadUrl?: string
        }>
        if (!Array.isArray(items)) return []
        return items.map(item => ({
          name: item.name ?? '',
          description: item.description ?? '',
          agent: null,
          enabled: true,
          path: '',
          source: src.name,
          downloadUrl: item.downloadUrl,
          sourceType: 'json' as const,
          sourceUrl: src.url,
        })).filter(s => s.name)
      } catch {
        return []
      }
    }

    return []
  }

  /** Copy a skill from the built-in global registry into a specific agent workspace */
  async deployToAgent(skillName: string, agent: string): Promise<Skill> {
    const src = join(this.openclawHome, 'skills', skillName)
    if (!existsSync(src)) throw new Error(`Skill not found in registry: ${skillName}`)
    const workspace = await this.resolveAgentWorkspace(agent)
    const destDir = join(workspace, 'skills')
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, skillName)
    await cp(src, dest, { recursive: true })
    const description = await this.parseDescription(join(dest, 'SKILL.md'))
    return { name: skillName, description, agent, enabled: true, path: dest }
  }

  /** Install a skill from a remote download URL (zip/skill file) */
  async installFromUrl(downloadUrl: string, agent: string | null): Promise<Skill> {
    // Validate URL scheme
    const parsed = new URL(downloadUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http/https URLs are supported')
    }

    const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) })
    if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`)

    const buf = Buffer.from(await resp.arrayBuffer())
    const { mkdir: mkdirFn, rm, readdir: readdirFn, writeFile: writeFileFn } = await import('fs/promises')
    const { join: joinFn, resolve: resolveFn } = await import('path')
    const { tmpdir } = await import('os')
    const { spawnSync } = await import('child_process')

    const uploadDir = joinFn(tmpdir(), `skill-remote-${Date.now()}`)
    await mkdirFn(uploadDir, { recursive: true })
    const zipPath = joinFn(uploadDir, 'download.zip')

    try {
      await writeFileFn(zipPath, buf)
      const extractDir = joinFn(uploadDir, 'extracted')
      await mkdirFn(extractDir)

      const result = spawnSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'pipe' })
      if (result.status !== 0) throw new Error('Failed to extract downloaded zip')

      const entries = await readdirFn(extractDir, { withFileTypes: true })
      const dirs = entries.filter(e => e.isDirectory())
      if (dirs.length !== 1) throw new Error('Zip must contain exactly one top-level skill directory')

      const skillFolderName = dirs[0].name
      const skillPath = resolveFn(extractDir, skillFolderName)
      if (!skillPath.startsWith(resolveFn(extractDir) + '/')) throw new Error('Path traversal detected')

      return await this.installSkill(skillPath, agent)
    } finally {
      try {
        await rm(uploadDir, { recursive: true, force: true })
      } catch (err: any) {
        console.warn('[skill-manager] Failed to remove remote download tmpdir:', uploadDir, err?.message)
      }
    }
  }

  async installFromClawHub(slug: string, sourceUrl: string, agent: string | null): Promise<Skill> {
    // Reject untrusted inputs that could be interpreted as CLI flags.
    if (slug.startsWith('-') || !/^[A-Za-z0-9_./-]{1,128}$/.test(slug)) {
      throw new Error(`Invalid slug: ${slug}`)
    }
    if (sourceUrl.startsWith('-') || !/^https?:\/\//.test(sourceUrl)) {
      throw new Error(`Invalid sourceUrl: ${sourceUrl}`)
    }
    const workdir = agent ? await this.resolveAgentWorkspace(agent) : this.openclawHome
    const dir = agent ? 'skills' : 'skills'
    const result = spawnSync('npx', [
      '-y',
      'clawhub',
      '--site',
      sourceUrl,
      '--registry',
      sourceUrl,
      '--workdir',
      workdir,
      '--dir',
      dir,
      '--no-input',
      'install',
      slug,
    ], {
      stdio: 'pipe',
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: '/tmp',
        XDG_CONFIG_HOME: '/tmp',
      },
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || '执行 clawhub 安装失败'))
    }

    const skillPath = join(workdir, dir, slug)
    const description = existsSync(join(skillPath, 'SKILL.md'))
      ? await this.parseDescription(join(skillPath, 'SKILL.md'))
      : ''
    return { name: slug, description, agent, enabled: true, path: skillPath }
  }

  async installFromSkillHub(slug: string, agent: string | null): Promise<Skill> {
    if (slug.startsWith('-') || !/^[A-Za-z0-9_./-]{1,128}$/.test(slug)) {
      throw new Error(`Invalid slug: ${slug}`)
    }
    const workdir = agent ? await this.resolveAgentWorkspace(agent) : this.openclawHome
    const projectSkillRoot = join(workdir, '.codex', 'skills')
    const targetRoot = join(workdir, 'skills')

    const listEntries = async (dir: string): Promise<string[]> => {
      if (!existsSync(dir)) return []
      const entries = await readdir(dir, { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    }

    await mkdir(projectSkillRoot, { recursive: true })
    await mkdir(targetRoot, { recursive: true })

    const before = new Set(await listEntries(projectSkillRoot))
    const result = spawnSync('npx', ['-y', 'skillhub', 'install', slug, '--platform', 'codex', '--project', '--force'], {
      cwd: workdir,
      stdio: 'pipe',
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    })

    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || '执行 skillhub 安装失败'))
    }

    const after = await listEntries(projectSkillRoot)
    const created = after.find(name => !before.has(name)) || slug.split('/').pop() || slug
    const installedPath = join(projectSkillRoot, created)
    const targetPath = join(targetRoot, created)

    if (!existsSync(installedPath)) {
      throw new Error('SkillHub 安装完成，但未找到生成的技能目录')
    }

    if (existsSync(targetPath)) {
      await rm(targetPath, { recursive: true, force: true })
    }

    await cp(installedPath, targetPath, { recursive: true })
    const description = existsSync(join(targetPath, 'SKILL.md'))
      ? await this.parseDescription(join(targetPath, 'SKILL.md'))
      : ''
    return {
      name: created,
      description,
      agent,
      enabled: true,
      path: targetPath,
    }
  }

  /** Install a SKILL.md file as a named skill */
  async installSkillMd(name: string, mdContent: string, agent: string | null): Promise<Skill> {
    const destDir = agent
      ? join(await this.resolveAgentWorkspace(agent), 'skills')
      : join(this.openclawHome, 'skills')
    await mkdir(destDir, { recursive: true })
    const skillDir = join(destDir, name)
    await mkdir(skillDir, { recursive: true })
    const skillMdPath = join(skillDir, 'SKILL.md')
    await writeFile(skillMdPath, mdContent, 'utf-8')
    const description = await this.parseDescription(skillMdPath)
    return { name, description, agent, enabled: true, path: skillDir }
  }

  private async readSkillDir(
    dir: string,
    agent: string | null,
    enabled: boolean,
  ): Promise<Skill[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const skills: Skill[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'disabled') continue
        const skillMd = join(dir, entry.name, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        const description = await this.parseDescription(skillMd)
        skills.push({ name: entry.name, description, agent, enabled, path: join(dir, entry.name) })
      }
      return skills
    } catch {
      return []
    }
  }

  private async parseDescription(skillMdPath: string): Promise<string> {
    const content = await readFile(skillMdPath, 'utf-8')
    const match = content.match(/^description:\s*"?([^"\n]+)"?/m)
    return match?.[1]?.trim() ?? ''
  }

  async disableSkill(name: string, agent: string): Promise<void> {
    const workspace = await this.resolveAgentWorkspace(agent)
    const skillsDir = join(workspace, 'skills')
    const src = join(skillsDir, name)
    const disabledDir = join(skillsDir, 'disabled')
    await mkdir(disabledDir, { recursive: true })
    await rename(src, join(disabledDir, name))
  }

  async enableSkill(name: string, agent: string): Promise<void> {
    const workspace = await this.resolveAgentWorkspace(agent)
    const skillsDir = join(workspace, 'skills')
    const src = join(join(skillsDir, 'disabled'), name)
    await rename(src, join(skillsDir, name))
  }

  async installSkill(extractedPath: string, agent: string | null): Promise<Skill> {
    const name = basename(extractedPath)
    const destDir = agent
      ? join(await this.resolveAgentWorkspace(agent), 'skills')
      : join(this.openclawHome, 'skills')
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, name)
    await rename(extractedPath, dest)
    const description = await this.parseDescription(join(dest, 'SKILL.md'))
    return { name, description, agent, enabled: true, path: dest }
  }
}
