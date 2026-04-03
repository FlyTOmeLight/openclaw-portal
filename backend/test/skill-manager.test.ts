import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { SkillManager, type Skill } from '../src/services/skill-manager.js'

async function makeSkill(dir: string, name: string, description: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\n---\n\nSkill body.`)
}

describe('SkillManager', () => {
  let tmpDir: string
  let globalSkillsDir: string
  let manager: SkillManager

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-manager-test-'))
    globalSkillsDir = join(tmpDir, 'skills')
    await mkdir(globalSkillsDir, { recursive: true })
    await mkdir(join(tmpDir, 'workspace-finance', 'skills'), { recursive: true })
    await mkdir(join(tmpDir, 'workspace-medical', 'skills'), { recursive: true })
    await makeSkill(globalSkillsDir, 'skill-creator', 'Meta skill for creating skills')
    await makeSkill(join(tmpDir, 'workspace-finance', 'skills'), 'alphaear-stock', 'Stock analysis')
    await makeSkill(join(tmpDir, 'workspace-medical', 'skills'), 'pubmed-search', 'Search PubMed')
    manager = new SkillManager(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it('listSkills() returns skills from global and all workspace dirs', async () => {
    const skills = await manager.listSkills()
    const names = skills.map(s => s.name)
    expect(names).toContain('skill-creator')
    expect(names).toContain('alphaear-stock')
    expect(names).toContain('pubmed-search')
  })

  it('listSkills() marks agent for workspace skills', async () => {
    const skills = await manager.listSkills()
    const stock = skills.find(s => s.name === 'alphaear-stock')!
    expect(stock.agent).toBe('finance')
  })

  it('listSkills() marks global skills with agent=null', async () => {
    const skills = await manager.listSkills()
    const meta = skills.find(s => s.name === 'skill-creator')!
    expect(meta.agent).toBeNull()
  })

  it('disableSkill() moves skill to disabled/ subfolder', async () => {
    await manager.disableSkill('alphaear-stock', 'finance')
    const skills = await manager.listSkills()
    const stock = skills.find(s => s.name === 'alphaear-stock')
    expect(stock?.enabled).toBe(false)
  })

  it('enableSkill() restores disabled skill', async () => {
    await manager.disableSkill('alphaear-stock', 'finance')
    await manager.enableSkill('alphaear-stock', 'finance')
    const skills = await manager.listSkills()
    const stock = skills.find(s => s.name === 'alphaear-stock')!
    expect(stock.enabled).toBe(true)
  })
})
