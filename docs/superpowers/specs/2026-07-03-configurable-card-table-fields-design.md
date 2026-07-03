# Configurable Card & Table Fields — Design

**Date:** 2026-07-03
**Scope (new/changed):**
- `packages/core/src/modules/ado/` — field catalogs + resolver helpers (new file, e.g. `field-visibility.js`) + barrel export
- `packages/ui/src/views/view-settings.jsx` — new reusable `FieldVisibilityCard` (generalized from `BoardColumnsCard`)
- `packages/ui/src/index.js` — export `FieldVisibilityCard`
- `packages/ui/src/views/view-workitems.jsx` — `BoardCard` + work-items table read resolved fields
- `packages/ui/src/views/view-prs.jsx` — `PRRow` reads resolved fields
- `packages/ui/src/views/view-builds.jsx` — dynamic grid/columns from resolved config
- `packages/ui/src/views/view-tests.jsx` — dynamic grid/columns from resolved config
- `apps/desktop/src/desktop-settings.jsx` and `apps/web/src/view-settings.jsx` — mount a new "Cards & Tables" settings section
- Tests in `packages/core/tests/` and `packages/ui/tests/`

## Context

Every card and table in the app hardcodes which fields it shows. Users want to
choose what appears on **work item cards** (board), the **work item table**, **PR
cards**, and the **builds/tests tables**. Today those field lists are fixed in the
component markup (enumerated in "Current state" below), so there is no way to
tailor them.

There is already a proven precedent in the codebase — the **board-columns**
configuration: a config persisted via `usePersisted('nexusmd.wi.boardColumns', …)`,
pure state helpers in `@nexusmd/core` (`reorderColumns`, `toggleColumnHidden`,
`resetToDetected`, …), applied in the view via `getActiveLanes(config, …)`, and
edited through `BoardColumnsCard` (`view-settings.jsx`) with drag-reorder + show/hide
checkboxes. This feature generalizes that same shape into a reusable
field-visibility system rather than inventing a new one or doing a heavier
data-driven table-engine rewrite.

### Decisions (from brainstorming)
- **One shared framework** in `@nexusmd/ui`, honored by both web and desktop.
- **Surfaces (v1):** WI cards (board), WI table, PR cards, builds table, tests table.
  Dashboard widgets are **out of scope** — they already have their own show/hide +
  order (`widgetOrder`/`widgetWidths`/`widgetHeights`).
- **Controls:** show/hide **and** reorder (reuse the `BoardColumnsCard` drag UI).
- **Granularity:** one **global** config per surface (not per-project).

### Current state (defaults are seeded from these)
- **WI board card** — `view-workitems.jsx` `BoardCard` (~line 1412): type icon, ID,
  priority, title, assignee, tags, points, comments, PR count, "updated … ago".
  Item shape built in `mapDto` (~lines 265-289).
- **WI table** — `view-workitems.jsx` thead (~1095-1110) / tbody (~1146-1179):
  ID, Type, Title, Project, State, Assignee, Priority, Tags, Updated. Sortable
  columns use `SortHeader` from `components.jsx`.
- **PR card** — `view-prs.jsx` `PRRow` (~line 258): status icon, title (+DRAFT/
  Conflicts pills), `#id`, author, branch, opened-age, linked work items,
  additions/deletions, comments/unresolved, CI status, reviewers.
- **Builds table** — `view-builds.jsx` `BUILD_GRID` (line 14) + `ColHead`
  (~317-338): status, build #, triggered by, branch, commit, reason, duration,
  date, actions.
- **Tests table** — `view-tests.jsx` inline `gridTemplateColumns` on `.build-row`
  (~line 185): result, run (title/meta), duration, date, actions.

### Preference plumbing (reused as-is)
`usePersisted(key, initial, { sync })` (`app-components.jsx:18`) reads/writes
`storage` via `getProfileKey`, JSON-encodes, and calls `pushPref` when `sync:true`.
It resolves those from `useNexusData()` (`data-context.jsx`). This is the canonical
way a view reads a preference — **not** the separate dev-only `tweaks` panel.

---

## 1. Field catalogs + resolver (`@nexusmd/core`)

New module `packages/core/src/modules/ado/field-visibility.js`, exported through
`modules/ado/index.js` (which the core barrel already re-exports via
`export * from './modules/ado/index.js'`).

### Catalogs
One ordered descriptor array per surface. Each descriptor:

```js
{ key: 'assignee', label: 'Assignee', width: '160px', locked: false }
```

- `key` — stable identifier the view maps to a render fragment.
- `label` — shown in the settings card.
- `width` — **table columns only**; used to build `gridTemplateColumns`. Omitted
  for card fields.
- `locked` — `true` = always visible, cannot be hidden (and not draggable in a way
  that removes it). Non-locked fields are toggleable and reorderable.

Catalogs (defaults = current order; `locked` marked with 🔒):

- `WI_CARD_FIELDS`: type🔒, id🔒, title🔒, priority, assignee, tags, points,
  comments, prCount, updated.
- `WI_TABLE_COLUMNS`: id, type, title🔒, project, state, assignee, priority, tags,
  updated. (Each carries a `width`; title is `1fr`.)
- `PR_CARD_FIELDS`: status🔒, title🔒, id🔒, author, branch, age, linkedWorkItems,
  changes (additions/deletions), comments, ci, reviewers.
- `BUILDS_TABLE_COLUMNS`: status🔒, build🔒, triggeredBy, branch, commit, reason,
  duration, date, actions🔒. (Widths seeded from today's `BUILD_GRID`.)
- `TESTS_TABLE_COLUMNS`: result🔒, run🔒, duration, date, actions🔒.

The catalogs live in core (pure data) so both the settings card and the views
import the same source of truth.

### Config shape (persisted)
A compact ordered array of `{ key, visible }`:

```js
[ { key: 'assignee', visible: true }, { key: 'tags', visible: false }, … ]
```

Empty/absent config → all defaults. Storing order + visibility together keeps the
persisted value small and human-readable.

### Helpers (pure, unit-tested)
```js
resolveFields(catalog, config) // → ordered [{ key, label, width, locked, visible }]
reorderField(config, catalog, fromKey, toKey) // → new config array
toggleField(config, catalog, key)             // → new config array (no-op on locked)
defaultConfig(catalog)                          // → config array from catalog order
```

`resolveFields` rules:
1. Start from `config` order; drop entries whose `key` is not in `catalog`
   (removes stale keys after a catalog change).
2. **Append** any catalog field missing from `config`, in catalog order, as
   visible — so fields added in a future release appear automatically instead of
   silently vanishing.
3. Force `visible: true` for any `locked` field regardless of stored value.

---

## 2. Persistence — one global key per surface

Read/written with `usePersisted`, `{ sync: true }` so the pref propagates through
`pushPref`:

- `nexusmd.fields.wiCard`
- `nexusmd.fields.wiTable`
- `nexusmd.fields.prCard`
- `nexusmd.fields.buildsTable`
- `nexusmd.fields.testsTable`

Initial value `[]` (→ resolver yields catalog defaults). Profile-scoping and sync
behavior come from each app's `getProfileKey`/`pushPref`, unchanged.

---

## 3. Reusable settings card (`@nexusmd/ui`)

`FieldVisibilityCard`, generalized from `BoardColumnsCard` (`view-settings.jsx`):

Props: `{ title, catalog, config, onChange }`.

Renders one draggable row per resolved field:
- drag handle (reorder) — reuses the existing board-columns drag interaction;
- a checkbox bound to `visible` (locked fields render checked + **disabled**);
- the field `label`.
Plus a **Reset to defaults** button per card (`onChange(defaultConfig(catalog))`).

Reorder calls `reorderField`; toggle calls `toggleField`; both hand the new config
to `onChange`. Exported from `packages/ui/src/index.js`.

## 4. Settings section wiring

A new **"Cards & Tables"** section presents five `FieldVisibilityCard` instances
(WI card, WI table, PR card, Builds, Tests), each wired to its `usePersisted` key.

- **Desktop:** add a `SETTINGS_TABS` entry in `apps/desktop/src/desktop-settings.jsx`
  and render the five cards in that tab (mirrors how `BoardColumnsCard` is mounted
  under the Planner tab).
- **Web:** add the same section to `apps/web/src/view-settings.jsx`, composing the
  shared `FieldVisibilityCard` (web keeps its own settings page but imports shared
  building blocks — same pattern as `BoardColumnsCard`).

The five `usePersisted` hooks can live in a small shared wrapper (e.g. a
`CardsAndTablesSettings` component exported from `@nexusmd/ui`) that both apps drop
in, so the key names and card wiring exist in exactly one place.

## 5. Views read the resolved config

Each view calls `usePersisted(<key>, [])` then `resolveFields(<catalog>, config)`
and renders by iterating the resolved (visible, ordered) list. Each view owns a
`key → fragment` map so core stays free of JSX.

- **`BoardCard`** and **`PRRow`**: render the visible fragments in resolved order;
  skip `visible: false`. Locked fields always render.
- **WI table**, **Builds**, **Tests**: derive `gridTemplateColumns` by joining the
  visible columns' `width`s, and render `<th>`/`<td>` (or grid cells) for visible
  columns in order. Builds' current `BUILD_GRID` constant is replaced by the
  computed template; Tests' inline template likewise.

Sortable table headers keep using `SortHeader`; sort state is unaffected (a hidden
column simply isn't rendered).

## 6. Testing

- **Core (`packages/core/tests`)** — `resolveFields`: defaults from empty config;
  saved order applied; hidden respected; **locked forced visible** even if stored
  hidden; **unknown key dropped**; **new catalog field appended visible**.
  `reorderField`/`toggleField`: reorder result, toggle flips visibility,
  toggle is a **no-op on locked**. `defaultConfig` matches catalog order.
- **UI (`packages/ui/tests`)** — `FieldVisibilityCard`: toggling a checkbox and
  reset call `onChange` with the expected config; locked row checkbox is disabled.
  One view test each for a card (hidden field absent, order honored) and a table
  (hidden column absent, `gridTemplateColumns` reflects visible widths), rendered
  through `NexusDataProvider` with a seeded `storage`.

## Out of scope
- Dashboard widgets (already configurable separately).
- Per-project field configs (global only this cut).
- Team view (card/grid layout, not in the requested surface list).
- Adding brand-new data fields not already present on the item/PR/build/test shape.
- Column resizing by drag (widths come from the catalog).
