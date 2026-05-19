import { describe, it, expect } from 'vitest'
import { validateTarEntries, parseManifest, compareDeps } from '../src/services/upgrade-manager.js'

describe('validateTarEntries', () => {
  it('accepts a normal package listing', () => {
    expect(() => validateTarEntries([
      'openclaw-upgrade.json',
      'dist/',
      'dist/index.js',
      'package.json',
    ])).not.toThrow()
  })

  it('rejects absolute-path members', () => {
    expect(() => validateTarEntries(['dist/index.js', '/etc/passwd']))
      .toThrow(/绝对路径/)
  })

  it('rejects parent-traversal members', () => {
    expect(() => validateTarEntries(['dist/index.js', '../../root/.ssh/authorized_keys']))
      .toThrow(/穿越/)
    expect(() => validateTarEntries(['dist/../../escape']))
      .toThrow(/穿越/)
  })

  it('ignores blank lines', () => {
    expect(() => validateTarEntries(['dist/index.js', '', '  '])).not.toThrow()
  })
})

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const m = parseManifest('{"type":"backend-dist","version":"0.2.0","builtAt":"2026-05-19T00:00:00Z"}')
    expect(m.type).toBe('backend-dist')
    expect(m.version).toBe('0.2.0')
    expect(m.builtAt).toBe('2026-05-19T00:00:00Z')
  })

  it('accepts all three known types', () => {
    for (const type of ['frontend', 'backend-dist', 'backend-full']) {
      expect(parseManifest(`{"type":"${type}","version":"1.0.0"}`).type).toBe(type)
    }
  })

  it('rejects non-JSON', () => {
    expect(() => parseManifest('not json')).toThrow(/JSON/)
  })

  it('rejects unknown type', () => {
    expect(() => parseManifest('{"type":"plugin","version":"1.0.0"}')).toThrow(/类型/)
  })

  it('rejects a missing version', () => {
    expect(() => parseManifest('{"type":"frontend"}')).toThrow(/version/)
  })
})

describe('compareDeps', () => {
  it('passes when dependency maps are identical', () => {
    const a = { fastify: '^5.0.0', 'node-pty': '^1.1.0' }
    const b = { 'node-pty': '^1.1.0', fastify: '^5.0.0' }
    expect(() => compareDeps(a, b)).not.toThrow()
  })

  it('throws when a dependency version differs', () => {
    expect(() => compareDeps({ fastify: '^5.0.0' }, { fastify: '^5.1.0' }))
      .toThrow(/完整后端包/)
  })

  it('throws when a dependency is added or removed', () => {
    expect(() => compareDeps({ fastify: '^5.0.0' }, { fastify: '^5.0.0', ws: '^8.0.0' }))
      .toThrow(/完整后端包/)
    expect(() => compareDeps({ fastify: '^5.0.0', ws: '^8.0.0' }, { fastify: '^5.0.0' }))
      .toThrow(/完整后端包/)
  })

  it('treats undefined dependency maps as empty', () => {
    expect(() => compareDeps(undefined, undefined)).not.toThrow()
    expect(() => compareDeps({}, undefined)).not.toThrow()
  })
})
