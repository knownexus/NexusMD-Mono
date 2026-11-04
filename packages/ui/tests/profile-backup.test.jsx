import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, useProfile, localUpsertProfiles, BackupRestoreCard } from '../src/index.js'

const toasts = vi.hoisted(() => [])
vi.mock('../src/toast.jsx', async (orig) => ({ ...(await orig()), toast: (msg, type) => { toasts.push([type, msg]) } }))

afterEach(cleanup)

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null, _map: m,
  }
}
function harness(props) {
  const ref = { api: null }
  function Probe() { ref.api = useProfile(); return null }
  render(<ProfileProvider {...props}>{React.createElement(Probe)}</ProfileProvider>)
  return ref
}

describe('profile backup export/import (provider)', () => {
  it('exportBundle gathers a profile + its namespace-stripped data, encrypted', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
      'helm.activeProfileId': 'p1',
      'helm.p.p1.planner.week.2026-W26': '{"x":1}',
      'helm.p.p1.tweaks': '{"dark":true}',
      'helm.p.OTHER.tweaks': 'leaveme',
    })
    const ref = harness({ namespace: 'helm', storage, store: { create: vi.fn() } })
    const { filename, text } = await ref.api.exportBundle({ scope: 'all', password: 'pw' })
    expect(filename).toMatch(/^nexusmd-backup-\d{4}-\d{2}-\d{2}\.nmdprofile$/)
    // text is encrypted (no plaintext); decode via importing into a clean store proves round-trip:
    const store2 = makeStorage()
    const importer = vi.fn(async () => {})
    const ref2 = harness({ namespace: 'helm', storage: store2, store: { create: vi.fn(), importProfiles: importer } })
    const res = await ref2.api.importBundle({ text, password: 'pw' })
    expect(res.imported).toBe(1)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(store2.getItem('helm.p.p1.planner.week.2026-W26')).toBe('{"x":1}')
    expect(store2.getItem('helm.p.p1.tweaks')).toBe('{"dark":true}')
    expect(store2.getItem('helm.p.OTHER.tweaks')).toBeNull() // only the exported profile's keys
  })

  // A secure-storage fake: names() lists every stored secret, as the desktop's encrypted store does.
  function makeSecure(seed = {}) {
    const m = new Map(Object.entries(seed))
    return {
      _map: m,
      names: () => [...m.keys()],
      get: async (n) => (m.has(n) ? m.get(n) : null),
      set: async (n, v) => { m.set(n, String(v)) },
    }
  }
  const ONE = { 'nexusmd.profiles': JSON.stringify([{ id: 'p1', name: 'Work' }]), 'nexusmd.activeProfileId': 'p1' }

  it('a bundle carries the exported profiles’ secrets decrypted and import writes them back into secure storage', async () => {
    const storage = makeStorage({ ...ONE, 'nexusmd.p.p1.ado.org': 'acme' })
    const secure = makeSecure({
      'nexusmd.p.p1.ado.pat': 'pat-1',
      'nexusmd.p.p1.github.auth': '{"token":"gh"}',
      'nexusmd.p.p1.apiClient.secret.col.dev.token': 's3cret',
      'nexusmd.p.OTHER.ado.pat': 'not-mine',
      'nexusmd.account.session': 'never-exported',
    })
    const ref = harness({ namespace: 'nexusmd', storage, secure, store: { create: vi.fn() } })
    const { text } = await ref.api.exportBundle({ scope: 'p1', password: 'pw' })
    expect(text).not.toContain('pat-1')

    const storage2 = makeStorage()
    const secure2 = makeSecure()
    const ref2 = harness({ namespace: 'nexusmd', storage: storage2, secure: secure2, store: { create: vi.fn(), importProfiles: vi.fn(async () => {}) } })
    const res = await ref2.api.importBundle({ text, password: 'pw' })
    expect(res.secrets).toBe(3)
    expect([...secure2._map.entries()].sort()).toEqual([
      ['nexusmd.p.p1.ado.pat', 'pat-1'],
      ['nexusmd.p.p1.apiClient.secret.col.dev.token', 's3cret'],
      ['nexusmd.p.p1.github.auth', '{"token":"gh"}'],
    ])
    expect(storage2.getItem('nexusmd.p.p1.ado.org')).toBe('acme')
    // never written as plain storage
    expect([...storage2._map.keys()].some(k => k.endsWith('ado.pat'))).toBe(false)
  })

  it('an importer without secure storage skips the secrets in a file and never writes them as plain keys', async () => {
    const secure = makeSecure({ 'nexusmd.p.p1.ado.pat': 'pat-1' })
    const ref = harness({ namespace: 'nexusmd', storage: makeStorage(ONE), secure, store: { create: vi.fn() } })
    const { text } = await ref.api.exportBundle({ scope: 'all', password: 'pw' })
    const storage2 = makeStorage()
    const ref2 = harness({ namespace: 'nexusmd', storage: storage2, store: { create: vi.fn(), importProfiles: vi.fn(async () => {}) } })
    const res = await ref2.api.importBundle({ text, password: 'pw' })
    expect(res.secrets).toBe(0)
    expect([...storage2._map.values()]).not.toContain('pat-1')
  })

  it('a secret that does not save is reported, the rest still import', async () => {
    const secure = makeSecure({ 'nexusmd.p.p1.ado.pat': 'pat-1', 'nexusmd.p.p1.jira.apiToken': 'jt' })
    const ref = harness({ namespace: 'nexusmd', storage: makeStorage(ONE), secure, store: { create: vi.fn() } })
    const { text } = await ref.api.exportBundle({ scope: 'all', password: 'pw' })
    const secure2 = makeSecure()
    const realSet = secure2.set
    secure2.set = async (n, v) => { if (n.endsWith('ado.pat')) throw new Error('locked'); return realSet(n, v) }
    const ref2 = harness({ namespace: 'nexusmd', storage: makeStorage(), secure: secure2, store: { create: vi.fn(), importProfiles: vi.fn(async () => {}) } })
    const res = await ref2.api.importBundle({ text, password: 'pw' })
    expect(res.secrets).toBe(1)
    expect(res.secretsFailed).toEqual(['ado.pat'])
    expect(await secure2.get('nexusmd.p.p1.jira.apiToken')).toBe('jt')
  })

  it('localUpsertProfiles overwrites by id and adds new', () => {
    const storage = makeStorage({
      'nexusmd.profiles': JSON.stringify([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]),
    })
    localUpsertProfiles(storage, 'nexusmd',
      [{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }], 'c')
    const list = JSON.parse(storage.getItem('nexusmd.profiles'))
    expect(list.map(p => `${p.id}:${p.name}`)).toEqual(['a:A', 'b:B2', 'c:C'])
    expect(storage.getItem('nexusmd.activeProfileId')).toBe('c')
  })
})

describe('BackupRestoreCard', () => {
  it('exports all profiles to fileIO.saveFile after a password is entered', async () => {
    const storage = makeStorage({
      'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
      'helm.activeProfileId': 'p1',
      'helm.p.p1.tweaks': '{"dark":true}',
    })
    const saveFile = vi.fn(async () => {})
    const fileIO = { saveFile, pickFile: vi.fn() }

    function Tree() {
      return (
        <ProfileProvider namespace="helm" storage={storage} store={{ create: () => {} }}>
          <BackupRestoreCard fileIO={fileIO} />
        </ProfileProvider>
      )
    }
    const { getByText, container } = render(<Tree />)
    await act(async () => { getByText('Back up all profiles').click() })
    // password modal appears; type + confirm + submit
    const inputs = container.querySelectorAll('input[type="password"]')
    await act(async () => {
      inputs[0].value = 'pw'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].value = 'pw'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { getByText('Export').click() })
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(saveFile.mock.calls[0][0]).toMatch(/\.nmdprofile$/)
    expect(saveFile.mock.calls[0][1]).toContain('nexusmd-profile-bundle-enc')
  })

  it('restoring a file whose secrets do not all save says which sign-ins to redo', async () => {
    const reload = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0)
    try {
      const m = new Map([['nexusmd.p.p1.ado.pat', 'pat-1']])
      const secure = { names: () => [...m.keys()], get: async n => m.get(n) ?? null, set: async () => { throw new Error('locked') } }
      const storage = makeStorage({ 'nexusmd.profiles': JSON.stringify([{ id: 'p1', name: 'Work' }]), 'nexusmd.activeProfileId': 'p1' })
      let bundle = null
      const ref = harness({ namespace: 'nexusmd', storage, secure, store: { create: vi.fn() } })
      bundle = (await ref.api.exportBundle({ scope: 'all', password: 'pw' })).text
      cleanup()
      toasts.length = 0
      const fileIO = { saveFile: vi.fn(), pickFile: vi.fn(async () => bundle) }
      const { getByText, container } = render(
        <ProfileProvider namespace="nexusmd" storage={storage} secure={secure} store={{ create: () => {}, importProfiles: async () => {} }}>
          <BackupRestoreCard fileIO={fileIO} />
        </ProfileProvider>,
      )
      await act(async () => { getByText('Import / Restore from file').click() })
      const input = container.querySelector('input[type="password"]')
      await act(async () => { input.value = 'pw'; input.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => { getByText('Import').click() })
      await vi.waitFor(() => expect(toasts.some(([t]) => t === 'error')).toBe(true))
      expect(toasts.find(([t]) => t === 'error')[1]).toMatch(/1 saved sign-in or token could not be restored.*sign in again/i)
    } finally { reload.mockRestore() }
  })

  it('the card mentions saved tokens only where bundles carry them', () => {
    const storage = makeStorage({ 'nexusmd.profiles': JSON.stringify([{ id: 'p1', name: 'Work' }]) })
    const fileIO = { saveFile: vi.fn(), pickFile: vi.fn() }
    const secure = { names: () => [], get: async () => null, set: async () => {} }
    const a = render(<ProfileProvider namespace="nexusmd" storage={storage} secure={secure} store={{}}><BackupRestoreCard fileIO={fileIO} /></ProfileProvider>)
    expect(a.container.textContent).toMatch(/saved tokens and sign-ins/)
    cleanup()
    const b = render(<ProfileProvider namespace="nexusmd" storage={storage} store={{}}><BackupRestoreCard fileIO={fileIO} /></ProfileProvider>)
    expect(b.container.textContent).not.toMatch(/saved tokens/)
  })
})
