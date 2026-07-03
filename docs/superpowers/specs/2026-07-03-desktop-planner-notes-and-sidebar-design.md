# Desktop: PR link, sidebar reshuffle, planner notes & cloud backup

**Date:** 2026-07-03
**Scope:** `apps/desktop` (Electron), with additive changes to shared `packages/ui`
and `packages/core` where the feature inherently lives in shared code.

## Summary

Seven related desktop improvements, grouped here into one spec:

1. Visible link affordance to the DevOps PR on the PR **card** (drawer already has one).
2. Pin **Settings** to the bottom of the sidebar, out of the reorderable list.
3. Surface **cloud sync/backup** inside the Planner header.
4. Show a list of the current week's **planner row-notes** in the Planner overview.
5. Rename the sidebar **"Notes"** item to **"Documents"**.
6. Move the **week-agnostic notes** library out of Planner into its own top-level
   sidebar tab.
7. Add a **"Promote to Notes"** button on planner row-notes that copies them into
   the week-agnostic library.

All work targets the desktop app. Shared code is touched only where noted, and only
additively.

## Feature 1 — DevOps PR link on the PR card

**Current state.** `pr.url` already holds the ADO web link
(`packages/core/src/modules/ado/loader.js:114` → `pr._links?.web?.href`). The desktop
drawer already renders an "Open in browser" button (`apps/desktop/src/main.jsx:377`).
The shared `PRRow` card only wraps the title in a hidden `<a>`, which is unreliable in
Electron.

**Change.** In the shared `packages/ui/src/views/view-prs.jsx`:
- Add an optional `onOpenLink(url)` prop to `PRView`/`PRRow`.
- On each card, when `pr.url` is present, render a small external-link icon button
  (`link` icon) that calls `onOpenLink(pr.url)`, falling back to
  `window.open(pr.url, '_blank', 'noopener')` when the prop is absent.
- `stopPropagation` so clicking the link does not also trigger the row's `onOpen`.

Desktop wiring (`apps/desktop/src/main.jsx`): pass
`onOpenLink={(u) => window.electronAPI.openLink(u)}` to `PRView`.

Web/mobile are unaffected (they simply do not pass the prop and get the `window.open`
fallback). Drawer stays as-is; its "Open in browser" label may be relabelled
"Open in DevOps" for consistency.

## Feature 2 — Pin Settings to the bottom of the sidebar

**Current state.** `settings` lives in the reorderable `NAV` list, is part of
`DEFAULT_TWEAKS.navOrder`, is rendered in the flat `orderedNav(...)` map
(`apps/desktop/src/main.jsx:857`), and is draggable in `nav-order-editor.jsx`.

**Change (all desktop-only).**
- Split the nav: `SETTINGS_NAV` (the settings item) is excluded from the reorderable
  `NAV`.
- In the sidebar render, map the reorderable items, then a flex spacer
  (`marginTop: 'auto'`), then a pinned Settings button reusing the same `nav-item`
  markup/behaviour.
- Remove `'settings'` from `DEFAULT_TWEAKS.navOrder` and from the
  `nav-order-editor` list so it can no longer be dragged.
- `orderedNav` already tolerates ids dropping out of `navOrder`; confirm it does not
  re-append settings.
- The number-shortcut hint (`idx + 1`, currently `idx < 9`) applies only to the
  reorderable items; settings gets no number, which is acceptable.

## Feature 3 — Cloud sync/backup in the Planner header

**Current state.** `desktopSync` (`apps/desktop/src/sync.js`) already syncs planner
weeks + the notes library to Google Drive via the shared controller. Settings exposes
"Sync now" with toast feedback and skip-reason handling
(`packages/ui/src/views/view-settings.jsx:527`).

**Change.** Add a compact **"Back up / Sync"** button to the Planner header toolbar
(top of `PlannerView`, alongside export / week nav). It calls `desktopSync.syncOnce()`
and mirrors the Settings toast handling:
- `no-key` → "Set a sync passphrase in Settings first."
- `no-provider` / `not-connected` → point the user to Settings.
- `bad-passphrase` → error toast.
- success → "Synced — pushed N, pulled N, merged N."

Because `PlannerView` is shared (`packages/ui`), the sync action is injected as an
optional prop (e.g. `onCloudSync`) that desktop supplies; other apps that do not pass
it simply do not render the button.

## Feature 4 — Planner notes list in the overview

**Current state.** Row notes are stored per-row as `row._notesList`
(`plRowNotes(row)`), rendered via `NotesButton` / `RowNotesModal`, and gated by
`section.hasNotes`. Only `meetNotes` and `dailyLog` set `hasNotes: true`. The overview
is `GlanceView` (`packages/ui/src/planner/planner-glance.jsx`).

**Change A — widen `hasNotes`.** In `PLANNER_SECTIONS`
(`packages/core/src/modules/planner/index.js`), add `hasNotes: true` to:
`tasks`, `reminders` (My week); `chatsIn`, `chatsOut`, `statusUpdates` (Comms);
`workItemsPlan`, `teamTasks` (Work items); `teamNotes` (People) — in addition to the
existing `meetNotes`.

> ⚠️ Shared-code note: `PLANNER_SECTIONS` lives in `packages/core` and is consumed by
> all apps' planners. Enabling `hasNotes` there surfaces the note buttons in web/mobile
> too. The change is purely additive (adds an affordance, no data-shape change; DOCX
> export/import columns are untouched). We accept the cross-app effect rather than a
> desktop-only override, since the planner is inherently shared.

**Change B — overview panel.** Add a "Planner notes" panel to the Planner overview
(within/next to `GlanceView`) that scans the **currently viewed week's** data across all
`hasNotes` table sections, collecting every row where `plRowNotes(row).length > 0`. For
each, render a card showing: section title, the row's `main` column text (fallback to a
snippet), and the note count. Clicking a card opens the existing `RowNotesModal` for that
row (saving back through the normal planner `setData` path). Empty state when the week has
no notes.

Scope: current viewed week only (not all weeks).

## Feature 5 — Rename "Notes" → "Documents"

`apps/desktop/src/main.jsx:210`: change the `markdown` nav item's `label` from
`'Notes'` to `'Documents'`. The view (`MarkdownViewer`) is unchanged. This frees the
name "Notes" for Feature 6.

## Feature 6 — Week-agnostic notes as a top-level sidebar tab

**Current state.** `GlobalNotesView` renders as a tab inside Planner
(`packages/ui/src/views/view-planner.jsx:483`). Its storage/sync
(`nexusmd.planner.globalNotes`) is unchanged.

**Change (desktop-only wiring).**
- Add a new nav item `{ id: 'notes', label: 'Notes', icon: 'pin' }` to the reorderable
  `NAV`, and a `case 'notes'` in the view switch that renders `GlobalNotesView`.
- Provide `notes`/`setNotes` backed by `loadGlobalNotes()` / `saveGlobalNotes()`.
- Since there is no "current week" outside Planner, compute **this week's** label via the
  core week helpers (`getYearWeekForOffset(0)` / existing week-label logic) and pass it as
  `weekLabel` so the note "Complete in <week>" action still works.
- `onAddTask` (the note modal's "Task this week"): wire it to append a task to the
  current week's planner `tasks` section via `loadWeekPlanner`/`saveWeekPlanner`. If that
  proves fiddly, omit the prop (the button hides automatically).
- **Remove** the week-agnostic Notes tab from inside Planner (`view-planner.jsx`): drop
  the `glance`-adjacent `GlobalNotesView` tab/group so the library lives only in the new
  top-level view. The Planner overview keeps the Feature-4 planner-notes list.

Add the new `notes` id to `DEFAULT_TWEAKS.navOrder` (positioned sensibly, e.g. after
`planner`).

## Feature 7 — Promote planner row-note to the week-agnostic library

On each entry in the Feature-4 overview list (and/or within `RowNotesModal`), add a
**"Promote to Notes"** button. It reads the row's note(s), and for each appends a new
entry to the week-agnostic library via `loadGlobalNotes()` + `saveGlobalNotes()`:

```
{ id: 'gn' + <unique>, title: <note.title || snippet>, body: <note.body>,
  createdAt: now, updatedAt: now, status: 'open', completedWeek: null }
```

**Promote = copy:** the original row note is retained on the planner row; a copy is added
to the library. Show a success toast ("Promoted to Notes"). Avoid duplicate promotion of
the exact same note in one action.

## Testing

- **Feature 1:** unit-test that `PRRow` renders the link button when `pr.url` is set and
  calls `onOpenLink`; falls back to `window.open` without the prop.
- **Feature 2:** `orderedNav` excludes `settings`; snapshot/logic test that settings
  renders in the pinned section, not the reorderable map; `nav-order-editor` omits it.
- **Feature 4A:** assert the targeted sections now have `hasNotes: true` in
  `PLANNER_SECTIONS`.
- **Feature 4B/7:** pure helper that, given a week's data + `PLANNER_SECTIONS`, returns
  the aggregated notes list (section title, row main text, notes). Unit-test aggregation
  and the promote transform (copy semantics; library append shape).
- **Feature 6:** the this-week label helper; `GlobalNotesView` mounts standalone with
  load/save wiring.
- Follow existing desktop test patterns (`*.test.jsx` with the project's Vitest setup).

## Out of scope

- No backend work; cloud remains Google Drive via the existing native flow.
- No change to the notes data shape or DOCX export/import.
- Web/mobile receive only the additive shared-code changes (extra `hasNotes` sections,
  optional PR link/sync props); no new web/mobile UI wiring is built here.
