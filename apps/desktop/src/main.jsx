import React from 'react'
import ReactDOM from 'react-dom/client'
import '@nexusmd/ui/styles.css'

import {
  initCore, createNoOpAdapters, core, loadCachedAdoData, loadAdoData,
  loadCachedJiraData, loadJiraData, displayIdOf,
} from '@nexusmd/core'
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost, toast,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  PlannerView, DocumentsView, plannerExportDocx,
  WorkItemDetail, BuildDetail, Drawer, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  WorkItemFieldsEditor, PRTabs, useSeenTracking, SEEN_FINGERPRINTS,
  ApiClientProvider, ApiClientView, ViewDbManager,
} from '@nexusmd/ui'
import { effectiveSidebar, ICON_RAIL_WIDTH, orderedNav } from './layout.js'
import { useLocalItems } from './items-state.js'
import { DesktopSettings } from './desktop-settings.jsx'
import { ProfileProvider, useProfile, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopCloudProviders, registerCloudDeepLink, makeDesktopOAuthService } from './cloud-auth.js'
import { startDesktopAutoSync, desktopSync } from './sync.js'
import { NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, isAdoConfigured } from './ado-client.js'
import { getJiraConfig, isJiraActive, createJiraHttpAdapter, createJiraWorkItemSource } from './jira-client.js'
import { buildSnapshot, refreshProviders, adoMoveToCategory, defaultCreateProvider, adoWorkItemUrl, useRoutedWorkItemSource, nextHiddenIds } from './work-item-data.js'
import { desktopBuildSource } from './desktop-build-source.js'
import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import { PersonSummary, PersonActions } from './person-summary.jsx'
import DesktopNotesView from './desktop-notes-view.jsx'
import { CalendarView } from './views/view-calendar.jsx'
import { DevenvView } from './views/devenv/view-devenv.jsx'
import { DevenvRunProvider } from './views/devenv/devenv-run-context.jsx'
import { createCalendarEvent, toLocalDateTimeString } from './ms-graph-calendar.js'
import { submitNewWorkItem } from './ado-workitem-types.js'
import { navigationAdapter }    from './adapters/navigation.js'
import { authAdapter }          from './adapters/auth.js'
import { fileAdapter }          from './adapters/file.js'
import { pickerAdapter }        from './adapters/picker.js'
import { badgeAdapter }         from './adapters/badge.js'
import { trayAdapter }          from './adapters/tray.js'
import { deepLinkAdapter }      from './adapters/deepLink.js'
import { updateAdapter }        from './adapters/update.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import { scriptRunnerAdapter }  from './adapters/scriptRunner.js'
import { rawHttpAdapter }       from './adapters/rawHttp.js'
import { dbManagerAdapter }     from './adapters/db-manager.js'
import { devenvAdapter }        from './adapters/devenv.js'
import { gitAdapter }           from './adapters/git.js'
import { listSavedConnections, getConnectionSecret } from './db-manager-config.js'

const adapters = {
  ...createNoOpAdapters(),
  storage:       localStorageAdapter,
  http:          createAdoHttpAdapter(),
  network:       networkAdapter,
  lifecycle:     lifecycleAdapter,
  theme:         themeAdapter,
  clipboard:     clipboardAdapter,
  share:         shareAdapter,
  notification:  notificationAdapter,
  navigation:    navigationAdapter,
  auth:          authAdapter,
  file:          fileAdapter,
  picker:        pickerAdapter,
  badge:         badgeAdapter,
  tray:          trayAdapter,
  deepLink:      deepLinkAdapter,
  update:        updateAdapter,
  secureStorage: secureStorageAdapter,
  // Desktop-only — their absence on web/app is what keeps the api-client
  // module from registering there (see module-registry.js hasRequiredAdapters).
  scriptRunner:  scriptRunnerAdapter,
  apiHttp:       rawHttpAdapter,
  // Desktop-only — its absence on web/app is what keeps the db-manager
  // module from registering there.
  dbManager:     dbManagerAdapter,
  // Desktop-only — runs pwsh in the main process; gates the devenv module.
  devenv:        devenvAdapter,
  // Desktop-only — runs git in the main process; gates the git module.
  git:           gitAdapter,
}

const NEXUSMD_THEMES = [
  { id: 'parchment', label: 'Parchment', swatch: ['#f4f1e8', '#ebe5d4', '#9a7e22'] },
  { id: 'dusk',      label: 'Dusk',      swatch: ['#e4e0d2', '#dbd5c2', '#9a7e22'] },
  { id: 'paper',     label: 'Paper',     swatch: ['#f5f5f5', '#e8e8e8', '#1d6fcc'] },
  { id: 'cobalt',    label: 'Cobalt',    swatch: ['#0d1620', '#1f2c3b', '#4a9eff'] },
  { id: 'noir',      label: 'Noir',      swatch: ['#171410', '#282420', '#e8a020'] },
  { id: 'slate',     label: 'Slate',     swatch: ['#1a1c20', '#2a2e38', '#8098e0'] },
  { id: 'forest',    label: 'Forest',    swatch: ['#0e1812', '#1c2a20', '#48b870'] },
]
window.NEXUSMD_THEMES = NEXUSMD_THEMES

const DASH_WIDGET_ORDER = ['sprint', 'review', 'blockers', 'team', 'triage', 'activity', 'resolvedme']

const DEFAULT_TWEAKS = {
  theme: 'light', lightTheme: 'parchment', darkTheme: 'cobalt',
  density: 'balanced', sidebar: 'labels', typeLabels: false,
  widgetOrder: DASH_WIDGET_ORDER,
  navOrder: DEFAULT_NAV_ORDER,
  quickLinks: [
    { label: 'UAT Testing', url: 'https://cirrus.uat.msl.co.uk/', color: 'var(--info)' },
    { label: 'Dev Testing', url: 'https://cirrus.dev.msl.co.uk/', color: 'var(--success)' },
    { label: 'Cirrus HR',   url: 'https://cirrushr.co.uk',        color: 'var(--violet)' },
  ],
}

function loadTweaks() {
  try { const s = localStorage.getItem('nexusmd.tweaks'); return s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS } catch { return DEFAULT_TWEAKS }
}

// Seed a default profile and fold any pre-registry flat `nexusmd.*` data into
// its scope. Must run before initCore, which reads cached ADO data via the
// (now profile-scoped) getProfileKey.
ensureDefaultProfileAndMigrate()

// Subscribe to nexusmd:// deep links so cloud OAuth one-time codes are redeemed.
registerCloudDeepLink()

// Fire-and-forget: enables modules + inits adapters. The shell reads cached data
// and re-renders on core's 'data:updated' events.
initCore(adapters)

// Manual + timed refresh for every work-item provider. ADO also loads PRs/builds/
// tests. Each provider records its own outcome; a failure keeps its cached data.
async function refreshAllData() {
  try {
    await refreshProviders({
      storage: localStorageAdapter,
      providers: {
        ado: {
          configured: isAdoConfigured(),
          run: () => {
            const priorData = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
            return loadAdoData(
              getAdoConfig(),
              { http: createAdoHttpAdapter(), storage: localStorageAdapter },
              { isRefresh: !!priorData && (priorData.TEAM?.length ?? 0) > 0, priorData },
            )
          },
        },
        jira: {
          configured: isJiraActive(),
          run: () => {
            const priorData = loadCachedJiraData(getJiraConfig(), { storage: localStorageAdapter })
            return loadJiraData(
              getJiraConfig(),
              { http: createJiraHttpAdapter(), storage: localStorageAdapter },
              { isRefresh: !!priorData?._jiraMeta, priorData },
            )
          },
        },
      },
    })
  } finally { core._emit?.('data:updated') }
  // Check GitHub token health — fires nexusmd:github-401 event if expired
  try {
    const ghService = makeDesktopOAuthService('github')
    if (ghService?.getToken) {
      await ghService.getToken({ force: true }).catch(() => {})
    }
  } catch {}
}

// F5 (main process menu accelerator) sends 'refresh-data' instead of reloading
// the window, so it triggers the same data refresh as the in-app Refresh
// button rather than resetting navigation state back to the dashboard.
if (window.electronAPI?.onRefreshData) {
  window.electronAPI.onRefreshData(() => { refreshAllData() })
}

// Direct-to-ADO work item source for the desktop (no ASP.NET proxy available).
// Mirrors the shape expected by the shared WorkItemDetail component.
const desktopWorkItemSource = {
  async loadDetail(id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${id}?$expand=all&api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const f = data.fields || {}
    return {
      description:        f['System.Description']                       || null,
      acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'] || null,
      reproSteps:         f['Microsoft.VSTS.TCM.ReproSteps']            || null,
    }
  },
  async loadComments(id, project) {
    const adapter = createAdoHttpAdapter()
    const proj = project || (getAdoConfig().projects || [])[0] || ''
    if (!proj) return []
    const res = await adapter.fetch(`${encodeURIComponent(proj)}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.comments || []).map(c => ({
      id:          c.id,
      author:      c.createdBy?.displayName || '',
      text:        c.text || c.renderedText || '',
      createdDate: c.createdDate || '',
    }))
  },
  async saveField(itemId, field, html) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${itemId}?api-version=7.0`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify([{ op: 'add', path: `/fields/${field}`, value: html }]),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
  async addComment(id, project, html) {
    const adapter = createAdoHttpAdapter()
    const proj = encodeURIComponent(project || (getAdoConfig().projects || [])[0] || '')
    const res = await adapter.fetch(
      `${proj}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments: [{ parentCommentId: 0, content: html, commentType: 1 }], status: 1 }),
      },
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return {
      id:          data.id,
      author:      data.createdBy?.displayName || '',
      text:        html,
      createdDate: data.createdDate || new Date().toISOString(),
    }
  },
  async loadRawFields(id) {
    const adapter = createAdoHttpAdapter()
    const res = await adapter.fetch(`_apis/wit/workitems/${id}?$expand=fields&api-version=7.0`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.fields || {}
  },
  async createWorkItem(payload) {
    return submitNewWorkItem(payload)
  },
  async moveToCategory(id, category, item) {
    const meta = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })?._adoMeta
    return adoMoveToCategory({ item, category, meta, saveState: (state) => this.saveField(id, 'System.State', state) })
  },
  webUrl(item) {
    return adoWorkItemUrl(getAdoConfig().org, item)
  },
}

// Per-profile ids of people hidden from NexusMD (the Team view's "Remove").
function readHiddenPeople() {
  try {
    const ids = JSON.parse(localStorage.getItem(getProfileKey('nexusmd.team.removed')) || '[]')
    return Array.isArray(ids) ? ids : []
  } catch { return [] }
}

// Cached ADO snapshot, shaped for the shared views, re-read on every data:updated.
function useNexusSnapshot() {
  const [snapshot, setSnapshot] = React.useState(EMPTY_NEXUS_DATA)
  const [loaded, setLoaded] = React.useState(false)
  const refresh = React.useCallback(() => {
    try {
      setSnapshot(buildSnapshot({
        adoConfig: getAdoConfig(), adoConfigured: isAdoConfigured(),
        jiraConfig: getJiraConfig(), jiraActive: isJiraActive(),
        storage: localStorageAdapter, empty: EMPTY_NEXUS_DATA,
        hiddenIds: readHiddenPeople(),
      }))
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return { snapshot, loaded }
}

// Simple localStorage-backed state for the per-view "acknowledged" sets and
// PR criteria that the shared views expect their host to own. Keys are routed
// through getProfileKey so this state is scoped to the active profile.
function usePersistedState(key, initial) {
  const sk = getProfileKey(key)
  const [value, setValue] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(sk)
      return raw === null ? initial : JSON.parse(raw)
    } catch { return initial }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem(sk, JSON.stringify(value)) } catch { /* ignore */ }
  }, [sk, value])
  return [value, setValue]
}

function NotConfigured() {
  return (
    <CardFrame title="Welcome to NexusMD" icon={<Icon name="dashboard" size={16} />}>
      <p style={{ color: 'var(--text-muted)', maxWidth: 520 }}>
        Connect your Azure DevOps organisation in <strong>Settings</strong> to populate your
        dashboard with work items, pull requests, builds and sprint metrics.
      </p>
    </CardFrame>
  )
}

function Placeholder({ label }) {
  return (
    <CardFrame title={label}>
      <p style={{ color: 'var(--text-muted)' }}>
        {label} is platform-specific (it depends on the web host's APIs / Google) and is not
        shared into <code>@nexusmd/ui</code> yet.
      </p>
    </CardFrame>
  )
}

function DesktopDetailDrawer({ drawer, onClose, setItems, onOpenItem, onOpenPR }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data
  const http = React.useMemo(() => createAdoHttpAdapter(), [])
  const { workItemSource } = useNexusData()

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : kind === 'person' ? d.name : kind === 'build' ? d.pipeline : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' ? workItemSource.webUrl(d)
    : kind === 'pr' ? d?.url
    : kind === 'build' && (d?.projectName || d?.project) && org
      ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(d.projectName || d.project)}/_build/results?buildId=${d.id}`
      : null

  const markDone = async () => {
    try {
      const r = await workItemSource.moveToCategory(d.id, 'Completed', d)
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: r.state, stateCategory: r.stateCategory } : w))
      toast?.('Marked done', 'success')
      onClose()
    } catch (e) {
      toast?.('Could not update: ' + (e?.message || 'unknown error'), 'error')
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={kind === 'wi' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{displayIdOf(d)}</span>
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ) : kind === 'pr' && d ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
      ) : kind === 'build' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <span className={`build-dot ${d.status}`}/>
        </span>
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {kind === 'person' && d && <PersonActions dev={d} />}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.electronAPI.openLink(adoUrl)}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? (d?.source === 'jira' ? 'Jira' : 'ADO') : kind === 'build' ? 'ADO' : 'browser'}
            </button>
          )}
        </React.Fragment>
      )}>
      {kind === 'wi' && d && (
        <React.Fragment>
          <WorkItemFieldsEditor item={d} onItemUpdated={patch => setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, ...patch } : w))} />
          <WorkItemDetail id={d.id} project={d.project} />
        </React.Fragment>
      )}
      {kind === 'pr' && d && <PRTabs key={d.id} pr={d} http={http} />}
      {kind === 'person' && d && <PersonSummary dev={d} onOpenItem={onOpenItem} onOpenPR={onOpenPR} />}
      {kind === 'build' && d && <BuildDetail build={d} />}
    </Drawer>
  )
}

// Stable fallback so fullRoster (a memo dependency) doesn't change identity every render.
const EMPTY = []

// The view body — reads the snapshot from context and wires per-view host state.
function ViewBody({
  view, onOpenItem, onOpenPR, onOpenPerson = () => {}, onOpenBuild = () => {},
  tweaks = DEFAULT_TWEAKS, setTweak = () => {},
  newItemIds = { work: new Set(), pr: new Set(), builds: new Set(), tests: new Set() },
  plannerData = {}, setPlannerData = () => {},
  plannerThemes = {}, setPlannerThemes = () => {},
  refreshInterval = 300, onRefreshIntervalChange = () => {},
  localItems = null, setLocalItems = () => {},
}) {
  const { data } = useNexusData()
  const { activeProfile } = useProfile() || {}
  // manual profiles don't require ADO config
  const configured = activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() || isJiraActive() } catch { return false } })()
  const openExternal = (item) => { if (item?.url) window.electronAPI.openLink(item.url) }

  const [needsMeCriteria, setNeedsMeCriteria] = usePersistedState('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false })
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersistedState('nexusmd.builds.acknowledged', [])
  const [acknowledgedTests, setAcknowledgedTests]   = usePersistedState('nexusmd.tests.acknowledged', [])
  const [widgetWidths, setWidgetWidths] = usePersistedState('nexusmd.dash.widgetWidths', {})
  const [widgetHeights, setWidgetHeights] = usePersistedState('nexusmd.dash.widgetHeights', {})
  const [calendarEvents, setCalendarEvents] = usePersistedState('nexusmd.calendar.events', [])
  const items = localItems ?? (data.WORK_ITEMS || [])

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
  // The Team view lists removed people (to restore them), so it needs the unfiltered roster.
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

  const handleScheduleOneOnOne = (dev) => {
    const start = new Date()
    start.setHours(10, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 60 * 60000)
    const msAuth = makeDesktopOAuthService('microsoft')
    if (msAuth.isConnected()) {
      createCalendarEvent(msAuth.getToken, {
        title: `1:1 with ${dev.name}`,
        start: toLocalDateTimeString(start),
        end: toLocalDateTimeString(end),
      }).catch(console.error)
    }
    window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))
  }

  switch (view) {
    case 'dashboard': {
      if (!configured) return <NotConfigured />
      const acknowledgedSet = new Set([...acknowledgedBuilds, ...acknowledgedTests])
      return (
        <DashboardView
          onOpenItem={onOpenItem} onOpenPR={onOpenPR}
          widgetOrder={tweaks.widgetOrder || DASH_WIDGET_ORDER} setWidgetOrder={arr => setTweak('widgetOrder', arr)}
          widgetWidths={widgetWidths} setWidgetWidths={setWidgetWidths}
          widgetHeights={widgetHeights} setWidgetHeights={setWidgetHeights}
          needsMeCriteria={needsMeCriteria} setPlannerData={setPlannerData}
          quickLinks={tweaks.quickLinks || []}
          density={tweaks.density}
          team={effectiveTeam}
          acknowledgedSet={acknowledgedSet}
        />
      )
    }
    case 'calendar':
      return (
        <CalendarView
          calendarEvents={calendarEvents}
          setCalendarEvents={setCalendarEvents}
          onNavigatePlanner={() => window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'planner' }))}
        />
      )
    case 'work':
      return (
        <WorkItemsView
          items={items}
          setItems={setLocalItems}
          onOpen={onOpenItem}
          onCreate={() => { window.dispatchEvent(new CustomEvent('nexusmd:create-wi', { detail: {} })) }}
          team={effectiveTeam}
          newItemIds={newItemIds.work}
        />
      )
    case 'prs':
      return (
        <PRView prs={data.PRS || []} onOpen={onOpenPR}
          onOpenLink={(u) => window.electronAPI.openLink(u)}
          needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
          newItemIds={newItemIds.pr} />
      )
    case 'builds':
      return (
        <BuildsView builds={data.BUILDS || []}
          acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
          newItemIds={newItemIds.builds} onOpenBuild={onOpenBuild}
        />
      )
    case 'tests':
      return (
        <TestsView tests={data.TESTS || []}
          acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests}
          newItemIds={newItemIds.tests} />
      )
    case 'team':
      return (
        <TeamView
          team={teamViewTeam}
          workItems={data.WORK_ITEMS || []}
          prs={data.PRS || []}
          onOpenItem={onOpenItem}
          onOpenPerson={onOpenPerson}
          onTeamChange={handleTeamChange}
          onScheduleOneOnOne={handleScheduleOneOnOne}
        />
      )
    case 'triage':
      return <TriageView />
    case 'planner': {
      const pk = k => { try { return getProfileKey(k) } catch { return k } }
      const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
      const plannerPrefs = {
        landing:     readPref('nexusmd.planner.landing', 'glance'),
        nav:         readPref('nexusmd.planner.nav', 'rail'),
        entry:       readPref('nexusmd.planner.entry', 'inline'),
        carryPrompt: readPref('nexusmd.planner.carryPrompt', '1') === '1',
      }
      const handlePlannerCloudSync = async () => {
        try {
          const r = await desktopSync.syncOnce()
          if (r.skipped === 'no-key') toast?.('Set a sync passphrase in Settings first.', 'info')
          else if (r.skipped === 'no-provider') toast?.('Select a cloud provider in Settings first.', 'info')
          else if (r.skipped === 'not-connected') toast?.('Connect your cloud provider in Settings first.', 'info')
          else if (r.skipped === 'bad-passphrase') toast?.('Wrong passphrase — fix it in Settings.', 'error')
          else if (!r.skipped) toast?.(`Backed up — pushed ${r.pushed}, pulled ${r.pulled}, merged ${r.merged}.`, 'success')
        } catch (err) { toast?.('Cloud sync failed: ' + (err?.message || 'unknown error'), 'error') }
      }
      return (
        <PlannerView
          data={plannerData}
          setData={setPlannerData}
          themes={plannerThemes}
          setThemes={setPlannerThemes}
          onExportDocx={plannerExportDocx}
          landing={plannerPrefs.landing}
          navStyle={plannerPrefs.nav}
          entryStyle={plannerPrefs.entry}
          carryPrompt={plannerPrefs.carryPrompt}
          showGlobalNotesTab={false}
          onCloudSync={handlePlannerCloudSync}
        />
      )
    }
    case 'notes':
      return <DesktopNotesView />
    case 'markdown':
      return <DocumentsView />
    case 'api-client':
      return (
        <ApiClientProvider adapters={adapters}>
          <ApiClientView />
        </ApiClientProvider>
      )
    case 'db-manager':
      return (
        <ViewDbManager
          adapters={adapters}
          savedConnections={listSavedConnections()}
          onResolveSecret={id => getConnectionSecret(secureStorageAdapter, id)}
        />
      )
    case 'devenv':
      return <DevenvView adapters={adapters} />
    case 'settings':
      return <DesktopSettings tweaks={tweaks} setTweak={setTweak}
        nav={NAV} defaultNavOrder={DEFAULT_TWEAKS.navOrder}
        refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange}
        onRefreshData={refreshAllData} />
    default:
      return <Placeholder label={(ALL_NAV.find(n => n.id === view) || ALL_NAV[0]).label} />
  }
}

function WindowControls() {
  if (window.electronAPI?.platform === 'darwin') return null;
  const win = window.electronAPI?.window;
  return (
    <div style={{ display: 'flex', alignSelf: 'stretch', marginLeft: 'auto', marginTop: -10, marginBottom: -10 }}>
      <button className="wc-btn" onClick={() => win?.minimize()} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn" onClick={() => win?.maximize()} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0h10v10H0V0zm1 1v8h8V1H1z" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn wc-close" onClick={() => win?.close()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

function DesktopProjectAreasModal({ open, onClose }) {
  const [areas, setAreas] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('nexusmd.projectAreas.v3') || '[]') } catch { return [] }
  })

  React.useEffect(() => {
    if (open) {
      try { setAreas(JSON.parse(localStorage.getItem('nexusmd.projectAreas.v3') || '[]')) } catch { setAreas([]) }
    }
  }, [open])

  const save = (next) => {
    setAreas(next)
    try { localStorage.setItem('nexusmd.projectAreas.v3', JSON.stringify(next)) } catch {}
  }

  if (!open) return null

  const addArea  = () => save([...areas, { id: Date.now().toString(), label: 'New area' }])
  const remove   = (id) => save(areas.filter(a => a.id !== id))
  const rename   = (id, label) => save(areas.map(a => a.id === id ? { ...a, label } : a))

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 10, padding: 24, width: 'min(520px, 92vw)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Project Areas</h2>
          <button className="btn sm ghost" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {areas.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No areas yet. Click "+ Add area" to create one.</p>
          )}
          {areas.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                value={a.label}
                onChange={e => rename(a.id, e.target.value)}
                style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13 }}
              />
              <button className="btn sm ghost" onClick={() => remove(a.id)} title="Delete area">
                <Icon name="trash" size={12}/>
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={addArea}>+ Add area</button>
          <button className="btn sm primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [view, setView]         = React.useState('dashboard')
  const [createWI, setCreateWI] = React.useState(null)
  const [areasOpen, setAreasOpen] = React.useState(false)
  const [drawer, setDrawer] = React.useState(null)
  const [sidebarWidth, setSidebarWidth] = usePersistedState('nexusmd.sidebar.width', 220)
  const openItem   = item => setDrawer({ kind: 'wi', data: item })
  const openPR     = pr   => setDrawer({ kind: 'pr', data: pr })
  const openPerson = dev  => setDrawer({ kind: 'person', data: dev })
  const openBuild  = b    => setDrawer({ kind: 'build', data: b })
  const [tweaks, setTweaksState] = React.useState(loadTweaks)

  // Fall back to clientWidth when innerWidth is 0 (e.g. jsdom in tests) so the
  // sidebar doesn't spuriously start collapsed.
  const [winWidth, setWinWidth] = React.useState(() => window.innerWidth || document.documentElement.clientWidth || 1280)
  React.useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const effSidebar = effectiveSidebar(winWidth, tweaks.sidebar)
  const iconsOnly  = effSidebar === 'icons'

  const setTweak = React.useCallback((key, value) => {
    setTweaksState(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem('nexusmd.tweaks', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [])

  React.useEffect(() => {
    const palette = tweaks.theme === 'dark' ? (tweaks.darkTheme || 'cobalt') : (tweaks.lightTheme || 'parchment')
    document.body.dataset.theme = palette
  }, [tweaks.theme, tweaks.darkTheme, tweaks.lightTheme])

  React.useEffect(() => {
    window.nexusMDTypeLabels = tweaks.typeLabels || false
  }, [tweaks.typeLabels])

  React.useEffect(() => {
    const handler = () => setAreasOpen(true)
    window.addEventListener('nexusmd:openProjectAreas', handler)
    return () => window.removeEventListener('nexusmd:openProjectAreas', handler)
  }, [])

  const [githubExpired, setGithubExpired] = React.useState(false)

  const [plannerData, setPlannerData]     = React.useState({})
  const [plannerThemes, setPlannerThemes] = React.useState({})

  const [refreshInterval, setRefreshInterval] = React.useState(() => {
    try { return parseInt(localStorage.getItem('nexusmd.refreshInterval') || '300', 10) } catch { return 300 }
  })
  const [refreshPaused, setRefreshPaused] = React.useState(false)
  const [refreshLeft, setRefreshLeft] = React.useState(refreshInterval)
  const refreshLeftRef = React.useRef(refreshInterval)

  const active = ALL_NAV.find(n => n.id === view) || ALL_NAV[0]
  const { snapshot, loaded: dataLoaded } = useNexusSnapshot()

  // localItems starts as null (sentinel: mirror snapshot.WORK_ITEMS). Shared
  // views update via setItems(arr => arr.map(...)); the setter resolves the
  // sentinel to the current snapshot so the first edit doesn't call .map on null.
  // A new snapshot (refresh, hide/restore) resets it so Work Items shows it.
  const [localItems, setItemsResolved] = useLocalItems(snapshot)

  const seenCategories = {
    work:   { items: snapshot.WORK_ITEMS || [], fingerprint: SEEN_FINGERPRINTS.work },
    pr:     { items: snapshot.PRS || [],        fingerprint: SEEN_FINGERPRINTS.pr },
    builds: { items: snapshot.BUILDS || [],     fingerprint: SEEN_FINGERPRINTS.builds },
    tests:  { items: snapshot.TESTS || [],      fingerprint: SEEN_FINGERPRINTS.tests },
  }
  const { unseenIds: newItemIds, unseenCounts, markSeen } = useSeenTracking(
    seenCategories, dataLoaded, { storage: window.localStorage, getProfileKey },
  )
  // Sidebar badges are keyed by nav id; 'prs' (nav-config.js) maps to the 'pr' category.
  const changeBadges = { work: unseenCounts.work, prs: unseenCounts.pr, builds: unseenCounts.builds, tests: unseenCounts.tests }

  React.useEffect(() => {
    const viewToCategory = { work: 'work', prs: 'pr', builds: 'builds', tests: 'tests' }
    const key = viewToCategory[view]
    if (key) markSeen(key)
  }, [view, snapshot])

  React.useEffect(() => {
    const handler = () => setGithubExpired(true)
    window.addEventListener('nexusmd:github-401', handler)
    return () => window.removeEventListener('nexusmd:github-401', handler)
  }, [])

  React.useEffect(() => {
    const handler = e => {
      const detail = e.detail
      // Accept both the string payload (desktop-internal dispatches) and the
      // { view, filter } object payload used by shared @nexusmd/ui components.
      const next = typeof detail === 'string' ? detail : detail?.view
      const filter = (detail && typeof detail === 'object') ? (detail.filter || null) : null
      if (next) {
        // Stash the filter so views (e.g. PRView's focused work item) can consume it,
        // mirroring the web host's window.NexusMDNav mechanism.
        window.NexusMDNav = { pendingFilter: filter, view: next }
        setView(next)
      }
    }
    window.addEventListener('nexusmd:navigate', handler)
    return () => window.removeEventListener('nexusmd:navigate', handler)
  }, [])

  React.useEffect(() => {
    const handler = (e) => setCreateWI(e.detail || {})
    window.addEventListener('nexusmd:create-wi', handler)
    return () => window.removeEventListener('nexusmd:create-wi', handler)
  }, [])

  React.useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const idx = parseInt(e.key, 10)
      if (idx >= 1 && idx <= 9) {
        const target = NAV[idx - 1]
        if (target) setView(target.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  React.useEffect(() => {
    refreshLeftRef.current = refreshInterval
    setRefreshLeft(refreshInterval)
  }, [refreshInterval])

  React.useEffect(() => {
    if (refreshPaused) return
    const tick = setInterval(() => {
      refreshLeftRef.current -= 1
      setRefreshLeft(refreshLeftRef.current)
      if (refreshLeftRef.current <= 0) {
        refreshAllData()
        refreshLeftRef.current = refreshInterval
        setRefreshLeft(refreshInterval)
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [refreshPaused, refreshInterval])

  // One Jira source per Jira-active state: a new identity on every snapshot
  // would make JiraCreateForm re-fetch create-meta and wipe the user's input.
  const jiraActive = isJiraActive()
  const jiraSource = React.useMemo(() => (jiraActive ? createJiraWorkItemSource() : null), [jiraActive])
  // Stable across data refreshes: only a Jira-source change produces a new identity.
  const workItemSource = useRoutedWorkItemSource(desktopWorkItemSource, jiraSource)

  const nexusDataValue = React.useMemo(() => ({
    data:           snapshot,
    api:            { load: refreshAllData },
    storage:        window.localStorage,
    getProfileKey,
    pushPref:       () => {},
    workItemSource,
    buildSource:    desktopBuildSource,
  }), [snapshot, workItemSource])

  return (
    <NexusDataProvider value={nexusDataValue}>
    {/* Above ViewBody so a devenv run (and its prompts) outlives leaving its screen. */}
    <DevenvRunProvider adapter={adapters.devenv}
      notify={(title, body) => notificationAdapter.send(title, body, { tag: 'devenv-prompt' })}>
      <div data-density={tweaks.density} data-sidebar={effSidebar}
        style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <aside style={{
          width: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          minWidth: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--surface, transparent)', position: 'relative',
        }}>
          <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
            <Icon name="dashboard" size={18} />
            {!iconsOnly && <strong style={{ fontSize: 14 }}>NexusMD</strong>}
          </div>
          {orderedNav(tweaks.navOrder, NAV).map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              title={iconsOnly ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                justifyContent: iconsOnly ? 'center' : 'flex-start',
                gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: view === item.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
                color: view === item.id ? 'var(--accent)' : 'var(--text-muted)',
                font: 'inherit', fontSize: 13, position: 'relative',
              }}
            >
              <Icon name={item.icon} size={16} />
              {!iconsOnly && item.label}
              {changeBadges[item.id] > 0 && (
                iconsOnly ? (
                  <span style={{
                    position: 'absolute', top: 4, right: 4, width: 8, height: 8,
                    background: 'var(--accent)', borderRadius: '50%',
                  }} />
                ) : (
                  <span style={{
                    marginLeft: 'auto', minWidth: 18, height: 18,
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    borderRadius: 9, fontSize: 11, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px',
                  }}>
                    {changeBadges[item.id] > 99 ? '99+' : changeBadges[item.id]}
                  </span>
                )
              )}
              {!iconsOnly && tweaks.sidebar === 'labels' && idx < 9 && !changeBadges[item.id] && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)', opacity: 0.5 }}>
                  {idx + 1}
                </span>
              )}
            </button>
          ))}
          <div style={{ marginTop: 'auto' }} />
          <button
            key={SETTINGS_NAV.id}
            onClick={() => setView(SETTINGS_NAV.id)}
            className={`nav-item ${view === SETTINGS_NAV.id ? 'active' : ''}`}
            title={iconsOnly ? SETTINGS_NAV.label : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: iconsOnly ? 'center' : 'flex-start',
              gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
              border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              background: view === SETTINGS_NAV.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
              color: view === SETTINGS_NAV.id ? 'var(--accent)' : 'var(--text-muted)',
              font: 'inherit', fontSize: 13, position: 'relative',
            }}
          >
            <Icon name={SETTINGS_NAV.icon} size={16} />
            {!iconsOnly && SETTINGS_NAV.label}
          </button>
          {!iconsOnly && (
            <div
              style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 10 }}
              onMouseDown={e => {
                e.preventDefault()
                const startX = e.clientX
                const startW = sidebarWidth
                const onMove = (me) => {
                  const next = Math.max(160, Math.min(320, startW + me.clientX - startX))
                  setSidebarWidth(next)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
          )}
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <header className="topbar" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 10px 18px',
            borderBottom: '1px solid var(--border)',
          }}>
            <Icon name={active.icon} size={16} />
            <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
              {refreshPaused ? 'paused' : `${refreshLeft}s`}
            </span>
            <button className="btn sm ghost" title={refreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              onClick={() => setRefreshPaused(p => !p)}>
              <Icon name={refreshPaused ? 'play' : 'pause'} size={12}/>
            </button>
            <WindowControls />
          </header>
          {githubExpired && (
            <div style={{
              background: 'var(--warning-soft)', borderBottom: '1px solid var(--warning-border)',
              padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
              flexShrink: 0,
            }}>
              <Icon name="alert" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }}/>
              <span style={{ flex: 1, color: 'var(--warning-text)' }}>GitHub token expired — re-connect to restore PR and build data.</span>
              <button className="btn sm ghost" onClick={() => {
                window.electronAPI?.openExternal?.('nexusmd://github-oauth')
                setGithubExpired(false)
              }}>Re-connect</button>
              <button className="btn sm ghost" onClick={() => setGithubExpired(false)}>
                <Icon name="x" size={12}/>
              </button>
            </div>
          )}
          <section style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: view === 'markdown' ? 'hidden' : 'auto',
            padding: view === 'markdown' ? 0 : 18,
          }}>
            <ViewBody
              view={view} onOpenItem={openItem} onOpenPR={openPR} onOpenPerson={openPerson} onOpenBuild={openBuild}
              tweaks={tweaks} setTweak={setTweak}
              newItemIds={newItemIds}
              plannerData={plannerData} setPlannerData={setPlannerData}
              plannerThemes={plannerThemes} setPlannerThemes={setPlannerThemes}
              refreshInterval={refreshInterval} onRefreshIntervalChange={setRefreshInterval}
              localItems={localItems} setLocalItems={setItemsResolved}
            />
          </section>
        </main>
      </div>
      <ToastHost />
      <TweaksPanel title="Display">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweaks.theme}
            onChange={v => setTweak('theme', v)}
            options={[{label:'Light',value:'light'},{label:'Dark',value:'dark'}]}/>
          <TweakRadio label="Density" value={tweaks.density}
            onChange={v => setTweak('density', v)}
            options={[{label:'Compact',value:'compact'},{label:'Balanced',value:'balanced'},{label:'Cozy',value:'cozy'}]}/>
          <TweakRadio label="Sidebar" value={tweaks.sidebar}
            onChange={v => setTweak('sidebar', v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
          <TweakToggle label="Show type labels" value={tweaks.typeLabels || false}
            onChange={v => setTweak('typeLabels', v)}/>
        </TweakSection>
        <TweakSection title="Dashboard">
          <TweakButton label="Reset widget order"
            onClick={() => setTweak('widgetOrder', DASH_WIDGET_ORDER)}/>
        </TweakSection>
      </TweaksPanel>
      <DesktopDetailDrawer drawer={drawer} onClose={() => setDrawer(null)} setItems={setItemsResolved}
        onOpenItem={openItem} onOpenPR={openPR} />
      <CreateWorkItemDrawer
        open={!!createWI}
        title={createWI?.title}
        project={getAdoConfig().projects || []}
        team={snapshot.TEAM || []}
        adoAvailable={isAdoConfigured()}
        jira={jiraActive ? {
          source: jiraSource,
          projectKeys: getJiraConfig().projectKeys,
          people: snapshot.JIRA_PEOPLE || [],
          site: getJiraConfig().site,
        } : null}
        defaultProvider={defaultCreateProvider({
          readJson: (k, d) => { try { const v = localStorage.getItem(getProfileKey(k)); return v == null ? d : JSON.parse(v) } catch { return d } },
          adoAvailable: isAdoConfigured(),
          jiraAvailable: jiraActive,
        })}
        onProviderChange={(p) => { try { localStorage.setItem(getProfileKey('nexusmd.wi.createProvider'), JSON.stringify(p)) } catch {} }}
        onJiraCreated={(result) => {
          if (!result.warnings?.length) setTimeout(() => setCreateWI(null), 600)
          refreshAllData()
        }}
        onClose={() => setCreateWI(null)}
        onCreate={async (payload) => {
          const result = await desktopWorkItemSource.createWorkItem(payload)
          if (result.warnings.length === 0) {
            setTimeout(() => setCreateWI(null), 600)
          }
          return result
        }}
      />
      <DesktopProjectAreasModal open={areasOpen} onClose={() => setAreasOpen(false)} />
    </DevenvRunProvider>
    </NexusDataProvider>
  )
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Uncaught render error:', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        background: 'var(--surface, #1e1e1e)', color: 'var(--text, #eee)',
        fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24,
      }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h2>
        <p style={{ margin: 0, maxWidth: 480, fontSize: 13, opacity: 0.8 }}>
          {this.state.error?.message || 'The app hit an unexpected error and could not continue rendering.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ProfileProvider>
        <App />
      </ProfileProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)

startDesktopAutoSync()
