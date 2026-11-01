# Desktop / mobile parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Lists (synced), Home widgets, the offline queue and the other mobile-only improvements to the desktop app, with one shared implementation in `@nexusmd/core` / `@nexusmd/ui`.

**Architecture:** Pure logic moves from `apps/app/src` into `packages/core/src/modules/*` and is exported from `packages/core/src/index.js`. Views that need to be on both apps move into `packages/ui` as prop-driven components; each app keeps a thin wrapper. Desktop then wires the shared pieces in through `modules/*` and `apps/desktop`. Lists syncs as one more collection in the existing sync engine.

**Tech Stack:** JavaScript/JSX, React, Vitest, Electron (desktop), Capacitor (mobile), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-01-desktop-mobile-parity-design.md`

## Global Constraints

- Logic that both apps use lives in `packages/core` (pure, storage/clock/network injected); shared UI lives in `packages/ui`. No copies in `apps/app` and `apps/desktop`: delete the original when moving.
- Moved code keeps its behaviour; moved tests move with it (`git mv`) and keep passing. Update imports instead of leaving re-export shims.
- Lists storage key is `${namespace}.lists` (`helm.lists` on mobile, `nexusmd.lists` on desktop); stored shape `{ lists: [...] }`. No data migration.
- Sync conflicts keep both sides; nothing is silently dropped.
- The offline queue is per device and never synced. Only network failures queue; a provider rejection is thrown to the caller.
- Mobile-only and out of scope: pull-to-refresh, phone card layouts, APK updater, direct Google sign-in.
- Run tests per package: `cd packages/core && npx vitest run <path>`, `cd packages/ui && npx vitest run <path>`, `cd apps/app && npx vitest run <path>`, `cd apps/desktop && npx vitest run <path>`; a task finishes with its package's whole suite green.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A `helm.lists` value that is empty, not JSON, or lacks `items`/`fields` on a list: loads as no lists or defaults, never throws.
- Two devices edit different items in one list, or one deletes a list the other added items to: both edits survive (no duplicated list).
- Same item edited on both devices: both versions kept (second gets id `<id>__conflict`).
- A home widget that points at a screen that is switched off, or a Lists widget whose list was deleted: renders an empty/removed state, does not crash the dashboard.
- Saved hidden builds columns or nav placements naming an id that no longer exists: ignored.
- Desktop queue: provider says no (e.g. 401/409) → thrown and shown, not queued; flush stops at the first network failure and drops rejected operations.

---

### Task 1: Offline queue to core

**Files:**
- Move: `apps/app/src/offline-queue.js` and `offline-queue.test.js` → `packages/core/src/modules/offline-queue/index.js` and `packages/core/tests/offline-queue.test.js`
- Modify: `packages/core/src/index.js` (export), `apps/app/src/offline-queue-app.js` and any other importer of `./offline-queue.js`

**Interfaces:**
- Produces (from `@nexusmd/core`): `createOfflineQueue({ storage, key, handlers, isOnline?, now?, emit? }) → { enqueue, run, flush, count, list }`; `isNetworkError(e: unknown): boolean` (signatures unchanged).

- [ ] **Step 1:** `git mv` both files; fix the test's import path; run `cd packages/core && npx vitest run tests/offline-queue.test.js` — expect PASS.
- [ ] **Step 2:** Add the export to `packages/core/src/index.js`; change `offline-queue-app.js` to `import { createOfflineQueue } from '@nexusmd/core'`.
- [ ] **Step 3:** Run `cd packages/core && npx vitest run` and `cd apps/app && npx vitest run` — expect all PASS.
- [ ] **Step 4:** Commit `refactor(core): move the offline queue to core`.

### Task 2: Navigation placement and sync status to core

**Files:**
- Move: `apps/app/src/nav-order.js`(+test) → `packages/core/src/modules/nav/order.js`(+`packages/core/tests/nav-order.test.js`); `apps/app/src/sync-status.js` → `packages/core/src/modules/nav/status.js`
- Modify: `packages/core/src/index.js`, every app importer of those files

**Interfaces:**
- Produces: `orderTabs(tabs, order)`, `moveTab(order, groupTabs, id, dir)`, `placeTabs(primary, secondary, placement, { tablet?, defaultFooter? })`, `syncLabel(loadedAt, now?)`, `offlineText(pending)` — all from `@nexusmd/core`, signatures unchanged.

- [ ] **Step 1:** `git mv`, fix paths, add exports, update importers (`grep -rn "nav-order\|sync-status" apps/app/src`).
- [ ] **Step 2:** Run core and app suites — expect all PASS.
- [ ] **Step 3:** Commit `refactor(core): move nav placement and sync status helpers to core`.

### Task 3: JSON tree and Markdown extras to core

**Files:**
- Move: `apps/app/src/json-tree.js`(+test) → `packages/core/src/modules/json/tree.js`; `apps/app/src/md-extras.js`(+test) → `packages/core/src/modules/markdown/extras.js`
- Modify: `packages/core/src/index.js`, app importers

**Interfaces:**
- Produces from `@nexusmd/core`: json-tree's `TYPE_OPTIONS, isContainer, pathKey, describePath, rawOf, searchPaths, validateKey, editNode, addChild, removeNode`; md-extras' `CHEAT, learnTarget, MAX_DIFF_LINES, diffLines, diffCounts, collapseDiff` (unchanged).

- [ ] **Step 1:** If either file imports an app-only module, move that dependency too or inject it; otherwise `git mv` and update paths/exports/importers.
- [ ] **Step 2:** Run core and app suites — expect PASS. Commit `refactor(core): move JSON tree and Markdown extras to core`.

### Task 4: Lists model and sync

**Files:**
- Create: `packages/core/src/modules/lists/index.js`, `packages/core/tests/lists.test.js`, `packages/core/tests/merge-lists.test.js`
- Modify: `packages/core/src/modules/sync/merge.js`, `packages/core/src/modules/sync/collections.js`, `packages/core/src/modules/sync/controller.js:45-48`, `packages/core/src/index.js`

**Interfaces:**
- Produces from `@nexusmd/core`:
  - `FIELD_DEFS`, `DEFAULT_STATUSES`, `DEFAULT_FIELDS`, `PRIORITY_LABELS`, `BUCKET_ORDER`, `BUCKET_LABELS`, `toBucket(status): 'done'|'blocked'|'inprogress'|'notstarted'` (values copied from `view-lists.jsx` lines 30-54).
  - `readLists({ storage, getProfileKey, namespace }): { lists: List[] }`, `writeLists({ storage, getProfileKey, namespace }, data): void`, `newListId(): string`.
  - `mergeLists(base, local, remote): { merged: { lists: List[] }, conflicts: Conflict[] }` in `merge.js`.
  - `listsCollection({ storage, getProfileKey, namespace })` — a `singletonCollection` with `id: 'lists'`, `bareKey: `${namespace}.lists``, `merge: mergeLists`.

- [ ] **Step 1: Failing tests** in `lists.test.js`: `readLists returns { lists: [] } for empty, non-JSON and missing storage`; `toBucket('Closed')==='done'`, `toBucket('Blocked by X')==='blocked'`, `toBucket('Doing')==='inprogress'`, `toBucket('')==='notstarted'`; `writeLists then readLists round-trips`.
- [ ] **Step 2: Failing tests** in `merge-lists.test.js` (each uses a base list `{id:'a',name:'A',items:[{id:'1',title:'x'},{id:'2',title:'y'}]}`): `edits to different items on each side both survive in one list` (merged has one list `a`, items 1 and 2 with both edits); `same item edited on both sides keeps both, second id '1__conflict'`; `list added on remote appears`; `list deleted locally and untouched remotely is dropped`; `list deleted remotely but items added locally is kept`; `list-level rename uses the newer side (prefer local) without duplicating items`; `a list with no items key does not throw`.
- [ ] **Step 3:** Run both — expect FAIL (not defined).
- [ ] **Step 4:** Implement the module and `mergeLists` (match lists by id; merge each list's `items` with `mergeRows`; merge the rest of a list's fields with `mergeKeyVal`; collect conflicts), add `listsCollection`, register it in `controller.js`'s `buildCollections`, export from `index.js`.
- [ ] **Step 5:** Run core suite — expect PASS. Add one test in `packages/core/tests/` that a runtime built with the mobile namespace (`helm`) and one with the desktop namespace (`nexusmd`) exchange `lists` through the in-memory cloud used by the existing sync tests (follow `integration.test.js`).
- [ ] **Step 6:** Commit `feat(core): Lists model and sync collection`.

### Task 5: Mobile uses the core Lists model

**Files:**
- Modify: `apps/app/src/views/view-lists.jsx:1-54` (replace local storage/field/bucket code with core imports; storage via `localStorage` + `getProfileKey` + namespace `'helm'`)

**Interfaces:** Consumes Task 4's exports.

- [ ] **Step 1:** Replace `readLists`/`writeLists`/`newId`/`FIELD_DEFS`/`toBucket` etc. with the core versions.
- [ ] **Step 2:** Run `cd apps/app && npx vitest run` — expect PASS. Manually: in a manual profile, create a list and item, reload, confirm it persists.
- [ ] **Step 3:** Commit `refactor(app): Lists uses the core model`.

### Task 6: Home widget logic to core

**Files:**
- Create: `packages/core/src/modules/widgets/index.js`, `packages/core/tests/widgets.test.js`
- Modify: `apps/app/src/views/home-widgets.jsx`, `packages/core/src/index.js`

**Interfaces:**
- Produces from `@nexusmd/core`: `newWidgetsAfterSave(list, w)`, `WIDGET_PAGES: [id, label][]` (the `PAGES` array), `pageLabel(id): string`, and the pure part of `WIDGET_TYPES` (type id, label, config field definitions such as `COUNT`) as `WIDGET_CONFIG_TYPES`. React render functions stay in the UI.

- [ ] **Step 1: Failing tests:** `newWidgetsAfterSave replaces a widget with the same id`; `appends a widget with a new id`; `pageLabel('markdown')==='Documents'` and `pageLabel('zzz')==='zzz'`.
- [ ] **Step 2:** Implement by moving those pieces out of `home-widgets.jsx`; the JSX file imports them.
- [ ] **Step 3:** Run core and app suites (`home-widgets.test.jsx` unchanged) — expect PASS. Commit `refactor(core): home widget configuration to core`.

### Task 7: Shared Lists and widget UI in `packages/ui`

**Files:**
- Create: `packages/ui/src/views/view-lists.jsx`, `packages/ui/src/home-widgets.jsx` (+ moved tests)
- Modify: `packages/ui/src/index.js`, `apps/app/src/views/view-lists.jsx` and `home-widgets.jsx` become thin wrappers, `apps/app/src/views/dashboard-interactive-widgets.jsx` (widget bodies move to `packages/ui`)

**Interfaces:**
- Produces from `@nexusmd/ui`:
  - `ListsView({ data: { lists }, onChange(nextData), toast, Icon, device })` — no `localStorage`/`HelmData` reads inside.
  - `WidgetHost({ widgets, offScreens, ctx, onEdit })`, `WidgetSheet({ open, widget, offScreens, onClose, onSave, onRemove, Sheet })` — `ctx` carries what the widgets read (`lists`, `builds`, `tests`, notes, timer, repo choices); the apps build `ctx`.

- [ ] **Step 1:** Move components and tests; replace direct data reads with props; mobile wrappers read `localStorage`/`HelmData` and pass them in.
- [ ] **Step 2: Failing test** in `packages/ui`: `WidgetHost renders a Lists widget whose list was deleted as removed, without throwing`; `WidgetHost skips a widget whose page is in offScreens`.
- [ ] **Step 3:** Make it pass. Run ui and app suites — expect PASS (mobile's existing widget/list tests unchanged).
- [ ] **Step 4:** Commit `refactor(ui): share Lists and home widgets`.

### Task 8: Desktop offline queue

**Files:**
- Create: `apps/desktop/src/offline-queue-app.js`, `apps/desktop/src/offline-queue-app.test.js`
- Modify: the desktop/module call sites for PR vote, PR comment and work-item state change (`grep -rn "vote\|comment\|updateState" modules/work/src/renderer packages/ui/src --include=*.jsx`), `apps/desktop/src/main.jsx` (flush on start and on the `online` event)

**Interfaces:**
- Consumes: `createOfflineQueue`, `isNetworkError` from core.
- Produces: `appQueue` (same `run(kind, payload, label)` contract as mobile) with handlers `ado-vote`, `ado-comment`, `github-vote`, `github-comment`, `work-state`; `flushQueue(): Promise<{ sent, failed }>`.

- [ ] **Step 1: Failing tests:** `run queues when offline and returns { queued: true }`; `a 409 from the provider is thrown, not queued`; `flush sends oldest first and stops at the first network error`; `a rejected operation is dropped and reported in failed`.
- [ ] **Step 2:** Implement `offline-queue-app.js`; route the call sites through `appQueue.run` and show the same "queued" toast as mobile.
- [ ] **Step 3:** Run desktop suite — expect PASS. Commit `feat(desktop): offline queue for PR actions and state changes`.

### Task 9: Desktop Lists

**Files:**
- Modify: `modules/work/app.manifest.json` (nav entry `{ "id": "lists", "label": "Lists", "icon": "work" }`, shown only for manual profiles), the work module's views map in `modules/work/src/renderer/`, `apps/desktop/src/shell/app-manifests.js` (regenerate if it is generated)
- Test: `modules/work/src/renderer/lists-view.test.jsx`

**Interfaces:** Consumes `ListsView` (Task 7) and `readLists`/`writeLists` (Task 4) with namespace `'nexusmd'`.

- [ ] **Step 1: Failing test:** `Lists nav entry is shown for a manual profile and hidden for an ADO profile`; `adding an item writes nexusmd.lists`.
- [ ] **Step 2:** Implement the wrapper that reads/writes via core and passes `data`/`onChange` to `ListsView`; add the nav entry.
- [ ] **Step 3:** Run desktop and module suites — expect PASS. Commit `feat(desktop): Lists for manual profiles`.

### Task 10: Desktop Home widgets

**Files:**
- Modify: the desktop dashboard view in `packages/ui/src/views/` or `modules/work/src/renderer/` (whichever renders Dashboard; `grep -rn "dashboard" modules/work/src/renderer`), plus the `homeWidgets` tweak plumbing
- Test: alongside that view

**Interfaces:** Consumes `WidgetHost`, `WidgetSheet`, `newWidgetsAfterSave`. `homeWidgets` lives in the `tweaks` collection (already synced).

- [ ] **Step 1: Failing test:** `Add widget opens the sheet, saving adds a widget, removing deletes it`; `a widget for a switched-off app is hidden`.
- [ ] **Step 2:** Add the host and the "Add widget" entry to the dashboard; build `ctx` from desktop data.
- [ ] **Step 3:** Run suites — expect PASS. Commit `feat(desktop): optional Home widgets`.

### Task 11: Builds columns menu

**Files:**
- Create: `packages/core/src/modules/builds/columns.js`, `packages/core/tests/build-columns.test.js`
- Modify: `apps/app/src/views/view-builds.jsx:14-30,349-370` (use core definitions), `packages/ui/src/views/view-builds.jsx` (Columns menu, hidden columns persisted with `usePersisted('nexusmd.builds.hiddenColumns', [], { sync: true })`)

**Interfaces:**
- Produces from core: `BUILD_COLUMNS: { id, label, width }[]`, `visibleColumns(hidden: string[]): column[]` (ignores unknown ids), `gridTemplate(hidden): string`, `minTableWidth(hidden): number`, plus the user's column order (`orderColumns(order, columns)`).

- [ ] **Step 1: Failing tests:** `visibleColumns ignores hidden ids that no longer exist`; `gridTemplate omits hidden columns`; `minTableWidth shrinks when a column is hidden`; `orderColumns keeps unknown/new columns after the saved ones`.
- [ ] **Step 2:** Implement; make mobile use it; add the Columns menu (hide/reorder) to the desktop Builds view.
- [ ] **Step 3:** Run core, app, ui suites — expect PASS. Commit `feat(builds): columns menu on desktop, shared with mobile`.

### Task 12: Build artifact download

**Files:**
- Create: `packages/core/src/modules/builds/artifacts.js` (+ test, moved from `apps/app/src/build-artifacts.test.js`)
- Modify: `apps/app/src/build-artifacts.js` (keeps only the Capacitor `artifactPlugin`/`saveArtifact`), `apps/desktop/electron/` (an `artifacts:save` IPC that downloads with the auth headers and saves via a save dialog), `apps/desktop/src/adapters/` (renderer adapter), Builds detail view in `packages/ui`

**Interfaces:**
- Produces from core: `formatSize(bytes)`, `mapAdoArtifacts(raw, build, org)`, `mapGithubArtifacts(raw)`, `listArtifacts(build, deps)`, `authHeaders(provider, { ado, github })` (unchanged; configs injected, not read from app globals).
- Desktop adapter: `saveArtifact(item): Promise<{ saved: boolean, path?: string }>`.

- [ ] **Step 1:** Move the pure parts and tests; app imports from core; run core/app suites — PASS.
- [ ] **Step 2: Failing test** (desktop): `saveArtifact sends the Authorization header for ADO and GitHub items and returns { saved:false } when the dialog is cancelled`.
- [ ] **Step 3:** Implement the IPC and the artifacts list in the desktop Builds view. Manual check: download one artifact from a real build.
- [ ] **Step 4:** Commit `feat(builds): download build artifacts on desktop`.

### Task 13: Nav placement and sync status on desktop

**Files:**
- Modify: `apps/desktop/src/nav-order-editor.jsx` (+test), `apps/desktop/src/main.jsx` / `layout.js` (sidebar groups), `apps/desktop/src/nav-config.js`; new `apps/desktop/src/sync-indicator.jsx` (+test)

**Interfaces:** Consumes `placeTabs`, `moveTab`, `orderTabs`, `syncLabel`, `offlineText` (Task 2). Placement saved per profile as `navPlacement: { [id]: 'main'|'footer'|'more' }` in tweaks.

- [ ] **Step 1: Failing tests:** `moving a screen to More removes it from the main sidebar and lists it under More`; `placement naming a missing id is ignored`; `SyncIndicator shows "Updated 5m ago" and the offline text with the pending count`.
- [ ] **Step 2:** Implement the placement control in the editor, the sidebar footer group (Settings stays pinned), and the indicator (sidebar bottom).
- [ ] **Step 3:** Run desktop suite — expect PASS. Commit `feat(desktop): screen placement and sync status`.

### Task 14: JSON tree and Markdown extras on desktop

**Files:**
- Modify: the API Client/Editor JSON view (`modules/editor`, `packages/ui/src/json-pretty.jsx`) and `packages/ui/src/views/MarkdownViewer.jsx`; create `packages/ui/src/json-tree-ui.jsx`, `packages/ui/src/md-extras-ui.jsx` by moving the phone components in `apps/app/src/views/json-node-sheet.jsx`, `json-phone.jsx`, `md-phone.jsx` and keeping only layout in the app

**Interfaces:** Consumes Task 3 exports; Markdown cheat sheet, learn mode (`learnTarget`) and Compare (`diffLines`, `collapseDiff`) as shared components.

- [ ] **Step 1: Failing tests:** `searching the JSON tree highlights matching paths`; `editing a node updates the document and rejects a duplicate key`; `Compare shows added/removed counts and collapses unchanged context`.
- [ ] **Step 2:** Move the components, wire into the desktop views; if desktop already has an equivalent, keep one and delete the other.
- [ ] **Step 3:** Run ui, app and desktop suites — PASS. Commit `feat(desktop): JSON tree editing and Markdown cheat sheet, learn mode, Compare`.

### Task 15: Calendar Now and Soon badges

**Files:**
- Create: `packages/core/src/modules/calendar/now-soon.js` (+test); locate the existing calculation with `grep -rn "Soon" apps/app/src`
- Modify: the mobile calendar view (use core), `packages/ui/src/views/view-calendar.jsx` and `modules/calendar/src/renderer/view-calendar.jsx` (show badges)

**Interfaces:**
- Produces from core: `eventBadge(event, now = Date.now(), soonMinutes = <mobile's value>): 'now' | 'soon' | null`.

- [ ] **Step 1: Failing tests:** `an event in progress is 'now'`; `an event starting within the soon window is 'soon'`; `an all-day or past event is null`; `an event with no end time does not throw`.
- [ ] **Step 2:** Move the calculation, use it on both calendars, show the badges on desktop.
- [ ] **Step 3:** Run core, app, ui and desktop suites — PASS. Commit `feat(calendar): Now and Soon badges on desktop`.

### Task 16: Final check

- [ ] **Step 1:** Run all four package suites and `npm run build` for desktop and app (use the scripts in each `package.json`) — expect no failures.
- [ ] **Step 2:** Run `Start-Dev.ps1` in `apps/desktop`; check by hand: a manual profile shows Lists and a list created there appears on a device after sync; a widget can be added; Builds columns hide; an artifact downloads; a PR vote made offline is sent when back online.
- [ ] **Step 3:** Report what was and was not verified by hand.

---

## Self-review

- **Spec coverage:** Lists (T4, T5, T7, T9), sync (T4), widgets (T6, T7, T10), queue (T1, T8), builds columns and artifacts (T11, T12), nav placement and sync status (T2, T13), JSON/Markdown (T3, T14), Now/Soon (T15). Time needs nothing (per spec).
- **Order:** moves to core (T1-T4, T6) before UI (T7) before desktop wiring (T8-T15), so mobile's existing tests catch regressions first.
- **Known looseness the executor settles:** which desktop file renders the dashboard (T10) and the PR/state call sites (T8) — each task names the `grep` that finds them; the Now/Soon source file and window (T15) are found the same way.
