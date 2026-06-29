import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { ProfileProvider, BackupRestoreCard } from '../src/index.js'

afterEach(cleanup)

function makeStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null,
  }
}

function provStub(over = {}) {
  return {
    id: 'gdrive', label: 'Google Drive',
    isConnected: () => true,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    list: vi.fn(async () => [{ id: 'a', name: 'nexusmd-backup-2026-06-29.nmdprofile', modifiedAt: '2026-06-29T10:00:00Z' }]),
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => ''),
    ...over,
  }
}

function harness(provider) {
  const storage = makeStorage({
    'helm.profiles': JSON.stringify([{ id: 'p1', name: 'Work', initials: 'WK', color: '#000', type: 'manual' }]),
    'helm.activeProfileId': 'p1',
    'helm.p.p1.tweaks': '{"dark":true}',
  })
  const ui = render(
    <ProfileProvider namespace="helm" storage={storage} store={{ create: () => {} }}>
      <BackupRestoreCard fileIO={{ saveFile: vi.fn(), pickFile: vi.fn() }} cloudProviders={[provider]} />
    </ProfileProvider>,
  )
  return ui
}

describe('BackupRestoreCard cloud actions', () => {
  it('uploads an encrypted bundle to a connected provider after a password', async () => {
    const provider = provStub()
    const { getByText, container } = harness(provider)
    await act(async () => { getByText('Save backup to Google Drive').click() })
    const inputs = container.querySelectorAll('input[type="password"]')
    await act(async () => {
      inputs[0].value = 'pw'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      inputs[1].value = 'pw'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { getByText('Export').click() })
    await vi.waitFor(() => expect(provider.upload).toHaveBeenCalledTimes(1))
    expect(provider.upload.mock.calls[0][0]).toMatch(/\.nmdprofile$/)
    expect(provider.upload.mock.calls[0][1]).toContain('nexusmd-profile-bundle-enc')
  })

  it('lists cloud files when Restore is clicked', async () => {
    const provider = provStub()
    const { getByText } = harness(provider)
    await act(async () => { getByText('Restore from Google Drive').click() })
    await vi.waitFor(() => expect(provider.list).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(getByText('nexusmd-backup-2026-06-29.nmdprofile')).toBeTruthy())
  })
})
