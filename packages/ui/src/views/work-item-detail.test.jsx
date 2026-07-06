import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WorkItemFieldsEditor } from './work-item-detail.jsx'
import { NexusDataProvider } from '../data-context.jsx'

afterEach(cleanup)

function renderEditor({ item, workItemSource, onItemUpdated = vi.fn() }) {
  const data = {
    STATES: ['To Do', 'Active', 'Done'],
    TEAM: [{ id: 'u1', name: 'Alex' }, { id: 'u2', name: 'Sam' }],
    WORK_ITEMS: [],
  }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  return render(
    <NexusDataProvider value={{ data, storage, getProfileKey: k => k, pushPref: () => {}, workItemSource }}>
      <WorkItemFieldsEditor item={item} onItemUpdated={onItemUpdated} />
    </NexusDataProvider>
  )
}

describe('WorkItemFieldsEditor', () => {
  it('renders current State/Assignee/Priority values', () => {
    renderEditor({ item: { id: 1, state: 'Active', assignee: 'u1', priority: 2, area: '', tags: [] } })
    expect(screen.getByDisplayValue('Active')).toBeTruthy()
    expect(screen.getByDisplayValue('Alex')).toBeTruthy()
    expect(screen.getByDisplayValue('2 – High')).toBeTruthy()
  })

  it('saves a State change optimistically and calls onItemUpdated on success', async () => {
    const saveField = vi.fn().mockResolvedValue()
    const onItemUpdated = vi.fn()
    renderEditor({
      item: { id: 1, state: 'To Do', assignee: null, priority: 3, area: '', tags: [] },
      workItemSource: { saveField },
      onItemUpdated,
    })
    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'Active' } })
    await waitFor(() => expect(saveField).toHaveBeenCalledWith(1, 'System.State', 'Active'))
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalledWith({ state: 'Active' }))
  })

  it('rolls back the State select on save failure', async () => {
    const saveField = vi.fn().mockRejectedValue(new Error('boom'))
    renderEditor({
      item: { id: 1, state: 'To Do', assignee: null, priority: 3, area: '', tags: [] },
      workItemSource: { saveField },
    })
    fireEvent.change(screen.getByDisplayValue('To Do'), { target: { value: 'Active' } })
    await waitFor(() => expect(saveField).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByDisplayValue('To Do')).toBeTruthy())
  })
})
