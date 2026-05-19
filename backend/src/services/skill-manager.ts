import { readdir, readFile, writeFile, rename, mkdir, cp, rm } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type { RegistrySource } from './settings-manager.js'
import { spawnSync } from 'child_process'

export interface Skill {
  name: string
  description: string
  agent: string | null
  enabled: boolean
  path: string
  installSource?: string   // 安装来源:ClawHub / SafeSkill / URL 链接 / 离线上传
  relPath?: string         // 相对家目录的路径,供 FileBrowser 定位
}

export interface RegistrySkill extends Skill {
  source: string
  downloadUrl?: string
  slug?: string
  sourceType?: 'clawhub' | 'json' | 'safeskill'
  sourceUrl?: string
  installable?: boolean
  category?: string      // safeskill: category.field
  trustScore?: number    // safeskill: trust_score (0-100)
  installs?: number      // safeskill: stats.total_installs
  author?: string        // clawhub: metaContent.owner / safeskill: namespace
  version?: string       // clawhub: version
  updatedAt?: number     // 毫秒时间戳
  keywords?: string[]    // clawhub: Keywords / safeskill: llm_tags
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
  async listRegistry(sources: RegistrySource[], query = '', sourceId?: string, category = '', page = 1): Promise<RegistrySkill[]> {
    const selectedSources = sourceId
      ? sources.filter(src => src.id === sourceId)
      : sources
    const all: RegistrySkill[] = []
    for (const src of selectedSources) {
      const skills = await this.readRegistrySource(src, query, category, page)
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

  private isSafeSkillSource(url: string): boolean {
    return /safeskill\.cn/i.test(url)
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

  private async readClawHubSource(src: RegistrySource, query = '', page = 1): Promise<RegistrySkill[]> {
    try {
      const apiBase = this.clawHubApiBase(src.url)
      const search = new URLSearchParams({ q: query, limit: '30' })
      if (page > 1) {
        // ClawHub 用 base64 游标分页:marker = base64({offset,limit})
        const marker = Buffer.from(
          JSON.stringify({ offset: (page - 1) * 30, limit: 30 }),
        ).toString('base64')
        search.set('marker', marker)
      }
      const resp = await fetch(`${apiBase}/search?${search.toString()}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return []
      const parsed = await resp.json() as { results?: any[] }
      const items = Array.isArray(parsed?.results) ? parsed.results : []
      return items.map((item: any): RegistrySkill => {
        const meta = item.metaContent ?? {}
        return {
          name: item.displayName ?? item.name ?? item.slug ?? '',
          slug: item.slug ?? item.name ?? '',
          description: meta.DisplayDescription || item.summary || item.description || '',
          agent: null,
          enabled: true,
          path: '',
          source: src.name,
          sourceType: 'clawhub',
          sourceUrl: src.url,
          installable: true,
          author: meta.owner || undefined,
          version: item.version || undefined,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
          keywords: Array.isArray(meta.Keywords) ? meta.Keywords.slice(0, 4) : undefined,
        }
      }).filter((s: RegistrySkill) => Boolean(s.slug))
    } catch {
      return []
    }
  }

  /** Read skills from a SafeSkill hub (safeskill.cn) via its public REST search API. */
  private async readSafeSkillSource(src: RegistrySource, query = '', category = '', page = 1): Promise<RegistrySkill[]> {
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: '30',
        status: 'published',
        sort_by: 'total_installs',
        sort_order: 'desc',
        category: category || 'all',
      })
      if (query.trim()) params.set('q', query.trim())
      const resp = await fetch(`https://safeskill.cn/web/v1/hub/skills/search?${params}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) return []
      const parsed = await resp.json() as { data?: { items?: any[] } }
      const items = Array.isArray(parsed?.data?.items) ? parsed.data.items : []
      return items.map((it: any): RegistrySkill => {
        const slug = `${it.space ?? it.namespace ?? ''}/${it.name ?? ''}`.replace(/^\/+|\/+$/g, '')
        const tags = it.cn?.llm_tags ?? it.en?.llm_tags
        return {
          name: it.name ?? slug.split('/').pop() ?? '',
          slug,
          description: it.description ?? it.summary ?? '',
          agent: null,
          enabled: true,
          path: '',
          source: src.name,
          sourceType: 'safeskill',
          sourceUrl: src.url,
          installable: true,
          category: it.category?.field ?? undefined,
          trustScore: typeof it.trust_score === 'number' ? it.trust_score : undefined,
          installs: it.stats?.total_installs,
          author: it.namespace || undefined,
          updatedAt: typeof it.updated_at === 'number' ? it.updated_at * 1000 : undefined,
          keywords: Array.isArray(tags) ? tags.slice(0, 4) : undefined,
        }
      }).filter((s: RegistrySkill) => Boolean(s.slug) && s.slug !== '/')
    } catch {
      return []
    }
  }

  private async readRegistrySource(src: RegistrySource, query = '', category = '', page = 1): Promise<RegistrySkill[]> {
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
        return this.readClawHubSource(src, query, page)
      }
      if (this.isSafeSkillSource(src.url)) {
        return this.readSafeSkillSource(src, query, category, page)
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

      return await this.installSkill(skillPath, agent, 'URL 链接')
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
    await this.writeSkillMeta(skillPath, 'ClawHub')
    const description = existsSync(join(skillPath, 'SKILL.md'))
      ? await this.parseDescription(join(skillPath, 'SKILL.md'))
      : ''
    return { name: slug, description, agent, enabled: true, path: skillPath, installSource: 'ClawHub' }
  }

  async installFromSafeSkill(slug: string, agent: string | null): Promise<Skill> {
    // Reject untrusted inputs that could be interpreted as CLI flags.
    if (slug.startsWith('-') || !/^[A-Za-z0-9_./-]{1,128}$/.test(slug)) {
      throw new Error(`Invalid slug: ${slug}`)
    }
    const workdir = agent ? await this.resolveAgentWorkspace(agent) : this.openclawHome
    const skillRoot = join(workdir, 'skills')
    await mkdir(skillRoot, { recursive: true })

    const listEntries = async (dir: string): Promise<string[]> => {
      if (!existsSync(dir)) return []
      const entries = await readdir(dir, { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    }

    const before = new Set(await listEntries(skillRoot))
    // Build the safeskill:// ref ourselves from the validated slug — never exec
    // the npx_install_cmd string returned by the API.
    const ref = `safeskill://skillsh/${slug}@latest`
    const result = spawnSync('npx', [
      '-y', '@safeskill/cli', 'add', ref, '-y', '-a', 'openclaw', '--copy',
    ], {
      cwd: workdir,
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
      maxBuffer: 8 * 1024 * 1024,
    })
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || '执行 SafeSkill 安装失败'))
    }

    const after = await listEntries(skillRoot)
    const created = after.find(name => !before.has(name)) || slug.split('/').pop() || slug
    const skillPath = join(skillRoot, created)
    if (!existsSync(skillPath)) {
      throw new Error('SafeSkill 安装完成，但未找到生成的技能目录')
    }
    await this.writeSkillMeta(skillPath, 'SafeSkill')
    const description = existsSync(join(skillPath, 'SKILL.md'))
      ? await this.parseDescription(join(skillPath, 'SKILL.md'))
      : ''
    return { name: created, description, agent, enabled: true, path: skillPath, installSource: 'SafeSkill' }
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
    await this.writeSkillMeta(skillDir, '离线上传')
    const description = await this.parseDescription(skillMdPath)
    return { name, description, agent, enabled: true, path: skillDir, installSource: '离线上传' }
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
        const skillPath = join(dir, entry.name)
        const description = await this.parseDescription(skillMd)
        const installSource = await this.readSkillMeta(skillPath)
        const home = homedir()
        const relPath = skillPath.startsWith(home) ? skillPath.slice(home.length) : skillPath
        skills.push({ name: entry.name, description, agent, enabled, path: skillPath, installSource, relPath })
      }
      return skills
    } catch {
      return []
    }
  }

  private async parseDescription(skillMdPath: string): Promise<string> {
    const content = await readFile(skillMdPath, 'utf-8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^description:[ \t]*(.*)$/)
      if (!m) continue
      const rest = m[1].trim()
      // YAML 块标量(description: | / description: >):读取后续缩进行
      if (/^[|>][-+]?$/.test(rest)) {
        const out: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          const ln = lines[j]
          if (ln.trim() === '') { out.push(''); continue }
          if (/^[ \t]/.test(ln)) { out.push(ln.trim()); continue }
          break
        }
        return out.join(' ').replace(/\s+/g, ' ').trim()
      }
      // 单行:去掉两端引号
      return rest.replace(/^["']|["']$/g, '').trim()
    }
    return ''
  }

  /** 写入安装来源标记到 skill 目录(失败不阻断安装) */
  private async writeSkillMeta(skillPath: string, source: string): Promise<void> {
    try {
      await writeFile(
        join(skillPath, '.portal-meta.json'),
        JSON.stringify({ source, installedAt: Date.now() }, null, 2),
        'utf-8',
      )
    } catch { /* 元数据可选,失败忽略 */ }
  }

  /** 读取 skill 目录的安装来源标记 */
  private async readSkillMeta(skillPath: string): Promise<string | undefined> {
    try {
      const raw = await readFile(join(skillPath, '.portal-meta.json'), 'utf-8')
      const meta = JSON.parse(raw)
      return typeof meta?.source === 'string' ? meta.source : undefined
    } catch {
      return undefined
    }
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

  /** Permanently delete an installed skill (enabled or disabled, global or per-agent). */
  async deleteSkill(name: string, agent: string | null): Promise<void> {
    const base = agent
      ? join(await this.resolveAgentWorkspace(agent), 'skills')
      : join(this.openclawHome, 'skills')
    for (const dir of [join(base, name), join(base, 'disabled', name)]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true })
        return
      }
    }
    throw new Error(`技能不存在: ${name}`)
  }

  async installSkill(extractedPath: string, agent: string | null, source = '离线上传'): Promise<Skill> {
    const name = basename(extractedPath)
    const destDir = agent
      ? join(await this.resolveAgentWorkspace(agent), 'skills')
      : join(this.openclawHome, 'skills')
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, name)
    await rename(extractedPath, dest)
    await this.writeSkillMeta(dest, source)
    const description = await this.parseDescription(join(dest, 'SKILL.md'))
    return { name, description, agent, enabled: true, path: dest, installSource: source }
  }
}
