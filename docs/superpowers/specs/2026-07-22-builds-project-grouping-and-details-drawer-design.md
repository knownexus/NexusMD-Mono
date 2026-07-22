# Builds: Group by Project, Project Column, Details Drawer

## Goals

The Builds page (`packages/ui/src/views/view-builds.jsx`, shared across `apps/desktop`,
`apps/app`, `apps/web`) already aggregates pipelines from every configured project into one list,
but groups rows by pipeline name only, with no project-level grouping. The `Project` column
already exists but sits right after `Build #`, not next to `Branch`. Clicking a build row does
nothing today — there's no way to see a failed build's actual error beyond the short
`failureReason` string already shown inline. This design:

1. Groups the builds table by project first, then by pipeline within each project.
2. Moves the `Project` column to sit immediately before `Branch`.
3. Makes build rows clickable, opening a details drawer with full build metadata.
4. For failed/partial/cancelled builds, the drawer fetches and shows which stage/job/task failed
   and why (via Azure DevOps's build timeline API), not just the one-line `failureReason`.

## Scope

**In scope:**
- `packages/ui/src/views/view-builds.jsx`: project→pipeline nested grouping, replacing the
  current pipeline-only grouping. Pipeline visibility filter dropdown keeps its existing
  per-pipeline checkboxes, now visually grouped under project sub-headings.
- `packages/core/src/modules/ado/field-visibility.js`: reorder `BUILDS_TABLE_COLUMNS` so
  `project` sits immediately before `branch`.
- A new shared `BuildDetail` component (`packages/ui/src/views/build-detail.jsx`), modeled on
  the existing `WorkItemDetail` (`packages/ui/src/views/work-item-detail.jsx`).
- A new data seam, `packages/ui/src/views/build-source.js` (mirrors `work-item-source.js`), plus
  a `buildSource` field on `NexusDataProvider`'s `DEFAULTS` (`packages/ui/src/data-context.jsx`).
- A new `mapBuildTimeline` helper in `packages/core/src/modules/ado/mappers.js`.
- Desktop-only wiring: `apps/desktop/src/main.jsx` gains `openBuild`, a `kind: 'build'` branch in
  `DesktopDetailDrawer`, and a `desktopBuildSource` implementation that calls Azure DevOps
  directly via the existing `createAdoHttpAdapter()`.

**Out of scope:**
- `apps/app` and `apps/web` do not get the build details drawer in this pass — they use an older,
  separately-duplicated drawer implementation (local `DetailDrawer` in each app's `app.jsx`) that
  isn't part of the `packages/ui` shared-component migration this repo is otherwise moving
  towards. Wiring them up is a separate, later effort.
- Fetching or displaying full build logs (`_apis/build/builds/{id}/logs/{logId}`). The timeline
  API's per-record `issues[].message` already carries the actual error text (e.g.
  `##[error]Package restore failed`) and is enough to show "why it failed" without pulling
  potentially large log blobs. The drawer's "Open in ADO" action remains the escape hatch for
  full logs.
- Any change to the `/api/builds/queue|cancel` action endpoints or the build list fetch
  (`packages/core/src/modules/ado/loader.js`'s `buildsP`) — those are unaffected.
- A project-level (as opposed to per-pipeline) visibility filter. The existing per-pipeline
  filter is kept as-is, just re-presented grouped by project.
- Any change to `mapBuild`'s existing fields (`id`, `project`, `pipeline`, `status`, `branch`,
  `failureReason`, etc.) — the new timeline data is fetched separately, on-demand, only when the
  drawer opens.

## Data flow

```
BuildsView (packages/ui/src/views/view-builds.jsx)
  grouped = Map<project, Map<pipeline, runs[]>>            [was: Map<pipeline, runs[]>]
      │ row onClick (stopPropagation already used by inner buttons/links, so this is safe)
      ▼
onOpenBuild(b)                                              [new optional prop, no-op if absent]
      │
      ▼
App (apps/desktop/src/main.jsx)
  openBuild = b => setDrawer({ kind: 'build', data: b })    [new, alongside openItem/openPR/openPerson]
      │
      ▼
DesktopDetailDrawer
  kind === 'build' → title = pipeline name, badge = #id + status dot,
                     action = "Open in ADO" (build results URL, same URL shape already
                     used by the `build` column's link)
      │
      ▼
BuildDetail({ build })                                      [new, packages/ui]
  — renders static metadata immediately: project, branch, commit, actor, reason, duration,
    start/finish time (all already on `build`, no fetch needed for this part)
  — if build.status is failed/partial/cancelled: on mount, calls
    buildSource.loadTimeline(build.project, build.id) from useNexusData()
  — loading → "Loading errors…"; error → red error line (same pattern as WorkItemDetail)
  — success → list of failed records: { name, type, messages[] }, each rendered as a small
    card (stage/job/task name + its issue messages)
      │
      ▼
buildSource (packages/ui/src/views/build-source.js — new seam, mirrors work-item-source.js)
  default: apiBuildSource.loadTimeline(project, id)
    → GET /api/builds/${id}/timeline?project=${project}        [web-host proxy; not implemented
                                                                  in this pass since scope is
                                                                  desktop-only — see Error handling]
  desktop: desktopBuildSource.loadTimeline(project, id)
    → createAdoHttpAdapter().fetch(`${project}/_apis/build/builds/${id}/timeline?api-version=7.0`)
    → raw timeline JSON → mapBuildTimeline(raw) (packages/core/src/modules/ado/mappers.js)
    → { failedRecords: [{ name, type, messages: string[] }] }
```

`data-context.jsx`'s `DEFAULTS` gains `buildSource: apiBuildSource`, mirroring `workItemSource`.
Desktop's `NexusDataProvider` value gains `buildSource: desktopBuildSource` alongside its existing
`workItemSource: desktopWorkItemSource`.

## Component changes

### `packages/ui/src/views/view-builds.jsx`

- `grouped` memo becomes two-level: group `filteredBuilds` by `project` first (insertion order or
  alphabetical, matching current pipeline-name sort), then by `pipeline` within each project group.
- `collapsed` state keys become composite: `project` name for the outer group, `` `${project}::${pipeline}` `` for
  the inner group. Existing "Collapse all" / "Expand all" buttons set/clear both levels.
- Render: outer project header row (same visual weight as the current pipeline header — name,
  total run count, sparkline over all of the project's runs) containing nested pipeline header
  rows (as today) containing build rows.
- The "Pipelines" filter dropdown (`pipelineMenuOpen` block) keeps its flat `allPipelines`
  checkbox list but adds a non-interactive project-name sub-heading before each project's
  pipelines, computed from a `Map<pipeline, project>` built alongside `allPipelines`.
- Build rows: add `onClick={() => onOpenBuild?.(b)}` on the row `div` (already has
  `cursor:pointer`); no change needed to existing per-cell `stopPropagation()` calls on the
  build-link anchor and action buttons.
- `BuildsView` signature gains `onOpenBuild` (optional, defaults to undefined/no-op) as a new
  prop, alongside the existing `builds`, `acknowledgedBuilds`, etc.

### `packages/core/src/modules/ado/field-visibility.js`

- `BUILDS_TABLE_COLUMNS`: move the `{ key: 'project', ... }` entry from index 2 (after `build`) to
  sit immediately before `{ key: 'branch', ... }`. New order: `status, build, triggeredBy, project,
  branch, commit, reason, duration, date, actions`.

### `packages/ui/src/views/build-source.js` (new)

- Mirrors `work-item-source.js`'s shape: `apiBuildSource` (default, hits a `/api/builds/*`
  timeline proxy), `setBuildSource`/`getBuildSource` module-level mirror (kept for symmetry even
  though nothing prefetches builds today), consumed via `useNexusData().buildSource`.
- `apiBuildSource.loadTimeline(project, id)`: `GET /api/builds/${id}/timeline?project=${encodeURIComponent(project)}`,
  returns `{ failedRecords: [] }` shape (empty array, not an error, if the endpoint 404s — see
  Error handling, since the underlying web-host endpoint isn't implemented in this pass).

### `packages/core/src/modules/ado/mappers.js`

- New `mapBuildTimeline(raw)`: takes the raw ADO timeline response (`{ records: [...] }`), filters
  to `records` where `result === 'failed'` and `type` is one of `Stage`/`Phase`/`Job`/`Task`,
  and maps each to `{ name: r.name, type: r.type, messages: (r.issues || []).map(i => i.message) }`.
  Returns `{ failedRecords }`.

### `packages/ui/src/views/build-detail.jsx` (new)

- `BuildDetail({ build })`: reads `buildSource` from `useNexusData()`.
- Renders a metadata block unconditionally from `build` (no fetch): project, branch (mono pill,
  same styling as the table's branch cell), commit, actor/avatar, reason, duration, finish time.
- If `['failed','partial','cancelled'].includes(build.status)`: on mount, calls
  `buildSource.loadTimeline(build.project, build.id)`, tracks `loading`/`error`/`failedRecords`
  state exactly like `WorkItemDetail`'s `detail`/`comments`/`loading`/`error` — loading text,
  red error text on catch (`e.message || 'Failed to load'`), otherwise renders each failed record
  as a small card (name + type badge + its `messages` as separate lines). Empty `failedRecords`
  (e.g. a `cancelled` build with nothing that actually failed) renders "No failure details
  available" rather than an empty section.
- If `build.status` is `success`/`running`, the Errors section is omitted entirely.

### `apps/desktop/src/main.jsx`

- Add `openBuild = b => setDrawer({ kind: 'build', data: b })` next to `openItem`/`openPR`/`openPerson`.
- `DesktopDetailDrawer`: extend the `kind` union with `'build'`. Title = `d.pipeline`. Badge =
  `#id` (mono, matches `wi`/`pr` badge styling) + a small status dot reusing the table's
  `dotClass`/`sparkColor` maps (import from view-builds or duplicate the tiny lookup — prefer
  importing to avoid drift). `adoUrl` gains a `kind === 'build'` case building the same
  `https://dev.azure.com/{org}/{project}/_build/results?buildId={id}` URL already used by the
  `build` column's link in `view-builds.jsx`. Body: `<BuildDetail build={d} />`.
- Add `desktopBuildSource` object (new, alongside `desktopWorkItemSource`):
  `loadTimeline(project, id)` → `createAdoHttpAdapter().fetch(`${encodeURIComponent(project)}/_apis/build/builds/${id}/timeline?api-version=7.0`)`,
  throws `HTTP ${res.status}` on non-ok, otherwise `mapBuildTimeline(await res.json())`.
- Wherever `BuildsView` is rendered on desktop, pass `onOpenBuild={openBuild}`.
- `NexusDataProvider` value gains `buildSource: desktopBuildSource`.

## Error handling / edge cases

- `apiBuildSource.loadTimeline` (the non-desktop default) hits a `/api/builds/${id}/timeline`
  endpoint that does not exist yet on the web host — out of scope per above. It's implemented
  defensively (catches a non-ok response and returns `{ failedRecords: [] }` instead of throwing)
  so that if `apps/app`/`apps/web` ever render `BuildDetail` before that endpoint exists, it
  degrades to "No failure details available" rather than a hard error.
- ADO timeline fetch failing on desktop (network error, 404 for a very old/purged build): caught
  in `BuildDetail`, shown as a red error line; the static metadata section above it still renders
  normally.
- A build with `status: 'cancelled'` may have zero failed records (nothing actually failed, it
  was just stopped) — handled by the "No failure details available" empty state, not treated as
  an error.
- Drawer opened for a build, then that build's status changes (e.g. a running build finishes)
  while the drawer is still open: no live-update, consistent with how `wi`/`pr`/`person` drawer
  kinds already behave (stale snapshot until closed and reopened).
- Existing persisted `nexusmd.fields.buildsTable` configs (empty by default) are unaffected by the
  column reorder; only users who never customized column order pick up the new default position
  automatically, per `resolveFields`'s catalog-order fallback.

## Testing

- `packages/core`: unit tests for `mapBuildTimeline` (records with/without issues, mixed
  succeeded/failed records, empty `records` array) and for the reordered `BUILDS_TABLE_COLUMNS`
  (project position).
- `packages/ui`: tests for `view-builds.jsx`'s new two-level grouping (project→pipeline nesting,
  independent collapse state, "Collapse/Expand all" affecting both levels) and for `BuildDetail`
  (renders static metadata without fetching for `success`/`running` builds; fetches and renders
  failed records for `failed` builds; shows loading/error states).
- `apps/desktop`: test for `desktopBuildSource.loadTimeline` (mocked ADO response → normalized
  shape) and for `DesktopDetailDrawer`'s new `kind: 'build'` branch (title/badge/adoUrl/body).
- Existing `apps/desktop` and `packages/ui` vitest suites must keep passing.
- Manual/E2E verification of the actual Electron window: use the `apps/desktop:verify` skill once
  implemented.
