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
    expect(screen.getAllByLabelText('Runs: post-merge hook')).toHaveLength(1)
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

  it('reset lists what leaves the branch and warns about pushed commits and lost changes', async () => {
    const details = { oid: 'f'.repeat(40), mode: 'hard', branch: 'main', subject: 'base', count: 2, pushed: 1, dirty: true, lost: ['f.txt', 'g.txt'], leaves: [{ oid: 'abc1234', subject: 'two' }, { oid: 'abc1233', subject: 'one' }] }
    const git = adapter({ preview: vi.fn(async () => ({ eligible: true, details, programs: [], stamp: 's' })) })
    render(<Harness git={git} />)
    act(() => sync().open('reset', [target('A')], { oid: 'f'.repeat(40), mode: 'hard' }))
    expect((await screen.findByText(/back to/)).textContent).toBe('Moves main back to fffffff “base”; 2 commits leave the branch.')
    expect(screen.getByText('Leaves the branch')).toBeTruthy()
    expect(screen.getByText(/1 of these commits is already pushed/)).toBeTruthy()
    expect(screen.getByText(/these 2 files are thrown away for good/)).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Changes thrown away' }).textContent).toBe('f.txtg.txt')
    expect(screen.getByRole('radio', { name: 'Hard' }).checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Reset (hard)' }).className).toContain('danger')
  })

  it('cherry-pick warns when the target branch changed the same files', async () => {
    const details = { oid: 'e'.repeat(40), branch: 'feat', subject: 'fix', files: 2, overlap: ['a.js'], x: false }
    const git = adapter({ preview: vi.fn(async () => ({ eligible: true, details, programs: [], stamp: 's' })) })
    render(<Harness git={git} />)
    act(() => sync().open('cherryPick', [target('A')], { oid: 'e'.repeat(40) }, { choices: [target('A')] }))
    expect(await screen.findByText('feat has also changed a file this commit touches (a.js), so expect conflicts.')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Onto branch' }).value).toBe('C:/repos/A')
  })

  it('cherry-pick with nowhere to go says so', async () => {
    render(<Harness git={adapter()} />)
    act(() => sync().open('cherryPick', [], { oid: 'e'.repeat(40) }, { choices: [] }))
    expect(await screen.findByText('No other worktree of this repository to pick onto. Add one first.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cherry-pick' }).disabled).toBe(true)
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

  it('rebase starts on origin\'s default branch, fetching it, and can switch to a tag or a typed commit', async () => {
    const details = { count: 2, branch: 'feat', label: 'origin/main', remote: 'origin', fetch: true, pushed: 1, merges: 0, dirty: false, asOf: 'before fetching', replay: [{ oid: 'aaa1111', subject: 'mine' }], incoming: [{ oid: 'bbb2222', subject: 'theirs' }] }
    const git = adapter({
      preview: vi.fn(async (_r, _w, _g, _k, o) => (o.onto ? { eligible: true, details, programs: [], stamp: 's' } : { eligible: false, reason: 'Choose where to rebase onto.', programs: [] })),
      refs: vi.fn(async () => ({
        refs: ['refs/heads/feat\0a\0\0*', 'refs/heads/main\0b\0\0 ', 'refs/remotes/origin/HEAD\0b\0\0 ', 'refs/remotes/origin/main\0b\0\0 ', 'refs/tags/v1\0c\0\0 '].join('\n') + '\n',
        originHead: 'refs/remotes/origin/main', shallow: false,
      })),
    })
    render(<Harness git={git} />)
    act(() => sync().open('rebase', [target('A')], {}))
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ onto: 'refs/remotes/origin/main', fetch: true }))
    // The branch names are set apart as chips, so the sentence spans several elements.
    const line = await screen.findByText((_, el) => el?.tagName === 'DIV' && el.textContent === 'Replays 2 commits of feat onto origin/main.')
    expect([...line.querySelectorAll('.nx-ref')].map(r => r.textContent)).toEqual(['feat', 'origin/main'])
    expect(screen.getByText(/1 of these commits is already pushed/)).toBeTruthy()
    const onto = screen.getByRole('combobox', { name: 'Rebase onto' })
    expect([...onto.options].map(o => o.textContent)).toEqual(['(choose)', 'main', 'origin/main', 'v1', 'Another commit, tag or branch…'])
    expect(screen.getByRole('checkbox', { name: 'Fetch origin first' }).checked).toBe(true)

    fireEvent.change(onto, { target: { value: 'refs/tags/v1' } })
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ onto: 'refs/tags/v1', fetch: false }))
    expect(screen.queryByRole('checkbox', { name: /Fetch/ })).toBeNull()

    fireEvent.change(onto, { target: { value: '__other__' } })
    const typed = screen.getByRole('textbox', { name: 'Commit, tag or branch' })
    fireEvent.change(typed, { target: { value: 'abc1234' } })
    fireEvent.blur(typed)
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ onto: 'abc1234', fetch: false }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Stash my uncommitted changes and put them back afterwards' }))
    await waitFor(() => expect(git.preview.mock.calls.at(-1)[4]).toEqual({ onto: 'abc1234', fetch: false, autostash: true }))
  })

  it('shows an interactive rebase\'s plan as one coloured step per commit', async () => {
    const todo = `pick ${'a'.repeat(40)}\nsquash ${'b'.repeat(40)}\ndrop ${'c'.repeat(40)}\n`
    const git = adapter({ preview: vi.fn(async () => ({ eligible: true, details: { todo }, programs: [], stamp: 's' })) })
    render(<Harness git={git} />)
    act(() => sync().open('rebaseInteractive', [target('A')], { base: 'x', rows: [] }))
    const steps = await screen.findByRole('list', { name: 'Rebase steps' })
    expect([...steps.querySelectorAll('li')].map(li => li.textContent)).toEqual(['pick aaaaaaa', 'squash bbbbbbb', 'drop ccccccc'])
    expect([...steps.querySelectorAll('.nx-todo-action')].map(a => a.dataset.action)).toEqual(['pick', 'squash', 'drop'])
  })

  it('the activity drawer expands to git\'s output', async () => {
    render(<Harness git={adapter()} />)
    act(() => sync().open('fetch', [target('A')]))
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Activity (1)' }))
    expect(screen.getByText(/Fetch · A › main → main - Done/)).toBeTruthy()
  })

  it('the activity drawer closes, and comes back when another action logs', async () => {
    render(<Harness git={adapter()} />)
    act(() => sync().open('fetch', [target('A')]))
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch' }))
    await screen.findByRole('button', { name: 'Activity (1)' })
    fireEvent.click(screen.getByRole('button', { name: 'Close activity' }))
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull()
    act(() => sync().close())
    act(() => sync().open('fetch', [target('B')]))
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch' }))
    expect(await screen.findByRole('button', { name: 'Activity (2)' })).toBeTruthy()
  })
})
