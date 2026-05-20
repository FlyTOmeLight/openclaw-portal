/**
 * /api/skills/health         — overview across every installed skill.
 * /api/skills/:agent/:name/deps — full per-skill scan (4 dimensions).
 *
 * Path agent placeholder: `_global` denotes a skill that belongs to no
 * agent workspace (lives under ~/.openclaw/skills/). Anything else must
 * match AGENT_NAME_RE.
 *
 * Read-only — install endpoints are intentionally NOT defined here.
 */

import type { FastifyInstance } from 'fastify'
import type { SkillDepsChecker } from '../services/skill-deps-checker.js'

const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const GLOBAL_AGENT = '_global'

export async function skillDepsRoutes(app: FastifyInstance, checker: SkillDepsChecker) {
  // Overview — one summary line per installed skill. Used by the SkillHealth
  // page. Optional `refresh=1` busts the in-memory cache first.
  app.get<{ Querystring: { refresh?: string } }>('/api/skills/health', async (req) => {
    if (req.query.refresh === '1') checker.invalidate()
    const skills = await checker.healthOverview()
    return { skills }
  })

  // Per-skill deep scan. Use `_global` in :agent for skills that don't belong
  // to any agent workspace.
  app.get<{ Params: { agent: string; name: string }; Querystring: { refresh?: string } }>(
    '/api/skills/:agent/:name/deps',
    async (req, reply) => {
      const { agent: rawAgent, name } = req.params
      if (!SKILL_NAME_RE.test(name)) {
        return reply.code(400).send({ error: 'invalid skill name' })
      }
      const agent = rawAgent === GLOBAL_AGENT ? null : rawAgent
      if (agent !== null && !AGENT_NAME_RE.test(agent)) {
        return reply.code(400).send({ error: 'invalid agent name' })
      }
      if (req.query.refresh === '1') checker.invalidate()
      try {
        return await checker.checkSkill(name, agent)
      } catch (e: any) {
        if (/not found/i.test(String(e?.message ?? ''))) {
          return reply.code(404).send({ error: e.message })
        }
        throw e
      }
    },
  )
}
