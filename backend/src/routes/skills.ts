import type { FastifyInstance } from 'fastify'
import type { SkillManager } from '../services/skill-manager.js'
import type { SettingsManager } from '../services/settings-manager.js'
import { BundledSkillsService } from '../services/bundled-skills.js'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { mkdir, rm, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

export async function skillsRoutes(
  app: FastifyInstance,
  skillManager: SkillManager,
  settingsManager: SettingsManager,
) {
  const bundledSkillsService = new BundledSkillsService(
    (await import('../config.js')).config.openclawBin
  )

  // List openclaw built-in bundled skills with dependency status
  app.get('/api/skills/bundled', async () => {
    const skills = await bundledSkillsService.list()
    return { skills, skillsDir: bundledSkillsService.bundledSkillsDir }
  })

  // List installed skills (per-agent workspaces)
  app.get('/api/skills', async () => {
    return skillManager.listSkills()
  })

  // List registry skills from all configured sources
  app.get<{ Querystring: { q?: string; sourceId?: string } }>('/api/skills/registry', async (req) => {
    const settings = await settingsManager.read()
    return skillManager.listRegistry(settings.skillRegistrySources, req.query.q ?? '', req.query.sourceId)
  })

  // Deploy a built-in registry skill to an agent workspace
  app.post<{ Params: { name: string }; Body: { agent: string } }>(
    '/api/skills/registry/:name/deploy',
    async (req, reply) => {
      const { name } = req.params
      const { agent } = req.body
      if (!SKILL_NAME_RE.test(name)) return reply.status(400).send({ error: 'invalid skill name' })
      if (!agent || !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'valid agent required' })
      try {
        const skill = await skillManager.deployToAgent(name, agent)
        return skill
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    }
  )

  // Install a skill from a remote download URL
  app.post<{ Body: { downloadUrl: string; agent?: string } }>(
    '/api/skills/install-remote',
    async (req, reply) => {
      const { downloadUrl, agent } = req.body
      if (!downloadUrl) return reply.status(400).send({ error: 'downloadUrl required' })
      if (agent && !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'invalid agent name' })
      try {
        const skill = await skillManager.installFromUrl(downloadUrl, agent ?? null)
        return skill
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    }
  )

  app.post<{ Body: { slug: string; sourceUrl: string; sourceType?: string; agent?: string } }>(
    '/api/skills/install-registry',
    async (req, reply) => {
      const { slug, sourceUrl, sourceType, agent } = req.body
      if (!slug) return reply.status(400).send({ error: 'slug required' })
      if (!sourceUrl) return reply.status(400).send({ error: 'sourceUrl required' })
      if (agent && !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'invalid agent name' })
      try {
        const skill = sourceType === 'skillhub'
          ? await skillManager.installFromSkillHub(slug, agent ?? null)
          : await skillManager.installFromClawHub(slug, sourceUrl, agent ?? null)
        return skill
      } catch (err: any) {
        return reply.status(400).send({ error: err.message })
      }
    }
  )

  app.post<{ Params: { name: string }; Body: { agent: string } }>(
    '/api/skills/:name/disable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent || !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'valid agent required' })
      if (!SKILL_NAME_RE.test(req.params.name)) return reply.status(400).send({ error: 'invalid skill name' })
      await skillManager.disableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  app.post<{ Params: { name: string }; Body: { agent: string } }>(
    '/api/skills/:name/enable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent || !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'valid agent required' })
      if (!SKILL_NAME_RE.test(req.params.name)) return reply.status(400).send({ error: 'invalid skill name' })
      await skillManager.enableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  // Install a skill from an uploaded file (.skill/.zip or SKILL.md)
  app.post('/api/skills/install', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const filename = data.filename ?? ''
    const agent = (data.fields as any)?.agent?.value ?? null
    if (agent && !AGENT_NAME_RE.test(agent)) {
      // drain the stream before returning error
      data.file.resume()
      return reply.status(400).send({ error: 'Invalid agent name' })
    }

    // Handle SKILL.md upload
    if (filename.endsWith('.md') || filename === 'SKILL.md') {
      const skillName = (data.fields as any)?.skillName?.value ?? ''
      if (!skillName || !SKILL_NAME_RE.test(skillName)) {
        data.file.resume()
        return reply.status(400).send({ error: 'skillName is required and must be lowercase-hyphenated' })
      }
      const buf = await data.toBuffer()
      const mdContent = buf.toString('utf-8')
      const skill = await skillManager.installSkillMd(skillName, mdContent, agent)
      return skill
    }

    // Handle zip / .skill upload
    const uploadDir = join(tmpdir(), `skill-upload-${Date.now()}`)
    await mkdir(uploadDir, { recursive: true })
    const zipPath = join(uploadDir, 'upload.zip')

    try {
      await pipeline(data.file, createWriteStream(zipPath))
      const extractDir = join(uploadDir, 'extracted')
      await mkdir(extractDir)

      const unzipResult = spawnSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'pipe' })
      if (unzipResult.status !== 0) {
        return reply.status(400).send({ error: 'Failed to extract zip' })
      }

      const entries = await readdir(extractDir, { withFileTypes: true })
      const skillDirs = entries.filter(e => e.isDirectory())
      if (skillDirs.length !== 1) {
        return reply.status(400).send({ error: 'Zip must contain exactly one top-level skill directory' })
      }

      const skillFolderName = skillDirs[0].name
      if (!SKILL_NAME_RE.test(skillFolderName)) {
        return reply.status(400).send({ error: `Invalid skill name: ${skillFolderName}` })
      }

      const skillPath = resolve(extractDir, skillFolderName)
      if (!skillPath.startsWith(resolve(extractDir) + '/')) {
        return reply.status(400).send({ error: 'Path traversal detected' })
      }

      const skill = await skillManager.installSkill(skillPath, agent)
      return skill
    } finally {
      try {
        await rm(uploadDir, { recursive: true, force: true })
      } catch (err: any) {
        app.log.warn({ err, uploadDir }, 'Failed to remove skill upload tmpdir')
      }
    }
  })
}
