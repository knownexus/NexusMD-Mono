# Devenv Phase 6b: Reconcile the Profile Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master now carries a second, independent Phase 6 (commits 5754cb2..d17a31e, "B"). Replace it with this branch's Phase 6 ("A", b86d6c1). Then port the four things B does better:
- a SHA-256 content stamp instead of mtime;
- a rename retry on Windows sharing errors;
- an early stale-draft warning;
- drafts kept across file switches, with dirty markers.

Also fix A's `removeRepository` cascade.

**Architecture:**
- Task 1 merges `master` into `feature/devenv-profile`. Every Phase 6 conflict resolves to A, B's leftover files and wiring are removed, and master's other work (git stage 2) is kept intact.
- Tasks 2-5 are ordinary TDD changes on A's files:
  - Task 2: the IPC `devenv-profile.cjs`, plus the renderer's stamp plumbing.
  - Task 3: the `use-profile-file.js` draft store.
  - Task 4: `profile-view.jsx` and `view-devenv.jsx` markers.
  - Task 5: core `profile.js`.
- Task 6 is the end-to-end check.

**Tech Stack:** Electron main (CommonJS, `fs/promises`, `crypto`), React 18 renderer, CodeMirror 6, vitest + @testing-library/react, core ESM package `@nexusmd/core`.

**Spec:** `docs/superpowers/specs/2026-10-08-devenv-module-design.md`. It covers the Profile tab (line ~118), the error table (~131) and "Amendments made during Phase 6 planning" (A's version is the one kept). The previous plan, `docs/superpowers/plans/2026-10-14-devenv-phase6-profile.md`, describes A.

## Global Constraints

- Work only in the worktree `C:\repos\NexusMD-Mono-devenv6` on branch `feature/devenv-profile`.
  - Never touch `C:\repos\NexusMD-Mono`, which is another session's checkout.
  - Never push.
- Never write into `C:\repos\dev-environment\profile`. Reading it is fine.
- No new npm dependencies. Task 1 removes `js-yaml` from `apps/desktop/package.json`.
- Desktop tests: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test` (or `npx vitest run <file>` inside `apps/desktop` with the same NODE_OPTIONS). Core tests: `npm -w packages/core test`.
- `src/jira-create-form.test.jsx` is a known flake. Don't touch it.
- In JS test strings, Windows paths keep escaped backslashes (`'C:\\p'`).
- Write files with the Edit/Write tools, not shell heredocs.
- Copy style matches the existing UI strings:
  - sentence case;
  - ` - ` as the dash;
  - errors name the file;
  - the conflict banner text stays "This file changed on disk since you opened it."
- Commit messages end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- IPC channel names stay A's: `devenv:profile-info|list|read|write|create`. Adapter and preload method names stay `profileInfo/List/Read/Write/Create`.

## Review Focus

1. **A kept draft reopened after devenv rewrote the file** (for example `devenv start` changing `ref`). The conflict banner should show as soon as the file opens, not only at Save. Task 3 adds the test.
2. **A save while antivirus or an editor holds the file for a moment** (EBUSY/EPERM on rename). It should retry briefly and succeed. If it still fails, no temp file is left. Task 2 adds the test.
3. **Bytes rewritten with the mtime unchanged** (coarse timestamps, tools that restore mtime). It should still be reported as a conflict. Task 2 adds the test.
4. **Saving, switching away before the write returns, then coming back.** The text typed after Save stays a draft against the new stamp, and there is no false "changed on disk". Task 3 adds the test.
5. **The merge silently dropping master's non-Phase-6 work** (git stage 2 exports in core `index.js`, preload, adapters). Every file that differs from master must be one this branch touched, and everything else must be byte-identical to master. Task 1 checks this with `comm`.

---

### Task 1: Merge master, keeping this branch's Phase 6

**Files:**
- Merge: `master` (d17a31e) into `feature/devenv-profile` (b86d6c1)
- Resolve to ours (add/add):
  - `apps/desktop/electron/ipc/devenv-profile.cjs` and `.test.js`
  - `apps/desktop/src/views/devenv/{environment-form,environment-form.test,mac-form,profile-view,profile-view.test}.jsx`
  - `packages/core/src/modules/devenv/profile.js` and `profile.test.js`
- Resolve by hand (content), keeping master's non-Phase-6 lines:
  - `apps/desktop/electron/preload.cjs`
  - `apps/desktop/src/adapters/devenv.js`
  - `apps/desktop/src/views/devenv/view-devenv.jsx`
  - `packages/core/src/adapters/index.js`
  - `packages/core/src/index.js`
  - `packages/core/src/modules/devenv/index.js`
  - `packages/core/tests/public-api.test.js`
  - `docs/superpowers/specs/2026-10-08-devenv-module-design.md`
- Clean up after the auto-merge:
  - `apps/desktop/electron/ipc/devenv.cjs`
  - `apps/desktop/electron/preload.test.js`
  - `apps/desktop/src/views/devenv/view-devenv.test.jsx`
  - `apps/desktop/package.json`
  - `package-lock.json`
- Delete (B only):
  - `apps/desktop/src/views/devenv/profile-editor.jsx` and `profile-editor.test.jsx`
  - `apps/desktop/src/views/devenv/profile-drafts.js`
  - `apps/desktop/src/views/devenv/profile-fields.jsx`
  - `apps/desktop/src/views/devenv/use-profile-files.js`
  - `apps/desktop/src/views/devenv/profile-test-fixtures.js`
  - `docs/superpowers/plans/2026-10-14-devenv-phase6-profile-editor.md`

**Interfaces:**
- Consumes: A's modules as they are at b86d6c1.
- Produces: a merge commit whose Phase 6 files equal the branch tip d658b8c (= b86d6c1 plus this plan). Every other file equals master's, except `package.json`/`package-lock.json` (js-yaml dropped).

- [ ] **Step 1: Start the merge**

```bash
cd /c/repos/NexusMD-Mono-devenv6
git status --short          # must be clean
git merge master --no-ff --no-commit
```

Expected: 17 conflicts (listed under Files).

- [ ] **Step 2: Resolve the add/add files to ours**

```bash
git checkout --ours -- apps/desktop/electron/ipc/devenv-profile.cjs apps/desktop/electron/ipc/devenv-profile.test.js \
  apps/desktop/src/views/devenv/environment-form.jsx apps/desktop/src/views/devenv/environment-form.test.jsx \
  apps/desktop/src/views/devenv/mac-form.jsx apps/desktop/src/views/devenv/profile-view.jsx apps/desktop/src/views/devenv/profile-view.test.jsx \
  packages/core/src/modules/devenv/profile.js packages/core/src/modules/devenv/profile.test.js
git add <the same paths>
```

- [ ] **Step 3: Resolve the content conflicts by hand**

For each content-conflict file, open it and edit the conflict markers.

Do not use `git checkout --ours` on these files. Master (62ba0dd, git stage 2) added non-Phase-6 lines to `preload.cjs`, `packages/core/src/adapters/index.js`, `packages/core/src/index.js` and `public-api.test.js`, and `--ours` would drop them.

Rules:
- Keep every line master added that isn't B's Phase 6. B's Phase 6 lines are:
  - `listProfileFiles`, `readProfileFile` and `writeProfileFile`;
  - the `devenv:profile:` channels;
  - B's profile exports, e.g. names that exist only in `git show d17a31e:packages/core/src/modules/devenv/profile.js`.
- Keep A's side for the Phase 6 hunks.
- `view-devenv.jsx`: keep A's version of the Profile tab (`import { ProfileView }`, `TABS` with `'Profile'`, `{tab === 'Profile' && <ProfileView adapter={adapter} />}`). Drop B's `profile-drafts.js` import and `useDraftsVersion()` call, and its marker span. Task 4 adds markers back from A's store.
- Spec: take master's status line `**Status:** Implemented (phases 1–6)`. Keep A's "## Amendments made during Phase 6 planning" section exactly as at b86d6c1, and drop B's section, including its `devenv setup profile` claim.

Check that no markers remain:

```bash
git diff --name-only --diff-filter=U    # should list nothing once all are added
grep -rn '^<<<<<<<\|^>>>>>>>' apps packages docs --include=*.js --include=*.jsx --include=*.cjs --include=*.md
```

- [ ] **Step 4: Remove B's leftovers that auto-merged**

- `apps/desktop/electron/ipc/devenv.cjs`: remove `const { registerProfile } = require('./devenv-profile.cjs');`, the `fsp = require('fs/promises'),` destructured default, and the two lines `// Profile files (the Profile tab) go through ...` and `registerProfile(handle, { fsp });`. A's module exports `register`, not `registerProfile`, so leaving the call would throw at startup and take down every devenv channel. A registers the profile module itself in `main.cjs`. Afterwards `git diff 62ba0dd -- apps/desktop/electron/ipc/devenv.cjs` must be empty.
- `apps/desktop/electron/preload.test.js`: delete B's test `it('exposes the profile file channels', ...)` (it asserts `devenv:profile:list`). Keep A's `it('exposes the devenv profile file methods over their channels', ...)`.
- `apps/desktop/src/views/devenv/view-devenv.test.jsx`:
  - remove `import { setDraft, clearAllDrafts } from './profile-drafts.js'` and B's `act` import if nothing else uses it;
  - set `afterEach(cleanup)`;
  - replace B's test `has a Profile tab between Mac and Commands, marked while a draft is unsaved` with:

```jsx
  it('has a Profile tab between Mac and Commands', () => {
    render(<DevenvView adapters={adapters} />)
    const names = ['Status', 'Start', 'Builds', 'Logs', 'Tests', 'Database', 'Emulator', 'Mac', 'Profile', 'Commands']
    const order = names.map(n => screen.getByRole('button', { name: n }))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.getByText('profile-stub')).toBeTruthy()
  })
```

  Keep B's `vi.mock('./profile-view.jsx', ...)` stub line. If an A test already covers the tab order, keep only one.
- Delete B's files:

```bash
git rm apps/desktop/src/views/devenv/profile-editor.jsx apps/desktop/src/views/devenv/profile-editor.test.jsx \
  apps/desktop/src/views/devenv/profile-drafts.js apps/desktop/src/views/devenv/profile-fields.jsx \
  apps/desktop/src/views/devenv/use-profile-files.js apps/desktop/src/views/devenv/profile-test-fixtures.js \
  docs/superpowers/plans/2026-10-14-devenv-phase6-profile-editor.md
```

- `apps/desktop/package.json`: remove the line `"js-yaml": "^4.1.0",`. Then refresh the lockfile from the worktree root with `npm install` (no new packages; it only drops the workspace's js-yaml entry).

- [ ] **Step 5: Prove nothing of B is left and nothing of master was lost**

```bash
grep -rn "profile-drafts\|registerProfile\|js-yaml\|listProfileFiles\|readProfileFile\|writeProfileFile\|devenv:profile:" apps packages --include=*.js --include=*.jsx --include=*.cjs --include=*.json -l | grep -v node_modules
# Expected: no output

# Every file that differs from git-stage-2 master is one this branch touched:
git add -A   # stage the resolved merge first; both checks compare against the index
comm -13 <(git diff --name-only eac102e d658b8c | sort) <(git diff --cached --name-only 62ba0dd -- . ':!package-lock.json' | sort)
# Expected: no output

# Every file that differs from this branch's tip is one master (git stage 2) touched:
comm -13 <(git diff --name-only eac102e 62ba0dd | sort) <(git diff --cached --name-only d658b8c -- . ':!package-lock.json' ':!docs/superpowers/plans' ':!docs/superpowers/specs/2026-10-08-devenv-module-design.md' | sort)
# Expected: no output (the spec differs from b86d6c1 only by the status line; check that with `git diff --cached d658b8c -- docs/superpowers/specs/`)
```

If a `comm` prints a path, that file is wrong. Fix it before going on.

- [ ] **Step 6: Run everything**

```bash
npm -w packages/core test
NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test
npm -w apps/desktop run build:renderer
```

Expected: all pass (bar the known jira flake), and the build succeeds.

- [ ] **Step 7: Commit the merge**

```bash
git add -A
git commit -m "Merge master: keep this branch's devenv Profile editor over the duplicate Phase 6

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Content stamp, rename retry, temp files hidden

**Files:**
- Modify:
  - `apps/desktop/electron/ipc/devenv-profile.cjs`
  - `apps/desktop/src/views/devenv/use-profile-file.js` (only `mtimeMs` → `stamp`)
  - `packages/core/src/adapters/index.js` (the `IDevenvAdapter` profile comments)
  - spec "Amendments made during Phase 6 planning", second bullet
- Test:
  - `apps/desktop/electron/ipc/devenv-profile.test.js`
  - `apps/desktop/src/views/devenv/profile-file-editor.test.jsx`
  - `apps/desktop/src/views/devenv/profile-view.test.jsx`
  - any other test faking `profileRead`/`profileWrite` with `mtimeMs`; find them with `grep -rln "mtimeMs" apps/desktop/src`

**Interfaces:**
- Produces:
  - `profile-read` returns `{ text, bom, stamp }`, where `stamp` is the lowercase hex SHA-256 of the file's bytes exactly as on disk (BOM included). It may also return `{ missing: true }`.
  - `profile-write(config, rel, text, opts)` takes `opts = { expectedStamp, overwrite, bom, create }` (opts may be null).
  - `profile-write` returns one of:
    - `{ ok: true, stamp }`, where `stamp` is the SHA-256 of the bytes written;
    - `{ ok: false, conflict: true, stamp }`, where `stamp` is the current file's;
    - `{ ok: false, missing: true }`.
  - `profile-list` entries keep their `mtimeMs` (display only).
  - The hook state field `mtimeMs` is renamed `stamp`. The conflict state is `{ stamp }`.

- [ ] **Step 1: Write the failing IPC tests**

In `devenv-profile.test.js`, reuse the file's existing helpers (`cfg()`, `call`, `file()`, the temp profile fixture). Change the existing read/write tests from `mtimeMs`/`expectedMtimeMs` to `stamp`/`expectedStamp`. Add:

```js
  it('stamps a read with the SHA-256 of the bytes on disk, BOM included', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\r\n')])
    fs.writeFileSync(file(), bytes)
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    expect(r.stamp).toBe(crypto.createHash('sha256').update(bytes).digest('hex'))
    expect(r.bom).toBe(true)
  })

  it('reports a conflict when the bytes changed even though the mtime did not', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const { mtime, atime } = fs.statSync(file())
    fs.writeFileSync(file(), '{"changed":true}\n')
    fs.utimesSync(file(), atime, mtime)
    const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"x":1}\n', { expectedStamp: r.stamp })
    expect(w).toEqual({ ok: false, conflict: true, stamp: crypto.createHash('sha256').update('{"changed":true}\n').digest('hex') })
    expect(fs.readFileSync(file(), 'utf8')).toBe('{"changed":true}\n')
  })

  it('returns the stamp of what it wrote', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"y":2}\n', { expectedStamp: r.stamp, bom: true })
    const onDisk = fs.readFileSync(file())
    expect(w).toEqual({ ok: true, stamp: crypto.createHash('sha256').update(onDisk).digest('hex') })
  })

  it('retries the rename while the file is briefly locked', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const spy = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(busy).mockRejectedValueOnce(Object.assign(new Error('perm'), { code: 'EPERM' }))
    try {
      const w = await call('devenv:profile-write', cfg(), 'environment.json', '{"z":3}\n', { expectedStamp: r.stamp })
      expect(w.ok).toBe(true)
      expect(spy).toHaveBeenCalledTimes(3)
      expect(fs.readFileSync(file(), 'utf8')).toBe('{"z":3}\n')
    } finally { spy.mockRestore() }
  })

  it('gives up after the retries and leaves no temp file behind', async () => {
    const r = await call('devenv:profile-read', cfg(), 'environment.json')
    const spy = vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('locked'), { code: 'EBUSY' }))
    try {
      await expect(call('devenv:profile-write', cfg(), 'environment.json', '{}\n', { expectedStamp: r.stamp })).rejects.toThrow()
      expect(spy).toHaveBeenCalledTimes(4)
      expect(fs.readdirSync(path.dirname(file())).filter(n => n.includes('.nexusmd-'))).toEqual([])
    } finally { spy.mockRestore() }
  })

  it('does not list leftover save temp files', async () => {
    fs.writeFileSync(path.join(path.dirname(file()), '.environment.json.nexusmd-0a1b2c3d.tmp'), 'x')
    const r = await call('devenv:profile-list', cfg())
    expect(r.files.map(f => f.path).some(p => p.includes('.nexusmd-'))).toBe(false)
  })
```

`fsp` is `require('fs/promises')`, the same object the module uses, so `vi.spyOn` intercepts its calls. Add `crypto`, `path` or `fsp` requires/imports at the top if the file lacks them, in the style the file already uses. Keep EACCES out of the tests; it's in the retry set only for parity with B.

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/desktop && NODE_OPTIONS=--no-experimental-webstorage npx vitest run electron/ipc/devenv-profile.test.js`
Expected: the new tests FAIL (no `stamp`, no retry, temp file listed).

- [ ] **Step 3: Implement in `devenv-profile.cjs`**

Next to the existing constants:

```js
const RENAME_RETRIES = 3;
const RENAME_RETRY_MS = 100;
// Windows sharing errors while antivirus or an editor has the file open for a moment.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const TMP_FILE = /^\..+\.nexusmd-[0-9a-f]{8}\.tmp$/;
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
```

In `listFiles`, skip files whose name matches `TMP_FILE`, next to the existing symlink skip: `if (!e.isDirectory() && TMP_FILE.test(e.name)) continue;`.

In `devenv:profile-read`, compute `const stamp = sha256(buf);` right after `readFile`, before the BOM is stripped. Return `{ text, bom, stamp }`, dropping `mtimeMs`. The `missing`, size, NUL and UTF-8 checks stay as they are.

In `devenv:profile-write`, replace the stat-based check and the write/rename block:

```js
    let current = null;
    try { current = await fsp.readFile(full); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const currentStamp = current ? sha256(current) : null;
    if (!opts.overwrite) {
      if (current && (opts.create || currentStamp !== opts.expectedStamp)) return { ok: false, conflict: true, stamp: currentStamp };
      if (!current && !opts.create) return { ok: false, missing: true };
    }
    // (mkdir + the realDeep re-check stay exactly as they are)
    const tmp = /* unchanged temp name */;
    try {
      await fsp.writeFile(tmp, body);
      for (let attempt = 0; ; attempt++) {
        try { await fsp.rename(tmp, full); break; } catch (e) {
          if (attempt < RENAME_RETRIES && RETRY_CODES.has(e.code)) { await sleep(RENAME_RETRY_MS); continue; }
          throw e;
        }
      }
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    return { ok: true, stamp: sha256(body) };
```

Update the file's header comment where it mentions mtime.

- [ ] **Step 4: Switch the renderer to the stamp**

In `use-profile-file.js`:
- rename `mtimeMs` to `stamp` everywhere: `EMPTY`, the draft objects, load, and save;
- send `expectedStamp: s.stamp` instead of `expectedMtimeMs: s.mtimeMs`;
- set `conflict: { stamp: r.stamp }`;
- on success use `stamp: r.stamp`.

Update every renderer test fake that returns `mtimeMs` or asserts `expectedMtimeMs` (`grep -rn "mtimeMs" apps/desktop/src`) to use `stamp: 'aaa…'`-style strings and `expectedStamp`.

In `packages/core/src/adapters/index.js`, update the `IDevenvAdapter` profile comments to the new read/write shapes. Signatures are unchanged.

- [ ] **Step 5: Update the spec**

In "## Amendments made during Phase 6 planning", replace the second bullet's first sentence with:

> Saves are atomic (temp file + rename, retried briefly on Windows sharing errors) and carry the SHA-256 stamp of the bytes the edit started from; a different stamp on disk (for example `devenv start` rewriting `source`/`ref`) is a conflict offering Reload or Overwrite.

Keep the rest of the bullet (BOM, CRLF, 1 MB/NUL).

- [ ] **Step 6: Run the suites**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test` and `npm -w packages/core test`.
Expected: PASS. `grep -rn "mtimeMs" apps/desktop/src apps/desktop/electron` shows only the `profile-list` entry field and its test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(devenv): profile saves check a SHA-256 stamp, retry locked renames, hide temp files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Draft store outside React state, early stale warning

**Files:**
- Modify: `apps/desktop/src/views/devenv/use-profile-file.js`
- Test: `apps/desktop/src/views/devenv/use-profile-file.test.jsx`, and keep `profile-file-editor.test.jsx` green

**Interfaces:**
- Consumes: Task 2's `stamp` read/write shapes.
- Produces (exports from `use-profile-file.js`):
  - `useProfileFile({ adapter, config, path })`: unchanged return shape, with `stamp` instead of `mtimeMs`.
  - `discardProfileDraft(config, path)`: unchanged, and now notifies listeners.
  - `hasProfileDraft(config, path) → boolean`
  - `hasProfileDrafts() → boolean`
  - `useProfileDraftsVersion() → number`: re-renders its caller whenever a draft appears, changes or goes.
  - `clearProfileDrafts()`: for tests, and it notifies.

- [ ] **Step 1: Write the failing tests**

Add these to `use-profile-file.test.jsx`, following how the existing tests in that file render the hook. If it uses a small harness component, add one that exposes the hook result and its `setText`/`save`. Call `clearProfileDrafts()` in `afterEach`.

```jsx
  it('warns at once when a kept draft is reopened over a file that changed on disk', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const first = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(first.result().status).toBe('ready'))
    act(() => first.result().setText('{"a":2}\n'))
    first.unmount()
    adapter.profileRead.mockResolvedValue({ text: '{"a":9}\n', bom: false, stamp: 's2' })
    const again = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(again.result().conflict).toEqual({ stamp: 's2' }))
    expect(again.result().text).toBe('{"a":2}\n')
    expect(again.result().restored).toBe(true)
  })

  it('shows no warning when the kept draft still matches the file', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const first = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(first.result().status).toBe('ready'))
    act(() => first.result().setText('{"a":2}\n'))
    first.unmount()
    const again = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(adapter.profileRead).toHaveBeenCalledTimes(2))
    expect(again.result().conflict).toBe(null)
  })

  it('keeps text typed during a save as a draft against the new stamp, even after leaving the file', async () => {
    let finish
    const adapter = {
      profileRead: vi.fn().mockResolvedValue({ text: '{"a":1}\n', bom: false, stamp: 's1' }),
      profileWrite: vi.fn(() => new Promise(r => { finish = r })),
    }
    const h = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    act(() => h.result().setText('{"a":2}\n'))
    let saving
    act(() => { saving = h.result().save() })
    act(() => h.result().setText('{"a":3}\n'))
    h.unmount()
    await act(async () => { finish({ ok: true, stamp: 's2' }); await saving })
    expect(hasProfileDraft(CFG, 'environment.json')).toBe(true)
    adapter.profileRead.mockResolvedValue({ text: '{"a":2}\n', bom: false, stamp: 's2' })
    const back = renderHookHarness({ adapter, config: CFG, path: 'environment.json' })
    await waitFor(() => expect(adapter.profileRead).toHaveBeenCalledTimes(2))
    expect(back.result().text).toBe('{"a":3}\n')
    expect(back.result().saved).toBe('{"a":2}\n')
    expect(back.result().conflict).toBe(null)
  })

  it('notifies draft listeners when a draft appears and goes', async () => {
    const adapter = { profileRead: vi.fn().mockResolvedValue({ text: '{}\n', bom: false, stamp: 's1' }), profileWrite: vi.fn() }
    const h = renderHookHarness({ adapter, config: CFG, path: 'mac.json' })
    await waitFor(() => expect(h.result().status).toBe('ready'))
    expect(hasProfileDrafts()).toBe(false)
    act(() => h.result().setText('{"host":"x"}\n'))
    expect(hasProfileDraft(CFG, 'mac.json')).toBe(true)
    act(() => h.result().setText('{}\n'))
    expect(hasProfileDrafts()).toBe(false)
  })
```

`CFG = { root: 'C:\\d', pwsh: 'pwsh', profile: '' }`. `renderHookHarness` is a small helper in the test file: it renders a component that calls `useProfileFile(props)` and stores the result in a variable, and returns `{ result: () => latest, unmount }`. If `@testing-library/react`'s `renderHook` is available in this repo (check other tests), use it instead.

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/desktop && NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/views/devenv/use-profile-file.test.jsx`
Expected: FAIL (no early conflict, no `hasProfileDraft` export).

- [ ] **Step 3: Implement**

Replace the store and bookkeeping in `use-profile-file.js`. Draft writes move out of `setS` updaters: updaters may run during render, and notifying other components from there is a React error. They also don't run reliably after unmount.

```js
// Unsaved edits survive switching files or tabs for this window's lifetime (a reload loses them).
// Kept outside React, with listeners, so the file list and the Profile tab can mark them.
const drafts = new Map()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const draftKey = (config, path) => `${config.root}|${config.profile}|${path}`
const putDraft = (key, d) => { drafts.set(key, d); emit() }
const dropDraft = key => { if (drafts.delete(key)) emit() }

export const hasProfileDraft = (config, path) => drafts.has(draftKey(config, path))
export const hasProfileDrafts = () => drafts.size > 0
// Without this, "Revert" would still bring the draft back on the next visit.
export function discardProfileDraft(config, path) { dropDraft(draftKey(config, path)) }
export function clearProfileDrafts() { if (drafts.size) { drafts.clear(); emit() } }
export function useProfileDraftsVersion() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const l = () => setVersion(v => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return version
}
```

Inside `useProfileFile`, add refs below `live`:

```js
  // The latest state and text, for draft bookkeeping done outside state updaters.
  const latest = React.useRef(s)
  latest.current = s
  const typed = React.useRef('')
```

In `load`, after `const d = drafts.get(key)`, replace the draft branch:

```js
    if (d) {
      typed.current = d.text
      setS({ ...EMPTY, ...d, status: 'ready', restored: true })
      // The draft may be older than the file: say so now rather than at Save.
      try {
        const r = await adapter.profileRead(config, path)
        if (live.current !== key) return
        if (r.missing) {
          if (!d.missing) setS(p => ({ ...p, missing: true, stamp: null, error: `${path} no longer exists on disk - Save again to create it.` }))
        } else if (d.missing || r.stamp !== d.stamp) {
          setS(p => ({ ...p, conflict: { stamp: r.stamp } }))
        }
      } catch { /* the draft stays on screen; Save reports a real problem */ }
      return
    }
```

In the non-draft read path, set `typed.current = text` (and `''` for missing) alongside the existing `setS`.

Replace `setText`:

```js
  const setText = React.useCallback(text => {
    const p = latest.current
    typed.current = text
    if (text !== p.saved) putDraft(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, stamp: p.stamp, missing: p.missing })
    else dropDraft(key)
    setS(q => ({ ...q, text }))
  }, [key])
```

In `save`, replace the success `setS` updater, which did draft bookkeeping inside it, with:

```js
      const now = typed.current
      if (now === written) dropDraft(key)
      else putDraft(key, { text: now, saved: written, eol: s.eol, bom: s.bom, stamp: r.stamp, missing: false })
      setS(p => ({ ...p, saving: false, saved: written, stamp: r.stamp, conflict: null, missing: false, restored: false }))
```

In `load({ discardDraft })`, use `dropDraft(key)` instead of `drafts.delete(key)`.

- [ ] **Step 4: Run the devenv view tests**

Run: `cd apps/desktop && NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/views/devenv`
Expected: PASS, with no React "Cannot update a component while rendering a different component" warnings in the output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(devenv): profile drafts notify listeners and warn early when the file moved on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Keep drafts across file switches, mark them

**Files:**
- Modify:
  - `apps/desktop/src/views/devenv/profile-view.jsx`
  - `apps/desktop/src/views/devenv/view-devenv.jsx`
  - spec "Amendments made during Phase 6 planning", fourth bullet
- Test:
  - `apps/desktop/src/views/devenv/profile-view.test.jsx`
  - `apps/desktop/src/views/devenv/view-devenv.test.jsx`

**Interfaces:**
- Consumes: Task 3's `hasProfileDraft`, `hasProfileDrafts`, `useProfileDraftsVersion` and `clearProfileDrafts`.
- Produces:
  - File-list buttons are named `label(p)` plus `', unsaved changes'` when a draft exists, and show a visible ` •`.
  - The Profile tab button shows an `aria-hidden` ` •` (title "Unsaved changes") while any draft exists, so its accessible name stays `Profile`.

- [ ] **Step 1: Write the failing tests**

In `profile-view.test.jsx`:
- remove the tests for the "Unsaved changes" modal ("Keep editing" / "Discard changes");
- add `afterEach(() => clearProfileDrafts())`;
- add the tests below, reusing the file's existing adapter fake and render helper. The fake's list returns `environment.json` and `commands.ps1`, and its read returns valid text with a `stamp`.

```jsx
  it('switches files without asking and keeps the unsaved draft, marked in the list', async () => {
    renderProfile()
    await screen.findByRole('button', { name: 'Text' })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    typeInto(screen.getByLabelText('Edit environment.json'), '{"edited":true}')
    fireEvent.click(screen.getByRole('button', { name: 'commands.ps1' }))
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    await screen.findByLabelText('Edit commands.ps1')
    const marked = screen.getByRole('button', { name: 'environment.json, unsaved changes' })
    expect(marked.textContent).toContain('•')
    fireEvent.click(marked)
    await screen.findByText('Unsaved changes from earlier were restored.')
  })

  it('drops the marker when the draft is reverted', async () => {
    renderProfile()
    await screen.findByRole('button', { name: 'Text' })
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))
    typeInto(screen.getByLabelText('Edit environment.json'), '{"edited":true}')
    await screen.findByRole('button', { name: 'environment.json, unsaved changes' })
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await screen.findByRole('button', { name: 'environment.json' })
  })
```

`typeInto` is however the existing tests in this file put text into the CodeMirror editor. Reuse that helper or pattern exactly, and don't invent a new one.

In `view-devenv.test.jsx`, add:

```jsx
  it('marks the Profile tab while any profile draft is unsaved', () => {
    render(<DevenvView adapters={adapters} />)
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile')
    act(() => setProfileDraftForTest())
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile •')
  })
```

There is no public setter, so `setProfileDraftForTest` mounts nothing. Instead, have the test mock `./use-profile-file.js` the way the file already mocks its siblings:

```jsx
vi.mock('./use-profile-file.js', () => {
  let any = false; const ls = new Set()
  return {
    hasProfileDrafts: () => any,
    useProfileDraftsVersion: () => { const [, f] = require('react').useState(0); require('react').useEffect(() => { const l = () => f(x => x + 1); ls.add(l); return () => ls.delete(l) }, []); return 0 },
    __setAny: v => { any = v; ls.forEach(l => l()) },
  }
})
```

Write `setProfileDraftForTest` as `() => mod.__setAny(true)`, with `mod` imported from `./use-profile-file.js`. Reset it with `__setAny(false)` in `afterEach`. Use ESM `import React` inside the factory if the file's other mocks do; match the file.

- [ ] **Step 2: Run them and see them fail**

Run: `cd apps/desktop && NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/views/devenv/profile-view.test.jsx src/views/devenv/view-devenv.test.jsx`
Expected: FAIL (the modal still appears, there are no markers).

- [ ] **Step 3: Implement**

In `profile-view.jsx`:
- remove the `PlModal` import, the `dirty` and `pending` state, and the whole `<PlModal …>` block;
- remove `discardProfileDraft` from the import, and `onDirtyChange={setDirty}` from `ProfileFileEditor`;
- replace `choose`, and add the marker:

```jsx
import { hasProfileDraft, useProfileDraftsVersion } from './use-profile-file.js'
// …
  useProfileDraftsVersion()
  const choose = p => setSelected(p)
  // …
            {paths.map(p => {
              const unsaved = hasProfileDraft(config, p)
              return (
                <button key={p} className={`btn sm ${p === selected ? '' : 'ghost'}`} aria-current={p === selected ? 'true' : undefined}
                  aria-label={unsaved ? `${label(p)}, unsaved changes` : label(p)} title={unsaved ? 'Unsaved changes' : undefined}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => choose(p)}>
                  {label(p)}{unsaved && <span aria-hidden="true"> •</span>}
                </button>
              )
            })}
```

In `view-devenv.jsx`, import `{ hasProfileDrafts, useProfileDraftsVersion }` from `./use-profile-file.js`. Call `useProfileDraftsVersion()` before the early `return` in `DevenvView`, as hooks must run unconditionally. Render the tab label as:

```jsx
{t}{t === 'Profile' && hasProfileDrafts() ? <span aria-hidden="true" title="Unsaved changes"> •</span> : null}
```

- [ ] **Step 4: Update the spec**

In "## Amendments made during Phase 6 planning", fourth bullet, replace "Unsaved edits survive file and tab switches for the window's lifetime; switching files with unsaved edits asks first." with:

> Unsaved edits survive file and tab switches for the window's lifetime (a reload loses them); a • marks each file with unsaved edits and the Profile tab while any exist, Revert discards a draft, and a draft reopened over a file that changed on disk shows the conflict banner straight away.

In the error table row "Profile file invalid / changed on disk", the text can stay as it is.

- [ ] **Step 5: Run the desktop suite**

Run: `NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(devenv): profile drafts survive file switches, marked in the file list and on the tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Removing a repository removes its references

**Files:**
- Modify: `packages/core/src/modules/devenv/profile.js` (`removeRepository`)
- Test: `packages/core/src/modules/devenv/profile.test.js`

**Interfaces:**
- Produces: `removeRepository(env, key)`, with the same signature. It also drops:
  - `test.wiring` entries whose `from` or `to` is `key`;
  - `test.extraDbConn[key]`;
  - `test.collectionPatterns` entries whose value is `key`.

  Order is kept, and non-object values are left alone.

- [ ] **Step 1: Write the failing test**

```js
  it('removeRepository drops wiring, extraDbConn and collectionPatterns that point at it', () => {
    const env = {
      repositories: { a: { source: 'x', ref: 'main', project: 'p', kind: 'api' }, b: { source: 'y', ref: 'main', project: 'q', kind: 'api' } },
      test: {
        defaultServices: ['a', 'b'],
        wiring: [{ from: 'a', to: 'b', setting: 'S1' }, { from: 'b', to: 'a', setting: 'S2' }, { from: 'b', to: 'b', setting: 'S3' }],
        extraDbConn: { a: { K: 'DbA' }, b: { K: 'DbB' } },
        collectionPatterns: { 'x|y': 'a', z: 'b' },
      },
    }
    const next = removeRepository(env, 'a')
    expect(Object.keys(next.repositories)).toEqual(['b'])
    expect(next.test.defaultServices).toEqual(['b'])
    expect(next.test.wiring).toEqual([{ from: 'b', to: 'b', setting: 'S3' }])
    expect(next.test.extraDbConn).toEqual({ b: { K: 'DbB' } })
    expect(next.test.collectionPatterns).toEqual({ z: 'b' })
    expect(env.test.wiring).toHaveLength(3)
  })

  it('removeRepository leaves odd test values alone', () => {
    const env = { repositories: { a: {} }, test: { wiring: 'nope', extraDbConn: 5, collectionPatterns: null } }
    expect(removeRepository(env, 'a').test).toEqual({ wiring: 'nope', extraDbConn: 5, collectionPatterns: null })
  })
```

Match the wiring entry's field names to what `validateEnvironment` and `renameRepository` use (`from`/`to`, plus whatever the setting field is called in that file).

- [ ] **Step 2: Run it and see it fail**

Run: `npm -w packages/core test -- src/modules/devenv/profile.test.js`
Expected: FAIL (wiring, extraDbConn and patterns are kept).

- [ ] **Step 3: Implement**

```js
export function removeRepository(env, key) {
  let next = setIn(env, ['repositories', key], undefined)
  const t = env.test
  if (Array.isArray(t?.defaultServices)) next = setIn(next, ['test', 'defaultServices'], t.defaultServices.filter(s => s !== key))
  // References to a removed repository would only fail validation; they go with it.
  if (Array.isArray(t?.wiring)) next = setIn(next, ['test', 'wiring'], t.wiring.filter(w => !isObj(w) || (w.from !== key && w.to !== key)))
  if (isObj(t?.extraDbConn) && key in t.extraDbConn) next = setIn(next, ['test', 'extraDbConn', key], undefined)
  if (isObj(t?.collectionPatterns) && Object.values(t.collectionPatterns).includes(key)) {
    next = setIn(next, ['test', 'collectionPatterns'], Object.fromEntries(Object.entries(t.collectionPatterns).filter(([, v]) => v !== key)))
  }
  return next
}
```

- [ ] **Step 4: Run the core suite**

Run: `npm -w packages/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/devenv/profile.js packages/core/src/modules/devenv/profile.test.js
git commit -m "fix(core): removing a repository drops its wiring, extraDbConn and collection patterns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end check

- [ ] **Step 1: Full suites and build, in the worktree**

```bash
npm -w packages/core test
NODE_OPTIONS=--no-experimental-webstorage npm -w apps/desktop test
npm -w apps/desktop run build:renderer
```

Expected: all pass (bar the known jira flake), and the build succeeds. Report the main chunk size.

- [ ] **Step 2: Headless check (throwaway script in the session scratchpad, not committed)**

Drive `apps/desktop/electron/ipc/devenv-profile.cjs` from Node with a fake `ipcMain`, as Phase 6's check did.

1. **Read only, against the real profile** (`{ root: 'C:\\repos\\dev-environment', profile: '' }`):
   - `profile-info` reports `exists: true`;
   - the list has no `.git` paths and no `.nexusmd-` temp files;
   - `environment.json` and `mac.json` read with a 64-hex `stamp`;
   - `validateProfileFile` gives 0 errors on both.
2. **Writes, against a scratchpad copy** of `C:\repos\dev-environment\profile`:
   - an unchanged `environment.json` round-trips byte-identical;
   - a CRLF+BOM `.ps1` round-trips byte-identical;
   - a write with a stale `expectedStamp` returns `conflict` with the disk stamp;
   - afterwards, delete the copy and confirm the real profile's hash is unchanged.

- [ ] **Step 3: GUI checklist (for the user, at the desktop)**

| # | Do | Expect |
|---|---|---|
| 1 | Dev Environment → Profile | Files are listed; `environment.json` opens in the form |
| 2 | Change a repository's label, then click `commands.ps1` | No prompt; `environment.json •` in the list; `Profile •` on the tab |
| 3 | Go back to `environment.json` | "Unsaved changes from earlier were restored."; Save works and the • markers go |
| 4 | Edit, switch file, run `devenv start` on another branch, come back | The conflict banner shows at once, with Reload / Overwrite |
| 5 | Remove a repository that has wiring and collection patterns, then Save | Saves; the Text view shows its wiring, extraDbConn and pattern entries gone |
| 6 | Open a `.ps1` and a compose `.yml` | Highlighted; a YAML typo blocks Save with its line |
| 7 | Check | `devenv doctor` output in the run panel |

- [ ] **Step 4: Fix anything that fails**

For each failure, first write a failing test in the owning task's test file. Then fix it and re-run that suite.
