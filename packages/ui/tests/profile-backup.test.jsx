import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, useProfile, localUpsertProfiles, BackupRestoreCard } from '../src/index.js'

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
})
