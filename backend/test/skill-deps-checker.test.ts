import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { SkillManager } from '../src/services/skill-manager.js'
import { SkillDepsChecker, type ExecFn } from '../src/services/skill-deps-checker.js'

async function makeSkill(dir: string, name: string, description: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: "${description}"\n---\n\nSkill body.`,
  )
  return skillDir
}

/**
 * Fake exec — drives all scanner branches deterministically.
 * Map key is `<cmd> <args.join(' ')>` (no shell quoting).
 */
function makeFakeExec(table: Record<string, { stdout?: string; stderr?: string; code?: number }>): ExecFn {
  return async (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    const hit = table[key]
    if (hit) {
      return { stdout: hit.stdout ?? '', stderr: hit.stderr ?? '', code: hit.code ?? 0 }
    }
    // Default: command not found → exit 1
    return { stdout: '', stderr: '', code: 1 }
  }
}

describe('SkillDepsChecker', () => {
  let tmpDir: string
  let workspaceSkillsDir: string
  let manager: SkillManager

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-deps-test-'))
    await mkdir(join(tmpDir, 'agents', 'finance'), { recursive: true })
    workspaceSkillsDir = join(tmpDir, 'workspace-finance', 'skills')
    await mkdir(workspaceSkillsDir, { recursive: true })
    manager = new SkillManager(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ------- Node deps -------

  it('node: declares deps from package.json; flags missing when node_modules absent', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'with-node', 'Node skill')
    await writeFile(
      join(skillDir, 'package.json'),
      JSON.stringify({ name: 'with-node', dependencies: { 'left-pad': '^1.0.0', 'lodash': '*' } }),
    )
    const checker = new SkillDepsChecker(manager, 'openclaw', makeFakeExec({}))
    const r = await checker.checkSkill('with-node', 'finance')
    expect(r.node.declared).toBe(2)
    expect(r.node.missing).toBe(2)
    const names = r.node.items.map(i => i.name).sort()
    expect(names).toEqual(['left-pad', 'lodash'])
    expect(r.node.items.every(i => !i.present)).toBe(true)
  })

  it('node: marks deps present when node_modules has the package', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'with-node', 'Node skill')
    await writeFile(
      join(skillDir, 'package.json'),
      JSON.stringify({ name: 'with-node', dependencies: { 'foo': '*' } }),
    )
    await mkdir(join(skillDir, 'node_modules', 'foo'), { recursive: true })
    await writeFile(join(skillDir, 'node_modules', 'foo', 'package.json'), '{"name":"foo","version":"1.0.0"}')
    const checker = new SkillDepsChecker(manager, 'openclaw', makeFakeExec({}))
    const r = await checker.checkSkill('with-node', 'finance')
    expect(r.node.missing).toBe(0)
    expect(r.node.present).toBe(1)
  })

  it('node: handles scoped packages and ignores devDependencies', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'scoped', 'Scoped pkg')
    await writeFile(
      join(skillDir, 'package.json'),
      JSON.stringify({
        name: 'scoped',
        dependencies: { '@vercel/edge': '*' },
        devDependencies: { 'eslint': '*' },
      }),
    )
    const checker = new SkillDepsChecker(manager, 'openclaw', makeFakeExec({}))
    const r = await checker.checkSkill('scoped', 'finance')
    expect(r.node.declared).toBe(1) // dev not counted
    expect(r.node.items[0].name).toBe('@vercel/edge')
  })

  // ------- Python deps -------

  it('python: parses requirements.txt and detects missing via pip list', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'py-skill', 'Py skill')
    await writeFile(
      join(skillDir, 'requirements.txt'),
      '# comment\nrequests==2.0\nflask>=1.0\n  pandas  \n',
    )
    const exec = makeFakeExec({
      // installed: requests + pandas. flask missing.
      'pip3 list --format=json': {
        stdout: JSON.stringify([
          { name: 'requests', version: '2.0.0' },
          { name: 'pandas', version: '2.1.0' },
        ]),
      },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('py-skill', 'finance')
    expect(r.python.declared).toBe(3)
    expect(r.python.missing).toBe(1)
    const missing = r.python.items.find(i => !i.present)!
    expect(missing.name.toLowerCase()).toBe('flask')
  })

  it('python: parses pyproject.toml [project.dependencies]', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'py-proj', 'PyProject skill')
    await writeFile(
      join(skillDir, 'pyproject.toml'),
      [
        '[project]',
        'name = "py-proj"',
        'dependencies = [',
        '  "numpy>=1.20",',
        '  "scipy"',
        ']',
      ].join('\n'),
    )
    const exec = makeFakeExec({
      'pip3 list --format=json': { stdout: JSON.stringify([{ name: 'numpy', version: '1.22.0' }]) },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('py-proj', 'finance')
    expect(r.python.declared).toBe(2)
    expect(r.python.items.find(i => i.name.toLowerCase() === 'numpy')?.present).toBe(true)
    expect(r.python.items.find(i => i.name.toLowerCase() === 'scipy')?.present).toBe(false)
  })

  it('python: malicious-looking package names are dropped at parse time, not exec-ed', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'py-evil', 'Evil pkg')
    await writeFile(join(skillDir, 'requirements.txt'), 'evil;rm -rf /\n$(whoami)\nrequests\n')
    const exec = makeFakeExec({
      'pip3 list --format=json': { stdout: '[]' },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('py-evil', 'finance')
    // Only "requests" is a legal name; the other two must be filtered out.
    expect(r.python.declared).toBe(1)
    expect(r.python.items[0].name).toBe('requests')
  })

  // ------- System binary deps -------

  it('system: extracts bins from shell scripts and verifies via which', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'sh-skill', 'Shell skill')
    await mkdir(join(skillDir, 'scripts'), { recursive: true })
    await writeFile(
      join(skillDir, 'scripts', 'run.sh'),
      ['#!/bin/bash', 'set -e', 'jq -r .x', 'curl -sS https://example.com', 'echo done'].join('\n'),
    )
    const exec = makeFakeExec({
      'which jq': { stdout: '/usr/bin/jq\n' },
      'which curl': { code: 1 }, // missing
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('sh-skill', 'finance')
    const names = r.system.items.map(i => i.name).sort()
    // Shell builtins (set, echo) must not appear.
    expect(names).toEqual(expect.arrayContaining(['curl', 'jq']))
    expect(names).not.toContain('echo')
    expect(names).not.toContain('set')
    expect(r.system.items.find(i => i.name === 'jq')?.present).toBe(true)
    expect(r.system.items.find(i => i.name === 'curl')?.present).toBe(false)
  })

  it('system: picks up python subprocess targets', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'py-sub', 'Py sub')
    await mkdir(join(skillDir, 'scripts'), { recursive: true })
    await writeFile(
      join(skillDir, 'scripts', 'run.py'),
      [
        '#!/usr/bin/env python3',
        'import subprocess',
        'subprocess.run(["pandoc", "-f", "md", "-t", "pdf"])',
        'subprocess.check_output(["ffmpeg", "-i", "in.mp4"])',
      ].join('\n'),
    )
    const exec = makeFakeExec({
      'which pandoc': { code: 1 },
      'which ffmpeg': { stdout: '/usr/bin/ffmpeg' },
      'which python3': { stdout: '/usr/bin/python3' }, // from shebang
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('py-sub', 'finance')
    const names = r.system.items.map(i => i.name).sort()
    expect(names).toEqual(expect.arrayContaining(['ffmpeg', 'pandoc', 'python3']))
    expect(r.system.items.find(i => i.name === 'ffmpeg')?.present).toBe(true)
    expect(r.system.items.find(i => i.name === 'pandoc')?.present).toBe(false)
  })

  // ------- openclaw CLI awareness -------

  it('openclaw: marks skill as known when CLI lists it', async () => {
    await makeSkill(workspaceSkillsDir, 'cli-known', 'Known by CLI')
    const exec = makeFakeExec({
      'openclaw skills list --json': {
        stdout: JSON.stringify([{ name: 'cli-known', agent: 'finance' }]),
      },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('cli-known', 'finance')
    expect(r.openclaw.declared).toBe(1)
    expect(r.openclaw.present).toBe(1)
    expect(r.openclaw.items[0].present).toBe(true)
  })

  it('openclaw: marks missing when CLI does not list the skill', async () => {
    await makeSkill(workspaceSkillsDir, 'cli-unknown', 'Unknown to CLI')
    const exec = makeFakeExec({
      'openclaw skills list --json': { stdout: '[]' },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('cli-unknown', 'finance')
    expect(r.openclaw.missing).toBe(1)
    expect(r.openclaw.items[0].present).toBe(false)
  })

  it('openclaw: falls back gracefully when CLI fails (treats as unknown)', async () => {
    await makeSkill(workspaceSkillsDir, 'cli-err', 'CLI errors out')
    const exec = makeFakeExec({
      'openclaw skills list --json': { code: 1, stderr: 'boom' },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('cli-err', 'finance')
    // Cli failure → declared=0, missing=0 (no opinion), items=[]
    expect(r.openclaw.declared).toBe(0)
    expect(r.openclaw.missing).toBe(0)
  })

  // ------- Aggregate / cache / health overview -------

  it('totalMissing aggregates all four categories', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'all-missing', 'All missing')
    await writeFile(join(skillDir, 'package.json'), JSON.stringify({ dependencies: { 'foo': '*' } }))
    await writeFile(join(skillDir, 'requirements.txt'), 'flask\n')
    await mkdir(join(skillDir, 'scripts'), { recursive: true })
    await writeFile(join(skillDir, 'scripts', 'r.sh'), '#!/bin/bash\njq -r .x\n')
    const exec = makeFakeExec({
      'pip3 list --format=json': { stdout: '[]' },
      'openclaw skills list --json': { stdout: '[]' },
      'which jq': { code: 1 },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const r = await checker.checkSkill('all-missing', 'finance')
    // 1 node + 1 python + 1 system + 1 openclaw
    expect(r.totalMissing).toBe(4)
  })

  it('healthOverview returns one entry per skill with summary counts', async () => {
    await makeSkill(workspaceSkillsDir, 'a', 'A')
    await makeSkill(workspaceSkillsDir, 'b', 'B')
    const aDir = join(workspaceSkillsDir, 'a')
    await writeFile(join(aDir, 'package.json'), JSON.stringify({ dependencies: { 'foo': '*' } }))
    const exec = makeFakeExec({
      'pip3 list --format=json': { stdout: '[]' },
      'openclaw skills list --json': {
        stdout: JSON.stringify([
          { name: 'a', agent: 'finance' },
          { name: 'b', agent: 'finance' },
        ]),
      },
    })
    const checker = new SkillDepsChecker(manager, 'openclaw', exec)
    const overview = await checker.healthOverview()
    expect(overview).toHaveLength(2)
    const a = overview.find(s => s.name === 'a')!
    const b = overview.find(s => s.name === 'b')!
    expect(a.totalMissing).toBe(1)
    expect(b.totalMissing).toBe(0)
    expect(b.status).toBe('ok')
    expect(a.status).toBe('missing')
  })

  it('cache: second call within TTL skips work', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'cached', 'Cached skill')
    await writeFile(join(skillDir, 'requirements.txt'), 'requests\n')
    let pipCalls = 0
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'pip3' && args[0] === 'list') {
        pipCalls++
        return { stdout: '[]', stderr: '', code: 0 }
      }
      if (cmd === 'openclaw') return { stdout: '[]', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 1 }
    }
    const checker = new SkillDepsChecker(manager, 'openclaw', exec, { cacheTtlMs: 60_000 })
    await checker.checkSkill('cached', 'finance')
    await checker.checkSkill('cached', 'finance')
    expect(pipCalls).toBe(1)
  })

  it('invalidate(): clears cache so the next call re-scans', async () => {
    const skillDir = await makeSkill(workspaceSkillsDir, 'cached', 'Cached')
    await writeFile(join(skillDir, 'requirements.txt'), 'requests\n')
    let calls = 0
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'pip3' && args[0] === 'list') {
        calls++
        return { stdout: '[]', stderr: '', code: 0 }
      }
      if (cmd === 'openclaw') return { stdout: '[]', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 1 }
    }
    const checker = new SkillDepsChecker(manager, 'openclaw', exec, { cacheTtlMs: 60_000 })
    await checker.checkSkill('cached', 'finance')
    checker.invalidate()
    await checker.checkSkill('cached', 'finance')
    expect(calls).toBe(2)
  })

  it('checkSkill: throws when skill name is unknown', async () => {
    const checker = new SkillDepsChecker(manager, 'openclaw', makeFakeExec({}))
    await expect(checker.checkSkill('no-such', 'finance')).rejects.toThrow(/not found/i)
  })
})
