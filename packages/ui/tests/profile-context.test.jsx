import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, useProfile } from '../src/index.js'

afterEach(cleanup)

// Enumerable storage mock (real localStorage has length/key(i); the provider
// enumerates it to purge/collect `${ns}.p.${id}.*` keys).
function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    _map: m,
  }
}

// Grab the context value via a probe child.
function harness(providerProps) {
  const ref = { api: null }
  function Probe() { ref.api = useProfile(); return null }
  render(<ProfileProvider {...providerProps}>{React.createElement(Probe)}</ProfileProvider>)
  return ref
}

describe('shared ProfileProvider (web + app via injected store)', () => {
  it('seeds state from the namespaced localStorage cache', () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'a', name: 'A', initials: 'A', color: '#000', type: 'ado' }]),
      'helm.activeProfileId': 'a',
    })
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn() } })
    expect(ref.api.profiles).toHaveLength(1)
    expect(ref.api.activeProfile.id).toBe('a')
    expect(ref.api.loading).toBe(false) // no store.load → not loading
  })

  it('createProfile appends the store entry and caches the list', async () => {
    const storage = makeStorage()
    const store = {
      create: async (opts) => ({ profile: { id: 'p1', ...opts }, entry: { id: 'p1', name: opts.name, initials: 'WK', color: '#000', type: 'ado' } }),
    }
    const ref = harness({ namespace: 'helm', storage, store })
    await act(async () => { await ref.api.createProfile({ name: 'Work' }) })
    expect(JSON.parse(storage.getItem('helm.profiles'))).toEqual([
      { id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'ado' },
    ])
    expect(ref.api.profiles[0].name).toBe('Work')
  })

  it('deleteProfile purges the profile-scoped keys and re-caches the list', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([
        { id: 'a', name: 'A', initials: 'A', color: '#000', type: 'ado' },
        { id: 'b', name: 'B', initials: 'B', color: '#000', type: 'ado' },
      ]),
      'helm.activeProfileId': 'a',
      'helm.p.b.planner.week.2026-W26': 'x',
      'helm.p.b.tweaks': 'y',
      'helm.p.a.tweaks': 'keep',
    })
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn() } })
    await act(async () => { await ref.api.deleteProfile('b') })
    // b's scoped keys gone, a's untouched
    expect(storage.getItem('helm.p.b.planner.week.2026-W26')).toBeNull()
    expect(storage.getItem('helm.p.b.tweaks')).toBeNull()
    expect(storage.getItem('helm.p.a.tweaks')).toBe('keep')
    expect(JSON.parse(storage.getItem('helm.profiles')).map(p => p.id)).toEqual(['a'])
  })

  it('deleteProfile refuses to delete the only profile', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'a', name: 'A', initials: 'A', color: '#000', type: 'ado' }]),
    })
    const remove = vi.fn()
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn(), remove } })
    await act(async () => { await ref.api.deleteProfile('a') })
    expect(remove).not.toHaveBeenCalled()
    expect(JSON.parse(storage.getItem('helm.profiles'))).toHaveLength(1)
  })

  it('an async store.load refreshes profiles and clears loading (web shape)', async () => {
    const storage = makeStorage()
    const store = {
      load: async () => ({ profiles: [{ id: 's', name: 'Server', initials: 'S', color: '#000', type: 'ado' }], activeId: 's' }),
      create: vi.fn(),
    }
    const ref = harness({ namespace: 'nexusmd', storage, store })
    await waitFor(() => expect(ref.api.loading).toBe(false))
    expect(ref.api.profiles[0].name).toBe('Server')
    expect(storage.getItem('nexusmd.profiles')).toContain('Server')
  })

  it('store ops that are absent behave as local-only (update/activate skipped, ok)', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'a', name: 'A', initials: 'A', color: '#000', type: 'ado' }]),
      'helm.activeProfileId': 'a',
    })
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn() } })
    await act(async () => { await ref.api.updateProfile('a', { name: 'Renamed' }) })
    expect(ref.api.profiles[0].name).toBe('Renamed')
    expect(JSON.parse(storage.getItem('helm.profiles'))[0].name).toBe('Renamed')
  })
})

describe('desktop profile lifecycle (soft delete, restore, purge)', () => {
  const W = { id: 'W', name: 'Work', initials: 'WK', color: '#000', type: 'manual', updatedAt: 1, deletedAt: null, purgedAt: null }
  const H = { id: 'H', name: 'Home', initials: 'HM', color: '#000', type: 'manual', updatedAt: 1, deletedAt: null, purgedAt: null }
  const listOf = (storage) => JSON.parse(storage.getItem('nexusmd.profiles'))
  function setup(list = [W, H]) {
    const storage = makeStorage({
      'nexusmd.profiles': JSON.stringify(list), 'nexusmd.activeProfileId': 'W',
      'nexusmd.p.H.md_documents': '{"docs":[]}', 'nexusmd.p.H.ado.org': 'acme',
      'nexusmd.sec.nexusmd.p.H.ado.pat': 'blob', 'nexusmd.p.W.ado.org': 'w',
    })
    const vals = new Map([['nexusmd.p.H.ado.pat', 'pat-H']])
    const secure = {
      names: () => [...storage._map.keys()].filter(k => k.startsWith('nexusmd.sec.')).map(k => k.slice(12)),
      get: async (n) => vals.get(n) ?? null, set: async (n, v) => { vals.set(n, v) },
      remove: async (n) => { vals.delete(n) }, vals,
    }
    const ref = harness({ namespace: 'nexusmd', storage, secure, lifecycle: true, store: {} })
    return { storage, secure, ref }
  }
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, configurable: true })
  })

  it('deleting moves the profile to Deleted profiles and keeps its data', async () => {
    const { storage, ref } = setup()
    await act(async () => { await ref.api.deleteProfile('H') })
    expect(ref.api.profiles.map(p => p.id)).toEqual(['W'])
    expect(ref.api.deletedProfiles.map(p => p.id)).toEqual(['H'])
    const rec = listOf(storage).find(p => p.id === 'H')
    expect(rec.deletedAt).toEqual(expect.any(Number))
    expect(rec.updatedAt).toBe(rec.deletedAt)
    expect(storage.getItem('nexusmd.p.H.md_documents')).toBe('{"docs":[]}')
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('deleting the active profile makes another live one active', async () => {
    const { storage, ref } = setup()
    await act(async () => { await ref.api.deleteProfile('W') })
    expect(storage.getItem('nexusmd.activeProfileId')).toBe('H')
    expect(window.location.reload).toHaveBeenCalled()
  })

  it('the last live profile cannot be deleted', async () => {
    const { storage, ref } = setup([W, { ...H, deletedAt: 5 }])
    await act(async () => { await ref.api.deleteProfile('W') })
    expect(listOf(storage).find(p => p.id === 'W').deletedAt).toBeNull()
  })

  it('restore brings it back with its data', async () => {
    const { storage, ref } = setup([W, { ...H, deletedAt: 5, updatedAt: 5 }])
    expect(ref.api.profiles.map(p => p.id)).toEqual(['W'])
    await act(async () => { await ref.api.restoreProfile('H') })
    expect(ref.api.profiles.map(p => p.id)).toEqual(['W', 'H'])
    expect(ref.api.deletedProfiles).toEqual([])
    const rec = listOf(storage).find(p => p.id === 'H')
    expect(rec.deletedAt).toBeNull()
    expect(rec.updatedAt).toBeGreaterThan(5)
    expect(storage.getItem('nexusmd.p.H.ado.org')).toBe('acme')
  })

  it('signed out, purge removes the profile\'s data and secrets here and leaves a tombstone', async () => {
    const { storage, secure, ref } = setup([W, { ...H, deletedAt: 5 }])
    await act(async () => { await ref.api.purgeProfile('H') })
    expect([...storage._map.keys()].filter(k => k.includes('.p.H.'))).toEqual([])
    expect(secure.vals.has('nexusmd.p.H.ado.pat')).toBe(false)
    expect(listOf(storage).find(p => p.id === 'H')).toMatchObject({ id: 'H', purgedAt: expect.any(Number) })
    expect(ref.api.deletedProfiles).toEqual([])
    expect(ref.api.profiles.map(p => p.id)).toEqual(['W'])
    expect(storage.getItem('nexusmd.p.W.ado.org')).toBe('w')
  })

  it('signed in, purge goes through the account sync and the list is re-read', async () => {
    const { storage, ref } = setup([W, { ...H, deletedAt: 5 }])
    const sync = { purgeProfile: vi.fn(async (pid) => {
      storage.setItem('nexusmd.profiles', JSON.stringify([W, { id: pid, name: 'Home', updatedAt: 9, deletedAt: 5, purgedAt: 9 }]))
      return {}
    }) }
    await act(async () => { await ref.api.purgeProfile('H', { sync }) })
    expect(sync.purgeProfile).toHaveBeenCalledWith('H')
    expect(ref.api.deletedProfiles).toEqual([])
  })

  it('a failed sync purge changes nothing', async () => {
    const { storage, ref } = setup([W, { ...H, deletedAt: 5 }])
    const sync = { purgeProfile: vi.fn(async () => ({ error: new Error('offline') })) }
    await act(async () => { await ref.api.purgeProfile('H', { sync }) })
    expect(ref.api.deletedProfiles.map(p => p.id)).toEqual(['H'])
    expect(storage.getItem('nexusmd.p.H.ado.org')).toBe('acme')
  })

  it('an edit bumps updatedAt so it wins on the other devices', async () => {
    const { storage, ref } = setup()
    await act(async () => { await ref.api.updateProfile('W', { name: 'Job' }) })
    expect(listOf(storage).find(p => p.id === 'W')).toMatchObject({ name: 'Job', updatedAt: expect.any(Number) })
    expect(listOf(storage).find(p => p.id === 'W').updatedAt).toBeGreaterThan(1)
  })

  it('the profile switcher never lists deleted profiles', () => {
    const { ref } = setup([W, { ...H, deletedAt: 5 }, { id: 'X', name: 'Gone', updatedAt: 9, deletedAt: 5, purgedAt: 9 }])
    expect(ref.api.profiles.map(p => p.id)).toEqual(['W'])
    expect(ref.api.deletedProfiles.map(p => p.id)).toEqual(['H'])
  })

  it('a deleted or purged profile can still be exported on its own (before a pending purge discards it)', async () => {
    const { ref } = setup([W, { id: 'H', name: 'Home', updatedAt: 9, deletedAt: 5, purgedAt: 9 }])
    const { text } = await ref.api.exportBundle({ scope: 'H', password: 'pw' })
    const { decodeBundle } = await import('@nexusmd/core')
    const payload = await decodeBundle(text, 'pw')
    expect(payload.profiles.map(p => p.id)).toEqual(['H'])
    expect(payload.profiles[0].data['ado.org']).toBe('acme')
  })
})
