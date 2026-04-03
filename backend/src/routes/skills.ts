import type { FastifyInstance } from 'fastify'
import type { SkillManager } from '../services/skill-manager.js'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

export async function skillsRoutes(app: FastifyInstance, skillManager: SkillManager) {
  app.get('/api/skills', async () => {
    return skillManager.listSkills()
  })

  app.post<{ Params: { name: string }; Body: { agent: string | null } }>(
    '/api/skills/:name/disable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent) return reply.status(400).send({ error: 'agent required for workspace skills' })
      await skillManager.disableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  app.post<{ Params: { name: string }; Body: { agent: string | null } }>(
    '/api/skills/:name/enable',
    async (req, reply) => {
      const { agent } = req.body
      if (!agent) return reply.status(400).send({ error: 'agent required for workspace skills' })
      await skillManager.enableSkill(req.params.name, agent)
      return { ok: true }
    }
  )

  // Upload and install a .skill zip package
  app.post('/api/skills/install', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const uploadDir = join(tmpdir(), `skill-upload-${Date.now()}`)
    await mkdir(uploadDir, { recursive: true })
    const zipPath = join(uploadDir, data.filename)

    try {
      await pipeline(data.file, createWriteStream(zipPath))
      const extractDir = join(uploadDir, 'extracted')
      await mkdir(extractDir)
      execSync(`unzip -q "${zipPath}" -d "${extractDir}"`)

      // Agent is passed as a form field
      const agent = (data.fields as any)?.agent?.value ?? null
      const skill = await skillManager.installSkill(extractDir, agent)
      return skill
    } finally {
      await rm(uploadDir, { recursive: true })
    }
  })
}
