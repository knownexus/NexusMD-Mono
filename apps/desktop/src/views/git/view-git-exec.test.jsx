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
  it('runs in the selected worktree and shows the output in the dock', async () => {
    const git = adapter()
    await typeCommand(git, 'status')
    await waitFor(() => expect(git.exec).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['status']))
    const out = await screen.findByRole('region', { name: 'Command output' })
    await waitFor(() => expect(within(out).getByText('nothing to commit')).toBeTruthy())
    expect(within(out).getByText('$ git status')).toBeTruthy()
    expect(within(out).queryByText('Working…')).toBeNull()
  })

  it('sits at the bottom of the details and keeps every run of the session', async () => {
    const git = adapter()
    await typeCommand(git, 'status')
    const details = screen.getByRole('complementary', { name: 'Details' })
    expect(details.lastElementChild.contains(screen.getByLabelText('git command'))).toBe(true)
    await screen.findByText('nothing to commit')
    const input = screen.getByLabelText('git command')
    await waitFor(() => expect(input.disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'log -1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(git.exec).toHaveBeenCalledTimes(2))
    const out = screen.getByRole('region', { name: 'Command output' })
    await waitFor(() => expect(within(out).getAllByText('nothing to commit')).toHaveLength(2))
    expect(within(out).getByText('$ git status')).toBeTruthy()
    expect(within(out).getByText('$ git log -1')).toBeTruthy()
  })

  it('shows a failing command with its exit code and stderr', async () => {
    const git = adapter({ exec: vi.fn(async () => ({ code: 1, stdout: '', stderr: "git: 'nope' is not a git command." })) })
    await typeCommand(git, 'nope')
    const out = await screen.findByRole('region', { name: 'Command output' })
    await waitFor(() => expect(within(out).getByText('exit 1')).toBeTruthy())
    expect(within(out).getByText("git: 'nope' is not a git command.").closest('.l-bad')).toBeTruthy()
  })

  it('shows a refused command without Electron\'s remote-method prefix', async () => {
    const git = adapter({ exec: vi.fn(async () => { throw new Error("Error invoking remote method 'git:exec': Error: git -C is not allowed here") }) })
    await typeCommand(git, '-C x status')
    const out = await screen.findByRole('region', { name: 'Command output' })
    await waitFor(() => expect(within(out).getByText('git -C is not allowed here')).toBeTruthy())
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
    const out = await screen.findByRole('region', { name: 'Command output' })
    expect(within(out).getByText(/can't run git commands/)).toBeTruthy()
  })
})

describe('aliases on the command line', () => {
  const ALIASES = 'alias.undo\nreset --hard HEAD~1\0alias.st\nstatus -sb\0'
  const PROFILE = 'function global:ga { git add @args }\r\nfunction global:grh2 { git reset --hard @args }\r\n'
  async function openWith(git) {
    setGitConfig({ repos: [REPO], groups: [] })
    render(<ViewGit adapters={{ git }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    await screen.findByRole('button', { name: 'My aliases (4) ▾' })
    const input = screen.getByLabelText('git command')
    return line => { fireEvent.change(input, { target: { value: line } }); fireEvent.keyDown(input, { key: 'Enter' }) }
  }
  const withAliases = () => adapter({ aliases: vi.fn(async () => ALIASES), shellAliases: vi.fn(async () => PROFILE) })

  it('reads git\'s aliases for the worktree and the DotFiles shortcuts from the default folder', async () => {
    const git = withAliases()
    const type = await openWith(git)
    expect(git.aliases).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG)
    expect(git.shellAliases).toHaveBeenCalledWith('C:/repos/DotFiles')
    type('ga x.txt')
    await waitFor(() => expect(git.exec).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, ['add', 'x.txt']))
    type('git st')
    await waitFor(() => expect(git.exec).toHaveBeenLastCalledWith(REPO, 'C:/repos/A', REG, ['st']))
  })

  it('asks first when an alias or a shortcut runs something destructive', async () => {
    const git = withAliases()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const type = await openWith(git)
    type('git undo')
    expect(confirm).toHaveBeenLastCalledWith('Run "git undo" (reset --hard HEAD~1) in C:/repos/A? This can\'t be undone from NexusMD.')
    type('grh2')
    expect(confirm).toHaveBeenLastCalledWith('Run "git reset --hard" in C:/repos/A? This can\'t be undone from NexusMD.')
    expect(git.exec).not.toHaveBeenCalled()
  })

  it('runs a DotFiles script in PowerShell, warmed up beforehand, and shows it as typed', async () => {
    const git = withAliases()
    git.shellAliases = vi.fn(async () => `# nexusmd-file: 12-git-core.ps1
${PROFILE}function global:g! { gstat }
`)
    git.shellWarm = vi.fn(async () => true)
    git.shellRun = vi.fn(async () => ({ code: 0, stdout: 'branch: main a1b2c3d', stderr: '' }))
    setGitConfig({ repos: [REPO], groups: [] })
    render(<ViewGit adapters={{ git }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    await screen.findByRole('button', { name: 'My aliases (5) ▾' })
    expect(git.shellWarm).toHaveBeenCalledWith('C:/repos/DotFiles')
    const input = screen.getByLabelText('git command')
    fireEvent.change(input, { target: { value: 'g!' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(git.shellRun).toHaveBeenCalledWith(REPO, 'C:/repos/A', REG, 'C:/repos/DotFiles', 'g!', []))
    const out = await screen.findByRole('region', { name: 'Command output' })
    await waitFor(() => expect(within(out).getByText('branch: main a1b2c3d')).toBeTruthy())
    expect(within(out).getByText('$ g!')).toBeTruthy()
    expect(git.exec).not.toHaveBeenCalled()
  })

  it('reads no DotFiles shortcuts once the folder is cleared', async () => {
    const git = withAliases()
    setGitConfig({ dotfiles: '' })
    setGitConfig({ repos: [REPO], groups: [] })
    render(<ViewGit adapters={{ git }} />)
    const region = await screen.findByRole('region', { name: 'A' })
    fireEvent.click(await within(region).findByRole('button', { name: /checkout → main/ }))
    await screen.findByRole('button', { name: 'My aliases (2) ▾' })
    expect(git.shellAliases).not.toHaveBeenCalled()
  })
})
