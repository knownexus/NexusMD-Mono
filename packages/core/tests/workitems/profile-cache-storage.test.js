import { describe, it, expect } from 'vitest'
import { profileCacheStorage } from '../../src/modules/workitems/profile-cache-storage.js'
import { ADO_CACHE_KEY } from '../../src/modules/ado/loader.js'
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

  it('passes every other key through unchanged', () => {
    const inner = mem()
    const s = profileCacheStorage(inner, pk)
    s.set('nexusmd.jira.cache.v1', 1)
    expect(s.get('nexusmd.jira.cache.v1')).toBe(1)
    expect(inner._m.get('nexusmd.jira.cache.v1')).toBe(1)
    expect(s.keys()).toEqual(['nexusmd.jira.cache.v1'])
  })
})
