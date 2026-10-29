import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), listGithubCommits: vi.fn(), getGithubCommit: vi.fn() }))
import { listGithubCommits, getGithubCommit } from '@nexusmd/core'
import { GithubHistory } from './github-history.jsx'

afterEach(() => { cleanup(); vi.clearAllMocks() })
const client = {}
const COMMITS = [{ sha: 'abcdef1234567', message: 'Fix bug\n\nlong body', author: 'Ann', date: new Date().toISOString() }]

describe('GithubHistory', () => {
  it('lists commits for the branch and refetches when it changes', async () => {
    listGithubCommits.mockResolvedValue(COMMITS)
    const { rerender } = render(<GithubHistory repo="acme/web" client={client} branch="main" />)
    expect(await screen.findByText(/Fix bug/)).toBeTruthy()
    expect(screen.getByText('abcdef1')).toBeTruthy()
    expect(listGithubCommits).toHaveBeenCalledWith(client, 'acme/web', 'main')
    rerender(<GithubHistory repo="acme/web" client={client} branch="dev" />)
    await waitFor(() => expect(listGithubCommits).toHaveBeenCalledWith(client, 'acme/web', 'dev'))
  })

  it('shows a commit\'s files and expands a patch', async () => {
    listGithubCommits.mockResolvedValue(COMMITS)
    getGithubCommit.mockResolvedValue({ ...COMMITS[0], files: [{ path: 'src/a.js', changeType: 'edit', additions: 1, deletions: 0, patch: '@@ -1 +1,2 @@\n x\n+new line' }] })
    render(<GithubHistory repo="acme/web" client={client} branch="main" />)
    fireEvent.click(await screen.findByText(/Fix bug/))
    expect(await screen.findByText(/long body/)).toBeTruthy()
    fireEvent.click(await screen.findByText('a.js'))
    expect(await screen.findByText('new line')).toBeTruthy()
  })

  it('shows the error message', async () => {
    listGithubCommits.mockRejectedValue(new Error('Not Found'))
    render(<GithubHistory repo="acme/web" client={client} branch="main" />)
    expect(await screen.findByText('Not Found')).toBeTruthy()
  })
})
