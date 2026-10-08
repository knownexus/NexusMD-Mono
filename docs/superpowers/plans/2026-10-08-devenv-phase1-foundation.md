# Dev Environment Module — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every devenv command can be run from NexusMD desktop, with every question it asks answered in a NexusMD dialog and no console window ever shown.

**Architecture:** devenv gains a host mode (`DEVENV_HOST=nexusmd`): `Read-Host` is replaced by `Request-DevenvInput`, which in host mode writes a `@@devenv {json}` prompt line to stdout and reads a JSON answer line from stdin; `devenv help --json` exports the command table. NexusMD's Electron main process runs `pwsh -NoProfile -NonInteractive -File devenv.ps1 …` hidden, streams lines to the renderer, and writes answers to stdin; a core `devenv` module holds the pure protocol / run-state / catalog logic; a generic **Commands** screen builds a form for every catalog entry.

**Tech Stack:** PowerShell 7.6 + Pester 5 (devenv); Node/Electron 43 CJS main process, React 18, Vitest 4 + Testing Library (NexusMD).

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (this plan is Phase 1 of 6).

**Two repositories.** Tasks 1–4 change `C:\repos\dev-environment` (shell examples use that as the working directory). Tasks 5–11 change `C:\repos\NexusMD-Mono`. Commit in the repository the task changes.

## Global Constraints

- devenv behaviour with `DEVENV_HOST` unset must stay exactly as today (same prompts, same text, same answers accepted).
- Host mode is `$env:DEVENV_HOST -eq 'nexusmd'`; NexusMD always sets it, and always runs `pwsh` with `-NoProfile -NonInteractive -File <root>\devenv.ps1`, `windowsHide: true`, argv as an array (never a shell string).
- Control lines: `@@devenv ` + one line of compact JSON with a `type` of `prompt`, `step`, `result` or `open`. Answers on stdin: `{"id":"<id>","value":<value>}` or `{"id":"<id>","cancel":true}`, one per line.
- Protocol version is `1` (`help --json` → `result` with `kind: 'catalog'`, `protocol: 1`).
- Prompt kinds: `choice`, `multi`, `confirm`, `text`, `secret`. `secret` answers are never logged, echoed, or kept in renderer state.
- One exclusive run at a time (catalog `mut: true`); read-only runs (`mut: false`) may run alongside. Commands without a `Mut` field are treated as mutating.
- Module: `id: 'devenv'`, `name: 'Dev Environment'`, `requiredAdapters: ['devenv']`, `defaultEnabled: false`. Nav entry `{ id: 'devenv', label: 'Dev Environment', icon: 'build' }`.
- Settings defaults: devenv folder `C:\repos\dev-environment`, `pwsh` path `pwsh`, profile folder empty (→ `DEVENV_PROFILE` unset).
- NexusMD code style: ESM `.js`/`.jsx` without semicolons; Electron `electron/**/*.cjs` CommonJS with semicolons; comments only explain why.
- devenv code style: two-space-free compact PowerShell as in the existing files (one-space indents, `$x=...` without spaces around `=`), comments explain why.

## Review Focus

- **NexusMD dies or the answer channel closes while devenv waits on a prompt** → devenv must exit with an error, never hang. Pinned in Task 1 (`stdin closed` test).
- **Output chunks split mid-line or mid-UTF-8 character** (devenv prints `─` box-drawing and `—`) → lines arrive whole and undamaged. Pinned in Task 7 (`lineSplitter` tests).
- **Starting a second state-changing command while one runs** (double-click Run, or Run while Stop is going) → second one refused with a clear message; read-only commands still allowed. Pinned in Task 7.
- **Cancel while a prompt dialog is open** → process tree killed, dialog closes, run shows Cancelled rather than Failed. Pinned in Task 5 (run-state) and Task 7 (ipc).
- **A password typed into a `secret` prompt** → never in the output panel, renderer state, or Electron logs. Pinned in Task 5 (run-state) and Task 7 (ipc logger).

---

### Task 1: devenv host-mode helpers (`host-common.ps1`) and Pester

**Repository:** `C:\repos\dev-environment`

**Files:**
- Create: `host-common.ps1`
- Modify: `launcher-common.ps1:1-2` (dot-source `host-common.ps1`)
- Create: `tests/TestHelpers.ps1`
- Test: `tests/host-common.Tests.ps1`

**Interfaces:**
- Produces (PowerShell functions, available to every script that dot-sources `launcher-common.ps1`):
  - `Test-DevenvHost` → `[bool]`
  - `Write-DevenvEvent -Type <string> [-Data <IDictionary>] [-Force]` — writes `@@devenv {"type":...,...}` to stdout in host mode (always with `-Force`)
  - `Request-DevenvInput [-Prompt] <string> [-Kind choice|multi|confirm|text|secret] [-Title] [-Detail] [-Options <hashtable[]> @{value;label;hint}] [-Default] [-AllowText] [-ConfirmWord] [-AsSecureString]` → `[string]` (what Read-Host would have returned; `multi` values joined with `,`), or `[SecureString]` with `-AsSecureString`. Throws `Cancelled.` on a cancel answer, and throws when stdin closes.
  - `Open-DevenvTarget <string>` — `open` event (`url` for `http(s)://…`, else `path`) in host mode, `Start-Process` otherwise.
- Test helper: `Invoke-HostSnippet -Code <string> [-Stdin <string[]>] [-NoHost]` → `@{ Out=[string[]]; Err=[string]; Code=[int] }`

- [ ] **Step 1: Install Pester 5 (one-time, current user)**

Windows ships Pester 3.4; the tests need 5.x.

Run: `pwsh -NoProfile -Command "Install-Module Pester -MinimumVersion 5.5 -Scope CurrentUser -Force -SkipPublisherCheck; (Get-Module -ListAvailable Pester | Sort-Object Version -Descending | Select-Object -First 1).Version.ToString()"`
Expected: a version `5.x.x`.

- [ ] **Step 2: Write the test helper**

`tests/TestHelpers.ps1`:

```powershell
#requires -Version 7.0
# Host mode talks over the real process stdin/stdout, so it is tested in a real child pwsh
# rather than with mocks: the snippet runs with host-common.ps1 loaded, stdin pre-filled with
# the answers, and the child's stdout captured line by line.

function Invoke-HostSnippet {
 param([Parameter(Mandatory)][string]$Code,[string[]]$Stdin=@(),[switch]$NoHost)
 $root=Split-Path $PSScriptRoot -Parent
 $psi=[Diagnostics.ProcessStartInfo]::new('pwsh')
 foreach ($a in @('-NoProfile','-NonInteractive','-Command',". '$root/host-common.ps1'; $Code")) { $psi.ArgumentList.Add($a) }
 $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
 $psi.UseShellExecute=$false
 if ($NoHost) { [void]$psi.Environment.Remove('DEVENV_HOST') } else { $psi.Environment['DEVENV_HOST']='nexusmd' }
 $p=[Diagnostics.Process]::Start($psi)
 foreach ($line in $Stdin) { $p.StandardInput.WriteLine($line) }
 $p.StandardInput.Close()
 $out=$p.StandardOutput.ReadToEnd(); $err=$p.StandardError.ReadToEnd()
 $p.WaitForExit()
 @{ Out=@($out -split "`r?`n" | Where-Object { $_ -ne '' }); Err=$err; Code=$p.ExitCode }
}

function Get-ControlMessages([string[]]$Lines) {
 @($Lines | Where-Object { $_.StartsWith('@@devenv ') } | ForEach-Object { $_.Substring(9) | ConvertFrom-Json -AsHashtable })
}
```

- [ ] **Step 3: Write the failing tests**

`tests/host-common.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
 $root=Split-Path $PSScriptRoot -Parent
}

Describe 'Test-DevenvHost' {
 It 'is true only for DEVENV_HOST=nexusmd' {
  (Invoke-HostSnippet 'Test-DevenvHost').Out | Should -Be 'True'
  (Invoke-HostSnippet 'Test-DevenvHost' -NoHost).Out | Should -Be 'False'
 }
}

Describe 'Write-DevenvEvent' {
 It 'writes one compact @@devenv line in host mode' {
  $r=Invoke-HostSnippet "Write-DevenvEvent step @{n=2;total=5;text='Building ─ api'}"
  $r.Out.Count | Should -Be 1
  $m=Get-ControlMessages $r.Out
  $m[0].type | Should -Be 'step'
  $m[0].n | Should -Be 2
  $m[0].text | Should -Be 'Building ─ api'
 }
 It 'writes nothing outside host mode unless forced' {
  (Invoke-HostSnippet "Write-DevenvEvent step @{n=1}" -NoHost).Out | Should -BeNullOrEmpty
  (Get-ControlMessages (Invoke-HostSnippet "Write-DevenvEvent result @{kind='x'} -Force" -NoHost).Out)[0].kind | Should -Be 'x'
 }
}

Describe 'Request-DevenvInput (host mode)' {
 It 'sends a choice prompt and returns the answered value' {
  $code="`$v=Request-DevenvInput 'Choice [1]' -Kind choice -Title 'Database' -Options @(@{value='1';label='Leave it'},@{value='2';label='Restore'}) -Default '1'; Write-Output ""got:`$v"""
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":"2"}')
  $p=(Get-ControlMessages $r.Out)[0]
  $p.type | Should -Be 'prompt'
  $p.id | Should -Be 'p1'
  $p.kind | Should -Be 'choice'
  $p.title | Should -Be 'Database'
  $p.prompt | Should -Be 'Choice [1]'
  $p.options.Count | Should -Be 2
  $p.options[1].label | Should -Be 'Restore'
  $p.default | Should -Be '1'
  $r.Out | Should -Contain 'got:2'
 }
 It 'numbers prompts p1, p2 ... in order' {
  $code="`$a=Request-DevenvInput 'A'; `$b=Request-DevenvInput 'B'; Write-Output ""`$a/`$b"""
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":"x"}','{"id":"p2","value":"y"}')
  (Get-ControlMessages $r.Out).id | Should -Be @('p1','p2')
  $r.Out | Should -Contain 'x/y'
 }
 It 'joins multi answers with commas, as Select-Indices expects' {
  $r=Invoke-HostSnippet "Write-Output (Request-DevenvInput 'Numbers' -Kind multi -Options @(@{value='1';label='a'},@{value='3';label='c'}))" -Stdin @('{"id":"p1","value":["1","3"]}')
  $r.Out | Should -Contain '1,3'
 }
 It 'returns a SecureString for -AsSecureString and sends kind secret' {
  $code="`$s=Request-DevenvInput 'Mac password' -AsSecureString; Write-Output ([Net.NetworkCredential]::new('',`$s).Password.Length)"
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":"hunter22"}')
  (Get-ControlMessages $r.Out)[0].kind | Should -Be 'secret'
  $r.Out | Should -Contain '8'
  ($r.Out -join "`n") | Should -Not -Match 'hunter22'
 }
 It 'sends allowText and confirmWord when given' {
  $r=Invoke-HostSnippet "Request-DevenvInput 'Type YES to confirm' -Kind confirm -ConfirmWord YES; Request-DevenvInput 'Ref' -AllowText" -Stdin @('{"id":"p1","value":"YES"}','{"id":"p2","value":"main"}')
  $m=Get-ControlMessages $r.Out
  $m[0].confirmWord | Should -Be 'YES'
  $m[1].allowText | Should -BeTrue
 }
 It 'throws Cancelled. on a cancel answer' {
  $r=Invoke-HostSnippet "Request-DevenvInput 'Choice'" -Stdin @('{"id":"p1","cancel":true}')
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match 'Cancelled\.'
 }
 It 'fails instead of hanging when stdin closes' {
  $r=Invoke-HostSnippet "Request-DevenvInput 'Choice'"
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match 'closed the answer channel'
 }
 It 'rejects an answer for a different prompt' {
  $r=Invoke-HostSnippet "Request-DevenvInput 'Choice'" -Stdin @('{"id":"p9","value":"1"}')
  $r.Code | Should -Not -Be 0
  $r.Err | Should -Match "waiting for 'p1'"
 }
}

Describe 'Request-DevenvInput (terminal mode)' {
 BeforeAll { Remove-Item Env:DEVENV_HOST -ErrorAction SilentlyContinue; . (Join-Path $root 'host-common.ps1') }
 It 'is plain Read-Host with the same prompt text' {
  Mock Read-Host { 'typed' } -ParameterFilter { $Prompt -eq 'Choice [1]' }
  Request-DevenvInput 'Choice [1]' -Kind choice -Options @(@{value='1';label='x'}) | Should -Be 'typed'
 }
 It 'passes -AsSecureString through' {
  Mock Read-Host { ConvertTo-SecureString 'pw' -AsPlainText -Force } -ParameterFilter { $AsSecureString }
  Request-DevenvInput 'Mac password' -AsSecureString | Should -BeOfType [Security.SecureString]
 }
}

Describe 'Open-DevenvTarget' {
 It 'emits open with url for http(s) in host mode' {
  (Get-ControlMessages (Invoke-HostSnippet "Open-DevenvTarget 'http://127.0.0.1:5280/?token=x'").Out)[0].url | Should -Be 'http://127.0.0.1:5280/?token=x'
 }
 It 'emits open with path otherwise' {
  (Get-ControlMessages (Invoke-HostSnippet "Open-DevenvTarget 'C:\reports\trace.html'").Out)[0].path | Should -Be 'C:\reports\trace.html'
 }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/host-common.Tests.ps1 -Output Detailed"`
Expected: FAIL — `host-common.ps1` not found.

- [ ] **Step 5: Write `host-common.ps1`**

```powershell
#requires -Version 7.0
# Running under NexusMD (DEVENV_HOST=nexusmd) there is no console at all. Questions, progress,
# results and "open this" requests travel as one-line JSON control messages on stdout
# ("@@devenv {...}"), and each answer comes back as one JSON line on stdin. Without
# DEVENV_HOST every function here behaves exactly like the console code it replaced.

$script:DevenvPromptSeq=0

function Test-DevenvHost { $env:DEVENV_HOST -eq 'nexusmd' }

# Colours survive the redirected stdout as ANSI codes, which NexusMD renders.
if ((Test-DevenvHost) -and $PSStyle) { $PSStyle.OutputRendering='Ansi' }

function Write-DevenvEvent {
 param([Parameter(Mandatory)][string]$Type,[Collections.IDictionary]$Data=@{},[switch]$Force)
 if (!$Force -and !(Test-DevenvHost)) { return }
 $o=[ordered]@{type=$Type}
 foreach ($k in $Data.Keys) { $o[$k]=$Data[$k] }
 # [Console]::Out, not Write-Output: a control line must never become part of a function's
 # return value, and must reach NexusMD immediately.
 [Console]::Out.WriteLine('@@devenv '+($o | ConvertTo-Json -Depth 10 -Compress))
 [Console]::Out.Flush()
}

function Request-DevenvInput {
 # Drop-in for Read-Host: returns what the person would have typed (a SecureString with
 # -AsSecureString), so callers keep their existing parsing. Under NexusMD the question is
 # sent as a prompt: -Options are the answers a dialog offers (value = exactly what would
 # have been typed), -AllowText lets the dialog also take free text.
 param(
  [Parameter(Mandatory,Position=0)][string]$Prompt,
  [ValidateSet('choice','multi','confirm','text','secret')][string]$Kind='text',
  [string]$Title,
  [string]$Detail,
  [object[]]$Options=@(),
  [string]$Default,
  [switch]$AllowText,
  [string]$ConfirmWord,
  [switch]$AsSecureString
 )
 if (!(Test-DevenvHost)) {
  if ($AsSecureString) { return Read-Host $Prompt -AsSecureString }
  return Read-Host $Prompt
 }
 if ($AsSecureString) { $Kind='secret' }
 $script:DevenvPromptSeq++
 $id="p$script:DevenvPromptSeq"
 $data=[ordered]@{id=$id;kind=$Kind;title=$(if ($Title) { $Title } else { $Prompt.Trim() });prompt=$Prompt.Trim()}
 if ($Detail) { $data.detail=$Detail }
 if ($Options) { $data.options=@($Options | ForEach-Object { [ordered]@{value="$($_.value)";label="$($_.label)";hint=$(if ($_.hint) { "$($_.hint)" } else { $null })} }) }
 if ($PSBoundParameters.ContainsKey('Default')) { $data.default=$Default }
 if ($AllowText) { $data.allowText=$true }
 if ($ConfirmWord) { $data.confirmWord=$ConfirmWord }
 Write-DevenvEvent prompt $data
 $line=[Console]::In.ReadLine()
 if ($null -eq $line) { throw 'NexusMD closed the answer channel - stopping.' }
 $answer=$line | ConvertFrom-Json -AsHashtable
 if ($answer['id'] -ne $id) { throw "Got an answer for '$($answer['id'])' while waiting for '$id'." }
 if ($answer['cancel']) { throw 'Cancelled.' }
 $value=$answer['value']
 if ($AsSecureString) {
  $secure=[Security.SecureString]::new()
  foreach ($c in "$value".ToCharArray()) { $secure.AppendChar($c) }
  $secure.MakeReadOnly()
  return $secure
 }
 if ($value -is [array]) { return (@($value | ForEach-Object { "$_" }) -join ',') }
 return "$value"
}

function Open-DevenvTarget([Parameter(Mandatory)][string]$Target) {
 # Reports, the live tracer, DbGate: under NexusMD it opens them itself (a hidden process
 # launching a browser is surprising); from a terminal they open as before.
 if (Test-DevenvHost) {
  if ($Target -match '^https?://') { Write-DevenvEvent open @{url=$Target} } else { Write-DevenvEvent open @{path=$Target} }
  return
 }
 Start-Process $Target
}
```

- [ ] **Step 6: Load it from `launcher-common.ps1`**

Insert after line 2 (`$ErrorActionPreference='Stop'`):

```powershell
. (Join-Path $PSScriptRoot 'host-common.ps1')   # Test-DevenvHost, Request-DevenvInput, Write-DevenvEvent, Open-DevenvTarget
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/host-common.Tests.ps1 -Output Detailed"`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add host-common.ps1 launcher-common.ps1 tests/TestHelpers.ps1 tests/host-common.Tests.ps1
git commit -m "feat: add host mode helpers for running devenv under NexusMD"
```

---

### Task 2: Route every `session.ps1` question through `Request-DevenvInput`

**Repository:** `C:\repos\dev-environment`

**Files:**
- Modify: `session.ps1` — `Write-Step` (≈153), `Edit-BuildPlan` (≈369), `Edit-TestPlan` (≈395), `Edit-DatabasePlan` (≈422, ≈449, ≈458), `Select-Ref` (≈570, ≈576), `Select-Indices` (≈638-655) and its three callers in `'Clean'`, start loop (≈832), `'Clean'` (≈1107, ≈1155, ≈1167, ≈1194, ≈1223)
- Test: `tests/session-prompts.Tests.ps1`

**Interfaces:**
- Consumes: `Request-DevenvInput`, `Write-DevenvEvent` (Task 1).
- Produces: `Select-Indices([int]$Count,[string]$Prompt,[string[]]$Labels)` — new third parameter; every `session.ps1` prompt reaches NexusMD as a `prompt` message; `Write-Step` also emits `step` `{n,total,text}`.

Every replacement keeps the same prompt text and the same answer parsing; each option's `value` is exactly what a person would type at that prompt.

- [ ] **Step 1: Write the failing test**

`tests/session-prompts.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
 $root=Split-Path $PSScriptRoot -Parent
 # Extract one function from session.ps1 by name, so it can be exercised without running
 # session.ps1's top-level code (which needs a profile and docker).
 function Get-SessionFunction([string]$Name) {
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'session.ps1'),[ref]$null,[ref]$null)
  $fn=$ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name },$true) | Select-Object -First 1
  if (!$fn) { throw "No function $Name in session.ps1" }
  $fn.Extent.Text
 }
}

Describe 'session.ps1 prompts in host mode' {
 It 'Select-Indices sends a multi prompt with the labels and parses the answer like typed input' {
  $code=(Get-SessionFunction 'Select-Indices')+"`n"+'Write-Output ((Select-Indices 3 "Numbers to delete" @("api a","api b","api c")) -join "|")'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":["1","3"]}')
  $p=(Get-ControlMessages $r.Out)[0]
  $p.kind | Should -Be 'multi'
  $p.options.label | Should -Be @('api a','api b','api c')
  $p.options.value | Should -Be @('1','2','3')
  $r.Out | Should -Contain '0|2'
 }
 It 'Edit-DatabasePlan asks a choice with 4 options and records remote' {
  $code=(Get-SessionFunction 'Edit-DatabasePlan')+"`n"+'$dockerApiText="the APIs"; $plan=@{Database="asis";Baseline=$null}; Edit-DatabasePlan $plan; Write-Output "db:$($plan.Database)"'
  $r=Invoke-HostSnippet $code -Stdin @('{"id":"p1","value":"4"}')
  $p=(Get-ControlMessages $r.Out)[0]
  $p.kind | Should -Be 'choice'
  $p.options.value | Should -Be @('1','2','3','4')
  $p.default | Should -Be '1'
  $r.Out | Should -Contain 'db:remote'
 }
 It 'Write-Step emits a step event' {
  $code='$uiWidth=60; '+(Get-SessionFunction 'Write-Step')+"`n"+'Write-Step 2 7 "Building APIs"'
  $m=Get-ControlMessages (Invoke-HostSnippet $code).Out
  $m[0].type | Should -Be 'step'
  $m[0].n | Should -Be 2; $m[0].total | Should -Be 7; $m[0].text | Should -Be 'Building APIs'
 }
}

Describe 'session.ps1 prompts in terminal mode' {
 It 'Select-Indices still parses typed input' {
  $code=(Get-SessionFunction 'Select-Indices')+"`n"+'function Read-Host { "2, 3 9" }; Write-Output ((Select-Indices 3 "Numbers" @("a","b","c")) -join "|")'
  (Invoke-HostSnippet $code -NoHost).Out | Should -Contain '1|2'
 }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/session-prompts.Tests.ps1 -Output Detailed"`
Expected: FAIL — no `prompt` control messages (functions still call `Read-Host`).

- [ ] **Step 3: `Write-Step` emits a step event**

Replace the function (≈153-156):

```powershell
function Write-Step([int]$Number,[int]$Total,[string]$Text) {
 Write-DevenvEvent step @{n=$Number;total=$Total;text=$Text}
 Write-Host ''
 Write-Host ("── [$Number/$Total] $Text ").PadRight($uiWidth,'─') -ForegroundColor Cyan
}
```

- [ ] **Step 4: `Edit-BuildPlan` (≈369)**

Replace `$c=([string](Read-Host '   Number to change, or Enter to go back')).Trim()` with:

```powershell
  $keys=@($serviceLabels.Keys)
  $opts=@(for ($k=0; $k -lt $keys.Count; $k++) { @{value="$($k+1)";label=$serviceLabels[$keys[$k]];hint=$Plan.Services[$keys[$k]].Action} })+@(@{value='';label='Done - go back'})
  $c=([string](Request-DevenvInput '   Number to change, or Enter to go back' -Kind choice -Title 'Build: a service cycles skip -> build -> clean rebuild' -Options $opts -Default '')).Trim()
```

- [ ] **Step 5: `Edit-TestPlan` (≈395)**

Replace the `Read-Host` line with:

```powershell
  $opts=@(
   $n=1; foreach ($m in $modes.Keys) { @{value="$n";label=$modes[$m];hint=$(if ($Plan.Test -eq $m) { 'current' })}; $n++ }
   $l=[int][char]'a'; foreach ($t in $testApis) { @{value="$([char]$l)";label="Toggle $($t.Label) :$($t.Test['port'])";hint=$(if ($Plan.TestServices -contains $t.Key) { 'on' } else { 'off' })}; $l++ }
   @{value='';label='Done - go back'}
  )
  $c=([string](Request-DevenvInput '   1-3 = what to do, a letter = toggle an API, Enter to go back' -Kind choice -Title 'Test stack' -Options $opts -Default '')).Trim().ToLowerInvariant()
```

- [ ] **Step 6: `Edit-DatabasePlan` (≈422, ≈449, ≈458)**

Replace `$c=([string](Read-Host '   Choice [1]')).Trim()` with:

```powershell
 $c=([string](Request-DevenvInput '   Choice [1]' -Kind choice -Title 'Database' -Default '1' -Options @(
  @{value='1';label='Leave whatever data is in there now'}
  @{value='2';label='Restore a saved baseline over it';hint='first run, or to reset test data'}
  @{value='3';label='Wipe the SQL volume, then restore a baseline';hint='fresh instance'}
  @{value='4';label='Use the remote DEV database';hint='shared - changes are real'}
 ))).Trim()
```

Replace `$pick=([string](Read-Host "   Number, or Enter for the default ($defaultId)")).Trim()` with:

```powershell
 $opts=@(@{value='';label="Default ($defaultId)"})+@(for ($i=0; $i -lt $backups.Count; $i++) { @{value="$($i+1)";label=$backups[$i].Id;hint=(Format-Bytes $backups[$i].Size)} })
 $pick=([string](Request-DevenvInput "   Number, or Enter for the default ($defaultId)" -Kind choice -Title 'Restore which baseline?' -Options $opts -Default '')).Trim()
```

Replace `if (([string](Read-Host '   Type YES to confirm')).Trim() -ne 'YES') {` with:

```powershell
  if (([string](Request-DevenvInput '   Type YES to confirm' -Kind confirm -ConfirmWord 'YES' -Title 'Wipe the local database?' -Detail 'Everything currently in the local database is deleted.')).Trim() -ne 'YES') {
```

- [ ] **Step 7: `Select-Ref` plain fallback (≈570, ≈576)**

Replace `$choice=Read-Host "Number, R for remote branches, type any other ref (branch/tag/SHA), or Enter for '$current'"` with:

```powershell
  $opts=@(@{value='';label="Keep $current"})+@(for ($i=0; $i -lt $worktrees.Count; $i++) { @{value="$($i+1)";label=$worktrees[$i].Display;hint=(Split-Path $worktrees[$i].Path -Leaf)} })+@(@{value='R';label='Show remote branches'})
  $choice=Request-DevenvInput "Number, R for remote branches, type any other ref (branch/tag/SHA), or Enter for '$current'" -Kind choice -Title "Branch for $Name" -Options $opts -Default '' -AllowText
```

Replace `$rchoice=Read-Host 'Number to pull into a new worktree, or Enter to go back'` with:

```powershell
   $opts=@(@{value='';label='Back'})+@(for ($i=0; $i -lt $remote.Count; $i++) { @{value="$($i+1)";label=$remote[$i]} })
   $rchoice=Request-DevenvInput 'Number to pull into a new worktree, or Enter to go back' -Kind choice -Title "$Name - remote branch for a new worktree" -Options $opts -Default ''
```

- [ ] **Step 8: `Select-Indices` and its callers**

Replace the function header and its `Read-Host` (≈638-641):

```powershell
function Select-Indices([int]$Count,[string]$Prompt,[string[]]$Labels=@()) {
 # Prints nothing itself — caller lists the numbered options first (and passes their labels
 # for NexusMD's checklist). Returns a sorted, de-duplicated array of 0-based indices.
 # Blank input = none; 'all' = every option.
 $opts=@(for ($i=0; $i -lt $Count; $i++) { @{value="$($i+1)";label=$(if ($i -lt $Labels.Count) { $Labels[$i] } else { "$($i+1)" })} })
 $raw=Request-DevenvInput $Prompt -Kind multi -Options $opts
```

(The rest of the function is unchanged: NexusMD's answer arrives as `1,3`, which the existing `-split '[,\s]+'` handles.)

Update the three callers in `'Clean'`:

```powershell
    $pickedBuilds=Select-Indices $builds.Count "Numbers to delete, 'all', or Enter for none" @($builds | ForEach-Object { "$($_.Service) $($_.Sha.Substring(0,[Math]::Min(8,$_.Sha.Length))) ($(Format-Bytes $_.Size))" })
```
```powershell
    $pickedCheckouts=Select-Indices $checkouts.Count "Numbers to delete, 'all', or Enter for none" @($checkouts | ForEach-Object { "$($_.Name) ($(Format-Bytes $_.Size))" })
```
```powershell
    $pickedBackups=Select-Indices $backups.Count "Numbers to delete, 'all', or Enter for none" @($backups | ForEach-Object { "$($_.Id) ($(Format-Bytes $_.Size))" })
```

- [ ] **Step 9: Start plan loop (≈832)**

Replace `$choice=([string](Read-Host "  Enter = start | $serviceRange = change branch | B/D/T/E/I = change a step | Q = cancel")).Trim()` with:

```powershell
   $keys=@($serviceLabels.Keys)
   $opts=@(@{value='';label='Start'})+
    @(for ($k=0; $k -lt $keys.Count; $k++) { @{value="$($k+1)";label="Change branch: $($serviceLabels[$keys[$k]])";hint=$plan.Services[$keys[$k]].Branch} })+
    @(@{value='B';label='Build: change what is built'},@{value='D';label='Database'},@{value='T';label='Test stack'},@{value='E';label='Android emulator on/off'},@{value='I';label='iOS'},@{value='Q';label='Cancel'})
   $choice=([string](Request-DevenvInput "  Enter = start | $serviceRange = change branch | B/D/T/E/I = change a step | Q = cancel" -Kind choice -Title 'Local session - review, then start' -Detail 'The plan is shown in the output above.' -Options $opts -Default '')).Trim()
```

- [ ] **Step 10: `'Clean'` (≈1107, ≈1155, ≈1167, ≈1194, ≈1223)**

```powershell
  $mode=([string](Request-DevenvInput '   Choice [1]' -Kind choice -Title 'Clean - reclaim disk' -Default '1' -Options @(
   @{value='1';label='Remove old commits';hint="$($oldBuilds.Count+$oldCheckouts.Count) items, $(Format-Bytes $oldSize)"}
   @{value='2';label='Remove everything not in use';hint="$($oldBuilds.Count+$allCheckouts.Count) items, $(Format-Bytes $unusedSize)"}
   @{value='3';label='Choose item by item';hint='the only route to the database and saved baselines'}
   @{value='Q';label='Cancel'}
  ))).Trim()
```
```powershell
   $dbChoice=Request-DevenvInput 'Choice [1]' -Kind choice -Title 'Database' -Default '1' -Options @(
    @{value='1';label='Leave the running SQL data exactly as it is'}
    @{value='2';label='Restore a saved baseline over it'}
    @{value='3';label='Wipe the SQL volume entirely';hint='next Up/Start creates a fresh, empty instance'}
   )
```
```powershell
     $opts=@(@{value='';label="Default ($defaultId)"})+@(for ($i=0; $i -lt $backups.Count; $i++) { @{value="$($i+1)";label=$backups[$i].Id;hint=(Format-Bytes $backups[$i].Size)} })
     $restoreChoice=Request-DevenvInput "Which one to restore? Number, or Enter for the default ($defaultId)" -Kind choice -Title 'Restore which baseline?' -Options $opts -Default ''
```
```powershell
  $confirm=Request-DevenvInput "`nProceed? [y/N]" -Kind confirm -Title 'Proceed with the clean?' -Detail 'See the summary in the output above.' -Default 'n' -Options @(@{value='y';label='Yes, proceed'},@{value='n';label='No'})
```
```powershell
     $wipeConfirm=Request-DevenvInput 'Type YES to confirm' -Kind confirm -ConfirmWord 'YES' -Title 'Wipe the SQL volume?' -Detail 'This deletes devenv-sql-data - all current database contents will be lost.'
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS.

- [ ] **Step 12: Smoke-test the terminal is unchanged**

Run: `pwsh -NoProfile -File ./devenv.ps1 help`
Expected: the same help text as before (no `@@devenv` lines). Then in an interactive terminal run `./devenv.ps1 clean`, press `Q` at `Choice [1]` → `Cancelled - nothing deleted.`

- [ ] **Step 13: Commit**

```bash
git add session.ps1 tests/session-prompts.Tests.ps1
git commit -m "feat: send session prompts to NexusMD in host mode"
```

---

### Task 3: Remaining console touch points + no-`Read-Host` guard

**Repository:** `C:\repos\dev-environment`

**Files:**
- Modify: `build-ios.ps1:44` (Mac password)
- Modify: `devenv.ps1` `Invoke-SqlScript` (≈55-75) — SQL script picker
- Modify: `logs.ps1:15-21` `Show-Log` (`less` pager)
- Modify: `test.ps1:503`, `test.ps1:574`, `test.ps1:580`, `docker/database.ps1:228` (`Start-Process` of reports/URLs)
- Modify: `mac-common.ps1:36-41` (`ssh -t` → batch mode in host mode)
- Modify: `ui/devplan-common.ps1` `Get-DevPlanExe` (never build/launch devplan in host mode)
- Test: `tests/no-console.Tests.ps1`

**Interfaces:**
- Consumes: `Request-DevenvInput`, `Open-DevenvTarget`, `Test-DevenvHost` (Task 1).
- Produces: nothing new; guarantees no `Read-Host` and no direct `Start-Process` of a report/URL anywhere outside `host-common.ps1`.

- [ ] **Step 1: Write the failing guard tests**

`tests/no-console.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 $scripts=@(Get-ChildItem $root -Recurse -Include *.ps1 -File |
  Where-Object { $_.FullName -notmatch '[\\/](\.local|tests|profile)[\\/]' -and $_.Name -ne 'host-common.ps1' })
 function Find-Code([string]$Pattern) {
  @($scripts | Select-String -Pattern $Pattern | Where-Object { $_.Line -notmatch '^\s*#' } | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })
 }
}

Describe 'no console interaction outside host-common.ps1' {
 It 'has no Read-Host' { Find-Code '\bRead-Host\b' | Should -BeNullOrEmpty }
 It 'has no pager' { Find-Code '\|\s*(less|more)\b' | Should -BeNullOrEmpty }
 It 'opens reports and URLs through Open-DevenvTarget' { Find-Code 'Start-Process\s+\$(html|url)\b' | Should -BeNullOrEmpty }
 It 'never asks ssh for a terminal in host mode' {
  (Get-Content (Join-Path $root 'mac-common.ps1') -Raw) | Should -Match 'BatchMode=yes'
 }
 It 'never launches devplan in host mode' {
  (Get-Content (Join-Path $root 'ui/devplan-common.ps1') -Raw) | Should -Match 'Test-DevenvHost'
 }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/no-console.Tests.ps1 -Output Detailed"`
Expected: FAIL — lists `build-ios.ps1:44 Read-Host`, `logs.ps1:20 | less`, four `Start-Process $html/$url` sites, and the two `Should -Match` checks.

- [ ] **Step 3: Mac password in `build-ios.ps1:44`**

```powershell
 $secure=Request-DevenvInput "Mac password for $($cfg.user)@$($cfg.host)" -AsSecureString -Title 'Mac password' -Detail "Used once for this build's connection to $($cfg.host); not stored."
```

- [ ] **Step 4: SQL script picker in `devenv.ps1` `Invoke-SqlScript`**

Replace the `if ($entries) { Invoke-DevPlanPicker 'SQL scripts' $entries }` line and the `if ($entries -and $script:DevPlanPickerAvailable) {` block opening with a host-mode branch first:

```powershell
  if ($entries -and (Test-DevenvHost)) {
   $Name=Request-DevenvInput 'SQL script' -Kind choice -Title "Run which SQL script on $Database?" -Options @($entries | ForEach-Object { @{value=$_.id;label=$_.id;hint=$_.about} })
  } else {
  if ($entries) { Invoke-DevPlanPicker 'SQL scripts' $entries }
  if ($entries -and $script:DevPlanPickerAvailable) {
   if (!$script:DevPlanPickerResult) { return }   # cancelled - same outcome as listing and stopping
   $Name=$script:DevPlanPickerResult
  } else {
   Write-Host "SQL scripts in $sqlDir (run one with: devenv db sql <name>):" -ForegroundColor Cyan
   foreach ($e in $entries) { Write-Host ("  {0,-28} {1}" -f $e.id,$e.about) }
   return
  }
  }
```

- [ ] **Step 5: `logs.ps1` `Show-Log`**

```powershell
function Show-Log([string]$Path,[string]$Label) {
 if (!(Test-Path $Path)) {
  Write-Host "$Label not found at $Path" -ForegroundColor Yellow
  return
 }
 # NexusMD shows the whole log in its own scrollable, searchable panel; less needs a console.
 if (Test-DevenvHost) { Get-Content $Path; return }
 Get-Content $Path | & less
}
```

(`& less` keeps the terminal behaviour and doesn't match the guard's `| less` pattern; the guard exists to catch new pagers, and this one is host-mode-safe.)

- [ ] **Step 6: Reports and URLs**

`test.ps1:503` and `test.ps1:574`: `if (!$NoOpen) { Start-Process $html }` → `if (!$NoOpen) { Open-DevenvTarget $html }`
`test.ps1:580`: `Start-Process $url` → `Open-DevenvTarget $url`
`docker/database.ps1:228`: `Start-Process $url` → `Open-DevenvTarget $url`

(`docker/database.ps1:53` starts Docker Desktop and `emulator.ps1:176` starts the emulator window — both are apps, not consoles; leave them.)

- [ ] **Step 7: `mac-common.ps1` — no terminal for ssh in host mode**

Replace `$sshArgs=@('-t','-o','ConnectTimeout=10')` and the `Write-Host "Connecting ..."` line with:

```powershell
 # Under NexusMD there is no terminal for ssh to ask for a password on, so it must fail fast
 # instead of waiting forever: key auth only (mac.json sshKey) until the Mac password flow
 # lands (spec phase 5).
 $sshArgs=if (Test-DevenvHost) { @('-o','BatchMode=yes','-o','ConnectTimeout=10') } else { @('-t','-o','ConnectTimeout=10') }
 if ($cfg.sshKey) { $sshArgs+=@('-i',$cfg.sshKey) }
 $sshArgs+=@("$($cfg.user)@$($cfg.host)",$remote)
 if (Test-DevenvHost) { Write-Host "Connecting to $($cfg.user)@$($cfg.host) with the ssh key from mac.json..." -ForegroundColor DarkGray }
 else { Write-Host "Connecting to $($cfg.user)@$($cfg.host) (ssh may ask for your Mac password)..." -ForegroundColor DarkGray }
```

(Remove the original `if ($cfg.sshKey) ...` and `$sshArgs+=@(...)` lines that followed, since they are now in this block.)

- [ ] **Step 8: `Get-DevPlanExe` — never in host mode**

First line of the function body in `ui/devplan-common.ps1`:

```powershell
 # NexusMD draws its own screens; never build or launch the console UI underneath it.
 if (Get-Command Test-DevenvHost -ErrorAction SilentlyContinue) { if (Test-DevenvHost) { return $null } }
```

- [ ] **Step 9: Run all tests**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add build-ios.ps1 devenv.ps1 logs.ps1 test.ps1 docker/database.ps1 mac-common.ps1 ui/devplan-common.ps1 tests/no-console.Tests.ps1
git commit -m "feat: remove the remaining console interactions in host mode"
```

---

### Task 4: `devenv help --json` command catalog

**Repository:** `C:\repos\dev-environment`

**Files:**
- Modify: `devenv.ps1` — command table entries (add `Mut`, `P`, `Pa`, `Hidden`), new `Write-DevenvCatalog`, dispatch (≈ the `if ($argv.Count -eq 0 -or $argv[0] -in @('help',...` line)
- Modify: `profile.example/commands.ps1` (document the new fields)
- Modify: `README.md` (new section "Running under NexusMD")
- Test: `tests/catalog.Tests.ps1`

**Interfaces:**
- Produces: `devenv help --json` prints one line `@@devenv {"type":"result","kind":"catalog","protocol":1,"profileError":<string|null>,"groups":[{"id","title"}],"commands":[{"group","verb","args","summary","switches":[],"values":[],"mut":bool,"pathValues":{"<value>":"file|folder"},"pathArgs":"file|folder|any|null","hidden":bool}]}` and exits 0, with or without `DEVENV_HOST`.
- Command table fields: `Mut=$false` marks read-only (absent = mutating); `P=@{name='file'|'folder'}` marks valued options that are paths; `Pa='file'|'folder'|'any'` marks positional arguments that are paths; `Hidden=$true` hides a command from NexusMD.

- [ ] **Step 1: Write the failing test**

`tests/catalog.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
 $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') help --json)
 $script:exit=$LASTEXITCODE
 $control=@($lines | Where-Object { $_.StartsWith('@@devenv ') })
 $script:catalog=if ($control) { $control[0].Substring(9) | ConvertFrom-Json -AsHashtable }
 function Get-Cmd([string]$Group,[string]$Verb) { $script:catalog.commands | Where-Object { $_.group -eq $Group -and $_.verb -eq $Verb } }
}
AfterAll { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }

Describe 'devenv help --json' {
 It 'exits 0 with exactly one catalog result line' {
  $script:exit | Should -Be 0
  $script:catalog.type | Should -Be 'result'
  $script:catalog.kind | Should -Be 'catalog'
  $script:catalog.protocol | Should -Be 1
 }
 It 'lists every command with string group/verb and arrays for options' {
  $script:catalog.commands.Count | Should -BeGreaterThan 40
  foreach ($c in $script:catalog.commands) {
   $c.verb | Should -Not -BeNullOrEmpty
   $c.group | Should -BeOfType [string]
   ,$c.switches | Should -BeOfType [object[]]
  }
 }
 It 'marks read-only and mutating commands' {
  (Get-Cmd '' 'status').mut | Should -BeFalse
  (Get-Cmd 'test' 'status').mut | Should -BeFalse
  (Get-Cmd '' 'start').mut | Should -BeTrue
  (Get-Cmd 'db' 'restore').mut | Should -BeTrue
 }
 It 'marks path arguments and path options' {
  (Get-Cmd 'emulator' 'push').pathArgs | Should -Be 'file'
  (Get-Cmd 'api' 'run').pathValues.settings | Should -Be 'file'
  (Get-Cmd 'test' 'run').pathValues.collection | Should -Be 'folder'
  (Get-Cmd 'test' 'bruno-env').pathArgs | Should -Be 'folder'
 }
 It 'hides setup shell' { (Get-Cmd 'setup' 'shell').hidden | Should -BeTrue }
 It 'has a title for every group a command uses' {
  $ids=@($script:catalog.groups.id)
  foreach ($c in $script:catalog.commands) { $ids | Should -Contain $c.group }
 }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL — `help --json` prints the normal help, no control line.

- [ ] **Step 3: Annotate the command table**

In `devenv.ps1`, add these fields to the existing entries (keep everything else on each entry the same):

| Entry | Add |
|---|---|
| `''/status`, `''/doctor` | `Mut=$false` |
| `emulator/status`, `backend/status`, `backend/logs`, `db/status`, `db/verify` | `Mut=$false` |
| `logs/show`, `logs/capture`, `source/doctor` | `Mut=$false` |
| `test/report`, `test/web`, `test/status`, `test/logs`, `mac/doctor` | `Mut=$false` |
| `emulator/push` | `Pa='file'` |
| `db/sql` | `Pa='file'` |
| `api/run` | `P=@{settings='file'}` |
| `test/run` | `Pa='any';P=@{collection='folder'}` |
| `test/bruno-env` | `Pa='folder'` |
| `setup/shell` | `Hidden=$true` |

Example (the `status` entry after the change):

```powershell
 @{G='';V='status';A='';S='Emulator, containers and proxy at a glance';Sw=@();Val=@();Mut=$false
   Run={ Invoke-Script 'session.ps1' @{Action='Status'} }}
```

Update the comment above the table to describe the new fields:

```powershell
# G = group ('' = top-level shortcut), V = action, A = positional arguments (for help),
# S = summary, Sw = switch options, Val = options that take a value,
# Mut = $false for read-only commands (NexusMD runs those alongside others; absent = changes state),
# P = @{option='file'|'folder'} for path-valued options, Pa = 'file'|'folder'|'any' when the
# positional arguments are paths, Hidden = $true to keep a command out of NexusMD,
# Run = { param($a,$o) } with $a = positional arguments, $o = options keyed without dashes.
```

- [ ] **Step 4: Add `Write-DevenvCatalog` (below `Show-Help`)**

```powershell
function Write-DevenvCatalog {
 # The command table as data, for NexusMD's Commands screen (protocol 1). Printed even
 # without DEVENV_HOST so it can be inspected from a terminal.
 $list=foreach ($c in $commands) {
  [ordered]@{
   group=[string]$c.G; verb=[string]$c.V; args=[string]$c.A; summary=[string]$c.S
   switches=@($c.Sw | ForEach-Object { [string]$_ }); values=@($c.Val | ForEach-Object { [string]$_ })
   mut=$(if ($c.ContainsKey('Mut')) { [bool]$c.Mut } else { $true })
   pathValues=$(if ($c.P) { $c.P } else { @{} })
   pathArgs=$(if ($c.Pa) { [string]$c.Pa } else { $null })
   hidden=[bool]$c.Hidden
  }
 }
 $groups=[Collections.Generic.List[object]]::new()
 foreach ($g in $groupTitles.Keys) { $groups.Add([ordered]@{id=[string]$g;title=$groupTitles[$g]}) }
 foreach ($c in $commands) { if (!($groups | Where-Object { $_.id -eq $c.G })) { $groups.Add([ordered]@{id=[string]$c.G;title=[string]$c.G}) } }
 Write-DevenvEvent result @{kind='catalog';protocol=1;profileError=$profileError;groups=@($groups);commands=@($list)} -Force
}
```

- [ ] **Step 5: Dispatch `help --json`**

Immediately before `if ($argv.Count -eq 0 -or $argv[0] -in @('help','--help','-h','-?','/?')) {`:

```powershell
if ($argv.Count -ge 1 -and $argv[0] -eq 'help' -and $argv -contains '--json') { Write-DevenvCatalog; exit 0 }
```

- [ ] **Step 6: Document the fields for profile commands**

In `profile.example/commands.ps1`, extend the field comment block:

```powershell
# Optional, for NexusMD: Mut=$false (read-only - may run alongside other commands; absent means
# it changes state), P=@{option='file'|'folder'} (path-valued options get a Browse button),
# Pa='file'|'folder'|'any' (positional arguments are paths), Hidden=$true (terminal only).
```

- [ ] **Step 7: README section**

Add to `README.md` before `## Limits`:

```markdown
## Running under NexusMD

NexusMD's desktop app (Dev Environment) runs devenv with `DEVENV_HOST=nexusmd` and no console.
In that mode every question devenv asks is sent to NexusMD as a `@@devenv {...}` line on stdout
and answered with one JSON line on stdin (`host-common.ps1`), reports and URLs are opened by
NexusMD, and the devplan console UI is never started. `devenv help --json` lists every command
(including the profile's) for NexusMD's Commands screen. Without `DEVENV_HOST` nothing changes.

Rules for new code: ask with `Request-DevenvInput` (never `Read-Host`), open things with
`Open-DevenvTarget` (never `Start-Process` on a report or URL), and mark new commands
`Mut=$false` when they only read. `tests/no-console.Tests.ps1` enforces the first two:
`pwsh -NoProfile -Command "Invoke-Pester ./tests -Output Detailed"`.

Mac commands under NexusMD need key auth (`sshKey` in `mac.json`) for now.
```

- [ ] **Step 8: Run all tests**

Run: `pwsh -NoProfile -Command "Invoke-Pester ./tests -Output Detailed"`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add devenv.ps1 profile.example/commands.ps1 README.md tests/catalog.Tests.ps1
git commit -m "feat: export the command table with devenv help --json"
```

---

### Task 5: Core `devenv` module — protocol, ANSI, run state

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `packages/core/src/modules/devenv/protocol.js`
- Create: `packages/core/src/modules/devenv/ansi.js`
- Create: `packages/core/src/modules/devenv/run-state.js`
- Test: `packages/core/src/modules/devenv/protocol.test.js`, `ansi.test.js`, `run-state.test.js`

**Interfaces:**
- Produces:
  - `CONTROL_PREFIX = '@@devenv '`, `PROTOCOL_VERSION = 1`
  - `parseLine(line: string) → { type: 'output', text } | { type: 'prompt'|'step'|'result'|'open'|string, ...fields }`
  - `ansiToSpans(line: string) → { text: string, color: string|null, bold: boolean }[]`
  - `stripAnsi(line: string) → string`
  - `createRunState(command?: string) → RunState` where `RunState = { command, runId: number|null, status: 'idle'|'starting'|'running'|'done'|'failed'|'cancelled', lines: {stream,text}[], prompts: Prompt[], step: {n,total,text}|null, results: object[], opens: object[], exitCode: number|null, error: string|null, cancelling: boolean }`
  - `applyStarting(state)`, `applyStarted(state, runId)`, `applyStartFailed(state, message)`, `applyLine(state, stream: 'stdout'|'stderr', line)`, `applyAnswered(state, promptId)`, `applyOpened(state)`, `applyCancelRequested(state)`, `applyExit(state, code)` — all pure, return new state
  - `MAX_LINES = 5000`

- [ ] **Step 1: Write the failing tests**

`protocol.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseLine, CONTROL_PREFIX, PROTOCOL_VERSION } from './protocol.js'

describe('parseLine', () => {
  it('treats ordinary lines as output', () => {
    expect(parseLine('Building api...')).toEqual({ type: 'output', text: 'Building api...' })
  })
  it('parses control lines', () => {
    const msg = parseLine(CONTROL_PREFIX + '{"type":"prompt","id":"p1","kind":"choice","options":[{"value":"1","label":"a"}]}')
    expect(msg).toEqual({ type: 'prompt', id: 'p1', kind: 'choice', options: [{ value: '1', label: 'a' }] })
  })
  it('falls back to output for malformed JSON or a missing type', () => {
    expect(parseLine('@@devenv {nope')).toEqual({ type: 'output', text: '@@devenv {nope' })
    expect(parseLine('@@devenv {"id":"p1"}')).toEqual({ type: 'output', text: '@@devenv {"id":"p1"}' })
  })
  it('handles non-strings', () => {
    expect(parseLine(undefined)).toEqual({ type: 'output', text: '' })
  })
  it('is protocol 1', () => { expect(PROTOCOL_VERSION).toBe(1) })
})
```

`ansi.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { ansiToSpans, stripAnsi } from './ansi.js'

describe('ansiToSpans', () => {
  it('returns one plain span for plain text', () => {
    expect(ansiToSpans('hello')).toEqual([{ text: 'hello', color: null, bold: false }])
  })
  it('splits on colour codes and resets', () => {
    expect(ansiToSpans('\x1b[32mok\x1b[0m done')).toEqual([
      { text: 'ok', color: 'green', bold: false },
      { text: ' done', color: null, bold: false },
    ])
  })
  it('handles bold + bright colours and combined codes', () => {
    expect(ansiToSpans('\x1b[1;91mFAILED\x1b[0m')).toEqual([{ text: 'FAILED', color: 'red', bold: true }])
  })
  it('drops non-colour escapes', () => {
    expect(ansiToSpans('\x1b[2Kline\x1b[?25l')).toEqual([{ text: 'line', color: null, bold: false }])
  })
  it('stripAnsi removes all escapes', () => {
    expect(stripAnsi('\x1b[36m── [1/3] Build \x1b[0m')).toBe('── [1/3] Build ')
  })
})
```

`run-state.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  createRunState, applyStarting, applyStarted, applyStartFailed, applyLine,
  applyAnswered, applyOpened, applyCancelRequested, applyExit, MAX_LINES,
} from './run-state.js'

const P = '@@devenv '
const run = () => applyStarted(applyStarting(createRunState('db restore')), 7)

describe('run state', () => {
  it('starts idle, then running with a runId', () => {
    expect(createRunState('x').status).toBe('idle')
    const s = run()
    expect(s.status).toBe('running')
    expect(s.runId).toBe(7)
  })

  it('collects output lines from both streams, control lines only from stdout', () => {
    let s = applyLine(run(), 'stdout', 'hello')
    s = applyLine(s, 'stderr', P + '{"type":"step","n":1,"total":2,"text":"x"}')
    expect(s.lines).toEqual([{ stream: 'stdout', text: 'hello' }, { stream: 'stderr', text: P + '{"type":"step","n":1,"total":2,"text":"x"}' }])
    expect(s.step).toBeNull()
  })

  it('queues prompts, tracks the latest step, and keeps results and opens', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"text","title":"Ref"}')
    s = applyLine(s, 'stdout', P + '{"type":"step","n":2,"total":5,"text":"Build"}')
    s = applyLine(s, 'stdout', P + '{"type":"result","kind":"summary"}')
    s = applyLine(s, 'stdout', P + '{"type":"open","url":"http://127.0.0.1:5280"}')
    expect(s.prompts.map(p => p.id)).toEqual(['p1'])
    expect(s.step).toEqual({ n: 2, total: 5, text: 'Build' })
    expect(s.results).toEqual([{ type: 'result', kind: 'summary' }])
    expect(s.opens).toEqual([{ type: 'open', url: 'http://127.0.0.1:5280' }])
    expect(s.lines).toEqual([])
    expect(applyOpened(s).opens).toEqual([])
  })

  it('ignores unknown control types instead of showing them', () => {
    expect(applyLine(run(), 'stdout', P + '{"type":"future-thing"}').lines).toEqual([])
  })

  it('removes an answered prompt and never stores the answer', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"secret","title":"Mac password"}')
    s = applyAnswered(s, 'p1')
    expect(s.prompts).toEqual([])
    expect(JSON.stringify(s)).not.toContain('hunter22')
  })

  it('caps the output buffer', () => {
    let s = run()
    for (let i = 0; i < MAX_LINES + 10; i++) s = applyLine(s, 'stdout', `line ${i}`)
    expect(s.lines).toHaveLength(MAX_LINES)
    expect(s.lines[0].text).toBe('line 10')
  })

  it('exit 0 is done, non-zero is failed, and pending prompts are dropped', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"text","title":"x"}')
    expect(applyExit(s, 0).status).toBe('done')
    const failed = applyExit(s, 1)
    expect(failed.status).toBe('failed')
    expect(failed.exitCode).toBe(1)
    expect(failed.prompts).toEqual([])
  })

  it('a cancelled run ends as cancelled whatever the exit code', () => {
    let s = applyLine(run(), 'stdout', P + '{"type":"prompt","id":"p1","kind":"choice","title":"x"}')
    s = applyCancelRequested(s)
    expect(s.cancelling).toBe(true)
    s = applyExit(s, 1)
    expect(s.status).toBe('cancelled')
    expect(s.prompts).toEqual([])
  })

  it('a failed start records the message', () => {
    const s = applyStartFailed(applyStarting(createRunState('x')), 'No devenv.ps1 in C:\\nope')
    expect(s.status).toBe('failed')
    expect(s.error).toBe('No devenv.ps1 in C:\\nope')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `protocol.js`**

```js
// packages/core/src/modules/devenv/protocol.js
//
// devenv's host-mode protocol (C:\repos\dev-environment\host-common.ps1): any stdout line
// starting with CONTROL_PREFIX is one JSON control message; everything else is output.

export const CONTROL_PREFIX = '@@devenv '
export const PROTOCOL_VERSION = 1

/**
 * Classify one stdout line from devenv.
 * @param {string} line
 * @returns {{ type: string, [key: string]: any }} `{ type: 'output', text }` for ordinary
 *   output (and anything malformed), otherwise the parsed control message.
 */
export function parseLine(line) {
  if (typeof line !== 'string') return { type: 'output', text: '' }
  if (!line.startsWith(CONTROL_PREFIX)) return { type: 'output', text: line }
  try {
    const msg = JSON.parse(line.slice(CONTROL_PREFIX.length))
    if (msg && typeof msg.type === 'string') return msg
  } catch { /* malformed control lines are shown as output so nothing is silently lost */ }
  return { type: 'output', text: line }
}
```

- [ ] **Step 4: Implement `ansi.js`**

```js
// packages/core/src/modules/devenv/ansi.js
//
// devenv's Write-Host colours arrive as ANSI SGR codes (host mode sets
// $PSStyle.OutputRendering='Ansi'); docker/git add their own. Only colour and bold are kept.

const ESC = /\x1b\[([0-9;?]*)([A-Za-z])/g
const COLORS = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'gray', 91: 'red', 92: 'green', 93: 'yellow', 94: 'blue', 95: 'magenta', 96: 'cyan', 97: 'white',
}

/**
 * @param {string} line
 * @returns {{ text: string, color: string|null, bold: boolean }[]}
 */
export function ansiToSpans(line) {
  const spans = []
  let color = null
  let bold = false
  let last = 0
  const push = text => {
    if (!text) return
    const prev = spans[spans.length - 1]
    if (prev && prev.color === color && prev.bold === bold) prev.text += text
    else spans.push({ text, color, bold })
  }
  for (const m of String(line ?? '').matchAll(ESC)) {
    push(line.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== 'm') continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (const c of codes) {
      if (c === 0) { color = null; bold = false }
      else if (c === 1) bold = true
      else if (c === 22) bold = false
      else if (c === 39) color = null
      else if (COLORS[c]) color = COLORS[c]
    }
  }
  push(String(line ?? '').slice(last))
  return spans.length ? spans : [{ text: '', color: null, bold: false }]
}

/** @param {string} line */
export function stripAnsi(line) {
  return String(line ?? '').replace(ESC, '')
}
```

- [ ] **Step 5: Implement `run-state.js`**

```js
// packages/core/src/modules/devenv/run-state.js
//
// State of one devenv run as the renderer sees it, built only from the events Electron
// forwards. Answers to prompts are never stored here (they may be passwords).

import { parseLine } from './protocol.js'

export const MAX_LINES = 5000

export function createRunState(command = '') {
  return {
    command, runId: null, status: 'idle', lines: [], prompts: [], step: null,
    results: [], opens: [], exitCode: null, error: null, cancelling: false,
  }
}

export function applyStarting(state) {
  return { ...createRunState(state.command), status: 'starting' }
}

export function applyStarted(state, runId) {
  return { ...state, runId, status: 'running' }
}

export function applyStartFailed(state, message) {
  return { ...state, status: 'failed', error: message }
}

/**
 * @param {'stdout'|'stderr'} stream
 * @param {string} line
 */
export function applyLine(state, stream, line) {
  const msg = stream === 'stdout' ? parseLine(line) : { type: 'output', text: line ?? '' }
  switch (msg.type) {
    case 'output': {
      const lines = [...state.lines, { stream, text: msg.text }]
      return { ...state, lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines }
    }
    case 'prompt': return { ...state, prompts: [...state.prompts, msg] }
    case 'step':   return { ...state, step: { n: msg.n, total: msg.total, text: msg.text } }
    case 'result': return { ...state, results: [...state.results, msg] }
    case 'open':   return { ...state, opens: [...state.opens, msg] }
    default:       return state
  }
}

export function applyAnswered(state, promptId) {
  return { ...state, prompts: state.prompts.filter(p => p.id !== promptId) }
}

export function applyOpened(state) {
  return { ...state, opens: [] }
}

export function applyCancelRequested(state) {
  return { ...state, cancelling: true }
}

export function applyExit(state, code) {
  const status = state.cancelling ? 'cancelled' : code === 0 ? 'done' : 'failed'
  return { ...state, status, exitCode: code, prompts: [], cancelling: false }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm -w packages/core exec vitest run src/modules/devenv`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/devenv
git commit -m "feat(core): add devenv protocol, ANSI and run-state helpers"
```

---

### Task 6: Core `devenv` module — catalog, registration, adapter contract

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `packages/core/src/modules/devenv/catalog.js`
- Create: `packages/core/src/modules/devenv/index.js`
- Modify: `packages/core/src/adapters/index.js` (add `IDevenvAdapter` after `IDbManagerAdapter`)
- Modify: `packages/core/src/index.js` (export the module after the db-manager exports, ≈line 78)
- Test: `packages/core/src/modules/devenv/catalog.test.js`, `packages/core/src/modules/devenv/index.test.js`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION`, `parseLine`, `ansiToSpans`, `stripAnsi`, run-state functions (Task 5).
- Produces (all exported from `@nexusmd/core`):
  - `normaliseCatalog(result) → { protocol, profileError: string|null, groups: {id,title}[], commands: Command[] }`, `Command = { key, group, verb, args, summary, switches: string[], values: string[], mut: boolean, pathValues: Record<string,'file'|'folder'>, pathArgs: 'file'|'folder'|'any'|null, hidden: boolean }`
  - `isCompatibleCatalog(catalog) → boolean`
  - `takesArgs(command) → boolean`, `takesManyArgs(command) → boolean`
  - `buildDevenvArgv(command, { positional?: string[], switches?: Record<string,boolean>, values?: Record<string,string> }) → string[]`
  - `getDevenvAdapter() → adapter|null`
  - everything from Task 5 (`parseDevenvLine` alias of `parseLine`, `ansiToSpans`, `stripAnsi`, `createRunState`, `applyStarting`, `applyStarted`, `applyStartFailed`, `applyLine`, `applyAnswered`, `applyOpened`, `applyCancelRequested`, `applyExit`, `DEVENV_PROTOCOL_VERSION`)
- Adapter contract `devenv`: `isAvailable() → boolean`, `run(config, argv, { exclusive, label }) → Promise<{ runId }>`, `answer(runId, { id, value } | { id, cancel: true }) → Promise`, `cancel(runId) → Promise`, `catalog(config) → Promise<catalogResult>`, `open({ url } | { path }) → Promise`, `onLine(cb: ({ runId, stream, line }) => void) → unsubscribe`, `onExit(cb: ({ runId, code, cancelled }) => void) → unsubscribe`. `config = { root, pwsh, profile }`.

- [ ] **Step 1: Write the failing tests**

`catalog.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseCatalog, isCompatibleCatalog, buildDevenvArgv, takesArgs, takesManyArgs } from './catalog.js'

const raw = {
  type: 'result', kind: 'catalog', protocol: 1, profileError: null,
  groups: [{ id: '', title: 'Everyday' }, { id: 'emulator', title: 'Emulator' }, { id: 'test', title: 'API test stack' }],
  commands: [
    { group: '', verb: 'status', args: '', summary: 'At a glance', switches: [], values: [], mut: false, pathValues: {}, pathArgs: null, hidden: false },
    { group: 'emulator', verb: 'push', args: '<file> [<file>...]', summary: 'Copy files', switches: [], values: ['to'], mut: true, pathValues: {}, pathArgs: 'file', hidden: false },
    { group: 'test', verb: 'run', args: '[<folder or .bru>...]', summary: 'Run Bruno', switches: ['no-open', 'all-apis'], values: ['collection', 'env'], mut: true, pathValues: { collection: 'folder' }, pathArgs: 'any', hidden: false },
    { group: 'orders', verb: 'seed', args: '', summary: 'Profile command', switches: [], values: ['count'] },
    { group: 'setup', verb: 'shell', args: '', summary: 'x', switches: [], values: [], hidden: true },
  ],
}

describe('normaliseCatalog', () => {
  const c = normaliseCatalog(raw)
  it('keys commands by "group verb"', () => {
    expect(c.commands.map(x => x.key)).toEqual(['status', 'emulator push', 'test run', 'orders seed', 'setup shell'])
  })
  it('treats a command without mut as mutating (profile commands)', () => {
    expect(c.commands.find(x => x.key === 'orders seed').mut).toBe(true)
    expect(c.commands.find(x => x.key === 'status').mut).toBe(false)
  })
  it('keeps group order from the catalog and adds groups it did not title', () => {
    expect(c.groups.map(g => g.id)).toEqual(['', 'emulator', 'test', 'orders', 'setup'])
    expect(c.groups.find(g => g.id === 'orders').title).toBe('orders')
  })
  it('defaults missing fields safely', () => {
    const seed = c.commands.find(x => x.key === 'orders seed')
    expect(seed.pathValues).toEqual({})
    expect(seed.pathArgs).toBeNull()
    expect(seed.hidden).toBe(false)
  })
  it('rejects something that is not a catalog', () => {
    expect(() => normaliseCatalog({ kind: 'summary' })).toThrow(/catalog/)
  })
})

describe('isCompatibleCatalog', () => {
  it('needs protocol 1', () => {
    expect(isCompatibleCatalog(normaliseCatalog(raw))).toBe(true)
    expect(isCompatibleCatalog(normaliseCatalog({ ...raw, protocol: 2 }))).toBe(false)
  })
})

describe('buildDevenvArgv', () => {
  const c = normaliseCatalog(raw)
  const cmd = key => c.commands.find(x => x.key === key)
  it('top-level shortcuts are just the verb', () => {
    expect(buildDevenvArgv(cmd('status'))).toEqual(['status'])
  })
  it('adds trimmed non-empty positionals, ticked switches and filled values in catalog order', () => {
    expect(buildDevenvArgv(cmd('test run'), {
      positional: [' smoke ', '', 'orders/get.bru'],
      switches: { 'all-apis': true, 'no-open': false },
      values: { env: 'docker', collection: 'C:\\My Tests\\coll' },
    })).toEqual(['test', 'run', 'smoke', 'orders/get.bru', '--all-apis', '--collection', 'C:\\My Tests\\coll', '--env', 'docker'])
  })
  it('ignores switches and values the command does not declare', () => {
    expect(buildDevenvArgv(cmd('status'), { switches: { evil: true }, values: { x: '1' } })).toEqual(['status'])
  })
})

describe('takesArgs / takesManyArgs', () => {
  const c = normaliseCatalog(raw)
  it('reads the args text', () => {
    expect(takesArgs(c.commands[0])).toBe(false)
    expect(takesArgs(c.commands[1])).toBe(true)
    expect(takesManyArgs(c.commands[1])).toBe(true)
  })
})
```

`index.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { getRegistry } from '../../features/module-registry.js'
import './index.js'

describe('devenv module registration', () => {
  it('registers a desktop-gated, off-by-default module', () => {
    const m = getRegistry().find(x => x.id === 'devenv')
    expect(m.name).toBe('Dev Environment')
    expect(m.requiredAdapters).toEqual(['devenv'])
    expect(m.defaultEnabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv`
Expected: FAIL — `catalog.js` / `index.js` not found.

- [ ] **Step 3: Implement `catalog.js`**

```js
// packages/core/src/modules/devenv/catalog.js
//
// devenv's command table, as exported by `devenv help --json`, turned into what the
// Commands screen needs: a form per command and the argv that runs it.

import { PROTOCOL_VERSION } from './protocol.js'

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const strings = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const PATH_ARGS = ['file', 'folder', 'any']

export function commandKey(c) {
  return [c.group, c.verb].filter(Boolean).join(' ')
}

/**
 * @param {object} result  The `result` control message with kind 'catalog'.
 */
export function normaliseCatalog(result) {
  if (!result || result.kind !== 'catalog') throw new Error('Not a devenv catalog')
  const commands = (Array.isArray(result.commands) ? result.commands : []).map(c => {
    const cmd = {
      group: str(c.group), verb: str(c.verb), args: str(c.args), summary: str(c.summary),
      switches: strings(c.switches), values: strings(c.values),
      // Profile commands written before NexusMD existed have no Mut: assume they change state.
      mut: c.mut !== false,
      pathValues: c.pathValues && typeof c.pathValues === 'object' && !Array.isArray(c.pathValues) ? c.pathValues : {},
      pathArgs: PATH_ARGS.includes(c.pathArgs) ? c.pathArgs : null,
      hidden: c.hidden === true,
    }
    return { ...cmd, key: commandKey(cmd) }
  })
  const used = new Set(commands.map(c => c.group))
  const groups = []
  for (const g of Array.isArray(result.groups) ? result.groups : []) {
    const id = str(g.id)
    if (used.has(id) && !groups.some(x => x.id === id)) groups.push({ id, title: str(g.title) || id })
  }
  for (const id of used) if (!groups.some(x => x.id === id)) groups.push({ id, title: id || 'Everyday' })
  return { protocol: result.protocol, profileError: result.profileError || null, groups, commands }
}

export function isCompatibleCatalog(catalog) {
  return catalog?.protocol === PROTOCOL_VERSION
}

export function takesArgs(command) {
  return command.args.trim() !== ''
}

export function takesManyArgs(command) {
  return command.args.includes('...')
}

/**
 * The argv for devenv.ps1. Only switches/values the command declares are passed.
 * @param {object} command  A normalised catalog command.
 * @param {{ positional?: string[], switches?: Record<string, boolean>, values?: Record<string, string> }} [form]
 * @returns {string[]}
 */
export function buildDevenvArgv(command, { positional = [], switches = {}, values = {} } = {}) {
  const argv = command.group ? [command.group, command.verb] : [command.verb]
  for (const p of positional) {
    const v = str(p).trim()
    if (v) argv.push(v)
  }
  for (const s of command.switches) if (switches[s]) argv.push(`--${s}`)
  for (const name of command.values) {
    const v = str(values[name]).trim()
    if (v) argv.push(`--${name}`, v)
  }
  return argv
}
```

- [ ] **Step 4: Implement `index.js`**

```js
// packages/core/src/modules/devenv/index.js
//
// Dev Environment — drives devenv (C:\repos\dev-environment) from NexusMD desktop.
// Pure logic only; processes are started by the desktop-only `devenv` adapter.

import { registerModule } from '../../features/module-registry.js'

export { CONTROL_PREFIX as DEVENV_CONTROL_PREFIX, PROTOCOL_VERSION as DEVENV_PROTOCOL_VERSION, parseLine as parseDevenvLine } from './protocol.js'
export { ansiToSpans, stripAnsi } from './ansi.js'
export {
  MAX_LINES as DEVENV_MAX_LINES, createRunState, applyStarting, applyStarted, applyStartFailed,
  applyLine, applyAnswered, applyOpened, applyCancelRequested, applyExit,
} from './run-state.js'
export { normaliseCatalog, isCompatibleCatalog, takesArgs, takesManyArgs, buildDevenvArgv, commandKey as devenvCommandKey } from './catalog.js'

let _adapter = null

export function getDevenvAdapter() {
  return _adapter
}

registerModule({
  id: 'devenv',
  name: 'Dev Environment',
  // Desktop-only: running pwsh needs the Electron main process.
  requiredAdapters: ['devenv'],
  defaultEnabled: false,
  init(adapters) {
    _adapter = adapters.devenv
  },
  async load() {
    // Action-oriented module — nothing to poll.
    return {}
  },
})
```

Check the db-manager registration in `packages/core/src/modules/db-manager/index.js:256-280` for any further descriptor fields (e.g. `dispose`) and mirror them (setting `_adapter = null` in `dispose`).

- [ ] **Step 5: Adapter contract**

In `packages/core/src/adapters/index.js`, after `IDbManagerAdapter`:

```js
// Dev Environment — desktop-only (pwsh runs in the Electron main process). Absence from
// createNoOpAdapters() gates the devenv module to platforms that supply it.
export const IDevenvAdapter = {
  isAvailable: () => false,
  run:     async (config, argv, opts) => Promise.reject(new Error('IDevenvAdapter.run not implemented')),
  answer:  async (runId, answer) => Promise.reject(new Error('IDevenvAdapter.answer not implemented')),
  cancel:  async (runId) => Promise.reject(new Error('IDevenvAdapter.cancel not implemented')),
  catalog: async (config) => Promise.reject(new Error('IDevenvAdapter.catalog not implemented')),
  open:    async (target) => Promise.reject(new Error('IDevenvAdapter.open not implemented')),
  onLine:  (cb) => () => {},
  onExit:  (cb) => () => {},
}
```

- [ ] **Step 6: Export from `@nexusmd/core`**

In `packages/core/src/index.js`, after the db-manager query-builder export block:

```js
export {
  getDevenvAdapter, DEVENV_CONTROL_PREFIX, DEVENV_PROTOCOL_VERSION, parseDevenvLine,
  ansiToSpans, stripAnsi,
  DEVENV_MAX_LINES, createRunState, applyStarting, applyStarted, applyStartFailed,
  applyLine, applyAnswered, applyOpened, applyCancelRequested, applyExit,
  normaliseCatalog, isCompatibleCatalog, takesArgs, takesManyArgs, buildDevenvArgv, devenvCommandKey,
} from './modules/devenv/index.js'
```

- [ ] **Step 7: Run tests**

Run: `npm -w packages/core test`
Expected: PASS (whole core suite, including any registry tests that list module ids — update such a list if one asserts the exact set).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/modules/devenv packages/core/src/adapters/index.js packages/core/src/index.js
git commit -m "feat(core): add devenv module with command catalog"
```

---

### Task 7: Electron process runner (`ipc/devenv.cjs`)

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/electron/ipc/devenv.cjs`
- Modify: `apps/desktop/electron/main.cjs` — require (≈line 66), register (≈line 326), `before-quit` (≈line 436)
- Test: `apps/desktop/electron/ipc/devenv.test.js`

**Interfaces:**
- Produces IPC channels: `devenv:run (config, argv, { exclusive, label }) → { runId }`, `devenv:answer (runId, { id, value } | { id, cancel: true }) → { ok }`, `devenv:cancel (runId) → { ok }`, `devenv:catalog (config) → catalog result message`, `devenv:open ({ url } | { path }) → { ok }`. Events sent to the renderer: `devenv:line { runId, stream: 'stdout'|'stderr', line }`, `devenv:exit { runId, code, cancelled }`.
- Module exports: `register(ipcMain, deps) → { disposeAll(): Promise<void> }`, `buildInvocation(config, argv, fileExists) → { command, args, options }`, `lineSplitter(onLine) → { push(chunk), end() }`.
- `deps`: `{ spawn, kill(pid) → Promise, send(channel, msg), shell: { openExternal, openPath }, fileExists(path) → boolean, logger }`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/electron/ipc/devenv.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { register, buildInvocation, lineSplitter } from './devenv.cjs'

const CONFIG = { root: 'C:\\Program Files\\dev env', pwsh: 'pwsh', profile: '' }

function fakeChild(pid = 4242) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() }
  child.pid = pid
  child.finish = code => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code)) }
  return child
}

function setup() {
  const handlers = {}
  const children = []
  const sent = []
  const logged = []
  const deps = {
    spawn: vi.fn(() => { const c = fakeChild(4242 + children.length); children.push(c); return c }),
    kill: vi.fn(async () => {}),
    send: (channel, msg) => sent.push({ channel, msg }),
    shell: { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => '') },
    fileExists: () => true,
    logger: { scope: () => ({ error: (...a) => logged.push(a), info: () => {} }) },
  }
  const api = register({ handle: (c, fn) => { handlers[c] = fn } }, deps)
  return { handlers, children, sent, logged, deps, api }
}

const tick = () => new Promise(r => setImmediate(r))

describe('buildInvocation', () => {
  it('runs devenv.ps1 hidden, non-interactive, with argv as separate args (spaces safe)', () => {
    const inv = buildInvocation(CONFIG, ['test', 'run', 'C:\\My Tests\\a b'], () => true)
    expect(inv.command).toBe('pwsh')
    expect(inv.args).toEqual(['-NoProfile', '-NonInteractive', '-File', 'C:\\Program Files\\dev env\\devenv.ps1', 'test', 'run', 'C:\\My Tests\\a b'])
    expect(inv.options.windowsHide).toBe(true)
    expect(inv.options.shell).toBeUndefined()
    expect(inv.options.env.DEVENV_HOST).toBe('nexusmd')
    expect(inv.options.env.DEVENV_PROFILE).toBeUndefined()
  })
  it('passes the profile folder through DEVENV_PROFILE', () => {
    expect(buildInvocation({ ...CONFIG, profile: 'D:\\prof' }, [], () => true).options.env.DEVENV_PROFILE).toBe('D:\\prof')
  })
  it('refuses a relative or missing devenv folder and non-string args', () => {
    expect(() => buildInvocation({ root: 'dev' }, [], () => true)).toThrow(/absolute/)
    expect(() => buildInvocation(CONFIG, [], () => false)).toThrow(/No devenv\.ps1/)
    expect(() => buildInvocation(CONFIG, [1], () => true)).toThrow(/strings/)
  })
})

describe('lineSplitter', () => {
  it('reassembles lines split across chunks, strips CR, flushes the tail', () => {
    const lines = []
    const s = lineSplitter(l => lines.push(l))
    s.push(Buffer.from('one\r\ntw'))
    s.push(Buffer.from('o\nthree'))
    s.end()
    expect(lines).toEqual(['one', 'two', 'three'])
  })
  it('keeps multi-byte characters split across chunks intact', () => {
    const lines = []
    const s = lineSplitter(l => lines.push(l))
    const bytes = Buffer.from('── [1/3] Build —\n')
    s.push(bytes.subarray(0, 2))
    s.push(bytes.subarray(2))
    s.end()
    expect(lines).toEqual(['── [1/3] Build —'])
  })
})

describe('devenv ipc', () => {
  let t
  beforeEach(() => { t = setup() })

  it('streams lines and the exit code for a run', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })
    const c = t.children[0]
    c.stdout.write('hello\n')
    c.stderr.write('warn\n')
    c.finish(0)
    await tick(); await tick()
    expect(t.sent).toEqual([
      { channel: 'devenv:line', msg: { runId, stream: 'stdout', line: 'hello' } },
      { channel: 'devenv:line', msg: { runId, stream: 'stderr', line: 'warn' } },
      { channel: 'devenv:exit', msg: { runId, code: 0, cancelled: false } },
    ])
  })

  it('refuses a second exclusive run but allows read-only ones alongside', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true, label: 'start' })
    await expect(t.handlers['devenv:run'](null, CONFIG, ['stop'], { exclusive: true })).rejects.toThrow(/still running "start"/)
    await expect(t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })).resolves.toHaveProperty('runId')
  })

  it('frees the exclusive slot when the run exits', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true })
    t.children[0].finish(1)
    await tick(); await tick()
    await expect(t.handlers['devenv:run'](null, CONFIG, ['stop'], { exclusive: true })).resolves.toHaveProperty('runId')
  })

  it('writes answers as one JSON line and never logs them', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['build', 'ios', '--password'], {})
    await t.handlers['devenv:answer'](null, runId, { id: 'p1', value: 'hunter22' })
    expect(t.children[0].stdin.write).toHaveBeenCalledWith('{"id":"p1","value":"hunter22"}\n')
    await t.handlers['devenv:answer'](null, runId, { id: 'p2', cancel: true })
    expect(t.children[0].stdin.write).toHaveBeenLastCalledWith('{"id":"p2","cancel":true}\n')
    expect(JSON.stringify(t.logged)).not.toContain('hunter22')
  })

  it('cancel kills the process tree and the exit is marked cancelled', async () => {
    const { runId } = await t.handlers['devenv:run'](null, CONFIG, ['start'], {})
    await t.handlers['devenv:cancel'](null, runId)
    expect(t.deps.kill).toHaveBeenCalledWith(4242)
    t.children[0].finish(1)
    await tick(); await tick()
    expect(t.sent.at(-1)).toEqual({ channel: 'devenv:exit', msg: { runId, code: 1, cancelled: true } })
  })

  it('reports a pwsh that cannot start as a stderr line and exit -1', async () => {
    const { runId } = await t.handlers['devenv:run'](null, { ...CONFIG, pwsh: 'C:\\nope\\pwsh.exe' }, ['status'], {})
    t.children[0].emit('error', new Error('spawn ENOENT'))
    expect(t.sent).toEqual([
      { channel: 'devenv:line', msg: { runId, stream: 'stderr', line: "Couldn't start C:\\nope\\pwsh.exe: spawn ENOENT" } },
      { channel: 'devenv:exit', msg: { runId, code: -1, cancelled: false } },
    ])
  })

  it('catalog runs help --json privately and returns the catalog message', async () => {
    const p = t.handlers['devenv:catalog'](null, CONFIG)
    await tick()
    expect(t.deps.spawn.mock.calls[0][1].slice(-2)).toEqual(['help', '--json'])
    t.children[0].stdout.write('@@devenv {"type":"result","kind":"catalog","protocol":1,"commands":[]}\n')
    t.children[0].finish(0)
    await expect(p).resolves.toEqual({ type: 'result', kind: 'catalog', protocol: 1, commands: [] })
    expect(t.sent).toEqual([])
  })

  it('catalog explains a devenv without help --json', async () => {
    const p = t.handlers['devenv:catalog'](null, CONFIG)
    await tick()
    t.children[0].stdout.write('devenv - local environment\n')
    t.children[0].finish(0)
    await expect(p).rejects.toThrow(/didn't return its command list/)
  })

  it('opens only http(s) URLs and existing absolute paths', async () => {
    await t.handlers['devenv:open'](null, { url: 'http://127.0.0.1:5280/?token=x' })
    expect(t.deps.shell.openExternal).toHaveBeenCalledWith('http://127.0.0.1:5280/?token=x')
    await expect(t.handlers['devenv:open'](null, { url: 'file:///C:/x' })).rejects.toThrow(/http/)
    await t.handlers['devenv:open'](null, { path: 'C:\\r\\trace.html' })
    expect(t.deps.shell.openPath).toHaveBeenCalledWith('C:\\r\\trace.html')
    await expect(t.handlers['devenv:open'](null, { path: 'rel\\x.html' })).rejects.toThrow(/Not found/)
  })

  it('disposeAll kills every running process', async () => {
    await t.handlers['devenv:run'](null, CONFIG, ['start'], { exclusive: true })
    await t.handlers['devenv:run'](null, CONFIG, ['status'], { exclusive: false })
    await t.api.disposeAll()
    expect(t.deps.kill).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js`
Expected: FAIL — `devenv.cjs` not found.

- [ ] **Step 3: Implement `devenv.cjs`**

```js
// electron/ipc/devenv.cjs
//
// Runs devenv (devenv.ps1 in the folder set in Settings) for the Dev Environment module, as
// hidden pwsh processes - the only place NexusMD starts them. devenv runs in host mode
// (DEVENV_HOST=nexusmd): its questions arrive as "@@devenv {...}" stdout lines, which the
// renderer answers through devenv:answer (one JSON line on the process's stdin).
//
// spawn / kill / send / shell / fileExists are injectable (same pattern as db-manager.cjs's
// drivers) because vi.mock() cannot intercept a CJS require() inside this file.

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn: nodeSpawn, execFile } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { withLogging } = require('./withLogging.cjs');

const PREFIX = '@@devenv ';

function killTree(pid) {
  // child.kill() would leave docker / dotnet / adb grandchildren running.
  return new Promise(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function lineSplitter(onLine) {
  const decoder = new StringDecoder('utf8');
  let buf = '';
  const drain = () => {
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  };
  return {
    push(chunk) { buf += decoder.write(chunk); drain(); },
    end() {
      buf += decoder.end();
      drain();
      if (buf) { onLine(buf.replace(/\r$/, '')); buf = ''; }
    },
  };
}

function buildInvocation(config, argv, fileExists = fs.existsSync) {
  const { root, pwsh, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  }
  const script = path.join(root, 'devenv.ps1');
  if (!fileExists(script)) throw new Error(`No devenv.ps1 in ${root}`);
  if (!Array.isArray(argv) || argv.some(a => typeof a !== 'string')) throw new Error('devenv arguments must be strings');
  const env = { ...process.env, DEVENV_HOST: 'nexusmd' };
  if (profile) env.DEVENV_PROFILE = profile;
  else delete env.DEVENV_PROFILE;
  return {
    command: pwsh || 'pwsh',
    args: ['-NoProfile', '-NonInteractive', '-File', script, ...argv],
    options: { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

function parseControl(line) {
  if (!line.startsWith(PREFIX)) return null;
  try { return JSON.parse(line.slice(PREFIX.length)); } catch { return null; }
}

function register(ipcMain, deps = {}) {
  const {
    spawn = nodeSpawn,
    kill = killTree,
    send = () => {},
    shell = require('electron').shell,
    fileExists = fs.existsSync,
    logger,
  } = deps;
  const handle = withLogging(ipcMain, logger);
  const runs = new Map();
  let nextId = 1;

  function start(config, argv, { exclusive = true, label } = {}) {
    if (exclusive) {
      for (const r of runs.values()) {
        if (r.exclusive) throw new Error(`devenv is still running "${r.label}" - wait for it or cancel it first.`);
      }
    }
    const inv = buildInvocation(config, argv, fileExists);
    const runId = nextId++;
    const child = spawn(inv.command, inv.args, inv.options);
    const run = { child, exclusive, label: label || argv.join(' '), cancelled: false };
    runs.set(runId, run);
    const out = lineSplitter(line => send('devenv:line', { runId, stream: 'stdout', line }));
    const err = lineSplitter(line => send('devenv:line', { runId, stream: 'stderr', line }));
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    // An answer written just as the process exits must not crash the main process.
    child.stdin.on?.('error', () => {});
    let finished = false;
    const finish = code => {
      if (finished) return;
      finished = true;
      out.end();
      err.end();
      runs.delete(runId);
      send('devenv:exit', { runId, code, cancelled: run.cancelled });
    };
    child.on('error', e => {
      send('devenv:line', { runId, stream: 'stderr', line: `Couldn't start ${inv.command}: ${e.message}` });
      finish(-1);
    });
    child.on('close', code => finish(code ?? -1));
    return runId;
  }

  function collect(config, argv) {
    const inv = buildInvocation(config, argv, fileExists);
    return new Promise((resolve, reject) => {
      const child = spawn(inv.command, inv.args, inv.options);
      const lines = [];
      const errLines = [];
      const out = lineSplitter(l => lines.push(l));
      const err = lineSplitter(l => errLines.push(l));
      child.stdout.on('data', c => out.push(c));
      child.stderr.on('data', c => err.push(c));
      child.stdin.end?.();
      child.on('error', e => reject(new Error(`Couldn't start ${inv.command}: ${e.message}`)));
      child.on('close', code => {
        out.end();
        err.end();
        resolve({ lines, stderr: errLines.join('\n'), code });
      });
    });
  }

  handle('devenv:run', async (_e, config, argv, opts) => ({ runId: start(config, argv, opts) }));

  handle('devenv:answer', async (_e, runId, answer) => {
    const run = runs.get(runId);
    if (!run) throw new Error('That devenv command has already finished.');
    if (!answer || typeof answer.id !== 'string') throw new Error('Invalid answer');
    // Answers can be passwords: they go to stdin and nowhere else (no logging here).
    const line = answer.cancel ? { id: answer.id, cancel: true } : { id: answer.id, value: answer.value ?? '' };
    run.child.stdin.write(JSON.stringify(line) + '\n');
    return { ok: true };
  });

  handle('devenv:cancel', async (_e, runId) => {
    const run = runs.get(runId);
    if (!run) return { ok: false };
    run.cancelled = true;
    await kill(run.child.pid);
    return { ok: true };
  });

  handle('devenv:catalog', async (_e, config) => {
    const { lines, stderr, code } = await collect(config, ['help', '--json']);
    for (const line of lines) {
      const msg = parseControl(line);
      if (msg && msg.type === 'result' && msg.kind === 'catalog') return msg;
    }
    const detail = stderr || lines.slice(-5).join('\n') || 'Is this devenv up to date?';
    throw new Error(`devenv didn't return its command list (exit ${code}). ${detail}`);
  });

  handle('devenv:open', async (_e, target) => {
    if (target && typeof target.url === 'string') {
      if (!/^https?:\/\//i.test(target.url)) throw new Error('Only http(s) URLs can be opened');
      await shell.openExternal(target.url);
      return { ok: true };
    }
    if (target && typeof target.path === 'string') {
      if (!path.isAbsolute(target.path) || !fileExists(target.path)) throw new Error(`Not found: ${target.path}`);
      const error = await shell.openPath(target.path);
      if (error) throw new Error(error);
      return { ok: true };
    }
    throw new Error('Nothing to open');
  });

  return {
    async disposeAll() {
      const all = [...runs.values()];
      runs.clear();
      await Promise.all(all.map(r => kill(r.child.pid)));
    },
  };
}

module.exports = { register, buildInvocation, lineSplitter };
```

Note on the `path` open test: `fileExists` is `() => true` in `setup()`, so `'rel\\x.html'` is rejected by `path.isAbsolute` — `path` resolves to `path.win32` on Windows; if the suite also runs on a non-Windows CI, use `path.win32` explicitly for both `isAbsolute` checks and `join` in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into `main.cjs`**

After `const jiraIpc        = require('./ipc/jira.cjs');`:

```js
const devenvIpc      = require('./ipc/devenv.cjs');
```

Declare next to `let mainWindow = null;`:

```js
let devenvRuns = null;
```

After `jiraIpc.register(ipcMain);`:

```js
  devenvRuns = devenvIpc.register(ipcMain, {
    send: (channel, msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, msg); },
  });
```

In the `before-quit` handler, after the `dbManagerIpc.closeAll()` line:

```js
  devenvRuns?.disposeAll().catch(err => log.scope('lifecycle').error('devenv disposeAll failed', err));
```

- [ ] **Step 6: Run the desktop suite**

Run: `npm -w apps/desktop test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/ipc/devenv.test.js apps/desktop/electron/main.cjs
git commit -m "feat(desktop): run devenv as hidden processes over IPC"
```

---

### Task 8: Preload bridge, renderer adapter, settings card

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Modify: `apps/desktop/electron/preload.cjs` (add `devenv` after the `apiClient` block, before the closing `});`)
- Modify: `apps/desktop/electron/preload.test.js` (fake `ipcRenderer` gains `removeListener`; new test)
- Create: `apps/desktop/src/adapters/devenv.js`
- Create: `apps/desktop/src/devenv-config.js`
- Create: `apps/desktop/src/devenv-settings-card.jsx`
- Modify: `apps/desktop/src/main.jsx` (import + `devenv: devenvAdapter` in `adapters`)
- Modify: `apps/desktop/src/desktop-settings.jsx` (render `<DevenvSettingsCard />` in the `desktop` tab)
- Test: `apps/desktop/src/devenv-config.test.js`, `apps/desktop/src/devenv-settings-card.test.jsx`

**Interfaces:**
- Consumes: IPC channels from Task 7; `normaliseCatalog`, `isCompatibleCatalog` (Task 6).
- Produces:
  - `window.electronAPI.devenv`: `run(config, argv, opts)`, `answer(runId, answer)`, `cancel(runId)`, `catalog(config)`, `open(target)`, `onLine(cb) → unsubscribe`, `onExit(cb) → unsubscribe`
  - `devenvAdapter` (same methods + `isAvailable()`), the `devenv` key on the desktop `adapters` object
  - `DEFAULT_DEVENV_CONFIG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }`, `getDevenvConfig() → config`, `setDevenvConfig(patch) → config` (persists per NexusMD profile, dispatches `window` event `nexusmd:devenv-config`)
  - `DevenvSettingsCard({ adapter?, picker? })`

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/electron/preload.test.js`: in `beforeAll`, change the fake to `ipcRenderer = { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeAllListeners: vi.fn(), removeListener: vi.fn() }`, then add:

```js
  it('exposes devenv run/answer/cancel/catalog/open over the devenv channels', () => {
    const cfg = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
    exposed.devenv.run(cfg, ['status'], { exclusive: false })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:run', cfg, ['status'], { exclusive: false })
    exposed.devenv.answer(3, { id: 'p1', value: '2' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:answer', 3, { id: 'p1', value: '2' })
    exposed.devenv.cancel(3)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:cancel', 3)
    exposed.devenv.catalog(cfg)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:catalog', cfg)
    exposed.devenv.open({ url: 'http://127.0.0.1:1' })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:open', { url: 'http://127.0.0.1:1' })
  })

  it('devenv.onLine / onExit subscribe and return an unsubscribe', () => {
    const cb = vi.fn()
    const off = exposed.devenv.onLine(cb)
    const [channel, handler] = ipcRenderer.on.mock.calls.at(-1)
    expect(channel).toBe('devenv:line')
    handler({}, { runId: 1, stream: 'stdout', line: 'x' })
    expect(cb).toHaveBeenCalledWith({ runId: 1, stream: 'stdout', line: 'x' })
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('devenv:line', handler)
    exposed.devenv.onExit(vi.fn())
    expect(ipcRenderer.on.mock.calls.at(-1)[0]).toBe('devenv:exit')
  })
```

`apps/desktop/src/devenv-config.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDevenvConfig, setDevenvConfig, DEFAULT_DEVENV_CONFIG } from './devenv-config.js'

describe('devenv config', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to C:\\repos\\dev-environment and pwsh on PATH', () => {
    expect(getDevenvConfig()).toEqual(DEFAULT_DEVENV_CONFIG)
    expect(DEFAULT_DEVENV_CONFIG).toEqual({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })
  })

  it('merges and persists patches, and announces the change', () => {
    const seen = vi.fn()
    window.addEventListener('nexusmd:devenv-config', seen)
    expect(setDevenvConfig({ profile: 'D:\\prof' })).toEqual({ ...DEFAULT_DEVENV_CONFIG, profile: 'D:\\prof' })
    expect(getDevenvConfig().profile).toBe('D:\\prof')
    expect(seen).toHaveBeenCalled()
    window.removeEventListener('nexusmd:devenv-config', seen)
  })

  it('survives corrupt storage', () => {
    setDevenvConfig({ pwsh: 'x' })
    for (const k of Object.keys(localStorage)) localStorage.setItem(k, '{nope')
    expect(getDevenvConfig()).toEqual(DEFAULT_DEVENV_CONFIG)
  })
})
```

`apps/desktop/src/devenv-settings-card.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DevenvSettingsCard } from './devenv-settings-card.jsx'

const catalog = (over = {}) => ({ type: 'result', kind: 'catalog', protocol: 1, profileError: null, groups: [], commands: [{ group: '', verb: 'status' }, { group: '', verb: 'start' }], ...over })
const adapterWith = catalogImpl => ({ isAvailable: () => true, catalog: vi.fn(catalogImpl) })

describe('DevenvSettingsCard', () => {
  beforeEach(() => localStorage.clear())

  it('renders nothing without the desktop adapter', () => {
    const { container } = render(<DevenvSettingsCard adapter={{ isAvailable: () => false }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the defaults and saves edits', () => {
    render(<DevenvSettingsCard adapter={adapterWith(async () => catalog())} />)
    const folder = screen.getByLabelText('devenv folder')
    expect(folder.value).toBe('C:\\repos\\dev-environment')
    fireEvent.change(screen.getByLabelText('Profile folder'), { target: { value: 'D:\\prof' } })
    expect(JSON.stringify(localStorage)).toContain('D:\\\\prof')
  })

  it('Check reports the command count', async () => {
    const adapter = adapterWith(async () => catalog())
    render(<DevenvSettingsCard adapter={adapter} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(screen.getByText(/devenv OK - 2 commands/)).toBeInTheDocument())
    expect(adapter.catalog).toHaveBeenCalledWith({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })
  })

  it('Check reports a protocol mismatch and errors', async () => {
    const { unmount } = render(<DevenvSettingsCard adapter={adapterWith(async () => catalog({ protocol: 2 }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(screen.getByText(/update devenv/i)).toBeInTheDocument())
    unmount()
    render(<DevenvSettingsCard adapter={adapterWith(async () => { throw new Error('No devenv.ps1 in C:\\x') })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(screen.getByText('No devenv.ps1 in C:\\x')).toBeInTheDocument())
  })

  it('Browse fills the folder from the picker', async () => {
    const picker = { pickDirectory: vi.fn(async () => 'E:\\devenv') }
    render(<DevenvSettingsCard adapter={adapterWith(async () => catalog())} picker={picker} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Browse…' })[0])
    await waitFor(() => expect(screen.getByLabelText('devenv folder').value).toBe('E:\\devenv'))
  })
})
```

(If `toBeEmptyDOMElement` / `toBeInTheDocument` are unavailable — check `apps/desktop/vitest.config.js` and an existing `*.test.jsx` for a `@testing-library/jest-dom` setup — use `container.innerHTML === ''` and `getByText` (which throws when missing) instead.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w apps/desktop exec vitest run electron/preload.test.js src/devenv-config.test.js src/devenv-settings-card.test.jsx`
Expected: FAIL — `exposed.devenv` undefined, modules not found.

- [ ] **Step 3: Preload**

In `apps/desktop/electron/preload.cjs`, after the `apiClient: { ... },` block:

```js
  // ── Dev Environment module (devenv adapter) ────────────────────────────────
  devenv: {
    run:     (config, argv, opts) => ipcRenderer.invoke('devenv:run', config, argv, opts),
    answer:  (runId, answer) => ipcRenderer.invoke('devenv:answer', runId, answer),
    cancel:  (runId) => ipcRenderer.invoke('devenv:cancel', runId),
    catalog: (config) => ipcRenderer.invoke('devenv:catalog', config),
    open:    (target) => ipcRenderer.invoke('devenv:open', target),
    onLine: (callback) => {
      const handler = (_event, msg) => callback(msg);
      ipcRenderer.on('devenv:line', handler);
      return () => ipcRenderer.removeListener('devenv:line', handler);
    },
    onExit: (callback) => {
      const handler = (_event, msg) => callback(msg);
      ipcRenderer.on('devenv:exit', handler);
      return () => ipcRenderer.removeListener('devenv:exit', handler);
    },
  },
```

- [ ] **Step 4: Adapter**

`apps/desktop/src/adapters/devenv.js`:

```js
// Renderer-side `devenv` adapter (contract: IDevenvAdapter in packages/core/src/adapters/index.js),
// calling through to window.electronAPI.devenv from electron/preload.cjs.

const api = () => window.electronAPI?.devenv

export const devenvAdapter = {
  isAvailable() { return !!api() },
  run(config, argv, opts) { return api().run(config, argv, opts) },
  answer(runId, answer) { return api().answer(runId, answer) },
  cancel(runId) { return api().cancel(runId) },
  catalog(config) { return api().catalog(config) },
  open(target) { return api().open(target) },
  onLine(cb) { return api()?.onLine(cb) ?? (() => {}) },
  onExit(cb) { return api()?.onExit(cb) ?? (() => {}) },
}
```

- [ ] **Step 5: Config**

`apps/desktop/src/devenv-config.js`:

```js
// Where devenv lives and how to run it, per NexusMD profile.
import { getProfileKey } from './profile-keys.js'

const KEY = () => getProfileKey('devenv.config')

export const DEFAULT_DEVENV_CONFIG = Object.freeze({ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' })

export function getDevenvConfig() {
  try {
    const raw = localStorage.getItem(KEY())
    const saved = raw ? JSON.parse(raw) : {}
    return { ...DEFAULT_DEVENV_CONFIG, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return { ...DEFAULT_DEVENV_CONFIG }
  }
}

export function setDevenvConfig(patch) {
  const next = { ...getDevenvConfig(), ...patch }
  try { localStorage.setItem(KEY(), JSON.stringify(next)) } catch {}
  window.dispatchEvent(new Event('nexusmd:devenv-config'))
  return next
}
```

- [ ] **Step 6: Settings card**

`apps/desktop/src/devenv-settings-card.jsx`:

```jsx
import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'
import { normaliseCatalog, isCompatibleCatalog } from '@nexusmd/core'
import { getDevenvConfig, setDevenvConfig } from './devenv-config.js'
import { devenvAdapter } from './adapters/devenv.js'
import { pickerAdapter } from './adapters/picker.js'

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
}

export function DevenvSettingsCard({ adapter = devenvAdapter, picker = pickerAdapter }) {
  const [cfg, setCfg] = React.useState(getDevenvConfig)
  const [check, setCheck] = React.useState(null)

  if (!adapter.isAvailable()) return null

  const update = patch => setCfg(setDevenvConfig(patch))
  const browse = async key => {
    const dir = await picker.pickDirectory()
    if (dir) update({ [key]: dir })
  }
  const runCheck = async () => {
    setCheck({ ok: null, text: 'Checking…' })
    try {
      const catalog = normaliseCatalog(await adapter.catalog(cfg))
      if (!isCompatibleCatalog(catalog)) {
        setCheck({ ok: false, text: `This devenv speaks protocol ${catalog.protocol}; NexusMD needs 1 - update devenv.` })
        return
      }
      const note = catalog.profileError ? ` - profile problem: ${catalog.profileError}` : ''
      setCheck({ ok: !catalog.profileError, text: `devenv OK - ${catalog.commands.length} commands${note}` })
    } catch (e) {
      setCheck({ ok: false, text: e.message })
    }
  }

  const folderRow = (key, title, desc, placeholder) => (
    <VsRow title={title} desc={desc}>
      <div style={{ display: 'flex', gap: 8, minWidth: 360 }}>
        <input aria-label={title} value={cfg[key]} placeholder={placeholder} style={inputStyle}
          onChange={e => update({ [key]: e.target.value })} />
        <button className="btn sm ghost" onClick={() => browse(key)}>Browse…</button>
      </div>
    </VsRow>
  )

  return (
    <VsCard title="Dev Environment" icon="build">
      {folderRow('root', 'devenv folder', 'The folder that contains devenv.ps1', 'C:\\repos\\dev-environment')}
      <VsRow title="PowerShell" desc="pwsh 7 - a name on PATH or a full path to pwsh.exe">
        <input aria-label="PowerShell" value={cfg.pwsh} style={{ ...inputStyle, minWidth: 360 }}
          onChange={e => update({ pwsh: e.target.value })} />
      </VsRow>
      {folderRow('profile', 'Profile folder', 'Optional - empty uses devenv\'s own profile/ folder (DEVENV_PROFILE)', '(devenv folder)\\profile')}
      <VsRow title="Check" desc={check ? check.text : 'Asks devenv for its command list'}>
        <button className="btn sm" onClick={runCheck}>Check</button>
      </VsRow>
    </VsCard>
  )
}
```

The `desc` of the Check row shows the result text, so the tests' `getByText` finds it. If `VsRow` does not render `desc` as plain text, render the result in a `<div role="status">` under the button instead and keep the same text.

- [ ] **Step 7: Wire the adapter and card**

`apps/desktop/src/main.jsx`: add the import after the `dbManagerAdapter` import:

```js
import { devenvAdapter }        from './adapters/devenv.js'
```

and in `adapters`, after `dbManager: dbManagerAdapter,`:

```js
  // Desktop-only — runs pwsh in the main process; gates the devenv module.
  devenv:        devenvAdapter,
```

`apps/desktop/src/desktop-settings.jsx`: import `import { DevenvSettingsCard } from './devenv-settings-card.jsx'` and in the `desktop` tab:

```jsx
          {tab === 'desktop' && (
            <>
              <DesktopAppCard />
              <DevenvSettingsCard />
              <DesktopQuickLinksCard
```

- [ ] **Step 8: Run tests**

Run: `npm -w apps/desktop test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/devenv.js apps/desktop/src/devenv-config.js apps/desktop/src/devenv-config.test.js apps/desktop/src/devenv-settings-card.jsx apps/desktop/src/devenv-settings-card.test.jsx apps/desktop/src/main.jsx apps/desktop/src/desktop-settings.jsx
git commit -m "feat(desktop): add devenv bridge, adapter and settings card"
```

---

### Task 9: Run hook, output panel and prompt dialog

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/use-devenv-run.js`
- Create: `apps/desktop/src/views/devenv/run-panel.jsx`
- Create: `apps/desktop/src/views/devenv/prompt-dialog.jsx`
- Test: `apps/desktop/src/views/devenv/use-devenv-run.test.jsx`, `run-panel.test.jsx`, `prompt-dialog.test.jsx`

**Interfaces:**
- Consumes: `devenvAdapter` contract (Task 6/8), run-state functions and `ansiToSpans`, `stripAnsi` (Task 5).
- Produces:
  - `useDevenvRun({ adapter, config, notify? }) → { state: RunState, start(argv: string[], { exclusive: boolean, label: string }), answer(promptId, value), cancelPrompt(promptId), cancel() }` — `notify(title, body)` is called when a prompt arrives while `document.hasFocus()` is false.
  - `RunPanel({ state, onCancel })`
  - `PromptDialog({ prompt, onAnswer(value), onCancel() })` — `value` is a string, or a string[] for `multi`.

- [ ] **Step 1: Write the failing tests**

`prompt-dialog.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptDialog } from './prompt-dialog.jsx'

const base = { type: 'prompt', id: 'p1', title: 'Database', prompt: 'Choice [1]' }

describe('PromptDialog', () => {
  it('choice: preselects the default and answers the picked value', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'choice', default: '1', options: [{ value: '1', label: 'Leave it' }, { value: '4', label: 'Remote DEV', hint: 'shared' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    expect(screen.getByLabelText(/Leave it/)).toBeChecked()
    fireEvent.click(screen.getByLabelText(/Remote DEV/))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('4')
  })

  it('choice with allowText answers the typed text when filled', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'choice', allowText: true, default: '', options: [{ value: '', label: 'Keep main' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Or type a value'), { target: { value: 'feature/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('feature/x')
  })

  it('multi answers the ticked values', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'multi', options: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }, { value: '3', label: 'c' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('a'))
    fireEvent.click(screen.getByLabelText('c'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith(['1', '3'])
  })

  it('confirm with a word only enables OK once the word is typed', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'confirm', confirmWord: 'YES', detail: 'Deletes everything.' }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    const ok = screen.getByRole('button', { name: 'OK' })
    expect(ok).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type YES to confirm'), { target: { value: 'YES' } })
    fireEvent.click(ok)
    expect(onAnswer).toHaveBeenCalledWith('YES')
  })

  it('confirm with options shows them as buttons', () => {
    const onAnswer = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'confirm', options: [{ value: 'y', label: 'Yes, proceed' }, { value: 'n', label: 'No' }] }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, proceed' }))
    expect(onAnswer).toHaveBeenCalledWith('y')
  })

  it('secret uses a password field and does not render the value anywhere else', () => {
    const onAnswer = vi.fn()
    const { container } = render(<PromptDialog prompt={{ ...base, kind: 'secret', title: 'Mac password' }} onAnswer={onAnswer} onCancel={vi.fn()} />)
    const input = screen.getByLabelText('Mac password')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.change(input, { target: { value: 'hunter22' } })
    expect(container.textContent).not.toContain('hunter22')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('hunter22')
  })

  it('text answers the default when untouched; Cancel cancels', () => {
    const onAnswer = vi.fn(); const onCancel = vi.fn()
    render(<PromptDialog prompt={{ ...base, kind: 'text', default: 'main' }} onAnswer={onAnswer} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenCalledWith('main')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

`run-panel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { RunPanel } from './run-panel.jsx'

const state = over => ({ ...createRunState('db restore'), status: 'running', runId: 1, ...over })

describe('RunPanel', () => {
  it('renders coloured output without escape codes', () => {
    const { container } = render(<RunPanel state={state({ lines: [{ stream: 'stdout', text: '\x1b[32mok\x1b[0m done' }] })} onCancel={vi.fn()} />)
    expect(container.textContent).toContain('ok done')
    expect(container.textContent).not.toContain('\x1b')
    expect(container.querySelector('[data-color="green"]').textContent).toBe('ok')
  })

  it('shows step progress and a Cancel button while running', () => {
    const onCancel = vi.fn()
    render(<RunPanel state={state({ step: { n: 2, total: 5, text: 'Building APIs' } })} onCancel={onCancel} />)
    expect(screen.getByText('2/5 Building APIs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows the exit badge and no Cancel once finished', () => {
    render(<RunPanel state={state({ status: 'failed', exitCode: 1 })} onCancel={vi.fn()} />)
    expect(screen.getByText('Failed (exit 1)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows a start error', () => {
    render(<RunPanel state={state({ status: 'failed', error: 'No devenv.ps1 in C:\\x' })} onCancel={vi.fn()} />)
    expect(screen.getByText('No devenv.ps1 in C:\\x')).toBeInTheDocument()
  })
})
```

`use-devenv-run.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDevenvRun } from './use-devenv-run.js'

function fakeAdapter() {
  const listeners = { line: [], exit: [] }
  return {
    listeners,
    run: vi.fn(async () => ({ runId: 9 })),
    answer: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { listeners.line.push(cb); return () => { listeners.line = listeners.line.filter(x => x !== cb) } },
    onExit: cb => { listeners.exit.push(cb); return () => { listeners.exit = listeners.exit.filter(x => x !== cb) } },
    emitLine: m => listeners.line.forEach(cb => cb(m)),
    emitExit: m => listeners.exit.forEach(cb => cb(m)),
  }
}
const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const P = '@@devenv '

describe('useDevenvRun', () => {
  it('runs, collects lines for its own runId only, and finishes', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['status'], { exclusive: false, label: 'status' }))
    expect(a.run).toHaveBeenCalledWith(CFG, ['status'], { exclusive: false, label: 'status' })
    act(() => {
      a.emitLine({ runId: 9, stream: 'stdout', line: 'hello' })
      a.emitLine({ runId: 8, stream: 'stdout', line: 'not mine' })
      a.emitExit({ runId: 9, code: 0, cancelled: false })
    })
    expect(result.current.state.lines.map(l => l.text)).toEqual(['hello'])
    expect(result.current.state.status).toBe('done')
  })

  it('keeps events that arrive before run() resolves', async () => {
    const a = fakeAdapter()
    a.run = vi.fn(async () => { a.emitLine({ runId: 9, stream: 'stdout', line: 'early' }); return { runId: 9 } })
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['status'], { exclusive: false, label: 'status' }))
    expect(result.current.state.lines.map(l => l.text)).toEqual(['early'])
  })

  it('answers prompts through the adapter and drops them from state', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['clean'], { exclusive: true, label: 'clean' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"choice","title":"Clean"}' }))
    expect(result.current.state.prompts).toHaveLength(1)
    await act(() => result.current.answer('p1', '1'))
    expect(a.answer).toHaveBeenCalledWith(9, { id: 'p1', value: '1' })
    expect(result.current.state.prompts).toHaveLength(0)
  })

  it('cancelling a prompt sends cancel; cancelling the run marks it cancelled', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['start'], { exclusive: true, label: 'start' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"text","title":"x"}' }))
    await act(() => result.current.cancelPrompt('p1'))
    expect(a.answer).toHaveBeenCalledWith(9, { id: 'p1', cancel: true })
    await act(() => result.current.cancel())
    expect(a.cancel).toHaveBeenCalledWith(9)
    act(() => a.emitExit({ runId: 9, code: 1, cancelled: true }))
    expect(result.current.state.status).toBe('cancelled')
  })

  it('opens what devenv asks to open', async () => {
    const a = fakeAdapter()
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['test', 'web'], { exclusive: false, label: 'test web' }))
    await act(async () => { a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"open","url":"http://127.0.0.1:5280/"}' }) })
    expect(a.open).toHaveBeenCalledWith({ url: 'http://127.0.0.1:5280/' })
    expect(result.current.state.opens).toEqual([])
  })

  it('notifies when a prompt arrives while the window is not focused', async () => {
    const a = fakeAdapter()
    const notify = vi.fn()
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG, notify }))
    await act(() => result.current.start(['clean'], { exclusive: true, label: 'clean' }))
    act(() => a.emitLine({ runId: 9, stream: 'stdout', line: P + '{"type":"prompt","id":"p1","kind":"choice","title":"Clean - reclaim disk"}' }))
    expect(notify).toHaveBeenCalledWith('devenv needs an answer', 'Clean - reclaim disk')
    focus.mockRestore()
  })

  it('records a failed start', async () => {
    const a = fakeAdapter()
    a.run = vi.fn(async () => { throw new Error('devenv is still running "start"') })
    const { result } = renderHook(() => useDevenvRun({ adapter: a, config: CFG }))
    await act(() => result.current.start(['stop'], { exclusive: true, label: 'stop' }))
    expect(result.current.state.status).toBe('failed')
    expect(result.current.state.error).toMatch(/still running/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w apps/desktop exec vitest run src/views/devenv`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `use-devenv-run.js`**

```js
// One devenv run, from start to exit, as React state. Events can arrive before run()
// resolves with the runId, so everything is buffered by runId until it is known.
import React from 'react'
import {
  createRunState, applyStarting, applyStarted, applyStartFailed, applyLine,
  applyAnswered, applyOpened, applyCancelRequested, applyExit, parseDevenvLine,
} from '@nexusmd/core'

export function useDevenvRun({ adapter, config, notify }) {
  const [state, setState] = React.useState(() => createRunState())
  const runIdRef = React.useRef(null)
  const pendingRef = React.useRef([])
  const notifyRef = React.useRef(notify)
  notifyRef.current = notify

  const handleLine = React.useCallback(msg => {
    if (msg.stream === 'stdout') {
      const parsed = parseDevenvLine(msg.line)
      if (parsed.type === 'prompt' && typeof document !== 'undefined' && !document.hasFocus()) {
        notifyRef.current?.('devenv needs an answer', parsed.title || parsed.prompt || '')
      }
    }
    setState(s => applyLine(s, msg.stream, msg.line))
  }, [])

  React.useEffect(() => {
    const offLine = adapter.onLine(msg => {
      if (runIdRef.current === null) { pendingRef.current.push({ kind: 'line', msg }); return }
      if (msg.runId === runIdRef.current) handleLine(msg)
    })
    const offExit = adapter.onExit(msg => {
      if (runIdRef.current === null) { pendingRef.current.push({ kind: 'exit', msg }); return }
      if (msg.runId === runIdRef.current) setState(s => applyExit(s, msg.code))
    })
    return () => { offLine(); offExit() }
  }, [adapter, handleLine])

  React.useEffect(() => {
    if (!state.opens.length) return
    for (const o of state.opens) {
      adapter.open(o.url ? { url: o.url } : { path: o.path }).catch(() => {})
    }
    setState(s => applyOpened(s))
  }, [state.opens, adapter])

  const start = React.useCallback(async (argv, { exclusive, label }) => {
    runIdRef.current = null
    pendingRef.current = []
    setState(s => applyStarting({ ...s, command: label }))
    try {
      const { runId } = await adapter.run(config, argv, { exclusive, label })
      runIdRef.current = runId
      setState(s => applyStarted(s, runId))
      const pending = pendingRef.current
      pendingRef.current = []
      for (const p of pending) {
        if (p.msg.runId !== runId) continue
        if (p.kind === 'line') handleLine(p.msg)
        else setState(s => applyExit(s, p.msg.code))
      }
    } catch (e) {
      runIdRef.current = -1
      setState(s => applyStartFailed(s, e.message))
    }
  }, [adapter, config, handleLine])

  const answer = React.useCallback(async (promptId, value) => {
    setState(s => applyAnswered(s, promptId))
    await adapter.answer(runIdRef.current, { id: promptId, value })
  }, [adapter])

  const cancelPrompt = React.useCallback(async promptId => {
    setState(s => applyAnswered(s, promptId))
    await adapter.answer(runIdRef.current, { id: promptId, cancel: true })
  }, [adapter])

  const cancel = React.useCallback(async () => {
    setState(s => applyCancelRequested(s))
    await adapter.cancel(runIdRef.current)
  }, [adapter])

  return { state, start, answer, cancelPrompt, cancel }
}
```

Check `parseDevenvLine` is exported from `@nexusmd/core` (Task 6 step 6 — it is). The `answer` value never enters `state`.

- [ ] **Step 4: Implement `run-panel.jsx`**

```jsx
import React from 'react'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'

const COLOR_VARS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning, #b8860b)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}

function badge(state) {
  if (state.status === 'starting') return 'Starting…'
  if (state.status === 'running') return state.cancelling ? 'Cancelling…' : 'Running'
  if (state.status === 'done') return 'Done'
  if (state.status === 'cancelled') return 'Cancelled'
  if (state.status === 'failed') return state.exitCode == null ? 'Failed' : `Failed (exit ${state.exitCode})`
  return ''
}

export function RunPanel({ state, onCancel }) {
  const outRef = React.useRef(null)
  const running = state.status === 'starting' || state.status === 'running'

  React.useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.lines.length])

  const copy = () => navigator.clipboard?.writeText(state.lines.map(l => stripAnsi(l.text)).join('\n')).catch(() => {})

  return (
    <div className="devenv-run" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong>{state.command}</strong>
        <span className={`chip ${state.status}`}>{badge(state)}</span>
        {state.step && running && <span style={{ color: 'var(--text-muted)' }}>{`${state.step.n}/${state.step.total} ${state.step.text}`}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={copy} disabled={!state.lines.length}>Copy output</button>
          {running && <button className="btn sm danger" onClick={onCancel} disabled={state.cancelling}>Cancel</button>}
        </span>
      </div>
      {state.step && running && (
        <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2 }}>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--accent)', width: `${Math.min(100, (state.step.n / Math.max(1, state.step.total)) * 100)}%` }} />
        </div>
      )}
      {state.error && <div style={{ color: 'var(--danger)' }}>{state.error}</div>}
      <pre ref={outRef} style={{ flex: 1, minHeight: 200, overflow: 'auto', margin: 0, padding: 10, background: 'var(--surface-2)', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
        {state.lines.map((l, i) => (
          <div key={i} style={l.stream === 'stderr' ? { color: 'var(--danger)' } : undefined}>
            {ansiToSpans(l.text).map((s, j) => (
              <span key={j} data-color={s.color || undefined} style={{ color: s.color ? COLOR_VARS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
            ))}
          </div>
        ))}
      </pre>
    </div>
  )
}
```

- [ ] **Step 5: Implement `prompt-dialog.jsx`**

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'

const fieldStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

export function PromptDialog({ prompt, onAnswer, onCancel }) {
  const options = prompt.options || []
  const [choice, setChoice] = React.useState(prompt.default ?? options[0]?.value ?? '')
  const [text, setText] = React.useState(prompt.kind === 'text' ? (prompt.default ?? '') : '')
  const [ticked, setTicked] = React.useState([])

  const confirmByButtons = prompt.kind === 'confirm' && !prompt.confirmWord && options.length > 0
  const okDisabled = prompt.kind === 'confirm' && prompt.confirmWord ? text !== prompt.confirmWord : false

  const submit = () => {
    if (prompt.kind === 'choice') return onAnswer(prompt.allowText && text.trim() ? text.trim() : choice)
    if (prompt.kind === 'multi') return onAnswer(options.map(o => o.value).filter(v => ticked.includes(v)))
    if (prompt.kind === 'confirm') return onAnswer(prompt.confirmWord ? text : 'y')
    return onAnswer(text)
  }

  const footer = confirmByButtons ? (
    <>
      {options.map(o => <button key={o.value} className="btn" onClick={() => onAnswer(o.value)}>{o.label}</button>)}
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
    </>
  ) : (
    <>
      <button className="btn ghost" onClick={onCancel}>Cancel</button>
      <button className="btn primary" onClick={submit} disabled={okDisabled}>OK</button>
    </>
  )

  return (
    <PlModal open onClose={onCancel} icon="build" title={prompt.title || prompt.prompt} sub={prompt.detail} footer={footer}>
      <form onSubmit={e => { e.preventDefault(); if (!okDisabled && !confirmByButtons) submit() }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompt.kind === 'choice' && options.map(o => (
          <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input type="radio" name={prompt.id} checked={choice === o.value} onChange={() => setChoice(o.value)} />
            <span>{o.label}{o.hint && <span style={{ color: 'var(--text-muted)' }}> — {o.hint}</span>}</span>
          </label>
        ))}
        {prompt.kind === 'choice' && prompt.allowText && (
          <input aria-label="Or type a value" placeholder="Or type a value" value={text} onChange={e => setText(e.target.value)} style={fieldStyle} />
        )}
        {prompt.kind === 'multi' && options.map(o => (
          <label key={o.value} style={{ display: 'flex', gap: 8 }}>
            <input type="checkbox" checked={ticked.includes(o.value)}
              onChange={e => setTicked(t => e.target.checked ? [...t, o.value] : t.filter(v => v !== o.value))} />
            <span>{o.label}</span>
          </label>
        ))}
        {prompt.kind === 'confirm' && prompt.confirmWord && (
          <input aria-label={`Type ${prompt.confirmWord} to confirm`} placeholder={prompt.confirmWord} value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
        {prompt.kind === 'confirm' && !prompt.confirmWord && !options.length && <div>{prompt.prompt}</div>}
        {prompt.kind === 'text' && (
          <input aria-label={prompt.title || prompt.prompt} value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
        {prompt.kind === 'secret' && (
          <input aria-label={prompt.title || prompt.prompt} type="password" autoComplete="off" value={text} onChange={e => setText(e.target.value)} style={fieldStyle} autoFocus />
        )}
      </form>
    </PlModal>
  )
}
```

Unknown kinds fall through to no input and OK answers `''` (text state) — acceptable for forward-compatibility.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm -w apps/desktop exec vitest run src/views/devenv`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): add devenv run hook, output panel and prompt dialog"
```

---

### Task 10: Commands screen, Dev Environment view and nav entry

**Repository:** `C:\repos\NexusMD-Mono`

**Files:**
- Create: `apps/desktop/src/views/devenv/commands-view.jsx`
- Create: `apps/desktop/src/views/devenv/view-devenv.jsx`
- Modify: `apps/desktop/src/nav-config.js` (append the nav entry)
- Modify: `apps/desktop/src/main.jsx` (import + `case 'devenv':`)
- Test: `apps/desktop/src/views/devenv/commands-view.test.jsx`, `apps/desktop/src/nav-config.test.js`

**Interfaces:**
- Consumes: `useDevenvRun`, `RunPanel`, `PromptDialog` (Task 9); `normaliseCatalog`, `isCompatibleCatalog`, `buildDevenvArgv`, `takesArgs`, `takesManyArgs` (Task 6); `getDevenvConfig` (Task 8); `pickerAdapter`, `notificationAdapter`.
- Produces: `CommandsView({ adapter, picker, notify })`, `DevenvView({ adapters })`, nav item `{ id: 'devenv', label: 'Dev Environment', icon: 'build' }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/nav-config.test.js`:

```js
  it('has a Dev Environment item', () => {
    expect(NAV.find(n => n.id === 'devenv')).toEqual({ id: 'devenv', label: 'Dev Environment', icon: 'build' })
  })
```

`apps/desktop/src/views/devenv/commands-view.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CommandsView } from './commands-view.jsx'

const CATALOG = {
  type: 'result', kind: 'catalog', protocol: 1, profileError: null,
  groups: [{ id: '', title: 'Everyday' }, { id: 'emulator', title: 'Emulator' }, { id: 'setup', title: 'Setup' }],
  commands: [
    { group: '', verb: 'status', args: '', summary: 'At a glance', switches: [], values: [], mut: false },
    { group: '', verb: 'clean', args: '', summary: 'Free disk space', switches: [], values: [], mut: true },
    { group: 'emulator', verb: 'push', args: '<file> [<file>...]', summary: 'Copy files', switches: [], values: ['to'], mut: true, pathArgs: 'file' },
    { group: 'setup', verb: 'shell', args: '', summary: 'Profile function', switches: [], values: [], hidden: true },
  ],
}

function fakeAdapter(catalog = CATALOG) {
  const l = { line: [], exit: [] }
  return {
    l,
    isAvailable: () => true,
    catalog: vi.fn(async () => catalog),
    run: vi.fn(async () => ({ runId: 1 })),
    answer: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    open: vi.fn(async () => ({ ok: true })),
    onLine: cb => { l.line.push(cb); return () => {} },
    onExit: cb => { l.exit.push(cb); return () => {} },
    line: m => l.line.forEach(cb => cb(m)),
    exit: m => l.exit.forEach(cb => cb(m)),
  }
}

describe('CommandsView', () => {
  beforeEach(() => localStorage.clear())

  it('lists visible commands by group, hiding hidden ones', async () => {
    render(<CommandsView adapter={fakeAdapter()} picker={{}} />)
    await waitFor(() => expect(screen.getByText('devenv status')).toBeInTheDocument())
    expect(screen.getByText('Emulator')).toBeInTheDocument()
    expect(screen.getByText('devenv emulator push')).toBeInTheDocument()
    expect(screen.queryByText('devenv setup shell')).toBeNull()
  })

  it('filters by text', async () => {
    render(<CommandsView adapter={fakeAdapter()} picker={{}} />)
    await waitFor(() => screen.getByText('devenv status'))
    fireEvent.change(screen.getByLabelText('Filter commands'), { target: { value: 'disk' } })
    expect(screen.getByText('devenv clean')).toBeInTheDocument()
    expect(screen.queryByText('devenv status')).toBeNull()
  })

  it('runs a command with its form values and shows output', async () => {
    const a = fakeAdapter()
    render(<CommandsView adapter={a} picker={{ pickFile: vi.fn(async () => 'C:\\pics\\a b.jpg') }} />)
    await waitFor(() => screen.getByText('devenv emulator push'))
    fireEvent.click(screen.getByText('devenv emulator push'))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await waitFor(() => expect(screen.getByLabelText('Argument 1').value).toBe('C:\\pics\\a b.jpg'))
    fireEvent.change(screen.getByLabelText('--to'), { target: { value: '/sdcard/Pictures' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(a.run).toHaveBeenCalled())
    expect(a.run.mock.calls[0][1]).toEqual(['emulator', 'push', 'C:\\pics\\a b.jpg', '--to', '/sdcard/Pictures'])
    expect(a.run.mock.calls[0][2]).toEqual({ exclusive: true, label: 'devenv emulator push' })
    act(() => a.line({ runId: 1, stream: 'stdout', line: 'Pushed a b.jpg' }))
    expect(screen.getByText('Pushed a b.jpg')).toBeInTheDocument()
  })

  it('shows a prompt dialog and answers it', async () => {
    const a = fakeAdapter()
    render(<CommandsView adapter={a} picker={{}} />)
    await waitFor(() => screen.getByText('devenv clean'))
    fireEvent.click(screen.getByText('devenv clean'))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(a.run).toHaveBeenCalled())
    act(() => a.line({ runId: 1, stream: 'stdout', line: '@@devenv {"type":"prompt","id":"p1","kind":"choice","title":"Clean - reclaim disk","default":"1","options":[{"value":"1","label":"Remove old commits"},{"value":"Q","label":"Cancel"}]}' }))
    expect(screen.getByText('Clean - reclaim disk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(a.answer).toHaveBeenCalledWith(1, { id: 'p1', value: '1' }))
  })

  it('explains a missing or outdated devenv', async () => {
    const { unmount } = render(<CommandsView adapter={{ ...fakeAdapter(), catalog: vi.fn(async () => { throw new Error('No devenv.ps1 in C:\\x') }) }} picker={{}} />)
    await waitFor(() => expect(screen.getByText('No devenv.ps1 in C:\\x')).toBeInTheDocument())
    expect(screen.getByText(/Settings → Desktop/)).toBeInTheDocument()
    unmount()
    render(<CommandsView adapter={fakeAdapter({ ...CATALOG, protocol: 2 })} picker={{}} />)
    await waitFor(() => expect(screen.getByText(/update devenv/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w apps/desktop exec vitest run src/views/devenv/commands-view.test.jsx src/nav-config.test.js`
Expected: FAIL.

- [ ] **Step 3: Nav entry**

`apps/desktop/src/nav-config.js` — append to `NAV` after the `db-manager` item:

```js
  { id: 'devenv',    label: 'Dev Environment', icon: 'build' },
```

- [ ] **Step 4: Implement `commands-view.jsx`**

```jsx
import React from 'react'
import { normaliseCatalog, isCompatibleCatalog, buildDevenvArgv, takesArgs, takesManyArgs } from '@nexusmd/core'
import { getDevenvConfig } from '../../devenv-config.js'
import { useDevenvRun } from './use-devenv-run.js'
import { RunPanel } from './run-panel.jsx'
import { PromptDialog } from './prompt-dialog.jsx'

const fieldStyle = { width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

function useDevenvConfig() {
  const [cfg, setCfg] = React.useState(getDevenvConfig)
  React.useEffect(() => {
    const onChange = () => setCfg(getDevenvConfig())
    window.addEventListener('nexusmd:devenv-config', onChange)
    return () => window.removeEventListener('nexusmd:devenv-config', onChange)
  }, [])
  return cfg
}

function CommandForm({ command, picker, onRun, disabled }) {
  const [positional, setPositional] = React.useState([''])
  const [switches, setSwitches] = React.useState({})
  const [values, setValues] = React.useState({})
  React.useEffect(() => { setPositional(['']); setSwitches({}); setValues({}) }, [command.key])

  const pick = async kind => (kind === 'folder' ? picker.pickDirectory?.() : picker.pickFile?.())
  const setArg = (i, v) => setPositional(p => p.map((x, j) => (j === i ? v : x)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div><strong>{`devenv ${command.key}`}</strong> <span style={{ color: 'var(--text-muted)' }}>{command.args}</span></div>
      <div style={{ color: 'var(--text-muted)' }}>{command.summary}</div>
      {takesArgs(command) && positional.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <input aria-label={`Argument ${i + 1}`} value={v} onChange={e => setArg(i, e.target.value)} style={fieldStyle} />
          {command.pathArgs && (
            <button className="btn sm ghost" onClick={async () => { const p = await pick(command.pathArgs === 'folder' ? 'folder' : 'file'); if (p) setArg(i, p) }}>Browse…</button>
          )}
        </div>
      ))}
      {takesManyArgs(command) && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPositional(p => [...p, ''])}>+ Add another</button>
      )}
      {command.switches.map(s => (
        <label key={s} style={{ display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={!!switches[s]} onChange={e => setSwitches(x => ({ ...x, [s]: e.target.checked }))} />
          <span>{`--${s}`}</span>
        </label>
      ))}
      {command.values.map(name => (
        <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 110 }}>{`--${name}`}</span>
          <input aria-label={`--${name}`} value={values[name] || ''} onChange={e => setValues(x => ({ ...x, [name]: e.target.value }))} style={fieldStyle} />
          {command.pathValues[name] && (
            <button className="btn sm ghost" onClick={async () => { const p = await pick(command.pathValues[name]); if (p) setValues(x => ({ ...x, [name]: p })) }}>Browse…</button>
          )}
        </div>
      ))}
      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={disabled}
        onClick={() => onRun(buildDevenvArgv(command, { positional, switches, values }))}>Run</button>
    </div>
  )
}

export function CommandsView({ adapter, picker, notify }) {
  const config = useDevenvConfig()
  const [catalog, setCatalog] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [filter, setFilter] = React.useState('')
  const [selected, setSelected] = React.useState(null)
  const run = useDevenvRun({ adapter, config, notify })

  React.useEffect(() => {
    let live = true
    setCatalog(null); setError(null)
    adapter.catalog(config)
      .then(r => { if (live) setCatalog(normaliseCatalog(r)) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [adapter, config])

  if (error) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ color: 'var(--danger)' }}>{error}</div>
        <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>Check the devenv folder in Settings → Desktop → Dev Environment.</div>
      </div>
    )
  }
  if (!catalog) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Asking devenv for its commands…</div>
  if (!isCompatibleCatalog(catalog)) {
    return <div className="card" style={{ padding: 16 }}>{`This devenv speaks protocol ${catalog.protocol}; NexusMD needs 1 - update devenv.`}</div>
  }

  const q = filter.trim().toLowerCase()
  const visible = catalog.commands.filter(c => !c.hidden && (!q || `${c.key} ${c.summary}`.toLowerCase().includes(q)))
  const command = visible.find(c => c.key === selected) || catalog.commands.find(c => c.key === selected) || null
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const prompt = run.state.prompts[0]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {catalog.profileError && <div style={{ color: 'var(--warning, #b8860b)' }}>{catalog.profileError}</div>}
        <input aria-label="Filter commands" placeholder="Filter commands" value={filter} onChange={e => setFilter(e.target.value)} style={fieldStyle} />
        <div style={{ overflow: 'auto' }}>
          {catalog.groups.map(g => {
            const rows = visible.filter(c => c.group === g.id)
            if (!rows.length) return null
            return (
              <div key={g.id || 'everyday'} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.title}</div>
                {rows.map(c => (
                  <button key={c.key} className={`btn ghost sm ${selected === c.key ? 'active' : ''}`}
                    style={{ display: 'block', width: '100%', textAlign: 'left' }} title={c.summary}
                    onClick={() => setSelected(c.key)}>{`devenv ${c.key}`}</button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {command
          ? <CommandForm command={command} picker={picker} disabled={busy && command.mut}
              onRun={argv => run.start(argv, { exclusive: command.mut, label: `devenv ${command.key}` })} />
          : <div style={{ color: 'var(--text-muted)' }}>Pick a command.</div>}
        {run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
      </div>
      {prompt && (
        <PromptDialog key={prompt.id} prompt={prompt}
          onAnswer={value => run.answer(prompt.id, value)}
          onCancel={() => run.cancelPrompt(prompt.id)} />
      )}
    </div>
  )
}
```

Only one run is shown at a time in this screen; running a read-only command while a mutating one is going replaces the panel's view of the first (the first keeps running in the main process). Phase 2's Status tab will show background runs; note this in the PR description.

- [ ] **Step 5: Implement `view-devenv.jsx`**

```jsx
import React from 'react'
import { notificationAdapter } from '@nexusmd/web-adapters'
import { pickerAdapter } from '../../adapters/picker.js'
import { CommandsView } from './commands-view.jsx'

// Phase 1 has one tab; Status, Start, Builds, Logs, Tests, Database, Emulator, Mac and
// Profile join it in later phases (docs/superpowers/specs/2026-10-08-devenv-module-design.md).
export function DevenvView({ adapters }) {
  const adapter = adapters.devenv
  if (!adapter?.isAvailable()) return <div style={{ padding: 16 }}>Dev Environment needs the desktop app.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: 16 }}>
      <h2 style={{ margin: 0 }}>Dev Environment</h2>
      <CommandsView adapter={adapter} picker={pickerAdapter}
        notify={(title, body) => notificationAdapter.send(title, body, { tag: 'devenv-prompt' })} />
    </div>
  )
}
```

- [ ] **Step 6: Route the view in `main.jsx`**

Import after the `CalendarView` import:

```js
import { DevenvView } from './views/devenv/view-devenv.jsx'
```

Add before `case 'settings':`:

```jsx
    case 'devenv':
      return <DevenvView adapters={adapters} />
```

- [ ] **Step 7: Run tests**

Run: `npm -w apps/desktop test`
Expected: PASS.

- [ ] **Step 8: Run the whole monorepo suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/views/devenv apps/desktop/src/nav-config.js apps/desktop/src/nav-config.test.js apps/desktop/src/main.jsx
git commit -m "feat(desktop): add Dev Environment view with every devenv command"
```

---

### Task 11: End-to-end verification against the real devenv, spec amendments

**Repository:** both

**Files:**
- Modify: `C:\repos\NexusMD-Mono\docs\superpowers\specs\2026-10-08-devenv-module-design.md` (add `## Amendments made during Phase 1 planning`)

- [ ] **Step 1: Record the plan-time amendments in the spec**

Append to the spec:

```markdown
## Amendments made during Phase 1 planning

- Phase 1 opens HTML reports with the default app (`shell.openPath`); the in-app report window arrives with the Tests screen (phase 4).
- The Settings **Check** button runs `help --json` only; `doctor` is run from the Commands screen.
- Until phase 5, Mac commands under NexusMD use `ssh -o BatchMode=yes` and need `sshKey` in `mac.json`; without it they fail fast instead of asking for a password.
- `logs show` prints the whole log into the output panel under NexusMD (no `less`).
- Phase 1 prompts are devenv's existing questions rendered as dialogs (including the plain start-plan menu); the dedicated plan form and branch picker are phase 2.
- `Select-Indices` gained a `-Labels` parameter so checklists show names, not numbers.
```

- [ ] **Step 2: Build and start NexusMD desktop**

Run (from `C:\repos\NexusMD-Mono`): `npm -w apps/desktop run build:renderer` then `npm -w apps/desktop run start`
Expected: the app opens; **Dev Environment** is in the sidebar.

- [ ] **Step 3: Settings check**

Settings → Desktop → Dev Environment → **Check**.
Expected: `devenv OK - N commands` (N > 40). Watch the taskbar: no console window appears.

- [ ] **Step 4: Walk the checklist (watch for any console window at every step)**

| # | Do | Expect |
|---|---|---|
| 1 | Commands → `devenv status` → Run | Status output streams; Done; no console |
| 2 | `devenv doctor` → Run | Coloured output (green/red/yellow rendered, no escape codes) |
| 3 | `devenv clean` → Run | Dialog "Clean - reclaim disk" with the 4 options and sizes; choose **Cancel (Q)** → output `Cancelled - nothing deleted.` |
| 4 | `devenv clean` → Run → **Choose item by item** | Checklist dialogs with build/checkout/baseline names; Database choice dialog; final **Proceed?** dialog → No → `Nothing changed.` |
| 5 | `devenv start` → Run | Plan printed in the output; "Local session - review, then start" dialog; choose **Database** → database dialog → back → **Cancel** → `Cancelled - nothing was started.` |
| 6 | `devenv start` → Run → Start | Step progress bar advances (`n/total`); backend comes up; finishes Done (or Failed with the reason shown) |
| 7 | While 6 runs, run `devenv status` | Allowed (read-only). Try `devenv stop` while 6 runs → refused: `devenv is still running "devenv start"…` |
| 8 | `devenv db sql` (no argument) → Run | Script picker dialog listing the profile's `sql/` scripts |
| 9 | `devenv test web` (test stack up) | Browser opens mitmweb; no console |
| 10 | `devenv backend logs <api>` → Run → Cancel | Log follows live; Cancel stops it; status **Cancelled**; `docker compose logs` process is gone (Task Manager) |
| 11 | `devenv emulator push` → Browse… → pick an image → Run | File pushed |
| 12 | Start `devenv clean`, minimise NexusMD before the dialog | Windows notification "devenv needs an answer"; dialog waiting on return |
| 13 | Start `devenv clean`, then quit NexusMD from the tray while the dialog is open | No orphaned `pwsh.exe` left in Task Manager |
| 14 | In a normal terminal: `devenv clean`, `devenv start`, `devenv help` | Unchanged console behaviour |

- [ ] **Step 5: Fix anything that fails**

For each failure: write a failing test in the owning task's test file first, fix, re-run that suite and the checklist row. Common suspects: a prompt site missed in Task 2 (shows up as `Read-Host` error under `-NonInteractive` — the guard test should already catch it), ANSI not rendered (check `$PSStyle.OutputRendering` in `host-common.ps1`), Windows path handling in `devenv.cjs` (`path.win32`).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "docs: record Phase 1 amendments to the devenv module spec"
```
