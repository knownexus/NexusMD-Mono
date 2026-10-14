# Dev Environment Module — Phase 6 (Profile editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Profile** tab for editing the devenv profile in NexusMD:
- create the profile from `profile.example`;
- edit `environment.json` and `mac.json` in structured forms, or as text;
- edit every other profile file in a CodeMirror editor;
- validate before saving;
- save atomically, warning when the file changed on disk;
- run `devenv doctor` from the tab.

**Architecture:** A new Electron module, `ipc/devenv-profile.cjs`, is the only code that touches profile files. It provides five handlers: `devenv:profile-info`, `-list`, `-read`, `-write` and `-create`. Every path arrives relative to the profile folder and is checked to stay inside it, including through junctions and symlinks.
- Writes go to a temp file followed by a rename.
- A write carries the `mtimeMs` the file had when it was read. If the file changed since, the write is refused as a conflict, unless the user chooses Overwrite.
- A UTF-8 BOM and CRLF line endings are kept as they were.

The core module `profile.js` holds the pure parts:
- file kinds;
- JSON and YAML parsing (YAML through the `yaml` package);
- `environment.json` and `mac.json` validation;
- line-ending helpers;
- immutable edit helpers for the forms.

The renderer has five pieces:
- `CodeEditor`, a CodeMirror 6 wrapper;
- `useProfileFile`, which loads, validates, saves, handles conflicts, and keeps unsaved drafts across file and tab switches;
- `ProfileFileEditor`, which shows a toolbar, banners, and either a form or the code editor;
- `EnvironmentForm` and `MacForm`;
- `ProfileView`, which holds the file list, the unsaved-changes guard, template creation and Check.

devenv itself does not change.

**Tech Stack:**
- Electron 43 (Node 22+, `fs/promises`, `fs.cp`), React 18, Vitest 4 + Testing Library (no jest-dom).
- New dependencies:
  - desktop: `codemirror` 6, plus `@codemirror/state`, `view`, `language`, `lang-json`, `lang-yaml`, `lang-sql`, `lang-markdown` and `legacy-modes`;
  - core: `yaml` 2.

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Screens → **Profile**; the Error handling row "Profile file invalid / changed on disk"; the NexusMD components table rows Preload and Core module, which mention `readProfileFile`, `writeProfileFile`, `listProfileFiles` and "profile schema + validation"). Previous plan for patterns: `docs/superpowers/plans/2026-10-14-devenv-phase5-mac-ios.md`.

**Repository:** NexusMD only, worktree `C:\repos\NexusMD-Mono-devenv6`, branch `feature/devenv-profile`.
- The controller created this worktree and ran `npm ci` in it, so it has its **own** `node_modules`. Install new packages there with `npm install -w <workspace> …`.
- Never touch `C:\repos\NexusMD-Mono`, which belongs to another session.
- devenv (`C:\repos\dev-environment`) is read only, as test data.

## Global Constraints

- **The profile folder** is `config.profile` when it is set (it must be an absolute path), else `<config.root>\profile`. `config.root` must be absolute.
  - A profile **exists** when `<dir>\environment.json` exists. That is devenv's own test (`launcher-common.ps1 Get-DevEnvProfileDir`).
- **Path confinement.**
  - Every file path from the renderer is a profile-relative path with `/` or `\` separators.
  - Absolute paths, NUL bytes, and anything resolving outside the profile folder are refused with `Not a profile file: <path>`. That includes `..`, and junctions or symlinks that lead outside, judged by the real path.
  - The listing skips symlinks and junctions, and the folders `.git`, `node_modules`, `bin`, `obj`, `.vs` and `.idea`. It stops after 2000 files and reports `truncated`.
- **Reads:**
  - files over 1 MB are refused with "too large to edit here";
  - a NUL byte in the first 8 KB means "isn't a text file";
  - a UTF-8 BOM is stripped and reported as `bom: true`;
  - a missing file returns `{ missing: true }` and does not throw.
- **Writes:**
  - Write to a temp file in the same folder (`.<name>.nexusmd-<hex>.tmp`), then rename over the target. The temp file is removed on failure.
  - The result is `{ ok: true, mtimeMs }`, `{ ok: false, conflict: true, mtimeMs }` or `{ ok: false, missing: true }`.
  - A conflict means the file exists and its `mtimeMs` differs from `expectedMtimeMs`, or `create` was asked for but the file exists. `overwrite: true` skips both checks.
  - A missing file is created only with `create: true`.
  - Writes over 2 MB are refused. The profile folder itself must already exist.
  - `bom: true` writes the BOM back. CRLF files are saved with CRLF: the renderer converts.
  - File contents never appear in logs or error messages.
- **Create from template** copies `<root>\profile.example` to the profile folder. It is refused when `profile.example` is missing, when the profile already exists, or when the folder exists and isn't empty.
- **Validation before save** (`validateProfileFile(path, text)` → `[{ message, line, path? }]`; any entry blocks Save):
  - `*.json` must parse.
  - `*.yml` / `*.yaml` must parse with `yaml`'s `parseAllDocuments`.
  - **`environment.json`** (at the profile root):
    - It must be an object, with `repositories` holding at least one entry.
    - Repository keys match `^[a-z][a-z0-9-]*$`.
    - `source`, `ref` and `project` are non-empty, and `ref` must not start with `-`.
    - `kind` is one of `api|mobile|web`. A `mobile`-kind repository must be keyed `mobile`, and the `mobile` key must be kind `mobile`.
    - `port` and `test.port` are integers from 1 to 65535. `test.db` is required when `test` is present.
    - `label` and `dll` are strings. `docker`, `start` and `migrationGuard` are booleans.
    - When a mobile repository exists, `mobile.packageId` is required.
    - `database.databases` is a list of names. `database.sourceContainer` matches `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`.
    - `test.defaultServices` only names repositories that have a `test` block.
    - Each `test.wiring[i]` has `from` and `to` naming repositories, a non-empty `key`, and a boolean `always` if present.
    - `test.extraDbConn` and `test.collectionPatterns` are objects.
  - **`mac.json`:** `host` matches `^[A-Za-z0-9.-]+$`, `user` matches `^[A-Za-z0-9._-]+$`, and `sshKey` is a string if present.
  - Other files are not validated.
- **Conflict UX:**
  - Saving over a file that changed on disk shows "This file changed on disk since you opened it", with **Reload (discard my changes)** and **Overwrite**.
  - Unsaved edits survive switching files or tabs for the lifetime of the window, through an in-memory draft store, and show "Unsaved changes from earlier were restored."
  - Switching to another file while the current one has unsaved edits asks first: **Discard changes** or **Keep editing**.
  - devenv itself rewrites `environment.json` (`source`/`ref`) during `devenv start`, so conflicts are expected, not exotic.
- **Forms:**
  - Form edits reserialise the file as `JSON.stringify(obj, null, 2) + '\n'`.
  - Keys the form does not show are kept: the form edits the parsed object itself.
  - JSON that does not parse forces the Text view, with "Fix the JSON in the Text view first."
  - Renaming a repository also renames it in `test.defaultServices` and `test.wiring` (`from`/`to`). Removing one also removes it from `test.defaultServices`.
  - Clearing an optional field removes its key. Optional fields are `label`, `dll`, `port`, the checkboxes when unticked, and `name`.
- **Check** runs `devenv doctor` through the provider's single run, with `exclusive: false` and label `devenv doctor`.
- Tab order: `['Status','Start','Builds','Logs','Tests','Database','Emulator','Mac','Profile','Commands']`.
- Code style: ESM without semicolons in `src/` and `packages/`; CommonJS with semicolons in `electron/*.cjs`. Comments explain why, never what.
- Tests:
  - Desktop tests always run with `NODE_OPTIONS=--no-experimental-webstorage`.
  - JS test strings keep Windows paths escaped (`'C:\\x'`).
  - Write files with the Write/Edit tools, never shell heredocs.
- Commits end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Escaping the profile folder** with `..`, an absolute path, or a junction inside the profile pointing elsewhere. It must be refused for read, write and list. Pinned in Task 1 with real temp folders and a real junction.
2. **A file changed on disk while open.** A typical cause is `devenv start` rewriting `environment.json`. Save must not silently overwrite it, and Reload must discard local edits. Pinned in Task 1 (an mtime conflict) and Task 4 (the banner, Overwrite and Reload).
3. **CRLF and BOM files**, such as PowerShell scripts. They round-trip byte-for-byte when nothing else changed. Pinned in Task 1 (BOM) and Task 4 (CRLF restored on save).
4. **Invalid JSON or YAML, or a schema error.** Save is blocked with the message and line, and Form view is refused until the text parses. Pinned in Tasks 2 and 4/5.
5. **Leaving a file with unsaved edits.** Switching files asks first, and switching tabs keeps a draft. Pinned in Task 4.

---

### Task 1: Electron — confined profile file IPC

**Files:**
- Create: `apps/desktop/electron/ipc/devenv-profile.cjs`, `apps/desktop/electron/ipc/devenv-profile.test.js`
- Modify:
  - `apps/desktop/electron/main.cjs`: require the module and call `register(ipcMain)` next to `devenvIpc.register(...)`.
  - `apps/desktop/electron/preload.cjs` and `preload.test.js`: five `devenv.profile*` methods.
  - `apps/desktop/src/adapters/devenv.js`.
  - `packages/core/src/adapters/index.js`: the `IDevenvAdapter` stubs.

**Interfaces:**
- Produces, for Task 4: renderer `adapter.profileInfo(config)`, `profileList(config)`, `profileRead(config, path)`, `profileWrite(config, path, text, { expectedMtimeMs, overwrite, create, bom })` and `profileCreate(config)`, each returning a Promise.

  | Method | Returns |
  |---|---|
  | `profileInfo` | `{ dir, isDefault, exists, example }` |
  | `profileList` | `{ dir, files: [{ path, size, mtimeMs }], truncated }`, with `path` profile-relative and `/`-separated, sorted |
  | `profileRead` | `{ text, bom, mtimeMs }` or `{ missing: true }` |
  | `profileWrite` | `{ ok: true, mtimeMs }`, `{ ok: false, conflict: true, mtimeMs }` or `{ ok: false, missing: true }` |
  | `profileCreate` | `{ ok: true, dir }` |

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/electron/ipc/devenv-profile.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { register, profileDir } from './devenv-profile.cjs'

let tmp, root, dir, h
const call = (ch, ...args) => h[ch](null, ...args)
const cfg = (over = {}) => ({ root, pwsh: 'pwsh', profile: '', ...over })

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-profile-'))
  root = path.join(tmp, 'dev-environment')
  dir = path.join(root, 'profile')
  fs.mkdirSync(path.join(root, 'profile.example', 'docker'), { recursive: true })
  fs.writeFileSync(path.join(root, 'profile.example', 'environment.json'), '{"repositories":{}}\n')
  fs.writeFileSync(path.join(root, 'profile.example', 'docker', 'services.compose.yml'), 'services: {}\n')
  h = {}
  register({ handle: (c, fn) => { h[c] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
})
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

function makeProfile() {
  fs.mkdirSync(path.join(dir, 'docker'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'api-tests', 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'environment.json'), '{"repositories":{}}\n')
  fs.writeFileSync(path.join(dir, 'docker', 'services.compose.yml'), 'services: {}\n')
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'x')
  fs.writeFileSync(path.join(dir, 'api-tests', 'node_modules', 'x.js'), 'x')
}

describe('profileDir', () => {
  it('uses <root>\\profile by default and an absolute profile setting otherwise', () => {
    expect(profileDir(cfg())).toBe(path.resolve(dir))
    expect(profileDir(cfg({ profile: path.join(tmp, 'elsewhere') }))).toBe(path.join(tmp, 'elsewhere'))
  })
  it('refuses relative folders', () => {
    expect(() => profileDir({ root: 'dev', profile: '' })).toThrow(/absolute/)
    expect(() => profileDir(cfg({ profile: 'rel' }))).toThrow(/absolute/)
  })
})

describe('info, create, list', () => {
  it('reports a missing profile and the template, then creates it from profile.example', async () => {
    expect(await call('devenv:profile-info', cfg())).toEqual({ dir: path.resolve(dir), isDefault: true, exists: false, example: true })
    expect(await call('devenv:profile-create', cfg())).toEqual({ ok: true, dir: path.resolve(dir) })
    expect(fs.readFileSync(path.join(dir, 'docker', 'services.compose.yml'), 'utf8')).toBe('services: {}\n')
    expect((await call('devenv:profile-info', cfg())).exists).toBe(true)
  })
  it('refuses to create over an existing profile or a non-empty folder', async () => {
    makeProfile()
    await expect(call('devenv:profile-create', cfg())).rejects.toThrow(/already exists/)
    const other = path.join(tmp, 'busy'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'x.txt'), 'x')
    await expect(call('devenv:profile-create', cfg({ profile: other }))).rejects.toThrow(/isn't empty/)
  })
  it('lists files with / paths, skipping .git, node_modules and junctions', async () => {
    makeProfile()
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
    const r = await call('devenv:profile-list', cfg())
    expect(r.files.map(f => f.path)).toEqual(['docker/services.compose.yml', 'environment.json'])
    expect(r.truncated).toBe(false)
    expect(typeof r.files[0].mtimeMs).toBe('number')
  })
})

describe('read', () => {
  beforeEach(makeProfile)
  it('reads text with its mtime, strips and reports a BOM, and reports a missing file', async () => {
    fs.writeFileSync(path.join(dir, 'bom.ps1'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Write-Host hi\r\n')]))
    expect(await call('devenv:profile-read', cfg(), 'bom.ps1')).toMatchObject({ text: 'Write-Host hi\r\n', bom: true })
    expect((await call('devenv:profile-read', cfg(), 'docker\\services.compose.yml')).text).toBe('services: {}\n')
    expect(await call('devenv:profile-read', cfg(), 'mac.json')).toEqual({ missing: true })
  })
  it('refuses binary and oversized files', async () => {
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([1, 0, 2]))
    await expect(call('devenv:profile-read', cfg(), 'b.bin')).rejects.toThrow(/isn't a text file/)
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 1))
    await expect(call('devenv:profile-read', cfg(), 'big.txt')).rejects.toThrow(/too large/)
  })
  it('refuses paths outside the profile, including through a junction', async () => {
    const outside = path.join(tmp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 's')
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction')
    for (const bad of ['../profile.example/environment.json', 'docker/../../x', path.join(tmp, 'outside', 'secret.txt'), 'link/secret.txt', '', 'a\0b']) {
      await expect(call('devenv:profile-read', cfg(), bad)).rejects.toThrow(/Not a profile file/)
    }
  })
})

describe('write', () => {
  beforeEach(makeProfile)
  const file = () => path.join(dir, 'environment.json')
  it('saves atomically and returns the new mtime, leaving no temp file', async () => {
    const { mtimeMs } = await call('devenv:profile-read', cfg(), 'environment.json')
    const r = await call('devenv:profile-write', cfg(), 'environment.json', '{"name":"x"}\n', { expectedMtimeMs: mtimeMs })
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"name":"x"}\n')
    expect(r.mtimeMs).toBe(fs.statSync(file()).mtimeMs)
    expect(fs.readdirSync(dir).filter(n => n.includes('nexusmd'))).toEqual([])
  })
  it('refuses to overwrite a file that changed on disk, unless told to', async () => {
    const { mtimeMs } = await call('devenv:profile-read', cfg(), 'environment.json')
    fs.writeFileSync(file(), '{"changed":true}\n'); fs.utimesSync(file(), new Date(), new Date(Date.now() + 5000))
    const r = await call('devenv:profile-write', cfg(), 'environment.json', '{"mine":1}\n', { expectedMtimeMs: mtimeMs })
    expect(r).toEqual({ ok: false, conflict: true, mtimeMs: fs.statSync(file()).mtimeMs })
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"changed":true}\n')
    expect((await call('devenv:profile-write', cfg(), 'environment.json', '{"mine":1}\n', { expectedMtimeMs: mtimeMs, overwrite: true })).ok).toBe(true)
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"mine":1}\n')
  })
  it('creates a missing file only when asked, and treats an unexpected existing file as a conflict', async () => {
    expect(await call('devenv:profile-write', cfg(), 'mac.json', '{}', {})).toEqual({ ok: false, missing: true })
    expect((await call('devenv:profile-write', cfg(), 'mac.json', '{"host":"m"}\n', { create: true })).ok).toBe(true)
    expect((await call('devenv:profile-write', cfg(), 'mac.json', '{}', { create: true })).conflict).toBe(true)
  })
  it('writes the BOM back when asked', async () => {
    await call('devenv:profile-write', cfg(), 'x.ps1', 'a\r\n', { create: true, bom: true })
    expect([...fs.readFileSync(path.join(dir, 'x.ps1'))].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
  })
  it('refuses paths outside the profile and a missing profile folder', async () => {
    await expect(call('devenv:profile-write', cfg(), '../evil.txt', 'x', { create: true })).rejects.toThrow(/Not a profile file/)
    expect(fs.existsSync(path.join(root, 'evil.txt'))).toBe(false)
    await expect(call('devenv:profile-write', cfg({ profile: path.join(tmp, 'nope') }), 'a.txt', 'x', { create: true })).rejects.toThrow(/No profile folder/)
  })
})
```

In `preload.test.js`, add:

```js
  it('exposes the devenv profile file methods over their channels', () => {
    const cfg = { root: 'C:\\r', pwsh: 'pwsh', profile: '' }
    exposed.devenv.profileInfo(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-info', cfg)
    exposed.devenv.profileList(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-list', cfg)
    exposed.devenv.profileRead(cfg, 'mac.json'); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-read', cfg, 'mac.json')
    exposed.devenv.profileWrite(cfg, 'mac.json', '{}', { create: true }); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-write', cfg, 'mac.json', '{}', { create: true })
    exposed.devenv.profileCreate(cfg); expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('devenv:profile-create', cfg)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run, from `C:\repos\NexusMD-Mono-devenv6`: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron/ipc/devenv-profile.test.js electron/preload.test.js`
Expected: FAIL. The module is missing and `profileInfo` is not a function.

- [ ] **Step 3: Implement `devenv-profile.cjs`**

```js
// electron/ipc/devenv-profile.cjs
//
// The devenv profile (environment.json, mac.json, compose files, scripts...) as files the Dev
// Environment Profile tab can list, read and save. Paths come from the renderer relative to the
// profile folder and must stay inside it - judged by real paths, so a junction can't lead out.

'use strict';

const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { withLogging } = require('./withLogging.cjs');

const MAX_READ = 1024 * 1024;
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_FILES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', '.idea']);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function profileDir(config) {
  const { root, profile } = config || {};
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Set the devenv folder in Settings → Desktop (an absolute path).');
  if (profile && (typeof profile !== 'string' || !path.isAbsolute(profile))) throw new Error('The profile folder in Settings must be an absolute path.');
  return path.resolve(profile || path.join(root, 'profile'));
}

const inside = (dir, p) => {
  const d = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return p.toLowerCase().startsWith(d.toLowerCase());
};
const real = p => fsp.realpath(p).catch(() => null);
const exists = p => fsp.stat(p).then(() => true, () => false);
const isDir = p => fsp.stat(p).then(s => s.isDirectory(), () => false);

async function resolveFile(dir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) throw new Error(`Not a profile file: ${rel}`);
  const full = path.resolve(dir, rel);
  if (!inside(dir, full)) throw new Error(`Not a profile file: ${rel}`);
  const realDir = (await real(dir)) || dir;
  const realFull = (await real(full)) || path.join((await real(path.dirname(full))) || path.dirname(full), path.basename(full));
  if (!inside(realDir, realFull)) throw new Error(`Not a profile file: ${rel}`);
  return full;
}

async function listFiles(dir) {
  const files = [];
  let truncated = false;
  async function walk(abs, rel) {
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(abs, e.name), r); continue; }
      if (!e.isFile()) continue;
      const st = await fsp.stat(path.join(abs, e.name));
      files.push({ path: r, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  await walk(dir, '');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
}

function register(ipcMain, { logger } = {}) {
  const handle = withLogging(ipcMain, logger);

  handle('devenv:profile-info', async (_e, config) => {
    const dir = profileDir(config);
    return { dir, isDefault: !config.profile, exists: await exists(path.join(dir, 'environment.json')), example: await isDir(path.join(path.resolve(config.root), 'profile.example')) };
  });

  handle('devenv:profile-list', async (_e, config) => {
    const dir = profileDir(config);
    if (!(await isDir(dir))) return { dir, files: [], truncated: false };
    return { dir, ...(await listFiles(dir)) };
  });

  handle('devenv:profile-read', async (_e, config, rel) => {
    const dir = profileDir(config);
    const full = await resolveFile(dir, rel);
    let st;
    try { st = await fsp.stat(full); } catch (e) { if (e.code === 'ENOENT') return { missing: true }; throw e; }
    if (!st.isFile()) throw new Error(`Not a file: ${rel}`);
    if (st.size > MAX_READ) throw new Error(`${rel} is too large to edit here (${Math.round(st.size / 1024)} KB).`);
    let buf = await fsp.readFile(full);
    if (buf.subarray(0, 8192).includes(0)) throw new Error(`${rel} isn't a text file.`);
    const bom = buf.subarray(0, 3).equals(BOM);
    if (bom) buf = buf.subarray(3);
    return { text: buf.toString('utf8'), bom, mtimeMs: st.mtimeMs };
  });

  handle('devenv:profile-write', async (_e, config, rel, text, opts = {}) => {
    if (typeof text !== 'string') throw new Error('Nothing to save.');
    const body = Buffer.concat([opts.bom ? BOM : Buffer.alloc(0), Buffer.from(text, 'utf8')]);
    if (body.length > MAX_WRITE) throw new Error(`${rel} is too large to save here.`);
    const dir = profileDir(config);
    if (!(await isDir(dir))) throw new Error(`No profile folder at ${dir}.`);
    const full = await resolveFile(dir, rel);
    let current = null;
    try { current = await fsp.stat(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!opts.overwrite) {
      if (current && (opts.create || current.mtimeMs !== opts.expectedMtimeMs)) return { ok: false, conflict: true, mtimeMs: current.mtimeMs };
      if (!current && !opts.create) return { ok: false, missing: true };
    }
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.nexusmd-${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, full);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    return { ok: true, mtimeMs: (await fsp.stat(full)).mtimeMs };
  });

  handle('devenv:profile-create', async (_e, config) => {
    const dir = profileDir(config);
    const example = path.join(path.resolve(config.root), 'profile.example');
    if (!(await isDir(example))) throw new Error(`No profile.example in ${config.root}.`);
    if (await exists(path.join(dir, 'environment.json'))) throw new Error(`A profile already exists at ${dir}.`);
    if ((await isDir(dir)) && (await fsp.readdir(dir)).length) throw new Error(`${dir} isn't empty - choose an empty folder or remove it first.`);
    await fsp.cp(example, dir, { recursive: true, errorOnExist: true, force: false });
    return { ok: true, dir };
  });
}

module.exports = { register, profileDir };
```

Wire it up:
- **`main.cjs`:** add `const devenvProfileIpc = require('./ipc/devenv-profile.cjs');` next to `devenvIpc`, and `devenvProfileIpc.register(ipcMain);` right after the `devenvIpc.register(...)` call.
- **`preload.cjs`**, in the `devenv` object:

```js
    profileInfo:   (config) => ipcRenderer.invoke('devenv:profile-info', config),
    profileList:   (config) => ipcRenderer.invoke('devenv:profile-list', config),
    profileRead:   (config, path) => ipcRenderer.invoke('devenv:profile-read', config, path),
    profileWrite:  (config, path, text, opts) => ipcRenderer.invoke('devenv:profile-write', config, path, text, opts),
    profileCreate: (config) => ipcRenderer.invoke('devenv:profile-create', config),
```

- **`src/adapters/devenv.js`:** add the five pass-throughs, for example `profileRead(config, path) { return api().profileRead(config, path) },`.
- **`IDevenvAdapter`:** add five stubs that reject with `'IDevenvAdapter.profileX not implemented'`, under a comment along the lines of "The devenv profile's files (Profile tab), confined to the profile folder by the host".

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run electron` and `npm -w packages/core test`
Expected: PASS. Creating a junction needs no admin rights on Windows. If `fs.symlinkSync(…, 'junction')` fails in this environment anyway, keep the test and report the error.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/ipc/devenv-profile.cjs apps/desktop/electron/ipc/devenv-profile.test.js apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs apps/desktop/electron/preload.test.js apps/desktop/src/adapters/devenv.js packages/core/src/adapters/index.js
git commit -m "feat(desktop): confined devenv profile file IPC (list, read, atomic write, create from template)"
```

---

### Task 2: Core — profile validation and edit helpers

**Files:**
- Modify: `packages/core/package.json`. Add the `yaml` dependency with `npm install -w packages/core yaml@^2`, run from the worktree root. This updates the root `package-lock.json`.
- Create: `packages/core/src/modules/devenv/profile.js`, `profile.test.js`
- Modify: `packages/core/src/modules/devenv/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces:**
- Produces, for Tasks 4 and 5:
  - `profileFileKind(path)` → `'json'|'yaml'|'powershell'|'sql'|'markdown'|'text'`;
  - `validateProfileFile(path, text)` → `[{ message, line, path? }]`;
  - `validateEnvironment(obj)` → `[{ path, message }]`;
  - `validateMac(obj)` → `[{ path, message }]`;
  - `detectEol(text)` → `'\r\n'|'\n'`;
  - `toLf(text)`;
  - `fromLf(text, eol)`;
  - `setIn(obj, keys, value)`: immutable, where `value === undefined` deletes the key and array indexes are allowed;
  - `formatJson(obj)`;
  - `newRepository()` → `{ source: '', ref: 'main', project: '', kind: 'api' }`;
  - `addRepository(env, key)`;
  - `renameRepository(env, from, to)`: order-preserving, and updates `test.defaultServices` and `test.wiring` from/to;
  - `removeRepository(env, key)`: also drops the key from `test.defaultServices`;
  - `REPOSITORY_KEY` (the regex).

- [ ] **Step 1: Write the failing tests**

`profile.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  profileFileKind, validateProfileFile, validateEnvironment, validateMac, detectEol, toLf, fromLf,
  setIn, formatJson, newRepository, addRepository, renameRepository, removeRepository,
} from './profile.js'

const ENV = {
  name: 'example',
  repositories: {
    orders: { source: '../orders/main', ref: 'main', project: 'src/O.csproj', label: 'Orders', kind: 'api', port: 5101, dll: 'O.dll', docker: true, start: true, migrationGuard: true, test: { port: 5201, db: 'Orders_Local' } },
    mobile: { source: '../app/main', ref: 'main', project: 'src/A.csproj', kind: 'mobile', start: true },
  },
  database: { name: 'Orders_Local', databases: ['Orders_Local'], sourceContainer: 'sql-dev' },
  mobile: { packageId: 'com.example.app' },
  test: { defaultServices: ['orders'], collection: 'api-tests', collectionEnv: 'docker', wiring: [{ from: 'orders', to: 'orders', key: 'Self__Url', always: true }], extraDbConn: {}, collectionPatterns: { order: 'orders' } },
}
const msgs = env => validateEnvironment(env).map(e => e.message)

describe('profileFileKind', () => {
  it('maps extensions to editor languages', () => {
    expect(['environment.json', 'docker/a.yml', 'x.yaml', 'commands.ps1', 'sql/a.sql', 'README.md', 'api-tests/a.bru', 'docker/a.env'].map(profileFileKind))
      .toEqual(['json', 'yaml', 'yaml', 'powershell', 'sql', 'markdown', 'text', 'text'])
  })
})

describe('validateEnvironment', () => {
  it('accepts the example profile', () => { expect(validateEnvironment(ENV)).toEqual([]) })
  it('needs repositories with the required fields', () => {
    expect(msgs({})).toContain('repositories needs at least one repository.')
    const m = msgs({ repositories: { 'Bad Key': { kind: 'api' }, b: { source: 'x', ref: '-x', project: 'p', kind: 'desktop', port: 70000 } } })
    expect(m.some(x => /Bad Key.*lower-case/.test(x))).toBe(true)
    expect(m).toContain('b: ref can\'t start with \'-\'.')
    expect(m).toContain('b: kind must be api, mobile or web.')
    expect(m).toContain('b: port must be a whole number from 1 to 65535.')
    expect(m.filter(x => /: (source|ref|project) is required\./.test(x))).toHaveLength(3)
  })
  it('checks types of the optional fields and the test block', () => {
    const env = structuredClone(ENV)
    Object.assign(env.repositories.orders, { docker: 'yes', label: 3, test: { port: '5201' } })
    const m = msgs(env)
    expect(m).toContain('orders: docker must be true or false.')
    expect(m).toContain('orders: label must be text.')
    expect(m).toContain('orders: test.port must be a whole number from 1 to 65535.')
    expect(m).toContain('orders: test.db is required.')
  })
  it('ties the mobile app to the "mobile" key and mobile.packageId', () => {
    const env = structuredClone(ENV); delete env.mobile
    expect(msgs(env)).toContain('A mobile repository needs mobile.packageId (the app id, e.g. com.example.app).')
    const renamed = structuredClone(ENV); renamed.repositories.app = renamed.repositories.mobile; delete renamed.repositories.mobile
    expect(msgs(renamed)).toContain('The mobile app\'s repository must be named "mobile" (not "app").')
  })
  it('checks database and test sections against the repositories', () => {
    const env = structuredClone(ENV)
    env.database.sourceContainer = 'bad name'; env.database.databases = 'Orders_Local'
    env.test.defaultServices = ['mobile']; env.test.wiring = [{ from: 'nope', to: 'orders', key: '' }]
    const m = msgs(env)
    expect(m).toContain('database.sourceContainer must be a container name (letters, digits, _ . -).')
    expect(m).toContain('database.databases must be a list of names.')
    expect(m).toContain('test.defaultServices: "mobile" isn\'t a repository with a test block.')
    expect(m).toContain('test.wiring 1: from must be one of the repositories.')
    expect(m).toContain('test.wiring 1: key (the setting name) is required.')
  })
})

describe('validateMac', () => {
  it('checks host, user and sshKey', () => {
    expect(validateMac({ host: '10.0.0.5', user: 'me.name', sshKey: 'C:\\k' })).toEqual([])
    expect(validateMac({ host: 'bad host', user: 'a b' }).map(e => e.path)).toEqual(['host', 'user'])
    expect(validateMac([]).length).toBe(1)
  })
})

describe('validateProfileFile', () => {
  it('reports JSON syntax errors with a line', () => {
    const [e] = validateProfileFile('docker/x.json', '{\n  "a": 1,\n}')
    expect(e.line).toBe(3)
  })
  it('validates environment.json and mac.json at the profile root only', () => {
    expect(validateProfileFile('environment.json', '{}')[0].message).toBe('repositories needs at least one repository.')
    expect(validateProfileFile('mac.json', '{"host":"m","user":"u"}')).toEqual([])
    expect(validateProfileFile('docker/environment.json', '{}')).toEqual([])
  })
  it('reports YAML errors with a line and accepts compose files', () => {
    expect(validateProfileFile('docker/services.compose.yml', 'services:\n  api:\n    image: x\n    volumes:\n      - ${DEVENV_ROOT}/a:/a\n')).toEqual([])
    const [e] = validateProfileFile('a.yml', 'a: [1, 2\nb: 3\n')
    expect(e.line).toBeGreaterThan(0)
  })
  it('does not validate other files', () => { expect(validateProfileFile('commands.ps1', '{{{')).toEqual([]) })
})

describe('line endings', () => {
  it('detects, strips and restores CRLF', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n'); expect(detectEol('a\nb')).toBe('\n')
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n')
    expect(fromLf('a\nb\n', '\r\n')).toBe('a\r\nb\r\n'); expect(fromLf('a\nb', '\n')).toBe('a\nb')
  })
})

describe('edit helpers', () => {
  it('setIn sets, creates and deletes without mutating', () => {
    const o = { a: { b: 1 }, list: [{ x: 1 }] }
    expect(setIn(o, ['a', 'c'], 2)).toEqual({ a: { b: 1, c: 2 }, list: [{ x: 1 }] })
    expect(setIn(o, ['a', 'b'], undefined)).toEqual({ a: {}, list: [{ x: 1 }] })
    expect(setIn(o, ['n', 'm'], 1).n).toEqual({ m: 1 })
    expect(setIn(o, ['list', 0, 'x'], 5).list).toEqual([{ x: 5 }])
    expect(o).toEqual({ a: { b: 1 }, list: [{ x: 1 }] })
  })
  it('formats JSON with two spaces and a final newline', () => { expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}\n') })
  it('adds, renames (in order, with references) and removes repositories', () => {
    const added = addRepository(ENV, 'billing')
    expect(added.repositories.billing).toEqual(newRepository())
    const renamed = renameRepository(ENV, 'orders', 'ordering')
    expect(Object.keys(renamed.repositories)).toEqual(['ordering', 'mobile'])
    expect(renamed.test.defaultServices).toEqual(['ordering'])
    expect(renamed.test.wiring[0]).toMatchObject({ from: 'ordering', to: 'ordering' })
    const removed = removeRepository(ENV, 'orders')
    expect(Object.keys(removed.repositories)).toEqual(['mobile'])
    expect(removed.test.defaultServices).toEqual([])
    expect(ENV.repositories.orders).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm -w packages/core exec vitest run src/modules/devenv/profile.test.js`
Expected: FAIL — `profile.js` is missing.

- [ ] **Step 3: Implement**

First run `npm install -w packages/core yaml@^2` from the worktree root.

`profile.js`:

```js
// packages/core/src/modules/devenv/profile.js
//
// The devenv profile as the Profile tab edits it: which editor a file gets, what must be true
// before it may be saved (devenv itself never validates environment.json - a bad one only fails
// later, deep inside start or build), and immutable edits for the environment.json form.

import { parseAllDocuments } from 'yaml'

export const REPOSITORY_KEY = /^[a-z][a-z0-9-]*$/
const KINDS = ['api', 'mobile', 'web']
const CONTAINER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const MAC_HOST = /^[A-Za-z0-9.-]+$/
const MAC_USER = /^[A-Za-z0-9._-]+$/

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = v => typeof v === 'string' && v.trim() !== ''
const isPort = v => Number.isInteger(v) && v > 0 && v < 65536

export function profileFileKind(path) {
  const name = String(path).toLowerCase()
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml'
  if (/\.ps(m|d)?1$/.test(name)) return 'powershell'
  if (name.endsWith('.sql')) return 'sql'
  if (name.endsWith('.md')) return 'markdown'
  return 'text'
}

export function validateEnvironment(env) {
  const errors = []
  const err = (path, message) => errors.push({ path, message })
  if (!isObj(env)) { err('', 'environment.json must be a JSON object.'); return errors }
  if (env.name !== undefined && typeof env.name !== 'string') err('name', 'name must be text.')
  const repos = isObj(env.repositories) ? env.repositories : null
  const keys = repos ? Object.keys(repos) : []
  if (!keys.length) err('repositories', 'repositories needs at least one repository.')
  for (const key of keys) {
    const r = repos[key]
    const at = f => `repositories.${key}${f ? `.${f}` : ''}`
    if (!REPOSITORY_KEY.test(key)) err(at(), `"${key}": repository names are lower-case letters, digits and -, starting with a letter.`)
    if (!isObj(r)) { err(at(), `${key} must be an object.`); continue }
    for (const f of ['source', 'ref', 'project']) if (!isStr(r[f])) err(at(f), `${key}: ${f} is required.`)
    if (isStr(r.ref) && r.ref.trim().startsWith('-')) err(at('ref'), `${key}: ref can't start with '-'.`)
    if (!KINDS.includes(r.kind)) err(at('kind'), `${key}: kind must be api, mobile or web.`)
    else if (r.kind === 'mobile' && key !== 'mobile') err(at('kind'), `The mobile app's repository must be named "mobile" (not "${key}").`)
    if (key === 'mobile' && KINDS.includes(r.kind) && r.kind !== 'mobile') err(at('kind'), 'The "mobile" repository must have kind mobile.')
    if (r.port !== undefined && !isPort(r.port)) err(at('port'), `${key}: port must be a whole number from 1 to 65535.`)
    for (const f of ['label', 'dll']) if (r[f] !== undefined && typeof r[f] !== 'string') err(at(f), `${key}: ${f} must be text.`)
    for (const f of ['docker', 'start', 'migrationGuard']) if (r[f] !== undefined && typeof r[f] !== 'boolean') err(at(f), `${key}: ${f} must be true or false.`)
    if (r.test !== undefined) {
      if (!isObj(r.test)) err(at('test'), `${key}: test must be an object with port and db.`)
      else {
        if (!isPort(r.test.port)) err(at('test.port'), `${key}: test.port must be a whole number from 1 to 65535.`)
        if (!isStr(r.test.db)) err(at('test.db'), `${key}: test.db is required.`)
      }
    }
  }
  if (keys.some(k => repos[k]?.kind === 'mobile') && !isStr(env.mobile?.packageId)) err('mobile.packageId', 'A mobile repository needs mobile.packageId (the app id, e.g. com.example.app).')
  if (env.database !== undefined) {
    const d = env.database
    if (!isObj(d)) err('database', 'database must be an object.')
    else {
      if (d.name !== undefined && typeof d.name !== 'string') err('database.name', 'database.name must be text.')
      if (d.databases !== undefined && (!Array.isArray(d.databases) || !d.databases.every(isStr))) err('database.databases', 'database.databases must be a list of names.')
      if (d.sourceContainer !== undefined && d.sourceContainer !== '' && !CONTAINER.test(String(d.sourceContainer))) err('database.sourceContainer', 'database.sourceContainer must be a container name (letters, digits, _ . -).')
    }
  }
  if (env.test !== undefined) {
    const t = env.test
    if (!isObj(t)) err('test', 'test must be an object.')
    else {
      const testKeys = keys.filter(k => isObj(repos[k]?.test))
      if (t.defaultServices !== undefined) {
        if (!Array.isArray(t.defaultServices)) err('test.defaultServices', 'test.defaultServices must be a list.')
        else for (const s of t.defaultServices) if (!testKeys.includes(s)) err('test.defaultServices', `test.defaultServices: "${s}" isn't a repository with a test block.`)
      }
      for (const f of ['collection', 'collectionEnv']) if (t[f] !== undefined && typeof t[f] !== 'string') err(`test.${f}`, `test.${f} must be text.`)
      if (t.wiring !== undefined) {
        if (!Array.isArray(t.wiring)) err('test.wiring', 'test.wiring must be a list.')
        else t.wiring.forEach((w, i) => {
          const n = i + 1
          if (!isObj(w)) { err(`test.wiring.${i}`, `test.wiring ${n} must be an object.`); return }
          for (const f of ['from', 'to']) if (!keys.includes(w[f])) err(`test.wiring.${i}.${f}`, `test.wiring ${n}: ${f} must be one of the repositories.`)
          if (!isStr(w.key)) err(`test.wiring.${i}.key`, `test.wiring ${n}: key (the setting name) is required.`)
          if (w.always !== undefined && typeof w.always !== 'boolean') err(`test.wiring.${i}.always`, `test.wiring ${n}: always must be true or false.`)
        })
      }
      for (const f of ['extraDbConn', 'collectionPatterns']) if (t[f] !== undefined && !isObj(t[f])) err(`test.${f}`, `test.${f} must be an object.`)
    }
  }
  return errors
}

export function validateMac(mac) {
  if (!isObj(mac)) return [{ path: '', message: 'mac.json must be a JSON object.' }]
  const errors = []
  if (!MAC_HOST.test(String(mac.host ?? ''))) errors.push({ path: 'host', message: "host must be the Mac's IP address or host name." })
  if (!MAC_USER.test(String(mac.user ?? ''))) errors.push({ path: 'user', message: 'user must be your Mac login name.' })
  if (mac.sshKey !== undefined && typeof mac.sshKey !== 'string') errors.push({ path: 'sshKey', message: 'sshKey must be a file path.' })
  return errors
}

function jsonError(e, text) {
  const message = String(e?.message || e)
  const ln = /line (\d+)/.exec(message)
  const pos = /position (\d+)/.exec(message)
  const line = ln ? Number(ln[1]) : pos ? text.slice(0, Number(pos[1])).split('\n').length : null
  return { message, line }
}

export function validateProfileFile(path, text) {
  const kind = profileFileKind(path)
  const name = String(path).replace(/\\/g, '/').toLowerCase()
  if (kind === 'json') {
    let value
    try { value = JSON.parse(text) } catch (e) { return [jsonError(e, text)] }
    if (name === 'environment.json') return validateEnvironment(value).map(e => ({ ...e, line: null }))
    if (name === 'mac.json') return validateMac(value).map(e => ({ ...e, line: null }))
    return []
  }
  if (kind === 'yaml') {
    const out = []
    for (const doc of parseAllDocuments(text)) for (const e of doc.errors ?? []) out.push({ message: e.message, line: e.linePos?.[0]?.line ?? null })
    return out
  }
  return []
}

export const detectEol = text => (/\r\n/.test(text) ? '\r\n' : '\n')
export const toLf = text => text.replace(/\r\n/g, '\n')
export const fromLf = (text, eol) => (eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text)
export const formatJson = obj => `${JSON.stringify(obj, null, 2)}\n`

export function setIn(obj, keys, value) {
  const [k, ...rest] = keys
  const base = Array.isArray(obj) ? [...obj] : { ...(isObj(obj) ? obj : {}) }
  if (!rest.length) {
    if (value === undefined && !Array.isArray(base)) delete base[k]
    else base[k] = value
    return base
  }
  base[k] = setIn(base[k], rest, value)
  return base
}

export const newRepository = () => ({ source: '', ref: 'main', project: '', kind: 'api' })

export function addRepository(env, key) {
  return setIn(env, ['repositories', key], newRepository())
}

export function renameRepository(env, from, to) {
  const repositories = Object.fromEntries(Object.entries(env.repositories || {}).map(([k, v]) => [k === from ? to : k, v]))
  let next = { ...env, repositories }
  const swap = v => (v === from ? to : v)
  if (Array.isArray(env.test?.defaultServices)) next = setIn(next, ['test', 'defaultServices'], env.test.defaultServices.map(swap))
  if (Array.isArray(env.test?.wiring)) next = setIn(next, ['test', 'wiring'], env.test.wiring.map(w => (isObj(w) ? { ...w, from: swap(w.from), to: swap(w.to) } : w)))
  return next
}

export function removeRepository(env, key) {
  let next = setIn(env, ['repositories', key], undefined)
  if (Array.isArray(env.test?.defaultServices)) next = setIn(next, ['test', 'defaultServices'], env.test.defaultServices.filter(s => s !== key))
  return next
}
```

Add the names to `modules/devenv/index.js`:

```js
export {
  profileFileKind, validateProfileFile, validateEnvironment, validateMac, detectEol, toLf, fromLf, formatJson,
  setIn, newRepository, addRepository, renameRepository, removeRepository, REPOSITORY_KEY,
} from './profile.js'
```

Then add the same names to the devenv export list in `packages/core/src/index.js` and in `packages/core/tests/public-api.test.js`.

- [ ] **Step 4: Run the tests**

Run: `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core package-lock.json
git commit -m "feat(core): devenv profile validation (environment.json, mac.json, JSON/YAML) and form edit helpers"
```

---

### Task 3: CodeMirror wrapper

**Files:**
- Modify: `apps/desktop/package.json` and the root `package-lock.json`, through `npm install -w apps/desktop codemirror@^6 @codemirror/state@^6 @codemirror/view@^6 @codemirror/language@^6 @codemirror/lang-json@^6 @codemirror/lang-yaml@^6 @codemirror/lang-sql@^6 @codemirror/lang-markdown@^6 @codemirror/legacy-modes@^6` run from the worktree root.
- Create: `apps/desktop/src/views/devenv/code-editor.jsx`, `code-editor.test.jsx`

**Interfaces:**
- Produces, for Tasks 4 and 5: `CodeEditor({ value, language, onChange, ariaLabel })`.
  - `language` is one of `'json'|'yaml'|'powershell'|'sql'|'markdown'|'text'`.
  - `onChange(text)` fires on user edits only. The text has `\n` line endings.
  - A new `value` prop replaces the document.

- [ ] **Step 1: Write the failing test**

`code-editor.test.jsx`:

```js
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CodeEditor } from './code-editor.jsx'

afterEach(cleanup)

describe('CodeEditor', () => {
  it('shows the value in a CodeMirror editor with an accessible label', () => {
    const { container } = render(<CodeEditor value={'{\n  "a": 1\n}\n'} language="json" onChange={() => {}} ariaLabel="Edit environment.json" />)
    const content = container.querySelector('.cm-content')
    expect(content).toBeTruthy()
    expect(content.getAttribute('aria-label')).toBe('Edit environment.json')
    expect(content.textContent).toContain('"a": 1')
  })
  it('replaces the document when the value changes from outside', () => {
    const { container, rerender } = render(<CodeEditor value="one" language="text" onChange={() => {}} ariaLabel="x" />)
    rerender(<CodeEditor value="two" language="text" onChange={() => {}} ariaLabel="x" />)
    expect(container.querySelector('.cm-content').textContent).toBe('two')
  })
  it('accepts every profile language', () => {
    for (const language of ['json', 'yaml', 'powershell', 'sql', 'markdown', 'text']) {
      const { container, unmount } = render(<CodeEditor value="x" language={language} onChange={() => {}} ariaLabel={language} />)
      expect(container.querySelector('.cm-editor')).toBeTruthy()
      unmount()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/code-editor.test.jsx`
Expected: FAIL — module not found. Install the packages first, as listed under Files.

- [ ] **Step 3: Implement `code-editor.jsx`**

```jsx
import React from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

const LANGUAGES = {
  json: () => json(),
  yaml: () => yaml(),
  sql: () => sql(),
  markdown: () => markdown(),
  powershell: () => StreamLanguage.define(powerShell),
}
const languageFor = name => LANGUAGES[name]?.() ?? []

// NexusMD's own colours and monospace stack, so the editor reads like the rest of the app.
const THEME = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface-2)', fontSize: '12px', height: '100%' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Fira Code', Consolas, Menlo, monospace", caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-muted)', borderRight: '1px solid var(--border)' },
  '&.cm-focused': { outline: '1px solid var(--accent-border, var(--border))' },
})

export function CodeEditor({ value, language, onChange, ariaLabel }) {
  const host = React.useRef(null)
  const view = React.useRef(null)
  const lang = React.useRef(new Compartment())
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  const initial = React.useRef({ value, language, ariaLabel })

  React.useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup, THEME, lang.current.of(languageFor(initial.current.language)),
          EditorView.contentAttributes.of({ 'aria-label': initial.current.ariaLabel }),
          EditorView.updateListener.of(u => {
            // Only user edits report back; documents replaced from outside are already known.
            if (u.docChanged && !u.transactions.some(t => t.annotation(External))) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
  }, [])

  React.useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: External.of(true) })
  }, [value])

  React.useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageFor(language)) })
  }, [language])

  return <div ref={host} style={{ flex: 1, minHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
}
```

Add `import { Annotation } from '@codemirror/state'` (or extend the existing `@codemirror/state` import) and define `const External = Annotation.define()` above the component. CodeMirror shares `@codemirror/state` and `@codemirror/view` between the `codemirror` package and the language packages. If npm installs two copies of either, the editor throws "Unrecognized extension value". Check that `npm ls @codemirror/state @codemirror/view` shows a single version, and report it.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/code-editor.test.jsx`
Expected: PASS. If jsdom lacks a DOM API CodeMirror needs (for example `Range.getClientRects`), add the smallest stub in the test file only, and say which.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json package-lock.json apps/desktop/src/views/devenv/code-editor.jsx apps/desktop/src/views/devenv/code-editor.test.jsx
git commit -m "feat(desktop): CodeMirror editor for devenv profile files"
```

---

### Task 4: Profile tab — file list, editor, save, conflicts, template, Check

**Files:**
- Create: `apps/desktop/src/views/devenv/use-profile-file.js`
- Create: `apps/desktop/src/views/devenv/profile-file-editor.jsx`, `profile-file-editor.test.jsx`
- Create: `apps/desktop/src/views/devenv/profile-view.jsx`, `profile-view.test.jsx`
- Modify: `apps/desktop/src/views/devenv/view-devenv.jsx`. Put `'Profile'` in `TABS` after `'Mac'`, render `ProfileView`, and update the comment, since all spec tabs now exist.

**Interfaces:**
- Consumes:
  - the Task 1 adapter methods;
  - Task 2's `validateProfileFile`, `profileFileKind`, `detectEol`, `toLf`, `fromLf`;
  - Task 3's `CodeEditor`;
  - `useDevenvRunContext()` → `{ state, start, cancel, config }`;
  - `RunPanel`;
  - `PlModal` from `@nexusmd/ui`.
- Produces, for Task 5:
  - `useProfileFile({ adapter, config, path })` → `{ status, text, setText, saved, dirty, errors, missing, restored, conflict, error, saving, save({ overwrite }), revert }`;
  - `ProfileFileEditor({ adapter, config, path, onDirtyChange, forms })`, where `forms` maps a path to a form component `({ value, onChange })`. It is empty in this task; Task 5 passes `{ 'environment.json': EnvironmentForm, 'mac.json': MacForm }` from `ProfileView`.

- [ ] **Step 1: Write the failing tests**

`profile-file-editor.test.jsx`. It mocks `./code-editor.jsx` with a plain textarea so jsdom does not need CodeMirror:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { ProfileFileEditor } from './profile-file-editor.jsx'

vi.mock('./code-editor.jsx', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />,
}))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
function fakeAdapter(files = {}) {
  const disk = { ...files }
  return {
    disk,
    profileRead: vi.fn(async (_c, p) => (p in disk ? { ...disk[p] } : { missing: true })),
    profileWrite: vi.fn(async (_c, p, text, opts) => {
      const cur = disk[p]
      if (!opts.overwrite && cur && (opts.create || cur.mtimeMs !== opts.expectedMtimeMs)) return { ok: false, conflict: true, mtimeMs: cur.mtimeMs }
      if (!opts.overwrite && !cur && !opts.create) return { ok: false, missing: true }
      disk[p] = { text, bom: !!opts.bom, mtimeMs: (cur?.mtimeMs ?? 0) + 1 }
      return { ok: true, mtimeMs: disk[p].mtimeMs }
    }),
  }
}
const edit = (label, text) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } })

describe('ProfileFileEditor', () => {
  it('loads a file, saves edits with the mtime it read, and keeps CRLF and the BOM', async () => {
    const a = fakeAdapter({ 'commands.ps1': { text: 'a\r\nb\r\n', bom: true, mtimeMs: 10 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="commands.ps1" />)
    await waitFor(() => expect(screen.getByLabelText('Edit commands.ps1').value).toBe('a\nb\n'))
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    edit('Edit commands.ps1', 'a\nc\n')
    expect(screen.getByText('Unsaved')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(a.profileWrite).toHaveBeenCalledWith(CFG, 'commands.ps1', 'a\r\nc\r\n', { expectedMtimeMs: 10, overwrite: false, bom: true, create: false })
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  it('blocks saving invalid JSON and shows the line', async () => {
    const a = fakeAdapter({ 'docker/x.json': { text: '{}\n', bom: false, mtimeMs: 1 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="docker/x.json" />)
    await waitFor(() => expect(screen.getByLabelText('Edit docker/x.json').value).toBe('{}\n'))
    edit('Edit docker/x.json', '{\n  "a": 1,\n}')
    expect(screen.getByRole('alert').textContent).toMatch(/Line 3/)
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
  })

  it('shows a conflict when the file changed on disk, and can overwrite or reload', async () => {
    const a = fakeAdapter({ 'environment.json': { text: '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}', bom: false, mtimeMs: 1 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="environment.json" />)
    await waitFor(() => expect(screen.getByLabelText('Edit environment.json')).toBeTruthy())
    a.disk['environment.json'] = { text: '{"repositories":{"b":{"source":"s","ref":"r","project":"p","kind":"api"}}}', bom: false, mtimeMs: 5 }
    edit('Edit environment.json', '{"repositories":{"c":{"source":"s","ref":"r","project":"p","kind":"api"}}}')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(screen.getByText('This file changed on disk since you opened it.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overwrite' })) })
    expect(a.profileWrite).toHaveBeenLastCalledWith(CFG, 'environment.json', expect.stringContaining('"c"'), expect.objectContaining({ overwrite: true }))
    a.disk['environment.json'].mtimeMs = 99
    edit('Edit environment.json', '{"repositories":{"d":{"source":"s","ref":"r","project":"p","kind":"api"}}}')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload (discard my changes)' })) })
    await waitFor(() => expect(screen.getByLabelText('Edit environment.json').value).toContain('"c"'))
  })

  it('creates a missing file on save', async () => {
    const a = fakeAdapter()
    render(<ProfileFileEditor adapter={a} config={CFG} path="mac.json" />)
    await screen.findByText("mac.json doesn't exist yet - fill it in and Save to create it.")
    edit('Edit mac.json', '{"host":"mac.local","user":"me"}\n')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(a.profileWrite).toHaveBeenCalledWith(CFG, 'mac.json', '{"host":"mac.local","user":"me"}\n', expect.objectContaining({ create: true }))
  })

  it('keeps unsaved edits when the editor is remounted, until reverted', async () => {
    const a = fakeAdapter({ 'sql/a.sql': { text: 'select 1\n', bom: false, mtimeMs: 1 } })
    const first = render(<ProfileFileEditor adapter={a} config={CFG} path="sql/a.sql" />)
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 1\n'))
    edit('Edit sql/a.sql', 'select 2\n')
    first.unmount()
    render(<ProfileFileEditor adapter={a} config={CFG} path="sql/a.sql" />)
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 2\n'))
    expect(screen.getByText('Unsaved changes from earlier were restored.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Revert' })) })
    await waitFor(() => expect(screen.getByLabelText('Edit sql/a.sql').value).toBe('select 1\n'))
  })

  it('reports read errors', async () => {
    const a = { profileRead: vi.fn(async () => { throw new Error('big.txt is too large to edit here (2048 KB).') }), profileWrite: vi.fn() }
    render(<ProfileFileEditor adapter={a} config={CFG} path="big.txt" />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too large/))
  })
})
```

`profile-view.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { createRunState } from '@nexusmd/core'
import { ProfileView } from './profile-view.jsx'

vi.mock('./devenv-run-context.jsx', () => ({ useDevenvRunContext: () => globalThis.__run }))
vi.mock('./code-editor.jsx', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }) => <textarea aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} />,
}))
afterEach(cleanup)

const CFG = { root: 'C:\\repos\\dev-environment', pwsh: 'pwsh', profile: '' }
const DIR = 'C:\\repos\\dev-environment\\profile'
const ENV = '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}\n'

function setup({ exists = true, over = {} } = {}) {
  globalThis.__run = { state: { ...createRunState(), ...over }, start: vi.fn(), cancel: vi.fn(), config: CFG }
  const disk = { 'environment.json': { text: ENV, bom: false, mtimeMs: 1 }, 'sql/a.sql': { text: 'select 1\n', bom: false, mtimeMs: 1 } }
  const state = { exists }
  const adapter = {
    profileInfo: vi.fn(async () => ({ dir: DIR, isDefault: true, exists: state.exists, example: true })),
    profileList: vi.fn(async () => ({ dir: DIR, truncated: false, files: Object.keys(disk).map(p => ({ path: p, size: 1, mtimeMs: 1 })) })),
    profileRead: vi.fn(async (_c, p) => (p in disk ? { ...disk[p] } : { missing: true })),
    profileWrite: vi.fn(async () => ({ ok: true, mtimeMs: 2 })),
    profileCreate: vi.fn(async () => { state.exists = true; return { ok: true, dir: DIR } }),
  }
  render(<ProfileView adapter={adapter} />)
  return { run: globalThis.__run, adapter }
}

describe('ProfileView', () => {
  it('offers to create a missing profile from the template', async () => {
    const { adapter } = setup({ exists: false })
    await screen.findByText(`No profile at ${DIR} yet.`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create from template' })) })
    expect(adapter.profileCreate).toHaveBeenCalledWith(CFG)
    await screen.findByRole('button', { name: 'sql/a.sql' })
  })

  it('lists the files, opens environment.json first, and always offers mac.json', async () => {
    setup()
    await screen.findByLabelText('Edit environment.json')
    expect(screen.getByRole('button', { name: 'sql/a.sql' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'mac.json (not created yet)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    await screen.findByLabelText('Edit sql/a.sql')
  })

  it('asks before leaving a file with unsaved changes', async () => {
    setup()
    await screen.findByLabelText('Edit environment.json')
    fireEvent.change(screen.getByLabelText('Edit environment.json'), { target: { value: '{}' } })
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    expect(await screen.findByText('environment.json has unsaved changes.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Edit environment.json').value).toBe('{}')
    fireEvent.click(screen.getByRole('button', { name: 'sql/a.sql' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await screen.findByLabelText('Edit sql/a.sql')
  })

  it('runs devenv doctor as Check, alongside other runs', async () => {
    const { run } = setup()
    await screen.findByLabelText('Edit environment.json')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(run.start).toHaveBeenCalledWith(['doctor'], { exclusive: false, label: 'devenv doctor' })
  })

  it('shows profile errors', async () => {
    globalThis.__run = { state: createRunState(), start: vi.fn(), cancel: vi.fn(), config: CFG }
    render(<ProfileView adapter={{ profileInfo: vi.fn(async () => { throw new Error('Set the devenv folder in Settings') }) }} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Set the devenv folder/))
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/profile-file-editor.test.jsx src/views/devenv/profile-view.test.jsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `use-profile-file.js`**

```js
import React from 'react'
import { validateProfileFile, detectEol, toLf, fromLf } from '@nexusmd/core'

// Unsaved edits survive switching files or tabs for this window's lifetime.
const drafts = new Map()
const EMPTY = { status: 'loading', text: '', saved: '', eol: '\n', bom: false, mtimeMs: null, missing: false, error: null, conflict: null, saving: false, restored: false }

export function useProfileFile({ adapter, config, path }) {
  const key = `${config.root}|${config.profile}|${path}`
  const [s, setS] = React.useState(EMPTY)
  const live = React.useRef(key)
  live.current = key

  const load = React.useCallback(async ({ discardDraft = false } = {}) => {
    if (discardDraft) drafts.delete(key)
    const d = drafts.get(key)
    if (d) { setS({ ...EMPTY, ...d, status: 'ready', restored: true }); return }
    setS(p => ({ ...p, status: 'loading', error: null, conflict: null }))
    try {
      const r = await adapter.profileRead(config, path)
      if (live.current !== key) return
      if (r.missing) { setS({ ...EMPTY, status: 'ready', missing: true }); return }
      const text = toLf(r.text)
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: detectEol(r.text), bom: !!r.bom, mtimeMs: r.mtimeMs })
    } catch (e) {
      if (live.current === key) setS({ ...EMPTY, status: 'error', error: e?.message || 'Could not read the file.' })
    }
  }, [adapter, config, path, key])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => setS(p => {
    if (text !== p.saved) drafts.set(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, mtimeMs: p.mtimeMs, missing: p.missing })
    else drafts.delete(key)
    return { ...p, text }
  }), [key])

  const errors = React.useMemo(() => (s.status === 'ready' ? validateProfileFile(path, s.text) : []), [path, s.text, s.status])
  const dirty = s.status === 'ready' && s.text !== s.saved

  const save = React.useCallback(async ({ overwrite = false } = {}) => {
    if (errors.length) return false
    setS(p => ({ ...p, saving: true, error: null }))
    try {
      const r = await adapter.profileWrite(config, path, fromLf(s.text, s.eol), { expectedMtimeMs: s.mtimeMs, overwrite, bom: s.bom, create: s.missing })
      if (r.conflict) { setS(p => ({ ...p, saving: false, conflict: { mtimeMs: r.mtimeMs } })); return false }
      if (r.missing) { setS(p => ({ ...p, saving: false, missing: true, mtimeMs: null, error: `${path} no longer exists on disk - Save again to create it.` })); return false }
      drafts.delete(key)
      setS(p => ({ ...p, saving: false, saved: p.text, mtimeMs: r.mtimeMs, conflict: null, missing: false, restored: false }))
      return true
    } catch (e) {
      setS(p => ({ ...p, saving: false, error: e?.message || 'Save failed.' }))
      return false
    }
  }, [adapter, config, path, key, s.text, s.eol, s.bom, s.mtimeMs, s.missing, errors])

  const revert = React.useCallback(() => load({ discardDraft: true }), [load])
  return { ...s, setText, errors, dirty, save, revert }
}
```

- [ ] **Step 4: Implement `profile-file-editor.jsx`**

```jsx
import React from 'react'
import { profileFileKind, formatJson } from '@nexusmd/core'
import { CodeEditor } from './code-editor.jsx'
import { useProfileFile } from './use-profile-file.js'

const alertStyle = { padding: 10, color: 'var(--danger)' }

export function ProfileFileEditor({ adapter, config, path, onDirtyChange, forms = {} }) {
  const f = useProfileFile({ adapter, config, path })
  const Form = forms[path]
  const [mode, setMode] = React.useState(Form ? 'form' : 'text')
  React.useEffect(() => { onDirtyChange?.(f.dirty) }, [f.dirty, onDirtyChange])

  let parsed = null
  let parseError = null
  if (Form && mode === 'form' && f.status === 'ready') {
    try { parsed = f.text.trim() ? JSON.parse(f.text) : {} } catch (e) { parseError = e.message }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{path}</strong>
        {f.dirty && <span className="chip">Unsaved</span>}
        {Form && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button className={`btn sm ${mode === 'form' ? '' : 'ghost'}`} aria-pressed={mode === 'form'} onClick={() => setMode('form')}>Form</button>
            <button className={`btn sm ${mode === 'text' ? '' : 'ghost'}`} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Text</button>
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" disabled={!f.dirty || f.saving} onClick={f.revert}>Revert</button>
          <button className="btn sm primary" disabled={!f.dirty || f.saving || f.errors.length > 0} onClick={() => f.save()}>Save</button>
        </span>
      </div>
      {f.restored && <span style={{ color: 'var(--text-muted)' }}>Unsaved changes from earlier were restored.</span>}
      {f.missing && <span style={{ color: 'var(--text-muted)' }}>{`${path} doesn't exist yet - fill it in and Save to create it.`}</span>}
      {f.error && <div className="card" role="alert" style={alertStyle}>{f.error}</div>}
      {f.conflict && (
        <div className="card" role="alert" style={{ ...alertStyle, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>This file changed on disk since you opened it.</span>
          <button className="btn sm" onClick={f.revert}>Reload (discard my changes)</button>
          <button className="btn sm danger" onClick={() => f.save({ overwrite: true })}>Overwrite</button>
        </div>
      )}
      {f.errors.length > 0 && (
        <div className="card" role="alert" style={alertStyle}>
          <strong>Fix before saving</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {f.errors.map((e, i) => <li key={i}>{e.line ? `Line ${e.line}: ${e.message}` : e.message}</li>)}
          </ul>
        </div>
      )}
      {f.status === 'loading' && <span style={{ color: 'var(--text-muted)' }}>Loading…</span>}
      {f.status === 'ready' && Form && mode === 'form' && (parseError
        ? <span style={{ color: 'var(--text-muted)' }}>Fix the JSON in the Text view first.</span>
        : <Form value={parsed} onChange={obj => f.setText(formatJson(obj))} />)}
      {f.status === 'ready' && (!Form || mode === 'text') && (
        <CodeEditor value={f.text} language={profileFileKind(path)} onChange={f.setText} ariaLabel={`Edit ${path}`} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Implement `profile-view.jsx`**

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { useDevenvRunContext } from './devenv-run-context.jsx'
import { ProfileFileEditor } from './profile-file-editor.jsx'
import { RunPanel } from './run-panel.jsx'

const FORMS = {}

export function ProfileView({ adapter }) {
  const run = useDevenvRunContext()
  const config = run.config
  const [info, setInfo] = React.useState(null)
  const [files, setFiles] = React.useState([])
  const [error, setError] = React.useState(null)
  const [selected, setSelected] = React.useState('environment.json')
  const [dirty, setDirty] = React.useState(false)
  const [pending, setPending] = React.useState(null)

  const refresh = React.useCallback(async () => {
    setError(null)
    try {
      const i = await adapter.profileInfo(config)
      setInfo(i)
      setFiles(i.exists ? (await adapter.profileList(config)).files.map(x => x.path) : [])
    } catch (e) { setError(e?.message || 'Could not read the profile.') }
  }, [adapter, config])
  React.useEffect(() => { refresh() }, [refresh])

  const create = async () => {
    setError(null)
    try { await adapter.profileCreate(config); await refresh() } catch (e) { setError(e?.message || 'Could not create the profile.') }
  }
  const choose = p => { if (p === selected) return; if (dirty) setPending(p); else setSelected(p) }
  const paths = info?.exists ? [...new Set([...files, 'mac.json'])].sort((a, b) => a.localeCompare(b)) : []
  const label = p => (p === 'mac.json' && !files.includes('mac.json') ? 'mac.json (not created yet)' : p)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{info ? `${info.dir}${info.isDefault ? " (devenv's profile folder)" : ' (from Settings)'}` : '…'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={refresh}>Refresh</button>
          <button className="btn sm" disabled={!info?.exists} onClick={() => run.start(['doctor'], { exclusive: false, label: 'devenv doctor' })}>Check</button>
        </span>
      </div>
      {error && <div className="card" role="alert" style={{ padding: 10, color: 'var(--danger)' }}>{error}</div>}
      {info && !info.exists && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>{`No profile at ${info.dir} yet.`}</span>
          {info.example
            ? <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={create}>Create from template</button>
            : <span style={{ color: 'var(--text-muted)' }}>There is no profile.example in the devenv folder to start from.</span>}
        </div>
      )}
      {info?.exists && (
        <div style={{ display: 'flex', gap: 12, minHeight: 0, flex: 1 }}>
          <nav aria-label="Profile files" style={{ width: 260, flex: 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {paths.map(p => (
              <button key={p} className={`btn sm ${p === selected ? '' : 'ghost'}`} aria-current={p === selected ? 'true' : undefined}
                aria-label={label(p)} style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choose(p)}>{label(p)}</button>
            ))}
          </nav>
          <ProfileFileEditor key={selected} adapter={adapter} config={config} path={selected} onDirtyChange={setDirty} forms={FORMS} />
        </div>
      )}
      <PlModal open={!!pending} onClose={() => setPending(null)} title="Unsaved changes"
        footer={<>
          <button className="btn sm ghost" onClick={() => setPending(null)}>Keep editing</button>
          <button className="btn sm danger" onClick={() => { setDirty(false); setSelected(pending); setPending(null) }}>Discard changes</button>
        </>}>
        <p>{`${selected} has unsaved changes.`}</p>
        <p style={{ color: 'var(--text-muted)' }}>Discarding keeps nothing - the file stays as it is on disk.</p>
      </PlModal>
      {run.state.command === 'devenv doctor' && run.state.status !== 'idle' && <RunPanel state={run.state} onCancel={run.cancel} />}
    </div>
  )
}
```

**Discard changes** must really discard the draft. Otherwise returning to that file would restore it. Clear the draft before switching:
- export `discardProfileDraft(config, path)` from `use-profile-file.js`, which deletes the matching key from `drafts`;
- in the Discard handler, call `discardProfileDraft(config, selected)` before `setSelected(pending)`.

Add a test to `profile-view.test.jsx`: after Discard, re-selecting `environment.json` shows the on-disk text, not the edit.

Check `PlModal`'s props in `packages/ui/src/planner-chips.jsx` (`open, onClose, title, footer, children`) and adapt if they differ.

In `view-devenv.jsx`:
- import `ProfileView`;
- set `TABS` to `['Status', 'Start', 'Builds', 'Logs', 'Tests', 'Database', 'Emulator', 'Mac', 'Profile', 'Commands']`;
- add `{tab === 'Profile' && <ProfileView adapter={adapter} />}`;
- change the comment to say the tabs cover every screen in the spec.

- [ ] **Step 6: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`, then the whole desktop suite once with `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`.
Expected: PASS. Name any failure. The known flaky `src/jira-create-form.test.jsx` may fail; leave it alone.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/devenv
git commit -m "feat(desktop): devenv Profile tab - file list, editor, validated atomic save, conflicts, template, Check"
```

---

### Task 5: Structured forms for `environment.json` and `mac.json`, and spec amendments

**Files:**
- Create: `apps/desktop/src/views/devenv/environment-form.jsx`, `environment-form.test.jsx`
- Create: `apps/desktop/src/views/devenv/mac-form.jsx`, `mac-form.test.jsx`
- Modify: `apps/desktop/src/views/devenv/profile-view.jsx`. Set `FORMS = { 'environment.json': EnvironmentForm, 'mac.json': MacForm }`.
- Modify: `apps/desktop/src/views/devenv/profile-file-editor.test.jsx`. Add a Form/Text test.
- Modify: `apps/desktop/src/views/devenv/profile-view.test.jsx`. With the forms wired in, `environment.json` opens in Form view, so the Task 4 tests that wait for or type into `Edit environment.json` must first click the **Text** button. Assert the form is the default for `environment.json`: the `orders name`-style inputs from `EnvironmentForm` show, using the test's `ENV` repository key `a`, so `a name`.
- Modify: `docs/superpowers/specs/2026-10-08-devenv-module-design.md` (Phase 6 amendments)

**Interfaces:**
- Consumes: core `setIn`, `addRepository`, `renameRepository`, `removeRepository`, `REPOSITORY_KEY`; `ProfileFileEditor`'s `forms` prop, which hands a form `{ value: object, onChange(object) }`.
- Produces: `EnvironmentForm({ value, onChange })` and `MacForm({ value, onChange })`.

Field `aria-label`s, which the tests rely on:

| Section | `aria-label`s |
|---|---|
| General | `Name` |
| Each repository `<key>` | `<key> name`, `<key> label`, `<key> kind`, `<key> source`, `<key> ref`, `<key> project`, `<key> port`, `<key> dll`, `<key> runs in Docker`, `<key> built by devenv start`, `<key> migration guard`, `<key> runs in the test stack`, `<key> test port`, `<key> test database` |
| Repositories, shared | the button `Remove <key>`, the input `New repository name` and the button `Add repository` |
| Database | `Database name`, `Databases` (comma-separated), `Source container` |
| Mobile | `Mobile package id` (shown when a mobile repository exists or `mobile` is present) |
| Test | `Test collection`, `Collection environment`, `<key> default test API` (one checkbox per repository with a `test` block) |
| Test wiring, per row `<n>` (1-based) | `Wiring <n> from`, `Wiring <n> to`, `Wiring <n> setting`, `Wiring <n> local`, `Wiring <n> always`, the button `Remove wiring <n>` |
| Test wiring, shared | the button `Add wiring` |
| Mac | `Mac host`, `Mac user`, `SSH key file` |

Value rules:
- Required text fields keep `''`, so validation flags them.
- Optional fields (`label`, `dll`, `port`, `name`, Mac `sshKey`) delete their key when cleared.
- `port` and `test port` become a number when the input is all digits. Otherwise they keep the raw text, which validation flags.
- An unticked checkbox deletes its key, and ticked writes `true`.
- **Runs in the test stack** ticked sets `test` to `{ db: '' }`. Unticked deletes `test`.
- `Databases` splits on commas and trims, and an empty input deletes the key.
- A repository's **name** input commits on blur or Enter through `renameRepository`. A name that is invalid (`REPOSITORY_KEY`) or already taken shows `"<name>" can't be used - lower-case letters, digits and -, not already taken.` and does not rename.
- **Add repository** uses the same rule.

- [ ] **Step 1: Write the failing tests**

`environment-form.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EnvironmentForm } from './environment-form.jsx'

afterEach(cleanup)
const ENV = {
  name: 'example',
  repositories: {
    orders: { source: '../orders/main', ref: 'main', project: 'src/O.csproj', label: 'Orders', kind: 'api', port: 5101, docker: true, test: { port: 5201, db: 'Orders_Local' } },
    mobile: { source: '../app/main', ref: 'main', project: 'src/A.csproj', kind: 'mobile' },
  },
  database: { name: 'Orders_Local', databases: ['Orders_Local'], sourceContainer: 'sql-dev' },
  mobile: { packageId: 'com.example.app' },
  test: { defaultServices: ['orders'], collection: 'api-tests', wiring: [{ from: 'orders', to: 'orders', key: 'Self__Url' }], extraDbConn: { x: {} } },
  custom: { keep: true },
}
function setup(value = ENV) {
  const onChange = vi.fn()
  render(<EnvironmentForm value={value} onChange={onChange} />)
  return onChange
}
const last = fn => fn.mock.calls.at(-1)[0]

describe('EnvironmentForm', () => {
  it('edits repository fields, keeping keys it does not show', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('orders source'), { target: { value: '../orders/feature' } })
    expect(last(onChange).repositories.orders.source).toBe('../orders/feature')
    expect(last(onChange).custom).toEqual({ keep: true })
    expect(last(onChange).test.extraDbConn).toEqual({ x: {} })
  })
  it('turns ports into numbers and removes cleared optional fields', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('orders port'), { target: { value: '6000' } })
    expect(last(onChange).repositories.orders.port).toBe(6000)
    fireEvent.change(screen.getByLabelText('orders label'), { target: { value: '' } })
    expect('label' in last(onChange).repositories.orders).toBe(false)
  })
  it('ticks and unticks booleans and the test stack block', () => {
    const onChange = setup()
    fireEvent.click(screen.getByLabelText('orders runs in Docker'))
    expect('docker' in last(onChange).repositories.orders).toBe(false)
    fireEvent.click(screen.getByLabelText('mobile built by devenv start'))
    expect(last(onChange).repositories.mobile.start).toBe(true)
    fireEvent.click(screen.getByLabelText('orders runs in the test stack'))
    expect('test' in last(onChange).repositories.orders).toBe(false)
  })
  it('renames a repository on blur, with references, and refuses a taken name', () => {
    const onChange = setup()
    const name = screen.getByLabelText('orders name')
    fireEvent.change(name, { target: { value: 'mobile' } }); fireEvent.blur(name)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('"mobile" can\'t be used - lower-case letters, digits and -, not already taken.')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'ordering' } }); fireEvent.blur(name)
    expect(Object.keys(last(onChange).repositories)).toEqual(['ordering', 'mobile'])
    expect(last(onChange).test.defaultServices).toEqual(['ordering'])
  })
  it('adds and removes repositories', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('New repository name'), { target: { value: 'billing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(last(onChange).repositories.billing).toEqual({ source: '', ref: 'main', project: '', kind: 'api' })
    fireEvent.click(screen.getByRole('button', { name: 'Remove orders' }))
    expect(Object.keys(last(onChange).repositories)).toEqual(['mobile'])
  })
  it('edits database, mobile and test settings and the wiring list', () => {
    const onChange = setup()
    fireEvent.change(screen.getByLabelText('Databases'), { target: { value: 'A, B' } })
    expect(last(onChange).database.databases).toEqual(['A', 'B'])
    fireEvent.change(screen.getByLabelText('Mobile package id'), { target: { value: 'com.x' } })
    expect(last(onChange).mobile.packageId).toBe('com.x')
    fireEvent.click(screen.getByLabelText('orders default test API'))
    expect(last(onChange).test.defaultServices).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Add wiring' }))
    expect(last(onChange).test.wiring).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Wiring 1 setting'), { target: { value: 'Other__Url' } })
    expect(last(onChange).test.wiring[0].key).toBe('Other__Url')
    fireEvent.click(screen.getByRole('button', { name: 'Remove wiring 1' }))
    expect(last(onChange).test.wiring).toEqual([])
  })
  it('works for an empty file', () => {
    const onChange = setup({})
    fireEvent.change(screen.getByLabelText('New repository name'), { target: { value: 'api' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(last(onChange)).toEqual({ repositories: { api: { source: '', ref: 'main', project: '', kind: 'api' } } })
  })
})
```

`mac-form.test.jsx`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MacForm } from './mac-form.jsx'

afterEach(cleanup)

describe('MacForm', () => {
  it('edits host, user and the key path, removing a cleared key path', () => {
    const onChange = vi.fn()
    render(<MacForm value={{ host: 'mac.local', user: 'me', sshKey: 'C:\\k', other: 1 }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Mac host'), { target: { value: '10.0.0.5' } })
    expect(onChange).toHaveBeenLastCalledWith({ host: '10.0.0.5', user: 'me', sshKey: 'C:\\k', other: 1 })
    fireEvent.change(screen.getByLabelText('SSH key file'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ host: 'mac.local', user: 'me', other: 1 })
  })
  it('starts from nothing', () => {
    const onChange = vi.fn()
    render(<MacForm value={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Mac user'), { target: { value: 'me' } })
    expect(onChange).toHaveBeenLastCalledWith({ user: 'me' })
  })
})
```

Add to `profile-file-editor.test.jsx`:

```js
  it('edits environment.json in a form, and falls back to text when the JSON is broken', async () => {
    const Form = ({ value, onChange }) => <button onClick={() => onChange({ ...value, name: 'x' })}>{`form:${Object.keys(value.repositories || {}).join(',')}`}</button>
    const a = fakeAdapter({ 'environment.json': { text: '{"repositories":{"a":{"source":"s","ref":"r","project":"p","kind":"api"}}}', bom: false, mtimeMs: 1 } })
    render(<ProfileFileEditor adapter={a} config={CFG} path="environment.json" forms={{ 'environment.json': Form }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'form:a' }))
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    expect(screen.getByLabelText('Edit environment.json').value).toBe('{\n  "repositories": {\n    "a": {\n      "source": "s",\n      "ref": "r",\n      "project": "p",\n      "kind": "api"\n    }\n  },\n  "name": "x"\n}\n')
    edit('Edit environment.json', '{ broken')
    fireEvent.click(screen.getByRole('button', { name: 'Form' }))
    expect(screen.getByText('Fix the JSON in the Text view first.')).toBeTruthy()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv/environment-form.test.jsx src/views/devenv/mac-form.test.jsx src/views/devenv/profile-file-editor.test.jsx`
Expected: FAIL. The two form modules are missing. The new editor test should already pass, because `ProfileFileEditor` supports `forms` since Task 4. If it fails, fix the editor.

- [ ] **Step 3: Implement `mac-form.jsx`**

```jsx
import React from 'react'
import { setIn } from '@nexusmd/core'

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }

function Field({ label, aria, value, onChange, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <input aria-label={aria} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)} />
      {hint && <span>{hint}</span>}
    </label>
  )
}

export function MacForm({ value, onChange }) {
  const set = (k, v, optional) => onChange(setIn(value, [k], optional && v === '' ? undefined : v))
  return (
    <div className="card" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
      <Field label="Host" aria="Mac host" value={value.host} onChange={v => set('host', v)} hint="The Mac's IP address or host name." />
      <Field label="User" aria="Mac user" value={value.user} onChange={v => set('user', v)} hint="Your login name on the Mac." />
      <Field label="SSH key" aria="SSH key file" value={value.sshKey} onChange={v => set('sshKey', v, true)} hint="Set by Set up SSH key in the Mac tab." />
    </div>
  )
}
```

- [ ] **Step 4: Implement `environment-form.jsx`**

```jsx
import React from 'react'
import { setIn, addRepository, renameRepository, removeRepository, REPOSITORY_KEY } from '@nexusmd/core'

const inputStyle = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 13 }
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)' }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }
const asPort = v => (v === '' ? undefined : /^\d+$/.test(v) ? Number(v) : v)
const badName = (name, keys) => `"${name}" can't be used - lower-case letters, digits and -, not already taken.`

function Field({ label, aria, value, onChange }) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <input aria-label={aria} style={inputStyle} value={value ?? ''} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function Check({ label, aria, checked, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" aria-label={aria} checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  )
}

function RepositoryName({ name, taken, onRename }) {
  const [draft, setDraft] = React.useState(name)
  const [problem, setProblem] = React.useState(null)
  React.useEffect(() => { setDraft(name); setProblem(null) }, [name])
  const commit = () => {
    if (draft === name) return
    if (!REPOSITORY_KEY.test(draft) || taken.includes(draft)) { setProblem(badName(draft)); return }
    setProblem(null)
    onRename(draft)
  }
  return (
    <label style={labelStyle}>
      <span>Name</span>
      <input aria-label={`${name} name`} style={inputStyle} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      {problem && <span style={{ color: 'var(--danger)' }}>{problem}</span>}
    </label>
  )
}

export function EnvironmentForm({ value, onChange }) {
  const env = value || {}
  const repos = env.repositories && typeof env.repositories === 'object' ? env.repositories : {}
  const keys = Object.keys(repos)
  const set = (path, v) => onChange(setIn(env, path, v))
  const optional = (path, v) => set(path, v === '' ? undefined : v)
  const tick = (path, on) => set(path, on ? true : undefined)
  const [newName, setNewName] = React.useState('')
  const [newProblem, setNewProblem] = React.useState(null)
  const testKeys = keys.filter(k => repos[k]?.test && typeof repos[k].test === 'object')
  const defaults = Array.isArray(env.test?.defaultServices) ? env.test.defaultServices : []
  const wiring = Array.isArray(env.test?.wiring) ? env.test.wiring : []
  const showMobile = keys.some(k => repos[k]?.kind === 'mobile') || env.mobile !== undefined

  const add = () => {
    if (!REPOSITORY_KEY.test(newName) || keys.includes(newName)) { setNewProblem(badName(newName)); return }
    setNewProblem(null); setNewName('')
    onChange(addRepository(env, newName))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', minHeight: 0 }}>
      <Section title="General">
        <div style={grid}><Field label="Name" aria="Name" value={env.name} onChange={v => optional(['name'], v)} /></div>
      </Section>

      <Section title="Repositories">
        {keys.map(k => {
          const r = repos[k] || {}
          const at = f => ['repositories', k, f]
          return (
            <div key={k} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={grid}>
                <RepositoryName name={k} taken={keys.filter(x => x !== k)} onRename={to => onChange(renameRepository(env, k, to))} />
                <Field label="Label" aria={`${k} label`} value={r.label} onChange={v => optional(at('label'), v)} />
                <label style={labelStyle}>
                  <span>Kind</span>
                  <select aria-label={`${k} kind`} style={inputStyle} value={r.kind ?? ''} onChange={e => set(at('kind'), e.target.value)}>
                    {!r.kind && <option value="">(choose)</option>}
                    <option value="api">api</option><option value="mobile">mobile</option><option value="web">web</option>
                  </select>
                </label>
                <Field label="Source (worktree, relative to devenv)" aria={`${k} source`} value={r.source} onChange={v => set(at('source'), v)} />
                <Field label="Ref" aria={`${k} ref`} value={r.ref} onChange={v => set(at('ref'), v)} />
                <Field label="Project (.csproj in the source)" aria={`${k} project`} value={r.project} onChange={v => set(at('project'), v)} />
                <Field label="Port" aria={`${k} port`} value={r.port === undefined ? '' : String(r.port)} onChange={v => set(at('port'), asPort(v))} />
                <Field label="DLL" aria={`${k} dll`} value={r.dll} onChange={v => optional(at('dll'), v)} />
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <Check label="Runs in Docker" aria={`${k} runs in Docker`} checked={r.docker} onChange={on => tick(at('docker'), on)} />
                <Check label="Built by devenv start" aria={`${k} built by devenv start`} checked={r.start} onChange={on => tick(at('start'), on)} />
                <Check label="Migration guard" aria={`${k} migration guard`} checked={r.migrationGuard} onChange={on => tick(at('migrationGuard'), on)} />
                <Check label="Runs in the test stack" aria={`${k} runs in the test stack`} checked={r.test !== undefined}
                  onChange={on => set(at('test'), on ? { db: '' } : undefined)} />
                <button className="btn sm ghost danger" style={{ marginLeft: 'auto' }} aria-label={`Remove ${k}`} onClick={() => onChange(removeRepository(env, k))}>Remove</button>
              </div>
              {r.test !== undefined && (
                <div style={grid}>
                  <Field label="Test port" aria={`${k} test port`} value={r.test?.port === undefined ? '' : String(r.test.port)} onChange={v => set(['repositories', k, 'test', 'port'], asPort(v))} />
                  <Field label="Test database" aria={`${k} test database`} value={r.test?.db} onChange={v => set(['repositories', k, 'test', 'db'], v)} />
                </div>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="New repository" aria="New repository name" value={newName} onChange={setNewName} />
          <button className="btn sm" onClick={add}>Add repository</button>
          {newProblem && <span style={{ color: 'var(--danger)' }}>{newProblem}</span>}
        </div>
      </Section>

      <Section title="Database">
        <div style={grid}>
          <Field label="Default database" aria="Database name" value={env.database?.name} onChange={v => optional(['database', 'name'], v)} />
          <Field label="Databases (comma-separated)" aria="Databases" value={(env.database?.databases || []).join(', ')}
            onChange={v => set(['database', 'databases'], v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined)} />
          <Field label="Source container (for backups)" aria="Source container" value={env.database?.sourceContainer} onChange={v => optional(['database', 'sourceContainer'], v)} />
        </div>
      </Section>

      {showMobile && (
        <Section title="Mobile">
          <div style={grid}><Field label="Package id" aria="Mobile package id" value={env.mobile?.packageId} onChange={v => set(['mobile', 'packageId'], v)} /></div>
        </Section>
      )}

      <Section title="API test stack">
        <div style={grid}>
          <Field label="Collection folder" aria="Test collection" value={env.test?.collection} onChange={v => optional(['test', 'collection'], v)} />
          <Field label="Collection environment" aria="Collection environment" value={env.test?.collectionEnv} onChange={v => optional(['test', 'collectionEnv'], v)} />
        </div>
        {testKeys.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)' }}>Started by default:</span>
            {testKeys.map(k => (
              <Check key={k} label={k} aria={`${k} default test API`} checked={defaults.includes(k)}
                onChange={on => set(['test', 'defaultServices'], on ? [...defaults, k] : defaults.filter(x => x !== k))} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Wiring (which setting in one API points at another)</span>
          {wiring.map((w, i) => {
            const n = i + 1
            const at = f => ['test', 'wiring', i, f]
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select aria-label={`Wiring ${n} from`} style={inputStyle} value={w?.from ?? ''} onChange={e => set(at('from'), e.target.value)}>
                  <option value="">(from)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <select aria-label={`Wiring ${n} to`} style={inputStyle} value={w?.to ?? ''} onChange={e => set(at('to'), e.target.value)}>
                  <option value="">(to)</option>{keys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label={`Wiring ${n} setting`} placeholder="Setting" style={inputStyle} value={w?.key ?? ''} onChange={e => set(at('key'), e.target.value)} />
                <input aria-label={`Wiring ${n} local`} placeholder="Local value (optional)" style={inputStyle} value={w?.local ?? ''} onChange={e => set(at('local'), e.target.value === '' ? undefined : e.target.value)} />
                <Check label="Always" aria={`Wiring ${n} always`} checked={w?.always} onChange={on => set(at('always'), on ? true : undefined)} />
                <button className="btn sm ghost" aria-label={`Remove wiring ${n}`} onClick={() => set(['test', 'wiring'], wiring.filter((_, j) => j !== i))}>×</button>
              </div>
            )
          })}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set(['test', 'wiring'], [...wiring, { from: '', to: '', key: '' }])}>Add wiring</button>
        </div>
        <span style={{ color: 'var(--text-muted)' }}>extraDbConn and collectionPatterns are kept as they are - edit them in the Text view.</span>
      </Section>
    </div>
  )
}
```

In `profile-view.jsx`, import both forms and set `const FORMS = { 'environment.json': EnvironmentForm, 'mac.json': MacForm }`.

- [ ] **Step 5: Spec amendments**

Append to `docs/superpowers/specs/2026-10-08-devenv-module-design.md`:

```markdown
## Amendments made during Phase 6 planning

- Profile files go through a dedicated Electron module (`devenv:profile-info|list|read|write|create`), not the app's general `file:*` channels: every path is relative to the profile folder (`config.profile` or `<root>\profile`) and must stay inside it by real path, so `..`, absolute paths and junctions leading out are refused; `.git`, `node_modules`, `bin`, `obj`, `.vs`, `.idea` and symlinks are not listed.
- Saves are atomic (temp file + rename) and carry the file's `mtimeMs` from when it was read; a different `mtimeMs` on disk (for example `devenv start` rewriting `source`/`ref`) is a conflict offering Reload or Overwrite. A UTF-8 BOM and CRLF line endings are preserved. Files over 1 MB or with NUL bytes aren't opened.
- Validation before save: JSON and YAML (`yaml` package) must parse; `environment.json` and `mac.json` are checked against the rules devenv relies on (repository keys, required source/ref/project, kind api/mobile/web, the `mobile` key and `mobile.packageId`, ports, test blocks, wiring references, container name; Mac host/user). devenv itself has no schema validation, so these rules live in core (`profile.js`).
- The forms edit the parsed object (unknown keys kept) and save it as 2-space JSON; `extraDbConn` and `collectionPatterns` are edited in the Text view. Unsaved edits survive file and tab switches for the window's lifetime; switching files with unsaved edits asks first.
- Other files open in CodeMirror 6 (JSON, YAML, PowerShell, SQL, Markdown highlighting). Check runs `devenv doctor` (non-exclusive).
- Status, Start, Builds, Logs, Tests, Database, Emulator, Mac, Profile and Commands are the Dev Environment tabs - every screen in this spec.
```

- [ ] **Step 6: Run the tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop exec vitest run src/views/devenv`, then the whole desktop suite once.
Expected: PASS. Name any failure; the known jira flake may appear and should be left alone.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/views/devenv docs/superpowers/specs/2026-10-08-devenv-module-design.md
git commit -m "feat(desktop): environment.json and mac.json forms in the devenv Profile tab"
```

---

### Task 6: End-to-end check

- [ ] **Step 1: Full suites, in the worktree**

Run `npm -w packages/core test` and `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`. All pass, apart from the known jira flake.

Also run `npm -w apps/desktop run build`, or whatever builds the renderer (check `apps/desktop/package.json` scripts). That confirms CodeMirror and `yaml` bundle with Vite. Report any size warning.

- [ ] **Step 2: Headless end-to-end check (throwaway script in the session scratchpad, nothing committed)**

Drive `apps/desktop/electron/ipc/devenv-profile.cjs` from Node with a fake `ipcMain`.

1. **Read-only, against the real profile** (config `{ root: 'C:\\repos\\dev-environment', profile: '' }`):
   - `profile-info`: expect `exists: true`.
   - `profile-list`: print the file count and that no `.git` paths appear.
   - `profile-read` on `environment.json` and `mac.json`. Run the core `validateProfileFile` on both and print the error count. Today's profile should validate. If it doesn't, print the messages: that is a finding, either about the rules or about the profile.
2. **Writes, against a copy:**
   - Copy `C:\repos\dev-environment\profile` to a scratchpad folder.
   - Point `profile` at it and write `environment.json` back unchanged with the mtime just read. Confirm the bytes are identical with a hash before and after.
   - Write a CRLF+BOM `commands.ps1` back unchanged through `toLf`/`fromLf`, and confirm the same.
   - Delete the copy.

Never write into the real profile.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment → Profile | Profile folder shown; files listed; environment.json opens in the form |
| 2 | Change a repository's label, Save | Saved; the Text view shows the change; `git diff` in the profile shows only that line plus any reformatting |
| 3 | Type invalid JSON in the Text view | Save disabled; "Line N: …" shown; Form view refuses |
| 4 | Edit, then run `devenv start` from the Start tab and pick another branch, then Save | "This file changed on disk…" with Reload / Overwrite |
| 5 | Open a `.ps1` and a compose `.yml` | Highlighted; a YAML typo blocks Save with its line |
| 6 | Edit a file, click another file | "Unsaved changes" dialog; Keep editing / Discard work |
| 7 | Check | `devenv doctor` output in the run panel |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix, and re-run that suite.
