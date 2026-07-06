# Clear cache (desktop) — design

## Problem

The desktop app caches the ADO data snapshot (work items, PRs, builds, tests) in
the renderer's `localStorage`. When that snapshot goes stale — e.g. PRs mapped
before the DevOps-web-URL fix, leaving their link buttons hidden — there is no
in-app way to drop just the cache and re-fetch. The only existing control,
"Clear local data" in Settings → Data & sync, is the nuclear option: it removes
**all** `nexusmd.*` keys (profiles, config, planner notes, preferences) and
reloads the window.

Users need a targeted "clear the cache" that discards only the re-fetchable
remote-data snapshot and immediately re-fetches, while preserving every profile,
credential, preference, and planner note.

## Scope

**In scope (desktop only):** clear the ADO data snapshot cache and re-fetch.

Keys removed:

| Key | Nature |
|---|---|
| `nexusmd.ado.cache.v1` | ADO data snapshot (work items, PRs, builds, tests, team) |
| `nexusmd.wi.wiTypeStates.cache` | Board work-item-type state lists, derived from ADO |

Keys explicitly preserved: `nexusmd.ado.org` / `pat` / `projects`, all profile
registry and profile-scoped keys (`nexusmd.p.*`), `nexusmd.planner.week.*`
(user-authored notes), field/column configs, and all other preferences.

**Out of scope:** web and app platforms; clearing any user-authored or config
data; a "clear everything" replacement for the existing Clear local data control.

## Approach

### Placement

A new **"Clear cache"** row in the existing `DesktopDataSyncCard`
(`packages/ui/src/views/view-settings.jsx`), Settings → Data & sync tab, rendered
**above** the existing "Clear local data" row. This groups the two reset actions
and draws the line between them: cache = safe, self-healing; local data =
destructive.

### Behaviour

On click:

1. Remove `nexusmd.ado.cache.v1` and `nexusmd.wi.wiTypeStates.cache` from
   `localStorage`.
2. Call the desktop's existing `refreshAdoData()` to re-fetch from ADO (a no-op
   if ADO is not configured), which emits `data:updated` and re-renders the
   views via the existing `useNexusSnapshot()` hook.
3. Show a toast: "Cache cleared — refreshing…".

No `window.confirm` (clearing is non-destructive and self-healing) and no
`window.location.reload()` (unlike Clear local data), so profile and UI state
stay put.

### Wiring

`DesktopDataSyncCard` is a shared component but `refreshAdoData()` lives in the
desktop's `apps/desktop/src/main.jsx`. To keep the shared component
platform-agnostic:

- Add an optional `onClearCache` prop to `DesktopDataSyncCard`. Render the
  "Clear cache" row only when the prop is provided, so web/app never show a
  non-functional button.
- In `main.jsx`, define `clearAdoCache()` that removes the two cache keys and
  then calls `refreshAdoData()`. Thread it through `DesktopSettings` →
  `DesktopDataSyncCard` alongside the existing `onRefreshData` / refresh-interval
  props.

### Cache keys as shared constants

`nexusmd.ado.cache.v1` is currently a duplicated magic string in
`packages/core/src/modules/ado/loader.js`, `.../triage/index.js`, and
`.../digest/index.js`. To stop the clear logic drifting from the loader:

- Export the ADO cache key from `@nexusmd/core` (single source of truth) and
  reference it from the loader and the desktop clear function. Updating the
  existing `triage`/`digest` duplicates to import it is a small, in-scope tidy.
- The `nexusmd.wi.wiTypeStates.cache` key is UI-local
  (`packages/ui/src/views/view-workitems.jsx`); expose it as a named constant so
  the clear function imports the same string rather than re-typing it.

## Components touched

- `packages/core/src/modules/ado/loader.js` — export cache key constant; loader
  references it.
- `packages/core` triage/digest modules — import the shared constant instead of
  re-declaring.
- `packages/ui/src/views/view-workitems.jsx` — export the wiTypeStates cache key
  constant.
- `packages/ui/src/views/view-settings.jsx` — `DesktopDataSyncCard` gains the
  optional `onClearCache` prop and the "Clear cache" row.
- `apps/desktop/src/main.jsx` — `clearAdoCache()`; pass through
  `DesktopSettings`.
- `apps/desktop/src/desktop-settings.jsx` — thread `onClearCache` from
  `DesktopSettings` into `DesktopDataSyncCard`.

## Testing

Following the existing `DesktopDataSyncCard.test.jsx` pattern:

- The "Clear cache" row renders when `onClearCache` is provided and is absent
  when it is not.
- Clicking the row invokes the `onClearCache` handler.
- Unit test for `clearAdoCache`: seed `localStorage` with the two cache keys plus
  a representative set of preserved keys (`nexusmd.ado.org`,
  `nexusmd.planner.week.2026-W27`, a `nexusmd.p.*` key); after clearing, assert
  the two cache keys are gone and every preserved key is untouched, and that the
  refresh function was called once.

## Risks / notes

- If ADO is offline or unconfigured when cache is cleared, the views show the
  empty state until the next successful fetch — acceptable and self-correcting;
  the toast still fires.
- The cache keys are not profile-scoped (flat keys, org-guarded inside
  `loadCachedAdoData`), so clearing is effectively global across profiles for the
  ADO snapshot. That matches how the cache is written today.
