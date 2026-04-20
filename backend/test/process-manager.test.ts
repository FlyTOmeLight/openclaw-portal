import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProcessManager } from '../src/services/process-manager.js'

const { runCliMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
}))

vi.mock('../src/services/cli-runner.js', () => ({
  runCli: runCliMock,
}))

// We mock child_process at the module level
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
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

describe('ProcessManager', () => {
  let manager: ProcessManager

  beforeEach(() => {
    vi.clearAllMocks()
    runCliMock.mockReset()
    manager = new ProcessManager({ openclawBin: 'openclaw', gatewayPort: 18789 })
  })

  it('getStatus() returns stopped when no process is running', async () => {
    // CLI 不可用时应回落到进程扫描，并在未找到进程时返回 stopped。
    runCliMock.mockRejectedValueOnce(new Error('unsupported'))
    // execSync throws when process not found
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not found') })
    const status = await manager.getStatus()
    expect(status.state).toBe('stopped')
    expect(status.pid).toBeUndefined()
  })

  it('getStatus() returns running when process found', async () => {
    // CLI 不可用时，pgrep 找到进程也应识别为 running。
    runCliMock.mockRejectedValueOnce(new Error('unsupported'))
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from('12345\n'))
    const status = await manager.getStatus()
    expect(status.state).toBe('running')
    expect(status.pid).toBe(12345)
  })

  it('getStatus() understands modern gateway status JSON', async () => {
    // 现代状态 JSON 会把 pid 放在 port.listeners 里，portal 需要能识别。
    runCliMock.mockResolvedValueOnce(JSON.stringify({
      service: { runtime: { status: 'unknown' } },
      port: { status: 'busy', listeners: [{ pid: 30889, commandLine: 'openclaw-gateway' }] },
      rpc: { ok: false, error: 'device identity required' },
    }))

    const status = await manager.getStatus()

    expect(status.state).toBe('running')
    expect(status.pid).toBe(30889)
  })

  it('getStatus() falls back to port listener pid when top-level running has no pid', async () => {
    // Kylin 的 direct-run 场景里，running=true 但顶层 pid 可能缺失。
    runCliMock.mockResolvedValueOnce(JSON.stringify({
      running: true,
      port: { status: 'busy', listeners: [{ pid: 54321, commandLine: 'openclaw gateway run --force' }] },
    }))

    const status = await manager.getStatus(true)

    expect(status.state).toBe('running')
    expect(status.pid).toBe(54321)
  })

  it('getStatus() uses pgrep when CLI reports running without any pid', async () => {
    // 如果 CLI 只能确认 running，但不给任何 pid，仍应继续走 pgrep 兜底。
    runCliMock.mockResolvedValueOnce(JSON.stringify({ running: true }))
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from('555\n'))

    const status = await manager.getStatus(true)

    expect(status.state).toBe('running')
    expect(status.pid).toBe(555)
  })

  it('start() spawns openclaw gateway run as detached process', async () => {
    // start 先看状态，CLI start 不可用时应退回 detached run。
    runCliMock
      .mockReturnValueOnce(JSON.stringify({ port: { status: 'free' } }))
      .mockReturnValueOnce('Gateway service not loaded.\nStart with: openclaw gateway install')
      .mockReturnValueOnce(JSON.stringify({ port: { status: 'busy', listeners: [{ pid: 99 }] } }))
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not found') })
    const mockChild = {
      pid: 99,
      unref: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'spawn') handler()
        return mockChild as any
      }),
    }
    vi.mocked(cp.spawn).mockReturnValue(mockChild as any)

    await manager.start()

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.openclaw/logs'), { recursive: true })
    expect(fs.openSync).toHaveBeenCalledWith(manager.logFile, expect.any(Number))
    expect(cp.spawn).toHaveBeenCalledWith(
      'openclaw',
      ['gateway', 'run', '--port', '18789'],
      expect.objectContaining({ detached: true, stdio: ['ignore', 42, 42] })
    )
    expect(mockChild.unref).toHaveBeenCalled()
  })

  it('start() throws if already running', async () => {
    // 已运行时不应重复启动。
    runCliMock.mockResolvedValueOnce(JSON.stringify({ running: true, pid: 12345 }))
    await expect(manager.start()).rejects.toThrow('already running')
  })

  it('stop() kills the process by listener pid when CLI stop is unavailable', async () => {
    // CLI stop 失败后，仍应使用 listeners 里的 pid 做 kill 兜底。
    runCliMock
      .mockReturnValueOnce(JSON.stringify({ running: true, pid: 12345 }))
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockReturnValueOnce(JSON.stringify({ running: false }))
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from(''))

    await manager.stop()

    expect(cp.execSync).toHaveBeenCalledWith('kill 12345')
  })

  it('stop() refreshes status and kills fallback pid when initial status has no pid', async () => {
    // 兼容 running=true 但首轮拿不到 pid 的 Kylin direct-run 形态。
    runCliMock
      .mockResolvedValueOnce(JSON.stringify({ running: true }))
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce(JSON.stringify({
        running: true,
        port: { status: 'busy', listeners: [{ pid: 67890 }] },
      }))
      .mockResolvedValueOnce(JSON.stringify({ running: false }))
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from(''))

    await manager.stop()

    expect(cp.execSync).toHaveBeenCalledWith('kill 67890')
  })

  it('stop() throws if not running', async () => {
    // stopped 状态下调用 stop 应直接报错。
    runCliMock.mockResolvedValueOnce(JSON.stringify({ running: false }))
    await expect(manager.stop()).rejects.toThrow('not running')
  })
})
