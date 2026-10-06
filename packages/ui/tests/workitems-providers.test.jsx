import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView, WorkItemIdLink } from '../src/index.js'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/toast.jsx', () => ({ toast, ToastHost: () => null }))

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const ADO_ITEM = { id: 7, source: 'ado', displayId: '#7', type: 'bug', title: 'ADO bug', project: 'web', state: 'Active', stateCategory: 'InProgress', assignee: null, priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '1h' }
const JIRA_ITEM = { id: 'jira:ABC-1', source: 'jira', displayId: 'ABC-1', type: 'story', title: 'Jira story', project: 'abc', state: 'To Do', stateCategory: 'Proposed', assignee: null, priority: 3, points: 0, tags: [], comments: 0, prs: 0, updated: '2h' }
const PROVIDERS = [
  { id: 'ado', label: 'Azure DevOps', status: 'ok', error: null },
  { id: 'jira', label: 'Jira', status: 'stale', error: 'auth failed — check settings' },
]

function renderView({ seed = {}, source = {}, items = [ADO_ITEM, JIRA_ITEM], providers = PROVIDERS, setItems = () => {} } = {}) {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify('board'), ...seed })
  const workItemSource = { saveField: vi.fn(async () => {}), webUrl: (w) => (w.source === 'jira' ? `https://a.atlassian.net/browse/${w.displayId}` : null), ...source }
  render(
    <NexusDataProvider value={{
      storage, getProfileKey: k => k, pushPref: () => {}, workItemSource,
      data: {
        ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: items, WORK_ITEM_PROVIDERS: providers,
        WI_TYPE_STATES_BY_SOURCE: { jira: { story: ['To Do', 'In Progress', 'Done'] } },
      },
    }}>
      <WorkItemsView items={items} setItems={setItems} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  return { workItemSource, storage }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); toast.mockReset() })

it('shows category lanes on the merged board when two providers are connected', () => {
  renderView()
  for (const label of ['Proposed', 'In Progress', 'Resolved', 'Completed']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByText('ADO bug')).toBeTruthy()
  expect(screen.getByText('Jira story')).toBeTruthy()
})

it('shows the provider status pill for a stale provider', () => {
  renderView()
  expect(screen.getByText('Jira: auth failed — check settings (showing cached)')).toBeTruthy()
})

it('in separate mode shows source tabs and only that source\'s items, with its real states as lanes', () => {
  renderView({ seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"jira"' } })
  expect(screen.getByRole('tab', { name: /Jira/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('ADO bug')).toBeNull()
  expect(screen.getByText('Jira story')).toBeTruthy()
  expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('tab', { name: /Azure DevOps/ }))
  expect(screen.getByRole('tab', { name: /Azure DevOps/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByText('Jira story')).toBeNull()
})

it('keeps today\'s single-provider UI when only one provider is connected', () => {
  renderView({ items: [ADO_ITEM], providers: [PROVIDERS[0]] })
  expect(screen.queryByRole('group', { name: 'Display mode' })).toBeNull()
  expect(screen.queryByText('Proposed')).toBeNull()
})

it('moves a card by category on drop and applies the returned state', async () => {
  const moveToCategory = vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' }))
  const setItems = vi.fn()
  renderView({ source: { moveToCategory }, setItems })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('Completed').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(moveToCategory).toHaveBeenCalledWith('jira:ABC-1', 'Completed', expect.objectContaining({ id: 'jira:ABC-1' })))
  await waitFor(() => expect(setItems).toHaveBeenCalled())
})

it('toasts and leaves the card when a category move fails', async () => {
  const moveToCategory = vi.fn(async () => { throw new Error('No transition from "To Do" to "Completed" in this workflow') })
  renderView({ source: { moveToCategory } })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('Completed').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('No transition'), 'error'))
})

it('renders Jira keys and links via the source', () => {
  const storage = memStorage()
  render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, data: { ORG: 'o', WORK_ITEM_PROVIDERS: PROVIDERS }, workItemSource: { webUrl: () => 'https://a.atlassian.net/browse/ABC-1' } }}>
      <WorkItemIdLink w={JIRA_ITEM} />
    </NexusDataProvider>
  )
  const link = screen.getByText('ABC-1')
  expect(link.getAttribute('href')).toBe('https://a.atlassian.net/browse/ABC-1')
  expect(screen.getByText('Jira')).toBeTruthy()
})
