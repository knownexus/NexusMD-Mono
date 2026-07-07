# Per-Item Unseen/Alert Tracking

## Goals

Fix "alert count" badges (nav badge counts + row highlighting for new items) so each item owns its own seen/unseen state, and eliminate the loading-race bug where badges show new items that don't actually exist because counting happened before real data had loaded.

Today there are **two separate, divergent implementations**:
- Web/mobile (`apps/app/src/app.jsx:1533-1586`): per-item fingerprint map persisted to `localStorage`, keyed per profile.
- Desktop (`apps/desktop/src/main.jsx:675-711`): in-memory id-set diffing, not persisted, only detects new ids (not field changes).

Both have a loading-race bug: they can seed their "previous state" baseline from empty/placeholder data before the real dataset loads, causing every item to register as falsely "new" once real data arrives (desktop), or clobbering the persisted baseline with an empty snapshot (web).

This design replaces both with one shared implementation.

## Scope

**In scope:**
- New `useSeenTracking` hook in `packages/ui`, used by both `apps/app` and `apps/desktop`.
- Categories tracked: work items, PRs, builds, tests (matching today's coverage).
- Fixing the loading-race bug via an explicit `dataLoaded` gate.
- Persisting seen state per item (via the existing `usePersisted` storage abstraction), so desktop gains persistence it doesn't have today.
- Deleting the two existing bespoke effects (`app.jsx:1533-1586`, `main.jsx:675-711`) once the shared hook is wired in.

**Out of scope:**
- OS-level taskbar badge count (`apps/desktop/electron/ipc/badge.cjs`) — unaffected, continues to receive a total count from `unseenCounts`.
- Backend/cross-device sync of seen state (no backend exists — see `[[nexusmd-no-backend]]`).
- Changing what fields are tracked per category beyond what's tracked today.

## Data model

Per category, persisted state is a map of `{ [itemId]: lastSeenFingerprint }`, stored under the same key naming as today's web implementation (`helm_seen_<category>`) so existing web users' seen state carries over without a migration.

Fingerprints (unchanged from today's web logic):
```js
work:   x => `${x.id}|${x.state}`
pr:     x => `${x.id}|${x.status}`
builds: x => `${x.id}|${x.status}`
tests:  x => `${x.id}|${x.result}|${x.failedTests || 0}`
```

An item is unseen if its id is absent from the map, or its current fingerprint differs from the stored one. This map is the per-item "HasBeenSeen" state — no separate boolean field needed.

On every diff, ids no longer present in the current dataset are pruned from the persisted map, so storage doesn't grow unbounded as work items complete / PRs merge / builds age out.

## Hook API

`packages/ui/src/app-components.jsx` (next to `usePersisted`):

```js
const { unseenIds, unseenCounts, markSeen } = useSeenTracking(categories, dataLoaded, { storage, getProfileKey })
```

- `categories`: `{ [key]: { items: Array, fingerprint: (item) => string } }`
- `dataLoaded`: `boolean`. While `false`, the hook performs no reads, writes, or diffing — this is the loading-race fix. The first diff only ever runs once real data has genuinely loaded, so a placeholder/empty dataset can never be recorded as the "previous" baseline, and can never overwrite a real persisted baseline with an empty one.
- `storage`/`getProfileKey`: passed explicitly by the caller (e.g. `window.localStorage` and each app's own `getProfileKey`) rather than read from `useNexusData()` context. Desktop's `App()` component calls its own hooks *before* it renders `<NexusDataProvider>` as a child, so a context-based read there would silently miss the real profile-scoped storage. Explicit params work the same regardless of where in the component tree the hook is called.
- `unseenIds`: `{ [key]: Set<id> }` — for row highlighting (same shape both apps already consume).
- `unseenCounts`: `{ [key]: number }` — for nav badges.
- `markSeen(key)`: writes current fingerprints for every currently-loaded item in that category into the persisted map, and clears that category's entries from `unseenIds`/`unseenCounts`. Called when the user switches to that category's tab.

Internally, `useSeenTracking` reads/writes each category's map directly via the supplied `storage`/`getProfileKey`, then a single `useEffect` (gated on `dataLoaded` and the items arrays) does the diff/prune/update per category.

## Integration

- `apps/app/src/app.jsx`: delete the two effects at `1533-1586`; call `useSeenTracking({ work: {...}, pr: {...}, builds: {...}, tests: {...} }, dataLoaded)`, and call `markSeen(view)` in a `useEffect` keyed on `view` (replacing `1580-1586`). Existing consumers of `newItemIds`/`changeBadges` are re-pointed at `unseenIds`/`unseenCounts` — same shapes, so view components (`view-workitems.jsx`, `view-prs.jsx`, `view-builds.jsx`, `view-tests.jsx`) need no changes.
- `apps/desktop/src/main.jsx`: delete the two effects at `675-711`; same wiring. `useNexusSnapshot()` (`main.jsx:204-221`) has no loaded flag today — it returns `EMPTY_NEXUS_DATA` both before the first `refresh()` call and when there's genuinely no cache yet, so those two cases are indistinguishable as-is. Add a `loaded` boolean to its returned value, set to `true` after `refresh()` has run at least once (regardless of whether `cached` was present), and pass `loaded` as `useSeenTracking`'s `dataLoaded` argument.

## Testing

Run from each package's own directory (workspace/jsdom gap when run from repo root — see `[[nexusmd-test-runner-dirs]]`):

- `packages/ui`: unit tests for `useSeenTracking` covering:
  - New id → unseen; unchanged fingerprint → stays seen; changed fingerprint (e.g. work item state change) → unseen again.
  - `dataLoaded: false` → no state changes at all, regardless of what items are passed.
  - Regression case for the race: pre-seed the persisted map with fingerprints matching today's items, simulate a render pass with empty items + `dataLoaded: false` followed by real items + `dataLoaded: true` — assert `unseenCounts` stay at `0` (no false positives from the empty intermediate state).
  - Pruning: item removed from the dataset is removed from the persisted map on the next diff.
  - `markSeen(key)`: clears that category's `unseenIds`/`unseenCounts` and persists current fingerprints.
- No changes expected to existing view tests in `packages/ui/tests/views.test.jsx` since `unseenIds`/`unseenCounts` match the shapes those views already consume.
