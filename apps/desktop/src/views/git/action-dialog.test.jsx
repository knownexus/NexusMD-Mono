import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, renderHook, act } from '@testing-library/react'
import { useGitSync } from './use-git-sync.js'
import { ActionDialog, ActivityDrawer } from './action-dialog.jsx'

afterEach(cleanup)

const target = (n, over = {}) => ({ id: `C:/repos/${n}`, repo: n, repoRoot: `C:/repos/${n}`, worktreePath: `C:/repos/${n}`, title: `${n} › main → main`, ticked: true, unavailable: null, ...over })
const registered = ['C:/repos/A', 'C:/repos/B', 'C:/repos/C']
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function adapter(over = {}) {
  return {
    preview: vi.fn(async (repo, wt, reg, kind) => ({ eligible: true, reason: null, details: kind === 'pull' ? { behind: 1, ahead: 0, asOf: 'as of the last fetch', incoming: [{ oid: 'abc1234', subject: 'theirs' }] } : null, programs: repo.name === 'A' ? ['pre-push hook'] : [], stamp: `s-${repo.name}` })),
    run: vi.fn(async () => ({ ok: true, detail: 'Done' })),
    refs: vi.fn(async () => ({ refs: 'refs/heads/main\0a\0\0*\nrefs/remotes/origin/feature/x\0b\0\0 \n', originHead: null, shallow: false })),
    ...over,
  }
}

function Harness({ git, reload = () => {} }) {
  const sync = useGitSync({ adapter: git, registered, reload })
  globalThis.__sync = sync
  return <><ActionDialog sync={sync} adapter={git} registered={registered} /><ActivityDrawer sync={sync} /></>
}
const sync = () => globalThis.__sync

describe('useGitSync and the action dialog', () => {
  it('previews every target, shows skipped ones with reasons and what runs, and the batch note', async () => {
    const git = adapter({ preview: vi.fn(async repo => (repo.name === 'B' ? { eligible: false, reason: 'no upstream', programs: [] } : { eligible: true, details: null, programs: ['post-merge hook'], stamp: 's' })) })
    render(<Harness git={git} />)
    act(() => sync().open('fetch', [target('A'), target('B'), target('C', { unavailable: 'missing' })]))
    await screen.findByText('no upstream')
    expect(screen.getByText('missing')).toBeTruthy()
    expect(git.preview).toHaveBeenCalledTimes(2)
    expect(screen.getAllByText('Runs: post-merge hook')).toHaveLength(1)
    expect(screen.getByText('Each repository runs separately; if one fails the others are not undone.')).toBeTruthy()
  })

  it('runs only eligible targets with their stamps, once, and logs each result', async () => {
    const reload = vi.fn()
    const gate = deferred()
    const git = adapter({ run: vi.fn(async (repo) => { await gate.promise; return repo.name === 'B' ? { ok: false, detail: 'boom\nmore' } : { ok: true, detail: 'Done' } }) })
    render(<Harness git={git} reload={reload} />)
    act(() => sync().open('fetch', [target('A'), target('B')]))
    const run = await screen.findByRole('button', { name: 'Fetch' })
    await waitFor(() => expect(run.disabled).toBe(false))
    fireEvent.click(run)
    fireEvent.click(screen.getByRole('button', { name: 'Running…' }))
    gate.resolve()
    await screen.findByRole('button', { name: 'Retry failed' })
    expect(git.run).toHaveBeenCalledTimes(2)
    expect(git.run).toHaveBeenCalledWith({ name: 'A', path: 'C:/repos/A' }, 'C:/repos/A', registered, 'fetch', {}, 's-A')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Failed')).toBeTruthy()
    expect(sync().activity.map(e => [e.label, e.ok, e.summary])).toEqual([['B › main → main', false, 'boom'], ['A › main → main', true, 'Done']])
  })

  it('Retry failed re-previews only the failures', async () => {
    const git = adapter({ run: vi.fn(async repo => (repo.name === 'B' ? { ok: false, detail: 'boom' } : { ok: true, detail: 'Done' })) })
    render(<Harness git={git} />)
    act(() => sync().open('fetch', [target('A'), target('B')]))
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry failed' }))
    await waitFor(() => expect(sync().dialog.targets.map(t => t.repo)).toEqual(['B']))
    expect(git.preview.mock.calls.at(-1)[0]).toEqual({ name: 'B', path: 'C:/repos/B' })
  })

  it('Drop needs the word DROP typed', async () => {
    render(<Harness git={adapter()} />)
    act(() => sync().open('stashDrop', [target('A')], { oid: 'c'.repeat(40) }))
    const drop = await screen.findByRole('button', { name: 'Drop' })
    await waitFor(() => expect(screen.queryByText('Checking the current state…')).toBeNull())
    expect(drop.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Type DROP to confirm' }), { target: { value: 'DROP' } })
    expect(drop.disabled).toBe(false)
  })

  it('changing an option previews again with it', async () => {
    const git = adapter()
    render(<Harness git={git} />)
    act(() => sync().open('pull', [target('A')], { mode: 'ff' }))
    await screen.findByText('1 to bring in, 0 of yours (as of the last fetch).')
    fireEvent.click(screen.getByRole('button', { name: 'Rebase' }))
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ mode: 'rebase' }))
  })

  it('a stale result is shown as git returned it', async () => {
    const git = adapter({ run: vi.fn(async () => ({ ok: false, stale: true, detail: 'Changed since the preview. Preview again.' })) })
    render(<Harness git={git} />)
    act(() => sync().open('pull', [target('A')], { mode: 'ff' }))
    const pull = await screen.findByRole('button', { name: 'Pull' })
    await waitFor(() => expect(pull.disabled).toBe(false))
    fireEvent.click(pull)
    expect(await screen.findByText('Changed since the preview. Preview again.')).toBeTruthy()
  })

  it('a new worktree from a remote branch gets devenv\'s folder name', async () => {
    const git = adapter()
    render(<Harness git={git} />)
    act(() => sync().open('worktreeAdd', [target('A')], {}))
    const branch = await screen.findByRole('combobox', { name: 'Branch' })
    await waitFor(() => expect(branch.options.length).toBe(3))
    fireEvent.change(branch, { target: { value: 'refs/remotes/origin/feature/x' } })
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ ref: 'refs/remotes/origin/feature/x', path: 'C:/repos/A/feature-x' }))
  })

  it('the activity drawer expands to git\'s output', async () => {
    render(<Harness git={adapter()} />)
    act(() => sync().open('fetch', [target('A')]))
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Activity (1)' }))
    expect(screen.getByText(/Fetch · A › main → main - Done/)).toBeTruthy()
  })
})
