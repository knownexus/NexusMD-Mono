import { describe, it, expect, beforeEach } from 'vitest'
import { makeGithubConfig, MAX_GITHUB_REPOS, repoListFromStub } from '../../src/modules/github/index.js'

function memStorage() {
  const map = new Map()
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, String(v)) },
    remove: (k) => { map.delete(k) },
    keys: () => [...map.keys()],
  }
}

describe('makeGithubConfig', () => {
  let cfg
  beforeEach(() => { cfg = makeGithubConfig({ storage: memStorage(), key: (n) => `gh.${n}` }) })

  it('throws without storage or key', () => {
    expect(() => makeGithubConfig({})).toThrow()
  })
  it('has defaults', () => {
    expect(cfg.getGithubConfig()).toEqual({ pat: '', repos: [], issues: true, inWork: true, login: '', refreshSecs: 60 })
    expect(MAX_GITHUB_REPOS).toBe(50)
  })
  it('round-trips each field', () => {
    cfg.saveGithubConfig({ pat: 'tok', repos: ['a/b', 'c/d'], login: 'me', refreshSecs: 90, issues: false, inWork: false })
    expect(cfg.getGithubConfig()).toEqual({ pat: 'tok', repos: ['a/b', 'c/d'], issues: false, inWork: false, login: 'me', refreshSecs: 90 })
  })
  it('partial saves leave other fields', () => {
    cfg.saveGithubConfig({ pat: 'tok' })
    cfg.saveGithubConfig({ login: 'me' })
    expect(cfg.getGithubConfig().pat).toBe('tok')
  })
  it('isGithubConfigured needs pat and repos', () => {
    expect(cfg.isGithubConfigured()).toBe(false)
    cfg.saveGithubConfig({ pat: 'tok' })
    expect(cfg.isGithubConfigured()).toBe(false)
    cfg.saveGithubConfig({ repos: ['a/b'] })
    expect(cfg.isGithubConfigured()).toBe(true)
    cfg.saveGithubConfig({ pat: '' })
    expect(cfg.isGithubConfigured()).toBe(false)
  })
  it('usesGithubWorkItems follows issues', () => {
    cfg.saveGithubConfig({ pat: 'tok', repos: ['a/b'] })
    expect(cfg.usesGithubWorkItems()).toBe(true)
    cfg.saveGithubConfig({ issues: false })
    expect(cfg.usesGithubWorkItems()).toBe(false)
  })
  it('rejects more than 50 repos and keeps the stored list', () => {
    cfg.saveGithubConfig({ repos: ['a/b'] })
    const many = Array.from({ length: 51 }, (_, i) => `o/r${i}`)
    expect(() => cfg.saveGithubConfig({ repos: many })).toThrow('Select at most 50 repositories')
    expect(cfg.getGithubConfig().repos).toEqual(['a/b'])
  })
})

describe('repoListFromStub', () => {
  it('qualifies, keeps qualified names and dedupes', () => {
    expect(repoListFromStub({ owner: 'acme', repos: ['web', 'api'] })).toEqual(['acme/web', 'acme/api'])
    expect(repoListFromStub({ owner: 'acme', repos: ['other/x', 'web'] })).toEqual(['other/x', 'acme/web'])
    expect(repoListFromStub({ owner: 'acme', repos: ['web', 'acme/web'] })).toEqual(['acme/web'])
    expect(repoListFromStub(undefined)).toEqual([])
  })
})
