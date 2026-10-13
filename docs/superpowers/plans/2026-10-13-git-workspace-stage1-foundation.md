# Git Workspace — Stage 1 (Foundation and workspace overview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A desktop-only Git Workspace module that shows registered repositories' worktrees and status, organised into project groups with a tree-based group editor and repository discovery — read-only.

**Architecture:** Electron main (`electron/ipc/git.cjs`) runs the `git` CLI for a fixed set of named operations, validating every repo path against the registered list the renderer sends. `@nexusmd/core` (`modules/git/`) holds pure parsers, the snapshot loader, the group model and the group-draft editor model, all unit-tested without Electron. The desktop renderer adds a thin adapter, profile-scoped settings, a polling hook, the view, the group editor and a settings card.

**Tech Stack:** Electron 43 (CommonJS main), React 18 + Vite renderer (ESM), `@nexusmd/core` (ESM, no build), Vitest 4 + Testing Library (no jest-dom), git CLI.

**Spec:** `docs/superpowers/specs/2026-10-13-git-workspace-design.md` (Stage 1 section is the contract; read Decisions and Stage 1 in full before starting).

## Global Constraints

- Work on branch `feature/git-workspace` (Task 1 creates it from `master`). Never commit unrelated files; stage only the paths each task names.
- Code style (`WRITING_MODULES.md`): no semicolons in `.js`/`.jsx` ESM files; semicolons in `.cjs` files; new files under `apps/desktop/electron/` must be `.cjs`; minimal comments that explain *why*; JSDoc on exported functions whose parameters aren't obvious.
- `packages/core` never imports from any app. Core is ESM-only, consumed as source.
- The module is desktop-only: `registerModule({ id: 'git', name: 'Git Workspace', requiredAdapters: ['git'], defaultEnabled: false, … })`; `createNoOpAdapters()` must not gain a `git` key.
- Stage 1 is read-only: no git command that writes (no `fetch`, `add`, `commit`, `checkout`, `worktree add/remove/prune`, `config`, etc.).
- Git process rules (main): argv arrays only (never a shell string); `windowsHide: true`; env adds `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` and removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`; 30 s timeout with `taskkill /PID <pid> /T /F`; at most 6 concurrent git processes.
- Settings key: `getProfileKey('git.config')`; change event `nexusmd:git-config`; default search root `C:/repos` when `roots` is `null`; `[]` means no discovery.
- "All projects" is a reserved group name (case-insensitive); repo and group names are unique case-insensitively.
- Poll interval 10 000 ms; poll skipped while one is in flight; only the newest response writes state.
- Test commands (run from `C:\repos\NexusMD-Mono`):
  - core: `npm -w packages/core test -- <path-or-name-filter>`
  - desktop: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- <path-or-name-filter>` (Node ≥ 22 needs the flag; this machine runs Node 26)
  - full: `npm -w packages/core test` and `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test`
- Commit messages end with your session's Co-Authored-By attribution line.

**Deviations from the spec, decided while planning (recorded in the spec by Task 12):**
- Discovery marker rules and de-duplication live in `git.cjs` (main cannot `require()` ESM `@nexusmd/core`); core has no `discovery.js`. `uniqueName` lives in `groups.js`.
- `discover(roots, repos)` takes registered repos as `{ name, path }` (it reports `registeredAs`).
- Extra read-only operation `checkFolders(paths)` → `[{ path, exists }]` for the settings card's "not found" list.
- The adapter's async `version()` reports whether `git` runs (`null` = not found); `isAvailable()` stays the sync "desktop bridge present" check, as for devenv.
- No enable/disable toggle on the settings card: like devenv, the module is gated purely by the adapter and the nav entry is always present on desktop.

## Review Focus

1. File and worktree paths containing spaces, brackets, unicode or a leading `-` → shown exactly as git reports them (Task 1 parser tests).
2. One repository whose `git status` fails (e.g. a locked or corrupt index) while others are fine → only that worktree shows the error; the rest load (Task 2 test).
3. A renderer request for a worktree path that is outside the repo folder and not in its `git worktree list` → rejected in main without running `git status` (Task 5 test).
4. Settings saved in an older or partial shape (missing `groups` arrays, group with no `branches`, unknown keys) → load with defaults filled in, no crash; a newer `version` → explicit "unsupported" state (Task 7 test).
5. Group editor save with a discovered folder whose name differs only by case from a registered repo → registered with a numeric suffix, no duplicate names (Task 4 test).

---

## File Structure

Create:

| File | Responsibility |
|---|---|
| `packages/core/src/modules/git/parse.js` | Parse `status --porcelain=v2 -z`, `worktree list --porcelain -z`, `for-each-ref`; worktree helpers (id, name, branch ref/label, status code) |
| `packages/core/src/modules/git/snapshot.js` | `loadSnapshot(adapter, repos)` with bounded concurrency; `applyStatus`; `worktreeSummary` |
| `packages/core/src/modules/git/groups.js` | Group membership, scoping, change counts, name rules, register/unregister repo, rename/duplicate/delete group |
| `packages/core/src/modules/git/group-draft.js` | `GroupDraft` editor model and `GroupSaveError` |
| `packages/core/src/modules/git/index.js` | Module registration + re-exports |
| `packages/core/src/modules/git/*.test.js` | Core tests |
| `apps/desktop/electron/ipc/git.cjs` (+ `git.test.js`, `git.integration.test.js`) | Named git operations, validation, process control |
| `apps/desktop/src/adapters/git.js` | Renderer adapter |
| `apps/desktop/src/git-config.js` (+ test) | Profile-scoped settings |
| `apps/desktop/src/views/git/use-git-config.js` | Settings hook |
| `apps/desktop/src/views/git/use-git-snapshot.js` (+ test) | Polling hook |
| `apps/desktop/src/views/git/group-editor.jsx` (+ test) | Group editor dialog |
| `apps/desktop/src/views/git/group-tabs.jsx`, `worktree-list.jsx`, `worktree-detail.jsx`, `group-menu.jsx`, `view-git.jsx` (+ `view-git.test.jsx`) | The view |
| `apps/desktop/src/git-settings-card.jsx` (+ test) | Settings card |

Modify: `packages/core/src/adapters/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`, `apps/desktop/electron/preload.cjs`, `apps/desktop/electron/main.cjs`, `apps/desktop/src/main.jsx`, `apps/desktop/src/nav-config.js`, `apps/desktop/src/desktop-settings.jsx`, `apps/desktop/e2e/smoke.spec.js`, the spec.

---

### Task 1: Branch and core parsers

**Files:**
- Create: `packages/core/src/modules/git/parse.js`, `packages/core/src/modules/git/parse.test.js`

**Interfaces:**
- Produces:
  - `GIT_AREAS = { STAGED: 'staged', UNSTAGED: 'unstaged', CONFLICT: 'conflict', UNTRACKED: 'untracked' }`
  - `parseStatus(output) → { branch, head, upstream, ahead, behind, changes: Change[] }` where `Change = { path, originalPath, xy, area, sub, id }`
  - `parseWorktrees(output, repo, commonDir) → Worktree[]` where `Worktree = { repo, repoRoot, path, commonDir, branch, head, rebasingBranch, upstream, upstreamGone, ahead, behind, operation, error, locked, prunable, fetchedAt, changes }` (`repo` is the repo name, `repoRoot` its path)
  - `parseBranches(output, repo, commonDir) → Branch[]` where `Branch = { repo, commonDir, ref, head, subject, upstream, name, id }`
  - `worktreeId(tree) → string` (path with `/` separators, no trailing slash), `worktreeName(tree) → string`, `activeBranchRef(tree) → string|null`, `branchLabel(tree) → string`, `statusCode(change) → string` (2 chars)

- [ ] **Step 1: Create the branch**

```bash
cd /c/repos/NexusMD-Mono
git switch -c feature/git-workspace
```

- [ ] **Step 2: Write the failing tests**

`packages/core/src/modules/git/parse.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseStatus, parseWorktrees, parseBranches, statusCode, worktreeId, worktreeName, activeBranchRef, branchLabel } from './parse.js'

const REPO = { name: 'Test', path: 'C:/repos/Test' }

describe('parseStatus', () => {
  it('reads branch info and keeps staged and unstaged sides as separate changes', () => {
    const out = '# branch.oid abc\0# branch.head actual-branch\0# branch.upstream origin/main\0# branch.ab +2 -3\0' +
      '1 MM N... 100644 100644 100644 abc abc space [a].txt\0' +
      '2 R. N... 100644 100644 100644 abc abc R100 new name.txt\0old name.txt\0' +
      '? unknown ü.txt\0'
    const s = parseStatus(out)
    expect([s.branch, s.head, s.upstream, s.ahead, s.behind]).toEqual(['actual-branch', 'abc', 'origin/main', 2, 3])
    expect(s.changes.map(c => [c.area, c.path])).toEqual([
      ['staged', 'space [a].txt'], ['unstaged', 'space [a].txt'], ['staged', 'new name.txt'], ['untracked', 'unknown ü.txt'],
    ])
    expect(s.changes[2].originalPath).toBe('old name.txt')
    expect(new Set(s.changes.map(c => c.id)).size).toBe(4)
  })

  it('reports conflicts, a detached unborn HEAD, no upstream and leading-dash paths', () => {
    const s = parseStatus('# branch.oid (initial)\0# branch.head (detached)\0u UU N... 100644 100644 100644 100644 a b c -dash.txt\0')
    expect([s.branch, s.upstream, s.ahead, s.behind]).toEqual(['(detached)', null, 0, 0])
    expect(s.changes).toHaveLength(1)
    expect(s.changes[0]).toMatchObject({ area: 'conflict', path: '-dash.txt', xy: 'UU' })
  })

  it('treats a submodule with modified content as an unstaged change', () => {
    const s = parseStatus('1 .. S.M. 160000 160000 160000 a a vendor/lib\0')
    expect(s.changes.map(c => c.area)).toEqual(['unstaged'])
  })

  it('returns an empty result for empty output', () => {
    expect(parseStatus('')).toEqual({ branch: '(detached)', head: '', upstream: null, ahead: 0, behind: 0, changes: [] })
  })
})

describe('statusCode', () => {
  it('shows the staged side on the left and the unstaged side on the right', () => {
    expect(statusCode({ area: 'untracked', xy: '??' })).toBe('??')
    expect(statusCode({ area: 'conflict', xy: 'UU' })).toBe('UU')
    expect(statusCode({ area: 'staged', xy: 'R.' })).toBe('R ')
    expect(statusCode({ area: 'unstaged', xy: '.D' })).toBe(' D')
    expect(statusCode({ area: 'unstaged', xy: '..' })).toBe(' M')
  })
})

describe('parseWorktrees', () => {
  const out = 'worktree C:/repos/Test/.git-main\0bare\0\0' +
    'worktree C:/other/location\0HEAD abc\0detached\0locked keep me\0\0' +
    'worktree C:/repos/Test/topic dir\0HEAD def\0branch refs/heads/topic/x\0prunable gitdir file points to non-existent location\0\0'

  it('skips the bare entry and keeps detached, locked and prunable worktrees', () => {
    const trees = parseWorktrees(out, REPO, 'C:/repos/Test/.git-main')
    expect(trees).toHaveLength(2)
    expect(trees[0]).toMatchObject({ repo: 'Test', repoRoot: 'C:/repos/Test', commonDir: 'C:/repos/Test/.git-main', branch: '(detached)', head: 'abc', locked: 'keep me' })
    expect(trees[1]).toMatchObject({ branch: 'topic/x', head: 'def' })
    expect(trees[1].prunable).toMatch(/^gitdir file/)
    expect(trees[1].changes).toEqual([])
  })

  it('names worktrees relative to the repo folder', () => {
    const [external, topic] = parseWorktrees(out, REPO, 'x')
    expect(worktreeName(external)).toBe('C:/other/location')
    expect(worktreeName(topic)).toBe('topic dir')
    expect(worktreeName({ path: 'C:\\repos\\Test\\', repoRoot: 'C:/repos/test' })).toBe('checkout')
    expect(worktreeId({ path: 'C:\\repos\\Test\\a\\' })).toBe('C:/repos/Test/a')
  })

  it('works out the active branch ref, preferring the branch being rebased', () => {
    const [external, topic] = parseWorktrees(out, REPO, 'x')
    expect(activeBranchRef(topic)).toBe('refs/heads/topic/x')
    expect(activeBranchRef(external)).toBeNull()
    expect(activeBranchRef({ ...external, rebasingBranch: 'refs/heads/feature' })).toBe('refs/heads/feature')
    expect(branchLabel({ ...external, rebasingBranch: 'refs/heads/feature' })).toBe('feature (rebasing)')
    expect(branchLabel(topic)).toBe('topic/x')
  })
})

describe('parseBranches', () => {
  it('reads NUL-separated for-each-ref lines', () => {
    const b = parseBranches('refs/heads/main\0abc\0Initial\0origin/main\nrefs/heads/topic\0def\0Fix [x]\0\n', REPO, 'C:/c')
    expect(b).toEqual([
      { repo: 'Test', commonDir: 'C:/c', ref: 'refs/heads/main', head: 'abc', subject: 'Initial', upstream: 'origin/main', name: 'main', id: 'b:Test:refs/heads/main' },
      { repo: 'Test', commonDir: 'C:/c', ref: 'refs/heads/topic', head: 'def', subject: 'Fix [x]', upstream: null, name: 'topic', id: 'b:Test:refs/heads/topic' },
    ])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm -w packages/core test -- src/modules/git/parse.test.js`
Expected: FAIL — `Failed to resolve import "./parse.js"`.

- [ ] **Step 4: Implement**

`packages/core/src/modules/git/parse.js`:

```js
// Parsers for git's machine-readable output. Ported from gws (Git.ParseStatus,
// Git.ParseWorktrees, History.Branches) so both tools read git the same way.

export const GIT_AREAS = Object.freeze({ STAGED: 'staged', UNSTAGED: 'unstaged', CONFLICT: 'conflict', UNTRACKED: 'untracked' })

const change = (path, originalPath, xy, area, sub) => ({ path, originalPath, xy, area, sub, id: `${area}\0${path}` })

function splitN(s, sep, n) {
  const out = []
  let start = 0
  while (out.length < n - 1) {
    const i = s.indexOf(sep, start)
    if (i < 0) break
    out.push(s.slice(start, i))
    start = i + 1
  }
  out.push(s.slice(start))
  return out
}

/**
 * Parses `git status --porcelain=v2 --branch -z --untracked-files=all`.
 * A file changed on both the staged and unstaged side yields two changes.
 */
export function parseStatus(output) {
  const result = { branch: '(detached)', head: '', upstream: null, ahead: 0, behind: 0, changes: [] }
  const records = (output || '').split('\0')
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.startsWith('# branch.head ')) result.branch = r.slice(14)
    else if (r.startsWith('# branch.oid ')) result.head = r.slice(13)
    else if (r.startsWith('# branch.upstream ')) result.upstream = r.slice(18)
    else if (r.startsWith('# branch.ab ')) {
      const [ahead, behind] = r.slice(12).split(' ')
      result.ahead = Number(ahead.slice(1))
      result.behind = Number(behind.slice(1))
    }
    else if (r.startsWith('? ')) result.changes.push(change(r.slice(2), null, '??', GIT_AREAS.UNTRACKED, 'N...'))
    else if (/^[12u] /.test(r)) {
      const kind = r[0]
      const parts = splitN(r, ' ', kind === '1' ? 9 : kind === '2' ? 10 : 11)
      const path = parts[parts.length - 1]
      const xy = parts[1]
      const sub = parts[2]
      // Renames carry the original path as the next NUL-separated record.
      const original = kind === '2' ? records[++i] : null
      if (kind === 'u') result.changes.push(change(path, original, xy, GIT_AREAS.CONFLICT, sub))
      else {
        if (xy[0] !== '.') result.changes.push(change(path, original, xy, GIT_AREAS.STAGED, sub))
        if (xy[1] !== '.' || (sub.startsWith('S') && sub !== 'S...')) result.changes.push(change(path, original, xy, GIT_AREAS.UNSTAGED, sub))
      }
    }
  }
  return result
}

/** Two-letter status: staged side on the left, unstaged side on the right. */
export function statusCode(c) {
  if (c.area === GIT_AREAS.UNTRACKED) return '??'
  if (c.area === GIT_AREAS.CONFLICT) return c.xy.replace(/\./g, ' ').padEnd(2).slice(0, 2)
  if (c.area === GIT_AREAS.STAGED) return `${c.xy[0] === '.' ? 'M' : c.xy[0]} `
  return ` ${c.xy.length > 1 && c.xy[1] !== '.' ? c.xy[1] : 'M'}`
}

function newWorktree(repo, commonDir, path) {
  return {
    repo: repo.name, repoRoot: repo.path, path, commonDir,
    branch: '(detached)', head: '', rebasingBranch: null, upstream: null, upstreamGone: false,
    ahead: 0, behind: 0, operation: '', error: '', locked: null, prunable: null, fetchedAt: null, changes: [],
  }
}

/** Parses `git worktree list --porcelain -z`; the bare entry of a bare repository is skipped. */
export function parseWorktrees(output, repo, commonDir) {
  const trees = []
  let current = null
  let bare = false
  const flush = () => { if (current && !bare) trees.push(current); current = null }
  for (const field of (output || '').split('\0')) {
    if (field.startsWith('worktree ')) { flush(); current = newWorktree(repo, commonDir, field.slice(9)); bare = false }
    else if (current) {
      if (field === 'bare') bare = true
      else if (field.startsWith('branch ')) current.branch = field.slice(7).replace(/^refs\/heads\//, '')
      else if (field.startsWith('HEAD ')) current.head = field.slice(5)
      else if (field.startsWith('locked')) current.locked = field.length > 7 ? field.slice(7) : 'Locked'
      else if (field.startsWith('prunable')) current.prunable = field.length > 9 ? field.slice(9) : 'Stale registration'
      else if (field === '') flush()
    }
  }
  flush()
  return trees
}

/** Parses `git for-each-ref --format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short) refs/heads/`. */
export function parseBranches(output, repo, commonDir) {
  return (output || '').split('\n')
    .map(line => line.replace(/\r$/, '').split('\0'))
    .filter(p => p.length === 4 && !p[0].endsWith('/HEAD'))
    .map(([ref, head, subject, upstream]) => ({
      repo: repo.name, commonDir, ref, head, subject, upstream: upstream || null,
      name: ref.replace(/^refs\/heads\//, ''), id: `b:${repo.name}:${ref}`,
    }))
}

const slashes = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')

export function worktreeId(tree) {
  return slashes(tree.path)
}

export function worktreeName(tree) {
  const path = slashes(tree.path)
  const root = slashes(tree.repoRoot)
  if (path.toLowerCase() === root.toLowerCase()) return 'checkout'
  if (path.toLowerCase().startsWith(root.toLowerCase() + '/')) return path.slice(root.length + 1)
  return path
}

export function activeBranchRef(tree) {
  return tree.rebasingBranch ?? (tree.branch === '(detached)' ? null : `refs/heads/${tree.branch}`)
}

export function branchLabel(tree) {
  return tree.rebasingBranch ? `${tree.rebasingBranch.replace(/^refs\/heads\//, '')} (rebasing)` : tree.branch
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm -w packages/core test -- src/modules/git/parse.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/git/parse.js packages/core/src/modules/git/parse.test.js
git commit -m "feat(core): git porcelain, worktree and branch parsers"
```

---

### Task 2: Snapshot loader, adapter contract and module registration

**Files:**
- Create: `packages/core/src/modules/git/snapshot.js`, `packages/core/src/modules/git/snapshot.test.js`, `packages/core/src/modules/git/index.js`
- Modify: `packages/core/src/adapters/index.js` (after `IDevenvAdapter`), `packages/core/src/index.js` (adapter export list near `IDevenvAdapter`; new module export block), `packages/core/tests/public-api.test.js` (`EXPECTED`)

**Interfaces:**
- Consumes: Task 1 parsers.
- Produces:
  - `IGitAdapter` contract: `isAvailable()` (sync), `version()` → `string|null`, `resolve(dir)` → `{ commonDir }`, `worktrees(repo, registered)` → raw text, `status(repo, worktreePath, registered)` → `{ porcelain, operation, rebasingBranch, fetchedAt, upstreamResolves } | { missing: true } | { error }`, `branches(repo, registered)` → raw text, `discover(roots, repos)` → `[{ name, path, commonDir, registeredAs }]`, `checkFolders(paths)` → `[{ path, exists }]`. `repo` = `{ name, path }`; `registered` = array of registered repo paths (strings).
  - `loadSnapshot(adapter, repos, { concurrency = 4, now } = {})` → `Promise<{ worktrees, branches, errors: [{ repo, message }], takenAt }>`
  - `applyStatus(tree, statusResult)` → tree; `worktreeSummary(tree)` → `{ changed, staged }`
  - `getGitAdapter()`; module id `'git'`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/modules/git/snapshot.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { loadSnapshot, worktreeSummary } from './snapshot.js'
import { createNoOpAdapters } from '../../adapters/defaults.js'
import { getRegistry } from '../../features/module-registry.js'
import './index.js'

const repos = [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }, { name: 'C', path: 'C:/repos/C' }]

function fakeAdapter() {
  return {
    resolve: vi.fn(async dir => {
      if (dir.endsWith('C')) throw new Error('No repository at C:/repos/C')
      return { commonDir: `${dir}/.git` }
    }),
    worktrees: vi.fn(async repo => repo.name === 'A'
      ? `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0worktree ${repo.path}/locked\0HEAD b\0branch refs/heads/x\0\0worktree ${repo.path}/gone\0HEAD c\0branch refs/heads/y\0prunable gitdir missing\0\0`
      : `worktree ${repo.path}\0HEAD d\0branch refs/heads/main\0\0`),
    status: vi.fn(async (repo, path) => {
      if (path.endsWith('/locked')) return { error: 'fatal: Unable to create index.lock' }
      if (path.endsWith('/gone')) return { missing: true }
      return {
        porcelain: '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\01 .M N... 100644 100644 100644 a a f.txt\0? n.txt\0',
        operation: '', rebasingBranch: null, fetchedAt: '2026-10-13T08:00:00.000Z', upstreamResolves: false,
      }
    }),
    branches: vi.fn(async () => 'refs/heads/main\0a\0Init\0origin/main\n'),
  }
}

describe('loadSnapshot', () => {
  it('loads every repo, keeps failures local and never reports a broken worktree as clean', async () => {
    const adapter = fakeAdapter()
    const s = await loadSnapshot(adapter, repos, { now: () => new Date('2026-10-13T09:00:00Z') })
    expect(s.takenAt).toBe('2026-10-13T09:00:00.000Z')
    expect(s.errors).toEqual([{ repo: 'C', message: 'No repository at C:/repos/C' }])
    expect(s.worktrees.map(t => t.path)).toEqual(['C:/repos/A', 'C:/repos/A/locked', 'C:/repos/A/gone', 'C:/repos/B'])
    const [main, locked, gone] = s.worktrees
    expect(main).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, upstreamGone: true, fetchedAt: '2026-10-13T08:00:00.000Z', error: '' })
    expect(worktreeSummary(main)).toEqual({ changed: 2, staged: 0 })
    expect(locked.error).toBe('fatal: Unable to create index.lock')
    expect(gone.error).toBe('Missing worktree · stale registration')
    expect(s.branches.map(b => b.id)).toEqual(['b:A:refs/heads/main', 'b:B:refs/heads/main'])
    expect(adapter.worktrees).toHaveBeenCalledWith(repos[0], repos.map(r => r.path))
  })

  it('turns a thrown status call into a worktree error', async () => {
    const adapter = { ...fakeAdapter(), status: vi.fn(async () => { throw new Error('git status timed out after 30s') }) }
    const s = await loadSnapshot(adapter, [repos[1]])
    expect(s.worktrees[0].error).toBe('git status timed out after 30s')
  })

  it('never runs more than the concurrency limit at once', async () => {
    let active = 0, peak = 0
    const adapter = { ...fakeAdapter(), resolve: vi.fn(async dir => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return { commonDir: dir } }) }
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `R${i}`, path: `C:/repos/R${i}` }))
    await loadSnapshot(adapter, many, { concurrency: 3 })
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('git module registration', () => {
  it('registers a desktop-only module that the no-op adapters do not enable', () => {
    const mod = getRegistry().find(m => m.id === 'git')
    expect(mod).toMatchObject({ name: 'Git Workspace', requiredAdapters: ['git'], defaultEnabled: false })
    expect(createNoOpAdapters().git).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w packages/core test -- src/modules/git/snapshot.test.js`
Expected: FAIL — cannot resolve `./snapshot.js`.

- [ ] **Step 3: Implement**

`packages/core/src/modules/git/snapshot.js`:

```js
import { parseStatus, parseWorktrees, parseBranches } from './parse.js'

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

const message = e => e?.message || String(e)

/** Merges one `adapter.status` result into a parsed worktree. */
export function applyStatus(tree, s) {
  if (s?.error) { tree.error = s.error; return tree }
  if (s?.missing) { tree.error = `Missing worktree${tree.prunable ? ' · stale registration' : ''}`; return tree }
  const p = parseStatus(s?.porcelain || '')
  Object.assign(tree, {
    branch: p.branch, head: p.head || tree.head, upstream: p.upstream, ahead: p.ahead, behind: p.behind, changes: p.changes,
    upstreamGone: !!p.upstream && !s.upstreamResolves,
    operation: s.operation || '', rebasingBranch: s.rebasingBranch || null, fetchedAt: s.fetchedAt || null,
  })
  return tree
}

export function worktreeSummary(tree) {
  return {
    changed: new Set(tree.changes.map(c => c.path)).size,
    staged: tree.changes.filter(c => c.area === 'staged').length,
  }
}

/**
 * Reads every registered repo through the git adapter. A repo that fails is reported in
 * `errors`; a worktree whose status fails carries `error` — neither stops the others.
 * @param {{ concurrency?: number, now?: () => Date }} [options]
 */
export async function loadSnapshot(adapter, repos, { concurrency = 4, now = () => new Date() } = {}) {
  const registered = repos.map(r => r.path)
  const perRepo = await mapLimit(repos, concurrency, async repo => {
    try {
      const { commonDir } = await adapter.resolve(repo.path)
      const trees = parseWorktrees(await adapter.worktrees(repo, registered), repo, commonDir)
      await mapLimit(trees, concurrency, async tree => {
        let s
        try { s = await adapter.status(repo, tree.path, registered) } catch (e) { s = { error: message(e) } }
        applyStatus(tree, s)
      })
      const branches = parseBranches(await adapter.branches(repo, registered), repo, commonDir)
      return { trees, branches, error: null }
    } catch (e) {
      return { trees: [], branches: [], error: { repo: repo.name, message: message(e) } }
    }
  })
  return {
    worktrees: perRepo.flatMap(r => r.trees),
    branches: perRepo.flatMap(r => r.branches),
    errors: perRepo.filter(r => r.error).map(r => r.error),
    takenAt: now().toISOString(),
  }
}
```

`packages/core/src/modules/git/index.js`:

```js
// packages/core/src/modules/git/index.js
//
// Git Workspace — local repositories, their worktrees and project groups. Pure logic only;
// git runs in the Electron main process through the desktop-only `git` adapter.

import { registerModule } from '../../features/module-registry.js'

export {
  GIT_AREAS, parseStatus, parseWorktrees, parseBranches, statusCode,
  worktreeId, worktreeName, activeBranchRef, branchLabel,
} from './parse.js'
export { loadSnapshot, applyStatus, worktreeSummary } from './snapshot.js'

let _adapter = null

export function getGitAdapter() {
  return _adapter
}

registerModule({
  id: 'git',
  name: 'Git Workspace',
  // Desktop-only: running git needs the Electron main process.
  requiredAdapters: ['git'],
  defaultEnabled: false,
  init(adapters) {
    _adapter = adapters.git
  },
  async load() {
    return {}
  },
  dispose() {
    _adapter = null
  },
})
```

In `packages/core/src/adapters/index.js`, after the `IDevenvAdapter` block, add:

```js
// Desktop-only: runs the git CLI in the Electron main process for the Git Workspace module.
// Deliberately absent from createNoOpAdapters() so the module is gated to platforms that
// supply it. `registered` is the list of registered repo paths; main rejects anything else.
export const IGitAdapter = {
  isAvailable: () => false,
  version:      async () => null,
  resolve:      async (dir) => Promise.reject(new Error('IGitAdapter.resolve not implemented')),
  worktrees:    async (repo, registered) => Promise.reject(new Error('IGitAdapter.worktrees not implemented')),
  status:       async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.status not implemented')),
  branches:     async (repo, registered) => Promise.reject(new Error('IGitAdapter.branches not implemented')),
  discover:     async (roots, repos) => [],
  checkFolders: async (paths) => [],
}
```

In `packages/core/src/index.js`: add `IGitAdapter` to the adapter export list right after `IDevenvAdapter` (line ~9), and append:

```js
export {
  getGitAdapter, GIT_AREAS, parseStatus, parseWorktrees, parseBranches, statusCode,
  worktreeId, worktreeName, activeBranchRef, branchLabel,
  loadSnapshot, applyStatus, worktreeSummary,
} from './modules/git/index.js'
```

In `packages/core/tests/public-api.test.js`, add to `EXPECTED` (after the devenv entries):

```js
  // Git Workspace module (desktop-only: requires the `git` adapter)
  'IGitAdapter', 'getGitAdapter', 'GIT_AREAS', 'parseStatus', 'parseWorktrees', 'parseBranches', 'statusCode',
  'worktreeId', 'worktreeName', 'activeBranchRef', 'branchLabel', 'loadSnapshot', 'applyStatus', 'worktreeSummary',
```

- [ ] **Step 4: Run to verify pass**

Run: `npm -w packages/core test -- src/modules/git` then `npm -w packages/core test -- tests/public-api.test.js`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/git/snapshot.js packages/core/src/modules/git/snapshot.test.js packages/core/src/modules/git/index.js packages/core/src/adapters/index.js packages/core/src/index.js packages/core/tests/public-api.test.js
git commit -m "feat(core): git snapshot loader, IGitAdapter contract and module registration"
```

---

### Task 3: Group membership, scoping and repo registration

**Files:**
- Create: `packages/core/src/modules/git/groups.js`, `packages/core/src/modules/git/groups.test.js`
- Modify: `packages/core/src/modules/git/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces:**
- Consumes: `worktreeId`, `activeBranchRef` (Task 1).
- Produces (config shape `{ version: 1, repos: [{ name, path }], groups: [{ name, repos: string[], worktrees: string[], branches: [{ repo, ref }] }], roots, view }`):
  - `ALL_PROJECTS = 'All projects'`
  - `findGroup(config, name)` → group | `null` (null for All projects or unknown)
  - `groupIncludesWorktree(group, tree)`, `groupIncludesBranch(group, branch)` (null group = everything)
  - `scopeSnapshot(snapshot, group)` → `{ worktrees, inactiveBranches }`
  - `changeCount(snapshot, group, { showUntracked = true } = {})` → number
  - `uniqueName(name, taken)` → string
  - `groupNameError(config, name, existingName = null)` → string | null
  - `renameGroup(config, oldName, newName)`, `duplicateGroup(config, name, newName)`, `deleteGroup(config, name)` → new config (throw `Error` on invalid name)
  - `registerRepo(config, path, adapter)` → `Promise<config>`; `unregisterRepo(config, name)` → config

- [ ] **Step 1: Write the failing tests**

`packages/core/src/modules/git/groups.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import {
  ALL_PROJECTS, findGroup, groupIncludesWorktree, groupIncludesBranch, scopeSnapshot, changeCount,
  uniqueName, groupNameError, renameGroup, duplicateGroup, deleteGroup, registerRepo, unregisterRepo,
} from './groups.js'

const tree = (repo, path, branch, changes = []) => ({ repo, repoRoot: `C:/repos/${repo}`, path, branch, rebasingBranch: null, changes })
const snapshot = {
  worktrees: [
    tree('A', 'C:/repos/A', 'main', [{ path: 'x', area: 'unstaged' }, { path: 'x', area: 'staged' }, { path: 'u', area: 'untracked' }]),
    tree('A', 'C:/repos/A/feature', 'feature/qr', [{ path: 'y', area: 'unstaged' }]),
    tree('B', 'C:/repos/B', 'main', [{ path: 'z', area: 'unstaged' }]),
  ],
  branches: [
    { repo: 'A', ref: 'refs/heads/main', id: 'b:A:refs/heads/main' },
    { repo: 'A', ref: 'refs/heads/feature/qr', id: 'b:A:refs/heads/feature/qr' },
    { repo: 'B', ref: 'refs/heads/parked', id: 'b:B:refs/heads/parked' },
  ],
}
const group = { name: 'QR', repos: [], worktrees: ['C:/repos/B'], branches: [{ repo: 'A', ref: 'refs/heads/feature/qr' }, { repo: 'B', ref: 'refs/heads/parked' }] }
const config = { version: 1, repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }], groups: [group], roots: null, view: {} }

describe('group membership', () => {
  it('matches whole repos, fixed worktree paths and branches that follow their checkout', () => {
    expect(groupIncludesWorktree(null, snapshot.worktrees[0])).toBe(true)
    expect(snapshot.worktrees.map(t => groupIncludesWorktree(group, t))).toEqual([false, true, true])
    expect(groupIncludesWorktree({ ...group, repos: ['A'] }, snapshot.worktrees[0])).toBe(true)
    expect(groupIncludesBranch(group, snapshot.branches[2])).toBe(true)
    expect(groupIncludesBranch(null, snapshot.branches[2])).toBe(false)
  })

  it('scopes a snapshot and lists only branch members that are not checked out', () => {
    const s = scopeSnapshot(snapshot, group)
    expect(s.worktrees.map(t => t.path)).toEqual(['C:/repos/A/feature', 'C:/repos/B'])
    expect(s.inactiveBranches.map(b => b.id)).toEqual(['b:B:refs/heads/parked'])
    expect(scopeSnapshot(snapshot, null).inactiveBranches).toEqual([])
    expect(scopeSnapshot(null, group)).toEqual({ worktrees: [], inactiveBranches: [] })
  })

  it('counts distinct changed paths, optionally without untracked files', () => {
    expect(changeCount(snapshot, null)).toBe(4)
    expect(changeCount(snapshot, null, { showUntracked: false })).toBe(3)
    expect(changeCount(snapshot, group)).toBe(2)
  })

  it('finds groups by name and treats All projects as no group', () => {
    expect(findGroup(config, 'QR')).toBe(group)
    expect(findGroup(config, ALL_PROJECTS)).toBeNull()
    expect(findGroup(config, 'missing')).toBeNull()
  })
})

describe('group names', () => {
  it('rejects blank, reserved and duplicate names case-insensitively', () => {
    expect(groupNameError(config, ' ')).toMatch(/name/)
    expect(groupNameError(config, 'all PROJECTS')).toMatch(/All projects/)
    expect(groupNameError(config, 'qr')).toMatch(/already exists/)
    expect(groupNameError(config, 'qr', 'QR')).toBeNull()
    expect(uniqueName('joiners', ['Joiners', 'joiners 2'])).toBe('joiners 3')
    expect(uniqueName('New', [])).toBe('New')
  })

  it('renames, duplicates and deletes without mutating the input', () => {
    const renamed = renameGroup(config, 'QR', 'Secure QR')
    expect(renamed.groups.map(g => g.name)).toEqual(['Secure QR'])
    expect(config.groups[0].name).toBe('QR')
    const copy = duplicateGroup(config, 'QR', 'QR copy')
    expect(copy.groups.map(g => g.name)).toEqual(['QR', 'QR copy'])
    copy.groups[1].branches.push({ repo: 'X', ref: 'y' })
    expect(group.branches).toHaveLength(2)
    expect(deleteGroup(config, 'QR').groups).toEqual([])
    expect(() => renameGroup(config, 'QR', 'All projects')).toThrow(/All projects/)
  })
})

describe('repo registration', () => {
  it('registers a repository under its folder name, refusing the same repository twice', async () => {
    const adapter = { resolve: vi.fn(async dir => ({ commonDir: dir.toLowerCase().includes('a-clone') ? 'C:/repos/A/.git' : `${dir}/.git` })) }
    const next = await registerRepo(config, 'D:\\src\\a\\', adapter)
    expect(next.repos.at(-1)).toEqual({ name: 'a 2', path: 'D:\\src\\a\\' })
    await expect(registerRepo(config, 'D:/src/a-clone', { resolve: async dir => ({ commonDir: dir.includes('clone') ? 'c:/repos/a/.git/' : 'C:/repos/A/.git' }) }))
      .rejects.toThrow('That repository is already registered as A')
  })

  it('unregisters by name and leaves groups untouched', () => {
    const next = unregisterRepo(config, 'B')
    expect(next.repos.map(r => r.name)).toEqual(['A'])
    expect(next.groups).toBe(config.groups)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w packages/core test -- src/modules/git/groups.test.js`
Expected: FAIL — cannot resolve `./groups.js`.

- [ ] **Step 3: Implement**

`packages/core/src/modules/git/groups.js`:

```js
import { worktreeId, activeBranchRef } from './parse.js'

export const ALL_PROJECTS = 'All projects'

const lower = s => String(s ?? '').toLowerCase()
const samePath = (a, b) => lower(a).replace(/\\/g, '/').replace(/\/+$/, '') === lower(b).replace(/\\/g, '/').replace(/\/+$/, '')

export function findGroup(config, name) {
  if (name === ALL_PROJECTS) return null
  return (config?.groups || []).find(g => g.name === name) || null
}

export function groupIncludesWorktree(group, tree) {
  if (!group) return true
  const ref = activeBranchRef(tree)
  return group.repos.includes(tree.repo) || group.worktrees.includes(worktreeId(tree)) ||
    group.branches.some(b => b.repo === tree.repo && b.ref === ref)
}

export function groupIncludesBranch(group, branch) {
  return !!group && (group.repos.includes(branch.repo) || group.branches.some(b => b.repo === branch.repo && b.ref === branch.ref))
}

/** Worktrees in the group, plus branch members that are not checked out in any worktree. */
export function scopeSnapshot(snapshot, group) {
  const all = snapshot?.worktrees || []
  const worktrees = all.filter(t => groupIncludesWorktree(group, t))
  const checkedOut = new Set(all.map(t => `${t.repo}\0${activeBranchRef(t)}`))
  const inactiveBranches = group
    ? (snapshot?.branches || []).filter(b => group.branches.some(s => s.repo === b.repo && s.ref === b.ref) && !checkedOut.has(`${b.repo}\0${b.ref}`))
    : []
  return { worktrees, inactiveBranches }
}

export function changeCount(snapshot, group, { showUntracked = true } = {}) {
  return scopeSnapshot(snapshot, group).worktrees.reduce((n, t) =>
    n + new Set(t.changes.filter(c => showUntracked || c.area !== 'untracked').map(c => c.path)).size, 0)
}

export function uniqueName(name, taken) {
  const used = new Set(taken.map(lower))
  if (!used.has(lower(name))) return name
  for (let n = 2; ; n++) if (!used.has(lower(`${name} ${n}`))) return `${name} ${n}`
}

/** Returns why `name` can't be used for a group (ignoring the group being renamed), or null. */
export function groupNameError(config, name, existingName = null) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Choose a group name.'
  if (lower(trimmed) === lower(ALL_PROJECTS)) return 'All projects is reserved — choose another name.'
  if ((config.groups || []).some(g => g.name !== existingName && lower(g.name) === lower(trimmed))) return 'A group with that name already exists.'
  return null
}

function checkName(config, name, existingName) {
  const error = groupNameError(config, name, existingName)
  if (error) throw new Error(error)
  return String(name).trim()
}

const copyGroup = g => ({ ...g, repos: [...g.repos], worktrees: [...g.worktrees], branches: g.branches.map(b => ({ ...b })) })

export function renameGroup(config, oldName, newName) {
  const name = checkName(config, newName, oldName)
  return { ...config, groups: config.groups.map(g => g.name === oldName ? { ...copyGroup(g), name } : g) }
}

export function duplicateGroup(config, sourceName, newName) {
  const name = checkName(config, newName)
  const source = config.groups.find(g => g.name === sourceName)
  if (!source) throw new Error(`No group named ${sourceName}`)
  return { ...config, groups: [...config.groups, { ...copyGroup(source), name }] }
}

export function deleteGroup(config, name) {
  return { ...config, groups: config.groups.filter(g => g.name !== name) }
}

/**
 * Registers the repository at `path` under its folder name (suffixed if taken).
 * Refuses a second registration of the same repository, compared by git common dir.
 */
export async function registerRepo(config, path, adapter) {
  const { commonDir } = await adapter.resolve(path)
  for (const repo of config.repos) {
    let other = null
    try { other = (await adapter.resolve(repo.path)).commonDir } catch { /* an unavailable registration can't clash */ }
    if (other && samePath(other, commonDir)) throw new Error(`That repository is already registered as ${repo.name}`)
  }
  const folder = String(path).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return { ...config, repos: [...config.repos, { name: uniqueName(folder, config.repos.map(r => r.name)), path }] }
}

/** Removes a registration only; repository files and saved group entries are untouched. */
export function unregisterRepo(config, name) {
  return { ...config, repos: config.repos.filter(r => r.name !== name) }
}
```

Add to `packages/core/src/modules/git/index.js`:

```js
export {
  ALL_PROJECTS, findGroup, groupIncludesWorktree, groupIncludesBranch, scopeSnapshot, changeCount,
  uniqueName, groupNameError, renameGroup, duplicateGroup, deleteGroup, registerRepo, unregisterRepo,
} from './groups.js'
```

Add the same 13 names to the git export block in `packages/core/src/index.js` and to `EXPECTED` in `packages/core/tests/public-api.test.js` (the git line from Task 2).

- [ ] **Step 4: Run to verify pass**

Run: `npm -w packages/core test -- src/modules/git` and `npm -w packages/core test -- tests/public-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/git/groups.js packages/core/src/modules/git/groups.test.js packages/core/src/modules/git/index.js packages/core/src/index.js packages/core/tests/public-api.test.js
git commit -m "feat(core): git workspace groups, scoping and repo registration"
```

---

### Task 4: Group draft (editor model)

**Files:**
- Create: `packages/core/src/modules/git/group-draft.js`, `packages/core/src/modules/git/group-draft.test.js`
- Modify: `packages/core/src/modules/git/index.js`, `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`

**Interfaces:**
- Consumes: `worktreeId`, `worktreeName`, `branchLabel` (Task 1); `ALL_PROJECTS`, `uniqueName`, `groupNameError` (Task 3).
- Produces:
  - `class GroupSaveError extends Error` with `memberId`
  - `class GroupDraft(config, snapshot, existing = null)` with:
    - `members` (`{ kind: 'repo'|'worktree'|'branch'|'new-repo', repo, value, label, id }[]`), `checked: Set<id>`, `branchesShown: Set<repoName>`
    - `addDiscovered(found)`; `inherited(member)`; `toggle(member)` (throws `Error` for inherited members); `state(repo)` → `'none'|'some'|'whole'`; `toggleWhole(repo)`; `rows(search = '', folded = new Set())` → members in display order
    - `async commit(config, name, existing, resolve)` → `{ config, group }` (pure — never mutates its inputs; throws `Error` or `GroupSaveError`)
  - For `new-repo` members, `repo` and `value` are the folder path and `label` is the folder name.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/modules/git/group-draft.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { GroupDraft, GroupSaveError } from './group-draft.js'

const tree = (repo, path, branch) => ({ repo, repoRoot: `C:/repos/${repo}`, path, branch, rebasingBranch: null, error: '', changes: [] })
const snapshot = {
  worktrees: [tree('AccessControl', 'C:/repos/AccessControl', 'main'), tree('AccessControl', 'C:/repos/AccessControl/qr', 'feature/qr'), tree('Joiners', 'C:/repos/Joiners', 'main')],
  branches: [{ repo: 'Joiners', ref: 'refs/heads/main', name: 'main' }, { repo: 'Joiners', ref: 'refs/heads/topic', name: 'topic' }],
}
const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }, { name: 'Joiners', path: 'C:/repos/Joiners' }], groups: [], roots: null, view: {} }
const resolve = vi.fn(async () => ({ commonDir: 'x' }))
const find = (d, kind, repo) => d.members.find(m => m.kind === kind && m.repo === repo)

describe('GroupDraft', () => {
  it('registers ticked discovered repos with unique names and builds the group', async () => {
    const d = new GroupDraft(config, snapshot)
    d.addDiscovered([
      { name: 'joiners', path: 'D:/src/joiners', commonDir: 'd', registeredAs: null },
      { name: 'Payments', path: 'D:/src/Payments', commonDir: 'p', registeredAs: null },
      { name: 'AccessControl', path: 'C:/repos/AccessControl', commonDir: 'a', registeredAs: 'AccessControl' },
    ])
    expect(d.members.filter(m => m.kind === 'new-repo').map(m => m.label)).toEqual(['joiners', 'Payments'])
    d.members.filter(m => m.kind === 'new-repo').forEach(m => d.toggle(m))
    d.toggle(find(d, 'repo', 'AccessControl'))
    const { config: next, group } = await d.commit(config, '  Payments work ', null, resolve)
    expect(next.repos.map(r => r.name)).toEqual(['AccessControl', 'Joiners', 'joiners 2', 'Payments'])
    expect(group).toEqual({ name: 'Payments work', repos: ['AccessControl', 'joiners 2', 'Payments'], worktrees: [], branches: [] })
    expect(next.groups).toEqual([group])
    expect(config.repos).toHaveLength(2)
  })

  it('reports the failing discovered repo and changes nothing', async () => {
    const d = new GroupDraft(config, snapshot)
    d.addDiscovered([{ name: 'Vanished', path: 'D:/gone', commonDir: 'g', registeredAs: null }])
    const m = find(d, 'new-repo', 'D:/gone')
    d.toggle(m)
    const error = await d.commit(config, 'Broken', null, async () => { throw new Error('No repository at D:/gone') }).catch(e => e)
    expect(error).toBeInstanceOf(GroupSaveError)
    expect(error.memberId).toBe(m.id)
    expect(error.message).toBe('Vanished: No repository at D:/gone')
  })

  it('rejects reserved, duplicate and empty selections', async () => {
    const d = new GroupDraft({ ...config, groups: [{ name: 'QR', repos: ['Joiners'], worktrees: [], branches: [] }] }, snapshot)
    await expect(d.commit(config, 'All Projects', null, resolve)).rejects.toThrow(/reserved/)
    await expect(d.commit(config, 'anything', null, resolve)).rejects.toThrow(/Select at least one/)
  })

  it('switches a repo between whole repo and individual worktrees', () => {
    const d = new GroupDraft(config, snapshot)
    d.toggle(find(d, 'repo', 'AccessControl'))
    expect(d.state('AccessControl')).toBe('whole')
    expect(() => d.toggle(find(d, 'worktree', 'AccessControl'))).toThrow(/whole repo/)
    d.toggleWhole('AccessControl')
    expect(d.state('AccessControl')).toBe('some')
    expect(d.members.filter(m => m.kind === 'worktree' && m.repo === 'AccessControl').every(m => d.checked.has(m.id))).toBe(true)
    d.toggleWhole('AccessControl')
    expect(d.state('AccessControl')).toBe('whole')
    expect(d.members.filter(m => m.repo === 'AccessControl' && m.kind !== 'repo').some(m => d.checked.has(m.id))).toBe(false)
  })

  it('hides branches until shown, folds repos and filters rows', () => {
    const d = new GroupDraft(config, snapshot)
    expect(d.rows().some(m => m.kind === 'branch')).toBe(false)
    d.branchesShown.add('Joiners')
    expect(d.rows().filter(m => m.kind === 'branch').map(m => m.value)).toEqual(['refs/heads/main', 'refs/heads/topic'])
    expect(d.rows('', new Set(['Joiners'])).filter(m => m.repo === 'Joiners').map(m => m.kind)).toEqual(['repo'])
    expect(d.rows('qr').map(m => m.label)).toEqual(['AccessControl', 'qr → feature/qr'])
  })

  it('keeps unavailable members of an existing group and replaces that group in place', async () => {
    const existing = { name: 'Old', repos: ['Gone'], worktrees: ['C:/repos/Joiners', 'C:/elsewhere/missing'], branches: [{ repo: 'Joiners', ref: 'refs/heads/deleted' }] }
    const cfg = { ...config, groups: [{ name: 'First', repos: ['Joiners'], worktrees: [], branches: [] }, existing] }
    const d = new GroupDraft(cfg, snapshot, existing)
    expect(d.members.filter(m => m.label.endsWith('(unavailable)')).map(m => m.value)).toEqual(['Gone', 'C:/elsewhere/missing', 'refs/heads/deleted'])
    expect(d.rows().map(m => m.value)).toEqual(expect.arrayContaining(['C:/elsewhere/missing']))
    const { config: next } = await d.commit(cfg, 'Old', existing, resolve)
    expect(next.groups.map(g => g.name)).toEqual(['First', 'Old'])
    expect(next.groups[1].worktrees).toEqual(['C:/repos/Joiners', 'C:/elsewhere/missing'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w packages/core test -- src/modules/git/group-draft.test.js`
Expected: FAIL — cannot resolve `./group-draft.js`.

- [ ] **Step 3: Implement**

`packages/core/src/modules/git/group-draft.js`:

```js
// The group editor's model, ported from gws GroupDraft: whole repos, worktree paths and
// branches can be mixed; discovered repos are registered on save; saving is all-or-nothing.

import { worktreeId, worktreeName, branchLabel } from './parse.js'
import { uniqueName, groupNameError } from './groups.js'

export class GroupSaveError extends Error {
  constructor(memberId, message) {
    super(message)
    this.name = 'GroupSaveError'
    this.memberId = memberId
  }
}

const memberId = (kind, repo, value) => `${kind}\0${repo}\0${value}`
const member = (kind, repo, value, label) => ({ kind, repo, value, label, id: memberId(kind, repo, value) })
const isEntry = m => m.kind === 'worktree' || m.kind === 'branch'

export class GroupDraft {
  constructor(config, snapshot, existing = null) {
    this.members = []
    this.checked = new Set()
    this.branchesShown = new Set()
    const worktrees = snapshot?.worktrees || []
    const branches = snapshot?.branches || []
    for (const repo of config.repos) {
      this.members.push(member('repo', repo.name, repo.name, repo.name))
      for (const t of worktrees.filter(t => t.repo === repo.name)) {
        this.members.push(member('worktree', repo.name, worktreeId(t), `${worktreeName(t)} → ${branchLabel(t)}${t.error ? ' (unavailable)' : ''}`))
      }
      for (const b of branches.filter(b => b.repo === repo.name)) this.members.push(member('branch', repo.name, b.ref, `Branch · ${b.name}`))
    }
    if (!existing) return
    // Missing entries stay selected so a temporarily unavailable disk or ref doesn't shrink the group.
    for (const name of existing.repos) this.#selectOrAdd(member('repo', name, name, `${name} (unavailable)`))
    for (const path of existing.worktrees) {
      this.#selectOrAdd(this.members.find(m => m.kind === 'worktree' && m.value === path) ?? member('worktree', '(unavailable)', path, `${path} (unavailable)`))
    }
    for (const b of existing.branches) this.#selectOrAdd(member('branch', b.repo, b.ref, `Branch · ${b.ref.replace(/^refs\/heads\//, '')} (unavailable)`))
  }

  #selectOrAdd(m) {
    if (!this.members.some(x => x.id === m.id)) this.members.push(m)
    this.checked.add(m.id)
  }

  /** Adds discovered, not-yet-registered repositories (`{ name, path, registeredAs }`). */
  addDiscovered(found) {
    for (const r of found || []) {
      if (r.registeredAs) continue
      if (!this.members.some(m => m.kind === 'new-repo' && m.value === r.path)) this.members.push(member('new-repo', r.path, r.path, r.name))
    }
  }

  inherited(m) {
    return isEntry(m) && this.checked.has(memberId('repo', m.repo, m.repo))
  }

  toggle(m) {
    if (this.inherited(m)) throw new Error('This is included by the whole repo. Switch the repo to individual entries to choose it.')
    if (!this.checked.delete(m.id)) this.checked.add(m.id)
  }

  state(repo) {
    if (this.checked.has(memberId('repo', repo, repo)) || this.checked.has(memberId('new-repo', repo, repo))) return 'whole'
    return this.members.some(m => m.repo === repo && isEntry(m) && this.checked.has(m.id)) ? 'some' : 'none'
  }

  toggleWhole(repo) {
    const head = this.members.find(m => m.kind === 'repo' && m.repo === repo)
    if (!head) return
    const children = this.members.filter(m => m.repo === repo && isEntry(m))
    if (this.checked.delete(head.id)) {
      for (const t of children.filter(c => c.kind === 'worktree')) this.checked.add(t.id)
    } else {
      for (const c of children) this.checked.delete(c.id)
      this.checked.add(head.id)
    }
  }

  rows(search = '', folded = new Set()) {
    const q = search.trim().toLowerCase()
    const out = []
    const heads = [...this.members.filter(m => m.kind === 'repo'), ...this.members.filter(m => m.kind === 'new-repo')]
    for (const head of heads) {
      const children = head.kind === 'repo'
        ? this.members.filter(m => m.repo === head.repo && (m.kind === 'worktree' || (m.kind === 'branch' && (this.branchesShown.has(head.repo) || this.checked.has(m.id)))))
        : []
      const match = m => !q || `${head.label} ${m.label}`.toLowerCase().includes(q)
      if (!match(head) && !children.some(match)) continue
      out.push(head)
      if (!folded.has(head.repo)) out.push(...children.filter(match))
    }
    // Selected entries whose repository is no longer registered stay visible so they can be unticked.
    const registered = new Set(this.members.filter(m => m.kind === 'repo').map(m => m.repo))
    out.push(...this.members.filter(m => isEntry(m) && this.checked.has(m.id) && !registered.has(m.repo)))
    return out
  }

  /**
   * Validates everything first, then returns the new config and group; inputs are never mutated.
   * @param {(path: string) => Promise<unknown>} resolve rejects if a discovered folder is no longer a repository
   */
  async commit(config, name, existing, resolve) {
    const error = groupNameError(config, name, existing?.name ?? null)
    if (error) throw new Error(error)
    const groupName = String(name).trim()
    const ticked = this.members.filter(m => this.checked.has(m.id))
    const added = []
    for (const m of ticked.filter(m => m.kind === 'new-repo')) {
      try { await resolve(m.value) } catch (e) { throw new GroupSaveError(m.id, `${m.label}: ${e?.message || e}`) }
      added.push({ name: uniqueName(m.label, [...config.repos.map(r => r.name), ...added.map(r => r.name)]), path: m.value })
    }
    const repos = [...new Set([...ticked.filter(m => m.kind === 'repo').map(m => m.value), ...added.map(r => r.name)])]
    const worktrees = [...new Set(ticked.filter(m => m.kind === 'worktree').map(m => m.value))]
    const branches = ticked.filter(m => m.kind === 'branch').map(m => ({ repo: m.repo, ref: m.value }))
    if (!repos.length && !worktrees.length && !branches.length) throw new Error('Select at least one repository, worktree or branch.')
    const group = { name: groupName, repos, worktrees, branches }
    const replacing = existing && config.groups.includes(existing)
    const groups = replacing ? config.groups.map(g => g === existing ? group : g) : [...config.groups, group]
    return { config: { ...config, repos: [...config.repos, ...added], groups }, group }
  }
}
```

Add `export { GroupDraft, GroupSaveError } from './group-draft.js'` to the module `index.js`; add `GroupDraft`, `GroupSaveError` to the git export block in `packages/core/src/index.js` and to `EXPECTED`.

- [ ] **Step 4: Run to verify pass**

Run: `npm -w packages/core test -- src/modules/git` and `npm -w packages/core test -- tests/public-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/git/group-draft.js packages/core/src/modules/git/group-draft.test.js packages/core/src/modules/git/index.js packages/core/src/index.js packages/core/tests/public-api.test.js
git commit -m "feat(core): git workspace group draft with discovered repos and atomic save"
```

---

### Task 5: Main-process git operations, preload and renderer adapter

**Files:**
- Create: `apps/desktop/electron/ipc/git.cjs`, `apps/desktop/electron/ipc/git.test.js`, `apps/desktop/src/adapters/git.js`
- Modify: `apps/desktop/electron/main.cjs` (require near line 67; `let` near line 97; register after `devenvRuns = devenvIpc.register(...)` near line 329; dispose near line 445), `apps/desktop/electron/preload.cjs` (after the `devenv` block near line 232), `apps/desktop/src/main.jsx` (import near line 56; `adapters` object near line 86)

**Interfaces:**
- Consumes: the `IGitAdapter` contract (Task 2).
- Produces: IPC channels `git:version`, `git:resolve`, `git:worktrees`, `git:status`, `git:branches`, `git:discover`, `git:checkFolders`; `window.electronAPI.git.{version, resolve, worktrees, status, branches, discover, checkFolders}`; `gitAdapter` (`apps/desktop/src/adapters/git.js`) implementing `IGitAdapter`; `adapters.git` in `main.jsx`. `git.cjs` exports `{ register, gitEnv, isRepositoryRoot }`; `register(ipcMain, deps)` returns `{ disposeAll() }`; `deps = { spawn, kill, probe: { isDirectory, isFile, exists, listDirectories, readText, mtime }, timeoutMs, maxConcurrent, logger }`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/electron/ipc/git.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { register, gitEnv, isRepositoryRoot } from './git.cjs'

const ROOT = process.platform === 'win32' ? 'C:\\repos' : '/repos'
const REPO = { name: 'App', path: path.join(ROOT, 'App') }
const COMMON = path.join(ROOT, 'App', '.git')

function fakeChild(result, pid) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = pid
  if (result !== 'hang') {
    setImmediate(() => {
      child.stdout.end(Buffer.from(result.stdout || ''))
      child.stderr.end(Buffer.from(result.stderr || ''))
      setImmediate(() => child.emit('close', result.code ?? 0))
    })
  }
  return child
}

function setup(respond = () => ({ stdout: '' }), probe = {}, extra = {}) {
  const handlers = {}
  const calls = []
  const deps = {
    spawn: vi.fn((cmd, args, opts) => {
      calls.push({ cmd, args: args.slice(1), opts })
      return fakeChild(respond(args.slice(1), opts), 1000 + calls.length)
    }),
    kill: vi.fn(async () => {}),
    probe: { isDirectory: () => true, isFile: () => false, exists: () => false, listDirectories: () => [], readText: () => null, mtime: () => null, ...probe },
    timeoutMs: 50,
    logger: { scope: () => ({ error: () => {}, info: () => {} }) },
    ...extra,
  }
  const api = register({ handle: (channel, fn) => { handlers[channel] = fn } }, deps)
  const invoke = (channel, ...args) => handlers[channel](null, ...args)
  return { invoke, calls, deps, api }
}

const commonDirResponder = extra => (args, opts) =>
  args[0] === 'rev-parse' && args[2] === '--git-common-dir' ? { stdout: `${COMMON}\n` } : extra(args, opts)

describe('git env and repository markers', () => {
  it('disables prompts and optional locks and drops inherited git location variables', () => {
    const env = gitEnv({ PATH: 'p', GIT_DIR: 'x', GIT_WORK_TREE: 'y', GIT_INDEX_FILE: 'z', GIT_COMMON_DIR: 'c' })
    expect(env).toMatchObject({ PATH: 'p', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) expect(env[k]).toBeUndefined()
  })

  it('recognises .git, .git-main, .bare and bare repository layouts', () => {
    const at = names => ({ exists: p => names.includes(path.basename(p)), isDirectory: p => names.includes(path.basename(p)), isFile: p => names.includes(path.basename(p)) })
    expect(isRepositoryRoot(ROOT, at(['.git']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['.git-main']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['.bare']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['HEAD', 'objects']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['src']))).toBe(false)
  })
})

describe('git:worktrees and git:branches', () => {
  it('runs an exact argv in the common dir, hidden, without a shell and with prompts disabled', async () => {
    const { invoke, calls, deps } = setup(commonDirResponder(() => ({ stdout: 'worktree X\0\0' })))
    expect(await invoke('git:worktrees', REPO, [REPO.path])).toBe('worktree X\0\0')
    expect(calls.map(c => c.args)).toEqual([['rev-parse', '--path-format=absolute', '--git-common-dir'], ['worktree', 'list', '--porcelain', '-z']])
    expect(deps.spawn.mock.calls[0][0]).toBe('git')
    expect(deps.spawn.mock.calls[0][1][0]).toBe('--no-pager')
    expect(calls[1].opts).toMatchObject({ cwd: COMMON, windowsHide: true })
    expect(calls[1].opts.shell).toBeUndefined()
    expect(calls[1].opts.env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('reads branches with NUL-separated fields', async () => {
    const { invoke, calls } = setup(commonDirResponder(() => ({ stdout: 'refs/heads/main\0a\0s\0\n' })))
    expect(await invoke('git:branches', REPO, [REPO.path])).toBe('refs/heads/main\0a\0s\0\n')
    expect(calls[1].args).toEqual(['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)', 'refs/heads/'])
  })

  it('rejects unregistered or relative repository paths without spawning git', async () => {
    const { invoke, deps } = setup()
    await expect(invoke('git:worktrees', { name: 'X', path: path.join(ROOT, 'Other') }, [REPO.path])).rejects.toThrow(/Not a registered repository/)
    await expect(invoke('git:branches', { name: 'X', path: 'App' }, ['App'])).rejects.toThrow(/absolute/)
    await expect(invoke('git:worktrees', REPO, 'not-a-list')).rejects.toThrow(/Not a registered repository/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

describe('git:status', () => {
  it('returns porcelain, the operation in progress, the rebasing branch, fetch time and the upstream check', async () => {
    const gitDir = path.join(COMMON, 'worktrees', 'feature')
    const { invoke, calls } = setup((args) => {
      if (args[0] === 'status') return { stdout: '# branch.head x\0' }
      if (args[2] === '--git-dir') return { stdout: `${gitDir}\n` }
      if (args[2] === '--git-common-dir') return { stdout: `${COMMON}\n` }
      if (args[1] === '--verify') return { code: 1 }
      return { stdout: '' }
    }, {
      exists: p => p === path.join(gitDir, 'rebase-merge'),
      readText: p => p === path.join(gitDir, 'rebase-merge', 'head-name') ? 'refs/heads/feature\n' : null,
      mtime: p => p === path.join(COMMON, 'FETCH_HEAD') ? '2026-10-13T08:00:00.000Z' : null,
    })
    const result = await invoke('git:status', REPO, path.join(REPO.path, 'feature'), [REPO.path])
    expect(result).toEqual({ porcelain: '# branch.head x\0', operation: 'Rebase in progress', rebasingBranch: 'refs/heads/feature', fetchedAt: '2026-10-13T08:00:00.000Z', upstreamResolves: false })
    expect(calls[0].args).toEqual(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
    expect(calls[0].opts.cwd).toBe(path.join(REPO.path, 'feature'))
  })

  it('rejects a worktree outside the repo that git does not list, without running git status', async () => {
    const { invoke, calls } = setup(commonDirResponder(() => ({ stdout: `worktree ${REPO.path}\0\0` })))
    await expect(invoke('git:status', REPO, path.join(ROOT, 'Elsewhere'), [REPO.path])).rejects.toThrow(/Not a worktree of/)
    expect(calls.some(c => c.args[0] === 'status')).toBe(false)
  })

  it('accepts an external worktree that git lists', async () => {
    const external = path.join(ROOT, 'external topic')
    const { invoke } = setup(commonDirResponder(args => args[0] === 'worktree' ? { stdout: `worktree ${REPO.path}\0\0worktree ${external}\0\0` } : { stdout: '' }))
    expect(await invoke('git:status', REPO, external, [REPO.path])).toMatchObject({ porcelain: '' })
  })

  it('reports a missing worktree folder without running git status', async () => {
    const { invoke, calls } = setup(() => ({ stdout: '' }), { isDirectory: p => !p.endsWith('gone') })
    expect(await invoke('git:status', REPO, path.join(REPO.path, 'gone'), [REPO.path])).toEqual({ missing: true })
    expect(calls).toHaveLength(0)
  })

  it('returns a git failure as an error field', async () => {
    const { invoke } = setup(args => args[0] === 'status' ? { code: 128, stderr: 'fatal: index.lock exists\n' } : { stdout: '' })
    expect(await invoke('git:status', REPO, REPO.path, [REPO.path])).toEqual({ error: 'fatal: index.lock exists' })
  })

  it('kills the process tree and rejects when git exceeds the timeout', async () => {
    const { invoke, deps } = setup(() => 'hang')
    await expect(invoke('git:status', REPO, REPO.path, [REPO.path])).rejects.toThrow(/timed out/)
    expect(deps.kill).toHaveBeenCalledWith(1001)
  })
})

describe('git:discover and git:checkFolders', () => {
  it('lists repo folders one level down, skips plain folders and missing roots, de-duplicates and marks registered ones', async () => {
    const commonFor = cwd => cwd.includes('b-repo') || cwd === REPO.path ? path.join(ROOT, 'B', '.git') : path.join(ROOT, 'A', '.git')
    const { invoke } = setup(
      (args, opts) => args[0] === 'rev-parse' ? { stdout: `${commonFor(opts.cwd)}\n` } : { stdout: '' },
      {
        isDirectory: p => !p.endsWith('missing'),
        listDirectories: () => ['b-repo', 'A-repo', 'plain', 'dup'],
        exists: p => ['A-repo', 'b-repo', 'dup'].some(n => p === path.join(ROOT, n, '.git')),
      })
    const found = await invoke('git:discover', [ROOT, path.join(ROOT, 'missing'), 'relative'], [REPO])
    expect(found.map(f => f.name)).toEqual(['A-repo', 'b-repo'])
    expect(found[1]).toMatchObject({ registeredAs: 'App', commonDir: path.join(ROOT, 'B', '.git') })
    expect(found[0].registeredAs).toBeNull()
    expect(found[0].path).toBe(path.join(ROOT, 'A-repo').replace(/\\/g, '/'))
  })

  it('reports which folders exist, accepting only absolute paths', async () => {
    const { invoke } = setup(() => ({ stdout: '' }), { isDirectory: p => p === ROOT })
    expect(await invoke('git:checkFolders', [ROOT, path.join(ROOT, 'nope'), 'rel'])).toEqual([
      { path: ROOT, exists: true }, { path: path.join(ROOT, 'nope'), exists: false }, { path: 'rel', exists: false },
    ])
  })
})

describe('process limits', () => {
  it('runs at most maxConcurrent git processes and kills running ones on dispose', async () => {
    let live = 0, peak = 0
    const { invoke, deps, api } = setup(() => 'hang', {}, { timeoutMs: 10000, maxConcurrent: 2 })
    deps.spawn.mockImplementation(() => { live++; peak = Math.max(peak, live); return fakeChild('hang', 7) })
    for (let i = 0; i < 4; i++) invoke('git:version').catch(() => {})
    await new Promise(r => setImmediate(r))
    expect(peak).toBe(2)
    await api.disposeAll()
    expect(deps.kill).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: FAIL — cannot find `./git.cjs`.

- [ ] **Step 3: Implement `git.cjs`**

`apps/desktop/electron/ipc/git.cjs`:

```js
// electron/ipc/git.cjs
//
// Runs the git CLI for the Git Workspace module. The renderer names an operation; this file
// owns the exact argv of each one, so the renderer can never pass git arguments. Repository
// paths arrive with the registered-repo list and are checked on every call (main keeps no state).
//
// spawn / kill / filesystem probes are injectable because vi.mock() cannot intercept a CJS require().

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn: nodeSpawn, execFile } = require('child_process');
const { withLogging } = require('./withLogging.cjs');

const STRIP_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
const BRANCH_FORMAT = '--format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)';
// [file in the git dir, label, is a rebase (has head-name)]
const OPERATIONS = [
  ['rebase-merge', 'Rebase in progress', true],
  ['rebase-apply', 'Rebase in progress', true],
  ['MERGE_HEAD', 'Merge in progress', false],
  ['REVERT_HEAD', 'Revert in progress', false],
  ['CHERRY_PICK_HEAD', 'Cherry-pick in progress', false],
];

function gitEnv(base = process.env) {
  // A target always means the requested checkout, even if NexusMD inherited git internals.
  const env = { ...base, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const k of STRIP_ENV) delete env[k];
  return env;
}

function normalise(p) {
  const s = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function samePath(a, b) {
  return normalise(a) === normalise(b);
}

function isInside(child, parent) {
  const c = normalise(child);
  const p = normalise(parent);
  return c === p || c.startsWith(p + path.sep);
}

function killTree(pid) {
  return new Promise(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function defaultProbe() {
  const stat = p => { try { return fs.statSync(p); } catch { return null; } };
  return {
    isDirectory: p => !!stat(p)?.isDirectory(),
    isFile: p => !!stat(p)?.isFile(),
    exists: p => fs.existsSync(p),
    listDirectories: p => fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name),
    readText: p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    mtime: p => stat(p)?.mtime.toISOString() ?? null,
  };
}

// Only folders with their own markers count; otherwise every subfolder of a checkout would
// resolve to that checkout's repository.
function isRepositoryRoot(dir, probe) {
  return probe.exists(path.join(dir, '.git')) ||
    probe.isDirectory(path.join(dir, '.git-main')) ||
    probe.isDirectory(path.join(dir, '.bare')) ||
    (probe.isFile(path.join(dir, 'HEAD')) && probe.isDirectory(path.join(dir, 'objects')));
}

function register(ipcMain, deps = {}) {
  const {
    spawn = nodeSpawn,
    kill = killTree,
    probe = defaultProbe(),
    timeoutMs = 30000,
    maxConcurrent = 6,
    logger,
  } = deps;
  const handle = withLogging(ipcMain, logger);
  const running = new Set();
  const waiting = [];
  let active = 0;
  let version = null;

  const acquire = () => new Promise(resolve => {
    if (active < maxConcurrent) { active++; resolve(); } else waiting.push(resolve);
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };

  async function git(cwd, args) {
    await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn('git', ['--no-pager', ...args], { cwd, env: gitEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        running.add(child);
        const out = [];
        const err = [];
        let settled = false;
        let timer = null;
        const done = fn => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(child);
          fn();
        };
        timer = setTimeout(() => done(() => {
          Promise.resolve(kill(child.pid)).catch(() => {});
          reject(new Error(`git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }), timeoutMs);
        child.stdout.on('data', c => out.push(Buffer.from(c)));
        child.stderr.on('data', c => err.push(Buffer.from(c)));
        child.on('error', e => done(() => reject(new Error(`Couldn't start git: ${e.message}`))));
        child.on('close', code => done(() => resolve({
          code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8').trim(),
        })));
      });
    } finally {
      release();
    }
  }

  function requireAbsolute(p, what) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${what} must be an absolute path`);
  }

  function requireRegistered(repo, registered) {
    requireAbsolute(repo?.path, 'Repository path');
    if (!Array.isArray(registered) || !registered.some(r => typeof r === 'string' && path.isAbsolute(r) && samePath(r, repo.path))) {
      throw new Error(`Not a registered repository: ${repo.path}`);
    }
  }

  async function resolveCommon(dir) {
    for (const candidate of [dir, path.join(dir, '.git-main'), path.join(dir, '.bare')]) {
      if (!probe.isDirectory(candidate)) continue;
      const r = await git(candidate, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    throw new Error(`No repository at ${dir} (including .git-main and .bare)`);
  }

  async function worktreeList(repoPath) {
    const r = await git(await resolveCommon(repoPath), ['worktree', 'list', '--porcelain', '-z']);
    if (r.code !== 0) throw new Error(r.stderr || 'git worktree list failed');
    return r.stdout;
  }

  async function inProgress(gitDir) {
    if (!gitDir) return { operation: '', rebasingBranch: null };
    for (const [name, label, rebase] of OPERATIONS) {
      const p = path.join(gitDir, name);
      if (!probe.exists(p)) continue;
      const head = rebase ? (probe.readText(path.join(p, 'head-name')) || '').trim() : '';
      return { operation: label, rebasingBranch: head.startsWith('refs/heads/') ? head : null };
    }
    return { operation: '', rebasingBranch: null };
  }

  handle('git:version', async () => {
    if (!version) {
      try {
        const r = await git(process.cwd(), ['--version']);
        version = r.code === 0 ? r.stdout.trim() : null;
      } catch {
        version = null;
      }
    }
    return version;
  });

  handle('git:resolve', async (_e, dir) => {
    requireAbsolute(dir, 'Folder');
    return { commonDir: await resolveCommon(dir) };
  });

  handle('git:worktrees', async (_e, repo, registered) => {
    requireRegistered(repo, registered);
    return worktreeList(repo.path);
  });

  handle('git:status', async (_e, repo, worktreePath, registered) => {
    requireRegistered(repo, registered);
    requireAbsolute(worktreePath, 'Worktree path');
    if (!isInside(worktreePath, repo.path)) {
      const listed = (await worktreeList(repo.path)).split('\0').filter(f => f.startsWith('worktree ')).map(f => f.slice(9));
      if (!listed.some(p => samePath(p, worktreePath))) throw new Error(`Not a worktree of ${repo.path}: ${worktreePath}`);
    }
    if (!probe.isDirectory(worktreePath)) return { missing: true };
    const status = await git(worktreePath, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (status.code !== 0) return { error: status.stderr || `git status failed (exit ${status.code})` };
    const gitDir = (await git(worktreePath, ['rev-parse', '--path-format=absolute', '--git-dir'])).stdout.trim();
    const commonDir = (await git(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    const upstream = await git(worktreePath, ['rev-parse', '--verify', '--quiet', '@{upstream}']);
    return {
      porcelain: status.stdout,
      ...(await inProgress(gitDir)),
      fetchedAt: commonDir ? probe.mtime(path.join(commonDir, 'FETCH_HEAD')) : null,
      upstreamResolves: upstream.code === 0,
    };
  });

  handle('git:branches', async (_e, repo, registered) => {
    requireRegistered(repo, registered);
    const r = await git(await resolveCommon(repo.path), ['for-each-ref', '--sort=refname', BRANCH_FORMAT, 'refs/heads/']);
    if (r.code !== 0) throw new Error(r.stderr || 'git for-each-ref failed');
    return r.stdout;
  });

  handle('git:discover', async (_e, roots, repos) => {
    const known = new Map();
    for (const repo of Array.isArray(repos) ? repos : []) {
      if (typeof repo?.path !== 'string' || !path.isAbsolute(repo.path)) continue;
      try { known.set(normalise(await resolveCommon(repo.path)), repo.name); } catch { /* unavailable registrations can't match */ }
    }
    const seen = new Set();
    const found = [];
    for (const root of Array.isArray(roots) ? roots : []) {
      if (typeof root !== 'string' || !path.isAbsolute(root) || !probe.isDirectory(root)) continue;
      let names;
      try { names = probe.listDirectories(root); } catch { continue; }
      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      for (const name of names) {
        const dir = path.join(root, name);
        try {
          if (!isRepositoryRoot(dir, probe)) continue;
          const commonDir = await resolveCommon(dir);
          const key = normalise(commonDir);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ name, path: dir.replace(/\\/g, '/'), commonDir, registeredAs: known.get(key) ?? null });
        } catch { /* unreadable or not a repository after all: skip it */ }
      }
    }
    return found;
  });

  handle('git:checkFolders', async (_e, paths) =>
    (Array.isArray(paths) ? paths : []).map(p => ({ path: p, exists: typeof p === 'string' && path.isAbsolute(p) && probe.isDirectory(p) })));

  return {
    async disposeAll() {
      const all = [...running];
      running.clear();
      await Promise.all(all.map(c => Promise.resolve(kill(c.pid)).catch(() => {})));
    },
  };
}

module.exports = { register, gitEnv, isRepositoryRoot };
```

- [ ] **Step 4: Run the IPC tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.test.js`
Expected: PASS.

- [ ] **Step 5: Wire main, preload and the renderer adapter**

`apps/desktop/electron/main.cjs`:
- After `const devenvIpc      = require('./ipc/devenv.cjs');` add `const gitIpc         = require('./ipc/git.cjs');`
- After `let devenvRuns = null;` add `let gitProcesses = null;`
- After the `devenvRuns = devenvIpc.register(ipcMain, { … });` statement add `gitProcesses = gitIpc.register(ipcMain);`
- After the `devenvRuns?.disposeAll()…` line add:

```js
  gitProcesses?.disposeAll().catch(err => log.scope('lifecycle').error('git disposeAll failed', err));
```

`apps/desktop/electron/preload.cjs`, after the closing `},` of the `devenv:` block:

```js
  // ── Git Workspace module (git adapter) ─────────────────────────────────────
  git: {
    version:      () => ipcRenderer.invoke('git:version'),
    resolve:      (dir) => ipcRenderer.invoke('git:resolve', dir),
    worktrees:    (repo, registered) => ipcRenderer.invoke('git:worktrees', repo, registered),
    status:       (repo, worktreePath, registered) => ipcRenderer.invoke('git:status', repo, worktreePath, registered),
    branches:     (repo, registered) => ipcRenderer.invoke('git:branches', repo, registered),
    discover:     (roots, repos) => ipcRenderer.invoke('git:discover', roots, repos),
    checkFolders: (paths) => ipcRenderer.invoke('git:checkFolders', paths),
  },
```

`apps/desktop/src/adapters/git.js`:

```js
// Renderer-side `git` adapter (contract: IGitAdapter in packages/core/src/adapters/index.js),
// calling through to window.electronAPI.git from electron/preload.cjs.

const api = () => window.electronAPI?.git

export const gitAdapter = {
  isAvailable() { return !!api() },
  version() { return api().version() },
  resolve(dir) { return api().resolve(dir) },
  worktrees(repo, registered) { return api().worktrees(repo, registered) },
  status(repo, worktreePath, registered) { return api().status(repo, worktreePath, registered) },
  branches(repo, registered) { return api().branches(repo, registered) },
  discover(roots, repos) { return api().discover(roots, repos) },
  checkFolders(paths) { return api().checkFolders(paths) },
}
```

`apps/desktop/src/main.jsx`: add `import { gitAdapter }           from './adapters/git.js'` next to the devenv adapter import, and in the `adapters` object after `devenv:        devenvAdapter,` add:

```js
  // Desktop-only — runs git in the main process; gates the git module.
  git:           gitAdapter,
```

- [ ] **Step 6: Run the preload test and the IPC tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/`
Expected: PASS. If `electron/preload.test.js` asserts the exact exposed surface, add the `git` methods to its expected list in the same style as `devenv`, and re-run.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/ipc/git.cjs apps/desktop/electron/ipc/git.test.js apps/desktop/electron/main.cjs apps/desktop/electron/preload.cjs apps/desktop/src/adapters/git.js apps/desktop/src/main.jsx
# plus apps/desktop/electron/preload.test.js if you changed it
git commit -m "feat(desktop): git IPC with named read-only operations and path validation"
```

---

### Task 6: Real-git integration test

**Files:**
- Create: `apps/desktop/electron/ipc/git.integration.test.js`

**Interfaces:**
- Consumes: `register` (Task 5), `loadSnapshot`, `worktreeName` (Tasks 1–2 via `@nexusmd/core`).

- [ ] **Step 1: Write the test**

```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { loadSnapshot, worktreeName } from '@nexusmd/core'
import { register } from './git.cjs'

let root
const handlers = {}
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM }
const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const adapter = {
  resolve: dir => handlers['git:resolve'](null, dir),
  worktrees: (repo, reg) => handlers['git:worktrees'](null, repo, reg),
  status: (repo, wt, reg) => handlers['git:status'](null, repo, wt, reg),
  branches: (repo, reg) => handlers['git:branches'](null, repo, reg),
  discover: (roots, repos) => handlers['git:discover'](null, roots, repos),
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-git-')))
  const globalConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(globalConfig, '[user]\n\tname = Test\n\temail = test@example.invalid\n[core]\n\tautocrlf = false\n')
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  const repos = path.join(root, 'repos')
  const normal = path.join(repos, 'Normal')
  fs.mkdirSync(normal, { recursive: true })
  run(normal, 'init', '-b', 'main')
  fs.writeFileSync(path.join(normal, 'a b.txt'), 'one\n')
  run(normal, 'add', '.')
  run(normal, 'commit', '-m', 'Initial')
  fs.writeFileSync(path.join(normal, 'a b.txt'), 'two\n')
  fs.writeFileSync(path.join(normal, 'new.txt'), 'new\n')
  const layout = path.join(repos, 'Layout')
  fs.mkdirSync(layout)
  run(root, 'clone', '--bare', normal, path.join(layout, '.git-main'))
  run(path.join(layout, '.git-main'), 'worktree', 'add', path.join(layout, 'master'), 'main')
  run(path.join(layout, '.git-main'), 'worktree', 'add', '-b', 'topic', path.join(root, 'external topic'), 'main')
  fs.mkdirSync(path.join(repos, 'Plain'))
  register({ handle: (channel, fn) => { handlers[channel] = fn } }, { logger: { scope: () => ({ error: () => {}, info: () => {} }) } })
}, 60000)

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.nosystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.nosystem
  fs.rmSync(root, { recursive: true, force: true })
})

const registered = () => [
  { name: 'Normal', path: path.join(root, 'repos', 'Normal') },
  { name: 'Layout', path: path.join(root, 'repos', 'Layout') },
]

describe('git workspace against real repositories', () => {
  it('builds a snapshot of a normal repo and a .git-main layout with an external worktree', async () => {
    const s = await loadSnapshot(adapter, registered())
    expect(s.errors).toEqual([])
    const normal = s.worktrees.filter(t => t.repo === 'Normal')
    expect(normal).toHaveLength(1)
    expect(normal[0].changes.map(c => [c.area, c.path])).toEqual([['unstaged', 'a b.txt'], ['untracked', 'new.txt']])
    const layout = s.worktrees.filter(t => t.repo === 'Layout')
    expect(layout.map(t => t.branch).sort()).toEqual(['main', 'topic'])
    expect(layout.map(worktreeName)).toContain('master')
    expect(layout.every(t => t.error === '')).toBe(true)
    expect(s.branches.filter(b => b.repo === 'Layout').map(b => b.name)).toEqual(['main', 'topic'])
  }, 60000)

  it('discovers repo folders, skipping plain folders and marking registered ones', async () => {
    const found = await adapter.discover([path.join(root, 'repos'), path.join(root, 'missing')], [registered()[0]])
    expect(found.map(f => f.name)).toEqual(['Layout', 'Normal'])
    expect(found.find(f => f.name === 'Normal').registeredAs).toBe('Normal')
  }, 60000)

  it('reports a deleted worktree folder as missing rather than clean', async () => {
    fs.rmSync(path.join(root, 'external topic'), { recursive: true, force: true })
    const s = await loadSnapshot(adapter, registered())
    const topic = s.worktrees.find(t => t.branch === 'topic' || t.path.endsWith('external topic'))
    expect(topic.error).toMatch(/^Missing worktree/)
  }, 60000)
})
```

- [ ] **Step 2: Run it**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- electron/ipc/git.integration.test.js`
Expected: PASS (requires `git` on PATH). If a step fails, the parsers or handlers have a real bug — fix it in the owning file (Task 1/2/5 code) and note it in your report.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/electron/ipc/git.integration.test.js
# plus any source file you had to fix
git commit -m "test(desktop): git workspace against real repositories"
```

---

### Task 7: Settings

**Files:**
- Create: `apps/desktop/src/git-config.js`, `apps/desktop/src/git-config.test.js`, `apps/desktop/src/views/git/use-git-config.js`

**Interfaces:**
- Produces: `GIT_CONFIG_EVENT = 'nexusmd:git-config'`, `DEFAULT_ROOTS = ['C:/repos']`, `DEFAULT_GIT_CONFIG`, `getGitConfig()` → normalised config (or `{ …defaults, unsupported: <version> }`), `setGitConfig(patch)` → next config, `effectiveRoots(config)` → string[], `parseRoots(text)` → `{ roots, invalid }`; `useGitConfig()` hook.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/git-config.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getGitConfig, setGitConfig, DEFAULT_GIT_CONFIG, effectiveRoots, parseRoots, GIT_CONFIG_EVENT } from './git-config.js'
import { getProfileKey } from './profile-keys.js'

describe('git config', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty with the default search root', () => {
    expect(getGitConfig()).toEqual(DEFAULT_GIT_CONFIG)
    expect(effectiveRoots(getGitConfig())).toEqual(['C:/repos'])
    expect(effectiveRoots({ roots: [] })).toEqual([])
  })

  it('merges and persists patches and announces the change', () => {
    const seen = vi.fn()
    window.addEventListener(GIT_CONFIG_EVENT, seen)
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    expect(getGitConfig().repos).toEqual([{ name: 'A', path: 'C:/repos/A' }])
    expect(seen).toHaveBeenCalled()
    window.removeEventListener(GIT_CONFIG_EVENT, seen)
  })

  it('fills in missing fields of older or partial settings', () => {
    localStorage.setItem(getProfileKey('git.config'), JSON.stringify({
      repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'bad' }], groups: [{ name: 'G', repos: ['A'] }, { nope: 1 }], extra: true,
    }))
    const cfg = getGitConfig()
    expect(cfg.repos).toEqual([{ name: 'A', path: 'C:/repos/A' }])
    expect(cfg.groups).toEqual([{ name: 'G', repos: ['A'], worktrees: [], branches: [] }])
    expect(cfg.roots).toBeNull()
    expect(cfg.view).toEqual(DEFAULT_GIT_CONFIG.view)
    expect(cfg.extra).toBeUndefined()
  })

  it('marks settings from a newer version as unsupported and survives corrupt storage', () => {
    localStorage.setItem(getProfileKey('git.config'), JSON.stringify({ version: 2 }))
    expect(getGitConfig().unsupported).toBe(2)
    localStorage.setItem(getProfileKey('git.config'), '{nope')
    expect(getGitConfig()).toEqual(DEFAULT_GIT_CONFIG)
  })

  it('parses semicolon-separated absolute search roots', () => {
    expect(parseRoots(' C:/repos ; ;D:\\src;\\\\server\\share; repos ')).toEqual({ roots: ['C:/repos', 'D:\\src', '\\\\server\\share'], invalid: ['repos'] })
    expect(parseRoots('C:/repos;c:/REPOS').roots).toEqual(['C:/repos'])
    expect(parseRoots('')).toEqual({ roots: [], invalid: [] })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/git-config.test.js`
Expected: FAIL — cannot resolve `./git-config.js`.

- [ ] **Step 3: Implement**

`apps/desktop/src/git-config.js`:

```js
// Git Workspace settings (registered repos, groups, search roots, view state), per NexusMD profile.
import { getProfileKey } from './profile-keys.js'

const KEY = () => getProfileKey('git.config')
export const GIT_CONFIG_EVENT = 'nexusmd:git-config'
export const DEFAULT_ROOTS = Object.freeze(['C:/repos'])
export const DEFAULT_GIT_CONFIG = Object.freeze({
  version: 1, repos: [], groups: [], roots: null,
  view: Object.freeze({ group: 'All projects', collapsed: [], selected: null }),
})

const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
const fresh = () => ({ ...DEFAULT_GIT_CONFIG, view: { ...DEFAULT_GIT_CONFIG.view, collapsed: [] } })

function normalise(saved) {
  const view = saved.view && typeof saved.view === 'object' ? saved.view : {}
  return {
    version: 1,
    repos: (Array.isArray(saved.repos) ? saved.repos : []).filter(r => r && typeof r.name === 'string' && typeof r.path === 'string').map(r => ({ name: r.name, path: r.path })),
    groups: (Array.isArray(saved.groups) ? saved.groups : []).filter(g => g && typeof g.name === 'string').map(g => ({
      name: g.name, repos: strings(g.repos), worktrees: strings(g.worktrees),
      branches: (Array.isArray(g.branches) ? g.branches : []).filter(b => b && typeof b.repo === 'string' && typeof b.ref === 'string').map(b => ({ repo: b.repo, ref: b.ref })),
    })),
    roots: saved.roots == null ? null : strings(saved.roots),
    view: {
      group: typeof view.group === 'string' ? view.group : DEFAULT_GIT_CONFIG.view.group,
      collapsed: strings(view.collapsed),
      selected: typeof view.selected === 'string' ? view.selected : null,
    },
  }
}

export function getGitConfig() {
  try {
    const raw = localStorage.getItem(KEY())
    const saved = raw ? JSON.parse(raw) : {}
    if (!saved || typeof saved !== 'object') return fresh()
    if (saved.version != null && saved.version !== 1) return { ...fresh(), unsupported: saved.version }
    return normalise(saved)
  } catch {
    return fresh()
  }
}

export function setGitConfig(patch) {
  const next = { ...getGitConfig(), ...patch }
  delete next.unsupported
  try { localStorage.setItem(KEY(), JSON.stringify(next)) } catch {}
  window.dispatchEvent(new Event(GIT_CONFIG_EVENT))
  return next
}

export function effectiveRoots(config) {
  return config?.roots ?? [...DEFAULT_ROOTS]
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\\\\|\/)/

/** Splits a `;`-separated list of folders; relative entries are returned in `invalid`. */
export function parseRoots(text) {
  const roots = []
  const invalid = []
  for (const entry of String(text ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    if (!ABSOLUTE.test(entry)) invalid.push(entry)
    else if (!roots.some(r => r.toLowerCase() === entry.toLowerCase())) roots.push(entry)
  }
  return { roots, invalid }
}
```

`apps/desktop/src/views/git/use-git-config.js`:

```js
import React from 'react'
import { getGitConfig, GIT_CONFIG_EVENT } from '../../git-config.js'

export function useGitConfig() {
  const [cfg, setCfg] = React.useState(getGitConfig)
  React.useEffect(() => {
    const onChange = () => setCfg(getGitConfig())
    window.addEventListener(GIT_CONFIG_EVENT, onChange)
    return () => window.removeEventListener(GIT_CONFIG_EVENT, onChange)
  }, [])
  return cfg
}
```

- [ ] **Step 4: Run to verify pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/git-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/git-config.js apps/desktop/src/git-config.test.js apps/desktop/src/views/git/use-git-config.js
git commit -m "feat(desktop): git workspace settings per profile"
```

---

### Task 8: Snapshot polling hook

**Files:**
- Create: `apps/desktop/src/views/git/use-git-snapshot.js`, `apps/desktop/src/views/git/use-git-snapshot.test.js`

**Interfaces:**
- Consumes: `loadSnapshot` (`@nexusmd/core`).
- Produces: `useGitSnapshot({ adapter, repos, enabled = true, intervalMs = 10000 })` → `{ snapshot, error, loading, refresh }`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useGitSnapshot } from './use-git-snapshot.js'

afterEach(cleanup)

const repos = [{ name: 'A', path: 'C:/repos/A' }]
function adapterWith(resolveImpl) {
  return {
    resolve: vi.fn(resolveImpl),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain: '# branch.head main\0', operation: '', rebasingBranch: null, fetchedAt: null, upstreamResolves: true })),
    branches: vi.fn(async () => ''),
  }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('useGitSnapshot', () => {
  it('loads a snapshot of the registered repos', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: `${dir}/.git` }))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await waitFor(() => expect(result.current.snapshot?.worktrees).toHaveLength(1))
    expect(result.current.error).toBeNull()
  })

  it('does nothing while disabled', async () => {
    const adapter = adapterWith(async dir => ({ commonDir: dir }))
    renderHook(() => useGitSnapshot({ adapter, repos, enabled: false, intervalMs: null }))
    await new Promise(r => setTimeout(r, 20))
    expect(adapter.resolve).not.toHaveBeenCalled()
  })

  it('skips polls while a load is still running', async () => {
    const pending = deferred()
    const adapter = adapterWith(() => pending.promise)
    renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: 10 }))
    await new Promise(r => setTimeout(r, 80))
    expect(adapter.resolve).toHaveBeenCalledTimes(1)
    pending.resolve({ commonDir: 'C:/repos/A/.git' })
  })

  it('keeps only the newest response when loads overlap', async () => {
    const first = deferred()
    let calls = 0
    const adapter = adapterWith(() => (++calls === 1 ? first.promise : Promise.resolve({ commonDir: 'second' })))
    const { result } = renderHook(() => useGitSnapshot({ adapter, repos, intervalMs: null }))
    await act(async () => { result.current.refresh() })
    await waitFor(() => expect(result.current.snapshot?.worktrees[0].commonDir).toBe('second'))
    await act(async () => { first.resolve({ commonDir: 'first' }) })
    await new Promise(r => setTimeout(r, 20))
    expect(result.current.snapshot.worktrees[0].commonDir).toBe('second')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/use-git-snapshot.test.js`
Expected: FAIL — cannot resolve `./use-git-snapshot.js`.

- [ ] **Step 3: Implement**

```js
import React from 'react'
import { loadSnapshot } from '@nexusmd/core'

// Polls git status for every registered repo while the window is visible (devenv's query-hook
// pattern): a poll is skipped while one is still running, and only the newest result is kept.
export function useGitSnapshot({ adapter, repos, enabled = true, intervalMs = 10000 }) {
  const [snapshot, setSnapshot] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const live = React.useRef(true)
  const reqId = React.useRef(0)
  const inFlight = React.useRef(0)
  const reposKey = JSON.stringify(repos || [])
  // StrictMode runs the cleanup and the effect again in dev, so liveness must be re-armed.
  React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const load = React.useCallback(async (quiet, skipIfBusy = false) => {
    if (!enabled) return
    if (skipIfBusy && inFlight.current > 0) return
    const seq = ++reqId.current
    inFlight.current++
    if (!quiet) setLoading(true)
    const current = () => live.current && seq === reqId.current
    try {
      const next = await loadSnapshot(adapter, JSON.parse(reposKey))
      if (current()) { setSnapshot(next); setError(null) }
    } catch (e) {
      if (current()) setError(e?.message || 'Could not read the repositories')
    } finally {
      inFlight.current--
      if (current()) setLoading(false)
    }
  }, [adapter, reposKey, enabled])

  const refresh = React.useCallback(() => load(false), [load])

  React.useEffect(() => {
    load(false)
    if (!enabled || !intervalMs) return undefined
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const poll = () => { if (visible()) load(true, true) }
    const id = setInterval(poll, intervalMs)
    document.addEventListener('visibilitychange', poll)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
      window.removeEventListener('focus', poll)
    }
  }, [load, enabled, intervalMs])

  return { snapshot, error, loading, refresh }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/use-git-snapshot.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/git/use-git-snapshot.js apps/desktop/src/views/git/use-git-snapshot.test.js
git commit -m "feat(desktop): git workspace snapshot polling hook"
```

---

### Task 9: Group editor dialog

**Files:**
- Create: `apps/desktop/src/views/git/group-editor.jsx`, `apps/desktop/src/views/git/group-editor.test.jsx`

**Interfaces:**
- Consumes: `GroupDraft` (Task 4), `effectiveRoots` (Task 7), `PlModal` (`@nexusmd/ui`: `open, onClose, icon, title, sub, wide, footer, children, closeOnBackdrop`).
- Produces: `GroupEditor({ open, config, snapshot, existing, adapter, onClose, onSaved })`; `onSaved(nextConfig, group)` is called after a successful commit (the caller persists).

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GroupEditor } from './group-editor.jsx'

afterEach(cleanup)

const config = { version: 1, repos: [{ name: 'AccessControl', path: 'C:/repos/AccessControl' }], groups: [], roots: ['C:/repos'], view: {} }
const snapshot = { worktrees: [{ repo: 'AccessControl', repoRoot: 'C:/repos/AccessControl', path: 'C:/repos/AccessControl', branch: 'main', rebasingBranch: null, error: '', changes: [] }], branches: [] }
const discovered = [{ name: 'Payments', path: 'C:/repos/Payments', commonDir: 'p', registeredAs: null }]

function setup(resolve = async () => ({ commonDir: 'x' })) {
  const adapter = { discover: vi.fn(async () => discovered), resolve: vi.fn(resolve) }
  const onSaved = vi.fn()
  render(<GroupEditor open config={config} snapshot={snapshot} existing={null} adapter={adapter} onClose={() => {}} onSaved={onSaved} />)
  return { adapter, onSaved }
}

describe('GroupEditor', () => {
  it('ticks a registered repo and a discovered one, then saves both under the typed name', async () => {
    const { adapter, onSaved } = setup()
    await screen.findByText('Payments')
    expect(adapter.discover).toHaveBeenCalledWith(['C:/repos'], config.repos)
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'QR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [next, group] = onSaved.mock.calls[0]
    expect(group).toEqual({ name: 'QR', repos: ['AccessControl', 'Payments'], worktrees: [], branches: [] })
    expect(next.repos.map(r => r.name)).toEqual(['AccessControl', 'Payments'])
  })

  it('keeps the dialog open and flags the failing row when a discovered repo cannot be registered', async () => {
    const { onSaved } = setup(async () => { throw new Error('No repository at C:/repos/Payments') })
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Payments: No repository at C:/repos/Payments')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Payments' }).closest('li').dataset.failing).toBe('true')
  })

  it('explains why an entry inside a whole repo cannot be ticked separately', async () => {
    setup()
    await screen.findByText('Payments')
    fireEvent.click(screen.getByRole('checkbox', { name: 'AccessControl' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'checkout → main' }))
    expect(screen.getByRole('alert').textContent).toMatch(/whole repo/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/group-editor.test.jsx`
Expected: FAIL — cannot resolve `./group-editor.jsx`.

- [ ] **Step 3: Implement**

```jsx
import React from 'react'
import { GroupDraft } from '@nexusmd/core'
import { PlModal } from '@nexusmd/ui'
import { effectiveRoots } from '../../git-config.js'

const BOX = { whole: '☑', some: '◩', none: '☐' }

export function GroupEditor({ open, config, snapshot, existing, adapter, onClose, onSaved }) {
  const [draft, setDraft] = React.useState(null)
  const [name, setName] = React.useState('')
  const [filter, setFilter] = React.useState('')
  const [folded, setFolded] = React.useState(() => new Set())
  const [status, setStatus] = React.useState('')
  const [failing, setFailing] = React.useState(null)
  const [searching, setSearching] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [, redraw] = React.useReducer(n => n + 1, 0)
  const roots = effectiveRoots(config)

  const scan = React.useCallback(async d => {
    setSearching(true)
    try {
      d.addDiscovered(await adapter.discover(roots, config.repos))
      redraw()
    } catch (e) {
      setStatus(`Repository search failed: ${e?.message || e}`)
    } finally {
      setSearching(false)
    }
    // roots/config.repos are read at the moment of the scan on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, JSON.stringify(roots), JSON.stringify(config.repos)])

  React.useEffect(() => {
    if (!open) return
    const d = new GroupDraft(config, snapshot || { worktrees: [], branches: [] }, existing)
    setDraft(d)
    setName(existing?.name ?? 'New group')
    setFilter('')
    setFolded(new Set())
    setStatus('')
    setFailing(null)
    scan(d)
    // A new draft only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || !draft) return null

  const act = fn => { try { fn(); setStatus('') } catch (e) { setStatus(e.message) } redraw() }
  const toggleFold = repo => setFolded(prev => { const next = new Set(prev); if (!next.delete(repo)) next.add(repo); return next })
  const save = async () => {
    setSaving(true)
    try {
      const { config: next, group } = await draft.commit(config, name, existing, dir => adapter.resolve(dir))
      onSaved(next, group)
    } catch (e) {
      setStatus(e.message)
      setFailing(e.memberId ?? null)
    } finally {
      setSaving(false)
    }
  }

  const rows = draft.rows(filter, folded)
  const footer = (
    <>
      <button className="btn sm ghost" onClick={onClose}>Cancel</button>
      <button className="btn sm" onClick={save} disabled={saving}>Save</button>
    </>
  )

  return (
    <PlModal open={open} onClose={onClose} wide icon="git-branch" closeOnBackdrop={false}
      title={existing ? `Edit ${existing.name}` : 'New project group'}
      sub="Whole repos include their future worktrees." footer={footer}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Name</span>
          <input aria-label="Group name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Filter" placeholder="Filter repositories, worktrees and branches" value={filter}
            onChange={e => setFilter(e.target.value)} style={{ flex: 1 }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {searching ? 'Searching for repositories…' : `Search folders: ${roots.join('; ') || 'none'}`}
          </span>
          <button className="btn sm ghost" onClick={() => scan(draft)} disabled={searching}>Rescan</button>
        </div>
        {status && <div role="alert" style={{ color: 'var(--danger)' }}>{status}</div>}
        <ul role="tree" aria-label="Group members" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflowY: 'auto' }}>
          {rows.map(m => (
            <li key={m.id} data-failing={m.id === failing ? 'true' : undefined}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 6px', paddingLeft: m.kind === 'worktree' || m.kind === 'branch' ? 34 : 6,
                outline: m.id === failing ? '1px solid var(--danger)' : undefined, borderRadius: 'var(--radius-sm)' }}>
              {m.kind === 'repo' && (
                <button className="btn sm ghost" aria-label={`${folded.has(m.repo) ? 'Unfold' : 'Fold'} ${m.repo}`} onClick={() => toggleFold(m.repo)}>
                  {folded.has(m.repo) ? '▸' : '▾'}
                </button>
              )}
              <button role="checkbox" aria-label={m.label} className="btn sm ghost"
                aria-checked={m.kind === 'repo' || m.kind === 'new-repo' ? draft.state(m.repo) === 'whole' : draft.inherited(m) || draft.checked.has(m.id)}
                onClick={() => act(() => draft.toggle(m))}>
                {m.kind === 'repo' || m.kind === 'new-repo' ? BOX[draft.state(m.repo)] : (draft.inherited(m) || draft.checked.has(m.id) ? '☑' : '☐')}
              </button>
              <span style={{ flex: 1, color: draft.inherited(m) ? 'var(--text-muted)' : undefined }}>{m.label}</span>
              {m.kind === 'new-repo' && <span style={{ color: 'var(--warning)', fontSize: 12 }}>★ not registered · {m.value}</span>}
              {m.kind === 'repo' && (
                <>
                  <button className="btn sm ghost" onClick={() => act(() => draft.toggleWhole(m.repo))}>
                    {draft.state(m.repo) === 'whole' ? 'Choose entries' : 'Whole repo'}
                  </button>
                  <button className="btn sm ghost" onClick={() => act(() => { if (!draft.branchesShown.delete(m.repo)) draft.branchesShown.add(m.repo) })}>
                    {draft.branchesShown.has(m.repo) ? 'Hide branches' : 'Show branches'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </PlModal>
  )
}
```

(If the desktop app has no ESLint, drop the two `eslint-disable-next-line` comments — check `apps/desktop/package.json` for a lint script first.)

- [ ] **Step 4: Run to verify pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/group-editor.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/git/group-editor.jsx apps/desktop/src/views/git/group-editor.test.jsx
git commit -m "feat(desktop): git workspace group editor with discovery"
```

---

### Task 10: Git Workspace view and navigation

**Files:**
- Create: `apps/desktop/src/views/git/group-tabs.jsx`, `worktree-list.jsx`, `worktree-detail.jsx`, `group-menu.jsx`, `view-git.jsx`, `view-git.test.jsx` (all in `apps/desktop/src/views/git/`)
- Modify: `apps/desktop/src/nav-config.js` (after the `devenv` entry), `apps/desktop/src/main.jsx` (import near line 40; `case` after `case 'devenv':` near line 607)

**Interfaces:**
- Consumes: Tasks 1–4 core exports, `useGitConfig`/`setGitConfig`/`getGitConfig` (Task 7), `useGitSnapshot` (Task 8), `GroupEditor` (Task 9).
- Produces: `ViewGit({ adapters })`; nav entry `{ id: 'git', label: 'Git Workspace', icon: 'git-branch' }`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/views/git/view-git.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const porcelain = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\01 .M N... 100644 100644 100644 a a f.txt\0'
function adapter(overrides = {}) {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => {
      if (dir.endsWith('Broken')) throw new Error('No repository at C:/repos/Broken')
      return { commonDir: `${dir}/.git` }
    }),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain, operation: '', rebasingBranch: null, fetchedAt: null, upstreamResolves: true })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    ...overrides,
  }
}

function configure() {
  setGitConfig({
    repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }, { name: 'Broken', path: 'C:/repos/Broken' }],
    groups: [{ name: 'Only B', repos: ['B'], worktrees: [], branches: [] }],
  })
}

describe('ViewGit', () => {
  it('shows group tabs with change counts and filters the repos by group', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    const tabs = await screen.findByRole('tablist', { name: 'Project groups' })
    expect(await within(tabs).findByRole('tab', { name: 'All projects 2' })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: 'Only B 1' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'A' })).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Only B 1' }))
    expect(screen.queryByRole('region', { name: 'A' })).toBeNull()
    expect(screen.getByRole('region', { name: 'B' })).toBeTruthy()
    expect(getGitConfig().view.group).toBe('Only B')
  })

  it('shows a failing repository as an error without hiding the others', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    const broken = await screen.findByRole('region', { name: 'Broken' })
    expect(within(broken).getByRole('alert').textContent).toBe('No repository at C:/repos/Broken')
    expect(screen.getByRole('region', { name: 'A' })).toBeTruthy()
  })

  it('shows worktree details with status codes when a row is selected', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    const detail = screen.getByRole('complementary', { name: 'Details' })
    expect(within(detail).getByText('C:/repos/A')).toBeTruthy()
    // Testing Library trims text, so the ' M' status code is matched as 'M'.
    expect(within(detail).getByText('M')).toBeTruthy()
    expect(within(detail).getByText('f.txt')).toBeTruthy()
  })

  it('deletes a group from its menu after confirmation', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Group options for Only B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }))
    expect(getGitConfig().groups).toEqual([])
  })

  it('explains when git is not installed and when there is no desktop bridge', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter({ version: vi.fn(async () => null) }) }} />)
    expect(await screen.findByText(/Git not found/)).toBeTruthy()
    cleanup()
    render(<ViewGit adapters={{}} />)
    expect(screen.getByText('Git Workspace needs the desktop app.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git/view-git.test.jsx`
Expected: FAIL — cannot resolve `./view-git.jsx`.

- [ ] **Step 3: Implement the components**

`apps/desktop/src/views/git/group-tabs.jsx`:

```jsx
import React from 'react'

export function GroupTabs({ tabs, active, onSelect, onNew, onMenu }) {
  const refs = React.useRef({})
  // The active tab must stay visible when the strip overflows.
  React.useEffect(() => { refs.current[active]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) }, [active])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div role="tablist" aria-label="Project groups" style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
        {tabs.map(t => (
          <span key={t.name} style={{ display: 'inline-flex', flex: 'none' }}
            onContextMenu={e => { if (t.editable) { e.preventDefault(); onMenu(t.name) } }}>
            <button ref={el => { refs.current[t.name] = el }} role="tab" aria-selected={t.name === active}
              className={`btn sm ${t.name === active ? '' : 'ghost'}`} onClick={() => onSelect(t.name)}>
              {t.name}
              {t.count > 0 && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>{` ${t.count}`}</span>}
            </button>
            {t.editable && (
              <button className="btn sm ghost" aria-label={`Group options for ${t.name}`} onClick={() => onMenu(t.name)}>⋯</button>
            )}
          </span>
        ))}
      </div>
      <button className="btn sm ghost" aria-label="New group" onClick={onNew}>+</button>
    </div>
  )
}
```

`apps/desktop/src/views/git/worktree-list.jsx`:

```jsx
import React from 'react'
import { worktreeName, branchLabel, worktreeSummary, worktreeId } from '@nexusmd/core'

function trackingText(t) {
  if (t.error) return t.error
  if (t.operation) return t.operation
  const upstream = !t.upstream ? ' · no upstream' : t.upstreamGone ? ' · upstream missing' : ''
  return `↑${t.ahead} ↓${t.behind}${upstream}`
}

function TreeRow({ tree, selected, onSelect }) {
  const s = worktreeSummary(tree)
  const changes = tree.error ? '' : s.changed ? ` · ${s.changed} changed · ${s.staged} staged` : ' · clean'
  return (
    <button className="btn ghost" aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect({ kind: 'worktree', id: worktreeId(tree) })}
      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12, color: tree.error ? 'var(--danger)' : undefined,
        background: selected ? 'var(--accent-soft)' : undefined }}>
      <span>{`${worktreeName(tree)} → ${branchLabel(tree)}`}</span>
      <span style={{ color: tree.error ? 'var(--danger)' : 'var(--text-muted)' }}>{trackingText(tree) + changes}</span>
    </button>
  )
}

export function WorktreeList({ repos, scoped, errors, collapsed, onToggleRepo, selected, onSelect }) {
  const groups = repos.map(r => ({
    name: r.name,
    trees: scoped.worktrees.filter(t => t.repo === r.name),
    branches: scoped.inactiveBranches.filter(b => b.repo === r.name),
    error: errors.find(e => e.repo === r.name),
  })).filter(g => g.trees.length || g.branches.length || g.error)
  if (!groups.length) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>No repositories in this group yet.</div>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {groups.map(g => {
        const isCollapsed = collapsed.includes(g.name)
        const changed = g.trees.reduce((n, t) => n + worktreeSummary(t).changed, 0)
        return (
          <section key={g.name} aria-label={g.name} className="card" style={{ padding: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn sm ghost" aria-expanded={!isCollapsed} onClick={() => onToggleRepo(g.name)}>
                {`${isCollapsed ? '▸' : '▾'} ${g.name}`}
              </button>
              <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{`${changed} changed`}</span>
            </div>
            {g.error && <div role="alert" style={{ color: 'var(--danger)', padding: '4px 8px' }}>{g.error.message}</div>}
            {!isCollapsed && g.trees.map(t => (
              <TreeRow key={t.path} tree={t} selected={selected === worktreeId(t)} onSelect={onSelect} />
            ))}
            {!isCollapsed && g.branches.map(b => (
              <button key={b.id} className="btn ghost" aria-current={selected === b.id ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'branch', id: b.id })}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between' }}>
                <span>{`◇ ${b.name}`}</span><span style={{ color: 'var(--text-muted)' }}>not checked out</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
```

`apps/desktop/src/views/git/worktree-detail.jsx`:

```jsx
import React from 'react'
import { statusCode } from '@nexusmd/core'

const AREA_COLOUR = { staged: 'var(--success)', unstaged: 'var(--warning)', untracked: 'var(--warning)', conflict: 'var(--danger)' }

function Field({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span><span style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

export function WorktreeDetail({ tree, branch }) {
  if (branch) {
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <Field label="Branch" value={branch.name} />
        <Field label="Last commit" value={`${branch.head.slice(0, 7)} ${branch.subject}`} />
        <Field label="Upstream" value={branch.upstream || 'None'} />
        <div style={{ color: 'var(--text-muted)' }}>Not checked out in any worktree.</div>
      </div>
    )
  }
  if (!tree) return <div style={{ color: 'var(--text-muted)' }}>Select a worktree to see its details.</div>
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label="Path" value={tree.path} />
      <Field label="Upstream" value={tree.upstream ? `${tree.upstream}${tree.upstreamGone ? ' (missing)' : ''}` : 'None'} />
      <Field label="Last fetch" value={tree.fetchedAt ? new Date(tree.fetchedAt).toLocaleString() : 'Unknown'} />
      <Field label="In progress" value={tree.operation} />
      <Field label="Locked" value={tree.locked} />
      <Field label="Stale" value={tree.prunable} />
      {tree.error && <div role="alert" style={{ color: 'var(--danger)' }}>{tree.error}</div>}
      {!tree.error && (
        tree.changes.length === 0
          ? <div style={{ color: 'var(--text-muted)' }}>No changes.</div>
          : (
            <ul aria-label="Changed files" style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--font-mono, monospace)' }}>
              {tree.changes.map(c => (
                <li key={c.id} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: AREA_COLOUR[c.area], whiteSpace: 'pre' }}>{statusCode(c)}</span>
                  <span>{c.path}</span>
                  {c.originalPath && <span style={{ color: 'var(--text-muted)' }}>{`← ${c.originalPath}`}</span>}
                </li>
              ))}
            </ul>
          )
      )}
    </div>
  )
}
```

`apps/desktop/src/views/git/group-menu.jsx`:

```jsx
import React from 'react'
import { PlModal } from '@nexusmd/ui'

// Edit / rename / duplicate / delete for one group. onRename/onDuplicate return an error message or null.
export function GroupMenu({ name, onClose, onEdit, onRename, onDuplicate, onDelete }) {
  const [mode, setMode] = React.useState('menu')
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState(null)
  const submit = fn => { const e = fn(value); if (e) setError(e); else onClose() }
  const footer = mode === 'menu' ? null
    : mode === 'delete'
      ? <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm danger" onClick={() => { onDelete(); onClose() }}>Delete group</button></>
      : <><button className="btn sm ghost" onClick={onClose}>Cancel</button><button className="btn sm" onClick={() => submit(mode === 'rename' ? onRename : onDuplicate)}>Save</button></>
  return (
    <PlModal open onClose={onClose} title={name} icon="git-branch" footer={footer}>
      {mode === 'menu' && (
        <div style={{ display: 'grid', gap: 6 }}>
          <button className="btn sm ghost" onClick={() => { onEdit(); onClose() }}>Edit members…</button>
          <button className="btn sm ghost" onClick={() => { setValue(name); setMode('rename') }}>Rename…</button>
          <button className="btn sm ghost" onClick={() => { setValue(`${name} copy`); setMode('duplicate') }}>Duplicate…</button>
          <button className="btn sm ghost" onClick={() => setMode('delete')}>Delete…</button>
        </div>
      )}
      {(mode === 'rename' || mode === 'duplicate') && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input aria-label="New group name" value={value} onChange={e => setValue(e.target.value)} />
          {error && <div role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
      )}
      {mode === 'delete' && <p>{`Delete the saved membership of ${name}? Repository files, branches and worktrees stay in place.`}</p>}
    </PlModal>
  )
}
```

`apps/desktop/src/views/git/view-git.jsx`:

```jsx
import React from 'react'
import {
  ALL_PROJECTS, findGroup, scopeSnapshot, changeCount, renameGroup, duplicateGroup, deleteGroup, worktreeId,
} from '@nexusmd/core'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { useGitConfig } from './use-git-config.js'
import { useGitSnapshot } from './use-git-snapshot.js'
import { GroupTabs } from './group-tabs.jsx'
import { WorktreeList } from './worktree-list.jsx'
import { WorktreeDetail } from './worktree-detail.jsx'
import { GroupMenu } from './group-menu.jsx'
import { GroupEditor } from './group-editor.jsx'

const card = (text, role) => <div className="card" role={role} style={{ padding: 16 }}>{text}</div>

export function ViewGit({ adapters }) {
  const adapter = adapters?.git
  if (!adapter?.isAvailable()) return <div style={{ padding: 16 }}>Git Workspace needs the desktop app.</div>
  return <GitWorkspace adapter={adapter} />
}

function GitWorkspace({ adapter }) {
  const config = useGitConfig()
  const [gitVersion, setGitVersion] = React.useState(undefined)
  const [menuFor, setMenuFor] = React.useState(null)
  const [editing, setEditing] = React.useState(null)
  React.useEffect(() => {
    let live = true
    adapter.version().then(v => { if (live) setGitVersion(v) }, () => { if (live) setGitVersion(null) })
    return () => { live = false }
  }, [adapter])
  const { snapshot, error, loading, refresh } = useGitSnapshot({ adapter, repos: config.repos, enabled: !!gitVersion && !config.unsupported })

  if (config.unsupported) return card(`These Git Workspace settings were saved by a newer NexusMD (version ${config.unsupported}). Update NexusMD to use them.`, 'alert')
  if (gitVersion === null) return card('Git not found. Install Git for Windows (git-scm.com) and make sure git is on PATH, then reopen this screen.', 'alert')
  if (gitVersion === undefined) return card('Checking for git…')

  const view = config.view
  const group = findGroup(config, view.group)
  const scoped = scopeSnapshot(snapshot, group)
  const tabs = [
    { name: ALL_PROJECTS, count: changeCount(snapshot, null), editable: false },
    ...config.groups.map(g => ({ name: g.name, count: changeCount(snapshot, g), editable: true })),
  ]
  const setView = patch => setGitConfig({ view: { ...getGitConfig().view, ...patch } })
  const selectedTree = scoped.worktrees.find(t => worktreeId(t) === view.selected)
  const selectedBranch = scoped.inactiveBranches.find(b => b.id === view.selected)
  const save = next => setGitConfig({ repos: next.repos, groups: next.groups })
  const tryName = fn => value => { try { save(fn(getGitConfig(), value)); return null } catch (e) { return e.message } }

  return (
    <div style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GroupTabs tabs={tabs} active={group ? group.name : ALL_PROJECTS}
            onSelect={name => setView({ group: name, selected: null })}
            onNew={() => setEditing({ existing: null })} onMenu={setMenuFor} />
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {loading ? 'Refreshing…' : snapshot ? `Updated ${new Date(snapshot.takenAt).toLocaleTimeString()}` : ''}
        </span>
        <button className="btn sm ghost" aria-label="Refresh" onClick={refresh}>⟳</button>
      </div>
      {error && card(error, 'alert')}
      {!config.repos.length && card('No repositories yet. Add one in Settings → Desktop → Git Workspace, or create a group to pick from C:\\repos.')}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12, alignItems: 'start' }}>
        <WorktreeList repos={config.repos} scoped={scoped} errors={snapshot?.errors || []} collapsed={view.collapsed}
          onToggleRepo={name => setView({ collapsed: view.collapsed.includes(name) ? view.collapsed.filter(n => n !== name) : [...view.collapsed, name] })}
          selected={view.selected} onSelect={s => setView({ selected: s.id })} />
        <aside aria-label="Details" className="card" style={{ padding: 12 }}>
          <WorktreeDetail tree={selectedTree} branch={selectedBranch} />
        </aside>
      </div>
      {menuFor && (
        <GroupMenu name={menuFor} onClose={() => setMenuFor(null)}
          onEdit={() => setEditing({ existing: config.groups.find(g => g.name === menuFor) })}
          onRename={tryName((cfg, value) => {
            const next = renameGroup(cfg, menuFor, value)
            if (cfg.view.group === menuFor) setTimeout(() => setView({ group: value.trim() }))
            return next
          })}
          onDuplicate={tryName((cfg, value) => duplicateGroup(cfg, menuFor, value))}
          onDelete={() => { save(deleteGroup(getGitConfig(), menuFor)); if (view.group === menuFor) setView({ group: ALL_PROJECTS, selected: null }) }} />
      )}
      <GroupEditor open={!!editing} config={config} snapshot={snapshot} existing={editing?.existing ?? null} adapter={adapter}
        onClose={() => setEditing(null)}
        onSaved={(next, saved) => { save(next); setView({ group: saved.name, selected: null }); setEditing(null); refresh() }} />
    </div>
  )
}
```

- [ ] **Step 4: Navigation and routing**

`apps/desktop/src/nav-config.js`: after `{ id: 'devenv', … },` add:

```js
  { id: 'git',       label: 'Git Workspace',  icon: 'git-branch' },
```

`apps/desktop/src/main.jsx`: add `import { ViewGit } from './views/git/view-git.jsx'` beside the `DevenvView` import, and after the `case 'devenv':` return add:

```jsx
    case 'git':
      return <ViewGit adapters={adapters} />
```

- [ ] **Step 5: Run the tests**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/views/git src/nav-config`
Expected: PASS. If `nav-config.test.js` asserts the exact list of nav ids, add `'git'` after `'devenv'` there and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/views/git/group-tabs.jsx apps/desktop/src/views/git/worktree-list.jsx apps/desktop/src/views/git/worktree-detail.jsx apps/desktop/src/views/git/group-menu.jsx apps/desktop/src/views/git/view-git.jsx apps/desktop/src/views/git/view-git.test.jsx apps/desktop/src/nav-config.js apps/desktop/src/main.jsx
# plus apps/desktop/src/nav-config.test.js if you changed it
git commit -m "feat(desktop): Git Workspace view with group tabs, worktree status and details"
```

---

### Task 11: Settings card

**Files:**
- Create: `apps/desktop/src/git-settings-card.jsx`, `apps/desktop/src/git-settings-card.test.jsx`
- Modify: `apps/desktop/src/desktop-settings.jsx` (import near line 22; render `<GitSettingsCard />` after `<DevenvSettingsCard />` near line 1109)

**Interfaces:**
- Consumes: `registerRepo`, `unregisterRepo` (Task 3), `getGitConfig`/`setGitConfig`/`effectiveRoots`/`parseRoots`/`DEFAULT_ROOTS` (Task 7), `useGitConfig` (Task 7), `VsCard`/`VsRow` (`@nexusmd/ui`: `VsCard({ title, icon, children })`, `VsRow({ title, desc, children })`), `pickerAdapter.pickDirectory()`.
- Produces: `GitSettingsCard({ adapter = gitAdapter, picker = pickerAdapter })`.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GitSettingsCard } from './git-settings-card.jsx'
import { getGitConfig, setGitConfig } from './git-config.js'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function adapter() {
  return {
    isAvailable: () => true,
    resolve: vi.fn(async dir => ({ commonDir: dir.includes('copy') ? 'C:/repos/A/.git' : `${dir}/.git` })),
    checkFolders: vi.fn(async paths => paths.map(p => ({ path: p, exists: !p.includes('missing') }))),
  }
}

describe('GitSettingsCard', () => {
  it('adds a repository from the folder picker and refuses the same repository twice', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    const picker = { pickDirectory: vi.fn().mockResolvedValueOnce('D:\\src\\Payments').mockResolvedValueOnce('D:\\src\\a-copy') }
    render(<GitSettingsCard adapter={adapter()} picker={picker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    await waitFor(() => expect(getGitConfig().repos.map(r => r.name)).toEqual(['A', 'Payments']))
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    expect(await screen.findByText('That repository is already registered as A')).toBeTruthy()
    expect(getGitConfig().repos).toHaveLength(2)
  })

  it('removes a registration', () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    render(<GitSettingsCard adapter={adapter()} picker={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))
    expect(getGitConfig().repos).toEqual([])
  })

  it('saves search folders, rejecting relative paths and naming missing ones', async () => {
    render(<GitSettingsCard adapter={adapter()} picker={{}} />)
    const input = screen.getByLabelText('Search folders')
    expect(input.value).toBe('C:/repos')
    fireEvent.change(input, { target: { value: 'C:/repos; repos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(await screen.findByText('Use absolute folders: repos')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'C:/repos; D:/missing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(await screen.findByText('Saved 2 search folders · not found: D:/missing')).toBeTruthy()
    expect(getGitConfig().roots).toEqual(['C:/repos', 'D:/missing'])
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(await screen.findByText('No search folders · the group editor shows registered repositories only')).toBeTruthy()
    expect(getGitConfig().roots).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/git-settings-card.test.jsx`
Expected: FAIL — cannot resolve `./git-settings-card.jsx`.

- [ ] **Step 3: Implement**

```jsx
import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'
import { registerRepo, unregisterRepo } from '@nexusmd/core'
import { getGitConfig, setGitConfig, effectiveRoots, parseRoots } from './git-config.js'
import { useGitConfig } from './views/git/use-git-config.js'
import { gitAdapter } from './adapters/git.js'
import { pickerAdapter } from './adapters/picker.js'

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
}

export function GitSettingsCard({ adapter = gitAdapter, picker = pickerAdapter }) {
  const config = useGitConfig()
  const [rootsText, setRootsText] = React.useState(() => effectiveRoots(getGitConfig()).join('; '))
  const [message, setMessage] = React.useState(null)
  if (!adapter.isAvailable()) return null

  const addRepo = async () => {
    const dir = await picker.pickDirectory()
    if (!dir) return
    try {
      setGitConfig(await registerRepo(getGitConfig(), dir, adapter))
      setMessage({ ok: true, text: `Added ${dir}` })
    } catch (e) {
      setMessage({ ok: false, text: e.message })
    }
  }
  const saveRoots = async () => {
    const { roots, invalid } = parseRoots(rootsText)
    if (invalid.length) { setMessage({ ok: false, text: `Use absolute folders: ${invalid.join(', ')}` }); return }
    setGitConfig({ roots })
    if (!roots.length) { setMessage({ ok: true, text: 'No search folders · the group editor shows registered repositories only' }); return }
    const missing = (await adapter.checkFolders(roots)).filter(f => !f.exists).map(f => f.path)
    setMessage({ ok: !missing.length, text: `Saved ${roots.length} search folder${roots.length === 1 ? '' : 's'}${missing.length ? ` · not found: ${missing.join(', ')}` : ''}` })
  }

  return (
    <VsCard title="Git Workspace" icon="git-branch">
      <VsRow title="Search folders" desc="Folders whose immediate subfolders are offered as repositories in the group editor. Separate with ; — leave empty to turn discovery off.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Search folders" style={inputStyle} value={rootsText} onChange={e => setRootsText(e.target.value)} />
          <button className="btn sm" onClick={saveRoots}>Save folders</button>
        </div>
      </VsRow>
      <VsRow title="Repositories" desc="Removing a repository only unregisters it; its files stay in place.">
        <div style={{ display: 'grid', gap: 4 }}>
          {config.repos.length === 0 && <span style={{ color: 'var(--text-muted)' }}>None registered.</span>}
          {config.repos.map(r => (
            <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{r.name} <span style={{ color: 'var(--text-muted)' }}>{r.path}</span></span>
              <button className="btn sm ghost" aria-label={`Remove ${r.name}`} onClick={() => setGitConfig(unregisterRepo(getGitConfig(), r.name))}>Remove</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={addRepo}>Add repository…</button></div>
        </div>
      </VsRow>
      {message && <div role="status" style={{ padding: '6px 12px', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</div>}
    </VsCard>
  )
}
```

`apps/desktop/src/desktop-settings.jsx`: add `import { GitSettingsCard } from './git-settings-card.jsx'` after the `DevenvSettingsCard` import, and render `<GitSettingsCard />` on the line after `<DevenvSettingsCard />`.

- [ ] **Step 4: Run to verify pass**

Run: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test -- src/git-settings-card.test.jsx src/desktop-settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/git-settings-card.jsx apps/desktop/src/git-settings-card.test.jsx apps/desktop/src/desktop-settings.jsx
git commit -m "feat(desktop): Git Workspace settings card"
```

---

### Task 12: Smoke test, spec amendments and full verification

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.js`, `docs/superpowers/specs/2026-10-13-git-workspace-design.md`

- [ ] **Step 1: Add the e2e smoke check**

Read `apps/desktop/e2e/smoke.spec.js` to see how it launches the app and gets the page (it uses `_electron.launch({ args: [appDir] })`). Add a test in the same style, reusing the existing launch/page setup:

```js
test('Git Workspace opens from the sidebar', async () => {
  await page.getByRole('button', { name: 'Git Workspace' }).click()
  await expect(
    page.getByRole('tablist', { name: 'Project groups' })
      .or(page.getByText(/Git not found|Checking for git/)),
  ).toBeVisible()
})
```

(Use the file's existing variable for the window — e.g. `window` or `page` — and its existing nav-button selector if the sidebar items are not `button`s.)

Run: `npm -w apps/desktop run e2e`
Expected: PASS, or — in a headless shell — the known launch failure described in `WRITING_MODULES.md` §7; report it as "blocked", not as a failure of this change.

- [ ] **Step 2: Record the planning amendments in the spec**

Append to `docs/superpowers/specs/2026-10-13-git-workspace-design.md`:

```markdown
## Amendments made during stage 1 planning

- Discovery marker rules and de-duplication live in `apps/desktop/electron/ipc/git.cjs`; Electron main is CommonJS and cannot `require()` the ESM-only `@nexusmd/core`, so there is no `packages/core/src/modules/git/discovery.js`. `uniqueName` lives in `groups.js`.
- `discover(roots, repos)` takes registered repos as `{ name, path }` so it can report `registeredAs`.
- New read-only operation `checkFolders(paths)` → `[{ path, exists }]`, used by the settings card to list missing search folders.
- `IGitAdapter.version()` (async) reports whether git runs (`null` = not found); `isAvailable()` stays the synchronous desktop-bridge check, as for devenv.
- No enable/disable toggle on the settings card: like devenv, the module is gated by the adapter and its nav entry is always present on desktop.
- Group rename/duplicate/delete and repo registration are pure functions in `groups.js`; the group editor model is `group-draft.js`.
```

- [ ] **Step 3: Full verification**

Run, from `C:\repos\NexusMD-Mono`:
- `npm -w packages/core test`
- `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm -w apps/desktop test`
- `npm -w apps/desktop run build:renderer`

Expected: all tests pass; the renderer builds without errors.

- [ ] **Step 4: Manual check (ask the user)**

Ask the user to run `npm -w apps/desktop run dev` and `npm -w apps/desktop run start`, open Git Workspace, and confirm: repos load, a group created from discovered repos appears as a tab, the detail panel shows changed files, Settings → Desktop shows the Git Workspace card. Record their answer; do not claim it was checked if it wasn't.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.js docs/superpowers/specs/2026-10-13-git-workspace-design.md
git commit -m "test(desktop): git workspace smoke check; docs: stage 1 planning amendments"
```
