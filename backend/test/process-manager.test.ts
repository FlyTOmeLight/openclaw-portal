import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runCliMock, createConnectionMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
  createConnectionMock: vi.fn(),
}))

vi.mock('../src/services/cli-runner.js', () => ({
  runCli: runCliMock,
}))

vi.mock('net', () => ({
  createConnection: createConnectionMock,
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 42),
  constants: {
    O_WRONLY: 1,
    O_CREAT: 2,
    O_APPEND: 4,
  },
}))

import * as cp from 'child_process'
import * as fs from 'fs'
import { ProcessManager } from '../src/services/process-manager.js'

function mockPort(alive: () => boolean) {
  createConnectionMock.mockImplementation(() => {
    const handlers: Record<string, () => void> = {}
    const sock: any = {
      setTimeout: vi.fn(),
      once: vi.fn((event: string, cb: () => void) => {
        handlers[event] = cb
        return sock
      }),
      destroy: vi.fn(),
    }
    setImmediate(() => {
      if (alive()) handlers.connect?.()
      else handlers.error?.()
    })
    return sock
  })
}

describe('ProcessManager', () => {
  let manager: ProcessManager

  beforeEach(() => {
    vi.clearAllMocks()
    runCliMock.mockReset()
    createConnectionMock.mockReset()
    manager = new ProcessManager({ openclawBin: 'openclaw', gatewayPort: 18789 })
  })

  it('getStatus() returns stopped when gateway port is closed', async () => {
    mockPort(() => false)
    const status = await manager.getStatus()
    expect(status.state).toBe('stopped')
    expect(status.pid).toBeUndefined()
  })

  it('getStatus() returns running with pid from lsof when port is open', async () => {
    mockPort(() => true)
    vi.mocked(cp.execFileSync).mockReturnValue('30889\n' as any)
    const status = await manager.getStatus()
    expect(status.state).toBe('running')
    expect(status.pid).toBe(30889)
  })

  it('getStatus() returns running without pid when port is open but lsof/ss/pgrep all fail', async () => {
    mockPort(() => true)
    vi.mocked(cp.execFileSync).mockImplementation(() => { throw new Error('not found') })
    const status = await manager.getStatus()
    expect(status.state).toBe('running')
    expect(status.pid).toBeUndefined()
  })

  it('start() spawns openclaw gateway run --force as detached process when CLI is unavailable', async () => {
    let portAlive = false
    mockPort(() => portAlive)

    runCliMock.mockResolvedValueOnce('Gateway service not loaded.\nStart with: openclaw gateway install')
    // No systemd unit — `systemctl cat` fails, forcing the legacy fallback.
    vi.mocked(cp.execFileSync).mockImplementation((cmd: any) => {
      if (cmd === 'systemctl') throw new Error('Unit openclaw-gateway.service could not be found.')
      return '99\n' as any
    })

    const mockChild: any = {
      pid: 99,
      unref: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'spawn') {
          portAlive = true
          setImmediate(handler)
        }
        return mockChild
      }),
    }
    vi.mocked(cp.spawn).mockReturnValue(mockChild as any)

    await manager.start()

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.openclaw/logs'), { recursive: true })
    expect(fs.openSync).toHaveBeenCalledWith(manager.logFile, expect.any(Number))
    expect(cp.spawn).toHaveBeenCalledWith(
      'openclaw',
      ['gateway', 'run', '--port', '18789', '--force'],
      expect.objectContaining({ detached: true, stdio: ['ignore', 42, 42] })
    )
    expect(mockChild.unref).toHaveBeenCalled()
  })

  it('start() throws if already running', async () => {
    mockPort(() => true)
    vi.mocked(cp.execFileSync).mockReturnValue('12345\n' as any)
    await expect(manager.start()).rejects.toThrow('already running')
  })

  it('stop() throws if not running', async () => {
    mockPort(() => false)
    await expect(manager.stop()).rejects.toThrow('not running')
  })

  it('start() uses `sudo systemctl start` when the gateway systemd unit exists', async () => {
    let portAlive = false
    mockPort(() => portAlive)
    vi.mocked(cp.execFileSync).mockImplementation((cmd: any, args: any) => {
      if (cmd === 'systemctl' && args?.[0] === 'cat') return '' as any // unit exists
      if (cmd === 'sudo') { portAlive = true; return '' as any }        // systemctl start
      return '' as any
    })

    await manager.start()

    expect(cp.execFileSync).toHaveBeenCalledWith(
      'sudo', ['-n', 'systemctl', 'start', 'openclaw-gateway'], expect.any(Object),
    )
    expect(cp.spawn).not.toHaveBeenCalled()
    expect(runCliMock).not.toHaveBeenCalled()
  })

  it('stop() uses `sudo systemctl stop` when the gateway systemd unit exists', async () => {
    let portAlive = true
    mockPort(() => portAlive)
    vi.mocked(cp.execFileSync).mockImplementation((cmd: any, args: any) => {
      if (cmd === 'systemctl' && args?.[0] === 'cat') return '' as any
      if (cmd === 'sudo') { portAlive = false; return '' as any }
      return '12345\n' as any
    })

    await manager.stop()

    expect(cp.execFileSync).toHaveBeenCalledWith(
      'sudo', ['-n', 'systemctl', 'stop', 'openclaw-gateway'], expect.any(Object),
    )
  })

  it('restart() issues a single `sudo systemctl restart` when the unit exists', async () => {
    mockPort(() => true)
    vi.mocked(cp.execFileSync).mockImplementation((cmd: any, args: any) => {
      if (cmd === 'systemctl' && args?.[0] === 'cat') return '' as any
      if (cmd === 'sudo') return '' as any
      return '12345\n' as any
    })

    await manager.restart()

    expect(cp.execFileSync).toHaveBeenCalledWith(
      'sudo', ['-n', 'systemctl', 'restart', 'openclaw-gateway'], expect.any(Object),
    )
    expect(runCliMock).not.toHaveBeenCalled()
  })

  it('start() surfaces a sudoers hint when `sudo systemctl` is denied', async () => {
    mockPort(() => false)
    vi.mocked(cp.execFileSync).mockImplementation((cmd: any, args: any) => {
      if (cmd === 'systemctl' && args?.[0] === 'cat') return '' as any
      if (cmd === 'sudo') {
        const err: any = new Error('sudo: a password is required')
        err.stderr = 'sudo: a password is required'
        throw err
      }
      return '' as any
    })

    await expect(manager.start()).rejects.toThrow('sudoers')
  })
})
