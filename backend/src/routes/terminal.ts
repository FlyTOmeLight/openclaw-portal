import type { FastifyInstance } from 'fastify'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import type { AuditLog } from '../services/audit-log.js'

// Text commands only — rejects anything that would need a real PTY (vim/top/less).
// The portal's use case is ops: `openclaw ...`, `systemctl ...`, `tail -f`, `journalctl`, etc.

interface RunMessage {
  type: 'run'
  cmd: string
  args?: string[]
  cwd?: string
}
interface SignalMessage {
  type: 'signal'
  signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL'
}
type IncomingMessage = RunMessage | SignalMessage

// Commands allowed without an explicit path. Everything else must be an absolute path
// or begin with "./" so users can't accidentally shadow PATH with a rogue binary.
const ALLOWED_COMMANDS = new Set([
  'openclaw',
  'node',
  'npm',
  'systemctl',
  'journalctl',
  'nginx',
  'ls',
  'cat',
  'tail',
  'head',
  'grep',
  'find',
  'ps',
  'df',
  'du',
  'free',
  'uptime',
  'uname',
  'hostname',
  'whoami',
  'env',
  'pwd',
  'echo',
  'date',
  'curl',
  'wget',
  'ip',
  'ss',
  'netstat',
  'lsof',
])

function isAllowedCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string') return false
  if (cmd.includes('\n') || cmd.includes('\r') || cmd.includes('\0')) return false
  if (cmd.startsWith('/') || cmd.startsWith('./')) return true
  return ALLOWED_COMMANDS.has(cmd)
}

function sanitizeArgs(args: unknown): string[] | null {
  if (!Array.isArray(args)) return []
  const clean: string[] = []
  for (const a of args) {
    if (typeof a !== 'string') return null
    if (a.includes('\0')) return null
    clean.push(a)
  }
  return clean
}

export async function terminalRoutes(app: FastifyInstance, audit?: AuditLog) {
  const handler = (socket: any) => {
    let child: ChildProcess | null = null

    const send = (type: string, payload: Record<string, any> = {}) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type, ...payload }))
      }
    }

    send('hello', {
      allowed: [...ALLOWED_COMMANDS].sort(),
      note: 'Non-interactive only. Use Ctrl+C to send SIGINT.',
    })

    socket.on('message', (data: Buffer) => {
      let msg: IncomingMessage
      try {
        msg = JSON.parse(data.toString())
      } catch {
        send('error', { message: 'Invalid JSON message' })
        return
      }

      if (msg.type === 'signal') {
        if (!child || child.killed) return
        try { child.kill(msg.signal) } catch {}
        return
      }

      if (msg.type !== 'run') {
        send('error', { message: `Unknown message type: ${(msg as any).type}` })
        return
      }

      if (child && !child.killed && child.exitCode === null) {
        send('error', { message: 'A command is already running' })
        return
      }

      const cmd = msg.cmd
      const args = sanitizeArgs(msg.args)
      if (args === null) {
        send('error', { message: 'Arguments must be strings without null bytes' })
        return
      }
      if (!isAllowedCommand(cmd)) {
        send('error', { message: `Command not allowed: ${cmd}` })
        return
      }

      send('started', { cmd, args, ts: Date.now() })
      audit?.record({
        ts: Date.now(),
        actor: 'admin',
        action: 'terminal.exec',
        target: [cmd, ...args].join(' ').slice(0, 200),
        result: 'success',
      })

      try {
        child = spawn(cmd, args, {
          cwd: msg.cwd && typeof msg.cwd === 'string' ? msg.cwd : process.env.HOME || '/',
          env: process.env,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (e: any) {
        send('error', { message: `Failed to spawn: ${e.message}` })
        child = null
        return
      }

      child.stdout?.on('data', (chunk: Buffer) => send('stdout', { data: chunk.toString('utf8') }))
      child.stderr?.on('data', (chunk: Buffer) => send('stderr', { data: chunk.toString('utf8') }))
      child.on('error', (err) => send('error', { message: err.message }))
      child.on('close', (code, signal) => {
        send('exit', { code, signal })
        child = null
      })
    })

    socket.on('close', () => {
      if (child && !child.killed) {
        try { child.kill('SIGTERM') } catch {}
        setTimeout(() => {
          if (child && !child.killed) {
            try { child.kill('SIGKILL') } catch {}
          }
        }, 2000).unref()
      }
    })
  }

  // Register both the canonical path and the /portal-prefixed path so direct
  // backend access and nginx-proxied access both work. HTTP routes can 307
  // redirect, but WebSocket upgrades cannot follow redirects.
  app.get('/api/terminal/ws', { websocket: true }, handler)
  app.get('/portal/api/terminal/ws', { websocket: true }, handler)
}
