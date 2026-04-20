import { homedir } from 'os'
import { join } from 'path'

// Gateway and portal co-locate on the same host. Defaults to loopback for the
// trusted-proxy security model; override via env only if you know what you're
// doing (e.g. running Gateway in a sidecar on a local-only network namespace).
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? '127.0.0.1'

export const config = {
  portalPort: parseInt(process.env.PORTAL_PORT ?? '18800', 10),
  gatewayPort: parseInt(process.env.GATEWAY_PORT ?? '18789', 10),
  gatewayHost: GATEWAY_HOST,
  openclawHome: process.env.OPENCLAW_HOME ?? join(homedir(), '.openclaw'),
  openclawBin: process.env.OPENCLAW_BIN ?? 'openclaw',
  frontendDist: process.env.FRONTEND_DIST ?? join(import.meta.dirname, '../../frontend/dist'),
} as const

export function gatewayHttpBase(port: number = config.gatewayPort): string {
  return `http://${config.gatewayHost}:${port}`
}

export function gatewayWsBase(port: number = config.gatewayPort): string {
  return `ws://${config.gatewayHost}:${port}`
}

export function portalHttpBase(port: number = config.portalPort): string {
  return `http://${config.gatewayHost}:${port}`
}

export type Config = typeof config
