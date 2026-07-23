# Documents Page Shell + JSON Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared "Documents" page (tab bar: Markdown | JSON Editor) to `packages/ui`, with a full React port of `docs/json-editor.html` as the JSON Editor tab, wired into `apps/desktop` (whose "Documents" nav entry currently renders the Markdown tool directly).

**Architecture:** Two new files in `packages/ui/src/views/` — `json-editor-helpers.js` (pure, DOM-free tree-mutation logic, immutable/path-based so React state updates trigger correctly) and `view-json-editor.jsx` (the `JsonEditorView` component built on those helpers, styled with the app's existing CSS variable theme, persisted via the shared `usePersisted` hook). A third new file, `view-documents.jsx`, exports `DocumentsView`, a thin tab shell that renders either the existing `MarkdownViewer` or the new `JsonEditorView`. `apps/desktop/src/main.jsx` swaps its `case 'markdown'` render target from `MarkdownViewer` to `DocumentsView`; no nav config changes needed since desktop's `markdown` nav entry is already labeled "Documents".

**Tech Stack:** React (function components + hooks), Vitest + `@testing-library/react` for tests, the existing `@nexusmd/ui` package's `Icon` component and CSS custom-property theme (`--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--text`, `--success`, `--warning`, `--danger`, etc., defined in `packages/ui/src/styles/base.css`).

## Global Constraints

- Every new/modified file lives under `packages/ui/` (shared) or `apps/desktop/src/main.jsx` (wiring) — no changes to `apps/app` or `apps/web` in this plan.
- All vitest suites in this plan run from `packages/ui` (`cd packages/ui && npm test`), never from repo root — this repo's `apps/*`/`packages/ui` test configs have a workspace/jsdom gap when run from root.
- No new external dependencies (no new CDN scripts, no new npm packages). Icons come from the existing shared `Icon` component; add missing icon cases there instead of pulling in Tabler's icon font.
- Component styling uses the app's existing CSS custom properties (see Tech Stack above) — no hardcoded hex colors for anything that should follow the app theme.
- `docs/json-editor.html` is left untouched — it's the behavioral reference, not a build input.

---

## Task 1: Add missing icons to the shared icon set

**Files:**
- Modify: `packages/ui/src/icons.jsx:65-66` (between the `folder` case and `logo` case)
- Test: `packages/ui/tests/icons.test.jsx` (new file)

**Interfaces:**
- Produces: 8 new `Icon` name values consumed by Task 3 — `undo`, `redo`, `expand`, `collapse`, `upload`, `copy`, `download`, `wand`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/tests/icons.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { Icon } from '../src/index.js'

const NEW_ICONS = ['undo', 'redo', 'expand', 'collapse', 'upload', 'copy', 'download', 'wand']

describe('Icon — json-editor icon additions', () => {
  it.each(NEW_ICONS)('renders a non-null element for "%s"', (name) => {
    expect(Icon({ name })).not.toBeNull()
  })

  it('still returns null for an unknown icon name', () => {
    expect(Icon({ name: 'does-not-exist' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `packages/ui`): `npm test -- icons.test.jsx`
Expected: 8 failures — `Icon({ name })` returns `null` for each new name (falls through to `default: return null`).

- [ ] **Step 3: Add the new icon cases**

In `packages/ui/src/icons.jsx`, insert these 8 cases immediately before the existing `case 'logo':` line (i.e. right after `case 'folder': return (...)`):

```jsx
    case 'undo':      return (<svg {...props}><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>);
    case 'redo':      return (<svg {...props}><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/></svg>);
    case 'expand':    return (<svg {...props}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>);
    case 'collapse':  return (<svg {...props}><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>);
    case 'upload':    return (<svg {...props}><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/></svg>);
    case 'copy':      return (<svg {...props}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>);
    case 'download':  return (<svg {...props}><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>);
    case 'wand':      return (<svg {...props}><path d="M4 20 18 6"/><path d="m17 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg>);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- icons.test.jsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/icons.jsx packages/ui/tests/icons.test.jsx
git commit -m "feat(ui): add undo/redo/expand/collapse/upload/copy/download/wand icons"
```

---

## Task 2: JSON tree helpers (pure logic)

**Files:**
- Create: `packages/ui/src/views/json-editor-helpers.js`
- Test: `packages/ui/tests/json-editor-helpers.test.js`

**Interfaces:**
- Produces (consumed by Task 3): `typeOf(val)`, `getAtPath(data, path)`, `setValueAtPath(data, path, newVal)`, `deleteAtPath(data, path)`, `replaceAtPath(data, path, newKey, newVal)`, `addFieldAtPath(data, path, key, val)`, `coerceVal(type, raw)`, `allContainerPaths(data)`, `highlightSegments(text, term)` — all pure, no DOM/React dependency, all path-mutation helpers return a **new** tree rather than mutating the input.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/json-editor-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  typeOf, getAtPath, setValueAtPath, deleteAtPath, replaceAtPath,
  addFieldAtPath, coerceVal, allContainerPaths, highlightSegments,
} from '../src/views/json-editor-helpers.js'

describe('typeOf', () => {
  it('distinguishes array, null, and primitive types', () => {
    expect(typeOf([1, 2])).toBe('array')
    expect(typeOf(null)).toBe('null')
    expect(typeOf('x')).toBe('string')
    expect(typeOf(1)).toBe('number')
    expect(typeOf(true)).toBe('boolean')
    expect(typeOf({})).toBe('object')
  })
})

describe('getAtPath', () => {
  it('walks nested objects and arrays', () => {
    const data = { a: { b: [10, 20] } }
    expect(getAtPath(data, ['a', 'b', 1])).toBe(20)
    expect(getAtPath(data, [])).toBe(data)
  })
})

describe('setValueAtPath', () => {
  it('replaces a nested value without mutating the original', () => {
    const data = { a: { b: 1 } }
    const next = setValueAtPath(data, ['a', 'b'], 2)
    expect(next).toEqual({ a: { b: 2 } })
    expect(data).toEqual({ a: { b: 1 } })
  })

  it('replaces the root when path is empty', () => {
    expect(setValueAtPath({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 })
  })

  it('replaces an array element by index', () => {
    const data = { list: [1, 2, 3] }
    expect(setValueAtPath(data, ['list', 1], 99)).toEqual({ list: [1, 99, 3] })
  })
})

describe('deleteAtPath', () => {
  it('removes an object key', () => {
    expect(deleteAtPath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
  })

  it('removes an array item and shifts indices', () => {
    expect(deleteAtPath({ list: [1, 2, 3] }, ['list', 1])).toEqual({ list: [1, 3] })
  })

  it('is a no-op at the root', () => {
    const data = { a: 1 }
    expect(deleteAtPath(data, [])).toBe(data)
  })
})

describe('replaceAtPath', () => {
  it('renames a key while preserving position', () => {
    const data = { a: 1, b: 2, c: 3 }
    expect(Object.keys(replaceAtPath(data, ['b'], 'renamed', 20))).toEqual(['a', 'renamed', 'c'])
  })

  it('keeps the same key when newKey matches the old one', () => {
    expect(replaceAtPath({ a: 1 }, ['a'], 'a', 2)).toEqual({ a: 2 })
  })

  it('ignores newKey for array items', () => {
    expect(replaceAtPath({ list: [1, 2] }, ['list', 0], 'ignored', 9)).toEqual({ list: [9, 2] })
  })

  it('replaces the whole tree at the root', () => {
    expect(replaceAtPath({ a: 1 }, [], undefined, { b: 2 })).toEqual({ b: 2 })
  })
})

describe('addFieldAtPath', () => {
  it('adds a keyed field to an object', () => {
    expect(addFieldAtPath({}, [], 'name', 'Alice')).toEqual({ name: 'Alice' })
  })

  it('pushes onto an array, ignoring key', () => {
    expect(addFieldAtPath({ list: [1] }, ['list'], null, 2)).toEqual({ list: [1, 2] })
  })
})

describe('coerceVal', () => {
  it('coerces each JSON type from raw modal input', () => {
    expect(coerceVal('string', 'hi')).toBe('hi')
    expect(coerceVal('number', '42')).toBe(42)
    expect(coerceVal('number', 'nope')).toBe(0)
    expect(coerceVal('boolean', 'true')).toBe(true)
    expect(coerceVal('boolean', false)).toBe(false)
    expect(coerceVal('null', 'x')).toBe(null)
    expect(coerceVal('object', 'x')).toEqual({})
    expect(coerceVal('array', 'x')).toEqual([])
  })
})

describe('allContainerPaths', () => {
  it('lists every object/array path, including root', () => {
    const data = { a: { b: 1 }, list: [1, [2]] }
    expect(allContainerPaths(data)).toEqual(['', 'a', 'list', 'list.1'])
  })

  it('returns an empty list for a primitive root', () => {
    expect(allContainerPaths(1)).toEqual([])
  })
})

describe('highlightSegments', () => {
  it('returns the whole string unmatched when there is no search term', () => {
    expect(highlightSegments('hello', '')).toEqual([{ text: 'hello', match: false }])
  })

  it('splits out case-insensitive matches', () => {
    expect(highlightSegments('Alice Johnson', 'jo')).toEqual([
      { text: 'Alice ', match: false },
      { text: 'Jo', match: true },
      { text: 'hnson', match: false },
    ])
  })

  it('escapes regex special characters in the search term', () => {
    expect(highlightSegments('a.b', '.')).toEqual([
      { text: 'a', match: false },
      { text: '.', match: true },
      { text: 'b', match: false },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- json-editor-helpers.test.js`
Expected: FAIL — `Cannot find module '../src/views/json-editor-helpers.js'`.

- [ ] **Step 3: Implement the helpers**

Create `packages/ui/src/views/json-editor-helpers.js`:

```js
// json-editor-helpers.js — pure, DOM-free JSON tree helpers for JsonEditorView.
// Every path-mutation helper returns a NEW tree (never mutates its input), so
// React state updates via setData(next) trigger re-renders correctly.

export function typeOf(val) {
  if (Array.isArray(val)) return 'array'
  if (val === null) return 'null'
  return typeof val
}

export function getAtPath(data, path) {
  let cur = data
  for (const k of path) cur = cur[k]
  return cur
}

function cloneShallow(val) {
  return Array.isArray(val) ? [...val] : { ...val }
}

// Returns a new tree with `updater(node)` applied to the node at parentPath,
// cloning every container from the root down to parentPath (structural
// sharing everywhere else).
function updateAtPath(data, parentPath, updater) {
  if (parentPath.length === 0) return updater(data)
  const [head, ...rest] = parentPath
  const clone = cloneShallow(data)
  clone[head] = updateAtPath(data[head], rest, updater)
  return clone
}

export function setValueAtPath(data, path, newVal) {
  if (path.length === 0) return newVal
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    const clone = cloneShallow(node)
    clone[key] = newVal
    return clone
  })
}

export function deleteAtPath(data, path) {
  if (path.length === 0) return data
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    if (Array.isArray(node)) return node.filter((_, i) => i !== key)
    const clone = { ...node }
    delete clone[key]
    return clone
  })
}

// Renames/replaces the node at `path` in one step: used by the edit modal,
// which can change a key, its type, and its value all at once. `newKey` is
// ignored for array items (array indices aren't renameable).
export function replaceAtPath(data, path, newKey, newVal) {
  if (path.length === 0) return newVal
  const parentPath = path.slice(0, -1)
  const oldKey = path[path.length - 1]
  return updateAtPath(data, parentPath, node => {
    if (Array.isArray(node)) {
      const clone = [...node]
      clone[oldKey] = newVal
      return clone
    }
    if (newKey === undefined || newKey === String(oldKey)) {
      return { ...node, [oldKey]: newVal }
    }
    // Preserve key order: rebuild entries with the renamed key in place.
    const entries = Object.entries(node)
    const idx = entries.findIndex(([k]) => k === String(oldKey))
    entries[idx] = [newKey, newVal]
    return Object.fromEntries(entries)
  })
}

export function addFieldAtPath(data, path, key, val) {
  return updateAtPath(data, path, node => {
    if (Array.isArray(node)) return [...node, val]
    return { ...node, [key]: val }
  })
}

export function coerceVal(type, raw) {
  if (type === 'string') return raw
  if (type === 'number') return isNaN(Number(raw)) ? 0 : Number(raw)
  if (type === 'boolean') return raw === true || raw === 'true' || raw === '1'
  if (type === 'null') return null
  if (type === 'object') return {}
  if (type === 'array') return []
  return null
}

// Every container path in `data` (root included, as ''). Used to seed the
// "collapsed" set for collapseAll().
export function allContainerPaths(data, path = [], out = []) {
  const t = typeOf(data)
  if (t !== 'object' && t !== 'array') return out
  out.push(path.join('.'))
  if (t === 'object') for (const [k, v] of Object.entries(data)) allContainerPaths(v, [...path, k], out)
  else data.forEach((v, i) => allContainerPaths(v, [...path, i], out))
  return out
}

// Splits `text` into [{ text, match }] segments for highlight rendering —
// React renders `match` segments in a <mark>, avoiding dangerouslySetInnerHTML.
export function highlightSegments(text, term) {
  const str = String(text)
  if (!term) return [{ text: str, match: false }]
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const segments = []
  let lastIndex = 0
  let m
  while ((m = re.exec(str)) !== null) {
    if (m.index > lastIndex) segments.push({ text: str.slice(lastIndex, m.index), match: false })
    segments.push({ text: m[0], match: true })
    lastIndex = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (lastIndex < str.length) segments.push({ text: str.slice(lastIndex), match: false })
  return segments.length ? segments : [{ text: str, match: false }]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- json-editor-helpers.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/json-editor-helpers.js packages/ui/tests/json-editor-helpers.test.js
git commit -m "feat(ui): add pure JSON tree helpers for the JSON Editor port"
```

---

## Task 3: JsonEditorView component

**Files:**
- Create: `packages/ui/src/views/view-json-editor.jsx`
- Modify: `packages/ui/src/index.js` (add export, see Task 4 — done together here since Task 3's tests import from the barrel)
- Test: `packages/ui/tests/json-editor.test.jsx`

**Interfaces:**
- Consumes: `Icon` from `../icons.jsx`; `usePersisted` from `../app-components.jsx` (signature: `usePersisted(key, initialValue) => [value, setValue]`, requires a `NexusDataProvider` ancestor); all exports from Task 2's `json-editor-helpers.js`.
- Produces (consumed by Task 4): `JsonEditorView` — a zero-prop component.

- [ ] **Step 1: Export `JsonEditorView` from the barrel (needed for the test to import it)**

In `packages/ui/src/index.js`, immediately after the line `export { MarkdownViewer, displayName } from './views/MarkdownViewer.jsx'`, add:

```js
export { JsonEditorView } from './views/view-json-editor.jsx'
```

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/tests/json-editor.test.jsx`:

```jsx
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
    const { container, unmount } = renderEditor(storage)
    const textarea = container.querySelector('textarea')
    fireEvent.change(textarea, { target: { value: '{"x":1}' } })
    act(() => { vi.advanceTimersByTime(500) })
    expect(storage.getItem('json_editor_content')).toBe('{"x":1}')
    unmount()
    vi.useRealTimers()

    const { container: container2 } = renderEditor(storage)
    expect(container2.querySelector('textarea').value).toBe('{"x":1}')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- json-editor.test.jsx`
Expected: FAIL — `Cannot find module './views/view-json-editor.jsx'` (from the barrel export added in Step 1).

- [ ] **Step 4: Implement `JsonEditorView`**

Create `packages/ui/src/views/view-json-editor.jsx`:

```jsx
// view-json-editor.jsx — full React port of docs/json-editor.html: a two-pane
// JSON editor (tree view + raw text), styled with the app's theme tokens
// instead of the original's own hardcoded light palette.
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
  ['string', 'Text (string)'],
  ['number', 'Number'],
  ['boolean', 'True / False (boolean)'],
  ['null', 'Empty (null)'],
  ['object', 'Group (object { })'],
  ['array', 'List (array [ ])'],
]

function parseOr(text, fallback) {
  try { return JSON.parse(text) } catch { return fallback }
}

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

  function showToast(msg) {
    clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000)
  }

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

  function formatRaw() {
    try {
      const parsed = JSON.parse(rawText)
      commit(parsed)
      showToast('Formatted ✓')
    } catch {
      setRawError('Cannot format — fix errors first')
    }
  }

  function expandAll() { setCollapsed(new Set()) }
  function collapseAll() { setCollapsed(new Set(allContainerPaths(data))) }

  function copyJSON() {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => showToast('Copied to clipboard ✓'))
  }
  function downloadJSON() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'data.json'
    a.click()
    showToast('Downloaded ✓')
  }
  function openFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        commit(parsed)
        showToast(`Opened: ${file.name}`)
      } catch { showToast('Error: invalid JSON file') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function openAddModal(path, containerType) {
    setModal({ mode: 'add', path, containerType, key: '', type: 'string', value: '' })
  }
  function openEditModal(path, keyLabel, curVal) {
    const type = typeOf(curVal)
    setModal({
      mode: 'edit', path, key: String(keyLabel), type,
      value: (type === 'string' || type === 'number' || type === 'boolean') ? curVal : '',
    })
  }
  function closeModal() { setModal(null) }
  function submitModal() {
    setModal(m => {
      if (!m) return m
      const val = coerceVal(m.type, m.value)
      if (m.mode === 'add') {
        const key = m.containerType === 'array' ? null : m.key.trim()
        if (m.containerType !== 'array' && !key) return null
        commit(addFieldAtPath(data, m.path, key, val))
      } else {
        const isArrayIndex = m.path.length > 0 && typeof m.path[m.path.length - 1] === 'number'
        commit(replaceAtPath(data, m.path, isArrayIndex ? undefined : m.key.trim(), val))
      }
      return null
    })
  }

  // Keyboard shortcuts — read the latest handlers via a ref so this effect
  // mounts once instead of re-subscribing (and risking stale closures) on
  // every render.
  const latestRef = useRef(null)
  latestRef.current = { undo, redo, downloadJSON, closeModal, submitModal, modal }
  useEffect(() => {
    function onKeyDown(e) {
      const cur = latestRef.current
      if (cur.modal) {
        if (e.key === 'Escape') { e.preventDefault(); cur.closeModal() }
        if (e.key === 'Enter') { e.preventDefault(); cur.submitModal() }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); cur.undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); cur.redo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); cur.downloadJSON() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function onResizerMouseDown() {
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current || !workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const w = Math.max(180, Math.min(rect.width - 185, e.clientX - rect.left))
      setLeftWidth(w)
    }
    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  function togglePanel(side) {
    setPanelHidden(prev => ({ ...prev, [side]: !prev[side] }))
  }

  const leftStyle = panelHidden.left
    ? { display: 'none' }
    : panelHidden.right
      ? { flex: '1 1 100%' }
      : leftWidth !== null ? { flex: `0 0 ${leftWidth}px` } : { flex: '1 1 50%' }
  const rightStyle = panelHidden.right
    ? { display: 'none' }
    : panelHidden.left
      ? { flex: '1 1 100%' }
      : { flex: '1 1 50%' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
      <style>{`
        .je-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; font-size:12px; white-space:nowrap; }
        .je-btn:hover { background:var(--surface-2); color:var(--text); }
        .je-btn:disabled { opacity:.4; cursor:not-allowed; }
        .je-sep { width:1px; height:18px; background:var(--border); margin:0 2px; flex-shrink:0; }
        .je-row { display:flex; align-items:center; padding:2px 6px 2px 4px; border-radius:5px; min-height:28px; cursor:default; }
        .je-row:hover { background:var(--surface-2); }
        .je-row.selected { background:var(--accent-soft); }
        .je-actions { margin-left:auto; display:flex; gap:1px; opacity:0; }
        .je-row:hover .je-actions { opacity:1; }
        .je-icon-btn { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--text-subtle); cursor:pointer; border-radius:4px; }
        .je-icon-btn:hover { background:var(--surface); color:var(--text); }
        .je-icon-btn.danger:hover { color:var(--danger); }
        mark { background: var(--warning-soft); color: inherit; border-radius:2px; }
      `}</style>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 44, background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>JSON Editor</span>
        <div className="je-sep"/>
        <button className="je-btn" disabled={histIdx === 0} onClick={undo} title="Ctrl+Z"><Icon name="undo" size={13}/> Undo</button>
        <button className="je-btn" disabled={histIdx === history.length - 1} onClick={redo} title="Ctrl+Y"><Icon name="redo" size={13}/> Redo</button>
        <div className="je-sep"/>
        <button className="je-btn" onClick={expandAll}><Icon name="expand" size={13}/> Expand</button>
        <button className="je-btn" onClick={collapseAll}><Icon name="collapse" size={13}/> Collapse</button>
        <div className="je-sep"/>
        <input
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search…"
          style={{ padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', width: 140 }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
            background: rawError === null ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: rawError === null ? 'var(--success)' : 'var(--danger)',
          }}>
            <Icon name={rawError === null ? 'check-circle' : 'alert'} size={12}/> {rawError === null ? 'Valid JSON' : 'Invalid'}
          </span>
          <div className="je-sep"/>
          <label className="je-btn" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={13}/> Open
            <input ref={fileInputRef} type="file" accept=".json" onChange={openFile} style={{ display: 'none' }}/>
          </label>
          <button className="je-btn" onClick={copyJSON}><Icon name="copy" size={13}/> Copy</button>
          <button className="je-btn" onClick={downloadJSON} title="Ctrl+S"><Icon name="download" size={13}/> Save</button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={workspaceRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ ...leftStyle, display: panelHidden.left ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)' }}>
          <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Visual editor</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className="je-icon-btn" title="Add field" onClick={() => openAddModal([], typeOf(data) === 'array' ? 'array' : 'object')}><Icon name="plus" size={13}/></button>
              <button className="je-icon-btn" title="Hide panel" onClick={() => togglePanel('left')}><Icon name="chevron-left" size={13}/></button>
            </div>
          </div>
          <div style={{ padding: '4px 12px', fontSize: 10.5, color: 'var(--text-subtle)', fontFamily: 'var(--mono)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedPath.length ? '/ ' + selectedPath.join(' / ') : '/'}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px 20px' }}>
            <JsonTreeNode
              value={data} keyLabel="root" path={[]} searchTerm={searchTerm}
              collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath}
              onSelect={setSelectedPath}
              onInlineCommit={(path, val) => commit(setValueAtPath(data, path, val))}
              onOpenAdd={openAddModal} onOpenEdit={openEditModal}
              onDelete={(path) => commit(deleteAtPath(data, path))}
            />
          </div>
        </div>

        {!panelHidden.left && !panelHidden.right && (
          <div onMouseDown={onResizerMouseDown} style={{ width: 5, flexShrink: 0, background: 'var(--border)', cursor: 'col-resize' }}/>
        )}

        <div style={{ ...rightStyle, display: panelHidden.right ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Raw JSON</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className="je-icon-btn" title="Format JSON" onClick={formatRaw}><Icon name="wand" size={13}/></button>
              <button className="je-icon-btn" title="Hide panel" onClick={() => togglePanel('right')}><Icon name="chevron-right" size={13}/></button>
            </div>
          </div>
          <textarea
            value={rawText} onChange={onRawChange} spellCheck={false}
            style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', padding: '14px 18px', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.65, background: 'var(--surface)', color: 'var(--text)' }}
          />
          {rawError && (
            <div style={{ padding: '7px 14px', fontSize: 11.5, color: 'var(--danger)', background: 'var(--danger-soft)', borderTop: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>
              ⚠ {rawError}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <JsonEditorModal
          modal={modal}
          onChange={patch => setModal(m => ({ ...m, ...patch }))}
          onSubmit={submitModal}
          onCancel={closeModal}
        />
      )}

      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text)', color: 'var(--bg)', padding: '7px 16px', borderRadius: 99, fontSize: 12.5, zIndex: 300,
        }}>{toastMsg}</div>
      )}
    </div>
  )
}

function JsonTreeNode({ value, keyLabel, path, searchTerm, collapsed, setCollapsed, selectedPath, onSelect, onInlineCommit, onOpenAdd, onOpenEdit, onDelete }) {
  const [editingInline, setEditingInline] = useState(false)
  const [inlineVal, setInlineVal] = useState('')

  const type = typeOf(value)
  const isContainer = type === 'object' || type === 'array'
  const pathKey = path.join('.')
  const isCollapsed = collapsed.has(pathKey)
  const isSelected = selectedPath.join('.') === pathKey

  function toggle() {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(pathKey) ? next.delete(pathKey) : next.add(pathKey)
      return next
    })
  }

  function startInline() {
    if (isContainer || path.length === 0) return
    setInlineVal(value === null ? '' : String(value))
    setEditingInline(true)
  }
  function commitInline() {
    let newVal
    if (type === 'number') newVal = isNaN(Number(inlineVal)) ? value : Number(inlineVal)
    else if (type === 'boolean') newVal = inlineVal.toLowerCase() !== 'false' && inlineVal !== '0' && inlineVal !== ''
    else newVal = inlineVal
    setEditingInline(false)
    onInlineCommit(path, newVal)
  }

  function renderHighlighted(text) {
    return highlightSegments(text, searchTerm).map((seg, i) =>
      seg.match ? <mark key={i}>{seg.text}</mark> : <React.Fragment key={i}>{seg.text}</React.Fragment>
    )
  }

  return (
    <div>
      <div
        className={`je-row${isSelected ? ' selected' : ''}`}
        onClick={() => onSelect(path)}
        onDoubleClick={() => { if (!isContainer && path.length > 0) startInline(); else onOpenEdit(path, keyLabel, value) }}
      >
        {isContainer ? (
          <button onClick={(e) => { e.stopPropagation(); toggle() }} style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-subtle)', flexShrink: 0 }}>
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={11}/>
          </button>
        ) : <span style={{ width: 20, flexShrink: 0 }}/>}

        {keyLabel !== 'root' && (
          <>
            <span style={{ fontWeight: 500, fontSize: 13, flexShrink: 0 }}>{renderHighlighted(String(keyLabel))}</span>
            <span style={{ color: 'var(--text-subtle)', margin: '0 6px 0 4px', flexShrink: 0 }}>→</span>
          </>
        )}

        {isContainer ? (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 4, fontFamily: 'var(--mono)' }}>
            {type === 'object'
              ? (isCollapsed ? `{ ${Object.keys(value).length} field${Object.keys(value).length !== 1 ? 's' : ''} }` : '{ … }')
              : (isCollapsed ? `[ ${value.length} item${value.length !== 1 ? 's' : ''} ]` : '[ … ]')}
          </span>
        ) : editingInline ? (
          <input
            autoFocus value={inlineVal} onChange={e => setInlineVal(e.target.value)}
            onClick={e => e.stopPropagation()}
            onBlur={commitInline}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.stopPropagation(); setEditingInline(false) } }}
            style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, outline: 'none', minWidth: 60 }}
          />
        ) : (
          <ValuePill type={type} value={value} renderText={renderHighlighted}/>
        )}

        <div className="je-actions">
          {isContainer && (
            <button className="je-icon-btn" title="Add field here" onClick={e => { e.stopPropagation(); onOpenAdd(path, type) }}><Icon name="plus" size={12}/></button>
          )}
          <button className="je-icon-btn" title="Edit (or double-click)" onClick={e => { e.stopPropagation(); onOpenEdit(path, keyLabel, value) }}><Icon name="edit" size={12}/></button>
          {path.length > 0 && (
            <button className="je-icon-btn danger" title="Delete" onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${keyLabel}"?`)) onDelete(path) }}><Icon name="trash" size={12}/></button>
          )}
        </div>
      </div>

      {isContainer && !isCollapsed && (
        <div style={{ paddingLeft: 18, borderLeft: '1.5px solid var(--border)', marginLeft: 10 }}>
          {type === 'object'
            ? Object.entries(value).map(([k, v]) => (
                <JsonTreeNode key={k} value={v} keyLabel={k} path={[...path, k]} searchTerm={searchTerm}
                  collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath} onSelect={onSelect}
                  onInlineCommit={onInlineCommit} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} onDelete={onDelete}/>
              ))
            : value.map((v, i) => (
                <JsonTreeNode key={i} value={v} keyLabel={i} path={[...path, i]} searchTerm={searchTerm}
                  collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath} onSelect={onSelect}
                  onInlineCommit={onInlineCommit} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} onDelete={onDelete}/>
              ))}
        </div>
      )}
    </div>
  )
}

function ValuePill({ type, value, renderText }) {
  const styles = {
    string:  { background: 'var(--success-soft)', color: 'var(--success)' },
    number:  { background: 'var(--warning-soft)', color: 'var(--warning)' },
    boolean: value ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' },
    null:    { background: 'var(--surface-2)', color: 'var(--text-subtle)', fontStyle: 'italic' },
  }
  const text = type === 'null' ? 'null' : String(value)
  return (
    <span style={{ display: 'inline-flex', padding: '1px 7px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--mono)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...styles[type] }}>
      {renderText(text)}
    </span>
  )
}

function JsonEditorModal({ modal, onChange, onSubmit, onCancel }) {
  const { mode, containerType, key, type, value } = modal
  const keyDisabled = containerType === 'array' || (mode === 'edit' && modal.path.length > 0 && typeof modal.path[modal.path.length - 1] === 'number')

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: '1.4rem 1.5rem', width: 340, boxShadow: 'var(--shadow-pop)' }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>{mode === 'add' ? 'Add field' : `Edit "${key || 'root'}"`}</h3>

        <label style={modalLabelStyle}>Key</label>
        <input
          value={keyDisabled ? '(auto-index)' : key} disabled={keyDisabled}
          onChange={e => onChange({ key: e.target.value })}
          placeholder="e.g. username" style={modalInputStyle}
        />

        <label style={modalLabelStyle}>Type</label>
        <select value={type} onChange={e => onChange({ type: e.target.value, value: '' })} style={modalInputStyle}>
          {TYPE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>

        {type === 'string' && (
          <div style={{ marginTop: 12 }}>
            <label style={modalLabelStyle}>Value</label>
            <input value={value} onChange={e => onChange({ value: e.target.value })} placeholder="Enter text…" style={modalInputStyle}/>
          </div>
        )}
        {type === 'number' && (
          <div style={{ marginTop: 12 }}>
            <label style={modalLabelStyle}>Value</label>
            <input type="number" value={value} onChange={e => onChange({ value: e.target.value })} placeholder="e.g. 42" style={modalInputStyle}/>
          </div>
        )}
        {type === 'boolean' && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            {[true, false].map(v => (
              <button key={String(v)} onClick={() => onChange({ value: v })}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 500,
                  border: `1.5px solid ${value === v ? 'var(--accent)' : 'var(--border)'}`,
                  background: value === v ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: value === v ? 'var(--accent)' : 'var(--text)',
                }}>{String(v)}</button>
            ))}
          </div>
        )}
        {(type === 'null' || type === 'object' || type === 'array') && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--text-muted)' }}>
            {type === 'null' && 'This field will be set to null — it exists but has no value.'}
            {type === 'object' && 'Creates an empty group { }. You can add fields inside it after saving.'}
            {type === 'array' && 'Creates an empty list [ ]. You can add items inside it after saving.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button className="je-btn" onClick={onCancel}>Cancel</button>
          <button className="je-btn" title="Save field" style={{ background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }} onClick={onSubmit}>Save</button>
        </div>
      </div>
    </div>
  )
}

const modalLabelStyle = { display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginBottom: 5, marginTop: 13, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }
const modalInputStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--surface)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- json-editor.test.jsx`
Expected: PASS (all tests). If any fail, re-check the exact DOM text/attributes the test targets against the component above (e.g. button `title` values) rather than loosening the assertion.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.js packages/ui/src/views/view-json-editor.jsx packages/ui/tests/json-editor.test.jsx
git commit -m "feat(ui): port json-editor.html to a themed JsonEditorView component"
```

---

## Task 4: DocumentsView shell

**Files:**
- Create: `packages/ui/src/views/view-documents.jsx`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/documents-view.test.jsx`

**Interfaces:**
- Consumes: `usePersisted` from `../app-components.jsx`; `MarkdownViewer` from `./MarkdownViewer.jsx`; `JsonEditorView` from `./view-json-editor.jsx` (Task 3).
- Produces (consumed by Task 5): `DocumentsView` — a zero-prop component, exported from the `@nexusmd/ui` barrel.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/documents-view.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, DocumentsView } from '../src/index.js'

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

afterEach(cleanup)

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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- documents-view.test.jsx`
Expected: FAIL — `DocumentsView` is not exported from `../src/index.js`.

- [ ] **Step 3: Implement `DocumentsView` and export it**

Create `packages/ui/src/views/view-documents.jsx`:

```jsx
// view-documents.jsx — shared "Documents" page shell: a tool tab bar plus the
// active tool's content area. New tools (Regex Tester, LINQ-to-SQL) get added
// as tabs here in later specs.
import React from 'react'
import { usePersisted } from '../app-components.jsx'
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { JsonEditorView } from './view-json-editor.jsx'

const TABS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON Editor' },
]
const STORAGE_KEY = 'documents_active_tab'

export function DocumentsView() {
  const [activeTab, setActiveTab] = usePersisted(STORAGE_KEY, 'markdown')
  const tab = TABS.some(t => t.id === activeTab) ? activeTab : 'markdown'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 500,
              background: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? 'var(--accent-fg)' : 'var(--text-muted)',
            }}
          >{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'markdown' ? <MarkdownViewer/> : <JsonEditorView/>}
      </div>
    </div>
  )
}
```

In `packages/ui/src/index.js`, immediately after the `JsonEditorView` export line added in Task 3, add:

```js
export { DocumentsView } from './views/view-documents.jsx'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- documents-view.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full packages/ui suite to catch regressions**

Run: `npm test`
Expected: PASS (all suites, including Tasks 1-3's new tests and every pre-existing test).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.js packages/ui/src/views/view-documents.jsx packages/ui/tests/documents-view.test.jsx
git commit -m "feat(ui): add DocumentsView tab shell hosting Markdown and JSON Editor"
```

---

## Task 5: Wire DocumentsView into apps/desktop

**Files:**
- Modify: `apps/desktop/src/main.jsx:13` (import list), `apps/desktop/src/main.jsx:530-531` (render switch)

**Interfaces:**
- Consumes: `DocumentsView` from `@nexusmd/ui` (Task 4).

- [ ] **Step 1: Update the import**

In `apps/desktop/src/main.jsx`, change:

```js
  PlannerView, MarkdownViewer, plannerExportDocx,
```

to:

```js
  PlannerView, MarkdownViewer, DocumentsView, plannerExportDocx,
```

(`MarkdownViewer` stays imported — nothing else in this file uses it after this change, so check with the next step whether it's still referenced; if not, remove it. As of this plan, `MarkdownViewer` is used nowhere else in `main.jsx`, so it becomes unused — drop it from the import list instead: `PlannerView, DocumentsView, plannerExportDocx,`.)

- [ ] **Step 2: Swap the render target**

Change:

```js
    case 'markdown':
      return <MarkdownViewer />
```

to:

```js
    case 'markdown':
      return <DocumentsView />
```

- [ ] **Step 3: Confirm no other reference to `MarkdownViewer` remains in this file**

Run (from `apps/desktop`): `grep -n "MarkdownViewer" src/main.jsx`
Expected: no output. If there is other output, keep `MarkdownViewer` in the import list instead of removing it in Step 1.

- [ ] **Step 4: Run the desktop test suite**

Run (from `apps/desktop`): `npm test`
Expected: PASS — no existing desktop test asserts on `case 'markdown'` rendering `MarkdownViewer` specifically (confirm by scanning test failures if any appear; if one does, update it to assert on `DocumentsView`'s tab bar instead, e.g. `getByText('JSON Editor')`).

- [ ] **Step 5: Build the renderer to catch compile errors**

Run (from `apps/desktop`): `npx vite build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Attempt runtime verification, report honestly if blocked**

Follow the `apps/desktop:verify` skill. Electron GUI launch is known-blocked in sandboxed shells (exits silently after `app ready` with no window — a pre-existing environment limitation, not a regression). If GUI launch is blocked here too:
- Confirm it's the environment issue, not this change, by running the unmodified `e2e/smoke.spec.js` and observing the same failure mode.
- Trace the render path by hand: `nav-config.js`'s `markdown` entry (label "Documents") → `main.jsx`'s `case 'markdown'` → `<DocumentsView/>` → tab bar defaults to Markdown, `JsonEditorView` reachable via the "JSON Editor" tab. Confirm each link in that chain via `grep`/`Read`, not assumption.
- Report the GUI surface as BLOCKED (environment limitation) alongside PASS results from Steps 4-5, rather than claiming full PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): render DocumentsView (Markdown + JSON Editor) on the Documents nav tab"
```

---

## Self-review notes

- **Spec coverage:** Shell + tab bar (Task 4), full JSON Editor port including layout/tree/raw-sync/undo-redo/inline-edit/modal/search/expand-collapse/copy-download-open/keyboard-shortcuts/resizer/panel-hide (Task 3), theming via CSS vars (Task 3, throughout), icon set instead of Tabler CDN (Task 1), the `mVal` bug fix (implicit — Task 3's modal is state-driven, not `document.getElementById`-driven, so the bug class doesn't exist), debounced localStorage persistence (Task 3, Step 4's `useEffect` + Task 3 test), desktop-only wiring (Task 5), testing (Tasks 1-5 each include tests, run from `packages/ui`/`apps/desktop` per Global Constraints). All spec sections are covered.
- **Placeholder scan:** No TBD/TODO markers; every step has complete, runnable code.
- **Type/name consistency:** Helper names (`typeOf`, `setValueAtPath`, `deleteAtPath`, `replaceAtPath`, `addFieldAtPath`, `coerceVal`, `allContainerPaths`, `highlightSegments`) are identical between Task 2's implementation and Task 3's imports. `JsonEditorView` and `DocumentsView` names are identical between their creating task, their barrel export, and their consuming task.
