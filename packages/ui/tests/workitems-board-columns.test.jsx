// packages/ui/tests/workitems-board-columns.test.jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/toast.jsx', () => ({ toast, ToastHost: () => null }))

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const item = (key, state) => ({ id: `jira:${key}`, source: 'jira', displayId: key, type: 'story', title: `T ${key}`, project: 'abc', state, stateCategory: 'InProgress', assignee: null, priority: 3, points: 0, tags: [], comments: 0, prs: 0, updated: '1h' })
const COLUMNS = [
  { name: 'To Do', statuses: ['To Do'] },
  { name: 'In Progress', statuses: ['In Progress', 'Code Review'] },
  { name: 'Done', statuses: ['Done'] },
]
const JIRA_ONLY = [{ id: 'jira', label: 'Jira', status: 'ok', error: null, warning: null }]

function renderBoard({ items, columns = COLUMNS, source = {} } = {}) {
  const workItemSource = { saveField: vi.fn(async () => {}), ...source }
  render(
    <NexusDataProvider value={{
      storage: memStorage({ 'nexusmd.wi.view': JSON.stringify('board') }), getProfileKey: k => k, pushPref: () => {}, workItemSource,
      data: { ORG: 'o', TEAM: [], PROJECTS: [], WORK_ITEMS: items, WORK_ITEM_PROVIDERS: JIRA_ONLY, JIRA_BOARD_COLUMNS: columns, WI_TYPE_STATES_BY_SOURCE: { jira: {} } },
    }}>
      <WorkItemsView items={items} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  return workItemSource
}

const laneOf = (text) => screen.getByText(text).closest('.lane')
const laneHeads = () => Array.from(document.querySelectorAll('.lane .lane-head h4')).map(h => h.textContent)

afterEach(() => { cleanup(); toast.mockReset() })

it('renders the Jira board columns in order and places cards by status, case-insensitively', () => {
  renderBoard({ items: [item('A-1', 'code review'), item('A-2', 'To Do')] })
  expect(laneHeads()).toEqual(['To Do', 'In Progress', 'Done'])
  expect(laneOf('T A-1').querySelector('h4').textContent).toBe('In Progress')
  expect(laneOf('T A-2').querySelector('h4').textContent).toBe('To Do')
})

it('adds an Other lane only for statuses not on the board', () => {
  renderBoard({ items: [item('A-1', 'Blocked'), item('A-2', 'Done')] })
  expect(laneHeads()).toEqual(['To Do', 'In Progress', 'Done', 'Other'])
  cleanup()
  renderBoard({ items: [item('A-2', 'Done')] })
  expect(laneHeads()).not.toContain('Other')
})

it('falls back to status lanes when the board has no columns', () => {
  renderBoard({ items: [item('A-1', 'Doing')], columns: [] })
  expect(laneHeads()).not.toEqual(COLUMNS.map(c => c.name))
})

it('moves a card into a column through moveToStatuses with that column\'s statuses', async () => {
  const moveToStatuses = vi.fn(async () => ({ state: 'Done', stateCategory: 'Completed' }))
  renderBoard({ items: [item('A-1', 'In Progress')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[2], { dataTransfer: {} })
  await waitFor(() => expect(moveToStatuses).toHaveBeenCalledWith('jira:A-1', ['Done'], expect.objectContaining({ id: 'jira:A-1' })))
})

it('does nothing when a card is dropped into the column it is already in', async () => {
  const moveToStatuses = vi.fn()
  renderBoard({ items: [item('A-1', 'Code Review')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[1], { dataTransfer: {} })
  await new Promise(r => setTimeout(r, 0))
  expect(moveToStatuses).not.toHaveBeenCalled()
})

it('toasts when the move fails', async () => {
  const moveToStatuses = vi.fn(async () => { throw new Error('No transition from "In Progress" to any status in this column') })
  renderBoard({ items: [item('A-1', 'In Progress')], source: { moveToStatuses } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  fireEvent.drop(document.querySelectorAll('.lane')[2], { dataTransfer: {} })
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('No transition'), 'error'))
})

it('dims columns the workflow cannot reach', async () => {
  const availableTargetStates = vi.fn(async () => ['Done'])
  renderBoard({ items: [item('A-1', 'In Progress')], source: { availableTargetStates, moveToStatuses: vi.fn() } })
  fireEvent.dragStart(screen.getByText('T A-1').closest('.board-card'), { dataTransfer: { setData: () => {} } })
  await waitFor(() => expect(document.querySelectorAll('.lane')[0].style.opacity).toBe('0.4'))
  expect(document.querySelectorAll('.lane')[1].style.opacity).toBe('')
  expect(document.querySelectorAll('.lane')[2].style.opacity).toBe('')
})
