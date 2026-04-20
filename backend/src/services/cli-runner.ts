import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface CliLogEntry {
  id: number
  ts: number          // epoch ms
  cmd: string         // display: "openclaw agents add foo"
  bin: string
  args: string[]
  exitCode: number    // 0 = success
  stdout: string
  stderr: string
  durationMs: number
}

const MAX_ENTRIES = 200
let nextId = 1
const entries: CliLogEntry[] = []

export function getCommandLog(): CliLogEntry[] {
  return [...entries].reverse()
}

export function clearCommandLog() {
  entries.length = 0
}

/**
 * Run an openclaw CLI command and record it in the command log.
 * Throws on non-zero exit (same as execFileSync).
 */
export async function runCli(
  bin: string,
  args: string[],
  opts: { encoding?: BufferEncoding; timeout?: number; silent?: boolean } = {},
): Promise<string> {
  const t0 = Date.now()
  let stdout = ''
  let stderr = ''
  let exitCode = 0

  // Display name: strip full path, show just "openclaw"
  const binName = bin.split('/').pop() ?? bin
  const cmd = [binName, ...args].join(' ')

  try {
    const result = await execFileAsync(bin, args, {
      encoding: opts.encoding ?? 'utf-8',
      timeout: opts.timeout ?? 15000,
      env: { ...process.env, OPENCLAW_LOG_LEVEL: process.env.OPENCLAW_LOG_LEVEL ?? 'warn' },
    })
    stdout = result.stdout as string
  } catch (e: any) {
    exitCode = e.code ?? e.status ?? 1
    stdout = e.stdout?.toString() ?? ''
    stderr = e.stderr?.toString() ?? e.message ?? ''
    if (!opts.silent) {
      const entry: CliLogEntry = {
        id: nextId++,
        ts: Date.now(),
        cmd,
        bin,
        args,
        exitCode,
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 2000),
        durationMs: Date.now() - t0,
      }
      entries.push(entry)
      if (entries.length > MAX_ENTRIES) entries.shift()
    }
    throw e
  }

  if (!opts.silent) {
    const entry: CliLogEntry = {
      id: nextId++,
      ts: Date.now(),
      cmd,
      bin,
      args,
      exitCode: 0,
      stdout: stdout.slice(0, 2000),
      stderr: '',
      durationMs: Date.now() - t0,
    }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.shift()
  }

  return stdout
}
