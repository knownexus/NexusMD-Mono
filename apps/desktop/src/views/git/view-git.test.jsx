import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig, getGitConfig } from '../../git-config.js'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

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
  it('replaces the edited group when a config change lands while the editor is open', async () => {
    configure()
    render(<ViewGit adapters={{ git: adapter() }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Group options for Only B' }))
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
})
