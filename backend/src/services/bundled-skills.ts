import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { realpathSync } from 'fs'
import { spawnSync, execFileSync } from 'child_process'

export interface InstallOption {
  id: string
  kind: 'brew' | 'apt' | 'npm' | 'pip' | 'cargo' | 'manual' | string
  formula?: string
  package?: string
  bins?: string[]
  label: string
  url?: string
}

export interface BundledSkill {
  name: string
  description: string
  emoji: string
  homepage?: string
  os?: string[]
  requiredBins: string[]
  missingBins: string[]
  install: InstallOption[]
  status: 'ready' | 'needs-setup' | 'unsupported-os'
}

/** Locate the openclaw bundled skills directory via the openclaw binary path. */
function findBundledSkillsDir(openclawBin: string): string | null {
  try {
    // Resolve the real path of the openclaw binary (follow symlinks)
    let binPath: string
    try {
      binPath = realpathSync(execFileSync('which', [openclawBin], { encoding: 'utf-8' }).trim())
    } catch {
      binPath = realpathSync(openclawBin)
    }
    // Binary lives at e.g. /opt/homebrew/lib/node_modules/openclaw/openclaw.mjs
    // Skills are at the same package root /…/openclaw/skills
    const skillsDir = join(dirname(binPath), 'skills')
    if (existsSync(skillsDir)) return skillsDir
    return null
  } catch {
    return null
  }
}

/** Extract the openclaw metadata block from a SKILL.md frontmatter string. */
function parseSkillMd(content: string): {
  name: string
  description: string
  homepage?: string
  emoji: string
  os?: string[]
  requiredBins: string[]
  install: InstallOption[]
} {
  // Extract frontmatter between first two ---
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = fmMatch?.[1] ?? ''

  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const description = fm.match(/^description:\s*([\s\S]*?)(?=\n\w|\n---)/m)?.[1]
    ?.trim().replace(/^["']|["']$/g, '') ?? ''
  const homepage = fm.match(/^homepage:\s*(.+)$/m)?.[1]?.trim() ?? undefined

  // Find the openclaw metadata block (it's a JSON5-ish object after "metadata:")
  const ocMatch = fm.match(/"openclaw"\s*:\s*\{([\s\S]*?)\}\s*[,\n]/)
  const ocBlock = ocMatch?.[0] ?? ''

  // emoji
  const emoji = ocBlock.match(/"emoji"\s*:\s*"([^"]+)"/)
    ?.[1] ?? '⚡'

  // os array
  let os: string[] | undefined
  const osMatch = ocBlock.match(/"os"\s*:\s*\[([^\]]+)\]/)
  if (osMatch) {
    os = osMatch[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean)
  }

  // requires.bins
  let requiredBins: string[] = []
  const binsMatch = ocBlock.match(/"requires"\s*:\s*\{[^}]*"bins"\s*:\s*\[([^\]]+)\]/)
  if (binsMatch) {
    requiredBins = binsMatch[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean)
  }

  // install array — extract each object between { } inside the "install": [...] block
  const install: InstallOption[] = []
  const installBlockMatch = ocBlock.match(/"install"\s*:\s*\[([\s\S]*?)\]\s*[,\n]/)
  if (installBlockMatch) {
    const block = installBlockMatch[1]
    // Split on }, { boundaries
    const items = block.split(/\},\s*\{/)
    for (const item of items) {
      const id      = item.match(/"id"\s*:\s*"([^"]+)"/)    ?.[1] ?? ''
      const kind    = item.match(/"kind"\s*:\s*"([^"]+)"/)  ?.[1] ?? 'manual'
      const formula = item.match(/"formula"\s*:\s*"([^"]+)"/)    ?.[1]
      const pkg     = item.match(/"package"\s*:\s*"([^"]+)"/)    ?.[1]
      const label   = item.match(/"label"\s*:\s*"([^"]+)"/)      ?.[1] ?? kind
      const url     = item.match(/"url"\s*:\s*"([^"]+)"/)        ?.[1]
      const binsM   = item.match(/"bins"\s*:\s*\[([^\]]+)\]/)
      const bins    = binsM
        ? binsM[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean)
        : undefined
      if (id || kind !== 'manual') install.push({ id, kind, formula, package: pkg, bins, label, url })
    }
  }

  return { name, description, homepage, emoji, os, requiredBins, install }
}

function checkBin(bin: string): boolean {
  try {
    const result = spawnSync('which', [bin], { encoding: 'utf-8', timeout: 2000 })
    return result.status === 0 && !!result.stdout.trim()
  } catch {
    return false
  }
}

function currentOs(): string {
  const p = process.platform
  if (p === 'darwin') return 'darwin'
  if (p === 'linux') return 'linux'
  if (p === 'win32') return 'windows'
  return p
}

export class BundledSkillsService {
  private skillsDir: string | null

  constructor(openclawBin: string) {
    this.skillsDir = findBundledSkillsDir(openclawBin)
  }

  get bundledSkillsDir(): string | null {
    return this.skillsDir
  }

  async list(): Promise<BundledSkill[]> {
    if (!this.skillsDir || !existsSync(this.skillsDir)) return []

    const entries = await readdir(this.skillsDir, { withFileTypes: true })
    const skills: BundledSkill[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = join(this.skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      try {
        const content = await readFile(skillMdPath, 'utf-8')
        const parsed = parseSkillMd(content)

        const os = currentOs()
        const unsupported = parsed.os && parsed.os.length > 0 && !parsed.os.includes(os)

        const missingBins = parsed.requiredBins.filter(b => !checkBin(b))

        let status: BundledSkill['status'] = 'ready'
        if (unsupported) status = 'unsupported-os'
        else if (missingBins.length > 0) status = 'needs-setup'

        skills.push({
          name: parsed.name || entry.name,
          description: parsed.description,
          emoji: parsed.emoji,
          homepage: parsed.homepage,
          os: parsed.os,
          requiredBins: parsed.requiredBins,
          missingBins,
          install: parsed.install,
          status,
        })
      } catch {
        // skip unparseable skills
      }
    }

    return skills.sort((a, b) => {
      // ready first, then needs-setup, then unsupported
      const order = { ready: 0, 'needs-setup': 1, 'unsupported-os': 2 }
      return (order[a.status] - order[b.status]) || a.name.localeCompare(b.name)
    })
  }
}
