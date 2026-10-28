import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ value: [] }), text: async () => '' }))
vi.mock('./ado-client.js', () => ({ createAdoHttpAdapter: () => ({ fetch }), getAdoConfig: () => ({ org: 'myorg' }) }))

import { NexusDataProvider } from '@nexusmd/ui'
import { DetailDrawer } from './detail-drawer.jsx'

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
