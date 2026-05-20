/**
 * SkillDepsChecker — read-only dependency scanner for installed skills.
 *
 * Four detection dimensions, each independent so a failure in one does not
 * mask the others:
 *
 *   - openclaw : does the openclaw CLI know about this skill (`skills list`)?
 *   - system   : binaries referenced by scripts/* (shebangs, bash command
 *                tokens, python `subprocess` calls). Verified with `which`.
 *   - node     : `package.json` dependencies vs `<skill>/node_modules/`.
 *   - python   : `requirements.txt` + `pyproject.toml` dependencies vs the
 *                output of `pip3 list --format=json`.
 *
 * Caching is per-skill, in-memory, default 60s TTL. `invalidate()` wipes it
 * (used by the portal "Refresh All" button). Concurrent calls for the same
 * skill share one in-flight scan via a Promise dedup map.
 *
 * The scanner is execution-only: it NEVER installs anything, NEVER runs a
 * shell, and NEVER passes user-supplied bytes through a shell interpreter.
 * Every spawn uses `execFile` (via `execFileSafe`) with an args array;
 * package / binary names are validated against `SAFE_NAME` before being
 * passed as args.
 *
 * Dependency injection: the `exec` function can be swapped out for tests
 * (see `ExecFn`). The default impl reuses the project's `execFileSafe` from
 * cli-runner, which keeps the unit tests hermetic.
 */

import { existsSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { join, extname } from 'path'
import { SkillManager, type Skill } from './skill-manager.js'
import { execFileSafe } from './cli-runner.js'

// ---- Types ----------------------------------------------------------------

export interface DepItem {
  name: string
  /** Where the declaration was found: 'package.json', 'requirements.txt', 'shebang', 'subprocess.run', ... */
  declaredIn?: string
  present: boolean
  /** Free-text reason / version (e.g. "1.22.0", "command not found"). */
  detail?: string
}

export interface DepCategoryResult {
  declared: number
  missing: number
  present: number
  items: DepItem[]
}

export interface SkillDepsReport {
  name: string
  agent: string | null
  path: string
  scannedAt: number
  openclaw: DepCategoryResult
  system: DepCategoryResult
  node: DepCategoryResult
  python: DepCategoryResult
  totalMissing: number
}

export interface SkillHealthSummary {
  name: string
  agent: string | null
  totalDeclared: number
  totalMissing: number
  status: 'ok' | 'missing' | 'unknown'
  scannedAt: number
}

/** Minimal shape for any subprocess runner — keeps the checker testable. */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>

interface Options {
  /** Cache TTL in milliseconds (default 60_000). */
  cacheTtlMs?: number
}

// ---- Validation -----------------------------------------------------------

/**
 * Safe-name regex for package / binary names. Matches PEP 503-ish Python
 * package names, npm scoped names, and typical binary filenames. Used as a
 * defence-in-depth filter even though we never pass these via a shell.
 */
const SAFE_NAME = /^[A-Za-z0-9._@/+-]+$/

/** Looser filter for heuristic token extraction — binary filenames don't
 *  include `/` or `@`, so the heuristic stage uses a tighter pattern. */
const SAFE_BIN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/** Known PEP 508 env-marker variables — used to distinguish a real marker
 *  (`requests; python_version >= "3.8"`) from a shell-injection attempt
 *  (`evil;rm -rf /`). */
const PEP508_MARKER_HINT =
  /\b(?:python_version|python_full_version|sys_platform|platform_(?:system|machine|release|version|python_implementation)|implementation_name|implementation_version|os_name|extra)\b/

/** Shell builtins / common keywords that should NOT be reported as deps. */
const SHELL_NOISE = new Set([
  // builtins
  'cd', 'echo', 'set', 'unset', 'export', 'local', 'declare', 'readonly',
  'eval', 'exec', 'exit', 'return', 'source', 'shift', 'test', 'true', 'false',
  'alias', 'unalias', 'command', 'type', 'history', 'ulimit', 'pwd', 'umask',
  'wait', 'trap', 'break', 'continue', 'read', 'printf', 'shopt',
  // syntax keywords
  'if', 'then', 'else', 'elif', 'fi', 'while', 'do', 'done', 'for', 'in',
  'case', 'esac', 'function', 'select', 'time', 'until',
  // shells themselves — not meaningful deps in a Kylin deployment
  'bash', 'sh', 'zsh', 'ksh', 'dash', 'fish',
])

// ---- Helpers --------------------------------------------------------------

function mkResult(items: DepItem[]): DepCategoryResult {
  const present = items.filter(i => i.present).length
  return {
    declared: items.length,
    missing: items.length - present,
    present,
    items,
  }
}

function emptyResult(): DepCategoryResult {
  return { declared: 0, missing: 0, present: 0, items: [] }
}

/** Walk a directory tree up to a depth, returning every file path. */
async function walkFiles(root: string, maxDepth: number): Promise<string[]> {
  if (!existsSync(root)) return []
  const out: string[] = []
  async function recur(dir: string, depth: number) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await recur(full, depth + 1)
      else out.push(full)
    }
  }
  await recur(root, 0)
  return out
}

// ---- Scanner --------------------------------------------------------------

export class SkillDepsChecker {
  private cache = new Map<string, { result: SkillDepsReport; expires: number }>()
  private inflight = new Map<string, Promise<SkillDepsReport>>()
  private cacheTtlMs: number

  constructor(
    private readonly skillManager: SkillManager,
    private readonly openclawBin: string,
    private readonly exec: ExecFn = (cmd, args, opts) =>
      execFileSafe(cmd, args, { timeoutMs: opts?.timeoutMs }),
    opts: Options = {},
  ) {
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000
  }

  /** Invalidate every cached scan result (Refresh All button). */
  invalidate(): void {
    this.cache.clear()
  }

  async checkSkill(name: string, agent: string | null): Promise<SkillDepsReport> {
    const key = `${agent ?? '_global'}/${name}`
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.result
    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = (async () => {
      const skill = await this.findSkill(name, agent)
      if (!skill) throw new Error(`Skill not found: ${agent ?? '_global'}/${name}`)
      const [openclaw, system, node, python] = await Promise.all([
        this.openclawCheck(skill).catch(() => emptyResult()),
        this.systemCheck(skill).catch(() => emptyResult()),
        this.nodeCheck(skill).catch(() => emptyResult()),
        this.pythonCheck(skill).catch(() => emptyResult()),
      ])
      const result: SkillDepsReport = {
        name: skill.name,
        agent: skill.agent,
        path: skill.path,
        scannedAt: Date.now(),
        openclaw,
        system,
        node,
        python,
        totalMissing: openclaw.missing + system.missing + node.missing + python.missing,
      }
      this.cache.set(key, { result, expires: Date.now() + this.cacheTtlMs })
      return result
    })()

    this.inflight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(key)
    }
  }

  async healthOverview(): Promise<SkillHealthSummary[]> {
    const skills = await this.skillManager.listSkills()
    const reports = await Promise.all(
      skills.map(async s => {
        try {
          return await this.checkSkill(s.name, s.agent)
        } catch {
          return null
        }
      }),
    )
    return reports.map((r, i) => {
      const skill = skills[i]
      if (!r) {
        return {
          name: skill.name,
          agent: skill.agent,
          totalDeclared: 0,
          totalMissing: 0,
          status: 'unknown' as const,
          scannedAt: Date.now(),
        }
      }
      const totalDeclared =
        r.openclaw.declared + r.system.declared + r.node.declared + r.python.declared
      let status: 'ok' | 'missing' | 'unknown' = 'ok'
      if (totalDeclared === 0) status = 'unknown'
      if (r.totalMissing > 0) status = 'missing'
      return {
        name: r.name,
        agent: r.agent,
        totalDeclared,
        totalMissing: r.totalMissing,
        status,
        scannedAt: r.scannedAt,
      }
    })
  }

  // ---- Skill lookup -------------------------------------------------------

  private async findSkill(name: string, agent: string | null): Promise<Skill | null> {
    const all = await this.skillManager.listSkills()
    return all.find(s => s.name === name && s.agent === agent) ?? null
  }

  // ---- Dimension: openclaw CLI awareness ----------------------------------

  private async openclawCheck(skill: Skill): Promise<DepCategoryResult> {
    // Prefer the JSON form if the CLI supports it; fall back to plain output.
    const json = await this.exec(this.openclawBin, ['skills', 'list', '--json'], { timeoutMs: 5000 })
    if (json.code === 0 && json.stdout.trim()) {
      try {
        const arr = JSON.parse(json.stdout) as Array<{ name?: string; agent?: string | null }>
        if (Array.isArray(arr)) {
          const known = arr.some(
            s => s?.name === skill.name && (s?.agent ?? null) === skill.agent,
          )
          return mkResult([
            {
              name: skill.name,
              declaredIn: 'openclaw skills list',
              present: known,
              detail: known ? 'recognised by openclaw CLI' : 'not listed by openclaw CLI',
            },
          ])
        }
      } catch {
        /* fall through to plain output */
      }
    }
    const plain = await this.exec(this.openclawBin, ['skills', 'list'], { timeoutMs: 5000 })
    if (plain.code === 0) {
      const safe = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const known = new RegExp(`(^|\\s)${safe}(\\s|$)`, 'm').test(plain.stdout)
      return mkResult([
        { name: skill.name, declaredIn: 'openclaw skills list', present: known },
      ])
    }
    // CLI itself failed → no opinion (declared/missing both 0).
    return emptyResult()
  }

  // ---- Dimension: Node (package.json + node_modules) ----------------------

  private async nodeCheck(skill: Skill): Promise<DepCategoryResult> {
    const pkgPath = join(skill.path, 'package.json')
    if (!existsSync(pkgPath)) return emptyResult()
    let pkg: { dependencies?: Record<string, string> }
    try {
      pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
    } catch {
      return emptyResult()
    }
    const deps = pkg.dependencies ?? {}
    const items: DepItem[] = []
    for (const dep of Object.keys(deps)) {
      if (!SAFE_NAME.test(dep)) continue
      // node_modules/<scope>/<pkg> for scoped, node_modules/<pkg> otherwise.
      // existsSync handles the slash naturally.
      const installed = existsSync(join(skill.path, 'node_modules', dep, 'package.json'))
      items.push({
        name: dep,
        declaredIn: 'package.json',
        present: installed,
        detail: installed ? undefined : 'not in node_modules',
      })
    }
    return mkResult(items)
  }

  // ---- Dimension: Python (requirements.txt + pyproject.toml) --------------

  private async pythonCheck(skill: Skill): Promise<DepCategoryResult> {
    const declared = new Map<string, string>() // name(lower) → declaredIn
    const reqPath = join(skill.path, 'requirements.txt')
    if (existsSync(reqPath)) {
      const text = await readFile(reqPath, 'utf-8')
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const beforeComment = line.split('#')[0].trim()
        // PEP 508: a `;` separates the dep from an env marker. Real markers
        // mention one of a fixed set of variables. If a `;` shows up but
        // there's no marker hint after it, it's far more likely to be a shell
        // injection attempt (e.g. `evil;rm -rf /`) than a half-written
        // marker — reject the whole line.
        const semiIdx = beforeComment.indexOf(';')
        if (semiIdx >= 0) {
          const after = beforeComment.slice(semiIdx + 1)
          if (!PEP508_MARKER_HINT.test(after)) continue
        }
        // Strip version specifiers and env markers.
        const name = beforeComment.split(/[<>=!~;\s]/)[0].trim()
        if (!name || !SAFE_NAME.test(name)) continue
        declared.set(name.toLowerCase(), 'requirements.txt')
      }
    }
    const projPath = join(skill.path, 'pyproject.toml')
    if (existsSync(projPath)) {
      const text = await readFile(projPath, 'utf-8')
      // Minimal toml parsing — pull "name" entries from a `dependencies = [...]`
      // block. A real toml parser would be safer but the heuristic covers the
      // 90% case (PEP 621 declarations).
      const blockMatch = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)
      if (blockMatch) {
        const block = blockMatch[1]
        const re = /["']([^"']+)["']/g
        let m: RegExpExecArray | null
        while ((m = re.exec(block)) !== null) {
          const name = m[1].split(/[<>=!~;\s]/)[0].trim()
          if (name && SAFE_NAME.test(name)) {
            declared.set(name.toLowerCase(), 'pyproject.toml')
          }
        }
      }
    }
    if (declared.size === 0) return emptyResult()

    // One pip3 list call gives us every installed package — much cheaper than
    // `pip3 show <pkg>` per dependency. We tolerate either non-zero exit or
    // unparseable JSON by treating the install set as empty (everything missing).
    const installed = new Set<string>()
    const out = await this.exec('pip3', ['list', '--format=json'], { timeoutMs: 8000 })
    if (out.code === 0) {
      try {
        const arr = JSON.parse(out.stdout) as Array<{ name?: string }>
        if (Array.isArray(arr)) for (const p of arr) if (p?.name) installed.add(p.name.toLowerCase())
      } catch {
        /* leave installed empty */
      }
    }

    const items: DepItem[] = []
    for (const [lower, declaredIn] of declared) {
      const present = installed.has(lower)
      items.push({
        name: lower,
        declaredIn,
        present,
        detail: present ? undefined : 'not in pip3 list',
      })
    }
    return mkResult(items)
  }

  // ---- Dimension: system binaries (heuristic) -----------------------------

  private async systemCheck(skill: Skill): Promise<DepCategoryResult> {
    const candidates = new Map<string, string>() // name → declaredIn
    const files = await walkFiles(skill.path, 4)
    for (const file of files) {
      const ext = extname(file).toLowerCase()
      if (!['.sh', '.bash', '.py'].includes(ext)) continue
      let content = ''
      try { content = await readFile(file, 'utf-8') } catch { continue }
      this.extractBinsFromFile(content, ext, candidates)
    }
    if (candidates.size === 0) return emptyResult()

    // Verify each candidate with `which` in parallel.
    const items: DepItem[] = []
    await Promise.all(
      [...candidates.entries()].map(async ([bin, declaredIn]) => {
        if (!SAFE_BIN_TOKEN.test(bin)) return
        const r = await this.exec('which', [bin], { timeoutMs: 3000 })
        items.push({
          name: bin,
          declaredIn,
          present: r.code === 0 && r.stdout.trim().length > 0,
          detail: r.code === 0 ? r.stdout.trim() : 'not on PATH',
        })
      }),
    )
    return mkResult(items)
  }

  /** Extract candidate binary names from one file's contents. */
  private extractBinsFromFile(text: string, ext: string, out: Map<string, string>) {
    // 1. Shebang line.
    const shebang = text.split('\n', 1)[0] ?? ''
    if (shebang.startsWith('#!')) {
      const after = shebang.slice(2).trim()
      let bin = ''
      // /usr/bin/env <interp>  vs  /usr/bin/python3
      if (after.startsWith('/usr/bin/env') || after.startsWith('env ')) {
        bin = after.replace(/^\/usr\/bin\/env\s+|^env\s+/, '').split(/\s+/)[0] ?? ''
      } else {
        bin = (after.split(/\s+/)[0] ?? '').split('/').pop() ?? ''
      }
      if (bin && !SHELL_NOISE.has(bin) && SAFE_BIN_TOKEN.test(bin)) {
        out.set(bin, out.get(bin) ?? 'shebang')
      }
    }

    if (ext === '.sh' || ext === '.bash') {
      // Split into statement chunks on common shell separators and take the
      // first word of each. Drop variable assignments and quoted noise.
      for (const stmt of text.split(/[\n;]|\|\|?|&&/)) {
        const trimmed = stmt.replace(/^\s+/, '')
        if (!trimmed || trimmed.startsWith('#')) continue
        const first = trimmed.split(/\s+/)[0] ?? ''
        if (!first || /=/.test(first) || first.startsWith('"') || first.startsWith("'")) continue
        const cleaned = first.replace(/[`$(){}]/g, '')
        if (!cleaned || SHELL_NOISE.has(cleaned)) continue
        if (!SAFE_BIN_TOKEN.test(cleaned)) continue
        out.set(cleaned, out.get(cleaned) ?? 'shell script')
      }
    } else if (ext === '.py') {
      // subprocess.run(["pandoc", ...]) and friends.
      const re = /subprocess\.(?:run|call|check_output|check_call|Popen)\s*\(\s*\[\s*["']([^"']+)["']/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const bin = m[1]
        if (SHELL_NOISE.has(bin)) continue
        if (!SAFE_BIN_TOKEN.test(bin)) continue
        out.set(bin, out.get(bin) ?? 'subprocess.run')
      }
    }
  }
}
