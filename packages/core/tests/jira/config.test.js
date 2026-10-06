import { describe, it, expect } from 'vitest'
import { normaliseSite, makeJiraConfig } from '../../src/modules/jira/config.js'

function memStorage() {
  const m = new Map()
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), _m: m }
}

describe('normaliseSite', () => {
  it('expands a bare site name', () => expect(normaliseSite('acme')).toBe('https://acme.atlassian.net'))
  it('strips scheme, path, whitespace and case', () => {
    expect(normaliseSite('  HTTPS://Acme.atlassian.net/jira/software/projects  ')).toBe('https://acme.atlassian.net')
  })
  it('keeps a full host', () => expect(normaliseSite('acme.atlassian.net')).toBe('https://acme.atlassian.net'))
  it('returns empty for empty input', () => expect(normaliseSite('')).toBe(''))
})

describe('makeJiraConfig', () => {
  it('requires storage and key', () => {
    expect(() => makeJiraConfig({})).toThrow('makeJiraConfig requires { storage, key }')
  })

  it('round-trips values through namespaced keys', () => {
    const storage = memStorage()
    const cfg = makeJiraConfig({ storage, key: n => `p1.jira.${n}` })
    cfg.saveJiraConfig({ site: 'acme', email: ' me@acme.io ', apiToken: 'tok', projectKeys: ['abc'], jql: 'labels = x' })
    expect(storage._m.get('p1.jira.site')).toBe('https://acme.atlassian.net')
    expect(cfg.getJiraConfig()).toEqual({
      site: 'https://acme.atlassian.net', email: 'me@acme.io', apiToken: 'tok',
      projectKeys: ['ABC'], jql: 'labels = x', boardId: '', enabled: true, refreshSecs: 60,
    })
  })

  it('normalises project keys typed in lowercase, with spaces or blanks', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    cfg.saveJiraConfig({ projectKeys: [' abc ', '', 'Def'] })
    expect(cfg.getJiraConfig().projectKeys).toEqual(['ABC', 'DEF'])
  })

  it('stores the chosen board id as a string', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    expect(cfg.getJiraConfig().boardId).toBe('')
    cfg.saveJiraConfig({ boardId: 42 })
    expect(cfg.getJiraConfig().boardId).toBe('42')
  })

  it('reports configured only with site, email, token and a project', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    expect(cfg.isJiraConfigured()).toBe(false)
    cfg.saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['A'] })
    expect(cfg.isJiraConfigured()).toBe(true)
  })

  it('isJiraActive also respects the enabled toggle', () => {
    const cfg = makeJiraConfig({ storage: memStorage(), key: n => n })
    cfg.saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['A'], enabled: false })
    expect(cfg.isJiraConfigured()).toBe(true)
    expect(cfg.isJiraActive()).toBe(false)
  })

  it('tolerates corrupt projectKeys JSON', () => {
    const storage = memStorage()
    storage.set('projectKeys', '{nope')
    expect(makeJiraConfig({ storage, key: n => n }).getJiraConfig().projectKeys).toEqual([])
  })
})
