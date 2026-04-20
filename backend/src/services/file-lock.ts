import { writeFile, rename } from 'fs/promises'
import { randomBytes } from 'crypto'
import { resolve } from 'path'

/**
 * Path-keyed serialization queue. Multiple services writing to the same
 * config file (e.g. channel-manager + config-manager both writing
 * ~/.openclaw/openclaw.json) serialize through a shared promise chain keyed
 * by the absolute path — preventing read-modify-write races across services.
 */
const queues = new Map<string, Promise<unknown>>()

export function serializePath<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(path)
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(key, next.catch(() => undefined))
  return next
}

/**
 * Atomic write via tempfile + rename. Callers should wrap in serializePath
 * when there are concurrent writers to the same file.
 */
export async function atomicWriteFile(path: string, payload: string): Promise<void> {
  const tmpPath = `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, payload, 'utf-8')
  await rename(tmpPath, path)
}
