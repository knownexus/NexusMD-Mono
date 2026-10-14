# Dev Environment Module — Phase 6 (Profile editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit the devenv profile from NexusMD with no console and no other editor, in three parts:
- **Create from template**, which copies `profile.example` into the profile folder when there is no profile yet;
- **structured forms** for `environment.json` and `mac.json`, which keep every field they don't show;
- a **file tree and text editor** for every other profile file, with validation before save, atomic saves and a warning when the file changed on disk.

**Architecture:** devenv keeps owning what a profile *is*: the folder rule (`DEVENV_PROFILE`, else `<devenv>/profile`) and the template. It gains one command, `devenv setup profile`, which copies the template's missing files and never overwrites. NexusMD reads and writes profile files directly, in the Electron main process, confined to the profile folder. Running pwsh for every keystroke-level read would be slow and adds nothing, because devenv reads these files fresh on every command.

The renderer never sends a path outside the profile. It sends a relative path. Main resolves it against the profile folder it computes itself from the config, and rejects anything that lands outside (`..`, absolute paths, junctions and symlinks).

Each read returns a **stamp**: the SHA-256 of the bytes on disk. Each write sends back the stamp it was based on. Main refuses the write, with `stale: true` and the current stamp, when the file changed since. That covers devenv itself writing `mac.json` during `mac key-setup` while the form is open.

Validation is pure and lives in core (`modules/devenv/profile.js`). The YAML parser is injected from desktop (`js-yaml`, already in the lockfile), so core keeps zero runtime dependencies.

**Tech Stack:** PowerShell 7.6 + Pester 6 (devenv); Electron 43, React 18, Vitest 4 + Testing Library, js-yaml 4 (NexusMD).

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md`:
- Decisions → Profile;
- Architecture → Preload (`readProfileFile`, `writeProfileFile`, `listProfileFiles`) and Core module ("profile schema + validation");
- Screens → Profile;
- Error handling → "Profile file invalid / changed on disk".

Previous plan for patterns: `docs/superpowers/plans/2026-10-14-devenv-phase5-mac-ios.md`.

**Grounded in devenv `master` at `a49576c`** (phase 5 merged). Facts this plan relies on:
- `launcher-common.ps1` `Get-DevEnvProfileDir`: `$env:DEVENV_PROFILE`, else `Join-Path $PSScriptRoot 'profile'`, then `[IO.Path]::GetFullPath`. It throws unless the folder contains `environment.json`.
- `mac-common.ps1` `Get-MacConfig`: `host` must match `^[A-Za-z0-9.-]+$`, `user` must match `^[A-Za-z0-9._-]+$`, and `sshKey` is optional but must exist when set.
- `profile.example/README.md` and the main README's profile table: per repository `source`, `ref`, `project`, `label`, `kind` (`api`|`mobile`|`web`), `port`, `dll`, `docker`, `start`, `migrationGuard`, `test` (`port`, `db`). Top level: `name`, `database` (`name`, `databases`, `sourceContainer`), `mobile.packageId`, `test` (`defaultServices`, `collection`, `collectionEnv`, `wiring`, `extraDbConn`, `collectionPatterns`). "The mobile app's key must be `mobile`."
- `test.ps1`: a `wiring` entry is `{ from, to, key, local?, always? }`.
- `devenv.ps1` already tolerates a missing profile for `help` (`$profileError`), but `Invoke-Script` throws without one. So `setup profile` must not go through `Invoke-Script`.
- `buildInvocation` in `apps/desktop/electron/ipc/devenv.cjs` deletes an inherited `DEVENV_PROFILE` when Settings leaves the profile folder empty. NexusMD's folder rule therefore matches devenv's exactly.

**Two repositories:**
- Task 1 changes `C:\repos\dev-environment` on a new branch `feature/nexusmd-profile` from `master`.
- Tasks 2–5 change a NexusMD **worktree** `C:\repos\NexusMD-Mono-devenv6` on a new branch `feature/devenv-profile` from `master`. Its `node_modules` are junctions prepared by the controller.
  - Work only in that worktree. Never touch `C:\repos\NexusMD-Mono`, which another session may be using.
- Task 6 spans both.

## Global Constraints

- With `DEVENV_HOST` unset, terminal behaviour is unchanged. `devenv setup profile` also works from a terminal, and that's how the README now tells people to start.
- **`setup profile` never overwrites.** It copies only template files that don't exist yet and prints each one it created. If every file already exists, it says so and exits 0.
- **Nothing outside the profile folder is read or written** by the new IPC. Main computes the folder from the config on every call and never takes it from the renderer.
  - A relative path with a `..` segment, a drive, a leading slash, a NUL or an empty segment is refused.
  - So is any path whose real path (junctions and symlinks resolved) leaves the folder's real path.
  - The listing does not descend into symlinks or junctions.
- **Saves are atomic and checked.** The write goes to a temp file in the same folder, then a rename. The stamp sent with a write is compared to the file's current SHA-256 (`null` = the file must not exist yet). On mismatch nothing is written and the reply is `{ ok: false, stale: true, stamp }`.
- **Profile file contents never reach a log or an error message.** `docker/*.env` holds passwords. Errors name the file and the problem, never the text.
- Files over 1 MiB, or with a NUL byte, or that aren't valid UTF-8, are listed but not editable ("Open the folder to edit this file").
- Form edits keep every field the form doesn't show, keep key order, and keep the file's BOM and line endings. They do rewrite the file with 2-space indentation, which the form says once.
- Validation **errors** block Save. **Warnings** don't. The rules are exactly those in Task 3. Each one is traced to the devenv code that needs it.
- Drafts survive tab switches, file switches and leaving Dev Environment. They are kept in memory for the session and lost on reload. There are no "discard changes?" dialogs.
- `setup profile` runs through the provider's single run with `exclusive: true`. **Check** runs `devenv doctor` with `exclusive: false`. Labels are `devenv ${argv.join(' ')}`.
- Code style:
  - devenv: compact PowerShell, ASCII only.
  - NexusMD: ESM without semicolons in `src/`/`packages/`, CommonJS with semicolons in `electron/*.cjs`.
  - Comments explain why, never what.
- Tests:
  - Pester: `pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.5; Invoke-Pester <path> -Output Detailed"` from `C:\repos\dev-environment`.
  - Desktop: always with `NODE_OPTIONS=--no-experimental-webstorage`.
  - JS test strings keep Windows paths escaped. Write files with the Write/Edit tools, never shell heredocs.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Escaping the profile folder.** `..\..\devenv.ps1`, `C:\Windows\x`, `\\server\share\x`, `a/../../x`, a junction inside the profile that points at `C:\repos\dev-environment`, and a path in a folder that doesn't exist yet whose parent is a junction. All must be refused for read and write, and skipped by list. Pinned in Task 2 with a real temp folder (junctions via `fs.symlinkSync(target, link, 'junction')`, skipped where the OS refuses).
2. **Lost updates.** If devenv (`mac key-setup`), another editor or a second NexusMD window changes a file after it was opened, Save must not overwrite it silently. Pinned in Task 2 (stale write leaves the file byte-identical) and Task 4 (conflict banner with Reload and Overwrite).
3. **The folder changing under a draft.** If the profile folder changes in Settings while a draft is open, saving must not write the old folder's draft into the new folder. Writes carry the `dir` the file was read from, and main refuses a mismatch. Pinned in Task 2 and Task 4.
4. **Fields the form doesn't show.** Unknown keys at any level (top level, a repository, `test`, `database`) and key order survive a form edit. BOM and CRLF survive. Pinned in Task 3 with round-trip tests on the real `profile.example/environment.json` text.
5. **Secrets in logs.** A failed write of `docker/orders.env` must not put its contents in electron-log. Pinned in Task 2 (spy on the injected logger; an error thrown after reading content contains only the path).

---

### Task 1: devenv — `devenv setup profile`

**Repository:** `C:\repos\dev-environment` (create branch `feature/nexusmd-profile` from `master`)

**Files:**
- Modify: `launcher-common.ps1`:
  - new `Resolve-DevEnvProfileDir` (the folder rule, never throws);
  - `Get-DevEnvProfileDir` calls it, and its "No profile" message now suggests `devenv setup profile`.
- Create: `profile-setup.ps1` with `New-DevenvProfile`.
- Modify: `devenv.ps1`:
  - dot-source `profile-setup.ps1`;
  - new command entry in the `# --- setup` block.
- Modify: `README.md` and `profile.example/README.md`. "Copy-Item -Recurse profile.example profile" becomes `devenv setup profile`, with the copy kept as the manual alternative.
- Test: `tests/profile-setup.Tests.ps1` (new)

**Interfaces:**
- Produces:
  - `Resolve-DevEnvProfileDir` → full path, with exactly `Get-DevEnvProfileDir`'s rule but no existence check.
  - `New-DevenvProfile -Template <dir> -Target <dir>` → `[string[]]` of the relative paths it created (forward slashes). It creates `-Target` if missing and copies each template file whose target doesn't exist. It never overwrites, and it never copies `README.md`, which describes the template rather than a profile.
  - `devenv setup profile` (`Mut` true):
    - prints `Created <rel>` per file and then `Profile ready at <dir> - fill in environment.json (see profile.example/README.md).`;
    - prints `The profile at <dir> already has every template file - nothing copied.` when nothing was missing;
    - works with no profile, because it doesn't go through `Invoke-Script`.

- [ ] **Step 1: Write the failing tests**

Create `tests/profile-setup.Tests.ps1`:

```powershell
#requires -Version 7.0
BeforeAll {
 $root=Split-Path $PSScriptRoot -Parent
 . (Join-Path $root 'launcher-common.ps1')
 . (Join-Path $root 'profile-setup.ps1')
 $script:template=Join-Path $root 'profile.example'
}
AfterEach { Remove-Item Env:DEVENV_PROFILE -ErrorAction SilentlyContinue }

Describe 'Resolve-DevEnvProfileDir' {
 It 'uses DEVENV_PROFILE, made absolute, without requiring environment.json' {
  $env:DEVENV_PROFILE=Join-Path $TestDrive 'nowhere/../p'
  Resolve-DevEnvProfileDir | Should -Be ([IO.Path]::GetFullPath((Join-Path $TestDrive 'p')))
 }
 It 'falls back to profile/ next to the scripts' {
  Resolve-DevEnvProfileDir | Should -Be ([IO.Path]::GetFullPath((Join-Path $root 'profile')))
 }
 It 'Get-DevEnvProfileDir points at devenv setup profile when there is no profile' {
  $env:DEVENV_PROFILE=Join-Path $TestDrive 'empty'
  { Get-DevEnvProfileDir } | Should -Throw '*devenv setup profile*'
 }
}

Describe 'New-DevenvProfile' {
 It 'copies the whole template (except README.md) into a new folder' {
  $t=Join-Path $TestDrive 'new'
  $made=New-DevenvProfile -Template $script:template -Target $t
  $made | Should -Contain 'environment.json'
  $made | Should -Contain 'docker/services.compose.yml'
  $made | Should -Not -Contain 'README.md'
  Test-Path (Join-Path $t 'api-tests/bruno.json') | Should -BeTrue
 }
 It 'never overwrites, and only fills in what is missing' {
  $t=Join-Path $TestDrive 'partial'
  New-Item -ItemType Directory $t | Out-Null
  Set-Content (Join-Path $t 'environment.json') '{"mine":true}'
  $made=New-DevenvProfile -Template $script:template -Target $t
  $made | Should -Not -Contain 'environment.json'
  (Get-Content (Join-Path $t 'environment.json') -Raw) | Should -Match '"mine"'
  $made | Should -Contain 'commands.ps1'
 }
 It 'returns nothing the second time' {
  $t=Join-Path $TestDrive 'twice'
  $null=New-DevenvProfile -Template $script:template -Target $t
  @(New-DevenvProfile -Template $script:template -Target $t).Count | Should -Be 0
 }
}

Describe 'devenv setup profile' {
 It 'runs without a profile and reports what it created' {
  $t=Join-Path $TestDrive 'cli'
  $env:DEVENV_PROFILE=$t
  $out=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') setup profile 2>&1 | ForEach-Object { "$_" })
  $LASTEXITCODE | Should -Be 0
  $out | Should -Contain 'Created environment.json'
  ($out -join "`n") | Should -Match 'Profile ready at'
  Test-Path (Join-Path $t 'environment.json') | Should -BeTrue
 }
 It 'is listed as a mutating setup command' {
  $env:DEVENV_PROFILE=$script:template
  $line=@(& pwsh -NoProfile -NonInteractive -File (Join-Path $root 'devenv.ps1') help --json) | Where-Object { $_.StartsWith('@@devenv ') } | Select-Object -First 1
  $c=($line.Substring(9) | ConvertFrom-Json -AsHashtable).commands | Where-Object { $_.group -eq 'setup' -and $_.verb -eq 'profile' }
  $c | Should -Not -BeNullOrEmpty
  $c.mut | Should -BeTrue
 }
}
```

- [ ] **Step 2: Run them and watch them fail**

`Resolve-DevEnvProfileDir`, `profile-setup.ps1` and the command don't exist yet.

- [ ] **Step 3: Implement**

`launcher-common.ps1`, replacing the start of `Get-DevEnvProfileDir`:

```powershell
function Resolve-DevEnvProfileDir {
 # The rule alone, for callers that must work before a profile exists (devenv setup profile).
 $dir=if($env:DEVENV_PROFILE){$env:DEVENV_PROFILE}else{Join-Path $PSScriptRoot 'profile'}
 [IO.Path]::GetFullPath($dir)
}

function Get-DevEnvProfileDir {
 $dir=Resolve-DevEnvProfileDir
 if(!(Test-Path (Join-Path $dir 'environment.json'))){
  throw "No profile at $dir. Create one from the template with: devenv setup profile  (or Copy-Item -Recurse profile.example profile, or set DEVENV_PROFILE)."
 }
 return $dir
}
```

`Resolve-DevEnvProfileDir` must live in `launcher-common.ps1`, because `$PSScriptRoot` there is the devenv root.

`profile-setup.ps1`:

```powershell
function New-DevenvProfile {
 # Copies only what is missing: re-running after a devenv update picks up new template files
 # without touching anything the user has filled in.
 param([Parameter(Mandatory)][string]$Template,[Parameter(Mandatory)][string]$Target)
 $Template=[IO.Path]::GetFullPath($Template); $Target=[IO.Path]::GetFullPath($Target)
 if (!(Test-Path -LiteralPath $Template -PathType Container)) { throw "No template at $Template" }
 $made=[Collections.Generic.List[string]]::new()
 foreach ($f in Get-ChildItem -LiteralPath $Template -Recurse -File) {
  $rel=[IO.Path]::GetRelativePath($Template,$f.FullName).Replace('\','/')
  if ($rel -eq 'README.md') { continue }
  $dest=Join-Path $Target $rel
  if (Test-Path -LiteralPath $dest) { continue }
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Copy-Item -LiteralPath $f.FullName -Destination $dest
  $made.Add($rel)
 }
 ,$made.ToArray()
}
```

`devenv.ps1`: dot-source `profile-setup.ps1` next to the other `*-common.ps1` lines. Add to the `# --- setup` block, before `ios-sim`:

```powershell
 @{G='setup';V='profile';A='';S='Create the profile folder from profile.example (copies only missing files, never overwrites)';Sw=@();Val=@()
   Run={
    $target=Resolve-DevEnvProfileDir
    $made=@(New-DevenvProfile -Template (Join-Path $root 'profile.example') -Target $target)
    foreach ($m in $made) { Write-Host "Created $m" }
    if ($made.Count) { Write-Host "Profile ready at $target - fill in environment.json (see profile.example/README.md)." -ForegroundColor Green }
    else { Write-Host "The profile at $target already has every template file - nothing copied." }
   }}
```

The dispatcher at the bottom of `devenv.ps1` (at `a49576c`) doesn't check for a profile before running a command. Only `Invoke-Script` does. So this `Run` block works with no profile as long as it doesn't call `Invoke-Script`. The CLI test in Step 1 pins that.

- [ ] **Step 4: Run the new tests and the whole suite**

`Invoke-Pester ./tests`. All pass, including `no-console.Tests.ps1`: the new code has no `Read-Host`.

- [ ] **Step 5: Commit**

```bash
git add launcher-common.ps1 profile-setup.ps1 devenv.ps1 README.md profile.example/README.md tests/profile-setup.Tests.ps1
git commit -m "feat(setup): devenv setup profile copies the template's missing files"
```

---

### Task 2: NexusMD — profile files in the Electron main process

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv6`

**Files:**
- Create: `apps/desktop/electron/ipc/devenv-profile.cjs`, `devenv-profile.test.js`
- Modify: `apps/desktop/electron/ipc/devenv.cjs`. `register` calls `registerProfile(handle, deps)` with the same `handle` and injected `fs`, so the profile channels share its logging.
- Modify: `apps/desktop/electron/preload.cjs`, `preload.test.js`. Add `devenv.listProfileFiles`, `readProfileFile` and `writeProfileFile`.
- Modify: `apps/desktop/src/adapters/devenv.js`, `packages/core/src/adapters/index.js` (`IDevenvAdapter` contract)

**Interfaces:**
- Produces:
  - `resolveProfileDir(config)` → absolute folder. It is `config.profile` when it's a non-empty string (must be absolute, else it throws "The profile folder in Settings must be an absolute path."), otherwise `path.join(config.root, 'profile')`, both through `path.resolve`. `config.root` is checked exactly as `buildInvocation` checks it.
  - `devenv:profile:list(config)` → `{ dir, exists, files: [{ path, size }], truncated }`.
    - `exists` is `environment.json` being a file.
    - `path` uses forward slashes, sorted case-insensitively.
    - The listing skips `.git`, `node_modules`, `bin`, `obj`, `.vs`, `*.nexusmd-tmp` and every symlink or junction, and stops at 2000 files (`truncated: true`).
    - A missing folder → `{ dir, exists: false, files: [], truncated: false }`.
  - `devenv:profile:read(config, rel)` → one of:
    - `{ dir, path, text, stamp }`;
    - `{ dir, path, stamp, binary: true }`;
    - `{ dir, path, stamp: null, tooLarge: true, size }`;
    - `{ dir, path, missing: true, stamp: null }`.
    - `stamp` is the hex SHA-256 of the bytes. `text` is decoded with `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`, so a BOM stays in `text` and survives a round trip.
  - `devenv:profile:write(config, rel, text, { expected, dir })`:
    - → `{ ok: true, stamp }`, or `{ ok: false, stale: true, stamp }` where `stamp` is the current one (`null` if the file is gone);
    - throws if `dir !== resolveProfileDir(config)` ("The profile folder changed in Settings - reopen the file.");
    - throws if `text` isn't a string or is over 1 MiB.
  - Adapter: `listProfileFiles(config)`, `readProfileFile(config, path)` and `writeProfileFile(config, path, text, opts)`.

- [ ] **Step 1: Write the failing tests** in `devenv-profile.test.js`, against a real temp folder (`fs.mkdtempSync(os.tmpdir())`), not mocks, because confinement is about the real file system:

| Test | Expect |
|---|---|
| `resolveProfileDir` with empty / missing / absolute `profile` | `<root>\profile` / `<root>\profile` / that path; a relative `profile` throws |
| list on a missing folder | `exists: false`, no files, no throw |
| list on a copy of `profile.example`-like files | forward-slash paths, sorted; `bin/`, `obj/`, `.git/`, `x.nexusmd-tmp` skipped |
| list with a junction / symlink inside the profile pointing outside | the link is not listed or descended (skip the test where creating it fails with `EPERM`) |
| list stops at 2000 files | `truncated: true`, 2000 entries |
| read `environment.json` | text equals the file; stamp = sha256 of the bytes |
| read a file with a UTF-8 BOM and CRLF | `text` starts with `\uFEFF` and keeps `\r\n` |
| read a file with a NUL / invalid UTF-8 | `binary: true`, no `text` |
| read a 1 MiB + 1 file | `tooLarge: true`, no `text`, file not read whole (spy: `stat` used, `readFile` not called) |
| read a missing file | `missing: true, stamp: null` |
| read / write `../x`, `..\\x`, `a/../../x`, `C:\\x`, `\\\\srv\\s\\x`, `/x`, `a//b`, `a\u0000b`, `''` | throws "Not a profile file: …"; nothing created outside |
| write through a junction inside the profile (existing target, and a new file under it) | throws "Not a profile file"; target folder unchanged |
| write with the right stamp | `ok: true`, new stamp; file content exact; no `*.nexusmd-tmp` left |
| write with a stale stamp | `{ ok: false, stale: true, stamp: <current> }`; file byte-identical |
| write `expected: null` when the file exists | stale; when it doesn't: created, parent folders made inside the profile |
| write with `dir` ≠ the resolved folder | throws "The profile folder changed in Settings"; nothing written |
| write where the rename fails (`fs.rename` injected to throw `EPERM` 3×) | throws; the tmp file is removed; original untouched |
| write where the rename fails once then succeeds | `ok: true` (retries 3 × 100 ms: Windows Defender / an editor briefly holding the file) |
| an error during write of `docker/orders.env` with text `SA_PASSWORD=secret` | the injected logger's `error` was called; nothing it received contains `secret` |

- [ ] **Step 2: Run them and watch them fail**

`NODE_OPTIONS=--no-experimental-webstorage npx vitest run electron/ipc/devenv-profile.test.js` from `apps/desktop`.

- [ ] **Step 3: Implement `devenv-profile.cjs`**

Key parts (the rest is plain plumbing):

```js
// electron/ipc/devenv-profile.cjs
//
// The Profile tab's file access. The renderer only ever names a path relative to the profile
// folder; the folder itself is recomputed here from the config on every call, with devenv's
// own rule (DEVENV_PROFILE, else <devenv>/profile - buildInvocation clears an inherited
// DEVENV_PROFILE, so this matches what devenv will read).

'use strict';

const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs']);
const TMP_SUFFIX = '.nexusmd-tmp';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function resolveProfileDir(config) {
  const { root, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  }
  if (typeof profile === 'string' && profile) {
    if (!path.isAbsolute(profile)) throw new Error('The profile folder in Settings must be an absolute path.');
    return path.resolve(profile);
  }
  return path.resolve(root, 'profile');
}

function checkRelative(rel) {
  const bad = typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)
    || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel);
  const parts = bad ? [] : rel.split(/[\\/]/);
  if (bad || parts.some(p => p === '' || p === '.' || p === '..')) throw new Error(`Not a profile file: ${String(rel)}`);
  return parts;
}

// Real-path containment: a junction inside the profile must not lead out of it. For a file that
// doesn't exist yet, its nearest existing ancestor is what has to be inside.
async function confine(fsp, dir, rel) {
  const parts = checkRelative(rel);
  const target = path.join(dir, ...parts);
  const realDir = await fsp.realpath(dir);
  let probe = target;
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      const inside = real === realDir || real.startsWith(realDir + path.sep);
      if (!inside) throw new Error(`Not a profile file: ${rel}`);
      return target;
    } catch (e) {
      if (e.code !== 'ENOENT' || probe === dir) throw e.code === 'ENOENT' ? new Error(`Not a profile file: ${rel}`) : e;
      probe = path.dirname(probe);
    }
  }
}
```

`confine` runs **before** every read and write. `list` walks with `lstat` and skips `isSymbolicLink()`. On Windows, Node reports junctions as symbolic links to `lstat`.

The write does these steps in order:
1. Check that `dir` matches the resolved folder.
2. Confine the path.
3. Read the current bytes (or `null`) and compare the stamp. On a mismatch, return stale.
4. `mkdir` the parent (recursive) and re-confine. The parent may be a freshly made folder, which is fine, but a pre-existing junction is not.
5. `writeFile(tmp, text, { flag: 'wx' })` with `tmp = file + '.' + crypto.randomBytes(6).toString('hex') + TMP_SUFFIX`.
6. Call `rename(tmp, file)`, retrying up to 3 times 100 ms apart on `EPERM`/`EBUSY`/`EACCES`. On final failure, `unlink(tmp)` and throw `Couldn't save <rel>: <code>`.
7. Return `{ ok: true, stamp: sha256(Buffer.from(text, 'utf8')) }`.

The stamp check and the rename are not one atomic operation. With a single user, that race is acceptable, and the comment says so.

Error messages are built from `rel` and `e.code` only, never from `text` or `e.message` of a write (`e.message` can echo a path, never content, but the code is enough).

- [ ] **Step 4: Wire up**

- In `devenv.cjs`, `register` gains `fsp = require('fs/promises')` in `deps` and calls `require('./devenv-profile.cjs').registerProfile(handle, { fsp })`.
- `preload.cjs` gets the three methods.
- The adapter wraps them.
- `IDevenvAdapter` gets three rejecting stubs with one-line comments giving their shapes.
- `preload.test.js` asserts the three channel names.

- [ ] **Step 5: Run the desktop suite**

`NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the known jira flake.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/ipc/devenv-profile.cjs apps/desktop/electron/ipc/devenv-profile.test.js apps/desktop/electron/ipc/devenv.cjs apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/devenv.js packages/core/src/adapters/index.js
git commit -m "feat(desktop): read, list and write devenv profile files, confined and stamp-checked"
```

---

### Task 3: NexusMD — core profile model and validation

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv6`

**Files:**
- Create: `packages/core/src/modules/devenv/profile.js`, `profile.test.js`
- Modify: `packages/core/src/modules/devenv/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces (all pure, no Node built-ins):**
- `profileFileKind(path)` → one of:
  - `'environment'` for `environment.json`;
  - `'mac'` for `mac.json`;
  - `'json'`, `'yaml'` (`.yml`/`.yaml`);
  - `'text'` for everything else.
- `textStyle(text)` → `{ bom, eol }`. `bom` is `text.startsWith('\uFEFF')`. `eol` is `'\r\n'` if the first line break is CRLF, else `'\n'`.
- `parseJsonText(text)` → `{ value }` | `{ error }`, with any BOM stripped first. The error message includes line and column, computed from the `position` in V8's message when present.
- `formatJson(value, style)` → `JSON.stringify(value, null, 2)` with `\n` replaced by `style.eol`, a final `style.eol`, and `\uFEFF` prefixed when `style.bom`.
- `validateProfileFile(path, text, { parseYaml })` → `{ errors: [{ at, message }], warnings: [{ at, message }] }`.
  - `json` checks that it parses.
  - `yaml` calls `parseYaml(text)` and reports its error's message.
  - `environment` / `mac` also run the rules below.
  - `text` is always valid.
- `validateEnvironment(env)` and `validateMacConfig(mac)` → the same `{ errors, warnings }`.
- Immutable edit helpers. Each returns a new object, keeps key order, and keeps unknown keys:
  - `setIn(obj, pathArray, value)`, where `value === undefined` deletes the key and empty parent objects created by the form are removed;
  - `addRepository(env, key, kind)` (`{ source: '', ref: 'main', project: '', kind }`);
  - `renameRepository(env, from, to)`, which keeps the position and also renames the key inside `test.defaultServices` and `test.wiring[].from/to`;
  - `removeRepository(env, key)`, which does not touch references, so validation then flags them;
  - `moveRepository(env, key, delta)`.

**Validation rules.** Each is tied to the devenv code that needs it, so the form never rejects what devenv accepts.

`environment.json` errors:

| Rule | Why (devenv) |
|---|---|
| Valid JSON, and an object | `Get-DevEnvConfig` (`ConvertFrom-Json -AsHashtable`) |
| `repositories` is an object | `Get-DevEnvServices` iterates `$Config.repositories.Keys` |
| Each repository key matches `^[A-Za-z0-9][A-Za-z0-9_-]*$` | used in paths (`.local/launcher/artifacts/<key>`, `logs/<key>.log`) and as `devenv build <key>` |
| `source`, `ref`, `project` are non-empty strings | README: "The repositories (`source` worktree path…, `ref`, `project`)"; `dev.ps1` worktrees and builds |
| `kind` is `api`, `mobile` or `web` | `Get-DevEnvServices -Kind` |
| A `mobile` repository has the key `mobile`, and there is at most one | `profile.example/README.md`: "The mobile app's key must be `mobile`" |
| `port` and `test.port`, when present, are integers 1–65535 | containers and the tracer bind them |
| `docker`, `start`, `migrationGuard`, when present, are booleans | read with `[bool]`; a string `"false"` would be true |
| `test`, when present, is an object with integer `port` and non-empty string `db` | `test.ps1` |
| `test.defaultServices`, when present, is an array of repository keys that have a `test` block | `test.ps1` `Up` default |
| `test.wiring`, when present, is an array of objects whose `from` and `to` are repository keys and whose `key` is a non-empty string | `test.ps1` wiring |
| `test.extraDbConn` and `test.collectionPatterns`, when present, are objects of strings | `test.ps1` |
| `database.databases`, when present, is an array of strings | `db-common.ps1` |

`environment.json` warnings:
- a `mobile` repository but no `mobile.packageId` (`logs.ps1` falls back to "(set mobile.packageId in the profile)");
- no repositories;
- two repositories (or test blocks) with the same port.

`mac.json` errors:
- `host` matches `^[A-Za-z0-9.-]+$`;
- `user` matches `^[A-Za-z0-9._-]+$`;
- `sshKey`, when present, is a string.

These are exactly `Get-MacConfig`'s checks. Whether the key file exists is left to the Mac tab, which already reports it.

`at` is a dotted path the form uses to put the message next to its field (`repositories.orders.port`, `test.wiring.0.to`).

- [ ] **Step 1: Write the failing tests** in `profile.test.js`. Include:
  - the real `profile.example/environment.json` text (copied into the test as a string): no errors, no warnings;
  - one test per rule above, error and passing case;
  - round trip: `formatJson(setIn(parse(x), ['repositories','orders','port'], 5102), textStyle(x))`, where `x` has a BOM, CRLF, an unknown top-level key `"notes"`, an unknown repository key `"envFile"` and an unknown `test` key. All survive, in order; only `port` changed;
  - `setIn` with `undefined` removes the key, and removes `test: {}` left empty by the form but keeps a `test: {}` that was in the file;
  - `renameRepository` keeps the position and updates `defaultServices` and `wiring`;
  - `removeRepository` leaves a dangling `defaultServices` entry that `validateEnvironment` reports at `test.defaultServices.0`;
  - `parseJsonText` error mentions the line;
  - `validateProfileFile('docker/services.compose.yml', 'a: [', { parseYaml })` with a fake `parseYaml` that throws → one error carrying that message;
  - `profileFileKind` for nested paths (`docker/test/servicebus-config.json` → `json`) and case (`Environment.JSON` → `environment`, because Windows paths are case-insensitive).

- [ ] **Step 2: Run them and watch them fail**

`npm -w packages/core test -- profile`

- [ ] **Step 3: Implement `profile.js`**, export from `index.js` and `packages/core/src/index.js`, and add the names to `public-api.test.js`

- [ ] **Step 4: Run the core suite.** All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/devenv/profile.js packages/core/src/modules/devenv/profile.test.js packages/core/src/modules/devenv/index.js packages/core/src/index.js packages/core/tests/public-api.test.js
git commit -m "feat(core): devenv profile validation and field-preserving edits"
```

---

### Task 4: NexusMD — the Profile tab

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv6`

**Files:**
- Create in `apps/desktop/src/views/devenv/`:
  - `profile-drafts.js` (the in-memory draft store);
  - `use-profile-files.js`;
  - `profile-view.jsx`, `profile-view.test.jsx`;
  - `profile-editor.jsx`, `profile-editor.test.jsx`;
  - `environment-form.jsx`, `environment-form.test.jsx`;
  - `mac-form.jsx`, `mac-form.test.jsx`.
- Modify: `apps/desktop/package.json`, adding `"js-yaml": "^4.1.0"` to `dependencies` (already in the lockfile at 4.2.0; run `npm install` so the lockfile records the direct dependency). Also modify `package-lock.json`.
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx`:
  - add `'Profile'` to `TABS` between `'Mac'` and `'Commands'`;
  - render `ProfileView`;
  - the tab button shows `Profile •` while any draft is unsaved;
  - remove the "later phase" comment.
- Modify: `apps/desktop/src/views/devenv/view-devenv.test.jsx` (the tab list).

**Interfaces:**
- Consumes:
  - `useDevenvRunContext()` → `{ state, start, config }`;
  - the adapter's `listProfileFiles` / `readProfileFile` / `writeProfileFile` / `open`;
  - core `profileFileKind`, `validateProfileFile`, `parseJsonText`, `formatJson`, `textStyle` and the edit helpers;
  - `RunPanel`.
- `profile-drafts.js`:
  - a module-level `Map` keyed by `dir + '\u0000' + path` → `{ text, baseStamp, baseText }`;
  - `getDraft`, `setDraft`, `clearDraft`, `hasDrafts()`;
  - a `subscribe(cb)` so the tab label updates.
  - It's module-level so that drafts outlive the view; it's lost on reload by design.
- `useProfileFiles({ adapter, config, runStatus })` → `{ dir, exists, files, truncated, error, loading, refresh }`. It reloads on mount, on config change, and when `runStatus` goes from `starting`/`running` to anything else (after `setup profile`). It uses the same newest-request-wins guard as `useDevenvQuery`.
- `ProfileView({ adapter, picker })`.

Layout:
- **Header card:**
  - the profile folder;
  - "(from Settings)" or "(devenv's default)";
  - **Open folder** (`adapter.open({ path: dir })`, disabled when `!exists`);
  - **Check** (`devenv doctor`, `exclusive: false`);
  - **Refresh**.
- **No profile** (`!exists`), in place of the editor:
  - "No profile at `<dir>` yet.";
  - **Create from template** → `run.start(['setup','profile'], { exclusive: true, label: 'devenv setup profile' })`, disabled while the run is busy;
  - "Copies devenv's profile.example; files that already exist are kept."
  - When the run ends, the list reloads and `environment.json` opens.
- **Left: file list.**
  - Two pinned entries first: **Environment** (`environment.json`) and **Mac** (`mac.json`, shown as "Mac (not set up)" when missing).
  - Then every other file, grouped by folder, with a `•` on files that have a draft.
  - "Showing the first 2000 files" when truncated.
  - **New file…** asks for a relative path (validated with the same rule as main, so the user sees the error before Save) and opens an empty draft with `baseStamp: null`.
- **Right: `ProfileEditor`** for the selected file.
  - Opening reads the file. A draft whose `baseStamp` differs from the disk stamp shows the conflict banner right away.
  - **Mode:** `Form | Text` for `environment.json` and `mac.json`; Text only for the rest.
  - Form is disabled, with the parse error shown, while the draft text doesn't parse as an object.
  - Form edits go `parseJsonText(draft)` → helper → `formatJson(next, textStyle(draft))` → draft. The draft text is the single source of truth.
  - The first form edit shows "Form edits rewrite this file with 2-space indentation" once per file.
  - **Text:** a monospace `<textarea>` with `spellCheck={false}` and `wrap="off"`.
  - **Validation:** `validateProfileFile(path, draft, { parseYaml: yaml.load })`, debounced 200 ms. Errors and warnings are listed under the editor; in Form mode each also shows next to its field (`at`). **Save** (and Ctrl+S) is disabled while there are errors or no changes.
  - **Save** → `writeProfileFile(config, path, draft, { expected: baseStamp, dir })`:
    - on `ok`: the draft is cleared and the base becomes the saved text and stamp;
    - on `stale`: the conflict banner reads "`<path>` changed on disk since you opened it". **Reload** discards the draft and reads again; **Overwrite** saves again with `expected` = the stamp from the stale reply;
    - on a throw: the message in an alert, and the draft is kept.
  - **Revert** clears the draft.
  - While the provider's run is busy, the editor shows "devenv is running `<label>` - it may have read the file before your save" but does not block Save.
  - Binary / too large / outside: "This file can't be edited here", with **Open folder**.
- **`EnvironmentForm`** (`value`, `issues`, `onChange`):
  - Top: `name`.
  - **Repositories:** one collapsible row per repository, in file order, with move up/down, rename, remove and **Add repository** (kind select).
    - Fields: `source`, `ref`, `project` (text), `label`, `kind` (select), `port` (number), `dll`, `docker` / `start` / `migrationGuard` (checkboxes; unticking removes the key instead of writing `false` when the file didn't have it), and a `test` block toggle with `port` and `db`.
  - **Database:** `name`, `databases` (comma list), `sourceContainer`.
  - **Mobile:** `packageId` (shown when a mobile repository exists or the key is present).
  - **Test stack:**
    - `defaultServices` as checkboxes of repositories with a test block;
    - `collection`, `collectionEnv`;
    - `wiring` as a table (from / to selects of repository keys, key, local, always);
    - `extraDbConn` and `collectionPatterns` as key/value tables.
  - Fields the form doesn't know about are listed read-only at the bottom: "Other settings (edit in Text): `notes`, `repositories.orders.envFile`". That way the user knows they exist and are kept.
- **`MacForm`:** `host`, `user`, `sshKey` (text + **Browse…** via `picker.pickFile()`), and the line "Set up or replace the key from the Mac tab."

- [ ] **Step 1: Write the failing tests:**

| File | Tests |
|---|---|
| `profile-view.test.jsx` | lists pinned + other files; `exists: false` shows Create from template, which starts `['setup','profile']` exclusive, and the list reloads when the run ends; Check starts `['doctor']` non-exclusive; Open folder opens `dir`; a draft marks its file with `•`; New file rejects `../x` before any IPC |
| `profile-editor.test.jsx` | opens and shows text; Save disabled with no changes and while an error is listed; Save sends `{ expected: <read stamp>, dir }`; `stale` shows the banner and Overwrite resends with the new stamp; Reload re-reads and drops the draft; a draft survives unmount/remount; a draft whose base stamp no longer matches disk shows the banner on open; Ctrl+S saves; binary file shows "can't be edited here"; invalid YAML in `docker/services.compose.yml` blocks Save with js-yaml's message |
| `environment-form.test.jsx` | renders `profile.example`'s repositories in order; editing a port calls `onChange` with only that change; an issue at `repositories.orders.port` shows next to the port field; rename updates `defaultServices`; unticking `docker` on a repo without the key leaves it absent; unknown keys are listed under "Other settings"; adding a mobile repository proposes the key `mobile` |
| `mac-form.test.jsx` | host/user errors show next to their fields; Browse fills `sshKey`; a missing `mac.json` opens as a new file with Save creating it |
| `view-devenv.test.jsx` | `Profile` sits between `Mac` and `Commands`; the label shows `•` while a draft exists |

- [ ] **Step 2: Run them and watch them fail**

- [ ] **Step 3: Implement.** Follow `mac-view.jsx` for cards, buttons and run wiring. `isMine` for the RunPanel matches `devenv setup profile` and `devenv doctor`.

- [ ] **Step 4: Run the desktop suite.** All pass, apart from the known jira flake.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/views/devenv/
git commit -m "feat(desktop): devenv Profile tab with forms, text editor and safe saves"
```

---

### Task 5: Spec amendments

**Repository:** worktree `C:\repos\NexusMD-Mono-devenv6`

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-devenv-module-design.md`. Append:

```markdown
## Amendments made during Phase 6 planning

- "Create from template" is `devenv setup profile` (also for terminal users): it copies the template's missing files into devenv's profile folder (`DEVENV_PROFILE`, else `<devenv>/profile`), never overwrites and skips the template's README.md.
- NexusMD reads and writes profile files itself, in the Electron main process (`devenv:profile:list|read|write`), never through pwsh: every path is relative to the profile folder main computes from the config, junctions and symlinks are neither followed nor listed, and files over 1 MiB, binary or non-UTF-8 files are view-only.
- Saves are atomic (temp file + rename, retried briefly on Windows sharing errors) and carry the SHA-256 stamp the edit started from; a changed file is reported as stale (Reload / Overwrite) rather than overwritten. A write also carries the folder it was read from, so changing the profile folder in Settings can't misdirect a draft.
- Validation is pure in core, with the YAML parser (js-yaml) injected from desktop; errors block Save, warnings don't. The environment.json and mac.json rules follow devenv's own requirements (`Get-DevEnvServices`, `Get-MacConfig`, test.ps1, the profile README).
- The forms keep unknown fields, key order, BOM and line endings, and rewrite indentation to 2 spaces. Drafts live in memory for the session (tab and file switches keep them; reload loses them).
- Status, Start, Builds, Logs, Tests, Database, Emulator, Mac, Profile and Commands are the Dev Environment tabs; with this phase the v1 phasing is complete.
```

  Change the header's `**Status:**` line to `Implemented (phases 1–6)`.

- [ ] **Step 1: Edit, then commit**

```bash
git add docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "docs: record Phase 6 amendments to the devenv module spec"
```

---

### Task 6: End-to-end check

**Repository:** both

- [ ] **Step 1: Full suites**

- devenv: `Invoke-Pester ./tests`. All pass.
- NexusMD, in the worktree: `npm -w packages/core test` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the known jira flake.

- [ ] **Step 2: Headless check (throwaway script in the session scratchpad, nothing committed)**

Drive the worktree's `devenv.cjs` with the real `spawn`/`fs` and config `{ root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '<scratch>\\p6' }`:
1. `devenv:profile:list`: `exists: false`.
2. `devenv:run ['setup','profile']`: exit 0, `Created environment.json` among the lines.
3. `devenv:profile:list`: `exists: true`, `README.md` absent.
4. `devenv:profile:read` `environment.json`, then write it back with `"name": "e2e"` and the stamp: `ok`.
5. Write again with the *old* stamp: `stale`.
6. `devenv:catalog`: `profileError` is null (devenv accepts the saved file).
7. Delete `<scratch>\p6`.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Settings → Profile folder = an empty folder; Dev Environment → Profile | "No profile at … yet", Create from template |
| 2 | Create from template | Run output lists the created files; Environment opens in Form mode with the example's repositories |
| 3 | Change the Orders port to `70000` | Error next to the port; Save disabled |
| 4 | Set it to `5102`, Save | Saved; Text mode shows the change; unknown keys untouched |
| 5 | Edit `environment.json` in Notepad and save, then edit in NexusMD and Save | "environment.json changed on disk…"; Reload shows Notepad's edit |
| 6 | Mac → fill host and user, Save; then Mac tab → Set up SSH key; back to Profile → Mac | The form shows the `sshKey` devenv wrote (no conflict if the form was not edited meanwhile) |
| 7 | Open `docker/services.compose.yml`, break the YAML | js-yaml's message; Save disabled |
| 8 | Leave an unsaved edit, go to Status and back | Draft still there; tab shows `Profile •` |
| 9 | Check | `devenv doctor` output in the run panel |
| 10 | Commands tab | The profile's `commands.ps1` commands are listed |
| 11 | Settings → Profile folder back to the real one | The Profile tab now shows the real profile; nothing written to the throwaway folder from here on |

Confirm that no console window appears at any point.

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite.

- [ ] **Step 5: Merge**

- Merge `feature/nexusmd-profile` into devenv `master`.
- Merge `feature/devenv-profile` into NexusMD `master` (merge `master` in first if it moved, as Phase 5 did).
