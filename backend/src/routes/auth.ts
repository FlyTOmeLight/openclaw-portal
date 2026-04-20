import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../services/auth.js'

const COOKIE_NAME = 'openclaw_session'
const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 86400, // 24h in seconds
}

export async function authRoutes(app: FastifyInstance, auth: AuthService) {
  app.get('/api/auth/status', async () => {
    return { enabled: auth.isEnabled() }
  })

  app.post('/api/auth/login', async (req, reply) => {
    if (!auth.isEnabled()) return { ok: true, disabled: true }
    const { password } = req.body as { password?: string }
    if (!password || !await auth.verifyPassword(password)) {
      return reply.code(401).send({ error: '密码错误' })
    }
    const token = auth.issueToken()
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS)
    return { ok: true }
  })

  app.get('/api/auth/check', async (req, reply) => {
    if (!auth.isEnabled()) return { ok: true, disabled: true }
    const token = req.cookies[COOKIE_NAME]
    if (!token || !auth.verifyToken(token)) {
      return reply.code(401).send({ error: '未登录' })
    }
    return { ok: true }
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.post('/api/auth/change-password', async (req, reply) => {
    if (!auth.isEnabled()) return reply.code(400).send({ error: '登录保护未启用' })
    const token = req.cookies[COOKIE_NAME]
    if (!token || !auth.verifyToken(token)) {
      return reply.code(401).send({ error: '未登录' })
    }
    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string }
    if (!oldPassword || !newPassword) {
      return reply.code(400).send({ error: '缺少参数' })
    }
    if (newPassword.length < 6) {
      return reply.code(400).send({ error: '新密码至少 6 个字符' })
    }
    const ok = await auth.changePassword(oldPassword, newPassword)
    if (!ok) return reply.code(401).send({ error: '原密码错误' })
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.post('/api/auth/enable', async (req, reply) => {
    const { password, confirmPassword } = req.body as { password?: string; confirmPassword?: string }
    if (!password || password.length < 6) {
      return reply.code(400).send({ error: '密码至少 6 个字符' })
    }
    if (password !== confirmPassword) {
      return reply.code(400).send({ error: '两次输入的密码不一致' })
    }
    if (auth.isEnabled()) {
      return reply.code(400).send({ error: '登录保护已启用，请使用修改密码接口' })
    }
    const ok = await auth.enable(password)
    if (!ok) return reply.code(400).send({ error: '启用失败' })
    const token = auth.issueToken()
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS)
    return { ok: true }
  })

  app.post('/api/auth/disable', async (req, reply) => {
    if (!auth.isEnabled()) return { ok: true, alreadyDisabled: true }
    const { password } = req.body as { password?: string }
    if (!password) return reply.code(400).send({ error: '请输入当前密码' })
    const ok = await auth.disable(password)
    if (!ok) return reply.code(401).send({ error: '密码错误' })
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })
}

export function authGuard(auth: AuthService) {
  const PUBLIC_PREFIXES = ['/api/auth/']
  return async (req: any, reply: any) => {
    const url: string = req.url
    if (!url.startsWith('/api/')) return
    if (PUBLIC_PREFIXES.some(p => url.startsWith(p))) return
    if (url.includes('/api/ws')) return
    // Auth disabled → everything is open. Portal is already loopback-only
    // so nginx in front is the real front door; inside the loopback there's
    // no attacker to authenticate against.
    if (!auth.isEnabled()) return

    const token = req.cookies?.[COOKIE_NAME]
    if (!token || !auth.verifyToken(token)) {
      return reply.code(401).send({ error: '未登录' })
    }
  }
}
