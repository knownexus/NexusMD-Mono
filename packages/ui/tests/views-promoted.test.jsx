import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  NexusDataProvider, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
} from '../src/index.js'

afterEach(cleanup)

// The promoted views fetch from /api/* (web host) on mount; stub it so jsdom
// doesn't reject and the shell still renders its header.
beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), text: () => Promise.resolve('') }))
})

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } }
}

function renderWithData(ui, data = {}) {
  const value = {
    data: { ...EMPTY_NEXUS_DATA, ...data },
    api: { load: () => Promise.resolve() },
    storage: memStorage(),
    getProfileKey: (k) => k,
    namespace: 'nexusmd',
    googleAuth: null,
  }
  return render(<NexusDataProvider value={value}>{ui}</NexusDataProvider>)
}

describe('promoted views render through the data-context seam', () => {
  it('DashboardView renders its widgets with empty data (no SPRINT crash)', () => {
    const { container } = renderWithData(
      <DashboardView
        onOpenItem={() => {}} onOpenPR={() => {}}
        widgetOrder={['sprint', 'review', 'blockers']} setWidgetOrder={() => {}}
        widgetWidths={{}} setWidgetWidths={() => {}}
        widgetHeights={{}} setWidgetHeights={() => {}}
        needsMeCriteria={{ votes: [0] }} setPlannerData={() => {}}
        quickLinks={[]}
      />,
    )
    // The morning-view header is always present.
    expect(container.querySelector('.page-head')).toBeTruthy()
  })

  it('WorkItemsView renders the table header and a work item from props', () => {
    const items = [{
      id: 101, title: 'Wire the thing', type: 'task', state: 'To Do', project: 'proj',
      assigneeId: null, tags: [], priority: 2, changed: '2026-01-01',
    }]
    const { container } = renderWithData(
      <WorkItemsView items={items} setItems={() => {}} onOpen={() => {}} onCreate={() => {}} />,
      { STATES: ['To Do', 'In Progress', 'Done'], PROJECTS: [{ id: 'proj', name: 'Proj' }] },
    )
    expect(container.querySelector('.page-head')).toBeTruthy()
    expect(container.textContent).toContain('Wire the thing')
  })

  it('TriageView renders its header even when the triage API is unavailable', () => {
    const { container } = renderWithData(<TriageView />)
    expect(container.querySelector('.page-head h1')?.textContent).toBe('Triage')
  })
})
