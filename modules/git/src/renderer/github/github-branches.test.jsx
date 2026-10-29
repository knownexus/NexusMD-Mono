import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

vi.mock('@nexusmd/core', async importOriginal => ({
  ...(await importOriginal()),
  listGithubBranches: vi.fn(),
  createGithubBranch: vi.fn(),
  deleteGithubBranch: vi.fn(),
}))
import { listGithubBranches, createGithubBranch, deleteGithubBranch } from '@nexusmd/core'
import { GithubBranches } from './github-branches.jsx'

afterEach(cleanup)

const BRANCHES = [
  { name: 'main', sha: 'a1', protected: true, isDefault: true },
  { name: 'release/1', sha: 'b2', protected: true, isDefault: false },
  { name: 'old', sha: 'c3', protected: false, isDefault: false },
]
const client = { id: 'client' }
beforeEach(() => {
  vi.clearAllMocks()
  listGithubBranches.mockResolvedValue(BRANCHES)
  createGithubBranch.mockResolvedValue({ name: 'feature/x', sha: 'd4' })
  deleteGithubBranch.mockResolvedValue(undefined)
})

const row = name => screen.getByRole('listitem', { name })

describe('GithubBranches', () => {
  it('lists branches with badges and offers Delete only on plain branches', async () => {
    render(<GithubBranches repo="acme/web" client={client} />)
    await screen.findByRole('listitem', { name: 'old' })
    expect(listGithubBranches).toHaveBeenCalledWith(client, 'acme/web')
    expect(within(row('main')).getByText('default')).toBeTruthy()
    expect(within(row('main')).queryByRole('button', { name: /delete/i })).toBeNull()
    expect(within(row('release/1')).getByText('protected')).toBeTruthy()
    expect(within(row('release/1')).queryByRole('button', { name: /delete/i })).toBeNull()
    expect(within(row('old')).getByRole('button', { name: /delete/i })).toBeTruthy()
  })

  it('creates a branch from a chosen branch, then reloads', async () => {
    const onBranchesChanged = vi.fn()
    render(<GithubBranches repo="acme/web" client={client} onBranchesChanged={onBranchesChanged} />)
    await screen.findByRole('listitem', { name: 'old' })
    expect(onBranchesChanged).toHaveBeenLastCalledWith(BRANCHES)
    expect(screen.getByLabelText('From branch').value).toBe('main')
    fireEvent.change(screen.getByLabelText('From branch'), { target: { value: 'release/1' } })
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'feature/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createGithubBranch).toHaveBeenCalledWith(client, 'acme/web', { name: 'feature/x', from: 'release/1' }))
    await waitFor(() => expect(listGithubBranches).toHaveBeenCalledTimes(2))
  })

  it('does not delete when the confirm is declined', async () => {
    const confirm = vi.fn(() => false)
    render(<GithubBranches repo="acme/web" client={client} confirm={confirm} />)
    await screen.findByRole('listitem', { name: 'old' })
    fireEvent.click(within(row('old')).getByRole('button', { name: /delete/i }))
    expect(confirm).toHaveBeenCalledWith('Delete branch old on GitHub?')
    expect(deleteGithubBranch).not.toHaveBeenCalled()
  })

  it('deletes when confirmed, then reloads', async () => {
    const confirm = vi.fn(() => true)
    render(<GithubBranches repo="acme/web" client={client} confirm={confirm} />)
    await screen.findByRole('listitem', { name: 'old' })
    fireEvent.click(within(row('old')).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(deleteGithubBranch).toHaveBeenCalledWith(client, 'acme/web', 'old'))
    await waitFor(() => expect(listGithubBranches).toHaveBeenCalledTimes(2))
  })

  it('shows the GitHub error message', async () => {
    createGithubBranch.mockRejectedValue(new Error('Reference already exists'))
    render(<GithubBranches repo="acme/web" client={client} />)
    await screen.findByRole('listitem', { name: 'old' })
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'main2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Reference already exists')
  })

  it('reloads when refreshKey changes', async () => {
    const { rerender } = render(<GithubBranches repo="acme/web" client={client} refreshKey={1} />)
    await screen.findByRole('listitem', { name: 'old' })
    rerender(<GithubBranches repo="acme/web" client={client} refreshKey={2} />)
    await waitFor(() => expect(listGithubBranches).toHaveBeenCalledTimes(2))
  })

  it('drops the previous repository rows while another repository loads', async () => {
    const onBranchesChanged = vi.fn()
    const { rerender } = render(<GithubBranches repo="acme/web" client={client} onBranchesChanged={onBranchesChanged} />)
    await screen.findByRole('listitem', { name: 'old' })
    onBranchesChanged.mockClear()
    listGithubBranches.mockReturnValue(new Promise(() => {}))
    rerender(<GithubBranches repo="acme/api" client={client} onBranchesChanged={onBranchesChanged} />)
    expect(screen.queryByRole('listitem', { name: 'old' })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(onBranchesChanged).not.toHaveBeenCalled()
  })

  it('does not bring the previous rows back when the other repository fails to load', async () => {
    const { rerender } = render(<GithubBranches repo="acme/web" client={client} />)
    await screen.findByRole('listitem', { name: 'old' })
    listGithubBranches.mockRejectedValue(new Error('Not Found'))
    rerender(<GithubBranches repo="acme/api" client={client} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Not Found')
    expect(screen.queryByRole('listitem', { name: 'old' })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('sends one create request for a same-tick double submit', async () => {
    render(<GithubBranches repo="acme/web" client={client} />)
    await screen.findByRole('listitem', { name: 'old' })
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'feature/x' } })
    const form = screen.getByLabelText('Branch name').closest('form')
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(listGithubBranches).toHaveBeenCalledTimes(2))
    expect(createGithubBranch).toHaveBeenCalledTimes(1)
  })

  it('builds each row as name, badges, then Delete', async () => {
    render(<GithubBranches repo="acme/web" client={client} />)
    await screen.findByRole('listitem', { name: 'old' })
    const kids = el => [...el.children].map(c => c.textContent)
    expect(kids(row('main'))).toEqual(['main', 'default', 'protected'])
    expect(kids(row('old'))).toEqual(['old', 'Delete'])
    expect(row('main').className).toBe('nx-gw-gh-branch')
  })
})
