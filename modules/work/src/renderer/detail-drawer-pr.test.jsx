import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ value: [] }), text: async () => '' }))
vi.mock('./ado-client.js', () => ({ createAdoHttpAdapter: () => ({ fetch }), getAdoConfig: () => ({ org: 'myorg' }) }))

import { createOfflineQueue } from '@nexusmd/core'
import { NexusDataProvider, ToastHost, QUEUED_TOAST } from '@nexusmd/ui'
import { DetailDrawer } from './detail-drawer.jsx'
import { makeOfflineSender } from './offline.js'

afterEach(() => { cleanup(); fetch.mockClear() })

const value = { data: { ME: { adoId: 'me-1' } }, workItemSource: { webUrl: () => null }, githubHttp: { fetch: vi.fn() } }
const pr = { id: 7, status: 'active', title: 'T', repoId: 'r1', project: 'Proj', url: 'u' }
const mount = (p, onPRChanged) => render(
  <NexusDataProvider value={value}>
    <DetailDrawer drawer={{ kind: 'pr', data: p }} onClose={() => {}} onPRChanged={onPRChanged} />
  </NexusDataProvider>,
)

describe('PR actions in the drawer', () => {
  it('approves an open PR as the current user', async () => {
    const onPRChanged = vi.fn()
    mount(pr, onPRChanged)
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => expect(onPRChanged).toHaveBeenCalledWith(7, { myVote: 10 }))
    expect(fetch.mock.calls.some(([p, o]) => p.includes('reviewers/me-1') && o?.method === 'PUT')).toBe(true)
  })
  it('closes an open merge dialog when the drawer switches to another PR', async () => {
    const view = p => (
      <NexusDataProvider value={value}>
        <DetailDrawer drawer={{ kind: 'pr', data: p }} onClose={() => {}} onPRChanged={() => {}} />
      </NexusDataProvider>
    )
    const { rerender } = render(view(pr))
    fireEvent.click(screen.getByText('Merge'))
    await screen.findByRole('dialog')
    rerender(view({ ...pr, id: 8, title: 'Other' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('offers no Approve on a merged PR', () => {
    mount({ ...pr, status: 'merged' }, vi.fn())
    expect(screen.queryByText('Approve')).toBeNull()
  })
})

describe('PR votes with the desktop offline queue', () => {
  // The queue the shell gives Work, over Work's own sender, as on desktop.
  function withQueue(online) {
    const send = makeOfflineSender({ adoHttp: { fetch }, githubHttp: () => null, workItemSource: () => ({}) })
    const store = new Map()
    const offlineQueue = createOfflineQueue({
      storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      key: () => 'q',
      handlers: Object.fromEntries(['ado-vote', 'ado-comment', 'github-vote', 'github-comment', 'work-state'].map(k => [k, p => send(k, p)])),
      isOnline: () => online,
    })
    return offlineQueue
  }
  const mountQ = (offlineQueue, onPRChanged = vi.fn()) => render(
    <NexusDataProvider value={{ ...value, offlineQueue }}>
      <DetailDrawer drawer={{ kind: 'pr', data: pr }} onClose={() => {}} onPRChanged={onPRChanged} />
      <ToastHost />
    </NexusDataProvider>,
  )

  it('offline, the vote is kept and the queued toast shows', async () => {
    const q = withQueue(false)
    const onPRChanged = vi.fn()
    mountQ(q, onPRChanged)
    fireEvent.click(screen.getByText('Approve'))
    expect(await screen.findByText(QUEUED_TOAST)).toBeTruthy()
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(false)
    expect(q.list()).toMatchObject([{ kind: 'ado-vote', payload: { pr: { id: 7, project: 'Proj', repoId: 'r1' }, vote: 10, adoId: 'me-1' } }])
    expect(onPRChanged).toHaveBeenCalledWith(7, { myVote: 10 })
  })

  it('a provider rejection is shown, not queued', async () => {
    const ordinary = fetch.getMockImplementation()
    fetch.mockImplementation(async (p, o) => (o?.method === 'PUT'
      ? { ok: false, status: 409, json: async () => ({}), text: async () => JSON.stringify({ message: 'TF401019: conflict' }) }
      : ordinary(p, o)))
    try {
      const q = withQueue(true)
      mountQ(q)
      fireEvent.click(screen.getByText('Approve'))
      expect(await screen.findByText('Approve failed: TF401019: conflict')).toBeTruthy()
      expect(q.count()).toBe(0)
    } finally { fetch.mockImplementation(ordinary) }
  })
})
