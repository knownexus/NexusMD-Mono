import React from 'react'
import { core, nextHiddenIds } from '@nexusmd/core'
import {
  useNexusData, DashboardView, WorkItemsView, PRView, BuildsView, TestsView, TeamView, TriageView, useProfile,
} from '@nexusmd/ui'
import { getProfileKey, linkAdapter, usePersistedState } from '@nexusmd/shell-sdk'
import { isAdoConfigured } from './ado-client.js'
import { isJiraActive } from './jira-client.js'
import { NotConfigured } from './not-configured.jsx'
import { useWork } from './work-context.js'

// Stable fallback so fullRoster (a memo dependency) doesn't change identity every render.
const EMPTY = []

// The people the screens show: the roster from the data, minus people removed in the Team screen,
// plus the ones added there. The Team screen itself lists removed people too (to restore them).
function useTeamRoster(data) {
  const [customTeam, setCustomTeam] = React.useState(() => {
    try {
      const k = getProfileKey('nexusmd.team.custom')
      return JSON.parse(localStorage.getItem(k) || '[]')
    } catch { return [] }
  })
  const [removedIds, setRemovedIds] = React.useState(() => {
    try {
      const k = getProfileKey('nexusmd.team.removed')
      return JSON.parse(localStorage.getItem(k) || '[]')
    } catch { return [] }
  })

  // data.TEAM is already filtered by hidden people; TEAM_ALL is the full roster.
  const fullRoster = data.TEAM_ALL || data.TEAM || EMPTY
  const effectiveTeam = React.useMemo(() => {
    const base = fullRoster.filter(m => !removedIds.includes(m.id))
    const existingIds = new Set(base.map(m => m.id))
    return [...base, ...customTeam.filter(m => !existingIds.has(m.id))]
  }, [fullRoster, customTeam, removedIds])
  const teamViewTeam = React.useMemo(() => {
    const existingIds = new Set(fullRoster.map(m => m.id))
    return [...fullRoster, ...customTeam.filter(m => !existingIds.has(m.id))]
  }, [fullRoster, customTeam])

  const handleTeamChange = (newTeam) => {
    const baseIds = new Set(fullRoster.map(m => m.id))
    const newCustom = newTeam.filter(m => !baseIds.has(m.id))
    const newRemoved = nextHiddenIds(removedIds, fullRoster, newTeam)
    setCustomTeam(newCustom)
    setRemovedIds(newRemoved)
    try {
      localStorage.setItem(getProfileKey('nexusmd.team.custom'), JSON.stringify(newCustom))
      localStorage.setItem(getProfileKey('nexusmd.team.removed'), JSON.stringify(newRemoved))
    } catch {}
    // Rebuild the snapshot so hidden/restored people apply immediately (skip no-op syncs)
    if (newRemoved.length !== removedIds.length || newRemoved.some(id => !removedIds.includes(id))) {
      core._emit?.('data:updated')
    }
  }

  return { effectiveTeam, teamViewTeam, handleTeamChange }
}

// Manual profiles don't require ADO or Jira to be set up.
function useConfigured() {
  const { activeProfile } = useProfile() || {}
  return activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() || isJiraActive() } catch { return false } })()
}

export function DashboardApp({ host, tweaks, setTweak }) {
  const { data } = useNexusData()
  const { openItem, openPR, newItemIds } = useWork()
  const configured = useConfigured()
  const { effectiveTeam } = useTeamRoster(data)
  const [needsMeCriteria] = usePersistedState('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false })
  const [acknowledgedBuilds] = usePersistedState('nexusmd.builds.acknowledged', [])
  const [acknowledgedTests] = usePersistedState('nexusmd.tests.acknowledged', [])
  const [widgetWidths, setWidgetWidths] = usePersistedState('nexusmd.dash.widgetWidths', {})
  const [widgetHeights, setWidgetHeights] = usePersistedState('nexusmd.dash.widgetHeights', {})

  if (!configured) return <NotConfigured />
  const acknowledgedSet = new Set([...acknowledgedBuilds, ...acknowledgedTests])
  const { capabilities } = host
  return (
    <DashboardView
      onOpenItem={openItem} onOpenPR={openPR}
      widgetOrder={tweaks.widgetOrder} setWidgetOrder={arr => setTweak('widgetOrder', arr)}
      widgetWidths={widgetWidths} setWidgetWidths={setWidgetWidths}
      widgetHeights={widgetHeights} setWidgetHeights={setWidgetHeights}
      needsMeCriteria={needsMeCriteria}
      setPlannerData={capabilities.has('planner.updateData') ? (updater => capabilities.call('planner.updateData', updater)) : undefined}
      quickLinks={tweaks.quickLinks || []}
      density={tweaks.density}
      team={effectiveTeam}
      acknowledgedSet={acknowledgedSet}
    />
  )
}

export function WorkItemsApp() {
  const { data } = useNexusData()
  const { openItem, newItemIds, localItems, setItems } = useWork()
  const { effectiveTeam } = useTeamRoster(data)
  const items = localItems ?? (data.WORK_ITEMS || [])
  return (
    <WorkItemsView
      items={items}
      setItems={setItems}
      onOpen={openItem}
      onCreate={() => { window.dispatchEvent(new CustomEvent('nexusmd:create-wi', { detail: {} })) }}
      team={effectiveTeam}
      newItemIds={newItemIds.work}
    />
  )
}

export function PullRequestsApp() {
  const { data } = useNexusData()
  const { openPR, newItemIds } = useWork()
  const [needsMeCriteria, setNeedsMeCriteria] = usePersistedState('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false })
  return (
    <PRView prs={data.PRS || []} onOpen={openPR}
      onOpenLink={(u) => linkAdapter.openLink(u)}
      needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
      newItemIds={newItemIds.pr} />
  )
}

export function BuildsApp() {
  const { data } = useNexusData()
  const { openBuild, newItemIds } = useWork()
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersistedState('nexusmd.builds.acknowledged', [])
  return (
    <BuildsView builds={data.BUILDS || []}
      acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
      newItemIds={newItemIds.builds} onOpenBuild={openBuild}
    />
  )
}

export function TestsApp() {
  const { data } = useNexusData()
  const { newItemIds } = useWork()
  const [acknowledgedTests, setAcknowledgedTests] = usePersistedState('nexusmd.tests.acknowledged', [])
  return (
    <TestsView tests={data.TESTS || []}
      acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests}
      newItemIds={newItemIds.tests} />
  )
}

export function TeamApp({ host }) {
  const { data } = useNexusData()
  const { openItem, openPerson } = useWork()
  const { teamViewTeam, handleTeamChange } = useTeamRoster(data)

  // "Schedule 1:1" is the Calendar app's job, so the button exists only when it's installed; the
  // Planner is opened afterwards only if it is installed too.
  const { capabilities } = host
  const scheduleOneOnOne = capabilities.has('calendar.scheduleMeeting') ? (dev) => {
    const start = new Date()
    start.setHours(10, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 60 * 60000)
    Promise.resolve(capabilities.call('calendar.scheduleMeeting', { title: `1:1 with ${dev.name}`, start, end })).catch(console.error)
    if (host.isInstalled('planner')) host.navigate('planner')
  } : undefined

  return (
    <TeamView
      team={teamViewTeam}
      workItems={data.WORK_ITEMS || []}
      prs={data.PRS || []}
      onOpenItem={openItem}
      onOpenPerson={openPerson}
      onTeamChange={handleTeamChange}
      onScheduleOneOnOne={scheduleOneOnOne}
    />
  )
}

export function TriageApp() {
  return <TriageView />
}
