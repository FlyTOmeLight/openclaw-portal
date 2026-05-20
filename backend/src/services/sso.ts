import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export interface SsoConfig {
  enabled: boolean
  baseUrl: string
  loginPath: string
  tokenCheckUrl: string
  productCode: string
  redirectBaseUrl: string
  /** 应用 secretKey（用户中心应用审批通过后下发）。仅带签名的接口需要。 */
  secretKey: string
  /** 权限校验接口地址（带签名的 apihandler 接口)。 */
  permissionCheckUrl: string
  /** 开启后,SSO 登录在签发会话前调权限校验接口,不通过则拒登。 */
  permissionCheckEnabled: boolean
  /** 权限校验所需的权限标识(policyUids),全部命中才放行。 */
  requiredPolicyUids: string[]
  /** 开启后,SSO 登录校验用户部门是否在白名单内。 */
  orgCheckEnabled: boolean
  /** 组织校验白名单:允许登录的部门编号(deptNum)。 */
  allowedDeptNums: string[]
  /** UI 隐藏开关。true 时 portal 前端不展示蓝信 SSO 配置区块与登录按钮,
   * 后端 isEnabled() 视同关闭,/api/auth/sso/* 路由 404。
   * 仅由环境变量 PORTAL_SSO_HIDDEN 控制,不持久化到 portal-sso.json。 */
  hidden: boolean
}

/** tokenCheck 返回的登录用户信息(取所需字段)。 */
export interface SsoUser {
  userName: string
  deptNum: string
  deptName: string
  displayName: string
}

const DEFAULTS: SsoConfig = {
  enabled: false,
  baseUrl: 'https://sso.example.com',
  loginPath: '/auth/sso/ssoLogin/',
  tokenCheckUrl: 'https://sso.example.com/auth/sso/tokenCheck',
  productCode: 'ceai-license',
  redirectBaseUrl: '',
  secretKey: '',
  permissionCheckUrl: 'https://sso.example.com/auth/apihandler/permissionCheck',
  permissionCheckEnabled: false,
  requiredPolicyUids: [],
  orgCheckEnabled: false,
  allowedDeptNums: [],
  hidden: false,
}

const TOKEN_CHECK_TIMEOUT_MS = 10_000

/** 某些网关把 token 里的 '+' 传成空格，导致 tokenCheck 401。还原。
 * 移植自 cec-tool normalizeCestcToken。 */
export function normalizeCestcToken(v: string): string {
  return (v ?? '').trim().replace(/ /g, '+')
}

export class SsoService {
  private readonly storePath: string
  private cfg: SsoConfig = { ...DEFAULTS }
  /** 当前被 PORTAL_SSO_* 环境变量覆盖的配置键(env 优先于文件)。 */
  private envLocked: string[] = []

  constructor(openclawHome: string) {
    this.storePath = join(openclawHome, 'portal-sso.json')
  }

  async init(): Promise<void> {
    let fileCfg: Partial<SsoConfig> = {}
    if (existsSync(this.storePath)) {
      try {
        fileCfg = JSON.parse(await readFile(this.storePath, 'utf-8'))
      } catch { /* corrupt file — fall back to defaults */ }
    } else {
      // First run: write a default template so an admin can edit it by hand.
      await writeFile(this.storePath, JSON.stringify(DEFAULTS, null, 2), 'utf-8')
    }
    // File over defaults; env over file. Env stays in memory only — it is not
    // persisted back, so the file remains a clean editable template. Older
    // portal-sso.json files lacking the new keys fall back to DEFAULTS.
    this.cfg = { ...DEFAULTS, ...fileCfg }
    this.envLocked = applyEnvOverrides(this.cfg)
  }

  /** 重新读取配置(文件 + env),刷新内存中的 cfg。 */
  async reload(): Promise<void> {
    await this.init()
  }

  isEnabled(): boolean {
    // 隐藏即关闭:hidden=true 时,后端视同 SSO 未启用,所有 /api/auth/sso/*
    // 路由 404,避免残留链接 / cookie 把用户引到一个 UI 看不见的入口。
    if (this.cfg.hidden) return false
    return this.cfg.enabled
  }

  /** UI 是否隐藏蓝信 SSO 入口与配置。由 PORTAL_SSO_HIDDEN env 控制。 */
  isHidden(): boolean {
    return this.cfg.hidden
  }

  getConfig(): SsoConfig {
    return { ...this.cfg }
  }

  /** 当前被环境变量覆盖、UI 改不动的配置键。 */
  envLockedKeys(): string[] {
    return [...this.envLocked]
  }

  /** 写回 portal-sso.json 并重载。仅持久化白名单字段(由调用方校验)。
   * secretKey 为空串/缺失时保留文件原值 —— 不让「留空」的脱敏输入清掉密钥。 */
  async updateConfig(partial: Partial<SsoConfig>): Promise<void> {
    let fileCfg: Partial<SsoConfig> = {}
    if (existsSync(this.storePath)) {
      try {
        fileCfg = JSON.parse(await readFile(this.storePath, 'utf-8'))
      } catch { /* corrupt file — rebuild from defaults */ }
    }
    const merged: SsoConfig = { ...DEFAULTS, ...fileCfg }
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'secretKey' && (typeof v !== 'string' || v.length === 0)) continue
      ;(merged as unknown as Record<string, unknown>)[k] = v
    }
    await writeFile(this.storePath, JSON.stringify(merged, null, 2), 'utf-8')
    await this.reload()
  }

  /** 构造蓝信登录页 URL。redirect 为后端算好的回跳地址。
   * 移植自 cec-tool SSOLoginURL。
   * @param redirect 必须由后端构造,绝不能直接传入用户输入,否则成为 open redirect。 */
  buildLoginUrl(redirect: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '')
    const path = this.cfg.loginPath.replace(/^\/+/, '')
    const u = new URL(`${base}/${path}`)
    u.searchParams.set('productCode', this.cfg.productCode)
    if (redirect) u.searchParams.set('redirect', redirect)
    return u.toString()
  }

  /** 用户中心接口统一签名:SHA3-224(productCode + secretKey + timestamp),hex 小写。
   * 对照《用户中心接入手册 V2.1.11》签名说明(BouncyCastle SHA3Digest(224))。 */
  private sign(timestamp: number): string {
    return createHash('sha3-224')
      .update(`${this.cfg.productCode}${this.cfg.secretKey}${timestamp}`)
      .digest('hex')
  }

  /** 调蓝信 tokenCheck 校验。通过返回登录用户信息，失败抛错。
   * 移植自 cec-tool validateSSOToken。tokenCheck 接口本身不需签名。 */
  async verifyCestcToken(rawToken: string): Promise<SsoUser> {
    const token = normalizeCestcToken(rawToken)
    if (!token) throw new Error('缺少 cestcToken')

    let res: Response
    try {
      res = await fetch(this.cfg.tokenCheckUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: this.cfg.productCode, cestcToken: token }),
        signal: AbortSignal.timeout(TOKEN_CHECK_TIMEOUT_MS),
      })
    } catch (e: any) {
      throw new Error(`请求 SSO 服务失败: ${e?.message ?? e}`)
    }

    const raw = await res.text()
    let parsed: any = {}
    try { parsed = JSON.parse(raw) } catch { /* non-JSON body — leave empty */ }

    if (!res.ok) {
      throw new Error(`${parsed?.message || 'SSO 校验失败'}(HTTP ${res.status})`)
    }
    const data = parsed?.data ?? {}
    const userName = data.userName
    if (parsed?.code !== 20000 || typeof userName !== 'string' || !userName.trim()) {
      throw new Error(parsed?.message || 'SSO 校验失败')
    }
    return {
      userName: userName.trim(),
      deptNum: typeof data.deptNum === 'string' ? data.deptNum : '',
      deptName: typeof data.deptName === 'string' ? data.deptName : '',
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
    }
  }

  /** 组织校验:开关关时恒放行;开启时校验用户部门编号是否在白名单内。
   * 部门信息来自 tokenCheck 响应,无需额外签名调用。 */
  checkOrg(user: SsoUser): boolean {
    if (!this.cfg.orgCheckEnabled) return true
    return this.cfg.allowedDeptNums.includes(user.deptNum)
  }

  /** 权限校验:开关关时恒放行;开启时调用户中心 permissionCheck(带签名),
   * 校验用户是否命中 requiredPolicyUids 全部权限标识。
   * 基础设施错误(网络/非 20000)抛错 —— 调用方应 fail-closed 拒登。 */
  async checkPermission(userName: string): Promise<boolean> {
    if (!this.cfg.permissionCheckEnabled) return true

    const timestamp = Date.now()
    const body = {
      data: { policyUids: this.cfg.requiredPolicyUids, userUid: userName },
      productCode: this.cfg.productCode,
      sign: this.sign(timestamp),
      timestamp: String(timestamp),
    }

    let res: Response
    try {
      res = await fetch(this.cfg.permissionCheckUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TOKEN_CHECK_TIMEOUT_MS),
      })
    } catch (e: any) {
      throw new Error(`请求权限校验服务失败: ${e?.message ?? e}`)
    }

    const raw = await res.text()
    let parsed: any = {}
    try { parsed = JSON.parse(raw) } catch { /* non-JSON body — leave empty */ }

    if (!res.ok) {
      throw new Error(`${parsed?.message || '权限校验失败'}(HTTP ${res.status})`)
    }
    if (parsed?.code !== 20000) {
      throw new Error(parsed?.message || '权限校验失败')
    }
    return parsed?.data?.allow === true
  }
}

/** 逗号分隔的 env 值解析为去空去重的字符串数组。 */
function parseList(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

/** 应用 PORTAL_SSO_* 环境变量覆盖,返回被覆盖的配置键列表。 */
function applyEnvOverrides(cfg: SsoConfig): string[] {
  const e = process.env
  const locked: string[] = []
  if (e.PORTAL_SSO_ENABLED != null) {
    cfg.enabled = e.PORTAL_SSO_ENABLED === 'true'; locked.push('enabled')
  }
  if (e.PORTAL_SSO_BASE_URL) { cfg.baseUrl = e.PORTAL_SSO_BASE_URL; locked.push('baseUrl') }
  if (e.PORTAL_SSO_LOGIN_PATH) { cfg.loginPath = e.PORTAL_SSO_LOGIN_PATH; locked.push('loginPath') }
  if (e.PORTAL_SSO_TOKEN_CHECK_URL) {
    cfg.tokenCheckUrl = e.PORTAL_SSO_TOKEN_CHECK_URL; locked.push('tokenCheckUrl')
  }
  if (e.PORTAL_SSO_PRODUCT_CODE) {
    cfg.productCode = e.PORTAL_SSO_PRODUCT_CODE; locked.push('productCode')
  }
  if (e.PORTAL_SSO_REDIRECT_BASE_URL) {
    cfg.redirectBaseUrl = e.PORTAL_SSO_REDIRECT_BASE_URL; locked.push('redirectBaseUrl')
  }
  if (e.PORTAL_SSO_SECRET_KEY) { cfg.secretKey = e.PORTAL_SSO_SECRET_KEY; locked.push('secretKey') }
  if (e.PORTAL_SSO_PERMISSION_CHECK_URL) {
    cfg.permissionCheckUrl = e.PORTAL_SSO_PERMISSION_CHECK_URL; locked.push('permissionCheckUrl')
  }
  if (e.PORTAL_SSO_PERMISSION_CHECK_ENABLED != null) {
    cfg.permissionCheckEnabled = e.PORTAL_SSO_PERMISSION_CHECK_ENABLED === 'true'
    locked.push('permissionCheckEnabled')
  }
  if (e.PORTAL_SSO_REQUIRED_POLICY_UIDS != null) {
    cfg.requiredPolicyUids = parseList(e.PORTAL_SSO_REQUIRED_POLICY_UIDS)
    locked.push('requiredPolicyUids')
  }
  if (e.PORTAL_SSO_ORG_CHECK_ENABLED != null) {
    cfg.orgCheckEnabled = e.PORTAL_SSO_ORG_CHECK_ENABLED === 'true'
    locked.push('orgCheckEnabled')
  }
  if (e.PORTAL_SSO_ALLOWED_DEPT_NUMS != null) {
    cfg.allowedDeptNums = parseList(e.PORTAL_SSO_ALLOWED_DEPT_NUMS)
    locked.push('allowedDeptNums')
  }
  if (e.PORTAL_SSO_HIDDEN != null) {
    cfg.hidden = e.PORTAL_SSO_HIDDEN === 'true' || e.PORTAL_SSO_HIDDEN === '1'
    locked.push('hidden')
  }
  return locked
}
