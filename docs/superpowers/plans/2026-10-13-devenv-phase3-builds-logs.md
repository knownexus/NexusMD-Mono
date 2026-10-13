# Dev Environment Module — Phase 3 (Builds + Logs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new Dev Environment tabs.
- **Builds** shows what each API and the mobile app was last built from, and builds or clean-rebuilds any of them.
- **Logs** shows build logs, follows container logs live with a filter and level highlighting, and captures a log snapshot folder.

**Architecture:** devenv gains two read-only data commands, each emitting one `result` line in host mode:
- `devenv build status --json` (kind `builds`), built from the `build-commit.txt` stamps devenv already writes;
- `devenv logs targets --json` (kind `log-targets`). devenv owns the mapping from each log to the argv that shows it.

devenv also gains:
- a `--clean` switch on `build <api>` and `build apis`;
- a `capture` result from `logs capture`.

NexusMD gains:
- both queries in the `devenv:query` allowlist;
- a generic query hook, which the status hook becomes a thin wrapper over;
- core normalisers and argv builders;
- a Builds tab that uses the provider's single run;
- a Logs tab that owns a second, non-exclusive run. That run is cancelled when the tab is left or the target changes.

**Tech Stack:** PowerShell 7.6 + Pester 6 (devenv); Electron 43 CJS main, React 18, Vitest 4 + Testing Library (no jest-dom) in NexusMD.

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 3 — Screens → Builds, Logs — plus its Amendments). Earlier plans for reference: `docs/superpowers/plans/2026-10-08-devenv-phase1-foundation.md`, `docs/superpowers/plans/2026-10-12-devenv-phase2-status-start.md`.

**Two repositories.** Task 1 changes `C:\repos\dev-environment` (branch `feature/nexusmd-builds-logs`). Tasks 2–5 change `C:\repos\NexusMD-Mono` (branch `feature/devenv-builds-logs`). Task 6 spans both.

## Global Constraints

- With `DEVENV_HOST` unset, devenv's terminal behaviour stays exactly as today, apart from the new commands and switch. Every existing command keeps its output and arguments.
- Control lines: `@@devenv ` followed by compact JSON. Protocol version stays `1`; the new result kinds are additive.
- New result kinds (exact shapes in Task 1):
  - `builds`: `{ kind: 'builds', at, items: [{ key, label, kind: 'api'|'mobile', source, built, upToDate, error, log, mode, ios }] }`
  - `log-targets`: `{ kind: 'log-targets', targets: [{ group: 'build'|'emulator'|'backend'|'test', key, label, argv: string[], follow: bool }] }`
  - `capture`: `{ kind: 'capture', path }`
- `devenv:query` accepts exactly these three argv and nothing else: `['status','--json']`, `['build','status','--json']`, `['logs','targets','--json']`.
- Build actions (`build <api> [--clean]`, `build apis [--clean]`, `build mobile …`, `build ios …`, `app install`) go through the provider's single run with `exclusive: true`. Their buttons are disabled while that run is starting or running.
- Log viewing (`logs show <x>`, `backend logs <svc>`, `test logs <svc>`, `logs capture`) runs in the Logs tab's own run with `exclusive: false`. Only one log run at a time: a new one cancels the previous one first, and leaving the tab cancels it.
- Run labels are `devenv ${argv.join(' ')}`.
- NexusMD code style: ESM without semicolons in `src/` and `packages/`; CommonJS with semicolons in `electron/*.cjs`. devenv code style: compact PowerShell as in the existing files. Comments explain why, never what.
- Desktop tests always run with `NODE_OPTIONS=--no-experimental-webstorage` (this machine runs Node 26). Pester runs as `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester <path> -Output Detailed"` from `C:\repos\dev-environment`. JS test strings keep Windows paths escaped (`'C:\\x'`).

## Review Focus

1. **Idle hook buffers.** A log follow streams lines while the provider's run hook is idle. Before any `start()`, `useDevenvRun` must drop other runs' lines, not buffer them forever. Pinned in Task 2: lines emitted before `start()` are not replayed and not kept.
2. **Leaving a log follow.** Leaving the Logs tab, or picking another target while following, must cancel the `docker compose logs -f` tree. Pinned in Task 5: unmount calls `cancel`, and a target switch calls `cancel` before the new `run`.
3. **A profile without a mobile repo or test APIs.** The Builds tab hides the Mobile and iOS sections. Logs has no Test stack group. Pinned in Task 1 (Pester: no test APIs → no `test` targets) and Task 4 (no mobile item → no Mobile section).
4. **A missing source worktree.** `build status --json` still exits 0, with `error` set on that item. The Builds row shows the error instead of a commit. Pinned in Task 1 (Pester) and Task 4.
5. **Filter text with regex characters** (`[`, `(`, `.`) matches literally, and ANSI codes never match. Pinned in Task 3.

---

### Task 1: devenv — `build status`, `--clean`, `logs targets`, capture result

**Repository:** `C:\repos\dev-environment`, branch `feature/nexusmd-builds-logs` (create from `master`).

**Files:**
- Create: `build-common.ps1` (pure `ConvertTo-DevenvBuilds`, reader `Get-DevenvBuildInput`)
- Create: `build-status.ps1` (text table or `--json` result)
- Create: `logs-common.ps1` (pure `ConvertTo-DevenvLogTargets`)
- Modify: `launcher-common.ps1`:
  - move `Get-ServiceProjectDir` and `Clear-ProjectBuildOutput` here from `session.ps1`;
  - add `$DevEnvInfraServices` and `$DevEnvTestInfraServices`.
- Modify: `session.ps1` (delete the two moved functions, around lines 636–656)
- Modify: `build-api.ps1` (`-Clean`)
- Modify: `devenv.ps1`:
  - new `build status` and `logs targets` entries;
  - `--clean` on `build apis` and on each `build <api>`.
- Modify: `logs.ps1` (`targets`, `-Json`, capture result)
- Modify: `docker.ps1:35` (use `$DevEnvInfraServices`)
- Modify: `test.ps1` (the `Logs` error message uses `$DevEnvTestInfraServices`)
- Modify: `README.md` ("Running under NexusMD" section)
- Test: `tests/builds.Tests.ps1`, `tests/logs.Tests.ps1`, `tests/catalog.Tests.ps1`

**Interfaces:**
- Consumes: `Write-DevenvEvent`, `Test-DevenvHost` (`host-common.ps1`); `Get-DevEnvConfig`, `Get-DevEnvServices` (`launcher-common.ps1`).
- Produces, all for Task 2 onwards:
  - `devenv build status --json` → one line: `@@devenv {"type":"result","kind":"builds","at":ISO,"items":[…]}`. Each item is:
    - `key`, `label`;
    - `kind` (`'api'|'mobile'`);
    - `source`: `{branch,commit,dirty}|null`;
    - `built`: `{commit,dirty,at}|null`;
    - `upToDate` (bool);
    - `error` (`string|null`);
    - `log` (`string|null`, an absolute path);
    - `mode`: `{deploy,abi}|null`;
    - `ios`: `{commit,dirty,at}|null`.
  - `devenv logs targets --json` → one line, kind `log-targets`.
  - `logs capture` in host mode → `result` `{kind:'capture',path}`.
  - `devenv build <api> --clean` and `devenv build apis --clean`.

- [ ] **Step 1: Create the branch**

```bash
cd /c/repos/dev-environment && git checkout master && git checkout -b feature/nexusmd-builds-logs
```

- [ ] **Step 2: Write the failing Pester tests for builds**

Create `tests/builds.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'host-common.ps1')
 . (Join-Path $root 'build-common.ps1')
}

Describe 'ConvertTo-DevenvBuilds' {
 It 'is up to date only when a clean worktree matches a clean build' {
  $r=ConvertTo-DevenvBuilds -Items @(
   @{Key='orders';Label='Orders';Kind='api';Branch='main';Commit='abc123';Dirty=$false;Stamp='abc123';StampAt='2026-10-13T09:00:00.0000000Z'}
   @{Key='billing';Label='Billing';Kind='api';Branch='main';Commit='def456';Dirty=$true;Stamp='def456';StampAt='2026-10-13T09:00:00.0000000Z'}
   @{Key='stock';Label='Stock';Kind='api';Branch='dev';Commit='111';Dirty=$false;Stamp='000';StampAt='2026-10-13T09:00:00.0000000Z'}
  )
  $r.kind | Should -Be 'builds'
  $r.items.upToDate | Should -Be @($true,$false,$false)
  $r.items[0].source.branch | Should -Be 'main'
  $r.items[0].built.commit | Should -Be 'abc123'
  $r.items[0].built.at | Should -Be '2026-10-13T09:00:00.0000000Z'
 }
 It 'splits a dirty stamp into its commit and dirty flag, never up to date' {
  $r=ConvertTo-DevenvBuilds -Items @(@{Key='orders';Label='Orders';Kind='api';Branch='main';Commit='abc';Dirty=$false;Stamp='abc+dirty-20261013090000';StampAt='2026-10-13T09:00:00.0000000Z'})
  $r.items[0].built.commit | Should -Be 'abc'
  $r.items[0].built.dirty | Should -BeTrue
  $r.items[0].upToDate | Should -BeFalse
 }
 It 'reports never built and a missing worktree without failing' {
  $r=ConvertTo-DevenvBuilds -Items @(
   @{Key='orders';Label='Orders';Kind='api';Branch='main';Commit='abc';Dirty=$false}
   @{Key='mobile';Label='Mobile';Kind='mobile';Error='Source worktree missing: C:\x'}
  )
  $r.items[0].built | Should -BeNullOrEmpty
  $r.items[0].upToDate | Should -BeFalse
  $r.items[1].source | Should -BeNullOrEmpty
  $r.items[1].error | Should -Be 'Source worktree missing: C:\x'
 }
 It 'carries the mobile build mode and the last iOS build' {
  $r=ConvertTo-DevenvBuilds -Items @(@{Key='mobile';Label='Mobile';Kind='mobile';Branch='main';Commit='abc';Dirty=$false;Mode=@{deploy='full';abi='android-arm64'};IosStamp='abc';IosAt='2026-10-13T10:00:00.0000000Z'})
  $r.items[0].mode.deploy | Should -Be 'full'
  $r.items[0].mode.abi | Should -Be 'android-arm64'
  $r.items[0].ios.commit | Should -Be 'abc'
  $r.items[0].ios.at | Should -Be '2026-10-13T10:00:00.0000000Z'
 }
}

Describe 'Get-DevenvBuildInput' {
 BeforeAll {
  $work=Join-Path $TestDrive 'work'; $dev=Join-Path $TestDrive 'devroot'
  New-Item -ItemType Directory $work,$dev | Out-Null
  & git -C $work init -q; & git -C $work config user.email t@t; & git -C $work config user.name t
  Set-Content (Join-Path $work 'a.txt') 'a'; & git -C $work add .; & git -C $work commit -qm one
  $script:sha=((& git -C $work rev-parse HEAD) -join '').Trim()
  $script:cfg=@{repositories=[ordered]@{
   orders=@{source='../work';kind='api';label='Orders';project='x.csproj'}
   gone=@{source='../nope';kind='api';label='Gone';project='x.csproj'}
   site=@{source='../work';kind='web';label='Site';project='x.csproj'}
  }}
  $art=Join-Path $dev '.local/launcher/artifacts/orders'; New-Item -ItemType Directory $art -Force | Out-Null
  Set-Content (Join-Path $art 'build-commit.txt') $script:sha
 }
 It 'reads api and mobile repos only, with git state and the build stamp' {
  $items=@(Get-DevenvBuildInput -Config $script:cfg -Root $dev)
  $items.Key | Should -Be @('orders','gone')
  $items[0].Commit | Should -Be $script:sha
  $items[0].Dirty | Should -BeFalse
  $items[0].Stamp | Should -Be $script:sha
  $items[0].StampAt | Should -Match '^\d{4}-\d\d-\d\dT'
  $items[1].Error | Should -Match 'Source worktree missing'
 }
 It 'sees uncommitted changes' {
  Set-Content (Join-Path $work 'a.txt') 'changed'
  (@(Get-DevenvBuildInput -Config $script:cfg -Root $dev))[0].Dirty | Should -BeTrue
 }
}

Describe 'Clear-ProjectBuildOutput' {
 It 'deletes only bin and obj in the project folder' {
  $dev=Join-Path $TestDrive 'dev2'; $proj=Join-Path $TestDrive 'repo2/src/App'
  New-Item -ItemType Directory $dev,"$proj/bin/Debug","$proj/obj",(Join-Path $proj 'Keep') -Force | Out-Null
  $cfg=@{repositories=@{orders=@{source='../repo2';project='src/App/App.csproj'}}}
  . (Join-Path $root 'launcher-common.ps1')
  Clear-ProjectBuildOutput 'orders' -Config $cfg -Root $dev
  Test-Path "$proj/bin" | Should -BeFalse
  Test-Path "$proj/obj" | Should -BeFalse
  Test-Path "$proj/Keep" | Should -BeTrue
 }
}

Describe 'devenv build status --json' {
 It 'prints one builds result and exits 0 even when worktrees are missing' {
  $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
  try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') build status --json); $code=$LASTEXITCODE }
  finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  $code | Should -Be 0
  $lines.Count | Should -Be 1
  $r=$lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'builds'
  $r.items.key | Should -Be @('orders','mobile')
  $r.items[0].error | Should -Match 'Source worktree missing'
 }
}
```

`Clear-ProjectBuildOutput` and `Get-ServiceProjectDir` gain optional `-Config` and `-Root` parameters. These default to `Get-DevEnvConfig` and `$PSScriptRoot`, so `session.ps1`'s existing calls, which pass only the name, keep working. The Pester test dot-sources `launcher-common.ps1` inside the `It`. That sets `DEVENV_ROOT` but does not need a profile: its `Get-DevEnvProfileDir` call sits in a `try`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/builds.Tests.ps1 -Output Detailed"`
Expected: FAIL — `build-common.ps1` not found.

- [ ] **Step 4: Implement `build-common.ps1`**

```powershell
#requires -Version 7.0
# What each API and the mobile app was last built from, as data for NexusMD's Builds tab
# (devenv build status --json). The conversion is pure; Get-DevenvBuildInput does the reading.

function Split-DevenvBuildStamp([string]$Stamp) {
 # build-commit.txt holds the commit, or "<commit>+dirty-<time>" for a build of uncommitted files.
 if (!$Stamp) { return $null }
 $s=$Stamp.Trim()
 if ($s -match '^(?<c>[^+]+)\+dirty-') { return @{commit=$Matches.c;dirty=$true} }
 return @{commit=$s;dirty=$false}
}

function ConvertTo-DevenvBuilds([object[]]$Items=@()) {
 [ordered]@{
  kind='builds'; at=(Get-Date).ToUniversalTime().ToString('o')
  items=@(foreach ($i in $Items) {
   $source=if ($i['Error']) { $null } else { [ordered]@{ branch=$i['Branch']; commit=$i['Commit']; dirty=[bool]$i['Dirty'] } }
   $b=Split-DevenvBuildStamp $i['Stamp']
   $built=if ($b) { [ordered]@{ commit=$b.commit; dirty=$b.dirty; at=$i['StampAt'] } } else { $null }
   $ios=Split-DevenvBuildStamp $i['IosStamp']
   [ordered]@{
    key=$i['Key']; label=$i['Label']; kind=$i['Kind']
    source=$source; built=$built
    # Same rule as the start plan: a dirty worktree always needs a build.
    upToDate=[bool]($source -and $built -and !$source.dirty -and !$built.dirty -and $built.commit -eq $source.commit)
    error=$(if ($i['Error']) { [string]$i['Error'] } else { $null })
    log=$(if ($i['Log']) { [string]$i['Log'] } else { $null })
    mode=$(if ($i['Mode']) { [ordered]@{ deploy=$i['Mode']['deploy']; abi=$i['Mode']['abi'] } } else { $null })
    ios=$(if ($ios) { [ordered]@{ commit=$ios.commit; dirty=$ios.dirty; at=$i['IosAt'] } } else { $null })
   }
  })
 }
}

function Get-DevenvBuildInput {
 param([Parameter(Mandatory)]$Config,[Parameter(Mandatory)][string]$Root)
 $utc={ param($f) (Get-Item -LiteralPath $f).LastWriteTimeUtc.ToString('o') }
 foreach ($key in $Config.repositories.Keys) {
  $repo=$Config.repositories[$key]
  if ($repo['kind'] -notin @('api','mobile')) { continue }
  $i=@{ Key=$key; Label=$(if ($repo['label']) { $repo['label'] } else { $key }); Kind=$repo['kind'] }
  $art=Join-Path $Root ".local/launcher/artifacts/$key"
  $log=Join-Path $Root ".local/launcher/logs/$key.log"
  if (Test-Path -LiteralPath $log) { $i.Log=[IO.Path]::GetFullPath($log) }
  $stamp=Join-Path $art 'build-commit.txt'
  if (Test-Path -LiteralPath $stamp) { $i.Stamp=(Get-Content -LiteralPath $stamp -Raw); $i.StampAt=& $utc $stamp }
  $mode=Join-Path $art 'build-mode.json'
  if (Test-Path -LiteralPath $mode) { try { $i.Mode=Get-Content -LiteralPath $mode -Raw | ConvertFrom-Json -AsHashtable } catch { } }
  $ios=Join-Path $art 'ios-build-commit.txt'
  if (Test-Path -LiteralPath $ios) { $i.IosStamp=(Get-Content -LiteralPath $ios -Raw); $i.IosAt=& $utc $ios }
  $work=[IO.Path]::GetFullPath((Join-Path $Root $repo['source']))
  if (!(Test-Path -LiteralPath $work)) { $i.Error="Source worktree missing: $work"; $i; continue }
  $i.Commit=((& git -C $work rev-parse HEAD 2>$null) -join '').Trim()
  $i.Branch=((& git -C $work rev-parse --abbrev-ref HEAD 2>$null) -join '').Trim()
  $i.Dirty=@(& git -C $work status --porcelain 2>$null).Count -gt 0
  if (!$i.Commit) { $i.Error="Not a git worktree: $work" }
  $i
 }
}
```

- [ ] **Step 5: Move the clean helpers into `launcher-common.ps1`**

Delete `Get-ServiceProjectDir` and `Clear-ProjectBuildOutput` from `session.ps1`. Leave their call sites unchanged. Append to `launcher-common.ps1`:

```powershell
function Get-ServiceProjectDir([string]$Name,$Config,[string]$Root=$PSScriptRoot) {
 # The folder the project file lives in, inside the selected worktree.
 if (!$Config) { $Config=Get-DevEnvConfig }
 $repo=$Config.repositories[$Name]
 $work=[IO.Path]::GetFullPath((Join-Path $Root $repo['source']))
 return (Split-Path (Join-Path $work $repo['project']) -Parent)
}

function Clear-ProjectBuildOutput([string]$Name,$Config,[string]$Root=$PSScriptRoot) {
 # Builds happen in the worktree itself, so bin/ and obj/ live there (normally gitignored).
 # A clean rebuild deletes just those two folders for this one project - never anything
 # tracked, and never anything outside the project directory.
 $dir=Get-ServiceProjectDir $Name -Config $Config -Root $Root
 foreach ($sub in @('bin','obj')) {
  $target=Join-Path $dir $sub
  if (Test-Path $target) {
   Write-Host "   Deleting $target" -ForegroundColor DarkGray
   Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  }
 }
}

# Non-API services in the backend compose project and the API test stack (logs targets, docker.ps1, test.ps1).
$DevEnvInfraServices=@('storage','firestore','servicebus','servicebus-sql')
$DevEnvTestInfraServices=@('tracer','servicebus','storage','firestore')
```

Then:
- In `docker.ps1:35`, replace `$infraServices=@('storage','firestore','servicebus','servicebus-sql')` with `$infraServices=$DevEnvInfraServices`.
- In `test.ps1`'s `'Logs'` block, replace the inline `@('tracer','servicebus','storage','firestore')` with `$DevEnvTestInfraServices`.
- In `devenv.ps1`'s `backend logs` summary, replace the inline `@('storage','firestore','servicebus','servicebus-sql')` with `$DevEnvInfraServices`. `devenv.ps1` already dot-sources `launcher-common.ps1`.

- [ ] **Step 6: Implement `build-status.ps1`, `--clean`, and the catalog entries**

Create `build-status.ps1`:

```powershell
#requires -Version 7.0
# devenv build status: what each API and the mobile app was last built from (--json for NexusMD).
param([switch]$Json)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/launcher-common.ps1"
. "$PSScriptRoot/build-common.ps1"
$result=ConvertTo-DevenvBuilds -Items @(Get-DevenvBuildInput -Config (Get-DevEnvConfig) -Root $PSScriptRoot)
if ($Json) { Write-DevenvEvent result $result -Force; return }
$short={ param($c) if ($c -and $c.Length -gt 8) { $c.Substring(0,8) } else { $c } }
Write-Host ''
foreach ($i in $result.items) {
 $src=if ($i.error) { $i.error } else { "$($i.source.branch) $(& $short $i.source.commit)$(if ($i.source.dirty) { ' + uncommitted' })" }
 $built=if ($i.built) { "$(& $short $i.built.commit) $(([DateTime]$i.built.at).ToLocalTime().ToString('yyyy-MM-dd HH:mm'))" } else { 'never built' }
 $state=if ($i.upToDate) { 'up to date' } else { 'needs a build' }
 Write-Host ("  {0,-14} {1,-40} {2,-26} {3}" -f $i.label,$src,$built,$state) -ForegroundColor $(if ($i.upToDate) { 'Green' } else { 'Yellow' })
}
Write-Host ''
```

In `build-api.ps1`, change the param line to `param([Parameter(Mandatory)][string]$Service,[switch]$Clean)`. Then add, right after `$p=Get-LauncherProject $Service`:

```powershell
if ($Clean) { Clear-ProjectBuildOutput $Service }
```

In `devenv.ps1`'s command table:
- Add as the first `# --- build` entry:

```powershell
 @{G='build';V='status';A='';S='What each API and the mobile app was last built from';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'build-status.ps1' $n }}
```

- Change `build apis` to:

```powershell
 @{G='build';V='apis';A='';S='Build every API in the profile (--clean deletes bin/obj first)';Sw=@('clean');Val=@()
   Run={ param($a,$o) foreach ($s in $apiNames) { $n=@{Service=$s}; if ($o['clean']) { $n.Clean=$true }; Invoke-Script 'build-api.ps1' $n } }}
```

- Change the per-API entry inside `$perApi` to:

```powershell
 @{G='build';V=$svc.Key;A='';S="Build $($svc.Label) (--clean deletes bin/obj first)";Sw=@('clean');Val=@()
   Run={ param($a,$o) $n=@{Service=$command.V}; if ($o['clean']) { $n.Clean=$true }; Invoke-Script 'build-api.ps1' $n }}
```

- [ ] **Step 7: Run the builds tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/builds.Tests.ps1 -Output Detailed"`
Expected: PASS (all).

- [ ] **Step 8: Write the failing Pester tests for log targets and capture**

Create `tests/logs.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'logs-common.ps1')
}

Describe 'ConvertTo-DevenvLogTargets' {
 BeforeAll {
  $script:t=ConvertTo-DevenvLogTargets `
   -BuildLogs @(@{Key='orders';Label='Orders'},@{Key='mobile';Label='Mobile'}) `
   -Backend @(@{Key='orders';Label='Orders'}) -Infra @('storage','servicebus') `
   -TestApis @(@{Key='orders';Label='Orders'}) -TestInfra @('tracer')
 }
 It 'is a log-targets result' { $script:t.kind | Should -Be 'log-targets' }
 It 'lists build logs (not followed) first, then the emulator' {
  $b=@($script:t.targets | Where-Object group -eq 'build')
  $b.key | Should -Be @('orders','mobile')
  $b[0].label | Should -Be 'Orders build log'
  $b[0].argv | Should -Be @('logs','show','orders')
  $b[0].follow | Should -BeFalse
  ($script:t.targets | Where-Object group -eq 'emulator').argv | Should -Be @('logs','show','emulator')
 }
 It 'follows backend containers through backend logs' {
  $b=@($script:t.targets | Where-Object group -eq 'backend')
  $b.key | Should -Be @('orders','storage','servicebus')
  $b[0].argv | Should -Be @('backend','logs','orders')
  $b[0].follow | Should -BeTrue
 }
 It 'follows test-stack services through test logs' {
  $t=@($script:t.targets | Where-Object group -eq 'test')
  $t.key | Should -Be @('orders','tracer')
  $t[1].argv | Should -Be @('test','logs','tracer')
 }
 It 'has no test group when the profile has no test APIs' {
  $n=ConvertTo-DevenvLogTargets -BuildLogs @() -Backend @() -Infra @() -TestApis @() -TestInfra @('tracer')
  @($n.targets | Where-Object group -eq 'test').Count | Should -Be 0
 }
}

Describe 'devenv logs targets --json' {
 It 'prints one log-targets result and exits 0' {
  $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
  try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') logs targets --json); $code=$LASTEXITCODE }
  finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  $code | Should -Be 0
  $lines.Count | Should -Be 1
  $r=$lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'log-targets'
  ($r.targets | Where-Object { $_.group -eq 'test' }).key | Should -Contain 'tracer'
 }
}

Describe 'logs capture in host mode' {
 It 'emits a capture result naming the folder' {
  $src=Get-Content (Join-Path $root 'logs.ps1') -Raw
  $src | Should -Match "Write-DevenvEvent result @\{kind='capture';path=\`$out\}"
 }
}
```

The capture check is structural on purpose. A real capture calls docker and adb, and these tests must not need either.

Add to `tests/catalog.Tests.ps1`, inside `Describe 'devenv help --json'`:

```powershell
 It 'build status and logs targets are read-only and hide --json' {
  foreach ($c in @((Get-Cmd 'build' 'status'),(Get-Cmd 'logs' 'targets'))) {
   $c.mut | Should -BeFalse
   $c.switches | Should -Not -Contain 'json'
  }
 }
 It 'offers --clean on build apis and on each API build' {
  (Get-Cmd 'build' 'apis').switches | Should -Contain 'clean'
  (Get-Cmd 'build' 'orders').switches | Should -Contain 'clean'
 }
```

- [ ] **Step 9: Run them to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/logs.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL. `logs-common.ps1` is not found; `logs targets` is unknown; there are no catalog entries.

- [ ] **Step 10: Implement `logs-common.ps1`, `logs targets` and the capture result**

Create `logs-common.ps1`:

```powershell
#requires -Version 7.0
# Every log NexusMD's Logs tab can show, with the devenv argv that shows it - so the mapping
# from a log to its command lives here, next to the commands, not in NexusMD.

function ConvertTo-DevenvLogTargets {
 param([object[]]$BuildLogs=@(),[object[]]$Backend=@(),[string[]]$Infra=@(),[object[]]$TestApis=@(),[string[]]$TestInfra=@())
 $t={ param($g,$k,$l,[string[]]$argv,$follow) [ordered]@{ group=$g; key=$k; label=$l; argv=$argv; follow=[bool]$follow } }
 [ordered]@{
  kind='log-targets'
  targets=@(
   foreach ($b in $BuildLogs) { & $t 'build' $b.Key "$($b.Label) build log" @('logs','show',$b.Key) $false }
   & $t 'emulator' 'emulator' 'Emulator' @('logs','show','emulator') $false
   foreach ($b in $Backend) { & $t 'backend' $b.Key $b.Label @('backend','logs',$b.Key) $true }
   foreach ($s in $Infra) { & $t 'backend' $s $s @('backend','logs',$s) $true }
   # The test stack only exists for profiles with test APIs.
   if ($TestApis) {
    foreach ($a in $TestApis) { & $t 'test' $a.Key $a.Label @('test','logs',$a.Key) $true }
    foreach ($s in $TestInfra) { & $t 'test' $s $s @('test','logs',$s) $true }
   }
  )
 }
}
```

In `logs.ps1`:
- Change the params to `param([string]$Service='list',[string]$Since='2h',[switch]$Json)`.
- Dot-source `"$root/logs-common.ps1"` after `launcher-common.ps1`.
- Add `'targets'` to both lists in the unknown-log check: the `-notin` list and the error message.
- Add this switch branch before `'list'`:

```powershell
 'targets' {
  $result=ConvertTo-DevenvLogTargets `
   -BuildLogs @($buildLogs | ForEach-Object { @{Key=$_.Key;Label=$_.Label} }) `
   -Backend @(Get-DevEnvServices -Docker -Config $config | ForEach-Object { @{Key=$_.Key;Label=$_.Label} }) `
   -Infra $DevEnvInfraServices `
   -TestApis @(Get-DevEnvServices -Test -Config $config | ForEach-Object { @{Key=$_.Key;Label=$_.Label} }) `
   -TestInfra $DevEnvTestInfraServices
  if ($Json) { Write-DevenvEvent result $result -Force; return }
  foreach ($g in $result.targets) { Write-Host ("  {0,-9} {1,-28} devenv {2}" -f $g.group,$g.label,($g.argv -join ' ')) }
 }
```

In the `'capture'` branch, after `Write-Host "Saved to $out …"`, add:

```powershell
  Write-DevenvEvent result @{kind='capture';path=$out}
```

That line has no `-Force`, so it is a no-op in the terminal. Write it exactly as shown: the structural test matches it.

In `devenv.ps1`, after `logs capture`, add:

```powershell
 @{G='logs';V='targets';A='';S='List every log devenv can show and the command for each';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{Service='targets'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'logs.ps1' $n }}
```

- [ ] **Step 11: Update the README**

In `README.md` under "Running under NexusMD", after the paragraph ending "Without `DEVENV_HOST` nothing changes.", add:

```markdown
Read-only data commands for NexusMD's tabs print one `result` line with `--json`:
`devenv status --json`, `devenv build status --json` (last build per API / mobile) and
`devenv logs targets --json` (every log and the devenv command that shows it). Without
`--json` they print a table.
```

- [ ] **Step 12: Run the whole Pester suite**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: PASS. The previous suite had 71 tests; it should now have about 85.

Also check by hand that the terminal output is unchanged:
- `pwsh -NoProfile -File ./devenv.ps1 help build` lists `status`, `apis --clean`, `orders --clean`.
- `pwsh -NoProfile -File ./devenv.ps1 build status` prints a table without throwing; with your profile this needs real worktrees.

- [ ] **Step 13: Commit**

```bash
git add build-common.ps1 build-status.ps1 logs-common.ps1 launcher-common.ps1 session.ps1 build-api.ps1 devenv.ps1 logs.ps1 docker.ps1 test.ps1 README.md tests/builds.Tests.ps1 tests/logs.Tests.ps1 tests/catalog.Tests.ps1
git commit -m "feat: devenv build status, --clean builds and logs targets for NexusMD"
```

---

### Task 2: NexusMD plumbing — query allowlist, idle run buffer, generic query hook

**Repository:** `C:\repos\NexusMD-Mono`, branch `feature/devenv-builds-logs` (create from `master`).

**Files:**
- Modify: `apps/desktop/electron/ipc/devenv.cjs` (`QUERIES`)
- Modify: `apps/desktop/electron/ipc/devenv.test.js`
- Modify: `apps/desktop/src/views/devenv/use-devenv-run.js` (initial `runIdRef` is `-1`)
- Modify: `apps/desktop/src/views/devenv/use-devenv-run.test.jsx`
- Create: `apps/desktop/src/views/devenv/use-devenv-query.js`
- Create: `apps/desktop/src/views/devenv/use-devenv-query.test.jsx`
- Modify: `apps/desktop/src/views/devenv/use-devenv-status.js` (becomes a wrapper)

**Interfaces:**
- Consumes: devenv `build status --json` / `logs targets --json` (Task 1).
- Produces:
  - `useDevenvQuery({ adapter, config, argv, kind, normalise, runStatus, intervalMs = null })` → `{ data, error, loading, refresh }`. `data` is `normalise(result)` for the first result whose `kind` matches.
  - `useDevenvStatus` keeps its signature and return `{ status, error, loading, refresh }`.

- [ ] **Step 1: Create the branch**

```bash
cd /c/repos/NexusMD-Mono && git checkout master && git checkout -b feature/devenv-builds-logs
```

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/electron/ipc/devenv.test.js`:
- rename the test `query refuses anything but status --json` to `query refuses anything outside the allowlist`;
- add `['build', 'status']` and `['logs', 'targets', '--json', 'x']` to its rejected cases;
- add this test after it:

```js
  it('query allows build status and logs targets', async () => {
    for (const argv of [['build', 'status', '--json'], ['logs', 'targets', '--json']]) {
      const p = t.handlers['devenv:query'](null, CONFIG, argv)
      await tick()
      t.children.at(-1).finish(0)
      await expect(p).resolves.toHaveProperty('code', 0)
    }
    expect(t.deps.spawn).toHaveBeenCalledTimes(2)
  })
```

In `use-devenv-run.test.jsx`, add:

```js
  it('drops lines from other runs while idle instead of buffering them', async () => {
    const a = fakeAdapter()
    a.run = vi.fn(async () => ({ runId: 5 }))
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    act(() => { for (let i = 0; i < 3; i++) a.emitLine({ runId: 5, stream: 'stdout', line: `old ${i}` }) })
    await act(() => result.current.start(['status'], { exclusive: false, label: 'status' }))
    expect(result.current.state.lines).toEqual([])
  })
```

Create `use-devenv-query.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useDevenvQuery } from './use-devenv-query.js'

afterEach(cleanup)
const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const ARGV = ['build', 'status', '--json']

describe('useDevenvQuery', () => {
  it('loads once, normalises the matching result, and does not poll without an interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'other' }, { kind: 'builds', items: [1] }], stderr: '' })) }
    const normalise = vi.fn(r => ({ n: r.items.length }))
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
    expect(adapter.query).toHaveBeenCalledWith(CFG, ARGV)
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect(adapter.query).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reports a missing result with the command name and exit code', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 1, results: [], stderr: 'boom' })) }
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: x => x, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.error).toBe('devenv build status returned nothing (exit 1). boom'))
  })

  it('turns a normaliser error into an error, not a crash', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'builds' }], stderr: '' })) }
    const { result } = renderHook(() => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: () => { throw new Error('bad shape') }, runStatus: 'idle' }))
    await waitFor(() => expect(result.current.error).toBe('bad shape'))
  })

  it('reloads when a run finishes', async () => {
    const adapter = { query: vi.fn(async () => ({ code: 0, results: [{ kind: 'builds' }], stderr: '' })) }
    const { rerender } = renderHook(p => useDevenvQuery({ adapter, config: CFG, argv: ARGV, kind: 'builds', normalise: x => x, runStatus: p.s }), { initialProps: { s: 'idle' } })
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(1))
    rerender({ s: 'running' })
    rerender({ s: 'done' })
    await waitFor(() => expect(adapter.query).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js src/views/devenv/use-devenv-run.test.jsx src/views/devenv/use-devenv-query.test.jsx`
Expected: FAIL:
- the allowlist rejects `build status`;
- the idle test sees `old 0..2`;
- `use-devenv-query.js` is missing.

- [ ] **Step 4: Implement**

`devenv.cjs`:

```js
const QUERIES = [['status', '--json'], ['build', 'status', '--json'], ['logs', 'targets', '--json']];
```

`use-devenv-run.js`: change `const runIdRef = React.useRef(null)` to:

```js
  // -1 = no run yet. Only null (a start in flight) buffers events: other screens' runs (a log
  // follow) stream all the time, and buffering them while idle would grow without bound.
  const runIdRef = React.useRef(-1)
```

`cancel` must not call `adapter.cancel(-1)`. After `setState(s => applyCancelRequested(s))`, change the guard to:

```js
    if (runIdRef.current === -1) { setState(s => ({ ...s, cancelling: false })); return }
    if (runIdRef.current === null) { cancelPendingRef.current = true; return }
```

Create `use-devenv-query.js`. Its body is the current `use-devenv-status.js` body, generalised:

```js
import React from 'react'

const ACTIVE = ['starting', 'running']

// A read-only devenv query (devenv:query never takes the exclusive slot), reloaded when the
// provider's run finishes and, with intervalMs, polled while the document is visible.
export function useDevenvQuery({ adapter, config, argv, kind, normalise, runStatus, intervalMs = null }) {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  const argvKey = argv.join('\u0000')
  const normaliseRef = React.useRef(normalise)
  normaliseRef.current = normalise
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const name = `devenv ${argv.filter(a => a !== '--json').join(' ')}`
  // Overlapping refreshes can resolve out of order; only the newest request may write state.
  const load = React.useCallback(async (quiet, skipIfBusy = false) => {
    // docker ps can hang for the whole timeout; stacking polls behind it would only pile up processes.
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const r = await adapter.query(config, argvKey.split('\u0000'))
      const result = (r?.results || []).find(m => m.kind === kind)
      if (!current()) return
      if (result) { setData(normaliseRef.current(result)); setError(null) }
      else setError(`${name} returned nothing (exit ${r?.code}). ${r?.stderr || ''}`.trim())
    } catch (e) {
      if (current()) setError(e?.message || `${name} failed`)
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
    }
  }, [adapter, config, argvKey, kind, name])

  const refresh = React.useCallback(() => load(false), [load])

  React.useEffect(() => {
    load(false)
    if (!intervalMs) return undefined
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const id = setInterval(() => { if (visible()) load(true, true) }, intervalMs)
    // Timers are throttled while hidden, so the view can be stale the moment it comes back.
    const onVisible = () => { if (visible()) load(true, true) }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, intervalMs])

  const prev = React.useRef(runStatus)
  React.useEffect(() => {
    if (ACTIVE.includes(prev.current) && !ACTIVE.includes(runStatus)) load(true)
    prev.current = runStatus
  }, [runStatus, load])

  return { data, error, loading, refresh }
}
```

Replace `use-devenv-status.js` with:

```js
import { normaliseStatus } from '@nexusmd/core'
import { useDevenvQuery } from './use-devenv-query.js'

const ARGV = ['status', '--json']

// Status keeps refreshing while start/stop run (devenv:query never waits for the exclusive slot).
export function useDevenvStatus({ adapter, config, runStatus, intervalMs = 10000 }) {
  const { data, ...rest } = useDevenvQuery({ adapter, config, argv: ARGV, kind: 'status', normalise: normaliseStatus, runStatus, intervalMs })
  return { status: data, ...rest }
}
```

- [ ] **Step 5: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js src/views/devenv`
Expected: PASS. That includes the existing, unchanged `use-devenv-status.test.jsx` and `status-view.test.jsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/ipc/devenv.test.js apps/desktop/src/views/devenv/use-devenv-run.js apps/desktop/src/views/devenv/use-devenv-run.test.jsx apps/desktop/src/views/devenv/use-devenv-query.js apps/desktop/src/views/devenv/use-devenv-query.test.jsx apps/desktop/src/views/devenv/use-devenv-status.js
git commit -m "feat(desktop): devenv build/log queries, generic query hook, no idle run buffering"
```

---

### Task 3: Core — builds, log targets, log filtering, build argv

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `packages/core/src/modules/devenv/builds.js`, `builds.test.js`
- Create: `packages/core/src/modules/devenv/logs.js`, `logs.test.js`
- Modify: `packages/core/src/modules/devenv/index.js` and `packages/core/src/index.js` (exports)
- Modify: whichever existing core test asserts the public API lists devenv exports. Find it with `grep -rn "normaliseSummary" packages/core/src --include=*.test.js`; add the new names there if it lists them.

**Interfaces:**
- Consumes: `stripAnsi` (`./ansi.js`).
- Produces:
  - `normaliseBuilds(result)` → `{ at, apis: Item[], mobile: Item|null }`. An `Item` is `{ key, label, kind, source: {branch,commit,dirty}|null, built: {commit,dirty,at}|null, upToDate, error, log, mode: {deploy,abi}|null, ios: {commit,dirty,at}|null }`. It throws `'Not a devenv builds result'` on the wrong kind.
  - `buildBuildArgv(action)` → `string[]`, throwing on invalid input.
  - `MOBILE_ABIS = ['x64','arm64','x86','arm','all']` and `DEPLOY_MODES = ['fast','full']`.
  - `normaliseLogTargets(result)` → `{ groups: [{ id, label, targets: [{ id, group, key, label, argv, follow }] }] }`. `id` is `${group}:${key}`.
  - `classifyLogLevel(text)` → `'error'|'warn'|null`.
  - `filterLogLines(lines, query)` → `[{ line, index }]`.
  - `CAPTURE_SINCE = ['15m','30m','1h','2h','6h','24h']`.
  - `captureFolder(results)` → `string|null`.

`buildBuildArgv` action shapes:

| Action | argv |
|---|---|
| `{ kind: 'api', key, clean? }` | `['build', key]`, plus `'--clean'` when `clean` |
| `{ kind: 'apis', clean? }` | `['build', 'apis']`, plus `'--clean'` when `clean` |
| `{ kind: 'mobile', abi = 'x64', deploy = 'fast', install? }` | `['build', 'mobile', '--abi', abi, '--deploy', deploy]`, plus `'--install'` when `install` |
| `{ kind: 'ios', device?, noRun? }` | `['build', 'ios']`, plus `'--device', device` when given, plus `'--no-run'` when `noRun` |
| `{ kind: 'app-install' }` | `['app', 'install']` |

- [ ] **Step 1: Write the failing tests**

`builds.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseBuilds, buildBuildArgv } from './builds.js'

const raw = {
  type: 'result', kind: 'builds', at: '2026-10-13T09:00:00Z',
  items: [
    { key: 'orders', label: 'Orders', kind: 'api', source: { branch: 'main', commit: 'abc', dirty: false }, built: { commit: 'abc', dirty: false, at: '2026-10-13T08:00:00Z' }, upToDate: true, error: null, log: 'C:\\d\\orders.log', mode: null, ios: null },
    { key: 'gone', label: 'Gone', kind: 'api', source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x', log: null, mode: null, ios: null },
    { key: 'mobile', label: 'Mobile', kind: 'mobile', source: { branch: 'dev', commit: 'm1', dirty: true }, built: null, upToDate: false, error: null, log: null, mode: { deploy: 'full', abi: 'android-arm64' }, ios: { commit: 'm0', dirty: false, at: '2026-10-12T08:00:00Z' } },
  ],
}

describe('normaliseBuilds', () => {
  it('splits APIs from the mobile app and keeps every field', () => {
    const b = normaliseBuilds(raw)
    expect(b.at).toBe('2026-10-13T09:00:00Z')
    expect(b.apis.map(a => a.key)).toEqual(['orders', 'gone'])
    expect(b.apis[0]).toMatchObject({ upToDate: true, built: { commit: 'abc', at: '2026-10-13T08:00:00Z' }, log: 'C:\\d\\orders.log' })
    expect(b.apis[1]).toMatchObject({ source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x' })
    expect(b.mobile).toMatchObject({ key: 'mobile', mode: { deploy: 'full', abi: 'android-arm64' }, ios: { commit: 'm0' } })
  })
  it('has no mobile without a mobile item, and survives junk', () => {
    const b = normaliseBuilds({ kind: 'builds', items: [null, { key: 'x', kind: 'web' }, { key: 'y', kind: 'api', upToDate: 'yes' }] })
    expect(b.mobile).toBeNull()
    expect(b.apis.map(a => a.key)).toEqual(['y'])
    expect(b.apis[0].upToDate).toBe(false)
  })
  it('rejects other results', () => {
    expect(() => normaliseBuilds({ kind: 'status' })).toThrow('Not a devenv builds result')
  })
})

describe('buildBuildArgv', () => {
  it('builds every build action', () => {
    expect(buildBuildArgv({ kind: 'api', key: 'orders' })).toEqual(['build', 'orders'])
    expect(buildBuildArgv({ kind: 'api', key: 'orders', clean: true })).toEqual(['build', 'orders', '--clean'])
    expect(buildBuildArgv({ kind: 'apis', clean: true })).toEqual(['build', 'apis', '--clean'])
    expect(buildBuildArgv({ kind: 'mobile' })).toEqual(['build', 'mobile', '--abi', 'x64', '--deploy', 'fast'])
    expect(buildBuildArgv({ kind: 'mobile', abi: 'arm64', deploy: 'full', install: true })).toEqual(['build', 'mobile', '--abi', 'arm64', '--deploy', 'full', '--install'])
    expect(buildBuildArgv({ kind: 'ios' })).toEqual(['build', 'ios'])
    expect(buildBuildArgv({ kind: 'ios', device: ' iPhone 16 ', noRun: true })).toEqual(['build', 'ios', '--device', 'iPhone 16', '--no-run'])
    expect(buildBuildArgv({ kind: 'app-install' })).toEqual(['app', 'install'])
  })
  it('refuses bad keys, ABIs, deploy modes and option-like device names', () => {
    expect(() => buildBuildArgv({ kind: 'api', key: '--clean' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'api', key: 'status' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'mobile', abi: 'mips' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'mobile', deploy: 'slow' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'ios', device: '-x' })).toThrow()
    expect(() => buildBuildArgv({ kind: 'nope' })).toThrow()
  })
})
```

`logs.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder } from './logs.js'

describe('normaliseLogTargets', () => {
  it('groups targets in a fixed order with readable group labels', () => {
    const r = normaliseLogTargets({ kind: 'log-targets', targets: [
      { group: 'backend', key: 'orders', label: 'Orders', argv: ['backend', 'logs', 'orders'], follow: true },
      { group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false },
      { group: 'test', key: 'tracer', label: 'tracer', argv: ['test', 'logs', 'tracer'], follow: true },
      { group: 'emulator', key: 'emulator', label: 'Emulator', argv: ['logs', 'show', 'emulator'], follow: false },
    ] })
    expect(r.groups.map(g => g.label)).toEqual(['Build logs', 'Emulator', 'Backend containers', 'Test stack'])
    expect(r.groups[0].targets[0]).toEqual({ id: 'build:orders', group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false })
  })
  it('drops targets without a string argv and empty groups', () => {
    const r = normaliseLogTargets({ kind: 'log-targets', targets: [{ group: 'build', key: 'x', argv: [1] }, { group: 'backend', key: 'y', label: 'Y', argv: ['backend', 'logs', 'y'], follow: true }, null] })
    expect(r.groups.map(g => g.id)).toEqual(['backend'])
  })
  it('rejects other results', () => { expect(() => normaliseLogTargets({ kind: 'builds' })).toThrow('Not a devenv log-targets result') })
})

describe('classifyLogLevel', () => {
  it('spots errors and warnings in common log formats, ignoring ANSI', () => {
    expect(classifyLogLevel('fail: Microsoft.AspNetCore[1] boom')).toBe('error')
    expect(classifyLogLevel('2026-10-13 ERROR something')).toBe('error')
    expect(classifyLogLevel('Unhandled exception. System.Exception')).toBe('error')
    expect(classifyLogLevel('\u001b[33mwarn\u001b[39m: retrying')).toBe('warn')
    expect(classifyLogLevel('info: started')).toBeNull()
    expect(classifyLogLevel('terrorist')).toBeNull()
  })
})

describe('filterLogLines', () => {
  const lines = [{ text: 'GET /orders 200' }, { text: '\u001b[31m[error]\u001b[0m (db) timeout' }, { text: 'a.b' }]
  it('keeps everything for an empty query, with original indexes', () => {
    expect(filterLogLines(lines, '  ').map(r => r.index)).toEqual([0, 1, 2])
  })
  it('matches literally and case-insensitively, never inside ANSI codes', () => {
    expect(filterLogLines(lines, '[ERROR]').map(r => r.index)).toEqual([1])
    expect(filterLogLines(lines, '(db)').map(r => r.index)).toEqual([1])
    expect(filterLogLines(lines, '.').map(r => r.index)).toEqual([2])
    expect(filterLogLines(lines, '31m')).toEqual([])
  })
})

describe('captureFolder', () => {
  it('returns the last capture path', () => {
    expect(captureFolder([{ kind: 'capture', path: 'C:\\a' }, { kind: 'capture', path: 'C:\\b' }])).toBe('C:\\b')
    expect(captureFolder([{ kind: 'capture' }, { kind: 'other', path: 'C:\\c' }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv/builds.test.js src/modules/devenv/logs.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`builds.js`:

```js
// packages/core/src/modules/devenv/builds.js
//
// `devenv build status --json` as the Builds tab's view model, and the argv for each build
// action. A newer devenv's unknown kinds are dropped rather than shown as APIs.

export const MOBILE_ABIS = ['x64', 'arm64', 'x86', 'arm', 'all']
export const DEPLOY_MODES = ['fast', 'full']
// Verbs in the build group that an API key must not shadow.
const RESERVED = ['apis', 'mobile', 'ios', 'status']

const str = v => (typeof v === 'string' && v ? v : null)
const commit = c => (c && typeof c === 'object' ? { commit: str(c.commit), dirty: c.dirty === true, at: str(c.at) } : null)

function item(i) {
  return {
    key: String(i.key ?? ''), label: String(i.label ?? i.key ?? ''), kind: i.kind,
    source: i.source && typeof i.source === 'object' ? { branch: str(i.source.branch), commit: str(i.source.commit), dirty: i.source.dirty === true } : null,
    built: commit(i.built),
    upToDate: i.upToDate === true,
    error: str(i.error),
    log: str(i.log),
    mode: i.mode && typeof i.mode === 'object' ? { deploy: str(i.mode.deploy), abi: str(i.mode.abi) } : null,
    ios: commit(i.ios),
  }
}

export function normaliseBuilds(result) {
  if (!result || result.kind !== 'builds') throw new Error('Not a devenv builds result')
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter(i => i && typeof i === 'object' && (i.kind === 'api' || i.kind === 'mobile'))
    .map(item)
  return { at: str(result.at), apis: items.filter(i => i.kind === 'api'), mobile: items.find(i => i.kind === 'mobile') ?? null }
}

export function buildBuildArgv(action) {
  const a = action || {}
  switch (a.kind) {
    case 'api': {
      if (typeof a.key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(a.key) || RESERVED.includes(a.key.toLowerCase())) throw new Error(`Not an API key: ${a.key}`)
      return ['build', a.key, ...(a.clean ? ['--clean'] : [])]
    }
    case 'apis': return ['build', 'apis', ...(a.clean ? ['--clean'] : [])]
    case 'mobile': {
      const abi = a.abi ?? 'x64'
      const deploy = a.deploy ?? 'fast'
      if (!MOBILE_ABIS.includes(abi)) throw new Error(`Unknown ABI: ${abi}`)
      if (!DEPLOY_MODES.includes(deploy)) throw new Error(`Unknown deploy mode: ${deploy}`)
      return ['build', 'mobile', '--abi', abi, '--deploy', deploy, ...(a.install ? ['--install'] : [])]
    }
    case 'ios': {
      const device = typeof a.device === 'string' ? a.device.trim() : ''
      // devenv reads anything starting with '-' as an option.
      if (device.startsWith('-')) throw new Error(`Not a device name: ${device}`)
      return ['build', 'ios', ...(device ? ['--device', device] : []), ...(a.noRun ? ['--no-run'] : [])]
    }
    case 'app-install': return ['app', 'install']
    default: throw new Error(`Unknown build action: ${a.kind}`)
  }
}
```

`logs.js`:

```js
// packages/core/src/modules/devenv/logs.js
//
// The Logs tab's model: devenv's own list of logs (each with the argv that shows it), level
// highlighting and a plain-text filter over the lines a run produced.

import { stripAnsi } from './ansi.js'

export const CAPTURE_SINCE = ['15m', '30m', '1h', '2h', '6h', '24h']

const GROUPS = [
  { id: 'build', label: 'Build logs' },
  { id: 'emulator', label: 'Emulator' },
  { id: 'backend', label: 'Backend containers' },
  { id: 'test', label: 'Test stack' },
]

export function normaliseLogTargets(result) {
  if (!result || result.kind !== 'log-targets') throw new Error('Not a devenv log-targets result')
  const targets = (Array.isArray(result.targets) ? result.targets : [])
    .filter(t => t && typeof t === 'object' && GROUPS.some(g => g.id === t.group)
      && Array.isArray(t.argv) && t.argv.length && t.argv.every(a => typeof a === 'string'))
    .map(t => ({ id: `${t.group}:${t.key}`, group: t.group, key: String(t.key ?? ''), label: String(t.label ?? t.key ?? ''), argv: [...t.argv], follow: t.follow === true }))
  return {
    groups: GROUPS.map(g => ({ ...g, targets: targets.filter(t => t.group === g.id) })).filter(g => g.targets.length),
  }
}

// ASP.NET console ("fail:", "crit:", "warn:"), Serilog ("[ERR]", "[WRN]") and plain words.
const ERROR = /\b(fail|failed|error|err|crit|critical|fatal|exception|panic)\b/i
const WARN = /\b(warn|warning|wrn)\b/i

export function classifyLogLevel(text) {
  const t = stripAnsi(text ?? '')
  if (ERROR.test(t)) return 'error'
  if (WARN.test(t)) return 'warn'
  return null
}

export function filterLogLines(lines, query) {
  const q = (query ?? '').trim().toLowerCase()
  const all = lines.map((line, index) => ({ line, index }))
  if (!q) return all
  return all.filter(({ line }) => stripAnsi(line.text ?? '').toLowerCase().includes(q))
}

export function captureFolder(results) {
  const r = [...(results || [])].reverse().find(m => m?.kind === 'capture' && typeof m.path === 'string' && m.path)
  return r ? r.path : null
}
```

Add to `modules/devenv/index.js`:

```js
export { normaliseBuilds, buildBuildArgv, MOBILE_ABIS as DEVENV_MOBILE_ABIS, DEPLOY_MODES as DEVENV_DEPLOY_MODES } from './builds.js'
export { normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder, CAPTURE_SINCE as DEVENV_CAPTURE_SINCE } from './logs.js'
```

Then add these names to the devenv export list in `packages/core/src/index.js`: `normaliseBuilds, buildBuildArgv, DEVENV_MOBILE_ABIS, DEVENV_DEPLOY_MODES, normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder, DEVENV_CAPTURE_SINCE`. Also add them to the public-API test if it lists devenv exports.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/core test`
Expected: PASS. That is 798 tests plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): devenv builds and log-targets normalisers, build argv, log filter"
```

---

### Task 4: Builds tab

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/builds-view.jsx`, `builds-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx` (`TABS` and the render switch)
- Modify: `apps/desktop/src/views/devenv/view-devenv.test.jsx` (tab list assertion, if it has one)

**Interfaces:**
- Consumes:
  - `useDevenvQuery` (Task 2);
  - `normaliseBuilds`, `buildBuildArgv`, `DEVENV_MOBILE_ABIS`, `DEVENV_DEPLOY_MODES` (Task 3);
  - `useDevenvRunContext()`, which returns `{ state, start, cancel, config }`;
  - `RunPanel({ state, onCancel })`.
- Produces: `BuildsView({ adapter })`.

Layout:
- A toolbar with **Build all APIs** (plus a "Clean first" checkbox) and **Refresh**.
- One row per API: label; source (`branch sha8`, plus ` + uncommitted`), or the error in red; last build (`sha8 · local time`, or `never built`); a chip reading **Up to date** or **Needs a build**; **Build** and **Clean rebuild** buttons.
- A **Mobile** section, only when `mobile` exists:
  - source and last build, with the mode (`deploy` / `abi`) from the last build;
  - ABI select (`x64` default), Deploy select (`fast` default), "Install on the emulator" checkbox, **Build mobile**;
  - **Install last build** (`app install`).
- An **iOS** section, only when `mobile` exists:
  - last iOS build;
  - Device text input (placeholder `default simulator`), "Build only (don't run)" checkbox, **Build for iOS**.
- `RunPanel` when the provider's run is one of this tab's: `command` starts with `devenv build ` or equals `devenv app install`, and `status !== 'idle'`.

- [ ] **Step 1: Write the failing test**

`builds-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { BuildsView } from './builds-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const builds = (items) => ({ code: 0, stderr: '', results: [{ type: 'result', kind: 'builds', at: '2026-10-13T09:00:00Z', items }] })
const ORDERS = { key: 'orders', label: 'Orders', kind: 'api', source: { branch: 'main', commit: 'abcdef123456', dirty: false }, built: { commit: 'abcdef123456', dirty: false, at: '2026-10-13T08:00:00Z' }, upToDate: true, error: null, log: null, mode: null, ios: null }
const GONE = { key: 'gone', label: 'Gone', kind: 'api', source: null, built: null, upToDate: false, error: 'Source worktree missing: C:\\x', log: null, mode: null, ios: null }
const MOBILE = { key: 'mobile', label: 'Mobile', kind: 'mobile', source: { branch: 'dev', commit: '99887766aa', dirty: true }, built: null, upToDate: false, error: null, log: null, mode: { deploy: 'full', abi: 'android-arm64' }, ios: null }

function setup(items, over = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = { query: vi.fn(async () => builds(items)) }
  render(<BuildsView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('BuildsView', () => {
  it('shows each API with its source, last build and state', async () => {
    setup([ORDERS, GONE])
    await screen.findByText('Orders')
    expect(screen.getByText('main abcdef12')).toBeTruthy()
    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.getByText('Source worktree missing: C:\\x')).toBeTruthy()
    expect(screen.getByText('never built')).toBeTruthy()
  })

  it('builds, clean-rebuilds and builds all through the provider run', async () => {
    const { run } = setup([ORDERS])
    await screen.findByText('Orders')
    fireEvent.click(screen.getByRole('button', { name: 'Build Orders' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'orders'], { exclusive: true, label: 'devenv build orders' })
    fireEvent.click(screen.getByRole('button', { name: 'Clean rebuild Orders' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'orders', '--clean'], { exclusive: true, label: 'devenv build orders --clean' })
    fireEvent.click(screen.getByLabelText('Clean first'))
    fireEvent.click(screen.getByRole('button', { name: 'Build all APIs' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'apis', '--clean'], { exclusive: true, label: 'devenv build apis --clean' })
  })

  it('has no Mobile or iOS section without a mobile repo', async () => {
    setup([ORDERS])
    await screen.findByText('Orders')
    expect(screen.queryByRole('button', { name: 'Build mobile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Build for iOS' })).toBeNull()
  })

  it('builds mobile with the chosen ABI, deploy and install, and iOS with a device', async () => {
    const { run } = setup([ORDERS, MOBILE])
    await screen.findByRole('button', { name: 'Build mobile' })
    expect(screen.getByText('Last build: full deploy, android-arm64')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ABI'), { target: { value: 'arm64' } })
    fireEvent.change(screen.getByLabelText('Deploy'), { target: { value: 'full' } })
    fireEvent.click(screen.getByLabelText('Install on the emulator'))
    fireEvent.click(screen.getByRole('button', { name: 'Build mobile' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'mobile', '--abi', 'arm64', '--deploy', 'full', '--install'], { exclusive: true, label: 'devenv build mobile --abi arm64 --deploy full --install' })
    fireEvent.click(screen.getByRole('button', { name: 'Install last build' }))
    expect(run.start).toHaveBeenLastCalledWith(['app', 'install'], { exclusive: true, label: 'devenv app install' })
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'iPhone 16' } })
    fireEvent.click(screen.getByLabelText("Build only (don't run)"))
    fireEvent.click(screen.getByRole('button', { name: 'Build for iOS' }))
    expect(run.start).toHaveBeenLastCalledWith(['build', 'ios', '--device', 'iPhone 16', '--no-run'], { exclusive: true, label: 'devenv build ios --device iPhone 16 --no-run' })
  })

  it('shows an invalid device as an error instead of starting', async () => {
    const { run } = setup([ORDERS, MOBILE])
    await screen.findByRole('button', { name: 'Build for iOS' })
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: '-x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build for iOS' }))
    expect(run.start).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/Not a device name/)
  })

  it('disables every action while a run is active and shows its own run', async () => {
    setup([ORDERS], { status: 'running', command: 'devenv build orders', runId: 3 })
    await screen.findByText('Orders')
    expect(screen.getByRole('button', { name: 'Build Orders' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Build all APIs' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it("does not show another tab's run", async () => {
    setup([ORDERS], { status: 'running', command: 'devenv start', runId: 3 })
    await screen.findByText('Orders')
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows a query error', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<BuildsView adapter={{ query: vi.fn(async () => { throw new Error('pwsh missing') }) }} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('pwsh missing'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/builds-view.test.jsx`
Expected: FAIL — `builds-view.jsx` not found.

- [ ] **Step 3: Implement `builds-view.jsx`**

```jsx
import React from 'react'
import { normaliseBuilds, buildBuildArgv, DEVENV_MOBILE_ABIS, DEVENV_DEPLOY_MODES } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { RunPanel } from './run-panel.jsx'

const ARGV = ['build', 'status', '--json']
const short = c => (c ? c.slice(0, 8) : '')
const when = at => (at ? new Date(at).toLocaleString() : '')
const sourceText = i => (i.source ? `${i.source.branch} ${short(i.source.commit)}${i.source.dirty ? ' + uncommitted' : ''}` : '')
const builtText = b => (b ? `${short(b.commit)}${b.dirty ? ' + uncommitted' : ''} · ${when(b.at)}` : 'never built')
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv build ') || cmd === 'devenv app install')

function Source({ item }) {
  return item.error ? <span style={{ color: 'var(--danger)' }}>{item.error}</span> : <span>{sourceText(item)}</span>
}

export function BuildsView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { data, error, loading, refresh } = useDevenvQuery({
    adapter, config: run.config, argv: ARGV, kind: 'builds', normalise: normaliseBuilds, runStatus: run.state.status,
  })
  const [cleanAll, setCleanAll] = React.useState(false)
  const [abi, setAbi] = React.useState('x64')
  const [deploy, setDeploy] = React.useState('fast')
  const [install, setInstall] = React.useState(false)
  const [device, setDevice] = React.useState('')
  const [noRun, setNoRun] = React.useState(false)
  const [actionError, setActionError] = React.useState(null)

  const go = action => {
    setActionError(null)
    let argv
    try { argv = buildBuildArgv(action) } catch (e) { setActionError(e.message); return }
    run.start(argv, { exclusive: true, label: `devenv ${argv.join(' ')}` })
  }
  const mobile = data?.mobile
  const problem = actionError || error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary sm" disabled={busy} onClick={() => go({ kind: 'apis', clean: cleanAll })}>Build all APIs</button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={cleanAll} onChange={e => setCleanAll(e.target.checked)} aria-label="Clean first" />
          <span>Clean first</span>
        </label>
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} disabled={loading} onClick={refresh}>Refresh</button>
      </div>

      {problem && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{problem}</div>}

      {data && (
        <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(100px,auto) 1fr 1fr auto auto', gap: '6px 12px', alignItems: 'center' }}>
          {data.apis.map(a => (
            <React.Fragment key={a.key}>
              <strong>{a.label}</strong>
              <Source item={a} />
              <span>{builtText(a.built)}</span>
              <span className={`chip ${a.upToDate ? 'done' : 'failed'}`}>{a.upToDate ? 'Up to date' : 'Needs a build'}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" disabled={busy} aria-label={`Build ${a.label}`} onClick={() => go({ kind: 'api', key: a.key })}>Build</button>
                <button className="btn sm ghost" disabled={busy} aria-label={`Clean rebuild ${a.label}`} onClick={() => go({ kind: 'api', key: a.key, clean: true })}>Clean rebuild</button>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {mobile && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Mobile (Android)</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Source item={mobile} />
            <span>{builtText(mobile.built)}</span>
            {mobile.mode && <span>{`Last build: ${mobile.mode.deploy} deploy, ${mobile.mode.abi}`}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>ABI <select aria-label="ABI" value={abi} onChange={e => setAbi(e.target.value)}>{DEVENV_MOBILE_ABIS.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
            <label>Deploy <select aria-label="Deploy" value={deploy} onChange={e => setDeploy(e.target.value)}>{DEVENV_DEPLOY_MODES.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={install} onChange={e => setInstall(e.target.checked)} aria-label="Install on the emulator" />
              <span>Install on the emulator</span>
            </label>
            <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'mobile', abi, deploy, install })}>Build mobile</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => go({ kind: 'app-install' })}>Install last build</button>
          </div>
        </div>
      )}

      {mobile && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>iOS simulator (Mac)</div>
          <span>{mobile.ios ? `Last iOS build: ${builtText(mobile.ios)}` : 'No iOS build yet'}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>Device <input aria-label="Device" value={device} placeholder="default simulator" onChange={e => setDevice(e.target.value)} /></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={noRun} onChange={e => setNoRun(e.target.checked)} aria-label="Build only (don't run)" />
              <span>Build only (don't run)</span>
            </label>
            <button className="btn sm" disabled={busy} onClick={() => go({ kind: 'ios', device, noRun })}>Build for iOS</button>
          </div>
        </div>
      )}

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

In `view-devenv.jsx`:
- set `const TABS = ['Status', 'Start', 'Builds', 'Logs', 'Commands']`;
- import `BuildsView`;
- add `{tab === 'Builds' && <BuildsView adapter={adapter} />}`.

Logs is wired in Task 5. Until then, render `{tab === 'Logs' && null}`, so that picking Logs shows an empty pane rather than crashing. Task 5 replaces it.

Update the comment above `DevenvView` to say that Tests, Database, Emulator, Mac and Profile tabs join in later phases.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS. If `view-devenv.test.jsx` asserts the tab list, update it to the five tabs.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): devenv Builds tab"
```

---

### Task 5: Logs tab

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/log-panel.jsx`, `log-panel.test.jsx`
- Create: `apps/desktop/src/views/devenv/logs-view.jsx`, `logs-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx` (render `LogsView`)
- Modify: `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 3 amendments)

**Interfaces:**
- Consumes:
  - `useDevenvQuery` (Task 2) and `useDevenvRun({ adapter, config })`, which returns `{ state, start, cancel }`;
  - `normaliseLogTargets`, `classifyLogLevel`, `filterLogLines`, `captureFolder`, `DEVENV_CAPTURE_SINCE`, `ansiToSpans`, `stripAnsi` (core);
  - `useDevenvRunContext()`, used for `config` and `state.status`;
  - `adapter.open({ path })`.
- Produces:
  - `LogPanel({ state, filter, onStop })`, where `state` is a run state;
  - `LogsView({ adapter })`.

Behaviour:
- Targets come from `useDevenvQuery({ argv: ['logs','targets','--json'], kind: 'log-targets', normalise: normaliseLogTargets })`.
- A `<select aria-label="Log">` has one `<optgroup>` per group; the option value is the target `id`. **Show** starts the selected target with `exclusive: false` and label `devenv ${argv.join(' ')}`.
- Starting anything while the Logs run is starting or running first awaits `logs.cancel()`, then starts. Unmounting cancels a starting or running run.
- A **Stop** button shows while a follow target (`follow: true`) runs. It calls `logs.cancel()`.
- The filter text input (`aria-label="Filter"`) shows only matching lines, with "N of M lines".
- Lines classified `error` or `warn` get a 3px left border (`var(--danger)` / `var(--warning, #b8860b)`) and `data-level`.
- "Scroll to newest" (checkbox, default on) keeps the panel scrolled to the bottom as lines arrive.
- **Capture:** a `<select aria-label="Since">` over `DEVENV_CAPTURE_SINCE` (default `2h`) and a **Capture logs** button, which runs `['logs','capture','--since',since]`. When the run's results contain a capture path, an **Open capture folder** button calls `adapter.open({ path })`.

- [ ] **Step 1: Write the failing tests**

`log-panel.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { LogPanel } from './log-panel.jsx'

afterEach(cleanup)
const state = over => ({ ...createRunState('devenv backend logs orders'), status: 'running', ...over })
const lines = [{ stream: 'stdout', text: 'info: started' }, { stream: 'stdout', text: 'fail: boom' }, { stream: 'stdout', text: 'warn: slow' }]

describe('LogPanel', () => {
  it('highlights error and warning lines', () => {
    const { container } = render(<LogPanel state={state({ lines })} filter="" onStop={() => {}} />)
    expect(container.querySelectorAll('[data-level="error"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-level="warn"]')).toHaveLength(1)
  })
  it('filters lines and counts them', () => {
    render(<LogPanel state={state({ lines })} filter="BOOM" onStop={() => {}} />)
    expect(screen.queryByText('info: started')).toBeNull()
    expect(screen.getByText('1 of 3 lines')).toBeTruthy()
  })
  it('offers Stop while running and calls it', () => {
    const onStop = vi.fn()
    render(<LogPanel state={state({ lines })} filter="" onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
  it('has no Stop once finished', () => {
    render(<LogPanel state={state({ lines, status: 'done', exitCode: 0 })} filter="" onStop={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })
})
```

`logs-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { LogsView } from './logs-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const TARGETS = { type: 'result', kind: 'log-targets', targets: [
  { group: 'build', key: 'orders', label: 'Orders build log', argv: ['logs', 'show', 'orders'], follow: false },
  { group: 'backend', key: 'orders', label: 'Orders', argv: ['backend', 'logs', 'orders'], follow: true },
  { group: 'backend', key: 'storage', label: 'storage', argv: ['backend', 'logs', 'storage'], follow: true },
] }

function fakeAdapter() {
  const listeners = { line: [], exit: [] }
  let id = 20
  const a = {
    query: vi.fn(async () => ({ code: 0, stderr: '', results: [TARGETS] })),
    run: vi.fn(async () => ({ runId: ++id })),
    cancel: vi.fn(async () => ({ ok: true })),
    answer: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { listeners.line.push(cb); return () => { listeners.line = listeners.line.filter(x => x !== cb) } },
    onExit: cb => { listeners.exit.push(cb); return () => { listeners.exit = listeners.exit.filter(x => x !== cb) } },
    emitLine: m => listeners.line.forEach(cb => cb(m)),
    emitExit: m => listeners.exit.forEach(cb => cb(m)),
  }
  return a
}

function setup() {
  globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = fakeAdapter()
  const view = render(<LogsView adapter={adapter} />)
  return { adapter, view }
}

const pick = id => fireEvent.change(screen.getByLabelText('Log'), { target: { value: id } })

describe('LogsView', () => {
  it('lists devenv targets by group and shows a build log without taking the exclusive slot', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders build log' })
    expect(document.querySelector('optgroup[label="Backend containers"]')).toBeTruthy()
    pick('build:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    expect(adapter.run).toHaveBeenCalledWith(CFG, ['logs', 'show', 'orders'], { exclusive: false, label: 'devenv logs show orders' })
    act(() => adapter.emitLine({ runId: 21, stream: 'stdout', line: 'Build succeeded' }))
    expect(screen.getByText('Build succeeded')).toBeTruthy()
  })

  it('cancels a running follow before showing another target', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    pick('backend:storage')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    expect(adapter.cancel).toHaveBeenCalledWith(21)
    expect(adapter.cancel.mock.invocationCallOrder[0]).toBeLessThan(adapter.run.mock.invocationCallOrder[1])
    expect(adapter.run).toHaveBeenLastCalledWith(CFG, ['backend', 'logs', 'storage'], { exclusive: false, label: 'devenv backend logs storage' })
  })

  it('stops the follow when the tab is left', async () => {
    const { adapter, view } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    view.unmount()
    await waitFor(() => expect(adapter.cancel).toHaveBeenCalledWith(21))
  })

  it('does not cancel anything when left idle', async () => {
    const { adapter, view } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    view.unmount()
    expect(adapter.cancel).not.toHaveBeenCalled()
  })

  it('filters the output', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    pick('backend:orders')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    act(() => {
      adapter.emitLine({ runId: 21, stream: 'stdout', line: 'GET /orders 200' })
      adapter.emitLine({ runId: 21, stream: 'stdout', line: 'fail: timeout' })
    })
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'timeout' } })
    expect(screen.queryByText('GET /orders 200')).toBeNull()
    expect(screen.getByText('1 of 2 lines')).toBeTruthy()
  })

  it('captures with the chosen range and opens the folder', async () => {
    const { adapter } = setup()
    await screen.findByRole('option', { name: 'Orders' })
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '30m' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Capture logs' })) })
    expect(adapter.run).toHaveBeenLastCalledWith(CFG, ['logs', 'capture', '--since', '30m'], { exclusive: false, label: 'devenv logs capture --since 30m' })
    act(() => {
      adapter.emitLine({ runId: 21, stream: 'stdout', line: '@@devenv {"type":"result","kind":"capture","path":"C:\\\\repos\\\\dev-environment\\\\.local\\\\cap"}' })
      adapter.emitExit({ runId: 21, code: 0, cancelled: false })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open capture folder' }))
    expect(adapter.open).toHaveBeenCalledWith({ path: 'C:\\repos\\dev-environment\\.local\\cap' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/log-panel.test.jsx src/views/devenv/logs-view.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `log-panel.jsx`**

```jsx
import React from 'react'
import { ansiToSpans, stripAnsi, classifyLogLevel, filterLogLines } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning, #b8860b)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}
const LEVEL_BORDER = { error: 'var(--danger)', warn: 'var(--warning, #b8860b)' }

// A run's output as a log: filtered, level-highlighted, optionally pinned to the newest line.
export function LogPanel({ state, filter, onStop }) {
  const outRef = React.useRef(null)
  const [pinned, setPinned] = React.useState(true)
  const running = state.status === 'starting' || state.status === 'running'
  const shown = filterLogLines(state.lines, filter)

  React.useEffect(() => {
    const el = outRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [state.lines.length, pinned])

  const copy = () => navigator.clipboard?.writeText(shown.map(r => stripAnsi(r.line.text)).join('\n')).catch(() => {})

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{state.command}</strong>
        <span style={{ color: 'var(--text-muted)' }}>{`${shown.length} of ${state.lines.length} lines`}</span>
        {state.status === 'failed' && <span className="chip failed">{state.exitCode == null ? 'Failed' : `Failed (exit ${state.exitCode})`}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} aria-label="Scroll to newest" />
            <span>Scroll to newest</span>
          </label>
          <button className="btn sm ghost" onClick={copy} disabled={!shown.length}>Copy</button>
          {running && <button className="btn sm danger" onClick={onStop} disabled={state.cancelling}>Stop</button>}
        </span>
      </div>
      {state.error && <div style={{ color: 'var(--danger)' }}>{state.error}</div>}
      <pre ref={outRef} style={{ flex: 1, minHeight: 200, overflow: 'auto', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {shown.map(({ line, index }) => {
          const level = classifyLogLevel(line.text)
          return (
            <div key={index} data-level={level || undefined}
              style={{ borderLeft: level ? `3px solid ${LEVEL_BORDER[level]}` : '3px solid transparent', paddingLeft: 6, color: line.stream === 'stderr' ? 'var(--danger)' : undefined }}>
              {ansiToSpans(line.text).map((s, j) => (
                <span key={j} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
              ))}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
```

- [ ] **Step 4: Implement `logs-view.jsx`**

```jsx
import React from 'react'
import { normaliseLogTargets, captureFolder, DEVENV_CAPTURE_SINCE } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { useDevenvRun } from './use-devenv-run.js'
import { LogPanel } from './log-panel.jsx'

const ARGV = ['logs', 'targets', '--json']
const ACTIVE = ['starting', 'running']

// Logs run beside the provider's run (they only read), in this tab's own run. A follow never
// ends by itself, so it is stopped when another log is picked and when the tab is left.
export function LogsView({ adapter }) {
  const shared = useDevenvRunContext()
  const logs = useDevenvRun({ adapter, config: shared.config })
  const { data, error } = useDevenvQuery({
    adapter, config: shared.config, argv: ARGV, kind: 'log-targets', normalise: normaliseLogTargets, runStatus: shared.state.status,
  })
  const [selected, setSelected] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [since, setSince] = React.useState('2h')
  const [openError, setOpenError] = React.useState(null)

  const targets = data ? data.groups.flatMap(g => g.targets) : []
  const target = targets.find(t => t.id === selected) || targets[0]

  const activeRef = React.useRef(false)
  activeRef.current = ACTIVE.includes(logs.state.status)
  const cancelRef = React.useRef(logs.cancel)
  cancelRef.current = logs.cancel
  React.useEffect(() => () => { if (activeRef.current) cancelRef.current() }, [])

  const launch = async argv => {
    setOpenError(null)
    if (activeRef.current) await logs.cancel()
    await logs.start(argv, { exclusive: false, label: `devenv ${argv.join(' ')}` })
  }
  const folder = captureFolder(logs.state.results)
  const openFolder = () => adapter.open({ path: folder }).catch(e => setOpenError(e?.message || 'Could not open the folder'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Log" value={target?.id || ''} onChange={e => setSelected(e.target.value)} disabled={!targets.length}>
          {data?.groups.map(g => (
            <optgroup key={g.id} label={g.label}>
              {g.targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn sm primary" disabled={!target} onClick={() => launch(target.argv)}>Show</button>
        <input aria-label="Filter" placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="Since" value={since} onChange={e => setSince(e.target.value)}>
            {DEVENV_CAPTURE_SINCE.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn sm ghost" onClick={() => launch(['logs', 'capture', '--since', since])}>Capture logs</button>
          {folder && <button className="btn sm" onClick={openFolder}>Open capture folder</button>}
        </span>
      </div>
      {openError && <div style={{ color: 'var(--danger)' }}>{openError}</div>}
      {logs.state.status !== 'idle' && <LogPanel state={logs.state} filter={filter} onStop={logs.cancel} />}
    </div>
  )
}
```

`LogPanel` shows **Stop** for any running log run. For a non-follow `logs show`, Stop simply ends it early, which is harmless.

In `view-devenv.jsx`, import `LogsView` and replace the Task 4 placeholder with `{tab === 'Logs' && <LogsView adapter={adapter} />}`.

- [ ] **Step 5: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS.

- [ ] **Step 6: Spec amendments**

Append to the spec:

```markdown
## Amendments made during Phase 3 planning

- Builds reads `devenv build status --json` (result kind `builds`) from the `build-commit.txt` / `build-mode.json` / `ios-build-commit.txt` files devenv writes after each build, not from the lock file; "up to date" uses the start plan's rule (clean worktree, clean build, same commit).
- `build <api>` and `build apis` gained `--clean` (delete the project's bin/obj first, as the start plan's clean rebuild does).
- Logs reads its target list from `devenv logs targets --json` (result kind `log-targets`), so devenv owns the mapping from a log to the command that shows it; `logs capture` emits a `capture` result with the folder.
- `devenv:query` allowlists `status --json`, `build status --json` and `logs targets --json`.
- The Logs tab owns its own non-exclusive run beside the provider's run; a follow is cancelled when another log is shown and when the tab is left. Builds use the provider's run.
- Status, Start, Builds, Logs and Commands are the Dev Environment tabs in this phase.
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/devenv docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "feat(desktop): devenv Logs tab with live follow, filter, levels and capture"
```

---

### Task 6: End-to-end check

**Repository:** both

- [ ] **Step 1: Full suites**

- devenv: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`. All pass.
- NexusMD: `npm -w packages/core test`, and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the pre-existing failures noted on master: the 3 `packages/ui` tests and the jira flake. Those suites are not run here.

- [ ] **Step 2: Headless end-to-end check (throwaway script in the session scratchpad, nothing committed)**

Drive `apps/desktop/electron/ipc/devenv.cjs` from a Node script with the real `spawn`, a fake `ipcMain`, and config `{ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }`:
1. `devenv:query ['build','status','--json']` → one `builds` result. Print each item's `key`, `upToDate` and `error`.
2. `devenv:query ['logs','targets','--json']` → one `log-targets` result. Print the target count per group.
3. `devenv:run` with a build-log target's argv (`logs show <first api>`) and `{ exclusive: false }`. Expect lines, then an exit.
4. `devenv:run ['backend','logs','<first api>']` with `{ exclusive: false }`. Wait 3 s and print the line count. Then `devenv:cancel` it, and confirm the exit arrives within 5 s and that `devenv:active` is empty afterwards.

Do not run a build: it would rebuild the user's APIs.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment → Builds | One row per API with branch, sha and last build time; Mobile and iOS sections if the profile has a mobile repo |
| 2 | Build on one API | Run panel with output; row turns "Up to date" when it finishes |
| 3 | Clean rebuild on the same API | Output shows "Deleting …\bin" / "…\obj" first |
| 4 | Logs → a backend container → Show | Last 200 lines, new lines arrive live; errors/warnings marked |
| 5 | Type in Filter | Only matching lines; "N of M lines" |
| 6 | Pick another container → Show | Previous follow stops (Task Manager: no leftover `docker` for it) |
| 7 | Go to Status tab and back | Follow stopped; no `docker compose logs` process left |
| 8 | Capture logs (30m) | Ends with "Saved to …"; Open capture folder opens Explorer there |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite.
