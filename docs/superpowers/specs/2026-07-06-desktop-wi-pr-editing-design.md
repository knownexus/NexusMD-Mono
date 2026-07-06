# Desktop Work Item & Pull Request Editing

## Goals

Bring the desktop app drawer (`apps/desktop`) up to parity with the mobile app (`apps/app`) for Work Item field editing, and extend Pull Request support beyond what either app currently has (mobile has no PR description editing).

Desktop's drawer was deliberately scoped down to a minimal read-only summary when it was rebuilt (`docs/superpowers/plans/2026-07-01-desktop-parity.md`, Task 4). This is not restoring lost functionality — it's porting mobile's existing richer behavior to desktop for the first time, plus adding one new capability (PR description editing).

## Scope

**In scope:**
- Work items: State, Assignee, Priority, Area, Tags editors in the desktop drawer, matching `WIDetail` in `apps/app/src/app.jsx:2187`. (Description, Acceptance Criteria, Repro Steps, and the comment thread already work via the shared `WorkItemDetail` component and are unaffected.)
- Pull requests, replacing the current read-only `DesktopPRDetail`:
  - Overview tab: description (read **and edit** — new, not present on mobile), reviewers, linked work items, comment threads (list, add top-level comment, reply to a thread, resolve/reopen a thread).
  - Commits tab: list of commits.
  - Files tab: list of changed files with expandable inline diffs.

**Out of scope:**
- PR voting, UAT branch push (mobile-only, unrelated to this request).
- Any refactor of `apps/app/src/app.jsx` — mobile's existing inline implementation stays as-is. The new shared logic in `packages/core`/`packages/ui` is additive; mobile is not migrated to it in this effort.
- Work item creation flow, backend/proxy work — desktop remains direct-to-ADO via `createAdoHttpAdapter()`.

## Architecture

### `packages/core/src/modules/ado/pr-collab.js` (new)

Pure functions taking an injected `http` adapter (`{ fetch(path, opts) }`), following the same pattern as `loader.js`'s internal `get`/`post` helpers. Ported from the logic embedded in `apps/app/src/app.jsx`'s `PRCommitsTab`, `PRFilesTab`, and `PRDetail` (thread functions), decoupled from React state:

- `fetchPRThreads(http, { project, repoId, prId })`
- `postPRThread(http, { project, repoId, prId, content })`
- `postPRReply(http, { project, repoId, prId, threadId, parentCommentId, content })`
- `setPRThreadStatus(http, { project, repoId, prId, threadId, status })`
- `fetchPRCommits(http, { project, repoId, prId })`
- `fetchPRFileChanges(http, { project, repoId, prId })` (resolves latest iteration, then its changes)
- `fetchFileContent(http, { project, repoId, path, commitId })`
- `updatePRDescription(http, { project, repoId, prId, description })` — new capability; PATCHes `pullRequests/{id}` with `{ description }`.

### `packages/core/src/modules/ado/helpers.js`

No change needed — `STATES` is already exported as a static constant; desktop imports it directly instead of hardcoding a duplicate list.

### `packages/core/src/modules/ado/wi-collab.js` (new, small)

- `fetchAreaPaths(http, { project })` — ports the ad hoc area-path fetch currently only in `apps/app/src/app.jsx` (used by `AreaTreePicker`), so desktop's Area editor has data to work with. No shared cache/loader integration — a simple on-demand fetch is sufficient.

### `packages/ui` additions

- `AreaTreePicker` and `TagInput`, ported from `apps/app/src/app.jsx:1163` and `:789` into `packages/ui/src/app-components.jsx`. Mobile keeps its local copies untouched; desktop imports the shared versions.
- `WorkItemFieldsEditor` — new component in `packages/ui/src/views/work-item-detail.jsx` rendering the State/Assignee/Priority/Area/Tags block (the `<dl className="kv">` section of mobile's `WIDetail`), using the optimistic-patch pattern below. Desktop renders `<WorkItemFieldsEditor>` followed by the existing `<WorkItemDetail>`, mirroring how mobile's `WIDetail` composes its own fields block with the shared `WorkItemDetail`.
- `PRTabs` — new component replacing `DesktopPRDetail`, providing the Overview/Commits/Files tab shell, description view/edit, reviewer/linked-work-item display, and the comment-thread panel (list, resolve/reopen toggle, reply box, top-level add-comment box). Ported UI structure from `apps/app/src/app.jsx:2551` (`PRDetail`), `:2339` (`PRCommitsTab`), `:2387` (`PRFilesTab`), built on `pr-collab.js` instead of inline `adoGet/adoPost/adoPut/adoPatch` calls.

### `apps/desktop/src/main.jsx`

- No changes needed to `desktopWorkItemSource.saveField` — State/Assignee/Priority/Area/Tags edits all go through the existing generic field-PATCH method (ADO field paths are uniform JSON-patch operations).
- Add `desktopPRSource`: `loadThreads`, `postThread`, `postReply`, `setThreadStatus`, `loadCommits`, `loadFileChanges`, `loadFileContent`, `updateDescription` — thin wrappers calling `pr-collab.js` functions with `createAdoHttpAdapter()`, same shape/placement as `desktopWorkItemSource` (`main.jsx:134-200`).
- Add `desktopWorkItemSource.loadAreaPaths(project)` wrapping `wi-collab.js`'s `fetchAreaPaths`.
- Update `DesktopDetailDrawer` (`main.jsx:325-376`): pass `desktopPRSource` and the area-paths loader down; render `<WorkItemFieldsEditor>` + `<WorkItemDetail>` for `kind === 'wi'`, and `<PRTabs>` (instead of `<DesktopPRDetail>`) for `kind === 'pr'`.

## Data flow / optimistic updates

Work-item field edits reuse the exact optimistic pattern already used by desktop's "Mark done" button and mobile's `WIDetail.patch()` (`app.jsx:2202`): snapshot local state → apply the change immediately → PATCH ADO → on failure, roll back and toast an error; on success, update the parent item list (`setItems`) and toast success.

PR thread/reply/resolve/description mutations follow the same snapshot → apply → mutate → rollback-on-failure shape, ported from mobile's `postComment`, `postReply`, `resolveThread` (`app.jsx:2638-2704`).

## Error handling

No new patterns: `toast()` (`packages/ui/src/toast.jsx`) for success/failure feedback, and per-panel `{ status: 'idle' | 'loading' | 'ok' | 'error', error }` state for the Commits/Files tabs, matching `PRCommitsTab`/`PRFilesTab`'s existing `state.status` convention.

## Testing

Run from each package's own directory per this repo's test-runner setup (workspace/jsdom gap when run from repo root):

- `packages/core`: unit tests for every `pr-collab.js` and `wi-collab.js` function — mock `http.fetch`, assert request method/URL/body shape for each endpoint, including the new `updatePRDescription`.
- `packages/ui`: component tests for `WorkItemFieldsEditor` (field edit → optimistic update → rollback on PATCH failure) and `PRTabs` (thread resolve/reopen toggle, reply posting, top-level comment posting, description edit save/cancel, tab switching, file-diff expand).
