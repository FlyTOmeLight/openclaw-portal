export interface VerifyResult {
  valid: boolean
  errors: string[]
  details: string[]
}

export class ChannelVerifier {
  async verify(platform: string, form: Record<string, any>): Promise<VerifyResult> {
    try {
      switch (platform) {
        case 'telegram':  return await this.verifyTelegram(form)
        case 'discord':   return await this.verifyDiscord(form)
        case 'qq-bot':    return await this.verifyQQBot(form)
        case 'feishu':    return await this.verifyFeishu(form)
        case 'dingtalk':  return await this.verifyDingTalk(form)
        case 'teams':     return await this.verifyTeams(form)
        case 'matrix':    return await this.verifyMatrix(form)
        case 'slack':     return await this.verifySlack(form)
        default:
          return { valid: false, errors: [`不支持 ${platform} 的凭证校验`], details: [] }
      }
    } catch (e: any) {
      return { valid: false, errors: [`网络错误: ${e.message ?? String(e)}`], details: [] }
    }
  }

  private async verifyTelegram(form: Record<string, any>): Promise<VerifyResult> {
    const token = String(form.botToken ?? '').trim()
    if (!token) return { valid: false, errors: ['Bot Token 不能为空'], details: [] }
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as any
    if (!data.ok) return { valid: false, errors: [data.description ?? '无效的 Bot Token'], details: [] }
    return { valid: true, errors: [], details: [`Bot: @${data.result?.username}`] }
  }

  private async verifyDiscord(form: Record<string, any>): Promise<VerifyResult> {
    const token = String(form.token ?? '').trim()
    if (!token) return { valid: false, errors: ['Bot Token 不能为空'], details: [] }
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) return { valid: false, errors: ['Bot Token 无效'], details: [] }
    const data = await res.json() as any
    return { valid: true, errors: [], details: [`Bot: ${data.username}#${data.discriminator ?? '0'}`] }
  }

  private async verifyQQBot(form: Record<string, any>): Promise<VerifyResult> {
    const appId = String(form.appId ?? '').trim()
    const clientSecret = String(form.clientSecret ?? '').trim()
    if (!appId) return { valid: false, errors: ['AppID 不能为空'], details: [] }
    if (!clientSecret) return { valid: false, errors: ['ClientSecret 不能为空'], details: [] }
    const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, clientSecret }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as any
    const errMsg = data.message ?? data.msg
    if (errMsg) return { valid: false, errors: [errMsg], details: [] }
    if (!data.access_token) return { valid: false, errors: ['未获取到 access_token，请检查凭证'], details: [] }
    return { valid: true, errors: [], details: [`AppID: ${appId}`] }
  }

  private async verifyFeishu(form: Record<string, any>): Promise<VerifyResult> {
    const appId = String(form.appId ?? '').trim()
    const appSecret = String(form.appSecret ?? '').trim()
    if (!appId) return { valid: false, errors: ['App ID 不能为空'], details: [] }
    if (!appSecret) return { valid: false, errors: ['App Secret 不能为空'], details: [] }
    const base = form.domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
    const res = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as any
    if (data.code !== 0) return { valid: false, errors: [data.msg ?? '凭证校验失败'], details: [] }
    return { valid: true, errors: [], details: [`App ID: ${appId}`] }
  }

  private async verifyDingTalk(form: Record<string, any>): Promise<VerifyResult> {
    const clientId = String(form.clientId ?? '').trim()
    const clientSecret = String(form.clientSecret ?? '').trim()
    if (!clientId) return { valid: false, errors: ['Client ID 不能为空'], details: [] }
    if (!clientSecret) return { valid: false, errors: ['Client Secret 不能为空'], details: [] }
    const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as any
    if (!data.accessToken && !data.access_token) {
      return { valid: false, errors: [data.message ?? data.errmsg ?? '凭证校验失败'], details: [] }
    }
    return { valid: true, errors: [], details: [`Client ID: ${clientId}`] }
  }

  private async verifyTeams(form: Record<string, any>): Promise<VerifyResult> {
    const appId = String(form.appId ?? '').trim()
    const appPassword = String(form.appPassword ?? '').trim()
    const tenantId = String(form.tenantId ?? '').trim() || 'botframework.com'
    if (!appId) return { valid: false, errors: ['App ID 不能为空'], details: [] }
    if (!appPassword) return { valid: false, errors: ['App Password 不能为空'], details: [] }
    const body = new URLSearchParams({
      client_id: appId,
      client_secret: appPassword,
      grant_type: 'client_credentials',
      scope: 'https://api.botframework.com/.default',
    })
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json() as any
    if (!data.access_token) {
      return { valid: false, errors: [data.error_description ?? data.error ?? '凭证校验失败'], details: [] }
    }
    return { valid: true, errors: [], details: [`App ID: ${appId}`] }
  }

  private async verifyMatrix(form: Record<string, any>): Promise<VerifyResult> {
    const homeserver = String(form.homeserver ?? '').trim()
    const accessToken = String(form.accessToken ?? '').trim()
    if (!homeserver) return { valid: false, errors: ['Homeserver 不能为空'], details: [] }
    if (!accessToken) return { valid: false, errors: ['Access Token 不能为空（填写后可校验）'], details: [] }
    const res = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) return { valid: false, errors: ['Access Token 无效'], details: [] }
    const data = await res.json() as any
    return { valid: true, errors: [], details: [data.user_id ? `User: ${data.user_id}` : '连接成功'] }
  }

  private async verifySlack(form: Record<string, any>): Promise<VerifyResult> {
    const botToken = String(form.botToken ?? '').trim()
    if (!botToken) return { valid: false, errors: ['Bot Token 不能为空'], details: [] }
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as any
    if (!data.ok) return { valid: false, errors: [data.error ?? 'Bot Token 无效'], details: [] }
    return { valid: true, errors: [], details: [`Workspace: ${data.team}，Bot: ${data.bot_id}`] }
  }
}
