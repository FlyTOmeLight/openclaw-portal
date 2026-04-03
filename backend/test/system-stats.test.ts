import { describe, it, expect, vi } from 'vitest'
import { getSystemStats } from '../src/services/system-stats.js'

describe('getSystemStats', () => {
  it('returns memory stats with totalMb and freeMb', async () => {
    const stats = await getSystemStats()
    expect(stats.memory.totalMb).toBeGreaterThan(0)
    expect(stats.memory.freeMb).toBeGreaterThan(0)
    expect(stats.memory.freeMb).toBeLessThanOrEqual(stats.memory.totalMb)
  })

  it('returns cpuCount greater than 0', async () => {
    const stats = await getSystemStats()
    expect(stats.cpuCount).toBeGreaterThan(0)
  })

  it('returns platform string', async () => {
    const stats = await getSystemStats()
    expect(typeof stats.platform).toBe('string')
    expect(stats.platform.length).toBeGreaterThan(0)
  })

  it('returns uptimeSeconds greater than 0', async () => {
    const stats = await getSystemStats()
    expect(stats.uptimeSeconds).toBeGreaterThan(0)
  })
})
