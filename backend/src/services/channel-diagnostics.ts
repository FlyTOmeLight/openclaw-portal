import * as net from 'net'
import { config as appConfig, gatewayHttpBase } from '../config.js'

export interface DiagCheck {
  id: string
  title: string
  ok: boolean
  detail: string
}

export interface DiagResult {
  platform: string
  checks: DiagCheck[]
  overallReady: boolean
  hints: string[]
}

// Plugins required per platform (npm package name)
export const PLATFORM_PLUGIN_PACKAGES: Record<string, string> = {
  'qq-bot':     '@tencent-connect/openclaw-qqbot',
  'dingtalk':   '@dingtalk-real-ai/dingtalk-connector',
  'feishu':     '@larksuite/openclaw-lark',
  'weixin':     '@tencent-weixin/openclaw-weixin-cli',
  'Lansenger':  '@lansenger/openclaw-channel-lansenger',
  'teams':      '@openclaw/msteams',
  'matrix':     '@openclaw/matrix',
}

/** Build a normalized key set from installed plugin list for fuzzy matching.
 *  Includes: full npm name, name without version, short name (no scope), and plugin id.
 */
export function buildInstalledKeySet(plugins: Array<{ name?: string; id?: string }>): Set<string> {
  const keys = new Set<string>()
  for (const p of plugins) {
    const name = p.name ?? ''
    const id = p.id ?? ''
    if (name) {
      keys.add(name)
      // strip @version suffix: @scope/pkg@1.0.0 → @scope/pkg
      const base = name.replace(/@[^/@]+$/, '')
      keys.add(base)
      // short name without scope: @scope/pkg → pkg
      if (base.includes('/')) keys.add(base.split('/').pop()!)
    }
    if (id) {
      keys.add(id)
      // some ids look like "openclaw-lark@1.2.0" — strip version
      keys.add(id.replace(/@.*$/, ''))
    }
  }
  return keys
}

const REQUIRED_FIELDS: Record<string, string[]> = {
  telegram:   ['botToken'],
  discord:    ['token'],
  'qq-bot':   ['appId', 'clientSecret'],
  feishu:     ['appId', 'appSecret'],
  dingtalk:   ['clientId', 'clientSecret'],
  Lansenger:  ['appId', 'appSecret', 'apiGatewayUrl'],
  slack:      ['botToken'],
  teams:      ['appId', 'appPassword'],
  matrix:     ['homeserver'],
  signal:     ['account'],
}

export class ChannelDiagnostics {
  constructor(private readonly gatewayPort: number) {}

  async diagnose(
    platform: string,
    config: Record<string, any> | null,
    installedPlugins: Array<{ name?: string; id?: string }>,
  ): Promise<DiagResult> {
    const installedKeys = buildInstalledKeySet(installedPlugins)
    const checks: DiagCheck[] = []

    // 1. Gateway TCP
    const tcpOk = await this.checkTcp()
    checks.push({
      id: 'gateway_tcp',
      title: 'Gateway 进程',
      ok: tcpOk,
      detail: tcpOk
        ? `${appConfig.gatewayHost}:${this.gatewayPort} 可达`
        : `Gateway 未启动（端口 ${this.gatewayPort} 不可达）`,
    })

    // 2. Gateway HTTP（仅 TCP 通时检查）
    if (tcpOk) {
      const httpOk = await this.checkHttp()
      checks.push({
        id: 'gateway_http',
        title: 'Gateway HTTP 健康检查',
        ok: httpOk,
        detail: httpOk ? 'HTTP 端点正常' : 'HTTP 健康检查无响应',
      })
    }

    // 3. 渠道启用状态
    const enabled = config?.enabled !== false
    checks.push({
      id: 'channel_enabled',
      title: '渠道已启用',
      ok: enabled,
      detail: enabled ? '渠道处于启用状态' : '渠道已禁用，点击"启用"按钮',
    })

    // 4. 插件安装状态
    const requiredPkg = PLATFORM_PLUGIN_PACKAGES[platform]
    if (requiredPkg) {
      const installed = installedKeys.has(requiredPkg) || installedKeys.has(requiredPkg.replace(/@[^/@]+$/, '')) ||
        (requiredPkg.includes('/') && installedKeys.has(requiredPkg.split('/').pop()!.replace(/@.*$/, '')))
      checks.push({
        id: 'plugin',
        title: `插件 ${requiredPkg}`,
        ok: installed,
        detail: installed ? '插件已安装' : '插件未安装，点击"安装插件"',
      })
    }

    // 5. 必填凭证
    const requiredFields = REQUIRED_FIELDS[platform] ?? []
    const missing = requiredFields.filter(k => !config?.[k])
    checks.push({
      id: 'fields',
      title: '必填凭证',
      ok: missing.length === 0,
      detail: missing.length === 0
        ? '所有必填字段已配置'
        : `以下字段未填写：${missing.join('、')}`,
    })

    const overallReady = checks.every(c => c.ok)
    const hints: string[] = []
    if (!tcpOk) hints.push(`通过服务面板启动 Gateway，或运行：\nopenclaw gateway start`)
    if (!enabled) hints.push('在渠道卡片上点击"启用"按钮')
    if (requiredPkg && !checks.find(c => c.id === 'plugin')?.ok) {
      hints.push(`安装所需插件：\nopenclaw plugins install ${requiredPkg}@latest`)
    }
    if (missing.length > 0) hints.push('编辑渠道，填写所有必填凭证后保存')

    return { platform, checks, overallReady, hints }
  }

  private checkTcp(): Promise<boolean> {
    return new Promise(resolve => {
      const sock = new net.Socket()
      const t = setTimeout(() => { sock.destroy(); resolve(false) }, 2000)
      sock.connect(this.gatewayPort, appConfig.gatewayHost, () => { clearTimeout(t); sock.destroy(); resolve(true) })
      sock.on('error', () => { clearTimeout(t); resolve(false) })
    })
  }

  private async checkHttp(): Promise<boolean> {
    try {
      const res = await fetch(`${gatewayHttpBase(this.gatewayPort)}/__api/health`, {
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}
