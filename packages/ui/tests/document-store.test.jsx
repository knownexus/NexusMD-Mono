import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider } from '../src/index.js'
import { generateId, displayName, relativeTime, useDocumentAutosave } from '../src/views/document-store.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function HookHarness({ config, captured }) {
  const result = useDocumentAutosave(config)
  captured.current = result
  return null
}

function renderHook(config, storage = memStorage()) {
  const captured = { current: null }
  render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <HookHarness config={config} captured={captured}/>
    </NexusDataProvider>
  )
  return { captured, storage }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('generateId / displayName / relativeTime', () => {
  it('generates unique-ish ids', () => {
    expect(generateId()).not.toBe(generateId())
  })

  it('displayName prefers an explicit name, falling back to autoName', () => {
    expect(displayName({ name: 'Custom', autoName: 'Auto' })).toBe('Custom')
    expect(displayName({ name: null, autoName: 'Auto' })).toBe('Auto')
  })

  it('relativeTime formats recent timestamps', () => {
    expect(relativeTime(Date.now())).toBe('just now')
    expect(relativeTime(Date.now() - 5 * 60000)).toBe('5m ago')
    expect(relativeTime(Date.now() - 3 * 3600000)).toBe('3h ago')
  })
})

const stringConfig = {
  storageKey: 'test_docs',
  initialContent: '',
  emptyContent: '',
  isEmpty: t => !t.trim(),
  extractAutoName: t => t.trim().slice(0, 20) || 'Untitled',
}

describe('useDocumentAutosave — creating and updating docs', () => {
  it('silently creates a new document 1500ms after typing starts with none open', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    expect(captured.current.currentDocId).toBeNull()

    act(() => { captured.current.setContent('hello world') })
    act(() => { vi.advanceTimersByTime(1499) })
    expect(captured.current.docs.length).toBe(0)

    act(() => { vi.advanceTimersByTime(1) })
    expect(captured.current.docs.length).toBe(1)
    expect(captured.current.currentDocId).toBe(captured.current.docs[0].id)
    expect(captured.current.docs[0].content).toBe('hello world')
    expect(captured.current.docs[0].autoName).toBe('hello world')
  })

  it('updates the open document 300ms after further edits', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { captured.current.setContent('first') })
    act(() => { vi.advanceTimersByTime(1500) })
    const docId = captured.current.currentDocId

    act(() => { captured.current.setContent('first edit') })
    act(() => { vi.advanceTimersByTime(299) })
    expect(captured.current.docs.find(d => d.id === docId).content).toBe('first')

    act(() => { vi.advanceTimersByTime(1) })
    expect(captured.current.docs.find(d => d.id === docId).content).toBe('first edit')
  })

  it('does not create a document while content is empty', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(captured.current.docs.length).toBe(0)
  })
})

describe('useDocumentAutosave — open/new/delete/rename', () => {
  it('opens a document, loading its content without creating a duplicate', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { captured.current.setContent('doc one') })
    act(() => { vi.advanceTimersByTime(1500) })
    const firstId = captured.current.currentDocId

    act(() => { captured.current.newDoc() })
    act(() => { captured.current.setContent('doc two') })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(captured.current.docs.length).toBe(2)

    act(() => { captured.current.openDoc(firstId) })
    expect(captured.current.content).toBe('doc one')
    expect(captured.current.currentDocId).toBe(firstId)
    expect(captured.current.docs.length).toBe(2)
  })

  it('newDoc resets content and clears the current doc id', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { captured.current.setContent('something') })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(captured.current.currentDocId).not.toBeNull()

    act(() => { captured.current.newDoc() })
    expect(captured.current.currentDocId).toBeNull()
    expect(captured.current.content).toBe('')
  })

  it('deleteDoc removes the document and resets content if it was open', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { captured.current.setContent('to delete') })
    act(() => { vi.advanceTimersByTime(1500) })
    const id = captured.current.currentDocId

    act(() => { captured.current.deleteDoc(id) })
    expect(captured.current.docs.length).toBe(0)
    expect(captured.current.currentDocId).toBeNull()
    expect(captured.current.content).toBe('')
  })

  it('renameDoc sets an explicit name', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(stringConfig)
    act(() => { captured.current.setContent('rename me') })
    act(() => { vi.advanceTimersByTime(1500) })
    const id = captured.current.currentDocId

    act(() => { captured.current.renameDoc(id, 'My Title') })
    expect(captured.current.docs.find(d => d.id === id).name).toBe('My Title')
  })
})

describe('useDocumentAutosave — persistence', () => {
  it('persists the document list to storage and restores it on remount', () => {
    vi.useFakeTimers()
    const storage = memStorage()
    const { captured } = renderHook(stringConfig, storage)
    act(() => { captured.current.setContent('persisted doc') })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(storage.getItem('test_docs')).toContain('persisted doc')

    const { captured: captured2 } = renderHook(stringConfig, storage)
    expect(captured2.current.docs.length).toBe(1)
    expect(captured2.current.docs[0].content).toBe('persisted doc')
  })
})

describe('useDocumentAutosave — object content (non-string, regex-shaped)', () => {
  const objConfig = {
    storageKey: 'test_obj_docs',
    initialContent: { pattern: '', flags: { g: true } },
    emptyContent: { pattern: '', flags: { g: true } },
    isEmpty: s => !s.pattern,
    extractAutoName: s => s.pattern ? `/${s.pattern}/` : 'Untitled',
  }

  it('treats an empty pattern as empty content and does not autosave', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(objConfig)
    act(() => { captured.current.setContent({ pattern: '', flags: { g: true, i: true } }) })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(captured.current.docs.length).toBe(0)
  })

  it('autosaves once the pattern is non-empty', () => {
    vi.useFakeTimers()
    const { captured } = renderHook(objConfig)
    act(() => { captured.current.setContent({ pattern: '\\d+', flags: { g: true } }) })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(captured.current.docs.length).toBe(1)
    expect(captured.current.docs[0].autoName).toBe('/\\d+/')
  })
})
