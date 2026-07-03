import { it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const PR = { id: 3, title: 'Fix', author: 'a', authorName: 'Alice', status: 'active', branch: 'fix/x', age: '2d', additions: 5, deletions: 2, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: 'success' }

afterEach(cleanup)

it('hides the branch on a PR card when config hides it', () => {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all'), 'nexusmd.fields.prCard': JSON.stringify([{ key: 'branch', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={[PR]} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).not.toContain('fix/x')
})

it('shows the branch on a PR card by default (positive control)', () => {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all'), 'nexusmd.fields.prCard': JSON.stringify([]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={[PR]} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).toContain('fix/x')
})

it('does not render an orphaned trailing separator when a sub-field renders nothing (no linked work items)', () => {
  const storage = memStorage({ 'nexusmd.pr.filter': JSON.stringify('all'), 'nexusmd.fields.prCard': JSON.stringify([]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={[PR]} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
  const sub = container.querySelector('.pr-sub')
  expect(sub.textContent.trim().endsWith('·')).toBe(false)
})
