import { it, expect, afterEach, vi } from 'vitest'
import { act, render, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

// Lets every promise callback already queued run (setImmediate comes after them all): ordering, not a wait on the clock.
const flushPromises = () => act(() => new Promise(r => setImmediate(r)))

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'x', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '3h' }

function renderView(props) {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify('table') })
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} {...props} />
    </NexusDataProvider>
  )
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('hides the load-more bar and never calls serverSearch when no fetcher is injected (desktop)', async () => {
  const search = vi.fn()
  const { container } = renderView({}) // no serverSearch
  // Give the auto-fill effect a chance to (not) fire.
  await flushPromises()
  expect(search).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('more may exist')
  expect(container.textContent).not.toContain('Load more')
})

it('shows the load-more bar and paginates via serverSearch when a fetcher is injected', async () => {
  const search = vi.fn(async () => ({ workItems: [], totalMatched: 1, hasMore: false }))
  const { container } = renderView({ serverSearch: search })
  await waitFor(() => expect(search).toHaveBeenCalled())
  expect(search.mock.calls[0][0]).toMatchObject({ top: 300, skip: 1 })
})
