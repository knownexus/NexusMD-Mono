import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NexusDataProvider, EMPTY_NEXUS_DATA } from '../data-context.jsx'
import { CreateWIModal, WIDetail, PersonDetail, DetailDrawer } from './work-item-shell.jsx'

afterEach(cleanup)

const data = {
  ...EMPTY_NEXUS_DATA,
  ORG: 'acme',
  TEAM: [{ id: 'u1', name: 'Ada Lovelace', role: 'Dev', tz: 'UTC', focus: 'Maths' }],
  CONFIG_PROJECTS: ['Proj'],
  STATES: ['New', 'Active'],
  WORK_ITEMS: [{ id: 1, title: 'Thing', type: 'Task', state: 'Active', assignee: 'u1', fields: { 'System.Tags': 'a; b' } }],
  PROJECT_AREAS: [{ id: 'x', name: 'Area X', items: [], children: [] }],
}
const wrap = (ui) => <NexusDataProvider value={{ data, workItemSource: { loadDetail: async () => null, loadComments: async () => [], loadRawFields: async () => ({}) } }}>{ui}</NexusDataProvider>
const item = { id: 1, title: 'Thing', type: 'Task', state: 'Active', priority: 2, project: 'Proj', tags: [], assignee: 'u1' }

describe('CreateWIModal', () => {
  it('submits the entered fields through onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(wrap(<CreateWIModal open onClose={() => {}} onSubmit={onSubmit} />))
    fireEvent.change(screen.getByPlaceholderText(/descriptive task title/i), { target: { value: 'Do it' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ project: 'Proj', type: 'Task', fields: { 'System.Title': 'Do it' } })
  })

  it('shows the error when onSubmit throws', async () => {
    render(wrap(<CreateWIModal open onClose={() => {}} onSubmit={async () => { throw new Error('nope') }} />))
    fireEvent.change(screen.getByPlaceholderText(/descriptive task title/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Create'))
    expect(await screen.findByText('Error: nope')).toBeTruthy()
  })
})

describe('WIDetail', () => {
  it('sends a state change through patchFields', async () => {
    const patchFields = vi.fn().mockResolvedValue(undefined)
    render(wrap(<WIDetail item={item} patchFields={patchFields} />))
    fireEvent.change(screen.getByDisplayValue('Active'), { target: { value: 'New' } })
    await waitFor(() => expect(patchFields).toHaveBeenCalledWith(1, [{ op: 'add', path: '/fields/System.State', value: 'New' }]))
  })
})

describe('PersonDetail', () => {
  it('reveals notes straight away when no password is set', () => {
    render(wrap(<PersonDetail dev={data.TEAM[0]} confidential={{ load: () => null, hash: async () => 'h' }} />))
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText(/Active work/)).toBeTruthy()
  })
})

describe('DetailDrawer', () => {
  it('renders the injected PRDetail for a pull request', () => {
    const PRDetail = ({ pr }) => <div>PR body {pr.id}</div>
    render(wrap(<DetailDrawer drawer={{ kind: 'pr', data: { id: 9, title: 'A PR' } }} onClose={() => {}} PRDetail={PRDetail} />))
    expect(screen.getByText('PR body 9')).toBeTruthy()
  })
})
