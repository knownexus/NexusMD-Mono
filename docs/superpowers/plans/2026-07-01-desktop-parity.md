# Desktop Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Electron desktop app to full feature parity with the web app across seven workstreams.

**Architecture:** All changes land in `apps/desktop/src/main.jsx` (primary shell) and a new `apps/desktop/src/view-calendar.jsx`; one line is removed from `packages/ui/src/index.js`. The shared `@nexusmd/ui` package is not modified beyond dead-export removal. Each task is independently verifiable by running the Electron app.

**Tech Stack:** React 18, Electron (via `window.electronAPI`), `@nexusmd/ui` shared component library, `@nexusmd/core` data layer, `@nexusmd/web-adapters`.

## Global Constraints

- Never modify web app files (`apps/web/`) or the mobile app (`apps/app/`)
- All localStorage keys must use `getProfileKey(key)` for profile-scoped data; use bare keys only for app-wide prefs (e.g. `nexusmd.tweaks`, `nexusmd.outputPath`)
- Import all shared components from `@nexusmd/ui` — never deep-import from `@nexusmd/ui/src/`
- `window.electronAPI` may be absent in dev browser preview — guard all IPC calls with `window.electronAPI?.method?.()`
- No new npm dependencies; all required components are already in `@nexusmd/ui`
- Run `npm run build` (or the desktop Vite build) after each task to catch import errors before committing

---

## Task Ownership

> **Coordination:** Two instances are working this plan simultaneously. Claim a task by replacing `—` with your instance name before starting. Do not start a task someone else has claimed.

| Task | Description | Owner | Status |
|------|-------------|-------|--------|
| 1 | Dead export cleanup | Instance A | |
| 2 | TweaksPanel + density/sidebar/typeLabels | Instance A | |
| 3 | Prop-wiring fixes (newItemIds, onCreate, DashboardView) | Instance A | |
| 3a | Nav sidebar change badges | Instance A | |
| 4 | Detail Drawer | Instance B | |
| 5 | Missing settings tabs (Profile, Planner, Confidential, Desktop app) | Instance B | |
| 5a | Wire planner prefs into PlannerView | Instance B | |
| 6 | Calendar view (Outlook) | Instance B | |
| 7 | Team mutations + quick links | Instance B | |
| 8 | Expand CreateWorkItemModal to full form | Instance A | |
| 9 | Auto-refresh countdown + pause | Instance A | |
| 10 | Data & sync settings card + configurable refresh interval | Instance A | |
| 11 | Keyboard shortcuts (1–9) | Instance A | |
| 12 | Project Areas modal | Instance A | |
| 13 | Token expiry banner (GitHub) | Instance A | |
| 14 | GitHub PAT + repo browser | Instance A | |
| 15 | Sidebar resize handle | Instance A | |

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/ui/src/index.js` | Modify | Remove 3 dead exports |
| `apps/desktop/src/main.jsx` | Modify | All shell changes (Tasks 2–15) |
| `apps/desktop/src/view-calendar.jsx` | Create | Desktop CalendarView orchestrator |

---

### Task 1: Dead export cleanup

**Files:**
- Modify: `packages/ui/src/index.js:61-62,77`

**Interfaces:**
- Produces: nothing (removal only)

- [ ] **Step 1: Remove `OutlookSetupModal` and `DayColumn` from the calendar export**

In `packages/ui/src/index.js`, change line 61-62 from:
```js
  MicrosoftLogo, EventDetailModal, OutlookSetupModal, OutlookBanner,
  DayColumn, WeekGrid, MonthView, YearView, AgendaView,
```
to:
```js
  MicrosoftLogo, EventDetailModal, OutlookBanner,
  WeekGrid, MonthView, YearView, AgendaView,
```

- [ ] **Step 2: Remove `RawFieldsInspector` from the work-item detail export**

Change line 77 from:
```js
export { WorkItemDetail, RawFieldsInspector } from './views/work-item-detail.jsx'
```
to:
```js
export { WorkItemDetail } from './views/work-item-detail.jsx'
```

- [ ] **Step 3: Verify build passes**

```bash
cd packages/ui && npm run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/index.js
git commit -m "chore(ui): remove dead exports — RawFieldsInspector, OutlookSetupModal, DayColumn"
```

---

### Task 2: TweaksPanel + tweak application

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton` from `@nexusmd/ui`
- Produces: `tweaks` state extended with `density`, `sidebar`, `typeLabels`, `widgetOrder`; root div gains `data-density` / `data-sidebar` attributes; `window.nexusMDTypeLabels` set at render time

- [ ] **Step 1: Expand the `@nexusmd/ui` import**

Find the existing import block (around line 8) and add the five new names:
```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, PlToggle,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
} from '@nexusmd/ui'
```

- [ ] **Step 2: Expand `DEFAULT_TWEAKS`**

Replace the current `DEFAULT_TWEAKS` constant with:
```js
const DEFAULT_TWEAKS = {
  theme: 'light', lightTheme: 'parchment', darkTheme: 'cobalt',
  density: 'balanced', sidebar: 'labels', typeLabels: false,
  widgetOrder: DASH_WIDGET_ORDER,
}
```

`DASH_WIDGET_ORDER` is defined a few lines above `DEFAULT_TWEAKS` — no change needed there.

- [ ] **Step 3: Add `window.nexusMDTypeLabels` to `App`**

Inside the `App` function body, immediately after the `tweaks` / `setTweak` declarations, add:
```js
window.nexusMDTypeLabels = tweaks.typeLabels || false
```

- [ ] **Step 4: Add `data-density` and `data-sidebar` to root div**

Find the root `<div>` inside `App`'s return (currently `<div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>`) and add the two data attributes:
```jsx
<div data-density={tweaks.density} data-sidebar={tweaks.sidebar}
  style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
```

- [ ] **Step 5: Remove `widgetOrder` from `ViewBody` and source it from `tweaks` instead**

In `ViewBody`, delete:
```js
const [widgetOrder, setWidgetOrder] = usePersistedState('nexusmd.dash.widgetOrder', DASH_WIDGET_ORDER)
```

Add `widgetOrder` and `setWidgetOrder` to the `ViewBody` props signature and update the DashboardView call (wiring done in Task 3). For now just remove the `usePersistedState` line and leave the prop destructuring gap — Task 3 fills it.

Actually: to keep Task 2 self-contained, change `ViewBody`'s signature to accept the props and pass default values for now:
```js
function ViewBody({ view, onOpenItem, onOpenPR, tweaks = DEFAULT_TWEAKS, setTweak = () => {}, plannerData = {}, setPlannerData = () => {}, plannerThemes = {}, setPlannerThemes = () => {} }) {
```

And replace the deleted `widgetOrder` / `setWidgetOrder` usage in the DashboardView call with:
```js
widgetOrder={tweaks.widgetOrder || DASH_WIDGET_ORDER}
setWidgetOrder={arr => setTweak('widgetOrder', arr)}
```

- [ ] **Step 6: Render `TweaksPanel` inside `App`**

Add this as a sibling of `<ToastHost />` (just before `</NexusDataProvider>`):
```jsx
<TweaksPanel title="Display">
  <TweakSection title="Appearance">
    <TweakRadio label="Theme" value={tweaks.theme}
      onChange={v => setTweak('theme', v)}
      options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]}/>
    <TweakRadio label="Density" value={tweaks.density}
      onChange={v => setTweak('density', v)}
      options={[{label:'Compact',value:'compact'},{label:'Balanced',value:'balanced'},{label:'Cozy',value:'cozy'}]}/>
    <TweakRadio label="Sidebar" value={tweaks.sidebar}
      onChange={v => setTweak('sidebar', v)}
      options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
    <TweakToggle label="Show type labels" value={tweaks.typeLabels || false}
      onChange={v => setTweak('typeLabels', v)}/>
  </TweakSection>
  <TweakSection title="Dashboard">
    <TweakButton label="Reset widget order"
      onClick={() => setTweak('widgetOrder', DASH_WIDGET_ORDER)}/>
  </TweakSection>
</TweaksPanel>
```

- [ ] **Step 7: Pass `tweaks` and `setTweak` to `ViewBody`**

In `App`'s JSX, update `<ViewBody>`:
```jsx
<ViewBody
  view={view}
  onOpenItem={openItem}
  onOpenPR={openPR}
  tweaks={tweaks}
  setTweak={setTweak}
  plannerData={plannerData}
  setPlannerData={setPlannerData}
  plannerThemes={plannerThemes}
  setPlannerThemes={setPlannerThemes}
/>
```

(`openItem`/`openPR`/`plannerData` etc. are introduced in later tasks — for now keep the existing `setOpenedItem`/`setOpenedPR` names and add the others when needed.)

- [ ] **Step 8: Verify in app**

Run the desktop app. Open the tweaks panel (the gear/display button). Confirm density, sidebar, theme, and type-label controls appear. Switch density to Compact — rows should compress. Switch sidebar to Icons — labels should hide.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): add TweaksPanel and apply density/sidebar/typeLabels tweaks"
```

---

### Task 3: Prop-wiring fixes

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `tweaks.density`, `tweaks.widgetOrder` from Task 2; `acknowledgedBuilds`, `acknowledgedTests` already in `ViewBody`
- Produces: `DashboardView` receives `density`, `team`, `acknowledgedSet`, `needsMeCriteria`, `setPlannerData`; `WorkItemsView` receives working `onCreate` and `team`; all four data views receive `newItemIds`

- [ ] **Step 1: Lift `plannerData` and `plannerThemes` to `App`**

In `App`, add after the `tweaks` state:
```js
const [plannerData, setPlannerData] = React.useState({})
const [plannerThemes, setPlannerThemes] = React.useState({})
```

Remove them from `ViewBody` (they were `React.useState({})` there). `ViewBody` now receives them as props (signature already updated in Task 2).

- [ ] **Step 2: Track `newItemIds` in `App`**

Add below the plannerData state:
```js
const prevSnapshotIdsRef = React.useRef(null)
const [newItemIds, setNewItemIds] = React.useState({
  work: new Set(), pr: new Set(), builds: new Set(), tests: new Set(),
})
```

Add a `useEffect` that runs whenever `snapshot` changes (put `snapshot` in the deps; it comes from `useNexusSnapshot()` already called in `App`):
```js
React.useEffect(() => {
  const toIds = arr => new Set((arr || []).map(i => i.id))
  const cur = {
    work:   toIds(snapshot.WORK_ITEMS),
    pr:     toIds(snapshot.PRS),
    builds: toIds(snapshot.BUILDS),
    tests:  toIds(snapshot.TESTS),
  }
  if (prevSnapshotIdsRef.current === null) {
    prevSnapshotIdsRef.current = cur
    return
  }
  const prev = prevSnapshotIdsRef.current
  setNewItemIds(n => ({
    work:   new Set([...n.work,   ...[...cur.work].filter(id => !prev.work.has(id))]),
    pr:     new Set([...n.pr,     ...[...cur.pr].filter(id => !prev.pr.has(id))]),
    builds: new Set([...n.builds, ...[...cur.builds].filter(id => !prev.builds.has(id))]),
    tests:  new Set([...n.tests,  ...[...cur.tests].filter(id => !prev.tests.has(id))]),
  }))
  prevSnapshotIdsRef.current = cur
}, [snapshot])
```

Add a second `useEffect` that clears badges when the user navigates to a view:
```js
React.useEffect(() => {
  const key = { work: 'work', prs: 'pr', builds: 'builds', tests: 'tests' }[view]
  if (key) setNewItemIds(n => ({ ...n, [key]: new Set() }))
}, [view])
```

- [ ] **Step 3: Pass `newItemIds` and `plannerData` down to `ViewBody`**

Update the `<ViewBody>` call to include:
```jsx
<ViewBody
  view={view}
  onOpenItem={openItem}
  onOpenPR={openPR}
  tweaks={tweaks}
  setTweak={setTweak}
  newItemIds={newItemIds}
  plannerData={plannerData}
  setPlannerData={setPlannerData}
  plannerThemes={plannerThemes}
  setPlannerThemes={setPlannerThemes}
/>
```

Add `newItemIds` to `ViewBody`'s props signature:
```js
function ViewBody({ view, onOpenItem, onOpenPR, tweaks, setTweak, newItemIds = { work: new Set(), pr: new Set(), builds: new Set(), tests: new Set() }, plannerData, setPlannerData, plannerThemes, setPlannerThemes }) {
```

- [ ] **Step 4: Wire `DashboardView` with missing props**

In `ViewBody`'s `'dashboard'` case, build `acknowledgedSet` from the already-tracked acknowledged arrays:
```js
case 'dashboard':
  if (!configured) return <NotConfigured />
  const acknowledgedSet = new Set([...acknowledgedBuilds, ...acknowledgedTests])
  return (
    <DashboardView
      onOpenItem={onOpenItem} onOpenPR={onOpenPR}
      widgetOrder={tweaks.widgetOrder || DASH_WIDGET_ORDER}
      setWidgetOrder={arr => setTweak('widgetOrder', arr)}
      quickLinks={tweaks.quickLinks || []}
      density={tweaks.density}
      team={data.TEAM || []}
      acknowledgedSet={acknowledgedSet}
      needsMeCriteria={needsMeCriteria}
      setPlannerData={setPlannerData}
      widgetWidths={widgetWidths} setWidgetWidths={setWidgetWidths}
      widgetHeights={widgetHeights} setWidgetHeights={setWidgetHeights}
    />
  )
```

- [ ] **Step 5: Wire `WorkItemsView` with `onCreate`, `team`, `setItems`, and `newItemIds`**

Add items state to `ViewBody`:
```js
// inside ViewBody, after existing usePersistedState calls
const [localItems, setLocalItems] = React.useState(null)
const items = localItems ?? (data.WORK_ITEMS || [])
```

Update the `'work'` case:
```jsx
case 'work':
  return (
    <WorkItemsView
      items={items}
      setItems={setLocalItems}
      onOpen={onOpenItem}
      onCreate={() => {
        window.dispatchEvent(new CustomEvent('nexusmd:create-wi', { detail: {} }))
      }}
      team={data.TEAM || []}
      newItemIds={newItemIds.work}
    />
  )
```

- [ ] **Step 6: Pass `newItemIds` to the other three data views**

Update the `'prs'`, `'builds'`, and `'tests'` cases:
```jsx
case 'prs':
  return (
    <PRView prs={data.PRS || []} onOpen={onOpenPR}
      needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
      newItemIds={newItemIds.pr} />
  )
case 'builds':
  return (
    <BuildsView builds={data.BUILDS || []}
      acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
      newItemIds={newItemIds.builds} />
  )
case 'tests':
  return (
    <TestsView tests={data.TESTS || []}
      acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests}
      newItemIds={newItemIds.tests} />
  )
```

- [ ] **Step 7: Verify in app**

Run the app. Load data, then navigate to Work Items — the "+" button should open the CreateWorkItemModal. Navigate away and back after a data refresh — new items should show badges. On the Dashboard, the team widget should populate and the "Needs me" criteria should filter correctly.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): wire missing props — newItemIds badges, onCreate, density, team, acknowledgedSet"
```

---

### Task 4: Detail Drawer

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `Drawer` from `@nexusmd/ui` (added to imports in Task 2); `WorkItemDetail` (already imported); `desktopWorkItemSource` (already defined); `TypeIcon`, `Prio` from `@nexusmd/ui`
- Produces: `DesktopDetailDrawer` component; `ItemDetailModal` and `PRDetailModal` removed; `drawer` state replaces `openedItem`/`openedPR`

- [ ] **Step 1: Add `TypeIcon` and `Prio` to the `@nexusmd/ui` import**

These are already exported from `@nexusmd/ui` (`packages/ui/src/index.js` line 13). Add them:
```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, PlToggle, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
} from '@nexusmd/ui'
```

- [ ] **Step 2: Change `App` state from two modals to a single drawer**

Replace:
```js
const [openedItem, setOpenedItem] = React.useState(null)
const [openedPR, setOpenedPR]     = React.useState(null)
```
with:
```js
const [drawer, setDrawer] = React.useState(null)
const openItem = item => setDrawer({ kind: 'wi', data: item })
const openPR   = pr   => setDrawer({ kind: 'pr', data: pr })
```

- [ ] **Step 3: Update `ViewBody` call to use `openItem`/`openPR`**

```jsx
<ViewBody
  ...
  onOpenItem={openItem}
  onOpenPR={openPR}
  ...
/>
```

- [ ] **Step 4: Add `DesktopPRDetail` component (replaces inline `PRDetailModal` body)**

Add before `DesktopDetailDrawer`:
```jsx
function DesktopPRDetail({ pr }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span className={`pill ${pr.status}`} style={{ textTransform: 'capitalize' }}>{pr.status}</span>
        {pr.draft && <span className="pill">Draft</span>}
        {pr.hasConflicts && <span className="pill danger"><Icon name="alert" size={9}/> Conflicts</span>}
        {pr.ciStatus === 'success' && <span className="pill success">CI passing</span>}
        {pr.ciStatus === 'failed'  && <span className="pill danger">CI failing</span>}
        {pr.ciStatus === 'running' && <span className="pill info">CI running</span>}
        {pr.ciStatus === 'partial' && <span className="pill warning">CI partial</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="git-branch" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{pr.branch}</span>
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          <strong>Author:</strong> {pr.authorName || pr.author}
          {' · '}<strong>Opened:</strong> {pr.age} ago
          {pr.repo && <>{' · '}<strong>Repo:</strong> {pr.repo}</>}
        </div>
        <div>
          <span style={{ color: 'var(--success)', fontWeight: 500 }}>+{pr.additions}</span>
          {' '}
          <span style={{ color: 'var(--danger)', fontWeight: 500 }}>−{pr.deletions}</span>
          {pr.comments > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
              <Icon name="comment" size={11}/> {pr.comments} comment{pr.comments !== 1 ? 's' : ''}
              {pr.unresolvedComments > 0 && ` (${pr.unresolvedComments} unresolved)`}
            </span>
          )}
        </div>
      </div>
      {(pr.reviewerDetails || []).length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Reviewers</div>
          {pr.reviewerDetails.map((r, i) => {
            const v = r.vote
            const label = v === 10 || v === 5 ? 'Approved' : v === -10 ? 'Rejected' : v === -5 ? 'Waiting for author' : 'Pending'
            const color = v === 10 || v === 5 ? 'var(--success)' : v === -10 ? 'var(--danger)' : v === -5 ? 'var(--warning)' : 'var(--text-subtle)'
            return (
              <div key={`${r.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{r.name || r.id}</span>
                <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
              </div>
            )
          })}
        </div>
      )}
      {(pr.linkedWorkItems || []).length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Linked Work Items</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pr.linkedWorkItems.map(wi => (
              <span key={wi.id} className="pill" style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}>#{wi.id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add `DesktopDetailDrawer` component**

Add after `DesktopPRDetail`:
```jsx
function DesktopDetailDrawer({ drawer, onClose, setItems }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' && d?.project && org
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent((d.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${d.id}`
    : kind === 'pr' ? d?.url : null

  const markDone = async () => {
    try {
      await desktopWorkItemSource.saveField(d.id, 'System.State', 'Done')
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: 'Done' } : w))
      toast?.('Marked done', 'success')
      onClose()
    } catch (e) {
      toast?.('Could not update: ' + (e?.message || 'unknown error'), 'error')
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={kind === 'wi' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ) : kind === 'pr' && d ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.open(adoUrl, '_blank', 'noopener')}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? 'ADO' : 'browser'}
            </button>
          )}
        </React.Fragment>
      )}>
      {kind === 'wi' && d && <WorkItemDetail id={d.id} project={d.project} />}
      {kind === 'pr' && d && <DesktopPRDetail pr={d} />}
    </Drawer>
  )
}
```

- [ ] **Step 6: Replace the two old modals with `DesktopDetailDrawer` in `App`'s JSX**

Remove `<ItemDetailModal .../>` and `<PRDetailModal .../>` from `App`'s return. Add:
```jsx
<DesktopDetailDrawer drawer={drawer} onClose={() => setDrawer(null)} />
```

- [ ] **Step 7: Delete the `ItemDetailModal` and `PRDetailModal` function definitions**

Find and delete both function components (they're in `main.jsx`). Their bodies can be identified by `function ItemDetailModal` and `function PRDetailModal`.

- [ ] **Step 8: Verify in app**

Click a work item — the side drawer should slide in with the item title, type icon, priority badge, "Mark done" and "Open in ADO" buttons, and the work item detail panel. Click a PR — drawer should show PR detail. Drawer should close on the × button or Esc.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): replace item/PR modals with side drawer"
```

---

### Task 5: Missing settings tabs

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `VsCard, VsRow, VsFullRow, VsSeg, PlToggle, VsPasswordModal, loadConfidentialConfig, hashPassword` from `@nexusmd/ui`; `getProfileKey` (already imported); `window.electronAPI` (guarded)
- Produces: four new setting cards in `DesktopSettings` — Profile, Planner, Confidential, Desktop

- [ ] **Step 1: Add `loadConfidentialConfig`, `hashPassword` to the `@nexusmd/ui` import**

```js
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  VsProfiles, BackupRestoreCard, CloudSyncCard,
  IntegrationsView, VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, PlToggle, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  VsPasswordModal, loadConfidentialConfig,
} from '@nexusmd/ui'
```

(`hashPassword` is used internally by `VsPasswordModal` — we do not need it directly.)

- [ ] **Step 2: Add `DesktopProfileCard` component**

Add before `DesktopSettings`:
```jsx
function DesktopProfileCard() {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const savePref = (key, val) => { try { localStorage.setItem(pk(key), val) } catch {} }

  const [displayName, setDisplayName] = React.useState(() => readPref('nexusmd.profile.displayName', ''))
  const [role, setRole]               = React.useState(() => readPref('nexusmd.profile.role', 'Engineering Manager'))
  const [team, setTeam]               = React.useState(() => readPref('nexusmd.profile.team', ''))
  const [tz, setTz]                   = React.useState(() => readPref('nexusmd.profile.timeZone', (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } })()))

  const inp = { width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }

  return (
    <VsCard title="Profile" icon="more">
      <VsRow title="Display name" desc="How your name appears in the app">
        <input value={displayName} style={inp}
          onChange={e => { setDisplayName(e.target.value); savePref('nexusmd.profile.displayName', e.target.value) }} />
      </VsRow>
      <VsRow title="Role" desc="Your role or job title">
        <input value={role} style={inp}
          onChange={e => { setRole(e.target.value); savePref('nexusmd.profile.role', e.target.value) }} />
      </VsRow>
      <VsRow title="Team" desc="Your team name">
        <input value={team} style={inp}
          onChange={e => { setTeam(e.target.value); savePref('nexusmd.profile.team', e.target.value) }} />
      </VsRow>
      <VsRow title="Timezone" desc="Used for calendar and scheduling">
        <input value={tz} style={inp}
          onChange={e => { setTz(e.target.value); savePref('nexusmd.profile.timeZone', e.target.value) }} />
      </VsRow>
    </VsCard>
  )
}
```

- [ ] **Step 3: Add `DesktopPlannerPrefsCard` component**

Add after `DesktopProfileCard`:
```jsx
function DesktopPlannerPrefsCard() {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const savePref = (key, val) => { try { localStorage.setItem(pk(key), val) } catch {} }

  const [landing, setLanding] = React.useState(() => readPref('nexusmd.planner.landing', 'glance'))
  const [nav,     setNav]     = React.useState(() => readPref('nexusmd.planner.nav', 'rail'))
  const [entry,   setEntry]   = React.useState(() => readPref('nexusmd.planner.entry', 'inline'))
  const [carry,   setCarry]   = React.useState(() => readPref('nexusmd.planner.carryPrompt', '1'))

  return (
    <VsCard title="Planner" icon="planner">
      <VsRow title="Landing view" desc="First view when opening the Planner">
        <VsSeg value={landing}
          options={[['glance','Glance'],['week','Week'],['month','Month']]}
          onChange={v => { setLanding(v); savePref('nexusmd.planner.landing', v) }} />
      </VsRow>
      <VsRow title="Navigation style" desc="How the planner nav is displayed">
        <VsSeg value={nav}
          options={[['rail','Rail'],['tabs','Tabs']]}
          onChange={v => { setNav(v); savePref('nexusmd.planner.nav', v) }} />
      </VsRow>
      <VsRow title="Entry style" desc="How new planner entries are created">
        <VsSeg value={entry}
          options={[['inline','Inline'],['modal','Modal']]}
          onChange={v => { setEntry(v); savePref('nexusmd.planner.entry', v) }} />
      </VsRow>
      <VsRow title="Carry-over prompt" desc="Prompt to carry unfinished tasks forward each week">
        <PlToggle checked={carry === '1'}
          onChange={v => { const s = v ? '1' : '0'; setCarry(s); savePref('nexusmd.planner.carryPrompt', s) }} />
      </VsRow>
    </VsCard>
  )
}
```

- [ ] **Step 4: Add `DesktopConfidentialCard` component**

Add after `DesktopPlannerPrefsCard`:
```jsx
function DesktopConfidentialCard() {
  const [pwOpen, setPwOpen] = React.useState(false)
  const [autoRelock, setAutoRelock] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.confidential.autoRelock') || '0' } catch { return '0' }
  })
  const cfg = loadConfidentialConfig() || { sections: [], hash: null }
  const lockedCount = (cfg.sections || []).filter(s => s.locked).length

  return (
    <VsCard title="Confidential" icon="lock">
      <VsRow title="Password" desc={cfg.hash ? 'A password is set for confidential sections' : 'No password set — anyone can view confidential rows'}>
        <button className="btn sm ghost" onClick={() => setPwOpen(true)}>
          {cfg.hash ? 'Change password' : 'Set password'}
        </button>
      </VsRow>
      <VsRow title="Auto re-lock" desc="Re-lock confidential sections when the app loses focus">
        <PlToggle checked={autoRelock === '1'} onChange={v => {
          const s = v ? '1' : '0'; setAutoRelock(s)
          try { localStorage.setItem('nexusmd.confidential.autoRelock', s) } catch {}
        }} />
      </VsRow>
      {lockedCount > 0 && (
        <VsRow title="Locked sections" desc={`${lockedCount} section${lockedCount !== 1 ? 's' : ''} currently locked in the planner`}>
          <span className="pill">{lockedCount}</span>
        </VsRow>
      )}
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </VsCard>
  )
}
```

- [ ] **Step 5: Add `DesktopAppCard` component**

Add after `DesktopConfidentialCard`:
```jsx
function DesktopAppCard() {
  if (!window.electronAPI) return null
  const [loginItem, setLoginItem] = React.useState(false)
  const [closeToTray, setCloseToTray] = React.useState(true)
  const [outputPath, setOutputPath] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.outputPath') || '' } catch { return '' }
  })

  React.useEffect(() => {
    window.electronAPI.getLoginItemEnabled?.().then(setLoginItem).catch(() => {})
    window.electronAPI.getCloseToTray?.().then(setCloseToTray).catch(() => {})
  }, [])

  const pickFolder = async () => {
    const picked = await window.electronAPI.pickOutputFolder?.()
    if (!picked) return
    setOutputPath(picked)
    try { localStorage.setItem('nexusmd.outputPath', picked) } catch {}
    toast?.('Output folder updated.', 'success')
  }

  const clearFolder = () => {
    setOutputPath('')
    try { localStorage.removeItem('nexusmd.outputPath') } catch {}
  }

  return (
    <VsCard title="Desktop app" icon="dashboard">
      <VsRow title="Start on login" desc="Launch NexusMD automatically when you log in">
        <PlToggle checked={loginItem} onChange={v => {
          setLoginItem(v)
          window.electronAPI.setLoginItemEnabled?.(v).catch(() => {})
        }} />
      </VsRow>
      <VsRow title="Close to tray" desc="Minimise to the system tray instead of quitting when the window is closed">
        <PlToggle checked={closeToTray} onChange={v => {
          setCloseToTray(v)
          window.electronAPI.setCloseToTray?.(v).catch(() => {})
        }} />
      </VsRow>
      <VsRow title="Output folder" desc={outputPath || 'Default download location'}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={pickFolder}>Change…</button>
          {outputPath && (
            <button className="btn sm ghost danger" onClick={clearFolder}>Clear</button>
          )}
        </div>
      </VsRow>
    </VsCard>
  )
}
```

- [ ] **Step 6: Add the four new cards to `DesktopSettings`**

Update `DesktopSettings` to render them after the Appearance card:
```jsx
function DesktopSettings({ tweaks, setTweak }) {
  const profileApi = useProfile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <VsCard title="Appearance" icon="sun">
        <VsRow title="Mode" desc="Toggle between your assigned light and dark themes">
          <VsSeg value={tweaks.theme}
            options={[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]}
            onChange={v => setTweak('theme', v)} />
        </VsRow>
        <VsFullRow title="Light mode theme" desc="Palette used when light mode is active">
          <ThemeChipPicker value={tweaks.lightTheme || 'parchment'} onChange={v => setTweak('lightTheme', v)} />
        </VsFullRow>
        <VsFullRow title="Dark mode theme" desc="Palette used when dark mode is active">
          <ThemeChipPicker value={tweaks.darkTheme || 'cobalt'} onChange={v => setTweak('darkTheme', v)} />
        </VsFullRow>
      </VsCard>
      <DesktopProfileCard />
      <DesktopPlannerPrefsCard />
      <DesktopConfidentialCard />
      <DesktopAppCard />
      <AdoConnectionCard />
      <VsProfiles profileApi={profileApi} />
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
      <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
    </div>
  )
}
```

- [ ] **Step 7: Verify in app**

Navigate to Settings. Confirm four new cards: Profile (inputs save on change), Planner (seg controls update preferences used by PlannerView), Confidential (Set password button opens VsPasswordModal), Desktop (login item / close to tray toggles call electronAPI; output folder picker works).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Profile, Planner, Confidential, and Desktop settings cards"
```

---

### Task 6: Calendar view

**Files:**
- Create: `apps/desktop/src/view-calendar.jsx`
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `OutlookService, WeekGrid, MonthView, YearView, AgendaView, EventDetailModal, OutlookBanner, getWeekDays, getMonthGrid, getYearMonths, getAgendaDays, nowTopPx, todayStr, isoDate, MONTH_NAMES, DAY_SHORT` from `@nexusmd/ui`; `usePersisted` from `@nexusmd/ui`
- Produces: `DesktopCalendarView` component exported from `view-calendar.jsx`; `calendar` nav entry in `main.jsx`

- [ ] **Step 1: Create `apps/desktop/src/view-calendar.jsx`**

```jsx
import React from 'react'
import {
  OutlookService,
  WeekGrid, MonthView, YearView, AgendaView,
  EventDetailModal, OutlookBanner,
  getWeekDays, getMonthGrid, getYearMonths, getAgendaDays,
  nowTopPx, todayStr, isoDate, MONTH_NAMES, DAY_SHORT,
  usePersisted,
} from '@nexusmd/ui'
import { Icon } from '@nexusmd/ui'

const { useState, useEffect, useRef } = React

export function DesktopCalendarView({ onNavigatePlanner }) {
  const [calView, setCalView] = useState('week')
  const [offset, setOffset]   = useState(0)
  const [selected, setSelected] = useState(null)
  const [nowPx, setNowPx]     = useState(nowTopPx)
  const scrollRef              = useRef(null)

  const [outlookConfig] = usePersisted('nexusmd.outlook.config', { clientId: '', tenantId: 'common' })
  const [connected, setConnected]     = useState(false)
  const [displayName, setDisplayName] = useState(null)
  const [outlookEvents, setOutlookEvents] = useState([])
  const [syncing, setSyncing]         = useState(false)
  const [syncError, setSyncError]     = useState(null)

  const today = todayStr()

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNowPx(nowTopPx()), 60000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll to current time on week view
  useEffect(() => {
    if ((calView !== 'week' && calView !== 'workweek') || offset !== 0 || !scrollRef.current) return
    const px = nowTopPx()
    if (px !== null) scrollRef.current.scrollTop = Math.max(0, px - 120)
  }, [calView, offset])

  // Init Outlook MSAL
  useEffect(() => {
    if (!outlookConfig?.clientId) return
    OutlookService.reset()
    OutlookService.init(outlookConfig.clientId, outlookConfig.tenantId || 'common')
      .then(() => {
        if (OutlookService.isConnected()) {
          setConnected(true)
          setDisplayName(OutlookService.getDisplayName())
          fetchEvents()
        }
      })
      .catch(console.error)
  }, [outlookConfig?.clientId, outlookConfig?.tenantId])

  const fetchEvents = async () => {
    if (!OutlookService.isConnected()) return
    setSyncing(true); setSyncError(null)
    try {
      const evs = await OutlookService.fetchEvents()
      setOutlookEvents(evs || [])
    } catch (e) {
      setSyncError(e?.message || 'Sync failed')
    } finally { setSyncing(false) }
  }

  const handleConnect = async () => {
    try {
      await OutlookService.signIn()
      setConnected(OutlookService.isConnected())
      setDisplayName(OutlookService.getDisplayName())
      if (OutlookService.isConnected()) fetchEvents()
    } catch (e) { console.error(e) }
  }

  const handleDisconnect = async () => {
    await OutlookService.signOut().catch(() => {})
    setConnected(false); setDisplayName(null); setOutlookEvents([])
  }

  const handleUpdateEvent = async (ev, patch) => {
    try { await OutlookService.updateEvent(ev.id, patch); fetchEvents() } catch (e) { console.error(e) }
  }
  const handleDeleteEvent = async (ev) => {
    try { await OutlookService.deleteEvent(ev.id); setSelected(null); fetchEvents() } catch (e) { console.error(e) }
  }

  // Build display ranges
  const weekDays  = getWeekDays(offset, calView === 'workweek')
  const monthGrid = getMonthGrid(offset)
  const yearGrid  = getYearMonths(offset)
  const agendaDays = getAgendaDays(offset)

  const VIEW_OPTS = [
    ['week','Week'], ['workweek','Work week'], ['month','Month'],
    ['year','Year'], ['agenda','Agenda'],
  ]

  const navLabel = calView === 'week' || calView === 'workweek'
    ? `${DAY_SHORT[weekDays[0].getDay()]} ${weekDays[0].getDate()} – ${weekDays[weekDays.length-1].getDate()} ${MONTH_NAMES[weekDays[weekDays.length-1].getMonth()]} ${weekDays[weekDays.length-1].getFullYear()}`
    : calView === 'month'
    ? `${MONTH_NAMES[monthGrid[2][0].getMonth()]} ${monthGrid[2][0].getFullYear()}`
    : calView === 'year'
    ? String(new Date().getFullYear() + offset)
    : calView === 'agenda'
    ? `${agendaDays[0] ? isoDate(agendaDays[0]) : ''} – ${agendaDays[agendaDays.length-1] ? isoDate(agendaDays[agendaDays.length-1]) : ''}`
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 12px', flexShrink: 0, flexWrap: 'wrap' }}>
        <button className="btn sm ghost" onClick={() => setOffset(0)}>Today</button>
        <button className="btn sm ghost" style={{ padding: '4px 8px' }} onClick={() => setOffset(o => o - 1)}>
          <Icon name="chevron-left" size={14}/>
        </button>
        <button className="btn sm ghost" style={{ padding: '4px 8px' }} onClick={() => setOffset(o => o + 1)}>
          <Icon name="chevron-right" size={14}/>
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>{navLabel}</span>
        <div className="pl-seg">
          {VIEW_OPTS.map(([v, l]) => (
            <button key={v} className={calView === v ? 'active' : ''} onClick={() => { setCalView(v); setOffset(0) }}>{l}</button>
          ))}
        </div>
        <OutlookBanner
          connected={connected}
          displayName={displayName}
          syncing={syncing}
          error={syncError}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRefresh={fetchEvents}
        />
      </div>

      {/* Body */}
      <div ref={scrollRef} style={{ flex: 1, overflow: calView === 'week' || calView === 'workweek' ? 'auto' : 'hidden', minHeight: 0 }}>
        {(calView === 'week' || calView === 'workweek') && (
          <WeekGrid
            days={weekDays}
            events={outlookEvents}
            today={today}
            nowPx={nowPx}
            onEventClick={setSelected}
            onNavigatePlanner={onNavigatePlanner}
          />
        )}
        {calView === 'month' && (
          <MonthView
            grid={monthGrid}
            events={outlookEvents}
            today={today}
            onEventClick={setSelected}
          />
        )}
        {calView === 'year' && (
          <YearView
            grid={yearGrid}
            events={outlookEvents}
            today={today}
            onMonthClick={(mo) => { setCalView('month'); setOffset(mo) }}
          />
        )}
        {calView === 'agenda' && (
          <AgendaView
            days={agendaDays}
            events={outlookEvents}
            today={today}
            onEventClick={setSelected}
          />
        )}
      </div>

      <EventDetailModal
        event={selected}
        onClose={() => setSelected(null)}
        onUpdate={patch => handleUpdateEvent(selected, patch)}
        onDelete={() => handleDeleteEvent(selected)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Add `calendar` to the desktop NAV**

In `main.jsx`, find the `NAV` array and add calendar after tests:
```js
const NAV = [
  { id: 'dashboard',    label: 'Dashboard',    icon: 'dashboard' },
  { id: 'work',         label: 'Work Items',   icon: 'work' },
  { id: 'prs',          label: 'Pull Requests',icon: 'pr' },
  { id: 'builds',       label: 'Builds',       icon: 'build' },
  { id: 'tests',        label: 'Tests',        icon: 'check-circle' },
  { id: 'calendar',     label: 'Calendar',     icon: 'planner' },
  { id: 'team',         label: 'Team',         icon: 'team' },
  { id: 'triage',       label: 'Triage',       icon: 'work' },
  { id: 'planner',      label: 'Planner',      icon: 'planner' },
  { id: 'markdown',     label: 'Notes',        icon: 'pin' },
  { id: 'integrations', label: 'Integrations', icon: 'lock' },
  { id: 'settings',     label: 'Settings',     icon: 'settings' },
]
```

- [ ] **Step 3: Import `DesktopCalendarView` in `main.jsx`**

```js
import { DesktopCalendarView } from './view-calendar.jsx'
```

- [ ] **Step 4: Add `calendar` case to `ViewBody`**

```jsx
case 'calendar':
  return <DesktopCalendarView onNavigatePlanner={() => { /* nav prop not available here — dispatch event instead */ window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' })) }} />
```

And in `App`, add a listener for `nexusmd:navigate`:
```js
React.useEffect(() => {
  const handler = e => setView(e.detail)
  window.addEventListener('nexusmd:navigate', handler)
  return () => window.removeEventListener('nexusmd:navigate', handler)
}, [])
```

- [ ] **Step 5: Adjust `main` section scroll handling for calendar view**

The existing `section` style already has special handling for `'markdown'`. Add `'calendar'` to the same check:
```jsx
<section style={{
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: (view === 'markdown' || view === 'calendar') ? 'hidden' : 'auto',
  padding: (view === 'markdown' || view === 'calendar') ? 0 : 18,
}}>
```

- [ ] **Step 6: Verify in app**

Navigate to Calendar. The Outlook connect button should appear. (Connect requires a valid clientId configured in Integrations → Microsoft.) Once connected, events should populate the week/month/year/agenda views. Week view should auto-scroll to current time.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/view-calendar.jsx apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Calendar view with Outlook integration"
```

---

### Task 7: Team mutations + quick links

**Files:**
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Consumes: `plannerData`/`setPlannerData` lifted to `App` in Task 3; `tweaks.quickLinks` from tweaks state; `getProfileKey` (already imported)
- Produces: `onTeamChange`, `onAddNote`, `onScheduleOneOnOne` wired to `TeamView`; quick links in `DEFAULT_TWEAKS`, settings card, and `DashboardView`

- [ ] **Step 1: Add `quickLinks` to `DEFAULT_TWEAKS`**

```js
const DEFAULT_TWEAKS = {
  theme: 'light', lightTheme: 'parchment', darkTheme: 'cobalt',
  density: 'balanced', sidebar: 'labels', typeLabels: false,
  widgetOrder: DASH_WIDGET_ORDER,
  quickLinks: [
    { label: 'UAT Testing', url: 'https://uat.example.com/', color: 'var(--info)' },
    { label: 'Dev Testing', url: 'https://dev.example.com/', color: 'var(--success)' },
    { label: 'Cirrus HR',   url: 'https://cirrushr.co.uk',        color: 'var(--violet)' },
  ],
}
```

- [ ] **Step 2: Pass `tweaks.quickLinks` to `DashboardView`**

In the `'dashboard'` case of `ViewBody`, the `quickLinks` prop already reads from `tweaks.quickLinks || []` (added in Task 3). This step is already done — verify the constant is in place.

- [ ] **Step 3: Wire `TeamView` mutations in `ViewBody`**

In `ViewBody`, add custom team state:
```js
const [customTeam, setCustomTeam] = React.useState(() => {
  try {
    const k = getProfileKey('nexusmd.team.custom')
    return JSON.parse(localStorage.getItem(k) || '[]')
  } catch { return [] }
})
const [removedIds, setRemovedIds] = React.useState(() => {
  try {
    const k = getProfileKey('nexusmd.team.removed')
    return JSON.parse(localStorage.getItem(k) || '[]')
  } catch { return [] }
})

const effectiveTeam = React.useMemo(() => {
  const base = (data.TEAM || []).filter(m => !removedIds.includes(m.id))
  const existingIds = new Set(base.map(m => m.id))
  return [...base, ...customTeam.filter(m => !existingIds.has(m.id))]
}, [data.TEAM, customTeam, removedIds])

const handleTeamChange = (newTeam) => {
  const baseIds = new Set((data.TEAM || []).map(m => m.id))
  const newCustom = newTeam.filter(m => !baseIds.has(m.id))
  const newRemoved = (data.TEAM || []).filter(m => !newTeam.find(t => t.id === m.id)).map(m => m.id)
  setCustomTeam(newCustom)
  setRemovedIds(newRemoved)
  try {
    localStorage.setItem(getProfileKey('nexusmd.team.custom'), JSON.stringify(newCustom))
    localStorage.setItem(getProfileKey('nexusmd.team.removed'), JSON.stringify(newRemoved))
  } catch {}
}

const handleAddNote = (devId, note) => {
  setPlannerData(prev => {
    const notes = prev.globalNotes || []
    return { ...prev, globalNotes: [...notes, { devId, note, date: new Date().toISOString() }] }
  })
}

const handleScheduleOneOnOne = (dev) => {
  const start = new Date()
  start.setHours(10, 0, 0, 0)
  start.setDate(start.getDate() + 1)
  const end = new Date(start.getTime() + 60 * 60000)
  if (OutlookService?.isConnected()) {
    OutlookService.createEvent({
      title: `1:1 with ${dev.name}`,
      start: start.toISOString().slice(0, 16),
      end:   end.toISOString().slice(0, 16),
    }).catch(console.error)
  }
  window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))
}
```

Import `OutlookService` in `main.jsx` — it's already exported from `@nexusmd/ui` and should be added to the import:
```js
import {
  ...,
  OutlookService,
} from '@nexusmd/ui'
```

- [ ] **Step 4: Update the `'team'` case in `ViewBody`**

```jsx
case 'team':
  return (
    <TeamView
      team={effectiveTeam}
      workItems={data.WORK_ITEMS || []}
      prs={data.PRS || []}
      onOpenItem={onOpenItem}
      onOpenPerson={() => {}}
      onTeamChange={handleTeamChange}
      onAddNote={handleAddNote}
      onScheduleOneOnOne={handleScheduleOneOnOne}
    />
  )
```

- [ ] **Step 5: Add `DesktopQuickLinksCard` to settings**

Add before `DesktopSettings`:
```jsx
function DesktopQuickLinksCard({ links, onChange }) {
  const [editing, setEditing] = React.useState(null) // index | 'new' | null
  const [form, setForm] = React.useState({ label: '', url: '', color: 'var(--accent)' })

  const open = (idx) => {
    if (idx === 'new') {
      setForm({ label: '', url: '', color: 'var(--accent)' })
    } else {
      setForm({ ...links[idx] })
    }
    setEditing(idx)
  }
  const save = () => {
    if (!form.label || !form.url) return
    const next = editing === 'new'
      ? [...links, form]
      : links.map((l, i) => i === editing ? form : l)
    onChange(next)
    setEditing(null)
  }
  const remove = (idx) => onChange(links.filter((_, i) => i !== idx))

  const inp = { width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }

  return (
    <VsCard title="Quick links" icon="link">
      {links.map((l, i) => (
        <VsRow key={i} title={l.label} desc={l.url}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" onClick={() => open(i)}>Edit</button>
            <button className="btn sm ghost danger" onClick={() => remove(i)}>Remove</button>
          </div>
        </VsRow>
      ))}
      <div style={{ padding: '8px 16px' }}>
        <button className="btn sm" onClick={() => open('new')}>+ Add link</button>
      </div>
      {editing !== null && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="Label" value={form.label} style={inp} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <input placeholder="URL" value={form.url} style={inp} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <input placeholder="Colour (CSS var or hex)" value={form.color} style={inp} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn sm primary" onClick={save} disabled={!form.label || !form.url}>Save</button>
          </div>
        </div>
      )}
    </VsCard>
  )
}
```

- [ ] **Step 6: Add `DesktopQuickLinksCard` to `DesktopSettings`**

In `DesktopSettings`, add after `DesktopAppCard`:
```jsx
<DesktopQuickLinksCard
  links={tweaks.quickLinks || []}
  onChange={links => setTweak('quickLinks', links)}
/>
```

- [ ] **Step 7: Verify in app**

Navigate to Team — add a custom member (should persist on reload), remove a member (should persist). Navigate to Settings → Quick Links — add/edit/remove a quick link, navigate to Dashboard and confirm the quick links widget shows the updated list. Navigate to team member and click "Schedule 1:1" — should navigate to Planner.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): team mutations, quick links settings card and dashboard wiring"
```

---

## Not Applicable to Desktop

These web features have hard architectural dependencies on the web server and are intentionally excluded from this plan:

| Feature | Reason |
|---------|--------|
| Google Workspace OAuth + Calendar alerts | Google OAuth requires a server-side redirect URI; `calendar-alerts.js` polling loop relies on server-kept tokens |
| Email digest / SMTP | `PUT /api/config` writes SMTP config and sends digests server-side — no equivalent in Electron |

---

## Addendum: Gaps Identified in Audit (2026-07-01)

The original seven tasks leave the following gaps open. Tasks 3 and 5 each need one extra step, and Tasks 8–16 are new.

---

### Task 3 addendum: Nav sidebar change badges

**Insert as Step 2b** (after the `newItemIds` useEffect, before Step 3).

The existing Task 3 Step 2 tracks `newItemIds` for in-row highlighting. Sidebar badge counts require a separate `changeBadges` counter that increments on any change (not just additions) and resets to 0 when the user visits that view.

**Files:** `apps/desktop/src/main.jsx`

- [ ] **Step 2b: Add `changeBadges` state to `App`**

Add below `newItemIds`:
```js
const [changeBadges, setChangeBadges] = React.useState({ work: 0, prs: 0, builds: 0, tests: 0 })
```

Add a `useEffect` alongside the `newItemIds` effect:
```js
React.useEffect(() => {
  if (prevSnapshotIdsRef.current === null) return
  const prev = prevSnapshotIdsRef.current
  const toIds = arr => new Set((arr || []).map(i => i.id))
  const cur = {
    work:   toIds(snapshot.WORK_ITEMS),
    prs:    toIds(snapshot.PRS),
    builds: toIds(snapshot.BUILDS),
    tests:  toIds(snapshot.TESTS),
  }
  const changed = (curSet, prevSet) => [...curSet].filter(id => !prevSet.has(id)).length
  setChangeBadges(b => ({
    work:   b.work   + changed(cur.work,   prev.work),
    prs:    b.prs    + changed(cur.prs,    prev.pr),
    builds: b.builds + changed(cur.builds, prev.builds),
    tests:  b.tests  + changed(cur.tests,  prev.tests),
  }))
}, [snapshot])
```

Extend the existing view-navigation effect to also clear the badge:
```js
React.useEffect(() => {
  const keyMap = { work: 'work', prs: 'prs', builds: 'builds', tests: 'tests' }
  const wiKey  = keyMap[view]
  if (wiKey) {
    setNewItemIds(n => ({ ...n, [wiKey]: new Set() }))
    setChangeBadges(b => ({ ...b, [wiKey]: 0 }))
  }
}, [view])
```

- [ ] **Step 2c: Pass `changeBadges` to the sidebar and render badge chips**

Pass `changeBadges` into the sidebar NAV render. Where each nav item is rendered (look for the map over `NAV` that produces `<button>` elements), add:
```jsx
{changeBadges[item.id] > 0 && (
  <span style={{
    marginLeft: 'auto', minWidth: 18, height: 18,
    background: 'var(--accent)', color: 'var(--on-accent)',
    borderRadius: 9, fontSize: 11, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 5px',
  }}>
    {changeBadges[item.id] > 99 ? '99+' : changeBadges[item.id]}
  </span>
)}
```

- [ ] **Step 2d: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): sidebar change-badge counts on Work, PRs, Builds, Tests"
```

---

### Task 5 addendum: Wire planner preferences into PlannerView

**Insert as Step 6b** (after the settings cards are added, before the verify step).

Task 5 adds the `DesktopPlannerPrefsCard` which saves pref keys to localStorage, but `PlannerView` in `ViewBody` is never passed those keys. This step reads them and passes them as props.

**Files:** `apps/desktop/src/main.jsx`

- [ ] **Step 6b: Read pref keys and pass to PlannerView**

In `ViewBody`'s `'planner'` case, before the `return`, read the four keys:
```js
case 'planner': {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const plannerPrefs = {
    landing:     readPref('nexusmd.planner.landing', 'glance'),
    nav:         readPref('nexusmd.planner.nav', 'rail'),
    entry:       readPref('nexusmd.planner.entry', 'inline'),
    carryPrompt: readPref('nexusmd.planner.carryPrompt', '1') === '1',
  }
  return (
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
    />
  )
}
```

(Check `PlannerView`'s prop list in `packages/ui` to confirm the exact prop names match — `landing`, `navStyle`, `entryStyle`, `carryPrompt` are the most likely names based on the web app's `usePrefVS` keys.)

- [ ] **Step 6c: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): pass planner preferences from localStorage to PlannerView"
```

---

### Task 8: Expand CreateWorkItemModal to full form

**Files:** `apps/desktop/src/main.jsx`

**Context:** The current `CreateWorkItemModal` has three fields (project, type, title). The web form has 11 fields. The modal is only reachable via the `nexusmd:create-wi` event — the `onCreate` no-op in `WorkItemsView` was fixed in Task 3.

- [ ] **Step 1: Add assignee, state, and priority fields**

In `CreateWorkItemModal`, after the type `<select>`, add:
```jsx
{/* Assignee — derive options from data.TEAM if available */}
<label>Assignee<br/>
  <select value={form.assignee || ''} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}>
    <option value="">Unassigned</option>
    {(teamMembers || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
  </select>
</label>
{/* State */}
<label>State<br/>
  <select value={form.state || 'Active'} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}>
    {['New','Active','Resolved','Closed'].map(s => <option key={s}>{s}</option>)}
  </select>
</label>
{/* Priority */}
<label>Priority<br/>
  <select value={form.priority || '2'} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
    {[['1','Critical'],['2','High'],['3','Medium'],['4','Low']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
  </select>
</label>
```

`teamMembers` comes from `data.TEAM` — thread it into the modal via a prop or read from a context/window global.

- [ ] **Step 2: Add tags, description, and type-conditional fields**

After priority:
```jsx
<label>Tags (comma-separated)<br/>
  <input value={form.tags || ''} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
</label>
<label>Description<br/>
  <textarea rows={4} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
</label>
{/* Acceptance criteria — User Story / Feature only */}
{(form.type === 'User Story' || form.type === 'Feature') && (
  <label>Acceptance criteria<br/>
    <textarea rows={3} value={form.acceptanceCriteria || ''} onChange={e => setForm(f => ({ ...f, acceptanceCriteria: e.target.value }))} />
  </label>
)}
{/* Repro steps — Bug only */}
{form.type === 'Bug' && (
  <>
    <label>Repro steps<br/>
      <textarea rows={3} value={form.reproSteps || ''} onChange={e => setForm(f => ({ ...f, reproSteps: e.target.value }))} />
    </label>
    <label>System info<br/>
      <input value={form.systemInfo || ''} onChange={e => setForm(f => ({ ...f, systemInfo: e.target.value }))} />
    </label>
  </>
)}
{/* Story points — User Story only */}
{form.type === 'User Story' && (
  <label>Story points<br/>
    <input type="number" min={0} value={form.storyPoints || ''} onChange={e => setForm(f => ({ ...f, storyPoints: e.target.value }))} />
  </label>
)}
{/* Remaining work — Task only */}
{form.type === 'Task' && (
  <label>Remaining work (hours)<br/>
    <input type="number" min={0} step={0.5} value={form.remainingWork || ''} onChange={e => setForm(f => ({ ...f, remainingWork: e.target.value }))} />
  </label>
)}
```

- [ ] **Step 3: Pass expanded fields to `desktopWorkItemSource.createWorkItem`**

In the submit handler, spread the full `form` into the create call:
```js
await desktopWorkItemSource.createWorkItem({
  project: form.project,
  type:    form.type,
  title:   form.title,
  assignedTo:         form.assignee || undefined,
  state:              form.state,
  priority:           form.priority ? parseInt(form.priority) : undefined,
  tags:               form.tags || undefined,
  description:        form.description || undefined,
  acceptanceCriteria: form.acceptanceCriteria || undefined,
  reproSteps:         form.reproSteps || undefined,
  systemInfo:         form.systemInfo || undefined,
  storyPoints:        form.storyPoints ? parseFloat(form.storyPoints) : undefined,
  remainingWork:      form.remainingWork ? parseFloat(form.remainingWork) : undefined,
})
```

(Check `desktopWorkItemSource.createWorkItem`'s accepted fields in `packages/ui` or `apps/desktop` to confirm field names match ADO patch operations.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): expand CreateWorkItemModal to full 11-field form"
```

---

### Task 9: Auto-refresh countdown + pause

**Files:** `apps/desktop/src/main.jsx`

**Context:** Currently `refreshAdoData()` is called once at startup. The web refreshes on a configurable interval (default 300 s) and shows a countdown in the topbar with a pause/resume button.

- [ ] **Step 1: Add refresh state to `App`**

```js
const [refreshInterval, setRefreshInterval] = React.useState(() => {
  try { return parseInt(localStorage.getItem('nexusmd.refreshInterval') || '300', 10) } catch { return 300 }
})
const [refreshPaused, setRefreshPaused] = React.useState(false)
const [refreshLeft, setRefreshLeft] = React.useState(refreshInterval)
const refreshLeftRef = React.useRef(refreshInterval)
```

- [ ] **Step 2: Add countdown tick and auto-refresh effect**

```js
React.useEffect(() => {
  refreshLeftRef.current = refreshInterval
  setRefreshLeft(refreshInterval)
}, [refreshInterval])

React.useEffect(() => {
  if (refreshPaused) return
  const tick = setInterval(() => {
    refreshLeftRef.current -= 1
    setRefreshLeft(refreshLeftRef.current)
    if (refreshLeftRef.current <= 0) {
      refreshAdoData()
      refreshLeftRef.current = refreshInterval
      setRefreshLeft(refreshInterval)
    }
  }, 1000)
  return () => clearInterval(tick)
}, [refreshPaused, refreshInterval])
```

- [ ] **Step 3: Add countdown display and pause button to topbar**

In the topbar JSX (near the existing manual refresh button), add:
```jsx
<span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
  {refreshPaused ? 'paused' : `${refreshLeft}s`}
</span>
<button className="btn sm ghost" title={refreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
  onClick={() => setRefreshPaused(p => !p)}>
  <Icon name={refreshPaused ? 'play' : 'pause'} size={12}/>
</button>
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): auto-refresh countdown timer with pause/resume"
```

---

### Task 10: Data & sync settings card + configurable refresh interval

**Files:** `apps/desktop/src/main.jsx`

**Context:** The web Settings has a Data & sync tab showing KB used, version count, server sync status, and a refresh interval field. Desktop can show localStorage usage and wire the refresh interval from Task 9.

- [ ] **Step 1: Add `DesktopDataSyncCard` component**

Add before `DesktopSettings`:
```jsx
function DesktopDataSyncCard({ refreshInterval, onRefreshIntervalChange }) {
  const [kbUsed, setKbUsed] = React.useState(0)

  React.useEffect(() => {
    try {
      let bytes = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        bytes += (localStorage.getItem(k) || '').length * 2
      }
      setKbUsed(Math.round(bytes / 1024))
    } catch {}
  }, [])

  const clearLocal = () => {
    if (!window.confirm('Clear all local NexusMD data? This cannot be undone.')) return
    try {
      const toRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('nexusmd.')) toRemove.push(k)
      }
      toRemove.forEach(k => localStorage.removeItem(k))
      window.location.reload()
    } catch {}
  }

  return (
    <VsCard title="Data & sync" icon="dashboard">
      <VsRow title="Local storage used" desc="Approximate size of all NexusMD data in this profile">
        <span style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>{kbUsed} KB</span>
      </VsRow>
      <VsRow title="Auto-refresh interval" desc="Seconds between automatic ADO data refreshes (10–3600)">
        <input type="number" min={10} max={3600} step={10}
          value={refreshInterval}
          style={{ width: 80, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
          onChange={e => {
            const v = Math.max(10, Math.min(3600, parseInt(e.target.value, 10) || 300))
            onRefreshIntervalChange(v)
            try { localStorage.setItem('nexusmd.refreshInterval', String(v)) } catch {}
          }}
        />
      </VsRow>
      <VsRow title="Clear local data" desc="Remove all locally stored NexusMD data and reload">
        <button className="btn sm ghost danger" onClick={clearLocal}>Clear data…</button>
      </VsRow>
    </VsCard>
  )
}
```

- [ ] **Step 2: Add to `DesktopSettings` and thread `refreshInterval`/`setRefreshInterval` through**

`DesktopSettings` needs to receive `refreshInterval` and `onRefreshIntervalChange` as props (passed from `App`):
```jsx
function DesktopSettings({ tweaks, setTweak, refreshInterval, onRefreshIntervalChange }) {
  ...
  return (
    <div ...>
      ...existing cards...
      <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
    </div>
  )
}
```

In `App`'s JSX, pass:
```jsx
<DesktopSettings tweaks={tweaks} setTweak={setTweak}
  refreshInterval={refreshInterval} onRefreshIntervalChange={setRefreshInterval} />
```

(`refreshInterval` / `setRefreshInterval` are the state vars added in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): Data & sync settings card with localStorage stats and refresh interval"
```

---

### Task 11: Keyboard shortcuts (1–9 nav)

**Files:** `apps/desktop/src/main.jsx`

- [ ] **Step 1: Register digit-key handler in `App`**

```js
React.useEffect(() => {
  const handler = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
    const idx = parseInt(e.key, 10)
    if (idx >= 1 && idx <= 9) {
      const target = NAV[idx - 1]
      if (target) setView(target.id)
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])
```

- [ ] **Step 2: Show shortcut hints in sidebar (optional)**

If sidebar is in `labels` mode, append a muted digit hint after each nav label where the index is 1–9:
```jsx
{idx < 9 && (
  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)', opacity: 0.5 }}>
    {idx + 1}
  </span>
)}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): keyboard shortcuts 1-9 for view navigation"
```

---

### Task 12: Project Areas modal

**Files:** `apps/desktop/src/main.jsx`

**Context:** The web has a full tree-structured `ProjectAreasModal` (stored at `nexusmd.projectAreas.v3`) used in triage and work-item classification. The shared `@nexusmd/ui` package may not export this modal — check `packages/ui/src/index.js` for an export named `ProjectAreasModal` or similar before implementing.

- [ ] **Step 1: Check if `ProjectAreasModal` is exported from `@nexusmd/ui`**

```bash
grep -n "ProjectAreas" packages/ui/src/index.js
```

If exported, import it and skip to Step 4. If not, continue to Step 2.

- [ ] **Step 2: Build `DesktopProjectAreasModal` in `main.jsx`**

The modal manages a tree of `{ id, label, children: [] }` nodes stored under `nexusmd.projectAreas.v3`. Minimum viable implementation:

```jsx
function DesktopProjectAreasModal({ open, onClose }) {
  const [areas, setAreas] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('nexusmd.projectAreas.v3') || '[]') } catch { return [] }
  })
  const save = (next) => {
    setAreas(next)
    try { localStorage.setItem('nexusmd.projectAreas.v3', JSON.stringify(next)) } catch {}
  }

  if (!open) return null

  const addRoot = () => save([...areas, { id: Date.now().toString(), label: 'New area', children: [] }])
  const remove = (id) => save(areas.filter(a => a.id !== id))
  const rename = (id, label) => save(areas.map(a => a.id === id ? { ...a, label } : a))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Project Areas</span>
          <button className="btn sm ghost" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {areas.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input value={a.label} style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13 }}
                onChange={e => rename(a.id, e.target.value)} />
              <button className="btn sm ghost danger" onClick={() => remove(a.id)}><Icon name="trash" size={12}/></button>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn sm" onClick={addRoot}>+ Add area</button>
          <button className="btn sm primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
```

> **Note:** This is a flat-list MVP. The web supports nested sub-areas. Nested tree editing can be added in a follow-up once the basic modal is in place.

- [ ] **Step 3: Add `projectAreas` state and modal to `App`**

```js
const [areasOpen, setAreasOpen] = React.useState(false)
```

Add to `App`'s JSX (alongside other modals):
```jsx
<DesktopProjectAreasModal open={areasOpen} onClose={() => setAreasOpen(false)} />
```

- [ ] **Step 4: Add Project Areas entry point in Settings**

In `DesktopSettings`, add a row to the Appearance card or a standalone card:
```jsx
<VsCard title="Project areas" icon="work">
  <VsRow title="Manage areas" desc="Define project area categories used in triage and work-item classification">
    <button className="btn sm ghost" onClick={() => setAreasOpen(true)}>Open editor</button>
  </VsRow>
</VsCard>
```

`setAreasOpen` needs to be threaded down from `App` to `DesktopSettings` as a prop, or trigger via a custom DOM event to avoid deep prop drilling.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): Project Areas modal (flat-list MVP)"
```

---

### Task 13: Token expiry banner (GitHub)

**Files:** `apps/desktop/src/main.jsx`

**Context:** The web renders a `TokenExpiryBanner` when GitHub or Google tokens expire. On desktop only GitHub OAuth applies. The banner should appear when a GitHub API call returns 401 and offer one-click re-auth via the existing deep-link flow.

- [ ] **Step 1: Add `githubExpired` state to `App`**

```js
const [githubExpired, setGithubExpired] = React.useState(false)
```

- [ ] **Step 2: Detect expiry in the data refresh path**

In the `refreshAdoData` (or wherever GitHub API errors surface), catch 401s:
```js
// where GitHub fetch errors are caught:
.catch(e => {
  if (e?.status === 401 || e?.message?.includes('401')) setGithubExpired(true)
})
```

Also reset when the user successfully re-connects:
```js
// after GitHub OAuth deep-link completes:
setGithubExpired(false)
```

- [ ] **Step 3: Render the banner**

Add above `<ViewBody>` in `App`'s JSX:
```jsx
{githubExpired && (
  <div style={{
    background: 'var(--warning-soft)', borderBottom: '1px solid var(--warning-border)',
    padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
    flexShrink: 0,
  }}>
    <Icon name="alert" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }}/>
    <span style={{ flex: 1, color: 'var(--warning-text)' }}>GitHub token expired — re-connect to restore PR and build data.</span>
    <button className="btn sm ghost" onClick={() => {
      window.electronAPI?.openExternal?.('nexusmd://github-oauth')
      setGithubExpired(false)
    }}>Re-connect</button>
    <button className="btn sm ghost" onClick={() => setGithubExpired(false)}>
      <Icon name="x" size={12}/>
    </button>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): GitHub token expiry banner with re-auth shortcut"
```

---

### Task 14: GitHub PAT + repo browser in Integrations

**Files:** `apps/desktop/src/main.jsx`

**Context:** The web's GitHub settings tab supports both a PAT path (with format validation) and an OAuth path, plus a "Browse repos" picker. Desktop currently only has the OAuth deep-link. Adding PAT support gives users who can't complete OAuth a fallback.

- [ ] **Step 1: Add PAT field to the GitHub section of `IntegrationsView` or the desktop's custom Integrations card**

Find where GitHub credentials are configured in `main.jsx` (likely inside `IntegrationsView` or a wrapper around it). Add a PAT input alongside the OAuth button:

```jsx
function DesktopGitHubPATRow() {
  const [pat, setPat] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.github.pat') || '' } catch { return '' }
  })
  const [valid, setValid] = React.useState(true)
  const validate = (v) => /^gh[ps]_/.test(v) || /^github_pat_/.test(v) || v === ''

  const save = () => {
    if (!validate(pat)) { setValid(false); return }
    setValid(true)
    try { localStorage.setItem('nexusmd.github.pat', pat) } catch {}
    toast?.('GitHub PAT saved.', 'success')
  }

  return (
    <VsRow title="Personal access token" desc="Alternative to OAuth — must start with ghp_, ghs_, or github_pat_">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="password" value={pat} style={{ width: 260, padding: '5px 10px', borderRadius: 8, border: `1px solid ${valid ? 'var(--border)' : 'var(--danger)'}`, background: 'var(--surface-2)', font: 'inherit', fontSize: 13 }}
          onChange={e => { setPat(e.target.value); setValid(true) }}
          placeholder="ghp_…" />
        <button className="btn sm" onClick={save}>Save</button>
        {pat && <button className="btn sm ghost danger" onClick={() => { setPat(''); localStorage.removeItem('nexusmd.github.pat') }}>Clear</button>}
      </div>
      {!valid && <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>Invalid PAT format</span>}
    </VsRow>
  )
}
```

Render `<DesktopGitHubPATRow />` inside the GitHub integrations section.

- [ ] **Step 2: Add repo browser (text field with comma-separated repos)**

The web has a full repo browser via `/api/github/repos`. On desktop, implement a simpler manual entry:
```jsx
<VsRow title="Repositories" desc="Comma-separated list of owner/repo pairs to track (e.g. org/api, org/app)">
  <input value={repos} style={{ width: 320, ... }}
    onChange={e => { setRepos(e.target.value); localStorage.setItem('nexusmd.github.repos', e.target.value) }}
    placeholder="org/repo, org/other-repo" />
</VsRow>
```

> Full automated repo discovery requires a GitHub API call — can be added in a follow-up once PAT storage is in place.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): GitHub PAT field with format validation in Integrations"
```

---

### Task 15: Sidebar resize handle

**Files:** `apps/desktop/src/main.jsx`

**Context:** The web sidebar is draggable (resize handle at right edge, min 160px, max 320px). The desktop sidebar is fixed at 220px. This task adds a resize handle with the same behaviour.

- [ ] **Step 1: Add sidebar width state**

In `App`:
```js
const [sidebarWidth, setSidebarWidth] = usePersistedState('nexusmd.sidebar.width', 220)
```

- [ ] **Step 2: Apply `sidebarWidth` to the `<nav>` element**

Find the `<nav>` (currently `style={{ width: 220, ... }}`):
```jsx
<nav style={{ width: sidebarWidth, minWidth: sidebarWidth, ... }}>
```

- [ ] **Step 3: Add drag handle**

Add as the last child of `<nav>`:
```jsx
<div
  style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 10 }}
  onMouseDown={e => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const onMove = (me) => {
      const next = Math.max(160, Math.min(320, startW + me.clientX - startX))
      setSidebarWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }}
/>
```

Ensure the `<nav>` has `position: relative` so the absolute handle is contained.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.jsx
git commit -m "feat(desktop): draggable sidebar resize handle (160–320px)"
```

---

### Updated File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/ui/src/index.js` | Modify | Task 1 — dead export removal |
| `apps/desktop/src/main.jsx` | Modify | Tasks 2–7, 3-addendum, 5-addendum, 8–15 |
| `apps/desktop/src/view-calendar.jsx` | Create | Task 6 — Calendar view |
