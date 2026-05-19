import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    await mkdir(join(tmpDir, 'agents', 'finance'), { recursive: true })
    await mkdir(join(tmpDir, 'agents', 'medical'), { recursive: true })
    await mkdir(join(tmpDir, 'workspace-finance', 'skills'), { recursive: true })
    await mkdir(join(tmpDir, 'workspace-medical', 'skills'), { recursive: true })
    await makeSkill(globalSkillsDir, 'skill-creator', 'Meta skill for creating skills')
    await makeSkill(join(tmpDir, 'workspace-finance', 'skills'), 'alphaear-stock', 'Stock analysis')
    await makeSkill(join(tmpDir, 'workspace-medical', 'skills'), 'pubmed-search', 'Search PubMed')
    manager = new SkillManager(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
    vi.unstubAllGlobals()
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

  const safeskillSource = {
    id: 'safeskill',
    name: 'SafeSkill',
    type: 'remote' as const,
    url: 'https://safeskill.cn',
  }

  it('listRegistry() maps SafeSkill API items to RegistrySkill', async () => {
    const fakeJson = {
      code: 0,
      data: {
        items: [
          {
            name: 'find-skills',
            space: 'vercel-labs/skills',
            summary: 'find-skills',
            trust_score: 90,
            stats: { total_installs: 1384810 },
            category: { field: 'productivity' },
          },
          {
            name: 'frontend-design',
            space: 'anthropics/skills',
            description: 'Create distinctive frontend interfaces',
            summary: 'frontend-design',
            trust_score: 88,
            stats: { total_installs: 320983 },
            category: { field: 'development' },
          },
        ],
      },
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fakeJson), { status: 200 })))
    const skills = await manager.listRegistry([safeskillSource])
    expect(skills).toHaveLength(2)

    const fs = skills.find(s => s.name === 'find-skills')!
    expect(fs.slug).toBe('vercel-labs/skills/find-skills')
    expect(fs.sourceType).toBe('safeskill')
    expect(fs.trustScore).toBe(90)
    expect(fs.category).toBe('productivity')
    expect(fs.installs).toBe(1384810)
    expect(fs.description).toBe('find-skills') // summary fallback when description missing

    const fd = skills.find(s => s.name === 'frontend-design')!
    expect(fd.description).toBe('Create distinctive frontend interfaces') // description preferred
  })

  it('listRegistry() passes category filter to the SafeSkill API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await manager.listRegistry([safeskillSource], '', undefined, 'development')
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('category=development')
    expect(calledUrl).toContain('/web/v1/hub/skills/search')
  })

  it('listRegistry() passes the page number to the SafeSkill API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await manager.listRegistry([safeskillSource], '', undefined, '', 3)
    expect(String(fetchMock.mock.calls[0][0])).toContain('page=3')
  })

  it('listRegistry() passes a base64 marker to ClawHub for page > 1', async () => {
    const clawSource = { id: 'clawhub-cn', name: 'ClawHub', type: 'remote' as const, url: 'https://cn.clawhub-mirror.com' }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await manager.listRegistry([clawSource], '', undefined, '', 2)
    const marker = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('marker')
    expect(marker).toBeTruthy()
    expect(JSON.parse(Buffer.from(marker!, 'base64').toString())).toEqual({ offset: 30, limit: 30 })
  })

  it('listRegistry() returns empty list when SafeSkill API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    const skills = await manager.listRegistry([safeskillSource])
    expect(skills).toEqual([])
  })

  it('installFromSafeSkill() rejects slug with a leading dash', async () => {
    await expect(manager.installFromSafeSkill('-rf', null)).rejects.toThrow('Invalid slug')
  })

  it('installFromSafeSkill() rejects slug with illegal characters', async () => {
    await expect(manager.installFromSafeSkill('foo;rm -rf', null)).rejects.toThrow('Invalid slug')
  })
})
