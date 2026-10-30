# Work Item Drawer — Example Agile Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the New Work Item drawer's Details tab using Example's real per-type Azure DevOps field layout (Bug/Epic/Feature/Issue/Task) instead of the current generic bucket-based grouping, while leaving every other project/process template on today's unchanged fallback path.

**Architecture:** A pure, independently-testable `resolveTypeLayout(typeName, fields)` function in `ado-workitem-types.js` maps a `TYPE_LAYOUTS` config (field display names, per type, per column) onto the live field defs ADO returns. `CreateWorkItemDrawer` calls it once per render; when it returns a layout, the Details tab renders two equal columns (Left: stacked multi-line fields, Middle: Acceptance Criteria + Planning group + Additional Fields catch-all) instead of today's `1fr 280px` main+rail split. When it returns `null` (unknown type), the existing generic rendering path is untouched.

**Tech Stack:** React, Vitest + @testing-library/react, existing `@nexusmd/ui` package.

## Global Constraints

- Fields are matched by **display name** (`field.name`), not reference name — several of Example's fields (Resolved Reason, Risk, Effort, Stack Rank, Activity, Stages) have unverified reference names; a name that doesn't match a field returned by ADO must degrade to the "Additional Fields" section, never crash or silently drop data.
- `fieldBucket`, `fieldGroup`, `KNOWN_FIELD_GROUPS`, and the existing generic rendering path in `CreateWorkItemDrawer` must be unchanged and still used for any type not in `TYPE_LAYOUTS` — no regression for other projects/process templates.
- The System.State field continues to render exactly once, in the drawer header (established in a prior feature) — it must never appear in a type layout's `left`/`middleTop`/`planning`/`additional` output.
- No changes to the create/submit/attachment/link API flow — this is a layout-only change.
- **Test-fixture interaction to watch:** the drawer's `DEFAULT_TYPE_REF` is `Microsoft.VSTS.WorkItemTypes.Task` (`create-work-item-drawer.jsx:129`), and the existing test file's `stubDefs()`/`stubDefsWithState()` helpers both declare a work item type named `'Task'` (`create-work-item-drawer.test.jsx:84,97`). Once `TYPE_LAYOUTS` includes a `'Task'` entry, every pre-existing test using these helpers automatically exercises the new per-type layout path instead of the old generic path — none of their fixture fields (`Description`, `Assigned To`, `Risk Level`, `State`, `Reason`) match Task's `left`/`middleTop`/`planning` names (`['Description', 'System Info']` / `'Acceptance Criteria'` / `['Area', 'Priority', 'Activity']`) except `Description`, so the rest correctly fall through to Additional Fields. This must not break any pre-existing test's `getByLabelText`/`getByText` assertions, since `FieldInput` renders identically regardless of which section contains it — Task 3 verifies this explicitly.

---

### Task 1: `TYPE_LAYOUTS` config and `resolveTypeLayout` matching function

**Files:**
- Modify: `apps/desktop/src/ado-workitem-types.js` (insert after `fieldGroup`, currently ending at line 127, before `export const LINK_TYPES` at line 129)
- Test: `apps/desktop/src/ado-workitem-types.test.js`

**Interfaces:**
- Produces: `export const TYPE_LAYOUTS` — an object keyed by work item type **name** (e.g. `"Bug"`), each value `{ left: string[], middleTop: string|null, planning: string[] }` of field **display names**.
- Produces: `export function resolveTypeLayout(typeName, fields)` — `fields` is the array shape already used elsewhere in this file (`{ referenceName, name, dataType, allowedValues, alwaysRequired }[]`). Returns `null` if `typeName` has no `TYPE_LAYOUTS` entry. Otherwise returns `{ left: Field[], middleTop: Field|null, planning: Field[], additional: Field[] }` — `left`/`planning` contain only the fields that actually matched (by `f.name`) an entry in the config, in config order; unmatched config names are silently skipped. `additional` contains every field in `fields` not selected into `left`/`middleTop`/`planning` and not `System.State`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/ado-workitem-types.test.js`, after the existing `describe('fieldGroup', ...)` block (after line 181):

```js
describe('TYPE_LAYOUTS / resolveTypeLayout', () => {
  it('returns null for a type with no configured layout', () => {
    expect(resolveTypeLayout('CustomThing', [])).toBe(null)
  })

  it('resolves Bug fields into left, middleTop, planning, and additional, in config order', () => {
    const fields = [
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false },
      { referenceName: 'System.AreaPath', name: 'Area', dataType: 'treePath', allowedValues: [], alwaysRequired: false },
    ]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.left.map((f) => f.name)).toEqual(['Description', 'Repro Steps'])
    expect(layout.middleTop.name).toBe('Acceptance Criteria')
    expect(layout.planning.map((f) => f.name)).toEqual(['Area', 'Priority'])
    expect(layout.additional.map((f) => f.name)).toEqual(['Assigned To'])
  })

  it('skips config field names that have no matching field, without throwing', () => {
    const fields = [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.left.map((f) => f.name)).toEqual(['Description'])
    expect(layout.middleTop).toBe(null)
    expect(layout.planning).toEqual([])
    expect(layout.additional).toEqual([])
  })

  it('excludes System.State from additional even when unmatched by the layout', () => {
    const fields = [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.State', name: 'State', dataType: 'string', allowedValues: ['New'], alwaysRequired: false },
    ]
    const layout = resolveTypeLayout('Bug', fields)
    expect(layout.additional).toEqual([])
  })

  it('returns null middleTop for Issue, which has no Acceptance Criteria in its layout', () => {
    const layout = resolveTypeLayout('Issue', [{ referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false }])
    expect(layout.middleTop).toBe(null)
  })
})
```

Update the import line at the top of the test file (currently line 2) to include the two new exports:

```js
import { getCachedDefs, setCachedDefs, fetchWorkItemTypes, fetchProjectFieldTypes, fetchTypeFields, fetchClassificationPaths, loadWorkItemTypeDefs, fieldBucket, fieldGroup, TYPE_LAYOUTS, resolveTypeLayout, LINK_TYPES, buildFieldPatchOps, buildAttachmentRelationOps, buildLinkRelationOps, submitNewWorkItem } from './ado-workitem-types.js'
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/desktop/`): `npx vitest run src/ado-workitem-types.test.js -t "TYPE_LAYOUTS"`
Expected: FAIL — `resolveTypeLayout`/`TYPE_LAYOUTS` are not exported yet (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Implement `TYPE_LAYOUTS` and `resolveTypeLayout`**

In `apps/desktop/src/ado-workitem-types.js`, insert after line 127 (the end of `fieldGroup`), before line 129 (`export const LINK_TYPES`):

```js
export const TYPE_LAYOUTS = {
  Bug: {
    left: ['Description', 'Repro Steps', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Resolved Reason', 'Story Points', 'Priority'],
  },
  Epic: {
    left: ['Description', 'Stages'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk', 'Effort'],
  },
  Feature: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Risk'],
  },
  Issue: {
    left: ['Description'],
    middleTop: null,
    planning: ['Area', 'Stack Rank', 'Priority', 'Due Date'],
  },
  Task: {
    left: ['Description', 'System Info'],
    middleTop: 'Acceptance Criteria',
    planning: ['Area', 'Priority', 'Activity'],
  },
}

export function resolveTypeLayout(typeName, fields) {
  const layout = TYPE_LAYOUTS[typeName]
  if (!layout) return null

  const byName = (name) => fields.find((f) => f.name === name)
  const left = layout.left.map(byName).filter(Boolean)
  const middleTop = layout.middleTop ? (byName(layout.middleTop) || null) : null
  const planning = layout.planning.map(byName).filter(Boolean)

  const selectedRefNames = new Set([...left, ...(middleTop ? [middleTop] : []), ...planning].map((f) => f.referenceName))
  const additional = fields.filter((f) => !selectedRefNames.has(f.referenceName) && f.referenceName !== 'System.State')

  return { left, middleTop, planning, additional }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ado-workitem-types.test.js`
Expected: PASS — all tests in the file, including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/ado-workitem-types.js apps/desktop/src/ado-workitem-types.test.js
git commit -m "feat(desktop): add per-type field layout config for Example Agile process"
```

---

### Task 2: Wire `resolveTypeLayout` into the Details tab's two-column rendering

**Files:**
- Modify: `apps/desktop/src/create-work-item-drawer.jsx:166-174` (field derivation) and `:263-290` (Details tab grid)
- Test: `apps/desktop/src/create-work-item-drawer.test.jsx`

**Interfaces:**
- Consumes: `resolveTypeLayout(typeName, fields)` from Task 1 — returns `null` or `{ left, middleTop, planning, additional }` (arrays of field defs, same shape as elsewhere in this file).
- Produces: no new exports — this is the terminal consumer. `CreateWorkItemDrawer`'s Details tab now branches: `resolveTypeLayout(typeName, fields)` truthy → new two-column (`1fr 1fr`) Left/Middle grid; falsy → today's unchanged `1fr 280px` main+rail grid.

- [ ] **Step 1: Write the failing tests**

Add a new stub helper and `describe` block to `apps/desktop/src/create-work-item-drawer.test.jsx`, after the existing `stubDefsWithState()` function (after line 100):

```jsx
function stubDefsForBug() {
  vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
    fields: [
      { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria', dataType: 'html', allowedValues: [], alwaysRequired: false },
      { referenceName: 'System.AreaPath', name: 'Area', dataType: 'treePath', allowedValues: [], alwaysRequired: false },
      { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false },
      { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false },
    ],
    paths: { areas: [], iterations: [] },
    types: [{ name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', icon: '', color: '' }],
    fetchedAt: Date.now(),
  })
}
```

Add a new `describe` block at the end of the file:

```jsx
describe('CreateWorkItemDrawer per-type layout', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a two-column Left/Middle layout for a known type (Bug), in config order', async () => {
    stubDefsForBug()
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Microsoft.VSTS.WorkItemTypes.Bug' } })
    await screen.findByLabelText('Description')

    // Left column: Description then Repro Steps (System Info absent from this fixture — skipped, not blank)
    const description = screen.getByLabelText('Description')
    const reproSteps = screen.getByLabelText('Repro Steps')
    expect(description.compareDocumentPosition(reproSteps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Middle column: Acceptance Criteria present, then Planning fields (Area, Priority) — Resolved Reason/Story Points absent from fixture, skipped
    expect(screen.getByLabelText('Acceptance Criteria')).toBeTruthy()
    expect(screen.getByLabelText('Area')).toBeTruthy()
    expect(screen.getByLabelText('Priority')).toBeTruthy()

    // Additional Fields: Assigned To isn't in Bug's left/middleTop/planning config
    expect(screen.getByText('Additional Fields')).toBeTruthy()
    expect(screen.getByLabelText('Assigned To')).toBeTruthy()
  })

  it('falls back to the generic grouped layout for an unrecognized type', async () => {
    vi.spyOn(adoWorkItemTypes, 'loadWorkItemTypeDefs').mockResolvedValue({
      fields: [
        { referenceName: 'System.Description', name: 'Description', dataType: 'html', allowedValues: [], alwaysRequired: false },
        { referenceName: 'Custom.Whatever', name: 'Whatever', dataType: 'string', allowedValues: [], alwaysRequired: false },
      ],
      paths: { areas: [], iterations: [] },
      types: [{ name: 'CustomThing', referenceName: 'Custom.WorkItemTypes.CustomThing', icon: '', color: '' }],
      fetchedAt: Date.now(),
    })
    render(<CreateWorkItemDrawer open={true} title="" project={['ProjectA']} team={[]} onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'Custom.WorkItemTypes.CustomThing' } })
    await screen.findByLabelText('Description')

    // Falls into Additional Fields exactly as today's generic path does for unrecognized reference names
    expect(screen.getByText('Additional Fields')).toBeTruthy()
    expect(screen.getByLabelText('Whatever')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/create-work-item-drawer.test.jsx -t "per-type layout"`
Expected: FAIL — the drawer still renders the old `mainFields`/rail-group layout for every type, so `Repro Steps`/`Acceptance Criteria`/`Area` (Bug-specific fixture fields) don't yet render as a Left/Middle split and `Additional Fields` doesn't yet contain `Assigned To` in that arrangement (it would currently be under the status rail group instead, un-labeled section, but still findable — the ordering assertion for Description/Repro Steps in the same left column is what actually fails, since today's `mainFields` only contains `Description` because `Repro Steps` isn't in `HTML_FIELDS` unless its `dataType` is `'html'`... it is `'html'` in this fixture, so it WOULD already render as a main field today; the real failing assertion is `Area`/`Priority` appearing without `Assigned To`/`Resolved Reason`-shaped generic grouping, and `Additional Fields` heading not yet present for this fixture since `additionalFields` may be empty under the old bucket path). Confirm the actual failure reason in your terminal output rather than assuming — the important thing is Step 4 passes once implemented.

- [ ] **Step 3: Implement the two-column rendering**

In `apps/desktop/src/create-work-item-drawer.jsx`, add the import (top of file, alongside the existing `ado-workitem-types.js` import — check the current import line and add `resolveTypeLayout` to it):

```jsx
import { fieldBucket, fieldGroup, LINK_TYPES, resolveTypeLayout } from './ado-workitem-types.js'
```

After the existing field-derivation block (after `const stateField = fields.find(...)`, currently line 174), add:

```jsx
  const typeLayout = resolveTypeLayout(typeName, fields)
```

Replace the Details tab's field grid (currently `apps/desktop/src/create-work-item-drawer.jsx:263-290`, the `<div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', ... }}>...</div>` block) with a conditional:

```jsx
        {typeLayout ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 14 }}>
            <div>
              {typeLayout.left.map((f) => (
                <MarkdownField
                  key={f.referenceName}
                  label={f.name}
                  required={f.alwaysRequired}
                  value={values[f.referenceName] || ''}
                  onChange={(v) => setFieldValue(f.referenceName, v)}
                />
              ))}
            </div>
            <div>
              {typeLayout.middleTop && (
                <MarkdownField
                  label={typeLayout.middleTop.name}
                  required={typeLayout.middleTop.alwaysRequired}
                  value={values[typeLayout.middleTop.referenceName] || ''}
                  onChange={(v) => setFieldValue(typeLayout.middleTop.referenceName, v)}
                />
              )}
              {typeLayout.planning.length > 0 && (
                <div className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {typeLayout.planning.map((f) => (
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
              )}
              {typeLayout.additional.length > 0 && (
                <div className="drawer-section">
                  <h4>Additional Fields</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {typeLayout.additional.map((f) => (
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
        ) : (
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
        )}
```

The `else` branch is the exact pre-existing JSX (unchanged), just moved under the conditional — this is what makes the fallback path a true no-op for unknown types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/create-work-item-drawer.test.jsx`
Expected: PASS — all tests in the file, including the 2 new ones in `'CreateWorkItemDrawer per-type layout'`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/create-work-item-drawer.jsx apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "feat(desktop): render per-type Left/Middle field layout in work item drawer"
```

---

### Task 3: Full regression check — pre-existing tests under the new default-type layout path

**Files:** none (verification only)

**Context:** per the Global Constraints note, `DEFAULT_TYPE_REF` is Task, and `TYPE_LAYOUTS` now has a `'Task'` entry — every pre-existing test that renders `CreateWorkItemDrawer` without explicitly switching type now exercises the new two-column path instead of the old generic one. This task confirms nothing broke.

- [ ] **Step 1: Run the full `create-work-item-drawer.test.jsx` suite**

Run (from `apps/desktop/`): `npx vitest run src/create-work-item-drawer.test.jsx`
Expected: PASS — every pre-existing test (submit flow, link staging/removal, attachment staging, error handling, header/State tests, tab-switching tests) plus the 2 new per-type-layout tests from Task 2. If any pre-existing test fails, read its failure carefully: the most likely cause is a field that Task 1's `TYPE_LAYOUTS.Task` config unexpectedly matches (or fails to match) against that test's fixture `field.name` values — fix by adjusting the specific fixture in that test (not `TYPE_LAYOUTS`, which must stay faithful to the design spec) unless the test's own assertion was about a section/grouping detail that's legitimately different now (in which case update the assertion to check the field is still present via `getByLabelText`, not which section it's in).

- [ ] **Step 2: Run the full `ado-workitem-types.test.js` suite**

Run: `npx vitest run src/ado-workitem-types.test.js`
Expected: PASS — all tests, including Task 1's 5 new ones.

- [ ] **Step 3: Run the full `packages/ui` suite** (unaffected by this change, but confirms no cross-package breakage)

Run (from `packages/ui/`): `npx vitest run tests/components.test.jsx`
Expected: PASS — 18/18 (unchanged from before this feature; this task touches no `packages/ui` files).

- [ ] **Step 4: Commit** (only if Step 1 required fixture fixes)

If Step 1 passed with no changes needed, no commit — Tasks 1–2 already committed the full change. If a pre-existing test's fixture needed adjustment:

```bash
git add apps/desktop/src/create-work-item-drawer.test.jsx
git commit -m "test(desktop): adjust pre-existing drawer test fixtures for per-type layout"
```
