import { describe, it, expect } from 'vitest'
import { makeProfileKeys } from '../src/index.js'

describe('makeProfileKeys', () => {
  it('namespaces under the active profile when one is set', () => {
    const { getProfileKey } = makeProfileKeys({ getActiveId: () => 'abc123' })
    expect(getProfileKey('ado.org')).toBe('nexusmd.p.abc123.ado.org')
  })

  it('uses the bare namespace when no profile is active', () => {
    const { getProfileKey } = makeProfileKeys({ getActiveId: () => null })
    expect(getProfileKey('ado.org')).toBe('nexusmd.ado.org')
  })

  it('strips a leading namespace prefix of any length (the old slice(5) bug)', () => {
    const { getProfileKey } = makeProfileKeys({ getActiveId: () => 'p1' })
    // 'nexusmd.' is 8 chars — the old code sliced a fixed 5 and left "md." behind.
    expect(getProfileKey('nexusmd.themes')).toBe('nexusmd.p.p1.themes')
  })

  it('honours a custom namespace', () => {
    const { getProfileKey } = makeProfileKeys({ namespace: 'helm', getActiveId: () => 'x' })
    expect(getProfileKey('android.org')).toBe('helm.p.x.android.org')
    expect(getProfileKey('helm.android.org')).toBe('helm.p.x.android.org')
  })

  it('getActiveProfileId returns "" when the reader throws or is absent', () => {
    expect(makeProfileKeys({ getActiveId: () => { throw new Error('boom') } }).getActiveProfileId()).toBe('')
    expect(makeProfileKeys().getActiveProfileId()).toBe('')
  })

  it('falls back to the bare namespace when getActiveId throws', () => {
    const { getProfileKey } = makeProfileKeys({ getActiveId: () => { throw new Error('x') } })
    expect(getProfileKey('k')).toBe('nexusmd.k')
  })
})
