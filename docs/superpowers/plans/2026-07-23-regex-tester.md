# Regex Tester (Documents page, third tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Regex Tester" as a third tab in the existing `DocumentsView` shell (`packages/ui/src/views/view-documents.jsx`), as a full React port of `docs/regex-tester.html`, themed to the app.

**Architecture:** A pure, DOM-free helper module (`packages/ui/src/views/regex-tester-helpers.js`) mirrors the `json-editor-helpers.js` precedent from the prior sub-project — matching logic, group-highlight span computation, the 7 code-gen language templates, the unit-test runner, and the static reference data all live there, independently unit-testable. `RegexTesterView` (`packages/ui/src/views/view-regex-tester.jsx`) is the React component built on those helpers, styled with the app's CSS variable theme and persisted via the shared `usePersisted` hook (same debounce pattern as `JsonEditorView`). `DocumentsView` gains a third tab pointing at it. Because `DocumentsView` is already wired into `apps/desktop`'s "Documents" nav entry, **no changes to any app's `main.jsx`/nav config are needed** — the new tab appears automatically.

**Tech Stack:** React (function components + hooks), Vitest + `@testing-library/react`, the existing `@nexusmd/ui` package's `Icon` component and CSS custom-property theme.

## Global Constraints

- Every new/modified file lives under `packages/ui/` — no changes to `apps/desktop`, `apps/app`, or `apps/web` in this plan (the tab appears automatically via the already-wired `DocumentsView`).
- All vitest suites run from `packages/ui` (`cd packages/ui && npm test`), never from repo root.
- No new external dependencies. No new icons are needed — `plus`, `copy`, `chevron-left`, `chevron-right` already exist in `packages/ui/src/icons.jsx` from the prior sub-project.
- Component styling uses the app's existing CSS custom properties (`--bg`, `--surface`, `--surface-2`, `--border`, `--accent`, `--accent-fg`, `--accent-soft`, `--accent-border`, `--text`, `--text-muted`, `--text-subtle`, `--success`, `--success-soft`, `--warning`, `--warning-soft`, `--danger`, `--danger-soft`, `--radius-sm`, `--radius`, `--mono`) — no hardcoded hex colors for anything that should follow the app theme. The per-capture-group highlight colors are the one deliberate exception (a small fixed 6-color palette, since group N needs a *stable, distinguishable* color independent of theme, not a semantic theme color) — see Task 2.
- The AI "Explain this pattern" feature and the contentEditable pattern input (with live syntax-highlighting-as-you-type and manual caret preservation) from `docs/regex-tester.html` are explicitly NOT ported — replaced with a plain `<input>` for the pattern and no AI tab. Do not add them.
- State (pattern, flags, mode, test cases, active test-case index, substitution replacement, unit tests) persists via `usePersisted`, debounced ~400ms, one JSON blob under storage key `regex_tester_state`.

---

## Task 1: Regex tester helpers (pure logic)

**Files:**
- Create: `packages/ui/src/views/regex-tester-helpers.js`
- Test: `packages/ui/tests/regex-tester-helpers.test.js`

**Interfaces:**
- Produces (consumed by Task 2): `findMatches(pattern, flagsStr, str)`, `groupHighlightSpans(match)`, `buildOverlaySegments(str, matches)`, `splitMatchByGroups(value, groupSpans)`, `runUnitTests(tests, pattern, flagsStr)`, `genCode(lang, pattern, flagsStr)`, `REFERENCE_DATA` — all pure, no DOM/React dependency.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/regex-tester-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  findMatches, groupHighlightSpans, buildOverlaySegments, splitMatchByGroups,
  runUnitTests, genCode, REFERENCE_DATA,
} from '../src/views/regex-tester-helpers.js'

describe('findMatches', () => {
  it('returns all matches when the g flag is set', () => {
    const ms = findMatches('a+', 'g', 'aa b aaa')
    expect(ms.map(m => m.value)).toEqual(['aa', 'aaa'])
  })

  it('returns only the first match without the g flag', () => {
    const ms = findMatches('a+', '', 'aa b aaa')
    expect(ms.map(m => m.value)).toEqual(['aa'])
  })

  it('captures groups and their indices', () => {
    const ms = findMatches('(\\w+)@(\\w+)', '', 'user@host')
    expect(ms[0].groups).toEqual(['user', 'host'])
    expect(ms[0].indices).toBeTruthy()
    expect(ms[0].indices[0]).toEqual([0, 4])
    expect(ms[0].indices[1]).toEqual([5, 9])
  })

  it('captures named groups', () => {
    const ms = findMatches('(?<user>\\w+)@(?<host>\\w+)', '', 'user@host')
    expect(ms[0].named).toEqual({ user: 'user', host: 'host' })
  })

  it('returns null for an invalid pattern', () => {
    expect(findMatches('(unterminated', 'g', 'x')).toBeNull()
  })

  it('returns an empty array when there are no matches', () => {
    expect(findMatches('zzz', 'g', 'abc')).toEqual([])
  })
})

describe('groupHighlightSpans', () => {
  it('converts absolute indices to match-relative spans', () => {
    const match = { index: 5, value: 'user@host', indices: [[5, 9], [10, 14]] }
    expect(groupHighlightSpans(match)).toEqual([
      { start: 0, end: 4, colorIndex: 0 },
      { start: 5, end: 9, colorIndex: 1 },
    ])
  })

  it('returns an empty array when there are no capture group indices', () => {
    expect(groupHighlightSpans({ index: 0, value: 'x', indices: null })).toEqual([])
  })

  it('drops a span that overlaps a preceding one', () => {
    const match = { index: 0, value: 'abcdef', indices: [[0, 4], [2, 6]] }
    expect(groupHighlightSpans(match)).toEqual([{ start: 0, end: 4, colorIndex: 0 }])
  })
})

describe('buildOverlaySegments', () => {
  it('splits text into unmatched and matched segments in order', () => {
    const matches = [{ index: 2, value: 'bb', indices: null }]
    const segs = buildOverlaySegments('aabbcc', matches)
    expect(segs).toEqual([
      { text: 'aa', matchIndex: null },
      { text: 'bb', matchIndex: 0, groupSpans: [] },
      { text: 'cc', matchIndex: null },
    ])
  })

  it('returns the whole string unmatched when there are no matches', () => {
    expect(buildOverlaySegments('hello', [])).toEqual([{ text: 'hello', matchIndex: null }])
  })
})

describe('splitMatchByGroups', () => {
  it('splits a match value into colored and plain pieces', () => {
    const pieces = splitMatchByGroups('user@host', [{ start: 0, end: 4, colorIndex: 0 }])
    expect(pieces).toEqual([
      { text: 'user', colorIndex: 0 },
      { text: '@host', colorIndex: null },
    ])
  })

  it('returns the whole value as one plain piece with no group spans', () => {
    expect(splitMatchByGroups('abc', [])).toEqual([{ text: 'abc', colorIndex: null }])
  })
})

describe('runUnitTests', () => {
  const tests = [{ str: 'user@host.com', expectMatch: true }, { str: 'nope', expectMatch: true }]

  it('marks tests pending when the pattern is empty', () => {
    expect(runUnitTests(tests, '', '')).toEqual([
      { str: 'user@host.com', expectMatch: true, result: 'pending' },
      { str: 'nope', expectMatch: true, result: 'pending' },
    ])
  })

  it('marks tests pending when the pattern is invalid', () => {
    const r = runUnitTests(tests, '(unterminated', '')
    expect(r.every(t => t.result === 'pending')).toBe(true)
  })

  it('passes or fails tests against a valid pattern', () => {
    const r = runUnitTests(tests, '\\w+@\\w+\\.\\w+', '')
    expect(r[0].result).toBe('pass')
    expect(r[1].result).toBe('fail')
  })
})

describe('genCode', () => {
  it('generates JS code containing the pattern and flags', () => {
    const code = genCode('JS', '\\d+', 'gi')
    expect(code).toContain('/\\d+/gi')
    expect(code).toContain('matchAll')
  })

  it('generates Python code with mapped flags', () => {
    const code = genCode('Python', '\\d+', 'im')
    expect(code).toContain('re.IGNORECASE | re.MULTILINE')
  })

  it('generates code for every supported language without throwing', () => {
    for (const lang of ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']) {
      const code = genCode(lang, '\\d+', 'g')
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    }
  })

  it('returns an empty string for an unrecognized language', () => {
    expect(genCode('COBOL', '\\d+', '')).toBe('')
  })
})

describe('REFERENCE_DATA', () => {
  it('is a non-empty list of groups with items', () => {
    expect(REFERENCE_DATA.length).toBeGreaterThan(0)
    for (const g of REFERENCE_DATA) {
      expect(typeof g.t).toBe('string')
      expect(g.i.length).toBeGreaterThan(0)
      for (const item of g.i) {
        expect(typeof item.k).toBe('string')
        expect(typeof item.d).toBe('string')
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `packages/ui`): `npm test -- regex-tester-helpers.test.js`
Expected: FAIL — `Cannot find module '../src/views/regex-tester-helpers.js'`.

- [ ] **Step 3: Implement `findMatches`, `groupHighlightSpans`, `buildOverlaySegments`, `splitMatchByGroups`, `runUnitTests`**

Create `packages/ui/src/views/regex-tester-helpers.js` starting with this content (Step 4 below appends `genCode` and `REFERENCE_DATA` to the same file):

```js
// regex-tester-helpers.js — pure, DOM-free regex-matching and code-gen logic
// for RegexTesterView. Mirrors json-editor-helpers.js's pattern: no React, no
// browser globals, independently unit-testable.

export function findMatches(pattern, flagsStr, str) {
  let re
  try { re = new RegExp(pattern, flagsStr + 'd') }
  catch { try { re = new RegExp(pattern, flagsStr) } catch { return null } }

  const results = []
  try {
    if (flagsStr.includes('g')) {
      for (const m of str.matchAll(re)) results.push(buildMatch(m))
    } else {
      const m = re.exec(str)
      if (m) results.push(buildMatch(m))
    }
  } catch {
    // The 'd' flag (match indices) isn't supported in every environment —
    // fall back to matching without it (no per-group highlight indices).
    try {
      const re2 = new RegExp(pattern, flagsStr)
      if (flagsStr.includes('g')) {
        let m, safety = 0
        while ((m = re2.exec(str)) !== null && safety++ < 5000) {
          results.push(buildMatchFallback(m))
          if (!m[0]) re2.lastIndex++
        }
      } else {
        const m = re2.exec(str)
        if (m) results.push(buildMatchFallback(m))
      }
    } catch { /* pattern itself is invalid — already handled above */ }
  }
  return results
}

function buildMatch(m) {
  return { index: m.index, value: m[0], groups: [...m].slice(1), indices: m.indices ? [...m.indices].slice(1) : null, named: m.groups || {} }
}
function buildMatchFallback(m) {
  return { index: m.index, value: m[0], groups: [...m].slice(1), indices: null, named: m.groups || {} }
}

// Converts a match's absolute capture-group indices into match-relative,
// non-overlapping spans for highlight rendering. Overlapping groups (rare,
// e.g. two groups covering the same text) are dropped rather than nested —
// matches the original tool's flat-highlight behavior.
export function groupHighlightSpans(match) {
  if (!match.indices || !match.indices.length) return []
  const base = match.index
  const spans = []
  match.indices.forEach((r, gi) => {
    if (r && r[0] != null) spans.push({ start: r[0] - base, end: r[1] - base, colorIndex: gi % 6 })
  })
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const nonOverlapping = []
  let p = 0
  for (const sp of spans) {
    if (sp.start >= p) { nonOverlapping.push(sp); p = sp.end }
  }
  return nonOverlapping
}

// Splits `str` into an ordered list of segments for the test-string overlay:
// unmatched text (`matchIndex: null`) and matched text (`matchIndex` is the
// index into `matches`, with `groupSpans` for per-group coloring via
// splitMatchByGroups).
export function buildOverlaySegments(str, matches) {
  const segments = []
  let pos = 0
  matches.forEach((m, i) => {
    if (m.index > pos) segments.push({ text: str.slice(pos, m.index), matchIndex: null })
    segments.push({ text: m.value, matchIndex: i, groupSpans: groupHighlightSpans(m) })
    pos = m.index + m.value.length
  })
  if (pos < str.length) segments.push({ text: str.slice(pos), matchIndex: null })
  return segments.length ? segments : [{ text: str, matchIndex: null }]
}

// Splits one matched segment's text into plain/colored pieces per
// groupHighlightSpans, for rendering distinct capture-group colors within a
// single match highlight.
export function splitMatchByGroups(value, groupSpans) {
  if (!groupSpans.length) return [{ text: value, colorIndex: null }]
  const pieces = []
  let p = 0
  groupSpans.forEach(sp => {
    if (sp.start > p) pieces.push({ text: value.slice(p, sp.start), colorIndex: null })
    pieces.push({ text: value.slice(sp.start, sp.end), colorIndex: sp.colorIndex })
    p = sp.end
  })
  if (p < value.length) pieces.push({ text: value.slice(p), colorIndex: null })
  return pieces
}

// Runs each { str, expectMatch } test against pattern/flagsStr, returning
// the same shape plus a `result: 'pass' | 'fail' | 'pending'` field.
// 'pending' when the pattern is empty or invalid.
export function runUnitTests(tests, pattern, flagsStr) {
  let re = null
  if (pattern) {
    try { re = new RegExp(pattern, flagsStr) } catch { re = null }
  }
  return tests.map(t => {
    if (!re) return { ...t, result: 'pending' }
    try {
      const r = new RegExp(re.source, re.flags.replace('g', ''))
      return { ...t, result: r.test(t.str) === t.expectMatch ? 'pass' : 'fail' }
    } catch {
      return { ...t, result: 'pending' }
    }
  })
}
```

- [ ] **Step 4: Port `genCode` and `REFERENCE_DATA` from the original tool**

Open `docs/regex-tester.html` and locate two blocks:

1. **`REF`** — the array literal starting at line 295 (`const REF=[`) through line 304 (`];`). This is static reference data with no DOM coupling.
2. **`genCode`** — the function starting at line 504 (`function genCode(l,pat,fStr){`) through its closing `}` at line 719 (immediately before `function buildLTabs(){`). This is a pure function (string templates only, no DOM reads/writes) — the port is a direct copy, not a rewrite.

Append both to `packages/ui/src/views/regex-tester-helpers.js`, adapted as follows:

- Copy the `REF` array's contents verbatim, and export it under a new name:
  ```js
  export const REFERENCE_DATA = [
    // ...paste the exact contents of REF from docs/regex-tester.html:295-304 here...
  ]
  ```
- Copy the `genCode` function's entire body verbatim (parameter names `l`, `pat`, `fStr` unchanged — do not rename them, to avoid introducing a transcription error in this escape-sequence-heavy code), and export it:
  ```js
  // genCode — ported verbatim from docs/regex-tester.html's genCode(l,pat,fStr)
  // (originally lines 504-719). l = language name, pat = pattern source,
  // fStr = flags string. Already pure (template strings only) in the
  // original — this port only adds `export`.
  export function genCode(l, pat, fStr) {
    // ...paste the exact body of genCode from docs/regex-tester.html:504-719 here...
  }
  ```

Double-check after pasting: the function must handle exactly these `l` values with a `return` for each — `'JS'`, `'Python'`, `'PHP'`, `'Go'`, `'Java'`, `'C#'`, `'Ruby'` — and `return ''` for anything else (this is the original's existing final `return '';` line). Do not add, remove, or reorder language branches.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- regex-tester-helpers.test.js`
Expected: PASS (all tests). If `genCode`'s Python/Go/Java/C#/Ruby-specific assertions fail, the most likely cause is a transcription error in the pasted block (e.g. a dropped backslash in the Ruby template's `\\1` backreferences) — compare the pasted code character-by-character against `docs/regex-tester.html:504-719` rather than guessing.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/regex-tester-helpers.js packages/ui/tests/regex-tester-helpers.test.js
git commit -m "feat(ui): add pure regex-matching, code-gen, and reference helpers"
```

---

## Task 2: RegexTesterView component

**Files:**
- Create: `packages/ui/src/views/view-regex-tester.jsx`
- Modify: `packages/ui/src/index.js`
- Test: `packages/ui/tests/regex-tester.test.jsx`

**Interfaces:**
- Consumes: `Icon` from `../icons.jsx`; `usePersisted` from `../app-components.jsx`; all exports from Task 1's `regex-tester-helpers.js`.
- Produces (consumed by Task 3): `RegexTesterView` — a zero-prop component.

- [ ] **Step 1: Export `RegexTesterView` from the barrel**

In `packages/ui/src/index.js`, immediately after the line `export { JsonEditorView } from './views/view-json-editor.jsx'`, add:

```js
export { RegexTesterView } from './views/view-regex-tester.jsx'
```

- [ ] **Step 2: Write the failing tests**

Create `packages/ui/tests/regex-tester.test.jsx`:

```jsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, RegexTesterView } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderRegexTester(storage = memStorage()) {
  return render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <RegexTesterView/>
    </NexusDataProvider>
  )
}

afterEach(cleanup)

describe('RegexTesterView — matching', () => {
  it('renders the demo pattern and its matches against the default Email test case', () => {
    const { getByDisplayValue, getAllByText } = renderRegexTester()
    expect(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})')).toBeTruthy()
    expect(getAllByText('3 matches').length).toBeGreaterThan(0)
  })

  it('shows the invalid-pattern state for a broken regex', () => {
    const { getByDisplayValue, getByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '(unterminated' } })
    expect(getByText('invalid pattern')).toBeTruthy()
  })

  it('toggling the g flag off drops to a single match', () => {
    const { getByDisplayValue, getByTitle, getAllByText } = renderRegexTester()
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\w+' } })
    fireEvent.click(getByTitle('Global — find all matches'))
    expect(getAllByText('1 match').length).toBeGreaterThan(0)
  })
})

describe('RegexTesterView — test cases', () => {
  it('switches test-string content when a different preset is selected', () => {
    const { getByText, container } = renderRegexTester()
    fireEvent.click(getByText('URL'))
    const textarea = container.querySelector('textarea')
    expect(textarea.value).toContain('https://www.example.com')
  })
})

describe('RegexTesterView — substitution mode', () => {
  it('shows a live substitution preview', () => {
    const { getByText, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByText('Substitution'))
    fireEvent.change(getByPlaceholderText('$1, $2, $& …'), { target: { value: '[EMAIL]' } })
    expect(getByText(/\[EMAIL\]/)).toBeTruthy()
  })
})

describe('RegexTesterView — bottom tabs', () => {
  it('Code gen tab shows a JS snippet containing the current pattern', () => {
    const { getByText } = renderRegexTester()
    expect(getByText(/matchAll/)).toBeTruthy()
  })

  it('switches to the Reference tab and inserts a token into the pattern on click', () => {
    const { getByText, getByDisplayValue } = renderRegexTester()
    fireEvent.click(getByText('Reference'))
    fireEvent.click(getByText('\\d'))
    expect(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})\\d')).toBeTruthy()
  })

  it('adds a unit test and shows it in the list', () => {
    const { getByText, getByPlaceholderText } = renderRegexTester()
    fireEvent.click(getByText('Unit tests'))
    fireEvent.change(getByPlaceholderText('Test string…'), { target: { value: 'x@y.com' } })
    fireEvent.click(getByText('Add'))
    expect(getByText('x@y.com')).toBeTruthy()
  })
})

describe('RegexTesterView — persistence', () => {
  it('persists the pattern (debounced) and restores it on remount', () => {
    vi.useFakeTimers()
    const storage = memStorage()
    const { getByDisplayValue, unmount } = renderRegexTester(storage)
    fireEvent.change(getByDisplayValue('(\\w+)@([\\w.-]+\\.[a-z]{2,})'), { target: { value: '\\d+' } })
    act(() => { vi.advanceTimersByTime(500) })
    unmount()
    vi.useRealTimers()

    const { getByDisplayValue: getByDisplayValue2 } = renderRegexTester(storage)
    expect(getByDisplayValue2('\\d+')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- regex-tester.test.jsx`
Expected: FAIL — `Cannot find module './views/view-regex-tester.jsx'` (from the barrel export added in Step 1).

- [ ] **Step 4: Implement `RegexTesterView`**

Create `packages/ui/src/views/view-regex-tester.jsx`:

```jsx
// view-regex-tester.jsx — full React port of docs/regex-tester.html, minus
// the AI "Explain this pattern" tab (no working backend for it) and the
// contentEditable pattern input (replaced with a plain <input> — see the
// design spec for why). Styled with the app's theme tokens.
import React from 'react'
import { Icon } from '../icons.jsx'
import { usePersisted } from '../app-components.jsx'
import {
  findMatches, buildOverlaySegments, splitMatchByGroups, runUnitTests, genCode, REFERENCE_DATA,
} from './regex-tester-helpers.js'

const { useState, useEffect, useMemo } = React

const FLAG_INFO = [
  ['g', 'Global — find all matches'],
  ['i', 'Case insensitive'],
  ['m', 'Multiline — ^ and $ match line ends'],
  ['s', 'Dotall — . matches newlines'],
  ['u', 'Unicode'],
]
const LANGS = ['JS', 'Python', 'PHP', 'Go', 'Java', 'C#', 'Ruby']
// Per-capture-group highlight colors: a small fixed, theme-independent
// palette (group N needs a stable, distinguishable color, not a semantic
// theme color).
const GROUP_COLORS = ['#818cf8', '#60a5fa', '#34d399', '#fb923c', '#c084fc', '#f472b6']
const STORAGE_KEY = 'regex_tester_state'

const DEFAULT_STATE = {
  pattern: '(\\w+)@([\\w.-]+\\.[a-z]{2,})',
  flags: { g: true, i: false, m: false, s: false, u: false },
  mode: 'match',
  testCases: [
    { name: 'Email', content: 'support@example.com\nsales@company.org\njohn.doe@email.co.uk\n\nInvalid: notanemail, @nodomain.com' },
    { name: 'URL', content: 'https://www.example.com/path?q=1&page=2\nhttp://sub.example.co.uk#anchor\nftp://files.server.net/data.zip' },
    { name: 'Phone', content: '+1 (555) 123-4567\n+44 20 7946 0958\n555.867.5309\n1-800-GOT-JUNK' },
    { name: 'Dates', content: '2024-01-15\n15/01/2024\nJanuary 15, 2024\nJan 15 2024' },
  ],
  tcIndex: 0,
  subReplacement: '',
  unitTests: [
    { str: 'test@example.com', expectMatch: true },
    { str: 'not-an-email', expectMatch: false },
  ],
}

function flagsToString(flags) {
  return Object.keys(flags).filter(f => flags[f]).join('')
}

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

  const flagsStr = flagsToString(state.flags)
  const testCase = state.testCases[state.tcIndex] || state.testCases[0]
  const testStr = testCase.content

  const matches = useMemo(() => {
    if (!state.pattern) return []
    return findMatches(state.pattern, flagsStr, testStr) || []
  }, [state.pattern, flagsStr, testStr])

  useEffect(() => { if (selIdx >= matches.length) setSelIdx(-1) }, [matches.length, selIdx])

  const patternError = useMemo(() => {
    if (!state.pattern) return null
    try { new RegExp(state.pattern, flagsStr); return null }
    catch (e) { return e.message }
  }, [state.pattern, flagsStr])

  const unitTestResults = useMemo(
    () => runUnitTests(state.unitTests, state.pattern, flagsStr),
    [state.unitTests, state.pattern, flagsStr]
  )

  const currentRe = useMemo(() => {
    if (!state.pattern || patternError) return null
    try { return new RegExp(state.pattern, flagsStr) } catch { return null }
  }, [state.pattern, flagsStr, patternError])

  const subResult = useMemo(() => {
    if (!currentRe || !testStr) return null
    try { return testStr.replace(currentRe, state.subReplacement) }
    catch { return 'INVALID' }
  }, [currentRe, testStr, state.subReplacement])

  const overlaySegments = useMemo(() => buildOverlaySegments(testStr, matches), [testStr, matches])

  function setTestContent(content) {
    const next = state.testCases.map((tc, i) => i === state.tcIndex ? { ...tc, content } : tc)
    patch({ testCases: next })
  }
  function switchTestCase(i) { patch({ tcIndex: i }); setSelIdx(-1) }
  function addTestCase() {
    const name = window.prompt('Test case name:', `Case ${state.testCases.length + 1}`)
    if (!name) return
    const next = [...state.testCases, { name: name.trim() || `Case ${state.testCases.length + 1}`, content: '' }]
    patch({ testCases: next, tcIndex: next.length - 1 })
    setSelIdx(-1)
  }
  function toggleFlag(f) { patch({ flags: { ...state.flags, [f]: !state.flags[f] } }) }
  function navMatch(dir) {
    if (!matches.length) return
    setSelIdx(prev => ((prev < 0 ? 0 : prev) + dir + matches.length) % matches.length)
  }
  function selectMatch(i) { setSelIdx(prev => prev === i ? -1 : i) }
  function insertToken(tok) { patch({ pattern: state.pattern + tok }) }
  function addUnitTest(str, expectMatch) {
    if (!str.trim()) return
    patch({ unitTests: [...state.unitTests, { str: str.trim(), expectMatch }] })
  }
  function deleteUnitTest(i) {
    patch({ unitTests: state.unitTests.filter((_, idx) => idx !== i) })
  }

  const chip = !state.pattern
    ? { text: 'enter a pattern', tone: 'muted' }
    : patternError
      ? { text: 'invalid pattern', tone: 'danger' }
      : { text: `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`, tone: matches.length ? 'success' : 'warning' }

  const chipColors = {
    muted:   { color: 'var(--text-subtle)', background: 'var(--surface-2)' },
    danger:  { color: 'var(--danger)', background: 'var(--danger-soft)' },
    success: { color: 'var(--success)', background: 'var(--success-soft)' },
    warning: { color: 'var(--warning)', background: 'var(--warning-soft)' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, padding: 16, boxSizing: 'border-box' }}>
      <style>{`
        .rt-btn { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; font-size:11.5px; }
        .rt-btn:hover:not(:disabled) { background:var(--surface-2); color:var(--text); }
        .rt-btn:disabled { opacity:.35; cursor:default; }
        .rt-btn.on { background:var(--accent-soft); border-color:var(--accent-border); color:var(--accent); }
        .rt-tab { font-size:10.5px; font-weight:600; padding:7px 13px; background:none; border:none; border-bottom:2px solid transparent; color:var(--text-muted); text-transform:uppercase; letter-spacing:.6px; cursor:pointer; }
        .rt-tab:hover { color:var(--text); }
        .rt-tab.on { color:var(--accent); border-bottom-color:var(--accent); }
        mark.rt-m { background: var(--warning-soft); border-bottom:2px solid var(--warning); border-radius:2px; color:inherit; padding:0; }
        mark.rt-m.sel { filter: brightness(1.3); }
      `}</style>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>/<em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>{state.pattern || '…'}</em>/</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', ...chipColors[chip.tone] }}>{chip.text}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className="rt-btn" disabled={matches.length < 2} onClick={() => navMatch(-1)} title="Previous">‹</button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, minWidth: 34, textAlign: 'center', color: 'var(--text-subtle)' }}>
            {matches.length ? (selIdx < 0 ? `${matches.length}` : `${selIdx + 1}/${matches.length}`) : '—'}
          </span>
          <button className="rt-btn" disabled={matches.length < 2} onClick={() => navMatch(1)} title="Next">›</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
          <button className={`rt-btn${state.mode === 'match' ? ' on' : ''}`} onClick={() => patch({ mode: 'match' })}>Match</button>
          <button className={`rt-btn${state.mode === 'sub' ? ' on' : ''}`} onClick={() => patch({ mode: 'sub' })}>Substitution</button>
        </div>
      </div>

      {/* Expression panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>
          <span>Expression</span>
          <div style={{ display: 'flex', gap: 3 }}>
            {FLAG_INFO.map(([f, tip]) => (
              <button key={f} className={`rt-btn${state.flags[f] ? ' on' : ''}`} title={tip} onClick={() => toggleFlag(f)} style={{ padding: '2px 7px', fontFamily: 'var(--mono)' }}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 13px', gap: 7 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--text-subtle)' }}>/</span>
          <input
            value={state.pattern} onChange={e => patch({ pattern: e.target.value })}
            placeholder="Enter pattern…" spellCheck={false}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--text)' }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, color: 'var(--text-subtle)' }}>/</span>
        </div>
        {patternError && (
          <div style={{ padding: '6px 13px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)', background: 'var(--danger-soft)', borderTop: '1px solid var(--border)' }}>{patternError}</div>
        )}
      </div>

      {/* Test string panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
          {state.testCases.map((tc, i) => (
            <button key={i} className={`rt-btn${i === state.tcIndex ? ' on' : ''}`} onClick={() => switchTestCase(i)}>{tc.name}</button>
          ))}
          <button className="rt-btn" onClick={addTestCase} title="New test case" style={{ marginLeft: 4 }}><Icon name="plus" size={12}/></button>
        </div>
        <div style={{ position: 'relative', height: 190 }}>
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.75,
            padding: '10px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden',
          }}>
            {overlaySegments.map((seg, i) => seg.matchIndex === null
              ? <React.Fragment key={i}>{seg.text}</React.Fragment>
              : (
                <mark key={i} className={`rt-m${seg.matchIndex === selIdx ? ' sel' : ''}`}>
                  {splitMatchByGroups(seg.text, seg.groupSpans).map((piece, pi) => piece.colorIndex === null
                    ? <React.Fragment key={pi}>{piece.text}</React.Fragment>
                    : <span key={pi} style={{ borderBottom: `2px solid ${GROUP_COLORS[piece.colorIndex]}`, background: `${GROUP_COLORS[piece.colorIndex]}18` }}>{piece.text}</span>
                  )}
                </mark>
              )
            )}
          </div>
          <textarea
            value={testStr} onChange={e => setTestContent(e.target.value)}
            placeholder="Enter test string…" spellCheck={false}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.75, padding: '10px 13px', color: 'transparent', caretColor: 'var(--text)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 13px', borderTop: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>
          <span>{testStr.length} chars</span>
          <span>{matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : (state.pattern ? 'no matches' : '–')}</span>
        </div>
      </div>

      {/* Substitution panel */}
      {state.mode === 'sub' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>Substitution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)', fontWeight: 600, whiteSpace: 'nowrap' }}>Replace with</span>
            <input
              value={state.subReplacement} onChange={e => patch({ subReplacement: e.target.value })}
              placeholder="$1, $2, $& …" spellCheck={false}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--success)' }}
            />
          </div>
          <div style={{ padding: '8px 13px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.7, minHeight: 42 }}>
            {subResult === null
              ? <span style={{ color: 'var(--text-subtle)' }}>Result will appear here</span>
              : subResult === 'INVALID' ? 'Invalid substitution pattern' : (subResult || '(empty string)')}
          </div>
        </div>
      )}

      {/* Bottom grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Match info */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '6px 13px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--text-subtle)' }}>Match information</div>
          <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
            {!matches.length ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12, lineHeight: 1.7 }}>
                {state.pattern ? 'No matches found' : 'Enter a pattern and test string to see matches'}
              </div>
            ) : matches.map((m, i) => {
              const end = m.index + m.value.length
              const namedKeys = Object.keys(m.named || {})
              return (
                <div key={i} onClick={() => selectMatch(i)} style={{
                  border: `1px solid ${i === selIdx ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                  cursor: 'pointer', background: 'var(--bg)', marginBottom: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 9px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--warning-soft)', border: '1px solid var(--warning)', color: 'var(--warning)' }}>Match {i + 1}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)' }}>{m.index}–{end} · len {m.value.length}</span>
                  </div>
                  <div style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all', color: 'var(--text)', borderBottom: m.groups.length ? '1px solid var(--border)' : 'none' }}>
                    {m.value ? m.value : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>empty match</span>}
                  </div>
                  {m.groups.map((g, gi) => (
                    <div key={gi} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '4px 9px', borderBottom: gi === m.groups.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-sm)', flexShrink: 0, marginTop: 1, color: GROUP_COLORS[gi % 6], border: `1px solid ${GROUP_COLORS[gi % 6]}50`, background: `${GROUP_COLORS[gi % 6]}10` }}>
                        {namedKeys[gi] ? `?<${namedKeys[gi]}>` : `Group ${gi + 1}`}
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: g == null ? 'var(--text-subtle)' : 'var(--text)', fontStyle: g == null ? 'italic' : 'normal', wordBreak: 'break-all' }}>
                        {g != null ? g : 'undefined'}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Tabbed panel */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            <button className={`rt-tab${bottomTab === 'code' ? ' on' : ''}`} onClick={() => setBottomTab('code')}>Code gen</button>
            <button className={`rt-tab${bottomTab === 'tests' ? ' on' : ''}`} onClick={() => setBottomTab('tests')}>Unit tests</button>
            <button className={`rt-tab${bottomTab === 'ref' ? ' on' : ''}`} onClick={() => setBottomTab('ref')}>Reference</button>
          </div>

          {bottomTab === 'code' && (
            <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 9 }}>
                {LANGS.map(l => (
                  <button key={l} className={`rt-btn${codeLang === l ? ' on' : ''}`} onClick={() => setCodeLang(l)}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}>
                <button className="rt-btn" onClick={() => navigator.clipboard.writeText(state.pattern ? genCode(codeLang, state.pattern, flagsStr) : '')}>
                  <Icon name="copy" size={12}/> Copy
                </button>
              </div>
              <pre style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 11, fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre', overflowX: 'auto', margin: 0 }}>
                {state.pattern ? genCode(codeLang, state.pattern, flagsStr) : '// Enter a pattern to generate code'}
              </pre>
            </div>
          )}

          {bottomTab === 'tests' && (
            <UnitTestsPanel tests={unitTestResults} onAdd={addUnitTest} onDelete={deleteUnitTest} />
          )}

          {bottomTab === 'ref' && (
            <ReferencePanel filter={refFilter} onFilterChange={setRefFilter} onInsert={insertToken} />
          )}
        </div>
      </div>
    </div>
  )
}

function UnitTestsPanel({ tests, onAdd, onDelete }) {
  const [str, setStr] = useState('')
  const [expect, setExpect] = useState('1')

  function submit() {
    onAdd(str, expect === '1')
    setStr('')
  }

  const passing = tests.filter(t => t.result === 'pass').length
  const failing = tests.filter(t => t.result === 'fail').length

  return (
    <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 9, alignItems: 'center' }}>
        <input
          value={str} onChange={e => setStr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Test string…"
          style={{ flex: 1, fontFamily: 'var(--mono)', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
        />
        <select value={expect} onChange={e => setExpect(e.target.value)} style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)' }}>
          <option value="1">should match</option>
          <option value="0">no match</option>
        </select>
        <button className="rt-btn" onClick={submit}>Add</button>
      </div>
      {tests.length === 0 ? (
        <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>No tests yet. Add strings above.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 7, marginBottom: 9, fontSize: 11, color: 'var(--text-muted)' }}>
            <b style={{ color: 'var(--text)' }}>{passing}/{tests.length}</b> passing · <b style={{ color: 'var(--text)' }}>{failing}</b> failing
          </div>
          {tests.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 5, fontFamily: 'var(--mono)', fontSize: 11.5, background: 'var(--bg)' }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0, fontWeight: 700,
                color: t.result === 'pass' ? 'var(--success)' : t.result === 'fail' ? 'var(--danger)' : 'var(--text-subtle)',
                background: t.result === 'pass' ? 'var(--success-soft)' : t.result === 'fail' ? 'var(--danger-soft)' : 'var(--surface-2)',
                border: `1px solid ${t.result === 'pass' ? 'var(--success)' : t.result === 'fail' ? 'var(--danger)' : 'var(--border)'}`,
              }}>{t.result === 'pass' ? '✓' : t.result === 'fail' ? '✗' : '?'}</span>
              <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.str}</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 'var(--radius-sm)', color: 'var(--text-subtle)', border: '1px solid var(--border)', background: 'var(--surface-2)', whiteSpace: 'nowrap' }}>{t.expectMatch ? 'should match' : 'no match'}</span>
              <button onClick={() => onDelete(i)} style={{ fontSize: 15, background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ReferencePanel({ filter, onFilterChange, onInsert }) {
  const q = filter.trim().toLowerCase()
  const groups = q
    ? REFERENCE_DATA.map(g => ({ ...g, i: g.i.filter(it => it.k.toLowerCase().includes(q) || it.d.toLowerCase().includes(q)) })).filter(g => g.i.length)
    : REFERENCE_DATA

  return (
    <div style={{ padding: 11, maxHeight: 340, overflowY: 'auto' }}>
      <input
        value={filter} onChange={e => onFilterChange(e.target.value)}
        placeholder="Filter…"
        style={{ width: '100%', marginBottom: 9, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
      />
      {groups.map(g => (
        <div key={g.t} style={{ marginBottom: 13 }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.8px', color: 'var(--text-subtle)', marginBottom: 4, padding: '0 2px' }}>{g.t}</div>
          {g.i.map(it => (
            <div key={it.k} onClick={() => onInsert(it.k)} style={{ display: 'flex', gap: 7, padding: '3px 5px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', alignItems: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', minWidth: 72, flexShrink: 0 }}>{it.k}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{it.d}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- regex-tester.test.jsx`
Expected: PASS (all tests). If the "3 matches" / "1 match" assertions fail, recompute the expected count by hand against the Email test case's exact content and the pattern under test rather than adjusting the assertion to whatever the code happens to produce — a wrong expected count would mask a real matching bug.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/index.js packages/ui/src/views/view-regex-tester.jsx packages/ui/tests/regex-tester.test.jsx
git commit -m "feat(ui): port regex-tester.html to a themed RegexTesterView component"
```

---

## Task 3: Wire RegexTesterView into DocumentsView

**Files:**
- Modify: `packages/ui/src/views/view-documents.jsx`
- Modify: `packages/ui/tests/documents-view.test.jsx`

**Interfaces:**
- Consumes: `RegexTesterView` from `./view-regex-tester.jsx` (Task 2).

- [ ] **Step 1: Write the failing test**

In `packages/ui/tests/documents-view.test.jsx`, add this test inside the existing `describe('DocumentsView', ...)` block (after the two existing `it(...)` blocks):

```jsx
  it('shows a third Regex Tester tab and switches to it', () => {
    const { getByText } = renderDocuments()
    fireEvent.click(getByText('Regex Tester'))
    expect(getByText('Expression')).toBeTruthy()
  })
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run (from `packages/ui`): `npm test -- documents-view.test.jsx`
Expected: FAIL — no element with text "Regex Tester" exists yet (`DocumentsView` only has Markdown and JSON Editor tabs).

- [ ] **Step 3: Add the third tab**

In `packages/ui/src/views/view-documents.jsx`, make these two changes:

Change the import block from:
```jsx
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { JsonEditorView } from './view-json-editor.jsx'
```
to:
```jsx
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { JsonEditorView } from './view-json-editor.jsx'
import { RegexTesterView } from './view-regex-tester.jsx'
```

Change the `TABS` array from:
```jsx
const TABS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON Editor' },
]
```
to:
```jsx
const TABS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON Editor' },
  { id: 'regex', label: 'Regex Tester' },
]
```

Change the render ternary from:
```jsx
        {tab === 'markdown' ? <MarkdownViewer/> : <JsonEditorView/>}
```
to:
```jsx
        {tab === 'markdown' ? <MarkdownViewer/> : tab === 'json' ? <JsonEditorView/> : <RegexTesterView/>}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- documents-view.test.jsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 5: Run the full packages/ui suite to catch regressions**

Run: `npm test`
Expected: PASS (all suites, including Tasks 1-2's new tests and every pre-existing test).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-documents.jsx packages/ui/tests/documents-view.test.jsx
git commit -m "feat(ui): add Regex Tester as a third Documents tab"
```

---

## Self-review notes

- **Spec coverage:** Match/substitution modes, flags, pattern input (plain, not contentEditable), test-string highlighting with per-group colors, match navigation, match info panel, test-case presets, code generation (7 languages), unit tests, reference panel, and persistence are all covered (Task 2). The AI explain tab and contentEditable pattern input are explicitly excluded (Global Constraints, Task 2's file header comment). Desktop wiring needs no changes because `DocumentsView` is already wired (Architecture section, Task 3's scope). Pure logic is separated and independently tested (Task 1). All spec sections are covered.
- **Placeholder scan:** No TBD/TODO markers. `genCode`/`REFERENCE_DATA` are the one place this plan asks the implementer to copy from a named source file+line-range rather than embedding the text directly — done deliberately (see Task 1 Step 4's rationale: re-transcribing ~200 lines of escape-sequence-heavy template literals through the plan document risks introducing subtle bugs that direct copy-paste from the source avoids), not a placeholder — the instructions specify exact source, exact target shape, and exact verification (Step 5's test suite).
- **Type/name consistency:** Helper names (`findMatches`, `groupHighlightSpans`, `buildOverlaySegments`, `splitMatchByGroups`, `runUnitTests`, `genCode`, `REFERENCE_DATA`) are identical between Task 1's implementation and Task 2's imports. `RegexTesterView` is identical between its creating task, its barrel export, and Task 3's import.
