import { cpus, freemem, totalmem, uptime, platform } from 'os'

export interface SystemStats {
  cpuCount: number
  platform: string
  uptimeSeconds: number
  memory: {
    totalMb: number
    freeMb: number
    usedPercent: number
  }
}

export async function getSystemStats(): Promise<SystemStats> {
  const totalBytes = totalmem()
  const freeBytes = freemem()
  const usedBytes = totalBytes - freeBytes
  return {
    cpuCount: cpus().length,
    platform: platform(),
    uptimeSeconds: Math.floor(uptime()),
    memory: {
      totalMb: Math.round(totalBytes / 1024 / 1024),
      freeMb: Math.round(freeBytes / 1024 / 1024),
      usedPercent: Math.round((usedBytes / totalBytes) * 100),
    },
  }
}
