// apps/desktop/src/jira-create-form.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { JiraCreateForm } from './jira-create-form.jsx'

afterEach(() => cleanup())

function makeSource(fields) {
  return {
    getCreateTypes: vi.fn(async () => [{ id: '10001', name: 'Story' }, { id: '10002', name: 'Bug' }]),
    getCreateFields: vi.fn(async () => fields),
    getLinkTypes: vi.fn(async () => [{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }]),
    createIssue: vi.fn(async () => ({ id: 'jira:ABC-9', key: 'ABC-9', warnings: [] })),
  }
}

const FIELDS = [
  { key: 'description', name: 'Description', required: false, kind: 'richtext', role: 'description', allowedValues: [] },
  { key: 'assignee', name: 'Assignee', required: false, kind: 'user', role: 'assignee', allowedValues: [] },
  { key: 'priority', name: 'Priority', required: false, kind: 'option', role: 'priority', allowedValues: [{ id: '2', name: 'High' }] },
  { key: 'customfield_1', name: 'Team', required: true, kind: 'option', role: null, allowedValues: [{ id: '7', name: 'Core' }] },
]
const PEOPLE = [{ accountId: 'u1', displayName: 'Alex Doe' }]

describe('JiraCreateForm', () => {
  it('loads types and fields, then creates with the chosen values', async () => {
    const source = makeSource(FIELDS)
    const onCreated = vi.fn()
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site="https://a.atlassian.net" initialTitle="From planner" onCreated={onCreated} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalledWith('ABC', '10001'))
    expect(screen.getByLabelText('Summary').value).toBe('From planner')
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Team *'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '**bold**' } })
    fireEvent.click(screen.getByText('Create issue'))
    await waitFor(() => expect(source.createIssue).toHaveBeenCalled())
    const [input, extras] = source.createIssue.mock.calls[0]
    expect(input).toMatchObject({ projectKey: 'ABC', typeId: '10001', summary: 'From planner', fields: FIELDS })
    expect(input.values).toMatchObject({ assignee: 'u1', customfield_1: '7' })
    expect(input.values.description).toContain('<strong>bold</strong>')
    expect(extras).toEqual({ attachments: [], links: [] })
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'jira:ABC-9', key: 'ABC-9', warnings: [] }))
    expect(screen.getByText('Created ABC-9.')).toBeTruthy()
  })

  it('requires a summary and the required fields', async () => {
    const source = makeSource(FIELDS)
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site="s" onCreated={() => {}} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Create issue'))
    expect(screen.getByText('Summary is required.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Create issue'))
    expect(screen.getByText('Fill in: Team')).toBeTruthy()
    expect(source.createIssue).not.toHaveBeenCalled()
  })

  it('offers Open in Jira instead of submitting when a required field is unsupported', async () => {
    const source = makeSource([{ key: 'customfield_9', name: 'Weird', required: true, kind: null, role: null, allowedValues: [] }])
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={[]} site="https://a.atlassian.net" onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Weird/)).toBeTruthy())
    expect(screen.getByText('Open project in Jira').getAttribute('href')).toBe('https://a.atlassian.net/browse/ABC')
    expect(screen.queryByText('Create issue')).toBeNull()
  })

  it('keeps entered values when re-rendered with the same source and new unrelated props', async () => {
    const source = makeSource(FIELDS)
    const { rerender } = render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site="s" onCreated={() => {}} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Team *'), { target: { value: '7' } })
    rerender(<JiraCreateForm source={source} projectKeys={['ABC']} people={[...PEOPLE, { accountId: 'u2', displayName: 'Sam Roe' }]} site="s" onCreated={() => {}} />)
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByLabelText('Team *').value).toBe('7')
    expect(source.getCreateFields).toHaveBeenCalledTimes(1)
    expect(source.getCreateTypes).toHaveBeenCalledTimes(1)
  })

  it('reloads fields when the type changes', async () => {
    const source = makeSource(FIELDS)
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={[]} site="s" onCreated={() => {}} />)
    await waitFor(() => expect(source.getCreateFields).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: '10002' } })
    await waitFor(() => expect(source.getCreateFields).toHaveBeenLastCalledWith('ABC', '10002'))
  })

  async function createOnce(source) {
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site='s' initialTitle='T' onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Team *')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Team *'), { target: { value: '7' } })
    fireEvent.click(screen.getByText('Create issue'))
    await waitFor(() => expect(screen.getByText('Created ABC-9.')).toBeTruthy())
  }

  it('disables Create issue after a successful create so it cannot be submitted twice', async () => {
    const source = makeSource(FIELDS)
    await createOnce(source)
    const btn = screen.getByText('Create issue')
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    await new Promise(r => setTimeout(r, 20))
    expect(source.createIssue).toHaveBeenCalledTimes(1)
  })

  it('re-enables Create issue once the form is changed after a create', async () => {
    const source = makeSource(FIELDS)
    await createOnce(source)
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Another' } })
    await waitFor(() => expect(screen.getByText('Create issue').disabled).toBe(false))
    fireEvent.click(screen.getByText('Create issue'))
    await waitFor(() => expect(source.createIssue).toHaveBeenCalledTimes(2))
  })

  it('clears the old fields and blocks submit while the new type fields load', async () => {
    const source = makeSource(FIELDS)
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site='s' initialTitle='T' onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Team *')).toBeTruthy())
    let resolveBug
    source.getCreateFields.mockImplementationOnce(() => new Promise(r => { resolveBug = r }))
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: '10002' } })
    await waitFor(() => expect(source.getCreateFields).toHaveBeenLastCalledWith('ABC', '10002'))
    expect(screen.queryByLabelText('Team *')).toBeNull()
    expect(screen.getByText('Create issue').disabled).toBe(true)
    fireEvent.click(screen.getByText('Create issue'))
    expect(source.createIssue).not.toHaveBeenCalled()
    resolveBug([FIELDS[0]])
    await waitFor(() => expect(screen.getByText('Create issue').disabled).toBe(false))
    expect(screen.getByLabelText('Description')).toBeTruthy()
  })

  it('clears a field-load error when a later load succeeds', async () => {
    const source = makeSource(FIELDS)
    source.getCreateFields.mockRejectedValueOnce(new Error('Boom fields'))
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={PEOPLE} site='s' onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByText('Boom fields')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: '10002' } })
    await waitFor(() => expect(screen.getByLabelText('Team *')).toBeTruthy())
    expect(screen.queryByText('Boom fields')).toBeNull()
  })
})

describe('JiraCreateForm date inputs', () => {
  it('renders datetime fields as datetime-local and date fields as date', async () => {
    const source = makeSource([
      { key: 'customfield_9', name: 'Start', required: true, kind: 'datetime', role: null, allowedValues: [] },
      { key: 'duedate', name: 'Due', required: true, kind: 'date', role: null, allowedValues: [] },
    ])
    render(<JiraCreateForm source={source} projectKeys={['ABC']} people={[]} site="s" initialTitle="T" onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('Start *')).toBeTruthy())
    expect(screen.getByLabelText('Start *').getAttribute('type')).toBe('datetime-local')
    expect(screen.getByLabelText('Due *').getAttribute('type')).toBe('date')
    fireEvent.change(screen.getByLabelText('Start *'), { target: { value: '2026-10-10T14:30' } })
    fireEvent.change(screen.getByLabelText('Due *'), { target: { value: '2026-10-11' } })
    fireEvent.click(screen.getByText('Create issue'))
    await waitFor(() => expect(source.createIssue).toHaveBeenCalled())
    expect(source.createIssue.mock.calls[0][0].values).toEqual({ customfield_9: '2026-10-10T14:30', duedate: '2026-10-11' })
  })
})
