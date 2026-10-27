import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WorkItemsView } from './view-workitems.jsx'
import { NexusDataProvider } from '../data-context.jsx'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }
}

const TEAM = [
  { id: 'amy', name: 'Amy Adams', initials: 'AA' },
  { id: 'phil', name: 'Phil Smyth', initials: 'PS' },
]
const wi = (id, assignee) => ({ id, title: `Item ${id}`, state: 'Active', type: 'task', priority: 2, project: 'p1', assignee, tags: [] })
const items = [wi(1, 'amy'), wi(2, 'amy'), wi(3, 'phil')]

function renderView(storage) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {},
      data: { ORG: 'o', TEAM, PROJECTS: [{ id: 'p1', name: 'P1' }], STATES: ['Active'], PRS: [] } }}>
      <WorkItemsView items={items} setItems={vi.fn()} onOpen={vi.fn()} onCreate={vi.fn()} />
    </NexusDataProvider>
  )
}

// Group header rows in the table, top to bottom.
const tableGroups = (container) =>
  [...container.querySelectorAll('tbody tr')].filter(tr => tr.style.background).map(tr => [...tr.querySelectorAll('span')].find(s => !s.children.length && !s.className)?.textContent)

describe('Work Items group order', () => {
  it('moves a group to the top and saves the order', () => {
    const storage = memStorage()
    const { container } = renderView(storage)
    // Default order follows the sort (newest id first), so Phil's #3 puts him on top.
    expect(tableGroups(container)).toEqual(['Phil Smyth', 'Amy Adams'])

    fireEvent.click(screen.getByTitle('Order the groups'))
    const amyRow = screen.getAllByText('Amy Adams').find(el => el.closest('[draggable]') && !el.closest('tr')).closest('[draggable]')
    fireEvent.click(within(amyRow).getByTitle('Move to top'))

    expect(tableGroups(container)).toEqual(['Amy Adams', 'Phil Smyth'])
    expect(JSON.parse(storage.getItem('nexusmd.wi.groupOrder'))).toEqual({ assignee: { mode: 'custom', keys: ['amy', 'phil'] } })
  })

  it('uses a saved order on load', () => {
    const storage = memStorage({ 'nexusmd.wi.groupOrder': JSON.stringify({ assignee: { mode: 'name' } }) })
    const { container } = renderView(storage)
    expect(tableGroups(container)).toEqual(['Amy Adams', 'Phil Smyth'])
  })
})
