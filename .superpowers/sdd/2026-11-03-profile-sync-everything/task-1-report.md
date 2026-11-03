# Task 1 report: Sync-format gate

Status: DONE. Commit cf3455b `feat(accounts): sync-format gate refuses outdated clients`.

## Implemented
- Server: `Services/Sync/SyncFormatGate.cs` (`IsOutdated(req, cfg)`: `Sync:MinFormat` default 1; missing/unparsable `X-Sync-Format` = 1; plus `Outdated()` returning 426 `{error, code:"client_outdated"}`). Called first in `ItemsController.Put`, `ItemsController.Batch`, `DevicesController.PutPrefs`. Reads are not gated.
- Client: `account-client.js` sends `X-Sync-Format: 2` on every request (in `send`); status 426 maps to `AccountError` code `client-outdated`.
- UI: `MESSAGES['client-outdated']` in account-gate.jsx (exact text from the brief).
- Docs: `Sync__MinFormat` row in docs/railway-deploy.md.

## TDD evidence
- RED server: `dtest.sh ... "FullyQualifiedName~SyncFormatGate"` -> `Failed! Failed: 1, Passed: 3` (only the 426 test fails; the other three pass before the gate exists, as they assert pre-gate behavior).
- GREEN server: full suite `Passed! Failed: 0, Passed: 292, Total: 292`.
- RED client: `npx vitest run --project core --maxWorkers=1 account-client` -> 2 failed (header undefined; code not client-outdated). `--project ui account-gate` -> 1 failed (message not found).
- GREEN: core account-client 55/55; ui account-gate 33/33.

## Files
apps/web/server/Services/Sync/SyncFormatGate.cs (new), Controllers/ItemsController.cs, Controllers/DevicesController.cs, apps/web/server-tests/SyncFormatGateTests.cs (new), packages/core/src/modules/account/account-client.js, packages/core/tests/account-client.test.js, packages/ui/src/account-gate.jsx, packages/ui/src/account-gate.test.jsx, docs/railway-deploy.md.

## Self-review / concerns
- The brief's "PUT /api/items batch" is actually `POST /api/items/batch`; the gate and test use POST.
- Program.cs needed no change (config default handled in the gate), so it was not touched.
- Gate runs before id/If-Match validation so an outdated client always gets 426. Header parsed with NumberStyles.None (digits only), so "+2" or " 2" count as format 1.
- Server tests are in a new file with own small helpers rather than reusing the private ones in DevicesItemsTests.
- The working tree had other implementers' uncommitted edits (key-registry.js, var-resolve.js); not touched or committed.

## Fix round 1
- CORS: `X-Sync-Format` added to WithHeaders of policy "CapacitorApp" in apps/web/server/Program.cs. Test `Cors_preflight_allows_the_sync_format_header` (OPTIONS from Origin "null", request headers incl. x-sync-format) in SyncFormatGateTests.cs.
- Ordering pinned: `Gate_runs_before_id_and_if_match_validation` (invalid id, and missing If-Match, no header, MinFormat=2 -> 426). Passed already at RED, as the gate is first.
- `Sync:MinFormat` now parsed with int.TryParse (non-numeric = 1). Test `Non_numeric_min_format_accepts_old_clients` ("two" -> write 200).
- RED (`dtest.sh ... "FullyQualifiedName~SyncFormatGate"`): `Failed: 2, Passed: 5` (CORS and non-numeric).
- GREEN: full server suite `Passed: 295/295`; `npx vitest run --project core --maxWorkers=1 account-client` 55/55.
- Note: Docker Desktop had stopped mid-task; restarted it.
