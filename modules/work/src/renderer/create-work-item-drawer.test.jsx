import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
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
    // Non-template types (not in TYPE_LAYOUTS) → generic grouped fallback path.
    types: [{ name: 'Ticket', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }, { name: 'Incident', referenceName: 'Custom.WorkItemTypes.Incident', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}

function stubDefsWithState() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.State', name: 'State', dataType: 'string', allowedValues: ['New', 'Active', 'Closed'], alwaysRequired: false },
      { referenceName: 'System.Reason', name: 'Reason', dataType: 'string', allowedValues: ['New'], alwaysRequired: false },
    ],
    paths: { areas: [], iterations: [] },
    // Non-template type (not in TYPE_LAYOUTS) → generic grouped fallback path.
    types: [{ name: 'Ticket', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}

function stubDefsForBug() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.AreaPath', name: 'Area', dataType: 'treePath', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false },
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
    ],
    paths: { areas: [], iterations: [] },
    types: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }],
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

  it('shows an inline error when loading field definitions fails, and clears it on a successful retry', async () => {
    const spy = vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockRejectedValueOnce(new Error('network down'))
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)

    expect(await screen.findByText(/network down/)).toBeTruthy()
    expect(screen.getByText(/click Refresh to retry/)).toBeTruthy()

    spy.mockResolvedValueOnce({
      fields: [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }],
      paths: { areas: [], iterations: [] },
      types: [{ name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }],
      fetchedAt: Date.now(),
    })
    fireEvent.click(screen.getByTitle('Refresh field definitions'))

    await screen.findByText('Description')
    expect(screen.queryByText(/network down/)).toBe(null)
  })
})

describe('CreateWorkItemDrawer submit', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders MarkdownField for main fields and FieldInput for rail fields, and calls onCreate with assembled fields', async () => {
    stubDefs()
    const onCreate = vi.fn().mockResolvedValue({ id: 42 })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[{ id: '1', name: 'Alex' }]} onClose={() => {}} onCreate={onCreate} />)

    await screen.findByLabelText('Description') // wait for defs to load before interacting with dynamic fields
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fix login bug' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'It crashes' } })
    fireEvent.change(screen.getByLabelText('Assigned To'), { target: { value: 'Alex' } })

    fireEvent.click(screen.getByText('Create'))

    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      project: 'ProjectA',
      type: 'Microsoft.VSTS.WorkItemTypes.Task',
      fields: expect.objectContaining({
        'System.Title': 'Fix login bug',
        'System.Description': 'It crashes',
        'System.AssignedTo': 'Alex',
      }),
      attachmentFiles: [],
    }))
  })

  it('blocks submit and shows an inline error when Title is empty', async () => {
    stubDefs()
    const onCreate = vi.fn()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')
    fireEvent.click(screen.getByText('Create'))
    expect(await screen.findByText('Title is required.')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows the title-required error even when a non-Details tab is active', async () => {
    stubDefs()
    const onCreate = vi.fn()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')

    fireEvent.click(screen.getByRole('button', { name: 'Links' }))
    fireEvent.click(screen.getByText('Create'))

    expect(await screen.findByText('Title is required.')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('stages a file for upload without calling the attachments API immediately', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={vi.fn().mockResolvedValue({ id: 1 })} />)
    await screen.findByLabelText('Description')
    const file = new File(['contents'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } })
    expect(screen.getByText('notes.txt')).toBeTruthy()
  })
})

describe('CreateWorkItemDrawer links', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('stages a link and includes it in the onCreate payload', async () => {
    stubDefs()
    const onCreate = vi.fn().mockResolvedValue({ id: 1 })
    render(<CreateWorkItemDrawer open={true} title="Has a parent" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')

    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'System.LinkTypes.Hierarchy-Reverse' } })
    fireEvent.change(screen.getByLabelText('Linked work item ID'), { target: { value: '555' } })
    fireEvent.click(screen.getByText('+ Add link'))

    expect(screen.getByText('#555 (Parent)')).toBeTruthy()

    fireEvent.click(screen.getByText('Create'))
    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      links: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', id: 555 }],
    }))
  })

  it('removes a staged link', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="x" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={vi.fn().mockResolvedValue({ id: 1 })} />)
    await screen.findByLabelText('Description')
    fireEvent.change(screen.getByLabelText('Linked work item ID'), { target: { value: '555' } })
    fireEvent.click(screen.getByText('+ Add link'))
    fireEvent.click(screen.getByTitle('Remove link'))
    expect(screen.queryByText('#555 (Parent)')).toBe(null)
  })
})

describe('CreateWorkItemDrawer header', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the State field once, in the header, not duplicated in the status rail', async () => {
    stubDefsWithState()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    const stateSelect = screen.getByLabelText('State')
    expect(stateSelect.tagName).toBe('SELECT')
    expect(screen.getByText('Reason')).toBeTruthy() // other status field still in the rail
  })

  it('includes the State value in the onCreate payload when set via the header pill', async () => {
    stubDefsWithState()
    const onCreate = vi.fn().mockResolvedValue({ id: 7 })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Header state test' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Active' } })
    fireEvent.click(screen.getByText('Create'))

    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({ 'System.State': 'Active' }),
    }))
  })
})

describe('CreateWorkItemDrawer tabs', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows the Details panel by default and hides Links/Attachments', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    expect(screen.getByLabelText('Description').closest('[hidden]')).toBeNull()
    expect(screen.getByLabelText('Attach files').closest('[hidden]')).not.toBeNull()
    expect(screen.getByLabelText('Link type').closest('[hidden]')).not.toBeNull()
  })

  it('switches to the Links panel and hides Details when the Links tab is clicked', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    fireEvent.click(screen.getByRole('button', { name: 'Links' }))

    expect(screen.getByLabelText('Link type').closest('[hidden]')).toBeNull()
    expect(screen.getByLabelText('Description').closest('[hidden]')).not.toBeNull()
  })

  it('renders Discussion and History as disabled tabs', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    expect(screen.getByText('Discussion').closest('button').disabled).toBe(true)
    expect(screen.getByText('History').closest('button').disabled).toBe(true)
  })
})

describe('CreateWorkItemDrawer per-type layout', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a two-column Left/Middle layout for a known type (Bug), in config order', async () => {
    stubDefsForBug()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Microsoft.VSTS.WorkItemTypes.Bug' } })
    await screen.findByLabelText('Description')

    // Left column: Description then Repro Steps (System Info absent from this fixture — skipped, not blank)
    const description = screen.getByLabelText('Description')
    const reproSteps = screen.getByLabelText('Repro Steps')
    expect(description.compareDocumentPosition(reproSteps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Middle column: Acceptance Criteria present, then Planning fields (Area, Priority) — Resolved Reason/Story Points absent from fixture, skipped
    expect(screen.getByLabelText('Acceptance Criteria')).toBeTruthy()
    expect(screen.getByLabelText('Area')).toBeTruthy()
    expect(screen.getByLabelText('Priority')).toBeTruthy()

    // Non-listed, non-required fields are hidden: Assigned To isn't in Bug's
    // layout and isn't alwaysRequired, so it must not render.
    expect(screen.queryByLabelText('Assigned To')).toBeNull()
    expect(screen.queryByText('Required Fields')).toBeNull()
    expect(screen.queryByText('Additional Fields')).toBeNull()
  })

  it('surfaces a non-listed alwaysRequired field under "Required Fields"', async () => {
    vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
      fields: [
        { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
        { referenceName: 'Custom.Compliance', name: 'Compliance', dataType: 'string', allowedValues: [], alwaysRequired: true },
        { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
      ],
      paths: { areas: [], iterations: [] },
      types: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }],
      fetchedAt: Date.now(),
    })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Microsoft.VSTS.WorkItemTypes.Bug' } })
    await screen.findByLabelText('Description')

    // Required extra shows; non-required extra (Assigned To) stays hidden.
    expect(screen.getByText('Required Fields')).toBeTruthy()
    expect(screen.getByLabelText('Compliance')).toBeTruthy()
    expect(screen.queryByLabelText('Assigned To')).toBeNull()
  })

  it('restricts the Type picker to configured types when the project is on that process', async () => {
    vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
      fields: [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }],
      paths: { areas: [], iterations: [] },
      types: [
        { name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' },
        { name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' },
        { name: 'Test Case', referenceName: 'Microsoft.VSTS.WorkItemTypes.TestCase', icon: '', color: '' },
      ],
      fetchedAt: Date.now(),
    })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    const options = Array.from(screen.getByLabelText('Type').querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toContain('Bug')
    expect(options).toContain('Task')
    expect(options).not.toContain('Test Case')
  })

  it('falls back to the generic grouped layout for an unrecognized type', async () => {
    vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
      fields: [
        { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
        { referenceName: 'Custom.Whatever', name: 'Whatever', dataType: 'string', allowedValues: [], alwaysRequired: false },
      ],
      paths: { areas: [], iterations: [] },
      types: [{ name: 'CustomThing', referenceName: 'Custom.WorkItemTypes.CustomThing', icon: '', color: '' }],
      fetchedAt: Date.now(),
    })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Custom.WorkItemTypes.CustomThing' } })
    await screen.findByLabelText('Description')

    // Falls into Additional Fields exactly as today's generic path does for unrecognized reference names
    expect(screen.getByText('Additional Fields')).toBeTruthy()
    expect(screen.getByLabelText('Whatever')).toBeTruthy()
  })
})

describe('CreateWorkItemDrawer with GitHub', () => {
  afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
  const github = () => ({
    source: { getCreateMeta: vi.fn(async () => ({ labels: [], assignees: [], milestones: [] })), createIssue: vi.fn() },
    repos: ['acme/web'],
  })

  it('opens on the GitHub form when GitHub is the only provider, without loading ADO types', async () => {
    const spy = vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs'); spy.mockClear()
    render(<CreateWorkItemDrawer open={true} title="Idea" project={[]} team={[]} adoAvailable={false} github={github()} onClose={() => {}} onCreate={() => {}} />)
    expect(await screen.findByLabelText('Repository')).toBeTruthy()
    expect(screen.getByLabelText('Title').value).toBe('Idea')
    expect(screen.queryByRole('group', { name: 'Create in' })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('switches between ADO and GitHub, keeping the title typed on the GitHub form', async () => {
    stubDefs()
    const onProviderChange = vi.fn()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} github={github()} defaultProvider="github" onProviderChange={onProviderChange} onClose={() => {}} onCreate={() => {}} />)
    const sw = screen.getByRole('group', { name: 'Create in' })
    expect(within(sw).getByRole('button', { name: 'GitHub' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Carried over' } })
    fireEvent.click(within(sw).getByRole('button', { name: 'Azure DevOps' }))
    expect(onProviderChange).toHaveBeenCalledWith('ado')
    expect(screen.queryByLabelText('Repository')).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'Create in' })).getByRole('button', { name: 'GitHub' }))
    expect((await screen.findByLabelText('Title')).value).toBe('Carried over')
  })
})
