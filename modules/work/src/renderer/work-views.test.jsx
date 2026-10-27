import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { createCapabilities } from '@nexusmd/shell-sdk'

const seen = {}
let profile = { activeProfile: { type: 'manual' } }
vi.mock('@nexusmd/ui', async importOriginal => ({
  ...(await importOriginal()),
  useProfile: () => profile,
  DashboardView: p => { seen.dashboard = p; return <div>dashboard view</div> },
  WorkItemsView: p => { seen.work = p; return <div>work items view</div> },
  PRView: p => { seen.prs = p; return <div>prs view</div> },
  BuildsView: p => { seen.builds = p; return <div>builds view</div> },
  TestsView: p => { seen.tests = p; return <div>tests view</div> },
  TeamView: p => { seen.team = p; return <div>team view</div> },
  TriageView: () => <div>triage view</div>,
}))

import { NexusDataProvider } from '@nexusmd/ui'
import { WorkContext } from './work-context.js'
import { DashboardApp, WorkItemsApp, PullRequestsApp, BuildsApp, TestsApp, TeamApp, TriageApp } from './work-views.jsx'

const DATA = {
  WORK_ITEMS: [{ id: 1, title: 'one' }], PRS: [{ id: 7 }], BUILDS: [{ id: 'b1' }], TESTS: [{ id: 't1' }],
  TEAM: [{ id: 'p1', name: 'Pat' }], TEAM_ALL: [{ id: 'p1', name: 'Pat' }, { id: 'p2', name: 'Sam' }],
}

function mount(ui, { work = {}, data = DATA } = {}) {
  const ctx = {
    openItem: vi.fn(), openPR: vi.fn(), openPerson: vi.fn(), openBuild: vi.fn(),
    newItemIds: { work: new Set(['w']), pr: new Set(['p']), builds: new Set(['b']), tests: new Set(['t']) },
    localItems: null, setItems: vi.fn(), ...work,
  }
  render(<NexusDataProvider value={{ data }}><WorkContext.Provider value={ctx}>{ui}</WorkContext.Provider></NexusDataProvider>)
  return ctx
}
const hostWith = (provided = [], extra = {}) => {
  const capabilities = createCapabilities()
  const calls = []
  for (const name of provided) capabilities.provide(name, (...a) => { calls.push([name, ...a]); return Promise.resolve(true) })
  return { calls, host: { capabilities, isInstalled: () => false, navigate: vi.fn(), ...extra } }
}
const tweaks = { widgetOrder: ['sprint'], quickLinks: [{ label: 'q' }], density: 'cozy' }

beforeEach(() => {
  for (const k of Object.keys(seen)) delete seen[k]
  profile = { activeProfile: { type: 'manual' } }
  localStorage.clear()
})
afterEach(cleanup)

describe('Dashboard', () => {
  it('asks to connect Azure DevOps when the profile is not set up', () => {
    profile = { activeProfile: { type: 'ado' } }
    mount(<DashboardApp host={hostWith().host} tweaks={tweaks} setTweak={vi.fn()} />)
    expect(screen.getByText(/Welcome to NexusMD/)).toBeTruthy()
    expect(seen.dashboard).toBeUndefined()
  })

  it('shows the dashboard for a manual profile, with the shell\'s display settings', () => {
    const setTweak = vi.fn()
    const work = mount(<DashboardApp host={hostWith().host} tweaks={tweaks} setTweak={setTweak} />)
    expect(screen.getByText('dashboard view')).toBeTruthy()
    expect(seen.dashboard).toMatchObject({ widgetOrder: ['sprint'], quickLinks: [{ label: 'q' }], density: 'cozy' })
    expect(seen.dashboard.onOpenItem).toBe(work.openItem)
    expect(seen.dashboard.onOpenPR).toBe(work.openPR)
    seen.dashboard.setWidgetOrder(['review'])
    expect(setTweak).toHaveBeenCalledWith('widgetOrder', ['review'])
  })

  it('has no Quick note without the Planner, and routes it to the Planner with it', () => {
    mount(<DashboardApp host={hostWith().host} tweaks={tweaks} setTweak={vi.fn()} />)
    expect(seen.dashboard.setPlannerData).toBeUndefined()
    cleanup()
    const { host, calls } = hostWith(['planner.updateData'])
    mount(<DashboardApp host={host} tweaks={tweaks} setTweak={vi.fn()} />)
    const updater = prev => prev
    seen.dashboard.setPlannerData(updater)
    expect(calls).toEqual([['planner.updateData', updater]])
  })

  it('keeps its widget sizes per profile', () => {
    mount(<DashboardApp host={hostWith().host} tweaks={tweaks} setTweak={vi.fn()} />)
    act(() => seen.dashboard.setWidgetWidths({ sprint: 2 }))
    expect(Object.entries(localStorage).some(([k, v]) => k.includes('nexusmd.dash.widgetWidths') && v === '{"sprint":2}')).toBe(true)
  })

  it('treats the builds and tests the user has acknowledged as one set', () => {
    localStorage.setItem('nexusmd.builds.acknowledged', '["b1"]')
    localStorage.setItem('nexusmd.tests.acknowledged', '["t1"]')
    mount(<DashboardApp host={hostWith().host} tweaks={tweaks} setTweak={vi.fn()} />)
    expect([...seen.dashboard.acknowledgedSet].sort()).toEqual(['b1', 't1'])
  })
})

describe('Work Items', () => {
  it('lists the data\'s items, with the team (minus nobody) and the unseen markers', () => {
    const work = mount(<WorkItemsApp />)
    expect(seen.work.items).toBe(DATA.WORK_ITEMS)
    expect(seen.work.newItemIds).toBe(work.newItemIds.work)
    expect(seen.work.onOpen).toBe(work.openItem)
    expect(seen.work.team.map(m => m.id)).toEqual(['p1', 'p2'])
  })
  it('lists the edited copy once there is one', () => {
    const edited = [{ id: 1, title: 'edited' }]
    mount(<WorkItemsApp />, { work: { localItems: edited } })
    expect(seen.work.items).toBe(edited)
  })
  it('opens the create drawer', () => {
    mount(<WorkItemsApp />)
    const heard = vi.fn()
    window.addEventListener('nexusmd:create-wi', heard)
    seen.work.onCreate()
    window.removeEventListener('nexusmd:create-wi', heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('Pull Requests, Builds and Tests', () => {
  it('Pull Requests shows the PRs and opens links in the link window', () => {
    window.electronAPI = { openLink: vi.fn() }
    const work = mount(<PullRequestsApp />)
    expect(seen.prs.prs).toBe(DATA.PRS)
    expect(seen.prs.onOpen).toBe(work.openPR)
    seen.prs.onOpenLink('https://example.test/pr/7')
    expect(window.electronAPI.openLink).toHaveBeenCalledWith('https://example.test/pr/7')
    delete window.electronAPI
  })
  it('Pull Requests remembers who the "needs me" criteria are', () => {
    mount(<PullRequestsApp />)
    expect(seen.prs.needsMeCriteria).toEqual({ votes: [0], includeDrafts: false })
    act(() => seen.prs.setNeedsMeCriteria({ votes: [5], includeDrafts: true }))
    expect(Object.entries(localStorage).some(([k]) => k.includes('nexusmd.pr.needsMeCriteria'))).toBe(true)
  })
  it('Builds remembers which are acknowledged', () => {
    const work = mount(<BuildsApp />)
    expect(seen.builds.builds).toBe(DATA.BUILDS)
    expect(seen.builds.onOpenBuild).toBe(work.openBuild)
    act(() => seen.builds.setAcknowledgedBuilds(['b1']))
    expect(Object.entries(localStorage).some(([k, v]) => k.includes('nexusmd.builds.acknowledged') && v === '["b1"]')).toBe(true)
  })
  it('Tests remembers which are acknowledged', () => {
    mount(<TestsApp />)
    expect(seen.tests.tests).toBe(DATA.TESTS)
    act(() => seen.tests.setAcknowledgedTests(['t1']))
    expect(Object.entries(localStorage).some(([k, v]) => k.includes('nexusmd.tests.acknowledged') && v === '["t1"]')).toBe(true)
  })
  it('Triage shows the triage view', () => {
    mount(<TriageApp />)
    expect(screen.getByText('triage view')).toBeTruthy()
  })
})

describe('Team', () => {
  it('lists everyone, including people added here, and the work and PRs', () => {
    localStorage.setItem('nexusmd.team.custom', JSON.stringify([{ id: 'c1', name: 'Custom' }]))
    const work = mount(<TeamApp host={hostWith().host} />)
    expect(seen.team.team.map(m => m.id)).toEqual(['p1', 'p2', 'c1'])
    expect(seen.team.workItems).toBe(DATA.WORK_ITEMS)
    expect(seen.team.onOpenPerson).toBe(work.openPerson)
  })

  it('saves added and removed people per profile', () => {
    mount(<TeamApp host={hostWith().host} />)
    act(() => seen.team.onTeamChange([{ id: 'p1', name: 'Pat' }, { id: 'new', name: 'New' }]))   // Sam removed, New added
    const stored = Object.fromEntries(Object.entries(localStorage))
    const get = part => JSON.parse(Object.entries(stored).find(([k]) => k.includes(part))[1])
    expect(get('nexusmd.team.custom')).toEqual([{ id: 'new', name: 'New' }])
    expect(get('nexusmd.team.removed')).toEqual(['p2'])
  })

  it('has no Schedule 1:1 without the Calendar', () => {
    mount(<TeamApp host={hostWith().host} />)
    expect(seen.team.onScheduleOneOnOne).toBeUndefined()
  })

  it('schedules tomorrow at ten for an hour through the Calendar, and opens the Planner only if installed', () => {
    const { host, calls } = hostWith(['calendar.scheduleMeeting'], { isInstalled: id => id === 'planner' })
    mount(<TeamApp host={host} />)
    seen.team.onScheduleOneOnOne({ name: 'Pat' })
    const [name, meeting] = calls[0]
    expect(name).toBe('calendar.scheduleMeeting')
    expect(meeting.title).toBe('1:1 with Pat')
    expect(meeting.start.getHours()).toBe(10)
    expect(meeting.end - meeting.start).toBe(60 * 60000)
    expect(meeting.start.getTime()).toBeGreaterThan(Date.now())
    expect(host.navigate).toHaveBeenCalledWith('planner')
  })

  it('stays where it is after scheduling when the Planner is not installed', () => {
    const { host } = hostWith(['calendar.scheduleMeeting'])
    mount(<TeamApp host={host} />)
    seen.team.onScheduleOneOnOne({ name: 'Pat' })
    expect(host.navigate).not.toHaveBeenCalled()
  })
})
