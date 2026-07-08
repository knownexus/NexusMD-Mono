# Desktop Person Summary Drawer

## Goals

The desktop Team tab's "Open profile" action was recently fixed (it was previously a hardcoded
no-op) and now opens a minimal drawer (`PersonSummary` in `apps/desktop/src/main.jsx`) showing
avatar/role/focus plus a re-filtered list of active work items and open PRs. This design improves
that drawer so it's the richest view of a team member (not a strict subset of what the card
already shows), and moves note-viewing/management from the card to the drawer.

## Scope

**In scope:**
- `PersonSummary` (`apps/desktop/src/main.jsx`) stops re-deriving work item/PR filters and uses
  the already-`enrichTeamMember`-computed fields on the `dev` object it's passed.
- A stats strip (Active / Open PRs / Sprint pts) and a blocked-items callout, mirroring the
  card's existing stat/blocker styling.
- Work item and PR rows in the drawer become clickable, swapping the same drawer to that item's
  own `wi`/`pr` detail (reusing the existing `openItem`/`openPR` handlers in `App`).
- Quick actions in the drawer's action bar: "Schedule 1:1" and "Add note", implemented via a
  `window` CustomEvent bridge into `TeamView` (`packages/ui/src/views/view-team.jsx`), which stays
  the sole owner of the note/1-on-1 modal state.
- A "Notes" section in the drawer: full list of existing notes (text + date), each with a delete
  button, kept live-in-sync with `TeamView` via a `nexusmd:team-notes-changed` event.
- `DevCard`'s existing inline notes preview (up to 3 notes with delete buttons) is replaced by a
  single compact `💬 N notes` line that opens the profile drawer. Notes are no longer read or
  deleted directly from the card.

**Out of scope:**
- The web app's password-gated "confidential notes" feature — not being ported to desktop.
- Any change to `enrichTeamMember` or the underlying `@nexusmd/core` team module — the enriched
  shape (`active`, `blocked`, `done`, `myPRs`, `current`, `points`, `myWIs`) already has everything
  needed.
- Profile-scoping of the `nexusmd.team.notes` storage key — it's already a plain, non-profile-
  scoped `window.localStorage` key on desktop (confirmed via
  `packages/ui/tests/team-notes.test.jsx` and `apps/desktop/src/main.jsx`'s
  `storage: window.localStorage` wiring), and this design doesn't change that.
- Any other app (`apps/app`, `apps/web`) — this is desktop-drawer + shared-`TeamView` work only;
  the other apps don't render a person-profile drawer today.

## Data flow

```
DevCard (packages/ui) — dev = enrichTeamMember(...), already has
  { active, blocked, done, myPRs, current, points, myWIs }
      │ onClick / "Open profile" menu item
      ▼
onOpenPerson(dev)                                    [unchanged signature]
      │
      ▼
App (apps/desktop/src/main.jsx)
  openPerson = dev => setDrawer({ kind: 'person', data: dev })     [already exists]
      │
      ▼
DesktopDetailDrawer
  — gains onOpenItem / onOpenPR props (App already has openItem/openPR; just pass them through)
      │
      ▼
PersonSummary(dev, onOpenItem, onOpenPR)
  — reads dev.active / dev.blocked / dev.myPRs / dev.points directly (no re-filtering)
  — row click → onOpenItem(w) / onOpenPR(p) → same setDrawer(), swaps kind in place
  — "Add note" / "Schedule 1:1" → window.dispatchEvent(new CustomEvent('nexusmd:team-add-note' | 'nexusmd:team-schedule-1on1', { detail: { id, name } }))
  — notes list: read from storage.getItem('nexusmd.team.notes') on mount, filtered by dev.id;
    refreshed on 'nexusmd:team-notes-changed'
  — note delete → window.dispatchEvent(new CustomEvent('nexusmd:team-delete-note', { detail: { noteId } }))
      │
      ▼
TeamView (packages/ui) — adds effect listeners for the three events above:
  'nexusmd:team-add-note'      → setNoteTarget({ id, name })
  'nexusmd:team-schedule-1on1' → setScheduleTarget({ id, name })
  'nexusmd:team-delete-note'   → deleteNote(noteId)
  — persistNotes(...) additionally dispatches 'nexusmd:team-notes-changed' after storage.setItem,
    so the drawer's independent read stays in sync without prop drilling
```

No new props cross the `TeamView` boundary — the event bridge is the only new "API," matching the
existing `nexusmd:navigate`/`nexusmd:create-wi` idiom already used elsewhere in this app.

## Component changes

### `packages/ui/src/views/view-team.jsx`

- `TeamView` adds one `React.useEffect` registering/cleaning up listeners for
  `nexusmd:team-add-note`, `nexusmd:team-schedule-1on1`, `nexusmd:team-delete-note`, calling
  `setNoteTarget`, `setScheduleTarget`, `deleteNote` respectively. `NoteModal`/
  `ScheduleOneOnOneModal` only need `{ id, name }` on `dev` — the event `detail` is that minimal
  shape, no need to look up the full enriched member.
- `persistNotes` dispatches `window.dispatchEvent(new CustomEvent('nexusmd:team-notes-changed', { detail: next }))` right after `storage.setItem(...)`, alongside the existing `pushPref` call.
- `DevCard`'s notes block (currently: header + up to 3 note rows with delete buttons + "+N more")
  is replaced with:
  ```jsx
  {notes.length > 0 && (
    <div className="dev-card-notes-count" onClick={e => { e.stopPropagation(); onOpenPerson(dev) }}>
      <Icon name="message" size={11}/> {notes.length} note{notes.length !== 1 ? 's' : ''}
    </div>
  )}
  ```
  positioned where the old block was (same border-top separator styling).
- `onDeleteNote` prop/plumbing to `DevCard` is removed (no longer used there) once the card no
  longer renders individual notes.

### `apps/desktop/src/main.jsx`

- `DesktopDetailDrawer` gains `onOpenItem`, `onOpenPR` props, passed from `App` (`openItem`,
  `openPR` already exist — add them to the `<DesktopDetailDrawer .../>` call site).
- `PersonSummary` rewritten:
  - Drop the `workItems`/`prs` props and the `useNexusData()` call in `DesktopDetailDrawer` used
    only to feed them (no longer needed) — use `dev.active`, `dev.blocked`, `dev.myPRs`,
    `dev.points`, `dev.myWIs.length` instead.
  - `useNexusData()` is still needed inside `PersonSummary` itself, for `storage` (to read/observe
    `nexusmd.team.notes`).
  - Stats strip: Active / Open PRs / Sprint pts (3 cells, matches `DevCard`'s `.dev-stat` styling).
  - Blocked callout: shown only if `dev.blocked.length > 0`, matching the card's danger-soft
    banner (icon + count + first blocked item's title).
  - Work item rows: `onClick={() => onOpenItem(w)}`.
  - PR rows: `onClick={() => onOpenPR(p)}`.
  - Notes section: reads `nexusmd.team.notes` from `storage` on mount (`JSON.parse(... || '[]')`,
    catch → `[]`), filters by `devId === dev.id`, re-reads on `nexusmd:team-notes-changed`. Each
    note row shows text + relative date + a delete button dispatching
    `nexusmd:team-delete-note` with `{ noteId: n.id }`. Empty state: "No notes yet."
  - Action bar (in the `<Drawer actions={...}>` slot, alongside the existing "Open in ADO"
    button): "Schedule 1:1" and "Add note" buttons dispatching their respective events with
    `{ id: dev.id, name: dev.name }`.

## Layout (drawer body, top to bottom)

```
[Avatar]  Name
          Role · TZ
          Focus text

┌─────────┬─────────┬─────────┐
│ Active  │ Open PRs│ Sprint  │
│   3     │   1     │  8 pts  │
└─────────┴─────────┴─────────┘

⚠ 1 blocker — <title of first blocked item>     (only if blocked.length > 0)

Active work (3)
  🔹 #123  Fix login redirect        →  (clickable)
  🔹 #456  Update dashboard styles   →

Open PRs (1)
  #789  Add retry logic              →

Notes (2)
  "Great work on the API"  · Jul 1        [🗑]
  "Pairing on the migration" · Jul 3      [🗑]

[drawer actions bar: Schedule 1:1 | Add note | Open in ADO]
```

## Error handling / edge cases

- `dev.blocked`/`active`/`myPRs`/`myWIs` are always arrays (guaranteed by `enrichTeamMember`) — no
  extra guards needed.
- Notes storage read failures (corrupt JSON) → catch, fall back to `[]`, matching `TeamView`'s
  existing pattern.
- Drawer opened for a member with no work items/PRs/notes → each section renders its own empty
  state; nothing crashes.
- Drawer opened, then the underlying team member is removed/hidden while the drawer is still
  open → no special handling; the drawer just keeps showing the stale `dev` snapshot it was
  opened with, consistent with how `wi`/`pr` drawer kinds already behave (they don't live-update
  either).

## Testing

- Extend `packages/ui/tests/team-notes.test.jsx`-style coverage in `packages/ui` for the three new
  `TeamView` event listeners (add-note, schedule-1:1, delete-note) and the card's `N notes` count
  line replacing the inline preview.
- New test(s) for `apps/desktop`'s `PersonSummary`: renders stats/blocked/notes from an enriched
  `dev` + storage snapshot, updates its notes list after `nexusmd:team-notes-changed`, and that
  row clicks call `onOpenItem`/`onOpenPR`.
- Existing `apps/desktop` vitest suite (245 tests as of the last run) and `packages/ui` suite must
  keep passing.
- Manual/E2E verification of the actual Electron window is environment-blocked in this sandbox
  (documented in `apps/desktop/.claude/skills/verify/SKILL.md`) — same caveat applies here; rely
  on the component/unit tests above plus careful code-path tracing.
