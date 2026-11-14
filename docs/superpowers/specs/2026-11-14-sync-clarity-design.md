# Sync that says what is going on

"Sync" meant several things and gave no way to see whether anything was waiting. Each thing now has one name, and the state is visible without opening Settings.

## What changed

- **Unsaved counts.** `sync.unsaved()` (account-sync.js) returns `{ profiles: { [id]: n }, unattributed, total }`: local values that differ from the last synced ones, built on `listUnpushed`. Open conflicts are not counted (a decision, not something Save sends) and neither is a purged profile; `unattributed` is what belongs to no profile (the profiles list).
- **One source for every surface.** `useSyncSummary()` (packages/ui/src/sync-summary.js) gives `{ known, unsaved, conflicts, error, lastSyncAt }`. It reads again when a pull applies something, a conflict or error arrives, the window is focused, every 30 s, and on `refreshSyncSummary()` (the card calls it after a save or load). `known` is false without an account or on an engine that cannot count, and callers then show nothing, never "Nothing to save".
- **Data & sync card.** Each profile row says "N changes not saved"; **Save to server** is disabled with "Nothing to save" when the count is known to be 0.
- **Sidebar badge (desktop).** Saved / N unsaved / N conflicts / Sync error, most pressing first, hidden without an account; a click calls `openSettings('data')`. The phone's Data & sync line on the settings list carries the conflict and unsaved counts.
- **Conflict notice.** `toast(message, type, { action: { label, onClick } })` shows a button that runs the action and closes the toast (such a toast stays 9 s). The gate adds **Review** when the app supplies `account.reviewConflicts`.
- **`openSettings(tab)`** (packages/ui/src/open-settings.js) dispatches `nexusmd:open-settings`. The shell shows Settings, the Settings screen switches tab, and a tab asked for before Settings is mounted waits (5 s at most). It works for a plain `dispatchEvent` too. Used again by the Settings work (remembering the last tab).

## Names

| Was | Is |
| --- | --- |
| Settings card "Data & sync" (local storage) | **Local data** (the tab keeps "Data & sync": it holds all of it) |
| "Cloud Sync" card | **Google Drive / OneDrive sync**, button **Sync with Drive / OneDrive** |
| Sidebar "Updated 5m ago" | **Work data updated 5m ago** |
| "will sync when you're back" | "will be sent when you're back online" |
| "N changes waiting to sync" (phone) | "N changes waiting to be sent" |

## Not done here

The sidebar badge and the Review button need an account server to see for real; they are covered by unit tests against a real sync engine, and the navigation by a real-app test. The collapsed state of the two renamed cards is kept per card title, so each shows expanded once after the rename.
