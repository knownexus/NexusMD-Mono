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

  describe('bareWhenInactive (legacy App/Web parity)', () => {
    it('returns the raw key unchanged when no profile is active', () => {
      const { getProfileKey } = makeProfileKeys({ getActiveId: () => null, bareWhenInactive: true })
      expect(getProfileKey('planner.sync')).toBe('planner.sync')
      expect(getProfileKey('nexusmd.profile.photo')).toBe('nexusmd.profile.photo')
    })

    it('still scopes under an active profile (and fixes the slice(5) bug)', () => {
      const { getProfileKey } = makeProfileKeys({ getActiveId: () => 'p1', bareWhenInactive: true })
      // The old Web code produced nexusmd.p.p1.md.profile.photo — core strips the full prefix.
      expect(getProfileKey('nexusmd.profile.photo')).toBe('nexusmd.p.p1.profile.photo')
      expect(getProfileKey('planner.sync')).toBe('nexusmd.p.p1.planner.sync')
    })

    it('matches the App helm namespace exactly (slice(5) is correct for "helm.")', () => {
      const { getProfileKey } = makeProfileKeys({ namespace: 'helm', getActiveId: () => 'a1', bareWhenInactive: true })
      expect(getProfileKey('helm.android.org')).toBe('helm.p.a1.android.org')
      expect(getProfileKey('helm.tweaks')).toBe('helm.p.a1.tweaks')
    })
  })
})
