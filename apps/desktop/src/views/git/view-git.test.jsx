import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); clearGitSnapshotCache() })

const porcelain = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\x001 .M N... 100644 100644 100644 a a f.txt\0'
function adapter(overrides = {}) {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => {
      if (dir.endsWith('Broken')) throw new Error('No repository at C:/repos/Broken')
      return { commonDir: `${dir}/.git` }
    }),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
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

// Group options are offered for the active group, so its tab is selected first.
async function openGroupMenu(name) {
  const tabs = await screen.findByRole('tablist', { name: 'Project groups' })
  fireEvent.click(within(tabs).getByRole('tab', { name: new RegExp(`^${name}`) }))
  fireEvent.click(screen.getByRole('button', { name: `Group options for ${name}` }))
}

describe('ViewGit', () => {
  it('shows group tabs with repository counts and filters the repos by group', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    const tabs = await screen.findByRole('tablist', { name: 'Project groups' })
    expect(await within(tabs).findByRole('tab', { name: 'Registered repos 3 repos' })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: 'Only B 1 repo' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'A' })).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Only B 1 repo' }))
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
    expect(within(detail).getByText('C:/repos/A', { selector: '.nx-gw-path' })).toBeTruthy()
    // Testing Library trims text, so the ' M' status code is matched as 'M'.
    expect(within(detail).getByText('M')).toBeTruthy()
    expect(within(detail).getByText('f.txt')).toBeTruthy()
  })

  it('deletes a group from its menu after confirmation', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await openGroupMenu('Only B')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
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
  it('replaces the edited group when a config change lands while the editor is open', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    await openGroupMenu('Only B')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit members…' }))
    await screen.findByLabelText('Group name')
    setGitConfig({ view: { ...getGitConfig().view, collapsed: ['A'] } })
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Renamed B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(getGitConfig().groups.map(g => g.name)).toEqual(['Renamed B']))
  })

  it('renames the active group and keeps it selected in one write', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    const tabs = await screen.findByRole('tablist', { name: 'Project groups' })
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Only B 1 repo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Group options for Only B' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Team B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(getGitConfig().view.group).toBe('Team B')
    expect(getGitConfig().groups.map(g => g.name)).toEqual(['Team B'])
  })

  it('keeps New group and Edit members disabled until the first snapshot arrives', async () => {
    configure()
    const answers = []
    const a = adapter({ resolve: vi.fn(dir => new Promise(r => { answers.push(() => r({ commonDir: `${dir}/.git` })) })) })
    render(<ViewGit adapters={{ git: a }} />)
    const plus = await screen.findByRole('button', { name: 'New group' })
    expect(plus.disabled).toBe(true)
    expect(plus.title).toBe('Loading repositories…')
    await openGroupMenu('Only B')
    const edit = screen.getByRole('menuitem', { name: 'Edit members…' })
    expect(edit.disabled).toBe(true)
    expect(edit.title).toBe('Loading repositories…')
    fireEvent.click(edit)
    expect(screen.queryByLabelText('Group name')).toBeNull()
    answers.forEach(f => f())
    await waitFor(() => expect(screen.getByRole('button', { name: 'New group' }).disabled).toBe(false))
  })

  const loadsOfA = a => a.worktrees.mock.calls.filter(([repo]) => repo.name === 'A').length

  it('reloads once after saving a group that keeps the same repositories', async () => {
    configure()
    const a = adapter()
    render(<ViewGit adapters={{ git: a }} />)
    await screen.findByRole('region', { name: 'A' })
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
    await openGroupMenu('Only B')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit members…' }))
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'Renamed B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(loadsOfA(a)).toBe(2))
    await new Promise(r => setTimeout(r, 30))
    expect(loadsOfA(a)).toBe(2)
  })

  it('names the effective search folders in the empty state', async () => {
    setGitConfig({ roots: ['D:/src', 'E:/work'] })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect(await screen.findByText('No repositories registered yet. Pick them in Settings → Desktop → Git Workspace, which lists the repositories found in D:/src; E:/work.')).toBeTruthy()
    cleanup()
    setGitConfig({ roots: [] })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect(await screen.findByText('No repositories registered yet. Add them in Settings → Desktop → Git Workspace.')).toBeTruthy()
  })
  it('drops selected files that vanish on refresh', async () => {
    configure()
    let now = porcelain
    const a = adapter({ status: vi.fn(async () => ({ porcelain: now, operation: '', rebasingBranch: null, fetchedAt: null })) })
    render(<ViewGit adapters={{ git: a }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
    fireEvent.click(screen.getByLabelText('Select f.txt'))
    expect(screen.getByRole('button', { name: 'Stage 1' })).toBeTruthy()
    now = '# branch.oid a\0# branch.head main\0'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stage' }).disabled).toBe(true))
    expect(screen.getByText('Working tree clean')).toBeTruthy()
  })
})

describe('ViewGit header', () => {
  const BEHIND = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -2\0'

  it('counts only branches behind with nothing local for Pull all, and pulls just those', async () => {
    configure()
    const preview = vi.fn(async () => ({ eligible: true, details: { behind: 2, ahead: 0, asOf: 'now', incoming: [] }, programs: [], stamp: 's' }))
    const a = adapter({
      status: vi.fn(async repo => ({ porcelain: repo.name === 'B' ? BEHIND : porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
      preview,
    })
    render(<ViewGit adapters={{ git: a }} />)
    const pull = await screen.findByRole('button', { name: 'Pull all (1)' })
    fireEvent.click(pull)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(preview).toHaveBeenCalled())
    expect(preview.mock.calls.map(c => c[0].name)).toEqual(['B'])
    expect(within(dialog).getByRole('list', { name: 'Targets' }).children).toHaveLength(1)
  })

  it('disables Pull all when nothing qualifies', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect((await screen.findByRole('button', { name: 'Pull all (0)' })).disabled).toBe(true)
  })

  it('jumps to a branch by the start of its words', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    fireEvent.click(screen.getByRole('button', { name: /Jump to branch/ }))
    const box = screen.getByRole('combobox', { name: 'Branch name' })
    fireEvent.change(box, { target: { value: 'b ma' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(box, { target: { value: 'ain' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    fireEvent.change(box, { target: { value: 'b' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getGitConfig().view.selected).toBe('C:/repos/B')
  })

  it('filters the branch list by text and by chip, and clears both from the empty state', async () => {
    configure()
    const BEHIND_B = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -2\0'
    render(<ViewGit adapters={{ git: adapter({
      status: vi.fn(async repo => ({ porcelain: repo.name === 'B' ? BEHIND_B : porcelain, operation: '', rebasingBranch: null, fetchedAt: null })),
    }) }} />)
    await screen.findByRole('region', { name: 'A' })
    const chips = screen.getByRole('group', { name: 'Show branches' })
    await waitFor(() => expect(within(chips).getByRole('button', { name: /^To pull/ }).textContent).toBe('To pull1'))
    fireEvent.click(within(chips).getByRole('button', { name: /^To pull/ }))
    expect(screen.queryByRole('region', { name: 'A' })).toBeNull()
    expect(screen.getByRole('region', { name: 'B' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter branches and repos'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByLabelText('Filter branches and repos').value).toBe('')
    expect(screen.getByRole('region', { name: 'A' })).toBeTruthy()
  })

  it('offers the group menu as a popover for custom groups only', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    expect(screen.queryByRole('button', { name: /Group options/ })).toBeNull()
    await openGroupMenu('Only B')
    const menu = screen.getByRole('menu', { name: 'Group options for Only B' })
    expect(within(menu).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Edit members…', 'Rename…', 'Duplicate…', 'Delete…'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ViewGit shortcuts', () => {
  const press = (key, init = {}, target = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key, ...init })

  it('opens Jump to branch with Ctrl+K, but not over another dialog', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    press('k', { ctrlKey: true }, document.body)
    expect(screen.getByRole('combobox', { name: 'Branch name' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Branch name' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    press('k', { metaKey: true }, document.body)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('walks the visible branches with j and k, never while typing or with a modifier', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'B' })
    press('j', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/A')
    press('j', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/B')
    press('k', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/A')
    press('k', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/B')
    for (const init of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }]) press('j', init, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/B')
    // / focuses the filter; j typed there is text, not a move.
    press('/', {}, document.body)
    const box = screen.getByLabelText('Filter branches and repos')
    expect(document.activeElement).toBe(box)
    press('j', {}, box)
    expect(getGitConfig().view.selected).toBe('C:/repos/B')
    // Only what the filter shows is walked.
    fireEvent.change(box, { target: { value: 'a' } })
    press('j', {}, document.body)
    press('j', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/A')
    expect(screen.getAllByText('j', { selector: '.kbd' })).toHaveLength(1)
  })

  it('focuses the command line with ` and opens New branch with b', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter({ refs: vi.fn(async () => ({ refs: '', originHead: null })) }) }} />)
    await screen.findByRole('region', { name: 'A' })
    press('j', {}, document.body)
    press('`', {}, document.body)
    expect(document.activeElement).toBe(await screen.findByLabelText('git command'))
    press('b', {}, document.activeElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    press('b', {}, document.body)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // Inside a dialog the page's keys stay quiet.
    press('j', {}, document.body)
    expect(getGitConfig().view.selected).toBe('C:/repos/A')
  })
})

describe('ViewGit overview', () => {
  const head = (ab, upstream = '# branch.upstream origin/main\0') => `# branch.oid a\0# branch.head main\0${upstream}# branch.ab ${ab}\0`
  const STAGED = '1 M. N... 100644 100644 100644 a a s.txt\0'
  function withStatus(byRepo, extra = {}) {
    configure()
    const a = adapter({
      status: vi.fn(async repo => ({ porcelain: byRepo[repo.name], operation: '', rebasingBranch: null, fetchedAt: null })),
      preview: vi.fn(async () => ({ eligible: true, details: null, programs: [], stamp: 's' })),
      stamp: vi.fn(async () => 'stamp-1'),
      ...extra,
    })
    render(<ViewGit adapters={{ git: a }} />)
    return a
  }

  it('lists what needs attention when nothing is selected, and opens a branch on its changes', async () => {
    withStatus({ A: porcelain, B: head('+0 -2') })
    expect(await screen.findByRole('heading', { name: '2 branches need attention' })).toBeTruthy()
    const changes = screen.getByRole('region', { name: 'Uncommitted work' })
    fireEvent.click(within(changes).getByRole('button', { name: 'Review & commit' }))
    expect(getGitConfig().view.selected).toBe('C:/repos/A')
    expect(getGitConfig().view.panel).toBe('changes')
    expect(screen.queryByRole('heading', { name: /need attention/ })).toBeNull()
  })

  it('pulls one branch from the overview through the pull preview', async () => {
    const a = withStatus({ A: head('+0 -0'), B: head('+0 -2') })
    fireEvent.click(await screen.findByRole('button', { name: 'Pull ↓2' }))
    await waitFor(() => expect(a.preview).toHaveBeenCalled())
    expect(a.preview.mock.calls[0][0].name).toBe('B')
    expect(a.preview.mock.calls[0][3]).toBe('pull')
    expect(a.preview.mock.calls[0][4]).toEqual({ mode: 'ff' })
  })

  it('pushes an unpublished branch with a push that sets the upstream', async () => {
    const a = withStatus({ A: head('+0 -0'), B: '# branch.oid a\0# branch.head main\0' })
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }))
    await waitFor(() => expect(a.preview).toHaveBeenCalled())
    expect(a.preview.mock.calls[0][3]).toBe('push')
    expect(a.preview.mock.calls[0][4]).toEqual({ setUpstream: true })
  })

  it('commits across branches with every worktree that has staged files ticked', async () => {
    withStatus({ A: head('+0 -0') + STAGED, B: head('+0 -0') + STAGED })
    fireEvent.click(await screen.findByRole('button', { name: 'Commit across branches (2)…' }))
    const dialog = screen.getByRole('dialog')
    const boxes = within(within(dialog).getByRole('group', { name: 'Worktrees' })).getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    expect(boxes.every(b => b.checked)).toBe(true)
  })

  it('says so when nothing needs attention', async () => {
    withStatus({ A: head('+0 -0'), B: head('+0 -0') })
    expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeTruthy()
    expect(screen.getByText(/Nothing needs you right now/)).toBeTruthy()
  })
})

describe('ViewGit repository list', () => {
  it('hides the repository list to give the details the full width, and remembers it', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    fireEvent.click(screen.getByRole('button', { name: 'Hide repositories' }))
    expect(screen.queryByRole('region', { name: 'A' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeTruthy()
    expect(getGitConfig().view.list).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Show repositories' }))
    expect(screen.getByRole('region', { name: 'A' })).toBeTruthy()
  })
})
