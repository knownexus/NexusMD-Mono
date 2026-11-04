import { describe, it, expect } from 'vitest'
import { profileCacheStorage } from '../../src/modules/workitems/profile-cache-storage.js'
import { ADO_CACHE_KEY } from '../../src/modules/ado/loader.js'
import { JIRA_CACHE_KEY } from '../../src/modules/jira/loader.js'
import { GITHUB_CACHE_KEY } from '../../src/modules/github/loader.js'
import { WORK_ITEM_STATUS_KEY, readProviderStatus, recordProviderStatus } from '../../src/modules/workitems/status.js'
import * as core from '../../src/index.js'

const mem = () => {
  const m = new Map()
  return { _m: m, get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: k => m.delete(k), keys: () => [...m.keys()] }
}
const pk = k => `nexusmd.p.P1.${k.replace(/^nexusmd\./, '')}`

describe('profileCacheStorage', () => {
  it('is exported from @nexusmd/core', () => expect(core.profileCacheStorage).toBe(profileCacheStorage))

  it('keeps the ADO cache and the provider status under the active profile', () => {
    const inner = mem()
    const s = profileCacheStorage(inner, pk)
    s.set(ADO_CACHE_KEY, { WORK_ITEMS: [] })
    recordProviderStatus(s, 'ado', { ok: true })
    expect(inner._m.has('nexusmd.p.P1.ado.cache.v1')).toBe(true)
    expect(inner._m.has('nexusmd.p.P1.workitems.status.v1')).toBe(true)
    expect(inner._m.has(ADO_CACHE_KEY)).toBe(false)
    expect(inner._m.has(WORK_ITEM_STATUS_KEY)).toBe(false)
    expect(readProviderStatus(s).ado.status).toBe('ok')
    s.remove(ADO_CACHE_KEY)
    expect(inner._m.has('nexusmd.p.P1.ado.cache.v1')).toBe(false)
  })

  it('keeps the Jira and GitHub caches under the active profile', () => {
    const inner = mem()
    const s = profileCacheStorage(inner, pk)
    s.set(JIRA_CACHE_KEY, { WORK_ITEMS: [1] })
    s.set(GITHUB_CACHE_KEY, { WORK_ITEMS: [2] })
    expect(inner._m.get('nexusmd.p.P1.jira.cache.v1')).toEqual({ WORK_ITEMS: [1] })
    expect(inner._m.get('nexusmd.p.P1.github.cache.v1')).toEqual({ WORK_ITEMS: [2] })
    expect(inner._m.has(JIRA_CACHE_KEY)).toBe(false)
    expect(inner._m.has(GITHUB_CACHE_KEY)).toBe(false)
    expect(s.get(JIRA_CACHE_KEY)).toEqual({ WORK_ITEMS: [1] })
    s.remove(GITHUB_CACHE_KEY)
    expect(inner._m.has('nexusmd.p.P1.github.cache.v1')).toBe(false)
  })

  it('passes every other key through unchanged', () => {
    const inner = mem()
    const s = profileCacheStorage(inner, pk)
    s.set('nexusmd.wi.wiTypeStates.cache', 1)
    expect(s.get('nexusmd.wi.wiTypeStates.cache')).toBe(1)
    expect(inner._m.get('nexusmd.wi.wiTypeStates.cache')).toBe(1)
    expect(s.keys()).toEqual(['nexusmd.wi.wiTypeStates.cache'])
  })
})
