import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemFieldsEditor } from '../src/index.js'

vi.mock('../src/toast.jsx', () => ({ toast: vi.fn(), ToastHost: () => null }))

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const DATA = {
  STATES: ['New', 'Active', 'Closed', 'To Do', 'In Progress', 'Done'],
  TEAM: [{ id: 'alex-doe', name: 'Alex Doe' }, { id: 'ado-only', name: 'Ado Only' }],
  WORK_ITEMS: [],
  WI_TYPE_STATES_BY_SOURCE: { jira: { story: ['To Do', 'In Progress', 'Done'] }, ado: { bug: ['New', 'Closed'] } },
  PRIORITIES_BY_SOURCE: { jira: [{ id: '1', name: 'Highest', rank: 1 }, { id: '2', name: 'High', rank: 2 }] },
  JIRA_PEOPLE: [{ accountId: 'a1', displayName: 'Alex Doe' }, { accountId: 'j1', displayName: 'Jira Person' }],
}

function renderEditor(item, saveField = vi.fn(async () => {})) {
  render(
    <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, data: DATA, workItemSource: { saveField } }}>
      <WorkItemFieldsEditor item={item} />
    </NexusDataProvider>
  )
  return saveField
}

afterEach(() => cleanup())

const JIRA = { id: 'jira:ABC-1', source: 'jira', type: 'story', state: 'To Do', priority: 2, priorityName: 'High', assignee: null, tags: [] }

it('offers the Jira item type\'s states and Jira priority names, and hides Area', () => {
  renderEditor(JIRA)
  const selects = screen.getAllByRole('combobox')
  const stateOpts = Array.from(selects[0].options).map(o => o.value)
  expect(stateOpts).toEqual(['To Do', 'In Progress', 'Done'])
  expect(screen.getByRole('option', { name: 'High' })).toBeTruthy()
  expect(screen.queryByText('Area')).toBeNull()
})

it('lists Jira-assignable people and saves by display name', async () => {
  const saveField = renderEditor(JIRA)
  const assignee = screen.getAllByRole('combobox')[1]
  expect(Array.from(assignee.options).map(o => o.textContent)).toEqual(['Unassigned', 'Alex Doe', 'Jira Person'])
  fireEvent.change(assignee, { target: { value: 'Jira Person' } })
  await waitFor(() => expect(saveField).toHaveBeenCalledWith('jira:ABC-1', 'System.AssignedTo', 'Jira Person'))
})

it('saves a Jira priority by rank', async () => {
  const saveField = renderEditor(JIRA)
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: '1' } })
  await waitFor(() => expect(saveField).toHaveBeenCalledWith('jira:ABC-1', 'Microsoft.VSTS.Common.Priority', 1))
})

it('leaves ADO items as they were', () => {
  renderEditor({ id: 7, source: 'ado', type: 'bug', state: 'Active', priority: 2, assignee: null, tags: [] })
  expect(screen.getByText('Area')).toBeTruthy()
  expect(screen.getByRole('option', { name: '2 – High' })).toBeTruthy()
})

it('gives ADO items exactly the global STATES (no per-type list, no prepend)', () => {
  renderEditor({ id: 8, source: 'ado', type: 'bug', state: 'Resolved', priority: 2, assignee: null, tags: [] })
  const stateOpts = Array.from(screen.getAllByRole('combobox')[0].options).map(o => o.value)
  expect(stateOpts).toEqual(DATA.STATES)
})
