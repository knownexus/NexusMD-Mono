import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, EMPTY_NEXUS_DATA, DashboardView } from '../src/index.js'

afterEach(cleanup)
beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), text: () => Promise.resolve('') }))
})

function memStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } }
}

const ADO_123 = { id: 123, source: 'ado', title: 'ADO item 123', state: 'Active', assignee: 'alex', priority: 2, tags: [] }
const JIRA_1 = { id: 'jira:NX-1', source: 'jira', displayId: 'NX-1', title: 'Follow up #123', state: 'In Dev', stateCategory: 'InProgress', assignee: 'sam', priority: 3, tags: [] }

function renderDashboard(activity, onOpenItem) {
  const value = {
    data: { ...EMPTY_NEXUS_DATA, WORK_ITEMS: [ADO_123, JIRA_1], ACTIVITY: activity },
    api: { load: () => Promise.resolve() },
    storage: memStorage(),
    getProfileKey: (k) => k,
    namespace: 'nexusmd',
    googleAuth: null,
  }
  return render(
    <NexusDataProvider value={value}>
      <DashboardView
        onOpenItem={onOpenItem} onOpenPR={() => {}}
        widgetOrder={['activity']} setWidgetOrder={() => {}}
        widgetWidths={{}} setWidgetWidths={() => {}}
        widgetHeights={{}} setWidgetHeights={() => {}}
        needsMeCriteria={{ votes: [0] }} setPlannerData={() => {}}
        quickLinks={[]}
      />
    </NexusDataProvider>,
  )
}

const rowOf = (text) => screen.getByText(text, { exact: false }).closest('.activity-item')

describe('Recent activity rows', () => {
  it('opens a Jira item by its id, not an ADO item whose number appears in the title', () => {
    const onOpenItem = vi.fn()
    renderDashboard([{ id: 'jira:NX-1', who: 'sam', action: 'is working on', what: 'NX-1 Follow up #123', when: '1m' }], onOpenItem)
    fireEvent.click(rowOf('NX-1 Follow up'))
    expect(onOpenItem).toHaveBeenCalledTimes(1)
    expect(onOpenItem.mock.calls[0][0].id).toBe('jira:NX-1')
  })

  it('still falls back to the #number in the text for entries without an id', () => {
    const onOpenItem = vi.fn()
    renderDashboard([{ who: 'alex', action: 'is working on', what: '#123 ADO item 123', when: '1m' }], onOpenItem)
    fireEvent.click(rowOf('#123 ADO item'))
    expect(onOpenItem.mock.calls[0][0].id).toBe(123)
  })
})
