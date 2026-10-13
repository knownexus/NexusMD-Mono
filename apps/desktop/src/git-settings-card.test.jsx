import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GitSettingsCard } from './git-settings-card.jsx'
import { getGitConfig, setGitConfig } from './git-config.js'
import { getProfileKey } from './profile-keys.js'

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
