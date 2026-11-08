import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, DocumentsView } from '../src/index.js'
import { JsonEditorView } from '../src/views/view-json-editor.jsx'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderDocuments(storage = memStorage()) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <DocumentsView/>
    </NexusDataProvider>
  )
}

afterEach(() => { cleanup(); localStorage.clear() })

// A file the app was opened with (Android "Open with") is added to the saved documents, then the Documents
// page is shown with `opened` counting the files that arrived. The tablet layout must show that file.
describe('DocumentsView when a file was opened with the app', () => {
  const seed = () => localStorage.setItem('md_documents', JSON.stringify({ docs: [
    { id: 'old', name: null, autoName: 'Old notes', content: '# Old notes\n\nfrom before', createdAt: 1, updatedAt: 1 },
    { id: 'new', name: 'Opened', autoName: 'Opened', content: '# Opened\n\nthe file that arrived', createdAt: 2, updatedAt: 2 },
  ] }))

  it('shows the newest document in the editor, not an empty page', () => {
    seed()
    const { container } = render(
      <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {} }}>
        <DocumentsView opened={1}/>
      </NexusDataProvider>
    )
    expect(container.querySelector('textarea').value).toBe('# Opened\n\nthe file that arrived')
  })

  it('switches to the Markdown tool when another tool was the last one in use', () => {
    seed()
    const storage = memStorage()
    storage.setItem('documents_active_tab', JSON.stringify('json'))
    const { container, getByRole } = render(
      <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
        <DocumentsView opened={1}/>
      </NexusDataProvider>
    )
    expect(getByRole('tab', { name: 'Markdown' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('textarea').value).toBe('# Opened\n\nthe file that arrived')
  })

  it('shows the JSON Editor tab on the opened document when a JSON file was opened, whichever tab was last in use', () => {
    const storage = memStorage()
    storage.setItem('documents_active_tab', JSON.stringify('markdown'))
    storage.setItem('json_editor_documents', JSON.stringify([
      { id: 'j', name: 'cfg', autoName: 'cfg', content: '{"city":"Oslo"}', createdAt: 1, updatedAt: 9 },
    ]))
    const { container, getByRole, queryByText } = render(
      <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
        <DocumentsView opened={1} openedTool="json"/>
      </NexusDataProvider>
    )
    expect(getByRole('tab', { name: 'JSON Editor' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('textarea').value).toBe('{"city":"Oslo"}')
    expect(queryByText('Alice Johnson')).toBeNull()
  })

  it('lets the person pick another tool afterwards', () => {
    seed()
    const { getByRole, getByText } = render(
      <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {} }}>
        <DocumentsView opened={1}/>
      </NexusDataProvider>
    )
    fireEvent.click(getByRole('tab', { name: 'JSON Editor' }))
    expect(getByRole('tab', { name: 'JSON Editor' }).getAttribute('aria-selected')).toBe('true')
    expect(getByText('Alice Johnson')).toBeTruthy()
  })

  it('still starts on a blank page when nothing was opened', () => {
    seed()
    const { container } = renderDocuments()
    expect(container.querySelector('textarea').value).toBe('')
  })
})

describe('DocumentsView', () => {
  it('defaults to the Markdown tab and switches to JSON Editor on click', () => {
    const { getByText, container } = renderDocuments()
    expect(container.querySelector('textarea').placeholder).toContain('Start writing')
    fireEvent.click(getByText('JSON Editor'))
    expect(getByText('Alice Johnson')).toBeTruthy()
  })

  it('persists the active tab across remount', () => {
    const storage = memStorage()
    const { getByText, unmount } = renderDocuments(storage)
    fireEvent.click(getByText('JSON Editor'))
    unmount()

    const { getByText: getByText2 } = renderDocuments(storage)
    expect(getByText2('Alice Johnson')).toBeTruthy()
  })

  it('shows a third Regex Tester tab and switches to it', () => {
    const { getByText } = renderDocuments()
    fireEvent.click(getByText('Regex Tester'))
    expect(getByText('Saved patterns')).toBeTruthy()
  })
})

describe('DocumentsBar', () => {
  it('is a tab strip of the three tools with the chosen one selected', () => {
    const { getByRole } = renderDocuments()
    expect(getByRole('tablist', { name: 'Documents tool' })).toBeTruthy()
    expect(getByRole('tab', { name: 'Markdown' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(getByRole('tab', { name: 'Regex Tester' }))
    expect(getByRole('tab', { name: 'Regex Tester' }).getAttribute('aria-selected')).toBe('true')
    expect(getByRole('tab', { name: 'Markdown' }).getAttribute('aria-selected')).toBe('false')
  })

  it('is a 48px bar, not the accent-filled button row', () => {
    const { container } = renderDocuments()
    const bar = container.querySelector('.nx-docs-bar')
    expect(bar.style.height).toBe('48px')
    expect(bar.querySelector('button[style*="var(--accent)"]')).toBeNull()
  })

  it('says nothing about saving on a tool that does not report it', () => {
    const { container } = renderDocuments()
    expect(container.querySelector('.nx-docs-save')).toBeNull()
  })

  it('shows Saving… then Saved just now beside the tabs while the Regex Tester saves a pattern', async () => {
    const { getByRole, getByDisplayValue, findByText, container } = renderDocuments()
    fireEvent.click(getByRole('tab', { name: 'Regex Tester' }))
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    expect(await findByText('Saving…')).toBeTruthy()
    expect(await findByText('Saved just now', {}, { timeout: 4000 })).toBeTruthy()
  })

  it('draws no save text once the tool is left', async () => {
    const { getByRole, getByDisplayValue, findByText, container } = renderDocuments()
    fireEvent.click(getByRole('tab', { name: 'Regex Tester' }))
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    await findByText('Saving…')
    fireEvent.click(getByRole('tab', { name: 'Markdown' }))
    expect(container.querySelector('.nx-docs-save')).toBeNull()
  })
})

describe('JsonEditorView when a file was opened', () => {
  const store = docs => { const storage = memStorage(); storage.setItem('json_editor_documents', JSON.stringify(docs)); return storage }
  const doc = (content, updatedAt = 5) => ({ id: 'd' + updatedAt, name: null, autoName: 'Opened', content, createdAt: 1, updatedAt })
  const renderJson = (storage, props) => render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <JsonEditorView {...props}/>
    </NexusDataProvider>
  )

  it('shows the newest document, not the sample', () => {
    const { container, queryByText } = renderJson(store([doc('{"city":"Oslo"}')]), { openNewest: true })
    expect(container.querySelector('textarea').value).toBe('{"city":"Oslo"}')
    expect(queryByText('Alice Johnson')).toBeNull()
  })

  it('a broken document shows Invalid and no sample tree', () => {
    const { container, queryByText, getByText } = renderJson(store([doc('{ "a": ')]), { openNewest: true })
    expect(container.querySelector('textarea').value).toBe('{ "a": ')
    expect(getByText('Invalid')).toBeTruthy()
    expect(queryByText('Alice Johnson')).toBeNull()
    expect(queryByText('address')).toBeNull()
  })

  it('an empty document is an empty document, not an Invalid one', () => {
    const { container, queryByText, getByText } = renderJson(store([doc('')]), { openNewest: true })
    expect(container.querySelector('textarea').value).toBe('')
    expect(queryByText('Invalid')).toBeNull()
    expect(getByText('Valid JSON')).toBeTruthy()
    expect(queryByText('Alice Johnson')).toBeNull()
  })

  it('without openNewest it still starts on the sample', () => {
    const { getByText } = renderJson(store([doc('{"city":"Oslo"}')]), {})
    expect(getByText('Alice Johnson')).toBeTruthy()
  })
})
