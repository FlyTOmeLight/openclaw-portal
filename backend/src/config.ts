import { homedir } from 'os'
import { join } from 'path'

export const config = {
  portalPort: parseInt(process.env.PORTAL_PORT ?? '18800', 10),
  gatewayPort: parseInt(process.env.GATEWAY_PORT ?? '18789', 10),
  openclawHome: process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw'),
  openclawBin: process.env.OPENCLAW_BIN ?? 'openclaw',
  frontendDist: process.env.FRONTEND_DIST ?? join(import.meta.dirname, '../../frontend/dist'),
} as const

export type Config = typeof config
