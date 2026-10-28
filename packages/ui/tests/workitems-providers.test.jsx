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

function renderView({ seed = {}, source = {}, items = [ADO_ITEM, JIRA_ITEM], providers = PROVIDERS, setItems = () => {}, data = {}, view = 'board' } = {}) {
  const storage = memStorage({ 'nexusmd.wi.view': JSON.stringify(view), ...seed })
  const workItemSource = { saveField: vi.fn(async () => {}), webUrl: (w) => (w.source === 'jira' ? `https://a.atlassian.net/browse/${w.displayId}` : null), ...source }
  render(
    <NexusDataProvider value={{
      storage, getProfileKey: k => k, pushPref: () => {}, workItemSource,
      data: {
        ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: items, WORK_ITEM_PROVIDERS: providers,
        WI_TYPE_STATES_BY_SOURCE: { jira: { story: ['To Do', 'In Progress', 'Done'] } },
        ...data,
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

it('shows the ADO PR warning pill in an ADO-only profile, but still no error pill', () => {
  const warning = 'PRs unavailable (HTTP 401) — check the ADO PAT has Code (Read) scope'
  renderView({ items: [ADO_ITEM], providers: [{ id: 'ado', label: 'Azure DevOps', status: 'stale', error: 'boom', warning }] })
  expect(screen.getByText(`Azure DevOps: ${warning}`)).toBeTruthy()
  expect(screen.queryByText(/Azure DevOps: boom/)).toBeNull()
})

it('uses the warning detail as the pill tooltip', () => {
  renderView({ items: [ADO_ITEM], providers: [{ id: 'ado', label: 'Azure DevOps', status: 'ok', error: null, warning: 'PRs unavailable (HTTP 500)', warningDetail: 'ADO GET x → 500' }] })
  expect(screen.getByText('Azure DevOps: PRs unavailable (HTTP 500)').getAttribute('title')).toBe('ADO GET x → 500')
})

it('shows no provider pills in an ADO-only profile without a warning', () => {
  renderView({ items: [ADO_ITEM], providers: [{ id: 'ado', label: 'Azure DevOps', status: 'stale', error: 'boom', warning: null }] })
  expect(screen.queryByText(/Azure DevOps:/)).toBeNull()
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

it('shows no provider status pill when only one provider is connected, even if it is stale', () => {
  renderView({ items: [ADO_ITEM], providers: [{ id: 'ado', label: 'Azure DevOps', status: 'stale', error: 'network down' }] })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByText(/showing cached/)).toBeNull()
})

it('bulk mark-done skips items already in the Completed category', async () => {
  const DONE_JIRA = { ...JIRA_ITEM, id: 'jira:ABC-2', displayId: 'ABC-2', title: 'Done story', state: 'Done', stateCategory: 'Completed' }
  const moveToCategory = vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' }))
  renderView({ view: 'table', items: [JIRA_ITEM, DONE_JIRA], source: { moveToCategory }, seed: { 'nexusmd.wi.grouping': '"none"' } })
  for (const title of ['Jira story', 'Done story']) {
    fireEvent.click(screen.getByText(title).closest('tr').querySelector('input[type="checkbox"]').closest('td'))
  }
  fireEvent.click(screen.getByRole('button', { name: /Mark done/ }))
  await waitFor(() => expect(moveToCategory).toHaveBeenCalledTimes(1))
  expect(moveToCategory).toHaveBeenCalledWith('jira:ABC-1', 'Completed', expect.objectContaining({ id: 'jira:ABC-1' }))
  expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('not marked done'), 'error')
})

it('does not sync Jira states or projects into ADO board columns when multiple providers are connected', async () => {
  const { storage } = renderView({
    seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"ado"' },
    data: {
      PROJECTS: [{ id: 'web', name: 'Web', source: 'ado' }, { id: 'abc', name: 'ABC', source: 'jira' }],
      WI_TYPE_STATES: { Bug: ['New', 'Active', 'Resolved'], story: ['Selected for Development'] },
      WI_TYPE_STATES_BY_SOURCE: { ado: { Bug: ['New', 'Active', 'Resolved'] }, jira: { story: ['Selected for Development'] } },
    },
  })
  await waitFor(() => expect(storage.getItem('nexusmd.wi.boardColumns')).toContain('Active'))
  const cfg = JSON.parse(storage.getItem('nexusmd.wi.boardColumns'))
  expect(JSON.stringify(cfg)).not.toContain('Selected for Development')
  expect(cfg.abc).toBeUndefined()
})

it('shows the provider status pill for a Jira-only profile whose load failed', () => {
  renderView({ items: [], providers: [{ id: 'jira', label: 'Jira', status: 'error', error: 'auth failed — check settings' }] })
  expect(screen.getByRole('status').textContent).toBe('Jira: auth failed — check settings')
})

it('recomputes stateCategory when a state-lane drop changes an item\'s state', async () => {
  const setItems = vi.fn()
  renderView({
    setItems,
    seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"jira"' },
    data: { STATE_CATEGORIES_BY_SOURCE: { ado: {}, jira: { 'To Do': 'Proposed', 'In Progress': 'InProgress', Done: 'Completed' } } },
  })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('In Progress').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(setItems).toHaveBeenCalled())
  const updater = setItems.mock.calls[0][0]
  const [next] = updater([JIRA_ITEM])
  expect(next).toMatchObject({ state: 'In Progress', stateCategory: 'InProgress' })
})

it('sets stateCategory to null when the new state has no known category', async () => {
  const setItems = vi.fn()
  renderView({
    setItems,
    seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"jira"' },
    data: { STATE_CATEGORIES_BY_SOURCE: { ado: {}, jira: {} } },
  })
  const card = screen.getByText('Jira story').closest('.board-card')
  const lane = screen.getAllByText('In Progress').map(n => n.closest('.lane')).find(Boolean)
  fireEvent.dragStart(card, { dataTransfer: { setData: () => {} } })
  fireEvent.drop(lane, { dataTransfer: {} })
  await waitFor(() => expect(setItems).toHaveBeenCalled())
  const [next] = setItems.mock.calls[0][0]([JIRA_ITEM])
  expect(next).toMatchObject({ state: 'In Progress', stateCategory: null })
})

it('shows a provider warning pill when the Jira board is unavailable', () => {
  renderView({ providers: [{ id: 'ado', label: 'Azure DevOps', status: 'ok', error: null, warning: null }, { id: 'jira', label: 'Jira', status: 'ok', error: null, warning: 'Jira board unavailable — using status columns' }] })
  expect(screen.getByText('Jira: Jira board unavailable — using status columns')).toBeTruthy()
})

const GH_ITEM = { id: 'gh:acme/web#4', source: 'github', displayId: 'acme/web#4', type: 'bug', title: 'GitHub issue', project: 'acme-web', state: 'Open', stateCategory: 'Proposed', assignee: null, priority: 3, points: 0, tags: [], comments: 0, prs: 0, updated: '3h' }
const GH_PROVIDERS = [...PROVIDERS, { id: 'github', label: 'GitHub', status: 'ok', error: null }]

it('in separate mode shows a GitHub tab with only GitHub items and Open/Closed lanes', () => {
  renderView({ items: [ADO_ITEM, JIRA_ITEM, GH_ITEM], providers: GH_PROVIDERS, seed: { 'nexusmd.wi.displayMode': '"separate"', 'nexusmd.wi.sourceTab': '"github"' } })
  expect(screen.getByRole('tab', { name: /GitHub/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('GitHub issue')).toBeTruthy()
  expect(screen.queryByText('ADO bug')).toBeNull()
  expect(screen.queryByText('Jira story')).toBeNull()
  expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)
})

it('shows Open/Closed state lanes for a GitHub-only profile', () => {
  renderView({ items: [GH_ITEM], providers: [{ id: 'github', label: 'GitHub', status: 'ok', error: null }], data: { WI_TYPE_STATES: { bug: ['Open', 'Closed'] } } })
  expect(screen.getByText('GitHub issue')).toBeTruthy()
  expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
  expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)
  expect(screen.queryByText('Proposed')).toBeNull()
})

it('labels GitHub items with a GitHub source badge when several providers are connected', () => {
  renderView({ items: [ADO_ITEM, GH_ITEM], providers: GH_PROVIDERS, view: 'list' })
  expect(document.querySelector('[data-source="github"]')?.textContent).toBe('GitHub')
})
