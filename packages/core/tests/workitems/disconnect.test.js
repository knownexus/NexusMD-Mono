import { describe, it, expect } from 'vitest'
import {
  clearProviderData, ADO_CACHE_KEY, JIRA_CACHE_KEY, GITHUB_CACHE_KEY, WORK_ITEM_STATUS_KEY,
} from '../../src/index.js'
import { ADO_FIELDS } from '../../src/modules/ado/config.js'
import { GITHUB_FIELDS } from '../../src/modules/github/config.js'
import { JIRA_FIELDS } from '../../src/modules/jira/config.js'
import { ALIASES } from '../../src/modules/account/key-registry.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v) }, remove: k => { m.delete(k) }, _m: m }
}

describe('clearProviderData', () => {
  const seed = () => memStorage({
    [ADO_CACHE_KEY]: { PRS: [{ id: 1 }] },
    [JIRA_CACHE_KEY]: { WORK_ITEMS: [] },
    [GITHUB_CACHE_KEY]: { PRS: [] },
    [WORK_ITEM_STATUS_KEY]: { ado: { status: 'ok', at: 1 }, jira: { status: 'ok', at: 2 }, github: { status: 'error', at: 3 } },
  })

  it('drops the provider\'s cache and its status, and nothing of the others', () => {
    const st = seed()
    clearProviderData(st, 'ado')
    expect(st.get(ADO_CACHE_KEY)).toBeNull()
    expect(st.get(JIRA_CACHE_KEY)).not.toBeNull()
    expect(st.get(GITHUB_CACHE_KEY)).not.toBeNull()
    expect(Object.keys(st.get(WORK_ITEM_STATUS_KEY))).toEqual(['jira', 'github'])
  })

  it.each([['jira', JIRA_CACHE_KEY], ['github', GITHUB_CACHE_KEY]])('does the same for %s', (id, cacheKey) => {
    const st = seed()
    clearProviderData(st, id)
    expect(st.get(cacheKey)).toBeNull()
    expect(st.get(WORK_ITEM_STATUS_KEY)[id]).toBeUndefined()
  })

  it('does nothing for an unknown provider and when there is nothing to clear', () => {
    const st = seed()
    clearProviderData(st, 'nope')
    expect(st._m.size).toBe(4)
    expect(() => clearProviderData(memStorage(), 'ado')).not.toThrow()
  })
})

describe('the fields a removal covers match the fields account sync carries', () => {
  const synced = (prefix) => ALIASES.filter(a => a.id.startsWith(prefix + '.')).map(a => a.id.slice(prefix.length + 1)).sort()
  it('ado', () => expect([...ADO_FIELDS].sort()).toEqual(synced('ado')))
  it('github', () => expect([...GITHUB_FIELDS].sort()).toEqual(synced('github')))
  it('jira', () => expect([...JIRA_FIELDS].sort()).toEqual(synced('jira')))
})
