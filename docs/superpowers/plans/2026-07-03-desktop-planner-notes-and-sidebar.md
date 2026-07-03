# Desktop PR link, sidebar, planner notes & cloud backup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver seven desktop improvements — a visible DevOps PR link on PR cards, a pinned Settings item, in-Planner cloud backup, a planner-notes overview list with promote-to-library, a "Notes → Documents" rename, and a standalone week-agnostic Notes tab.

**Architecture:** Desktop app (`apps/desktop`) consumes shared React views from `packages/ui` and a section schema from `packages/core`. Changes that must live in shared code are made **additively** and, where they would otherwise regress or clutter the web/mobile apps, gated behind optional props that only desktop passes. Nav configuration is extracted from the non-testable `main.jsx` (which renders + starts sync at import) into a pure `nav-config.js` module so it can be unit-tested.

**Tech Stack:** React 18, Vitest + @testing-library/react, Electron, ESM JavaScript (`.jsx`/`.js`). No TypeScript.

## Global Constraints

- Desktop app namespace is `nexusmd`; profile keys go through `getProfileKey`.
- Shared-code changes must be **additive**. Behaviour that should not appear in web/mobile is gated behind an optional prop defaulting to the current behaviour; desktop opts in/out explicitly.
- The week-agnostic notes library is stored at `${namespace}.planner.globalNotes` and accessed only via `loadGlobalNotes()` / `saveGlobalNotes(notes)` — never touch the raw key.
- A library note has the shape: `{ id, title, body, createdAt, updatedAt, status: 'open'|'done', completedWeek: string|null }`.
- A planner row note (`plRowNotes(row)` item) has the shape: `{ id, title, body, createdAt, updatedAt }`.
- Promote semantics are **copy**: the original row note is retained.
- The overview planner-notes list is scoped to the **currently viewed week only**.
- Do not change the notes data shape or the DOCX export/import columns.
- Tests use `import { describe, it, expect, vi, afterEach } from 'vitest'` and `@testing-library/react` with `afterEach(cleanup)`, mirroring `apps/desktop/src/nav-order-editor.test.jsx`.
- Run desktop tests with `npm test` inside `apps/desktop`; core tests inside `packages/core`; ui tests inside `packages/ui`. (The repo uses a Vitest workspace — `npx vitest run <file>` from the repo root also works.)

---

## File Structure

**Create:**
- `apps/desktop/src/nav-config.js` — pure nav definitions: `NAV` (reorderable, no Settings), `SETTINGS_NAV`, `ALL_NAV`, `DEFAULT_NAV_ORDER`.
- `apps/desktop/src/nav-config.test.js` — tests for the above.
- `apps/desktop/src/desktop-notes-view.jsx` — standalone top-level Notes view wrapping `GlobalNotesView`.
- `apps/desktop/src/desktop-notes-view.test.jsx` — tests for the above.
- `packages/ui/src/planner/planner-notes-overview.jsx` — pure `collectRowNotes(data, sections)` + `promoteRowNoteToLibrary(...)` helpers and the `PlannerNotesPanel` component.
- `packages/ui/src/planner/planner-notes-overview.test.jsx` — tests for the helpers.
- `packages/ui/src/views/view-prs.test.jsx` — tests for the new PR card link.

**Modify:**
- `apps/desktop/src/main.jsx` — import nav-config; render pinned Settings; fix `active`/placeholder lookups; wire `case 'notes'`; pass `onOpenLink` to `PRView` and `onCloudSync` to `PlannerView`.
- `packages/ui/src/views/view-prs.jsx` — optional `onOpenLink` prop + card link button.
- `packages/ui/src/views/view-planner.jsx` — optional `onCloudSync` header button + optional `showGlobalNotesTab` prop; render `PlannerNotesPanel` in the overview.
- `packages/ui/src/index.js` — export `collectRowNotes`, `promoteRowNoteToLibrary`, `PlannerNotesPanel`.
- `packages/core/src/modules/planner/index.js` — add `hasNotes: true` to more sections.
- `packages/core/tests/planner.test.js` — assert the new `hasNotes` sections.

---

## Task 1: Extract nav config and pin Settings to the sidebar bottom (Feature 2)

**Files:**
- Create: `apps/desktop/src/nav-config.js`
- Create: `apps/desktop/src/nav-config.test.js`
- Modify: `apps/desktop/src/main.jsx` (NAV definition ~200-211, DEFAULT_TWEAKS.navOrder ~80, `active`/placeholder lookups ~572 & ~729, keyboard shortcut ~806, sidebar render ~857-899)

**Interfaces:**
- Produces: `NAV` (array of `{id,label,icon}`, **no** `settings`), `SETTINGS_NAV` (`{id:'settings',label:'Settings',icon:'settings'}`), `ALL_NAV` (`[...NAV, SETTINGS_NAV]`), `DEFAULT_NAV_ORDER` (`NAV.map(n => n.id)`).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/nav-config.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'

describe('nav-config', () => {
  it('NAV does not contain the settings item', () => {
    expect(NAV.find(n => n.id === 'settings')).toBeUndefined()
  })

  it('SETTINGS_NAV is the settings item', () => {
    expect(SETTINGS_NAV).toEqual({ id: 'settings', label: 'Settings', icon: 'settings' })
  })

  it('ALL_NAV appends settings after the reorderable items', () => {
    expect(ALL_NAV[ALL_NAV.length - 1]).toEqual(SETTINGS_NAV)
    expect(ALL_NAV.length).toBe(NAV.length + 1)
  })

  it('DEFAULT_NAV_ORDER mirrors NAV ids and excludes settings', () => {
    expect(DEFAULT_NAV_ORDER).toEqual(NAV.map(n => n.id))
    expect(DEFAULT_NAV_ORDER).not.toContain('settings')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/nav-config.test.js`
Expected: FAIL — cannot resolve `./nav-config.js`.

- [ ] **Step 3: Create the nav-config module**

Create `apps/desktop/src/nav-config.js`:

```javascript
// Pure sidebar nav configuration, extracted from main.jsx (which renders and
// starts sync at import, so it can't be imported by tests). Settings is kept OUT
// of the reorderable NAV and pinned separately at the sidebar bottom.
export const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'calendar',  label: 'Calendar',      icon: 'clock' },
  { id: 'work',      label: 'Work Items',    icon: 'work' },
  { id: 'prs',       label: 'Pull Requests', icon: 'pr' },
  { id: 'builds',    label: 'Builds',        icon: 'build' },
  { id: 'tests',     label: 'Tests',         icon: 'check' },
  { id: 'team',      label: 'Team',          icon: 'team' },
  { id: 'triage',    label: 'Triage',        icon: 'work' },
  { id: 'planner',   label: 'Planner',       icon: 'planner' },
  { id: 'markdown',  label: 'Notes',         icon: 'pin' },
]

export const SETTINGS_NAV = { id: 'settings', label: 'Settings', icon: 'settings' }

export const ALL_NAV = [...NAV, SETTINGS_NAV]

export const DEFAULT_NAV_ORDER = NAV.map(n => n.id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/nav-config.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire main.jsx to the new module**

In `apps/desktop/src/main.jsx`:

1. Add an import near the other local imports (after line 22's `./sync.js` import):

```javascript
import { NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'
```

2. **Delete** the inline `const NAV = [ ... ]` block (currently ~lines 200-211).

3. In `DEFAULT_TWEAKS` (~line 80), replace the `navOrder` array literal with:

```javascript
  navOrder: DEFAULT_NAV_ORDER,
```

4. Replace the two `NAV.find(...)` lookups that must resolve Settings with `ALL_NAV.find(...)`:
   - The placeholder fallback (~line 572): `<Placeholder label={(ALL_NAV.find(n => n.id === view) || ALL_NAV[0]).label} />`
   - The active-item lookup (~line 729): `const active = ALL_NAV.find(n => n.id === view) || ALL_NAV[0]`

(The keyboard-shortcut lookup `NAV[idx - 1]` at ~line 806 stays as `NAV` — number shortcuts should map to reorderable items only.)

- [ ] **Step 6: Render the pinned Settings button**

In the sidebar `<aside>` render, the reorderable items are produced by `orderedNav(tweaks.navOrder, NAV).map((item, idx) => ( ... ))` and end with `))}` (~line 899). Immediately after that closing `))}` and before the resize-handle block, insert a spacer and a pinned Settings button:

```jsx
          <div style={{ marginTop: 'auto' }} />
          <button
            key={SETTINGS_NAV.id}
            onClick={() => setView(SETTINGS_NAV.id)}
            className={`nav-item ${view === SETTINGS_NAV.id ? 'active' : ''}`}
            title={iconsOnly ? SETTINGS_NAV.label : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: iconsOnly ? 'center' : 'flex-start',
              gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
              border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              background: view === SETTINGS_NAV.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
              color: view === SETTINGS_NAV.id ? 'var(--accent)' : 'var(--text-muted)',
              font: 'inherit', fontSize: 13, position: 'relative',
            }}
          >
            <Icon name={SETTINGS_NAV.icon} size={16} />
            {!iconsOnly && SETTINGS_NAV.label}
          </button>
```

Note: the `<aside>` already uses `flexDirection: 'column'`, so `marginTop: 'auto'` pushes Settings to the bottom.

- [ ] **Step 7: Verify the full desktop suite still passes**

Run: `npx vitest run apps/desktop/src/nav-config.test.js apps/desktop/src/nav-order-editor.test.jsx apps/desktop/src/layout.test.js`
Expected: PASS. (`orderedNav` already drops stored ids missing from `NAV`, so a saved `navOrder` containing `settings` silently loses it from the reorderable list — Settings only renders in the pinned slot.)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/nav-config.js apps/desktop/src/nav-config.test.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): pin Settings to sidebar bottom; extract nav-config"
```

---

## Task 2: Rename "Notes" → "Documents" and add a standalone Notes tab (Features 5 & 6)

**Files:**
- Modify: `apps/desktop/src/nav-config.js` (rename `markdown` label; add `notes` item)
- Modify: `apps/desktop/src/nav-config.test.js` (assert rename + new item)
- Create: `apps/desktop/src/desktop-notes-view.jsx`
- Create: `apps/desktop/src/desktop-notes-view.test.jsx`
- Modify: `apps/desktop/src/main.jsx` (add `case 'notes'`)
- Modify: `packages/ui/src/views/view-planner.jsx` (gate the in-planner Notes tab behind `showGlobalNotesTab`)

**Interfaces:**
- Consumes: `GlobalNotesView`, `loadGlobalNotes`, `saveGlobalNotes` from `@nexusmd/ui`; `getIsoWeek` from `@nexusmd/core`.
- Produces: `DesktopNotesView` (default-exported React component, no props).
- Produces: `PlannerView` gains optional prop `showGlobalNotesTab` (default `true`).

- [ ] **Step 1: Write the failing nav-config tests**

Add to `apps/desktop/src/nav-config.test.js`:

```javascript
  it('renames the markdown item to Documents', () => {
    expect(NAV.find(n => n.id === 'markdown').label).toBe('Documents')
  })

  it('adds a top-level Notes item after planner', () => {
    const ids = NAV.map(n => n.id)
    expect(ids).toContain('notes')
    expect(ids.indexOf('notes')).toBe(ids.indexOf('planner') + 1)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/desktop/src/nav-config.test.js`
Expected: FAIL — label is still 'Notes'; no 'notes' id.

- [ ] **Step 3: Update nav-config**

In `apps/desktop/src/nav-config.js`, change the `markdown` line's label to `'Documents'` and insert a `notes` item immediately after `planner`:

```javascript
  { id: 'planner',   label: 'Planner',       icon: 'planner' },
  { id: 'notes',     label: 'Notes',         icon: 'pin' },
  { id: 'markdown',  label: 'Documents',     icon: 'pin' },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/desktop/src/nav-config.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing DesktopNotesView test**

Create `apps/desktop/src/desktop-notes-view.test.jsx`:

```jsx
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub the heavy shared view: assert DesktopNotesView passes a computed weekLabel
// and load/save-backed notes through to GlobalNotesView.
const gvProps = { current: null }
vi.mock('@nexusmd/ui', () => ({
  GlobalNotesView: (props) => { gvProps.current = props; return <div data-testid="gnv">notes:{props.notes.length}</div> },
  loadGlobalNotes: () => [{ id: 'gn1', title: 'A', body: '', status: 'open', completedWeek: null, createdAt: '', updatedAt: '' }],
  saveGlobalNotes: vi.fn(),
}))

import DesktopNotesView from './desktop-notes-view.jsx'

afterEach(() => { cleanup(); gvProps.current = null })

describe('DesktopNotesView', () => {
  it('renders GlobalNotesView with loaded notes and a week label', () => {
    render(<DesktopNotesView />)
    expect(screen.getByTestId('gnv').textContent).toBe('notes:1')
    expect(gvProps.current.weekLabel).toMatch(/^W\d{1,2}$/)
    expect(typeof gvProps.current.setNotes).toBe('function')
  })
})
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run apps/desktop/src/desktop-notes-view.test.jsx`
Expected: FAIL — cannot resolve `./desktop-notes-view.jsx`.

- [ ] **Step 7: Implement DesktopNotesView**

Create `apps/desktop/src/desktop-notes-view.jsx`:

```jsx
import React from 'react'
import { GlobalNotesView, loadGlobalNotes, saveGlobalNotes } from '@nexusmd/ui'
import { getIsoWeek } from '@nexusmd/core'

// Standalone top-level "Notes" view: the week-agnostic notes library, lifted out
// of the Planner into its own sidebar tab. There is no "current week" here, so we
// compute this week's short label for the note "Complete in <week>" action.
function thisWeekShortLabel() {
  const now = new Date()
  const day = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + 1)
  return `W${getIsoWeek(monday)}`
}

export default function DesktopNotesView() {
  const [notes, setNotesRaw] = React.useState(() => loadGlobalNotes())
  const setNotes = React.useCallback((fn) => setNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn
    saveGlobalNotes(next)
    return next
  }), [])
  const weekLabel = React.useMemo(thisWeekShortLabel, [])

  return (
    <div style={{ padding: 4 }}>
      <GlobalNotesView notes={notes} setNotes={setNotes} weekLabel={weekLabel} />
    </div>
  )
}
```

(No `onAddTask` prop — outside the planner there is no active week to add tasks to, and `GlobalNoteModal` hides that button when `onAddTask` is absent.)

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run apps/desktop/src/desktop-notes-view.test.jsx`
Expected: PASS.

- [ ] **Step 9: Wire the view into main.jsx**

In `apps/desktop/src/main.jsx`:

1. Import the component near the top:

```javascript
import DesktopNotesView from './desktop-notes-view.jsx'
```

2. In the view switch (the `switch`/`case` block in `ViewBody`), add a case before `case 'markdown':`:

```jsx
    case 'notes':
      return <DesktopNotesView />
```

3. In the `PlannerView` render (~line 551), pass the gating prop so the in-planner Notes tab disappears on desktop:

```jsx
        <PlannerView
          data={plannerData}
          setData={setPlannerData}
          themes={plannerThemes}
          setThemes={setPlannerThemes}
          onExportDocx={plannerExportDocx}
          landing={plannerPrefs.landing}
          navStyle={plannerPrefs.nav}
          entryStyle={plannerPrefs.entry}
          carryPrompt={plannerPrefs.carryPrompt}
          showGlobalNotesTab={false}
        />
```

- [ ] **Step 10: Gate the in-planner Notes tab in the shared view**

In `packages/ui/src/views/view-planner.jsx`:

1. Add `showGlobalNotesTab = true` to the destructured props (line 28):

```javascript
function PlannerView({ data, setData, themes, setThemes, onExportDocx, showGlobalNotesTab = true }) {
```

2. Where `navGroups` is built (~line 449), include the `mynotes` entry only when enabled:

```javascript
  const navGroups = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    ...(showGlobalNotesTab ? [{ id: 'mynotes', label: 'Notes', icon: 'pin' }] : []),
    ...PL_GROUPS,
  ]
```

3. At each of the three render sites that reference `'mynotes'` / `notesView` (the rail body ~line 663, the scroll body ~line 678-679, and the tabs body ~line 695), guard the notes rendering with `showGlobalNotesTab`. For the two ternary sites, change `activeGroup === 'mynotes' ? notesView` to:

```jsx
              : (showGlobalNotesTab && activeGroup === 'mynotes') ? notesView
```

For the scroll body block (~line 678-679) wrap it:

```jsx
          {showGlobalNotesTab && (
            <React.Fragment>
              {groupHeader({ id: 'mynotes', label: 'Notes (week-agnostic)', icon: 'pin' })}
              {notesView}
            </React.Fragment>
          )}
```

(If `activeGroup` is still `'mynotes'` from a persisted state while disabled, the overview default applies because no branch matches; the final `: glance`/overview fallback in each ternary handles it. Verify each ternary chain ends in an overview/`glance` fallback — it does.)

- [ ] **Step 11: Run planner + desktop tests**

Run: `npx vitest run packages/ui/src/views apps/desktop/src/desktop-notes-view.test.jsx apps/desktop/src/nav-config.test.js`
Expected: PASS (existing planner tests unaffected because the prop defaults to `true`).

- [ ] **Step 12: Commit**

```bash
git add apps/desktop/src/nav-config.js apps/desktop/src/nav-config.test.js apps/desktop/src/desktop-notes-view.jsx apps/desktop/src/desktop-notes-view.test.jsx apps/desktop/src/main.jsx packages/ui/src/views/view-planner.jsx
git commit -m "feat(desktop): rename Notes→Documents; move week-agnostic notes to own tab"
```

---

## Task 3: Visible DevOps link on the PR card (Feature 1)

**Files:**
- Modify: `packages/ui/src/views/view-prs.jsx` (`PRView` signature ~line 83; `PRRow` ~line 278-345)
- Create: `packages/ui/src/views/view-prs.test.jsx`
- Modify: `apps/desktop/src/main.jsx` (`PRView` render ~line 510)

**Interfaces:**
- Consumes: `pr.url` (ADO web link, may be empty string).
- Produces: `PRView`/`PRRow` gain optional prop `onOpenLink(url)`. When absent, the button falls back to `window.open(url, '_blank', 'noopener')`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/views/view-prs.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRView } from './view-prs.jsx'

afterEach(cleanup)

const basePr = {
  id: 42, title: 'Fix the thing', url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
  author: 'Alex', additions: 3, deletions: 1, status: 'active', reviewers: [],
}

describe('PRView card DevOps link', () => {
  it('renders a link button when pr.url is set and calls onOpenLink', () => {
    const onOpenLink = vi.fn()
    render(<PRView prs={[basePr]} onOpen={vi.fn()} onOpenLink={onOpenLink} />)
    const link = screen.getByTestId('pr-open-link')
    fireEvent.click(link)
    expect(onOpenLink).toHaveBeenCalledWith(basePr.url)
  })

  it('does not render a link button when pr.url is empty', () => {
    render(<PRView prs={[{ ...basePr, url: '' }]} onOpen={vi.fn()} onOpenLink={vi.fn()} />)
    expect(screen.queryByTestId('pr-open-link')).toBeNull()
  })

  it('clicking the link does not trigger the row onOpen', () => {
    const onOpen = vi.fn()
    render(<PRView prs={[basePr]} onOpen={onOpen} onOpenLink={vi.fn()} />)
    fireEvent.click(screen.getByTestId('pr-open-link'))
    expect(onOpen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/ui/src/views/view-prs.test.jsx`
Expected: FAIL — no element with testid `pr-open-link`.

- [ ] **Step 3: Thread the prop and render the button**

In `packages/ui/src/views/view-prs.jsx`:

1. Add `onOpenLink` to the `PRView` signature (line 83):

```javascript
export function PRView({ prs, onOpen, onOpenLink, needsMeCriteria, setNeedsMeCriteria, newItemIds = new Set() }) {
```

2. Find where `PRView` renders `<PRRow ... />` (search for `<PRRow`) and pass the prop through: add `onOpenLink={onOpenLink}`.

3. Update `PRRow` signature (line 278): `function PRRow({ pr, onOpen, onOpenLink }) {`.

4. Ensure the `Icon` component is imported in this file (check the imports at the top; it is used elsewhere as `<Icon .../>`). Inside the `.pr-meta` container (~line 338) add a link button as the first child:

```jsx
      <div className="pr-meta">
        {pr.url && (
          <button
            type="button"
            data-testid="pr-open-link"
            className="btn sm ghost"
            title="Open pull request in Azure DevOps"
            onClick={(e) => {
              e.stopPropagation()
              if (onOpenLink) onOpenLink(pr.url)
              else window.open(pr.url, '_blank', 'noopener')
            }}
            style={{ flexShrink: 0 }}
          >
            <Icon name="link" size={12} />
          </button>
        )}
```

(Keep the remaining `.pr-meta` children as-is.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/ui/src/views/view-prs.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire desktop to open links via Electron**

In `apps/desktop/src/main.jsx`, update the `PRView` render (~line 510):

```jsx
        <PRView prs={data.PRS || []} onOpen={onOpenPR}
          onOpenLink={(u) => window.electronAPI.openLink(u)}
          needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
          newItemIds={newItemIds.pr} />
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-prs.jsx packages/ui/src/views/view-prs.test.jsx apps/desktop/src/main.jsx
git commit -m "feat(ui): visible DevOps link button on PR cards"
```

---

## Task 4: Cloud sync/backup button in the Planner header (Feature 3)

**Files:**
- Modify: `packages/ui/src/views/view-planner.jsx` (signature line 28; header ~line 520-526)
- Modify: `apps/desktop/src/main.jsx` (import `desktopSync`; PlannerView render ~line 551)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PlannerView` gains optional async prop `onCloudSync()`. When present, a "Sync" button renders in the header; it disables while the promise is pending. All user feedback (toasts, skip reasons) is the caller's responsibility.
- `desktopSync.syncOnce()` returns `{ skipped: 'no-key'|'no-provider'|'not-connected'|'bad-passphrase' }` or `{ pushed, pulled, merged }`.

- [ ] **Step 1: Add the header button (manual verification — no isolated unit test)**

In `packages/ui/src/views/view-planner.jsx`:

1. Add `onCloudSync` to the signature (line 28), extending the Task 2 change:

```javascript
function PlannerView({ data, setData, themes, setThemes, onExportDocx, showGlobalNotesTab = true, onCloudSync }) {
```

2. Add a busy state near the other `useState` hooks (e.g. after line 82's `plannerSyncRev`):

```javascript
  const [cloudSyncing, setCloudSyncing] = useState(false)
```

3. In the header actions `<div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>` (~line 526), add as the **first** child:

```jsx
        {onCloudSync && (
          <button type="button" className="btn sm ghost" title="Back up / sync planner to cloud"
            disabled={cloudSyncing}
            onClick={async () => {
              setCloudSyncing(true)
              try { await onCloudSync() } finally { setCloudSyncing(false) }
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <Icon name="refresh" size={14} />
            {cloudSyncing ? 'Syncing…' : 'Sync'}
          </button>
        )}
```

- [ ] **Step 2: Wire desktop's sync handler**

In `apps/desktop/src/main.jsx`:

1. Extend the sync import (line 22):

```javascript
import { startDesktopAutoSync, desktopSync } from './sync.js'
```

2. Define a handler inside the component that renders `PlannerView` (the `ViewBody` function, alongside the other planner prep at ~line 541). Place it just before the `return` of the `'planner'` case:

```javascript
      const handlePlannerCloudSync = async () => {
        try {
          const r = await desktopSync.syncOnce()
          if (r.skipped === 'no-key') toast?.('Set a sync passphrase in Settings first.', 'info')
          else if (r.skipped === 'no-provider') toast?.('Select a cloud provider in Settings first.', 'info')
          else if (r.skipped === 'not-connected') toast?.('Connect your cloud provider in Settings first.', 'info')
          else if (r.skipped === 'bad-passphrase') toast?.('Wrong passphrase — fix it in Settings.', 'error')
          else if (!r.skipped) toast?.(`Backed up — pushed ${r.pushed}, pulled ${r.pulled}, merged ${r.merged}.`, 'success')
        } catch (err) { toast?.('Cloud sync failed: ' + (err?.message || 'unknown error'), 'error') }
      }
```

3. Pass it to `PlannerView`:

```jsx
          onCloudSync={handlePlannerCloudSync}
```

(Confirm `toast` is imported in `main.jsx` from `@nexusmd/ui`; it is already used at ~line 353. If it is not in the import list, add `toast` to the `@nexusmd/ui` import block.)

- [ ] **Step 3: Verify existing planner tests still pass**

Run: `npx vitest run packages/ui/src/views`
Expected: PASS — `onCloudSync` is optional so no existing test renders the button.

- [ ] **Step 4: Manually verify in the running app (optional but recommended)**

Follow `apps/desktop/Start-Dev.ps1`; open Planner; confirm a "Sync" button appears in the header and shows the correct toast when no passphrase is set.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/view-planner.jsx apps/desktop/src/main.jsx
git commit -m "feat(desktop): back up planner to cloud from the Planner header"
```

---

## Task 5: Enable row notes on more planner sections (Feature 4A)

**Files:**
- Modify: `packages/core/src/modules/planner/index.js` (`PLANNER_SECTIONS`, lines 86-147)
- Modify: `packages/core/tests/planner.test.js`

**Interfaces:**
- Produces: `PLANNER_SECTIONS` entries `tasks`, `reminders`, `chatsIn`, `chatsOut`, `statusUpdates`, `workItemsPlan`, `teamTasks`, `teamNotes` now carry `hasNotes: true` (in addition to the existing `meetNotes`, `dailyLog`).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/tests/planner.test.js`:

```javascript
describe('PLANNER_SECTIONS row-notes coverage', () => {
  const withNotes = new Set([
    'tasks', 'reminders', 'chatsIn', 'chatsOut', 'statusUpdates',
    'workItemsPlan', 'teamTasks', 'teamNotes', 'meetNotes', 'dailyLog',
  ])
  it('enables hasNotes on exactly the expected sections', () => {
    const actual = new Set(PLANNER_SECTIONS.filter(s => s.hasNotes).map(s => s.id))
    expect(actual).toEqual(withNotes)
  })
  it('note-enabled sections are all tables', () => {
    PLANNER_SECTIONS.filter(s => s.hasNotes).forEach(s => {
      expect(s.type).toBe('table')
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/tests/planner.test.js`
Expected: FAIL — only `meetNotes` and `dailyLog` currently have `hasNotes`.

- [ ] **Step 3: Add `hasNotes: true` to the target sections**

In `packages/core/src/modules/planner/index.js`, add `hasNotes: true` to each section object below (place it right after `type:'table'`). The eight to change:

- `tasks` (line 87): `{ id:'tasks', num:'1', title:'My tasks', icon:'check-circle', type:'table', hasNotes: true, cols:[ ... ]`
- `chatsIn` (line 99): add `hasNotes: true` after `type:'table'`
- `chatsOut` (line 103): add `hasNotes: true`
- `statusUpdates` (line 107): add `hasNotes: true`
- `teamNotes` (line 115): add `hasNotes: true` (keep `defaultConfidential: true`)
- `workItemsPlan` (line 133): add `hasNotes: true`
- `teamTasks` (line 138): add `hasNotes: true`
- `reminders` (line 142): add `hasNotes: true`

(`meetNotes` and `dailyLog` already have it. Do not add `cols` changes — only the `hasNotes` flag.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/core/tests/planner.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/planner/index.js packages/core/tests/planner.test.js
git commit -m "feat(core): enable row notes on more planner sections"
```

---

## Task 6: Planner-notes overview list with promote-to-library (Features 4B & 7)

**Files:**
- Create: `packages/ui/src/planner/planner-notes-overview.jsx`
- Create: `packages/ui/src/planner/planner-notes-overview.test.jsx`
- Modify: `packages/ui/src/index.js` (export the new helpers/component)
- Modify: `packages/ui/src/views/view-planner.jsx` (render `PlannerNotesPanel` in the overview)

**Interfaces:**
- Consumes: `plRowNotes` (from `planner-notes.jsx`), `loadGlobalNotes`, `saveGlobalNotes`, `PLANNER_SECTIONS` row/section shapes, `RowNotesModal`.
- Produces:
  - `collectRowNotes(data, sections)` → array of `{ sectionId, sectionTitle, rowId, rowLabel, notes }` for every table row (in a `hasNotes` section) that has ≥1 note. `notes` is the row's `plRowNotes(row)` array.
  - `promoteRowNoteToLibrary(note)` → appends a copy of one row note to the library via load/save and returns the new library entry. Copy semantics; original untouched.
  - `PlannerNotesPanel({ data, setData, sections })` React component rendering the list + promote buttons + a `RowNotesModal` for editing.

- [ ] **Step 1: Write the failing helper tests**

Create `packages/ui/src/planner/planner-notes-overview.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = { notes: [] }
vi.mock('./planner-notes.jsx', () => ({
  plRowNotes: (row) => Array.isArray(row._notesList) ? row._notesList : [],
  loadGlobalNotes: () => store.notes,
  saveGlobalNotes: (n) => { store.notes = n },
  RowNotesModal: () => null,
}))

import { collectRowNotes, promoteRowNoteToLibrary } from './planner-notes-overview.jsx'

const SECTIONS = [
  { id: 'tasks', title: 'My tasks', type: 'table', hasNotes: true,
    cols: [{ k: 'task', l: 'Task', main: true }] },
  { id: 'meetNotes', title: 'Meetings - notes & decisions', type: 'table', hasNotes: true,
    cols: [{ k: 'meeting', l: 'Meeting', main: true }] },
  { id: 'themes', title: 'Themes', type: 'keyval' },
]

beforeEach(() => { store.notes = [] })

describe('collectRowNotes', () => {
  it('collects only rows that have notes, labelled by section + main col', () => {
    const data = {
      tasks: [
        { id: 'r1', task: 'Ship it', _notesList: [{ id: 'n1', title: 'Plan', body: 'do' }] },
        { id: 'r2', task: 'No notes', _notesList: [] },
      ],
      meetNotes: [
        { id: 'r3', meeting: 'Standup', _notesList: [{ id: 'n2', title: '', body: 'x' }] },
      ],
    }
    const out = collectRowNotes(data, SECTIONS)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ sectionId: 'tasks', rowId: 'r1', rowLabel: 'Ship it' })
    expect(out[0].notes).toHaveLength(1)
    expect(out[1]).toMatchObject({ sectionId: 'meetNotes', rowId: 'r3', rowLabel: 'Standup' })
  })

  it('ignores non-table and note-less sections', () => {
    const out = collectRowNotes({ themes: { a: 'b' } }, SECTIONS)
    expect(out).toEqual([])
  })

  it('falls back to a placeholder label when the main column is empty', () => {
    const out = collectRowNotes({ tasks: [{ id: 'r1', task: '', _notesList: [{ id: 'n', title: 't', body: '' }] }] }, SECTIONS)
    expect(out[0].rowLabel).toBe('(untitled)')
  })
})

describe('promoteRowNoteToLibrary', () => {
  it('appends a copy to the library with open status', () => {
    const entry = promoteRowNoteToLibrary({ id: 'n1', title: 'Decision', body: 'ship' })
    expect(store.notes).toHaveLength(1)
    expect(store.notes[0]).toMatchObject({ title: 'Decision', body: 'ship', status: 'open', completedWeek: null })
    expect(store.notes[0].id).not.toBe('n1') // fresh library id
    expect(entry).toBe(store.notes[0])
  })

  it('derives a title from the body when the note has no title', () => {
    const entry = promoteRowNoteToLibrary({ id: 'n2', title: '', body: '# Heading\nmore text' })
    expect(entry.title.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/ui/src/planner/planner-notes-overview.test.jsx`
Expected: FAIL — cannot resolve `./planner-notes-overview.jsx`.

- [ ] **Step 3: Implement the helpers + panel**

Create `packages/ui/src/planner/planner-notes-overview.jsx`:

```jsx
import React from 'react';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { plRowNotes, loadGlobalNotes, saveGlobalNotes, RowNotesModal } from './planner-notes.jsx';

// Aggregate every table row (in a hasNotes section) that has at least one note,
// for the Planner overview "Planner notes" list. Pure — unit-tested independently.
export function collectRowNotes(data, sections) {
  const out = [];
  sections.forEach(sec => {
    if (sec.type !== 'table' || !sec.hasNotes) return;
    const mainCol = (sec.cols || []).find(c => c.main) || (sec.cols || [])[0];
    (data[sec.id] || []).forEach(row => {
      const notes = plRowNotes(row);
      if (!notes.length) return;
      out.push({
        sectionId: sec.id,
        sectionTitle: sec.title,
        rowId: row.id,
        rowLabel: (mainCol && row[mainCol.k]) ? String(row[mainCol.k]) : '(untitled)',
        notes,
      });
    });
  });
  return out;
}

function deriveTitle(note) {
  if (note.title && note.title.trim()) return note.title.trim();
  const snippet = (note.body || '').replace(/[#>*`\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return snippet || 'Untitled note';
}

let _promoteSeq = 0;
// Copy (not move) a single planner row note into the week-agnostic library.
export function promoteRowNoteToLibrary(note) {
  const now = new Date().toISOString();
  const entry = {
    id: 'gn' + Date.now() + '-' + (_promoteSeq++),
    title: deriveTitle(note),
    body: note.body || '',
    createdAt: now,
    updatedAt: now,
    status: 'open',
    completedWeek: null,
  };
  const next = [entry, ...loadGlobalNotes()];
  saveGlobalNotes(next);
  return entry;
}

export function PlannerNotesPanel({ data, setData, sections }) {
  const [editing, setEditing] = React.useState(null); // { sectionId, rowId }
  const entries = collectRowNotes(data, sections);

  const updateRowNotes = (sectionId, rowId, notesArr) => {
    setData(prev => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).map(r =>
        r.id === rowId ? { ...r, _notesList: notesArr, _notes: '' } : r),
    }));
  };

  const promoteAll = (entry) => {
    entry.notes.forEach(promoteRowNoteToLibrary);
    toast?.(`Promoted ${entry.notes.length} note${entry.notes.length !== 1 ? 's' : ''} to Notes.`, 'success');
  };

  const editingEntry = editing
    ? entries.find(e => e.sectionId === editing.sectionId && e.rowId === editing.rowId)
    : null;

  return (
    <div className="card pl-section" data-testid="planner-notes-panel">
      <div className="card-head">
        <h3>
          <span className="ic"><Icon name="edit" size={14}/></span>
          Planner notes
          <span className="pl-sec-count">{entries.length} this week</span>
        </h3>
      </div>
      <div className="card-body flush">
        {entries.length === 0 && (
          <div className="empty" style={{ padding: '24px 20px', fontSize: 12.5 }}>
            No notes on this week's planner rows yet. Add notes to a row, then promote the useful ones to your week-agnostic Notes.
          </div>
        )}
        {entries.map(entry => (
          <div key={entry.sectionId + ':' + entry.rowId} className="gnote-card"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="body" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              onClick={() => setEditing({ sectionId: entry.sectionId, rowId: entry.rowId })}>
              <div className="ttl">{entry.rowLabel}</div>
              <div className="meta">
                <span>{entry.sectionTitle}</span>
                <span className="pill">{entry.notes.length} note{entry.notes.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button className="btn sm ghost" title="Copy these notes into your week-agnostic Notes"
              onClick={() => promoteAll(entry)}>
              <Icon name="pin" size={12}/> Promote
            </button>
          </div>
        ))}
      </div>

      {editingEntry && (
        <RowNotesModal
          open={!!editingEntry}
          onClose={() => setEditing(null)}
          title={editingEntry.rowLabel}
          sub={editingEntry.sectionTitle}
          notes={editingEntry.notes}
          onChange={arr => updateRowNotes(editingEntry.sectionId, editingEntry.rowId, arr)}
        />
      )}
    </div>
  );
}
```

(Note: `toast` is imported from `../toast.jsx`; confirm that path exports `toast` — `planner-notes.jsx`-adjacent files import it the same way. If the export name differs, match the existing import used elsewhere in `packages/ui`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/ui/src/planner/planner-notes-overview.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from the ui package index**

In `packages/ui/src/index.js`, add to the planner-notes export area (near line 100-101):

```javascript
export { collectRowNotes, promoteRowNoteToLibrary, PlannerNotesPanel } from './planner/planner-notes-overview.jsx'
```

- [ ] **Step 6: Render the panel in the Planner overview**

In `packages/ui/src/views/view-planner.jsx`:

1. Add the import near the other planner imports (after line 14's glance import):

```javascript
import { PlannerNotesPanel } from '../planner/planner-notes-overview.jsx'
```

2. Extend the `glance` element (~line 477-481) to include the panel below the glance grid:

```jsx
  const glance = (
    <React.Fragment>
      <GlanceView data={data} themes={themes} sections={PLANNER_SECTIONS} groups={PL_GROUPS}
        onOpenGroup={openGroup} onOpenSection={openSection} rowVisible={rowVisible}
        carryCount={showCarryBanner ? carryItems.length : 0} onOpenCarry={() => setModal('carry')}/>
      <div style={{ marginTop: 12 }}>
        <PlannerNotesPanel data={data} setData={setData} sections={PLANNER_SECTIONS} />
      </div>
    </React.Fragment>
  )
```

- [ ] **Step 7: Run the ui view + planner tests**

Run: `npx vitest run packages/ui/src`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/planner/planner-notes-overview.jsx packages/ui/src/planner/planner-notes-overview.test.jsx packages/ui/src/index.js packages/ui/src/views/view-planner.jsx
git commit -m "feat(ui): planner-notes overview list with promote-to-library"
```

---

## Task 7: Full regression + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the whole workspace test suite**

Run: `npx vitest run` (from repo root)
Expected: PASS across `packages/core`, `packages/ui`, `apps/desktop`. If any pre-existing unrelated failures appear, note them but do not fix out of scope.

- [ ] **Step 2: Launch the desktop app and smoke-test each feature**

Follow `apps/desktop/Start-Dev.ps1`. Verify:
1. PR card shows a link icon; clicking opens the ADO PR in the browser (drawer link still works).
2. Settings sits pinned at the sidebar bottom and is absent from Settings → nav-order editor.
3. Planner header has a "Sync" button; it toasts appropriately.
4. Planner Overview shows a "Planner notes" list for rows with notes across My week / Comms / Work items / Team notes / Meetings; "Promote" adds them to the Notes tab.
5. Sidebar shows "Documents" (old markdown view) and a separate top-level "Notes" tab (week-agnostic library); Planner no longer has the in-planner Notes tab.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test(desktop): regression pass for planner notes & sidebar work"
```

---

## Self-Review Notes

- **Spec coverage:** F1 → Task 3; F2 → Task 1; F3 → Task 4; F4 (list) → Tasks 5 + 6; F4A (widen hasNotes) → Task 5; F5 (rename) → Task 2; F6 (notes tab) → Task 2; F7 (promote) → Task 6. All covered.
- **Refinement vs. spec:** the spec said "remove the in-Planner Notes tab" outright; to avoid regressing web/mobile (spec's own "out of scope: no web/mobile changes"), the removal is gated behind `showGlobalNotesTab` (default `true`), and desktop passes `false`. Same additive-prop pattern used for the PR link (`onOpenLink`) and planner sync (`onCloudSync`).
- **Type consistency:** `collectRowNotes` returns `{ sectionId, sectionTitle, rowId, rowLabel, notes }` and `PlannerNotesPanel` consumes exactly those keys; `promoteRowNoteToLibrary` produces the library note shape defined in Global Constraints.
