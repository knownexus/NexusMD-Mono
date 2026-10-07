import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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

function renderDashboard(data) {
  const value = {
    data: { ...EMPTY_NEXUS_DATA, ...data },
    api: { load: () => Promise.resolve() },
    storage: memStorage(),
    getProfileKey: (k) => k,
    namespace: 'nexusmd',
    googleAuth: null,
  }
  return render(
    <NexusDataProvider value={value}>
      <DashboardView
        onOpenItem={() => {}} onOpenPR={() => {}}
        widgetOrder={['blockers']} setWidgetOrder={() => {}}
        widgetWidths={{}} setWidgetWidths={() => {}}
        widgetHeights={{}} setWidgetHeights={() => {}}
        needsMeCriteria={{ votes: [0] }} setPlannerData={() => {}}
        quickLinks={[]}
      />
    </NexusDataProvider>,
  )
}

const jira = (n, state, stateCategory, extra = {}) => ({
  id: `jira:NX-${n}`, displayId: `NX-${n}`, key: `NX-${n}`, source: 'jira', type: 'story',
  title: `Item ${n}`, state, stateCategory, assignee: 'alex', priority: 3, tags: [], ...extra,
})

const statValue = (container, title) => container.querySelector(`[title="${title}"] .stat-value`)?.textContent

describe('DashboardView counts Jira work items', () => {
  it('shows non-zero Active, Needs review and Blockers counts for Jira statuses', () => {
    const { container } = renderDashboard({
      WORK_ITEMS: [
        jira(1, 'In Dev', 'InProgress'),
        jira(2, 'Design', 'InProgress'),
        jira(3, 'In QA', 'InProgress'),
        jira(4, 'To Do', 'Proposed'),
        jira(5, 'In Dev', 'InProgress', { flagged: true }),
      ],
    })
    expect(statValue(container, 'Open active work items')).toBe('2')
    expect(statValue(container, 'Open work items in review')).toBe('1')
    expect(statValue(container, 'Open all blocked work items')).toBe('1')
  })
})
