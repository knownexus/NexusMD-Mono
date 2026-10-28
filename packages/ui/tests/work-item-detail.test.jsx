import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemDetail } from '../src/index.js'

afterEach(cleanup)

describe('WorkItemDetail (shared via injected workItemSource)', () => {
  it('loads detail + comments from the injected source and renders them', async () => {
    const source = {
      loadDetail: vi.fn(async () => ({
        description: 'The description text',
        acceptanceCriteria: null,
        reproSteps: null,
      })),
      loadComments: vi.fn(async () => [
        { id: 1, author: 'Alice', text: '<p>Looks good</p>', createdDate: '2026-01-01' },
      ]),
      saveField: vi.fn(),
      addComment: vi.fn(),
      loadRawFields: vi.fn(),
    }

    const { container } = render(
      <NexusDataProvider value={{ data: {}, workItemSource: source }}>
        <WorkItemDetail id={42} project="Proj" />
      </NexusDataProvider>,
    )

    // The source is consulted with the id/project from props.
    await waitFor(() => expect(source.loadDetail).toHaveBeenCalledWith(42, 'Proj'))
    expect(source.loadComments).toHaveBeenCalledWith(42, 'Proj')

    // Rendered output reflects the normalised shapes the source returned.
    await waitFor(() => expect(container.textContent).toContain('The description text'))
    expect(container.textContent).toContain('Looks good')
  })
})

describe('WorkItemDetail failure handling', () => {
  const wrap = (source, id = 43) => render(
    <NexusDataProvider value={{ data: {}, workItemSource: source }}>
      <WorkItemDetail id={id} project="Proj" />
    </NexusDataProvider>,
  )

  it('still shows the item when only the comments fail to load', async () => {
    const { container } = wrap({
      loadDetail: vi.fn(async () => ({ description: 'Body survives', acceptanceCriteria: null, reproSteps: null })),
      loadComments: vi.fn(async () => { throw new Error('comments down') }),
    })
    await waitFor(() => expect(container.textContent).toContain('Body survives'))
    expect(container.textContent).not.toContain('comments down')
  })

  it('shows the error when the detail itself fails', async () => {
    const { container } = wrap({
      loadDetail: vi.fn(async () => { throw new Error('HTTP 404') }),
      loadComments: vi.fn(async () => []),
    }, 44)
    await waitFor(() => expect(container.textContent).toContain('HTTP 404'))
  })
})

describe('WorkItemDetail for GitHub issues (markdown, not HTML)', () => {
  const ghSource = () => ({
    loadDetail: vi.fn(async () => ({ description: 'Steps:<br>1. run &lt;app&gt;' })),
    loadComments: vi.fn(async () => []),
    saveField: vi.fn(async () => {}),
    addComment: vi.fn(async (_id, _p, text) => ({ id: 9, author: 'me', text, createdDate: '2026-01-01' })),
  })
  const wrapGh = (source) => render(
    <NexusDataProvider value={{ data: {}, workItemSource: source }}>
      <WorkItemDetail id="gh:acme/web#4" project="acme-web" />
    </NexusDataProvider>,
  )

  it('edits the description as the issue\'s own markdown and saves it unconverted', async () => {
    const { fireEvent, screen } = await import('@testing-library/react')
    const source = ghSource()
    wrapGh(source)
    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }))
    const box = document.querySelector('textarea')
    expect(box.value).toBe('Steps:\n1. run <app>')
    fireEvent.change(box, { target: { value: '**bold** <app>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(source.saveField).toHaveBeenCalledWith('gh:acme/web#4', 'System.Description', '**bold** <app>'))
  })

  it('posts comments as markdown', async () => {
    const { fireEvent, screen } = await import('@testing-library/react')
    const source = ghSource()
    wrapGh(source)
    const box = await screen.findByPlaceholderText(/Add a comment/)
    fireEvent.change(box, { target: { value: 'see `x`' } })
    fireEvent.click(screen.getByRole('button', { name: /Post|Comment/ }))
    await waitFor(() => expect(source.addComment).toHaveBeenCalledWith('gh:acme/web#4', 'acme-web', 'see `x`'))
  })
})

describe('WorkItemFieldsEditor for GitHub issues', () => {
  it('offers Open/Closed states and GitHub logins, and hides Priority and Area', async () => {
    const { WorkItemFieldsEditor } = await import('../src/index.js')
    const { container } = render(
      <NexusDataProvider value={{ data: { STATES: ['New', 'Active'], TEAM: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob Smith', githubLogin: 'bobs' }, { id: 'octo', name: 'octo', githubLogin: 'octo', source: 'github' }] }, storage: { getItem: () => null, setItem() {} }, getProfileKey: k => k, workItemSource: { saveField: vi.fn() } }}>
        <WorkItemFieldsEditor item={{ id: 'gh:acme/web#4', source: 'github', state: 'Open', tags: [] }} />
      </NexusDataProvider>,
    )
    const [stateSel, assigneeSel] = container.querySelectorAll('select')
    expect([...stateSel.options].map(o => o.value)).toEqual(['Open', 'Closed'])
    expect([...assigneeSel.options].map(o => o.value)).toEqual(['', 'bobs', 'octo'])
    expect(container.textContent).not.toContain('Priority')
    expect(container.textContent).not.toContain('Area')
  })
})
