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
