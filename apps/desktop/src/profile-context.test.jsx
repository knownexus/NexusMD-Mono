// The one-time move of shared data into profiles runs at start, before anything under the
// provider (the account gate and its sync, the screens) mounts, and fills the token cache.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const saved = vi.hoisted(() => ({ map: new Map(), failSet: false }))
vi.mock('./adapters/secureStorage.js', async () => {
  const { createSecretCache } = await import('@nexusmd/core')
  return { secureStorageAdapter: createSecretCache({
    get: async k => (saved.map.has(k) ? saved.map.get(k) : null),
    set: async (k, v) => { if (!saved.failSet) saved.map.set(k, v) }, // like the real one: a failed write is silent
    remove: async k => { saved.map.delete(k) },
  }) }
})

const seed = () => {
  localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: 'A', name: 'Work' }, { id: 'B', name: 'Home' }]))
  localStorage.setItem('nexusmd.activeProfileId', 'A')
  localStorage.setItem('md_documents', '{"docs":[{"id":"d1"}]}')
  localStorage.setItem('nexusmd.tweaks', '{"theme":"dark"}')
  localStorage.setItem('nexusmd.p.A.ado.pat', 'pat-A')
}

// What a child sees on its very first render.
let firstSeen = null
function Probe() {
  const [seen] = React.useState(() => ({
    doc: localStorage.getItem('nexusmd.p.A.md_documents'),
    globalDoc: localStorage.getItem('md_documents'),
    pat: secure.peek('nexusmd.p.A.ado.pat'),
  }))
  firstSeen = seen
  return <div>child</div>
}

let ProfileProvider, bootProfileData, secure
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  saved.map.clear()
  saved.failSet = false
  firstSeen = null
  ;({ ProfileProvider, bootProfileData } = await import('./profile-context.jsx'))
  ;({ secureStorageAdapter: secure } = await import('./adapters/secureStorage.js'))
})

describe('desktop ProfileProvider boot', () => {
  it('children mount only after the migration, with the data moved and the tokens loaded', async () => {
    seed()
    render(<ProfileProvider><Probe /></ProfileProvider>)
    await screen.findByText('child')
    expect(firstSeen).toEqual({ doc: '{"docs":[{"id":"d1"}]}', globalDoc: null, pat: 'pat-A' })
    expect(localStorage.getItem('nexusmd.p.B.tweaks')).toBe('{"theme":"dark"}')
    expect(localStorage.getItem('nexusmd.p.A.ado.pat')).toBeNull()
    expect(saved.map.get('nexusmd.p.A.ado.pat')).toBe('pat-A')
    expect(localStorage.getItem('nexusmd.migrated.v2')).toBe('1')
  })

  it('a failed migration is logged, changes nothing, sets no marker, and the app still starts', async () => {
    seed()
    saved.failSet = true
    const before = { ...localStorage }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ProfileProvider><Probe /></ProfileProvider>)
    await screen.findByText('child')
    expect({ ...localStorage }).toEqual(before)
    expect(localStorage.getItem('nexusmd.migrated.v2')).toBeNull()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('runs once however often it is asked', async () => {
    seed()
    const first = bootProfileData()
    expect(bootProfileData()).toBe(first)
    await first
    expect(localStorage.getItem('nexusmd.migrated.v2')).toBe('1')
    expect(localStorage.getItem('nexusmd.p.A.md_documents')).toBe('{"docs":[{"id":"d1"}]}')
  })

  it('with no profile yet nothing moves (the first profile adopts the flat keys, then the next start migrates)', async () => {
    localStorage.setItem('md_documents', '{"docs":[]}')
    render(<ProfileProvider><Probe /></ProfileProvider>)
    await waitFor(() => expect(firstSeen).not.toBeNull())
    expect(localStorage.getItem('md_documents')).toBe('{"docs":[]}')
    expect(localStorage.getItem('nexusmd.migrated.v2')).toBeNull()
  })
})

describe('desktop profile bundles', () => {
  it('a .nmdprofile export carries the profile’s secrets and an import writes them back into secure storage', async () => {
    const { useProfile } = await import('./profile-context.jsx')
    localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id: 'A', name: 'Work' }]))
    localStorage.setItem('nexusmd.activeProfileId', 'A')
    localStorage.setItem('nexusmd.migrated.v2', '1')
    // The encrypted store keeps each secret's ciphertext at nexusmd.sec.<name>.
    for (const [k, v] of [['nexusmd.p.A.ado.pat', 'pat-A'], ['nexusmd.account.session', 'sess']]) {
      saved.map.set(k, v); localStorage.setItem(`nexusmd.sec.${k}`, 'ciphertext')
    }
    const api = { current: null }
    function Grab() { api.current = useProfile(); return <div>child</div> }
    render(<ProfileProvider><Grab /></ProfileProvider>)
    await screen.findByText('child')
    const { text } = await api.current.exportBundle({ scope: 'A', password: 'pw' })
    saved.map.clear()
    const res = await api.current.importBundle({ text, password: 'pw' })
    expect(res.secrets).toBe(1)
    expect([...saved.map.entries()]).toEqual([['nexusmd.p.A.ado.pat', 'pat-A']])
  })
})
