export interface RequestLogEntry {
  ts: number          // epoch ms
  method: string
  url: string
  status: number
  durationMs: number
}

const MAX_ENTRIES = 100
const entries: RequestLogEntry[] = []

export function recordRequest(entry: RequestLogEntry) {
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()
}

export function getLog(): RequestLogEntry[] {
  return [...entries].reverse()   // newest first
}

export function clearLog() {
  entries.length = 0
}
