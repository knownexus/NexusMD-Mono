# Create Work Item Drawer — ADO Parity Design

**Date:** 2026-07-01
**Scope:** `apps/desktop/src/main.jsx`, `apps/desktop/src/ado-client.js`, new `apps/desktop/src/ado-workitem-types.js`, new `apps/desktop/src/create-work-item-drawer.jsx`

## Background

The desktop app's "New work item" button opens `CreateWorkItemModal` (`apps/desktop/src/main.jsx:406-565`) — a centered modal with a fixed, hand-maintained field set per type (Title, Project, Type, Assignee, State, Priority, Tags, Description, and a few type-specific extras). It only supports four hardcoded types and never reflects custom fields, area/iteration path, attachments, or links.

Azure DevOps' real "New work item" form is dynamic: the fields, their required-ness, and allowed values come from the org's process/work item type configuration, and the form has a two-column layout (main content column + status/planning rail). This design replaces `CreateWorkItemModal` with a `<Drawer>`-based component that mirrors that layout and pulls its field set live from ADO, so the desktop app becomes a full substitute for opening the ADO web page to create work items.

---

## Section 1 — Field & path definitions: fetch + cache

### New module: `apps/desktop/src/ado-workitem-types.js`

Exports:
- `async function fetchWorkItemTypes(project)` → `GET {project}/_apis/wit/workitemtypes?api-version=7.0`, returns `[{ name, referenceName, icon, color }]` (excludes `isDisabled` types).
- `async function fetchTypeFields(project, type)` → `GET {project}/_apis/wit/workitemtypes/{type}/fields?api-version=7.0`, returns `[{ referenceName, name, alwaysRequired, defaultValue, allowedValues }]`. Cross-referenced with `GET {project}/_apis/wit/fields/{referenceName}?api-version=7.0` only when `type` (string/html/integer/etc.) is missing from the first response — ADO's per-type fields endpoint omits the data type, so a second batched call (`_apis/wit/fields?api-version=7.0`, fetched once per project and cached) supplies `{referenceName: fieldType}` lookups.
- `async function fetchClassificationPaths(project)` → `GET {project}/_apis/wit/classificationnodes/areas?$depth=10` and `.../iterations?$depth=10`, flattened recursively into `{ areas: string[], iterations: string[] }` of `"Root\Child\Grandchild"` paths.
- `function getCachedDefs(project, type)` / `function setCachedDefs(project, type, defs)` — localStorage under `getProfileKey('ado.wiTypeDefs.' + project + '.' + type)`, JSON-serialized `{ fields, types, paths, fetchedAt }`. No TTL/expiry.
- `async function loadWorkItemTypeDefs(project, type, { forceRefresh } = {})` — the single entry point the drawer calls. Returns cached defs unless `forceRefresh` is true or no cache exists, in which case it fetches all three calls above (`Promise.all`), caches, and returns.

### Field type inference

Each field is classified into a rendering bucket used by the generic renderer (Section 3):
- `html` fields (`System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`, `Microsoft.VSTS.TCM.ReproSteps`, `Microsoft.VSTS.TCM.SystemInfo`, or any field whose ADO type is `html`) → markdown Write/Preview editor.
- `identity` fields (`System.AssignedTo`, or ADO type `identity`) → team member `<select>` (existing `team` prop data), falls back to free-text input if no team match.
- Fields with non-empty `allowedValues` → `<select>` dropdown (covers State, Reason, Priority, Severity, custom picklists).
- `treePath` type or reference name `System.AreaPath`/`System.IterationPath` → path combobox (Section 4).
- `dateTime` → `<input type="date">`.
- `boolean` → checkbox.
- `integer`/`double` → `<input type="number">`.
- Everything else → single-line text input.

---

## Section 2 — Layout: two-column ADO-style body

`CreateWorkItemDrawer` (new file `create-work-item-drawer.jsx`) renders inside the shared `<Drawer>`:

- **Drawer title:** `New {type}` with `<TypeIcon>` badge (same header pattern as `DesktopDetailDrawer`).
- **Drawer actions slot:** "Refresh field definitions" icon button — calls `loadWorkItemTypeDefs(project, type, { forceRefresh: true })` and re-renders.
- **Body, top strip:** Project `<select>`, Type `<select>` (populated from `fetchWorkItemTypes`, replacing the hardcoded 4-type list), and a large Title `<input>` spanning full width.
- **Body, two-column grid** (`display: grid; grid-template-columns: 1fr 280px; gap: 20px`, collapsing to a single column under 700px drawer width, matching the Drawer's existing `isPhone` breakpoint pattern):
  - **Main column:** one `drawer-section` per `html`-bucket field, each using the same Write/Preview markdown textarea UI as `HtmlField` in `work-item-detail.jsx` (extracted into a shared `MarkdownEditor` presentational piece — no save/PATCH per keystroke here, just local state, since the item doesn't exist yet).
  - **Right rail:** one compact field row per remaining known field, grouped into three unlabeled `drawer-section` blocks in this order: **Status** (Assigned To, State, Reason), **Classification** (Area Path, Iteration Path, Priority, Severity), **Planning** (Story Points, Remaining Work, Effort, or whatever Scheduling.* fields the type defines), **Tags**.
  - **Additional Fields section** (bottom of right rail, collapsible like `RawFieldsInspector`): any field returned by `fetchTypeFields` not already claimed by a known bucket above, rendered via the generic type-inferred renderer. This is what gives parity with custom process templates.
- **Attachments section** (Section 5) and **Links section** (Section 6) render below the two-column grid, full width.
- **Footer:** sticky (`position: sticky; bottom: 0; background: var(--surface)`) bar with Cancel / Create buttons and status text, styled like `CreateWIModal`'s footer but pinned to the bottom of the scrollable `drawer-body` instead of a separate flex region (the shared `<Drawer>` component has no footer slot, so this is the pragmatic fit).

### Type/Project switching behavior
Changing Type or Project triggers a new `loadWorkItemTypeDefs` call (cache-first) and resets all field values except Title (preserved, matching today's `prefill.title` behavior via the `nexusmd:create-wi` event detail).

---

## Section 3 — Generic field renderer

A small internal `FieldInput({ def, value, onChange, team, paths })` component switches on the bucket computed in Section 1 and renders the appropriate control. Required fields (`alwaysRequired`) get a `*` suffix on the label and are included in pre-submit validation (Section 7).

---

## Section 4 — Area Path / Iteration Path pickers

Rendered as `<input list="areaPathsList">` / `<input list="iterationPathsList">` with a sibling `<datalist>` populated from the cached flattened path arrays (Section 1). Native, no new dependency, supports typeahead filtering for large trees. Values default to the project root path if the field is required and empty.

---

## Section 5 — Attachments

- Local-only staging: `<input type="file" multiple>` plus a drag-and-drop zone (reuse the drawer's body as the drop target). Staged files render as a removable chip list (name + size), no upload happens yet.
- On Create (Section 7 step 3): for each staged file, `POST {project}/_apis/wit/attachments?fileName={name}&api-version=7.0` with the raw file body (`Content-Type: application/octet-stream`) → returns `{ id, url }`. Collect all successes, then issue one follow-up PATCH to the newly created work item adding one `AttachedFile` relation per uploaded attachment.
- Failures are collected, not thrown: the create flow finishes (or fails) independently of attachment upload outcomes.

---

## Section 6 — Links / Relations

- "+ Add link" row: link-type `<select>` (Parent, Child, Related, Predecessor, Successor, Duplicate, Duplicate Of — mapped to the ADO `rel` URNs: `System.LinkTypes.Hierarchy-Reverse`, `-Forward`, `System.LinkTypes.Related`, `System.LinkTypes.Dependency-Reverse`, `-Forward`, `System.LinkTypes.Duplicate-Forward`, `-Reverse`) + work item ID `<input type="number">` + "Preview" button that does a one-off `GET {project}/_apis/wit/workitems/{id}?api-version=7.0` to show the target title inline before staging.
- Staged links render as a removable list (`#1234 — <title> (Parent)`).
- On Create (Section 7 step 4): one PATCH per staged link (or a single combined PATCH with multiple relation `add` ops), using `System.LinkTypes.*` `rel` values and `vstfs:///WorkItemTracking/WorkItem/{id}` URLs.
- Same failure-collection behavior as attachments.

---

## Section 7 — Submit flow & validation

1. **Validate:** Title and Project required (existing behavior); any field with `alwaysRequired: true` from the fetched definitions must be non-empty, with inline error text under the field (not just the footer status line).
2. **Create:** build the JSON-patch document from all populated known + additional fields, `POST {project}/_apis/wit/workitems/${type}?api-version=7.0`. This is the only step that must succeed for the operation to count as successful.
3. **Attach** staged files (Section 5), collecting per-file success/failure.
4. **Link** staged relations (Section 6), collecting per-link success/failure.
5. **Report:** if steps 3/4 have zero failures, show "Created #{id}." and close after the existing 600ms delay. If there are failures, show "Created #{id} — {n} attachment(s)/{m} link(s) failed" and keep the drawer open with a "Close" button so the user can see which ones failed (failed items stay in their staged lists, marked with an error badge, so the user can retry without re-entering everything).

### `desktopWorkItemSource.createWorkItem` — signature change

Replace the current fixed-parameter signature (`main.jsx:191`) with:
```js
async createWorkItem({ project, type, fields /* { referenceName: value } */, attachments /* File[] */, links /* [{rel, id}] */ })
```
The patch-doc building logic (currently inline per named field) becomes a simple `Object.entries(fields).map(...)`, since the drawer now supplies ADO reference names directly rather than named JS parameters. This is the only breaking change to existing code; `CreateWorkItemModal` is deleted in the same change, so there are no other callers to update.

---

## Out of scope

- Editing the Process/Work Item Type definitions themselves.
- Discussion/comments on the new item before it's created (ADO's own create form doesn't support this either — comments only exist after creation, which this drawer also follows).
- Full ADO "rules" engine (conditional required fields based on other field values) — required-ness is taken at face value from `alwaysRequired`, not re-evaluated live as the user edits other fields.
