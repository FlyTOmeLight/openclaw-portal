import type { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string        // for SSE/HTTP-based remote servers
  headers?: Record<string, string>
  transport?: 'stdio' | 'sse' | 'http'
  description?: string
  disabled?: boolean
  // Portal-layer convention (not yet read by gateway): which agents may use
  // this MCP server. Empty array or missing field = all agents allowed.
  allowedAgents?: string[]
}

async function readConfig(configPath: string): Promise<any> {
  if (!existsSync(configPath)) return {}
  const raw = await readFile(configPath, 'utf-8')
  try { return JSON.parse(raw) } catch { return {} }
}

async function writeConfig(configPath: string, cfg: any): Promise<void> {
  // Pretty-print to stay diff-friendly with openclaw's own writes
  await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
}

function getServers(cfg: any): Record<string, McpServerConfig> {
  return cfg?.mcp?.servers ?? {}
}

function setServers(cfg: any, servers: Record<string, McpServerConfig>): any {
  if (!cfg.mcp) cfg.mcp = {}
  cfg.mcp.servers = servers
  return cfg
}

function isValidName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)
}

export async function mcpRoutes(app: FastifyInstance, openclawHome: string, openclawBin: string) {
  const configPath = join(openclawHome, 'openclaw.json')

  async function resolveOpenclawBin(): Promise<string> {
    // Prefer the configured bin path if it exists on disk
    if (existsSync(openclawBin)) return openclawBin
    return 'openclaw'  // fall back to $PATH lookup
  }

  // GET /api/mcp/servers — list
  app.get('/api/mcp/servers', async () => {
    const cfg = await readConfig(configPath)
    const servers = getServers(cfg)
    const list = Object.entries(servers).map(([name, s]) => ({
      name,
      command: s.command ?? '',
      args: s.args ?? [],
      env: s.env ?? {},
      cwd: s.cwd ?? '',
      url: s.url ?? '',
      transport: s.transport ?? (s.url ? 'http' : 'stdio'),
      description: s.description ?? '',
      disabled: Boolean(s.disabled),
      allowedAgents: Array.isArray(s.allowedAgents) ? s.allowedAgents : [],
    }))
    return { servers: list }
  })

  // GET /api/mcp/servers/:name
  app.get<{ Params: { name: string } }>('/api/mcp/servers/:name', async (req, reply) => {
    const { name } = req.params
    if (!isValidName(name)) return reply.status(400).send({ error: '非法名称' })
    const cfg = await readConfig(configPath)
    const s = getServers(cfg)[name]
    if (!s) return reply.status(404).send({ error: 'MCP server not found' })
    return { name, ...s }
  })

  // PUT /api/mcp/servers/:name — create or update
  app.put<{ Params: { name: string }; Body: McpServerConfig }>(
    '/api/mcp/servers/:name',
    async (req, reply) => {
      const { name } = req.params
      if (!isValidName(name)) return reply.status(400).send({ error: '名称必须以字母开头，只含字母/数字/-/_，最长 64' })

      const body = req.body ?? {}
      // Need at least command+args OR url
      if (!body.command && !body.url) {
        return reply.status(400).send({ error: '必须提供 command（stdio 模式）或 url（远程模式）' })
      }

      const entry: McpServerConfig = {}
      if (body.command) entry.command = String(body.command)
      if (Array.isArray(body.args)) entry.args = body.args.map(String)
      if (body.env && typeof body.env === 'object') entry.env = body.env
      if (body.cwd) entry.cwd = String(body.cwd)
      if (body.url) entry.url = String(body.url)
      if (body.headers && typeof body.headers === 'object') entry.headers = body.headers
      if (body.transport) entry.transport = body.transport
      if (body.description) entry.description = String(body.description)
      if (typeof body.disabled === 'boolean') entry.disabled = body.disabled
      if (Array.isArray(body.allowedAgents)) {
        entry.allowedAgents = body.allowedAgents.map(String)
      }

      const cfg = await readConfig(configPath)
      const servers = getServers(cfg)
      servers[name] = entry
      setServers(cfg, servers)
      await writeConfig(configPath, cfg)
      return { ok: true, name, server: entry }
    },
  )

  // DELETE /api/mcp/servers/:name
  app.delete<{ Params: { name: string } }>(
    '/api/mcp/servers/:name',
    async (req, reply) => {
      const { name } = req.params
      if (!isValidName(name)) return reply.status(400).send({ error: '非法名称' })
      const cfg = await readConfig(configPath)
      const servers = getServers(cfg)
      if (!(name in servers)) return reply.status(404).send({ error: 'MCP server not found' })
      delete servers[name]
      setServers(cfg, servers)
      await writeConfig(configPath, cfg)
      return { ok: true }
    },
  )

  // POST /api/mcp/servers/:name/test — probe connectivity
  // Stdio servers: spawn with --help or no args, check the process starts without
  // crashing within 4 seconds. HTTP/SSE servers: HEAD request to the URL.
  app.post<{ Params: { name: string } }>(
    '/api/mcp/servers/:name/test',
    async (req, reply) => {
      const { name } = req.params
      if (!isValidName(name)) return reply.status(400).send({ error: '非法名称' })
      const cfg = await readConfig(configPath)
      const s = getServers(cfg)[name]
      if (!s) return reply.status(404).send({ error: 'MCP server not found' })

      if (s.url) {
        try {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 5000)
          const res = await fetch(s.url, { method: 'HEAD', signal: ctrl.signal, headers: s.headers })
          clearTimeout(timer)
          return { ok: res.ok, status: res.status, transport: 'http' }
        } catch (e: any) {
          return reply.status(200).send({ ok: false, error: e.message, transport: 'http' })
        }
      }

      if (!s.command) {
        return reply.status(400).send({ error: '该 server 既无 command 也无 url，无法测试' })
      }

      return new Promise<void>((resolve) => {
        let stdoutBuf = ''
        let stderrBuf = ''
        let settled = false
        const finish = (result: any) => {
          if (settled) return
          settled = true
          reply.send(result)
          resolve()
        }

        let child: ReturnType<typeof spawn>
        try {
          child = spawn(s.command!, s.args ?? [], {
            env: { ...process.env, ...(s.env ?? {}) },
            cwd: s.cwd || process.env.HOME,
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        } catch (e: any) {
          return finish({ ok: false, error: `spawn failed: ${e.message}`, transport: 'stdio' })
        }

        child.stdout?.on('data', d => { stdoutBuf += d.toString('utf8').slice(0, 500) })
        child.stderr?.on('data', d => { stderrBuf += d.toString('utf8').slice(0, 500) })
        child.on('error', (err) => {
          finish({ ok: false, error: err.message, transport: 'stdio', stderr: stderrBuf })
        })
        child.on('exit', (code, signal) => {
          // Exit before timeout → server probably crashed (MCP stdio servers run until EOF)
          // But CLI tools that print help also exit fast; treat as inconclusive
          if (!settled) {
            const ok = code === 0
            finish({
              ok,
              code,
              signal,
              transport: 'stdio',
              stdout: stdoutBuf,
              stderr: stderrBuf,
              note: ok
                ? '进程正常退出（常见于 stdio server 在无输入时退出，不代表失败）'
                : '进程异常退出，请检查 command/args 是否正确',
            })
          }
        })

        // MCP stdio servers expect to run indefinitely. If it's still alive after
        // 3 seconds, the binary is at least resolvable and starts cleanly.
        setTimeout(() => {
          if (!settled) {
            try { child.kill('SIGTERM') } catch {}
            finish({
              ok: true,
              transport: 'stdio',
              stdout: stdoutBuf,
              stderr: stderrBuf,
              note: '进程启动后持续运行 3 秒，视为可用',
            })
          }
        }, 3000).unref()
      })
    },
  )

  // GET /api/mcp/serve-info — info for exposing this OpenClaw as an MCP server
  // to external clients (Claude Desktop, Cursor, Continue, etc.)
  app.get('/api/mcp/serve-info', async () => {
    const openclawBin = await resolveOpenclawBin()
    const serverName = 'openclaw'
    const stdioEntry = {
      command: openclawBin,
      args: ['mcp', 'serve'],
      env: { OPENCLAW_HOME: openclawHome },
    }
    // Claude Desktop / Cursor config shape: { mcpServers: { <name>: {...} } }
    const claudeDesktopConfig = { mcpServers: { [serverName]: stdioEntry } }
    // Continue config shape: "experimental.modelContextProtocolServers": [{name, transport:{...}}]
    const continueConfig = [{
      name: serverName,
      transport: { type: 'stdio', command: stdioEntry.command, args: stdioEntry.args, env: stdioEntry.env },
    }]
    return {
      openclawBin,
      openclawHome,
      stdioEntry,
      clients: {
        claudeDesktop: {
          path: '~/Library/Application Support/Claude/claude_desktop_config.json',
          json: claudeDesktopConfig,
        },
        cursor: {
          path: '~/.cursor/mcp.json',
          json: claudeDesktopConfig,  // Cursor uses the same shape
        },
        continue: {
          path: '~/.continue/config.json (under experimental.modelContextProtocolServers)',
          json: continueConfig,
        },
      },
      commandLine: `${openclawBin} mcp serve`,
    }
  })

  // POST /api/mcp/serve/verify — run `openclaw mcp serve`, send an MCP
  // `initialize` handshake over stdin, capture the server's response, then
  // close stdin to let the process exit cleanly. Returns serverInfo / capabilities
  // / tool list on success.
  app.post('/api/mcp/serve/verify', async (_req, reply) => {
    const bin = await resolveOpenclawBin()
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'openclaw-portal', version: '0.1.0' },
      },
    })
    const listMsg = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

    return new Promise<void>((resolve) => {
      let stdoutBuf = ''
      let stderrBuf = ''
      let settled = false
      const finish = (payload: any) => {
        if (settled) return
        settled = true
        reply.send(payload)
        resolve()
      }

      let child: ReturnType<typeof spawn>
      try {
        child = spawn(bin, ['mcp', 'serve'], {
          env: { ...process.env, OPENCLAW_HOME: openclawHome },
          cwd: openclawHome,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (e: any) {
        return finish({ ok: false, error: `spawn failed: ${e.message}` })
      }

      child.stdout?.on('data', chunk => {
        stdoutBuf += chunk.toString('utf8')
        parseFrames()
      })
      child.stderr?.on('data', chunk => {
        stderrBuf += chunk.toString('utf8').slice(0, 2000)
      })
      child.on('error', err => finish({ ok: false, error: err.message, stderr: stderrBuf }))
      child.on('exit', code => {
        if (!settled) {
          finish({
            ok: false,
            error: `serve exited with code ${code} before returning initialize response`,
            stdout: stdoutBuf.slice(0, 2000),
            stderr: stderrBuf,
          })
        }
      })

      const seen = new Map<number, any>()
      function parseFrames() {
        // MCP over stdio uses newline-delimited JSON-RPC messages.
        let idx: number
        while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
          const line = stdoutBuf.slice(0, idx).trim()
          stdoutBuf = stdoutBuf.slice(idx + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line)
            if (msg.id != null) seen.set(Number(msg.id), msg)
          } catch {}
        }

        const initRes = seen.get(1)
        const listRes = seen.get(2)
        if (initRes && listRes) {
          try {
            child.stdin?.end()
          } catch {}
          if (initRes.error) {
            finish({ ok: false, error: `initialize error: ${JSON.stringify(initRes.error)}`, stderr: stderrBuf })
          } else {
            finish({
              ok: true,
              serverInfo: initRes.result?.serverInfo ?? null,
              protocolVersion: initRes.result?.protocolVersion ?? null,
              capabilities: initRes.result?.capabilities ?? null,
              tools: Array.isArray(listRes.result?.tools) ? listRes.result.tools : [],
              stderr: stderrBuf || undefined,
            })
          }
        } else if (initRes && !listRes) {
          // Follow up with tools/list
          try { child.stdin?.write(listMsg + '\n') } catch {}
        }
      }

      // Send initialize and, once acknowledged, follow with initialized + tools/list
      try {
        child.stdin?.write(initMsg + '\n')
      } catch (e: any) {
        return finish({ ok: false, error: `write failed: ${e.message}` })
      }

      // Hard timeout — don't block the request longer than 6s
      setTimeout(() => {
        if (!settled) {
          try { child.kill('SIGTERM') } catch {}
          finish({
            ok: false,
            error: '6 秒内未收到 MCP 响应',
            stdout: stdoutBuf.slice(0, 1000),
            stderr: stderrBuf,
          })
        }
      }, 6000).unref()
    })
  })

  // GET /api/mcp/templates — built-in templates for common MCP servers
  app.get('/api/mcp/templates', async () => {
    return {
      templates: [
        {
          name: 'filesystem',
          description: '文件系统访问（读写指定目录）',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '${HOME}'],
          category: '本地',
        },
        {
          name: 'memory',
          description: '持久化记忆图谱（Knowledge Graph）',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-memory'],
          category: '本地',
        },
        {
          name: 'github',
          description: 'GitHub 仓库、issue、PR 操作',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
          category: '云端',
        },
        {
          name: 'sqlite',
          description: 'SQLite 数据库查询',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/tmp/example.db'],
          category: '数据',
        },
        {
          name: 'fetch',
          description: 'HTTP 请求 / 网页抓取',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-fetch'],
          category: '云端',
        },
        {
          name: 'puppeteer',
          description: '浏览器自动化（需 Chromium）',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-puppeteer'],
          category: '浏览器',
        },
      ],
    }
  })
}
