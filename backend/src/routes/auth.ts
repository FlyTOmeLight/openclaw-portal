import type { FastifyInstance } from 'fastify'
import type { AuthService } from '../services/auth.js'
import type { SsoService, SsoConfig } from '../services/sso.js'
import type { AuditLog } from '../services/audit-log.js'

export const COOKIE_NAME = 'openclaw_session'
const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 86400, // 24h in seconds
}

export async function authRoutes(
  app: FastifyInstance,
  auth: AuthService,
  sso: SsoService,
  auditLog: AuditLog,
) {
  // 登录 / 登出审计 —— 在 handler 内显式记录(登录请求时会话尚未建立,通用
  // onResponse 审计钩子拿不到用户身份,故在此处用已知的真实用户写入)。
  const auditAuth = (
    req: { method: string; url: string },
    actor: string, action: string, target: string,
    status: number, result: 'success' | 'failure', errorMessage?: string,
  ) => auditLog.record({
    ts: Date.now(), actor, action, target,
    method: req.method, url: req.url.replace(/^\/portal/, ''),
    status, result, ...(errorMessage ? { errorMessage } : {}),
  })

  app.get('/api/auth/status', async () => {
    return { enabled: auth.isEnabled(), ssoEnabled: sso.isEnabled() }
  })

  app.post('/api/auth/login', async (req, reply) => {
    if (!auth.isEnabled()) return { ok: true, disabled: true }
    const { password } = req.body as { password?: string }
    if (!password || !await auth.verifyPassword(password)) {
      auditAuth(req, 'admin', 'login', 'password', 401, 'failure', '密码错误')
      return reply.code(401).send({ error: '密码错误' })
    }
    const token = auth.issueToken('admin', 'password')
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS)
    auditAuth(req, 'admin', 'login', 'password', 200, 'success')
    return { ok: true }
  })

  app.get('/api/auth/check', async (req, reply) => {
    if (!auth.isEnabled() && !sso.isEnabled()) return { ok: true, disabled: true }
    const token = req.cookies[COOKIE_NAME]
    if (!token || !auth.verifyToken(token)) {
      return reply.code(401).send({ error: '未登录' })
    }
    return { ok: true }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME]
    const session = token ? auth.getSession(token) : null
    if (token) auth.revokeToken(token)
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    auditAuth(req, session?.user ?? 'admin', 'logout', session?.method ?? 'password', 200, 'success')
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
    const token = auth.issueToken('admin', 'password')
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS)
    auditAuth(req, 'admin', 'login', 'password', 200, 'success')
    return { ok: true }
  })

  app.post('/api/auth/disable', async (req, reply) => {
    if (!auth.isEnabled()) return { ok: true, alreadyDisabled: true }
    // 蓝信 SSO 不能作为唯一登录方式:SSO 开启时禁止停用密码登录,
    // 否则蓝信故障后将无人能登入 portal。
    if (sso.isEnabled()) {
      return reply.code(400).send({ error: '蓝信 SSO 已开启,请先关闭蓝信 SSO 再停用密码登录' })
    }
    const { password } = req.body as { password?: string }
    if (!password) return reply.code(400).send({ error: '请输入当前密码' })
    const ok = await auth.disable(password)
    if (!ok) return reply.code(401).send({ error: '密码错误' })
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  // ── 蓝信 SSO ────────────────────────────────────────────
  // 回跳地址完全由后端构造,不接受客户端传入的 redirect,消除 open redirect。
  app.get('/api/auth/sso/login-url', async (req, reply) => {
    if (!sso.isEnabled()) return reply.code(404).send({ error: 'SSO 未启用' })
    const configured = sso.getConfig().redirectBaseUrl.replace(/\/+$/, '')
    let base = configured
    if (!base) {
      const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
      // X-Forwarded-Host 在此可信:后端只绑 loopback,nginx 是唯一入口并设置该头。
      // 若日后放宽绑定,改用 PORTAL_SSO_REDIRECT_BASE_URL。
      const host = (req.headers['x-forwarded-host'] as string)
        || (req.headers['host'] as string) || ''
      if (!host) {
        return reply.code(500).send({
          error: '无法推导回跳地址,请配置 PORTAL_SSO_REDIRECT_BASE_URL',
        })
      }
      // 标准部署中 portal 挂在 nginx 的 /portal/ 前缀下。非标准前缀须设
      // PORTAL_SSO_REDIRECT_BASE_URL 覆盖。
      base = `${proto}://${host}/portal`
    }
    return { loginUrl: sso.buildLoginUrl(`${base}/login`) }
  })

  app.post('/api/auth/sso/login', async (req, reply) => {
    if (!sso.isEnabled()) return reply.code(404).send({ error: 'SSO 未启用' })
    const { cestcToken } = req.body as { cestcToken?: string }
    if (!cestcToken) return reply.code(400).send({ error: '缺少 cestcToken' })
    let user: Awaited<ReturnType<typeof sso.verifyCestcToken>>
    try {
      user = await sso.verifyCestcToken(cestcToken)
    } catch (e: any) {
      req.log.warn({ err: e?.message }, 'SSO login failed')
      auditAuth(req, 'unknown', 'login', 'sso', 401, 'failure', e?.message || 'SSO 校验失败')
      return reply.code(401).send({ error: e?.message || 'SSO 校验失败' })
    }
    // 组织校验:开关关时恒放行;开启时校验部门白名单。
    if (!sso.checkOrg(user)) {
      req.log.warn({ ssoUser: user.userName, deptNum: user.deptNum }, 'SSO login denied: org check')
      auditAuth(req, user.userName, 'login', 'sso', 403, 'failure', '该部门无访问权限')
      return reply.code(403).send({ error: '该部门无访问权限' })
    }
    // 权限校验:开关关时恒放行;基础设施错误 fail-closed 拒登。
    let permitted: boolean
    try {
      permitted = await sso.checkPermission(user.userName)
    } catch (e: any) {
      req.log.warn({ ssoUser: user.userName, err: e?.message }, 'SSO permission check failed')
      auditAuth(req, user.userName, 'login', 'sso', 403, 'failure', '权限校验失败')
      return reply.code(403).send({ error: '权限校验失败' })
    }
    if (!permitted) {
      req.log.warn({ ssoUser: user.userName }, 'SSO login denied: permission check')
      auditAuth(req, user.userName, 'login', 'sso', 403, 'failure', '无访问权限')
      return reply.code(403).send({ error: '无访问权限' })
    }
    // 蓝信用户名仅记日志用于审计;会话 cookie 保持不透明 HMAC,不嵌用户名。
    req.log.info({ ssoUser: user.userName }, 'SSO login success')
    const token = auth.issueToken(user.userName, 'sso')
    reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS)
    auditAuth(req, user.userName, 'login', 'sso', 200, 'success')
    return { ok: true }
  })

  // ── 蓝信 SSO 配置(系统设置页用)─────────────────────────
  // 路径不在 /api/auth/ 下 → 受 authGuard 保护,仅登录管理员可读写。
  app.get('/api/sso/config', async () => {
    const c = sso.getConfig()
    // secretKey 绝不回传明文,只回「是否已配置」。
    return {
      enabled: c.enabled,
      productCode: c.productCode,
      baseUrl: c.baseUrl,
      loginPath: c.loginPath,
      tokenCheckUrl: c.tokenCheckUrl,
      redirectBaseUrl: c.redirectBaseUrl,
      permissionCheckUrl: c.permissionCheckUrl,
      permissionCheckEnabled: c.permissionCheckEnabled,
      requiredPolicyUids: c.requiredPolicyUids,
      orgCheckEnabled: c.orgCheckEnabled,
      allowedDeptNums: c.allowedDeptNums,
      secretKeySet: c.secretKey.length > 0,
      envLocked: sso.envLockedKeys(),
    }
  })

  app.put('/api/sso/config', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const isStrList = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every(x => typeof x === 'string')

    for (const k of ['enabled', 'permissionCheckEnabled', 'orgCheckEnabled']) {
      if (typeof b[k] === 'boolean') patch[k] = b[k]
    }
    for (const k of ['productCode', 'baseUrl', 'loginPath', 'tokenCheckUrl',
                     'redirectBaseUrl', 'permissionCheckUrl', 'secretKey']) {
      if (typeof b[k] === 'string') patch[k] = b[k]
    }
    for (const k of ['requiredPolicyUids', 'allowedDeptNums']) {
      if (isStrList(b[k])) patch[k] = (b[k] as string[]).map(s => s.trim()).filter(Boolean)
    }

    // 约束:蓝信 SSO 不能作为唯一登录方式 —— 开启它必须同时启用密码登录,
    // 否则蓝信故障(网关不可达、回跳白名单等)时将无人能登入 portal。
    const willEnable = typeof patch.enabled === 'boolean' ? patch.enabled : sso.isEnabled()
    if (willEnable && !auth.isEnabled()) {
      return reply.code(400).send({
        error: '请先在「登录保护」启用密码登录,再开启蓝信 SSO(蓝信故障时需要密码登录兜底)',
      })
    }

    try {
      await sso.updateConfig(patch as unknown as Partial<SsoConfig>)
    } catch (e: any) {
      req.log.error({ err: e?.message }, 'SSO config update failed')
      return reply.code(500).send({ error: '保存失败' })
    }
    return { ok: true }
  })
}

export function authGuard(auth: AuthService, sso: SsoService) {
  // /api/system/ping is a public liveness probe — the upgrade apply script and
  // post-restart polling must reach it without a session cookie.
  const PUBLIC_PREFIXES = ['/api/auth/', '/api/system/ping']
  return async (req: any, reply: any) => {
    const url: string = req.url
    if (!url.startsWith('/api/')) return
    if (PUBLIC_PREFIXES.some(p => url.startsWith(p))) return
    if (url.includes('/api/ws')) return
    // auth 与 sso 都未启用 → 全开放(portal 仍只绑 loopback,nginx 是真正前门)。
    if (!auth.isEnabled() && !sso.isEnabled()) return

    const token = req.cookies?.[COOKIE_NAME]
    if (!token || !auth.verifyToken(token)) {
      return reply.code(401).send({ error: '未登录' })
    }
  }
}
