import { describe, it, expect, afterEach, vi } from 'vitest'
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
