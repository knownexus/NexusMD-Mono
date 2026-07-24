import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, JsonEditorView } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderEditor(storage = memStorage()) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <JsonEditorView/>
    </NexusDataProvider>
  )
}

afterEach(cleanup)

describe('JsonEditorView — tree and raw sync', () => {
  it('renders the sample JSON in both the tree and the raw pane', () => {
    const { container, getByText } = renderEditor()
    expect(getByText('Alice Johnson')).toBeTruthy()
    const textarea = container.querySelector('textarea')
    expect(textarea.value).toContain('"name": "Alice Johnson"')
  })

  it('syncs a valid raw edit into the tree and shows the valid badge', () => {
    const { container, getByText } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    expect(getByText('hi')).toBeTruthy()
    expect(getByText('Valid JSON')).toBeTruthy()
  })

  it('shows the invalid badge and an error message for broken JSON, without touching the tree', () => {
    const { container, getByText } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"broken":' } })
    expect(getByText('Invalid')).toBeTruthy()
    expect(getByText('Alice Johnson')).toBeTruthy()
  })
})

describe('JsonEditorView — undo/redo', () => {
  it('restores prior raw text and disables correctly at history bounds', () => {
    const { container, getByTitle } = renderEditor()
    const textarea = container.querySelector('textarea')
    expect(getByTitle('Ctrl+Z').disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    expect(getByTitle('Ctrl+Z').disabled).toBe(false)

    fireEvent.click(getByTitle('Ctrl+Z'))
    expect(textarea.value).toContain('"name": "Alice Johnson"')
    expect(getByTitle('Ctrl+Z').disabled).toBe(true)

    fireEvent.click(getByTitle('Ctrl+Y'))
    expect(textarea.value).toBe('{"greeting":"hi"}')
  })

  it('undoes a field added via the modal, disabling correctly at the history boundary (StrictMode)', () => {
    const { getByTitle, getByPlaceholderText, getByText, queryByText } = render(
      <React.StrictMode>
        <NexusDataProvider value={{ storage: memStorage(), getProfileKey: k => k, pushPref: () => {} }}>
          <JsonEditorView/>
        </NexusDataProvider>
      </React.StrictMode>
    )

    fireEvent.click(getByTitle('Add field'))
    fireEvent.change(getByPlaceholderText('e.g. username'), { target: { value: 'nickname' } })
    fireEvent.change(getByPlaceholderText('Enter text…'), { target: { value: 'Ally' } })
    fireEvent.click(getByTitle('Save field'))
    expect(getByText('nickname')).toBeTruthy()

    fireEvent.click(getByTitle('Ctrl+Z'))
    expect(queryByText('nickname')).toBeNull()
    expect(getByTitle('Ctrl+Z').disabled).toBe(true)
  })
})

describe('JsonEditorView — inline edit and delete', () => {
  it('double-clicking a primitive value edits it inline', () => {
    const { getByText, getByDisplayValue } = renderEditor()
    fireEvent.doubleClick(getByText('Alice Johnson'))
    const input = getByDisplayValue('Alice Johnson')
    fireEvent.change(input, { target: { value: 'Bob Smith' } })
    fireEvent.blur(input)
    expect(getByText('Bob Smith')).toBeTruthy()
  })

  it('deletes a field after confirming', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { getAllByTitle, queryByText } = renderEditor()
    fireEvent.click(getAllByTitle('Delete')[0]) // first field in key order is "name"
    expect(queryByText('Alice Johnson')).toBeNull()
    window.confirm.mockRestore()
  })
})

describe('JsonEditorView — add/edit modal', () => {
  it('adds a new string field to the root object', () => {
    const { getByTitle, getByPlaceholderText, getByText } = renderEditor()
    fireEvent.click(getByTitle('Add field'))
    fireEvent.change(getByPlaceholderText('e.g. username'), { target: { value: 'nickname' } })
    fireEvent.change(getByPlaceholderText('Enter text…'), { target: { value: 'Ally' } })
    fireEvent.click(getByTitle('Save field'))
    expect(getByText('nickname')).toBeTruthy()
    expect(getByText('Ally')).toBeTruthy()
  })
})

describe('JsonEditorView — search, expand/collapse', () => {
  it('highlights search matches in the tree', () => {
    const { container, getByPlaceholderText } = renderEditor()
    fireEvent.change(getByPlaceholderText('Search…'), { target: { value: 'alice' } })
    expect(container.querySelector('mark').textContent.toLowerCase()).toBe('alice')
  })

  it('collapse-all then expand-all toggles nested content visibility', () => {
    const { getByText, queryByText } = renderEditor()
    fireEvent.click(getByText('Collapse'))
    expect(queryByText('12 Oak Avenue')).toBeNull()
    fireEvent.click(getByText('Expand'))
    expect(getByText('12 Oak Avenue')).toBeTruthy()
  })
})

describe('JsonEditorView — persistence', () => {
  it('persists edited content to storage (debounced) and restores it on remount', () => {
    vi.useFakeTimers()
    const storage = memStorage()
    const { container, unmount, getByText } = renderEditor(storage)
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"x":1}' } })
    act(() => { vi.advanceTimersByTime(1500) })
    unmount()
    vi.useRealTimers()

    const { container: container2, getByText: getByText2, getByRole: getByRole2 } = renderEditor(storage)
    fireEvent.click(getByRole2('button', { name: /^Documents/ }))
    expect(getByText2('Documents (1)')).toBeTruthy()
  })
})

describe('JsonEditorView — documents', () => {
  it('shows a Documents button that opens the modal, and a New button', () => {
    const { getByText } = renderEditor()
    expect(getByText('New')).toBeTruthy()
    fireEvent.click(getByText('Documents'))
    expect(getByText('No saved documents yet.')).toBeTruthy()
  })

  it('autosaves typed content into a new document and shows it in the modal', () => {
    vi.useFakeTimers()
    const { container, getByText, getByRole } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.click(getByRole('button', { name: /^Documents/ }))
    expect(getByText('Documents (1)')).toBeTruthy()
    vi.useRealTimers()
  })

  it('opening a saved document loads its content into the tree and raw pane', () => {
    vi.useFakeTimers()
    const { container, getByText, getAllByText, getByRole } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('New'))
    fireEvent.change(container.querySelector('textarea'), { target: { value: '{"other":"doc"}' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByRole('button', { name: /^Documents/ }))
    fireEvent.click(getAllByText(/greeting/)[0])
    // Document content round-trips exactly as typed/saved (no reformatting
    // on load), so the raw pane should show the original compact JSON.
    expect(container.querySelector('textarea').value).toBe('{"greeting":"hi"}')
    vi.useRealTimers()
  })

  it('New resets the editor to an empty object', () => {
    vi.useFakeTimers()
    const { container, getByText } = renderEditor()
    fireEvent.change(container.querySelector('textarea'), { target: { value: '{"x":1}' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('New'))
    expect(container.querySelector('textarea').value).toBe('{}')
    vi.useRealTimers()
  })
})
