import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { GithubError } from '@nexusmd/core'
import { GithubRepoPane } from './github-repo-pane.jsx'

afterEach(cleanup)

const iso = () => new Date().toISOString()
const pr = (number, title, login = 'ann') => ({ number, title, state: 'open', user: { login }, created_at: iso(), updated_at: iso(), html_url: `https://github.com/acme/web/pull/${number}`, head: { ref: 'f' }, base: { ref: 'main' } })
const issue = (number, title, extra = {}) => ({ number, title, state: 'open', user: { login: 'bob' }, created_at: iso(), updated_at: iso(), labels: [], ...extra })

function fakeClient(routes) {
  return { getPaged: vi.fn(async path => { const r = routes[path]; if (r instanceof Error) throw r; return r ?? [] }) }
}
const ROUTES = {
  'repos/acme/web/pulls?state=open': [pr(7, 'Add search'), pr(8, 'Fix typo', 'cy')],
  'repos/acme/web/issues?state=open': [issue(4, 'Crash on save'), issue(9, 'A PR in disguise', { pull_request: {} })],
}

describe('GithubRepoPane', () => {
  it('lists open PRs and opens one in Work', async () => {
    const openPR = vi.fn()
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={openPR} openItem={vi.fn()} />)
    expect(await screen.findByText(/Add search/)).toBeTruthy()
    expect(screen.getByText(/Fix typo/)).toBeTruthy()
    fireEvent.click(screen.getByText(/Add search/))
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ id: 'gh:acme/web#7', source: 'github' }))
  })

  it('lists issues without pull requests and opens one', async () => {
    const openItem = vi.fn()
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={vi.fn()} openItem={openItem} initialTab="issues" />)
    expect(await screen.findByText(/Crash on save/)).toBeTruthy()
    expect(screen.queryByText(/in disguise/)).toBeNull()
    fireEvent.click(screen.getByText(/Crash on save/))
    expect(openItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'gh:acme/web#4' }))
  })

  it('has the five tabs and switches between them', async () => {
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    for (const l of ['Pull requests', 'Issues', 'Branches', 'History', 'Files']) expect(screen.getByRole('button', { name: l })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Issues' }))
    expect(await screen.findByText(/Crash on save/)).toBeTruthy()
  })

  it('shows the error message, then loads another repo', async () => {
    const client = fakeClient({ ...ROUTES, 'repos/acme/gone/pulls?state=open': new GithubError('Not Found: acme/gone', { status: 404 }), 'repos/acme/api/pulls?state=open': [pr(2, 'API change')] })
    const { rerender } = render(<GithubRepoPane repo="acme/gone" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    expect(await screen.findByText('Not Found: acme/gone')).toBeTruthy()
    rerender(<GithubRepoPane repo="acme/api" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    expect(await screen.findByText(/API change/)).toBeTruthy()
    expect(screen.queryByText('Not Found: acme/gone')).toBeNull()
  })

  it('refetches on a new refreshKey', async () => {
    const client = fakeClient(ROUTES)
    const { rerender } = render(<GithubRepoPane repo="acme/web" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    await screen.findByText(/Add search/)
    rerender(<GithubRepoPane repo="acme/web" client={client} refreshKey={1} openPR={vi.fn()} openItem={vi.fn()} />)
    await waitFor(() => expect(client.getPaged).toHaveBeenCalledTimes(2))
  })

  it('shows placeholders for the later tabs', () => {
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} initialTab="history" />)
    expect(screen.getByText('Coming soon')).toBeTruthy()
  })
})
