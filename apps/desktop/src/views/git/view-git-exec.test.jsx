import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { ViewGit } from './view-git.jsx'
import { setGitConfig } from '../../git-config.js'
import { clearGitSnapshotCache } from './use-git-snapshot.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => { localStorage.clear(); clearGitSnapshotCache() })

const CLEAN = '# branch.oid a\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0'
const REPO = { name: 'A', path: 'C:/repos/A' }
const REG = ['C:/repos/A']

function adapter(over = {}) {
  return {
    isAvailable: () => true,
    version: vi.fn(async () => 'git version 2.50.0'),
    resolve: vi.fn(async dir => ({ commonDir: `${dir}/.git` })),
    worktrees: vi.fn(async repo => `worktree ${repo.path}\0HEAD a\0branch refs/heads/main\0\0`),
    status: vi.fn(async () => ({ porcelain: CLEAN, operation: '', rebasingBranch: null, fetchedAt: null })),
    branches: vi.fn(async () => ''),
    discover: vi.fn(async () => []),
    stashes: vi.fn(async () => []),
    preview: vi.fn(async () => ({ eligible: true, reason: null, details: null, programs: [], stamp: 's' })),
    exec: vi.fn(async () => ({ code: 0, stdout: 'On branch main\nnothing to commit\n', stderr: '' })),
    ...over,
  }
}

async function typeCommand(git, line) {
  setGitConfig({ repos: [REPO], groups: [] })
  render(<ViewGit adapters={{ git }} />)
  const region = await screen.findByRole('region', { name: 'A' })
  fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
  const input = await screen.findByLabelText('git command')
  fireEvent.change(input, { target: { value: line } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('the git command line', () => {
  it('runs in the selected worktree and shows the output in the drawer', async () => {
    const git = adapter()
    await typeCommand(git, 'status')
    await waitFor(() => expect(git.exec).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['status']))
    const drawer = await screen.findByRole('dialog', { name: 'git status' })
    await waitFor(() => expect(within(drawer).getByText('nothing to commit')).toBeTruthy())
    expect(within(drawer).getByText('Finished')).toBeTruthy()
    expect(within(drawer).getByText('$ git status')).toBeTruthy()
  })

  it('shows a failing command with its exit code and stderr', async () => {
    const git = adapter({ exec: vi.fn(async () => ({ code: 1, stdout: '', stderr: "git: 'nope' is not a git command." })) })
    await typeCommand(git, 'nope')
    const drawer = await screen.findByRole('dialog', { name: 'git nope' })
    await waitFor(() => expect(within(drawer).getByText('Failed (exit 1)')).toBeTruthy())
    expect(within(drawer).getByText("git: 'nope' is not a git command.")).toBeTruthy()
  })

  it('shows a refused command without Electron\'s remote-method prefix', async () => {
    const git = adapter({ exec: vi.fn(async () => { throw new Error("Error invoking remote method 'git:exec': Error: git -C is not allowed here") }) })
    await typeCommand(git, '-C x status')
    const drawer = await screen.findByRole('dialog', { name: 'git -C x status' })
    await waitFor(() => expect(within(drawer).getByText('git -C is not allowed here')).toBeTruthy())
  })

  it('opens the preview dialog for a bare fetch, pull or push instead of running it', async () => {
    const git = adapter()
    await typeCommand(git, 'pull')
    await waitFor(() => expect(git.preview).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'pull', { mode: 'ff' }))
    expect(git.exec).not.toHaveBeenCalled()
  })

  it('runs an inherited object name as a plain command', async () => {
    const git = adapter()
    await typeCommand(git, 'constructor')
    await waitFor(() => expect(git.exec).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['constructor']))
    expect(git.preview).not.toHaveBeenCalled()
  })

  it('asks before a destructive command and runs nothing when declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const git = adapter()
    await typeCommand(git, 'clean -fd')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('git clean -fd'))
    expect(git.exec).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    const input = screen.getByLabelText('git command')
    fireEvent.change(input, { target: { value: 'push --force-with-lease' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(git.exec).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['push', '--force-with-lease']))
  })

  it('says so when the desktop app has no command line channel', async () => {
    const git = adapter({ exec: undefined })
    await typeCommand(git, 'status')
    const drawer = await screen.findByRole('dialog', { name: 'git status' })
    expect(within(drawer).getByText(/can't run git commands/)).toBeTruthy()
  })
})
