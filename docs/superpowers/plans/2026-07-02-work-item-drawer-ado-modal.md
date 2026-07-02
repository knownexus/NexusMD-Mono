# New Work Item Drawer — ADO Modal Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle and restructure the desktop app's "New Work Item" drawer so it reads like Azure DevOps' work item modal — large title + type icon + State pill in the header, a Details/Discussion/Links/Attachments/History tab strip, and a wider default open width.

**Architecture:** Two small additive props (`headerContent`, `defaultWidth`) are added to the shared `Drawer` component so every other consumer is unaffected. `CreateWorkItemDrawer` then rebuilds its header using `headerContent` and adds a local tab strip that toggles `hidden` on always-mounted panels (so existing field/link/attachment interaction tests keep working without being rewritten).

**Tech Stack:** React, Vitest + @testing-library/react, existing `@nexusmd/ui` package.

## Global Constraints

- `Drawer`'s existing behavior (resize, backdrop, Escape-to-close, stored-width persistence key) must be unchanged for every consumer that doesn't pass the new props.
- No changes to the create/submit/attachment/link API flow — this is a visual/structural pass only, per the spec's "Out of scope" section.
- Tab switching must not reset or discard any field/link/attachment state.

---

### Task 1: `Drawer` — add `headerContent` and `defaultWidth` props

**Files:**
- Modify: `packages/ui/src/app-components.jsx:75-144` (`Drawer`)
- Test: `packages/ui/tests/components.test.jsx`

**Interfaces:**
- Produces: `Drawer({ open, onClose, title, badges, children, actions, headerContent, defaultWidth = 560 })`. When `headerContent` is a truthy node, it renders in place of `<h2>{title}</h2>{badges}` inside `.drawer-head`; `title`/`badges` are otherwise unchanged. `defaultWidth` seeds the initial width state before anything is stored (falls back to `560`, today's hardcoded value).

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/tests/components.test.jsx` (same file already imports `Drawer` and `NexusDataProvider` — see existing Drawer tests around line 123 for the storage-mocking pattern):

```jsx
it('Drawer renders headerContent instead of title/badges when provided', () => {
  const value = { data: {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, getProfileKey: (k) => k, namespace: 'nexusmd' }
  const { container } = render(
    <NexusDataProvider value={value}>
      <Drawer open title="Should not show" headerContent={<span>Custom header</span>}><p>body</p></Drawer>
    </NexusDataProvider>,
  )
  expect(container.textContent).toContain('Custom header')
  expect(container.textContent).not.toContain('Should not show')
})

it('Drawer uses defaultWidth as the initial width when nothing is stored', () => {
  const value = { data: {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, getProfileKey: (k) => k, namespace: 'nexusmd' }
  const { container } = render(
    <NexusDataProvider value={value}>
      <Drawer open title="X" defaultWidth={820} />
    </NexusDataProvider>,
  )
  expect(container.querySelector('.drawer.open').style.width).toBe('820px')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/ui/tests/components.test.jsx -t "headerContent instead of title"`
Expected: FAIL — `Custom header` not found, default header renders `Should not show` instead.

Run: `npx vitest run packages/ui/tests/components.test.jsx -t "defaultWidth as the initial width"`
Expected: FAIL — width is `560px`, not `820px`.

- [ ] **Step 3: Implement the props**

In `packages/ui/src/app-components.jsx`, change the `Drawer` signature and body:

```jsx
export function Drawer({ open, onClose, title, badges, children, actions, headerContent, defaultWidth = 560 }) {
  const { storage, getProfileKey, namespace } = useNexusData()
  const widthKey = getProfileKey(`${namespace}.ui.drawerWidth`)
  const DRAWER_MIN = 280
  const DRAWER_MAX = 2000
  const drawerRef = useRef(null)
  const draggedW = useRef(null)
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const stored = parseInt(storage.getItem(widthKey) || String(defaultWidth), 10)
    return Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, stored))
  })
```

(Only the `useState` initializer's fallback and the function signature change — everything else in `Drawer` stays as-is.)

Then update the head markup:

```jsx
        <div className="drawer-head">
          {headerContent || (<><h2 className="truncate">{title}</h2>{badges}</>)}
          <div className="spacer"/>
          {actions}
          <button className="btn icon ghost sm" onClick={onClose} title="Close (Esc)"><Icon name="x" size={14}/></button>
        </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/ui/tests/components.test.jsx`
Expected: PASS — all Drawer tests, including the two new ones and the existing "reads its persisted width" / "clamps an out-of-range persisted width" tests (unaffected since they don't pass `defaultWidth`, so it still defaults to `560`).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app-components.jsx packages/ui/tests/components.test.jsx
git commit -m "feat(ui): add headerContent and defaultWidth props to Drawer"
```

---

### Task 2: `CreateWorkItemDrawer` header — type icon, large title input, State pill

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx:131-231` (`CreateWorkItemDrawer`)
- Modify: `packages/ui/src/styles/base.css` (append after line 1172, the `.kv` block, before the "Work item rich content" comment)
- Test: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `Drawer({ headerContent, defaultWidth })` from Task 1.
- Produces: the header now contains the title `<input aria-label="Title">` (same aria-label as before, so existing tests referencing `getByLabelText('Title')` keep working) and, when a `System.State` field is present in `defs.fields`, a `<select aria-label="State">` pill. `values['System.State']` becomes reachable the same way any other field is — through `setFieldValue`.

- [ ] **Step 1: Write the failing tests**

Add a new stub helper and tests to `apps/desktop/src/create-work-item-drawer.test.jsx`, right after the existing `stubDefs()` function (around line 87):

```jsx
function stubDefsWithState() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.State', name: 'State', dataType: 'string', allowedValues: ['New', 'Active', 'Closed'], alwaysRequired: false },
      { referenceName: 'System.Reason', name: 'Reason', dataType: 'string', allowedValues: ['New'], alwaysRequired: false },
    ],
    paths: { areas: [], iterations: [] },
    types: [{ name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}
```

Add a new `describe` block at the end of the file:

```jsx
describe('CreateWorkItemDrawer header', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the State field once, in the header, not duplicated in the status rail', async () => {
    stubDefsWithState()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    const stateSelect = screen.getByLabelText('State')
    expect(stateSelect.tagName).toBe('SELECT')
    expect(screen.getByText('Reason')).toBeTruthy() // other status field still in the rail
  })

  it('includes the State value in the onCreate payload when set via the header pill', async () => {
    stubDefsWithState()
    const onCreate = vi.fn().mockResolvedValue({ id: 7 })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={onCreate} />)
    await screen.findByLabelText('Description')

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Header state test' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Active' } })
    fireEvent.click(screen.getByText('Create'))

    await screen.findByText(/Created/)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({ 'System.State': 'Active' }),
    }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/create-work-item-drawer.test.jsx -t "State field once"`
Expected: FAIL — `getByLabelText('State')` finds two elements (rail + none in header yet) or none, since State isn't rendered in a header at all today.

- [ ] **Step 3: Implement the header**

In `apps/desktop/src/create-work-item-drawer.jsx`, inside `CreateWorkItemDrawer`, after the existing `const additionalFields = ...` line, add:

```jsx
  const stateField = fields.find((f) => f.referenceName === 'System.State')
```

Change the `statusFields` line to exclude it:

```jsx
  const statusFields = fields.filter((f) => fieldGroup(f) === 'status' && f.referenceName !== 'System.State')
```

Replace the `<Drawer ... >` opening tag (currently `title`/`badges` props) with:

```jsx
    <Drawer
      open={open}
      onClose={onClose}
      defaultWidth={820}
      headerContent={(
        <div className="wi-drawer-header">
          <TypeIcon type={adoTypeToHelm(typeName)} />
          <input
            aria-label="Title"
            className="wi-title-input"
            value={wiTitle}
            onChange={(e) => setWiTitle(e.target.value)}
            autoFocus
          />
          {stateField && (
            <select
              aria-label={stateField.name}
              className="wi-state-pill"
              value={values[stateField.referenceName] ?? ''}
              onChange={(e) => setFieldValue(stateField.referenceName, e.target.value)}
            >
              <option value="" />
              {stateField.allowedValues.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </div>
      )}
      actions={(
        <button className="btn icon ghost sm" title="Refresh field definitions"
          onClick={() => load(project, typeRef, { forceRefresh: true })}>
          <Icon name="refresh" size={13} />
        </button>
      )}
    >
```

Remove the old title field block (currently right after the Project/Type grid):

```jsx
      <SettField label="Title">
        <input aria-label="Title" value={wiTitle} onChange={(e) => setWiTitle(e.target.value)} autoFocus />
      </SettField>
      {titleError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{titleError}</div>}
```

and replace it with just the error line (title input itself now lives in the header):

```jsx
      {titleError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{titleError}</div>}
```

Append to `packages/ui/src/styles/base.css`, right after the `.kv dd { margin: 0; }` line (line 1172), before the `/* ---------- Work item rich content ... */` comment:

```css
.wi-drawer-header { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.wi-title-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 2px 4px;
}
.wi-title-input:focus { outline: none; background: var(--surface-2); border-radius: 6px; }
.wi-state-pill {
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/create-work-item-drawer.test.jsx`
Expected: PASS — the two new tests, and every pre-existing test in this file (they don't use `stubDefsWithState`, so no `State` field exists in their mocked defs and nothing changes for them).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx packages/ui/src/styles/base.css
git commit -m "feat(desktop): move work item title and State into the drawer header"
```

---

### Task 3: Tab strip — Details / Discussion / Links / Attachments / History

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx`
- Modify: `packages/ui/src/styles/base.css`
- Test: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `stateField`, `statusFields`, `stubDefsWithState()` from Task 2.
- Produces: local `tab` state (`'details' | 'links' | 'attachments'`); the four content blocks (Project/Type + title error + two-column grid, Attachments, Links, and the sticky action bar) stay always mounted, with `hidden={tab !== '<name>'}` on the first three so existing tests that query fields on the Links/Attachments tabs (e.g. `getByLabelText('Attach files')`, `getByLabelText('Link type')`) keep working without clicking a tab first.

- [ ] **Step 1: Write the failing tests**

Add to the new `describe('CreateWorkItemDrawer header', ...)` block from Task 2 (or a new `describe('CreateWorkItemDrawer tabs', ...)` block — use a new one for clarity):

```jsx
describe('CreateWorkItemDrawer tabs', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows the Details panel by default and hides Links/Attachments', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    expect(screen.getByLabelText('Description').closest('[hidden]')).toBeNull()
    expect(screen.getByLabelText('Attach files').closest('[hidden]')).not.toBeNull()
    expect(screen.getByLabelText('Link type').closest('[hidden]')).not.toBeNull()
  })

  it('switches to the Links panel and hides Details when the Links tab is clicked', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    fireEvent.click(screen.getByText('Links'))

    expect(screen.getByLabelText('Link type').closest('[hidden]')).toBeNull()
    expect(screen.getByLabelText('Description').closest('[hidden]')).not.toBeNull()
  })

  it('renders Discussion and History as disabled tabs', async () => {
    stubDefs()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    await screen.findByLabelText('Description')

    expect(screen.getByText('Discussion').closest('button').disabled).toBe(true)
    expect(screen.getByText('History').closest('button').disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/desktop/src/create-work-item-drawer.test.jsx -t "Details panel by default"`
Expected: FAIL — no tab strip exists yet, so `Attach files`/`Link type` are already visible (not hidden) and there's no `Links`/`Discussion`/`History` text to click or find.

- [ ] **Step 3: Implement the tab strip**

In `apps/desktop/src/create-work-item-drawer.jsx`, add tab state near the other `useState` calls in `CreateWorkItemDrawer` (next to `const [attachmentFiles, setAttachmentFiles] = React.useState([])`):

```jsx
  const [tab, setTab] = React.useState('details')
```

Restructure the body (everything currently between `{loadError && (...)}` and the sticky footer `<div style={{ position: 'sticky', ... }}>`) into:

```jsx
      {loadError && (
        <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {loadError} — click Refresh to retry.
        </div>
      )}

      <div className="wi-tabs" role="tablist">
        <button type="button" className={`wi-tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>Details</button>
        <button type="button" className="wi-tab" disabled title="Available after the item is created">Discussion</button>
        <button type="button" className={`wi-tab${tab === 'links' ? ' active' : ''}`} onClick={() => setTab('links')}>Links</button>
        <button type="button" className={`wi-tab${tab === 'attachments' ? ' active' : ''}`} onClick={() => setTab('attachments')}>Attachments</button>
        <button type="button" className="wi-tab" disabled title="Available after the item is created">History</button>
      </div>

      <div hidden={tab !== 'details'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <SettField label="Project">
            <select aria-label="Project" value={project} onChange={(e) => { setProject(e.target.value); load(e.target.value, typeRef) }}>
              {projectsList.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </SettField>
          <SettField label="Type">
            <select aria-label="Type" value={typeRef} onChange={(e) => { setTypeRef(e.target.value); load(project, e.target.value) }}>
              {(defs?.types || []).map((t) => <option key={t.referenceName} value={t.referenceName}>{t.name}</option>)}
            </select>
          </SettField>
        </div>

        {titleError && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{titleError}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginTop: 14 }}>
          <div>
            {mainFields.map((f) => (
              <MarkdownField
                key={f.referenceName}
                label={f.name}
                required={f.alwaysRequired}
                value={values[f.referenceName] || ''}
                onChange={(v) => setFieldValue(f.referenceName, v)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[statusFields, classificationFields, planningFields, tagsFields].map((group, i) => (
              group.length > 0 && (
                <div key={i} className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {group.map((f) => (
                    <FieldInput
                      key={f.referenceName}
                      def={f}
                      value={values[f.referenceName]}
                      onChange={(v) => setFieldValue(f.referenceName, v)}
                      team={team}
                      paths={defs?.paths || { areas: [], iterations: [] }}
                    />
                  ))}
                </div>
              )
            ))}
            {additionalFields.length > 0 && (
              <div className="drawer-section">
                <h4>Additional Fields</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {additionalFields.map((f) => (
                    <FieldInput
                      key={f.referenceName}
                      def={f}
                      value={values[f.referenceName]}
                      onChange={(v) => setFieldValue(f.referenceName, v)}
                      team={team}
                      paths={defs?.paths || { areas: [], iterations: [] }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div hidden={tab !== 'attachments'} className="drawer-section">
        <h4>Attachments</h4>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Attach files</span>
          <input
            aria-label="Attach files"
            type="file"
            multiple
            onChange={(e) => setAttachmentFiles((prev) => [...prev, ...Array.from(e.target.files)])}
          />
        </label>
        {attachmentFiles.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {attachmentFiles.map((f, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                {f.name}
                <button type="button" className="btn icon ghost sm" style={{ marginLeft: 6 }}
                  onClick={() => setAttachmentFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div hidden={tab !== 'links'} className="drawer-section">
        <h4>Links</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Link type</span>
            <select aria-label="Link type" value={linkRel} onChange={(e) => setLinkRel(e.target.value)}>
              {LINK_TYPES.map((lt) => <option key={lt.rel} value={lt.rel}>{lt.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Linked work item ID</span>
            <input aria-label="Linked work item ID" type="number" value={linkId} onChange={(e) => setLinkId(e.target.value)} />
          </label>
          <button type="button" className="btn sm"
            onClick={() => {
              const id = parseInt(linkId, 10)
              if (!id) return
              setLinks((prev) => [...prev, { rel: linkRel, id }])
              setLinkId('')
            }}>
            + Add link
          </button>
        </div>
        {links.length > 0 && (
          <ul style={{ paddingLeft: 18 }}>
            {links.map((l, i) => (
              <li key={i} style={{ fontSize: 12.5 }}>
                #{l.id} ({LINK_TYPES.find((lt) => lt.rel === l.rel)?.label})
                <button type="button" className="btn icon ghost sm" title="Remove link" style={{ marginLeft: 6 }}
                  onClick={() => setLinks((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
```

(The sticky footer block below stays exactly as it is today — no changes.)

Append to `packages/ui/src/styles/base.css`, right after the `.wi-state-pill { ... }` block added in Task 2:

```css
.wi-tabs { display: flex; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.wi-tab {
  border: none;
  background: transparent;
  padding: 8px 4px;
  margin-right: 18px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.wi-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.wi-tab:disabled { color: var(--text-subtle); opacity: 0.5; cursor: default; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/create-work-item-drawer.test.jsx`
Expected: PASS — all new tab tests, plus every pre-existing test in the file (staging a link/attachment, submitting, error handling) since those elements are still in the DOM, just under `hidden` on non-default tabs, and `fireEvent`/`onChange` work regardless of visibility.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx packages/ui/src/styles/base.css
git commit -m "feat(desktop): add Details/Discussion/Links/Attachments/History tab strip to work item drawer"
```

---

### Task 4: Full-suite regression check

**Files:** none (verification only)

- [ ] **Step 1: Run the full desktop and ui test suites**

Run: `npx vitest run apps/desktop/src/create-work-item-drawer.test.jsx packages/ui/tests/components.test.jsx`
Expected: PASS — 0 failures across both files (this re-confirms Task 1–3's tests together, since Task 3 depends on Task 2's header change and Task 1's Drawer props).

- [ ] **Step 2: Run the full repo test suite**

Run: `npx vitest run`
Expected: PASS — no other file imports `Drawer` with `title`/`badges` in a way `headerContent`'s fallback branch would break (verified in Task 1: `headerContent` only replaces the head content when truthy, so `apps/app/src/app.jsx`, `apps/web/src/app.jsx`, and `packages/ui/src/planner/planner-editors.jsx` render exactly as before).

- [ ] **Step 3: Manually smoke-check in the running app**

Start the desktop app (see the project's existing dev-run instructions), open "New work item," and confirm: the header shows a type icon, a large editable title, and (once field defs load) a State pill; clicking Links/Attachments swaps the panel; Discussion/History are visibly disabled; the drawer opens wider than before.

- [ ] **Step 4: Commit (only if smoke-check turns up fixes)**

If Step 3 finds nothing to fix, no commit is needed here — Tasks 1–3 already committed the full change.
