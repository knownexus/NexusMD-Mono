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
      has: name => name === 'work.github',
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
    expect(within(repoItem('acme/web')).getByText('2 PRs · 1 issue')).toBeTruthy()
    expect(within(repoItem('acme/api')).getByText('1 PR · 0 issues')).toBeTruthy()
    await screen.findByRole('button', { name: 'Open local copy' })
  })

  it('offers Open local copy only on the repository a registered repo\'s remotes point at', async () => {
    const { git, onOpenLocal } = setup()
    const open = await within(repoItem('acme/web')).findByRole('button', { name: 'Open local copy' })
    expect(within(repoItem('acme/api')).queryByRole('button', { name: 'Open local copy' })).toBeNull()
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
    await screen.findByRole('button', { name: 'Open local copy' })
  })

  it('reads Work\'s GitHub data again when Work\'s data updates', async () => {
    const { state } = setup()
    await screen.findByRole('button', { name: 'Open local copy' })
    state.github = { ...state.github, cached: { prs: [], issues: [...ISSUES, { id: 'i2', projectKey: 'ACME/web' }] } }
    act(() => core._emit('data:updated'))
    await waitFor(() => expect(within(repoItem('acme/web')).getByText('0 PRs · 2 issues')).toBeTruthy())
  })


  it('reads remotes again only when the registered repositories change, not on other view writes', async () => {
    const { git } = setup()
    await screen.findByRole('button', { name: 'Open local copy' })
    expect(git.remotes).toHaveBeenCalledTimes(2)
    fireEvent.click(within(repoItem('acme/api')).getByRole('button', { name: /^acme\/api/ }))
    act(() => { setGitConfig({ view: { ...getGitConfig().view, list: 'hidden' } }) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(git.remotes).toHaveBeenCalledTimes(2)
    act(() => { setGitConfig({ repos: [...getGitConfig().repos, { name: 'later', path: 'C:/repos/later' }] }) })
    await waitFor(() => expect(git.remotes).toHaveBeenCalledWith({ name: 'later', path: 'C:/repos/later' }, 'C:/repos/later', ['C:/repos/web', 'C:/repos/other', 'C:/repos/later']))
    await screen.findByRole('button', { name: 'Open local copy' })
  })
})
