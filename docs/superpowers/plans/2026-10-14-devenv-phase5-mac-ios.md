# Dev Environment Module — Phase 5 (Mac / iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the Mac build host from NexusMD with no console, in three parts:
- a one-time **Set up SSH key** wizard, which takes the Mac password once and then uses key login from then on;
- **Fix**, whose `sudo` steps get the Mac password through a NexusMD prompt;
- a **Mac** tab with the connection state, Doctor, Fix and the arm64 simulator setting.

**Architecture:** Every ssh process devenv starts under NexusMD gets its own stdin. NexusMD's answer channel is never inherited. That stdin carries exactly what the remote side needs, which today is the sudo password, and is then closed.

On the Mac, `mac-host.sh`:
- reads the password from the first stdin line;
- checks it once with `sudo -v`, exiting 254 if it is refused;
- pipes it into `sudo -S` for each fix.

`devenv mac key-setup` works like this:
1. It creates `~/.ssh/devenv_mac_ed25519` if missing.
2. It installs the public key with one password login. The password reaches ssh through `SSH_ASKPASS` (`ios/askpass.cmd`) and an environment variable set on that one ssh child.
3. It writes `sshKey` into `mac.json`.

`devenv mac status --json` reports the configuration and whether a BatchMode login works.

**Tech Stack:** PowerShell 7.6 + Pester 6, Windows OpenSSH, macOS bash 3.2 (devenv); Electron 43, React 18, Vitest 4 + Testing Library (NexusMD).

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Decisions → Mac / iOS; devenv changes → the Mac rows and `devenv mac key-setup`; Screens → Mac / iOS; Phase 1 amendment "Mac commands under NexusMD use `ssh -o BatchMode=yes`…"). Previous plan for patterns: `docs/superpowers/plans/2026-10-13-devenv-phase4-tests-db-emulator.md`.

**Two repositories:**
- Tasks 1–2 change `C:\repos\dev-environment` on branch `feature/nexusmd-mac`, which already exists and is checked out.
- Tasks 3–4 change the NexusMD **worktree** `C:\repos\NexusMD-Mono-devenv5` on branch `feature/devenv-mac`, which already exists. Its `node_modules` are junctions prepared by the controller.
  - Work only in that worktree. Never touch `C:\repos\NexusMD-Mono`, which another session may be using.
- Task 5 spans both.

## Global Constraints

- With `DEVENV_HOST` unset, terminal behaviour is unchanged:
  - `mac doctor`, `mac fix` and `build ios` still use `ssh -t`, and sudo asks on the terminal as today.
  - The new `mac key-setup` and `mac status` also work from a terminal.
- **Passwords never appear on a command line, in a file, or in logs.** They travel in one of two ways:
  - The sudo password is the first line of the ssh child's stdin.
  - The login password, for key setup only, is the `DEVENV_MAC_PASSWORD` environment variable of that one ssh child, read back by `ios/askpass.cmd` through `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force`.
  - The existing `build ios --password` flow is not in scope. It passes `-p:ServerPassword` to the .NET build agent, and is recorded as an amendment.
- Under NexusMD (host mode), ssh never inherits devenv's stdin, because that stdin is NexusMD's answer channel. Every Mac ssh call goes through `Invoke-MacSsh`, which gives the child its own stdin and passes its output through.
- Host mode keeps `-o BatchMode=yes` for every login except key setup's single password login.
- The key is `~/.ssh/devenv_mac_ed25519`, type ed25519, with **no passphrase**. devenv logs in with BatchMode, and Windows' ssh-agent is usually disabled.
- Key setup records the Mac's host key on first contact with `StrictHostKeyChecking=accept-new`. Every other call keeps ssh's default host-key checking.
- `mac-host.sh` exits **254** when sudo refuses the password. `mac.ps1` turns that into "The Mac refused that password for sudo - nothing was changed." Exit 255 stays "couldn't connect".
- New result kind: `mac-status` `{ kind, configured, host, user, sshKey, keyExists, connection, detail, error }`. `connection` is one of:
  - `ok`: BatchMode login works;
  - `auth`: the key is refused or missing;
  - `hostkey`: unknown or changed host key;
  - `unreachable`;
  - `error`;
  - `unconfigured`: `mac.json` is missing or invalid.
- `devenv:query` gains exactly `['mac','status','--json']`.
- Tab actions run through the provider's single run with `exclusive` taken from devenv's `Mut`. `mac doctor` is `exclusive: false`. `mac fix`, `mac key-setup` and `setup ios-sim [--remove]` are `exclusive: true`. Buttons are disabled while the provider's run is starting or running. Labels are `devenv ${argv.join(' ')}`.
- Code style:
  - devenv: compact PowerShell and bash 3.2 (no associative arrays, ASCII only).
  - NexusMD: ESM without semicolons in `src/`/`packages/`, CommonJS with semicolons in `electron/*.cjs`.
  - Comments explain why, never what.
- Tests:
  - Pester: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester <path> -Output Detailed"` from `C:\repos\dev-environment`.
  - Desktop: always with `NODE_OPTIONS=--no-experimental-webstorage`.
  - JS test strings keep Windows paths escaped. Write files with the Write/Edit tools, never shell heredocs.
- Bash in Pester tests is **Git's** bash (`<git>\bin\bash.exe`, derived from `git.exe`), never `bash` from PATH, which is WSL on this machine. Tests that need it skip when Git's bash is missing.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An ssh child swallowing NexusMD's answers.** If ssh inherited devenv's stdin, a later prompt's answer could vanish into the ssh session. Pinned in Task 1: `Invoke-MacSsh` gives the child exactly the stdin it is told to, and nothing more.
2. **A wrong sudo password.** It must be refused up front, before any fix runs, with a clear message and nothing changed. Pinned in Task 1 (Git bash plus a fake `sudo`, exit 254) and in `mac.ps1`'s mapping.
3. **The password leaking into argv.** The sudo password must never be an argument to ssh or sudo, and the login password must never be an argument to ssh. Pinned in Task 1 (the fake `sudo` logs its argv; mocked `Invoke-MacSsh` arguments) and Task 2 (mocked install call).
4. **Passwords with `& | < > ^ % ! " '` and spaces.** `askpass.cmd` must print them exactly. Pinned in Task 2.
5. **`mac.json` missing or invalid, or the key file deleted.** `mac status --json` still exits 0 with `configured: false` and the error, and the Mac tab shows guidance with Doctor and Fix disabled. Pinned in Task 2 and Task 4.

---

### Task 1: devenv — ssh with its own stdin, and sudo through stdin

**Repository:** `C:\repos\dev-environment` (branch `feature/nexusmd-mac`, already checked out)

**Files:**
- Modify: `mac-common.ps1`:
  - new `Get-DevenvSsh`;
  - new `Invoke-MacSsh`;
  - `Invoke-MacScript` gains `-SudoPassword` and uses `Invoke-MacSsh` in host mode.
- Modify: `mac.ps1`. In host mode, Fix asks for the Mac password and maps exit 254.
- Modify: `ios/mac-host.sh`:
  - `SUDO_STDIN` argument;
  - `sudo` wrapper;
  - up-front `sudo -v` check;
  - `MODE=sudo-check`.
- Test: `tests/mac-ssh.Tests.ps1` (new)

**Interfaces:**
- Produces:
  - `Get-DevenvSsh` → the full path of `ssh.exe`. It throws the existing "ssh isn't available…" message when ssh is missing.
  - `Invoke-MacSsh -Exe <path> [-ArgList <string[]>] [-Stdin <string>] [-Environment <hashtable>] [-Quiet]` returns the child's exit code as `[int]`.
    - Without `-Quiet`, it writes the child's stdout and then its stderr through `Write-Host`. stdout is passed line by line as it arrives.
    - It always sets `$script:MacSshError` to the child's whole stderr text.
    - The child's stdin receives exactly `-Stdin` (or nothing) and is then closed.
    - `-Environment` entries are added to the child's environment only.
  - `Invoke-MacScript [string[]]$Arguments [-SudoPassword <SecureString>]`. In host mode with `-SudoPassword`, it adds the remote argument `SUDO_STDIN=1` and sends `"<password>`n"` as stdin.
  - `mac-host.sh`:
    - `SUDO_STDIN=1` reads the first stdin line as the password and checks it with `sudo -v`; on refusal it prints `  FAIL  The Mac refused that password for sudo` and exits 254;
    - `MODE=sudo-check` exits 0 after that check, or right away without `SUDO_STDIN`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mac-ssh.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'launcher-common.ps1')
 . (Join-Path $root 'mac-common.ps1')
 $script:pwshExe=(Get-Process -Id $PID).Path
 $git=Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 # Git's bash, never PATH's bash (WSL on Windows).
 $script:gitBash=if ($git) { Join-Path (Split-Path (Split-Path $git.Source)) 'bin/bash.exe' }
 if ($script:gitBash -and !(Test-Path $script:gitBash)) { $script:gitBash=$null }
}

Describe 'Invoke-MacSsh' {
 It 'gives the child exactly the stdin it is told to, then closes it, and returns the exit code' {
  $code=Invoke-MacSsh -Exe $script:pwshExe -ArgList @('-NoProfile','-Command','$a=[Console]::In.ReadLine(); $b=[Console]::In.ReadLine(); Write-Output "first=$a"; Write-Output "second=$([bool]$b)"; exit 7') -Stdin "hello`n" -InformationVariable iv -InformationAction SilentlyContinue
  $code | Should -Be 7
  $lines=@($iv | ForEach-Object { "$($_.MessageData)" })
  $lines | Should -Contain 'first=hello'
  $lines | Should -Contain 'second=False'
 }
 It 'passes stderr through and keeps it in $script:MacSshError' {
  $code=Invoke-MacSsh -Exe $script:pwshExe -ArgList @('-NoProfile','-Command','[Console]::Error.WriteLine("Permission denied (publickey)"); exit 255') -InformationVariable iv -InformationAction SilentlyContinue
  $code | Should -Be 255
  $script:MacSshError | Should -Match 'Permission denied'
  @($iv | ForEach-Object { "$($_.MessageData)" }) | Should -Contain 'Permission denied (publickey)'
 }
 It 'prints nothing with -Quiet' {
  $null=Invoke-MacSsh -Exe $script:pwshExe -ArgList @('-NoProfile','-Command','Write-Output hi; [Console]::Error.WriteLine("err")') -Quiet -InformationVariable iv -InformationAction SilentlyContinue
  @($iv).Count | Should -Be 0
  $script:MacSshError | Should -Match 'err'
 }
 It 'sets -Environment on the child only' {
  Remove-Item Env:DEVENV_MAC_PASSWORD -ErrorAction SilentlyContinue
  $null=Invoke-MacSsh -Exe $script:pwshExe -ArgList @('-NoProfile','-Command','Write-Output "len=$($env:DEVENV_MAC_PASSWORD.Length)"') -Environment @{ DEVENV_MAC_PASSWORD='abc' } -InformationVariable iv -InformationAction SilentlyContinue
  @($iv | ForEach-Object { "$($_.MessageData)" }) | Should -Contain 'len=3'
  $env:DEVENV_MAC_PASSWORD | Should -BeNullOrEmpty
 }
}

Describe 'Invoke-MacScript in host mode' {
 BeforeEach { $env:DEVENV_HOST='nexusmd' }
 AfterEach { Remove-Item Env:DEVENV_HOST -ErrorAction SilentlyContinue }
 It 'sends the sudo password as stdin, never as an argument, and asks the Mac to read it' {
  Mock Get-MacConfig { @{ host='mac.local'; user='me'; sshKey='' } }
  Mock Get-DevenvSsh { 'C:\ssh.exe' }
  Mock Invoke-MacSsh { 0 }
  $pw=ConvertTo-SecureString 'right horse' -AsPlainText -Force
  Invoke-MacScript @('MODE=fix') -SudoPassword $pw
  Should -Invoke Invoke-MacSsh -Times 1 -ParameterFilter {
   $Stdin -eq "right horse`n" -and ($ArgList -join ' ') -notmatch 'right horse' -and
   ($ArgList -contains 'BatchMode=yes') -and $ArgList[-1] -match "'SUDO_STDIN=1'" -and $ArgList[-1] -match "'MODE=fix'"
  }
  $script:MacExitCode | Should -Be 0
 }
 It 'gives ssh an empty stdin without a password' {
  Mock Get-MacConfig { @{ host='mac.local'; user='me'; sshKey='' } }
  Mock Get-DevenvSsh { 'C:\ssh.exe' }
  Mock Invoke-MacSsh { 3 }
  Invoke-MacScript @('MODE=doctor')
  Should -Invoke Invoke-MacSsh -Times 1 -ParameterFilter { !$Stdin -and $ArgList[-1] -notmatch 'SUDO_STDIN' }
  $script:MacExitCode | Should -Be 3
 }
}

Describe 'mac-host.sh sudo through stdin' {
 BeforeAll {
  $script:macHost=Join-Path $TestDrive 'mac-host.sh'
  # The repo file may be checked out with CRLF; the Mac gets LF (Invoke-MacScript converts too).
  [IO.File]::WriteAllText($script:macHost,(Get-Content (Join-Path $root 'ios/mac-host.sh') -Raw).Replace("`r`n","`n"))
  $script:fake=Join-Path $TestDrive 'bin'; New-Item -ItemType Directory $script:fake | Out-Null
  $script:log=Join-Path $TestDrive 'sudo-argv.log'
  [IO.File]::WriteAllText((Join-Path $script:fake 'sudo'),"#!/bin/bash`nIFS= read -r pw`necho ""`$*"" >> ""`$SUDO_LOG""`n[ ""`$pw"" = 'right horse' ] && exit 0`necho 'Sorry, try again.' >&2`nexit 1`n")
  $script:runHost={ param([string]$Stdin,[string[]]$HostArgs)
   Invoke-MacSsh -Exe $script:gitBash -ArgList (@($script:macHost)+$HostArgs) -Stdin $Stdin -Environment @{ PATH="$($script:fake);$env:PATH"; SUDO_LOG=$script:log } -InformationVariable iv -InformationAction SilentlyContinue
   $script:hostOut=@($iv | ForEach-Object { "$($_.MessageData)" })
  }
 }
 It 'accepts the right password, checking it once with sudo -S -v' -Skip:(!$script:gitBash) {
  Remove-Item $script:log -ErrorAction SilentlyContinue
  (& $script:runHost "right horse`n" @('MODE=sudo-check','SUDO_STDIN=1')) | Should -Be 0
  $argv=Get-Content $script:log -Raw
  $argv | Should -Match '-S'
  $argv | Should -Match '-v'
  $argv | Should -Not -Match 'right horse'
 }
 It 'refuses a wrong password with exit 254 before doing anything' -Skip:(!$script:gitBash) {
  (& $script:runHost "wrong`n" @('MODE=sudo-check','SUDO_STDIN=1')) | Should -Be 254
  ($script:hostOut -join "`n") | Should -Match 'refused that password for sudo'
 }
 It 'does not read stdin without SUDO_STDIN' -Skip:(!$script:gitBash) {
  Remove-Item $script:log -ErrorAction SilentlyContinue
  (& $script:runHost "" @('MODE=sudo-check')) | Should -Be 0
  Test-Path $script:log | Should -BeFalse
 }
}
```

`-Skip:(!$script:gitBash)` is evaluated at discovery time, before `BeforeAll` has run. Also compute the Git bash path in a `BeforeDiscovery` block, into a variable used by `-Skip`. Keep the `BeforeAll` assignment for the run phase. If Pester 6 resolves `-Skip` differently, put the guard inside the test (`if (!$script:gitBash) { Set-ItResult -Skipped -Because 'no Git bash'; return }`) and note it in the report.

- [ ] **Step 2: Run them to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/mac-ssh.Tests.ps1 -Output Detailed"`
Expected: FAIL. `Invoke-MacSsh` is not recognised, and `MODE=sudo-check` is an unknown mode.

- [ ] **Step 3: Implement `mac-common.ps1`**

Add after `Get-MacConfig`:

```powershell
function Get-DevenvSsh {
 $ssh=Get-Command ssh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 if (!$ssh) { throw "ssh isn't available - add Windows' 'OpenSSH Client' (Settings > System > Optional features)." }
 $ssh.Source
}

function Invoke-MacSsh {
 # Under NexusMD this process's stdin carries the answers to devenv's prompts, so a child that
 # inherited it could swallow them. The child gets exactly -Stdin (e.g. the sudo password) and
 # then end-of-file; its output is passed through as it arrives.
 param([Parameter(Mandatory)][string]$Exe,[string[]]$ArgList=@(),[string]$Stdin,[hashtable]$Environment=@{},[switch]$Quiet)
 $psi=[Diagnostics.ProcessStartInfo]::new($Exe)
 foreach ($a in $ArgList) { $psi.ArgumentList.Add($a) }
 foreach ($k in $Environment.Keys) { $psi.Environment[$k]=[string]$Environment[$k] }
 $psi.UseShellExecute=$false
 $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
 $psi.StandardOutputEncoding=[Text.Encoding]::UTF8; $psi.StandardErrorEncoding=[Text.Encoding]::UTF8
 $p=[Diagnostics.Process]::Start($psi)
 $err=$p.StandardError.ReadToEndAsync()
 if ($Stdin) { $p.StandardInput.Write($Stdin) }
 $p.StandardInput.Close()
 while ($null -ne ($line=$p.StandardOutput.ReadLine())) { if (!$Quiet) { Write-Host $line } }
 $p.WaitForExit()
 $script:MacSshError=$err.Result
 if (!$Quiet -and $script:MacSshError) { foreach ($l in ($script:MacSshError -split "`r?`n")) { if ($l) { Write-Host $l } } }
 return $p.ExitCode
}
```

Change `Invoke-MacScript`:
- The signature becomes `function Invoke-MacScript([string[]]$Arguments,[Security.SecureString]$SudoPassword)`.
- Replace the `$ssh=Get-Command …; if (!$ssh) { throw … }` lines with `$ssh=Get-DevenvSsh`.
- Validate the arguments exactly as today. Then, before building `$quoted`, add:

```powershell
 $stdin=$null
 if ((Test-DevenvHost) -and $SudoPassword) {
  # No terminal for sudo under NexusMD: the password is the first line of the session's stdin.
  $Arguments=@($Arguments)+'SUDO_STDIN=1'
  $stdin=[Net.NetworkCredential]::new('',$SudoPassword).Password+"`n"
 }
```

- Replace the final `& $ssh.Source @sshArgs` and `$script:MacExitCode=$LASTEXITCODE` with:

```powershell
 if (Test-DevenvHost) {
  try { $script:MacExitCode=Invoke-MacSsh -Exe $ssh -ArgList $sshArgs -Stdin $stdin } finally { $stdin=$null }
 } else {
  & $ssh @sshArgs
  $script:MacExitCode=$LASTEXITCODE
 }
```

- Update the `-t` comment at the top of the function. Terminal mode keeps `-t` so sudo can prompt. Host mode gives ssh its own stdin and sends the sudo password through it.
- Update the comment above the `$sshArgs` line, which says "until the Mac password flow lands (spec phase 5)". It should now say that key setup (`devenv mac key-setup`) installs the key and sudo passwords come through stdin.

- [ ] **Step 4: Implement `ios/mac-host.sh` and `mac.ps1`**

In `ios/mac-host.sh`:
- Header comment: add the line `#   MODE=sudo-check  only check the sudo password from stdin (SUDO_STDIN=1)`.
- Defaults line: add `SUDO_STDIN=` (`MODE=doctor; …; DEVICE=; SUDO_STDIN=`).
- Whitelist: add `SUDO_STDIN` to the `case` (`MODE|PACK_SUFFIX|…|DEVICE|SUDO_STDIN) eval …`).
- Right after the `section()` helper definition, add:

```bash
# Under NexusMD there is no terminal for sudo to ask on (SUDO_STDIN=1): the Mac password is the
# first line of stdin, checked once here so a typo changes nothing, then piped to every sudo.
if [ "$SUDO_STDIN" = 1 ]; then
 IFS= read -r SUDO_PW || SUDO_PW=
 sudo() { printf '%s\n' "$SUDO_PW" | command sudo -S -p '' "$@"; }
 if ! sudo -v 2>/dev/null; then
  printf '  %sFAIL%s  %s\n' "$R" "$N" "The Mac refused that password for sudo"
  exit 254
 fi
fi
[ "$MODE" = sudo-check ] && exit 0
```

In `mac.ps1`, replace the `Invoke-MacScript (Get-MacHostArgs …)` line and the `$code`/255 lines with:

```powershell
$sudo=$null
if ($Action -eq 'Fix' -and (Test-DevenvHost)) {
 $cfg=Get-MacConfig
 $sudo=Request-DevenvInput "Mac password for $($cfg.user)@$($cfg.host)" -AsSecureString -Title 'Mac password (for sudo)' `
  -Detail 'Fixes that change system settings on the Mac run with sudo. The password goes once over this ssh connection and is not stored.'
}
Invoke-MacScript (Get-MacHostArgs $info $(if ($Action -eq 'Fix') { 'fix' } else { 'doctor' })) -SudoPassword $sudo
$code=$script:MacExitCode
if ($code -eq 255) { throw "Couldn't connect to the Mac (ssh exit 255). Check mac.json, that the Mac is on and that Remote Login is enabled (System Settings > General > Sharing)." }
if ($code -eq 254) { throw 'The Mac refused that password for sudo - nothing was changed. Run Fix again with your Mac login password.' }
```

Leave the `$total` lines below unchanged.

- [ ] **Step 5: Run the tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: PASS. That covers the whole suite (115 before this task), including `no-console.Tests.ps1`, which still finds `BatchMode=yes` in `mac-common.ps1`.

- [ ] **Step 6: Commit**

```bash
git add mac-common.ps1 mac.ps1 ios/mac-host.sh tests/mac-ssh.Tests.ps1
git commit -m "feat: Mac ssh gets its own stdin under NexusMD; sudo password through stdin"
```

---

### Task 2: devenv — `mac key-setup`, `ios/askpass.cmd`, `mac status --json`

**Repository:** `C:\repos\dev-environment`

**Files:**
- Create: `ios/askpass.cmd`
- Modify: `mac-common.ps1`. New functions:
  - `Get-DevenvMacKeyPath`;
  - `Test-DevenvPublicKey`;
  - `Get-DevenvKeyInstallCommand`;
  - `Set-DevenvMacKey`;
  - `Invoke-DevenvMacKeySetup`;
  - `Get-DevenvSshProblem`;
  - `ConvertTo-DevenvMacStatus`;
  - `Get-DevenvMacStatus`.
- Modify: `mac.ps1`. Actions `Status` and `KeySetup` and a `-Json` switch, dispatched **before** `$info=Get-IosBuildInfo`, since neither needs dotnet.
- Modify: `devenv.ps1`. Add `mac status` and `mac key-setup` entries.
- Modify: `README.md`, in the "iOS: the Mac build host" section and the "Running under NexusMD" Mac note.
- Test: `tests/mac-key.Tests.ps1` (new), `tests/catalog.Tests.ps1`

**Interfaces:**
- Consumes: `Get-DevenvSsh`, `Invoke-MacSsh` (Task 1).
- Produces:
  - `devenv mac key-setup`, which is mutating.
  - `devenv mac status [--json]`, which is read-only. It prints one line of kind `mac-status` and always exits 0 with `--json`.

`mac-status` fields:
- `configured: bool`;
- `host`, `user`, `sshKey`: each `string|null`;
- `keyExists: bool`;
- `connection: 'ok'|'auth'|'hostkey'|'unreachable'|'error'|'unconfigured'`;
- `detail`: the first stderr line, `string|null`;
- `error`: a `mac.json` problem, `string|null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mac-key.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'launcher-common.ps1')
 . (Join-Path $root 'mac-common.ps1')
}

Describe 'ios/askpass.cmd' {
 It 'prints the password from DEVENV_MAC_PASSWORD exactly, special characters and all' {
  $pw=' p@ss w0rd!^&|<>%PATH%"'' end '
  $psi=[Diagnostics.ProcessStartInfo]::new('cmd.exe')
  foreach ($a in @('/d','/c',(Join-Path $root 'ios/askpass.cmd'))) { $psi.ArgumentList.Add($a) }
  $psi.UseShellExecute=$false; $psi.RedirectStandardOutput=$true
  $psi.Environment['DEVENV_MAC_PASSWORD']=$pw
  $p=[Diagnostics.Process]::Start($psi); $out=$p.StandardOutput.ReadToEnd(); $p.WaitForExit()
  $out.TrimEnd("`r","`n") | Should -BeExactly $pw
 }
}

Describe 'key install helpers' {
 It 'accepts ed25519 public keys and builds an idempotent install command' {
  $pub='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample+/= devenv@PC-1'
  Test-DevenvPublicKey $pub | Should -BeTrue
  $cmd=Get-DevenvKeyInstallCommand $pub
  $cmd | Should -Match "grep -qxF '$([regex]::Escape($pub))' ~/.ssh/authorized_keys \|\| echo '$([regex]::Escape($pub))' >> ~/.ssh/authorized_keys"
  $cmd | Should -Match 'chmod 700 ~/.ssh'
 }
 It 'refuses anything else' {
  foreach ($bad in @("ssh-ed25519 AAAA x'; rm -rf ~; echo '",'ssh-rsa AAAA','')) {
   Test-DevenvPublicKey $bad | Should -BeFalse
   { Get-DevenvKeyInstallCommand $bad } | Should -Throw
  }
 }
 It 'writes sshKey into mac.json and keeps the other fields' {
  $f=Join-Path $TestDrive 'mac.json'
  Set-Content $f '{"host":"mac.local","user":"me","sshKey":"","note":"keep"}'
  Set-DevenvMacKey $f 'C:\Users\me\.ssh\devenv_mac_ed25519'
  $j=Get-Content $f -Raw | ConvertFrom-Json -AsHashtable
  $j.sshKey | Should -Be 'C:\Users\me\.ssh\devenv_mac_ed25519'
  $j.host | Should -Be 'mac.local'; $j.note | Should -Be 'keep'
 }
}

Describe 'Invoke-DevenvMacKeySetup' {
 BeforeEach {
  $script:cfgPath=Join-Path $TestDrive "mac-$([guid]::NewGuid()).json"
  Set-Content $script:cfgPath '{"host":"mac.local","user":"me","sshKey":""}'
  $script:key=Join-Path $TestDrive "k-$([guid]::NewGuid())"
  $script:args=@{ Config=@{ host='mac.local'; user='me' }; ConfigPath=$script:cfgPath; KeyPath=$script:key; Ssh='C:\ssh.exe'; KeyGen='C:\ssh-keygen.exe' }
  Mock Write-Host {}
 }
 It 'creates a missing key without a passphrase, then stops asking when the key already works' {
  Mock Invoke-MacSsh -ParameterFilter { $Exe -eq 'C:\ssh-keygen.exe' } { Set-Content "$($ArgList[-1]).pub" 'ssh-ed25519 AAAAC3Nza devenv@PC'; 0 }
  Mock Invoke-MacSsh -ParameterFilter { $Exe -eq 'C:\ssh.exe' } { 0 }
  Mock Request-DevenvInput { throw 'should not ask' }
  Invoke-DevenvMacKeySetup @script:args
  Should -Invoke Invoke-MacSsh -ParameterFilter { $Exe -eq 'C:\ssh-keygen.exe' -and ($ArgList -join ' ') -match "-t ed25519 -N  -C" -and $ArgList[-1] -eq $script:key } -Times 1
  (Get-Content $script:cfgPath -Raw | ConvertFrom-Json).sshKey | Should -Be $script:key
 }
 It 'installs the key with one password login through askpass, never putting the password in argv' {
  Set-Content $script:key 'private'; Set-Content "$($script:key).pub" 'ssh-ed25519 AAAAC3Nza devenv@PC'
  $script:probe=0
  Mock Invoke-MacSsh -ParameterFilter { $ArgList -contains 'BatchMode=yes' } { $script:probe++; if ($script:probe -eq 1) { 255 } else { 0 } }
  Mock Invoke-MacSsh -ParameterFilter { $ArgList -notcontains 'BatchMode=yes' } { 0 }
  Mock Request-DevenvInput { ConvertTo-SecureString 'p@ss & word' -AsPlainText -Force }
  Invoke-DevenvMacKeySetup @script:args
  Should -Invoke Invoke-MacSsh -Times 1 -ParameterFilter {
   $ArgList -notcontains 'BatchMode=yes' -and ($ArgList -join ' ') -notmatch 'p@ss' -and
   $Environment.DEVENV_MAC_PASSWORD -eq 'p@ss & word' -and $Environment.SSH_ASKPASS_REQUIRE -eq 'force' -and
   $Environment.SSH_ASKPASS -like '*ios*askpass.cmd' -and ($ArgList -contains 'StrictHostKeyChecking=accept-new') -and
   $ArgList[-1] -match 'authorized_keys'
  }
  (Get-Content $script:cfgPath -Raw | ConvertFrom-Json).sshKey | Should -Be $script:key
 }
 It 'leaves mac.json alone when the password login fails' {
  Set-Content $script:key 'private'; Set-Content "$($script:key).pub" 'ssh-ed25519 AAAAC3Nza devenv@PC'
  Mock Invoke-MacSsh { 255 }
  Mock Request-DevenvInput { ConvertTo-SecureString 'nope' -AsPlainText -Force }
  { Invoke-DevenvMacKeySetup @script:args } | Should -Throw "*Couldn't log in to me@mac.local*"
  (Get-Content $script:cfgPath -Raw | ConvertFrom-Json).sshKey | Should -Be ''
 }
}

Describe 'mac status' {
 It 'classifies ssh failures' {
  Get-DevenvSshProblem 'me@mac.local: Permission denied (publickey,password).' | Should -Be 'auth'
  Get-DevenvSshProblem 'Host key verification failed.' | Should -Be 'hostkey'
  Get-DevenvSshProblem 'ssh: connect to host mac.local port 22: Connection timed out' | Should -Be 'unreachable'
  Get-DevenvSshProblem 'ssh: Could not resolve hostname mac: No such host is known.' | Should -Be 'unreachable'
  Get-DevenvSshProblem 'something odd' | Should -Be 'error'
 }
 It 'converts to a mac-status result' {
  $s=ConvertTo-DevenvMacStatus -Config @{ host='mac.local'; user='me'; sshKey='C:\k' } -KeyExists $true -Connection 'ok'
  $s.kind | Should -Be 'mac-status'
  $s.configured | Should -BeTrue; $s.host | Should -Be 'mac.local'; $s.connection | Should -Be 'ok'; $s.error | Should -BeNullOrEmpty
  $u=ConvertTo-DevenvMacStatus -Problem 'No mac.json in C:\p'
  $u.configured | Should -BeFalse; $u.connection | Should -Be 'unconfigured'; $u.error | Should -Be 'No mac.json in C:\p'
 }
 It 'reports a missing or invalid mac.json without connecting' {
  Mock Invoke-MacSsh { throw 'should not connect' }
  $missing=Get-DevenvMacStatus -ConfigPath (Join-Path $TestDrive 'none.json')
  $missing.connection | Should -Be 'unconfigured'; $missing.error | Should -Match 'No mac.json'
  $bad=Join-Path $TestDrive 'bad.json'; Set-Content $bad '{"host":"bad host!","user":"me"}'
  (Get-DevenvMacStatus -ConfigPath $bad).error | Should -Match "'host'"
  $gone=Join-Path $TestDrive 'gone.json'; Set-Content $gone ('{"host":"mac.local","user":"me","sshKey":"' + (Join-Path $TestDrive 'nokey').Replace('\','\\') + '"}')
  $g=Get-DevenvMacStatus -ConfigPath $gone
  $g.configured | Should -BeFalse; $g.error | Should -Match 'sshKey file not found'; $g.host | Should -Be 'mac.local'
 }
 It 'probes the login quietly with BatchMode and the key' {
  $k=Join-Path $TestDrive 'probe-key'; Set-Content $k 'x'
  $c=Join-Path $TestDrive 'ok.json'; Set-Content $c ('{"host":"mac.local","user":"me","sshKey":"' + $k.Replace('\','\\') + '"}')
  Mock Get-DevenvSsh { 'C:\ssh.exe' }
  Mock Invoke-MacSsh { $script:MacSshError='me@mac.local: Permission denied (publickey).'; 255 }
  $s=Get-DevenvMacStatus -ConfigPath $c
  Should -Invoke Invoke-MacSsh -Times 1 -ParameterFilter { $Quiet -and ($ArgList -contains 'BatchMode=yes') -and ($ArgList -contains $k) -and $ArgList[-1] -eq 'true' }
  $s.connection | Should -Be 'auth'; $s.detail | Should -Match 'Permission denied'; $s.keyExists | Should -BeTrue
 }
 It 'devenv mac status --json prints one mac-status line and exits 0' {
  $env:DEVENV_PROFILE=Join-Path $root 'profile.example'
  try { $lines=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') mac status --json); $code=$LASTEXITCODE }
  finally { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }
  $code | Should -Be 0; $lines.Count | Should -Be 1
  $r=$lines[0].Substring(9) | ConvertFrom-Json -AsHashtable
  $r.kind | Should -Be 'mac-status'; $r.connection | Should -Be 'unconfigured'
 }
}
```

`profile.example` has no `mac.json`, which is why the CLI test expects `unconfigured`.

The 'probes the login quietly' test sets `$script:MacSshError` inside a Pester mock. If that assignment is not visible to `Get-DevenvMacStatus`, because Pester runs mock bodies in another scope, keep the function as written. Make the test reach the same state another way, for example `Mock Invoke-MacSsh { Set-Variable -Name MacSshError -Scope Script -Value '…'; 255 }`, or by asserting through a real `pwsh` child as in Task 1. Say which in the report.

Add to `tests/catalog.Tests.ps1`:

```powershell
 It 'mac status is read-only with a hidden --json; mac key-setup changes state' {
  (Get-Cmd 'mac' 'status').mut | Should -BeFalse
  (Get-Cmd 'mac' 'status').switches | Should -Not -Contain 'json'
  (Get-Cmd 'mac' 'key-setup').mut | Should -BeTrue
 }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests/mac-key.Tests.ps1, ./tests/catalog.Tests.ps1 -Output Detailed"`
Expected: FAIL. `askpass.cmd` and the functions are missing.

- [ ] **Step 3: Implement `ios/askpass.cmd`**

Write it with CRLF line endings:

```bat
@echo off
rem ssh runs this (SSH_ASKPASS, SSH_ASKPASS_REQUIRE=force) during devenv mac key-setup to read
rem the Mac password devenv put in that one ssh process's environment. Delayed expansion
rem prints the value without cmd re-reading & | < > ^ in it.
setlocal EnableDelayedExpansion
echo(!DEVENV_MAC_PASSWORD!
```

If the test shows a character that does not survive (for example `!`), switch the body to `powershell -NoProfile -NonInteractive -Command "[Console]::Out.Write($env:DEVENV_MAC_PASSWORD)"` and keep the comment's reason. Note it in the report.

- [ ] **Step 4: Implement the functions in `mac-common.ps1`**

```powershell
function Get-DevenvMacKeyPath { Join-Path $HOME '.ssh/devenv_mac_ed25519' }

function Test-DevenvPublicKey([string]$Text) { $Text -match '^ssh-ed25519 [A-Za-z0-9+/=]+( [A-Za-z0-9@._-]+)?$' }

function Get-DevenvKeyInstallCommand([string]$PublicKey) {
 # The key goes inside single quotes in the Mac's shell, so only the strict key shape is allowed.
 if (!(Test-DevenvPublicKey $PublicKey)) { throw "Not an ed25519 public key: $PublicKey" }
 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF '$PublicKey' ~/.ssh/authorized_keys || echo '$PublicKey' >> ~/.ssh/authorized_keys)"
}

function Set-DevenvMacKey([string]$ConfigPath,[string]$KeyPath) {
 $cfg=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable
 $cfg['sshKey']=$KeyPath
 $tmp="$ConfigPath.tmp"
 ($cfg | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $tmp -Encoding utf8NoBOM
 Move-Item -LiteralPath $tmp -Destination $ConfigPath -Force
}

function Invoke-DevenvMacKeySetup {
 param([Parameter(Mandatory)]$Config,[Parameter(Mandatory)][string]$ConfigPath,[Parameter(Mandatory)][string]$KeyPath,
  [Parameter(Mandatory)][string]$Ssh,[string]$KeyGen)
 $target="$($Config.user)@$($Config.host)"
 if (!(Test-Path -LiteralPath $KeyPath)) {
  if (!$KeyGen) { throw "ssh-keygen isn't available - add Windows' 'OpenSSH Client' (Settings > System > Optional features)." }
  New-Item -ItemType Directory -Force -Path (Split-Path $KeyPath) | Out-Null
  # No passphrase: devenv logs in with BatchMode (nothing can ask) and Windows' ssh-agent is usually off.
  $code=Invoke-MacSsh -Exe $KeyGen -ArgList @('-q','-t','ed25519','-N','','-C',"devenv@$env:COMPUTERNAME",'-f',$KeyPath)
  if ($code) { throw "ssh-keygen failed (exit $code)." }
  Write-Host "Created $KeyPath" -ForegroundColor Green
 } else { Write-Host "Using the existing key $KeyPath" -ForegroundColor DarkGray }
 # accept-new: the first contact records the Mac's host key; a changed key still fails.
 $common=@('-o','ConnectTimeout=10','-o','StrictHostKeyChecking=accept-new')
 $probe=$common+@('-o','BatchMode=yes','-i',$KeyPath,$target,'true')
 if ((Invoke-MacSsh -Exe $Ssh -ArgList $probe -Quiet) -eq 0) {
  Write-Host "The key already works on $target." -ForegroundColor Green
 } else {
  $pub=(Get-Content -LiteralPath "$KeyPath.pub" -Raw).Trim()
  $install=Get-DevenvKeyInstallCommand $pub
  $pw=Request-DevenvInput "Mac password for $target" -AsSecureString -Title 'Mac password' `
   -Detail "Used once to add this PC's devenv key to ~/.ssh/authorized_keys on the Mac. Not stored."
  $plain=[Net.NetworkCredential]::new('',$pw).Password
  try {
   Write-Host "Adding the key to $target..." -ForegroundColor DarkGray
   $code=Invoke-MacSsh -Exe $Ssh -ArgList ($common+@('-o','PreferredAuthentications=password,keyboard-interactive','-o','PubkeyAuthentication=no','-o','NumberOfPasswordPrompts=1',$target,$install)) `
    -Environment @{ SSH_ASKPASS=(Join-Path $PSScriptRoot 'ios/askpass.cmd'); SSH_ASKPASS_REQUIRE='force'; DEVENV_MAC_PASSWORD=$plain }
  } finally { $plain=$null }
  if ($code -eq 255) { throw "Couldn't log in to $target with that password (ssh exit 255). Check the password, that the Mac is on and that Remote Login is enabled." }
  if ($code) { throw "Adding the key on the Mac failed (exit $code)." }
  if ((Invoke-MacSsh -Exe $Ssh -ArgList $probe) -ne 0) { throw "The key was added but logging in with it still fails - see the ssh message above." }
  Write-Host "The Mac accepts the key." -ForegroundColor Green
 }
 Set-DevenvMacKey $ConfigPath $KeyPath
 Write-Host "mac.json now uses $KeyPath - Mac commands from NexusMD no longer need a password to log in." -ForegroundColor Green
}

function Get-DevenvSshProblem([string]$Stderr) {
 if ($Stderr -match 'Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED') { return 'hostkey' }
 if ($Stderr -match 'Permission denied|Too many authentication failures') { return 'auth' }
 if ($Stderr -match 'timed out|No route to host|Connection refused|Could not resolve|Network is unreachable|No such host') { return 'unreachable' }
 'error'
}

function ConvertTo-DevenvMacStatus {
 param([Collections.IDictionary]$Config,[bool]$KeyExists,[string]$Connection,[string]$Detail,[string]$Problem)
 $str={ param($v) if ($v) { [string]$v } else { $null } }
 [ordered]@{
  kind='mac-status'; configured=[bool]($Config -and !$Problem)
  host=(& $str $Config.host); user=(& $str $Config.user); sshKey=(& $str $Config.sshKey); keyExists=$KeyExists
  connection=$(if ($Problem -or !$Config) { 'unconfigured' } elseif ($Connection) { $Connection } else { 'error' })
  detail=(& $str $Detail); error=(& $str $Problem)
 }
}

function Get-DevenvMacStatus([string]$ConfigPath=(Join-Path (Get-DevEnvProfileDir) 'mac.json')) {
 # Never throws: the Mac tab shows what's wrong with mac.json instead of a failed command.
 if (!(Test-Path -LiteralPath $ConfigPath)) { return ConvertTo-DevenvMacStatus -Problem "No mac.json in $(Split-Path $ConfigPath) - create it with {""host"":""<mac ip or name>"",""user"":""<mac login>""}." }
 try { $raw=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable } catch { return ConvertTo-DevenvMacStatus -Problem "mac.json isn't valid JSON." }
 $problem=if ("$($raw.host)" -notmatch '^[A-Za-z0-9.-]+$') { "mac.json: 'host' must be the Mac's IP address or host name." }
  elseif ("$($raw.user)" -notmatch '^[A-Za-z0-9._-]+$') { "mac.json: 'user' must be your Mac login name." }
  elseif ($raw.sshKey -and !(Test-Path -LiteralPath $raw.sshKey)) { "mac.json: sshKey file not found: $($raw.sshKey) - run Set up SSH key again." }
 $keyExists=[bool]($raw.sshKey -and (Test-Path -LiteralPath $raw.sshKey))
 if ($problem) { return ConvertTo-DevenvMacStatus -Config $raw -KeyExists $keyExists -Problem $problem }
 $sshArgs=@('-o','BatchMode=yes','-o','ConnectTimeout=5')
 if ($raw.sshKey) { $sshArgs+=@('-i',$raw.sshKey) }
 $code=Invoke-MacSsh -Exe (Get-DevenvSsh) -ArgList ($sshArgs+@("$($raw.user)@$($raw.host)",'true')) -Quiet
 $first=@("$script:MacSshError" -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -First 1
 ConvertTo-DevenvMacStatus -Config $raw -KeyExists $keyExists -Connection $(if ($code -eq 0) { 'ok' } else { Get-DevenvSshProblem $script:MacSshError }) -Detail $(if ($code) { $first })
}
```

- [ ] **Step 5: Wire `mac.ps1` and `devenv.ps1`**

In `mac.ps1`:
- Set `param([ValidateSet('Doctor','Fix','IosSim','Status','KeySetup')][string]$Action='Doctor',[switch]$Remove,[switch]$Json)`.
- Add to the header comment: `./mac.ps1 Status [-Json]` (config + can it log in) and `./mac.ps1 KeySetup` (one password login installs this PC's devenv key on the Mac).
- Right after the function definitions and **before** `$info=Get-IosBuildInfo`, add:

```powershell
if ($Action -eq 'Status') {
 $s=Get-DevenvMacStatus
 if ($Json) { Write-DevenvEvent result $s -Force; return }
 Write-Host "Mac  $(if ($s.host) { "$($s.user)@$($s.host)" } else { '(not configured)' })"
 Write-Host "  key         $(if ($s.sshKey) { "$($s.sshKey)$(if (!$s.keyExists) { ' (missing)' })" } else { 'none - devenv mac key-setup' })"
 Write-Host "  connection  $($s.connection)$(if ($s.detail) { " - $($s.detail)" })"
 if ($s.error) { Write-Host "  $($s.error)" -ForegroundColor Yellow }
 return
}
if ($Action -eq 'KeySetup') {
 $cfgPath=Join-Path (Get-DevEnvProfileDir) 'mac.json'
 # Get-MacConfig refuses an sshKey that no longer exists - exactly the case key-setup repairs.
 $raw=if (Test-Path -LiteralPath $cfgPath) { Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json -AsHashtable }
 if ($raw -and $raw.sshKey -and !(Test-Path -LiteralPath $raw.sshKey)) {
  Write-Host "mac.json's sshKey ($($raw.sshKey)) no longer exists - setting up a new key." -ForegroundColor Yellow
  Set-DevenvMacKey $cfgPath ''
 }
 $keygen=Get-Command ssh-keygen -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 Invoke-DevenvMacKeySetup -Config (Get-MacConfig) -ConfigPath $cfgPath -KeyPath (Get-DevenvMacKeyPath) `
  -Ssh (Get-DevenvSsh) -KeyGen $(if ($keygen) { $keygen.Source })
 return
}
```

In `devenv.ps1`, after `mac fix`, add:

```powershell
 @{G='mac';V='status';A='';S='Is the Mac configured, and does devenv log in with its key?';Sw=@();HSw=@('json');Val=@();Mut=$false
   Run={ param($a,$o) $n=@{Action='Status'}; if ($o['json']) { $n.Json=$true }; Invoke-Script 'mac.ps1' $n }}
 @{G='mac';V='key-setup';A='';S="Create this PC's devenv ssh key and add it to the Mac (asks for the Mac password once)";Sw=@();Val=@()
   Run={ Invoke-Script 'mac.ps1' @{Action='KeySetup'} }}
```

In `README.md`:
- In "iOS: the Mac build host", add a short paragraph on `devenv mac key-setup`. It creates `~/.ssh/devenv_mac_ed25519` without a passphrase, adds it to `authorized_keys` on the Mac with one password login, and writes `sshKey`. Also mention `devenv mac status`.
- In "Running under NexusMD", replace "Mac commands under NexusMD need key auth (`sshKey` in `mac.json`) for now." with: Mac commands under NexusMD log in with the devenv key (set it up once with `devenv mac key-setup` or the Mac tab); `mac fix` asks for the Mac password through NexusMD and sends it to sudo over the ssh connection's stdin.

- [ ] **Step 6: Run the tests**

Run: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester ./tests -Output Detailed"`
Expected: PASS (all).

Then check by hand, read-only and safe:
- `pwsh -NoProfile -File ./devenv.ps1 mac status` against the real profile prints the host, `key none` and a connection state. It must not change anything: BatchMode with default host-key checking writes nothing.
- Do **not** run `mac key-setup` against the real Mac; that is the user's GUI checklist.

- [ ] **Step 7: Commit**

```bash
git add ios/askpass.cmd mac-common.ps1 mac.ps1 devenv.ps1 README.md tests/mac-key.Tests.ps1 tests/catalog.Tests.ps1
git commit -m "feat: devenv mac key-setup (askpass, one password login) and mac status for NexusMD"
```

---

### Task 3: NexusMD — query allowlist and core Mac model

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv5`

**Files:**
- Modify: `apps/desktop/electron/ipc/devenv.cjs` (`QUERIES` gains `['mac', 'status', '--json']`), `apps/desktop/electron/ipc/devenv.test.js`
- Create: `packages/core/src/modules/devenv/mac.js`, `mac.test.js`
- Modify: `packages/core/src/modules/devenv/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces:**
- Produces, for Task 4:
  - `normaliseMacStatus(result)` → `{ configured, host, user, sshKey, keyExists, connection, detail, error }`. An unknown `connection` reads as `'error'`, and `configured: false` forces `'unconfigured'`. It throws `'Not a devenv mac-status result'`.
  - `buildMacArgv(action)` for `'doctor' | 'fix' | 'key-setup' | 'ios-sim' | 'ios-sim-remove'` → `['mac','doctor']`, `['mac','fix']`, `['mac','key-setup']`, `['setup','ios-sim']`, `['setup','ios-sim','--remove']`. It throws on anything else.
  - `macConnectionText(connection)` → a sentence for the UI.

- [ ] **Step 1: Write the failing tests**

In `devenv.test.js`, add `['mac', 'status', '--json']` to the "allows the phase 4 data commands" style test, or add a new one:

```js
  it('query allows mac status', async () => {
    const p = t.handlers['devenv:query'](null, CONFIG, ['mac', 'status', '--json'])
    await tick()
    t.children.at(-1).finish(0)
    await expect(p).resolves.toHaveProperty('code', 0)
    await expect(t.handlers['devenv:query'](null, CONFIG, ['mac', 'status'])).rejects.toThrow(/Not a devenv query/)
  })
```

`mac.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normaliseMacStatus, buildMacArgv, macConnectionText } from './mac.js'

const raw = over => ({ type: 'result', kind: 'mac-status', configured: true, host: 'mac.local', user: 'me', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, connection: 'ok', detail: null, error: null, ...over })

describe('normaliseMacStatus', () => {
  it('keeps the fields', () => {
    expect(normaliseMacStatus(raw())).toEqual({ configured: true, host: 'mac.local', user: 'me', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, connection: 'ok', detail: null, error: null })
  })
  it('reads an unknown connection as error, and unconfigured whenever configured is false', () => {
    expect(normaliseMacStatus(raw({ connection: 'weird' })).connection).toBe('error')
    expect(normaliseMacStatus(raw({ configured: false, connection: 'ok', error: 'No mac.json' }))).toMatchObject({ configured: false, connection: 'unconfigured', error: 'No mac.json' })
  })
  it('survives junk', () => {
    expect(normaliseMacStatus({ kind: 'mac-status', host: 3, keyExists: 'yes' })).toMatchObject({ configured: false, host: null, keyExists: false, connection: 'unconfigured' })
  })
  it('rejects other results', () => { expect(() => normaliseMacStatus({ kind: 'status' })).toThrow('Not a devenv mac-status result') })
})

describe('buildMacArgv', () => {
  it('builds each action', () => {
    expect(buildMacArgv('doctor')).toEqual(['mac', 'doctor'])
    expect(buildMacArgv('fix')).toEqual(['mac', 'fix'])
    expect(buildMacArgv('key-setup')).toEqual(['mac', 'key-setup'])
    expect(buildMacArgv('ios-sim')).toEqual(['setup', 'ios-sim'])
    expect(buildMacArgv('ios-sim-remove')).toEqual(['setup', 'ios-sim', '--remove'])
  })
  it('refuses anything else', () => { expect(() => buildMacArgv('rm')).toThrow() })
})

describe('macConnectionText', () => {
  it('explains every state', () => {
    for (const c of ['ok', 'auth', 'hostkey', 'unreachable', 'error', 'unconfigured']) expect(macConnectionText(c)).toMatch(/\w/)
    expect(macConnectionText('auth')).toMatch(/key/i)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv/mac.test.js` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/devenv.test.js`
Expected: FAIL. `mac.js` is missing, and the query is rejected.

- [ ] **Step 3: Implement**

In `devenv.cjs`, add `['mac', 'status', '--json']` to `QUERIES`.

`mac.js`:

```js
// packages/core/src/modules/devenv/mac.js
//
// The Mac tab's model: devenv's view of mac.json and whether it can log in, and the argv for
// each Mac action.

const CONNECTIONS = ['ok', 'auth', 'hostkey', 'unreachable', 'error', 'unconfigured']
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseMacStatus(result) {
  if (!result || result.kind !== 'mac-status') throw new Error('Not a devenv mac-status result')
  const configured = result.configured === true
  const connection = !configured ? 'unconfigured' : CONNECTIONS.includes(result.connection) ? result.connection : 'error'
  return {
    configured, host: str(result.host), user: str(result.user), sshKey: str(result.sshKey),
    keyExists: result.keyExists === true, connection, detail: str(result.detail), error: str(result.error),
  }
}

const ACTIONS = {
  doctor: ['mac', 'doctor'], fix: ['mac', 'fix'], 'key-setup': ['mac', 'key-setup'],
  'ios-sim': ['setup', 'ios-sim'], 'ios-sim-remove': ['setup', 'ios-sim', '--remove'],
}

export function buildMacArgv(action) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error(`Unknown Mac action: ${action}`)
  return [...ACTIONS[action]]
}

const TEXT = {
  ok: 'devenv logs in to the Mac with its key.',
  auth: "The Mac doesn't accept this PC's key yet - set up the SSH key.",
  hostkey: "The Mac's host key is unknown or has changed - check it is the right Mac, then set up the SSH key.",
  unreachable: "Can't reach the Mac - is it on, on this network, with Remote Login enabled?",
  error: 'ssh failed - see the detail below.',
  unconfigured: 'mac.json is missing or invalid.',
}

export function macConnectionText(connection) {
  return TEXT[connection] ?? TEXT.error
}
```

Export from `modules/devenv/index.js`:

```js
export { normaliseMacStatus, buildMacArgv, macConnectionText } from './mac.js'
```

Then add the same three names to the devenv export list in `packages/core/src/index.js` and in `packages/core/tests/public-api.test.js`.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/core test` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/ipc/devenv.test.js packages/core/src packages/core/tests/public-api.test.js
git commit -m "feat(core): devenv mac status model and argv; allow the mac status query"
```

---

### Task 4: Mac tab, wizard and spec amendments

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv5`

**Files:**
- Create: `apps/desktop/src/views/devenv/mac-view.jsx`, `mac-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx`:
  - add `'Mac'` to `TABS` before `'Commands'`;
  - render `MacView`;
  - update the comment, so only the Profile tab is left for a later phase.
- Modify: `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 5 amendments)

**Interfaces:**
- Consumes:
  - `useDevenvRunContext()` → `{ state, start, cancel, config }`;
  - `useDevenvQuery`;
  - core `normaliseMacStatus`, `buildMacArgv`, `macConnectionText`;
  - `RunPanel`.
  - The existing provider shows devenv's `secret` prompts (the Mac password) as a masked dialog, so this tab never handles a password.
- Produces: `MacView({ adapter })`.

Layout:
- **Mac build host card:**
  - `user@host`, or "Not configured".
  - The key line: the `sshKey` path; "(file missing)" when `!keyExists`; or "No devenv key yet".
  - The connection line: a dot (green for `ok`, otherwise grey), with `macConnectionText`.
  - `detail` in muted text when present.
  - `error` in an alert.
  - **Refresh**.
- **Set up SSH key card:**
  - When `configured && connection !== 'ok'`, it is shown expanded. It explains the four steps:
    1. Creates `~/.ssh/devenv_mac_ed25519` on this PC (if missing).
    2. Asks for your Mac password once.
    3. Adds the key to `~/.ssh/authorized_keys` on the Mac.
    4. Saves it in `mac.json`.
  - It has a **Set up SSH key** button.
  - When `connection === 'ok'`, only a small ghost button **Set up the key again** is shown.
  - When not configured, there is no wizard. The alert says to create `mac.json` in the profile with `{"host":"…","user":"…"}`.
- **Checks card:**
  - **Doctor**, which is non-exclusive.
  - **Fix**, which is exclusive. Muted hint: "Fixes that need sudo ask for your Mac password."
  - Both are disabled when `!configured`, as well as while busy.
- **iOS simulator builds card:**
  - Muted text: "Rider / dotnet on this PC build simulator apps as x64; the Apple Silicon simulator needs arm64."
  - **Make simulator builds arm64** (`setup ios-sim`) and **Remove** (`setup ios-sim --remove`).
- `RunPanel` shows when the command starts with `devenv mac ` or `devenv setup ios-sim`.

- [ ] **Step 1: Write the failing test**

`mac-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { MacView } from './mac-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const STATUS = over => ({ type: 'result', kind: 'mac-status', configured: true, host: 'mac.local', user: 'me', sshKey: null, keyExists: false, connection: 'auth', detail: 'me@mac.local: Permission denied (publickey).', error: null, ...over })

function setup({ status = STATUS(), over = {} } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const adapter = { query: vi.fn(async () => ({ code: 0, stderr: '', results: [status] })) }
  render(<MacView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('MacView', () => {
  it('shows the host, the missing key and why it cannot log in, with the wizard open', async () => {
    const { run } = setup()
    await screen.findByText('me@mac.local')
    expect(screen.getByText('No devenv key yet')).toBeTruthy()
    expect(screen.getByText("The Mac doesn't accept this PC's key yet - set up the SSH key.")).toBeTruthy()
    expect(screen.getByText('me@mac.local: Permission denied (publickey).')).toBeTruthy()
    expect(screen.getByText('Asks for your Mac password once.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up SSH key' }))
    expect(run.start).toHaveBeenCalledWith(['mac', 'key-setup'], { exclusive: true, label: 'devenv mac key-setup' })
  })

  it('folds the wizard away once the key works', async () => {
    setup({ status: STATUS({ connection: 'ok', sshKey: 'C:\\Users\\me\\.ssh\\devenv_mac_ed25519', keyExists: true, detail: null }) })
    await screen.findByText('C:\\Users\\me\\.ssh\\devenv_mac_ed25519')
    expect(screen.queryByText('Asks for your Mac password once.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Set up the key again' })).toBeTruthy()
  })

  it('runs Doctor alongside other runs and Fix exclusively', async () => {
    const { run } = setup({ status: STATUS({ connection: 'ok' }) })
    await screen.findByText('me@mac.local')
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))
    expect(run.start).toHaveBeenLastCalledWith(['mac', 'doctor'], { exclusive: false, label: 'devenv mac doctor' })
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(run.start).toHaveBeenLastCalledWith(['mac', 'fix'], { exclusive: true, label: 'devenv mac fix' })
  })

  it('sets up and removes arm64 simulator builds', async () => {
    const { run } = setup()
    await screen.findByText('me@mac.local')
    fireEvent.click(screen.getByRole('button', { name: 'Make simulator builds arm64' }))
    expect(run.start).toHaveBeenLastCalledWith(['setup', 'ios-sim'], { exclusive: true, label: 'devenv setup ios-sim' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(run.start).toHaveBeenLastCalledWith(['setup', 'ios-sim', '--remove'], { exclusive: true, label: 'devenv setup ios-sim --remove' })
  })

  it('without mac.json shows what to do and disables Doctor, Fix and the wizard', async () => {
    setup({ status: STATUS({ configured: false, host: null, user: null, connection: 'unconfigured', detail: null, error: 'No mac.json in C:\\p - create it with {"host":"<mac ip or name>","user":"<mac login>"}.' }) })
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => /No mac\.json/.test(a.textContent))).toBe(true))
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Doctor' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Fix' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Set up SSH key' })).toBeNull()
  })

  it('shows a missing key file', async () => {
    setup({ status: STATUS({ sshKey: 'C:\\k', keyExists: false }) })
    await screen.findByText('C:\\k (file missing)')
  })

  it('disables actions while a run is active and shows its own run', async () => {
    setup({ over: { status: 'running', command: 'devenv mac key-setup', runId: 6 } })
    await screen.findByText('me@mac.local')
    expect(screen.getByRole('button', { name: 'Set up SSH key' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Doctor' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows a query error', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<MacView adapter={{ query: vi.fn(async () => { throw new Error('pwsh missing') }) }} />)
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent === 'pwsh missing')).toBe(true))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/mac-view.test.jsx`
Expected: FAIL — `mac-view.jsx` not found.

- [ ] **Step 3: Implement `mac-view.jsx`**

```jsx
import React from 'react'
import { normaliseMacStatus, buildMacArgv, macConnectionText } from '@nexusmd/core'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { useDevenvQuery } from './use-devenv-query.js'
import { RunPanel } from './run-panel.jsx'

const ARGV = ['mac', 'status', '--json']
const isMine = cmd => typeof cmd === 'string' && (cmd.startsWith('devenv mac ') || cmd.startsWith('devenv setup ios-sim'))
const STEPS = [
  'Creates ~/.ssh/devenv_mac_ed25519 on this PC (if missing).',
  'Asks for your Mac password once.',
  'Adds the key to ~/.ssh/authorized_keys on the Mac.',
  'Saves it in mac.json.',
]

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

export function MacView({ adapter }) {
  const run = useDevenvRunContext()
  const busy = run.state.status === 'starting' || run.state.status === 'running'
  const { data: mac, error, loading, refresh } = useDevenvQuery({
    adapter, config: run.config, argv: ARGV, kind: 'mac-status', normalise: normaliseMacStatus, runStatus: run.state.status,
  })
  const go = (action, exclusive = true) => {
    const argv = buildMacArgv(action)
    run.start(argv, { exclusive, label: `devenv ${argv.join(' ')}` })
  }
  const configured = mac?.configured === true
  const alerts = [error, mac?.error].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {alerts.map((a, i) => <div key={i} className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{a}</div>)}

      <Card title="Mac build host">
        {mac && <strong>{mac.host ? `${mac.user}@${mac.host}` : 'Not configured'}</strong>}
        {mac && <span>{mac.sshKey ? (mac.keyExists ? mac.sshKey : `${mac.sshKey} (file missing)`) : 'No devenv key yet'}</span>}
        {mac && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-label={mac.connection} style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: mac.connection === 'ok' ? 'var(--success)' : 'var(--text-muted)' }} />
            <span>{macConnectionText(mac.connection)}</span>
          </div>
        )}
        {mac?.detail && <span style={{ color: 'var(--text-muted)' }}>{mac.detail}</span>}
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} disabled={loading} onClick={refresh}>Refresh</button>
      </Card>

      {configured && mac.connection !== 'ok' && (
        <Card title="Set up SSH key">
          <ol style={{ margin: 0, paddingLeft: 18 }}>{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
          <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go('key-setup')}>Set up SSH key</button>
        </Card>
      )}
      {configured && mac.connection === 'ok' && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => go('key-setup')}>Set up the key again</button>
      )}

      <Card title="Checks">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={busy || !configured} onClick={() => go('doctor', false)}>Doctor</button>
          <button className="btn sm" disabled={busy || !configured} onClick={() => go('fix')}>Fix</button>
          <span style={{ color: 'var(--text-muted)' }}>Fixes that need sudo ask for your Mac password.</span>
        </div>
      </Card>

      <Card title="iOS simulator builds">
        <span style={{ color: 'var(--text-muted)' }}>Rider / dotnet on this PC build simulator apps as x64; the Apple Silicon simulator needs arm64.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" disabled={busy} onClick={() => go('ios-sim')}>Make simulator builds arm64</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => go('ios-sim-remove')}>Remove</button>
        </div>
      </Card>

      {isMine(run.state.command) && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

The unconfigured test expects the guidance in an alert. `mac.error` from devenv already says "create it with {"host":…,"user":…}". `alerts` includes `mac.error`, so no extra text is needed.

In `view-devenv.jsx`:
- import `MacView`;
- set `TABS` to `['Status', 'Start', 'Builds', 'Logs', 'Tests', 'Database', 'Emulator', 'Mac', 'Commands']`;
- add `{tab === 'Mac' && <MacView adapter={adapter} />}`.

Keep any other tab entries the file already has, such as a Git Workspace route if present.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`. Then run the whole desktop suite once: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`.
Expected: PASS. The only allowed exception is the known flaky `src/jira-create-form.test.jsx`; name it if it appears.

- [ ] **Step 5: Spec amendments**

Append to the spec:

```markdown
## Amendments made during Phase 5 planning

- Under NexusMD every Mac ssh process gets its own stdin (never devenv's, which carries NexusMD's answers) and BatchMode; `mac fix` asks for the Mac password with a `secret` prompt and sends it as the first line of that stdin. `ios/mac-host.sh` checks it once with `sudo -v` (exit 254, nothing changed, if refused) and pipes it to `sudo -S` for each fix. Terminal mode keeps `ssh -t` and sudo's own prompt.
- `devenv mac key-setup`: an ed25519 key without a passphrase (`~/.ssh/devenv_mac_ed25519`; devenv logs in with BatchMode and Windows' ssh-agent is usually off), installed with one password login (`SSH_ASKPASS` = `ios/askpass.cmd`, `SSH_ASKPASS_REQUIRE=force`, password in `DEVENV_MAC_PASSWORD` on that ssh child only); the Mac's host key is recorded on first contact (`StrictHostKeyChecking=accept-new`); re-running is harmless.
- `devenv mac status --json` (result kind `mac-status`: configured, host, user, sshKey, keyExists, connection ok/auth/hostkey/unreachable/error/unconfigured, detail, error) is allowlisted in `devenv:query`; it probes the login with BatchMode and a 5 s timeout and never throws.
- `devenv build ios --password` is unchanged: the .NET Pair-to-Mac build agent still receives `-p:ServerPassword` on its own command line, and builds use the agent's own Mac login, not devenv's key.
- Status, Start, Builds, Logs, Tests, Database, Emulator, Mac and Commands are the Dev Environment tabs in this phase.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/devenv/mac-view.jsx apps/desktop/src/views/devenv/mac-view.test.jsx apps/desktop/src/views/devenv/view-devenv.jsx docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "feat(desktop): devenv Mac tab with SSH key wizard"
```

---

### Task 5: End-to-end check

**Repository:** both

- [ ] **Step 1: Full suites**

- devenv: run `Invoke-Pester ./tests`. All pass.
- NexusMD, in the worktree: `npm -w packages/core test` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the known jira flake.

- [ ] **Step 2: Headless end-to-end check (throwaway script in the session scratchpad, nothing committed)**

Drive the worktree's `devenv.cjs` with the real `spawn` and config `{ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }`.
1. Run `devenv:query ['mac','status','--json']`. Print the time taken, `configured`, `connection` and `detail`. This is read-only: BatchMode with default host-key checking writes nothing to the Mac or to `known_hosts`.
2. Run `devenv:run ['mac','doctor']` with `{ exclusive: false }`.
   - Print the exit code and the last lines.
   - Without a key, expect the "Couldn't connect to the Mac (ssh exit 255)" failure, not a hang.
   - With the key set up, expect the check list.

Do not run `mac key-setup` or `mac fix`. Both change the user's Mac, so the user does them in the GUI checklist.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment → Mac | `user@host`, "No devenv key yet", "The Mac doesn't accept this PC's key yet…" and the wizard |
| 2 | Set up SSH key | Masked "Mac password" dialog; after OK: "Created …", "The Mac accepts the key.", "mac.json now uses …"; the card turns green |
| 3 | Set up the key again | Runs without asking for a password ("The key already works") |
| 4 | Doctor | PC and Mac check list, no password asked |
| 5 | Fix → type a wrong password | "The Mac refused that password for sudo - nothing was changed." |
| 6 | Fix → the right password | Fixes run; anything needing sudo succeeds |
| 7 | Make simulator builds arm64, then Remove | Writes, then removes, the ios-sim stub |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite. If row 2 fails at the password login (for example Windows OpenSSH does not run `askpass.cmd`), record the ssh message. Switch `SSH_ASKPASS` to a `pwsh`-based helper only if `.cmd` is the cause, and pin that change with the Task 2 askpass test.
