import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FieldInput, MarkdownField, CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import * as adoWorkItemTypes from './ado-workitem-types.js'

describe('FieldInput', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a select with allowedValues for a picklist field', () => {
    const def = { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    const select = screen.getByLabelText('Priority')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(5) // 4 values + blank
  })

  it('renders a team select for an identity field', () => {
    const def = { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[{ id: '1', name: 'Alex' }]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByLabelText('Assigned To').tagName).toBe('SELECT')
    expect(screen.getByText('Alex')).toBeTruthy()
  })

  it('renders a datalist-backed input for a treePath field', () => {
    const def = { referenceName: 'System.AreaPath', name: 'Area Path', dataType: 'treePath', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: ['ProjectA\\Team1'], iterations: [] }} />)
    const input = screen.getByLabelText('Area Path')
    expect(input.getAttribute('list')).toBeTruthy()
  })

  it('calls onChange with the new value for a text field', () => {
    const def = { referenceName: 'Custom.Notes', name: 'Notes', dataType: 'string', allowedValues: [], alwaysRequired: false }
    const onChange = vi.fn()
    render(<FieldInput def={def} value="" onChange={onChange} team={[]} paths={{ areas: [], iterations: [] }} />)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('shows a required marker when alwaysRequired is true', () => {
    const def = { referenceName: 'System.Title', name: 'Title', dataType: 'string', allowedValues: [], alwaysRequired: true }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByText('Title *')).toBeTruthy()
  })
})

describe('MarkdownField', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a textarea in Write mode by default and calls onChange on input', () => {
    const onChange = vi.fn()
    render(<MarkdownField label="Description" value="" onChange={onChange} />)
    const textarea = screen.getByLabelText('Description')
    fireEvent.change(textarea, { target: { value: '**bold**' } })
    expect(onChange).toHaveBeenCalledWith('**bold**')
  })

  it('switches to Preview mode and renders converted markdown as HTML', () => {
    render(<MarkdownField label="Description" value="**bold**" onChange={() => {}} />)
    fireEvent.click(screen.getByText('Preview'))
    expect(document.querySelector('strong')).toBeTruthy()
  })

  it('shows a required marker in the label when required', () => {
    render(<MarkdownField label="Description" value="" onChange={() => {}} required />)
    expect(screen.getByText('Description *')).toBeTruthy()
  })
})

function stubDefs() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Custom.RiskLevel', name: 'Risk Level', dataType: 'string', allowedValues: ['Low', 'High'], alwaysRequired: false },
    ],
    paths: { areas: ['ProjectA'], iterations: ['ProjectA'] },
    types: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }, { name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}

describe('CreateWorkItemDrawer', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<CreateWorkItemDrawer open={false} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    expect(container.querySelector('.drawer.open')).toBe(null)
  })

  it('loads type definitions on open and renders known + additional fields', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    expect(await screen.findByText('Description')).toBeTruthy()
    expect(screen.getByText('Assigned To')).toBeTruthy()
    expect(screen.getByText('Risk Level')).toBeTruthy()
  })

  it('reloads definitions when the Type selector changes', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByText('Description')
    adoWorkItemTypes.loadWorkItemTypeDefs.mockClear()
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Microsoft.VSTS.WorkItemTypes.Task' } })
    expect(adoWorkItemTypes.loadWorkItemTypeDefs).toHaveBeenCalledWith('ProjectA', 'Microsoft.VSTS.WorkItemTypes.Task', expect.anything())
  })

  it('force-refreshes definitions when the refresh button is clicked', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByText('Description')
    adoWorkItemTypes.loadWorkItemTypeDefs.mockClear()
    fireEvent.click(screen.getByTitle('Refresh field definitions'))
    expect(adoWorkItemTypes.loadWorkItemTypeDefs).toHaveBeenCalledWith(expect.any(String), expect.any(String), { forceRefresh: true })
  })
})
