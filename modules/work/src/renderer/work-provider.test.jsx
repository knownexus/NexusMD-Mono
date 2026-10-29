import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

const refreshSpy = vi.fn(async () => {})
const markSeen = vi.fn()
const seen = { unseenIds: { work: new Set(), pr: new Set(), builds: new Set(), tests: new Set() }, unseenCounts: { work: 3, pr: 1, builds: 0, tests: 2 }, markSeen }
const BASE = { WORK_ITEMS: [], PRS: [], BUILDS: [], TESTS: [], TEAM: [], JIRA_PEOPLE: [], ME: { name: 'Me Myself' }, GITHUB_ME: { login: 'octo' } }
let SNAPSHOT = BASE

vi.mock('@nexusmd/ui', async importOriginal => ({ ...(await importOriginal()), useSeenTracking: () => seen }))
vi.mock('./work-data.js', () => ({
  makeRefreshAllData: () => refreshSpy,
  desktopWorkItemSource: { createWorkItem: vi.fn(async () => ({ warnings: [] })) },
  useNexusSnapshot: () => ({ snapshot: SNAPSHOT, loaded: true }),
}))
let drawerProps
vi.mock('./detail-drawer.jsx', () => ({ DetailDrawer: props => { drawerProps = props; return <div data-testid="drawer" data-status={props.drawer?.data?.status ?? ''}>{props.drawer ? props.drawer.kind : 'closed'}</div> } }))
vi.mock('./create-work-item-drawer.jsx', () => ({ CreateWorkItemDrawer: ({ open, title, github, defaultProvider }) => <div data-testid="create" data-github={github ? github.repos.join(',') : ''} data-provider={defaultProvider}>{open ? `open:${title ?? ''}` : 'closed'}</div> }))
vi.mock('./project-areas-modal.jsx', () => ({ ProjectAreasModal: ({ open }) => <div data-testid="areas">{open ? 'open' : 'closed'}</div> }))

import { useNexusData } from '@nexusmd/ui'
import { WorkProvider } from './work-provider.jsx'
import { useWork } from './work-context.js'
import { workBadges } from './work-store.js'
import { createCapabilities } from '@nexusmd/shell-sdk'
import { saveGithubConfig } from './github-client.js'

let work
let data
function Probe() {
  work = useWork()
  data = useNexusData()
  return <div data-testid="left">{work.refreshPaused ? 'paused' : work.refreshLeft}</div>
}

const onRefreshData = vi.fn()
let capabilities
let host
const makeHost = () => { capabilities = createCapabilities(); host = { cloud: {}, capabilities, adapters: { windowControls: { onRefreshData } } } }
makeHost()
const mount = (view = 'dashboard') => render(<WorkProvider host={host} view={view}><Probe /></WorkProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  makeHost()
  SNAPSHOT = BASE
  localStorage.clear()
  workBadges.set({})
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('the data it provides to the screens', () => {
  it('wraps its children in the real data, with refresh as the data\'s load', async () => {
    mount()
    expect(data.data).toBe(SNAPSHOT)
    await data.api.load()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(data.workItemSource).toBeTruthy()
    expect(data.buildSource).toBeTruthy()
  })
  it('shares the refresh and the unseen markers through useWork', () => {
    mount()
    expect(work.refreshAllData).toBe(refreshSpy)
    expect(work.newItemIds).toBe(seen.unseenIds)
  })
})

describe('the drawers', () => {
  it('opens the detail drawer for each kind of thing', () => {
    mount()
    expect(screen.getByTestId('drawer').textContent).toBe('closed')
    for (const [open, kind] of [['openItem', 'wi'], ['openPR', 'pr'], ['openPerson', 'person'], ['openBuild', 'build']]) {
      act(() => work[open]({ id: 1 }))
      expect(screen.getByTestId('drawer').textContent).toBe(kind)
    }
  })
  it('patches the open PR and refreshes when a PR action succeeds', () => {
    mount()
    act(() => work.openPR({ id: 1, status: 'active' }))
    act(() => drawerProps.onPRChanged(1, { status: 'merged' }))
    expect(screen.getByTestId('drawer').dataset.status).toBe('merged')
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })
  it('does not patch a different PR that is open now, but still refreshes', () => {
    mount()
    act(() => work.openPR({ id: 1, status: 'active' }))
    act(() => work.openPR({ id: 2, status: 'active' }))
    act(() => drawerProps.onPRChanged(1, { status: 'merged' }))
    expect(screen.getByTestId('drawer').dataset.status).toBe('active')
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    act(() => drawerProps.onPRChanged(2, { status: 'merged' }))
    expect(screen.getByTestId('drawer').dataset.status).toBe('merged')
  })
  it('puts the current user vote into the open ADO PR reviewers', () => {
    mount()
    act(() => work.openPR({ id: 1, status: 'active', reviewerDetails: [{ id: 'a', name: 'Alice', vote: 0 }, { id: 'me', name: 'me myself', vote: 0 }] }))
    act(() => drawerProps.onPRChanged(1, { myVote: 10 }))
    const data = drawerProps.drawer.data
    expect(data.reviewerDetails).toEqual([{ id: 'a', name: 'Alice', vote: 0 }, { id: 'me', name: 'me myself', vote: 10 }])
    expect('myVote' in data).toBe(false)
  })
  it('appends the current user when they are not yet a reviewer, using GITHUB_ME for GitHub PRs', () => {
    mount()
    act(() => work.openPR({ id: 2, source: 'github', status: 'active', reviewerDetails: [{ id: 'a', name: 'Alice', vote: 0 }] }))
    act(() => drawerProps.onPRChanged(2, { myVote: -5 }))
    expect(drawerProps.drawer.data.reviewerDetails).toEqual([
      { id: 'a', name: 'Alice', vote: 0 }, { id: 'octo', name: 'octo', vote: -5 },
    ])
    act(() => work.openPR({ id: 3, status: 'active' }))
    act(() => drawerProps.onPRChanged(3, { myVote: 10 }))
    expect(drawerProps.drawer.data.reviewerDetails).toEqual([{ id: 'Me Myself', name: 'Me Myself', vote: 10 }])
  })
  it('replaces the open PR with the refreshed one when the snapshot changes', () => {
    const view = () => <WorkProvider host={host} view="dashboard"><Probe /></WorkProvider>
    const { rerender } = render(view())
    act(() => work.openPR({ id: 1, status: 'active' }))
    expect(drawerProps.drawer.data.status).toBe('active')
    SNAPSHOT = { ...BASE, PRS: [{ id: 1, status: 'merged', title: 'fresh' }] }
    rerender(view())
    expect(drawerProps.drawer.data).toEqual({ id: 1, status: 'merged', title: 'fresh' })
  })
  it('opens the create drawer on nexusmd:create-wi, with the title it was given', () => {
    mount()
    expect(screen.getByTestId('create').textContent).toBe('closed')
    act(() => { window.dispatchEvent(new CustomEvent('nexusmd:create-wi', { detail: { title: 'From a widget' } })) })
    expect(screen.getByTestId('create').textContent).toBe('open:From a widget')
  })
  it('opens the project areas on nexusmd:openProjectAreas', () => {
    mount()
    act(() => { window.dispatchEvent(new Event('nexusmd:openProjectAreas')) })
    expect(screen.getByTestId('areas').textContent).toBe('open')
  })
})

describe('the GitHub notice', () => {
  it('turns on when a token expires, and off when dismissed', () => {
    mount()
    expect(work.githubExpired).toBe(false)
    act(() => { window.dispatchEvent(new Event('nexusmd:github-401')) })
    expect(work.githubExpired).toBe(true)
    act(() => work.dismissGithubExpired())
    expect(work.githubExpired).toBe(false)
  })
})

describe('sidebar badges and the seen markers', () => {
  it('publishes the unseen counts under the sidebar entries\' names', () => {
    mount()
    expect(workBadges.get()).toEqual({ work: 3, prs: 1, builds: 0, tests: 2 })
  })
  it('marks a category as seen when its screen is the one showing', () => {
    for (const [view, category] of [['work', 'work'], ['prs', 'pr'], ['builds', 'builds'], ['tests', 'tests']]) {
      markSeen.mockClear(); cleanup()
      mount(view)
      expect(markSeen).toHaveBeenCalledWith(category)
    }
  })
  it('marks nothing for the screens that have no category', () => {
    mount('dashboard')
    expect(markSeen).not.toHaveBeenCalled()
  })
})

describe('refresh', () => {
  it('asks the window for F5 to refresh the data', () => {
    mount()
    expect(onRefreshData).toHaveBeenCalledTimes(1)
    onRefreshData.mock.calls[0][0]()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('counts down to the next automatic refresh, refreshes at zero, and starts again', () => {
    vi.useFakeTimers()
    localStorage.setItem('nexusmd.refreshInterval', '3')
    mount()
    expect(screen.getByTestId('left').textContent).toBe('3')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('left').textContent).toBe('2')
    expect(refreshSpy).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('left').textContent).toBe('3')
  })

  it('stops counting while paused and carries on when resumed', () => {
    vi.useFakeTimers()
    localStorage.setItem('nexusmd.refreshInterval', '5')
    mount()
    act(() => work.setRefreshPaused(true))
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(refreshSpy).not.toHaveBeenCalled()
    act(() => work.setRefreshPaused(false))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('uses a new interval straight away', () => {
    vi.useFakeTimers()
    localStorage.setItem('nexusmd.refreshInterval', '100')
    mount()
    act(() => work.setRefreshInterval(2))
    expect(screen.getByTestId('left').textContent).toBe('2')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('defaults to five minutes when nothing usable is saved', () => {
    mount()
    expect(work.refreshInterval).toBe(300)
    cleanup()
    localStorage.setItem('nexusmd.refreshInterval', 'garbage')
    mount()
    expect(work.refreshInterval).toBe(300)
    cleanup()
    localStorage.setItem('nexusmd.refreshInterval', '0')
    mount()
    expect(work.refreshInterval).toBe(300)
  })
})

describe('the GitHub work-item source', () => {
  it('routes GitHub items only while "Load GitHub issues" is on', async () => {
    const { saveGithubConfig } = await import('./github-client.js')
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'] })
    mount()
    expect(data.workItemSource.github).toBeTruthy()
    expect(data.workItemSource.webUrl({ id: 'gh:acme/web#3' })).toBe('https://github.com/acme/web/issues/3')
    cleanup()
    saveGithubConfig({ issues: false })
    mount()
    expect(data.workItemSource.github).toBeNull()
  })
})

describe('creating GitHub issues', () => {
  it('offers GitHub in the create drawer with the selected repos, and defaults to it when it is the only provider', async () => {
    const { saveGithubConfig } = await import('./github-client.js')
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web', 'acme/api'] })
    mount()
    expect(screen.getByTestId('create').getAttribute('data-github')).toBe('acme/web,acme/api')
    expect(screen.getByTestId('create').getAttribute('data-provider')).toBe('github')
  })
})

describe('GitHub pull requests', () => {
  it('gives the PR drawer a GitHub http adapter', () => {
    mount()
    expect(typeof data.githubHttp?.fetch).toBe('function')
  })
})

describe('what it offers other apps', () => {
  const ghPr = { id: 'gh:a/b#1', source: 'github' }
  const adoPr = { id: 'ado:1', source: 'ado' }
  const ghItem = { id: 'gh:a/b#2', source: 'github' }
  const adoItem = { id: 'ado:2', source: 'ado' }
  it('offers GitHub with only its own cached PRs and issues', () => {
    saveGithubConfig({ pat: 'ghp_x', repos: ['acme/web'] })
    SNAPSHOT = { ...BASE, PRS: [ghPr, adoPr], WORK_ITEMS: [ghItem, adoItem] }
    mount()
    const gh = capabilities.call('work.github')
    expect(gh.repos).toEqual(['acme/web'])
    expect(typeof gh.http.fetch).toBe('function')
    expect(gh.cached.prs).toEqual([ghPr])
    expect(gh.cached.issues).toEqual([ghItem])
  })
  it('offers nothing when GitHub is not configured', () => {
    mount()
    expect(capabilities.call('work.github')).toBeNull()
  })
  it('opens its drawers on request', () => {
    mount()
    act(() => capabilities.call('work.openPR', { id: 'gh:a/b#1' }))
    expect(screen.getByTestId('drawer').textContent).toBe('pr')
    act(() => capabilities.call('work.openItem', { id: 'gh:a/b#1' }))
    expect(screen.getByTestId('drawer').textContent).toBe('wi')
  })
  it('stops offering them on unmount', () => {
    const { unmount } = mount()
    expect(capabilities.has('work.github')).toBe(true)
    unmount()
    expect(capabilities.has('work.github')).toBe(false)
  })
})
