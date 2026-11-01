# Bring mobile-only features to desktop (Lists, Home widgets, offline queue)

Date: 2026-11-01. Status: draft for approval.

## Intent

Three things exist only in the mobile app (`apps/app`). The owner wants them on desktop too, with
the shared logic moved into `@nexusmd/core` (and shared UI into `@nexusmd/ui`) rather than copied.
Lists must sync between devices.

## Goals

1. **Lists** on desktop: custom trackers (named, coloured lists; items with chosen fields; list and
   board views) for manual profiles. Same behaviour as mobile.
2. **Lists sync** between mobile and desktop through the existing cloud sync.
3. **Home widgets** on the desktop dashboard: optional, user-added widgets (Time, Notes, Latest build,
   Latest test and the others in `apps/app/src/views/home-widgets.jsx`), added/edited/removed from a sheet.
4. **Offline queue** on desktop: PR votes, PR comments and work-item state changes made offline are
   kept and sent when the connection returns.
5. One implementation of each piece of logic. Mobile and desktop both import it.
6. **Other mobile-only improvements** on desktop (found by searching the code; the builder confirms each is
   really missing before starting it):
   - Builds: columns menu (hide/reorder, tidier toolbar) and downloading build artifacts.
   - Navigation placement: move screens between the main bar, More and the footer (desktop only reorders),
     and a sync status indicator.
   - JSON tree edit and search, and the Markdown cheat sheet, learn mode and Compare.
   - Calendar "Now" and "Soon" badges on events.

The Time page needs nothing: it has been one shared page since commit `1281a3e` (`modules/time` on desktop).
Mobile-only by nature and left out: pull-to-refresh, phone card layouts, the Android APK updater, and direct
Google sign-in (desktop has its own flow).

## Non-goals

- Redesigning Lists, widgets or the queue. Behaviour matches mobile today.
- Syncing the offline queue itself (it is per device, by nature).
- Syncing Home widget choices (stay per device/profile in tweaks, as on mobile; tweaks already sync,
  so check this before assuming — see Open points).
- A desktop-specific Lists feature set (import/export, keyboard shortcuts) beyond what mobile has.

## Anti-goals

- Existing mobile Lists must not be lost or duplicated on first sync.
- A conflict must never silently drop an item; keep both, as the other collections do.
- Mobile must not regress: its existing tests keep passing after the code moves.

## Current state (verified)

- Lists: `apps/app/src/views/view-lists.jsx` (565 lines). Reads/writes `localStorage` key
  `getProfileKey('helm.lists')` as `{ lists: [{ id, name, color, fields, items... }] }`. Shown only for
  `profile.type === 'manual'`. Storage, field definitions and status bucketing sit inside the view.
- Offline queue: `offline-queue.js` is pure (storage, clock and network injected). `offline-queue-app.js`
  wires app handlers (ADO and GitHub vote/comment, work-item state) and exports `appQueue`.
- Home widgets: `views/home-widgets.jsx` (host and sheet) composing
  `views/dashboard-interactive-widgets.jsx`. Choices are saved in tweaks as `homeWidgets`.
- Sync: `packages/core/src/modules/sync` — collections (`collections.js`) with 3-way merges
  (`merge.js`), registered in `controller.js`. Mobile namespace is `helm`, desktop is `nexusmd`;
  collections are matched by id, so both devices sync the same collection.
- Desktop already has `'manual'` profiles but nothing shows for them like Lists.

## Design

### Core (`packages/core`)

- `modules/lists/` — pure Lists model: field definitions, defaults, status-to-bucket mapping, id
  generation, read/write against an injected `storage` + `getProfileKey`, plus create/update/delete helpers
  for lists and items.
- `modules/sync/collections.js` — new `listsCollection` (id `lists`, storage key `${namespace}.lists`),
  registered in `controller.js`. On mobile `${namespace}.lists` is `helm.lists`, the key mobile already uses,
  so no data migration is needed.
- `modules/sync/merge.js` — new `mergeLists(base, local, remote)`. Lists are matched by id and each list's
  items are merged by id with the existing `mergeRows` rules (keep both on a true conflict). List-level fields
  (name, colour, field set) merge as key-value, newest wins. Plain `mergeRows` on whole lists is NOT enough:
  edits to different items in one list on two devices would duplicate the whole list.
- `modules/offline-queue/` — `offline-queue.js` moves here unchanged (with its tests). Handlers stay
  injected by each app.
- Home widget configuration logic (`newWidgetsAfterSave`, widget type catalogue, validation) moves here
  as pure functions.

### Shared UI (`packages/ui`)

- Lists views and the widget host/sheet and the four widget components move to `packages/ui` as components
  that take data and callbacks as props. No direct `HelmData` or `localStorage` reads inside them.
- Mobile keeps thin phone-layout wrappers in `apps/app` that supply data and the mobile `Sheet`.

### Desktop (`apps/desktop`, `modules/`)

- Lists: a nav entry for manual profiles, provided by the work module's manifest (or a small `lists` module,
  builder's call), using the shared view.
- Home widgets: added to the dashboard in the work module, with the same Add widget entry as mobile.
- Offline queue: desktop `appQueue` built with desktop handlers (the ADO/GitHub clients desktop already has);
  PR vote/comment and state-change call sites go through it, with the same queued toast as mobile.

### Other improvements

Same rule as above: pure logic to `@nexusmd/core`, shared UI to `@nexusmd/ui`, thin wrappers per app.
- `build-artifacts.js` (listing and downloading) and the builds column definitions/visibility logic move to
  core; desktop's Builds view in `packages/ui` gets the Columns menu. Persisted per profile like the
  existing `hiddenPipelines`. Artifact download on desktop saves through Electron's file dialog, not the
  mobile share path.
- `nav-order.js` (`orderTabs`, `moveTab`, `placeTabs`) moves to core; desktop's `nav-order-editor.jsx` gains
  the main/More/footer placement. Desktop's sidebar already has Settings pinned at the bottom, so the footer
  there is the builder's call.
- `sync-status.js` moves to core; desktop shows it in the sidebar or title area (builder's call).
- `json-tree.js` and `md-extras.js` move to core; the Editor and Documents views use them. Where desktop
  already has part of this (e.g. in `MarkdownViewer`), keep one implementation and delete the other.
- The Now/Soon calculation moves to core; the desktop calendar shows the same badges.

## Decisions

Theirs (from the conversation): port all three; move shared logic to core rather than duplicate; Lists sync
between devices.

Mine (flagged for review):
- Lists sync merges per item inside each list (nested merge) instead of per whole list.
- Lists storage key stays `${namespace}.lists`, so mobile data is picked up unchanged.
- The offline queue stays per device and is not synced.
- Widgets stay in tweaks as today.

## Open points for the builder

- Whether Home widgets are already covered by tweaks sync (`homeWidgets` inside `tweaks`) on both apps;
  confirm and note.
- Whether desktop's write paths for PR votes/comments/state changes can be routed through the queue without
  changing their error handling (provider rejections must still be shown, not queued).
- Exact nav placement for Lists on desktop (manifest entry and order).

## Testing

- Core: unit tests for the Lists model, `mergeLists` (add/edit/delete on each side, same-item conflict,
  different-item edits in one list, list deleted on one side), and the queue (moved tests).
- UI: existing mobile tests for Lists, widgets and queue consumers pass unchanged after the move.
- Desktop: render tests for Lists and widgets; one sync round-trip test mobile-namespace to desktop-namespace.

## Build order

1. Move the offline queue and widget logic to core (mobile-only, no behaviour change).
2. Lists model, `mergeLists`, `listsCollection`; mobile switches to the core model.
3. Move Lists and widget UI to `packages/ui`; mobile switches to the shared components.
4. Desktop wiring: Lists nav, dashboard widgets, queue handlers.
5. Other improvements, one at a time (each: move logic to core, share the UI, wire desktop): builds columns and
   artifacts; nav placement and sync status; JSON tree and Markdown extras; calendar Now/Soon.
