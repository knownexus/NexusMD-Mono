import { it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const PRS = [
  { id: 55, title: 'Linked PR', status: 'active', branch: 'a', age: '1d', author: 'x', authorName: 'X', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [{ id: 7 }], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 56, title: 'Other PR', status: 'active', branch: 'b', age: '1d', author: 'y', authorName: 'Y', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
]

beforeEach(() => { window.NexusMDNav = { pendingFilter: { workItemId: 7 } }; })
afterEach(() => { window.NexusMDNav = null; cleanup(); })

function renderView() {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all') })
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={PRS} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
}

it('shows only PRs linked to the focused work item, with a banner', () => {
  const { container } = renderView()
  expect(container.textContent).toContain('Linked PR')
  expect(container.textContent).not.toContain('Other PR')
  expect(container.textContent).toContain('#7')          // banner references the work item
})

it('Clear restores the full list', () => {
  const { container, getByText } = renderView()
  fireEvent.click(getByText('Clear'))
  expect(container.textContent).toContain('Other PR')
})
