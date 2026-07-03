# Work Item → Linked PRs Design

**Date:** 2026-07-03
**Scope (changed/new):**
- `packages/core/src/modules/ado/loader.js` — fetch PR↔work-item links, populate `pr.linkedWorkItems`
- `packages/core/src/modules/ado/pr-links.js` (new) — pure reverse-index helper
- `packages/core/src/modules/ado/index.js` — export the helper
- `packages/ui/src/views/view-workitems.jsx` — real PR count + clickable indicator (board card + table)
- `packages/ui/src/views/view-prs.jsx` — focused-work-item filter + banner
- `apps/desktop/src/main.jsx` — carry the `nexusmd:navigate` `filter` payload through to `window.NexusMDNav`
- Tests in `packages/core/tests/` and `packages/ui/tests/`

## Context

On the work items **table and cards**, when a work item has associated pull
request(s), show a clickable indicator; clicking navigates to the in-app Pull
Requests view filtered to that work item's PR(s) ("outlining" them as PR rows).

**Key finding from exploration — the linkage data does not exist at runtime today:**
- `pr.linkedWorkItems` is normalized by `mapPR` (`mappers.js:55-59,74`) but the loader
  never populates it — no PR↔work-item fetch exists (`loader.js:103-115`). So it is
  always `[]`.
- The work-item `prs` field is hardcoded `0` in both mappers (`mappers.js:31`,
  `view-workitems.jsx:292`), so the PR icon slot on the card (`view-workitems.jsx:1171`)
  and table (`:1488`, grouped via `countKeys=['comments','prs']` at `:1491`) is dead.

So this feature needs a data-layer addition (fetch the links) before any UI can work.
This mirrors the recently-fixed comment-count gap (which was likewise hardcoded `0`).

## Decisions (from brainstorming)
- **Click behavior:** navigate to the in-app **Pull Requests view, filtered to the
  clicked work item's PR(s)**.
- **Surfaces:** board **cards** and the work-item **table**.
- **Data source:** ADO per-PR `pullRequests/{prId}/workitems` endpoint (accepted the
  extra ~one-call-per-active-PR cost).

---

## 1. Fetch the linkage (`loader.js`)

After the active PRs are fetched and before/while they are mapped, for each raw PR
call:

```
GET {project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/workitems?api-version=7.0
→ { value: [ { id, url }, … ] }
```

Populate each raw PR's `linkedWorkItems` with `value.map(w => ({ id: Number(w.id) }))`
before `mapPR` runs (or set it on the mapped object). Run these calls in parallel,
chunked the same way the existing batched fetches are, and swallow per-PR errors
(a failed link fetch degrades to `[]` for that PR, never breaks the load). Only ids
are needed downstream; `mapPR` already defaults `title/state/type` to `''`.

**Cost note (on record):** one extra request per active PR per refresh. Acceptable per
user decision. Repo id + PR id are already present on the raw PR objects used by the
loader.

## 2. Pure reverse-index helper (`pr-links.js`)

```js
// Map<workItemId(number), PR[]> from the loaded PRS array.
export function indexPRsByWorkItem(prs) {
  const map = new Map()
  for (const pr of prs || []) {
    for (const w of pr.linkedWorkItems || []) {
      const id = Number(w.id)
      if (!Number.isFinite(id)) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(pr)
    }
  }
  return map
}
```

Exported through `modules/ado/index.js` (re-exported by the core barrel). Pure,
unit-tested. The count for a work item is `index.get(id)?.length ?? 0`.

## 3. Work-item PR count + clickable indicator (`view-workitems.jsx`)

- Build the index once: `const prIndex = useMemo(() => indexPRsByWorkItem(NexusMDData.PRS), [NexusMDData.PRS])`.
- In the existing `allItems` memo (combines `items` + search `extraItems`), annotate
  each item: `prs: prIndex.get(item.id)?.length ?? 0`. This gives a consistent real
  count to both the board card and the table without touching the per-item mappers
  (their `prs:0` stays a harmless default that `allItems` overrides).
- Render the indicator as a **button** wherever `w.prs > 0` today:
  - Board card (`:1171`) and table `prs` cell (`:1488`).
  - Markup keeps the existing `<Icon name="pr"/> {w.prs}` content; wrap it in a
    button with `onClick={e => { e.stopPropagation(); navigateToPRs(w.id) }}`,
    `title="View linked pull requests"`, and link-styled affordance (accent color,
    pointer). `stopPropagation` prevents the card/row's open-detail handler firing.
  - `navigateToPRs(id)` dispatches:
    `window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'prs', filter: { workItemId: id } } }))`.

## 4. Focused-work-item filter in the PR view (`view-prs.jsx`)

`PRView` gains a `focusedWorkItem` state, populated from the pending navigation
filter the same way the planner view consumes it (`view-planner.jsx:106-114` reads and
clears `window.NexusMDNav.pendingFilter`):

- On mount / when the view becomes active, if `window.NexusMDNav?.pendingFilter?.workItemId`
  is set, store it as `focusedWorkItem` and clear `window.NexusMDNav.pendingFilter`.
- When `focusedWorkItem` is set, the `filtered` memo (currently `:118-131`) returns only
  PRs whose `linkedWorkItems.some(w => w.id === focusedWorkItem)`, **bypassing** the
  status `filter`/search (so no linked PR is hidden by an unrelated status filter).
- Render a banner above the list: `Showing pull requests for work item #<id>` with a
  **Clear** button that resets `focusedWorkItem` (returning to the normal status filter).
- Empty case: if no PRs match, the banner still shows with an empty-state message
  ("No pull requests linked to #<id>"), so the navigation never lands on a confusing
  blank list.

## 5. Navigation wiring (hosts)

- **Web** already stores the filter: `apps/web/src/app.jsx:1936-1943` sets
  `window.NexusMDNav = { pendingFilter: e.detail.filter || null, view }`. No change
  beyond `PRView` reading it (§4).
- **Desktop** currently drops the filter (`apps/desktop/src/main.jsx:776-786` reads only
  `detail.view`). Add: before `setView(next)`, set
  `window.NexusMDNav = { pendingFilter: (typeof detail === 'object' ? detail.filter : null) || null, view: next }`.
  (Builds on the string|object normalization already added to that handler.)

## 6. Testing

- **Core** (`pr-links.test.js`): `indexPRsByWorkItem` groups PRs by linked work-item id;
  a PR linked to two work items appears under both; PRs with no links / malformed ids
  are skipped; empty input → empty map.
- **Loader** (extend `loader.test.js` if its fetch mock allows): when the workitems
  endpoint returns ids, the mapped PR's `linkedWorkItems` contains them; a failing
  workitems fetch degrades that PR to `[]` without failing the load.
- **UI — work items** (`workitem-linked-prs.test.jsx`): a card/row for a work item with
  linked PRs (seed `NexusMDData.PRS` with a PR whose `linkedWorkItems` includes the id)
  renders a PR-count button; clicking it dispatches `nexusmd:navigate` with
  `{ view: 'prs', filter: { workItemId } }` and does **not** call the row/card `onOpen`.
- **UI — PR view** (`pr-focused-filter.test.jsx`): with `window.NexusMDNav.pendingFilter =
  { workItemId: 7 }`, `PRView` shows only PRs linked to #7 and the banner; **Clear**
  restores the full list.

## Out of scope
- Making the existing (non-functional) linked-work-item pills on PR rows clickable —
  reverse PR→WI navigation is a separate follow-up.
- Displaying PR titles/status on the work-item side (the indicator is a count; the
  PR view is where PRs are outlined).
- Fetching links for non-active PRs (only the already-loaded active PR set is indexed).
