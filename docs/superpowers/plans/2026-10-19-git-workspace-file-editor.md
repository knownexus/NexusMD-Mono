# Git Workspace File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open, edit and save any file of a worktree from the Git Workspace — from the changes list (Diff | Edit switch), from Go to file (Ctrl+P), or by clicking a diff line.

**Architecture:** Three new named git IPC operations (list files, read a file, write a file) live in a new `electron/ipc/git-files.cjs`, registered from `git.cjs` the way `git-actions.cjs` is, and reuse confined/atomic file I/O extracted from `devenv-profile.cjs`. The renderer gets a `useWorktreeFile` hook and a `FileEditor` built on the existing CodeMirror `CodeEditor` (moved to `views/shared/`), shown in the lower pane of `WorktreePanel` in place of the diff.

**Tech Stack:** Electron (CJS main), React 18, CodeMirror 6, Vitest (jsdom for views, node for real-git integration).

**Spec:** `docs/superpowers/specs/2026-10-19-git-workspace-editing-and-conflicts-design.md` (Part 1). Part 2 (conflicts) has its own plan, `2026-10-19-git-workspace-conflict-resolution.md`, which builds on this one.

## Global Constraints

- Only files inside a registered worktree are read or written; paths are relative, inside the worktree, no NUL / drive / device / UNC paths, and junction/symlink escapes are refused (real-path check).
- Never overwrite a file changed on disk since it was opened: a save carries the stamp from the read; a mismatch returns `{ ok: false, conflict: true }` and the UI offers **Reload (discard my changes)** or **Overwrite**.
- Unsaved edits are never discarded without asking.
- Binary files and files over 1 MB are not editable; say why ("isn't a text file", "is too large to edit here (N KB)", "isn't UTF-8 text").
- Line endings (LF vs CRLF) and a UTF-8 BOM are kept as found.
- Never write inside the `.git` directory.
- Syntax colours: JavaScript/TypeScript (incl. JSX/TSX), CSS, HTML, C#, plus the existing JSON, YAML, SQL, Markdown, PowerShell; anything else is plain text.
- Out of scope: creating/renaming/deleting files, format on save, a folder-tree Files tab.

## Review Focus

1. **A file edited outside NexusMD while open** — Save must report the conflict, not overwrite. (Task 2 integration test `refuses a stale write`; Task 4 hook test `reports a conflict and offers overwrite`.)
2. **CRLF files and BOM files** — saving an unchanged-looking edit must not flip every line ending or drop the BOM, or the diff fills with noise. (Task 2 `keeps CRLF and BOM`; Task 4 `writes back with the file's own line endings`.)
3. **Switching file/worktree/panel with unsaved edits** — must ask; Cancel keeps the edits on screen. (Task 5 view test `asks before leaving unsaved edits`.)
4. **Paths that escape the worktree** (`..\`, absolute, a junction inside the worktree pointing out, `.git/config`) — refused before any read or write. (Task 2 `refuses paths outside the worktree or inside .git`.)
5. **Big repos in Go to file** — tens of thousands of files must not freeze typing. (Task 6 `caps the list and the matches`.)

---

### Task 1: Extract confined, atomic file I/O into a shared module

**Files:**
- Create: `apps/desktop/electron/ipc/safe-file.cjs`
- Modify: `apps/desktop/electron/ipc/devenv-profile.cjs` (use the shared functions; behaviour unchanged)
- Test: `apps/desktop/electron/ipc/safe-file.test.js`; existing `devenv-profile.test.js` must still pass

**Interfaces:**
- Produces (CommonJS exports of `safe-file.cjs`):
  - `resolveInside(dir: string, rel: string, notOk: (rel) => Error): Promise<{ full: string, realDir: string }>` — today's `resolveFile` with the error built by `notOk` (devenv passes `` rel => new Error(`Not a profile file: ${rel}`) ``).
  - `readText(full: string, rel: string, { maxBytes }): Promise<{ text: string, bom: boolean, stamp: string } | { missing: true }>` — today's `devenv:profile-read` body (size cap, NUL ⇒ not text, BOM strip, fatal UTF-8).
  - `writeAtomic(full: string, realDir: string, body: Buffer, notOk): Promise<void>` — mkdir parent, re-check real parent inside `realDir`, temp file `.<name>.nexusmd-<8 hex>.tmp`, rename with 3 retries / 100 ms on EPERM/EBUSY/EACCES, temp removed on failure.
  - `sha256(buf: Buffer): string`, `BOM: Buffer`, `TMP_FILE: RegExp`.

- [ ] **Step 1: Write the failing tests** in `safe-file.test.js` (node environment, temp dir per test):
  - `resolveInside refuses ../, absolute, ADS (a:b) and trailing-dot names` → each rejects with the `notOk` error.
  - `resolveInside refuses a junction that leads out` (create with `fs.symlinkSync(outside, link, 'junction')`; skip when it throws EPERM).
  - `readText returns text, bom and stamp; missing for an absent file` → `{ text: 'hi\n', bom: true }` for `\uFEFFhi\n`; `{ missing: true }`.
  - `readText refuses binary, oversize and non-UTF-8` → messages `x.bin isn't a text file.`, `big.txt is too large to edit here (2 KB).` (with `maxBytes: 1024`), `bad.txt isn't UTF-8 text.`.
  - `writeAtomic replaces the file and leaves no temp file` → content equal, `readdirSync` has no `TMP_FILE` match.
- [ ] **Step 2: Run** `npx vitest run electron/ipc/safe-file.test.js` (in `apps/desktop`). Expected: FAIL, module not found.
- [ ] **Step 3: Implement `safe-file.cjs`** by moving the functions out of `devenv-profile.cjs` (`realDeep`, `inside`, `fold`, `resolveFile`, the read and the temp+rename write); switch `devenv-profile.cjs` to call them.
- [ ] **Step 4: Run** `npx vitest run electron/ipc/safe-file.test.js electron/ipc/devenv-profile.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(desktop): share confined atomic file I/O between devenv and git`.

### Task 2: Git IPC to list, read and write worktree files

**Files:**
- Create: `apps/desktop/electron/ipc/git-files.cjs`
- Modify: `apps/desktop/electron/ipc/git.cjs` (register it beside `registerActions`, passing `{ git, requireExactWorktree, requirePaths, withRepoLock }`; `requirePaths` is currently local to `register` — pass it in)
- Modify: `apps/desktop/electron/preload.cjs` (git section), `apps/desktop/src/adapters/git.js`, `packages/core/src/adapters/index.js` (`IGitAdapter` stubs)
- Test: `apps/desktop/electron/ipc/git.files.integration.test.js` (copy the harness of `git.writes.integration.test.js`: temp repo, isolated `GIT_CONFIG_GLOBAL`, `register(fakeIpcMain)`, `call(channel, …)`)

**Interfaces:**
- Consumes: Task 1 `resolveInside`, `readText`, `writeAtomic`, `sha256`, `BOM`.
- Produces (IPC channel → adapter method, all `(repo, worktreePath, registered, …)`):
  - `git:files` → `adapter.files(repo, wt, registered): Promise<{ files: string[], truncated: boolean }>` — `git ls-files -z -c -o --exclude-standard`, de-duplicated, sorted, capped at `MAX_LIST = 50000`.
  - `git:readFile` → `adapter.readFile(repo, wt, registered, rel): Promise<{ text, bom, stamp } | { missing: true }>` — `maxBytes` 1 MB.
  - `git:writeFile` → `adapter.writeFile(repo, wt, registered, rel, text, { expectedStamp, overwrite = false, bom = false }): Promise<{ ok: true, stamp } | { ok: false, conflict: true, stamp } | { ok: false, missing: true }>` — runs under `withRepoLock`; never creates a missing file (out of scope); body capped at 2 MB.
  - Every path: `requirePaths(wt, [rel])`, then `resolveInside(realpath(wt), rel)`, then refuse when the first segment is `.git` (case-insensitive) with `Not a worktree file: ${rel}`. Exported from `git-files.cjs` as `requireWorktreeFile(wt, rel): Promise<{ full, realDir }>` (the conflict plan reuses it).

- [ ] **Step 1: Write the failing integration tests:**
  - `lists tracked and untracked files but not ignored ones` → contains `story.txt`, `new.txt`; not `ignored.log` (with `.gitignore` `*.log`).
  - `reads a file with its stamp` → `{ text, bom: false, stamp: /^[0-9a-f]{64}$/ }`.
  - `writes with the expected stamp and returns the new one` → file content equals; returned stamp equals a fresh read's stamp.
  - `refuses a stale write` → write file on disk after reading; `writeFile` with old stamp → `{ ok: false, conflict: true }`, disk content unchanged; with `overwrite: true` → `{ ok: true }`.
  - `keeps CRLF and BOM` → write `'\uFEFF'`-less text `'a\r\nb\r\n'` with `bom: true`; bytes on disk start `EF BB BF` and contain `\r\n`.
  - `refuses paths outside the worktree or inside .git` → `../x`, `C:\\x`, `.git/config`, `.GIT/HEAD` each reject; nothing written.
  - `refuses a missing file and a file that isn't registered` → `{ ok: false, missing: true }`; unregistered repo rejects `Not a registered repository`.
- [ ] **Step 2: Run** `npx vitest run electron/ipc/git.files.integration.test.js`. Expected: FAIL (no handler).
- [ ] **Step 3: Implement `git-files.cjs`** (`registerFiles(handle, deps)`), wire it in `git.cjs`, add preload/adapter/IGitAdapter entries with the signatures above.
- [ ] **Step 4: Run** the test file again. Expected: PASS. Also `npx vitest run electron/ipc/git.writes.integration.test.js` still passes.
- [ ] **Step 5: Commit** `feat(desktop): git IPC to list, read and write worktree files`.

### Task 3: Shared CodeEditor with more languages and go-to-line

**Files:**
- Move: `apps/desktop/src/views/devenv/code-editor.jsx` → `apps/desktop/src/views/shared/code-editor.jsx` (and its test `code-editor.test.jsx`); update the import in `views/devenv/profile-file-editor.jsx`.
- Modify: `apps/desktop/package.json` — add `@codemirror/lang-javascript`, `@codemirror/lang-css`, `@codemirror/lang-html` (latest 6.x already published ≥ 2 weeks); C# uses `csharp` from the installed `@codemirror/legacy-modes/mode/clike`.

**Interfaces:**
- Produces:
  - `languageForPath(path: string): string | null` exported from `code-editor.jsx`: `.js .mjs .cjs .jsx` → `'javascript'`, `.ts .tsx .mts .cts` → `'typescript'`, `.css .scss .less` → `'css'`, `.html .htm` → `'html'`, `.cs .csx` → `'csharp'`, `.json` → `'json'`, `.yml .yaml` → `'yaml'`, `.sql` → `'sql'`, `.md .markdown` → `'markdown'`, `.ps1 .psm1 .psd1` → `'powershell'`; otherwise `null` (plain text). Case-insensitive.
  - `CodeEditor({ value, language, onChange, ariaLabel, line = null, readOnly = false })` — new `line` (1-based): when it changes to a number, move the cursor to the start of that line and scroll it into view (`EditorView.scrollIntoView(pos, { y: 'center' })`). `readOnly` sets `EditorState.readOnly` (Part 2 uses it).
- [ ] **Step 1: Write failing tests** in `views/shared/code-editor.test.jsx`: `languageForPath maps each extension` (table of the pairs above plus `README` → `null`); `jumps to the given line` (render 50 lines with `line={30}`; `view.state.selection.main.head` equals the start of line 30 — reach the view through `EditorView.findFromDOM(container.querySelector('.cm-editor'))`); `readOnly blocks typing` (`view.state.readOnly === true`).
- [ ] **Step 2: Run** `npx vitest run src/views/shared/code-editor.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the move, `languageForPath`, the new languages in `LANGUAGES` (`javascript: () => javascript({ jsx: true })`, `typescript: () => javascript({ jsx: true, typescript: true })`, `css`, `html`, `csharp: () => StreamLanguage.define(csharp)`), `line` and `readOnly` (readOnly through a Compartment so it can change).
- [ ] **Step 4: Run** `npx vitest run src/views/shared/code-editor.test.jsx src/views/devenv`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): shared code editor with JS/TS/CSS/HTML/C# and go-to-line`.

### Task 4: `useWorktreeFile` hook

**Files:**
- Create: `apps/desktop/src/views/git/use-worktree-file.js`
- Test: `apps/desktop/src/views/git/use-worktree-file.test.js`

**Interfaces:**
- Consumes: Task 2 `adapter.readFile` / `adapter.writeFile`; `detectEol`, `toLf`, `fromLf` from `@nexusmd/core` (already used by `use-profile-file.js`).
- Produces: `useWorktreeFile({ adapter, repo, worktreePath, registered, path }) → { status: 'idle'|'loading'|'ready'|'error', text, setText(text), dirty: boolean, saving: boolean, error: string|null, conflict: boolean, save({ overwrite = false } = {}): Promise<boolean>, revert(): Promise<void> }`. `path === null` ⇒ `status: 'idle'`. Text is held LF-only; the file's eol and BOM are remembered from the read and used on save. Only the newest load is kept (switching path mid-load must not show the old file). Typing during a save stays dirty (compare with what was sent, as `use-profile-file.js` does).
- [ ] **Step 1: Write failing tests** (`renderHook`, mocked adapter):
  - `loads the file and is clean` → `status 'ready'`, `dirty false`.
  - `writes back with the file's own line endings` → read returns `'a\r\nb\r\n'`; `setText('a\nc\n')`; `save()` calls `writeFile` with text `'a\r\nc\r\n'`, `{ expectedStamp: 's1', overwrite: false, bom: false }`.
  - `reports a conflict and offers overwrite` → `writeFile` resolves `{ ok:false, conflict:true }` ⇒ `conflict true`, `dirty true`; `save({ overwrite: true })` passes `overwrite: true` and clears `conflict`.
  - `shows why a file can't be edited` → `readFile` rejects `Error("x.bin isn't a text file.")` ⇒ `status 'error'`, `error` equals that message (strip Electron's remote-method prefix with `ipcMessage` from `use-git-actions.js`).
  - `ignores a stale load after switching file`.
- [ ] **Step 2: Run** `npx vitest run src/views/git/use-worktree-file.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): useWorktreeFile hook with stamp-checked saves`.

### Task 5: FileEditor and the Diff | Edit switch, with unsaved-edit guards

**Files:**
- Create: `apps/desktop/src/views/git/file-editor.jsx`
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (lower pane: switch + DiffPane or FileEditor), `apps/desktop/src/views/git/diff-pane.jsx` (optional `onLine(newNo)` — clicking a line with a new-side number calls it), `apps/desktop/src/views/git/view-git.jsx` (pass `onSaved={reload}` and guard worktree/group/panel changes)
- Test: `apps/desktop/src/views/git/file-editor.test.jsx`, additions to `diff-pane.test.jsx` and `view-git-actions.test.jsx`

**Interfaces:**
- Consumes: Task 3 `CodeEditor`, `languageForPath`; Task 4 `useWorktreeFile`.
- Produces:
  - `FileEditor({ adapter, repo, worktreePath, registered, path, line = null, onSaved, onDirtyChange })` — header: path, "● Unsaved" badge when dirty, **Revert** and **Save** (Ctrl+S also saves); conflict alert copied from `profile-file-editor.jsx` ("This file changed on disk since you opened it." / **Reload (discard my changes)** / **Overwrite**); error alert for unreadable files. Calls `onSaved()` after a successful save (the panel passes the snapshot `reload`) and `onDirtyChange(bool)` whenever dirtiness changes.
  - In `WorktreePanel`: new state `editor = { path, line } | null` and `mode: 'diff' | 'edit'`. A `role="group" aria-label="Diff or edit"` pill pair **Diff** / **Edit** above the lower pane when a file is focused or opened. Focusing a change keeps the current mode. Diff for an opened file that isn't in the changes list shows "No changes yet."
  - A single guard `confirmDiscard(): boolean` in `WorktreePanel` = `!dirty || window.confirm('Discard unsaved changes to <path>?')`, run before: focusing another file, switching Diff→other file, opening via Go to file, switching Changes/History. `ViewGit` asks the panel through a ref (`panelRef.current?.confirmDiscard()`) before changing the selected worktree or group. **My call:** leaving the Git Workspace screen entirely is not intercepted (the app's router has no leave hook); a `beforeunload` handler covers closing the window.
- [ ] **Step 1: Write failing tests:**
  - `file-editor.test.jsx`: `saves with Save and Ctrl+S, then calls onSaved`; `shows the conflict choices`; `shows why a file can't be edited`.
  - `diff-pane.test.jsx`: `clicking a line calls onLine with its new line number` (context/add lines only; deleted lines don't).
  - `view-git-actions.test.jsx`: `Edit opens the focused file and Diff returns`; `asks before leaving unsaved edits` (confirm → false keeps the editor and text; true switches); `clicking a diff line opens Edit at that line`.
- [ ] **Step 2: Run** `npx vitest run src/views/git/file-editor.test.jsx src/views/git/diff-pane.test.jsx src/views/git/view-git-actions.test.jsx`. Expected: new tests FAIL. (Note: `view-git-actions.test.jsx` currently fails before any change on `localStorage` being undefined under jsdom; if that is still so, find why `localStorage` is missing in that environment, fix the test setup first, and commit that separately as `test(desktop): give jsdom a localStorage`.)
- [ ] **Step 3: Implement** the component, the switch, `onLine`, the guard and `beforeunload`.
- [ ] **Step 4: Run** the three test files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): edit files from the Git Workspace with a Diff | Edit switch`.

### Task 6: Go to file (Ctrl+P)

**Files:**
- Create: `packages/core/src/modules/git/file-filter.js` (+ export from `packages/core/src/modules/git/index.js`), `apps/desktop/src/views/git/go-to-file.jsx`
- Modify: `apps/desktop/src/views/git/worktree-panel.jsx` (button **Go to file** in the panel head with title `Ctrl+P`; Ctrl+P keydown on the panel while the Git Workspace is shown)
- Test: `packages/core/src/modules/git/file-filter.test.js`, `apps/desktop/src/views/git/go-to-file.test.jsx`

**Interfaces:**
- Consumes: Task 2 `adapter.files`; Task 5 panel `openFile(path, line = null)` (runs `confirmDiscard` then sets `editor` and `mode: 'edit'`).
- Produces:
  - `filterFiles(files: string[], query: string, limit = 50): string[]` — case-insensitive subsequence match on the path; rank: basename contains the query as a substring first, then shorter matched span, then shorter path, then alphabetical. Empty query ⇒ first `limit` files.
  - `GoToFile({ adapter, repo, worktreePath, registered, onOpen, onClose })` — `PlModal` from `@nexusmd/ui` with a text input (autofocus) and a `role="listbox"` of results; ↑/↓ move, Enter opens, Esc closes; "Loading files…" while listing; "Showing the first 50,000 files." when `truncated`.
- [ ] **Step 1: Write failing tests:**
  - `file-filter.test.js`: `matches a subsequence case-insensitively`; `ranks basename matches first` (`['src/app/view.jsx','src/views/git/view-git.jsx','docs/vgit.md']` with `'view'` → `view.jsx` path first); `caps the list and the matches` (60 000 generated paths, `limit 50` → 50 results in under 200 ms).
  - `go-to-file.test.jsx`: `filters as you type and opens with Enter` → `onOpen('src/views/git/view-git.jsx')`; `Esc closes`.
- [ ] **Step 2: Run** `npx vitest run src/modules/git/file-filter.test.js` in `packages/core` and `npx vitest run src/views/git/go-to-file.test.jsx` in `apps/desktop`. Expected: FAIL.
- [ ] **Step 3: Implement** `filterFiles`, `GoToFile`, the button and the shortcut.
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): Go to file (Ctrl+P) in the Git Workspace`.

### Task 7: Verify in the running app

- [ ] **Step 1:** `npx vitest run` in `apps/desktop` and in `packages/core`. Expected: all new tests pass; record any failures that also fail on `master`.
- [ ] **Step 2:** `npx vite build` then `npx electron .` in `apps/desktop`. In the Git Workspace: focus a changed file → Edit → change a line → Ctrl+S → the diff shows the edit. Ctrl+P → type part of an unchanged file's name → Enter → edit → Save → it appears in the changes list. Edit a CRLF file and confirm `git diff` shows only the edited line. Edit a file, change it in another editor, Save → the conflict choices appear.
- [ ] **Step 3: Commit** any fixes found, each with its own test.
