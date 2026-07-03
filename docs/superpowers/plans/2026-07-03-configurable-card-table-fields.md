# Configurable Card & Table Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose which fields/columns show (and in what order) on work item cards, the work item table, PR cards, and the builds/tests tables, via a shared settings section.

**Architecture:** Mirror the existing board-columns pattern. Canonical field catalogs + pure resolver/mutator helpers live in `@nexusmd/core`. One reusable `FieldVisibilityCard` (generalized from `BoardColumnsCard`) edits a per-surface config persisted with `usePersisted` and synced via `pushPref`. Each view reads its config, resolves the ordered/visible field list, and renders from a local `key → fragment` map.

**Tech Stack:** React (peer), `@nexusmd/core` (pure JS helpers), `@nexusmd/ui` (shared views/components), Vitest + @testing-library/react. ESM throughout.

## Global Constraints

- `@nexusmd/core` helpers are **pure** — no React, no DOM, no storage. (`packages/core/src` rule.)
- `@nexusmd/ui` contains **no platform glue**; views read prefs only through `useNexusData()` / `usePersisted`. (`packages/ui/src/index.js` header.)
- Config is **global per surface** (not per-project) this cut.
- Persisted keys: `nexusmd.fields.wiCard`, `nexusmd.fields.wiTable`, `nexusmd.fields.prCard`, `nexusmd.fields.buildsTable`, `nexusmd.fields.testsTable`. Initial value `[]`.
- Config value shape: ordered array `[{ key: string, visible: boolean }]`.
- **Locked** fields are always visible and cannot be hidden (`toggleField` is a no-op on them); they may still be reordered.
- Run tests per-package with `npx vitest run <path>` from inside `packages/core` or `packages/ui` (there is no root test script; exit code 38 means "wrong cwd").

---

### Task 1: Core field-visibility module

**Files:**
- Create: `packages/core/src/modules/ado/field-visibility.js`
- Modify: `packages/core/src/modules/ado/index.js` (add exports)
- Test: `packages/core/tests/ado/field-visibility.test.js`

**Interfaces:**
- Produces:
  - Catalog constants (arrays of `{ key, label, width?, locked? }`): `WI_CARD_FIELDS`, `WI_TABLE_COLUMNS`, `PR_CARD_FIELDS`, `BUILDS_TABLE_COLUMNS`, `TESTS_TABLE_COLUMNS`.
  - `defaultConfig(catalog) → [{ key, visible:true }]` in catalog order.
  - `resolveFields(catalog, config) → [{ key, label, width, locked, visible }]` ordered.
  - `reorderField(config, catalog, fromKey, toKey) → config` (moves `fromKey` to `toKey`'s slot).
  - `toggleField(config, catalog, key) → config` (flips `visible`; no-op if `key` is locked).

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/ado/field-visibility.test.js
import { describe, it, expect } from 'vitest'
import {
  WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS,
  BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS,
  defaultConfig, resolveFields, reorderField, toggleField,
} from '../../src/modules/ado/field-visibility.js'

const CATALOG = [
  { key: 'title', label: 'Title', locked: true },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags', label: 'Tags' },
]

describe('catalogs', () => {
  it('every catalog entry has a key and label', () => {
    for (const cat of [WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS, BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS]) {
      expect(cat.length).toBeGreaterThan(0)
      for (const f of cat) { expect(typeof f.key).toBe('string'); expect(typeof f.label).toBe('string') }
    }
  })
})

describe('defaultConfig', () => {
  it('lists every catalog key visible, in order', () => {
    expect(defaultConfig(CATALOG)).toEqual([
      { key: 'title', visible: true },
      { key: 'assignee', visible: true },
      { key: 'tags', visible: true },
    ])
  })
})

describe('resolveFields', () => {
  it('returns catalog defaults (all visible) for empty config', () => {
    const r = resolveFields(CATALOG, [])
    expect(r.map(f => f.key)).toEqual(['title', 'assignee', 'tags'])
    expect(r.every(f => f.visible)).toBe(true)
    expect(r[0].locked).toBe(true)
  })
  it('applies saved order and visibility', () => {
    const cfg = [{ key: 'tags', visible: false }, { key: 'assignee', visible: true }, { key: 'title', visible: true }]
    const r = resolveFields(CATALOG, cfg)
    expect(r.map(f => f.key)).toEqual(['tags', 'assignee', 'title'])
    expect(r.find(f => f.key === 'tags').visible).toBe(false)
  })
  it('forces locked fields visible even if stored hidden', () => {
    const r = resolveFields(CATALOG, [{ key: 'title', visible: false }])
    expect(r.find(f => f.key === 'title').visible).toBe(true)
  })
  it('drops config keys not in the catalog', () => {
    const r = resolveFields(CATALOG, [{ key: 'ghost', visible: true }, { key: 'title', visible: true }])
    expect(r.map(f => f.key)).not.toContain('ghost')
  })
  it('appends catalog fields missing from config, visible, in catalog order', () => {
    const r = resolveFields(CATALOG, [{ key: 'tags', visible: false }])
    expect(r.map(f => f.key)).toEqual(['tags', 'title', 'assignee'])
    expect(r.find(f => f.key === 'assignee').visible).toBe(true)
  })
})

describe('reorderField', () => {
  it('moves a field to the target slot', () => {
    const cfg = defaultConfig(CATALOG)
    const next = reorderField(cfg, CATALOG, 'tags', 'title')
    expect(next.map(f => f.key)).toEqual(['tags', 'title', 'assignee'])
  })
})

describe('toggleField', () => {
  it('flips visibility of a normal field', () => {
    const next = toggleField(defaultConfig(CATALOG), CATALOG, 'assignee')
    expect(next.find(f => f.key === 'assignee').visible).toBe(false)
  })
  it('is a no-op on a locked field', () => {
    const next = toggleField(defaultConfig(CATALOG), CATALOG, 'title')
    expect(next.find(f => f.key === 'title').visible).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/ado/field-visibility.test.js`
Expected: FAIL — cannot resolve `../../src/modules/ado/field-visibility.js`.

- [ ] **Step 3: Write the module**

```js
// packages/core/src/modules/ado/field-visibility.js
// Field/column visibility catalogs + pure resolver. One config per surface:
// an ordered array of { key, visible }. Catalogs are the source of truth for
// which fields exist, their labels, default order, table widths, and lock state.

export const WI_CARD_FIELDS = [
  { key: 'type',     label: 'Type icon',   locked: true },
  { key: 'id',       label: 'ID',          locked: true },
  { key: 'title',    label: 'Title',       locked: true },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags',     label: 'Tags' },
  { key: 'points',   label: 'Story points' },
  { key: 'comments', label: 'Comment count' },
  { key: 'prs',      label: 'PR count' },
  { key: 'updated',  label: 'Updated' },
]

export const WI_TABLE_COLUMNS = [
  { key: 'id',       label: 'ID',       width: '70px' },
  { key: 'type',     label: 'Type',     width: '52px' },
  { key: 'title',    label: 'Title',    width: '1fr', locked: true },
  { key: 'project',  label: 'Project',  width: '120px' },
  { key: 'state',    label: 'State',    width: '120px' },
  { key: 'assignee', label: 'Assignee', width: '150px' },
  { key: 'priority', label: 'Priority', width: '52px' },
  { key: 'tags',     label: 'Tags',     width: '160px' },
  { key: 'updated',  label: 'Updated',  width: '96px' },
]

export const PR_CARD_FIELDS = [
  { key: 'status',           label: 'Status icon',      locked: true },
  { key: 'title',            label: 'Title',            locked: true },
  { key: 'id',               label: 'ID',               locked: true },
  { key: 'author',           label: 'Author' },
  { key: 'branch',           label: 'Branch' },
  { key: 'age',              label: 'Age' },
  { key: 'linkedWorkItems',  label: 'Linked work items' },
  { key: 'changes',          label: 'Additions / deletions' },
  { key: 'comments',         label: 'Comments' },
  { key: 'ci',               label: 'CI status' },
  { key: 'reviewers',        label: 'Reviewers' },
]

export const BUILDS_TABLE_COLUMNS = [
  { key: 'status',      label: 'Status',       width: '28px',  locked: true },
  { key: 'build',       label: 'Build #',      width: '68px',  locked: true },
  { key: 'triggeredBy', label: 'Triggered by', width: '1fr' },
  { key: 'branch',      label: 'Branch',       width: '160px' },
  { key: 'commit',      label: 'Commit',       width: '72px' },
  { key: 'reason',      label: 'Reason',       width: '80px' },
  { key: 'duration',    label: 'Duration',     width: '72px' },
  { key: 'date',        label: 'Date',         width: '148px' },
  { key: 'actions',     label: 'Actions',      width: '140px', locked: true },
]

export const TESTS_TABLE_COLUMNS = [
  { key: 'result',   label: 'Result',   width: 'auto', locked: true },
  { key: 'run',      label: 'Run',      width: '1fr',  locked: true },
  { key: 'duration', label: 'Duration', width: '80px' },
  { key: 'date',     label: 'Date',     width: '116px' },
  { key: 'actions',  label: 'Actions',  width: 'auto', locked: true },
]

const lockedKeys = (catalog) => new Set(catalog.filter(f => f.locked).map(f => f.key))

export function defaultConfig(catalog) {
  return catalog.map(f => ({ key: f.key, visible: true }))
}

export function resolveFields(catalog, config) {
  const byKey = new Map(catalog.map(f => [f.key, f]))
  const locked = lockedKeys(catalog)
  const cfg = Array.isArray(config) ? config : []
  const seen = new Set()
  const out = []
  for (const entry of cfg) {
    const meta = byKey.get(entry.key)
    if (!meta || seen.has(entry.key)) continue           // drop unknown / duplicate
    seen.add(entry.key)
    out.push({ ...meta, visible: locked.has(entry.key) ? true : !!entry.visible })
  }
  for (const meta of catalog) {                          // append newly-added catalog fields
    if (seen.has(meta.key)) continue
    out.push({ ...meta, visible: true })
  }
  return out
}

export function reorderField(config, catalog, fromKey, toKey) {
  const base = config.length ? config.slice() : defaultConfig(catalog)
  const from = base.findIndex(e => e.key === fromKey)
  const to = base.findIndex(e => e.key === toKey)
  if (from === -1 || to === -1 || from === to) return base
  const [moved] = base.splice(from, 1)
  base.splice(to, 0, moved)
  return base
}

export function toggleField(config, catalog, key) {
  if (lockedKeys(catalog).has(key)) return config.length ? config : defaultConfig(catalog)
  const base = config.length ? config.slice() : defaultConfig(catalog)
  return base.map(e => e.key === key ? { ...e, visible: !e.visible } : e)
}
```

- [ ] **Step 4: Add exports to the ado barrel**

In `packages/core/src/modules/ado/index.js`, add after the existing `board-columns` export block:

```js
export {
  WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS,
  BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS,
  defaultConfig, resolveFields, reorderField, toggleField,
} from './field-visibility.js'
```

(The core barrel already does `export * from './modules/ado/index.js'`, so these become importable from `@nexusmd/core`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run tests/ado/field-visibility.test.js`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/ado/field-visibility.js packages/core/src/modules/ado/index.js packages/core/tests/ado/field-visibility.test.js
git commit -m "feat(core): add field-visibility catalogs and resolver"
```

---

### Task 2: `FieldVisibilityCard` settings component

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx` (add component + export)
- Modify: `packages/ui/src/index.js` (re-export)
- Test: `packages/ui/tests/field-visibility-card.test.jsx`

**Interfaces:**
- Consumes: `resolveFields`, `reorderField`, `toggleField`, `defaultConfig` from `@nexusmd/core`; `VsCard`, `VsFullRow` (already in this file).
- Produces: `FieldVisibilityCard({ title, catalog, config, onChange })` — renders draggable rows with show/hide checkboxes (locked = checked+disabled) and a "Reset to defaults" button. Calls `onChange(nextConfig)`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/field-visibility-card.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { FieldVisibilityCard } from '../src/index.js'

const CATALOG = [
  { key: 'title', label: 'Title', locked: true },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags', label: 'Tags' },
]

afterEach(cleanup)

describe('FieldVisibilityCard', () => {
  it('renders a row per catalog field with the locked row disabled', () => {
    const { getByLabelText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG} config={[]} onChange={() => {}} />
    )
    expect(getByLabelText('Title').disabled).toBe(true)
    expect(getByLabelText('Assignee').disabled).toBe(false)
    expect(getByLabelText('Assignee').checked).toBe(true)
  })

  it('toggling a field calls onChange with that field hidden', () => {
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG} config={[]} onChange={onChange} />
    )
    fireEvent.click(getByLabelText('Tags'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0][0]
    expect(next.find(e => e.key === 'tags').visible).toBe(false)
  })

  it('Reset to defaults calls onChange with the default config', () => {
    const onChange = vi.fn()
    const { getByText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG}
        config={[{ key: 'tags', visible: false }]} onChange={onChange} />
    )
    fireEvent.click(getByText('Reset to defaults'))
    expect(onChange).toHaveBeenCalledWith([
      { key: 'title', visible: true },
      { key: 'assignee', visible: true },
      { key: 'tags', visible: true },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/field-visibility-card.test.jsx`
Expected: FAIL — `FieldVisibilityCard` is not exported.

- [ ] **Step 3: Add the component**

At the top of `packages/ui/src/views/view-settings.jsx`, extend the existing `@nexusmd/core` import to include the new helpers (add them to whatever is already imported from `@nexusmd/core`; if there is no such import yet, add one):

```js
import { resolveFields, reorderField, toggleField, defaultConfig } from '@nexusmd/core'
```

Add the component just above the `// ── Shared exports ──` block (near line 924). It reuses the same drag interaction as `BoardColumnsCard`:

```jsx
function FieldVisibilityCard({ title, catalog, config, onChange }) {
  const [dragIdx, setDragIdx] = useStateVS(null)
  const [overIdx, setOverIdx] = useStateVS(null)
  const rows = resolveFields(catalog, config)

  const onDrop = (dropIdx) => {
    if (dragIdx === null || dragIdx === dropIdx) { setDragIdx(null); setOverIdx(null); return }
    onChange(reorderField(config, catalog, rows[dragIdx].key, rows[dropIdx].key))
    setDragIdx(null); setOverIdx(null)
  }

  return (
    <VsCard title={title} icon="board">
      <VsFullRow title="Fields" desc="Drag to reorder · toggle to show/hide">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
          {rows.map((f, idx) => {
            const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx
            const isDragging = dragIdx === idx
            return (
              <div
                key={f.key}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={e => { e.preventDefault(); setOverIdx(idx) }}
                onDrop={e => { e.preventDefault(); onDrop(idx) }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 8, border: `1px solid ${isOver ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: isOver ? 'var(--accent-soft)' : isDragging ? 'var(--surface-2)' : 'var(--surface)',
                  opacity: isDragging ? 0.5 : 1, cursor: 'grab', userSelect: 'none',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-subtle)', flexShrink: 0 }}>
                  {[0,1].map(i => (
                    <span key={i} style={{ display: 'flex', gap: 2 }}>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                      <span style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: 'currentColor' }}/>
                    </span>
                  ))}
                </span>
                <input
                  type="checkbox"
                  aria-label={f.label}
                  checked={f.visible}
                  disabled={f.locked}
                  onChange={() => onChange(toggleField(config, catalog, f.key))}
                  onClick={e => e.stopPropagation()}
                  style={{ cursor: f.locked ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)', flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 13, color: f.visible ? 'var(--text)' : 'var(--text-subtle)', textDecoration: f.visible ? 'none' : 'line-through' }}>
                  {f.label}
                </span>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => onChange(defaultConfig(catalog))}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', alignSelf: 'flex-start', marginTop: 6 }}
        >
          Reset to defaults
        </button>
      </VsFullRow>
    </VsCard>
  )
}
```

Add `FieldVisibilityCard` to the `export { … }` list at the bottom of the file (the block that currently ends with `BoardColumnsCard,`).

- [ ] **Step 4: Re-export from the package barrel**

In `packages/ui/src/index.js`, add `FieldVisibilityCard` to the same export line that currently lists `BoardColumnsCard` (line ~72).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/field-visibility-card.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js packages/ui/tests/field-visibility-card.test.jsx
git commit -m "feat(ui): add reusable FieldVisibilityCard settings component"
```

---

### Task 3: Shared `CardsAndTablesSettings` section + mount in both apps

**Files:**
- Modify: `packages/ui/src/views/view-settings.jsx` (add wrapper + export)
- Modify: `packages/ui/src/index.js` (re-export)
- Modify: `apps/desktop/src/desktop-settings.jsx` (new tab)
- Modify: `apps/web/src/view-settings.jsx` (new sub-page)
- Test: `packages/ui/tests/cards-and-tables-settings.test.jsx`

**Interfaces:**
- Consumes: `FieldVisibilityCard`; the five catalogs from `@nexusmd/core`; `usePersisted` (`app-components.jsx`).
- Produces: `CardsAndTablesSettings()` — self-contained; owns the five `usePersisted` hooks and renders five `FieldVisibilityCard`s.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/cards-and-tables-settings.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, CardsAndTablesSettings } from '../src/index.js'

function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

afterEach(cleanup)

it('persists a toggle to storage under the surface key', () => {
  const storage = memStorage()
  const { getByLabelText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {} }}>
      <CardsAndTablesSettings />
    </NexusDataProvider>
  )
  // "Tags" appears in the WI-card card; toggling it writes the wiCard key.
  fireEvent.click(getByLabelText('Tags'))
  const saved = JSON.parse(storage.getItem('nexusmd.fields.wiCard'))
  expect(saved.find(e => e.key === 'tags').visible).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/cards-and-tables-settings.test.jsx`
Expected: FAIL — `CardsAndTablesSettings` not exported.

- [ ] **Step 3: Add the wrapper**

In `packages/ui/src/views/view-settings.jsx`, extend the `@nexusmd/core` import with the catalogs, and import `usePersisted`:

```js
import { WI_CARD_FIELDS, WI_TABLE_COLUMNS, PR_CARD_FIELDS, BUILDS_TABLE_COLUMNS, TESTS_TABLE_COLUMNS } from '@nexusmd/core'
import { usePersisted } from '../app-components.jsx'
```

(If `usePersisted` is already imported in this file, don't duplicate it.)

Add below `FieldVisibilityCard`:

```jsx
function CardsAndTablesSettings() {
  const [wiCard,      setWiCard]      = usePersisted('nexusmd.fields.wiCard',      [], { sync: true })
  const [wiTable,     setWiTable]     = usePersisted('nexusmd.fields.wiTable',     [], { sync: true })
  const [prCard,      setPrCard]      = usePersisted('nexusmd.fields.prCard',      [], { sync: true })
  const [buildsTable, setBuildsTable] = usePersisted('nexusmd.fields.buildsTable', [], { sync: true })
  const [testsTable,  setTestsTable]  = usePersisted('nexusmd.fields.testsTable',  [], { sync: true })
  return (
    <>
      <FieldVisibilityCard title="Work item cards" catalog={WI_CARD_FIELDS}       config={wiCard}      onChange={setWiCard} />
      <FieldVisibilityCard title="Work item table" catalog={WI_TABLE_COLUMNS}     config={wiTable}     onChange={setWiTable} />
      <FieldVisibilityCard title="Pull request cards" catalog={PR_CARD_FIELDS}    config={prCard}      onChange={setPrCard} />
      <FieldVisibilityCard title="Builds table" catalog={BUILDS_TABLE_COLUMNS}    config={buildsTable} onChange={setBuildsTable} />
      <FieldVisibilityCard title="Tests table" catalog={TESTS_TABLE_COLUMNS}      config={testsTable}  onChange={setTestsTable} />
    </>
  )
}
```

Add `CardsAndTablesSettings` to the file's export block and to `packages/ui/src/index.js` (same line as `FieldVisibilityCard`).

- [ ] **Step 4: Mount in desktop settings**

In `apps/desktop/src/desktop-settings.jsx`:
1. Add to the `@nexusmd/ui` import: `CardsAndTablesSettings`.
2. Add a tab to `SETTINGS_TABS` (after `planner`):

```js
  { id: 'cards',        label: 'Cards & Tables', icon: 'board'     },
```

3. Add the tab body alongside the other `tab === …` blocks:

```jsx
          {tab === 'cards' && <CardsAndTablesSettings />}
```

- [ ] **Step 5: Mount in web settings**

In `apps/web/src/view-settings.jsx`:
1. Add `CardsAndTablesSettings` to the `@nexusmd/ui` import (line 22 block).
2. Add a nav entry wherever the web page lists its sub-pages, using id `'cards'` and label `'Cards & Tables'` (follow the existing sub-page nav pattern in this file).
3. Render it in the matching branch:

```jsx
          {subPage === 'cards' && <CardsAndTablesSettings />}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/ui && npx vitest run tests/cards-and-tables-settings.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/views/view-settings.jsx packages/ui/src/index.js apps/desktop/src/desktop-settings.jsx apps/web/src/view-settings.jsx packages/ui/tests/cards-and-tables-settings.test.jsx
git commit -m "feat: add Cards & Tables settings section (web + desktop)"
```

---

### Task 4: Work item board card honors config

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx` (`BoardCard`, ~1412-1467)
- Test: `packages/ui/tests/board-card-fields.test.jsx`

**Interfaces:**
- Consumes: `resolveFields`, `WI_CARD_FIELDS` from `@nexusmd/core`; `usePersisted`.

**Rendering model:** locked identity fields (`type`, `id`, `title`) keep their fixed positions in the card head/title. The remaining fields (`priority`, `assignee`, `tags`, `points`, `comments`, `prs`, `updated`) render in the meta area in resolved order, skipping hidden ones, via a `key → fragment` map.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/board-card-fields.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Card field test', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 5, tags: ['alpha'], comments: 0, prs: 0, updated: '3h' }

afterEach(cleanup)

it('hides the points field on the board card when config hides it', () => {
  const storage = memStorage({ 'nexusmd.fields.wiCard': JSON.stringify([{ key: 'points', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  // Switch to board view is the default? Assert via text: points label "5 pts" absent.
  expect(container.textContent).not.toContain('5 pts')
})
```

> Note for implementer: if `WorkItemsView`'s default view is the table, the test must first switch to the board (find the board/table toggle and `fireEvent.click`). Inspect the view's toggle control (search `board`/`table` view state in `view-workitems.jsx`) and drive it before asserting. Keep the assertion on card-only markup (`'5 pts'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/board-card-fields.test.jsx`
Expected: FAIL — `5 pts` still present (field not yet gated).

- [ ] **Step 3: Implement**

At the top of `view-workitems.jsx`, add to the `@nexusmd/core` import: `resolveFields, WI_CARD_FIELDS`; ensure `usePersisted` is imported from `../app-components.jsx`.

In `BoardCard`, read and resolve the config, build a fragment map, and render the meta area from it. Replace the meta block (current lines ~1447-1464) with:

```jsx
      <div className="board-card-title">{w.title}</div>
      {(() => {
        const [cfg] = usePersisted('nexusmd.fields.wiCard', [])
        const fields = resolveFields(WI_CARD_FIELDS, cfg).filter(f => f.visible)
        const frag = {
          priority: () => null, // priority is rendered in the head via <Prio>; see below
          assignee: () => (
            <div key="assignee" onClick={e => e.stopPropagation()}>
              <InlineAssigneeCell assigneeId={w.assignee} team={team} onAssign={onAssign} />
            </div>
          ),
          tags: () => (
            <div key="tags" onClick={e => e.stopPropagation()}>
              <InlineTagsCell tags={w.tags || []} onTagsChange={onTagsChange} />
            </div>
          ),
          points: () => <span key="points" className="muted mono" style={{ fontSize: 10.5 }}>{w.points} pts</span>,
          comments: () => (w.comments > 0 ? <span key="comments" className="muted mono" style={{ fontSize: 10.5 }}><Icon name="comment" size={10}/> {w.comments}</span> : null),
          prs: () => (w.prs > 0 ? <span key="prs" className="muted mono" style={{ fontSize: 10.5 }}><Icon name="pr" size={10}/> {w.prs}</span> : null),
          updated: () => ((w.updated && w.updated !== '—') ? (
            <div key="updated" style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 5 }}
                 title={w.changedMs ? new Date(w.changedMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}>
              Updated {w.updated} ago
            </div>
          ) : null),
        }
        const metaKeys = ['assignee', 'tags', 'points', 'comments', 'prs']
        const meta = fields.filter(f => metaKeys.includes(f.key))
        const updatedVisible = fields.some(f => f.key === 'updated')
        return (
          <>
            <div className="board-card-meta">
              {meta.map((f, i) => {
                const el = frag[f.key]()
                // insert the flex spacer before comments/prs cluster, matching current layout
                return el
              })}
              <span className="spacer"/>
            </div>
            {updatedVisible && frag.updated()}
          </>
        )
      })()}
```

Keep the `type`/`id`/`title`/`priority` head markup (lines ~1426-1446) as-is — those are locked and rendered where they are today (`priority` stays in the head via `<Prio p={w.priority}/>`, so its `frag.priority` returns `null`). Gate `priority`'s head render on `resolveFields(...).some(f => f.key === 'priority' && f.visible)` if you want the priority toggle to hide it — read the config once at the top of `BoardCard` and reuse:

```jsx
function BoardCard({ w, dragId, onDragStart, onDragEnd, onOpen, team = [], onAssign, onTagsChange }) {
  const { data: NexusMDData } = useNexusData();
  const [cfg] = usePersisted('nexusmd.fields.wiCard', []);
  const visible = new Set(resolveFields(WI_CARD_FIELDS, cfg).filter(f => f.visible).map(f => f.key));
  // …head: {visible.has('priority') && <Prio p={w.priority}/>}
  // …meta: iterate resolveFields(...) order for the metaKeys subset.
```

Use the single top-of-component read (`cfg`/`visible`) rather than the inline IIFE if you prefer — pick one and keep it consistent. The IIFE above is shown for clarity; the cleaner form reads config once at the top and renders meta by iterating `resolveFields(WI_CARD_FIELDS, cfg)` filtered to `metaKeys` in order.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/board-card-fields.test.jsx`
Expected: PASS (`5 pts` absent).

- [ ] **Step 5: Run the existing WI view tests to check for regressions**

Run: `cd packages/ui && npx vitest run tests/views.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/tests/board-card-fields.test.jsx
git commit -m "feat(ui): work item board card honors field config"
```

---

### Task 5: Work item table honors config

**Files:**
- Modify: `packages/ui/src/views/view-workitems.jsx` (thead ~1095-1111, tbody cells ~1146-1179, group-row `colSpan`)
- Test: `packages/ui/tests/wi-table-fields.test.jsx`

**Interfaces:** Consumes `resolveFields`, `WI_TABLE_COLUMNS`, `usePersisted`.

**Rendering model:** the leading structural columns (drag handle, selection checkbox) and the trailing row-actions column are **fixed** and always render. The configurable columns (`id`, `type`, `title`, `project`, `state`, `assignee`, `priority`, `tags`, `updated`) render between them in resolved order, skipping hidden. The group-header row's `colSpan` becomes `2 + visibleCount + 1` (2 leading + configurable + 1 actions) rather than the hardcoded `13`.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/wi-table-fields.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, WorkItemsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const ITEM = { id: 7, type: 'Bug', title: 'Row', project: 'proj', state: 'Active', assignee: null, priority: 2, points: 5, tags: [], comments: 0, prs: 0, updated: '3h' }

afterEach(cleanup)

it('omits the Project column header when hidden by config', () => {
  const storage = memStorage({ 'nexusmd.fields.wiTable': JSON.stringify([{ key: 'project', visible: false }]) })
  const { queryAllByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <WorkItemsView items={[ITEM]} setItems={() => {}} onOpen={() => {}} team={[]} />
    </NexusDataProvider>
  )
  // Assuming the table is the default view; otherwise switch first (see note in Task 4).
  expect(queryAllByText('Project').length).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/wi-table-fields.test.jsx`
Expected: FAIL — `Project` header still present.

- [ ] **Step 3: Implement**

Read config once inside the table-rendering component (the one owning the `<table>` at ~1090). Add near its other hooks:

```jsx
  const [tableCfg] = usePersisted('nexusmd.fields.wiTable', []);
  const visibleCols = resolveFields(WI_TABLE_COLUMNS, tableCfg).filter(f => f.visible);
```

Define a header renderer and a cell renderer keyed by column, reusing the exact existing markup:

```jsx
  const headFor = (key) => {
    switch (key) {
      case 'id':       return <SortHeader key="id" col="id" label="ID" sort={sort} setSort={setSort}/>;
      case 'type':     return <th key="type">Type</th>;
      case 'title':    return <SortHeader key="title" col="title" label="Title" sort={sort} setSort={setSort}/>;
      case 'project':  return <th key="project">Project</th>;
      case 'state':    return <th key="state">State</th>;
      case 'assignee': return <th key="assignee">Assignee</th>;
      case 'priority': return <SortHeader key="priority" col="priority" label="P" sort={sort} setSort={setSort}/>;
      case 'tags':     return <th key="tags">Tags</th>;
      case 'updated':  return <SortHeader key="updated" col="updated" label="Updated" sort={sort} setSort={setSort}/>;
      default:         return null;
    }
  };

  const cellFor = (key, w) => {
    switch (key) {
      case 'id': return (
        <td key="id" className="id" onClick={e=>e.stopPropagation()}>
          <a href={`https://dev.azure.com/${encodeURIComponent(NexusMDData.ORG)}/${encodeURIComponent(w.project.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}/_workitems/edit/${w.id}`} target="_blank" rel="noopener" style={{color:'var(--accent)',textDecoration:'none',fontFamily:'var(--mono)',fontSize:12}}>#{w.id}</a>
        </td>);
      case 'type': return <td key="type"><TypeIcon type={w.type}/></td>;
      case 'title': return (
        <td key="title" className="title">
          <span className="truncate" style={{ display: 'inline-block', maxWidth: titleColWidth, verticalAlign: 'middle' }}>{w.title}</span>
          {w.comments > 0 && <span className="muted mono" style={{ fontSize: 10.5, marginLeft: 8 }}><Icon name="comment" size={10}/> {w.comments}</span>}
          {w.prs > 0 && <span className="muted mono" style={{ fontSize: 10.5, marginLeft: 6 }}><Icon name="pr" size={10}/> {w.prs}</span>}
        </td>);
      case 'project': return <td key="project"><ProjectChip id={w.project}/></td>;
      case 'state': return <td key="state"><StateDot state={w.state} withLabel/></td>;
      case 'assignee': return (
        <td key="assignee" onClick={e => e.stopPropagation()}>
          <InlineAssigneeCell assigneeId={w.assignee} team={TEAM} onAssign={async (assigneeId) => { const member = TEAM.find(t => t.id === assigneeId); updateItem(w.id, { assignee: assigneeId || null }); await patchWI(w.id, [['/fields/System.AssignedTo', member?.name || null]]); }} />
        </td>);
      case 'priority': return <td key="priority"><Prio p={w.priority}/></td>;
      case 'tags': return (
        <td key="tags" onClick={e => e.stopPropagation()}>
          <InlineTagsCell tags={w.tags || []} onTagsChange={async newTags => { updateItem(w.id, { tags: newTags }); await patchWI(w.id, [['/fields/System.Tags', newTags.join('; ')]]); }} />
        </td>);
      case 'updated': return <td key="updated" className="muted mono" style={{ fontSize: 11 }}>{w.updated} ago</td>;
      default: return null;
    }
  };
```

Then in the JSX:
- Replace the fixed header cells (current lines 1101-1109) with `{visibleCols.map(f => headFor(f.key))}`, keeping the two leading `<th>` (drag, checkbox) at 1097-1100 and the trailing `<th style={{ width: 32 }}/>` at 1110.
- Replace the fixed body `<td>`s (current lines 1146-1179) with `{visibleCols.map(f => cellFor(f.key, w))}`, keeping the leading drag `<td>` (1138-1142) + checkbox `<td>` (1143-1145) and the trailing `row-actions` `<td>` (1180-1186).
- Change the group-header `colSpan` (line 1118) from `13` to `{2 + visibleCols.length + 1}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/wi-table-fields.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-workitems.jsx packages/ui/tests/wi-table-fields.test.jsx
git commit -m "feat(ui): work item table honors column config"
```

---

### Task 6: PR card honors config

**Files:**
- Modify: `packages/ui/src/views/view-prs.jsx` (`PRRow`, ~258-340)
- Test: `packages/ui/tests/pr-card-fields.test.jsx`

**Interfaces:** Consumes `resolveFields`, `PR_CARD_FIELDS`, `usePersisted`.

**Rendering model:** locked fields `status` (`.pr-status`), `title`, `id` stay in their fixed positions. The `.pr-sub` line renders `author`, `branch`, `age`, `linkedWorkItems` in resolved order (skipping hidden), joined by the existing `·` separators. The `.pr-meta` area renders `changes`, `comments`, `ci`, `reviewers` in resolved order (skipping hidden).

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/pr-card-fields.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const PR = { id: 3, title: 'Fix', author: 'a', authorName: 'Alice', status: 'active', branch: 'fix/x', age: '2d', additions: 5, deletions: 2, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: 'success' }

afterEach(cleanup)

it('hides the branch on a PR card when config hides it', () => {
  const storage = memStorage({ 'nexusmd.fields.prCard': JSON.stringify([{ key: 'branch', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o', TEAM: [] } }}>
      <PRView prs={[PR]} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).not.toContain('fix/x')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/pr-card-fields.test.jsx`
Expected: FAIL — `fix/x` still present.

- [ ] **Step 3: Implement**

Add to the `@nexusmd/core` import in `view-prs.jsx`: `resolveFields, PR_CARD_FIELDS`; import `usePersisted` from `../app-components.jsx`.

In `PRRow`, read config and build sub/meta fragment maps, then render in resolved order:

```jsx
function PRRow({ pr, onOpen }) {
  const { data: NexusMDData } = useNexusData()
  const [cfg] = usePersisted('nexusmd.fields.prCard', [])
  const visible = new Set(resolveFields(PR_CARD_FIELDS, cfg).filter(f => f.visible).map(f => f.key))
  const order = resolveFields(PR_CARD_FIELDS, cfg).filter(f => f.visible).map(f => f.key)
  const reviewers = (pr.reviewerDetails || []).slice(0, 4)
  const wiList = (pr.linkedWorkItems || []).map(wi => wi.id)

  const subFrag = {
    author: () => (<React.Fragment key="author"><Avatar who={pr.author} size="xs"/><span style={{ fontWeight: 500 }}>{pr.authorName || NexusMDData.TEAM.find(t=>t.id===pr.author)?.name?.split(' ')[0] || pr.author}</span></React.Fragment>),
    branch: () => (<React.Fragment key="branch"><Icon name="git-branch" size={10}/><span>{pr.branch}</span></React.Fragment>),
    age: () => (<span key="age">opened {pr.age} ago</span>),
    linkedWorkItems: () => (wiList.length ? <React.Fragment key="wi">{wiList.map(wiId => <span key={wiId} className="pill" style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', cursor: 'pointer' }}>#{wiId}</span>)}</React.Fragment> : null),
  }
  const metaFrag = {
    changes: () => (<span key="changes" className="pr-checks" title={`+${pr.additions} −${pr.deletions}`}><span style={{ color: 'var(--success)' }}>+{pr.additions}</span><span style={{ color: 'var(--danger)' }}>−{pr.deletions}</span></span>),
    comments: () => ((pr.comments > 0 || pr.unresolvedComments > 0) ? (
      <span key="comments" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: pr.unresolvedComments > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
        <Icon name="comment" size={11}/>{pr.comments}
        {pr.unresolvedComments > 0 && <span title={`${pr.unresolvedComments} unresolved`} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }}/>}
      </span>) : null),
    ci: () => {
      const map = { success: 'success', failed: 'danger', running: 'info', partial: 'warning' }
      return map[pr.ciStatus] ? <span key="ci" className={`pill ${map[pr.ciStatus]}`} style={{ fontSize: 10 }}>CI</span> : null
    },
    reviewers: () => (
      <div key="reviewers" className="pr-reviewers" style={{ gap: 4 }}>
        {reviewers.map((r, i) => { const display = reviewerVoteDisplay(r.vote); const name = NexusMDData.TEAM.find(t => t.id === r.id)?.name || r.name || r.id; return (
          <span key={`${r.id}-${i}`} style={{ position: 'relative', display: 'inline-flex' }} title={`${name}: ${display.label}`}>
            <Avatar who={r.id} size="xs"/>
            <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', border: '1.5px solid var(--surface)', background: display.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, color: 'white' }}>{display.glyph}</span>
          </span>) })}
      </div>),
  }

  const subKeys = order.filter(k => subFrag[k])
  const metaKeys = order.filter(k => metaFrag[k])

  return (
    <div className="pr-row" onClick={() => onOpen(pr)}>
      <div className={`pr-status ${pr.status}`}>
        {pr.status === 'merged' ? <Icon name="merge" size={14}/> : <Icon name="pr" size={14}/>}
      </div>
      <div className="pr-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pr.url
            ? <a href={pr.url} target="_blank" rel="noopener" className="pr-title truncate" style={{ textDecoration: 'none', color: 'inherit' }} onClick={e => e.stopPropagation()}>{pr.title}</a>
            : <span className="pr-title truncate">{pr.title}</span>}
          {pr.draft && <span className="pill" style={{ fontSize: 10 }}>DRAFT</span>}
          {pr.hasConflicts && <span className="pill danger" style={{ fontSize: 10 }}><Icon name="alert" size={9}/> Conflicts</span>}
        </div>
        <div className="pr-sub">
          <span>#{pr.id}</span>
          {subKeys.map(k => (<React.Fragment key={`sep-${k}`}><span>·</span>{subFrag[k]()}</React.Fragment>))}
        </div>
      </div>
      <div className="pr-meta">
        {metaKeys.map(k => metaFrag[k]())}
      </div>
    </div>
  )
}
```

(`#id`, `title`, `status` are locked and stay put. `linkedWorkItems` renders as a single group after a `·`, matching current behavior closely enough; the per-item `·` between multiple WIs is dropped in favor of one leading separator — acceptable simplification.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/pr-card-fields.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-prs.jsx packages/ui/tests/pr-card-fields.test.jsx
git commit -m "feat(ui): PR card honors field config"
```

---

### Task 7: Builds table honors config

**Files:**
- Modify: `packages/ui/src/views/view-builds.jsx` (`BUILD_GRID` line 13-14, header ~309-338, rows ~372-436)
- Test: `packages/ui/tests/builds-table-fields.test.jsx`

**Interfaces:** Consumes `resolveFields`, `BUILDS_TABLE_COLUMNS`, `usePersisted`.

**Rendering model:** replace the constant `BUILD_GRID` with a template computed from the visible columns' `width`s. `status`, `build`, and `actions` are locked. Header cells and row cells render in resolved order.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/builds-table-fields.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, BuildsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const BUILD = { id: 'b1', pipeline: 'API', status: 'success', branch: 'main', project: 'Proj', definitionId: 5, commit: 'abc1234', reason: 'manual', duration: '1m', when: 'now', finishTime: '2026-01-02T10:00:00' }

afterEach(cleanup)

it('omits the Commit column when hidden by config', () => {
  const storage = memStorage({ 'nexusmd.fields.buildsTable': JSON.stringify([{ key: 'commit', visible: false }]) })
  const { queryAllByText } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <BuildsView builds={[BUILD]} acknowledgedBuilds={[]} setAcknowledgedBuilds={() => {}} />
    </NexusDataProvider>
  )
  expect(queryAllByText('Commit').length).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/builds-table-fields.test.jsx`
Expected: FAIL — `Commit` header still present.

- [ ] **Step 3: Implement**

Add imports: `resolveFields, BUILDS_TABLE_COLUMNS` from `@nexusmd/core`; `usePersisted` from `../app-components.jsx`.

Inside `BuildsView`, near the other hooks:

```jsx
  const [buildsCfg] = usePersisted('nexusmd.fields.buildsTable', []);
  const visibleBuildCols = resolveFields(BUILDS_TABLE_COLUMNS, buildsCfg).filter(f => f.visible);
  const buildGrid = visibleBuildCols.map(c => c.width).join(' ');
```

Replace the module constant `BUILD_GRID` usages (header container `gridTemplateColumns: BUILD_GRID` at ~310 and row `gridTemplateColumns: BUILD_GRID` at ~374) with `buildGrid`. (Leave the `BUILD_GRID` constant defined for reference or delete it — it is no longer read.)

Header renderer:

```jsx
  const buildHead = (key) => {
    switch (key) {
      case 'status':      return <div key="status"/>;
      case 'build':       return <ColHead key="build">Build</ColHead>;
      case 'triggeredBy': return <ColHead key="triggeredBy">Triggered by</ColHead>;
      case 'branch':      return <ColHead key="branch"><Icon name="git-branch" size={11} style={{ marginRight:3, opacity:0.7 }}/>Branch</ColHead>;
      case 'commit':      return <ColHead key="commit">Commit</ColHead>;
      case 'reason':      return <ColHead key="reason">Reason</ColHead>;
      case 'duration':    return <ColHead key="duration">Duration</ColHead>;
      case 'date':        return <ColHead key="date" sortable sortDir={sortDir} onSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}>Date</ColHead>;
      case 'actions':     return <div key="actions"/>;
      default:            return null;
    }
  };
```

Row cell renderer — move each existing cell body (lines ~379-485) into a `switch`, keyed by column, receiving the build `b`:

```jsx
  const buildCell = (key, b) => {
    switch (key) {
      case 'status':      return <div key="status" style={{ display:'flex', justifyContent:'center' }}><div className={`build-dot ${dotClass[dispStatus(b)]}`}/></div>;
      case 'build':       return (/* the existing Build # cell, lines 384-392 */);
      case 'triggeredBy': return (/* the existing Triggered-by/failureReason cell, lines 395-404 */);
      case 'branch':      return (/* the existing Branch cell, lines 407-415 */);
      case 'commit':      return <div key="commit" className="mono muted" style={{ fontSize:11.5 }}>{b.commit}</div>;
      case 'reason':      return (/* the existing Reason cell, lines 421-428 */);
      case 'duration':    return <div key="duration" className="build-meta">{b.duration}</div>;
      case 'date':        return <div key="date" className="build-meta mono" title={b.finishTime ? new Date(b.finishTime).toLocaleString() : ''}>{formatDateTime(b.finishTime)}</div>;
      case 'actions':     return (/* the existing Actions cell, lines 439-485 */);
      default:            return null;
    }
  };
```

> Implementer: copy the referenced JSX bodies verbatim from the current file into each `case`, adding a `key={key}` to the outer element. Keep `formatDateTime` (already imported).

Then render header cells with `{visibleBuildCols.map(f => buildHead(f.key))}` and row cells with `{visibleBuildCols.map(f => buildCell(f.key, b))}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/builds-table-fields.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-builds.jsx packages/ui/tests/builds-table-fields.test.jsx
git commit -m "feat(ui): builds table honors column config"
```

---

### Task 8: Tests table honors config

**Files:**
- Modify: `packages/ui/src/views/view-tests.jsx` (row grid ~185, cells ~187-233)
- Test: `packages/ui/tests/tests-table-fields.test.jsx`

**Interfaces:** Consumes `resolveFields`, `TESTS_TABLE_COLUMNS`, `usePersisted`.

**Rendering model:** `result`, `run`, and `actions` are locked; `duration` and `date` are toggleable. Compute `gridTemplateColumns` from visible columns' widths and render cells in resolved order.

- [ ] **Step 1: Write the failing test**

```jsx
// packages/ui/tests/tests-table-fields.test.jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, TestsView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const RUN = { id: 't1', pipeline: 'CI', project: 'Proj', result: 'succeeded', totalTests: 3, passedTests: 3, failedTests: 0, startTime: '2026-01-01T09:00:00', branch: 'main', duration: '30s', when: 'now' }

afterEach(cleanup)

it('hides the duration cell when config hides it', () => {
  const storage = memStorage({ 'nexusmd.fields.testsTable': JSON.stringify([{ key: 'duration', visible: false }]) })
  const { container } = render(
    <NexusDataProvider value={{ storage, getProfileKey: k => k, pushPref: () => {}, data: { ORG: 'o' } }}>
      <TestsView tests={[RUN]} acknowledgedTests={[]} setAcknowledgedTests={() => {}} />
    </NexusDataProvider>
  )
  expect(container.textContent).not.toContain('30s')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && npx vitest run tests/tests-table-fields.test.jsx`
Expected: FAIL — `30s` still present.

- [ ] **Step 3: Implement**

Add imports: `resolveFields, TESTS_TABLE_COLUMNS` from `@nexusmd/core`; `usePersisted` from `../app-components.jsx` (already imports `usePersisted`? if so reuse).

Inside `TestsView`, near the other hooks:

```jsx
  const [testsCfg] = usePersisted('nexusmd.fields.testsTable', []);
  const visibleTestCols = resolveFields(TESTS_TABLE_COLUMNS, testsCfg).filter(f => f.visible);
  const testsGrid = visibleTestCols.map(c => c.width).join(' ');
```

Replace the inline `gridTemplateColumns: 'auto 1fr 80px 116px auto'` (line ~185) with `gridTemplateColumns: testsGrid`.

Cell renderer (move existing cell bodies into `case`s; the `result`, `run`, and `actions` bodies are the existing blocks at lines 187-203 and 205-233):

```jsx
  const testCell = (key, run) => {
    switch (key) {
      case 'result':   return (/* existing pill cell, lines 187-189 */);
      case 'run':      return (/* existing run info block, lines 190-203 */);
      case 'duration': return <div key="duration" className="build-meta">{run.duration || '-'}</div>;
      case 'date':     return <div key="date" className="build-meta mono" title={run.startTime ? new Date(run.startTime).toLocaleString() : ''}>{formatDateTime(run.startTime)}</div>;
      case 'actions':  return (/* existing actions block, lines 205-233 */);
      default:         return null;
    }
  };
```

Render the row body as `{visibleTestCols.map(f => testCell(f.key, run))}`.

> Implementer: copy the referenced JSX bodies verbatim, adding `key={key}` to each outer element. `formatDateTime` is already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && npx vitest run tests/tests-table-fields.test.jsx`
Expected: PASS.

- [ ] **Step 5: Full regression + commit**

Run: `cd packages/ui && npx vitest run` and `cd packages/core && npx vitest run`
Expected: all PASS.

```bash
git add packages/ui/src/views/view-tests.jsx packages/ui/tests/tests-table-fields.test.jsx
git commit -m "feat(ui): tests table honors column config"
```

---

## Self-Review Notes

- **Spec coverage:** §1 catalogs+resolver → Task 1. §2 persistence keys → Task 3. §3 `FieldVisibilityCard` → Task 2. §4 settings wiring (web+desktop) → Task 3. §5 view integration → Tasks 4 (WI card), 5 (WI table), 6 (PR card), 7 (builds), 8 (tests). §6 testing → each task's tests. All spec sections mapped.
- **Type consistency:** helper names `resolveFields`/`reorderField`/`toggleField`/`defaultConfig` and catalog names are identical across Tasks 1-8. Config shape `[{key,visible}]` consistent everywhere.
- **Known approximations (called out, not silent):** PR `linkedWorkItems` collapses to one leading `·` separator (Task 6); the `WorkItemsView` default view (board vs table) may require a toggle click in Tasks 4/5 tests — implementer verifies against the actual view state control.
- **Locked semantics:** `toggleField` no-ops on locked keys and `resolveFields` forces locked visible — so locked columns/fields can never be removed even via a hand-edited stored config.
```
