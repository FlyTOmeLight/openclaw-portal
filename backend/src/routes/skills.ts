import type { FastifyInstance } from 'fastify'
import type { SkillManager } from '../services/skill-manager.js'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { mkdir, rm, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const AGENT_NAME_RE = /^[a-z]+$/

export async function skillsRoutes(app: FastifyInstance, skillManager: SkillManager) {
  app.get('/api/skills', async () => {
    return skillManager.listSkills()
  })

  app.post<{ Params: { name: string }; Body: { agent: string | null } }>(
    '/api/skills/:name/disable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent || !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'valid agent required' })
      if (!SKILL_NAME_RE.test(req.params.name)) return reply.status(400).send({ error: 'invalid skill name' })
      await skillManager.disableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  app.post<{ Params: { name: string }; Body: { agent: string | null } }>(
    '/api/skills/:name/enable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent || !AGENT_NAME_RE.test(agent)) return reply.status(400).send({ error: 'valid agent required' })
      if (!SKILL_NAME_RE.test(req.params.name)) return reply.status(400).send({ error: 'invalid skill name' })
      await skillManager.enableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  app.post('/api/skills/install', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const uploadDir = join(tmpdir(), `skill-upload-${Date.now()}`)
    await mkdir(uploadDir, { recursive: true })
    const zipPath = join(uploadDir, 'upload.zip')

    try {
      await pipeline(data.file, createWriteStream(zipPath))
      const extractDir = join(uploadDir, 'extracted')
      await mkdir(extractDir)

      // Use spawnSync with args array (no shell injection)
      const unzipResult = spawnSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'pipe' })
      if (unzipResult.status !== 0) {
        return reply.status(400).send({ error: 'Failed to extract zip' })
      }

      // Find the skill directory (top-level dir inside extractDir)
      const entries = await readdir(extractDir, { withFileTypes: true })
      const skillDirs = entries.filter(e => e.isDirectory())
      if (skillDirs.length !== 1) {
        return reply.status(400).send({ error: 'Zip must contain exactly one top-level skill directory' })
      }

      const skillFolderName = skillDirs[0].name
      if (!SKILL_NAME_RE.test(skillFolderName)) {
        return reply.status(400).send({ error: `Invalid skill name: ${skillFolderName}` })
      }

      // Verify it stays within extractDir (path traversal guard)
      const skillPath = resolve(extractDir, skillFolderName)
      if (!skillPath.startsWith(resolve(extractDir) + '/')) {
        return reply.status(400).send({ error: 'Path traversal detected' })
      }

      const agent = (data.fields as any)?.agent?.value ?? null
      if (agent && !AGENT_NAME_RE.test(agent)) {
        return reply.status(400).send({ error: 'Invalid agent name' })
      }

      const skill = await skillManager.installSkill(skillPath, agent)
      return skill
    } finally {
      await rm(uploadDir, { recursive: true })
    }
  })
}
