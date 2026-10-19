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
    await openGroupMenu('Only B')
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
  it('replaces the edited group when a config change lands while the editor is open', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    await screen.findByRole('region', { name: 'A' })
    await openGroupMenu('Only B')
    fireEvent.click(screen.getByRole('button', { name: 'Edit members…' }))
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
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Only B 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Group options for Only B' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }))
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
    const edit = screen.getByRole('button', { name: 'Edit members…' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit members…' }))
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'Renamed B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(loadsOfA(a)).toBe(2))
    await new Promise(r => setTimeout(r, 30))
    expect(loadsOfA(a)).toBe(2)
  })

  it('reloads once, not twice, after saving a group that registers a repository', async () => {
    configure()
    const a = adapter({ discover: vi.fn(async () => [{ name: 'C', path: 'C:/repos/C', commonDir: 'C:/repos/C/.git', registeredAs: null }]) })
    render(<ViewGit adapters={{ git: a }} />)
    await screen.findByRole('region', { name: 'A' })
    await waitFor(() => expect(screen.queryByText('Refreshing…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'New group' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'C' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(getGitConfig().repos.map(r => r.name)).toContain('C'))
    await waitFor(() => expect(loadsOfA(a)).toBe(2))
    await new Promise(r => setTimeout(r, 30))
    expect(loadsOfA(a)).toBe(2)
  })

  it('names the effective search folders in the empty state', async () => {
    setGitConfig({ roots: ['D:/src', 'E:/work'] })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect(await screen.findByText('No repositories yet. Add one in Settings → Desktop → Git Workspace, or create a group to pick from D:/src; E:/work.')).toBeTruthy()
    cleanup()
    setGitConfig({ roots: [] })
    render(<ViewGit adapters={{ git: adapter() }} />)
    expect(await screen.findByText('No repositories yet. Add repositories in Settings → Desktop → Git Workspace.')).toBeTruthy()
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
    expect(screen.getByText('No changes.')).toBeTruthy()
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
