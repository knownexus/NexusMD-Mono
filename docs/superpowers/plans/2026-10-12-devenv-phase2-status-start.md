# Dev Environment Module — Phase 2 (Status + Start) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Status tab that shows the whole local environment at a glance and a Start flow whose plan screen and branch picker are real NexusMD forms. This replaces phase 1's numbered-menu dialogs.

**Architecture:** devenv gains three structured messages in host mode:
- `devenv status --json` emits a `result` of kind `status`.
- `devenv start` sends its plan as a `plan` prompt carrying DevPlan's existing data transfer object (DTO), and the branch picker as a `ref` prompt. Both are answered with a JSON object in DevPlan's existing result format.
- A successful start emits a `result` of kind `summary`.

NexusMD gains:
- a read-only `devenv:query` IPC, used by status polling and running alongside the provider's single run;
- core normalisers;
- `PlanDialog` and `RefPickerDialog`, rendered by the existing provider for those prompt kinds;
- Status and Start tabs.

**Tech Stack:** PowerShell 7.6 + Pester 6 (devenv); Electron 43 CJS main, React 18, Vitest 4 + Testing Library (no jest-dom) in NexusMD.

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 2, plus its Amendments). Phase 1 plan for reference: `docs/superpowers/plans/2026-10-08-devenv-phase1-foundation.md`.

**Two repositories.** Tasks 1–3 change `C:\repos\dev-environment`. Tasks 4–9 change `C:\repos\NexusMD-Mono`. Task 10 spans both.

## Global Constraints

- With `DEVENV_HOST` unset, devenv's terminal behaviour stays exactly as today. That covers `devenv status` text, the DevPlan full-screen UI, the plain plan screen and the branch picker.
- Control lines: `@@devenv ` followed by compact JSON. Protocol version stays `1`: the new prompt kinds and result kinds are additive.
- New prompt kinds:
  - `plan`: the prompt's `plan` field is DevPlan's input DTO. The answer is DevPlan's output object `{ action: 'start'|'cancel'|'change-ref:<key>', services: { <key>: 'skip'|'build'|'clean' }, database: 'asis'|'restore'|'wipe'|'remote', baseline: string|null, emulator: bool, ios: 'off'|'run'|'build', test: 'off'|'up'|'run', testServices: string[] }`.
  - `ref`: the prompt's `ref` field is `{ name, current, worktrees: [{ path, ref, display, folder, current }], remotes: string[] }`. The answer is `{ kind: 'worktree', index }`, `{ kind: 'remote', name }`, `{ kind: 'ref', value }` or `{ kind: 'cancel' }`.
- New result kinds:
  - `status`: shape defined in Task 2.
  - `summary`: `{ kind: 'summary', title, rows: [{ key, value }], notes: string[] }`. A row with an empty value is a section heading.
- `devenv:query` is read-only and allowlisted. Only argv `['status', '--json']` is accepted. It never takes the exclusive slot.
- Status refreshes every 10 s while the Status tab is mounted and the document is visible. It also refreshes after every provider run ends.
- Every start, stop, backend and doctor action goes through the provider's single run (phase 1 rule: one command at a time from the UI). Its buttons are disabled while that run is starting or running.
- NexusMD code style: ESM without semicolons in `src/` and `packages/`; CommonJS with semicolons in `electron/*.cjs`. devenv code style: compact PowerShell as in the existing files. Comments explain why, never what.
- Desktop tests always run with `NODE_OPTIONS=--no-experimental-webstorage` (this machine runs Node 26). Pester runs as `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester <path>"`. JS test strings keep Windows paths escaped (`'C:\\x'`).

## Review Focus

- **Docker Desktop not running when Status polls.** Expected: the status reports `docker.ok: false` with the error, and the Status tab shows a banner instead of empty or failed cards. Pinned in Task 2 (`ConvertTo-DevenvStatus` with `-DockerError`) and Task 7.
- **Plan prompt while the profile's refs don't resolve (`locked: false`).** Expected: the form shows the lock error and Start is disabled, but Change branch still works. Pinned in Task 6.
- **Choosing "Wipe" in the plan form.** Expected: Start stays disabled until YES is typed, matching the terminal's "Type YES" confirmation. Pinned in Task 6.
- **Closing the plan or ref dialog with Esc or X.** Expected: a plan dialog answers `{ action: 'cancel' }` (devenv prints "Cancelled - nothing was started", exit 0). A ref dialog answers `{ kind: 'cancel' }`, which keeps the current branch. Neither is a protocol cancel that kills the run. Pinned in Task 6.
- **Status polls while a mutating run is going.** Expected: polling continues through `devenv:query` and never takes or waits for the exclusive slot. Pinned in Task 4 (main) and Task 7 (hook).

---

### Task 1: `Request-DevenvDecision` — structured answers

**Repository:** `C:\repos\dev-environment`

**Files:**
- Modify: `host-common.ps1` (add the function after `Request-DevenvInput`)
- Test: `tests/host-common.Tests.ps1` (new `Describe` block)

**Interfaces:**
- Produces: `Request-DevenvDecision -Kind <string> -Title <string> [-Detail <string>] -Data <IDictionary>` → `[hashtable]`, the answer's `value`. It is host mode only and throws outside host mode. It throws `Cancelled.` on a cancel answer. When stdin closes it throws `NexusMD closed the answer channel - stopping.`

- [ ] **Step 1: Write the failing tests**

Append to `tests/host-common.Tests.ps1`:

```powershell
Describe 'Request-DevenvDecision (host mode)' {
 It 'sends the data under its kind and returns the answer object' {
  $code='$r=Request-DevenvDecision -Kind plan -Title "Local session" -Data @{plan=@{locked=$true;services=@()}}; Write-Output "action:$($r.action) db:$($r.database) svc:$($r.services.api)"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":{"action":"start","database":"restore","services":{"api":"clean"}}}')
  $p=(Get-ControlMessages $r.Out)[0]
  $p.type | Should -Be 'prompt'
  $p.kind | Should -Be 'plan'
  $p.title | Should -Be 'Local session'
  $p.plan.locked | Should -BeTrue
  $r.Out | Should -Contain 'action:start db:restore svc:clean'
 }
 It 'shares the prompt id sequence with Request-DevenvInput' {
  $code='$a=Request-DevenvInput "A"; $b=Request-DevenvDecision -Kind ref -Title "Branch" -Data @{ref=@{name="api"}}; Write-Output "$a/$($b.kind)"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":"x"}','{"id":"p2","value":{"kind":"cancel"}}')
  (Get-ControlMessages $r.Out).id | Should -Be @('p1','p2')
  $r.Out | Should -Contain 'x/cancel'
 }
 It 'throws Cancelled. on a cancel answer' {
  $r=Invoke-HostSnippet 'Request-DevenvDecision -Kind plan -Title t -Data @{}' -Stdin @('{"id":"p1","cancel":true}')
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match 'Cancelled\.'
 }
 It 'fails instead of hanging when stdin closes' {
  $r=Invoke-HostSnippet 'Request-DevenvDecision -Kind plan -Title t -Data @{}'
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match 'closed the answer channel'
 }
 It 'refuses to run outside host mode' {
  $r=Invoke-HostSnippet 'Request-DevenvDecision -Kind plan -Title t -Data @{}' -NoHost
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match 'only under NexusMD'
 }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/host-common.Tests.ps1 -Output Detailed"`
Expected: the five new tests FAIL (`Request-DevenvDecision` is not recognised).

- [ ] **Step 3: Implement**

The prompt id counter, answer reading and id check are shared with `Request-DevenvInput`. Factor them out instead of duplicating them. Add a private helper and route both functions through it:

```powershell
function Read-DevenvAnswer([Parameter(Mandatory)][Collections.IDictionary]$Prompt) {
 # One prompt out, one JSON answer back; shared by every host-mode question.
 $script:DevenvPromptSeq++
 $id="p$script:DevenvPromptSeq"
 $msg=[ordered]@{id=$id}
 foreach ($k in $Prompt.Keys) { $msg[$k]=$Prompt[$k] }
 Write-DevenvEvent prompt $msg
 $line=[Console]::In.ReadLine()
 if ($null -eq $line) { throw 'NexusMD closed the answer channel - stopping.' }
 $answer=$line | ConvertFrom-Json -AsHashtable
 if ($answer['id'] -ne $id) { throw "Got an answer for '$($answer['id'])' while waiting for '$id'." }
 if ($answer['cancel']) { throw 'Cancelled.' }
 return ,$answer['value']
}

function Request-DevenvDecision {
 # The plan screen and branch picker answer with a whole object (DevPlan's result format),
 # not a typed string, so they get their own entry point. Host mode only: the terminal keeps
 # devplan.exe and the plain screens.
 param(
  [Parameter(Mandatory)][string]$Kind,
  [Parameter(Mandatory)][string]$Title,
  [string]$Detail,
  [Parameter(Mandatory)][Collections.IDictionary]$Data
 )
 if (!(Test-DevenvHost)) { throw 'Request-DevenvDecision runs only under NexusMD (DEVENV_HOST=nexusmd).' }
 $prompt=[ordered]@{kind=$Kind;title=$Title}
 if ($Detail) { $prompt.detail=$Detail }
 foreach ($k in $Data.Keys) { $prompt[$k]=$Data[$k] }
 $value=Read-DevenvAnswer $prompt
 if ($value -isnot [Collections.IDictionary]) { throw "Expected an object answer for the $Kind prompt." }
 return $value
}
```

Then change `Request-DevenvInput`'s host branch so it builds its `$data` without `id` and calls `$value=Read-DevenvAnswer $data`. Delete its now-duplicated counter, `Write-DevenvEvent`, `ReadLine` and id/cancel lines. Keep the existing SecureString and array-join handling of `$value`. The existing Task 1 tests (prompt ids, cancel, closed stdin, wrong id) must still pass unchanged.

- [ ] **Step 4: Run all Pester tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS (39 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add host-common.ps1 tests/host-common.Tests.ps1
git commit -m "feat(host): add Request-DevenvDecision for object answers"
```

---

### Task 2: `devenv status --json`

**Repository:** `C:\repos\dev-environment`

**Files:**
- Create: `status-common.ps1`
- Modify: `session.ps1` (param block: add `[switch]$Json`; the `'Status'` action)
- Modify: `devenv.ps1` (the `''/status` command entry)
- Test: `tests/status.Tests.ps1`; `tests/catalog.Tests.ps1` (one assertion)

**Interfaces:**
- Produces:
  - `ConvertTo-DevenvStatus -Rows <object[]> -Apis <object[]> -TestApis <object[]> [-Emulator <IDictionary>] -Mac <IDictionary> [-Baseline <string>] [-DockerError <string>]` → ordered hashtable. This is pure and has no I/O.
  - `Get-DevenvContainerRows` → `@(@{project;service;state})` read from `docker ps -a`. It throws on a docker failure.
  - `Get-DevenvEmulatorState -StateFile <path>` → `$null` or `@{running;serial;avd}`.
  - `devenv status --json` prints exactly one line, `@@devenv {"type":"result","kind":"status",...}`, and nothing else (with or without `DEVENV_HOST`). It exits 0 even when Docker is down.
- Status shape:

```json
{ "type": "result", "kind": "status", "at": "<ISO 8601>",
  "docker":   { "ok": true, "error": null },
  "backend":  [{ "key": "orders", "label": "Orders API", "port": 5101, "state": "running|stopped|missing" }],
  "infra":    [{ "service": "storage", "state": "running|stopped" }],
  "database": { "state": "running|stopped|missing", "ui": "running|stopped|missing", "baseline": "2026-10-01-1200" },
  "test":     { "tracer": "running|stopped|missing", "apis": [{ "key": "orders", "label": "Orders API", "port": 5201, "state": "running|stopped|missing" }] },
  "android":  { "emulator": { "running": true, "serial": "emulator-5554", "avd": "devenv" }, "proxy": "running|stopped|missing" },
  "ios":      { "host": "mac.local", "error": null } }
```

Container states map from Docker's `State`: `running` → `running`, any other value → `stopped`, and no container → `missing`. The compose projects are `devenv-app` (backend APIs = the profile's `docker` services; `infra` = every other service in that project), `devenv-database` (`sql`; `dbui`), `devenv-test` (`tracer`; the API services keyed by repository key) and `devenv-mobile-proxy` (`mitmproxy`).

- [ ] **Step 1: Write the failing tests**

`tests/status.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'host-common.ps1')
 . (Join-Path $root 'status-common.ps1')
 $apis=@(@{Key='orders';Label='Orders API';Port=5101},@{Key='billing';Label='Billing API';Port=5102})
 $testApis=@(@{Key='orders';Label='Orders API';Port=5201})
 $rows=@(
  @{project='devenv-app';service='orders';state='running'}
  @{project='devenv-app';service='storage';state='running'}
  @{project='devenv-app';service='servicebus';state='exited'}
  @{project='devenv-database';service='sql';state='running'}
  @{project='devenv-test';service='tracer';state='running'}
  @{project='devenv-test';service='orders';state='exited'}
  @{project='devenv-mobile-proxy';service='mitmproxy';state='running'}
  @{project='something-else';service='orders';state='running'}
 )
}

Describe 'ConvertTo-DevenvStatus' {
 BeforeAll {
  $s=ConvertTo-DevenvStatus -Rows $rows -Apis $apis -TestApis $testApis -Emulator @{running=$true;serial='emulator-5554';avd='devenv'} -Mac @{Host='mac.local';Error=$null} -Baseline 'b1'
 }
 It 'is a status result' { $s.type | Should -Be 'result'; $s.kind | Should -Be 'status'; $s.docker.ok | Should -BeTrue }
 It 'maps backend APIs in profile order with running / missing' {
  $s.backend.key | Should -Be @('orders','billing')
  $s.backend.state | Should -Be @('running','missing')
  $s.backend[0].port | Should -Be 5101
 }
 It 'lists the other devenv-app services as infra, non-running as stopped' {
  ($s.infra | Where-Object service -eq 'storage').state | Should -Be 'running'
  ($s.infra | Where-Object service -eq 'servicebus').state | Should -Be 'stopped'
  $s.infra.service | Should -Not -Contain 'orders'
 }
 It 'reports the database, its UI and baseline' {
  $s.database.state | Should -Be 'running'
  $s.database.ui | Should -Be 'missing'
  $s.database.baseline | Should -Be 'b1'
 }
 It 'reports the test stack from its own project only' {
  $s.test.tracer | Should -Be 'running'
  $s.test.apis[0].state | Should -Be 'stopped'
  $s.test.apis[0].port | Should -Be 5201
 }
 It 'reports Android and iOS' {
  $s.android.emulator.serial | Should -Be 'emulator-5554'
  $s.android.proxy | Should -Be 'running'
  $s.ios.host | Should -Be 'mac.local'
 }
 It 'reports docker down without inventing containers' {
  $d=ConvertTo-DevenvStatus -Rows @() -Apis $apis -TestApis $testApis -Mac @{Host=$null;Error='no mac.json'} -DockerError 'Docker Desktop is not running'
  $d.docker.ok | Should -BeFalse
  $d.docker.error | Should -Be 'Docker Desktop is not running'
  $d.backend.state | Should -Be @('missing','missing')
  $d.android.emulator | Should -BeNullOrEmpty
  $d.ios.error | Should -Be 'no mac.json'
 }
}

Describe 'Get-DevenvEmulatorState' {
 It 'is null without a state file' { Get-DevenvEmulatorState -StateFile (Join-Path $TestDrive 'none.json') | Should -BeNullOrEmpty }
 It 'is running only while the recorded process exists' {
  $f=Join-Path $TestDrive 'emu.json'
  @{pid=$PID;serial='emulator-5554';avd='devenv'} | ConvertTo-Json | Set-Content $f
  (Get-DevenvEmulatorState -StateFile $f).running | Should -BeTrue
  @{pid=999999;serial='emulator-5554';avd='devenv'} | ConvertTo-Json | Set-Content $f
  (Get-DevenvEmulatorState -StateFile $f).running | Should -BeFalse
 }
}

Describe 'devenv status --json' {
 It 'prints exactly one status result line and exits 0' {
  $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
  try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') status --json); $code=$LASTEXITCODE }
  finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  $code | Should -Be 0
  $lines.Count | Should -Be 1
  $lines[0] | Should -Match '^@@devenv '
  ($lines[0].Substring(9) | ConvertFrom-Json -AsHashtable).kind | Should -Be 'status'
 }
}
```

Append to `tests/catalog.Tests.ps1` inside `Describe 'devenv help --json'`:

```powershell
 It 'status takes --json and stays read-only' {
  (Get-Cmd '' 'status').switches | Should -Contain 'json'
  (Get-Cmd '' 'status').mut | Should -BeFalse
 }
```

- [ ] **Step 2: Run to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/status.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL (`status-common.ps1` missing; `json` not a switch).

- [ ] **Step 3: Write `status-common.ps1`**

```powershell
#requires -Version 7.0
# The environment's state as data, for NexusMD's Status tab (devenv status --json). The
# conversion is pure so it can be tested without Docker; Get-* functions do the reading.

function Get-DevenvContainerState([object[]]$Rows,[string]$Project,[string]$Service) {
 $row=@($Rows | Where-Object { $_.project -eq $Project -and $_.service -eq $Service }) | Select-Object -First 1
 if (!$row) { return 'missing' }
 if ($row.state -eq 'running') { return 'running' }
 return 'stopped'
}

function ConvertTo-DevenvStatus {
 param(
  [object[]]$Rows=@(),
  [object[]]$Apis=@(),
  [object[]]$TestApis=@(),
  [Collections.IDictionary]$Emulator,
  [Collections.IDictionary]$Mac=@{},
  [string]$Baseline,
  [string]$DockerError
 )
 $apiKeys=@($Apis | ForEach-Object { $_.Key })
 [ordered]@{
  type='result'; kind='status'; at=(Get-Date).ToUniversalTime().ToString('o')
  docker=[ordered]@{ ok=!$DockerError; error=$(if ($DockerError) { $DockerError } else { $null }) }
  backend=@(foreach ($a in $Apis) { [ordered]@{ key=$a.Key; label=$a.Label; port=$a.Port; state=(Get-DevenvContainerState $Rows 'devenv-app' $a.Key) } })
  infra=@(foreach ($r in @($Rows | Where-Object { $_.project -eq 'devenv-app' -and $apiKeys -notcontains $_.service })) {
   [ordered]@{ service=$r.service; state=$(if ($r.state -eq 'running') { 'running' } else { 'stopped' }) }
  })
  database=[ordered]@{
   state=(Get-DevenvContainerState $Rows 'devenv-database' 'sql')
   ui=(Get-DevenvContainerState $Rows 'devenv-database' 'dbui')
   baseline=$(if ($Baseline) { $Baseline } else { $null })
  }
  test=[ordered]@{
   tracer=(Get-DevenvContainerState $Rows 'devenv-test' 'tracer')
   apis=@(foreach ($t in $TestApis) { [ordered]@{ key=$t.Key; label=$t.Label; port=$t.Port; state=(Get-DevenvContainerState $Rows 'devenv-test' $t.Key) } })
  }
  android=[ordered]@{ emulator=$Emulator; proxy=(Get-DevenvContainerState $Rows 'devenv-mobile-proxy' 'mitmproxy') }
  ios=[ordered]@{ host=$Mac['Host']; error=$Mac['Error'] }
 }
}

function Get-DevenvContainerRows {
 # One docker call for every devenv compose project; the project and service come from the
 # labels compose puts on its containers.
 $out=@(& docker.exe ps -a --filter 'label=com.docker.compose.project' --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.State}}' 2>&1)
 if ($LASTEXITCODE) { throw ((@($out) -join ' ').Trim()) }
 @(foreach ($line in $out) {
  $p="$line".Split('|')
  if ($p.Count -eq 3 -and $p[0] -like 'devenv-*') { @{project=$p[0];service=$p[1];state=$p[2]} }
 })
}

function Get-DevenvEmulatorState([string]$StateFile) {
 if (!(Test-Path $StateFile)) { return $null }
 try { $s=Get-Content $StateFile -Raw | ConvertFrom-Json -AsHashtable } catch { return $null }
 $alive=[bool](Get-Process -Id ([int]$s['pid']) -ErrorAction SilentlyContinue)
 [ordered]@{ running=$alive; serial=$s['serial']; avd=$s['avd'] }
}
```

- [ ] **Step 4: Wire `session.ps1` and `devenv.ps1`**

In `session.ps1`'s param block add `[switch]$Json` (after `[switch]$RemoteDb`, with the comment `# Status: one machine-readable line for NexusMD instead of the text report`). Below the existing dot-sources add:

```powershell
. (Join-Path $root 'status-common.ps1')       # ConvertTo-DevenvStatus, Get-DevenvContainerRows, Get-DevenvEmulatorState
```

At the top of the `'Status' {` action, before `Write-Banner 'Backend + database'`:

```powershell
  if ($Json) {
   $rows=@(); $dockerError=$null
   try { $rows=@(Get-DevenvContainerRows) } catch { $dockerError="Docker isn't answering: $_" }
   $latest=Join-Path $root '.local/database/latest.txt'
   $status=ConvertTo-DevenvStatus -Rows $rows `
    -Apis @($dockerApis | ForEach-Object { @{Key=$_.Key;Label=$_.Label;Port=$_.Port} }) `
    -TestApis @($testApis | ForEach-Object { @{Key=$_.Key;Label=$_.Label;Port=$_.Test['port']} }) `
    -Emulator (Get-DevenvEmulatorState -StateFile (Join-Path $root '.local/emulator.json')) `
    -Mac (Get-MacHostInfo) `
    -Baseline $(if (Test-Path $latest) { (Get-Content $latest -Raw).Trim() }) `
    -DockerError $dockerError
   $data=[ordered]@{}; foreach ($k in $status.Keys) { if ($k -ne 'type') { $data[$k]=$status[$k] } }
   Write-DevenvEvent result $data -Force
   return
  }
```

In `devenv.ps1`, change the status entry to:

```powershell
 @{G='';V='status';A='';S='Emulator, containers and proxy at a glance';Sw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{Action='Status'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'session.ps1' $n }}
```

- [ ] **Step 5: Run all Pester tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS. Also run `pwsh -NoProfile -File ./devenv.ps1 status` and confirm the text report is unchanged.

- [ ] **Step 6: Commit**

```bash
git add status-common.ps1 session.ps1 devenv.ps1 tests/status.Tests.ps1 tests/catalog.Tests.ps1
git commit -m "feat: devenv status --json for NexusMD's Status tab"
```

---

### Task 3: Plan form, branch picker and summary as structured messages

**Repository:** `C:\repos\dev-environment`

**Files:**
- Modify: `session.ps1`:
  - `Invoke-StartPlanUI` (≈747-807): extract `New-StartPlanDto` and `Set-StartPlanFromResult`, and add a host branch;
  - `Select-Ref` (≈531-616): host branch before `Invoke-DevPlanRefPicker`;
  - the start summary (≈1046-1050): emit a `summary` result.
- Test: `tests/start-host.Tests.ps1`

**Interfaces:**
- Consumes: `Request-DevenvDecision` (Task 1).
- Produces:
  - `New-StartPlanDto($Plan)` → ordered hashtable: exactly the DTO `Invoke-StartPlanUI` writes for devplan today.
  - `Set-StartPlanFromResult($Plan, $Result)`: applies a DevPlan result to `$Plan`, exactly as today.
  - In host mode `Invoke-StartPlanUI` sends prompt `kind: 'plan'` with `plan = New-StartPlanDto`, applies the answer, and sets `$script:StartPlanUIResult` to its `action`.
  - In host mode `Select-Ref` sends prompt `kind: 'ref'` with `ref = { name, current, worktrees, remotes }` and handles the answer with the existing devplan result switch.
  - After a successful start, host mode emits `result` `{ kind: 'summary', title: 'Session up', rows, notes }`.

- [ ] **Step 1: Write the failing tests**

`tests/start-host.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
 $root=Split-Path $PSScriptRoot -Parent
 function Get-SessionFunction([string]$Name) {
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'session.ps1'),[ref]$null,[ref]$null)
  $fn=$ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name },$true) | Select-Object -First 1
  if (!$fn) { throw "No function $Name in session.ps1" }
  $fn.Extent.Text
 }
 # Just enough of session.ps1's script state for the plan functions.
 $prelude=@'
$serviceLabels=[ordered]@{api='Orders API';mobile='Mobile app'}
$dockerApiText='Orders API'; $testError=$null
$testApis=@([pscustomobject]@{Key='api';Label='Orders API';Test=@{port=5201}})
function Get-DbBackupEntries { @([pscustomobject]@{Id='b1';Size=10;IsLatest=$true}) }
function Resolve-TestKeys($Keys) { [string[]]@($Keys) }
function Write-Timing($x) {}
$plan=[ordered]@{Locked=$true;LockError=$null;Database='asis';Baseline=$null;RememberedBaseline=$null;Emulator=$false
 Ios='off';MacHost=$null;MacError='no mac.json';Test='off';TestServices=[string[]]@('api')
 Services=[ordered]@{api=[ordered]@{Ref='main';Branch='main';Sha='abc12345';Dirty=$false;Action='skip';Built=$true;Remembered=$false}
                     mobile=[ordered]@{Ref='main';Branch='main';Sha='def67890';Dirty=$true;Action='build';Built=$false;Remembered=$false}}}
'@
 $fns=(Get-SessionFunction 'New-StartPlanDto')+"`n"+(Get-SessionFunction 'Set-StartPlanFromResult')+"`n"+(Get-SessionFunction 'Invoke-StartPlanUI')
}

Describe 'start plan in host mode' {
 It 'sends the plan DTO as a plan prompt and applies the answer' {
  $code=$prelude+"`n"+$fns+"`n"+'Invoke-StartPlanUI $plan; Write-Output "ui:$script:StartPlanUIResult db:$($plan.Database) base:$($plan.Baseline) api:$($plan.Services.api.Action) emu:$($plan.Emulator) test:$($plan.Test)"'
  $answer='{"id":"p1","value":{"action":"start","services":{"api":"clean","mobile":"skip"},"database":"restore","baseline":"b1","emulator":true,"ios":"off","test":"up","testServices":["api"]}}'
  $r=Invoke-HostSnippet $code -Stdin @($answer)
  $p=(Get-ControlMessages $r.Out)[0]
  $p.kind | Should -Be 'plan'
  $p.plan.locked | Should -BeTrue
  $p.plan.services.key | Should -Be @('api','mobile')
  $p.plan.services[1].dirty | Should -BeTrue
  $p.plan.backups[0].id | Should -Be 'b1'
  $p.plan.testApis[0].port | Should -Be 5201
  $r.Out | Should -Contain 'ui:start db:restore base:b1 api:clean emu:True test:up'
 }
 It 'reports change-ref so the existing loop opens the branch picker' {
  $code=$prelude+"`n"+$fns+"`n"+'Invoke-StartPlanUI $plan; Write-Output "ui:$script:StartPlanUIResult"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":{"action":"change-ref:api","services":{"api":"skip","mobile":"build"},"database":"asis","baseline":null,"emulator":false,"ios":"off","test":"off","testServices":["api"]}}')
  $r.Out | Should -Contain 'ui:change-ref:api'
 }
 It 'never touches devplan in host mode' {
  $code=$prelude+"`n"+$fns+"`n"+'function Get-DevPlanExe { throw "devplan must not run" }; Invoke-StartPlanUI $plan; Write-Output "ok"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":{"action":"cancel"}}')
  $r.Out | Should -Contain 'ok'
 }
}

Describe 'branch picker in host mode' {
 It 'sends worktrees and remotes and applies a typed ref' {
  $repo=Join-Path $TestDrive 'repos/api'
  New-Item -ItemType Directory $repo -Force | Out-Null
  & git -C $repo init -q -b main 2>$null
  & git -C $repo -c user.email=t@t -c user.name=t commit -q --allow-empty -m init 2>$null
  $fns2=(Get-SessionFunction 'Get-LocalWorktrees')+"`n"+(Get-SessionFunction 'New-BranchWorktree')+"`n"+(Get-SessionFunction 'Select-Ref')
  $code="`$root='$TestDrive'; `$cfg=@{repositories=@{api=@{source='repos/api';ref='main'}}}`n"+$fns2+"`n"+'Select-Ref $cfg "api"; Write-Output "ref:$($cfg.repositories.api.ref)"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":{"kind":"ref","value":"feature/x"}}')
  $p=(Get-ControlMessages $r.Out)[0]
  $p.kind | Should -Be 'ref'
  $p.ref.name | Should -Be 'api'
  $p.ref.current | Should -Be 'main'
  $p.ref.worktrees[0].ref | Should -Be 'main'
  $r.Out | Should -Contain 'ref:feature/x'
 }
 It 'keeps the current ref on a cancel answer' {
  $repo=Join-Path $TestDrive 'repos/api2'
  New-Item -ItemType Directory $repo -Force | Out-Null
  & git -C $repo init -q -b main 2>$null
  & git -C $repo -c user.email=t@t -c user.name=t commit -q --allow-empty -m init 2>$null
  $fns2=(Get-SessionFunction 'Get-LocalWorktrees')+"`n"+(Get-SessionFunction 'New-BranchWorktree')+"`n"+(Get-SessionFunction 'Select-Ref')
  $code="`$root='$TestDrive'; `$cfg=@{repositories=@{api=@{source='repos/api2';ref='main'}}}`n"+$fns2+"`n"+'Select-Ref $cfg "api"; Write-Output "ref:$($cfg.repositories.api.ref)"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":{"kind":"cancel"}}')
  $r.Out | Should -Contain 'ref:main'
 }
}

Describe 'session summary' {
 It 'is emitted as a summary result in host mode' {
  (Get-Content (Join-Path $root 'session.ps1') -Raw) | Should -Match "Write-DevenvEvent result @\{kind='summary'"
 }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/start-host.Tests.ps1 -Output Detailed"`
Expected: FAIL (`No function New-StartPlanDto`; no `ref` prompt; no summary event).

- [ ] **Step 3: Extract `New-StartPlanDto` and `Set-StartPlanFromResult`**

Move the DTO construction out of `Invoke-StartPlanUI` into its own function, placed just above it. The body is the existing `$dto=[ordered]@{...}` block, unchanged, plus the `$backups` line it depends on:

```powershell
function New-StartPlanDto($Plan) {
 # The plan as data: what devplan.exe reads (--in) and what NexusMD's plan form shows.
 $backups=@(Get-DbBackupEntries | Sort-Object Id | ForEach-Object { @{id=$_.Id;size=[int64]$_.Size;isLatest=[bool]$_.IsLatest} })
 [ordered]@{
  locked=[bool]$Plan.Locked; lockError=$Plan.LockError; database=$Plan.Database; baseline=$Plan.Baseline
  rememberedBaseline=$Plan.RememberedBaseline; emulator=[bool]$Plan.Emulator; backups=$backups
  ios=[string]$Plan.Ios; macHost=$Plan.MacHost; macError=$Plan.MacError; dockerApis=$dockerApiText
  test=[string]$Plan.Test; testError=$testError; testServices=@($Plan.TestServices)
  testApis=@(foreach ($t in $testApis) { @{key=$t.Key;label=$t.Label;port=[int]$t.Test['port']} })
  services=@(foreach ($name in $serviceLabels.Keys) {
   $s=$Plan.Services[$name]
   @{key=$name;label=$serviceLabels[$name];ref=$s.Ref;branch=$s.Branch;sha=$s.Sha;dirty=[bool]$s.Dirty;action=$s.Action;built=[bool]$s.Built;remembered=[bool]$s.Remembered}
  })
 }
}

function Set-StartPlanFromResult($Plan,$Result) {   # untyped: [hashtable] would COPY the [ordered] plan
 # A devplan / NexusMD plan answer applied to the plan; unknown or missing fields keep today's value.
 foreach ($name in $serviceLabels.Keys) {
  if ($Result['services'] -and $Result.services.ContainsKey($name)) { $Plan.Services[$name].Action=$Result.services[$name] }
 }
 if ($Result.ContainsKey('database')) { $Plan.Database=$Result.database }
 if ($Result.ContainsKey('baseline')) { $Plan.Baseline=$Result.baseline }
 if ($Result.ContainsKey('emulator')) { $Plan.Emulator=[bool]$Result.emulator }
 if ($Result.ContainsKey('ios') -and "$($Result.ios)" -in @('off','run','build')) { $Plan.Ios=[string]$Result.ios }
 if ($Result.ContainsKey('test') -and "$($Result.test)" -in @('off','up','run')) { $Plan.Test=[string]$Result.test }
 if ($Result.ContainsKey('testServices') -and $Result.testServices) { $Plan.TestServices=Resolve-TestKeys @($Result.testServices) }
}
```

In `Invoke-StartPlanUI`:
- replace the `$backups=...` and `$dto=[ordered]@{...}` lines with `$dto=New-StartPlanDto $Plan`;
- replace the block that applies `$result` (the `foreach ($name ...)` loop through the `testServices` line) with `Set-StartPlanFromResult $Plan $result`.

The devplan path must behave exactly as before. Note that the old code assigned `database`, `baseline` and `emulator` unconditionally. devplan always sends all three, so the `ContainsKey` guards change nothing for it.

- [ ] **Step 4: Host branch in `Invoke-StartPlanUI`**

Directly after `$script:StartPlanUIResult=$null`, and before the redirected-console check:

```powershell
 if (Test-DevenvHost) {
  # NexusMD draws the plan as a form; its answer has devplan's result format.
  $result=Request-DevenvDecision -Kind plan -Title 'Local session - review, then start' -Data @{plan=(New-StartPlanDto $Plan)}
  Set-StartPlanFromResult $Plan $result
  $script:StartPlanUIResult="$($result['action'])"
  return
 }
```

The start loop in `'Start'` already handles `cancel`, `change-ref:<name>` and `start` from `$script:StartPlanUIResult`. It also already refuses to start an unlocked plan, so it needs no change.

- [ ] **Step 5: Host branch in `Select-Ref`**

Replace the line `Invoke-DevPlanRefPicker $Name $current $wtDto $remote` with:

```powershell
  if (Test-DevenvHost) {
   # NexusMD's branch picker answers in devplan's ref-picker result format, so the switch
   # below handles both.
   $script:DevPlanRefPickerAvailable=$true
   $script:DevPlanRefPickerResult=Request-DevenvDecision -Kind ref -Title "Branch for $Name" -Data @{ref=[ordered]@{name=$Name;current=$current;worktrees=$wtDto;remotes=@($remote)}}
  } else {
   Invoke-DevPlanRefPicker $Name $current $wtDto $remote
  }
```

- [ ] **Step 6: Summary result**

Immediately before `Invoke-DevPlanSummary 'Session up' $summaryRows $summaryNotes`:

```powershell
  Write-DevenvEvent result @{kind='summary';title='Session up';rows=@($summaryRows | ForEach-Object { [ordered]@{key=$_.key;value=$_.value} });notes=@($summaryNotes)}
```

(`Write-DevenvEvent` writes nothing outside host mode.)

- [ ] **Step 7: Run all Pester tests and check the terminal**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS, including `no-console.Tests.ps1`.

- [ ] **Step 8: Commit**

```bash
git add session.ps1 tests/start-host.Tests.ps1
git commit -m "feat: send the start plan, branch picker and session summary to NexusMD as data"
```

---

### Task 4: `devenv:query` for read-only queries

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Modify: `apps/desktop/electron/ipc/devenv.cjs`: generalise `collect`'s timeout message and add the `devenv:query` handler
- Modify: `apps/desktop/electron/preload.cjs`, `apps/desktop/src/adapters/devenv.js`, `packages/core/src/adapters/index.js` (`IDevenvAdapter.query`)
- Test: `apps/desktop/electron/ipc/devenv.test.js`, `apps/desktop/electron/preload.test.js`

**Interfaces:**
- Produces: IPC `devenv:query (config, argv) → { code: number, results: object[], stderr: string }`. `results` holds every `@@devenv` control message whose `type` is `result`, in order. Only argv `['status', '--json']` is allowed; anything else throws `Not a devenv query: <argv>`. It does not use the run registry or the exclusive slot. It is tracked for `disposeAll` and uses the same 30 s timeout as the catalog, with the message `devenv took too long to answer <argv joined by space>`.
- Preload and adapter: `query(config, argv)`. `IDevenvAdapter.query` defaults to `async () => ({ code: -1, results: [], stderr: 'not available' })`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('devenv ipc', ...)` block in `devenv.test.js`. It uses the existing `setup()`, `CONFIG` and `tick`:

```js
  it('query runs status --json privately and returns its result messages', async () => {
    const p = t.handlers['devenv:query'](null, CONFIG, ['status', '--json'])
    await tick()
    expect(t.deps.spawn.mock.calls[0][1].slice(-2)).toEqual(['status', '--json'])
    t.children[0].stdout.write('@@devenv {"type":"result","kind":"status","docker":{"ok":true}}\nplain\n')
    t.children[0].finish(0)
    await expect(p).resolves.toEqual({ code: 0, results: [{ type: 'result', kind: 'status', docker: { ok: true } }], stderr: '' })
    expect(t.sent).toEqual([])
  })

  it('query is allowed while an exclusive run holds the slot', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true, label: 'start' })
    const p = t.handlers['devenv:query'](null, CONFIG, ['status', '--json'])
    await tick()
    t.children[1].finish(0)
    await expect(p).resolves.toHaveProperty('code', 0)
  })

  it('query refuses anything but status --json', async () => {
    await expect(t.handlers['devenv:query'](null, CONFIG, ['stop'])).rejects.toThrow(/Not a devenv query/)
    await expect(t.handlers['devenv:query'](null, CONFIG, ['status'])).rejects.toThrow(/Not a devenv query/)
    expect(t.deps.spawn).not.toHaveBeenCalled()
  })
```

Add to `preload.test.js`, next to the other devenv bridge test:

```js
  it('exposes devenv.query over devenv:query', () => {
    const cfg = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
    exposed.devenv.query(cfg, ['status', '--json'])
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:query', cfg, ['status', '--json'])
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js electron/preload.test.js`
Expected: FAIL (`handlers['devenv:query'] is not a function`; `exposed.devenv.query is not a function`).

- [ ] **Step 3: Implement**

In `devenv.cjs`:
- give `collect` a third parameter, `timeoutMessage`, and use it in the timer's `reject(new Error(timeoutMessage))`. The catalog handler passes `'devenv took too long to list its commands'`, so its existing test is unchanged.
- add:

```js
const QUERIES = [['status', '--json']];

function isQuery(argv) {
  return Array.isArray(argv) && QUERIES.some(q => q.length === argv.length && q.every((a, i) => a === argv[i]));
}
```

(module level, next to `OPENABLE_EXTENSIONS`), and inside `register`:

```js
  // Read-only questions for the Status tab: they never take the exclusive slot, so status
  // keeps refreshing while a start or stop is running.
  handle('devenv:query', async (_e, config, argv) => {
    if (!isQuery(argv)) throw new Error(`Not a devenv query: ${Array.isArray(argv) ? argv.join(' ') : String(argv)}`);
    const { lines, stderr, code } = await collect(config, argv, `devenv took too long to answer ${argv.join(' ')}`);
    const results = [];
    for (const line of lines) {
      const msg = parseControl(line);
      if (msg && msg.type === 'result') results.push(msg);
    }
    return { code, results, stderr };
  });
```

In `preload.cjs`, inside `devenv: { ... }` after `active`:

```js
    query:   (config, argv) => ipcRenderer.invoke('devenv:query', config, argv),
```

In `adapters/devenv.js` add `query(config, argv) { return api().query(config, argv) },`. In `IDevenvAdapter` add:

```js
  // Read-only devenv questions (status) — never queued behind a running command.
  query:   async (config, argv) => ({ code: -1, results: [], stderr: 'not available' }),
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron` then `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/ipc/devenv.test.js apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/devenv.js packages/core/src/adapters/index.js
git commit -m "feat(desktop): add read-only devenv:query for status"
```

---

### Task 5: Core normalisers — status, plan, ref, summary

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `packages/core/src/modules/devenv/status.js`, `plan.js`, `summary.js`
- Modify: `packages/core/src/modules/devenv/index.js` (re-exports), `packages/core/src/index.js` (exports), `packages/core/tests/public-api.test.js` (EXPECTED list)
- Test: `packages/core/src/modules/devenv/status.test.js`, `plan.test.js`, `summary.test.js`

**Interfaces:**
- Produces (all exported from `@nexusmd/core`):
  - `normaliseStatus(result) → StatusView`, where `StatusView = { at: string|null, docker: { ok: boolean, error: string|null }, backend: Item[], infra: { service, state }[], database: { state, ui, baseline }, test: { tracer, apis: Item[] }, android: { emulator: { running, serial, avd }|null, proxy }, ios: { host, error } }` and `Item = { key, label, port, state }`. `state` is always one of `'running'|'stopped'|'missing'`; anything else becomes `'missing'`. Missing sections get safe defaults. It throws `Not a devenv status` unless `result.kind === 'status'`.
  - `createPlanForm(plan) → PlanForm`, where `PlanForm = { services: { [key]: 'skip'|'build'|'clean' }, database, baseline, wipeConfirm: '', emulator, ios, test, testServices: string[] }`. It is the initial form state from a `plan` prompt's DTO. `baseline` defaults to the DTO's baseline, else `rememberedBaseline` if that is in `backups`, else the `isLatest` backup, else the first backup, else `null`.
  - `validatePlanForm(plan, form) → string|null`: the reason Start is blocked, or `null`. Rules, in order:
    1. `!plan.locked` → `Pick a branch that exists for every source first: <lockError>`
    2. database `restore`/`wipe` with no backups → `No saved baseline to restore — run devenv db backup first`
    3. `wipe` and `wipeConfirm !== 'YES'` → `Type YES to wipe the local database`
    4. `test !== 'off'` and no `testServices` → `Pick at least one API for the test stack`
  - `buildPlanAnswer(form, action) → object`, the DevPlan result `{ action, services, database, baseline, emulator, ios, test, testServices }`. `baseline` is `null` unless the database is `restore`/`wipe`. `action` is `'start'`, `'cancel'` or `'change-ref:<key>'`.
  - `normaliseRefPrompt(prompt) → { name, current, worktrees: { path, ref, display, folder, current }[], remotes: string[] }`.
  - `normaliseSummary(result) → { title, sections: { heading: string|null, rows: { key, value, failed: boolean }[] }[], notes: string[] }`. A row with an empty value starts a new section headed by its key. `failed` is true when the value starts with `FAILED`.

- [ ] **Step 1: Write the failing tests**

`status.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseStatus } from './status.js'

const full = {
  type: 'result', kind: 'status', at: '2026-10-12T10:00:00Z',
  docker: { ok: true, error: null },
  backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }, { key: 'billing', label: 'Billing API', port: 5102, state: 'weird' }],
  infra: [{ service: 'storage', state: 'running' }],
  database: { state: 'running', ui: 'missing', baseline: 'b1' },
  test: { tracer: 'stopped', apis: [{ key: 'orders', label: 'Orders API', port: 5201, state: 'stopped' }] },
  android: { emulator: { running: true, serial: 'emulator-5554', avd: 'devenv' }, proxy: 'running' },
  ios: { host: 'mac.local', error: null },
}

describe('normaliseStatus', () => {
  it('keeps a full status and clamps unknown states to missing', () => {
    const s = normaliseStatus(full)
    expect(s.backend.map(b => b.state)).toEqual(['running', 'missing'])
    expect(s.database).toEqual({ state: 'running', ui: 'missing', baseline: 'b1' })
    expect(s.android.emulator.serial).toBe('emulator-5554')
    expect(s.ios.host).toBe('mac.local')
  })
  it('fills safe defaults for missing sections', () => {
    const s = normaliseStatus({ kind: 'status', docker: { ok: false, error: 'Docker is down' } })
    expect(s.docker).toEqual({ ok: false, error: 'Docker is down' })
    expect(s.backend).toEqual([])
    expect(s.test).toEqual({ tracer: 'missing', apis: [] })
    expect(s.android).toEqual({ emulator: null, proxy: 'missing' })
    expect(s.ios).toEqual({ host: null, error: null })
  })
  it('rejects non-status results', () => {
    expect(() => normaliseStatus({ kind: 'summary' })).toThrow(/Not a devenv status/)
  })
})
```

`plan.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt } from './plan.js'

const plan = {
  locked: true, lockError: null, database: 'asis', baseline: null, rememberedBaseline: 'b2',
  emulator: false, ios: 'off', macHost: null, macError: 'no mac.json', dockerApis: 'Orders API',
  test: 'off', testError: null, testServices: ['orders'],
  backups: [{ id: 'b1', size: 10, isLatest: true }, { id: 'b2', size: 20, isLatest: false }],
  testApis: [{ key: 'orders', label: 'Orders API', port: 5201 }],
  services: [
    { key: 'orders', label: 'Orders API', ref: 'main', branch: 'main', sha: 'abc12345', dirty: false, action: 'skip', built: true, remembered: false },
    { key: 'mobile', label: 'Mobile app', ref: 'main', branch: 'feature/x', sha: 'def67890', dirty: true, action: 'build', built: false, remembered: false },
  ],
}

describe('createPlanForm', () => {
  it('starts from the plan, preferring the remembered baseline', () => {
    expect(createPlanForm(plan)).toEqual({
      services: { orders: 'skip', mobile: 'build' }, database: 'asis', baseline: 'b2', wipeConfirm: '',
      emulator: false, ios: 'off', test: 'off', testServices: ['orders'],
    })
  })
  it('falls back to the latest backup, then none', () => {
    expect(createPlanForm({ ...plan, rememberedBaseline: 'gone' }).baseline).toBe('b1')
    expect(createPlanForm({ ...plan, rememberedBaseline: null, backups: [] }).baseline).toBeNull()
  })
})

describe('validatePlanForm', () => {
  const form = createPlanForm(plan)
  it('accepts the default plan', () => { expect(validatePlanForm(plan, form)).toBeNull() })
  it('blocks an unlocked plan with its reason', () => {
    expect(validatePlanForm({ ...plan, locked: false, lockError: 'ref nope not found' }, form)).toBe('Pick a branch that exists for every source first: ref nope not found')
  })
  it('needs a baseline to restore or wipe', () => {
    expect(validatePlanForm({ ...plan, backups: [] }, { ...form, database: 'restore', baseline: null })).toMatch(/No saved baseline/)
  })
  it('needs YES typed to wipe', () => {
    expect(validatePlanForm(plan, { ...form, database: 'wipe' })).toBe('Type YES to wipe the local database')
    expect(validatePlanForm(plan, { ...form, database: 'wipe', wipeConfirm: 'yes' })).toBe('Type YES to wipe the local database')
    expect(validatePlanForm(plan, { ...form, database: 'wipe', wipeConfirm: 'YES' })).toBeNull()
  })
  it('needs an API when the test stack is on', () => {
    expect(validatePlanForm(plan, { ...form, test: 'up', testServices: [] })).toBe('Pick at least one API for the test stack')
  })
})

describe('buildPlanAnswer', () => {
  it('builds devplan\'s result and drops the baseline unless restoring', () => {
    const form = { ...createPlanForm(plan), services: { orders: 'clean', mobile: 'skip' }, emulator: true, test: 'up' }
    expect(buildPlanAnswer(form, 'start')).toEqual({
      action: 'start', services: { orders: 'clean', mobile: 'skip' }, database: 'asis', baseline: null,
      emulator: true, ios: 'off', test: 'up', testServices: ['orders'],
    })
    expect(buildPlanAnswer({ ...form, database: 'restore' }, 'change-ref:orders')).toMatchObject({ action: 'change-ref:orders', database: 'restore', baseline: 'b2' })
  })
})

describe('normaliseRefPrompt', () => {
  it('reads the ref block with defaults', () => {
    const r = normaliseRefPrompt({ kind: 'ref', ref: { name: 'orders', current: 'main', worktrees: [{ path: 'C:\\w\\main', ref: 'main', display: 'main', folder: 'main', current: true }], remotes: ['origin/feature-x'] } })
    expect(r.name).toBe('orders')
    expect(r.worktrees[0].path).toBe('C:\\w\\main')
    expect(r.remotes).toEqual(['origin/feature-x'])
    expect(normaliseRefPrompt({ kind: 'ref' })).toEqual({ name: '', current: '', worktrees: [], remotes: [] })
  })
})
```

`summary.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseSummary } from './summary.js'

describe('normaliseSummary', () => {
  it('groups rows under their headings and flags failures', () => {
    const s = normaliseSummary({
      kind: 'summary', title: 'Session up',
      rows: [
        { key: 'Backend', value: '' }, { key: 'Orders API', value: 'http://127.0.0.1:5101' },
        { key: 'Mobile', value: '' }, { key: 'iOS', value: 'FAILED - ssh exit 255' },
      ],
      notes: ['devenv status'],
    })
    expect(s.title).toBe('Session up')
    expect(s.sections).toEqual([
      { heading: 'Backend', rows: [{ key: 'Orders API', value: 'http://127.0.0.1:5101', failed: false }] },
      { heading: 'Mobile', rows: [{ key: 'iOS', value: 'FAILED - ssh exit 255', failed: true }] },
    ])
    expect(s.notes).toEqual(['devenv status'])
  })
  it('keeps rows before any heading in an untitled section', () => {
    expect(normaliseSummary({ kind: 'summary', rows: [{ key: 'a', value: 'b' }] }).sections).toEqual([{ heading: null, rows: [{ key: 'a', value: 'b', failed: false }] }])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`status.js`:

```js
// packages/core/src/modules/devenv/status.js
//
// `devenv status --json` as the Status tab's view model. Unknown states read as 'missing'
// so a newer devenv can't make a card claim something is running.

const STATES = ['running', 'stopped', 'missing']
const state = v => (STATES.includes(v) ? v : 'missing')
const str = v => (typeof v === 'string' && v ? v : null)
const items = list => (Array.isArray(list) ? list : []).map(i => ({
  key: String(i?.key ?? ''), label: String(i?.label ?? i?.key ?? ''), port: Number.isFinite(i?.port) ? i.port : null, state: state(i?.state),
}))

export function normaliseStatus(result) {
  if (!result || result.kind !== 'status') throw new Error('Not a devenv status')
  const emu = result.android?.emulator
  return {
    at: str(result.at),
    docker: { ok: result.docker?.ok === true, error: str(result.docker?.error) },
    backend: items(result.backend),
    infra: (Array.isArray(result.infra) ? result.infra : []).map(i => ({ service: String(i?.service ?? ''), state: state(i?.state) })),
    database: { state: state(result.database?.state), ui: state(result.database?.ui), baseline: str(result.database?.baseline) },
    test: { tracer: state(result.test?.tracer), apis: items(result.test?.apis) },
    android: {
      emulator: emu && typeof emu === 'object' ? { running: emu.running === true, serial: str(emu.serial), avd: str(emu.avd) } : null,
      proxy: state(result.android?.proxy),
    },
    ios: { host: str(result.ios?.host), error: str(result.ios?.error) },
  }
}
```

`plan.js`:

```js
// packages/core/src/modules/devenv/plan.js
//
// The `devenv start` plan prompt (devplan's DTO) as an editable form, and the answer it
// sends back (devplan's result format), so NexusMD and devplan.exe drive the same loop.

const list = v => (Array.isArray(v) ? v : [])

function defaultBaseline(plan) {
  const ids = list(plan.backups).map(b => b.id)
  if (plan.baseline && ids.includes(plan.baseline)) return plan.baseline
  if (plan.rememberedBaseline && ids.includes(plan.rememberedBaseline)) return plan.rememberedBaseline
  return list(plan.backups).find(b => b.isLatest)?.id ?? ids[0] ?? null
}

export function createPlanForm(plan) {
  const services = {}
  for (const s of list(plan.services)) services[s.key] = s.action || 'build'
  return {
    services,
    database: plan.database || 'asis',
    baseline: defaultBaseline(plan),
    wipeConfirm: '',
    emulator: plan.emulator === true,
    ios: plan.ios || 'off',
    test: plan.test || 'off',
    testServices: list(plan.testServices).map(String),
  }
}

/** @returns {string|null} why Start can't go ahead, or null. */
export function validatePlanForm(plan, form) {
  if (!plan.locked) return `Pick a branch that exists for every source first: ${plan.lockError || 'a ref did not resolve'}`
  const restoring = form.database === 'restore' || form.database === 'wipe'
  if (restoring && (!list(plan.backups).length || !form.baseline)) return 'No saved baseline to restore — run devenv db backup first'
  if (form.database === 'wipe' && form.wipeConfirm !== 'YES') return 'Type YES to wipe the local database'
  if (form.test !== 'off' && !form.testServices.length) return 'Pick at least one API for the test stack'
  return null
}

/** @param {'start'|'cancel'|string} action  'change-ref:<key>' opens that source's branch picker. */
export function buildPlanAnswer(form, action) {
  const restoring = form.database === 'restore' || form.database === 'wipe'
  return {
    action,
    services: { ...form.services },
    database: form.database,
    baseline: restoring ? form.baseline : null,
    emulator: form.emulator,
    ios: form.ios,
    test: form.test,
    testServices: [...form.testServices],
  }
}

export function normaliseRefPrompt(prompt) {
  const r = prompt?.ref || {}
  return {
    name: String(r.name ?? ''),
    current: String(r.current ?? ''),
    worktrees: list(r.worktrees).map(w => ({ path: String(w.path ?? ''), ref: String(w.ref ?? ''), display: String(w.display ?? w.ref ?? ''), folder: String(w.folder ?? ''), current: w.current === true })),
    remotes: list(r.remotes).map(String),
  }
}
```

`summary.js`:

```js
// packages/core/src/modules/devenv/summary.js
//
// The "Session up" summary devenv start emits; a row with no value is a section heading,
// exactly as the terminal prints it.

export function normaliseSummary(result) {
  const sections = []
  let current = null
  for (const row of Array.isArray(result?.rows) ? result.rows : []) {
    const key = String(row?.key ?? '')
    const value = String(row?.value ?? '')
    if (!value) { current = { heading: key, rows: [] }; sections.push(current); continue }
    if (!current) { current = { heading: null, rows: [] }; sections.push(current) }
    current.rows.push({ key, value, failed: value.startsWith('FAILED') })
  }
  return {
    title: String(result?.title ?? 'Session up'),
    sections: sections.filter(s => s.rows.length),
    notes: (Array.isArray(result?.notes) ? result.notes : []).map(String),
  }
}
```

Re-export from `modules/devenv/index.js`:

```js
export { normaliseStatus } from './status.js'
export { createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt } from './plan.js'
export { normaliseSummary } from './summary.js'
```

Then add `normaliseStatus, createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt, normaliseSummary` to the devenv export block in `packages/core/src/index.js` and to `EXPECTED` in `packages/core/tests/public-api.test.js`.

- [ ] **Step 4: Run tests**

Run: `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/devenv packages/core/src/index.js packages/core/tests/public-api.test.js
git commit -m "feat(core): devenv status, plan form and summary view models"
```

---

### Task 6: Plan and branch dialogs, rendered by the provider

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/plan-dialog.jsx`, `ref-picker-dialog.jsx`, `prompt-host.jsx`
- Modify: `apps/desktop/src/views/devenv/devenv-run-context.jsx`: render `PromptHost` instead of `PromptDialog`
- Test: `apps/desktop/src/views/devenv/plan-dialog.test.jsx`, `ref-picker-dialog.test.jsx`, `prompt-host.test.jsx`

**Interfaces:**
- Consumes: `createPlanForm`, `validatePlanForm`, `buildPlanAnswer`, `normaliseRefPrompt` (Task 5); `PromptDialog`; `PlModal` (accepts `wide` and `closeOnBackdrop`).
- Produces:
  - `PlanDialog({ prompt, onAnswer })`. `onAnswer(answerObject)` is called with `buildPlanAnswer(...)` for Start, for Change branch… (`change-ref:<key>`) and for Cancel/Esc/X (`action: 'cancel'`). It never sends a protocol cancel.
  - `RefPickerDialog({ prompt, onAnswer })`. The answer is `{ kind: 'worktree', index }`, `{ kind: 'remote', name }`, `{ kind: 'ref', value }` or `{ kind: 'cancel' }` (Esc/X/Cancel).
  - `PromptHost({ prompt, onAnswer, onCancel })`. It picks the dialog by `prompt.kind`: `plan` → PlanDialog, `ref` → RefPickerDialog, else PromptDialog. Callers pass `key={prompt.id}`.

**Plan dialog layout** (a wide `PlModal`, title `prompt.title`, `closeOnBackdrop={false}`, `onClose` = answer `cancel`):
- A lock-error banner when `!plan.locked` (`plan.lockError`).
- **Sources:** one row per `plan.services`. The row shows the label, `branch` (or `ref`) with `*` when `dirty`, the 8-character `sha`, and a select labelled `Build <label>` with options `skip`/`build`/`clean` (text: "Skip (already built)" when `built`, else "Skip"; "Build"; "Clean rebuild"). It also has a **Change branch…** button that answers `change-ref:<key>` with the current form.
- **Database:** a radio group labelled `Database`:
  - `asis` "Leave the data as it is";
  - `restore` "Restore a saved baseline";
  - `wipe` "Wipe the SQL volume, then restore a baseline";
  - `remote` "Use the remote DEV database (shared — changes are real)".
  For `restore`/`wipe`, a select labelled `Baseline` lists `backups` (id + size, "latest" marker). For `wipe`, an input labelled `Type YES to wipe`.
- **Test stack:** a radio group `off`/`up`/`run` ("Leave it alone" / "Start APIs behind the tracer" / "Start them, then run the Bruno collection"), disabled with `plan.testError` shown when set. Below it, one checkbox per `testApis` (`<label> :<port>`).
- **Android:** a checkbox labelled `Start the Android emulator`.
- **iOS:** a radio group `off`/`run`/`build` ("Leave it alone" / "Build, then run on the simulator" / "Build only"), disabled with `plan.macError` shown when set.
- **Footer:** the `validatePlanForm` message (when set) in danger colour, **Cancel**, and **Start**. Start is disabled while the message is set.

**Ref dialog layout** (`PlModal`, title `prompt.title`, `closeOnBackdrop={false}`, `onClose` = `{ kind: 'cancel' }`):
- **Worktrees:** buttons for each worktree, showing `display` and `folder`, marked "current". Clicking one answers `{ kind: 'worktree', index }`.
- **Remote branches:** a filter input labelled `Filter remote branches` plus buttons. Clicking one answers `{ kind: 'remote', name }`, with the hint "creates a new worktree".
- **Other ref:** an input labelled `Branch, tag or SHA` and a **Use** button that answers `{ kind: 'ref', value }`. The button is disabled while the input is empty.
- **Footer:** **Cancel**.

- [ ] **Step 1: Write the failing tests**

`plan-dialog.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PlanDialog } from './plan-dialog.jsx'

afterEach(cleanup)

const plan = {
  locked: true, lockError: null, database: 'asis', baseline: null, rememberedBaseline: null,
  emulator: false, ios: 'off', macHost: null, macError: 'no mac.json', dockerApis: 'Orders API',
  test: 'off', testError: null, testServices: ['orders'],
  backups: [{ id: 'b1', size: 1048576, isLatest: true }],
  testApis: [{ key: 'orders', label: 'Orders API', port: 5201 }],
  services: [
    { key: 'orders', label: 'Orders API', ref: 'main', branch: 'main', sha: 'abc1234567', dirty: false, action: 'skip', built: true, remembered: false },
    { key: 'mobile', label: 'Mobile app', ref: 'main', branch: 'feature/x', sha: 'def6789012', dirty: true, action: 'build', built: false, remembered: false },
  ],
}
const prompt = over => ({ type: 'prompt', id: 'p1', kind: 'plan', title: 'Local session - review, then start', plan: { ...plan, ...over } })

describe('PlanDialog', () => {
  it('shows each source with branch, dirty marker and short sha', () => {
    render(<PlanDialog prompt={prompt()} onAnswer={vi.fn()} />)
    expect(screen.getByText('feature/x*')).toBeTruthy()
    expect(screen.getByText('def67890')).toBeTruthy()
  })

  it('Start answers devplan\'s result with the edited choices', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.change(screen.getByLabelText('Build Orders API'), { target: { value: 'clean' } })
    fireEvent.click(screen.getByLabelText('Start the Android emulator'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onAnswer).toHaveBeenCalledWith({
      action: 'start', services: { orders: 'clean', mobile: 'build' }, database: 'asis', baseline: null,
      emulator: true, ios: 'off', test: 'off', testServices: ['orders'],
    })
  })

  it('Change branch answers change-ref with the current choices', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change branch…' })[1])
    expect(onAnswer.mock.calls[0][0].action).toBe('change-ref:mobile')
  })

  it('blocks Start on an unlocked plan but still allows Change branch', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt({ locked: false, lockError: "ref 'nope' not found" })} onAnswer={onAnswer} />)
    expect(screen.getByText("Pick a branch that exists for every source first: ref 'nope' not found")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Change branch…' })[0])
    expect(onAnswer.mock.calls[0][0].action).toBe('change-ref:orders')
  })

  it('wipe needs YES typed before Start', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByLabelText(/Wipe the SQL volume/))
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type YES to wipe'), { target: { value: 'YES' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ action: 'start', database: 'wipe', baseline: 'b1' }))
  })

  it('disables iOS with the Mac error', () => {
    render(<PlanDialog prompt={prompt()} onAnswer={vi.fn()} />)
    expect(screen.getByText('no mac.json')).toBeTruthy()
    expect(screen.getByLabelText('Build, then run on the simulator').disabled).toBe(true)
  })

  it('Cancel and Esc answer action cancel (not a protocol cancel)', () => {
    const onAnswer = vi.fn()
    render(<PlanDialog prompt={prompt()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect(onAnswer.mock.calls[1][0].action).toBe('cancel')
  })
})
```

`ref-picker-dialog.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RefPickerDialog } from './ref-picker-dialog.jsx'

afterEach(cleanup)

const prompt = {
  type: 'prompt', id: 'p2', kind: 'ref', title: 'Branch for orders',
  ref: {
    name: 'orders', current: 'main',
    worktrees: [{ path: 'C:\\w\\main', ref: 'main', display: 'main', folder: 'main', current: true }, { path: 'C:\\w\\fx', ref: 'feature/x', display: 'feature/x', folder: 'fx', current: false }],
    remotes: ['origin/feature-y', 'origin/release-1'],
  },
}

describe('RefPickerDialog', () => {
  it('answers a worktree by index', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: /feature\/x/ }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'worktree', index: 1 })
  })
  it('filters and answers a remote branch', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.change(screen.getByLabelText('Filter remote branches'), { target: { value: 'release' } })
    expect(screen.queryByRole('button', { name: /origin\/feature-y/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /origin\/release-1/ }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'remote', name: 'origin/release-1' })
  })
  it('answers a typed ref, disabled while empty', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    expect(screen.getByRole('button', { name: 'Use' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Branch, tag or SHA'), { target: { value: ' v1.2.0 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'ref', value: 'v1.2.0' })
  })
  it('Cancel keeps the current branch', () => {
    const onAnswer = vi.fn()
    render(<RefPickerDialog prompt={prompt} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'cancel' })
  })
})
```

`prompt-host.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PromptHost } from './prompt-host.jsx'

afterEach(cleanup)

describe('PromptHost', () => {
  it('routes plan, ref and other kinds to their dialogs', () => {
    const { unmount } = render(<PromptHost prompt={{ id: 'p1', kind: 'plan', title: 'Plan title', plan: { locked: true, services: [], backups: [], testApis: [] } }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    unmount()
    const r2 = render(<PromptHost prompt={{ id: 'p2', kind: 'ref', title: 'Branch', ref: { name: 'a', worktrees: [], remotes: [] } }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Branch, tag or SHA')).toBeTruthy()
    r2.unmount()
    render(<PromptHost prompt={{ id: 'p3', kind: 'text', title: 'Name?', prompt: 'Name?' }} onAnswer={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
  })
})
```

Add one test to `devenv-run-context.test.jsx` (it uses that file's existing fake adapter and the `P = '@@devenv '` constant pattern): a `plan` prompt line arriving through the adapter renders the plan dialog's **Start** button, and clicking it calls `adapter.answer(runId, { id: 'p1', value: expect.objectContaining({ action: 'start' }) })`.

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `plan-dialog.jsx`**

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { createPlanForm, validatePlanForm, buildPlanAnswer } from '@nexusmd/core'

const field = { padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const section = { display: 'flex', flexDirection: 'column', gap: 6 }
const heading = { fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 6 }
const mb = n => `${Math.max(1, Math.round((n || 0) / 1048576))} MB`

function Radio({ name, value, current, label, disabled, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 8, opacity: disabled ? 0.6 : 1 }}>
      <input type="radio" name={name} checked={current === value} disabled={disabled} aria-label={label} onChange={() => onChange(value)} />
      <span>{label}</span>
    </label>
  )
}

// The devenv start plan as a form. Every way out answers with devplan's result format, so
// devenv's own start loop decides what happens next (start, re-plan after a branch change,
// or "Cancelled - nothing was started").
export function PlanDialog({ prompt, onAnswer }) {
  const plan = prompt.plan || {}
  const [form, setForm] = React.useState(() => createPlanForm(plan))
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const blocked = validatePlanForm(plan, form)
  const answer = action => onAnswer(buildPlanAnswer(form, action))
  const restoring = form.database === 'restore' || form.database === 'wipe'

  const footer = (
    <>
      {blocked && <span style={{ color: 'var(--danger)', marginRight: 'auto' }}>{blocked}</span>}
      <button className="btn ghost" onClick={() => answer('cancel')}>Cancel</button>
      <button className="btn primary" disabled={!!blocked} onClick={() => answer('start')}>Start</button>
    </>
  )

  return (
    <PlModal open wide closeOnBackdrop={false} onClose={() => answer('cancel')} icon="build" title={prompt.title || 'Start'} sub={plan.dockerApis ? `Always: local SQL, cloud emulators and ${plan.dockerApis}` : undefined} footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!plan.locked && <div role="alert" style={{ color: 'var(--danger)' }}>{plan.lockError || 'A ref did not resolve.'}</div>}

        <div style={section}>
          <div style={heading}>Sources</div>
          {(plan.services || []).map(s => (
            <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px 170px auto', gap: 8, alignItems: 'center' }}>
              <strong>{s.label}</strong>
              <span>{`${s.branch && s.branch !== 'unknown' ? s.branch : s.ref}${s.dirty ? '*' : ''}`}</span>
              <code>{(s.sha || '????????').slice(0, 8)}</code>
              <select aria-label={`Build ${s.label}`} style={field} value={form.services[s.key]} onChange={e => set({ services: { ...form.services, [s.key]: e.target.value } })}>
                <option value="skip">{s.built ? 'Skip (already built)' : 'Skip'}</option>
                <option value="build">Build</option>
                <option value="clean">Clean rebuild</option>
              </select>
              <button className="btn sm ghost" onClick={() => answer(`change-ref:${s.key}`)}>Change branch…</button>
            </div>
          ))}
        </div>

        <div style={section} role="radiogroup" aria-label="Database">
          <div style={heading}>Database</div>
          <Radio name="db" value="asis" current={form.database} label="Leave the data as it is" onChange={v => set({ database: v })} />
          <Radio name="db" value="restore" current={form.database} label="Restore a saved baseline" onChange={v => set({ database: v })} />
          <Radio name="db" value="wipe" current={form.database} label="Wipe the SQL volume, then restore a baseline" onChange={v => set({ database: v })} />
          <Radio name="db" value="remote" current={form.database} label="Use the remote DEV database (shared — changes are real)" onChange={v => set({ database: v })} />
          {restoring && (
            <select aria-label="Baseline" style={field} value={form.baseline || ''} onChange={e => set({ baseline: e.target.value })}>
              {(plan.backups || []).map(b => <option key={b.id} value={b.id}>{`${b.id} (${mb(b.size)})${b.isLatest ? ' — latest' : ''}`}</option>)}
            </select>
          )}
          {form.database === 'wipe' && (
            <input aria-label="Type YES to wipe" placeholder="YES" style={field} value={form.wipeConfirm} onChange={e => set({ wipeConfirm: e.target.value })} />
          )}
        </div>

        <div style={section} role="radiogroup" aria-label="Test stack">
          <div style={heading}>Test stack</div>
          {plan.testError && <div style={{ color: 'var(--text-muted)' }}>{plan.testError}</div>}
          <Radio name="test" value="off" current={form.test} label="Leave it alone" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          <Radio name="test" value="up" current={form.test} label="Start APIs behind the tracer" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          <Radio name="test" value="run" current={form.test} label="Start them, then run the Bruno collection" disabled={!!plan.testError} onChange={v => set({ test: v })} />
          {!plan.testError && (plan.testApis || []).map(t => (
            <label key={t.key} style={{ display: 'flex', gap: 8, marginLeft: 22 }}>
              <input type="checkbox" checked={form.testServices.includes(t.key)}
                onChange={e => set({ testServices: e.target.checked ? [...form.testServices, t.key] : form.testServices.filter(k => k !== t.key) })} />
              <span>{`${t.label} :${t.port}`}</span>
            </label>
          ))}
        </div>

        <div style={section}>
          <div style={heading}>Android</div>
          <label style={{ display: 'flex', gap: 8 }}>
            <input type="checkbox" aria-label="Start the Android emulator" checked={form.emulator} onChange={e => set({ emulator: e.target.checked })} />
            <span>Start the Android emulator (through mitmproxy)</span>
          </label>
        </div>

        <div style={section} role="radiogroup" aria-label="iOS">
          <div style={heading}>iOS</div>
          {plan.macError && <div style={{ color: 'var(--text-muted)' }}>{plan.macError}</div>}
          <Radio name="ios" value="off" current={form.ios} label="Leave it alone" onChange={v => set({ ios: v })} />
          <Radio name="ios" value="run" current={form.ios} label="Build, then run on the simulator" disabled={!!plan.macError} onChange={v => set({ ios: v })} />
          <Radio name="ios" value="build" current={form.ios} label="Build only" disabled={!!plan.macError} onChange={v => set({ ios: v })} />
        </div>
      </div>
    </PlModal>
  )
}
```

(`Radio`'s `aria-label` repeats the visible label so `getByLabelText` finds the input directly. The "Leave it alone" label appears twice, once for Test stack and once for iOS. Tests that need one of them scope by group, e.g. `within(screen.getByRole('radiogroup', { name: 'iOS' }))`.)

- [ ] **Step 4: Implement `ref-picker-dialog.jsx`**

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { normaliseRefPrompt } from '@nexusmd/core'

const field = { width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const heading = { fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 6 }

// devenv's branch picker: an existing worktree, a remote branch (devenv creates a worktree
// for it), or any ref. Closing it keeps the current branch, as Enter does in the terminal.
export function RefPickerDialog({ prompt, onAnswer }) {
  const ref = normaliseRefPrompt(prompt)
  const [filter, setFilter] = React.useState('')
  const [typed, setTyped] = React.useState('')
  const q = filter.trim().toLowerCase()
  const remotes = ref.remotes.filter(r => !q || r.toLowerCase().includes(q))
  const cancel = () => onAnswer({ kind: 'cancel' })

  return (
    <PlModal open closeOnBackdrop={false} onClose={cancel} icon="build" title={prompt.title || `Branch for ${ref.name}`} sub={`Currently ${ref.current}`}
      footer={<button className="btn ghost" onClick={cancel}>Cancel</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={heading}>Worktrees</div>
        {ref.worktrees.map((w, i) => (
          <button key={w.path} className="btn ghost sm" style={{ textAlign: 'left' }} onClick={() => onAnswer({ kind: 'worktree', index: i })}>
            {`${w.display}  (${w.folder})${w.current ? ' — current' : ''}`}
          </button>
        ))}
        {!ref.worktrees.length && <div style={{ color: 'var(--text-muted)' }}>No worktrees found.</div>}

        <div style={heading}>Remote branches</div>
        <input aria-label="Filter remote branches" placeholder="Filter remote branches" value={filter} onChange={e => setFilter(e.target.value)} style={field} />
        <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {remotes.map(r => (
            <button key={r} className="btn ghost sm" style={{ textAlign: 'left' }} title="Creates a new worktree" onClick={() => onAnswer({ kind: 'remote', name: r })}>
              {`${r} — creates a new worktree`}
            </button>
          ))}
        </div>

        <div style={heading}>Other ref</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input aria-label="Branch, tag or SHA" placeholder="Branch, tag or SHA" value={typed} onChange={e => setTyped(e.target.value)} style={field} />
          <button className="btn" disabled={!typed.trim()} onClick={() => onAnswer({ kind: 'ref', value: typed.trim() })}>Use</button>
        </div>
      </div>
    </PlModal>
  )
}
```

- [ ] **Step 5: Implement `prompt-host.jsx` and use it in the provider**

```jsx
import React from 'react'
import { PromptDialog } from './prompt-dialog.jsx'
import { PlanDialog } from './plan-dialog.jsx'
import { RefPickerDialog } from './ref-picker-dialog.jsx'

// Plan and branch prompts answer with an object and close by answering (never by a protocol
// cancel), so only the plain kinds get onCancel. Callers pass key={prompt.id}.
export function PromptHost({ prompt, onAnswer, onCancel }) {
  if (prompt.kind === 'plan') return <PlanDialog prompt={prompt} onAnswer={onAnswer} />
  if (prompt.kind === 'ref') return <RefPickerDialog prompt={prompt} onAnswer={onAnswer} />
  return <PromptDialog prompt={prompt} onAnswer={onAnswer} onCancel={onCancel} />
}
```

In `devenv-run-context.jsx`, replace the `PromptDialog` import with `import { PromptHost } from './prompt-host.jsx'`, and replace the `<PromptDialog ... />` element with:

```jsx
        <PromptHost key={prompt.id} prompt={prompt}
          onAnswer={v => run.answer(prompt.id, v)}
          onCancel={() => run.cancelPrompt(prompt.id)} />
```

- [ ] **Step 6: Run tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): devenv start plan form and branch picker"
```

---

### Task 7: Status hook and Status tab

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/use-devenv-status.js`, `status-view.jsx`
- Test: `apps/desktop/src/views/devenv/use-devenv-status.test.jsx`, `status-view.test.jsx`

**Interfaces:**
- Consumes: `adapter.query` (Task 4); `normaliseStatus` (Task 5); the run context (`useDevenvRunContext()` → `{ state, start, config, ... }`); `RunPanel`.
- Produces:
  - `useDevenvStatus({ adapter, config, runStatus, intervalMs = 10000 })` → `{ status: StatusView|null, error: string|null, loading: boolean, refresh(): Promise<void> }`. It queries `['status', '--json']` on mount, then every `intervalMs` while `document.visibilityState === 'visible'`. It queries again whenever `runStatus` changes from `starting`/`running` to anything else. It sets `error` when the query rejects or returns no status result: the message, or `devenv status returned nothing (exit <code>). <stderr>`.
  - `StatusView({ adapter, onStart })`: cards plus actions. `onStart()` switches to the Start tab.

**Status view:**
- A header row: "Updated hh:mm:ss" from `status.at`, and a **Refresh** button.
- A banner when `!status.docker.ok`: `Docker isn't running — <error>`. The cards are still rendered from whatever the status contains.
- Cards in a responsive grid. Each line shows a state dot (green running, grey stopped, faint missing) plus text:
  - **Backend:** one line per backend API, `<label> :<port>`. Under them, the infra services, e.g. "storage running".
  - **Database:** `SQL Server 127.0.0.1:14330`, `DB editor` (ui state), `Baseline <baseline or none>`.
  - **Test stack:** `Tracer`, then one line per test API `<label> :<port>`.
  - **Android:** `Emulator <serial> (<avd>)` when `emulator.running`, else `Emulator`, with the state from `running`; `mitmproxy :8888` (proxy state).
  - **iOS:** `Mac <host>` or the error.
- Actions:
  - **Start…** calls `onStart`.
  - **Stop** → `start(['stop'], { exclusive: true, label: 'devenv stop' })`.
  - **Backend up** → `start(['backend', 'up'], { exclusive: true, label: 'devenv backend up' })`.
  - **Backend down** → `start(['backend', 'down'], { exclusive: true, label: 'devenv backend down' })`.
  - **Doctor** → `start(['doctor'], { exclusive: false, label: 'devenv doctor' })`.
  All of them are disabled while the run's status is `starting`/`running`.
- `<RunPanel state={run.state} onCancel={run.cancel} />` below the cards whenever `run.state.status !== 'idle'`.

- [ ] **Step 1: Write the failing tests**

`use-devenv-status.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDevenvStatus } from './use-devenv-status.js'

afterEach(() => { cleanup(); vi.useRealTimers() })

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const statusResult = { type: 'result', kind: 'status', docker: { ok: true }, backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }] }
const adapterWith = impl => ({ query: vi.fn(impl) })

describe('useDevenvStatus', () => {
  it('queries status --json on mount', async () => {
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(a.query).toHaveBeenCalledWith(CFG, ['status', '--json'])
    expect(result.current.status.backend[0].state).toBe('running')
    expect(result.current.error).toBeNull()
  })

  it('polls on the interval while visible', async () => {
    vi.useFakeTimers()
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle', intervalMs: 1000 }))
    await act(async () => {})
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(a.query.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('refreshes when a run ends', async () => {
    const a = adapterWith(async () => ({ code: 0, results: [statusResult], stderr: '' }))
    const { rerender } = renderHook(p => useDevenvStatus({ adapter: a, config: CFG, runStatus: p }), { initialProps: 'running' })
    await act(async () => {})
    const before = a.query.mock.calls.length
    rerender('done')
    await act(async () => {})
    expect(a.query.mock.calls.length).toBe(before + 1)
  })

  it('reports a query that returns no status', async () => {
    const a = adapterWith(async () => ({ code: 1, results: [], stderr: 'No profile at C:\\x' }))
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(result.current.error).toBe('devenv status returned nothing (exit 1). No profile at C:\\x')
  })

  it('reports a rejected query', async () => {
    const a = adapterWith(async () => { throw new Error('devenv took too long to answer status --json') })
    const { result } = renderHook(() => useDevenvStatus({ adapter: a, config: CFG, runStatus: 'idle' }))
    await act(async () => {})
    expect(result.current.error).toMatch(/too long/)
  })
})
```

`status-view.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { StatusView } from './status-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))

afterEach(cleanup)

const full = {
  type: 'result', kind: 'status', at: '2026-10-12T10:00:00Z', docker: { ok: true, error: null },
  backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }],
  infra: [{ service: 'storage', state: 'running' }],
  database: { state: 'running', ui: 'missing', baseline: 'b1' },
  test: { tracer: 'stopped', apis: [{ key: 'orders', label: 'Orders API', port: 5201, state: 'stopped' }] },
  android: { emulator: { running: true, serial: 'emulator-5554', avd: 'devenv' }, proxy: 'running' },
  ios: { host: null, error: 'no mac.json' },
}

function setup({ result = full, runStatus = 'idle' } = {}) {
  const run = { state: { ...createRunState(), status: runStatus }, start: vi.fn(), cancel: vi.fn(), config: { root: 'C:\\r', pwsh: 'pwsh', profile: '' } }
  globalThis.__run = run
  const adapter = { query: vi.fn(async () => ({ code: 0, results: [result], stderr: '' })) }
  const onStart = vi.fn()
  return { run, adapter, onStart }
}

describe('StatusView', () => {
  it('renders the cards from the status', async () => {
    const { adapter, onStart } = setup()
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    expect(screen.getByText('Orders API :5101')).toBeTruthy()
    expect(screen.getByText('Baseline b1')).toBeTruthy()
    expect(screen.getByText('Emulator emulator-5554 (devenv)')).toBeTruthy()
    expect(screen.getByText('no mac.json')).toBeTruthy()
  })

  it('shows a banner when Docker is down', async () => {
    const { adapter, onStart } = setup({ result: { ...full, docker: { ok: false, error: 'Docker Desktop is not running' } } })
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    expect(screen.getByText("Docker isn't running — Docker Desktop is not running")).toBeTruthy()
  })

  it('runs actions through the provider run', async () => {
    const { run, adapter, onStart } = setup()
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(run.start).toHaveBeenCalledWith(['stop'], { exclusive: true, label: 'devenv stop' })
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))
    expect(run.start).toHaveBeenCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Start…' }))
    expect(onStart).toHaveBeenCalled()
  })

  it('disables actions while a run is active', async () => {
    const { adapter, onStart } = setup({ runStatus: 'running' })
    render(<StatusView adapter={adapter} onStart={onStart} />)
    await act(async () => {})
    for (const name of ['Start…', 'Stop', 'Backend up', 'Backend down', 'Doctor']) {
      expect(screen.getByRole('button', { name }).disabled).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/use-devenv-status.test.jsx src/views/devenv/status-view.test.jsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `use-devenv-status.js`**

```js
import React from 'react'
import { normaliseStatus } from '@nexusmd/core'

const ACTIVE = ['starting', 'running']

// Status comes from devenv:query, which never waits for the exclusive slot, so it keeps
// refreshing while start/stop run; it refreshes again the moment a run finishes.
export function useDevenvStatus({ adapter, config, runStatus, intervalMs = 10000 }) {
  const [status, setStatus] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  React.useEffect(() => () => { live.current = false }, [])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const r = await adapter.query(config, ['status', '--json'])
      const result = (r?.results || []).find(m => m.kind === 'status')
      if (!live.current) return
      if (result) { setStatus(normaliseStatus(result)); setError(null) }
      else setError(`devenv status returned nothing (exit ${r?.code}). ${r?.stderr || ''}`.trim())
    } catch (e) {
      if (live.current) setError(e?.message || 'devenv status failed')
    } finally {
      if (live.current) setLoading(false)
    }
  }, [adapter, config])

  React.useEffect(() => {
    refresh()
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [refresh, intervalMs])

  const prev = React.useRef(runStatus)
  React.useEffect(() => {
    if (ACTIVE.includes(prev.current) && !ACTIVE.includes(runStatus)) refresh()
    prev.current = runStatus
  }, [runStatus, refresh])

  return { status, error, loading, refresh }
}
```

- [ ] **Step 4: Implement `status-view.jsx`**

```jsx
import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvStatus } from './use-devenv-status.js'
import { RunPanel } from './run-panel.jsx'

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
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function StatusView({ adapter, onStart }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { status, error, loading, refresh } = useDevenvStatus({ adapter, config: run.config, runStatus: run.state.status })
  const go = (argv, exclusive) => run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  const emu = status?.android.emulator

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary sm" disabled={busy} onClick={onStart}>Start…</button>
        <button className="btn sm" disabled={busy} onClick={() => go(['stop'], true)}>Stop</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['backend', 'up'], true)}>Backend up</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['backend', 'down'], true)}>Backend down</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => go(['doctor'], false)}>Doctor</button>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {status?.at ? `Updated ${new Date(status.at).toLocaleTimeString()}` : ''}
        </span>
        <button className="btn sm ghost" disabled={loading} onClick={refresh}>Refresh</button>
      </div>

      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      {status && !status.docker.ok && (
        <div className="card" role="alert" style={{ padding: 10 }}>{`Docker isn't running — ${status.docker.error || 'no answer from docker'}`}</div>
      )}

      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          <Card title="Backend">
            {status.backend.map(b => <Line key={b.key} state={b.state}>{`${b.label} :${b.port}`}</Line>)}
            {status.infra.map(i => <Line key={i.service} state={i.state}>{i.service}</Line>)}
          </Card>
          <Card title="Database">
            <Line state={status.database.state}>SQL Server 127.0.0.1:14330</Line>
            <Line state={status.database.ui}>DB editor</Line>
            <div style={{ color: 'var(--text-muted)' }}>{`Baseline ${status.database.baseline || 'none'}`}</div>
          </Card>
          <Card title="Test stack">
            <Line state={status.test.tracer}>Tracer</Line>
            {status.test.apis.map(t => <Line key={t.key} state={t.state}>{`${t.label} :${t.port}`}</Line>)}
          </Card>
          <Card title="Android">
            <Line state={emu?.running ? 'running' : 'stopped'}>{emu?.running ? `Emulator ${emu.serial} (${emu.avd})` : 'Emulator'}</Line>
            <Line state={status.android.proxy}>mitmproxy :8888</Line>
          </Card>
          <Card title="iOS">
            {status.ios.host ? <div>{`Mac ${status.ios.host}`}</div> : <div style={{ color: 'var(--text-muted)' }}>{status.ios.error || 'No Mac configured'}</div>}
          </Card>
        </div>
      )}

      {run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): devenv Status tab"
```

---

### Task 8: Start tab, summary card and tabs

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/start-view.jsx`, `summary-card.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx`: tabs Status | Start | Commands, with the selected tab remembered
- Test: `apps/desktop/src/views/devenv/start-view.test.jsx`, `view-devenv.test.jsx`

**Interfaces:**
- Consumes: the run context; `normaliseSummary` (Task 5); `StatusView` (Task 7); `CommandsView`; `RunPanel`; `getProfileKey` (`apps/desktop/src/profile-keys.js`).
- Produces:
  - `SummaryCard({ result })`: renders `normaliseSummary(result)`. It shows the title, one block per section (heading + key/value rows, failed rows in danger colour) and the notes in muted text.
  - `StartView()`: an intro line ("Review the plan, then build and start the session."), a checkbox labelled `Use the remote DEV database`, and a **Start session…** button that calls `run.start(remote ? ['start', '--remote-db'] : ['start'], { exclusive: true, label: 'devenv start' })` and is disabled while busy. When the run's command is `devenv start` it shows `<RunPanel>` and, if `run.state.results` holds a `summary` result, the `<SummaryCard>` for the last one.
  - `DevenvView({ adapters })`: tabs `Status` (default), `Start` and `Commands`, rendered as buttons with `aria-pressed`. The selected tab is stored under `localStorage[getProfileKey('devenv.tab')]` (try/catch). `StatusView`'s `onStart` switches to Start. The leftover-runs banner stays above the tabs.

- [ ] **Step 1: Write the failing tests**

`start-view.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { StartView } from './start-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))

afterEach(cleanup)

const summary = { type: 'result', kind: 'summary', title: 'Session up', rows: [{ key: 'Backend', value: '' }, { key: 'Orders API', value: 'http://127.0.0.1:5101' }, { key: 'iOS', value: 'FAILED - ssh exit 255' }], notes: ['devenv status     devenv stop'] }

function setup(over = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn() }
  return globalThis.__run
}

describe('StartView', () => {
  it('starts devenv start, with --remote-db when ticked', () => {
    const run = setup()
    render(<StartView />)
    fireEvent.click(screen.getByRole('button', { name: 'Start session…' }))
    expect(run.start).toHaveBeenCalledWith(['start'], { exclusive: true, label: 'devenv start' })
    fireEvent.click(screen.getByLabelText('Use the remote DEV database'))
    fireEvent.click(screen.getByRole('button', { name: 'Start session…' }))
    expect(run.start).toHaveBeenLastCalledWith(['start', '--remote-db'], { exclusive: true, label: 'devenv start' })
  })

  it('is disabled while a run is active', () => {
    setup({ status: 'running', command: 'devenv stop' })
    render(<StartView />)
    expect(screen.getByRole('button', { name: 'Start session…' }).disabled).toBe(true)
  })

  it('shows the session summary from the start run', () => {
    setup({ status: 'done', command: 'devenv start', exitCode: 0, results: [summary] })
    render(<StartView />)
    expect(screen.getByText('Session up')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:5101')).toBeTruthy()
    expect(screen.getByText('FAILED - ssh exit 255')).toBeTruthy()
  })
})
```

`view-devenv.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./status-view.jsx', () => ({ StatusView: ({ onStart }) => <button onClick={onStart}>status-stub</button> }))
vi.mock('./start-view.jsx', () => ({ StartView: () => <div>start-stub</div> }))
vi.mock('./commands-view.jsx', () => ({ CommandsView: () => <div>commands-stub</div> }))

import { DevenvView } from './view-devenv.jsx'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), leftover: { runs: [], error: null, cancelAll: vi.fn() } }
})

const adapters = { devenv: { isAvailable: () => true } }

describe('DevenvView', () => {
  it('opens on Status and switches tabs', () => {
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('status-stub')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
  it('Start… on Status opens the Start tab', () => {
    render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByText('status-stub'))
    expect(screen.getByText('start-stub')).toBeTruthy()
  })
  it('remembers the tab', () => {
    const { unmount } = render(<DevenvView adapters={adapters} />)
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    unmount()
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByText('commands-stub')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/start-view.test.jsx src/views/devenv/view-devenv.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `summary-card.jsx` and `start-view.jsx`**

```jsx
// summary-card.jsx
import React from 'react'
import { normaliseSummary } from '@nexusmd/core'

export function SummaryCard({ result }) {
  const s = normaliseSummary(result)
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>{s.title}</strong>
      {s.sections.map((sec, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sec.heading && <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{sec.heading}</div>}
          {sec.rows.map(r => (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>{r.key}</span>
              <span style={r.failed ? { color: 'var(--danger)' } : undefined}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
      {s.notes.map(n => <div key={n} style={{ color: 'var(--text-muted)', fontSize: 12 }}>{n}</div>)}
    </div>
  )
}
```

```jsx
// start-view.jsx
import React from 'react'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { RunPanel } from './run-panel.jsx'
import { SummaryCard } from './summary-card.jsx'

const LABEL = 'devenv start'

// The plan itself is a dialog (devenv asks for it once the sources are resolved), so this
// tab only launches the run and shows where it got to.
export function StartView() {
  const run = useDevenvRunContext()
  const [remote, setRemote] = React.useState(false)
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const mine = run.state.command === LABEL && run.state.status !== 'idle'
  const summary = mine ? [...run.state.results].reverse().find(r => r.kind === 'summary') : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div>Review the plan, then build and start the session.</div>
      <label style={{ display: 'flex', gap: 8 }}>
        <input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} aria-label="Use the remote DEV database" />
        <span>Use the remote DEV database (shared — changes are real)</span>
      </label>
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy}
        onClick={() => run.start(remote ? ['start', '--remote-db'] : ['start'], { exclusive: true, label: LABEL })}>Start session…</button>
      {summary && <SummaryCard result={summary} />}
      {mine && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

- [ ] **Step 4: Tabs in `view-devenv.jsx`**

Keep `LeftoverRunsBanner` unchanged. Replace the phase-1 comment and `DevenvView` with:

```jsx
import { getProfileKey } from '../../profile-keys.js'
import { StatusView } from './status-view.jsx'
import { StartView } from './start-view.jsx'

const TABS = ['Status', 'Start', 'Commands']
const tabKey = () => getProfileKey('devenv.tab')

function useTab() {
  const [tab, setTab] = React.useState(() => {
    try { const t = localStorage.getItem(tabKey()); return TABS.includes(t) ? t : 'Status' } catch { return 'Status' }
  })
  const choose = t => { setTab(t); try { localStorage.setItem(tabKey(), t) } catch {} }
  return [tab, choose]
}

// Builds, Logs, Tests, Database, Emulator, Mac and Profile tabs join these in later phases
// (docs/superpowers/specs/2026-10-08-devenv-module-design.md).
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  const run = useDevenvRunContext()
  const [tab, setTab] = useTab()
  if (!adapter?.isAvailable() || !run) return <div style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Dev Environment</h2>
      <LeftoverRunsBanner leftover={run.leftover} />
      <div style={{ display: 'flex', gap: 6 }}>
        {TABS.map(t => (
          <button key={t} className={`btn sm ${tab === t ? '' : 'ghost'}`} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Status' && <StatusView adapter={adapter} onStart={() => setTab('Start')} />}
      {tab === 'Start' && <StartView />}
      {tab === 'Commands' && <CommandsView adapter={adapter} picker={pickerAdapter} />}
    </div>
  )
}
```

(The hook must run before the early return, so call `useTab()` before the `if`, as shown.)

- [ ] **Step 5: Run the desktop suite**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`
Expected: all PASS. `jira-create-form.test.jsx` is a known flake: re-run it alone if it fails on its own.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): devenv Start tab, session summary and tabs"
```

---

### Task 9: End-to-end check and spec amendments

**Repository:** both

**Files:**
- Modify: `C:\repos\NexusMD-Mono\docs\superpowers\specs\2026-10-08-devenv-module-design.md` (add a `## Amendments made during Phase 2 planning` section)

- [ ] **Step 1: Spec amendments**

Append:

```markdown
## Amendments made during Phase 2 planning

- Status comes from `devenv status --json` (one `result` line) through a read-only, allowlisted `devenv:query` IPC that never takes the exclusive slot; the text `devenv status` is unchanged.
- The plan and branch prompts are kinds `plan` and `ref`, answered with devplan's existing result objects through `Request-DevenvDecision`; closing either dialog answers (plan: `action: 'cancel'`; ref: `kind: 'cancel'`) rather than cancelling the run.
- The plan form and branch picker are dialogs rendered by the run provider (so they appear on any screen); the Start tab launches the run and shows its progress and summary.
- Status, Start and Commands are the Dev Environment tabs in this phase; Status is the default.
```

Commit:

```bash
git add docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "docs: record Phase 2 amendments to the devenv module spec"
```

- [ ] **Step 2: Headless end-to-end check (throwaway script in the session scratchpad, nothing committed)**

As in phase 1, drive `apps/desktop/electron/ipc/devenv.cjs` from a Node script. Use the real `spawn`, a fake `ipcMain` and config `{ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }`:
1. `devenv:query ['status','--json']` → one `status` result; print `docker.ok`, the backend states, and that the call took under 30 s.
2. `devenv:run ['start']` → wait for the first `@@devenv` `plan` prompt; print `locked`, the service keys and the backup count. Answer `{ id, value: { action: 'change-ref:<first service key>', ...same choices } }`. Expect a `ref` prompt; print its `worktrees` count and `current`. Answer `{ kind: 'cancel' }`. Expect a second `plan` prompt; answer `{ action: 'cancel', ... }`. Expect output containing `Cancelled - nothing was started.` and exit 0.
3. While step 2 is waiting on its first prompt, call `devenv:query` again. It must return without waiting.

Do not answer `start`: that would build and start the user's environment.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment opens | Status tab, cards filled within a few seconds, "Updated …" ticking every ~10 s |
| 2 | Quit Docker Desktop, wait 10 s | Banner "Docker isn't running — …" |
| 3 | Start… → Start session… | Plan dialog with sources, database, test stack, Android, iOS |
| 4 | Change branch… on a source → pick another worktree | Plan dialog returns showing the new branch |
| 5 | Wipe | Start disabled until YES typed |
| 6 | Start with defaults | Progress bar, output, then the Session up card; Status refreshes when done |
| 7 | Stop from Status | Runs; cards go grey after it finishes |
| 8 | Navigate to another screen during start; come back | Run and output still there; a prompt that arrived meanwhile is shown |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite.
