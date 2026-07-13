import { it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const PRS = [
  { id: 1, title: 'My PR', status: 'active', branch: 'a', age: '1d', author: 'me', authorName: 'Me', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 2, title: 'Alice PR', status: 'active', branch: 'b', age: '1d', author: 'alice', authorName: 'Alice', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 3, title: 'Alice draft PR', status: 'draft', draft: true, branch: 'c', age: '1d', author: 'alice', authorName: 'Alice', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
]

function renderView(storageSeed) {
  const storage = memStorage(storageSeed)
  return render(
    <NexusDataProvider value={{
      storage, getProfileKey: k => k, pushPref: () => {},
      data: { ORG: 'o', TEAM: [], ME: { id: 'me', name: 'Me', initials: 'ME' } },
    }}>
      <PRView prs={PRS} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
}

it('Team activity chip shows active PRs not authored by me, excluding drafts by default', () => {
  const { container, getByText } = renderView({ 'nexusmd.pr.filter': JSON.stringify('all') })
  fireEvent.click(getByText('Team activity'))
  expect(container.textContent).toContain('Alice PR')
  expect(container.textContent).not.toContain('My PR')
  expect(container.textContent).not.toContain('Alice draft PR')
})

it('Team activity gear popover toggles Include drafts and the list updates', () => {
  const { container, getByText, getAllByTitle } = renderView({ 'nexusmd.pr.filter': JSON.stringify('all') })
  fireEvent.click(getByText('Team activity'))
  fireEvent.click(getAllByTitle('Customise criteria')[1])
  fireEvent.click(getByText('Include drafts'))
  fireEvent.click(getByText('Only active PRs'))
  expect(container.textContent).toContain('Alice draft PR')
})
