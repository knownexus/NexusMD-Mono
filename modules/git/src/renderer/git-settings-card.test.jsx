import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GitSettingsCard } from './git-settings-card.jsx'
import { getGitConfig, setGitConfig } from './git-config.js'
import { getProfileKey } from '@nexusmd/shell-sdk'

// Lets every promise callback already queued run (setImmediate comes after them all): ordering, not a wait on the clock.
const flushPromises = () => act(() => new Promise(r => setImmediate(r)))

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function adapter() {
  return {
    isAvailable: () => true,
    resolve: vi.fn(async dir => ({ commonDir: dir.includes('copy') ? 'C:/repos/A/.git' : `${dir}/.git` })),
    checkFolders: vi.fn(async paths => paths.map(p => ({ path: p, exists: !p.includes('missing') }))),
    shellAliases: vi.fn(async folder => (folder.includes('empty') ? '' : 'function global:ga { git add @args }\nfunction global:gup { git reset HEAD~1 }\n')),
    // Discovery reports which found repositories are registered right now.
    discover: vi.fn(async (roots, repos) => ['A', 'Payments', 'Tools'].map(name => {
      const path = `C:/repos/${name}`
      return { name, path, commonDir: `${path}/.git`, registeredAs: repos.find(r => r.path === path)?.name ?? null }
    })),
  }
}

describe('GitSettingsCard', () => {
  it('saves the DotFiles folder, says how many git shortcuts it has, and turns them off when cleared', async () => {
    const git = adapter()
    render(<GitSettingsCard adapter={git} picker={{}} />)
    const folder = screen.getByRole('textbox', { name: 'DotFiles folder' })
    expect(folder.value).toBe('C:/repos/DotFiles')
    fireEvent.change(folder, { target: { value: 'D:/dots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }))
    expect(await screen.findByText('Saved · 2 git shortcuts found')).toBeTruthy()
    expect(getGitConfig().dotfiles).toBe('D:/dots')
    fireEvent.change(folder, { target: { value: 'D:/empty' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }))
    expect(await screen.findByText('Saved, but no git shortcuts were found in D:/empty/pwsh/profile.d')).toBeTruthy()
    fireEvent.change(folder, { target: { value: 'dots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }))
    expect(await screen.findByText('Use one absolute folder: dots')).toBeTruthy()
    fireEvent.change(folder, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }))
    expect(await screen.findByText('DotFiles shortcuts turned off')).toBeTruthy()
    expect(getGitConfig().dotfiles).toBe('')
  })

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

  it('lists discovered repositories in a dropdown, ticked when registered, and registers or unregisters on click', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    const git = adapter()
    render(<GitSettingsCard adapter={git} picker={{}} />)
    const toggle = await screen.findByRole('button', { name: 'Discovered repositories (3)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('checkbox', { name: 'Payments' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'A' }).checked).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Payments' }).checked).toBe(false)
    expect(screen.getByText('C:/repos/Payments')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payments' }))
    await waitFor(() => expect(getGitConfig().repos.map(r => r.name)).toEqual(['A', 'Payments']))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Payments' }).checked).toBe(true))
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    await waitFor(() => expect(getGitConfig().repos.map(r => r.name)).toEqual(['Payments']))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'A' }).checked).toBe(false))
    expect(git.discover).toHaveBeenLastCalledWith(['C:/repos'], [{ name: 'Payments', path: 'C:/repos/Payments' }])
  })

  it('says when discovery is off or finds nothing', async () => {
    setGitConfig({ roots: [] })
    render(<GitSettingsCard adapter={adapter()} picker={{}} />)
    expect(await screen.findByText('Set a search folder to list repositories found there.')).toBeTruthy()
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
    expect(await screen.findByText('No search folders · add repositories by folder below')).toBeTruthy()
    expect(getGitConfig().roots).toEqual([])
  })

  it('disables every control and writes nothing when the settings are from a newer version', () => {
    const raw = JSON.stringify({ version: 2, repos: [{ name: 'A', path: 'C:/repos/A' }] })
    localStorage.setItem(getProfileKey('git.config'), raw)
    const picker = { pickDirectory: vi.fn() }
    render(<GitSettingsCard adapter={adapter()} picker={picker} />)
    expect(screen.getByText(/saved by a newer NexusMD \(version 2\) and can't be edited here/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add repository…' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Save folders' }).disabled).toBe(true)
    expect(screen.getByLabelText('Search folders').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(picker.pickDirectory).not.toHaveBeenCalled()
    expect(localStorage.getItem(getProfileKey('git.config'))).toBe(raw)
  })

  it('rejects a UNC search folder with the network message and keeps the saved folders', () => {
    setGitConfig({ roots: ['C:/repos'] })
    render(<GitSettingsCard adapter={adapter()} picker={{}} />)
    fireEvent.change(screen.getByLabelText('Search folders'), { target: { value: '\\\\server\\share' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(screen.getByText("Network (UNC) paths aren't supported: \\\\server\\share")).toBeTruthy()
    expect(getGitConfig().roots).toEqual(['C:/repos'])
  })

  it('shows a network refusal from the main process without the IPC prefix', async () => {
    const a = adapter()
    a.resolve = vi.fn(async () => { throw new Error("Error invoking remote method 'git:resolve': Error: Network (UNC) paths aren't supported") })
    const picker = { pickDirectory: vi.fn().mockResolvedValueOnce('\\\\server\\share\\repo') }
    render(<GitSettingsCard adapter={a} picker={picker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    expect(await screen.findByText("Network (UNC) paths aren't supported")).toBeTruthy()
    expect(getGitConfig().repos).toEqual([])
  })

  it('names the registered repository after adding it', async () => {
    const picker = { pickDirectory: vi.fn().mockResolvedValueOnce('D:\\src\\Payments') }
    render(<GitSettingsCard adapter={adapter()} picker={picker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    expect(await screen.findByText('Added Payments')).toBeTruthy()
  })

  it('keeps the saved folders and says so when checking them fails', async () => {
    const a = adapter()
    a.checkFolders = vi.fn(async () => { throw new Error('boom') })
    render(<GitSettingsCard adapter={a} picker={{}} />)
    fireEvent.change(screen.getByLabelText('Search folders'), { target: { value: 'C:/repos; D:/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save folders' }))
    expect(await screen.findByText("Saved, but couldn't check the folders")).toBeTruthy()
    expect(getGitConfig().roots).toEqual(['C:/repos', 'D:/x'])
  })

  it('flags missing repositories and search folders on load', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'Gone', path: 'C:/repos/missing-repo' }], roots: ['C:/repos', 'D:/missing'] })
    const a = adapter()
    render(<GitSettingsCard adapter={a} picker={{}} />)
    expect(await screen.findByText('Not found: D:/missing')).toBeTruthy()
    expect(a.checkFolders).toHaveBeenCalledWith(['C:/repos/A', 'C:/repos/missing-repo', 'C:/repos', 'D:/missing'])
    expect(screen.getAllByText('not found')).toHaveLength(1)
    expect(screen.getByText('not found').closest('div').textContent).toContain('Gone')
  })

  it('checks again when the repositories change and ignores a stale answer', async () => {
    setGitConfig({ repos: [{ name: 'Gone', path: 'C:/repos/missing-repo' }], roots: [] })
    const a = adapter()
    let answerFirst
    a.checkFolders = vi.fn()
      .mockImplementationOnce(paths => new Promise(r => { answerFirst = () => r(paths.map(p => ({ path: p, exists: false }))) }))
      .mockImplementation(async paths => paths.map(p => ({ path: p, exists: true })))
    render(<GitSettingsCard adapter={a} picker={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Gone' }))
    await waitFor(() => expect(a.checkFolders).toHaveBeenCalledTimes(2))
    answerFirst()
    await flushPromises()
    expect(screen.queryByText('not found')).toBeNull()
  })

  it('ignores a failing folder check on load', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    const a = adapter()
    a.checkFolders = vi.fn(async () => { throw new Error('boom') })
    render(<GitSettingsCard adapter={a} picker={{}} />)
    await waitFor(() => expect(a.checkFolders).toHaveBeenCalled())
    expect(screen.queryByText('not found')).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove A' })).toBeTruthy()
  })

  it('ignores a second Add repository click while one is running', async () => {
    let pick
    const picker = { pickDirectory: vi.fn(() => new Promise(r => { pick = r })) }
    render(<GitSettingsCard adapter={adapter()} picker={picker} />)
    const button = screen.getByRole('button', { name: 'Add repository…' })
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(picker.pickDirectory).toHaveBeenCalledTimes(1)
    pick('D:\\src\\Payments')
    expect(await screen.findByText('Added Payments')).toBeTruthy()
    expect(button.disabled).toBe(false)
  })

  it('registers against the settings as they are after the repository check', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }], roots: ['C:/repos'] })
    const a = adapter()
    const resolve = a.resolve
    let changed = false
    a.resolve = vi.fn(async dir => {
      if (!changed) { changed = true; setGitConfig({ repos: [...getGitConfig().repos, { name: 'B', path: 'C:/repos/B' }], roots: ['D:/other'] }) }
      return resolve(dir)
    })
    const picker = { pickDirectory: vi.fn().mockResolvedValueOnce('D:\\src\\Payments') }
    render(<GitSettingsCard adapter={a} picker={picker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    expect(await screen.findByText('Added Payments')).toBeTruthy()
    expect(getGitConfig().repos.map(r => r.name)).toEqual(['A', 'B', 'Payments'])
    expect(getGitConfig().roots).toEqual(['D:/other'])
  })

  it('clears the last message when a registration is removed', async () => {
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    const picker = { pickDirectory: vi.fn().mockResolvedValueOnce('D:\\src\\a-copy') }
    render(<GitSettingsCard adapter={adapter()} picker={picker} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add repository…' }))
    expect(await screen.findByText('That repository is already registered as A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
