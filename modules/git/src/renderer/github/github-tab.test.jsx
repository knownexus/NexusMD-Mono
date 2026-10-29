import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { core } from '@nexusmd/core'
import { GithubTab } from './github-tab.jsx'
import { getGitConfig, setGitConfig } from '../git-config.js'
import { useGitConfig } from '../use-git-config.js'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const http = { fetch: vi.fn() }
const PRS = [
  { id: 'p1', repo: 'acme/web' }, { id: 'p2', repo: 'Acme/Web' }, { id: 'p3', repo: 'acme/api' },
]
const ISSUES = [{ id: 'i1', projectKey: 'acme/web' }]

function hostWith(state) {
  return {
    capabilities: {
      provide: vi.fn(),
      has: name => ['work.github', 'work.openPR', 'work.openItem'].includes(name),
      call: vi.fn(name => (name === 'work.github' ? state.github : undefined)),
    },
  }
}

const tree = (repo, path) => ({ repo, repoRoot: path, path, prunable: false, error: '' })
// 'later' has a worktree but is only registered by one test.
const SNAPSHOT = { worktrees: [tree('web-local', 'C:/repos/web'), tree('other', 'C:/repos/other'), tree('later', 'C:/repos/later')] }
const REMOTES = {
  'C:/repos/web': 'origin\tgit@github.com:Acme/Web.git (fetch)\norigin\tgit@github.com:Acme/Web.git (push)\n',
  'C:/repos/other': 'origin\thttps://dev.azure.com/acme/_git/other (fetch)\n',
}
const adapter = () => ({ remotes: vi.fn(async (repo, wt) => REMOTES[wt] ?? '') })

function setup({ github = { repos: ['acme/web', 'acme/api'], http, cached: { prs: PRS, issues: ISSUES } }, onOpenLocal = vi.fn() } = {}) {
  setGitConfig({ repos: [{ name: 'web-local', path: 'C:/repos/web' }, { name: 'other', path: 'C:/repos/other' }] })
  const state = { github }
  const host = hostWith(state)
  const git = adapter()
  // The view passes the live config, so a remembered selection shows straight away.
  function Harness() {
    const config = useGitConfig()
    return <GithubTab host={host} adapter={git} config={config} snapshot={SNAPSHOT} onOpenLocal={onOpenLocal} />
  }
  render(<Harness />)
  return { state, host, git, onOpenLocal }
}

const repoItem = name => screen.getByRole('listitem', { name })

describe('GithubTab', () => {
  it('counts open PRs and issues per repository from Work\'s cached data', async () => {
    setup()
    expect(within(repoItem('acme/web')).getByText('2 open PRs')).toBeTruthy()
    expect(within(repoItem('acme/web')).getByText('1 issue')).toBeTruthy()
    expect(within(repoItem('acme/api')).getByText('1 open PR')).toBeTruthy()
    expect(within(repoItem('acme/api')).getByText('0 issues')).toBeTruthy()
    await screen.findByRole('button', { name: /^Open local copy [(]/ })
  })

  it('offers Open local copy only on the repository a registered repo\'s remotes point at', async () => {
    const { git, onOpenLocal } = setup()
    const open = await within(repoItem('acme/web')).findByRole('button', { name: 'Open local copy (web-local)' })
    expect(within(repoItem('acme/api')).queryByRole('button', { name: /^Open local copy/ })).toBeNull()
    expect(git.remotes).toHaveBeenCalledWith({ name: 'web-local', path: 'C:/repos/web' }, 'C:/repos/web', ['C:/repos/web', 'C:/repos/other'])
    fireEvent.click(open)
    expect(onOpenLocal).toHaveBeenCalledWith('web-local')
  })

  it('links the selected repository to GitHub and remembers the selection in the view', async () => {
    setup()
    expect(screen.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')).toBe('https://github.com/acme/web')
    fireEvent.click(within(repoItem('acme/api')).getByRole('button', { name: /^acme\/api/ }))
    expect(getGitConfig().view.githubRepo).toBe('acme/api')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href')).toBe('https://github.com/acme/api'))
    await screen.findByRole('button', { name: /^Open local copy [(]/ })
  })

  it('reads Work\'s GitHub data again when Work\'s data updates', async () => {
    const { state } = setup()
    await screen.findByRole('button', { name: /^Open local copy [(]/ })
    state.github = { ...state.github, cached: { prs: [], issues: [...ISSUES, { id: 'i2', projectKey: 'ACME/web' }] } }
    act(() => core._emit('data:updated'))
    await waitFor(() => expect(within(repoItem('acme/web')).getByText('2 issues')).toBeTruthy())
  })


  it('reads remotes again only when the registered repositories change, not on other view writes', async () => {
    const { git } = setup()
    await screen.findByRole('button', { name: /^Open local copy [(]/ })
    expect(git.remotes).toHaveBeenCalledTimes(2)
    fireEvent.click(within(repoItem('acme/api')).getByRole('button', { name: /^acme\/api/ }))
    act(() => { setGitConfig({ view: { ...getGitConfig().view, list: 'hidden' } }) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(git.remotes).toHaveBeenCalledTimes(2)
    act(() => { setGitConfig({ repos: [...getGitConfig().repos, { name: 'later', path: 'C:/repos/later' }] }) })
    await waitFor(() => expect(git.remotes).toHaveBeenCalledWith({ name: 'later', path: 'C:/repos/later' }, 'C:/repos/later', ['C:/repos/web', 'C:/repos/other', 'C:/repos/later']))
    await screen.findByRole('button', { name: /^Open local copy [(]/ })
  })

  describe('opening in Work', () => {
    const json = body => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) })
    const item = (number, title, extra = {}) => ({ number, title, state: 'open', user: { login: 'ann' }, created_at: new Date().toISOString(), labels: [], head: { ref: 'f' }, base: { ref: 'main' }, ...extra })
    function withData() {
      const fetch = vi.fn(async path => json(String(path).includes('/pulls') ? [item(7, 'Add search')] : [item(4, 'Crash on save')]))
      return setup({ github: { repos: ['acme/web'], http: { fetch }, cached: { prs: [], issues: [] } } })
    }

    it('opens a PR row through work.openPR', async () => {
      const { host } = withData()
      fireEvent.click(await screen.findByText(/Add search/))
      expect(host.capabilities.call).toHaveBeenCalledWith('work.openPR', expect.objectContaining({ id: 'gh:acme/web#7' }))
    })

    it('opens an issue row through work.openItem', async () => {
      const { host } = withData()
      fireEvent.click(screen.getByRole('tab', { name: 'Issues' }))
      fireEvent.click(await screen.findByText(/Crash on save/))
      expect(host.capabilities.call).toHaveBeenCalledWith('work.openItem', expect.objectContaining({ id: 'gh:acme/web#4' }))
    })

    it('opens Work\'s cached copy of a PR or issue when Work has one, else the mapped row', async () => {
      const cachedPR = { id: 'GH:Acme/Web#7', title: 'Add search', reviewerDetails: [{ name: 'cy', vote: 10, id: 'cy' }] }
      const cachedIssue = { id: 'gh:acme/web#4', title: 'Crash on save', assignee: 'Ann' }
      const fetch = vi.fn(async path => json(String(path).includes('/pulls') ? [item(7, 'Add search'), item(8, 'Fix typo')] : [item(4, 'Crash on save')]))
      const { host } = setup({ github: { repos: ['acme/web'], http: { fetch }, cached: { prs: [cachedPR], issues: [cachedIssue] } } })
      fireEvent.click(await screen.findByText(/Add search/))
      expect(host.capabilities.call).toHaveBeenLastCalledWith('work.openPR', cachedPR)
      fireEvent.click(screen.getByText(/Fix typo/))
      expect(host.capabilities.call).toHaveBeenLastCalledWith('work.openPR', expect.objectContaining({ id: 'gh:acme/web#8', source: 'github' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Issues' }))
      fireEvent.click(await screen.findByText(/Crash on save/))
      expect(host.capabilities.call).toHaveBeenLastCalledWith('work.openItem', cachedIssue)
    })

    it('opens a build through work.openBuild, or on GitHub when Work can\'t', async () => {
      const runs = { workflow_runs: [{ id: 5, run_number: 3, name: 'CI', display_title: 'Ship it', status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/web/actions/runs/5' }] }
      const fetch = vi.fn(async path => json(String(path).includes('/actions/runs') ? runs : []))
      const { host } = setup({ github: { repos: ['acme/web'], http: { fetch }, cached: { prs: [], issues: [] } } })
      host.capabilities.has = name => ['work.github', 'work.openBuild'].includes(name)
      fireEvent.click(screen.getByRole('tab', { name: 'Builds' }))
      fireEvent.click(await screen.findByText(/Ship it/))
      expect(host.capabilities.call).toHaveBeenLastCalledWith('work.openBuild', expect.objectContaining({ id: 5, source: 'github' }))
      host.capabilities.has = name => name === 'work.github'
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      fireEvent.click(screen.getByText(/Ship it/))
      expect(open).toHaveBeenCalledWith('https://github.com/acme/web/actions/runs/5', '_blank', 'noopener,noreferrer')
      open.mockRestore()
    })

    it('does nothing on a row click once Work\'s drawers are gone', async () => {
      const { host } = withData()
      host.capabilities.has = name => name === 'work.github'
      const row = await screen.findByText(/Add search/)
      host.capabilities.call.mockImplementation(name => { throw new Error(`No capability ${name}`) })
      expect(() => fireEvent.click(row)).not.toThrow()
    })

    it('Refresh fetches the open pull requests and the branch list again', async () => {
      const fetch = vi.fn(async path => {
        const p = String(path)
        if (p.includes('/pulls')) return json([item(7, 'Add search')])
        if (p.includes('/branches')) return json([{ name: 'main', commit: { sha: 'a' } }])
        if (p.includes('/commits')) return json([])
        return json({ default_branch: 'main' })
      })
      setup({ github: { repos: ['acme/web'], http: { fetch }, cached: { prs: [], issues: [] } } })
      const calls = part => fetch.mock.calls.filter(([p]) => String(p).includes(part)).length
      await screen.findByText(/Add search/)
      expect(calls('/pulls')).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => expect(calls('/pulls')).toBe(2))
      fireEvent.click(screen.getByRole('tab', { name: 'History' }))
      await screen.findByRole('combobox', { name: 'Branch' })
      expect(calls('/branches')).toBe(1)
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => expect(calls('/branches')).toBe(2))
      await screen.findByText('No commits on this branch.')
    })

    it('warns that deleting a branch closes the open PRs Work knows it heads', async () => {
      const fetch = vi.fn(async path => {
        const p = String(path)
        if (p.includes('/branches')) return json([{ name: 'main', commit: { sha: 'a' } }, { name: 'feature/x', commit: { sha: 'b' } }])
        if (p.includes('/pulls')) return json([])
        return json({ default_branch: 'main' })
      })
      const prs = [{ id: 'gh:acme/web#7', repo: 'acme/web', number: 7, sourceBranch: 'feature/x' }, { id: 'gh:acme/api#9', repo: 'acme/api', number: 9, sourceBranch: 'feature/x' }]
      setup({ github: { repos: ['acme/web'], http: { fetch }, cached: { prs, issues: [] } } })
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      try {
        fireEvent.click(screen.getByRole('tab', { name: 'Branches' }))
        const row = await screen.findByRole('listitem', { name: 'feature/x' })
        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
        expect(confirm).toHaveBeenCalledWith('Delete branch feature/x on GitHub? This also closes pull request #7.')
      } finally {
        confirm.mockRestore()
      }
    })
  })
})
