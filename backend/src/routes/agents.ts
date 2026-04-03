import type { FastifyInstance } from 'fastify'
import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const DOMAIN_AGENTS = ['finance', 'bioinfo', 'medical', 'legal', 'frontend'] as const

export async function agentsRoutes(app: FastifyInstance, openclawHome: string) {
  app.get('/api/agents', async () => {
    const agents = await Promise.all(
      DOMAIN_AGENTS.map(async (agent) => {
        const workspaceDir = join(openclawHome, `workspace-${agent}`)
        const skillsDir = join(workspaceDir, 'skills')
        const soulPath = join(workspaceDir, 'SOUL.md')

        let skillCount = 0
        if (existsSync(skillsDir)) {
          const entries = await readdir(skillsDir, { withFileTypes: true })
          skillCount = entries.filter(e => e.isDirectory() && e.name !== 'disabled').length
        }

        let soul = ''
        if (existsSync(soulPath)) soul = await readFile(soulPath, 'utf-8')

        return { name: agent, skillCount, soul, workspaceDir }
      })
    )
    return agents
  })

  app.put<{ Params: { name: string }; Body: { soul: string } }>(
    '/api/agents/:name/soul',
    async (req, reply) => {
      if (!(DOMAIN_AGENTS as readonly string[]).includes(req.params.name)) {
        return reply.status(404).send({ error: 'Unknown agent' })
      }
      const soulPath = join(openclawHome, `workspace-${req.params.name}`, 'SOUL.md')
      await writeFile(soulPath, req.body.soul, 'utf-8')
      return { ok: true }
    }
  )
}
