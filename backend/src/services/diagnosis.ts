import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import type { ConfigManager } from './config-manager.js'
import { buildGatewayAuthHeaders } from './gateway-rpc.js'
import { gatewayHttpBase } from '../config.js'
import { join } from 'path'

const execFileAsync = promisify(execFile)

export interface CheckResult {
  name: string
  label: string
  status: 'ok' | 'warn' | 'error'
  message: string
  detail?: string
  repairable?: boolean
}

export class DiagnosisService {
  constructor(
    private configManager: ConfigManager,
    private openclawBin: string,
    private openclawHome: string,
    private gatewayPort: number,
  ) {}

  async checkConfig(): Promise<CheckResult> {
    try {
      const cfg = await this.configManager.read()
      const issues: string[] = []

      if (!cfg.agents?.defaults?.model?.primary) issues.push('缺少 primary model 配置')
      if (!cfg.models?.providers || Object.keys(cfg.models.providers).length === 0) {
        issues.push('未配置模型提供商')
      }
      if (!cfg.gateway?.port) issues.push('缺少 gateway.port 配置')

      if (issues.length > 0) {
        return { name: 'config', label: '配置文件', status: 'warn', message: issues.join('；') }
      }
      return { name: 'config', label: '配置文件', status: 'ok', message: 'openclaw.json 配置正常' }
    } catch (err: any) {
      return {
        name: 'config', label: '配置文件', status: 'error',
        message: `配置文件读取失败: ${err.message}`,
      }
    }
  }

  async checkGateway(): Promise<CheckResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const headers = await buildGatewayAuthHeaders(join(this.openclawHome, 'openclaw.json'))
      const res = await fetch(`${gatewayHttpBase(this.gatewayPort)}/v1/models`, {
        headers,
        signal: controller.signal,
      })
      // 401 is fine — gateway is running, just needs auth
      if (res.ok || res.status === 401 || res.status === 403) {
        return { name: 'gateway', label: 'OpenClaw 网关', status: 'ok', message: `网关运行正常（端口 ${this.gatewayPort}）` }
      }
      return {
        name: 'gateway', label: 'OpenClaw 网关', status: 'warn',
        message: `网关响应异常: HTTP ${res.status}`, repairable: true,
      }
    } catch (err: any) {
      return {
        name: 'gateway', label: 'OpenClaw 网关', status: 'error',
        message: '网关未运行或无法连接', repairable: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async checkModels(): Promise<CheckResult> {
    try {
      const cfg = await this.configManager.read()
      const providers = cfg.models?.providers ?? {}
      const providerCount = Object.keys(providers).length

      if (providerCount === 0) {
        return { name: 'models', label: '模型连通性', status: 'warn', message: '未配置任何模型提供商' }
      }

      // Probe via the local gateway — it already has network access to model providers.
      // If gateway can list models, connectivity is fine.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        const headers = await buildGatewayAuthHeaders(join(this.openclawHome, 'openclaw.json'))
        const res = await fetch(`${gatewayHttpBase(this.gatewayPort)}/v1/models`, {
          headers,
          signal: controller.signal,
        })
        if (res.ok) {
          return {
            name: 'models', label: '模型连通性', status: 'ok',
            message: `${providerCount} 个模型提供商连通正常`,
          }
        }
        return {
          name: 'models', label: '模型连通性', status: 'warn',
          message: `网关返回 HTTP ${res.status}，模型可能未就绪`,
        }
      } catch {
        return {
          name: 'models', label: '模型连通性', status: 'warn',
          message: '网关未响应，无法确认模型连通性',
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (err: any) {
      return { name: 'models', label: '模型连通性', status: 'error', message: `检查失败: ${err.message}` }
    }
  }

  async checkBinaries(): Promise<CheckResult> {
    const bins = [this.openclawBin, 'agent-browser', 'summarize']
    const missing: string[] = []

    for (const bin of bins) {
      try {
        await execFileAsync('which', [bin], { timeout: 3000 })
      } catch {
        missing.push(bin)
      }
    }

    if (missing.length > 0) {
      return { name: 'binaries', label: '二进制文件', status: 'error', message: `缺少: ${missing.join(', ')}` }
    }
    return { name: 'binaries', label: '二进制文件', status: 'ok', message: '所有必需程序均已安装' }
  }

  async checkDisk(): Promise<CheckResult> {
    try {
      const { stdout } = await execFileAsync('df', ['-k', this.openclawHome], { timeout: 3000 })
      const lines = stdout.trim().split('\n')
      const parts = lines[1]?.split(/\s+/)
      if (parts && parts.length >= 5) {
        const usePercent = parseInt(parts[4].replace('%', ''), 10)
        if (usePercent >= 95) {
          return { name: 'disk', label: '磁盘空间', status: 'error', message: `磁盘使用率 ${usePercent}%，空间严重不足` }
        }
        if (usePercent >= 85) {
          return { name: 'disk', label: '磁盘空间', status: 'warn', message: `磁盘使用率 ${usePercent}%，建议清理` }
        }
        return { name: 'disk', label: '磁盘空间', status: 'ok', message: `磁盘使用率 ${usePercent}%` }
      }
      return { name: 'disk', label: '磁盘空间', status: 'warn', message: '无法解析磁盘信息' }
    } catch (err: any) {
      return { name: 'disk', label: '磁盘空间', status: 'warn', message: `磁盘检查失败: ${err.message}` }
    }
  }

  async checkSSL(): Promise<CheckResult> {
    // installer generates openclaw-ip.crt; fall back to legacy server.crt
    const certPath = existsSync('/etc/nginx/ssl/openclaw-ip.crt')
      ? '/etc/nginx/ssl/openclaw-ip.crt'
      : '/etc/nginx/ssl/server.crt'
    if (!existsSync(certPath)) {
      return { name: 'ssl', label: 'SSL 证书', status: 'warn', message: '未找到 SSL 证书（/etc/nginx/ssl/openclaw-ip.crt）' }
    }
    try {
      const { stdout } = await execFileAsync('openssl', ['x509', '-enddate', '-noout', '-in', certPath], { timeout: 3000 })
      const match = stdout.match(/notAfter=(.+)/)
      if (match) {
        const expiry = new Date(match[1])
        const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000)
        if (daysLeft < 0) return { name: 'ssl', label: 'SSL 证书', status: 'error', message: `证书已过期 ${-daysLeft} 天` }
        if (daysLeft < 30) return { name: 'ssl', label: 'SSL 证书', status: 'warn', message: `证书将在 ${daysLeft} 天后过期` }
        return { name: 'ssl', label: 'SSL 证书', status: 'ok', message: `证书有效，还有 ${daysLeft} 天到期` }
      }
      return { name: 'ssl', label: 'SSL 证书', status: 'ok', message: 'SSL 证书存在' }
    } catch {
      return { name: 'ssl', label: 'SSL 证书', status: 'warn', message: 'SSL 证书检查跳过（openssl 不可用）' }
    }
  }

  async runAll(): Promise<CheckResult[]> {
    const settled = await Promise.allSettled([
      this.checkConfig(),
      this.checkGateway(),
      this.checkModels(),
      this.checkBinaries(),
      this.checkDisk(),
      this.checkSSL(),
    ])
    return settled.map(r =>
      r.status === 'fulfilled' ? r.value : {
        name: 'unknown', label: '未知', status: 'error' as const, message: '检查时发生异常',
      },
    )
  }
}
