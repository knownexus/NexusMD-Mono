import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GitSettingsCard } from './git-settings-card.jsx'
import { getGitConfig, setGitConfig } from './git-config.js'

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
})
