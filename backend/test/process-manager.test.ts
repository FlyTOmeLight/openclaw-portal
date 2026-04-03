import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProcessManager, type ProcessStatus } from '../src/services/process-manager.js'

// We mock child_process at the module level
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}))

import * as cp from 'child_process'

describe('ProcessManager', () => {
  let manager: ProcessManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new ProcessManager({ openclawBin: 'openclaw', gatewayPort: 18789 })
  })

  it('getStatus() returns stopped when no process is running', async () => {
    // execSync throws when process not found
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not found') })
    const status = await manager.getStatus()
    expect(status.state).toBe('stopped')
    expect(status.pid).toBeUndefined()
  })

  it('getStatus() returns running when process found', async () => {
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from('12345\n'))
    const status = await manager.getStatus()
    expect(status.state).toBe('running')
    expect(status.pid).toBe(12345)
  })

  it('start() spawns openclaw gateway run as detached process', async () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not found') })
    const mockChild = { pid: 99, unref: vi.fn() }
    vi.mocked(cp.spawn).mockReturnValue(mockChild as any)

    await manager.start()

    expect(cp.spawn).toHaveBeenCalledWith(
      'openclaw',
      ['gateway', 'run'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(mockChild.unref).toHaveBeenCalled()
  })

  it('start() throws if already running', async () => {
    vi.mocked(cp.execSync).mockReturnValue(Buffer.from('12345\n'))
    await expect(manager.start()).rejects.toThrow('already running')
  })

  it('stop() kills the process by pid', async () => {
    vi.mocked(cp.execSync)
      .mockReturnValueOnce(Buffer.from('12345\n'))  // getStatus call
      .mockReturnValueOnce(Buffer.from(''))         // kill call

    await manager.stop()

    expect(cp.execSync).toHaveBeenCalledWith('kill 12345')
  })

  it('stop() throws if not running', async () => {
    vi.mocked(cp.execSync).mockImplementation(() => { throw new Error('not found') })
    await expect(manager.stop()).rejects.toThrow('not running')
  })
})
