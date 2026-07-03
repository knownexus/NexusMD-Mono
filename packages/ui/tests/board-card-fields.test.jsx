import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Card field test', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 5, tags: ['alpha'], comments: 0, prs: 0, updated: '3h' }

afterEach(cleanup)

it('hides the points field on the board card when config hides it', () => {
  const storage = memStorage({
    'nexusmd.wi.view': JSON.stringify('board'),
    'nexusmd.fields.wiCard': JSON.stringify([{ key: 'points', visible: false }]),
  })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  expect(container.textContent).not.toContain('5 pts')
})

it('shows the points field on the board card by default', () => {
  const storage = memStorage({
    'nexusmd.wi.view': JSON.stringify('board'),
  })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [], PROJECTS: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  expect(container.textContent).toContain('5 pts')
})
