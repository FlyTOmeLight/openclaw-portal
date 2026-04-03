import { readdir, readFile, rename, mkdir } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'

export interface Skill {
  name: string
  description: string
  agent: string | null
  enabled: boolean
  path: string
}

const DOMAIN_AGENTS = ['finance', 'bioinfo', 'medical', 'legal', 'frontend'] as const

export class SkillManager {
  constructor(private readonly openclawHome: string) {}

  async listSkills(): Promise<Skill[]> {
    const skills: Skill[] = []

    // Global skills
    const globalDir = join(this.openclawHome, 'skills')
    if (existsSync(globalDir)) {
      const entries = await this.readSkillDir(globalDir, null, true)
      skills.push(...entries)
    }

    // Domain workspace skills
    for (const agent of DOMAIN_AGENTS) {
      const skillsDir = join(this.openclawHome, `workspace-${agent}`, 'skills')
      const disabledDir = join(skillsDir, 'disabled')
      if (existsSync(skillsDir)) {
        const enabled = await this.readSkillDir(skillsDir, agent, true)
        skills.push(...enabled)
      }
      if (existsSync(disabledDir)) {
        const disabled = await this.readSkillDir(disabledDir, agent, false)
        skills.push(...disabled)
      }
    }

    return skills
  }

  private async readSkillDir(
    dir: string,
    agent: string | null,
    enabled: boolean
  ): Promise<Skill[]> {
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
  }

  private async parseDescription(skillMdPath: string): Promise<string> {
    const content = await readFile(skillMdPath, 'utf-8')
    const match = content.match(/^description:\s*"?([^"\n]+)"?/m)
    return match?.[1]?.trim() ?? ''
  }

  async disableSkill(name: string, agent: string): Promise<void> {
    const skillsDir = join(this.openclawHome, `workspace-${agent}`, 'skills')
    const src = join(skillsDir, name)
    const disabledDir = join(skillsDir, 'disabled')
    await mkdir(disabledDir, { recursive: true })
    await rename(src, join(disabledDir, name))
  }

  async enableSkill(name: string, agent: string): Promise<void> {
    const skillsDir = join(this.openclawHome, `workspace-${agent}`, 'skills')
    const src = join(skillsDir, 'disabled', name)
    await rename(src, join(skillsDir, name))
  }

  async installSkill(
    extractedPath: string,
    agent: string | null
  ): Promise<Skill> {
    const name = basename(extractedPath)
    const destDir = agent
      ? join(this.openclawHome, `workspace-${agent}`, 'skills')
      : join(this.openclawHome, 'skills')
    await mkdir(destDir, { recursive: true })
    const dest = join(destDir, name)
    await rename(extractedPath, dest)
    const description = await this.parseDescription(join(dest, 'SKILL.md'))
    return { name, description, agent, enabled: true, path: dest }
  }
}
