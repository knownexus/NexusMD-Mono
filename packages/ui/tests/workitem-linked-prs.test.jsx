import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Linked item', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '3h' }
const PRS = [{ id: 55, title: 'Fix', status: 'active', linkedWorkItems: [{ id: 7 }] }]

afterEach(cleanup)

it('renders a clickable PR indicator that navigates to the PR view filtered to the work item', () => {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify('board') })
  const onOpen = vi.fn()
  const events = []
  const listener = e => events.push(e.detail)
  window.addEventListener('nexusmd:navigate', listener)
  try {
    const { container } = render(
      <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [], PRS } }}>
        <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={onOpen} team={[]} />
      </NexusDataProvider>
    )
    const card = container.querySelector('.board .board-card')
    const prBtn = Array.from(card.querySelectorAll('button')).find(b => b.title === 'View linked pull requests')
    expect(prBtn).toBeTruthy()          // indicator shows because PRS links WI #7
    expect(prBtn.textContent).toContain('1')
    fireEvent.click(prBtn)
    expect(events).toContainEqual({ view: 'prs', filter: { workItemId: 7 } })
    expect(onOpen).not.toHaveBeenCalled()   // clicking the PR indicator doesn't open the card
  } finally {
    window.removeEventListener('nexusmd:navigate', listener)
  }
})
