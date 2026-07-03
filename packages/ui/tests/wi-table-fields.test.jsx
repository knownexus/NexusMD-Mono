import { it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Row', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 5, tags: [], comments: 0, prs: 0, updated: '3h' }

afterEach(cleanup)

it('omits the Project column header when hidden by config', () => {
  const storage = memStorage({ 'nexusmd.fields.wiTable': JSON.stringify([{ key: 'project', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  const thead = container.querySelector('table.table thead')
  expect(thead.textContent).not.toContain('Project')
})

it('shows the Project column header by default', () => {
  const storage = memStorage({})
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  const thead = container.querySelector('table.table thead')
  expect(thead.textContent).toContain('Project')
})
