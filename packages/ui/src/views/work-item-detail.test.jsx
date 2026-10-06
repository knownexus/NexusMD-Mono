import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WorkItemFieldsEditor, WorkItemDetail } from './work-item-detail.jsx'
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

function renderDetail({ id, detail }) {
  const workItemSource = {
    loadDetail: vi.fn().mockResolvedValue(detail),
    loadComments: vi.fn().mockResolvedValue([]),
    webUrl: (item) => (String(item.id).startsWith('jira:') ? `https://a.atlassian.net/browse/${item.id.slice(5)}` : `https://ado/${item.id}`),
  }
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  return render(
    <NexusDataProvider value={{ data: { WORK_ITEMS: [] }, storage, getProfileKey: k => k, pushPref: () => {}, workItemSource }}>
      <WorkItemDetail id={id} />
    </NexusDataProvider>
  )
}

describe('WorkItemDetail — Jira fields that cannot round-trip', () => {
  it('renders a Jira description containing an image read-only with an "Edit in Jira" link', async () => {
    renderDetail({ id: 'jira:IMG-1', detail: { description: '<p>See <img src="x.png"></p>', acceptanceCriteria: '<p>plain AC</p>' } })
    const link = await screen.findByRole('link', { name: /Edit in Jira/ })
    expect(link.getAttribute('href')).toBe('https://a.atlassian.net/browse/IMG-1')
    // Only the image-bearing description loses its editor; the plain AC keeps it.
    expect(screen.getAllByRole('button', { name: /Edit/ })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /Edit in Jira/ })).toHaveLength(1)
  })

  it('renders Jira acceptance criteria containing an image read-only too', async () => {
    renderDetail({ id: 'jira:IMG-2', detail: { acceptanceCriteria: '<p><IMG src="y.png"></p>' } })
    expect(await screen.findByRole('link', { name: /Edit in Jira/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
  })

  it('keeps the editor for a Jira description with a table but no image', async () => {
    renderDetail({ id: 'jira:TBL-1', detail: { description: '<table><tr><td>a</td></tr></table>' } })
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Edit in Jira/ })).toBeNull()
  })

  it('leaves ADO items with images editable', async () => {
    renderDetail({ id: 4242, detail: { description: '<p><img src="x.png"></p>' } })
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Edit in Jira/ })).toBeNull()
  })
})
