import type { FastifyInstance } from 'fastify'
import * as pty from 'node-pty'
import type { AuditLog } from '../services/audit-log.js'
import { existsSync } from 'fs'

// Full PTY-backed terminal. Spawns the user's $SHELL (fallback /bin/bash, /bin/sh)
// with a real pseudo-terminal so interactive programs (vim, top, htop, less,
// sudo password prompts, ssh, openclaw repls, etc.) work end-to-end.
//
// Trust boundary: only loopback origin + nginx-forwarded admin identity may
// reach this endpoint. The portal is the *operator* shell, not a multi-tenant
// surface. Audit log captures session start/end + first 200 chars of input
// per command line submission.

interface ResizeMessage { type: 'resize'; cols: number; rows: number }
interface InputMessage  { type: 'input';  data: string }
interface SignalMessage { type: 'signal'; signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' }
type IncomingMessage = ResizeMessage | InputMessage | SignalMessage

function pickShell(): string {
  const candidates = [
    process.env.SHELL,
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/zsh',
    '/bin/sh',
  ].filter((c): c is string => typeof c === 'string' && !!c)
  for (const c of candidates) {
    try { if (existsSync(c)) return c } catch {}
  }
  return '/bin/sh'
}

export async function terminalRoutes(app: FastifyInstance, audit?: AuditLog) {
  const handler = (socket: any) => {
    const shell = pickShell()
    const cwd = process.env.HOME || '/'
    const startedAt = Date.now()

    let term: pty.IPty | null = null
    try {
      term = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 30,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: process.env.LANG || 'en_US.UTF-8',
        },
      })
    } catch (e: any) {
      try {
        socket.send(JSON.stringify({ type: 'error', message: `Failed to spawn shell: ${e.message}` }))
      } catch {}
      try { socket.close() } catch {}
      return
    }

    audit?.record({
      ts: startedAt,
      actor: 'admin',
      action: 'terminal.session.open',
      target: `${shell} pid=${term.pid}`,
      result: 'success',
    })

    const send = (type: string, payload: Record<string, any> = {}) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type, ...payload }))
      }
    }

    send('hello', {
      shell,
      pid: term.pid,
      cols: 100,
      rows: 30,
      note: 'Full PTY shell. Interactive programs (vim/top/less) supported.',
    })

    term.onData(data => send('data', { data }))
    term.onExit(({ exitCode, signal }) => {
      send('exit', { code: exitCode, signal: signal ?? null })
      try { socket.close() } catch {}
    })

    // Buffer accumulating user keystrokes between newlines so audit captures
    // command lines, not individual keystrokes.
    let inputBuffer = ''

    socket.on('message', (data: Buffer) => {
      let msg: IncomingMessage
      try {
        msg = JSON.parse(data.toString())
      } catch {
        send('error', { message: 'Invalid JSON message' })
        return
      }

      if (msg.type === 'input') {
        if (typeof msg.data !== 'string' || !term) return
        try {
          term.write(msg.data)
        } catch (e: any) {
          send('error', { message: `write failed: ${e.message}` })
          return
        }
        inputBuffer += msg.data
        // Audit on Enter — extract the typed line, strip trailing newline + control chars.
        let nl = inputBuffer.indexOf('\r')
        if (nl < 0) nl = inputBuffer.indexOf('\n')
        if (nl >= 0) {
          const line = inputBuffer.slice(0, nl).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim()
          inputBuffer = inputBuffer.slice(nl + 1)
          if (line) {
            audit?.record({
              ts: Date.now(),
              actor: 'admin',
              action: 'terminal.exec',
              target: line.slice(0, 200),
              result: 'success',
            })
          }
        }
        return
      }

      if (msg.type === 'resize') {
        const cols = Math.max(2, Math.min(500, Math.floor(Number(msg.cols) || 80)))
        const rows = Math.max(2, Math.min(200, Math.floor(Number(msg.rows) || 24)))
        try { term?.resize(cols, rows) } catch {}
        return
      }

      if (msg.type === 'signal') {
        if (!term) return
        try { term.kill(msg.signal) } catch {}
        return
      }

      send('error', { message: `Unknown message type: ${(msg as any).type}` })
    })

    socket.on('close', () => {
      if (term) {
        try { term.kill('SIGHUP') } catch {}
        const t = term
        setTimeout(() => {
          try { t.kill('SIGKILL') } catch {}
        }, 2000).unref()
        term = null
      }
      audit?.record({
        ts: Date.now(),
        actor: 'admin',
        action: 'terminal.session.close',
        target: `${shell} duration=${Math.floor((Date.now() - startedAt) / 1000)}s`,
        result: 'success',
      })
    })
  }

  app.get('/api/terminal/ws', { websocket: true }, handler)
  app.get('/portal/api/terminal/ws', { websocket: true }, handler)
}
