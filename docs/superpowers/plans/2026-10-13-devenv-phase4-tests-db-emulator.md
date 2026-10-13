# Dev Environment Module — Phase 4 (Tests + Database + Emulator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Dev Environment tabs, so the API test stack, the local database and the Android emulator can be driven entirely from NexusMD.
- **Tests:** test stack up/down with API selection; Bruno collection tree and run; run history; HTML reports in an in-app window.
- **Database:** start, stop, backup, verify, restore a chosen baseline, run a profile SQL script, and turn the DbGate editor on or off.
- **Emulator:** start (AVD, proxy), stop, proxy on/off, push CA, push files (drag-and-drop), reinstall the app, and recreate the AVD after a confirmation.

**Architecture:** devenv gains five read-only data commands. Each emits one `result` line with a hidden `--json` switch, following the `status` / `build status` pattern (pure `ConvertTo-*` plus a reader in a `*-common.ps1`):

| Command | Result kind |
|---|---|
| `test runs` | `test-runs` |
| `test collection [--collection <folder>]` | `test-collection` |
| `db baselines` | `db-baselines` |
| `db scripts` | `db-scripts` |
| `emulator avds` | `emulator-avds` |

Every action is an existing devenv command, run through the provider's single run.

NexusMD gains:
- those queries in the `devenv:query` allowlist, with one validated folder argument for `test collection`;
- `.html` reports opening in a sandboxed in-app window;
- `pathForFile` for drag-and-drop;
- core normalisers and argv builders;
- three tabs.

**Tech Stack:** PowerShell 7.6 + Pester 6 (devenv); Electron 43 CJS main, React 18, Vitest 4 + Testing Library (no jest-dom) in NexusMD.

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Screens → Tests, Database, Emulator; the Phase 1 amendment "the in-app report window arrives with the Tests screen (phase 4)"; later amendments). Previous plan for patterns: `docs/superpowers/plans/2026-10-13-devenv-phase3-builds-logs.md`.

**Two repositories:**
- Tasks 1–2 change `C:\repos\dev-environment` on branch `feature/nexusmd-tests-db-emulator`, which already exists and is checked out.
- Tasks 3–7 change the NexusMD **worktree** `C:\repos\NexusMD-Mono-devenv4` on branch `feature/devenv-tests-db-emulator`, which already exists. Its `node_modules` are junctions prepared by the controller.
  - Work only in that worktree. The main checkout `C:\repos\NexusMD-Mono` belongs to another session and must not be touched.
- Task 8 spans both.

## Global Constraints

- With `DEVENV_HOST` unset, devenv's terminal behaviour stays exactly as today, apart from the new commands. Every existing command keeps its output and arguments.
- Control lines: `@@devenv ` followed by compact JSON. Protocol version stays `1`; the new result kinds are additive. Every new data command has `HSw=@('json')` and `Mut=$false`, and emits through `Write-DevenvEvent result $result -Force`.
- New result kinds (exact shapes in Tasks 1 and 2):

  | Kind | Shape |
  |---|---|
  | `test-runs` | `{ kind, runs: [{ id, label, at, env, collection, paths, services, exit, passed, requests, traceHtml, brunoHtml }], reports: [{ name, at, path }] }` |
  | `test-collection` | `{ kind, root, isDefault, error, items: [{ path, kind: 'folder'\|'request', depth }] }` |
  | `db-baselines` | `{ kind, latest, baselines: [{ id, createdUtc, size, isLatest, databases, sourceContainer, valid }] }` |
  | `db-scripts` | `{ kind, database, scripts: [{ id, about }] }` |
  | `emulator-avds` | `{ kind, avds, default, error }` |

- `devenv:query` accepts exactly these argv and nothing else:
  - `['status','--json']`
  - `['build','status','--json']`
  - `['logs','targets','--json']`
  - `['test','runs','--json']`
  - `['test','collection','--json']`
  - `['test','collection','--json','--collection', <absolute folder path not starting with '->]`
  - `['db','baselines','--json']`
  - `['db','scripts','--json']`
  - `['emulator','avds','--json']`
- Every action in the three tabs runs through the provider's single run, with `exclusive` taken from devenv's `Mut`. Read-only commands use `exclusive: false`: `test web`, `test report`, `db verify`. Every other action uses `exclusive: true`. All of a tab's action buttons are disabled while the provider's run is starting or running.
- Run labels are `devenv ${argv.join(' ')}`.
- `.html` / `.htm` files opened through `devenv:open` (from devenv `open` events or from a tab) open in a sandboxed NexusMD window: no preload, `contextIsolation`, no node integration. http(s) links in it open in the system browser. Other files keep `shell.openPath`.
- Recreating an AVD deletes it. The Emulator tab asks first, with a two-step confirmation, before running `emulator create`.
- NexusMD code style: ESM without semicolons in `src/` and `packages/`; CommonJS with semicolons in `electron/*.cjs`. devenv code style: compact PowerShell as in the existing files. Comments explain why, never what.
- Desktop tests always run with `NODE_OPTIONS=--no-experimental-webstorage` (Node 26 here). Pester runs as `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester <path> -Output Detailed"` from `C:\repos\dev-environment`.
- **JS test strings keep Windows paths escaped:** `'C:\\x'`, with two backslash characters in the source. Write files with the Write/Edit tools, never through a shell heredoc (heredocs have collapsed them before). Afterwards, grep new test files for a single-backslash `'C:\`.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A profile without test APIs.** `test.ps1` throws "The profile has no repositories with a "test" block…" for every action. The Tests tab must show that error, not a blank tab. Pinned in Task 5: query errors are rendered.
2. **A collection folder without `bruno.json`.** `test collection --json` returns `error` and no items, and still exits 0. The tab shows the error and offers no Run. Pinned in Task 1 (Pester) and Task 5.
3. **Recreating an AVD is destructive.** A single click must never run `emulator create`. Pinned in Task 7: the first click only asks; "Keep it" backs out.
4. **Pushing to a bad destination, or with no files.** The push is refused in NexusMD with devenv's rule (destination starts with `/sdcard/` or `/storage/`), and no run starts. Pinned in Task 4 (argv builder) and Task 7.
5. **Opening a report twice, or clicking a link inside a report.** The existing window is focused and reloaded. Links never navigate the report window away; http(s) goes to the system browser. Pinned in Task 3.

---

### Task 1: devenv — `test runs` and `test collection`

**Repository:** `C:\repos\dev-environment` (branch `feature/nexusmd-tests-db-emulator`, already checked out)

**Files:**
- Create: `test-common.ps1`
- Modify: `test.ps1`:
  - `Action` ValidateSet plus `Runs` and `Collection`;
  - a `-Json` switch;
  - dot-source `test-common.ps1`;
  - two switch branches.
- Modify: `devenv.ps1` (two command entries in the `# --- test` block)
- Test: `tests/test-data.Tests.ps1` (new), `tests/catalog.Tests.ps1`

**Interfaces:**
- Consumes: `Write-DevenvEvent` (host-common.ps1); `$dirs.Runs`, `$dirs.Reports`, `$bundledCollection`, `$Collection` (already in test.ps1).
- Produces, for Tasks 3–5:
  - `devenv test runs --json` → one line, kind `test-runs`. It lists the 50 newest runs, newest first, and the 20 newest ad-hoc reports.
  - `devenv test collection [--collection <folder>] --json` → one line, kind `test-collection`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test-data.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'host-common.ps1')
 . (Join-Path $root 'test-common.ps1')
}

Describe 'Get-DevenvBrunoCounts' {
 It 'reads the first iteration of bru''s JSON report, counting errors as failures' {
  $f=Join-Path $TestDrive 'b.json'
  Set-Content $f '[{"iterationIndex":0,"results":[],"summary":{"totalRequests":5,"passedRequests":3,"failedRequests":1,"errorRequests":1}}]'
  $c=Get-DevenvBrunoCounts $f
  $c.total | Should -Be 5; $c.passed | Should -Be 3; $c.failed | Should -Be 2
 }
 It 'accepts a single object too' {
  $f=Join-Path $TestDrive 'o.json'
  Set-Content $f '{"summary":{"totalRequests":1,"passedRequests":1,"failedRequests":0}}'
  (Get-DevenvBrunoCounts $f).passed | Should -Be 1
 }
 It 'is null when missing, malformed or without a summary' {
  Get-DevenvBrunoCounts (Join-Path $TestDrive 'none.json') | Should -BeNullOrEmpty
  $bad=Join-Path $TestDrive 'bad.json'; Set-Content $bad '{not json'
  Get-DevenvBrunoCounts $bad | Should -BeNullOrEmpty
  $odd=Join-Path $TestDrive 'odd.json'; Set-Content $odd '[{"results":[]}]'
  Get-DevenvBrunoCounts $odd | Should -BeNullOrEmpty
 }
}

Describe 'test runs' {
 BeforeAll {
  $runs=Join-Path $TestDrive 'runs'; $reports=Join-Path $TestDrive 'reports'
  $a=Join-Path $runs '20261013-101500-smoke'; $b=Join-Path $runs '20261013-120000-api-tests'; $odd=Join-Path $runs 'x'
  New-Item -ItemType Directory $a,$b,$odd,$reports -Force | Out-Null
  Set-Content (Join-Path $b 'run.json') '{"collection":"C:\\c","paths":["smoke"],"env":"docker","services":["orders"],"brunoExit":1,"at":"2026-10-13T12:00:00+01:00"}'
  Set-Content (Join-Path $b 'bruno.json') '[{"summary":{"totalRequests":2,"passedRequests":1,"failedRequests":1,"errorRequests":0}}]'
  Set-Content (Join-Path $b 'trace.html') '<html></html>'
  Set-Content (Join-Path $reports 'trace-20261013-090000.html') '<html></html>'
  Set-Content (Join-Path $reports 'notes.txt') 'x'
  $script:r=ConvertTo-DevenvTestRuns -Runs @(Get-DevenvTestRunInput $runs) -Reports @(Get-DevenvTestReportInput $reports)
 }
 It 'is a test-runs result, newest first, with labels from the folder name' {
  $script:r.kind | Should -Be 'test-runs'
  $script:r.runs.id | Should -Be @('x','20261013-120000-api-tests','20261013-101500-smoke')
  ($script:r.runs | Where-Object id -eq '20261013-120000-api-tests').label | Should -Be 'api-tests'
  ($script:r.runs | Where-Object id -eq 'x').label | Should -Be 'x'
 }
 It 'reads run.json, the outcome and the counts' {
  $run=$script:r.runs | Where-Object id -eq '20261013-120000-api-tests'
  $run.env | Should -Be 'docker'
  $run.paths | Should -Be @('smoke')
  $run.services | Should -Be @('orders')
  $run.exit | Should -Be 1
  $run.passed | Should -BeFalse
  $run.requests.total | Should -Be 2
  $run.traceHtml | Should -Match 'trace\.html$'
  $run.brunoHtml | Should -BeNullOrEmpty
  $run.at | Should -Match '^2026-10-13T'
 }
 It 'falls back to the folder time and an unknown outcome without run.json' {
  $run=$script:r.runs | Where-Object id -eq '20261013-101500-smoke'
  $run.passed | Should -BeNullOrEmpty
  $run.exit | Should -BeNullOrEmpty
  $run.at | Should -Match '^2026-10-13T10:15:00'
 }
 It 'lists ad-hoc call-chain reports only' {
  $script:r.reports.name | Should -Be @('trace-20261013-090000.html')
  $script:r.reports[0].at | Should -Match '^2026-10-13T09:00:00'
 }
 It 'is empty, not an error, when nothing has run yet' {
  $e=ConvertTo-DevenvTestRuns -Runs @(Get-DevenvTestRunInput (Join-Path $TestDrive 'nope')) -Reports @()
  @($e.runs).Count | Should -Be 0
 }
}

Describe 'test collection' {
 BeforeAll {
  $c=Join-Path $TestDrive 'col'
  New-Item -ItemType Directory "$c/environments","$c/smoke/deep","$c/.git" -Force | Out-Null
  foreach ($f in 'bruno.json','collection.bru','environments/docker.bru','smoke/folder.bru','smoke/orders.bru','smoke/deep/a.bru','top.bru','readme.md','.git/x.bru') { Set-Content (Join-Path $c $f) 'x' }
  $script:items=@(Get-DevenvTestCollectionInput $c)
 }
 It 'lists folders before requests, depth-first, with collection-relative / paths' {
  $script:items.Path | Should -Be @('smoke','smoke/deep','smoke/deep/a.bru','smoke/orders.bru','top.bru')
  ($script:items | Where-Object Path -eq 'smoke/deep/a.bru').Depth | Should -Be 2
  ($script:items | Where-Object Path -eq 'smoke').Kind | Should -Be 'folder'
  ($script:items | Where-Object Path -eq 'top.bru').Kind | Should -Be 'request'
 }
 It 'converts to a test-collection result' {
  $r=ConvertTo-DevenvTestCollection -Root 'C:\c' -IsDefault $true -Items $script:items
  $r.kind | Should -Be 'test-collection'
  $r.isDefault | Should -BeTrue
  $r.error | Should -BeNullOrEmpty
  $r.items[0].path | Should -Be 'smoke'
 }
 It 'carries a problem with no items' {
  $r=ConvertTo-DevenvTestCollection -Root 'C:\c' -IsDefault $false -Items @() -Problem 'Not a Bruno collection'
  $r.error | Should -Be 'Not a Bruno collection'
  @($r.items).Count | Should -Be 0
 }
}

Describe 'devenv test runs / collection --json' {
 BeforeAll {
  $script:run={ param([string[]]$a)
   $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
   try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') @a); @{Lines=$lines;Code=$LASTEXITCODE} }
   finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  }
 }
 It 'test runs --json prints one test-runs line and exits 0' {
  $o=& $script:run @('test','runs','--json')
  $o.Code | Should -Be 0
  $o.Lines.Count | Should -Be 1
  ($o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable).kind | Should -Be 'test-runs'
 }
 It 'test collection --json lists the profile collection' {
  $o=& $script:run @('test','collection','--json')
  $o.Code | Should -Be 0
  $r=$o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'test-collection'
  $r.isDefault | Should -BeTrue
  $r.items.path | Should -Contain 'smoke/orders.bru'
 }
 It 'test collection --json reports a folder that is not a collection, still exit 0' {
  $o=& $script:run @('test','collection','--collection',$TestDrive,'--json')
  $o.Code | Should -Be 0
  ($o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable).error | Should -Match 'Not a Bruno collection'
 }
}
```

In `tests/catalog.Tests.ps1`, inside `Describe 'devenv help --json'`, add:

```powershell
 It 'test runs and test collection are read-only and hide --json' {
  foreach ($c in @((Get-Cmd 'test' 'runs'),(Get-Cmd 'test' 'collection'))) {
   $c.mut | Should -BeFalse
   $c.switches | Should -Not -Contain 'json'
  }
  (Get-Cmd 'test' 'collection').values | Should -Contain 'collection'
 }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/test-data.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL. `test-common.ps1` is not found, and there are no catalog entries.

- [ ] **Step 3: Implement `test-common.ps1`**

```powershell
#requires -Version 7.0
# The API test stack's run history and Bruno collection as data for NexusMD's Tests tab
# (devenv test runs --json, devenv test collection --json). Conversions are pure; the Get-*
# functions do the reading.

function ConvertFrom-DevenvStamp([string]$Stamp) {
 # Run folders and report files start with a local yyyyMMdd-HHmmss time.
 try { [datetime]::ParseExact($Stamp,'yyyyMMdd-HHmmss',[Globalization.CultureInfo]::InvariantCulture).ToString('o') } catch { $null }
}

function Get-DevenvBrunoCounts([string]$Path) {
 # bru's JSON reporter writes one entry per iteration; devenv runs a single iteration.
 if (!(Test-Path -LiteralPath $Path)) { return $null }
 try { $j=Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable } catch { return $null }
 $first=if ($j -is [Collections.IList]) { $j | Select-Object -First 1 } else { $j }
 $s=if ($first -is [Collections.IDictionary]) { $first['summary'] }
 if (!($s -is [Collections.IDictionary]) -or $null -eq $s['totalRequests']) { return $null }
 [ordered]@{ total=[int]$s['totalRequests']; passed=[int]$s['passedRequests']; failed=[int]$s['failedRequests']+[int]$s['errorRequests'] }
}

function ConvertTo-DevenvTestRuns([object[]]$Runs=@(),[object[]]$Reports=@()) {
 [ordered]@{
  kind='test-runs'
  runs=@(foreach ($r in $Runs) {
   [ordered]@{
    id=$r.Id; label=$r.Label; at=$r.At; env=$r.Env; collection=$r.Collection
    paths=@($r.Paths); services=@($r.Services)
    exit=$r.Exit
    passed=$(if ($null -eq $r.Exit) { $null } else { $r.Exit -eq 0 })
    requests=$r.Requests
    traceHtml=$r.TraceHtml; brunoHtml=$r.BrunoHtml
   }
  })
  reports=@(foreach ($p in $Reports) { [ordered]@{ name=$p.Name; at=$p.At; path=$p.Path } })
 }
}

function Get-DevenvTestRunInput([string]$RunsDir,[int]$Limit=50) {
 foreach ($d in @(Get-ChildItem -LiteralPath $RunsDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First $Limit)) {
  $meta=@{}
  $f=Join-Path $d.FullName 'run.json'
  if (Test-Path -LiteralPath $f) { try { $meta=Get-Content -LiteralPath $f -Raw | ConvertFrom-Json -AsHashtable } catch { } }
  $trace=Join-Path $d.FullName 'trace.html'; $bruno=Join-Path $d.FullName 'bruno.html'
  @{
   Id=$d.Name
   # The folder is yyyyMMdd-HHmmss-<label>, the label being the run's --name or what it ran.
   Label=$(if ($d.Name.Length -gt 16) { $d.Name.Substring(16) } else { $d.Name })
   At=$(if ($meta['at']) { ([datetime]$meta['at']).ToString('o') } elseif ($d.Name.Length -ge 15) { ConvertFrom-DevenvStamp $d.Name.Substring(0,15) } else { $null })
   Env=$meta['env']; Collection=$meta['collection']
   Paths=@($meta['paths'] | Where-Object { $_ }); Services=@($meta['services'] | Where-Object { $_ })
   Exit=$(if ($null -ne $meta['brunoExit']) { [int]$meta['brunoExit'] } else { $null })
   Requests=Get-DevenvBrunoCounts (Join-Path $d.FullName 'bruno.json')
   TraceHtml=$(if (Test-Path -LiteralPath $trace) { $trace } else { $null })
   BrunoHtml=$(if (Test-Path -LiteralPath $bruno) { $bruno } else { $null })
  }
 }
}

function Get-DevenvTestReportInput([string]$ReportsDir,[int]$Limit=20) {
 foreach ($f in @(Get-ChildItem -LiteralPath $ReportsDir -Filter 'trace-*.html' -File -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First $Limit)) {
  @{ Name=$f.Name; Path=$f.FullName; At=(ConvertFrom-DevenvStamp ($f.BaseName -replace '^trace-','')) }
 }
}

function Get-DevenvTestCollectionInput([string]$Root) {
 # What bru run accepts: folders and .bru requests, relative to the collection and /-separated.
 # environments/ holds env files, and folder.bru / collection.bru are settings, not requests.
 $items=[Collections.Generic.List[object]]::new()
 $walk={ param($dir,$rel,$depth)
  foreach ($c in @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Sort-Object @{e={!$_.PSIsContainer}},Name)) {
   if ($c.Name.StartsWith('.') -or $c.Name -in @('node_modules','environments')) { continue }
   $path=if ($rel) { "$rel/$($c.Name)" } else { $c.Name }
   if ($c.PSIsContainer) { $items.Add(@{Path=$path;Kind='folder';Depth=$depth}); & $walk $c.FullName $path ($depth+1) }
   elseif ($c.Extension -eq '.bru' -and $c.Name -notin @('folder.bru','collection.bru')) { $items.Add(@{Path=$path;Kind='request';Depth=$depth}) }
  }
 }
 & $walk $Root '' 0
 ,$items.ToArray()
}

function ConvertTo-DevenvTestCollection([string]$Root,[bool]$IsDefault,[object[]]$Items=@(),[string]$Problem) {
 [ordered]@{
  kind='test-collection'; root=$Root; isDefault=$IsDefault
  error=$(if ($Problem) { $Problem } else { $null })
  items=@(foreach ($i in $Items) { [ordered]@{ path=$i.Path; kind=$i.Kind; depth=$i.Depth } })
 }
}
```

- [ ] **Step 4: Wire `test.ps1` and `devenv.ps1`**

In `test.ps1`:
- Add `'Runs','Collection'` to the `Action` ValidateSet.
- Add `[switch]$Json` after `[switch]$AllApis`, keeping the comment that sits above `$AllApis`.
- After `. (Join-Path $root 'launcher-common.ps1')`, add `. (Join-Path $root 'test-common.ps1')   # ConvertTo-DevenvTestRuns, ConvertTo-DevenvTestCollection`.
- Add these branches to the `switch ($Action)` block. Neither needs Docker:

```powershell
 'Runs' {
  $result=ConvertTo-DevenvTestRuns -Runs @(Get-DevenvTestRunInput $dirs.Runs) -Reports @(Get-DevenvTestReportInput $dirs.Reports)
  if ($Json) { Write-DevenvEvent result $result -Force; return }
  if (!$result.runs) { Write-Note 'No runs yet: devenv test run' }
  foreach ($r in $result.runs) {
   $outcome=if ($null -eq $r.passed) { '?' } elseif ($r.passed) { 'passed' } else { 'FAILED' }
   $counts=if ($r.requests) { "$($r.requests.passed)/$($r.requests.total) requests" } else { '' }
   Write-Host ("   {0,-40} {1,-7} {2}" -f $r.id,$outcome,$counts) -ForegroundColor $(if ($null -eq $r.passed) { 'DarkGray' } elseif ($r.passed) { 'Green' } else { 'Red' })
  }
 }
 'Collection' {
  $folder=if ($Collection) { [IO.Path]::GetFullPath($Collection) } else { $bundledCollection }
  $problem=if (!(Test-Path -LiteralPath (Join-Path $folder 'bruno.json'))) { "Not a Bruno collection (no bruno.json): $folder" }
  $items=if ($problem) { @() } else { @(Get-DevenvTestCollectionInput $folder) }
  $result=ConvertTo-DevenvTestCollection -Root $folder -IsDefault ($folder -eq $bundledCollection) -Items $items -Problem $problem
  if ($Json) { Write-DevenvEvent result $result -Force; return }
  if ($problem) { throw $problem }
  Write-Host "   $folder" -ForegroundColor DarkCyan
  foreach ($i in $result.items) { Write-Host ("   {0}{1}" -f ('  ' * ($i.depth+1)),$i.path.Split('/')[-1]) }
 }
```

In `devenv.ps1`, after the `test status` entry, add:

```powershell
 @{G='test';V='runs';A='';S='Past test runs: outcome, request counts and their reports';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{Action='Runs'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'test.ps1' $n }}
 @{G='test';V='collection';A='';S='The folders and requests in a Bruno collection (default: the profile''s api-tests)';Sw=@();HSw=@('json');Val=@('collection');P=@{collection='folder'};Mut=$false
   Run={ param($a,$o) $n=@{Action='Collection'}; if ($o['collection']) { $n.Collection=$o['collection'] }; if ($o['json']) { $n.Json=$true }; Invoke-Script 'test.ps1' $n }}
```

- [ ] **Step 5: Run the tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/test-data.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: PASS. Then run the whole suite once, `Invoke-Pester ./tests`, which had 88 passing before this task. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test-common.ps1 test.ps1 devenv.ps1 tests/test-data.Tests.ps1 tests/catalog.Tests.ps1
git commit -m "feat: devenv test runs and test collection for NexusMD"
```

---

### Task 2: devenv — `db baselines`, `db scripts`, `emulator avds`

**Repository:** `C:\repos\dev-environment`

**Files:**
- Create: `db-common.ps1` (`Get-DevenvSqlScripts`, `ConvertTo-DevenvBaselines`, `Get-DevenvBaselineInput`), `db-list.ps1`
- Create: `emulator-common.ps1` (`ConvertTo-DevenvAvds`, `Get-DevenvEmulatorExe`), `emulator-avds.ps1`
- Modify: `devenv.ps1`:
  - dot-source `db-common.ps1`;
  - `Invoke-SqlScript` uses `Get-DevenvSqlScripts`;
  - three command entries.
- Modify: `README.md` ("Running under NexusMD" data-commands paragraph)
- Test: `tests/db-emulator-data.Tests.ps1` (new), `tests/catalog.Tests.ps1`

**Interfaces:**
- Produces, for Tasks 3, 4, 6 and 7:
  - `devenv db baselines --json` → kind `db-baselines`, with baselines newest first.
  - `devenv db scripts --json` → kind `db-scripts`.
  - `devenv emulator avds --json` → kind `emulator-avds`. With no Android SDK, `avds` is `[]` and `error` is set, and the command still exits 0.

- [ ] **Step 1: Write the failing tests**

Create `tests/db-emulator-data.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'host-common.ps1')
 . (Join-Path $root 'db-common.ps1')
 . (Join-Path $root 'emulator-common.ps1')
}

Describe 'Get-DevenvSqlScripts' {
 It 'lists scripts by name with the description from their first comment line' {
  $d=Join-Path $TestDrive 'sql'; New-Item -ItemType Directory $d | Out-Null
  Set-Content (Join-Path $d 'b.sql') "-- b.sql - reset the orders`nSELECT 1"
  Set-Content (Join-Path $d 'a.sql') "/*`n a.sql (needs sysadmin) - add test users`n*/"
  Set-Content (Join-Path $d 'empty.sql') ''
  $s=@(Get-DevenvSqlScripts $d)
  $s.id | Should -Be @('a','b','empty')
  ($s | Where-Object id -eq 'b').about | Should -Be 'reset the orders'
  ($s | Where-Object id -eq 'a').about | Should -Be 'add test users'
  ($s | Where-Object id -eq 'empty').about | Should -Be ''
 }
 It 'is empty without a sql folder' { @(Get-DevenvSqlScripts (Join-Path $TestDrive 'none')).Count | Should -Be 0 }
}

Describe 'baselines' {
 BeforeAll {
  $b=Join-Path $TestDrive 'backups'
  $new=Join-Path $b '20261013T120000Z-aaaaaaaa'; $old=Join-Path $b '20261001T080000Z-bbbbbbbb'; $junk=Join-Path $b 'not-a-baseline'
  New-Item -ItemType Directory $new,$old,$junk -Force | Out-Null
  Set-Content (Join-Path $new 'manifest.json') '{"schemaVersion":1,"id":"20261013T120000Z-aaaaaaaa","createdUtc":"2026-10-13T12:00:00Z","sourceContainer":"sql-dev","databases":[{"name":"Orders_Local"},{"name":"Billing_Local"}]}'
  Set-Content (Join-Path $new 'Orders_Local.bak') ('x' * 2048)
  $script:r=ConvertTo-DevenvBaselines -Items @(Get-DevenvBaselineInput $b) -Latest '20261013T120000Z-aaaaaaaa'
 }
 It 'lists baseline folders newest first and skips others' {
  $script:r.kind | Should -Be 'db-baselines'
  $script:r.baselines.id | Should -Be @('20261013T120000Z-aaaaaaaa','20261001T080000Z-bbbbbbbb')
 }
 It 'reads the manifest and marks the latest' {
  $n=$script:r.baselines[0]
  $n.isLatest | Should -BeTrue
  $n.valid | Should -BeTrue
  $n.databases | Should -Be @('Orders_Local','Billing_Local')
  $n.sourceContainer | Should -Be 'sql-dev'
  $n.createdUtc | Should -Match '^2026-10-13T12:00:00'
  $n.size | Should -BeGreaterThan 2000
  $script:r.latest | Should -Be '20261013T120000Z-aaaaaaaa'
 }
 It 'marks a baseline without a manifest as not valid' {
  $o=$script:r.baselines[1]
  $o.valid | Should -BeFalse
  $o.isLatest | Should -BeFalse
  @($o.databases).Count | Should -Be 0
 }
 It 'is empty without a backups folder' {
  @((ConvertTo-DevenvBaselines -Items @(Get-DevenvBaselineInput (Join-Path $TestDrive 'nope'))).baselines).Count | Should -Be 0
 }
}

Describe 'ConvertTo-DevenvAvds' {
 It 'lists AVD names with the default' {
  $r=ConvertTo-DevenvAvds -Names @('Pixel_9','Tablet') -Default 'Pixel_9'
  $r.kind | Should -Be 'emulator-avds'
  $r.avds | Should -Be @('Pixel_9','Tablet')
  $r.default | Should -Be 'Pixel_9'
  $r.error | Should -BeNullOrEmpty
 }
 It 'carries a problem with no names' {
  $r=ConvertTo-DevenvAvds -Names @() -Default 'Pixel_9' -Problem 'no SDK'
  @($r.avds).Count | Should -Be 0
  $r.error | Should -Be 'no SDK'
 }
}

Describe 'devenv db baselines / db scripts / emulator avds --json' {
 BeforeAll {
  $script:run={ param([string[]]$a)
   $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
   try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') @a); @{Lines=$lines;Code=$LASTEXITCODE} }
   finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  }
 }
 It 'db baselines --json prints one db-baselines line and exits 0' {
  $o=& $script:run @('db','baselines','--json')
  $o.Code | Should -Be 0; $o.Lines.Count | Should -Be 1
  ($o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable).kind | Should -Be 'db-baselines'
 }
 It 'db scripts --json lists the profile''s scripts and default database' {
  $o=& $script:run @('db','scripts','--json')
  $o.Code | Should -Be 0
  $r=$o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'db-scripts'
  $r.database | Should -Be 'Orders_Local'
  ($r.scripts | Where-Object { $_.id -eq 'example' }).about | Should -Match '^a script for devenv db sql'
 }
 It 'emulator avds --json exits 0 with a list or an error' {
  $o=& $script:run @('emulator','avds','--json')
  $o.Code | Should -Be 0
  $r=$o.Lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'emulator-avds'
  (@($r.avds).Count -gt 0 -or $r.error) | Should -BeTrue
 }
}
```

Add to `tests/catalog.Tests.ps1`:

```powershell
 It 'db baselines, db scripts and emulator avds are read-only and hide --json' {
  foreach ($c in @((Get-Cmd 'db' 'baselines'),(Get-Cmd 'db' 'scripts'),(Get-Cmd 'emulator' 'avds'))) {
   $c.mut | Should -BeFalse
   $c.switches | Should -Not -Contain 'json'
  }
 }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/db-emulator-data.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL — `db-common.ps1` not found.

- [ ] **Step 3: Implement `db-common.ps1` and `db-list.ps1`**

`db-common.ps1`:

```powershell
#requires -Version 7.0
# The local database's baselines and the profile's SQL scripts as data (devenv db baselines /
# db scripts --json for NexusMD's Database tab; the script list is also db sql's picker).

function Get-DevenvSqlScripts([string]$SqlDir) {
 @(Get-ChildItem -LiteralPath $SqlDir -Filter '*.sql' -File -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
  $first=Get-Content -LiteralPath $_.FullName -TotalCount 6 | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*/\*\s*$' } | Select-Object -First 1
  $about=if ($first) { ($first.Trim() -replace '^\s*(/\*|--)\s*','' -replace '^\S+\.sql(\s*\([^)]*\))?\s*-\s*','').Trim() } else { '' }
  @{id=$_.BaseName;about=$about}
 })
}

function ConvertTo-DevenvBaselines([object[]]$Items=@(),[string]$Latest) {
 [ordered]@{
  kind='db-baselines'; latest=$(if ($Latest) { $Latest } else { $null })
  baselines=@(foreach ($b in $Items) {
   [ordered]@{ id=$b.Id; createdUtc=$b.CreatedUtc; size=$b.Size; isLatest=($b.Id -eq $Latest); databases=@($b.Databases); sourceContainer=$b.SourceContainer; valid=[bool]$b.Valid }
  })
 }
}

function Get-DevenvBaselineInput([string]$BackupsDir) {
 # Newest first; only folders named like a baseline id (what database.ps1 Restore accepts).
 foreach ($d in @(Get-ChildItem -LiteralPath $BackupsDir -Directory -ErrorAction SilentlyContinue | Where-Object Name -match '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$' | Sort-Object Name -Descending)) {
  $m=$null; $f=Join-Path $d.FullName 'manifest.json'
  if (Test-Path -LiteralPath $f) { try { $m=Get-Content -LiteralPath $f -Raw | ConvertFrom-Json -AsHashtable } catch { } }
  @{
   Id=$d.Name
   CreatedUtc=$(if ($m -and $m['createdUtc']) { ([datetime]$m['createdUtc']).ToUniversalTime().ToString('o') } else { $null })
   Size=[long](Get-ChildItem -LiteralPath $d.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
   Databases=@(if ($m) { @($m['databases']) | Where-Object { $_ } | ForEach-Object { $_['name'] } })
   SourceContainer=$(if ($m) { $m['sourceContainer'] } else { $null })
   Valid=[bool]$m
  }
 }
}
```

`db-list.ps1`:

```powershell
#requires -Version 7.0
# devenv db baselines / db scripts: what NexusMD's Database tab offers (--json for NexusMD).
param([ValidateSet('Baselines','Scripts')][string]$What='Baselines',[switch]$Json)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/launcher-common.ps1"
. "$PSScriptRoot/db-common.ps1"
if ($What -eq 'Baselines') {
 $dbRoot=Join-Path $PSScriptRoot '.local/database'
 $latestFile=Join-Path $dbRoot 'latest.txt'
 $latest=if (Test-Path -LiteralPath $latestFile) { (Get-Content -LiteralPath $latestFile -Raw).Trim() }
 $result=ConvertTo-DevenvBaselines -Items @(Get-DevenvBaselineInput (Join-Path $dbRoot 'backups')) -Latest $latest
 if ($Json) { Write-DevenvEvent result $result -Force; return }
 if (!$result.baselines) { Write-Host '   No baselines yet: devenv db backup'; return }
 foreach ($b in $result.baselines) { Write-Host ("   {0}{1}  {2:N0} MB  {3}" -f $b.id,$(if ($b.isLatest) { ' (latest)' } else { '' }),($b.size/1MB),($b.databases -join ', ')) }
 return
}
$config=Get-DevEnvConfig
$db=if ($config['database']) { $config.database['name'] }
$result=[ordered]@{ kind='db-scripts'; database=$(if ($db) { $db } else { $null }); scripts=@(Get-DevenvSqlScripts (Join-Path (Get-DevEnvProfileDir) 'sql')) }
if ($Json) { Write-DevenvEvent result $result -Force; return }
foreach ($s in $result.scripts) { Write-Host ("   {0,-24} {1}" -f $s.id,$s.about) }
```

In `devenv.ps1`:
- After the `launcher-common.ps1` dot-source line, add `. (Join-Path $root 'db-common.ps1')        # Get-DevenvSqlScripts`.
- In `Invoke-SqlScript`, replace the whole `$entries=@(Get-ChildItem $sqlDir … })` expression with `$entries=@(Get-DevenvSqlScripts $sqlDir)`. The returned `@{id;about}` entries are the same shape, so the rest of `Invoke-SqlScript` is unchanged.

- [ ] **Step 4: Implement `emulator-common.ps1` and `emulator-avds.ps1`**

`emulator-common.ps1`:

```powershell
#requires -Version 7.0
# The emulator images (AVDs) on this PC as data (devenv emulator avds --json for NexusMD).

function Get-DevenvEmulatorExe {
 $sdk=$env:ANDROID_HOME; if (!$sdk) { $sdk=$env:ANDROID_SDK_ROOT }
 if (!$sdk) { return $null }
 $exe=Join-Path $sdk 'emulator/emulator.exe'
 if (Test-Path -LiteralPath $exe) { $exe } else { $null }
}

function ConvertTo-DevenvAvds([string[]]$Names=@(),[string]$Default,[string]$Problem) {
 [ordered]@{
  kind='emulator-avds'; avds=@($Names | Where-Object { $_ })
  default=$(if ($Default) { $Default } else { $null })
  error=$(if ($Problem) { $Problem } else { $null })
 }
}
```

`emulator-avds.ps1`:

```powershell
#requires -Version 7.0
# devenv emulator avds: the AVDs emulator -list-avds knows (--json for NexusMD).
param([switch]$Json)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/launcher-common.ps1"
. "$PSScriptRoot/emulator-common.ps1"
$default='Pixel_9'   # emulator.ps1's -Avd default; keep the two in step
$exe=Get-DevenvEmulatorExe
$names=@(); $problem=$null
if (!$exe) { $problem='Android emulator not found - set ANDROID_HOME (or ANDROID_SDK_ROOT) to the Android SDK.' }
else {
 # -list-avds can print INFO lines too; AVD names never contain spaces (emulator.ps1 validates the same pattern).
 $names=@(& $exe -list-avds 2>$null | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[A-Za-z0-9_.-]+$' })
}
$result=ConvertTo-DevenvAvds -Names $names -Default $default -Problem $problem
if ($Json) { Write-DevenvEvent result $result -Force; return }
if ($problem) { throw $problem }
foreach ($n in $result.avds) { Write-Host ("   {0}{1}" -f $n,$(if ($n -eq $default) { '  (default)' } else { '' })) }
```

In `devenv.ps1`:
- After `db verify`, add:

```powershell
 @{G='db';V='baselines';A='';S='List the saved baselines (newest first)';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{What='Baselines'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'db-list.ps1' $n }}
 @{G='db';V='scripts';A='';S='List the profile''s SQL scripts (profile/sql) for db sql';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{What='Scripts'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'db-list.ps1' $n }}
```

- After `emulator status`, add:

```powershell
 @{G='emulator';V='avds';A='';S='List the emulator images (AVDs) on this PC';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'emulator-avds.ps1' $n }}
```

In `README.md`, extend the data-commands paragraph under "Running under NexusMD" to list the new commands as well: `devenv test runs --json`, `devenv test collection --json`, `devenv db baselines --json`, `devenv db scripts --json`, `devenv emulator avds --json`.

- [ ] **Step 5: Run the tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: PASS (all, including the existing `session-prompts` and `no-console` guards).

Also check by hand that `devenv db sql`, with no name and without `DEVENV_HOST`, still prints the same list as before (`pwsh -NoProfile -File ./devenv.ps1 db sql` with `DEVENV_PROFILE` pointing at `profile.example`).

- [ ] **Step 6: Commit**

```bash
git add db-common.ps1 db-list.ps1 emulator-common.ps1 emulator-avds.ps1 devenv.ps1 README.md tests/db-emulator-data.Tests.ps1 tests/catalog.Tests.ps1
git commit -m "feat: devenv db baselines, db scripts and emulator avds for NexusMD"
```

---

### Task 3: NexusMD Electron — query allowlist, in-app report window, file paths for drag-and-drop

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv4`

**Files:**
- Create: `apps/desktop/electron/ipc/report-window.cjs`, `apps/desktop/electron/ipc/report-window.test.js`
- Modify: `apps/desktop/electron/ipc/devenv.cjs` (`QUERIES`, `isQuery`, `openReport` dependency, `.html` in `devenv:open`)
- Modify: `apps/desktop/electron/ipc/devenv.test.js`
- Modify: `apps/desktop/electron/preload.cjs`, `apps/desktop/electron/preload.test.js` (`devenv.pathForFile`)
- Modify: `apps/desktop/src/adapters/devenv.js` (`pathForFile`), `packages/core/src/adapters/index.js` (`IDevenvAdapter.pathForFile`)

**Interfaces:**
- Consumes: the Task 1 and 2 argv.
- Produces:
  - `devenv:query` accepts the Global Constraints allowlist.
  - `devenv:open({ path })` opens `.html`/`.htm` in a report window.
  - `createReportWindows({ BrowserWindow, shell })` returns `openReport(filePath)`.
  - The renderer adapter gains `devenvAdapter.pathForFile(file: File) → string`, which is `''` when unavailable.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/electron/ipc/report-window.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'
import { createReportWindows } from './report-window.cjs'

function fakes() {
  const wins = []
  class FakeWindow {
    constructor(opts) {
      this.opts = opts
      this.handlers = {}
      this.destroyed = false
      this.webContents = {
        setWindowOpenHandler: fn => { this.openHandler = fn },
        on: (ev, fn) => { this.handlers[ev] = fn },
      }
      this.loadFile = vi.fn()
      this.reload = vi.fn()
      this.focus = vi.fn()
      this.on = (ev, fn) => { this.handlers[`win:${ev}`] = fn }
      wins.push(this)
    }
    isDestroyed() { return this.destroyed }
  }
  const shell = { openExternal: vi.fn() }
  return { wins, shell, openReport: createReportWindows({ BrowserWindow: FakeWindow, shell }) }
}

const FILE = path.resolve('C:\\repos\\dev-environment\\.local\\test\\traces\\runs\\r1\\trace.html')

describe('report windows', () => {
  it('opens a sandboxed window with no preload and loads the file', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    const prefs = wins[0].opts.webPreferences
    expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    expect(wins[0].loadFile).toHaveBeenCalledWith(FILE)
    expect(wins[0].opts.title).toBe('trace.html')
  })

  it('focuses and reloads the window when the same report opens again', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    openReport(FILE.toUpperCase())
    expect(wins).toHaveLength(1)
    expect(wins[0].reload).toHaveBeenCalled()
    expect(wins[0].focus).toHaveBeenCalled()
  })

  it('opens a new window once the old one was closed', () => {
    const { wins, openReport } = fakes()
    openReport(FILE)
    wins[0].handlers['win:closed']()
    openReport(FILE)
    expect(wins).toHaveLength(2)
  })

  it('sends new-window links to the browser and denies everything', () => {
    const { wins, shell, openReport } = fakes()
    openReport(FILE)
    expect(wins[0].openHandler({ url: 'https://example.com/x' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/x')
    expect(wins[0].openHandler({ url: 'file:///C:/Windows/x.html' })).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
  })

  it('never navigates away from the report; anchors in it are fine', () => {
    const { wins, shell, openReport } = fakes()
    openReport(FILE)
    const nav = wins[0].handlers['will-navigate']
    const own = pathToFileURL(FILE).href
    const anchor = { preventDefault: vi.fn() }
    nav(anchor, `${own}#call-3`)
    expect(anchor.preventDefault).not.toHaveBeenCalled()
    const away = { preventDefault: vi.fn() }
    nav(away, 'https://example.com/')
    expect(away.preventDefault).toHaveBeenCalled()
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/')
    const file = { preventDefault: vi.fn() }
    nav(file, 'file:///C:/Windows/win.ini')
    expect(file.preventDefault).toHaveBeenCalled()
  })
})
```

In `devenv.test.js`:
- Add `openReport: vi.fn()` to the deps object in `setup()`.
- Rename `query refuses anything outside the allowlist` if needed. Add to its rejected cases:
  - `['test', 'collection', '--json', '--collection', 'relative\\dir']`
  - `['test', 'collection', '--json', '--collection', '-x']`
  - `['test', 'collection', '--json', '--collection']`
  - `['db', 'sql', '--json']`
- Add:

```js
  it('query allows the phase 4 data commands and a collection folder', async () => {
    const ok = [
      ['test', 'runs', '--json'], ['test', 'collection', '--json'],
      ['test', 'collection', '--json', '--collection', 'C:\\My Tests\\collection'],
      ['db', 'baselines', '--json'], ['db', 'scripts', '--json'], ['emulator', 'avds', '--json'],
    ]
    for (const argv of ok) {
      const p = t.handlers['devenv:query'](null, CONFIG, argv)
      await tick()
      t.children.at(-1).finish(0)
      await expect(p).resolves.toHaveProperty('code', 0)
    }
    expect(t.deps.spawn).toHaveBeenCalledTimes(ok.length)
  })

  it('opens html reports in a report window and other files with the default app', async () => {
    await t.handlers['devenv:open'](null, { path: 'C:\\r\\trace.html' })
    expect(t.deps.openReport).toHaveBeenCalledWith('C:\\r\\trace.html')
    expect(t.deps.shell.openPath).not.toHaveBeenCalled()
    await t.handlers['devenv:open'](null, { path: 'C:\\r\\out.log' })
    expect(t.deps.shell.openPath).toHaveBeenCalledWith('C:\\r\\out.log')
  })
```

Existing `devenv:open` tests that open an `.html` path with `shell.openPath` must change to expect `openReport` instead. Keep their other assertions.

In `preload.test.js`:
- Add `webUtils: { getPathForFile: vi.fn(() => 'C:\\Users\\me\\photo.jpg') }` to `fakeElectron`.
- Add:

```js
  it('exposes devenv.pathForFile through webUtils', () => {
    expect(exposed.devenv.pathForFile({ name: 'photo.jpg' })).toBe('C:\\Users\\me\\photo.jpg')
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/report-window.test.js electron/ipc/devenv.test.js electron/preload.test.js`
Expected: FAIL. `report-window.cjs` is missing, the new queries are rejected, and `pathForFile` is undefined.

- [ ] **Step 3: Implement**

`apps/desktop/electron/ipc/report-window.cjs`:

```js
// electron/ipc/report-window.cjs
//
// devenv's HTML reports (call-chain trace, Bruno) open in a NexusMD window instead of the
// default browser. They are local files that run their own scripts, so the window is sandboxed
// with no preload, and every link that would leave the report goes to the system browser.

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const isHttp = url => /^https?:\/\//i.test(url);

function createReportWindows({ BrowserWindow, shell }) {
  // One window per report: opening it again (a re-run writes the same file) refreshes it.
  const open = new Map();
  return function openReport(filePath) {
    const file = path.resolve(filePath);
    const key = file.toLowerCase();
    const existing = open.get(key);
    if (existing && !existing.isDestroyed()) { existing.reload(); existing.focus(); return existing; }
    const win = new BrowserWindow({
      width: 1280, height: 900, title: path.basename(file), autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const own = pathToFileURL(file).href;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.split('#')[0] === own) return;
      e.preventDefault();
      if (isHttp(url)) shell.openExternal(url);
    });
    win.on('closed', () => open.delete(key));
    open.set(key, win);
    win.loadFile(file);
    return win;
  };
}

module.exports = { createReportWindows };
```

`devenv.cjs`:
- Replace `QUERIES` and `isQuery` with:

```js
const QUERIES = [
  ['status', '--json'], ['build', 'status', '--json'], ['logs', 'targets', '--json'],
  ['test', 'runs', '--json'], ['test', 'collection', '--json'],
  ['db', 'baselines', '--json'], ['db', 'scripts', '--json'], ['emulator', 'avds', '--json'],
];
// Queries that end with one folder: an absolute path, never something devenv would read as an option.
const FOLDER_QUERIES = [['test', 'collection', '--json', '--collection']];

function isQuery(argv) {
  if (!Array.isArray(argv) || argv.some(a => typeof a !== 'string')) return false;
  const starts = q => q.every((a, i) => a === argv[i]);
  if (QUERIES.some(q => q.length === argv.length && starts(q))) return true;
  return FOLDER_QUERIES.some(q => q.length + 1 === argv.length && starts(q)
    && path.isAbsolute(argv[q.length]) && !argv[q.length].startsWith('-'));
}
```

- Add `openReport` to the destructured deps of `register`, without a default.
- Inside `register`, create the real one only when first needed, so tests and non-Electron loads never require `electron` for it:

```js
  let reportWindows = openReport;
  const showReport = file => {
    if (!reportWindows) {
      const { createReportWindows } = require('./report-window.cjs');
      reportWindows = createReportWindows({ BrowserWindow: require('electron').BrowserWindow, shell });
    }
    reportWindows(file);
  };
```

- In `devenv:open`'s path branch, after the existence and extension checks, add before `shell.openPath`:

```js
      if (ext === '.html' || ext === '.htm') { showReport(target.path); return { ok: true }; }
```

`preload.cjs`:
- Change the require to `const { contextBridge, ipcRenderer, webUtils } = require('electron');`.
- Add to the `devenv` object:

```js
    // Dropped File objects have no path in the renderer since Electron 32; webUtils resolves it here.
    pathForFile: (file) => webUtils.getPathForFile(file),
```

In `src/adapters/devenv.js`, add `pathForFile(file) { return api()?.pathForFile?.(file) || '' },`.

In `IDevenvAdapter` (`packages/core/src/adapters/index.js`), add:

```js
  // The file-system path of a File dropped on the window ('' when unknown).
  pathForFile: (file) => '',
```

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron` and `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/report-window.cjs apps/desktop/electron/ipc/report-window.test.js apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/ipc/devenv.test.js apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/devenv.js packages/core/src/adapters/index.js
git commit -m "feat(desktop): devenv phase 4 queries, in-app report window, dropped file paths"
```

---

### Task 4: Core — tests, database and emulator models and argv

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv4`

**Files:**
- Create: `packages/core/src/modules/devenv/tests.js`, `tests.test.js`
- Create: `packages/core/src/modules/devenv/database.js`, `database.test.js`
- Create: `packages/core/src/modules/devenv/emulator.js`, `emulator.test.js`
- Modify: `packages/core/src/modules/devenv/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js` (exports)

**Interfaces:**
- Produces, for Tasks 5–7, every name exported from `@nexusmd/core`:

  **Tests (`tests.js`):**
  - `normaliseTestRuns(result)` → `{ runs: Run[], reports: [{ name, at, path }] }`.
    - A `Run` is `{ id, label, at, env, collection, paths, services, exit, passed: true|false|null, requests: { total, passed, failed }|null, traceHtml, brunoHtml }`.
    - It throws `'Not a devenv test-runs result'`.
  - `normaliseTestCollection(result)` → `{ root, isDefault, error, items: [{ path, name, kind: 'folder'|'request', depth }] }`. It throws `'Not a devenv test-collection result'`.
  - `buildTestUpArgv({ apis = [], noBuild = false })`.
  - `buildTestRunArgv({ paths = [], collection = '', env = '', tags = '', allApis = false, name = '' })`.
  - `topLevelPaths(paths)`: drops any path inside another selected folder.

  **Database (`database.js`):**
  - `normaliseBaselines(result)` → `{ latest, baselines: [{ id, createdUtc, size, isLatest, databases, sourceContainer, valid }] }`.
  - `normaliseSqlScripts(result)` → `{ database, scripts: [{ id, about }] }`.
  - `buildDbArgv(action)`.
  - `DEVENV_DB_EDITOR_URL = 'http://127.0.0.1:14331'`.

  **Emulator (`emulator.js`):**
  - `normaliseAvds(result)` → `{ avds: string[], default: string|null, error: string|null }`.
  - `buildEmulatorArgv(action)`.

  Every builder throws an `Error` with a readable message on invalid input.

`buildDbArgv` actions:

| Action | argv |
|---|---|
| `{ kind: 'start' }` | `['db', 'start']` |
| `{ kind: 'stop' }` | `['db', 'stop']` |
| `{ kind: 'backup' }` | `['db', 'backup']` |
| `{ kind: 'verify' }` | `['db', 'verify']` |
| `{ kind: 'ui' }` | `['db', 'ui']` |
| `{ kind: 'ui-off' }` | `['db', 'ui', '--off']` |
| `{ kind: 'restore', baseline? }` | `['db', 'restore']`, plus `'--baseline', id` when a baseline is given; the id must match `^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$` |
| `{ kind: 'sql', script, database? }` | `['db', 'sql', script]`, plus `'--database', database` when given; `script` must match `^[A-Za-z0-9_.-]+$`, not start with `-`; `database` must match `^[A-Za-z0-9_]+$` |

`buildEmulatorArgv` actions:

| Action | argv |
|---|---|
| `{ kind: 'start', avd?, proxy = true }` | `['emulator', 'start']`, plus `'--avd', avd` when given, plus `'--no-proxy'` when `!proxy`; the avd must match `^[A-Za-z0-9_.-]+$` |
| `{ kind: 'stop' }` | `['emulator', 'stop']` |
| `{ kind: 'proxy', on }` | `['emulator', 'proxy']`, plus `'--off'` when `!on` |
| `{ kind: 'push-ca' }` | `['emulator', 'push-ca']` |
| `{ kind: 'push', paths, dest? }` | `['emulator', 'push', ...paths]`, plus `'--to', dest` when given; at least one path, none empty or starting with `-`; a trimmed `dest` must start with `/sdcard/` or `/storage/` |
| `{ kind: 'create', avd }` | `['emulator', 'create', '--avd', avd]`; `avd` is required |

- [ ] **Step 1: Write the failing tests**

`tests.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths } from './tests.js'

describe('normaliseTestRuns', () => {
  it('keeps runs and reports with safe types', () => {
    const r = normaliseTestRuns({ kind: 'test-runs', runs: [
      { id: '20261013-120000-api-tests', label: 'api-tests', at: '2026-10-13T12:00:00+01:00', env: 'docker', collection: 'C:\\c', paths: ['smoke'], services: ['orders'], exit: 1, passed: false, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: null },
      { id: 'x', label: 'x', passed: null, requests: 'junk', paths: 'smoke' },
      null,
    ], reports: [{ name: 'trace-1.html', at: null, path: 'C:\\r\\trace-1.html' }, { name: 'no-path' }] })
    expect(r.runs).toHaveLength(2)
    expect(r.runs[0]).toMatchObject({ passed: false, exit: 1, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: null, paths: ['smoke'] })
    expect(r.runs[1]).toMatchObject({ passed: null, requests: null, paths: [], exit: null })
    expect(r.reports).toEqual([{ name: 'trace-1.html', at: null, path: 'C:\\r\\trace-1.html' }])
  })
  it('rejects other results', () => { expect(() => normaliseTestRuns({ kind: 'builds' })).toThrow('Not a devenv test-runs result') })
})

describe('normaliseTestCollection', () => {
  it('adds the display name and drops unknown kinds', () => {
    const c = normaliseTestCollection({ kind: 'test-collection', root: 'C:\\c', isDefault: true, error: null, items: [
      { path: 'smoke', kind: 'folder', depth: 0 }, { path: 'smoke/orders.bru', kind: 'request', depth: 1 }, { path: 'x', kind: 'weird', depth: 0 },
    ] })
    expect(c).toEqual({ root: 'C:\\c', isDefault: true, error: null, items: [
      { path: 'smoke', name: 'smoke', kind: 'folder', depth: 0 },
      { path: 'smoke/orders.bru', name: 'orders.bru', kind: 'request', depth: 1 },
    ] })
  })
  it('carries the error', () => {
    expect(normaliseTestCollection({ kind: 'test-collection', root: 'C:\\x', error: 'Not a Bruno collection', items: [] }).error).toBe('Not a Bruno collection')
  })
})

describe('buildTestUpArgv', () => {
  it('builds up with APIs and --no-build', () => {
    expect(buildTestUpArgv({})).toEqual(['test', 'up'])
    expect(buildTestUpArgv({ apis: ['orders', 'billing'], noBuild: true })).toEqual(['test', 'up', 'orders', 'billing', '--no-build'])
  })
  it('refuses option-like API keys', () => { expect(() => buildTestUpArgv({ apis: ['--x'] })).toThrow() })
})

describe('buildTestRunArgv and topLevelPaths', () => {
  it('builds run with every option', () => {
    expect(buildTestRunArgv({})).toEqual(['test', 'run'])
    expect(buildTestRunArgv({ paths: ['smoke', 'top.bru'], collection: 'C:\\c', env: ' docker ', tags: 'smoke', allApis: true, name: 'nightly' }))
      .toEqual(['test', 'run', 'smoke', 'top.bru', '--collection', 'C:\\c', '--env', 'docker', '--tags', 'smoke', '--all-apis', '--name', 'nightly'])
  })
  it('refuses absolute or parent paths and option-like values', () => {
    expect(() => buildTestRunArgv({ paths: ['../x'] })).toThrow()
    expect(() => buildTestRunArgv({ paths: ['C:\\x'] })).toThrow()
    expect(() => buildTestRunArgv({ paths: ['/x'] })).toThrow()
    expect(() => buildTestRunArgv({ env: '-x' })).toThrow()
    expect(() => buildTestRunArgv({ name: '--all-apis' })).toThrow()
    expect(() => buildTestRunArgv({ collection: 'relative' })).toThrow()
  })
  it('keeps only paths not inside another selected folder', () => {
    expect(topLevelPaths(['smoke', 'smoke/orders.bru', 'smokey.bru', 'a/b', 'a'])).toEqual(['smoke', 'smokey.bru', 'a'])
  })
})
```

`database.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DB_EDITOR_URL } from './database.js'

const ID = '20261013T120000Z-aaaaaaaa'

describe('normaliseBaselines', () => {
  it('keeps baselines with safe types', () => {
    const b = normaliseBaselines({ kind: 'db-baselines', latest: ID, baselines: [
      { id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 2048, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true },
      { id: 'bad id', size: 'x' }, null,
    ] })
    expect(b.latest).toBe(ID)
    expect(b.baselines).toEqual([{ id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 2048, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true }])
  })
  it('rejects other results', () => { expect(() => normaliseBaselines({ kind: 'x' })).toThrow('Not a devenv db-baselines result') })
})

describe('normaliseSqlScripts', () => {
  it('keeps scripts and the default database', () => {
    expect(normaliseSqlScripts({ kind: 'db-scripts', database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script' }, { about: 'no id' }] }))
      .toEqual({ database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script' }] })
    expect(normaliseSqlScripts({ kind: 'db-scripts', database: null, scripts: null })).toEqual({ database: null, scripts: [] })
  })
})

describe('buildDbArgv', () => {
  it('builds every action', () => {
    expect(buildDbArgv({ kind: 'start' })).toEqual(['db', 'start'])
    expect(buildDbArgv({ kind: 'stop' })).toEqual(['db', 'stop'])
    expect(buildDbArgv({ kind: 'backup' })).toEqual(['db', 'backup'])
    expect(buildDbArgv({ kind: 'verify' })).toEqual(['db', 'verify'])
    expect(buildDbArgv({ kind: 'ui' })).toEqual(['db', 'ui'])
    expect(buildDbArgv({ kind: 'ui-off' })).toEqual(['db', 'ui', '--off'])
    expect(buildDbArgv({ kind: 'restore' })).toEqual(['db', 'restore'])
    expect(buildDbArgv({ kind: 'restore', baseline: ID })).toEqual(['db', 'restore', '--baseline', ID])
    expect(buildDbArgv({ kind: 'sql', script: 'example', database: 'Orders_Local' })).toEqual(['db', 'sql', 'example', '--database', 'Orders_Local'])
    expect(buildDbArgv({ kind: 'sql', script: 'example' })).toEqual(['db', 'sql', 'example'])
  })
  it('refuses bad baselines, scripts and databases', () => {
    expect(() => buildDbArgv({ kind: 'restore', baseline: 'latest' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: '-x' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: 'a b' })).toThrow()
    expect(() => buildDbArgv({ kind: 'sql', script: 'ok', database: 'x;drop' })).toThrow()
    expect(() => buildDbArgv({ kind: 'drop' })).toThrow()
  })
  it('knows the DB editor address', () => { expect(DB_EDITOR_URL).toBe('http://127.0.0.1:14331') })
})
```

`emulator.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseAvds, buildEmulatorArgv } from './emulator.js'

describe('normaliseAvds', () => {
  it('keeps valid names, the default and the error', () => {
    expect(normaliseAvds({ kind: 'emulator-avds', avds: ['Pixel_9', 'bad name', 3], default: 'Pixel_9', error: null }))
      .toEqual({ avds: ['Pixel_9'], default: 'Pixel_9', error: null })
    expect(normaliseAvds({ kind: 'emulator-avds', avds: [], default: null, error: 'no SDK' }).error).toBe('no SDK')
  })
  it('rejects other results', () => { expect(() => normaliseAvds({ kind: 'x' })).toThrow('Not a devenv emulator-avds result') })
})

describe('buildEmulatorArgv', () => {
  it('builds every action', () => {
    expect(buildEmulatorArgv({ kind: 'start' })).toEqual(['emulator', 'start'])
    expect(buildEmulatorArgv({ kind: 'start', avd: 'Pixel_9', proxy: false })).toEqual(['emulator', 'start', '--avd', 'Pixel_9', '--no-proxy'])
    expect(buildEmulatorArgv({ kind: 'stop' })).toEqual(['emulator', 'stop'])
    expect(buildEmulatorArgv({ kind: 'proxy', on: true })).toEqual(['emulator', 'proxy'])
    expect(buildEmulatorArgv({ kind: 'proxy', on: false })).toEqual(['emulator', 'proxy', '--off'])
    expect(buildEmulatorArgv({ kind: 'push-ca' })).toEqual(['emulator', 'push-ca'])
    expect(buildEmulatorArgv({ kind: 'push', paths: ['C:\\Users\\me\\a.jpg', 'C:\\b.txt'] })).toEqual(['emulator', 'push', 'C:\\Users\\me\\a.jpg', 'C:\\b.txt'])
    expect(buildEmulatorArgv({ kind: 'push', paths: ['C:\\a.jpg'], dest: ' /sdcard/DCIM ' })).toEqual(['emulator', 'push', 'C:\\a.jpg', '--to', '/sdcard/DCIM'])
    expect(buildEmulatorArgv({ kind: 'create', avd: 'Pixel_9' })).toEqual(['emulator', 'create', '--avd', 'Pixel_9'])
  })
  it('refuses empty pushes, bad destinations, bad AVDs and recreate without a name', () => {
    expect(() => buildEmulatorArgv({ kind: 'push', paths: [] })).toThrow(/at least one file/)
    expect(() => buildEmulatorArgv({ kind: 'push', paths: ['-x'] })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'push', paths: ['C:\\a'], dest: '/data/x' })).toThrow(/sdcard/)
    expect(() => buildEmulatorArgv({ kind: 'start', avd: 'a b' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'create' })).toThrow()
    expect(() => buildEmulatorArgv({ kind: 'nope' })).toThrow()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv/tests.test.js src/modules/devenv/database.test.js src/modules/devenv/emulator.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`tests.js`:

```js
// packages/core/src/modules/devenv/tests.js
//
// The Tests tab's model: devenv's run history and Bruno collection, and the argv for test up /
// test run. Paths in a collection are relative and /-separated, as bru run expects them.

const str = v => (typeof v === 'string' && v ? v : null)
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [])
const count = v => (Number.isFinite(v) ? v : 0)
const KEY = /^[a-z0-9][a-z0-9_-]*$/i

function requests(r) {
  return r && typeof r === 'object' && Number.isFinite(r.total) ? { total: r.total, passed: count(r.passed), failed: count(r.failed) } : null
}

export function normaliseTestRuns(result) {
  if (!result || result.kind !== 'test-runs') throw new Error('Not a devenv test-runs result')
  const runs = (Array.isArray(result.runs) ? result.runs : []).filter(r => r && typeof r === 'object' && str(r.id)).map(r => ({
    id: r.id, label: str(r.label) ?? r.id, at: str(r.at), env: str(r.env), collection: str(r.collection),
    paths: strings(r.paths), services: strings(r.services),
    exit: Number.isInteger(r.exit) ? r.exit : null,
    passed: typeof r.passed === 'boolean' ? r.passed : null,
    requests: requests(r.requests),
    traceHtml: str(r.traceHtml), brunoHtml: str(r.brunoHtml),
  }))
  const reports = (Array.isArray(result.reports) ? result.reports : []).filter(p => p && str(p.path))
    .map(p => ({ name: str(p.name) ?? p.path, at: str(p.at), path: p.path }))
  return { runs, reports }
}

export function normaliseTestCollection(result) {
  if (!result || result.kind !== 'test-collection') throw new Error('Not a devenv test-collection result')
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter(i => i && str(i.path) && (i.kind === 'folder' || i.kind === 'request'))
    .map(i => ({ path: i.path, name: i.path.split('/').pop(), kind: i.kind, depth: Number.isInteger(i.depth) ? i.depth : 0 }))
  return { root: str(result.root), isDefault: result.isDefault === true, error: str(result.error), items }
}

export function buildTestUpArgv({ apis = [], noBuild = false } = {}) {
  for (const a of apis) if (typeof a !== 'string' || !KEY.test(a)) throw new Error(`Not an API key: ${a}`)
  return ['test', 'up', ...apis, ...(noBuild ? ['--no-build'] : [])]
}

// devenv reads anything starting with '-' as an option.
function value(name, v) {
  const t = typeof v === 'string' ? v.trim() : ''
  if (t.startsWith('-')) throw new Error(`${name} can't start with '-': ${t}`)
  return t
}

function relativePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('-') || p.startsWith('/') || p.startsWith('\\') || /^[a-z]:/i.test(p) || p.split(/[\\/]/).includes('..')) {
    throw new Error(`Not a path inside the collection: ${p}`)
  }
  return p
}

export function buildTestRunArgv({ paths = [], collection = '', env = '', tags = '', allApis = false, name = '' } = {}) {
  const col = typeof collection === 'string' ? collection.trim() : ''
  if (col && !/^([a-z]:[\\/]|\\\\)/i.test(col)) throw new Error(`The collection must be a full folder path: ${col}`)
  const e = value('Environment', env), t = value('Tags', tags), n = value('Name', name)
  return [
    'test', 'run', ...paths.map(relativePath),
    ...(col ? ['--collection', col] : []), ...(e ? ['--env', e] : []), ...(t ? ['--tags', t] : []),
    ...(allApis ? ['--all-apis'] : []), ...(n ? ['--name', n] : []),
  ]
}

// A folder runs everything under it, so a request inside a selected folder would run twice.
export function topLevelPaths(paths) {
  return paths.filter(p => !paths.some(q => q !== p && p.startsWith(`${q}/`)))
}
```

`database.js`:

```js
// packages/core/src/modules/devenv/database.js
//
// The Database tab's model: devenv's baselines and SQL scripts, and the argv for each db action.

export const DB_EDITOR_URL = 'http://127.0.0.1:14331'
const BASELINE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/
const SCRIPT = /^[A-Za-z0-9_.-]+$/
const DATABASE = /^[A-Za-z0-9_]+$/
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseBaselines(result) {
  if (!result || result.kind !== 'db-baselines') throw new Error('Not a devenv db-baselines result')
  const baselines = (Array.isArray(result.baselines) ? result.baselines : [])
    .filter(b => b && typeof b.id === 'string' && BASELINE.test(b.id))
    .map(b => ({
      id: b.id, createdUtc: str(b.createdUtc), size: Number.isFinite(b.size) ? b.size : 0, isLatest: b.isLatest === true,
      databases: Array.isArray(b.databases) ? b.databases.filter(d => typeof d === 'string') : [],
      sourceContainer: str(b.sourceContainer), valid: b.valid === true,
    }))
  return { latest: str(result.latest), baselines }
}

export function normaliseSqlScripts(result) {
  if (!result || result.kind !== 'db-scripts') throw new Error('Not a devenv db-scripts result')
  const scripts = (Array.isArray(result.scripts) ? result.scripts : [])
    .filter(s => s && typeof s.id === 'string' && SCRIPT.test(s.id))
    .map(s => ({ id: s.id, about: typeof s.about === 'string' ? s.about : '' }))
  return { database: str(result.database), scripts }
}

const FIXED = { start: ['db', 'start'], stop: ['db', 'stop'], backup: ['db', 'backup'], verify: ['db', 'verify'], ui: ['db', 'ui'], 'ui-off': ['db', 'ui', '--off'] }

export function buildDbArgv(action) {
  const a = action || {}
  if (FIXED[a.kind]) return [...FIXED[a.kind]]
  if (a.kind === 'restore') {
    if (a.baseline == null || a.baseline === '') return ['db', 'restore']
    if (!BASELINE.test(a.baseline)) throw new Error(`Not a baseline id: ${a.baseline}`)
    return ['db', 'restore', '--baseline', a.baseline]
  }
  if (a.kind === 'sql') {
    if (typeof a.script !== 'string' || !SCRIPT.test(a.script) || a.script.startsWith('-')) throw new Error(`Not a script name: ${a.script}`)
    const db = typeof a.database === 'string' ? a.database.trim() : ''
    if (db && !DATABASE.test(db)) throw new Error(`Not a database name: ${db}`)
    return ['db', 'sql', a.script, ...(db ? ['--database', db] : [])]
  }
  throw new Error(`Unknown db action: ${a.kind}`)
}
```

`emulator.js`:

```js
// packages/core/src/modules/devenv/emulator.js
//
// The Emulator tab's model: devenv's AVD list and the argv for each emulator action, with
// devenv's own rules (AVD names, push destinations under /sdcard or /storage).

const AVD = /^[A-Za-z0-9_.-]+$/
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseAvds(result) {
  if (!result || result.kind !== 'emulator-avds') throw new Error('Not a devenv emulator-avds result')
  const avds = (Array.isArray(result.avds) ? result.avds : []).filter(n => typeof n === 'string' && AVD.test(n))
  return { avds, default: str(result.default), error: str(result.error) }
}

function avdName(avd) {
  if (typeof avd !== 'string' || !AVD.test(avd)) throw new Error(`Not an AVD name: ${avd}`)
  return avd
}

export function buildEmulatorArgv(action) {
  const a = action || {}
  switch (a.kind) {
    case 'start': return ['emulator', 'start', ...(a.avd ? ['--avd', avdName(a.avd)] : []), ...(a.proxy === false ? ['--no-proxy'] : [])]
    case 'stop': return ['emulator', 'stop']
    case 'proxy': return ['emulator', 'proxy', ...(a.on ? [] : ['--off'])]
    case 'push-ca': return ['emulator', 'push-ca']
    case 'push': {
      const paths = Array.isArray(a.paths) ? a.paths : []
      if (!paths.length) throw new Error('Choose at least one file to push.')
      for (const p of paths) if (typeof p !== 'string' || !p || p.startsWith('-')) throw new Error(`Not a file path: ${p}`)
      const dest = typeof a.dest === 'string' ? a.dest.trim() : ''
      if (dest && !/^\/(sdcard|storage)\//.test(dest)) throw new Error('The destination must start with /sdcard/ or /storage/.')
      return ['emulator', 'push', ...paths, ...(dest ? ['--to', dest] : [])]
    }
    case 'create': return ['emulator', 'create', '--avd', avdName(a.avd)]
    default: throw new Error(`Unknown emulator action: ${a.kind}`)
  }
}
```

Add to `modules/devenv/index.js`:

```js
export { normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths } from './tests.js'
export { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DB_EDITOR_URL as DEVENV_DB_EDITOR_URL } from './database.js'
export { normaliseAvds, buildEmulatorArgv } from './emulator.js'
```

Then add the same names to the devenv export list in `packages/core/src/index.js`, and to `packages/core/tests/public-api.test.js` where the devenv names are listed: `normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths, normaliseBaselines, normaliseSqlScripts, buildDbArgv, DEVENV_DB_EDITOR_URL, normaliseAvds, buildEmulatorArgv`.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/public-api.test.js
git commit -m "feat(core): devenv tests, database and emulator models and argv"
```

---

### Task 5: Tests tab

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv4`

**Files:**
- Create: `apps/desktop/src/views/devenv/tests-view.jsx`, `tests-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx`:
  - `TABS = ['Status', 'Start', 'Builds', 'Logs', 'Tests', 'Database', 'Emulator', 'Commands']`;
  - render `TestsView`;
  - `Database` and `Emulator` render `null` until Tasks 6–7.

**Interfaces:**
- Consumes:
  - `useDevenvRunContext()` → `{ state, start, cancel, config }`;
  - `useDevenvStatus({ adapter, config, runStatus })` → `{ status }`, where `status.test` is `{ tracer, apis: [{ key, label, port, state }] }`;
  - `useDevenvQuery`;
  - core `normaliseTestRuns`, `normaliseTestCollection`, `buildTestUpArgv`, `buildTestRunArgv`, `topLevelPaths`, `DEVENV_CAPTURE_SINCE`;
  - `RunPanel`;
  - `picker.pickDirectory()` → `string|null`.
- Produces: `TestsView({ adapter, picker })`.

Layout:
- **Stack card:**
  - Tracer state.
  - One checkbox per test API, labelled `${label} :${port}`, with a state dot. APIs that are running are pre-ticked on the first status.
  - "Skip builds" checkbox (`--no-build`).
  - Buttons: **Start stack** (`buildTestUpArgv`) with the muted hint "None ticked = the profile's default APIs"; **Stop stack** (`['test','down']`); **Clear trace** (`['test','clear']`); **Open live view** (`['test','web']`, `exclusive: false`).
- **Collection card:**
  - The root path, with "(profile)" when `isDefault`, plus **Choose collection…** and, when a custom collection is set, **Use the profile's**.
  - The error in red when `error` is set, with Run disabled.
  - The tree: one checkbox per item, indented `depth * 16px`. A folder shows a trailing `/`. An item inside a ticked folder is disabled.
  - Inputs Environment, Tags and Run name (`aria-label`s `Environment`, `Tags`, `Run name`), and the "Include requests for APIs that aren't running" checkbox.
  - **Run selected** when anything is ticked, otherwise **Run all**. Both use `buildTestRunArgv` with `paths: topLevelPaths(selected)`, plus `collection` when it is custom.
- **History card:**
  - One row per run: label, local time, a chip (`Passed` / `Failed` / `—`), `passed/total requests`, and **Call chain** / **Bruno report** buttons. Each button is shown only when its path exists and calls `adapter.open({ path })`.
  - **Report of the last** `<select aria-label="Report window">` over `DEVENV_CAPTURE_SINCE` (default `15m`), then **Make report** (`['test','report','--since',since]`, `exclusive: false`).
  - The ad-hoc reports list, each with **Open**.
- Action errors from the builders are shown in a `role="alert"` card, and so are query errors.
- `RunPanel` shows when the provider's command starts with `devenv test ` and its status is not `idle`.

- [ ] **Step 1: Write the failing test**

`tests-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { TestsView } from './tests-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = { type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], database: {}, android: {}, ios: {},
  test: { tracer: 'running', apis: [{ key: 'orders', label: 'Orders', port: 5201, state: 'running' }, { key: 'billing', label: 'Billing', port: 5202, state: 'stopped' }] } }
const RUNS = { type: 'result', kind: 'test-runs', runs: [
  { id: '20261013-120000-api-tests', label: 'api-tests', at: '2026-10-13T12:00:00+01:00', paths: [], services: ['orders'], exit: 1, passed: false, requests: { total: 2, passed: 1, failed: 1 }, traceHtml: 'C:\\r\\trace.html', brunoHtml: 'C:\\r\\bruno.html' },
], reports: [{ name: 'trace-20261013-090000.html', at: '2026-10-13T09:00:00', path: 'C:\\r\\trace-1.html' }] }
const COLLECTION = (root, extra = {}) => ({ type: 'result', kind: 'test-collection', root, isDefault: !extra.custom, error: extra.error ?? null,
  items: extra.error ? [] : [{ path: 'smoke', kind: 'folder', depth: 0 }, { path: 'smoke/orders.bru', kind: 'request', depth: 1 }, { path: 'top.bru', kind: 'request', depth: 0 }] })

function setup({ over = {}, collection } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    open: vi.fn(async () => ({ ok: true })),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS] }
      if (k === 'test runs --json') return { code: 0, stderr: '', results: [RUNS] }
      if (k.startsWith('test collection --json')) return { code: 0, stderr: '', results: [collection ? collection(argv) : COLLECTION('C:\\profile\\api-tests')] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  const picker = { pickDirectory: vi.fn(async () => 'C:\\other\\collection') }
  render(<TestsView adapter={adapter} picker={picker} />)
  return { run: globalThis.__run, adapter, picker }
}

describe('TestsView', () => {
  it('starts the stack with the running APIs pre-ticked, plus any ticked', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('Orders :5201').checked).toBe(true))
    expect(screen.getByLabelText('Billing :5202').checked).toBe(false)
    fireEvent.click(screen.getByLabelText('Billing :5202'))
    fireEvent.click(screen.getByLabelText('Skip builds'))
    fireEvent.click(screen.getByRole('button', { name: 'Start stack' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'up', 'orders', 'billing', '--no-build'], { exclusive: true, label: 'devenv test up orders billing --no-build' })
  })

  it('stops, clears and opens the live view', async () => {
    const { run } = setup()
    await screen.findByLabelText('Orders :5201')
    fireEvent.click(screen.getByRole('button', { name: 'Stop stack' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'down'], { exclusive: true, label: 'devenv test down' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear trace' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'clear'], { exclusive: true, label: 'devenv test clear' })
    fireEvent.click(screen.getByRole('button', { name: 'Open live view' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'web'], { exclusive: false, label: 'devenv test web' })
  })

  it('runs the whole collection, or the top-level ticked paths with options', async () => {
    const { run } = setup()
    await screen.findByLabelText('smoke/')
    fireEvent.click(screen.getByRole('button', { name: 'Run all' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run'], { exclusive: true, label: 'devenv test run' })
    fireEvent.click(screen.getByLabelText('smoke/'))
    expect(screen.getByLabelText('orders.bru').disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('top.bru'))
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'docker' } })
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'nightly' } })
    fireEvent.click(screen.getByLabelText("Include requests for APIs that aren't running"))
    fireEvent.click(screen.getByRole('button', { name: 'Run selected' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run', 'smoke', 'top.bru', '--env', 'docker', '--all-apis', '--name', 'nightly'],
      { exclusive: true, label: 'devenv test run smoke top.bru --env docker --all-apis --name nightly' })
  })

  it('switches to another collection and runs it with --collection', async () => {
    const { run, adapter } = setup({ collection: argv => COLLECTION(argv[4] || 'C:\\profile\\api-tests', { custom: !!argv[4] }) })
    await screen.findByLabelText('smoke/')
    fireEvent.click(screen.getByRole('button', { name: 'Choose collection…' }))
    await waitFor(() => expect(adapter.query).toHaveBeenCalledWith(CFG, ['test', 'collection', '--json', '--collection', 'C:\\other\\collection']))
    await screen.findByRole('button', { name: "Use the profile's" })
    fireEvent.click(screen.getByRole('button', { name: 'Run all' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'run', '--collection', 'C:\\other\\collection'], expect.objectContaining({ exclusive: true }))
  })

  it('shows a collection error and offers no run', async () => {
    setup({ collection: () => COLLECTION('C:\\x', { error: 'Not a Bruno collection (no bruno.json): C:\\x' }) })
    await screen.findByText('Not a Bruno collection (no bruno.json): C:\\x')
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
  })

  it('lists past runs and opens their reports in-app', async () => {
    const { adapter, run } = setup()
    await screen.findByText('api-tests')
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('1/2 requests')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Call chain' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\trace.html' })
    fireEvent.click(screen.getByRole('button', { name: 'Bruno report' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\bruno.html' })
    fireEvent.click(screen.getByRole('button', { name: 'Open trace-20261013-090000.html' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\r\\trace-1.html' })
    fireEvent.change(screen.getByLabelText('Report window'), { target: { value: '1h' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make report' }))
    expect(run.start).toHaveBeenLastCalledWith(['test', 'report', '--since', '1h'], { exclusive: false, label: 'devenv test report --since 1h' })
  })

  it('shows query errors (e.g. a profile without test APIs)', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    const adapter = { open: vi.fn(), query: vi.fn(async (_c, argv) => (argv[0] === 'status'
      ? { code: 0, stderr: '', results: [STATUS] }
      : { code: 1, stderr: 'The profile has no repositories with a "test" block', results: [] })) }
    render(<TestsView adapter={adapter} picker={{ pickDirectory: vi.fn() }} />)
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /no repositories with a "test" block/.test(a.textContent))).toBe(true))
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv test up', runId: 4 } })
    await screen.findByLabelText('Orders :5201')
    expect(screen.getByRole('button', { name: 'Start stack' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Run all' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/tests-view.test.jsx`
Expected: FAIL — `tests-view.jsx` not found.

- [ ] **Step 3: Implement `tests-view.jsx`**

```jsx
import React from 'react'
import {
  normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths, DEVENV_CAPTURE_SINCE,
} from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const RUNS_ARGV = ['test', 'runs', '--json']
const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }
const when = at => (at ? new Date(at).toLocaleString() : '')
const outcome = p => (p === true ? ['Passed', 'done'] : p === false ? ['Failed', 'failed'] : ['—', ''])

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

function Check({ label, checked, disabled, onChange, children }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {children ?? <span>{label}</span>}
    </label>
  )
}

export function TestsView({ adapter, picker }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const [collection, setCollection] = React.useState('')
  const collectionArgv = React.useMemo(
    () => ['test', 'collection', '--json', ...(collection ? ['--collection', collection] : [])], [collection])
  const runs = useDevenvQuery({ adapter, config: run.config, argv: RUNS_ARGV, kind: 'test-runs', normalise: normaliseTestRuns, runStatus: run.state.status })
  const tree = useDevenvQuery({ adapter, config: run.config, argv: collectionArgv, kind: 'test-collection', normalise: normaliseTestCollection, runStatus: run.state.status })

  const apis = status?.test.apis ?? []
  const [picked, setPicked] = React.useState(null)   // null until the first status pre-ticks the running APIs
  React.useEffect(() => {
    if (picked === null && status) setPicked(status.test.apis.filter(a => a.state === 'running').map(a => a.key))
  }, [status, picked])
  const [noBuild, setNoBuild] = React.useState(false)
  const [selected, setSelected] = React.useState([])
  const [env, setEnv] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [name, setName] = React.useState('')
  const [allApis, setAllApis] = React.useState(false)
  const [since, setSince] = React.useState('15m')
  const [actionError, setActionError] = React.useState(null)
  React.useEffect(() => { setSelected([]) }, [collection])

  const go = (build, exclusive = true) => {
    setActionError(null)
    let argv
    try { argv = typeof build === 'function' ? build() : build } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const toggle = (list, setList, key, on) => setList(on ? [...list, key] : list.filter(k => k !== key))
  const insideTicked = p => selected.some(s => s !== p && p.startsWith(`${s}/`))
  const chooseCollection = async () => { const dir = await picker.pickDirectory(); if (dir) setCollection(dir) }
  const openReport = path => adapter.open({ path }).catch(e => setActionError(e?.message || `Couldn't open ${path}`))
  const t = tree.data
  const canRun = !busy && t && !t.error
  const alerts = [actionError, statusError, runs.error, tree.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Test stack">
        <span>{`Tracer: ${status?.test.tracer ?? '…'}`}</span>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {apis.map(a => (
            <Check key={a.key} label={`${a.label} :${a.port}`} checked={(picked ?? []).includes(a.key)} onChange={on => toggle(picked ?? [], setPicked, a.key, on)}>
              <span aria-label={a.state} style={{ width: 8, height: 8, borderRadius: 4, background: DOT[a.state] || DOT.missing }} />
              <span>{`${a.label} :${a.port}`}</span>
            </Check>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Check label="Skip builds" checked={noBuild} onChange={setNoBuild} />
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildTestUpArgv({ apis: picked ?? [], noBuild }))}>Start stack</button>
          <button className="btn sm" disabled={busy} onClick={() => go(['test', 'down'])}>Stop stack</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'clear'])}>Clear trace</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'web'], false)}>Open live view</button>
          <span style={{ color: 'var(--text-muted)' }}>None ticked = the profile's default APIs</span>
        </div>
      </Card>

      <Card title="Collection">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{t ? `${t.root}${t.isDefault ? ' (profile)' : ''}` : '…'}</span>
          <button className="btn sm ghost" disabled={busy} onClick={chooseCollection}>Choose collection…</button>
          {collection && <button className="btn sm ghost" onClick={() => setCollection('')}>Use the profile's</button>}
        </div>
        {t?.error && <span style={{ color: 'var(--danger)' }}>{t.error}</span>}
        {t && !t.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {t.items.map(i => {
              const label = i.kind === 'folder' ? `${i.name}/` : i.name
              // Two requests with one file name (in different folders) need distinct accessible names.
              const aria = i.kind === 'folder' ? `${i.path}/` : (t.items.filter(x => x.name === i.name).length > 1 ? i.path : i.name)
              return (
                <div key={i.path} style={{ paddingLeft: i.depth * 16 }}>
                  <Check label={aria} checked={selected.includes(i.path) || insideTicked(i.path)}
                    disabled={insideTicked(i.path)} onChange={on => toggle(selected, setSelected, i.path, on)}>
                    <span>{label}</span>
                  </Check>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="Environment" placeholder="Environment" value={env} onChange={e => setEnv(e.target.value)} />
          <input aria-label="Tags" placeholder="Tags" value={tags} onChange={e => setTags(e.target.value)} />
          <input aria-label="Run name" placeholder="Run name" value={name} onChange={e => setName(e.target.value)} />
          <Check label="Include requests for APIs that aren't running" checked={allApis} onChange={setAllApis} />
          <button className="btn sm primary" disabled={!canRun}
            onClick={() => go(() => buildTestRunArgv({ paths: topLevelPaths(selected), collection, env, tags, allApis, name }))}>
            {selected.length ? 'Run selected' : 'Run all'}
          </button>
        </div>
      </Card>

      <Card title="History">
        {runs.data?.runs.map(r => {
          const [text, chip] = outcome(r.passed)
          return (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{r.label}</strong>
              <span style={{ color: 'var(--text-muted)' }}>{when(r.at)}</span>
              <span className={`chip ${chip}`}>{text}</span>
              {r.requests && <span>{`${r.requests.passed}/${r.requests.total} requests`}</span>}
              {r.traceHtml && <button className="btn sm ghost" onClick={() => openReport(r.traceHtml)}>Call chain</button>}
              {r.brunoHtml && <button className="btn sm ghost" onClick={() => openReport(r.brunoHtml)}>Bruno report</button>}
            </div>
          )
        })}
        {runs.data && !runs.data.runs.length && <span style={{ color: 'var(--text-muted)' }}>No runs yet.</span>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Report of the last</span>
          <select aria-label="Report window" value={since} onChange={e => setSince(e.target.value)}>
            {DEVENV_CAPTURE_SINCE.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(['test', 'report', '--since', since], false)}>Make report</button>
        </div>
        {runs.data?.reports.map(p => (
          <div key={p.path} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span>{p.name}</span>
            <button className="btn sm ghost" aria-label={`Open ${p.name}`} onClick={() => openReport(p.path)}>Open</button>
          </div>
        ))}
      </Card>

      {run.state.command?.startsWith('devenv test ') && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

`Check` puts the `aria-label` on the input. The API rows pass `label` for the `aria-label` and render their own children, so `getByLabelText('Orders :5201')` finds the checkbox. Folder rows are labelled with their path plus `/` (`smoke/`), and request rows with the file name (`orders.bru`), or with the full path when two requests share a file name.

In `view-devenv.jsx`:
- import `TestsView`;
- set the new `TABS`;
- add `{tab === 'Tests' && <TestsView adapter={adapter} picker={pickerAdapter} />}`, `{tab === 'Database' && null}` and `{tab === 'Emulator' && null}`.

Update the comment above `DevenvView` to say that the Mac and Profile tabs come in later phases.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/devenv/tests-view.jsx apps/desktop/src/views/devenv/tests-view.test.jsx apps/desktop/src/views/devenv/view-devenv.jsx
git commit -m "feat(desktop): devenv Tests tab"
```

---

### Task 6: Database tab

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv4`

**Files:**
- Create: `apps/desktop/src/views/devenv/database-view.jsx`, `database-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx` (render `DatabaseView`)

**Interfaces:**
- Consumes:
  - `useDevenvRunContext`;
  - `useDevenvStatus` (`status.database = { state, ui, baseline }`);
  - `useDevenvQuery`;
  - core `normaliseBaselines`, `normaliseSqlScripts`, `buildDbArgv`, `DEVENV_DB_EDITOR_URL`;
  - `RunPanel`;
  - `adapter.open({ url })`.
- Produces: `DatabaseView({ adapter })`.

Layout:
- **Local SQL card:**
  - Status lines "SQL Server 127.0.0.1:14330" (state) and "DB editor" (ui state), and "Latest baseline: <id>".
  - Buttons: **Start**, **Stop**, **Back up now**, **Verify** (`exclusive: false`), **Editor on** (`db ui`), **Editor off** (`db ui --off`), **Open editor** (`adapter.open({ url: DEVENV_DB_EDITOR_URL })`, enabled only when `status.database.ui === 'running'`).
- **Baselines card:**
  - Muted hint: "Restore fills databases that don't exist yet; to replace data, use Start's plan (wipe + restore) or Clean."
  - One row per baseline: id, created (local), size in MB to one decimal, databases joined, a `latest` chip, a `not readable` chip when `!valid`, and **Restore** (`aria-label` `Restore <id>`).
- **SQL scripts card:**
  - Database input (`aria-label` `Database`, prefilled from `scripts.database` once it loads).
  - One row per script: id, about, **Run** (`aria-label` `Run <id>`).
- Alerts as in Tests. `RunPanel` when the command starts with `devenv db `.

- [ ] **Step 1: Write the failing test**

`database-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { DatabaseView } from './database-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const ID = '20261013T120000Z-aaaaaaaa'
const STATUS = ui => ({ type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], test: {}, android: {}, ios: {}, database: { state: 'running', ui, baseline: ID } })
const BASELINES = { type: 'result', kind: 'db-baselines', latest: ID, baselines: [
  { id: ID, createdUtc: '2026-10-13T12:00:00Z', size: 5 * 1024 * 1024, isLatest: true, databases: ['Orders_Local'], sourceContainer: 'sql-dev', valid: true },
  { id: '20261001T080000Z-bbbbbbbb', createdUtc: null, size: 0, isLatest: false, databases: [], sourceContainer: null, valid: false },
] }
const SCRIPTS = { type: 'result', kind: 'db-scripts', database: 'Orders_Local', scripts: [{ id: 'example', about: 'a script for devenv db sql' }] }

function setup({ over = {}, ui = 'running' } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    open: vi.fn(async () => ({ ok: true })),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS(ui)] }
      if (k === 'db baselines --json') return { code: 0, stderr: '', results: [BASELINES] }
      if (k === 'db scripts --json') return { code: 0, stderr: '', results: [SCRIPTS] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  render(<DatabaseView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('DatabaseView', () => {
  it('runs the database actions with the right exclusivity', async () => {
    const { run } = setup()
    await screen.findByText(`Latest baseline: ${ID}`)
    const cases = [['Start', ['db', 'start'], true], ['Stop', ['db', 'stop'], true], ['Back up now', ['db', 'backup'], true],
      ['Verify', ['db', 'verify'], false], ['Editor on', ['db', 'ui'], true], ['Editor off', ['db', 'ui', '--off'], true]]
    for (const [name, argv, exclusive] of cases) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(run.start).toHaveBeenLastCalledWith(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
    }
  })

  it('opens the editor only while it runs', async () => {
    const { adapter } = setup()
    await screen.findByText(`Latest baseline: ${ID}`)
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(adapter.open).toHaveBeenCalledWith({ url: 'http://127.0.0.1:14331' })
    cleanup()
    setup({ ui: 'stopped' })
    await screen.findByText(`Latest baseline: ${ID}`)
    expect(screen.getByRole('button', { name: 'Open editor' }).disabled).toBe(true)
  })

  it('lists baselines and restores the chosen one', async () => {
    const { run } = setup()
    await screen.findByText(ID)
    expect(screen.getByText('5.0 MB')).toBeTruthy()
    expect(screen.getByText('latest')).toBeTruthy()
    expect(screen.getByText('not readable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Restore ${ID}` }))
    expect(run.start).toHaveBeenLastCalledWith(['db', 'restore', '--baseline', ID], { exclusive: true, label: `devenv db restore --baseline ${ID}` })
  })

  it('runs a SQL script on the profile database, or another one', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('Database').value).toBe('Orders_Local'))
    fireEvent.click(screen.getByRole('button', { name: 'Run example' }))
    expect(run.start).toHaveBeenLastCalledWith(['db', 'sql', 'example', '--database', 'Orders_Local'], { exclusive: true, label: 'devenv db sql example --database Orders_Local' })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'x;drop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run example' }))
    expect(run.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/Not a database name/)
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv db backup', runId: 2 } })
    await screen.findByText(ID)
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: `Restore ${ID}` }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/database-view.test.jsx`
Expected: FAIL — `database-view.jsx` not found.

- [ ] **Step 3: Implement `database-view.jsx`**

```jsx
import React from 'react'
import { normaliseBaselines, normaliseSqlScripts, buildDbArgv, DEVENV_DB_EDITOR_URL } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const BASELINES_ARGV = ['db', 'baselines', '--json']
const SCRIPTS_ARGV = ['db', 'scripts', '--json']
const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }

function Line({ state, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-label={state} style={{ width: 8, height: 8, borderRadius: 4, background: DOT[state] || DOT.missing, flex: 'none' }} />
      <span>{children}</span>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function DatabaseView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const baselines = useDevenvQuery({ adapter, config: run.config, argv: BASELINES_ARGV, kind: 'db-baselines', normalise: normaliseBaselines, runStatus: run.state.status })
  const scripts = useDevenvQuery({ adapter, config: run.config, argv: SCRIPTS_ARGV, kind: 'db-scripts', normalise: normaliseSqlScripts, runStatus: run.state.status })
  const [database, setDatabase] = React.useState(null)
  const [actionError, setActionError] = React.useState(null)
  React.useEffect(() => {
    if (database === null && scripts.data) setDatabase(scripts.data.database ?? '')
  }, [scripts.data, database])

  const go = (action, exclusive = true) => {
    setActionError(null)
    let argv
    try { argv = buildDbArgv(action) } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const openEditor = () => adapter.open({ url: DEVENV_DB_EDITOR_URL }).catch(e => setActionError(e?.message || "Couldn't open the editor"))
  const db = status?.database
  const alerts = [actionError, statusError, baselines.error, scripts.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Local SQL">
        {db && <Line state={db.state}>SQL Server 127.0.0.1:14330</Line>}
        {db && <Line state={db.ui}>DB editor</Line>}
        {db?.baseline && <span>{`Latest baseline: ${db.baseline}`}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={busy} onClick={() => go({ kind: 'start' })}>Start</button>
          <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'stop' })}>Stop</button>
          <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'backup' })}>Back up now</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'verify' }, false)}>Verify</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui' })}>Editor on</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'ui-off' })}>Editor off</button>
          <button className="btn sm ghost" disabled={db?.ui !== 'running'} onClick={openEditor}>Open editor</button>
        </div>
      </Card>

      <Card title="Baselines">
        <span style={{ color: 'var(--text-muted)' }}>Restore fills databases that don't exist yet; to replace data, use Start's plan (wipe + restore) or Clean.</span>
        {baselines.data?.baselines.map(b => (
          <div key={b.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{b.id}</strong>
            {b.createdUtc && <span style={{ color: 'var(--text-muted)' }}>{new Date(b.createdUtc).toLocaleString()}</span>}
            <span>{`${(b.size / (1024 * 1024)).toFixed(1)} MB`}</span>
            {b.databases.length > 0 && <span>{b.databases.join(', ')}</span>}
            {b.isLatest && <span className="chip done">latest</span>}
            {!b.valid && <span className="chip failed">not readable</span>}
            <button className="btn sm" disabled={busy} aria-label={`Restore ${b.id}`} onClick={() => go({ kind: 'restore', baseline: b.id })}>Restore</button>
          </div>
        ))}
        {baselines.data && !baselines.data.baselines.length && <span style={{ color: 'var(--text-muted)' }}>No baselines yet — Back up now makes one.</span>}
      </Card>

      <Card title="SQL scripts">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>Database</span>
          <input aria-label="Database" value={database ?? ''} onChange={e => setDatabase(e.target.value)} />
        </label>
        {scripts.data?.scripts.map(s => (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <strong>{s.id}</strong>
            <span style={{ color: 'var(--text-muted)' }}>{s.about}</span>
            <button className="btn sm" disabled={busy} aria-label={`Run ${s.id}`} onClick={() => go({ kind: 'sql', script: s.id, database: database ?? '' })}>Run</button>
          </div>
        ))}
        {scripts.data && !scripts.data.scripts.length && <span style={{ color: 'var(--text-muted)' }}>No scripts in the profile's sql folder.</span>}
      </Card>

      {run.state.command?.startsWith('devenv db ') && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

In `view-devenv.jsx`, import `DatabaseView` and replace the placeholder with `{tab === 'Database' && <DatabaseView adapter={adapter} />}`.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS. If the `Database` label also matches the wrapping `<label>`, both resolve to the same input, which is fine; Testing Library dedupes it.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/devenv/database-view.jsx apps/desktop/src/views/devenv/database-view.test.jsx apps/desktop/src/views/devenv/view-devenv.jsx
git commit -m "feat(desktop): devenv Database tab"
```

---

### Task 7: Emulator tab and spec amendments

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv4`

**Files:**
- Create: `apps/desktop/src/views/devenv/emulator-view.jsx`, `emulator-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx` (render `EmulatorView`)
- Modify: `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 4 amendments)

**Interfaces:**
- Consumes:
  - `useDevenvRunContext`;
  - `useDevenvStatus` (`status.android = { emulator: { running, serial, avd }|null, proxy }`);
  - `useDevenvQuery`;
  - core `normaliseAvds`, `buildEmulatorArgv`, `buildBuildArgv` (`{ kind: 'app-install' }`);
  - `RunPanel`;
  - `adapter.pathForFile(file)`;
  - `picker.pickFile()` → `string|null`.
- Produces: `EmulatorView({ adapter, picker })`.

Layout:
- **Emulator card:**
  - Status: "Emulator" running state with serial and avd; "Proxy (mitmproxy)" state.
  - `<select aria-label="AVD">` over the AVDs. The initial value is the running emulator's AVD if it is in the list, else `default` if it is in the list, else the first.
  - "Use the proxy" checkbox (default on).
  - Buttons: **Start**, **Stop**, **Proxy on**, **Proxy off**, **Push CA**, **Reinstall app** (`['app','install']`).
  - **Recreate image…** first shows the inline text "This deletes <avd> and creates it again." with **Recreate <avd>** and **Keep it**. Only **Recreate <avd>** runs `emulator create --avd <avd>`.
  - The AVD query `error` (no SDK) is shown in the alerts.
- **Push files card:**
  - A drop zone (`data-testid="drop-zone"`, text "Drop files here"). `onDragOver` calls `preventDefault`. `onDrop` maps `dataTransfer.files` through `adapter.pathForFile`, drops empty strings, and adds new paths to the list.
  - **Add file…** (`picker.pickFile()`).
  - The list of paths, each with a remove button (`aria-label` `Remove <path>`).
  - Destination input (`aria-label` `Destination`, placeholder "Pictures for images, Download for the rest").
  - **Push** builds `{ kind: 'push', paths, dest }`. Builder errors are shown as an alert, and no run starts.
- `RunPanel` when the command starts with `devenv emulator ` or equals `devenv app install`.

- [ ] **Step 1: Write the failing test**

`emulator-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { EmulatorView } from './emulator-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = emu => ({ type: 'result', kind: 'status', docker: { ok: true }, backend: [], infra: [], test: {}, database: {}, ios: {}, android: { emulator: emu, proxy: 'running' } })
const AVDS = (extra = {}) => ({ type: 'result', kind: 'emulator-avds', avds: ['Pixel_9', 'Tablet'], default: 'Pixel_9', error: null, ...extra })

function setup({ over = {}, emu = null, avds = AVDS() } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = {
    pathForFile: vi.fn(f => (f.name === 'skip' ? '' : `C:\\Users\\me\\${f.name}`)),
    query: vi.fn(async (_c, argv) => {
      const k = argv.join(' ')
      if (k === 'status --json') return { code: 0, stderr: '', results: [STATUS(emu)] }
      if (k === 'emulator avds --json') return { code: 0, stderr: '', results: [avds] }
      return { code: 1, stderr: 'unexpected', results: [] }
    }),
  }
  const picker = { pickFile: vi.fn(async () => 'C:\\Users\\me\\doc.pdf') }
  render(<EmulatorView adapter={adapter} picker={picker} />)
  return { run: globalThis.__run, adapter, picker }
}

describe('EmulatorView', () => {
  it('starts the chosen AVD with or without the proxy', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'start', '--avd', 'Pixel_9'], { exclusive: true, label: 'devenv emulator start --avd Pixel_9' })
    fireEvent.change(screen.getByLabelText('AVD'), { target: { value: 'Tablet' } })
    fireEvent.click(screen.getByLabelText('Use the proxy'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'start', '--avd', 'Tablet', '--no-proxy'], expect.objectContaining({ exclusive: true }))
  })

  it('preselects the running emulator\'s AVD', async () => {
    setup({ emu: { running: true, serial: 'emulator-5580', avd: 'Tablet' } })
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Tablet'))
    expect(screen.getByText('emulator-5580 (Tablet)')).toBeTruthy()
  })

  it('runs stop, proxy, CA and reinstall', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    const cases = [['Stop', ['emulator', 'stop']], ['Proxy on', ['emulator', 'proxy']], ['Proxy off', ['emulator', 'proxy', '--off']],
      ['Push CA', ['emulator', 'push-ca']], ['Reinstall app', ['app', 'install']]]
    for (const [name, argv] of cases) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(run.start).toHaveBeenLastCalledWith(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
    }
  })

  it('asks before recreating the image, and Keep it backs out', async () => {
    const { run } = setup()
    await waitFor(() => expect(screen.getByLabelText('AVD').value).toBe('Pixel_9'))
    fireEvent.click(screen.getByRole('button', { name: 'Recreate image…' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByText('This deletes Pixel_9 and creates it again.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByText('This deletes Pixel_9 and creates it again.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Recreate image…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recreate Pixel_9' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'create', '--avd', 'Pixel_9'], { exclusive: true, label: 'devenv emulator create --avd Pixel_9' })
  })

  it('pushes dropped and picked files to the destination', async () => {
    const { run } = setup()
    await screen.findByTestId('drop-zone')
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [{ name: 'photo.jpg' }, { name: 'skip' }] } })
    fireEvent.click(screen.getByRole('button', { name: 'Add file…' }))
    await screen.findByText('C:\\Users\\me\\doc.pdf')
    expect(screen.getByText('C:\\Users\\me\\photo.jpg')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '/sdcard/Download' } })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).toHaveBeenLastCalledWith(['emulator', 'push', 'C:\\Users\\me\\photo.jpg', 'C:\\Users\\me\\doc.pdf', '--to', '/sdcard/Download'],
      { exclusive: true, label: 'devenv emulator push C:\\Users\\me\\photo.jpg C:\\Users\\me\\doc.pdf --to /sdcard/Download' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove C:\\Users\\me\\photo.jpg' }))
    expect(screen.queryByText('C:\\Users\\me\\photo.jpg')).toBeNull()
  })

  it('refuses a push with no files or a bad destination', async () => {
    const { run } = setup()
    await screen.findByTestId('drop-zone')
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least one file/)
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [{ name: 'a.txt' }] } })
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '/data/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/sdcard/)
  })

  it('shows the SDK error from the AVD list', async () => {
    setup({ avds: AVDS({ avds: [], error: 'Android emulator not found - set ANDROID_HOME' }) })
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /ANDROID_HOME/.test(a.textContent))).toBe(true))
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv emulator start --avd Pixel_9', runId: 5 } })
    await screen.findByTestId('drop-zone')
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Push' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/emulator-view.test.jsx`
Expected: FAIL — `emulator-view.jsx` not found.

- [ ] **Step 3: Implement `emulator-view.jsx`**

```jsx
import React from 'react'
import { normaliseAvds, buildEmulatorArgv, buildBuildArgv } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

const AVDS_ARGV = ['emulator', 'avds', '--json']
const DOT = { running: 'var(--success)', stopped: 'var(--text-muted)', missing: 'var(--border)' }
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv emulator ') || cmd === 'devenv app install')

function Line({ state, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-label={state} style={{ width: 8, height: 8, borderRadius: 4, background: DOT[state] || DOT.missing, flex: 'none' }} />
      <span>{children}</span>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function EmulatorView({ adapter, picker }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error: statusError } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const avds = useDevenvQuery({ adapter, config: run.config, argv: AVDS_ARGV, kind: 'emulator-avds', normalise: normaliseAvds, runStatus: run.state.status })
  const [avd, setAvd] = React.useState('')
  const [proxy, setProxy] = React.useState(true)
  const [confirming, setConfirming] = React.useState(false)
  const [files, setFiles] = React.useState([])
  const [dest, setDest] = React.useState('')
  const [actionError, setActionError] = React.useState(null)
  const emu = status?.android.emulator

  React.useEffect(() => {
    const list = avds.data?.avds
    if (avd || !list?.length || !status) return
    const running = emu?.running && list.includes(emu.avd) ? emu.avd : null
    setAvd(running ?? (list.includes(avds.data.default) ? avds.data.default : list[0]))
  }, [avds.data, status, emu, avd])

  const go = build => {
    setActionError(null)
    let argv
    try { argv = typeof build === 'function' ? build() : build } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
  }
  const addPaths = paths => setFiles(fs => [...fs, ...paths.filter(p => p && !fs.includes(p))])
  const onDrop = e => {
    e.preventDefault()
    addPaths([...(e.dataTransfer?.files ?? [])].map(f => adapter.pathForFile(f)))
  }
  const addFile = async () => { const p = await picker.pickFile(); if (p) addPaths([p]) }
  const alerts = [actionError, statusError, avds.error, avds.data?.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Android emulator">
        {status && <Line state={emu?.running ? 'running' : 'stopped'}>{emu?.running ? `${emu.serial} (${emu.avd})` : 'Emulator not running'}</Line>}
        {status && <Line state={status.android.proxy}>Proxy (mitmproxy)</Line>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="AVD" value={avd} onChange={e => { setAvd(e.target.value); setConfirming(false) }} disabled={!avds.data?.avds.length}>
            {avds.data?.avds.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" aria-label="Use the proxy" checked={proxy} onChange={e => setProxy(e.target.checked)} />
            <span>Use the proxy</span>
          </label>
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildEmulatorArgv({ kind: 'start', avd, proxy }))}>Start</button>
          <button className="btn sm" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'stop' }))}>Stop</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'proxy', on: true }))}>Proxy on</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'proxy', on: false }))}>Proxy off</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildEmulatorArgv({ kind: 'push-ca' }))}>Push CA</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go(buildBuildArgv({ kind: 'app-install' }))}>Reinstall app</button>
          <button className="btn sm ghost" disabled={busy || !avd} onClick={() => setConfirming(true)}>Recreate image…</button>
        </div>
        {confirming && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{`This deletes ${avd} and creates it again.`}</span>
            <button className="btn sm danger" disabled={busy} onClick={() => { setConfirming(false); go(() => buildEmulatorArgv({ kind: 'create', avd })) }}>{`Recreate ${avd}`}</button>
            <button className="btn sm ghost" onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        )}
      </Card>

      <Card title="Push files">
        <div data-testid="drop-zone" onDragOver={e => e.preventDefault()} onDrop={onDrop}
          style={{ border: '1px dashed var(--border)', borderRadius: 6, padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
          Drop files here
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={addFile}>Add file…</button>
          <input aria-label="Destination" placeholder="Pictures for images, Download for the rest" value={dest} onChange={e => setDest(e.target.value)} />
          <button className="btn sm primary" disabled={busy} onClick={() => go(() => buildEmulatorArgv({ kind: 'push', paths: files, dest }))}>Push</button>
        </div>
        {files.map(f => (
          <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{f}</span>
            <button className="btn sm ghost" aria-label={`Remove ${f}`} onClick={() => setFiles(fs => fs.filter(x => x !== f))}>×</button>
          </div>
        ))}
      </Card>

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

In `view-devenv.jsx`, import `EmulatorView` and replace the placeholder with `{tab === 'Emulator' && <EmulatorView adapter={adapter} picker={pickerAdapter} />}`.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`. Then run the whole desktop suite once with `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`.
Expected: PASS. The only allowed exception is the known pre-existing `src/jira-create-form.test.jsx` failure; do not touch it.

- [ ] **Step 5: Spec amendments**

Append to `docs/superpowers/specs/2026-10-08-devenv-module-design.md`:

```markdown
## Amendments made during Phase 4 planning

- The Tests, Database and Emulator tabs read devenv data commands through `devenv:query`: `test runs --json` (run history from `.local/test/traces/runs/*/run.json` and Bruno's `bruno.json`), `test collection --json [--collection <folder>]` (the folder/request tree `bru run` accepts), `db baselines --json`, `db scripts --json` and `emulator avds --json`. `devenv:query` allows one absolute folder argument, for `test collection` only.
- Every Tests / Database / Emulator action is an existing devenv command run through the provider's single run; `test web`, `test report` and `db verify` run non-exclusive.
- `.html` files opened through `devenv:open` (devenv's `open` events and the Tests history) open in a sandboxed NexusMD window (no preload); links in it go to the system browser.
- `devenv db restore` only fills databases that don't exist yet (devenv's own rule); the Database tab says so and points at Start's plan or Clean for replacing data.
- Recreating an AVD (`emulator create`) is confirmed in the Emulator tab first; devenv itself still does not ask.
- Dropped files get their paths through `webUtils.getPathForFile` in the preload.
- Status, Start, Builds, Logs, Tests, Database, Emulator and Commands are the Dev Environment tabs in this phase.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/devenv/emulator-view.jsx apps/desktop/src/views/devenv/emulator-view.test.jsx apps/desktop/src/views/devenv/view-devenv.jsx docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "feat(desktop): devenv Emulator tab"
```

---

### Task 8: End-to-end check

**Repository:** both

- [ ] **Step 1: Full suites**

- devenv: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`. All pass.
- NexusMD, in the worktree: `npm -w packages/core test` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the known jira failure.

- [ ] **Step 2: Headless end-to-end check (throwaway script in the session scratchpad, nothing committed)**

Drive the worktree's `apps/desktop/electron/ipc/devenv.cjs` with the real `spawn`, a fake `ipcMain`, an `openReport` spy, and config `{ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }`:
1. Run each new query once and print the timing and a summary:
   - `['test','runs','--json']`: run count, and the newest run's label and outcome;
   - `['test','collection','--json']`: item count;
   - `['db','baselines','--json']`: count and latest;
   - `['db','scripts','--json']`: count and default database;
   - `['emulator','avds','--json']`: the list, or the error.
2. `devenv:open({ path: <the newest run's traceHtml> })` calls the `openReport` spy, not `shell.openPath`.
3. `devenv:run ['db','verify']` with `{ exclusive: false }` → exit code (verify is read-only).

Do not run `test up`, `test run`, `db restore`, `db backup`, `emulator create` or `emulator start`: they change the user's environment.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment → Tests | Test APIs with state, collection tree, run history with Passed/Failed and counts |
| 2 | Call chain on a run | Report opens in a NexusMD window; a link in it opens the browser |
| 3 | Tick one request → Run selected | Run panel; afterwards the call-chain report opens in-app and History shows the new run |
| 4 | Database → Verify | Output with per-database table counts; the button is usable while Status keeps refreshing |
| 5 | Database → Editor on, then Open editor | DbGate opens in the browser |
| 6 | Emulator → Start (proxy on) | Emulator window appears; status shows serial and AVD |
| 7 | Drag a photo onto "Drop files here" → Push | Output shows `→ /sdcard/Pictures/<name>` |
| 8 | Recreate image… → Keep it | Nothing runs |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite.
