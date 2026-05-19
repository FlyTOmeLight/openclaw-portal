/**
 * Dreaming routes — OpenClaw 梦境模式管理。
 *
 * 梦境(Dreaming)是 memory-core 插件的后台记忆固化系统:把短期信号经
 * Light/REM/Deep 三阶段提升为长期记忆。配置位于
 * `plugins.entries.memory-core.config.dreaming`,梦境扫描由一个托管 cron
 * 任务("Memory Dreaming Promotion")驱动。
 *
 * Method mapping (Gateway WebSocket RPC):
 *   GET  /api/dreaming/status  → doctor.memory.status   (取 .dreaming 子对象)
 *   GET  /api/dreaming/config  → 读 openclaw.json 配置
 *   PUT  /api/dreaming/config  → config.patch  (merge-patch 写入,启用会触发网关重启)
 *   GET  /api/dreaming/diary   → 读主 Agent 工作区 DREAMS.md
 *   POST /api/dreaming/run     → cron.list 找托管任务 → cron.run
 */
import type { FastifyInstance } from 'fastify'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { getGatewayRpc } from '../services/gateway-rpc.js'
import type { ProcessManager } from '../services/process-manager.js'

// memory-core SDK 常量 — 托管梦境 cron 任务的标识(见 memory-host-sdk/dreaming)
const MANAGED_CRON_NAME = 'Memory Dreaming Promotion'
const MANAGED_CRON_TAG = '[managed-by=memory-core.short-term-promotion]'
const DEFAULT_FREQUENCY = '0 3 * * *'

export async function dreamingRoutes(
  app: FastifyInstance,
  gatewayPort: number,
  openclawHome: string,
  portalPort: number,
  processManager: ProcessManager,
) {
  const rpc = () => getGatewayRpc(gatewayPort, openclawHome, portalPort)
  const configPath = join(openclawHome, 'openclaw.json')

  // ── 状态 ─────────────────────────────────────────────────────────────
  // doctor.memory.status 返回 { agentId, dreaming: { enabled, phases, counts… } }
  //
  // 注意 — memory-core 的 `doctor.memory.status` handler 走 cached path,
  // 但首调仍需 lazy-init `getActiveMemorySearchManager`(打开 vector store +
  // 扫 workspace dreaming store + 汇总三阶段托管 cron 状态),冷启动可能
  // 超过默认 15s RPC timeout。这里:
  //   1. 用更宽松的 30s timeout(memory-core 真的慢时不要太快放手)。
  //   2. 首次 timeout 就重试一次(给 manager 一次 warm-up 机会)。
  //   3. 仍 timeout 时返回 200 + `initializing: true`,让 UI 静默重试,
  //      不再弹 toast.error;只有真正的 RPC 错误才返回 502。
  const STATUS_RPC_TIMEOUT_MS = 30_000
  app.get('/api/dreaming/status', async (_req, reply) => {
    const callOnce = () => rpc().request('doctor.memory.status', {}, STATUS_RPC_TIMEOUT_MS)
    const isTimeout = (e: any) =>
      typeof e?.message === 'string' && e.message.startsWith('Gateway RPC timeout')

    let lastErr: any
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await callOnce()
        return { agentId: r?.agentId ?? 'main', dreaming: r?.dreaming ?? null }
      } catch (err: any) {
        lastErr = err
        if (!isTimeout(err)) break
        // 短暂等待让 manager init 完成,再试一次
        if (attempt === 0) await new Promise(res => setTimeout(res, 2000))
      }
    }

    if (isTimeout(lastErr)) {
      return {
        agentId: 'main',
        dreaming: null,
        initializing: true,
        error: `网关 memory 子系统初始化中(${STATUS_RPC_TIMEOUT_MS / 1000}s 内未响应)`,
      }
    }
    return reply.status(502).send({ error: `网关 RPC 失败: ${lastErr?.message ?? lastErr}` })
  })

  // ── 读配置 ───────────────────────────────────────────────────────────
  app.get('/api/dreaming/config', async (_req, reply) => {
    try {
      const cfg = JSON.parse(await readFile(configPath, 'utf-8'))
      const memoryCore = cfg?.plugins?.entries?.['memory-core'] ?? {}
      const dreaming = memoryCore?.config?.dreaming ?? {}
      return {
        enabled: dreaming.enabled ?? false,
        frequency: dreaming.frequency ?? DEFAULT_FREQUENCY,
        model: dreaming.model ?? '',
        allowModelOverride: memoryCore?.subagent?.allowModelOverride ?? false,
      }
    } catch (err: any) {
      return reply.status(500).send({ error: `读取配置失败: ${err?.message ?? err}` })
    }
  })

  // ── 写配置 ───────────────────────────────────────────────────────────
  // 走 config.patch RPC:网关做 RFC 7386 merge-patch,合并后校验并持久化,
  // 同时协调托管 cron 任务。启用梦境会触发网关重启。
  app.put<{ Body: { enabled?: boolean; frequency?: string; model?: string } }>(
    '/api/dreaming/config',
    async (req, reply) => {
      const { enabled, frequency, model } = req.body ?? {}
      const dreaming: Record<string, unknown> = {}
      if (typeof enabled === 'boolean') dreaming.enabled = enabled
      if (typeof frequency === 'string' && frequency.trim()) dreaming.frequency = frequency.trim()

      const memoryCore: Record<string, unknown> = { config: { dreaming } }
      if (model !== undefined) {
        // 空字符串 → null,merge-patch 据此删除 model 键
        dreaming.model = model ? model : null
        // 设置 model override 时必须打开 subagent 信任门控
        if (model) memoryCore.subagent = { allowModelOverride: true }
      }

      const raw = JSON.stringify({ plugins: { entries: { 'memory-core': memoryCore } } })
      try {
        // config.patch 走乐观锁:先 config.get 取当前 hash 作为 baseHash。
        // get→patch 窗口尽量短,避免并发写触发 "config changed since last load"。
        const snapshot = await rpc().request('config.get', {})
        const baseHash = typeof snapshot?.hash === 'string' ? snapshot.hash : undefined
        const result = await rpc().request('config.patch', baseHash ? { raw, baseHash } : { raw })

        // memory-core 的梦境托管 cron 任务只在 gateway 完整启动(gateway_start
        // hook)时创建/对账;config 热重载不会触发。因此梦境为启用态时,保存后
        // 必须重启 gateway,否则托管任务永远不会生成,「立即执行」也无任务可跑。
        const restarting = enabled === true
        if (restarting) {
          processManager.restart().catch(e =>
            console.warn('[dreaming] gateway restart failed:', e),
          )
        }
        return { ok: true, result, restarting }
      } catch (err: any) {
        return reply.status(502).send({ error: `写入配置失败: ${err?.message ?? err}` })
      }
    },
  )

  // ── 梦境日记 DREAMS.md ───────────────────────────────────────────────
  app.get('/api/dreaming/diary', async (_req, reply) => {
    const workspace = join(openclawHome, 'workspace')
    for (const name of ['DREAMS.md', 'dreams.md']) {
      try {
        const content = await readFile(join(workspace, name), 'utf-8')
        return { exists: true, name, content }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          return reply.status(500).send({ error: `读取日记失败: ${err?.message ?? err}` })
        }
      }
    }
    return { exists: false, name: 'DREAMS.md', content: '' }
  })

  // ── 立即执行一次梦境扫描 ─────────────────────────────────────────────
  // 梦境扫描没有专用 RPC,实质是一个托管 cron 任务,这里找到并触发它。
  app.post('/api/dreaming/run', async (_req, reply) => {
    try {
      const list = await rpc().request('cron.list', { includeDisabled: true })
      const jobs: any[] = Array.isArray(list?.jobs) ? list.jobs : []
      const job = jobs.find(j =>
        j?.name === MANAGED_CRON_NAME ||
        (typeof j?.name === 'string' && j.name.includes('Dreaming Promotion')) ||
        JSON.stringify(j ?? {}).includes(MANAGED_CRON_TAG),
      )
      if (!job) {
        return reply.status(409).send({ error: '未找到梦境托管任务,请先启用梦境模式' })
      }
      await rpc().request('cron.run', { jobId: job.id })
      return { ok: true, jobId: job.id, jobName: job.name }
    } catch (err: any) {
      return reply.status(502).send({ error: `触发失败: ${err?.message ?? err}` })
    }
  })
}
