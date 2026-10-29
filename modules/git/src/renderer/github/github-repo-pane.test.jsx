import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
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

  it('shows each PR as a card row: number and title, then who, which branch and when, with its labels beside it', async () => {
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    const card = await screen.findByRole('region', { name: 'Open pull requests' })
    const row = within(card).getByText(/Add search/).closest('li')
    expect(row.className).toBe('nx-gw-attn-row')
    const open = within(row).getByRole('button')
    expect(open.className).toBe('nx-gw-attn-open')
    expect(open.textContent).toContain('#7')
  })

  it('has the six tabs and switches between them', async () => {
    render(<GithubRepoPane repo="acme/web" client={fakeClient(ROUTES)} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} />)
    const tabs = screen.getByRole('tablist', { name: 'Repository views' })
    for (const l of ['Pull requests', 'Issues', 'Builds', 'Branches', 'History', 'Files']) expect(within(tabs).getByRole('tab', { name: l })).toBeTruthy()
    expect(within(tabs).getByRole('tab', { name: 'Pull requests' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Issues' }))
    expect(within(tabs).getByRole('tab', { name: 'Issues' }).getAttribute('aria-selected')).toBe('true')
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

  it('lists recent Actions runs with their result, and opens one as a build', async () => {
    const run = (id, run_number, conclusion, extra = {}) => ({
      id, run_number, name: 'CI', display_title: `Change ${run_number}`, status: conclusion ? 'completed' : 'in_progress', conclusion,
      head_branch: 'main', event: 'push', actor: { login: 'ann' }, run_started_at: iso(), updated_at: iso(), html_url: `https://github.com/acme/web/actions/runs/${id}`, ...extra,
    })
    const client = { getPaged: vi.fn(async () => []), get: vi.fn(async () => ({ workflow_runs: [run(11, 42, null), run(10, 41, 'failure'), run(9, 40, 'success')] })) }
    const openBuild = vi.fn()
    render(<GithubRepoPane repo="acme/web" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} openBuild={openBuild} initialTab="builds" />)
    const card = await screen.findByRole('region', { name: 'Recent builds' })
    expect(client.get).toHaveBeenCalledWith('repos/acme/web/actions/runs?per_page=30')
    expect(within(card).getByText('1 failed')).toBeTruthy()
    const failed = within(card).getByText(/Change 41/).closest('li')
    expect(within(failed).getByText('Failed')).toBeTruthy()
    expect(failed.querySelector('.build-dot.failed')).toBeTruthy()
    expect(within(card).getByText(/Change 42/).closest('li').textContent).toContain('Running')
    fireEvent.click(within(card).getByText(/Change 41/))
    expect(openBuild).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: 'failed', source: 'github', url: 'https://github.com/acme/web/actions/runs/10' }))
  })

  it('says when a repository has no Actions runs', async () => {
    const client = { getPaged: vi.fn(async () => []), get: vi.fn(async () => ({ total_count: 0, workflow_runs: [] })) }
    render(<GithubRepoPane repo="acme/web" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} initialTab="builds" />)
    expect(await screen.findByText('No Actions runs yet.')).toBeTruthy()
  })

  describe('branches, history and files', () => {
    const commit = (sha, message) => ({ sha, commit: { message, author: { name: 'Ann', date: iso() } }, author: { login: 'ann' } })
    function repoClient() {
      let branches = [{ name: 'main', commit: { sha: 'a1' } }, { name: 'old', commit: { sha: 'b2' } }]
      return {
        getPaged: vi.fn(async path => (path === 'repos/acme/web/branches' ? branches : [])),
        get: vi.fn(async path => {
          if (path === 'repos/acme/web') return { default_branch: 'main', html_url: 'https://github.com/acme/web' }
          if (path === 'repos/acme/web/commits?sha=main&per_page=50') return [commit('c1', 'Main commit')]
          if (path === 'repos/acme/web/commits?sha=old&per_page=50') return [commit('c2', 'Old commit')]
          if (path === 'repos/acme/web/contents?ref=main') return [{ name: 'README.md', path: 'README.md', type: 'file', size: 3 }, { name: 'src', path: 'src', type: 'dir' }]
          throw new Error(`unexpected ${path}`)
        }),
        del: vi.fn(async () => { branches = branches.filter(b => b.name !== 'old') }),
      }
    }
    const pane = (client, props = {}) => render(<GithubRepoPane repo="acme/web" client={client} refreshKey={0} openPR={vi.fn()} openItem={vi.fn()} confirm={() => true} {...props} />)

    it('renders the branch list on the Branches tab', async () => {
      pane(repoClient(), { initialTab: 'branches' })
      expect((await screen.findAllByText('main')).length).toBeGreaterThan(0)
      expect(screen.getByText(/default/i)).toBeTruthy()
    })

    it('shows a Branch picker on the default branch with its commits, and refetches for another', async () => {
      const client = repoClient()
      pane(client, { initialTab: 'history' })
      expect(await screen.findByText(/Main commit/)).toBeTruthy()
      const picker = screen.getByLabelText('Branch')
      expect(picker.value).toBe('main')
      fireEvent.change(picker, { target: { value: 'old' } })
      expect(await screen.findByText(/Old commit/)).toBeTruthy()
      expect(client.get).toHaveBeenCalledWith('repos/acme/web/commits?sha=old&per_page=50')
    })

    it('lists the root contents of the picked branch on the Files tab', async () => {
      pane(repoClient(), { initialTab: 'files' })
      expect(await screen.findByText('README.md')).toBeTruthy()
      expect(screen.getByText('src')).toBeTruthy()
      expect(screen.getByLabelText('Branch').value).toBe('main')
    })

    it('falls back to the default branch when the picked branch is deleted on the Branches tab', async () => {
      const client = repoClient()
      pane(client, { initialTab: 'history' })
      await screen.findByText(/Main commit/)
      fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'old' } })
      await screen.findByText(/Old commit/)
      fireEvent.click(screen.getByRole('tab', { name: 'Branches' }))
      const dels = await screen.findAllByRole('button', { name: /delete/i })
      fireEvent.click(dels[0])
      await waitFor(() => expect(client.del).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByText('old')).toBeNull())
      fireEvent.click(screen.getByRole('tab', { name: 'History' }))
      expect(await screen.findByText(/Main commit/)).toBeTruthy()
      expect(screen.getByLabelText('Branch').value).toBe('main')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    describe('refreshing', () => {
      function mutableClient() {
        const state = { branches: [{ name: 'main', commit: { sha: 'a1' } }, { name: 'old', commit: { sha: 'b2' } }] }
        const client = {
          getPaged: vi.fn(async path => (path === 'repos/acme/web/branches' ? state.branches : [])),
          get: vi.fn(async path => {
            if (path === 'repos/acme/web') return { default_branch: 'main' }
            if (path === 'repos/acme/web/commits?sha=main&per_page=50') return [commit('c1', 'Main commit')]
            if (path === 'repos/acme/web/commits?sha=old&per_page=50') return [commit('c2', 'Old commit')]
            throw new Error(`unexpected ${path}`)
          }),
        }
        return { client, state }
      }
      const props = { repo: 'acme/web', openPR: vi.fn(), openItem: vi.fn(), initialTab: 'history' }

      it('shows a branch added elsewhere in the picker after a refresh', async () => {
        const { client, state } = mutableClient()
        const { rerender } = render(<GithubRepoPane {...props} client={client} refreshKey={0} />)
        await screen.findByText(/Main commit/)
        state.branches = [...state.branches, { name: 'fresh', commit: { sha: 'c3' } }]
        rerender(<GithubRepoPane {...props} client={client} refreshKey={1} />)
        await waitFor(() => expect(screen.getByRole('option', { name: 'fresh' })).toBeTruthy())
        expect(screen.getByLabelText('Branch').value).toBe('main')
      })

      it('falls back to the default branch when the picked branch was removed elsewhere', async () => {
        const { client, state } = mutableClient()
        const { rerender } = render(<GithubRepoPane {...props} client={client} refreshKey={0} />)
        await screen.findByText(/Main commit/)
        fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'old' } })
        await screen.findByText(/Old commit/)
        state.branches = state.branches.filter(b => b.name !== 'old')
        rerender(<GithubRepoPane {...props} client={client} refreshKey={1} />)
        await waitFor(() => expect(screen.getByLabelText('Branch').value).toBe('main'))
        expect(await screen.findByText(/Main commit/)).toBeTruthy()
        expect(screen.queryByRole('alert')).toBeNull()
      })
    })
  })
})
