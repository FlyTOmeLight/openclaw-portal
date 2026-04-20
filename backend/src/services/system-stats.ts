import { cpus, freemem, totalmem, uptime, platform, loadavg } from 'os'
import { statfs } from 'fs/promises'

export interface SystemStats {
  cpuCount: number
  platform: string
  uptimeSeconds: number
  loadAvg: [number, number, number]
  memory: {
    totalMb: number
    freeMb: number
    usedPercent: number
  }
  disk?: {
    totalGb: number
    freeGb: number
    usedPercent: number
    mountPoint: string
  }
}

async function getDiskStats(): Promise<SystemStats['disk']> {
  const path = process.env.HOME ?? '/'
  try {
    const st = await statfs(path)
    const totalBytes = st.blocks * st.bsize
    const freeBytes = st.bfree * st.bsize
    const usedBytes = totalBytes - freeBytes
    return {
      totalGb: Math.round(totalBytes / 1024 / 1024 / 1024 * 10) / 10,
      freeGb: Math.round(freeBytes / 1024 / 1024 / 1024 * 10) / 10,
      usedPercent: Math.round((usedBytes / totalBytes) * 100),
      mountPoint: path,
    }
  } catch {}
  return undefined
}

export async function getSystemStats(): Promise<SystemStats> {
  const totalBytes = totalmem()
  const freeBytes = freemem()
  const usedBytes = totalBytes - freeBytes
  const avg = loadavg() as [number, number, number]
  return {
    cpuCount: cpus().length,
    platform: platform(),
    uptimeSeconds: Math.floor(uptime()),
    loadAvg: [
      Math.round(avg[0] * 100) / 100,
      Math.round(avg[1] * 100) / 100,
      Math.round(avg[2] * 100) / 100,
    ],
    memory: {
      totalMb: Math.round(totalBytes / 1024 / 1024),
      freeMb: Math.round(freeBytes / 1024 / 1024),
      usedPercent: Math.round((usedBytes / totalBytes) * 100),
    },
    disk: await getDiskStats(),
  }
}
