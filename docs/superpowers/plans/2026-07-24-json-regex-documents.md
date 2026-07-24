# Save/Load Documents for JSON Editor and Regex Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Markdown-style save/load document lists (autosave-into-named-doc, "Documents (N)" modal, "New") to `JsonEditorView` and `RegexTesterView`, each with its own independent document list.

**Architecture:** Two new shared, reusable pieces in `packages/ui`: `document-store.js` (pure helpers + a `useDocumentAutosave` hook that reproduces `MarkdownViewer`'s exact two-timer autosave state machine, generalized to any content shape) and `documents-modal.jsx` (a generic `DocumentsModal`, same interaction model as `MarkdownViewer`'s inline one, parameterized by `renderPreview`/`metaText` render props instead of hardcoded markdown rendering). `MarkdownViewer` itself is not modified. `JsonEditorView` and `RegexTesterView` each swap their existing single-buffer `usePersisted` persistence for `useDocumentAutosave`, and gain "New" + "Documents (N)" toolbar buttons.

**Tech Stack:** React (function components + hooks), Vitest + `@testing-library/react`, the existing `@nexusmd/ui` package's `Icon` component, `usePersisted` hook, and CSS custom-property theme.

## Global Constraints

- Every new/modified file lives under `packages/ui/`. `MarkdownViewer.jsx` is NOT modified anywhere in this plan.
- All vitest suites run from `packages/ui` (`cd packages/ui && npm test`), never from repo root.
- No new external dependencies, no new icons — `plus` and `doc` (used for the new toolbar buttons) already exist in `packages/ui/src/icons.jsx`.
- Document lists persist via the existing `usePersisted` hook (profile-scoped storage) under NEW storage keys (`json_editor_documents`, `regex_tester_documents`) — distinct from the two components' existing single-blob keys (`json_editor_content`, `regex_tester_state`), which become dead/unused after this plan (not migrated — acceptable for this internal tool; old data is simply orphaned, not read or deleted).
- Behavior change, intentional: reload no longer restores the exact last-typed content verbatim. Instead, both tools always start from their defined initial content on mount; prior work is reachable via the Documents list once autosaved (up to ~1.5s after typing starts). This matches `MarkdownViewer`'s existing behavior exactly.
- Component styling uses the app's existing CSS custom properties, consistent with `JsonEditorView`/`RegexTesterView`'s established convention — including for the new shared modal, which uses theme vars (`--danger`, `--accent-fg`, etc.) even in places where `MarkdownViewer`'s original inline modal used raw hex (`#ef4444`, `#fff`) — this is an intentional small improvement in new code, not a requirement to byte-match `MarkdownViewer`'s CSS.

---

## Task 1: Document store (pure helpers + autosave hook)

**Files:**
- Create: `packages/ui/src/views/document-store.js`
- Test: `packages/ui/tests/document-store.test.jsx`

**Interfaces:**
- Produces (consumed by Tasks 2-4): `generateId()`, `displayName(doc)`, `relativeTime(ts)`, and `useDocumentAutosave({ storageKey, initialContent, emptyContent, isEmpty, extractAutoName })` returning `{ content, setContent, docs, currentDocId, saveStatus, hasUnsavedContent, openDoc(id), newDoc(), deleteDoc(id), renameDoc(id, name) }`.
- A document has shape `{ id, name, autoName, content, createdAt, updatedAt }` where `content` can be any shape the caller chooses (string or plain object) — the hook and its consumers never assume it's markdown text.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/document-store.test.jsx`:

```jsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/ui`): `npm test -- document-store.test.jsx`
Expected: FAIL — `Cannot find module '../src/views/document-store.js'`.

- [ ] **Step 3: Implement `document-store.js`**

Create `packages/ui/src/views/document-store.js`:

```js
// document-store.js — shared multi-document save/load system: autosave a
// working buffer into a named document, mirroring MarkdownViewer's model
// (see MarkdownViewer.jsx's loadDocs/saveDocs/generateId/relativeTime and
// its autosave effect), generalized to work with any content shape (a
// string, or a structured object) rather than assuming markdown text.
import React from 'react'
import { usePersisted } from '../app-components.jsx'

const { useState, useEffect, useRef } = React

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function displayName(doc) {
  return doc.name ?? doc.autoName
}

export function relativeTime(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

// Reproduces MarkdownViewer's autosave state machine: a 300ms debounce to
// update the currently-open document, and a 1500ms debounce to silently
// create a new one once typing starts with nothing open. `isEmpty(content)`
// and `extractAutoName(content)` let each caller define what "nothing to
// save yet" and "a display name" mean for their content shape.
export function useDocumentAutosave({ storageKey, initialContent, emptyContent, isEmpty, extractAutoName }) {
  const [docs, setDocs] = usePersisted(storageKey, [])
  const [content, setContent] = useState(initialContent)
  const [currentDocId, setCurrentDocId] = useState(null)
  const [saveStatus, setSaveStatus] = useState('')

  // Kept fresh every render so the debounced timer callbacks below always
  // read the latest typed content, not a stale closure from when the timer
  // was scheduled.
  const contentRef = useRef(content)
  contentRef.current = content

  const isLoadingDoc = useRef(false)
  const saveTimerRef = useRef(null)
  const createDocTimerRef = useRef(null)
  const saveStatusTimerRef = useRef(null)

  useEffect(() => {
    // Skip when we programmatically loaded/reset content (open/new/delete),
    // not a user edit.
    if (isLoadingDoc.current) { isLoadingDoc.current = false; return }

    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)

    if (isEmpty(content)) { setSaveStatus(''); return }

    if (currentDocId) {
      setSaveStatus('saving')
      saveTimerRef.current = setTimeout(() => {
        const c = contentRef.current
        setDocs(prev => prev.map(d => d.id === currentDocId
          ? { ...d, content: c, autoName: extractAutoName(c), updatedAt: Date.now() }
          : d
        ))
        setSaveStatus('saved')
        clearTimeout(saveStatusTimerRef.current)
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000)
      }, 300)
    } else {
      setSaveStatus('unsaved')
      createDocTimerRef.current = setTimeout(() => {
        const c = contentRef.current
        if (isEmpty(c)) return
        const newDocEntry = {
          id: generateId(), name: null,
          autoName: extractAutoName(c), content: c,
          createdAt: Date.now(), updatedAt: Date.now(),
        }
        setCurrentDocId(newDocEntry.id)
        setDocs(prev => [...prev, newDocEntry])
        setSaveStatus('saved')
        clearTimeout(saveStatusTimerRef.current)
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000)
      }, 1500)
    }

    return () => {
      clearTimeout(saveTimerRef.current)
      clearTimeout(createDocTimerRef.current)
    }
  }, [content, currentDocId])

  useEffect(() => () => clearTimeout(saveStatusTimerRef.current), [])

  function openDoc(id) {
    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)
    const doc = docs.find(d => d.id === id)
    if (!doc) return
    isLoadingDoc.current = true
    setContent(doc.content)
    setCurrentDocId(id)
    setSaveStatus('')
  }

  function newDoc() {
    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)
    isLoadingDoc.current = true
    setCurrentDocId(null)
    setContent(emptyContent)
    setSaveStatus('')
  }

  function deleteDoc(id) {
    setDocs(prev => prev.filter(d => d.id !== id))
    if (currentDocId === id) {
      isLoadingDoc.current = true
      setCurrentDocId(null)
      setContent(emptyContent)
      setSaveStatus('')
    }
  }

  function renameDoc(id, name) {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, name: name || null } : d))
  }

  const hasUnsavedContent = !currentDocId && !isEmpty(content)

  return { content, setContent, docs, currentDocId, saveStatus, hasUnsavedContent, openDoc, newDoc, deleteDoc, renameDoc }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- document-store.test.jsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/document-store.js packages/ui/tests/document-store.test.jsx
git commit -m "feat(ui): add shared document-autosave store (helpers + hook)"
```

---

## Task 2: Generic DocumentsModal

**Files:**
- Create: `packages/ui/src/views/documents-modal.jsx`
- Test: `packages/ui/tests/documents-modal.test.jsx`

**Interfaces:**
- Consumes: `displayName` from `./document-store.js` (Task 1).
- Produces (consumed by Tasks 3-4): `DocumentsModal` — props `{ docs, currentDocId, hasUnsavedContent, onOpen(id), onNew(), onDelete(id), onRename(id, name), onClose(), renderPreview(doc), metaText(doc) }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/documents-modal.test.jsx`:

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { DocumentsModal } from '../src/views/documents-modal.jsx'

afterEach(cleanup)

function makeDocs() {
  return [
    { id: '1', name: null, autoName: 'First doc', content: 'a', createdAt: 1, updatedAt: 2000 },
    { id: '2', name: 'Custom Name', autoName: 'Second doc', content: 'b', createdAt: 1, updatedAt: 1000 },
  ]
}

function renderModal(overrides = {}) {
  const props = {
    docs: makeDocs(),
    currentDocId: null,
    hasUnsavedContent: false,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onClose: vi.fn(),
    renderPreview: doc => <div>preview:{doc.id}</div>,
    metaText: doc => `meta:${doc.id}`,
    ...overrides,
  }
  const utils = render(<DocumentsModal {...props}/>)
  return { ...utils, props }
}

describe('DocumentsModal', () => {
  it('lists documents sorted by most-recently-updated first, with name/meta/preview', () => {
    const { getAllByText, getByText } = renderModal()
    expect(getByText('First doc')).toBeTruthy()
    expect(getByText('Custom Name')).toBeTruthy()
    expect(getByText('preview:1')).toBeTruthy()
    expect(getByText('meta:2')).toBeTruthy()
    const names = getAllByText(/^(First doc|Custom Name)$/).map(el => el.textContent)
    expect(names).toEqual(['First doc', 'Custom Name'])
  })

  it('shows an empty state when there are no documents', () => {
    const { getByText } = renderModal({ docs: [] })
    expect(getByText('No saved documents yet.')).toBeTruthy()
  })

  it('opens a document on click when there is no unsaved content', () => {
    const { getByText, props } = renderModal()
    fireEvent.click(getByText('First doc'))
    expect(props.onOpen).toHaveBeenCalledWith('1')
  })

  it('asks for confirmation before discarding unsaved content to open another doc', () => {
    const { getByText, props } = renderModal({ hasUnsavedContent: true })
    fireEvent.click(getByText('First doc'))
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(getByText('Open anyway')).toBeTruthy()
    fireEvent.click(getByText('Open anyway'))
    expect(props.onOpen).toHaveBeenCalledWith('1')
  })

  it('renames a document', () => {
    const { getAllByTitle, props } = renderModal()
    fireEvent.click(getAllByTitle('Rename')[0])
    const input = document.querySelector('input')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    expect(props.onRename).toHaveBeenCalledWith('1', 'Renamed')
  })

  it('deletes a document after confirming', () => {
    const { getAllByTitle, getByText, props } = renderModal()
    fireEvent.click(getAllByTitle('Delete')[0])
    fireEvent.click(getByText('Delete?'))
    expect(props.onDelete).toHaveBeenCalledWith('1')
  })

  it('calls onNew when clicking New Document', () => {
    const { getByText, props } = renderModal()
    fireEvent.click(getByText('+ New Document'))
    expect(props.onNew).toHaveBeenCalled()
  })

  it('closes when clicking the backdrop', () => {
    const { container, props } = renderModal()
    fireEvent.click(container.firstChild)
    expect(props.onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- documents-modal.test.jsx`
Expected: FAIL — `Cannot find module '../src/views/documents-modal.jsx'`.

- [ ] **Step 3: Implement `DocumentsModal`**

Create `packages/ui/src/views/documents-modal.jsx`:

```jsx
// documents-modal.jsx — generic multi-document picker (new/open/rename/
// delete), the same interaction model as MarkdownViewer's inline
// DocumentsModal, generalized via renderPreview/metaText render props so it
// isn't tied to markdown-specific content or rendering.
import React from 'react'
import { displayName } from './document-store.js'

const { useState } = React

export function DocumentsModal({ docs, currentDocId, hasUnsavedContent, onOpen, onNew, onDelete, onRename, onClose, renderPreview, metaText }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [pendingOpenId, setPendingOpenId] = useState(null)

  const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt)

  function handleCardClick(doc) {
    if (doc.id === currentDocId) { onClose(); return }
    if (hasUnsavedContent) { setPendingOpenId(doc.id); return }
    onOpen(doc.id)
  }

  function startRename(e, doc) {
    e.stopPropagation()
    setRenamingId(doc.id)
    setRenameValue(doc.name ?? doc.autoName)
    setConfirmDeleteId(null)
  }

  function commitRename(id) {
    const val = renameValue.trim()
    const doc = docs.find(d => d.id === id)
    onRename(id, (doc && val === doc.autoName) ? null : (val || null))
    setRenamingId(null)
  }

  function startDelete(e, id) {
    e.stopPropagation()
    setConfirmDeleteId(id)
    setRenamingId(null)
  }

  const iconBtnStyle = {
    width: 26, height: 26, borderRadius: 4,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, padding: 0, flexShrink: 0,
  }

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 16px', overflowY: 'auto',
        }}
        onClick={onClose}
      >
        <div
          style={{
            width: '100%', maxWidth: 880,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Documents
              {docs.length > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>
                  ({docs.length})
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={onNew}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  border: '1px solid var(--accent)', background: 'var(--accent)',
                  color: 'var(--accent-fg)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >+ New Document</button>
              <button
                onClick={onClose}
                style={{
                  ...iconBtnStyle, width: 30, height: 30,
                  fontSize: 18, color: 'var(--text-muted)', border: '1px solid var(--border)',
                }}
              >×</button>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {docs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-subtle)', fontSize: 13 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
                  style={{ display: 'block', margin: '0 auto 12px', opacity: .4 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>No saved documents yet.</p>
                <p style={{ marginTop: 4 }}>Start typing to create one.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16,
              }}>
                {sorted.map(doc => {
                  const isActive   = doc.id === currentDocId
                  const isRenaming = renamingId === doc.id
                  const isDeleting = confirmDeleteId === doc.id

                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleCardClick(doc)}
                      style={{
                        position: 'relative', borderRadius: 8, overflow: 'hidden',
                        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        background: 'var(--bg)', cursor: 'pointer',
                        transition: 'border-color .15s',
                      }}
                    >
                      <div
                        style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}
                        onClick={e => e.stopPropagation()}
                      >
                        {isDeleting ? (
                          <>
                            <button
                              style={{ ...iconBtnStyle, color: 'var(--danger)', borderColor: 'var(--danger)', padding: '0 8px', width: 'auto', gap: 4, fontSize: 11 }}
                              onClick={e => { e.stopPropagation(); onDelete(doc.id); setConfirmDeleteId(null) }}
                            >Delete?</button>
                            <button
                              style={iconBtnStyle}
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}
                            >✕</button>
                          </>
                        ) : (
                          <>
                            <button style={iconBtnStyle} title="Rename" onClick={e => startRename(e, doc)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M11 2l3 3L5 14H2v-3L11 2z"/>
                              </svg>
                            </button>
                            <button style={{ ...iconBtnStyle, color: 'var(--danger)' }} title="Delete" onClick={e => startDelete(e, doc.id)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <polyline points="2 4 14 4"/>
                                <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
                                <path d="M3 4l1 10h8l1-10"/>
                              </svg>
                            </button>
                          </>
                        )}
                      </div>

                      <div style={{
                        height: 130, overflow: 'hidden', position: 'relative',
                        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
                      }}>
                        {renderPreview(doc)}
                      </div>

                      <div style={{ padding: '10px 12px 12px' }}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(doc.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(doc.id) }
                              if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%', border: '1px solid var(--accent)',
                              borderRadius: 4, padding: '3px 7px',
                              background: 'var(--surface)', color: 'var(--text)',
                              fontSize: 12, fontWeight: 600, outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        ) : (
                          <div style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            paddingRight: 58,
                          }}>
                            {displayName(doc)}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                          {metaText(doc)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingOpenId !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '28px 32px', maxWidth: 360, width: '100%',
            margin: '0 16px', textAlign: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,.25)',
          }}>
            <p style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              You have unsaved content. Open this document anyway?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                }}
                onClick={() => setPendingOpenId(null)}
              >Cancel</button>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: 'none', background: 'var(--accent)',
                  color: 'var(--accent-fg)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
                onClick={() => { onOpen(pendingOpenId); setPendingOpenId(null) }}
              >Open anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- documents-modal.test.jsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/documents-modal.jsx packages/ui/tests/documents-modal.test.jsx
git commit -m "feat(ui): add generic DocumentsModal (preview/meta render props)"
```

---

## Task 3: Wire documents into JsonEditorView

**Files:**
- Modify: `packages/ui/src/views/view-json-editor.jsx`
- Modify: `packages/ui/tests/json-editor.test.jsx`

**Interfaces:**
- Consumes: `useDocumentAutosave`, `displayName`, `relativeTime` from `./document-store.js` (Task 1); `DocumentsModal` from `./documents-modal.jsx` (Task 2).

**Note on scope:** this task also simplifies `JsonEditorView`'s existing data-derivation so that `data`/`rawError` are derived from `rawText` by a single effect rather than being set individually inside `commit`/`undo`/`redo`/`onRawChange`. This is necessary because `openDoc`/`newDoc`/`deleteDoc` change `rawText` from outside those handlers, and there's no other way for `data` to stay in sync with content changes that originate from the document system. It is a deliberate refactor, not incidental scope creep — call this out if a reviewer flags it.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/tests/json-editor.test.jsx`, add these tests. Read the existing file first to see the exact `memStorage()`/`renderEditor()` helpers already defined there and reuse them — do not redefine.

```jsx
describe('JsonEditorView — documents', () => {
  it('shows a Documents button that opens the modal, and a New button', () => {
    const { getByText } = renderEditor()
    expect(getByText('New')).toBeTruthy()
    fireEvent.click(getByText('Documents'))
    expect(getByText('No saved documents yet.')).toBeTruthy()
  })

  it('autosaves typed content into a new document and shows it in the modal', () => {
    vi.useFakeTimers()
    const { container, getByText } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.click(getByText('Documents'))
    expect(getByText('Documents (1)')).toBeTruthy()
    vi.useRealTimers()
  })

  it('opening a saved document loads its content into the tree and raw pane', () => {
    vi.useFakeTimers()
    const { container, getByText } = renderEditor()
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"greeting":"hi"}' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('New'))
    fireEvent.change(container.querySelector('textarea'), { target: { value: '{"other":"doc"}' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('Documents'))
    fireEvent.click(getByText(/greeting/))
    expect(container.querySelector('textarea').value).toContain('"greeting": "hi"')
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/ui`): `npm test -- json-editor.test.jsx`
Expected: FAIL — no "New"/"Documents" buttons exist yet.

- [ ] **Step 3: Update imports and module-level constants**

In `packages/ui/src/views/view-json-editor.jsx`, change:

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'
import { usePersisted } from '../app-components.jsx'
import {
  typeOf, setValueAtPath, deleteAtPath, replaceAtPath, addFieldAtPath,
  coerceVal, allContainerPaths, highlightSegments,
} from './json-editor-helpers.js'

const { useState, useEffect, useRef, useCallback } = React

const SAMPLE = {
  name: 'Alice Johnson',
  age: 28,
  active: true,
  role: null,
  address: { street: '12 Oak Avenue', city: 'Bristol', postcode: 'BS1 4QX' },
  tags: ['developer', 'designer', 'mentor'],
  score: 94.5,
}
const SAMPLE_TEXT = JSON.stringify(SAMPLE, null, 2)
const STORAGE_KEY = 'json_editor_content'
const TYPE_OPTIONS = [
```

to:

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'
import {
  typeOf, setValueAtPath, deleteAtPath, replaceAtPath, addFieldAtPath,
  coerceVal, allContainerPaths, highlightSegments,
} from './json-editor-helpers.js'
import { useDocumentAutosave, relativeTime } from './document-store.js'
import { DocumentsModal } from './documents-modal.jsx'

const { useState, useEffect, useRef, useCallback } = React

const SAMPLE = {
  name: 'Alice Johnson',
  age: 28,
  active: true,
  role: null,
  address: { street: '12 Oak Avenue', city: 'Bristol', postcode: 'BS1 4QX' },
  tags: ['developer', 'designer', 'mentor'],
  score: 94.5,
}
const SAMPLE_TEXT = JSON.stringify(SAMPLE, null, 2)
const EMPTY_TEXT = '{}'
const DOCS_STORAGE_KEY = 'json_editor_documents'
const TYPE_OPTIONS = [
```

(`usePersisted` is no longer imported directly — the new `useDocumentAutosave` hook uses it internally.)

Immediately after `TYPE_OPTIONS`'s closing `]`, add the JSON-specific auto-name extractor (this is new code, not a replacement):

```jsx
// A saved doc's display name: prefer a top-level "name"/"title" string field
// if the JSON has one, otherwise a truncated one-line snippet of the text.
function jsonAutoName(text) {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const nameField = parsed.name ?? parsed.title
      if (typeof nameField === 'string' && nameField.trim()) return nameField.trim().slice(0, 80)
    }
  } catch { /* fall through to raw-text snippet */ }
  const snippet = text.trim().replace(/\s+/g, ' ')
  return snippet ? snippet.slice(0, 60) : 'Untitled'
}
```

- [ ] **Step 4: Replace persistence and data-derivation**

Change:

```jsx
export function JsonEditorView() {
  const [persistedText, setPersistedText] = usePersisted(STORAGE_KEY, SAMPLE_TEXT)

  const [data, setData] = useState(() => parseOr(persistedText, SAMPLE))
  const [rawText, setRawText] = useState(persistedText)
  const [rawError, setRawError] = useState(null)
  const [history, setHistory] = useState(() => [persistedText])
  const [histIdx, setHistIdx] = useState(0)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selectedPath, setSelectedPath] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [modal, setModal] = useState(null)
  const [panelHidden, setPanelHidden] = useState({ left: false, right: false })
  const [leftWidth, setLeftWidth] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)

  const toastTimerRef = useRef(null)
  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const draggingRef = useRef(false)

  // Debounced persistence — write to storage 400ms after the raw text
  // settles, so every keystroke doesn't hit storage.
  useEffect(() => {
    const t = setTimeout(() => setPersistedText(rawText), 400)
    return () => clearTimeout(t)
  }, [rawText, setPersistedText])

  const pushHistory = useCallback((text) => {
    setHistory(prev => [...prev.slice(0, histIdx + 1), text])
    setHistIdx(prev => prev + 1)
  }, [histIdx])

  // Applies a new tree, keeping the raw pane and history in sync with it.
  const commit = useCallback((nextData) => {
    setData(nextData)
    const text = JSON.stringify(nextData, null, 2)
    setRawText(text)
    setRawError(null)
    pushHistory(text)
  }, [pushHistory])
```

to:

```jsx
export function JsonEditorView() {
  const {
    content: rawText, setContent: setRawText, docs, currentDocId, hasUnsavedContent,
    openDoc, newDoc, deleteDoc, renameDoc,
  } = useDocumentAutosave({
    storageKey: DOCS_STORAGE_KEY,
    initialContent: SAMPLE_TEXT,
    emptyContent: EMPTY_TEXT,
    isEmpty: t => !t.trim(),
    extractAutoName: jsonAutoName,
  })

  const [showDocsModal, setShowDocsModal] = useState(false)
  const [data, setData] = useState(() => parseOr(rawText, SAMPLE))
  const [rawError, setRawError] = useState(null)
  const [history, setHistory] = useState(() => [rawText])
  const [histIdx, setHistIdx] = useState(0)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selectedPath, setSelectedPath] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [modal, setModal] = useState(null)
  const [panelHidden, setPanelHidden] = useState({ left: false, right: false })
  const [leftWidth, setLeftWidth] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)

  const toastTimerRef = useRef(null)
  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const draggingRef = useRef(false)

  // Derives the tree (`data`) and error state from `rawText` — the single
  // source of truth for content, whether it changed via typing, undo/redo,
  // a tree edit (commit), or the document system (open/new/delete). Only
  // updates `data` on a successful parse, so the tree keeps showing the last
  // valid value while `rawText` is transiently invalid (e.g. mid-edit).
  useEffect(() => {
    try {
      const parsed = JSON.parse(rawText)
      setData(parsed)
      setRawError(null)
    } catch (err) {
      setRawError(err.message)
    }
  }, [rawText])

  const pushHistory = useCallback((text) => {
    setHistory(prev => [...prev.slice(0, histIdx + 1), text])
    setHistIdx(prev => prev + 1)
  }, [histIdx])

  // Applies a new tree, keeping the raw pane and history in sync with it.
  // (data/rawError update via the effect above, once rawText's new value
  // is parsed.)
  const commit = useCallback((nextData) => {
    const text = JSON.stringify(nextData, null, 2)
    setRawText(text)
    pushHistory(text)
  }, [pushHistory, setRawText])
```

- [ ] **Step 5: Simplify `undo`/`redo`/`onRawChange` (they no longer set `data`/`rawError` directly)**

Change:

```jsx
  function undo() {
    setHistIdx(idx => {
      if (idx === 0) return idx
      const nextIdx = idx - 1
      const text = history[nextIdx]
      setRawText(text)
      setData(parseOr(text, data))
      setRawError(null)
      return nextIdx
    })
  }
  function redo() {
    setHistIdx(idx => {
      if (idx === history.length - 1) return idx
      const nextIdx = idx + 1
      const text = history[nextIdx]
      setRawText(text)
      setData(parseOr(text, data))
      setRawError(null)
      return nextIdx
    })
  }

  function onRawChange(e) {
    const text = e.target.value
    setRawText(text)
    try {
      const parsed = JSON.parse(text)
      setData(parsed)
      setRawError(null)
      pushHistory(text)
    } catch (err) {
      setRawError(err.message)
    }
  }
```

to:

```jsx
  function undo() {
    setHistIdx(idx => {
      if (idx === 0) return idx
      const nextIdx = idx - 1
      setRawText(history[nextIdx])
      return nextIdx
    })
  }
  function redo() {
    setHistIdx(idx => {
      if (idx === history.length - 1) return idx
      const nextIdx = idx + 1
      setRawText(history[nextIdx])
      return nextIdx
    })
  }

  function onRawChange(e) {
    const text = e.target.value
    setRawText(text)
    try {
      JSON.parse(text)
      pushHistory(text)
    } catch { /* data/rawError update via the rawText-driven effect above */ }
  }
```

(`onRawChange` still needs its own `try/JSON.parse` purely to decide whether to `pushHistory` — history should only grow on valid JSON, matching the original behavior; the effect handles `data`/`rawError` regardless.)

- [ ] **Step 6: Add "New" and "Documents (N)" toolbar buttons**

Change:

```jsx
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
            background: rawError === null ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: rawError === null ? 'var(--success)' : 'var(--danger)',
          }}>
            <Icon name={rawError === null ? 'check-circle' : 'alert'} size={12}/> {rawError === null ? 'Valid JSON' : 'Invalid'}
          </span>
          <div className="je-sep"/>
```

to:

```jsx
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="je-btn" onClick={newDoc}><Icon name="plus" size={13}/> New</button>
          <button className="je-btn" onClick={() => setShowDocsModal(true)}>
            <Icon name="doc" size={13}/> Documents{docs.length > 0 ? ` (${docs.length})` : ''}
          </button>
          <div className="je-sep"/>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
            background: rawError === null ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: rawError === null ? 'var(--success)' : 'var(--danger)',
          }}>
            <Icon name={rawError === null ? 'check-circle' : 'alert'} size={12}/> {rawError === null ? 'Valid JSON' : 'Invalid'}
          </span>
          <div className="je-sep"/>
```

- [ ] **Step 7: Render the modal**

Change:

```jsx
      {modal && (
        <JsonEditorModal
          modal={modal}
          onChange={patch => setModal(m => ({ ...m, ...patch }))}
          onSubmit={submitModal}
          onCancel={closeModal}
        />
      )}
```

to:

```jsx
      {modal && (
        <JsonEditorModal
          modal={modal}
          onChange={patch => setModal(m => ({ ...m, ...patch }))}
          onSubmit={submitModal}
          onCancel={closeModal}
        />
      )}

      {showDocsModal && (
        <DocumentsModal
          docs={docs}
          currentDocId={currentDocId}
          hasUnsavedContent={hasUnsavedContent}
          onOpen={id => { openDoc(id); setShowDocsModal(false) }}
          onNew={() => { newDoc(); setShowDocsModal(false) }}
          onDelete={deleteDoc}
          onRename={renameDoc}
          onClose={() => setShowDocsModal(false)}
          renderPreview={doc => (
            <pre style={{
              margin: 0, padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: 10.5, lineHeight: 1.5,
              color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', height: '100%',
            }}>
              {doc.content || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Empty document</span>}
            </pre>
          )}
          metaText={doc => `${doc.content.length.toLocaleString()} chars · ${relativeTime(doc.updatedAt)}`}
        />
      )}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- json-editor.test.jsx`
Expected: PASS (all tests, including the pre-existing ones — the persistence test from the original suite now tests the document system's persistence path instead of the old single-blob key; if that specific pre-existing test fails because it references the old `json_editor_content` storage key, update it to match the new `json_editor_documents` behavior rather than deleting coverage — see the existing "persists edited content..." test in the file and adapt it to assert against the documents list the same way the new tests above do).

- [ ] **Step 9: Run the full packages/ui suite to catch regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/views/view-json-editor.jsx packages/ui/tests/json-editor.test.jsx
git commit -m "feat(ui): add save/load documents to JsonEditorView"
```

---

## Task 4: Wire documents into RegexTesterView

**Files:**
- Modify: `packages/ui/src/views/view-regex-tester.jsx`
- Modify: `packages/ui/tests/regex-tester.test.jsx`

**Interfaces:**
- Consumes: `useDocumentAutosave`, `relativeTime` from `./document-store.js` (Task 1); `DocumentsModal` from `./documents-modal.jsx` (Task 2).

This task is a more direct swap than Task 3: `RegexTesterView`'s existing `state`/`setState` already act as the single source of truth for its whole content (no derived-tree split like JSON has), so `useDocumentAutosave`'s `content`/`setContent` drop in as `state`/`setState` with no further restructuring needed.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/tests/regex-tester.test.jsx`, add these tests. Read the existing file first to see the exact `memStorage()`/`renderRegexTester()` helpers already defined there and reuse them.

```jsx
describe('RegexTesterView — documents', () => {
  it('shows a Documents button that opens the modal, and a New button', () => {
    const { getByText } = renderRegexTester()
    expect(getByText('New')).toBeTruthy()
    fireEvent.click(getByText('Documents'))
    expect(getByText('No saved documents yet.')).toBeTruthy()
  })

  it('autosaves a typed pattern into a new document and shows it in the modal', () => {
    vi.useFakeTimers()
    const { getByDisplayValue, getByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.click(getByText('Documents'))
    expect(getByText('Documents (1)')).toBeTruthy()
    expect(getByText('/\\d+/')).toBeTruthy()
    vi.useRealTimers()
  })

  it('opening a saved pattern loads it back into the pattern input', () => {
    vi.useFakeTimers()
    const { getByDisplayValue, getByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('New'))
    fireEvent.change(getByDisplayValue(''), { target: { value: '[a-z]+' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('Documents'))
    fireEvent.click(getByText('/\\d+/'))
    expect(getByDisplayValue('\\d+')).toBeTruthy()
    vi.useRealTimers()
  })

  it('New resets the pattern but keeps the canned test cases', () => {
    vi.useFakeTimers()
    const { getByDisplayValue, getByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(1500) })

    fireEvent.click(getByText('New'))
    expect(getByDisplayValue('')).toBeTruthy()
    expect(getByText('URL')).toBeTruthy()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/ui`): `npm test -- regex-tester.test.jsx`
Expected: FAIL — no "New"/"Documents" buttons exist yet.

- [ ] **Step 3: Update imports and add the regex-specific auto-name extractor**

Change:

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'
import { usePersisted } from '../app-components.jsx'
import {
  findMatches, buildOverlaySegments, splitMatchByGroups, runUnitTests, genCode, REFERENCE_DATA,
} from './regex-tester-helpers.js'

const { useState, useEffect, useMemo, useRef } = React
```

to:

```jsx
import React from 'react'
import { Icon } from '../icons.jsx'
import {
  findMatches, buildOverlaySegments, splitMatchByGroups, runUnitTests, genCode, REFERENCE_DATA,
} from './regex-tester-helpers.js'
import { useDocumentAutosave, relativeTime } from './document-store.js'
import { DocumentsModal } from './documents-modal.jsx'

const { useState, useEffect, useMemo, useRef } = React
```

Change:

```jsx
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6']
const STORAGE_KEY = 'regex_tester_state'

const DEFAULT_STATE = {
```

to:

```jsx
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6']
const DOCS_STORAGE_KEY = 'regex_tester_documents'

const DEFAULT_STATE = {
```

Immediately after `flagsToString`'s closing `}`, add:

```jsx
// A saved doc's display name: the pattern itself, since that's the natural
// identifier for a saved regex.
function regexAutoName(state) {
  return state.pattern ? `/${state.pattern}/${flagsToString(state.flags)}`.slice(0, 80) : 'Untitled'
}
```

- [ ] **Step 4: Replace persistence**

Change:

```jsx
export function RegexTesterView() {
  const [persisted, setPersisted] = usePersisted(STORAGE_KEY, DEFAULT_STATE)
  const [state, setState] = useState(persisted)
  const [selIdx, setSelIdx] = useState(-1)
  const [bottomTab, setBottomTab] = useState('code')
  const [codeLang, setCodeLang] = useState('JS')
  const [refFilter, setRefFilter] = useState('')

  // Debounced persistence — mirrors JsonEditorView's pattern.
  useEffect(() => {
    const t = setTimeout(() => setPersisted(state), 400)
    return () => clearTimeout(t)
  }, [state, setPersisted])

  function patch(p) { setState(prev => ({ ...prev, ...p })) }
```

to:

```jsx
export function RegexTesterView() {
  const {
    content: state, setContent: setState, docs, currentDocId, hasUnsavedContent,
    openDoc, newDoc, deleteDoc, renameDoc,
  } = useDocumentAutosave({
    storageKey: DOCS_STORAGE_KEY,
    initialContent: DEFAULT_STATE,
    emptyContent: { ...DEFAULT_STATE, pattern: '' },
    isEmpty: s => !s.pattern,
    extractAutoName: regexAutoName,
  })
  const [showDocsModal, setShowDocsModal] = useState(false)
  const [selIdx, setSelIdx] = useState(-1)
  const [bottomTab, setBottomTab] = useState('code')
  const [codeLang, setCodeLang] = useState('JS')
  const [refFilter, setRefFilter] = useState('')

  function patch(p) { setState(prev => ({ ...prev, ...p })) }
```

- [ ] **Step 5: Add "New" and "Documents (N)" buttons to the top bar**

Change:

```jsx
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className={`rt-btn${state.mode === 'match' ? ' on' : ''}`} onClick={() => patch({ mode: 'match' })}>Match</button>
          <button className={`rt-btn${state.mode === 'sub' ? ' on' : ''}`} onClick={() => patch({ mode: 'sub' })}>Substitution</button>
        </div>
      </div>
```

to:

```jsx
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className={`rt-btn${state.mode === 'match' ? ' on' : ''}`} onClick={() => patch({ mode: 'match' })}>Match</button>
          <button className={`rt-btn${state.mode === 'sub' ? ' on' : ''}`} onClick={() => patch({ mode: 'sub' })}>Substitution</button>
        </div>
        <button className="rt-btn" onClick={newDoc}><Icon name="plus" size={12}/> New</button>
        <button className="rt-btn" onClick={() => setShowDocsModal(true)}>
          <Icon name="doc" size={12}/> Documents{docs.length > 0 ? ` (${docs.length})` : ''}
        </button>
      </div>
```

- [ ] **Step 6: Render the modal**

This component has no inline modal today. Change the exact end of the file's JSX from:

```jsx
          {bottomTab === 'ref' && (
            <ReferencePanel filter={refFilter} onFilterChange={setRefFilter} onInsert={insertToken} />
          )}
        </div>
      </div>
    </div>
  )
}
```

to:

```jsx
          {bottomTab === 'ref' && (
            <ReferencePanel filter={refFilter} onFilterChange={setRefFilter} onInsert={insertToken} />
          )}
        </div>
      </div>

      {showDocsModal && (
        <DocumentsModal
          docs={docs}
          currentDocId={currentDocId}
          hasUnsavedContent={hasUnsavedContent}
          onOpen={id => { openDoc(id); setShowDocsModal(false) }}
          onNew={() => { newDoc(); setShowDocsModal(false) }}
          onDelete={deleteDoc}
          onRename={renameDoc}
          onClose={() => setShowDocsModal(false)}
          renderPreview={doc => {
            const activeCase = doc.content.testCases?.[doc.content.tcIndex]
            const firstLine = (activeCase?.content || '').split('\n')[0]
            return (
              <div style={{ padding: '14px 12px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  {doc.content.pattern
                    ? `/${doc.content.pattern}/${flagsToString(doc.content.flags)}`
                    : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Empty pattern</span>}
                </div>
                {firstLine && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {firstLine}
                  </div>
                )}
              </div>
            )
          }}
          metaText={doc => relativeTime(doc.updatedAt)}
        />
      )}
    </div>
  )
}
```

(the bottom grid's two closing `</div>` tags stay exactly as they were; the new modal block is inserted as a sibling right after them, still inside the component's root `<div>`.)

```jsx
      {showDocsModal && (
        <DocumentsModal
          docs={docs}
          currentDocId={currentDocId}
          hasUnsavedContent={hasUnsavedContent}
          onOpen={id => { openDoc(id); setShowDocsModal(false) }}
          onNew={() => { newDoc(); setShowDocsModal(false) }}
          onDelete={deleteDoc}
          onRename={renameDoc}
          onClose={() => setShowDocsModal(false)}
          renderPreview={doc => {
            const activeCase = doc.content.testCases?.[doc.content.tcIndex]
            const firstLine = (activeCase?.content || '').split('\n')[0]
            return (
              <div style={{ padding: '14px 12px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', wordBreak: 'break-all' }}>
                  {doc.content.pattern
                    ? `/${doc.content.pattern}/${flagsToString(doc.content.flags)}`
                    : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Empty pattern</span>}
                </div>
                {firstLine && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {firstLine}
                  </div>
                )}
              </div>
            )
          }}
          metaText={doc => relativeTime(doc.updatedAt)}
        />
      )}
```

Before finalizing this step, read the current end of `RegexTesterView`'s JSX to confirm the exact surrounding structure (this plan was written from the version that ends the component's return with the bottom grid's closing `</div>` followed by the component function's closing `</div>\n  )\n}` — insert the modal block as the last child, immediately before that final `</div>`, matching how `view-json-editor.jsx` places its own modal renders as the last children of its root element).

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- regex-tester.test.jsx`
Expected: PASS (all tests, including pre-existing ones — adapt the pre-existing persistence test the same way as Task 3's Step 8 if it references the old `regex_tester_state` key directly).

- [ ] **Step 8: Run the full packages/ui suite to catch regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/views/view-regex-tester.jsx packages/ui/tests/regex-tester.test.jsx
git commit -m "feat(ui): add save/load documents to RegexTesterView"
```

---

## Self-review notes

- **Spec coverage:** Shared hook + generic modal (Tasks 1-2), JSON Editor wiring including the name-field-first auto-name and `{}` "New" reset (Task 3), Regex Tester wiring including pattern-based auto-name and pattern-only "New" reset that keeps canned test cases (Task 4), independent document lists per tool via distinct storage keys (Global Constraints + each task), `MarkdownViewer` untouched (Global Constraints). All spec sections covered.
- **Placeholder scan:** No TBD/TODO markers. Task 3/4's Step 8 test-adaptation instructions describe what to do (adapt the specific pre-existing persistence test) rather than leaving it undefined, since the exact pre-existing test text depends on the file state at the time this task runs.
- **Type/name consistency:** `useDocumentAutosave`'s returned shape (`content, setContent, docs, currentDocId, saveStatus, hasUnsavedContent, openDoc, newDoc, deleteDoc, renameDoc`) is used identically in Tasks 3 and 4. `DocumentsModal`'s props (`docs, currentDocId, hasUnsavedContent, onOpen, onNew, onDelete, onRename, onClose, renderPreview, metaText`) match between Task 2's implementation and Tasks 3-4's usage. `relativeTime`/`displayName`/`generateId` names match between Task 1 and its consumers.
