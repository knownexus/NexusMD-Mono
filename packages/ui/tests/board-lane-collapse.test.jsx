import { it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

afterEach(cleanup)

const TEAM = [{ id: 'u1', name: 'Alex', initials: 'AL' }, { id: 'u2', name: 'Sam', initials: 'SA' }]
const base = { type: 'task', project: 'proj', priority: 2, points: 0, tags: [], comments: 0, prs: 0, updated: '1h' }
const ITEMS = [
  { ...base, id: 1, title: 'Alex todo', state: 'To Do', assignee: 'u1' },
  { ...base, id: 2, title: 'Alex doing', state: 'In Progress', assignee: 'u1' },
  { ...base, id: 3, title: 'Sam todo', state: 'To Do', assignee: 'u2' },
]

function renderBoard(storage) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM, PROJECTS: [] } }}>
      <WorkItemsView items={ITEMS} setItems={() => {}} onOpen={() => {}} team={TEAM} />
    </NexusDataProvider>
  )
}

const groupedStorage = () => memStorage({
  'nexusmd.wi.view': JSON.stringify('board'),
  'nexusmd.wi.boardGrouping': JSON.stringify('assignee'),
})

it('collapses one column inside one swimlane, leaving the rest alone', () => {
  const { container, getByText, queryByText } = renderBoard(groupedStorage())
  const boards = container.querySelectorAll('.board')
  const alexBoard = Array.from(boards).find(b => b.textContent.includes('Alex todo'))

  fireEvent.click(within(alexBoard).getByRole('button', { name: 'Collapse To Do' }))

  expect(queryByText('Alex todo')).toBeNull()
  expect(getByText('Alex doing')).toBeTruthy()
  expect(getByText('Sam todo')).toBeTruthy()
  // The collapsed lane still shows its name and count, and can be expanded again.
  const expand = within(alexBoard).getByRole('button', { name: 'Expand To Do' })
  expect(expand.closest('.lane').textContent).toContain('1')
  fireEvent.click(expand)
  expect(getByText('Alex todo')).toBeTruthy()
})

it('widens one column so its card titles stay on one line, and narrows it again', () => {
  const { container, getByText } = renderBoard(groupedStorage())
  const alexBoard = Array.from(container.querySelectorAll('.board')).find(b => b.textContent.includes('Alex todo'))

  fireEvent.click(within(alexBoard).getByRole('button', { name: 'Widen To Do' }))

  expect(getByText('Alex todo').style.whiteSpace).toBe('nowrap')
  expect(getByText('Alex doing').style.whiteSpace).toBe('')
  expect(getByText('Sam todo').style.whiteSpace).toBe('')
  expect(alexBoard.style.gridTemplateColumns.split(' ')[1]).toBe('max-content')

  fireEvent.click(within(alexBoard).getByRole('button', { name: 'Narrow To Do' }))
  expect(getByText('Alex todo').style.whiteSpace).toBe('')
})

it('remembers widened columns across renders', () => {
  const storage = groupedStorage()
  const first = renderBoard(storage)
  const alexBoard = Array.from(first.container.querySelectorAll('.board')).find(b => b.textContent.includes('Alex todo'))
  fireEvent.click(within(alexBoard).getByRole('button', { name: 'Widen To Do' }))
  cleanup()

  const { getByText } = renderBoard(storage)
  expect(getByText('Alex todo').style.whiteSpace).toBe('nowrap')
})

it('remembers collapsed columns across renders', () => {
  const storage = groupedStorage()
  const first = renderBoard(storage)
  const alexBoard = Array.from(first.container.querySelectorAll('.board')).find(b => b.textContent.includes('Alex todo'))
  fireEvent.click(within(alexBoard).getByRole('button', { name: 'Collapse To Do' }))
  cleanup()

  const { queryByText, getByText } = renderBoard(storage)
  expect(queryByText('Alex todo')).toBeNull()
  expect(getByText('Sam todo')).toBeTruthy()
})
