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

/**
 * Non-throwing variant of {@link runCli}: returns the captured stdout/stderr
 * plus the numeric exit code instead of throwing on non-zero. Intended for
 * read-only probes (`which`, `pip3 list`, `openclaw skills list`) where a
 * non-zero exit is a normal answer ("not installed") rather than an error.
 *
 * Does NOT touch the command log — these probes are noisy and would drown
 * out the interesting CLI operations users actually triggered.
 */
export async function execFileSafe(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const r = await execFileAsync(bin, args, {
      encoding: 'utf-8',
      timeout: opts.timeoutMs ?? 5000,
    })
    return { stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''), code: 0 }
  } catch (e: any) {
    return {
      stdout: String(e?.stdout ?? ''),
      stderr: String(e?.stderr ?? e?.message ?? ''),
      // execFile callback puts the exit code on `code` (string like "ENOENT")
      // OR `status` (number). Map non-numeric to 1.
      code: typeof e?.code === 'number' ? e.code : (typeof e?.status === 'number' ? e.status : 1),
    }
  }
}
