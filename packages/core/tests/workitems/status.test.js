import { describe, it, expect } from 'vitest'
import { WORK_ITEM_STATUS_KEY, readProviderStatus, recordProviderStatus, describeProviderError } from '../../src/modules/workitems/status.js'

function storage() { const s = {}; return { get: k => s[k] ?? null, set: (k, v) => { s[k] = v }, _s: s } }

describe('provider status', () => {
  it('records ok and error per provider', () => {
    const st = storage()
    recordProviderStatus(st, 'ado', { ok: true })
    recordProviderStatus(st, 'jira', { ok: false, error: Object.assign(new Error('x'), { status: 401 }) })
    const all = readProviderStatus(st)
    expect(all.ado.status).toBe('ok')
    expect(all.jira).toMatchObject({ status: 'error', error: 'auth failed — check settings' })
    expect(st._s[WORK_ITEM_STATUS_KEY]).toBe(all)
  })
  it('reads an empty object when nothing is stored or it is malformed', () => {
    const st = storage()
    expect(readProviderStatus(st)).toEqual({})
    st.set(WORK_ITEM_STATUS_KEY, '{bad')
    expect(readProviderStatus(st)).toEqual({})
  })
  it('describes errors', () => {
    expect(describeProviderError({ status: 403 })).toBe('auth failed — check settings')
    expect(describeProviderError(new Error('Not found in Jira (404)'))).toBe('Not found in Jira (404)')
    expect(describeProviderError(null)).toBe('load failed')
  })
})
