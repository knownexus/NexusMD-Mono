# Desktop Person Summary Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop Team tab's "Open profile" drawer the richest view of a team member (stats, blockers, clickable work/PR rows, notes, quick actions), and move note-viewing/management from the `DevCard` (which now only shows a count) into that drawer.

**Architecture:** Extract the desktop drawer's `PersonSummary` component into its own file so it's independently testable. Wire a `window` `CustomEvent` bridge (`nexusmd:team-add-note`, `nexusmd:team-schedule-1on1`, `nexusmd:team-delete-note`, `nexusmd:team-notes-changed`) between the desktop drawer and `TeamView` (in `packages/ui`, shared across apps), so `TeamView` stays the sole owner of note/1:1-modal state and the drawer never duplicates it — it just reads the same `nexusmd.team.notes` storage key and re-reads on the "changed" event.

**Tech Stack:** React 18, Vitest + @testing-library/react, existing `@nexusmd/ui` / `@nexusmd/core` shared packages.

## Global Constraints

- `enrichTeamMember` (`packages/core/src/modules/team/index.js`) already computes `{ active, blocked, done, myPRs, current, points, myWIs }` on every team member passed to `DevCard`/`onOpenPerson` — never re-filter `workItems`/`prs` manually in the drawer; use these fields.
- The `nexusmd.team.notes` storage key is a plain (non-profile-scoped) key on desktop — `storage: window.localStorage` is wired directly into `NexusDataProvider` in `apps/desktop/src/main.jsx`. Don't add profile-scoping to it.
- `NoteModal`/`ScheduleOneOnOneModal` (`packages/ui/src/views/view-team.jsx`) only ever read `dev.id`/`dev.name` off the object they're given — event `detail` payloads only need `{ id, name }`, never the full enriched member.
- No web app (`apps/web`) or ADO-connected app (`apps/app`) changes — this is `apps/desktop` + `packages/ui`'s `TeamView`/`DevCard` only.
- Run tests from each package's own directory (`apps/desktop/`, `packages/ui/`) per this repo's existing convention — not from the repo root.

---

### Task 1: Extract `PersonSummary` into its own file

**Files:**
- Create: `apps/desktop/src/person-summary.jsx`
- Create: `apps/desktop/src/person-summary.test.jsx`
- Modify: `apps/desktop/src/main.jsx` (remove inline `PersonSummary`, add import, drop now-unused imports)

**Interfaces:**
- Produces: `PersonSummary({ dev, workItems, prs })` — a named export from `apps/desktop/src/person-summary.jsx`. Renders identity (avatar/name/role/tz/focus), active (non-terminal) work items assigned to `dev.id`, and open PRs authored by `dev.id`. (This signature changes in Task 3 — this task is a pure move, no behavior change.)

This is a mechanical refactor (no behavior change), so there's no red/green cycle — instead, write the test against the *already-correct* moved behavior, confirm it passes, then confirm the full existing suite still passes (regression check).

- [ ] **Step 1: Create the new file with the moved component**

```jsx
// apps/desktop/src/person-summary.jsx
import React from 'react'
import { Icon, TypeIcon, Avatar } from '@nexusmd/ui'
import { isTerminalState } from '@nexusmd/core'

export function PersonSummary({ dev, workItems, prs }) {
  const myWIs = workItems.filter(w => w.assignee === dev.id && !isTerminalState(w.state))
  const myPRs = prs.filter(p => p.author === dev.id)

  return (
    <div>
      <div className="drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{dev.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{dev.role}{dev.tz ? ` · ${dev.tz}` : ''}</div>
          {dev.focus && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{dev.focus}</div>}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Active work ({myWIs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {myWIs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No active work items.</div>}
          {myWIs.map(w => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <TypeIcon type={w.type}/><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{w.id}</span>
              <span>{w.title}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Open PRs ({myPRs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {myPRs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No open pull requests.</div>}
          {myPRs.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{p.id}</span>
              <span>{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the inline component and unused imports from `main.jsx`**

In `apps/desktop/src/main.jsx`, change the `@nexusmd/core` import (drop `isTerminalState` — it's no longer used anywhere in this file):

```js
import {
  initCore, createNoOpAdapters, core, loadCachedAdoData, loadAdoData,
} from '@nexusmd/core'
```

Change the `@nexusmd/ui` import (drop `Avatar` — no longer used in this file):

```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost, toast,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  WorkItemFieldsEditor, PRTabs,
} from '@nexusmd/ui'
```

Add a new import for the extracted file (place alongside the other local imports, e.g. after `import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'`):

```js
import { PersonSummary } from './person-summary.jsx'
```

Delete the entire inline `function PersonSummary({ dev, workItems, prs }) { ... }` block (currently right after `DesktopDetailDrawer`'s closing brace, ending right before the `// The view body` comment) — its content now lives in `person-summary.jsx`.

- [ ] **Step 3: Write the test for the moved component**

```jsx
// apps/desktop/src/person-summary.test.jsx
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PersonSummary } from './person-summary.jsx'

describe('PersonSummary', () => {
  afterEach(cleanup)

  const dev = { id: 'alice', name: 'Alice Ng', role: 'Dev', tz: 'UTC', focus: 'Onboarding' }

  it('renders identity info and active (non-terminal) work items assigned to this person', () => {
    const workItems = [
      { id: 1, assignee: 'alice', state: 'Active', title: 'Fix login redirect', type: 'bug' },
      { id: 2, assignee: 'alice', state: 'Done', title: 'Old finished task', type: 'task' },
      { id: 3, assignee: 'bob', state: 'Active', title: "Not Alice's", type: 'task' },
    ]
    render(<PersonSummary dev={dev} workItems={workItems} prs={[]} />)
    expect(screen.getByText('Alice Ng')).toBeTruthy()
    expect(screen.getByText('Active work (1)')).toBeTruthy()
    expect(screen.getByText('Fix login redirect')).toBeTruthy()
    expect(screen.queryByText('Old finished task')).toBeNull()
    expect(screen.queryByText("Not Alice's")).toBeNull()
  })

  it('renders open PRs authored by this person', () => {
    const prs = [
      { id: 10, author: 'alice', title: 'Add retry logic' },
      { id: 11, author: 'bob', title: "Not Alice's PR" },
    ]
    render(<PersonSummary dev={dev} workItems={[]} prs={prs} />)
    expect(screen.getByText('Open PRs (1)')).toBeTruthy()
    expect(screen.getByText('Add retry logic')).toBeTruthy()
    expect(screen.queryByText("Not Alice's PR")).toBeNull()
  })

  it('shows empty states when there is no active work or PRs', () => {
    render(<PersonSummary dev={dev} workItems={[]} prs={[]} />)
    expect(screen.getByText('No active work items.')).toBeTruthy()
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run the new test file**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full desktop suite to confirm no regression**

Run (from `apps/desktop/`): `npx vitest run`
Expected: PASS, 34 files (33 existing + 1 new), 248 tests (245 existing + 3 new)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/person-summary.jsx apps/desktop/src/person-summary.test.jsx apps/desktop/src/main.jsx
git commit -m "refactor(desktop): extract PersonSummary into its own file"
```

---

### Task 2: `TeamView` event bridge for notes/1:1 actions

**Files:**
- Modify: `packages/ui/src/views/view-team.jsx`
- Test: `packages/ui/tests/team-notes.test.jsx`

**Interfaces:**
- Consumes: none new (uses `NoteModal`, `ScheduleOneOnOneModal`, `setNoteTarget`, `setScheduleTarget`, `deleteNote`, `persistNotes`, all already defined in this file).
- Produces: `TeamView` now reacts to three `window` `CustomEvent`s (payload shapes are the contract later tasks rely on):
  - `nexusmd:team-add-note` — `detail: { id, name }` → opens the add-note modal for that person.
  - `nexusmd:team-schedule-1on1` — `detail: { id, name }` → opens the schedule-1:1 modal for that person.
  - `nexusmd:team-delete-note` — `detail: { noteId }` → deletes that note.
  - Also *dispatches* `nexusmd:team-notes-changed` (`detail`: the new notes array) every time notes are persisted (add or delete), for other components to observe.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/tests/team-notes.test.jsx` (keep the existing `memStorage`/`TEAM`/`renderTeam`/existing two tests as-is for this task — they'll be touched in Task 6):

```jsx
it('opens the add-note modal when nexusmd:team-add-note fires', async () => {
  const storage = memStorage()
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-add-note', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Add note — Alice Ng')).toBeTruthy()

  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'From the drawer' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ devId: 'alice', note: 'From the drawer' })
  })
})

it('opens the schedule-1:1 modal when nexusmd:team-schedule-1on1 fires', () => {
  const storage = memStorage()
  const { getByText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-schedule-1on1', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Schedule 1:1 — Alice Ng')).toBeTruthy()
})

it('deletes a note when nexusmd:team-delete-note fires', async () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-delete-note', { detail: { noteId: 'tn1' } }))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(0)
  })
})

it('broadcasts nexusmd:team-notes-changed after adding a note', async () => {
  const storage = memStorage()
  const onChanged = vi.fn()
  window.addEventListener('nexusmd:team-notes-changed', onChanged)
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent.click(getByText('Note'))
  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'Pairing' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  window.removeEventListener('nexusmd:team-notes-changed', onChanged)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/ui/`): `npx vitest run tests/team-notes.test.jsx`
Expected: FAIL — the add-note/schedule modals never open and no `nexusmd:team-notes-changed` event fires, because `TeamView` doesn't listen for these events yet.

- [ ] **Step 3: Implement the event bridge in `TeamView`**

In `packages/ui/src/views/view-team.jsx`, modify `persistNotes` to also dispatch the "changed" event:

```js
const persistNotes = (next) => {
  setTeamNotes(next)
  const s = JSON.stringify(next)
  storage.setItem('nexusmd.team.notes', s)
  pushPref?.('nexusmd.team.notes', s)
  window.dispatchEvent(new CustomEvent('nexusmd:team-notes-changed', { detail: next }))
}
```

Add a new effect right after the `notesFor` function definition (still inside `TeamView`, before the `removeAzureMember` function):

```js
React.useEffect(() => {
  const onAddNoteEvent = (e) => setNoteTarget(e.detail)
  const onScheduleEvent = (e) => setScheduleTarget(e.detail)
  const onDeleteNoteEvent = (e) => deleteNote(e.detail.noteId)
  window.addEventListener('nexusmd:team-add-note', onAddNoteEvent)
  window.addEventListener('nexusmd:team-schedule-1on1', onScheduleEvent)
  window.addEventListener('nexusmd:team-delete-note', onDeleteNoteEvent)
  return () => {
    window.removeEventListener('nexusmd:team-add-note', onAddNoteEvent)
    window.removeEventListener('nexusmd:team-schedule-1on1', onScheduleEvent)
    window.removeEventListener('nexusmd:team-delete-note', onDeleteNoteEvent)
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [teamNotes])
```

(`teamNotes` is a dependency so `deleteNote`'s closure — which reads `teamNotes` — is never stale; the existing membership-sync effect a little further down already uses this same `eslint-disable-next-line react-hooks/exhaustive-deps` idiom in this file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `packages/ui/`): `npx vitest run tests/team-notes.test.jsx`
Expected: PASS (6 tests: the original 2 + the 4 new ones)

- [ ] **Step 5: Run the full `packages/ui` suite to confirm no regression**

Run (from `packages/ui/`): `npx vitest run`
Expected: PASS, all files green

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/view-team.jsx packages/ui/tests/team-notes.test.jsx
git commit -m "feat(ui): bridge TeamView note/1:1 actions to window events"
```

---

### Task 3: `PersonSummary` — enriched stats, blocked callout, clickable rows

**Files:**
- Modify: `apps/desktop/src/person-summary.jsx`
- Modify: `apps/desktop/src/person-summary.test.jsx`
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: the enriched `dev` shape from `enrichTeamMember` — `dev.active` (array of `{ id, type, title, ... }`), `dev.blocked` (same shape), `dev.myPRs` (array of `{ id, title, ... }`), `dev.points` (number). All already produced by `packages/core/src/modules/team/index.js` and already flowing through `onOpenPerson(dev)` from `DevCard`.
- Produces: `PersonSummary({ dev, onOpenItem, onOpenPR })` — note the signature change from Task 1 (`workItems`/`prs` props are gone). `onOpenItem(workItem)` and `onOpenPR(pr)` are called when a row is clicked. `DesktopDetailDrawer` now requires `onOpenItem`/`onOpenPR` props.

- [ ] **Step 1: Write the failing tests (replacing Task 1's test file content)**

```jsx
// apps/desktop/src/person-summary.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NexusDataProvider } from '@nexusmd/ui'
import { PersonSummary } from './person-summary.jsx'

function renderPerson(dev, props = {}) {
  return render(
    <NexusDataProvider value={{}}>
      <PersonSummary dev={dev} onOpenItem={() => {}} onOpenPR={() => {}} {...props} />
    </NexusDataProvider>
  )
}

describe('PersonSummary', () => {
  afterEach(cleanup)

  const baseDev = {
    id: 'alice', name: 'Alice Ng', role: 'Dev', tz: 'UTC', focus: 'Onboarding',
    active: [{ id: 1, type: 'bug', title: 'Fix login redirect' }],
    blocked: [],
    myPRs: [{ id: 10, title: 'Add retry logic' }],
    points: 8,
  }

  it('renders identity info and the stats strip from the enriched dev object', () => {
    renderPerson(baseDev)
    expect(screen.getByText('Alice Ng')).toBeTruthy()
    expect(screen.getByText('Active work (1)')).toBeTruthy()
    expect(screen.getByText('Open PRs (1)')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('lists active work items and calls onOpenItem when a row is clicked', () => {
    const onOpenItem = vi.fn()
    renderPerson(baseDev, { onOpenItem })
    fireEvent.click(screen.getByText('Fix login redirect'))
    expect(onOpenItem).toHaveBeenCalledWith(baseDev.active[0])
  })

  it('lists open PRs and calls onOpenPR when a row is clicked', () => {
    const onOpenPR = vi.fn()
    renderPerson(baseDev, { onOpenPR })
    fireEvent.click(screen.getByText('Add retry logic'))
    expect(onOpenPR).toHaveBeenCalledWith(baseDev.myPRs[0])
  })

  it('shows a blocked-items callout when the person has blockers', () => {
    const dev = { ...baseDev, blocked: [{ id: 2, title: 'Waiting on infra' }] }
    renderPerson(dev)
    expect(screen.getByText('1 blocker')).toBeTruthy()
    expect(screen.getByText('· Waiting on infra')).toBeTruthy()
  })

  it('shows no blocked callout when there are no blockers', () => {
    renderPerson(baseDev)
    expect(screen.queryByText(/blocker/)).toBeNull()
  })

  it('shows empty states when there is no active work or open PRs', () => {
    renderPerson({ ...baseDev, active: [], myPRs: [] })
    expect(screen.getByText('No active work items.')).toBeTruthy()
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: FAIL — `PersonSummary` still expects `workItems`/`prs` props and doesn't render a stats strip, blocked callout, or clickable rows.

- [ ] **Step 3: Rewrite `PersonSummary`**

```jsx
// apps/desktop/src/person-summary.jsx
import React from 'react'
import { Icon, TypeIcon, Avatar } from '@nexusmd/ui'

export function PersonSummary({ dev, onOpenItem, onOpenPR }) {
  return (
    <div>
      <div className="drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{dev.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{dev.role}{dev.tz ? ` · ${dev.tz}` : ''}</div>
          {dev.focus && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{dev.focus}</div>}
        </div>
      </div>

      <div className="drawer-section">
        <div className="dev-card-stats">
          <div className="dev-stat">
            <div className="dev-stat-label">Active</div>
            <div className="dev-stat-value">{dev.active.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Open PRs</div>
            <div className="dev-stat-value">{dev.myPRs.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Sprint pts</div>
            <div className="dev-stat-value">{dev.points}</div>
          </div>
        </div>
      </div>

      {dev.blocked.length > 0 && (
        <div className="drawer-section" style={{
          background: 'var(--danger-soft)', color: 'var(--danger)', padding: '6px 10px', borderRadius: 6,
          fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="alert" size={12}/>
          <span style={{ fontWeight: 500 }}>{dev.blocked.length} blocker{dev.blocked.length !== 1 ? 's' : ''}</span>
          <span className="truncate" style={{ opacity: 0.8 }}>· {dev.blocked[0].title}</span>
        </div>
      )}

      <div className="drawer-section">
        <h4>Active work ({dev.active.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.active.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No active work items.</div>}
          {dev.active.map(w => (
            <div key={w.id} onClick={() => onOpenItem(w)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <TypeIcon type={w.type}/><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{w.id}</span>
              <span>{w.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Open PRs ({dev.myPRs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.myPRs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No open pull requests.</div>}
          {dev.myPRs.map(p => (
            <div key={p.id} onClick={() => onOpenPR(p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{p.id}</span>
              <span>{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `DesktopDetailDrawer` and `App` in `main.jsx`**

Change `DesktopDetailDrawer`'s signature and drop the now-unused `useNexusData()`/`data` destructure (it existed only to feed `workItems`/`prs` into the old `PersonSummary`):

```js
function DesktopDetailDrawer({ drawer, onClose, setItems, onOpenItem, onOpenPR }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data
  const http = React.useMemo(() => createAdoHttpAdapter(), [])

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : kind === 'person' ? d.name : ''
```

(Delete the `const { data } = useNexusData()` line entirely — nothing else in this function used it.)

Change the drawer body's `person` line:

```jsx
{kind === 'person' && d && <PersonSummary dev={d} onOpenItem={onOpenItem} onOpenPR={onOpenPR} />}
```

Update the call site (search for `<DesktopDetailDrawer` — it's near the end of `App`'s JSX):

```jsx
<DesktopDetailDrawer drawer={drawer} onClose={() => setDrawer(null)} setItems={setItemsResolved}
  onOpenItem={openItem} onOpenPR={openPR} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full desktop suite**

Run (from `apps/desktop/`): `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/person-summary.jsx apps/desktop/src/person-summary.test.jsx apps/desktop/src/main.jsx
git commit -m "feat(desktop): drive person drawer from enriched dev stats, clickable rows"
```

---

### Task 4: Notes section in the drawer

**Files:**
- Modify: `apps/desktop/src/person-summary.jsx`
- Modify: `apps/desktop/src/person-summary.test.jsx`

**Interfaces:**
- Consumes: `storage` from `useNexusData()` (`@nexusmd/ui`) — same `nexusmd.team.notes` key `TeamView` reads/writes (see Task 2's `Global Constraints` note on this key not being profile-scoped). Listens for `nexusmd:team-notes-changed` (produced by Task 2). Dispatches `nexusmd:team-delete-note` (`detail: { noteId }`, consumed by Task 2's `TeamView` listener).
- Produces: no new props — `PersonSummary`'s signature is unchanged (`{ dev, onOpenItem, onOpenPR }`); it now also calls `useNexusData()` internally.

- [ ] **Step 1: Write the failing tests (rewriting the test file's helper + adding a new describe block)**

```jsx
// apps/desktop/src/person-summary.test.jsx
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NexusDataProvider } from '@nexusmd/ui'
import { PersonSummary } from './person-summary.jsx'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

function renderPerson(dev, { storage = memStorage(), ...props } = {}) {
  return render(
    <NexusDataProvider value={{ storage }}>
      <PersonSummary dev={dev} onOpenItem={() => {}} onOpenPR={() => {}} {...props} />
    </NexusDataProvider>
  )
}

describe('PersonSummary', () => {
  afterEach(cleanup)

  const baseDev = {
    id: 'alice', name: 'Alice Ng', role: 'Dev', tz: 'UTC', focus: 'Onboarding',
    active: [{ id: 1, type: 'bug', title: 'Fix login redirect' }],
    blocked: [],
    myPRs: [{ id: 10, title: 'Add retry logic' }],
    points: 8,
  }

  it('renders identity info and the stats strip from the enriched dev object', () => {
    renderPerson(baseDev)
    expect(screen.getByText('Alice Ng')).toBeTruthy()
    expect(screen.getByText('Active work (1)')).toBeTruthy()
    expect(screen.getByText('Open PRs (1)')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
  })

  it('lists active work items and calls onOpenItem when a row is clicked', () => {
    const onOpenItem = vi.fn()
    renderPerson(baseDev, { onOpenItem })
    fireEvent.click(screen.getByText('Fix login redirect'))
    expect(onOpenItem).toHaveBeenCalledWith(baseDev.active[0])
  })

  it('lists open PRs and calls onOpenPR when a row is clicked', () => {
    const onOpenPR = vi.fn()
    renderPerson(baseDev, { onOpenPR })
    fireEvent.click(screen.getByText('Add retry logic'))
    expect(onOpenPR).toHaveBeenCalledWith(baseDev.myPRs[0])
  })

  it('shows a blocked-items callout when the person has blockers', () => {
    const dev = { ...baseDev, blocked: [{ id: 2, title: 'Waiting on infra' }] }
    renderPerson(dev)
    expect(screen.getByText('1 blocker')).toBeTruthy()
    expect(screen.getByText('· Waiting on infra')).toBeTruthy()
  })

  it('shows no blocked callout when there are no blockers', () => {
    renderPerson(baseDev)
    expect(screen.queryByText(/blocker/)).toBeNull()
  })

  it('shows empty states when there is no active work or open PRs', () => {
    renderPerson({ ...baseDev, active: [], myPRs: [] })
    expect(screen.getByText('No active work items.')).toBeTruthy()
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })

  it('renders existing notes for this person from storage', () => {
    const storage = memStorage({
      'nexusmd.team.notes': JSON.stringify([
        { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
        { id: 'tn2', devId: 'bob', person: 'Bob', note: 'Not for Alice', date: '2026-07-01T00:00:00Z' },
      ]),
    })
    renderPerson(baseDev, { storage })
    expect(screen.getByText('Notes (1)')).toBeTruthy()
    expect(screen.getByText('Great work on the API')).toBeTruthy()
    expect(screen.queryByText('Not for Alice')).toBeNull()
  })

  it('shows an empty state when there are no notes', () => {
    renderPerson(baseDev)
    expect(screen.getByText('No notes yet.')).toBeTruthy()
  })

  it('refreshes its notes list when nexusmd:team-notes-changed fires', () => {
    const storage = memStorage()
    renderPerson(baseDev, { storage })
    expect(screen.getByText('No notes yet.')).toBeTruthy()

    storage.setItem('nexusmd.team.notes', JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Added later', date: '2026-07-02T00:00:00Z' },
    ]))
    fireEvent(window, new CustomEvent('nexusmd:team-notes-changed'))

    expect(screen.getByText('Added later')).toBeTruthy()
  })

  it('dispatches nexusmd:team-delete-note with the note id when delete is clicked', () => {
    const storage = memStorage({
      'nexusmd.team.notes': JSON.stringify([
        { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
      ]),
    })
    renderPerson(baseDev, { storage })
    const onDelete = vi.fn()
    window.addEventListener('nexusmd:team-delete-note', onDelete)

    fireEvent.click(screen.getByTitle('Delete note'))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0][0].detail).toEqual({ noteId: 'tn1' })
    window.removeEventListener('nexusmd:team-delete-note', onDelete)
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: the 6 tests carried over from Task 3 still PASS; the 4 new notes tests FAIL (no "Notes" section exists yet).

- [ ] **Step 3: Add the notes section to `PersonSummary`**

```jsx
// apps/desktop/src/person-summary.jsx
import React from 'react'
import { Icon, TypeIcon, Avatar, useNexusData } from '@nexusmd/ui'

function readTeamNotes(storage, devId) {
  let all = []
  try { all = JSON.parse(storage.getItem('nexusmd.team.notes') || '[]') } catch { all = [] }
  return all.filter(n => n.devId === devId)
}

function formatNoteDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PersonSummary({ dev, onOpenItem, onOpenPR }) {
  const { storage } = useNexusData()
  const [notes, setNotes] = React.useState(() => readTeamNotes(storage, dev.id))

  React.useEffect(() => {
    setNotes(readTeamNotes(storage, dev.id))
    const onChanged = () => setNotes(readTeamNotes(storage, dev.id))
    window.addEventListener('nexusmd:team-notes-changed', onChanged)
    return () => window.removeEventListener('nexusmd:team-notes-changed', onChanged)
  }, [storage, dev.id])

  const deleteNote = (noteId) => {
    window.dispatchEvent(new CustomEvent('nexusmd:team-delete-note', { detail: { noteId } }))
  }

  return (
    <div>
      <div className="drawer-section" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{dev.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{dev.role}{dev.tz ? ` · ${dev.tz}` : ''}</div>
          {dev.focus && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>{dev.focus}</div>}
        </div>
      </div>

      <div className="drawer-section">
        <div className="dev-card-stats">
          <div className="dev-stat">
            <div className="dev-stat-label">Active</div>
            <div className="dev-stat-value">{dev.active.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Open PRs</div>
            <div className="dev-stat-value">{dev.myPRs.length}</div>
          </div>
          <div className="dev-stat">
            <div className="dev-stat-label">Sprint pts</div>
            <div className="dev-stat-value">{dev.points}</div>
          </div>
        </div>
      </div>

      {dev.blocked.length > 0 && (
        <div className="drawer-section" style={{
          background: 'var(--danger-soft)', color: 'var(--danger)', padding: '6px 10px', borderRadius: 6,
          fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="alert" size={12}/>
          <span style={{ fontWeight: 500 }}>{dev.blocked.length} blocker{dev.blocked.length !== 1 ? 's' : ''}</span>
          <span className="truncate" style={{ opacity: 0.8 }}>· {dev.blocked[0].title}</span>
        </div>
      )}

      <div className="drawer-section">
        <h4>Active work ({dev.active.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.active.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No active work items.</div>}
          {dev.active.map(w => (
            <div key={w.id} onClick={() => onOpenItem(w)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <TypeIcon type={w.type}/><span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{w.id}</span>
              <span>{w.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Open PRs ({dev.myPRs.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dev.myPRs.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No open pull requests.</div>}
          {dev.myPRs.map(p => (
            <div key={p.id} onClick={() => onOpenPR(p)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: 11.5 }}>#{p.id}</span>
              <span>{p.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <h4>Notes ({notes.length})</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No notes yet.</div>}
          {notes.map(n => (
            <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.note}</span>
              <span className="muted" style={{ fontSize: 10.5, flexShrink: 0, marginTop: 1 }}>{formatNoteDate(n.date)}</span>
              <button className="btn icon ghost sm" title="Delete note" style={{ height: 18, padding: 0, flexShrink: 0 }}
                onClick={() => deleteNote(n.id)}>
                <Icon name="trash" size={11}/>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: PASS (10 tests)

- [ ] **Step 5: Run the full desktop suite**

Run (from `apps/desktop/`): `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/person-summary.jsx apps/desktop/src/person-summary.test.jsx
git commit -m "feat(desktop): show and manage this person's notes in the profile drawer"
```

---

### Task 5: Quick actions (Schedule 1:1 / Add note) in the drawer's action bar

**Files:**
- Modify: `apps/desktop/src/person-summary.jsx`
- Modify: `apps/desktop/src/person-summary.test.jsx`
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Produces: `PersonActions({ dev })` — a new named export from `person-summary.jsx`. `dev` only needs `{ id, name }`. Dispatches `nexusmd:team-schedule-1on1` / `nexusmd:team-add-note` (both consumed by Task 2's `TeamView` listeners).

- [ ] **Step 1: Write the failing tests (append a new describe block)**

```jsx
// apps/desktop/src/person-summary.test.jsx — add these imports/describe alongside the existing ones
import { PersonActions } from './person-summary.jsx'

describe('PersonActions', () => {
  afterEach(cleanup)
  const dev = { id: 'alice', name: 'Alice Ng' }

  it('dispatches nexusmd:team-schedule-1on1 with the person id/name when Schedule 1:1 is clicked', () => {
    render(<PersonActions dev={dev} />)
    const onSchedule = vi.fn()
    window.addEventListener('nexusmd:team-schedule-1on1', onSchedule)

    fireEvent.click(screen.getByText('Schedule 1:1'))

    expect(onSchedule.mock.calls[0][0].detail).toEqual({ id: 'alice', name: 'Alice Ng' })
    window.removeEventListener('nexusmd:team-schedule-1on1', onSchedule)
  })

  it('dispatches nexusmd:team-add-note with the person id/name when Add note is clicked', () => {
    render(<PersonActions dev={dev} />)
    const onAdd = vi.fn()
    window.addEventListener('nexusmd:team-add-note', onAdd)

    fireEvent.click(screen.getByText('Add note'))

    expect(onAdd.mock.calls[0][0].detail).toEqual({ id: 'alice', name: 'Alice Ng' })
    window.removeEventListener('nexusmd:team-add-note', onAdd)
  })
})
```

(The existing `import { NexusDataProvider } from '@nexusmd/ui'` and `import { PersonSummary } from './person-summary.jsx'` lines stay — just add the `PersonActions` import next to the latter.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: FAIL — `PersonActions` doesn't exist yet (import error / undefined component).

- [ ] **Step 3: Add `PersonActions` to `person-summary.jsx`**

Append this export to the bottom of `apps/desktop/src/person-summary.jsx` (after the closing brace of `PersonSummary`):

```jsx
export function PersonActions({ dev }) {
  const scheduleOneOnOne = () => window.dispatchEvent(
    new CustomEvent('nexusmd:team-schedule-1on1', { detail: { id: dev.id, name: dev.name } })
  )
  const addNote = () => window.dispatchEvent(
    new CustomEvent('nexusmd:team-add-note', { detail: { id: dev.id, name: dev.name } })
  )
  return (
    <React.Fragment>
      <button className="btn sm ghost" onClick={scheduleOneOnOne}><Icon name="clock" size={12}/> Schedule 1:1</button>
      <button className="btn sm ghost" onClick={addNote}><Icon name="message" size={12}/> Add note</button>
    </React.Fragment>
  )
}
```

- [ ] **Step 4: Wire `PersonActions` into `DesktopDetailDrawer`'s action bar in `main.jsx`**

Update the import:

```js
import { PersonSummary, PersonActions } from './person-summary.jsx'
```

Update the `actions={...}` block inside `DesktopDetailDrawer`:

```jsx
actions={(
  <React.Fragment>
    {kind === 'wi' && d && (
      <button className="btn sm" onClick={markDone}>
        <Icon name="check" size={13}/> Mark done
      </button>
    )}
    {kind === 'person' && d && <PersonActions dev={d} />}
    {adoUrl && (
      <button className="btn sm ghost" onClick={() => window.electronAPI.openLink(adoUrl)}>
        <Icon name="link" size={12}/> Open in {kind === 'wi' ? 'ADO' : 'browser'}
      </button>
    )}
  </React.Fragment>
)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `apps/desktop/`): `npx vitest run src/person-summary.test.jsx`
Expected: PASS (12 tests)

- [ ] **Step 6: Run the full desktop suite**

Run (from `apps/desktop/`): `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/person-summary.jsx apps/desktop/src/person-summary.test.jsx apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Schedule 1:1 / Add note quick actions to the profile drawer"
```

---

### Task 6: `DevCard` — replace the notes preview with a count line

**Files:**
- Modify: `packages/ui/src/views/view-team.jsx`
- Modify: `packages/ui/tests/team-notes.test.jsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DevCard` no longer accepts an `onDeleteNote` prop (removed — notes are deleted only from the drawer now, via the `nexusmd:team-delete-note` event from Task 2/5). `TeamView` no longer passes `onDeleteNote` to `DevCard`.

- [ ] **Step 1: Write the failing tests (rewrite the two existing card-notes tests, add one new test)**

Replace the entire contents of `packages/ui/tests/team-notes.test.jsx` with:

```jsx
import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, TeamView } from '../src/index.js'

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }
}
const TEAM = [{ id: 'alice', name: 'Alice Ng', initials: 'AN', role: 'Dev', tz: 'UTC', status: 'online', focus: '' }]

function renderTeam(storage, extraProps = {}) {
  const value = { data: { ORG: 'o', TEAM, PROJECTS: [] }, storage, getProfileKey: k => k, pushPref: () => {} }
  return render(
    <NexusDataProvider value={value}>
      <TeamView team={TEAM} workItems={[]} prs={[]} onOpenItem={() => {}} onOpenPerson={() => {}} onTeamChange={() => {}} {...extraProps} />
    </NexusDataProvider>
  )
}

afterEach(cleanup)

it('renders a note count (not the note text) on the member card for persisted notes', () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  const { getByText, queryByText } = renderTeam(storage)
  expect(getByText('1 note')).toBeTruthy()
  expect(queryByText('Great work on the API')).toBeNull()
})

it('opens the profile drawer when the note count is clicked', () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  const onOpenPerson = vi.fn()
  const { getByText } = renderTeam(storage, { onOpenPerson })

  fireEvent.click(getByText('1 note'))

  expect(onOpenPerson).toHaveBeenCalledWith(expect.objectContaining({ id: 'alice' }))
})

it('adds a note that persists to storage and shows a note count on the card', async () => {
  const storage = memStorage()
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent.click(getByText('Note'))
  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'Pairing on the migration' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => expect(getByText('1 note')).toBeTruthy())
  const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ devId: 'alice', person: 'Alice Ng', note: 'Pairing on the migration' })
})

it('opens the add-note modal when nexusmd:team-add-note fires', async () => {
  const storage = memStorage()
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-add-note', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Add note — Alice Ng')).toBeTruthy()

  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'From the drawer' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ devId: 'alice', note: 'From the drawer' })
  })
})

it('opens the schedule-1:1 modal when nexusmd:team-schedule-1on1 fires', () => {
  const storage = memStorage()
  const { getByText } = renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-schedule-1on1', { detail: { id: 'alice', name: 'Alice Ng' } }))
  expect(getByText('Schedule 1:1 — Alice Ng')).toBeTruthy()
})

it('deletes a note when nexusmd:team-delete-note fires', async () => {
  const storage = memStorage({
    'nexusmd.team.notes': JSON.stringify([
      { id: 'tn1', devId: 'alice', person: 'Alice Ng', note: 'Great work on the API', date: '2026-07-01T00:00:00Z' },
    ]),
  })
  renderTeam(storage)

  fireEvent(window, new CustomEvent('nexusmd:team-delete-note', { detail: { noteId: 'tn1' } }))

  await waitFor(() => {
    const saved = JSON.parse(storage.getItem('nexusmd.team.notes'))
    expect(saved).toHaveLength(0)
  })
})

it('broadcasts nexusmd:team-notes-changed after adding a note', async () => {
  const storage = memStorage()
  const onChanged = vi.fn()
  window.addEventListener('nexusmd:team-notes-changed', onChanged)
  const { getByText, getByPlaceholderText } = renderTeam(storage)

  fireEvent.click(getByText('Note'))
  fireEvent.change(getByPlaceholderText('Write a note about this team member…'), { target: { value: 'Pairing' } })
  fireEvent.click(getByText('Save note'))

  await waitFor(() => expect(onChanged).toHaveBeenCalled())
  window.removeEventListener('nexusmd:team-notes-changed', onChanged)
})
```

(This merges Task 2's four tests back in — verbatim — alongside the two rewritten card tests and one new one, since this task rewrites the whole file.)

- [ ] **Step 2: Run the tests to verify the rewritten ones fail**

Run (from `packages/ui/`): `npx vitest run tests/team-notes.test.jsx`
Expected: the two rewritten tests and the new "opens the profile drawer" test FAIL (`getByText('1 note')` doesn't exist yet — the card still renders the full note list); the four bridge tests carried over from Task 2 still PASS.

- [ ] **Step 3: Replace `DevCard`'s notes-preview block with a count line**

In `packages/ui/src/views/view-team.jsx`, change the `DevCard` signature to drop `onDeleteNote`:

```js
function DevCard({ dev, onOpenItem, onOpenPerson, onRemove, onDelete, onAddNote, onScheduleOneOnOne, notes = [] }) {
```

Replace the entire notes-preview block (the `{notes.length > 0 && (...)}` section that currently renders up to 3 notes with delete buttons and a "+N more" line) with:

```jsx
{notes.length > 0 && (
  <div className="dev-card-notes-count"
    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2, cursor: 'pointer' }}
    onClick={e => { e.stopPropagation(); onOpenPerson(dev) }}>
    <Icon name="message" size={11}/>
    <span>{notes.length} note{notes.length !== 1 ? 's' : ''}</span>
  </div>
)}
```

- [ ] **Step 4: Remove the now-unused `onDeleteNote` prop pass-through in `TeamView`**

At the `<DevCard .../>` call site inside `TeamView`, remove the `onDeleteNote={deleteNote}` line:

```jsx
<DevCard key={t.id} dev={t} onOpenItem={onOpenItem} onOpenPerson={onOpenPerson}
  onRemove={t.isCustom ? null : removeAzureMember}
  onDelete={t.isCustom ? removeCustomMember : null}
  notes={notesFor(t.id)}
  onAddNote={() => setNoteTarget(t)}
  onScheduleOneOnOne={onScheduleOneOnOne ? () => setScheduleTarget(t) : null}
/>
```

(`deleteNote` itself stays in `TeamView` — Task 2's `nexusmd:team-delete-note` listener still calls it.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `packages/ui/`): `npx vitest run tests/team-notes.test.jsx`
Expected: PASS (8 tests)

- [ ] **Step 6: Run the full `packages/ui` suite**

Run (from `packages/ui/`): `npx vitest run`
Expected: PASS, all files green

- [ ] **Step 7: Run the full `apps/desktop` suite one more time (DevCard is shared, but this confirms nothing desktop-side broke)**

Run (from `apps/desktop/`): `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/views/view-team.jsx packages/ui/tests/team-notes.test.jsx
git commit -m "feat(ui): replace DevCard's inline notes preview with a count that opens the profile drawer"
```

---

## Final verification

After Task 6, do one more full pass across both packages:

```bash
cd packages/ui && npx vitest run
cd ../../apps/desktop && npx vitest run
```

Both should report all tests passing. As noted in the design spec, driving the actual Electron window in this sandbox is environment-blocked (see `apps/desktop/.claude/skills/verify/SKILL.md`) — this test coverage plus the prior Playwright smoke script (once run in a normal desktop environment) are the available verification surfaces.
