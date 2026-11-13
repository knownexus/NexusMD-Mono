import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { NexusDataProvider } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import documents from './index.js'
import { openedFiles } from './opened.js'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

describe('Documents app', () => {
  it('owns the markdown view', () => {
    expect(documents.id).toBe('documents')
    expect(typeof documents.views.markdown).toBe('function')
  })
})

describe('Documents app: files opened with the desktop app', () => {
  const fakeHost = () => {
    const provided = {}
    return { provided, navigate: vi.fn(), capabilities: { provide: (name, fn) => { provided[name] = fn } } }
  }

  it('offers documents.openFile, which saves the file as a document and shows the Documents screen', async () => {
    const host = fakeHost()
    documents.activate(host)
    expect(typeof host.provided['documents.openFile']).toBe('function')
    const r = await host.provided['documents.openFile']({ name: 'plan.md', text: '# Plan' })
    expect(r).toMatchObject({ tool: 'markdown', created: true, name: 'plan' })
    expect(JSON.parse(localStorage.getItem(getProfileKey('md_documents'))).docs[0]).toMatchObject({ name: 'plan', content: '# Plan' })
    expect(host.navigate).toHaveBeenCalledWith('markdown')
  })

  it('does not show the Documents screen for a file it could not take', async () => {
    const host = fakeHost()
    documents.activate(host)
    await expect(host.provided['documents.openFile']({ name: 'a.ts', text: 'x' })).rejects.toThrow(/Markdown or JSON/)
    expect(host.navigate).not.toHaveBeenCalled()
  })

  it('shows a JSON file that arrives in the JSON editor, as it is', () => {
    const Screen = documents.views.markdown
    render(<NexusDataProvider value={{ storage: localStorage, getProfileKey, pushPref: () => {} }}><Screen /></NexusDataProvider>)
    act(() => { openedFiles.add({ name: 'settings.json', text: '{"theme":"dark"}' }) })
    expect(screen.getByText('dark')).toBeTruthy()
    expect(screen.getByText('Valid JSON')).toBeTruthy()
  })
})

describe('Documents app: a Home shortcut to one saved document', () => {
  const fakeHost = () => {
    const provided = {}
    return { provided, navigate: vi.fn(), capabilities: { provide: (name, fn) => { provided[name] = fn } } }
  }
  const seed = () => {
    localStorage.setItem(getProfileKey('md_documents'), JSON.stringify({ docs: [
      { id: 'old', name: null, autoName: 'Old', content: '# Old\n\nfrom before', createdAt: 1, updatedAt: 1 },
      { id: 'new', name: null, autoName: 'New', content: '# New\n\nlast edited', createdAt: 2, updatedAt: 9 },
    ] }))
    localStorage.setItem(getProfileKey('json_editor_documents'), JSON.stringify([
      { id: 'j1', name: 'cfg', autoName: 'cfg', content: '{"theme":"dark"}', createdAt: 1, updatedAt: 1 },
    ]))
  }

  it('offers documents.openDoc, which shows the screen for a saved document and says so', () => {
    seed()
    const host = fakeHost()
    documents.activate(host)
    expect(host.provided['documents.openDoc']({ tool: 'markdown', docId: 'old' })).toBe(true)
    expect(host.navigate).toHaveBeenCalledWith('markdown')
  })

  it('does not go to the screen for a document that no longer exists', () => {
    seed()
    const host = fakeHost()
    documents.activate(host)
    expect(host.provided['documents.openDoc']({ tool: 'markdown', docId: 'gone' })).toBe(false)
    expect(host.navigate).not.toHaveBeenCalled()
  })

  it('shows the named Markdown document, not the newest, on the screen', () => {
    seed()
    const Screen = documents.views.markdown
    const { container } = render(<NexusDataProvider value={{ storage: localStorage, getProfileKey, pushPref: () => {} }}><Screen /></NexusDataProvider>)
    act(() => { openedFiles.openDoc({ tool: 'markdown', docId: 'old' }) })
    expect(container.querySelector('textarea').value).toBe('# Old\n\nfrom before')
  })

  it('shows the named JSON document on the JSON editor', () => {
    seed()
    const Screen = documents.views.markdown
    render(<NexusDataProvider value={{ storage: localStorage, getProfileKey, pushPref: () => {} }}><Screen /></NexusDataProvider>)
    act(() => { openedFiles.openDoc({ tool: 'json', docId: 'j1' }) })
    expect(screen.getByText('dark')).toBeTruthy()
  })
})
