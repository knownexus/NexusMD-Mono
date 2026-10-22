import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'
import { historyCache } from './history-cache.js'
import { RebaseDialog } from './rebase-dialog.jsx'
import { clearWorktreeDrafts, putWorktreeDraft, getWorktreeDraft, conflictDraftKey } from './use-worktree-file.js'

afterEach(cleanup)
// A kept draft for c.txt, as left by an editor that went away; stands in for one, since conflicted files have no Edit.
const keptDraft = { on: false, discarded: [] }
vi.mock('./use-worktree-file.js', async orig => {
  const real = await orig()
  return {
    ...real,
    worktreeDraftPaths: (...a) => (keptDraft.on ? ['c.txt'] : real.worktreeDraftPaths(...a)),
    discardWorktreeDraft: (...a) => { keptDraft.discarded.push(a[2]); keptDraft.on = false; return real.discardWorktreeDraft(...a) },
  }
})
beforeEach(() => {
  localStorage.clear()
  clearGitSnapshotCache()
  for (const k of ['details', 'files', 'diffs', 'pages']) historyCache[k].clear()
})

const oid = n => String(n).repeat(40).slice(0, 40)
const HEAD = oid(9)
const porcelain = (extra = '') => `# branch.oid ${HEAD}\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -0\0${extra}`
// HEAD (9) and 8 are unpushed; 7 is pushed; 6 is a merge further down.
const rec = (o, subject, parents) => `* \x1e${o}\x1f${parents.join(' ')}\x1fAna\x1fa@b\x1f1\x1f\x1f${subject}`
const LOG = [rec(oid(9), 'nine', [oid(8)]), rec(oid(8), 'eight', [oid(7)]), rec(oid(7), 'seven', [oid(6)]), rec(oid(6), 'merge', [oid(5), oid(4)])].join('\n') + '\n'

function adapter(over = {}) {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD ${HEAD}\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain: porcelain(), operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    diff: vi.fn(async () => ({ text: '', stamp: 's', truncated: false, binary: false, size: 0 })),
    refs: vi.fn(async () => ({ refs: `refs/heads/main\0${HEAD}\0\0*\n`, originHead: null, shallow: false })),
    log: vi.fn(async (_r, _c, _g, q) => ({ text: LOG, tip: HEAD, unpushed: [oid(9), oid(8)], truncated: false, limit: q.limit })),
    commitDetails: vi.fn(async (_r, _c, _g, o) => ({ details: [o, oid(1), 'Ana', 'a@b', 'd', 'Ana', 'a@b', 'd', '', 'msg'].join('\0') })),
    commitFiles: vi.fn(async () => ({ files: '' })),
    commitDiff: vi.fn(async () => ({ text: '', truncated: false, binary: false, size: 0 })),
    preview: vi.fn(async () => ({ eligible: true, reason: null, details: null, programs: [], stamp: 's' })),
    run: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    stashes: vi.fn(async () => `${oid(3)}\0stash@{0}\x00100\0On main: wip\n`),
    remotes: vi.fn(async () => ''),
    ...over,
  }
}

async function openWorktree(git, config = {}) {
  setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'B', path: 'C:/repos/B' }], groups: [], ...config })
  render(<ViewGit adapters={{ git }} />)
  const region = await screen.findByRole('region', { name: 'A' })
  fireEvent.click(await within(region).findByRole('button', { name: /→ main/ }))
  return within(screen.getByRole('group', { name: 'Branch actions' }))
}

describe('stage 4 in the Git Workspace view', () => {
  it('the sync bar previews the selected worktree with each action', async () => {
    const git = adapter()
    const bar = await openWorktree(git)
    fireEvent.click(bar.getByRole('button', { name: 'Pull…' }))
    await waitFor(() => expect(git.preview).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', ['C:/repos/A', 'C:/repos/B'], 'pull', { mode: 'ff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(bar.getByRole('button', { name: 'Rebase…' }))
    await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'rebase', {}))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    // The main worktree can't be removed; adding one previews from it.
    expect(screen.getByRole('menuitem', { name: 'Remove this worktree…' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add worktree…' }))
    await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'worktreeAdd', {}))
  })

  it('the header Switch chip opens the branch switcher and Overview goes back to nothing selected', async () => {
    await openWorktree(adapter())
    fireEvent.click(screen.getByRole('button', { name: 'Switch ▾' }))
    expect(await screen.findByRole('combobox', { name: 'Branch name' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Branch name' }), { key: 'Escape' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Overview' }))
    expect(getGitConfig().view.selected).toBe(null)
    expect(screen.queryByRole('group', { name: 'Branch actions' })).toBeNull()
  })

  it('Editor opens Go to file', async () => {
    const bar = await openWorktree(adapter({ files: vi.fn(async () => ({ files: ['a.txt'], truncated: false })) }))
    fireEvent.click(bar.getByRole('button', { name: 'Editor' }))
    expect(await screen.findByRole('combobox', { name: 'File name' })).toBeTruthy()
  })

  it('Terminal opens one in the selected worktree, and says why when it cannot', async () => {
    const git = adapter({ openTerminal: vi.fn().mockResolvedValueOnce({ opened: 'wt.exe' }).mockRejectedValueOnce(new Error("Error invoking remote method 'git:openTerminal': Error: Couldn't open a terminal: none found")) })
    const bar = await openWorktree(git)
    fireEvent.click(bar.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => expect(git.openTerminal).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', ['C:/repos/A', 'C:/repos/B']))
    expect(bar.queryByRole('alert')).toBeNull()
    fireEvent.click(bar.getByRole('button', { name: 'Terminal' }))
    expect((await bar.findByRole('alert')).textContent).toBe("Couldn't open a terminal: none found")
  })

  it('Fetch all previews one target per repository in the group', async () => {
    const git = adapter()
    await openWorktree(git)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all' }))
    await waitFor(() => expect(git.preview.mock.calls.filter(c => c[3] === 'fetch').map(c => c[0].name)).toEqual(['A', 'B']))
    expect(await screen.findByText('Each repository runs separately; if one fails the others are not undone.')).toBeTruthy()
  })

  it('the stash list applies, pops and drops by commit id', async () => {
    const git = adapter()
    const bar = await openWorktree(git)
    fireEvent.click(bar.getByRole('button', { name: 'More ▾' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Stashes…/ }))
    const entries = await screen.findByRole('list', { name: 'Stash entries' })
    await within(entries).findByText('stash@{0} · On main: wip')
    fireEvent.click(within(entries).getByRole('button', { name: 'Drop…' }))
    await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'stashDrop', { oid: oid(3) }))
    expect(await screen.findByRole('textbox', { name: 'Type DROP to confirm' })).toBeTruthy()
  })

  it('History rows offer branch, checkout and revert, and rebase only over unpushed, merge-free commits', async () => {
    const git = adapter()
    await openWorktree(git, { view: { ...getGitConfig().view, panel: 'history' } })
    await screen.findByText('nine')
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${oid(8).slice(0, 7)}` }))
    let menu = screen.getByRole('menu', { name: `Actions for ${oid(8).slice(0, 7)}` })
    expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['New branch here…', 'Check out (detached)…', 'Revert…', 'Rebase from here…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rebase from here…' }))
    const plan = await screen.findByRole('list', { name: 'Rebase plan' })
    expect(within(plan).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringContaining('eight'), expect.stringContaining('nine')])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${oid(7).slice(0, 7)}` }))
    menu = screen.getByRole('menu', { name: `Actions for ${oid(7).slice(0, 7)}` })
    expect(within(menu).queryByRole('menuitem', { name: 'Rebase from here…' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'New branch here…' }))
    await waitFor(() => expect(git.preview).toHaveBeenLastCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'branch', expect.objectContaining({ start: oid(7), checkout: false })))
  })

  it('reverting a merge asks which parent to keep, as a number', async () => {
    const git = adapter()
    await openWorktree(git, { view: { ...getGitConfig().view, panel: 'history' } })
    await screen.findByText('merge')
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${oid(6).slice(0, 7)}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revert…' }))
    const parent = await screen.findByRole('combobox', { name: 'Keep parent' })
    fireEvent.change(parent, { target: { value: '2' } })
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toMatchObject({ oid: oid(6), parent: 2 }))
  })
})

describe('resolving a conflicted file whole', () => {
  it('stamps the file, resolves it after confirming, and shows a refusal', async () => {
    const h = 'f'.repeat(40)
    const git = adapter({
      status: vi.fn(async () => ({
        porcelain: porcelain(`u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} c.txt\0`),
        operation: 'Rebase in progress', rebasingBranch: 'main', fetchedAt: null,
        operationInfo: { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 1, total: 2, replaying: null },
      })),
      stamp: vi.fn(async () => 'stamp-1'),
      resolveConflict: vi.fn(async () => ({ ok: false, stale: true, detail: 'c.txt changed since it was listed.' })),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openWorktree(git)
    fireEvent.click(await screen.findByRole('button', { name: "Take dev's for c.txt" }))
    await waitFor(() => expect(git.resolveConflict).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', ['C:/repos/A', 'C:/repos/B'], 'c.txt', { take: 'left' }, 'stamp-1'))
    expect(git.stamp).toHaveBeenCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), { kind: 'files', paths: ['c.txt'] })
    expect((await screen.findByRole('alert')).textContent).toContain('c.txt changed since it was listed.')
    window.confirm.mockRestore()
  })
})

describe('resolving over a kept draft', () => {
  const conflicted = over => adapter({
    status: vi.fn(async () => ({
      porcelain: porcelain(`u UU N... 100644 100644 100644 100644 ${'f'.repeat(40)} ${'f'.repeat(40)} ${'f'.repeat(40)} c.txt\0`),
      operation: 'Rebase in progress', rebasingBranch: 'main', fetchedAt: null,
      operationInfo: { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 1, total: 2, replaying: null },
    })),
    stamp: vi.fn(async () => 'stamp-1'),
    resolveConflict: vi.fn(async () => ({ ok: true, detail: 'Resolved' })),
    ...over,
  })
  afterEach(() => { keptDraft.on = false; keptDraft.discarded = []; vi.restoreAllMocks() })

  it('declining the discard does nothing', async () => {
    keptDraft.on = true
    const git = conflicted()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValue(false)
    await openWorktree(git)
    fireEvent.click(await screen.findByRole('button', { name: "Take dev's for c.txt" }))
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to c.txt?')
    expect(git.resolveConflict).not.toHaveBeenCalled()
    expect(keptDraft.discarded).toEqual([])
  })

  it('accepting resolves the file and drops the draft', async () => {
    keptDraft.on = true
    const git = conflicted()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openWorktree(git)
    fireEvent.click(await screen.findByRole('button', { name: "Take dev's for c.txt" }))
    await waitFor(() => expect(git.resolveConflict).toHaveBeenCalled())
    await waitFor(() => expect(keptDraft.discarded).toEqual(['c.txt']))
  })
})

describe('resolving a conflicted file in the panel', () => {
  const h = 'f'.repeat(40)
  const MARKED = '<<<<<<< HEAD\nL\n=======\nR\n>>>>>>> fix\n'
  const conflicted = () => {
    const state = { resolved: false }
    const git = adapter({
      status: vi.fn(async () => ({
        porcelain: porcelain(state.resolved ? `1 M. N... 100644 100644 100644 ${h} ${h} c.txt\0` : `u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} c.txt\0`),
        operation: 'Rebase in progress', rebasingBranch: 'main', fetchedAt: null,
        operationInfo: { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 1, total: 2, replaying: { oid: oid(2), subject: 'Fix' } },
      })),
      conflict: vi.fn(async () => ({ kind: 'both-modified', binary: false, stages: { base: null, left: { text: 'L\n' }, right: { text: 'R\n' } }, working: { text: MARKED, bom: false, stamp: 'w1' }, stamp: 'c1' })),
      resolveConflict: vi.fn(async () => { state.resolved = true; return { ok: true } }),
      unresolve: vi.fn(async () => { state.resolved = false; return { ok: true } }),
      stamp: vi.fn(async () => 'stamp-1'),
    })
    return git
  }
  afterEach(() => { vi.restoreAllMocks(); clearWorktreeDrafts() })

  it('jumps to the next conflicted file, and offers it once one is resolved', async () => {
    const resolved = new Set()
    const both = p => (resolved.has(p) ? `1 M. N... 100644 100644 100644 ${h} ${h} ${p}\0` : `u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} ${p}\0`)
    const git = conflicted()
    git.status.mockImplementation(async () => ({
      porcelain: porcelain(both('a.txt') + both('b.txt')),
      operation: 'Rebase in progress', rebasingBranch: 'main', fetchedAt: null,
      operationInfo: { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 1, total: 2, replaying: { oid: oid(2), subject: 'Fix' } },
    }))
    git.resolveConflict.mockImplementation(async (_r, _w, _g, p) => { resolved.add(p); return { ok: true } })
    await openWorktree(git)
    fireEvent.click(await screen.findByText('a.txt'))
    await screen.findByRole('heading', { name: 'Resolve: a.txt' })
    expect(within(screen.getByRole('group', { name: 'Conflicted files' })).getByText('File 1 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next conflicted file' }))
    expect(await screen.findByRole('heading', { name: 'Resolve: b.txt' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous conflicted file' }))
    await screen.findByRole('heading', { name: 'Resolve: a.txt' })
    await screen.findByText('1 of 1 left')
    fireEvent.click(within(screen.getByRole('region', { name: 'Resolve a.txt' })).getByRole('button', { name: "Take dev's" }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next conflict: b.txt →' }))
    expect(await screen.findByRole('heading', { name: 'Resolve: b.txt' })).toBeTruthy()
  })

  it('a focused conflict shows the resolve screen, and Undo stays after it is staged', async () => {
    const git = conflicted()
    await openWorktree(git)
    fireEvent.click(await screen.findByText('c.txt'))
    expect(await screen.findByRole('heading', { name: 'Resolve: c.txt' })).toBeTruthy()
    expect(screen.queryByText('Resolve in your editor, then stage the file.')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Diff or edit' })).toBeNull()
    await screen.findByText('1 of 1 left')
    fireEvent.click(within(screen.getByRole('region', { name: 'Resolve c.txt' })).getByRole('button', { name: "Take dev's" }))
    const statusCalls = git.status.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(git.resolveConflict).toHaveBeenCalledWith(expect.anything(), 'C:/repos/A', expect.anything(), 'c.txt', { take: 'text', text: 'L\n', bom: false, force: false }, 'c1'))
    await waitFor(() => expect(git.status.mock.calls.length).toBeGreaterThan(statusCalls))
    await waitFor(() => expect(screen.queryByRole('button', { name: "Take dev's for c.txt" })).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: 'Undo resolution' }))
    await waitFor(() => expect(git.unresolve).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: "Take dev's for c.txt" })).toBeTruthy()
    expect(await screen.findByText('1 of 1 left')).toBeTruthy()
  })

  it('a file that conflicts again after being resolved shows its sides again', async () => {
    const git = conflicted()
    await openWorktree(git)
    fireEvent.click(await screen.findByText('c.txt'))
    await screen.findByText('1 of 1 left')
    fireEvent.click(within(screen.getByRole('region', { name: 'Resolve c.txt' })).getByRole('button', { name: "Take dev's" }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }))
    await screen.findByRole('button', { name: 'Undo resolution' })
    await waitFor(() => expect(screen.queryByRole('button', { name: "Take dev's for c.txt" })).toBeNull())
    // The next step of the rebase (or something outside the app) puts c.txt back in conflict.
    git.resolveConflict.mockClear()
    git.status.mockImplementation(async () => ({
      porcelain: porcelain(`u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} c.txt\0`),
      operation: 'Rebase in progress', rebasingBranch: 'main', fetchedAt: null,
      operationInfo: { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 2, total: 2, replaying: { oid: oid(3), subject: 'More' } },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('1 of 1 left')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Resolve c.txt' })).getByRole('button', { name: "Take dev's" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo resolution' })).toBeNull()
  })

  it('leaving a half-resolved file asks first', async () => {
    const git = conflicted()
    await openWorktree(git)
    fireEvent.click(await screen.findByText('c.txt'))
    await screen.findByText('1 of 1 left')
    fireEvent.click(within(screen.getByRole('region', { name: 'Resolve c.txt' })).getByRole('button', { name: 'Take mine' }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to c.txt?')
    expect(screen.getByRole('heading', { name: 'Resolve: c.txt' })).toBeTruthy()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Resolve: c.txt' })).toBeNull())
  })
})

describe('unsaved resolve text is never stranded', () => {
  const h = 'f'.repeat(40)
  const MARKED = '<<<<<<< HEAD\nL\n=======\nR\n>>>>>>> fix\n'
  const OP = { kind: 'rebase', onto: { name: 'refs/heads/dev', oid: oid(1) }, step: 1, total: 2, replaying: { oid: oid(2), subject: 'Fix' } }
  const KEY = conflictDraftKey('C:/repos/A', 'C:/repos/A', 'c.txt')
  const make = ({ conflicted = true } = {}) => adapter({
    status: vi.fn(async () => ({
      porcelain: porcelain(conflicted ? `u UU N... 100644 100644 100644 100644 ${h} ${h} ${h} c.txt\0` : `1 .M N... 100644 100644 100644 ${h} ${h} c.txt\0`),
      operation: 'Rebase in progress', rebasingBranch: 'refs/heads/main', fetchedAt: null, operationInfo: OP,
    })),
    conflict: vi.fn(async () => ({ kind: 'both-modified', binary: false, stages: { base: null, left: { text: 'L\n' }, right: { text: 'R\n' } }, working: { text: MARKED, bom: false, stamp: 'w1' }, stamp: 'c1' })),
    resolveConflict: vi.fn(async () => ({ ok: true })),
    stamp: vi.fn(async () => 'stamp-1'),
  })
  const halfResolved = async git => {
    await openWorktree(git)
    fireEvent.click(await screen.findByText('c.txt'))
    await screen.findByText('1 of 1 left')
    fireEvent.click(within(screen.getByRole('region', { name: 'Resolve c.txt' })).getByRole('button', { name: 'Take mine' }))
    expect(getWorktreeDraft(KEY)).toBeTruthy()
  }
  const previewed = (git, kind) => git.preview.mock.calls.some(c => c[3] === kind)
  afterEach(() => { vi.restoreAllMocks(); clearWorktreeDrafts() })
  // jsdom has no layout; CodeMirror measures text ranges.
  beforeEach(() => {
    Range.prototype.getClientRects ??= () => []
    Range.prototype.getBoundingClientRect ??= () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  })

  for (const kind of ['Skip', 'Abort']) {
    it(`${kind} asks about unsaved resolve text first; declining opens nothing, confirming drops the draft`, async () => {
      const git = make()
      await halfResolved(git)
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      fireEvent.click(screen.getByRole('button', { name: kind }))
      expect(confirm).toHaveBeenCalledWith('Discard unsaved changes to c.txt?')
      expect(previewed(git, kind.toLowerCase())).toBe(false)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(getWorktreeDraft(KEY)).toBeTruthy()
      confirm.mockReturnValue(true)
      fireEvent.click(screen.getByRole('button', { name: kind }))
      await waitFor(() => expect(previewed(git, kind.toLowerCase())).toBe(true))
      expect(getWorktreeDraft(KEY)).toBeUndefined()
    })
  }

  it('Abort asks first: the preview says the branch goes back as it was and resolved conflicts are lost', async () => {
    const git = make()
    await openWorktree(git)
    fireEvent.click(await screen.findByRole('button', { name: 'Abort' }))
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[3]).toBe('abort'))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.textContent).toContain('Puts main back exactly as it was before the rebase started.'))
    expect(within(dialog).getByRole('note').textContent).toContain("Conflicts you've resolved so far are lost")
    expect(git.run).not.toHaveBeenCalled()
  })

  it('a kept resolve draft of a still-conflicted file opens its resolve screen, with the edits restored', async () => {
    putWorktreeDraft(KEY, { text: 'R\n', saved: MARKED, eol: '\n', bom: false, stamp: 'w1' })
    const git = make()
    await openWorktree(git)
    const note = await screen.findByRole('note', { name: 'Unsaved edits' })
    fireEvent.click(within(note).getByRole('button', { name: 'c.txt' }))
    expect(await screen.findByRole('heading', { name: 'Resolve: c.txt' })).toBeTruthy()
    expect(await screen.findByText('Unsaved changes from earlier were restored.')).toBeTruthy()
  })

  it('a kept resolve draft of a file no longer conflicted offers Discard, asking first', async () => {
    putWorktreeDraft(KEY, { text: 'R\n', saved: MARKED, eol: '\n', bom: false, stamp: 'w1' })
    const git = make({ conflicted: false })
    await openWorktree(git)
    const note = await screen.findByRole('note', { name: 'Unsaved edits' })
    expect(within(note).queryByRole('button', { name: 'c.txt' })).toBeNull()
    const discard = within(note).getByRole('button', { name: 'Discard unsaved resolve edits to c.txt' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(discard)
    expect(confirm).toHaveBeenCalledWith("Discard unsaved resolve edits to c.txt? It isn't conflicted any more, so they can't be used.")
    expect(getWorktreeDraft(KEY)).toBeTruthy()
    confirm.mockReturnValue(true)
    fireEvent.click(discard)
    expect(getWorktreeDraft(KEY)).toBeUndefined()
    await waitFor(() => expect(screen.queryByRole('note', { name: 'Unsaved edits' })).toBeNull())
  })
})

describe('RebaseDialog', () => {
  const commits = [{ oid: oid(1), subject: 'one' }, { oid: oid(2), subject: 'two' }, { oid: oid(3), subject: 'three' }]
  it('orders, sets actions and messages, and runs with the rows', () => {
    const onRun = vi.fn()
    render(<RebaseDialog commits={commits} base={oid(0)} onClose={() => {}} onRun={onRun} />)
    fireEvent.click(screen.getByRole('button', { name: `Move ${oid(3).slice(0, 7)} up` }))
    fireEvent.change(screen.getByRole('combobox', { name: `Action for ${oid(2).slice(0, 7)}` }), { target: { value: 'squash' } })
    // two now follows one... after the move the order is one, three, two; two squashes into three.
    fireEvent.change(screen.getByRole('textbox', { name: `Message for ${oid(2).slice(0, 7)}` }), { target: { value: 'three and two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview rebase' }))
    expect(onRun).toHaveBeenCalledWith({ base: oid(0), rows: [
      { oid: oid(1), action: 'pick', message: null }, { oid: oid(3), action: 'pick', message: null }, { oid: oid(2), action: 'squash', message: 'three and two' },
    ] })
  })
  it('blocks a plan git would refuse', () => {
    render(<RebaseDialog commits={commits} base={oid(0)} onClose={() => {}} onRun={() => {}} />)
    fireEvent.change(screen.getByRole('combobox', { name: `Action for ${oid(1).slice(0, 7)}` }), { target: { value: 'fixup' } })
    expect(screen.getByRole('alert').textContent).toMatch(/first commit can't be squashed/)
    expect(screen.getByRole('button', { name: 'Preview rebase' }).disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: `Action for ${oid(1).slice(0, 7)}` }), { target: { value: 'reword' } })
    expect(screen.getByRole('alert').textContent).toMatch(/Give 1111111 a message/)
  })
})
