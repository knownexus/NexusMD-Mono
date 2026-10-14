# Dev Environment Module — Design

**Date:** 2026-10-08
**Status:** Implemented (phases 1–6)
**Repos touched:** `NexusMD-Mono` (new module) and `C:\repos\dev-environment` (devenv: host mode, protocol, catalog)

## Goal

Use the whole of devenv (`C:\repos\dev-environment`) from inside NexusMD desktop, without ever seeing or typing into a console. devenv stays the engine: NexusMD runs its scripts as hidden processes and turns every interaction (plan screen, pickers, confirmations, passwords) into NexusMD UI. Running devenv from a terminal keeps working exactly as it does today.

## Decisions

| Topic | Decision |
|---|---|
| Shape | NexusMD is a GUI over devenv; devenv's PowerShell stays the engine |
| Coverage | Every devenv command, including the profile's `commands.ps1` extras; no console, ever |
| Audience | Single user (the author); module is off by default (`defaultEnabled: false`) |
| Platform | Desktop (Electron) only, gated by a `devenv` adapter that only desktop provides |
| Integration | New devenv "host mode" (`DEVENV_HOST=nexusmd`): structured stdout control lines + JSON answers on stdin |
| Start flow | Native plan form in NexusMD, fed by devenv's existing DevPlan DTO |
| Branch switching | In v1 (worktree list, remote branch → new worktree, typed ref) |
| Profile | In v1: create from template, structured editor for `environment.json` / `mac.json`, text editor for every other profile file |
| Mac / iOS | One-time SSH key setup from NexusMD; `sudo` passwords via the protocol and `sudo -S`; no `ssh -t` in host mode |

## Phasing (one spec, implemented in order, each its own plan)

1. **Foundation.** devenv: `Request-DevenvInput`, control-line emitters, `help --json` (with `Mut` flags and protocol version), host-mode handling of `Start-Process`. NexusMD: Electron runner, preload, adapter, core module, settings card, generic **Commands** screen, run panel, prompt dialogs. This phase alone covers all of devenv with no console.
2. **Status + Start.** `status --json`-equivalent `result`, plan out/in through the protocol, `source refs` result, Status tab, Start plan form, branch picker, session summary.
3. **Builds + Logs.**
4. **Tests + Database + Emulator.**
5. **Mac / iOS.** SSH key wizard, `sudo -S` path in `mac-common.ps1` / `ios/mac-host.sh`, Mac screen.
6. **Profile editor.**

### Out of scope (v1)

- Web and Android (`apps/web`, `apps/app`)
- Multi-user setup (onboarding wizard, per-teammate defaults)
- Replacing devenv logic in JS
- Running DevPlan's terminal UI under NexusMD (host mode never launches `devplan.exe`)
- Embedding Docker Desktop, the Android emulator window or mitmweb; those stay their own windows / the browser

## Architecture

```
NexusMD renderer (views/devenv/*)
   │  core argv builders, protocol parser, normalisers (@nexusmd/core modules/devenv)
   ▼
devenv adapter (apps/desktop/src/adapters/devenv.js) ── window.electronAPI.devenv
   ▼  IPC
Electron main: ipc/devenv.cjs ── spawn('pwsh', ['-NoProfile','-NonInteractive','-File', devenv.ps1, ...argv],
   │                                  { windowsHide: true, env: { DEVENV_HOST: 'nexusmd', DEVENV_PROFILE? } })
   ▼  stdout lines / stdin answers
devenv.ps1 → session.ps1, docker.ps1, test.ps1, emulator.ps1, build-*.ps1, mac.ps1, ...
```

### NexusMD components

| Layer | Path | Responsibility |
|---|---|---|
| Electron main | `apps/desktop/electron/ipc/devenv.cjs` | The only process spawner. argv arrays only, never a shell string. `windowsHide: true`. One `runId` per process; streams `devenv:line` and `devenv:exit` events; writes answers to stdin; `cancel(runId)` kills the tree with `taskkill /PID <pid> /T /F`. Enforces one exclusive run at a time. `spawn` is injectable for tests (same pattern as `db-manager.cjs` drivers). Wrapped in `withLogging`; answers to `secret` prompts are never logged. |
| Preload | `apps/desktop/electron/preload.cjs` | `window.electronAPI.devenv`: `run`, `answer`, `cancel`, `onLine`, `onExit`, `catalog`, `openPath`, `readProfileFile`, `writeProfileFile`, `listProfileFiles`. |
| Adapter | `apps/desktop/src/adapters/devenv.js` | Thin wrapper over the preload API; added to the desktop adapters object as `devenv`. |
| Core module | `packages/core/src/modules/devenv/` | `registerModule({ id: 'devenv', name: 'Dev Environment', requiredAdapters: ['devenv'], defaultEnabled: false })`. Pure: protocol line parser, argv builders per command, catalog → form model, status / plan / summary normalisers, profile schema + validation. No Node built-ins. |
| UI | `apps/desktop/src/views/devenv/` | Tabs listed under **Screens**; shared `RunPanel` and `PromptDialog`. |
| Nav | `apps/desktop/src/nav-config.js` | `{ id: 'devenv', label: 'Dev Environment', icon: 'build' }` |
| Settings | Desktop Settings → **Dev Environment** card | devenv folder (default `C:\repos\dev-environment`), `pwsh` path (default `pwsh`), profile folder (optional → `DEVENV_PROFILE`), **Check** (runs `help --json` then `doctor`). Stored in the NexusMD profile with the other desktop settings. |

### devenv changes

All are no-ops when `DEVENV_HOST` is unset, so the terminal workflow is unchanged.

| Change | Where |
|---|---|
| `Request-DevenvInput -Kind choice\|multi\|confirm\|text\|secret -Title -Detail -Options -Default -ConfirmWord` — terminal mode: today's `Read-Host` behaviour (`-AsSecureString` for secret); host mode: emit a `prompt` line, read one JSON line from stdin | `launcher-common.ps1` |
| Every `Read-Host` (17 today: `session.ps1` plan / build / test / database / baseline / YES confirm / branch picker / `Select-Indices` / clean / proceed, `build-ios.ps1` Mac password) goes through `Request-DevenvInput` | those files |
| `Write-DevenvEvent -Type step\|result\|open -Data` emits `@@devenv <json>` in host mode; `Write-Step` also emits `step` | `launcher-common.ps1`, `session.ps1` |
| `Start-Process <html\|url>` becomes `open` events in host mode | `test.ps1` (report, web) |
| Host mode never launches `devplan.exe`; `Invoke-StartPlanUI` emits the plan DTO as a `prompt` of kind `plan` and applies the answer exactly as it applies devplan's output file today | `session.ps1` |
| `Select-Ref` in host mode emits a `prompt` of kind `ref` with local worktrees, remote branches and free-text allowed | `session.ps1` |
| Start's "Session up" summary emits `result` `{ kind: 'summary', rows: [...] }` | `session.ps1` |
| Status emits `result` `{ kind: 'status', backend, database, test, android, ios }` (built from `docker compose ps --format json`, the database container, emulator state file, mitmproxy container, test stack status) | `session.ps1`, `docker.ps1`, `test.ps1`, `emulator.ps1` |
| `devenv help --json` emits `result` `{ kind: 'catalog', protocol: 1, commands: [{ group, verb, args, summary, switches, values, mut, pathValues }] }` from the existing command table, plus the profile's commands; new `Mut` (changes state) and `Path` (value is a file/folder) fields on table entries | `devenv.ps1` |
| Mac in host mode: no `ssh -t`; `ssh -o BatchMode=yes` (key auth required); `sudo -S` with the password from a `secret` prompt, sent over the ssh session's stdin, never on the command line | `mac-common.ps1`, `ios/mac-host.sh`, `build-ios.ps1` |
| `devenv mac key-setup`: generates `~/.ssh/devenv_mac_ed25519` if missing, installs the public key on the Mac (one password login: the Mac password comes from a `secret` prompt, is set as an environment variable on that one `ssh` child only, and `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` point ssh at a helper that prints it), writes `sshKey` into `mac.json` | `mac.ps1`, new `ios/askpass.cmd` |

## Protocol (version 1)

Control lines on stdout: `@@devenv ` followed by one line of JSON. All other lines are output, displayed with ANSI colour converted to styled spans. Control lines are never displayed.

| `type` | Fields | NexusMD behaviour |
|---|---|---|
| `prompt` | `id`, `kind`, `title`, `detail?`, `options?: [{ value, label, hint? }]`, `default?`, `confirmWord?`, `plan?` (kind `plan`), `ref` (kind `ref`) | Shows `PromptDialog`; writes `{"id":…,"value":…}` or `{"id":…,"cancel":true}` + newline to stdin |
| `step` | `n`, `total`, `text` | Progress bar in `RunPanel` |
| `result` | `kind`, payload | Feeds the screen that started the run (status cards, summary, catalog, report path) |
| `open` | `url` or `path` | URL → default browser; `.html` report → in-app window; folder → Explorer |

Prompt kinds and their dialogs: `choice` (single-select list), `multi` (checklist), `confirm` (yes/no, or type-the-word when `confirmWord` is set, e.g. `YES` for a wipe), `text`, `secret` (masked field, value sent once, never stored or logged), `plan` (the Start plan form), `ref` (branch picker).

Cancel answer: devenv treats it as the existing Q/Esc path and exits non-zero with `cancelled`.

Exclusive vs read-only: a run is exclusive when its catalog entry has `mut: true`. Only one exclusive run at a time; read-only runs (status, log follow, test status, catalog) run alongside.

Version check: NexusMD requires `protocol: 1` from `help --json`; otherwise the module shows "Update devenv" and disables every screen except Settings.

## Screens

All under the **Dev Environment** nav entry.

- **Status** (default): cards for Backend APIs (container state, port), Database, Test stack, Android (emulator + proxy), iOS (Mac reachable). Refreshes every 10s while visible and after every exclusive run. Actions: Start…, Stop, Backend up / down, Doctor.
- **Start:** runs `devenv start`; the `plan` prompt renders as a form: per source branch / sha / dirty, build action (skip / build / clean), **Change branch…** (opens the `ref` picker on a re-plan); database (keep / restore baseline / wipe+restore / remote); test stack (off / up / up+run) and its APIs; Android (off / up / up+run); iOS (off / build+run / build only, disabled with the reason when `mac.json` is missing). Progress from `step` events, output in `RunPanel`, ends on the summary card.
- **Builds:** each API (build / clean), all APIs, mobile (ABI, deploy fast / full, install), iOS (device). Shows last build sha / time from the lock file result.
- **Logs:** target picker (APIs, infra services, test services), follow live, text filter and level highlighting, `logs capture` with a time range.
- **Tests:** test stack up / down with API selection, Bruno folder / file tree from the profile's `api-tests` (or another collection folder), Run; reports open in-app, the tracer (`127.0.0.1:5280`) in the browser; report history from `.local/test/traces/runs`.
- **Database:** start / stop / status, backup, verify, restore (baseline choice), SQL script picker, DbGate on / off (opens `127.0.0.1:14331`).
- **Emulator:** start (proxy on / off, AVD), stop, proxy on / off, push files (drag-and-drop, optional destination), push CA, recreate AVD, reinstall app.
- **Mac / iOS:** doctor, fix (sudo prompts via the protocol), `setup ios-sim` / remove, **Set up SSH key** wizard.
- **Commands:** every catalog entry as a form (positional args, switches as checkboxes, values as inputs, `pathValues` as file / folder pickers). Guarantees nothing in devenv is unreachable. `setup shell` is hidden.
- **Profile:** "Create from template" (copies `profile.example` to `profile/`); structured forms for `environment.json` (repositories: key, label, kind, source, ref, project, port, dll, docker, start, migrationGuard, test; `database`; `mobile.packageId`; `test`) and `mac.json`; file tree + text editor for everything else in the profile. Validates before save (JSON / YAML parse, required `environment.json` keys, `mobile` key present when a mobile repo exists). Atomic save; warns when the file changed on disk since it was opened; **Check** runs `devenv doctor`.

## Error handling

| Situation | Behaviour |
|---|---|
| devenv folder missing / `help --json` fails | Module shows a setup state pointing at Settings |
| Protocol version mismatch | "Update devenv" state; screens disabled |
| `pwsh` missing / spawn error | Settings card shows the error and the path tried |
| Non-zero exit | Red exit badge, full output kept, Copy output; last error line raised as a toast; partial `result` (e.g. summary with FAILED rows) still rendered |
| Prompt while NexusMD is unfocused | Prompt queued, desktop notification, run waits (no timeout) |
| Missed `Read-Host` | `-NonInteractive` makes it an error naming the prompt instead of a hidden hang; the Pester guard (below) should stop it reaching here |
| Docker Desktop not running | devenv's own message shown; Status shows a banner |
| Profile file invalid / changed on disk | Save blocked with the parse error / conflict warning offering reload or overwrite |
| Cancel | Tree kill; devenv's existing `finally` / lock-file cleanup runs as it does on Ctrl+C; status refreshes |

## Testing

- **devenv (Pester, new `tests/` folder):** `Request-DevenvInput` terminal and host modes (fake stdin round trip, cancel), `Write-DevenvEvent` output shape, `help --json` matches the command table, plan prompt → applied plan round trip, `open` instead of `Start-Process` in host mode, and a guard test failing if `Read-Host` appears anywhere except inside `Request-DevenvInput`.
- **Core (vitest):** protocol parser (control vs output lines, malformed JSON → output line), argv builders, catalog → form model, status / plan / summary normalisers, profile validation.
- **Electron main (vitest, injected `spawn`):** line streaming across chunk boundaries, stdin answers, exclusive lock, tree cancel, secret answers absent from logs, env passed (`DEVENV_HOST`, `DEVENV_PROFILE`), `windowsHide: true`.
- **UI (vitest + testing-library):** each prompt kind, plan form → decision, ref picker, `RunPanel` (ANSI, progress, exit), Commands form generation, profile editor validation.
- **Manual checklist (real devenv, each phase):** start (local DB) → status → one API build → logs follow → test up + run + report → db restore → emulator start + push file → mac doctor → stop. Confirm no console window appears at any point.

## Amendments made during Phase 1 planning

- Phase 1 opens HTML reports with the default app (`shell.openPath`); the in-app report window arrives with the Tests screen (phase 4).
- The Settings **Check** button runs `help --json` only; `doctor` is run from the Commands screen.
- Until phase 5, Mac commands under NexusMD use `ssh -o BatchMode=yes` and need `sshKey` in `mac.json`; without it they fail fast instead of asking for a password. (superseded by the Phase 5 amendments)
- `logs show` prints the whole log into the output panel under NexusMD (no `less`).
- Phase 1 prompts are devenv's existing questions rendered as dialogs (including the plain start-plan menu); the dedicated plan form and branch picker are phase 2.
- `Select-Indices` gained a `-Labels` parameter so checklists show names, not numbers.
- Desktop tests need Node 20 (.nvmrc); on Node 22+ run them with NODE_OPTIONS=--no-experimental-webstorage, because Node's global localStorage hides jsdom's.
- Cancel is a process-tree kill (taskkill /T /F): devenv's PowerShell `finally` blocks do not run on cancel; a cancelled prompt (dialog Cancel) instead lets devenv stop itself cleanly.
- In phase 1 the Commands screen runs one command at a time; the run lives above the screen, so navigating away keeps it (and its prompts).

## Amendments made during Phase 2 planning

- Status comes from `devenv status --json` (one `result` line) through a read-only, allowlisted `devenv:query` IPC that never takes the exclusive slot; the text `devenv status` is unchanged.
- The plan and branch prompts are kinds `plan` and `ref`, answered with devplan's existing result objects through `Request-DevenvDecision`; closing either dialog answers (plan: `action: 'cancel'`; ref: `kind: 'cancel'`) rather than cancelling the run.
- The plan form and branch picker are dialogs rendered by the run provider (so they appear on any screen); the Start tab launches the run and shows its progress and summary.
- Status, Start and Commands are the Dev Environment tabs in this phase; Status is the default.
- The status hook survives React StrictMode's dev double-mount and only the newest status request may update the view.

## Amendments made during Phase 3 planning

- Builds reads `devenv build status --json` (result kind `builds`) from the `build-commit.txt` / `build-mode.json` / `ios-build-commit.txt` files devenv writes after each build, not from the lock file; "up to date" uses the start plan's rule (clean worktree, clean build, same commit).
- `build <api>` and `build apis` gained `--clean` (delete the project's bin/obj first, as the start plan's clean rebuild does).
- Logs reads its target list from `devenv logs targets --json` (result kind `log-targets`), so devenv owns the mapping from a log to the command that shows it; `logs capture` emits a `capture` result with the folder.
- `devenv:query` allowlists `status --json`, `build status --json` and `logs targets --json`.
- The Logs tab owns its own non-exclusive run beside the provider's run; a follow is cancelled when another log is shown and when the tab is left. Builds use the provider's run.
- Status, Start, Builds, Logs and Commands are the Dev Environment tabs in this phase.

## Amendments made during Phase 4 planning

- The Tests, Database and Emulator tabs read devenv data commands through `devenv:query`: `test runs --json` (run history from `.local/test/traces/runs/*/run.json` and Bruno's `bruno.json`), `test collection --json [--collection <folder>]` (the folder/request tree `bru run` accepts), `db baselines --json`, `db scripts --json` and `emulator avds --json`. `devenv:query` allows one absolute folder argument, for `test collection` only.
- Every Tests / Database / Emulator action is an existing devenv command run through the provider's single run; `test web`, `test report` and `db verify` run non-exclusive.
- `.html` files opened through `devenv:open` (devenv's `open` events and the Tests history) open in a sandboxed NexusMD window (no preload); links in it go to the system browser.
- `devenv db restore` only fills databases that don't exist yet (devenv's own rule); the Database tab says so and points at Start's plan or Clean for replacing data.
- Recreating an AVD (`emulator create`) is confirmed in the Emulator tab first; devenv itself still does not ask.
- Dropped files get their paths through `webUtils.getPathForFile` in the preload.
- Status, Start, Builds, Logs, Tests, Database, Emulator and Commands are the Dev Environment tabs in this phase.

## Amendments made during Phase 5 planning

- Under NexusMD every Mac ssh process gets its own stdin (never devenv's, which carries NexusMD's answers) and BatchMode; `mac fix` asks for the Mac password with a `secret` prompt and sends it as the first line of that stdin. `ios/mac-host.sh` checks it once with `sudo -v` (exit 254, nothing changed, if refused) and pipes it to `sudo -S` for each fix. Terminal mode keeps `ssh -t` and sudo's own prompt.
- `devenv mac key-setup`: an ed25519 key without a passphrase (`~/.ssh/devenv_mac_ed25519`; devenv logs in with BatchMode and Windows' ssh-agent is usually off), installed with one password login. It first probes with the key and, if the Mac is unreachable or its host key has changed, stops with a clear message before asking for any password (removing a changed host key is left to the user: `ssh-keygen -R`). Under NexusMD the password comes from a `secret` prompt and reaches ssh through `SSH_ASKPASS` = `ios/askpass.cmd` (`SSH_ASKPASS_REQUIRE=force`, password in `DEVENV_MAC_PASSWORD` on that ssh child only); askpass is host mode only - in a terminal, key-setup lets ssh prompt on the terminal itself. The Mac's host key is recorded on first contact (`StrictHostKeyChecking=accept-new`); re-running is harmless.
- `devenv mac status --json` (result kind `mac-status`: configured, host, user, sshKey, keyExists, connection ok/auth/hostkey/unreachable/error/unconfigured, detail, error) is allowlisted in `devenv:query`; it probes the login with BatchMode and a 5 s timeout and never throws.
- `devenv build ios --password` is unchanged: the .NET Pair-to-Mac build agent still receives `-p:ServerPassword` on its own command line, and builds use the agent's own Mac login, not devenv's key.
- Status, Start, Builds, Logs, Tests, Database, Emulator, Mac and Commands are the Dev Environment tabs in this phase.

## Amendments made during Phase 6 planning

- "Create from template" is `devenv setup profile` (also for terminal users): it copies the template's missing files into devenv's profile folder (`DEVENV_PROFILE`, else `<devenv>/profile`), never overwrites and skips the template's README.md.
- NexusMD reads and writes profile files itself, in the Electron main process (`devenv:profile:list|read|write`), never through pwsh: every path is relative to the profile folder main computes from the config, junctions and symlinks are neither followed nor listed, and files over 1 MiB, binary or non-UTF-8 files are view-only.
- Saves are atomic (temp file + rename, retried briefly on Windows sharing errors) and carry the SHA-256 stamp the edit started from; a changed file is reported as stale (Reload / Overwrite) rather than overwritten. A write also carries the folder it was read from, so changing the profile folder in Settings can't misdirect a draft.
- Validation is pure in core, with the YAML parser (js-yaml) injected from desktop; errors block Save, warnings don't. The environment.json and mac.json rules follow devenv's own requirements (`Get-DevEnvServices`, `Get-MacConfig`, test.ps1, the profile README).
- The forms keep unknown fields, key order, BOM and line endings, and rewrite indentation to 2 spaces. Drafts live in memory for the session (tab and file switches keep them; reload loses them). Validation runs on every edit rather than debounced: profile files are small.
- Status, Start, Builds, Logs, Tests, Database, Emulator, Mac, Profile and Commands are the Dev Environment tabs; with this phase the v1 phasing is complete.
