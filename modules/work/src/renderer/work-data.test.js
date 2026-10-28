import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@nexusmd/shell-sdk', () => ({ getProfileKey: k => `p.${k}` }))
const refreshProviders = vi.hoisted(() => vi.fn(async () => {}))
const loadGithubData = vi.hoisted(() => vi.fn(async () => ({})))
const buildSnapshot = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('@nexusmd/core', async importOriginal => ({ ...(await importOriginal()), refreshProviders, loadGithubData, buildSnapshot }))

import { makeRefreshAllData, useNexusSnapshot } from './work-data.js'
import { saveGithubConfig } from './github-client.js'

afterEach(() => { localStorage.clear(); vi.clearAllMocks() })

describe('refreshAllData with GitHub', () => {
  it('runs a github provider that loads issues, PRs and runs for a configured profile', async () => {
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'] })
    await makeRefreshAllData({})()
    const { providers } = refreshProviders.mock.calls[0][0]
    expect(providers.github.configured).toBe(true)
    await providers.github.run()
    const [config, deps, opts] = loadGithubData.mock.calls[0]
    expect(config.repos).toEqual(['acme/web'])
    expect(deps.http.fetch).toBeTypeOf('function')
    expect(opts.skip.workItems).toBe(false)
  })

  it('skips issues when "Load GitHub issues" is off, and is unconfigured without a token', async () => {
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'], issues: false })
    await makeRefreshAllData({})()
    await refreshProviders.mock.calls[0][0].providers.github.run()
    expect(loadGithubData.mock.calls[0][2].skip.workItems).toBe(true)

    localStorage.clear()
    await makeRefreshAllData({})()
    expect(refreshProviders.mock.calls[1][0].providers.github.configured).toBe(false)
  })
})

describe('useNexusSnapshot with GitHub', () => {
  it('passes the GitHub config and switches to the snapshot', async () => {
    const { renderHook } = await import('@testing-library/react')
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'], issues: false })
    renderHook(() => useNexusSnapshot())
    const args = buildSnapshot.mock.calls[0][0]
    expect(args.githubConfig.repos).toEqual(['acme/web'])
    expect(args.githubActive).toBe(true)
    expect(args.githubWorkItems).toBe(false)
  })
})
