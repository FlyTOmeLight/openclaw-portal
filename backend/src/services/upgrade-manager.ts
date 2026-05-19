import { existsSync, createWriteStream } from 'fs'
import { mkdir, rm, readFile, writeFile, readdir, stat, statfs, realpath } from 'fs/promises'
import { join } from 'path'
import { spawnSync, execFileSync } from 'child_process'
import { pipeline } from 'stream/promises'

// ── Web self-upgrade for the portal ──────────────────────────────────────────
//
// A node process cannot cleanly replace its own running files and restart
// itself: a detached child shares the unit's cgroup and gets SIGTERM'd, and a
// renamed working dir makes lazy `require` mix old/new code. So the portal
// only *stages* an uploaded package, then hands off to an independent root
// transient unit (`systemd-run` → portal-upgrade-apply.sh) that does the
// stop → swap → start → health-check → auto-rollback. See the offline
// installer's Step 17 for the one-time sudoers / apply-script setup.

export type UpgradeType = 'frontend' | 'backend-dist' | 'backend-full'

export interface UpgradeManifest {
  type: UpgradeType
  version: string
  builtAt?: string
}

const VALID_TYPES: UpgradeType[] = ['frontend', 'backend-dist', 'backend-full']
const MANIFEST_NAME = 'openclaw-upgrade.json'

// systemd-run + apply-script paths must match the /etc/sudoers.d/openclaw-portal
// grant exactly — the sudoers line pins the full command, args and all.
const SYSTEMD_RUN = process.env.PORTAL_SYSTEMD_RUN ?? '/usr/bin/systemd-run'
const APPLY_SCRIPT = process.env.PORTAL_APPLY_SCRIPT ?? '/opt/openclaw-portal-apply.sh'
const TRANSIENT_UNIT = 'openclaw-portal-upgrade'

/** Reject absolute-path or parent-traversal members from a `tar -tzf` listing
 *  before extraction. A post-extraction realpath sweep additionally catches
 *  symlink escapes. */
export function validateTarEntries(entries: string[]): void {
  for (const raw of entries) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) {
      throw new Error(`升级包含绝对路径成员，已拒绝: ${entry}`)
    }
    if (entry.split('/').some(seg => seg === '..')) {
      throw new Error(`升级包含路径穿越成员，已拒绝: ${entry}`)
    }
  }
}

/** Parse and validate the in-package `openclaw-upgrade.json` manifest. */
export function parseManifest(json: string): UpgradeManifest {
  let parsed: any
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`${MANIFEST_NAME} 不是合法 JSON`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${MANIFEST_NAME} 格式错误`)
  }
  if (!VALID_TYPES.includes(parsed.type)) {
    throw new Error(`未知的升级包类型: ${parsed.type}`)
  }
  if (typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error(`${MANIFEST_NAME} 缺少 version`)
  }
  return {
    type: parsed.type,
    version: parsed.version,
    builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : undefined,
  }
}

/** A dist-only package reuses the machine's existing node_modules, so its
 *  declared dependencies must match the running install exactly. */
export function compareDeps(
  current: Record<string, string> = {},
  incoming: Record<string, string> = {},
): void {
  const ck = Object.keys(current ?? {}).sort()
  const ik = Object.keys(incoming ?? {}).sort()
  const same =
    ck.length === ik.length &&
    ck.every((k, i) => k === ik[i] && current![k] === incoming![k])
  if (!same) {
    throw new Error('此 dist 包的依赖与当前运行环境不一致，请改用完整后端包（portal-backend.tar.gz）升级')
  }
}

export interface UpgradeManagerOptions {
  backendDir: string
  frontendDir: string
  stagingDir: string
  portalPort: number
}

export interface UpgradeResult {
  ok: boolean
  action?: 'upgrade' | 'rollback'
  type?: UpgradeType
  version?: string
  message?: string
  ts?: number
}

export class UpgradeManager {
  private readonly backendDir: string
  private readonly frontendDir: string
  private readonly stagingDir: string
  private readonly portalPort: number
  private busy = false

  constructor(opts: UpgradeManagerOptions) {
    this.backendDir = opts.backendDir
    this.frontendDir = opts.frontendDir
    this.stagingDir = opts.stagingDir
    this.portalPort = opts.portalPort
  }

  private get pendingPath() { return join(this.stagingDir, 'pending.json') }
  private get resultPath() { return join(this.stagingDir, 'result.json') }

  /** True when this environment lacks the apply script — i.e. the portal was
   *  not deployed by an installer new enough to support web upgrades. */
  isSupported(): boolean {
    return existsSync(APPLY_SCRIPT)
  }

  /** An upgrade is running if the in-process lock is held or apply.sh has not
   *  yet consumed the pending marker. */
  isBusy(): boolean {
    return this.busy || existsSync(this.pendingPath)
  }

  async getCurrentVersion(): Promise<{ version: string; builtAt: string | null }> {
    let version = 'unknown'
    try {
      const pkg = JSON.parse(await readFile(join(this.backendDir, 'package.json'), 'utf-8'))
      if (typeof pkg.version === 'string') version = pkg.version
    } catch {}
    let builtAt: string | null = null
    try {
      const st = await stat(join(this.backendDir, 'dist', 'index.js'))
      builtAt = new Date(st.mtimeMs).toISOString()
    } catch {}
    return { version, builtAt }
  }

  /** Which `.bak` snapshots exist, newest-first (per the last result). */
  async rollbackInfo(): Promise<{ available: boolean; type: UpgradeType | null }> {
    const candidates: Array<[UpgradeType, string]> = [
      ['frontend', this.frontendDir + '.bak'],
      ['backend-dist', join(this.backendDir, 'dist.bak')],
      ['backend-full', this.backendDir + '.bak'],
    ]
    const present = candidates.filter(([, p]) => existsSync(p)).map(([t]) => t)
    if (present.length === 0) return { available: false, type: null }
    // Prefer the type recorded by the most recent successful upgrade.
    const last = await this.readResult()
    if (last?.type && present.includes(last.type)) return { available: true, type: last.type }
    return { available: true, type: present[present.length - 1] }
  }

  async readResult(): Promise<UpgradeResult | null> {
    try {
      return JSON.parse(await readFile(this.resultPath, 'utf-8'))
    } catch {
      return null
    }
  }

  /** Progress for the frontend to poll: in-progress (pending), or last result. */
  async getStatus(): Promise<{ state: 'idle' | 'in_progress' | 'done'; result?: UpgradeResult }> {
    if (existsSync(this.pendingPath)) return { state: 'in_progress' }
    const result = await this.readResult()
    if (result) return { state: 'done', result }
    return { state: 'idle' }
  }

  /** Stage an uploaded `.tar.gz` and hand off to the apply transient unit.
   *  Returns the detected type; `restarting` is true for backend packages. */
  async stageAndApply(
    fileStream: NodeJS.ReadableStream,
  ): Promise<{ type: UpgradeType; version: string; restarting: boolean }> {
    if (!this.isSupported()) {
      fileStream.resume()
      throw new Error('网页升级不可用：当前部署缺少升级执行脚本，请先用新版 installer 部署一次')
    }
    if (this.isBusy()) {
      fileStream.resume()
      throw new Error('已有升级任务进行中，请稍后再试')
    }
    this.busy = true
    const ts = Date.now()
    const workDir = join(this.stagingDir, String(ts))
    const pkgPath = join(workDir, 'pkg.tar.gz')
    const extractDir = join(workDir, 'extracted')
    try {
      await mkdir(extractDir, { recursive: true })
      await pipeline(fileStream, createWriteStream(pkgPath))

      // 1. List the archive — verifies integrity and screens for traversal.
      const list = spawnSync('tar', ['-tzf', pkgPath], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
      if (list.status !== 0) {
        throw new Error('升级包损坏或不是合法的 .tar.gz')
      }
      const entries = list.stdout.split('\n')
      validateTarEntries(entries)

      // 2. Disk space — extracted + .bak roughly triples the footprint.
      const pkgStat = await stat(pkgPath)
      const fs = await statfs(this.stagingDir)
      const free = fs.bavail * fs.bsize
      if (free < pkgStat.size * 8) {
        throw new Error('磁盘可用空间不足，无法安全完成升级')
      }

      // 3. Extract into a fresh empty dir; --no-same-owner avoids uid surprises.
      const extract = spawnSync('tar', ['-xzf', pkgPath, '-C', extractDir, '--no-same-owner'], { encoding: 'utf-8' })
      if (extract.status !== 0) {
        throw new Error(`升级包解压失败: ${extract.stderr || ''}`.trim())
      }
      await this.assertContained(extractDir)

      // 4. Identify the package via its manifest (not by guessing dir names).
      const manifestPath = join(extractDir, MANIFEST_NAME)
      if (!existsSync(manifestPath)) {
        throw new Error(`升级包缺少 ${MANIFEST_NAME}，无法识别类型`)
      }
      const manifest = parseManifest(await readFile(manifestPath, 'utf-8'))

      // 5. Structural + dependency checks per type.
      if (manifest.type === 'frontend') {
        if (!existsSync(join(extractDir, 'index.html'))) {
          throw new Error('前端升级包缺少 index.html')
        }
      } else {
        if (!existsSync(join(extractDir, 'dist', 'index.js'))) {
          throw new Error('后端升级包缺少 dist/index.js')
        }
        if (manifest.type === 'backend-dist') {
          const incoming = await this.readPkgDeps(join(extractDir, 'package.json'))
          const current = await this.readPkgDeps(join(this.backendDir, 'package.json'))
          compareDeps(current, incoming)
        }
        if (manifest.type === 'backend-full' && !existsSync(join(extractDir, 'node_modules'))) {
          throw new Error('完整后端包缺少 node_modules')
        }
      }

      // 6. Write the pending marker and trigger the apply transient unit.
      await writeFile(this.pendingPath, JSON.stringify({
        action: 'upgrade',
        type: manifest.type,
        version: manifest.version,
        src: extractDir,
        backendDir: this.backendDir,
        frontendDir: this.frontendDir,
        portalPort: this.portalPort,
        stagingDir: this.stagingDir,
        ts,
      }, null, 2), 'utf-8')
      this.triggerApply()

      this.cleanupOldStaging(ts).catch(() => {})
      return { type: manifest.type, version: manifest.version, restarting: manifest.type !== 'frontend' }
    } catch (err) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      await rm(this.pendingPath, { force: true }).catch(() => {})
      throw err
    } finally {
      this.busy = false
    }
  }

  /** Roll back the most recent upgrade by handing off to the apply unit. */
  async rollback(): Promise<{ type: UpgradeType; restarting: boolean }> {
    if (!this.isSupported()) {
      throw new Error('网页升级不可用：当前部署缺少升级执行脚本')
    }
    if (this.isBusy()) {
      throw new Error('已有升级任务进行中，请稍后再试')
    }
    const info = await this.rollbackInfo()
    if (!info.available || !info.type) {
      throw new Error('没有可回滚的版本')
    }
    this.busy = true
    try {
      await writeFile(this.pendingPath, JSON.stringify({
        action: 'rollback',
        type: info.type,
        backendDir: this.backendDir,
        frontendDir: this.frontendDir,
        portalPort: this.portalPort,
        stagingDir: this.stagingDir,
        ts: Date.now(),
      }, null, 2), 'utf-8')
      this.triggerApply()
      return { type: info.type, restarting: info.type !== 'frontend' }
    } catch (err) {
      await rm(this.pendingPath, { force: true }).catch(() => {})
      throw err
    } finally {
      this.busy = false
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Launch the root transient unit. The command is pinned to match the
   *  /etc/sudoers.d/openclaw-portal NOPASSWD grant byte-for-byte — all variable
   *  data travels through pending.json, never through argv. */
  private triggerApply(): void {
    try {
      execFileSync('sudo', [
        '-n', SYSTEMD_RUN,
        `--unit=${TRANSIENT_UNIT}`,
        '--collect',
        '--service-type=oneshot',
        APPLY_SCRIPT,
      ], { stdio: 'pipe', timeout: 15000 })
    } catch (err: any) {
      const detail = String(err?.stderr || err?.stdout || err?.message || '').trim()
      throw new Error(`无法启动升级任务（systemd-run 失败）: ${detail || '未知错误'}`)
    }
  }

  private async readPkgDeps(pkgPath: string): Promise<Record<string, string>> {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      return pkg.dependencies ?? {}
    } catch {
      return {}
    }
  }

  /** Every extracted path must resolve to within `root` — defeats symlink
   *  members that point outside the staging area. */
  private async assertContained(root: string): Promise<void> {
    const realRoot = await realpath(root)
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        const real = await realpath(child).catch(() => '')
        if (!real || (real !== realRoot && !real.startsWith(realRoot + '/'))) {
          throw new Error(`升级包含越界符号链接，已拒绝: ${entry.name}`)
        }
        if (entry.isDirectory()) await walk(child)
      }
    }
    await walk(root)
  }

  /** Drop staging subdirs other than the current run and the apply markers. */
  private async cleanupOldStaging(keepTs: number): Promise<void> {
    const keep = new Set(['pending.json', 'result.json', 'apply.log', String(keepTs)])
    for (const entry of await readdir(this.stagingDir, { withFileTypes: true }).catch(() => [])) {
      if (keep.has(entry.name)) continue
      if (!entry.isDirectory()) continue
      await rm(join(this.stagingDir, entry.name), { recursive: true, force: true }).catch(() => {})
    }
  }
}
