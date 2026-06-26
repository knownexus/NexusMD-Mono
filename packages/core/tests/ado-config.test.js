import { describe, it, expect, beforeEach } from 'vitest'
import { makeAdoConfig } from '../src/index.js'

// Minimal in-memory IStorageAdapter.
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, String(v)) },
    remove: (k) => { map.delete(k) },
    keys: () => [...map.keys()],
    _dump: () => Object.fromEntries(map),
  }
}

describe('makeAdoConfig', () => {
  let storage
  const key = (name) => `nexusmd.ado.${name}`
  let cfg

  beforeEach(() => {
    storage = memStorage()
    cfg = makeAdoConfig({ storage, key })
  })

  it('throws without storage or key', () => {
    expect(() => makeAdoConfig({})).toThrow()
    expect(() => makeAdoConfig({ storage })).toThrow()
  })

  it('returns sensible defaults when storage is empty', () => {
    const c = cfg.getAdoConfig()
    expect(c).toMatchObject({
      org: '', pat: '', projects: [], testProject: '',
      uatBranch: 'refs/heads/uat', refreshSecs: 30, uatPipelineId: 0,
    })
  })

  it('round-trips a saved config through the injected key scheme', () => {
    cfg.saveAdoConfig({ org: 'acme', pat: 'secret', projects: ['A', 'B'], refreshSecs: 60 })
    expect(storage.get('nexusmd.ado.org')).toBe('acme')
    expect(storage.get('nexusmd.ado.projects')).toBe('["A","B"]')
    const c = cfg.getAdoConfig()
    expect(c.org).toBe('acme')
    expect(c.projects).toEqual(['A', 'B'])
    expect(c.refreshSecs).toBe(60)
  })

  it('only writes keys that are explicitly provided', () => {
    cfg.saveAdoConfig({ org: 'acme' })
    expect(storage.get('nexusmd.ado.org')).toBe('acme')
    expect(storage.get('nexusmd.ado.pat')).toBeNull()
  })

  it('tolerates malformed projects JSON', () => {
    storage.set('nexusmd.ado.projects', '{not json')
    expect(cfg.getAdoConfig().projects).toEqual([])
  })

  it('isAdoConfigured requires org + pat + at least one project', () => {
    expect(cfg.isAdoConfigured()).toBe(false)
    cfg.saveAdoConfig({ org: 'acme', pat: 'p' })
    expect(cfg.isAdoConfigured()).toBe(false)
    cfg.saveAdoConfig({ projects: ['A'] })
    expect(cfg.isAdoConfigured()).toBe(true)
  })

  it('respects injected defaults', () => {
    const c = makeAdoConfig({ storage: memStorage(), key, defaults: { uatBranch: 'refs/heads/qa', refreshSecs: 15 } })
    const out = c.getAdoConfig()
    expect(out.uatBranch).toBe('refs/heads/qa')
    expect(out.refreshSecs).toBe(15)
  })
})
