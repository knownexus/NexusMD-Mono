import React from 'react'
import ReactDOM from 'react-dom/client'
import '@nexusmd/ui/styles.css'

import {
  initCore, createNoOpAdapters, core, loadCachedAdoData, loadAdoData,
} from '@nexusmd/core'
import {
  Icon, CardFrame,
  NexusDataProvider, useNexusData, ToastHost,
  PRView, BuildsView, TestsView, TeamView, EMPTY_NEXUS_DATA,
  DashboardView, WorkItemsView, TriageView,
  PlannerView, MarkdownViewer, plannerExportDocx,
  WorkItemDetail, Drawer, TypeIcon, Prio,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
} from '@nexusmd/ui'
import { effectiveSidebar, ICON_RAIL_WIDTH, orderedNav } from './layout.js'
import { DesktopSettings } from './desktop-settings.jsx'
import { ProfileProvider, useProfile, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopCloudProviders, registerCloudDeepLink, makeDesktopOAuthService } from './cloud-auth.js'
import { startDesktopAutoSync } from './sync.js'
import { NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, isAdoConfigured } from './ado-client.js'
import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import DesktopNotesView from './desktop-notes-view.jsx'
import { CalendarView } from './views/view-calendar.jsx'
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

// Manual refresh for the views' Refresh buttons (api.load). Does a full load on
// first run (no cache) so team members are fetched from the ADO teams API. On
// subsequent calls, passes the cached team as priorData so isRefresh=true skips
// the expensive team API and reuses it.
async function refreshAdoData() {
  try {
    if (!isAdoConfigured()) return
    const priorData = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
    await loadAdoData(
      getAdoConfig(),
      { http: createAdoHttpAdapter(), storage: localStorageAdapter },
      { isRefresh: !!priorData && (priorData.TEAM?.length ?? 0) > 0, priorData },
    )
  } catch {
    /* offline / not configured — keep cached */
  }
  finally { core._emit?.('data:updated') }
  // Check GitHub token health — fires nexusmd:github-401 event if expired
  try {
    const ghService = makeDesktopOAuthService('github')
    if (ghService?.getToken) {
      await ghService.getToken({ force: true }).catch(() => {})
    }
  } catch {}
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
}

// Cached ADO snapshot, shaped for the shared views, re-read on every data:updated.
function useNexusSnapshot() {
  const [snapshot, setSnapshot] = React.useState(EMPTY_NEXUS_DATA)
  const refresh = React.useCallback(() => {
    try {
      const cached = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
      setSnapshot(cached ? { ...EMPTY_NEXUS_DATA, ...cached } : EMPTY_NEXUS_DATA)
    } catch { setSnapshot(EMPTY_NEXUS_DATA) }
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return snapshot
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

function DesktopPRDetail({ pr }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span className={`pill ${pr.status}`} style={{ textTransform: 'capitalize' }}>{pr.status}</span>
        {pr.draft && <span className="pill">Draft</span>}
        {pr.hasConflicts && <span className="pill danger"><Icon name="alert" size={9}/> Conflicts</span>}
        {pr.ciStatus === 'success' && <span className="pill success">CI passing</span>}
        {pr.ciStatus === 'failed'  && <span className="pill danger">CI failing</span>}
        {pr.ciStatus === 'running' && <span className="pill info">CI running</span>}
        {pr.ciStatus === 'partial' && <span className="pill warning">CI partial</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="git-branch" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }}/>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>{pr.branch}</span>
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          <strong>Author:</strong> {pr.authorName || pr.author}
          {' · '}<strong>Opened:</strong> {pr.age} ago
          {pr.repo && <>{' · '}<strong>Repo:</strong> {pr.repo}</>}
        </div>
        <div>
          <span style={{ color: 'var(--success)', fontWeight: 500 }}>+{pr.additions}</span>
          {' '}
          <span style={{ color: 'var(--danger)', fontWeight: 500 }}>−{pr.deletions}</span>
          {pr.comments > 0 && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
              <Icon name="comment" size={11}/> {pr.comments} comment{pr.comments !== 1 ? 's' : ''}
              {pr.unresolvedComments > 0 && ` (${pr.unresolvedComments} unresolved)`}
            </span>
          )}
        </div>
      </div>
      {(pr.reviewerDetails || []).length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Reviewers</div>
          {pr.reviewerDetails.map((r, i) => {
            const v = r.vote
            const label = v === 10 || v === 5 ? 'Approved' : v === -10 ? 'Rejected' : v === -5 ? 'Waiting for author' : 'Pending'
            const color = v === 10 || v === 5 ? 'var(--success)' : v === -10 ? 'var(--danger)' : v === -5 ? 'var(--warning)' : 'var(--text-subtle)'
            return (
              <div key={`${r.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{r.name || r.id}</span>
                <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
              </div>
            )
          })}
        </div>
      )}
      {(pr.linkedWorkItems || []).length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Linked Work Items</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pr.linkedWorkItems.map(wi => (
              <span key={wi.id} className="pill" style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-border)' }}>#{wi.id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DesktopDetailDrawer({ drawer, onClose, setItems }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' && d?.project && org
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent((d.project || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}/_workitems/edit/${d.id}`
    : kind === 'pr' ? d?.url : null

  const markDone = async () => {
    try {
      await desktopWorkItemSource.saveField(d.id, 'System.State', 'Done')
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: 'Done' } : w))
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
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ) : kind === 'pr' && d ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => window.electronAPI.openLink(adoUrl)}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? 'ADO' : 'browser'}
            </button>
          )}
        </React.Fragment>
      )}>
      {kind === 'wi' && d && <WorkItemDetail id={d.id} project={d.project} />}
      {kind === 'pr' && d && <DesktopPRDetail pr={d} />}
    </Drawer>
  )
}

// The view body — reads the snapshot from context and wires per-view host state.
function ViewBody({
  view, onOpenItem, onOpenPR,
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
  const configured = activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() } catch { return false } })()
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

  const effectiveTeam = React.useMemo(() => {
    const base = (data.TEAM || []).filter(m => !removedIds.includes(m.id))
    const existingIds = new Set(base.map(m => m.id))
    return [...base, ...customTeam.filter(m => !existingIds.has(m.id))]
  }, [data.TEAM, customTeam, removedIds])

  const handleTeamChange = (newTeam) => {
    const baseIds = new Set((data.TEAM || []).map(m => m.id))
    const newCustom = newTeam.filter(m => !baseIds.has(m.id))
    const newRemoved = (data.TEAM || []).filter(m => !newTeam.find(t => t.id === m.id)).map(m => m.id)
    setCustomTeam(newCustom)
    setRemovedIds(newRemoved)
    try {
      localStorage.setItem(getProfileKey('nexusmd.team.custom'), JSON.stringify(newCustom))
      localStorage.setItem(getProfileKey('nexusmd.team.removed'), JSON.stringify(newRemoved))
    } catch {}
  }

  const handleAddNote = (devId, note) => {
    setPlannerData(prev => {
      const notes = prev.globalNotes || []
      return { ...prev, globalNotes: [...notes, { devId, note, date: new Date().toISOString() }] }
    })
  }

  const handleScheduleOneOnOne = (dev) => {
    const start = new Date()
    start.setHours(10, 0, 0, 0)
    start.setDate(start.getDate() + 1)
    const end = new Date(start.getTime() + 60 * 60000)
    const msAuth = makeDesktopOAuthService('microsoft')
    if (msAuth.isConnected()) {
      msAuth.getToken({}).then((token) => {
        if (!token) return
        return createCalendarEvent(token, {
          title: `1:1 with ${dev.name}`,
          start: toLocalDateTimeString(start),
          end: toLocalDateTimeString(end),
        })
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
          team={data.TEAM || []}
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
          team={data.TEAM || []}
          newItemIds={newItemIds.work}
        />
      )
    case 'prs':
      return (
        <PRView prs={data.PRS || []} onOpen={onOpenPR}
          needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria}
          newItemIds={newItemIds.pr} />
      )
    case 'builds':
      return (
        <BuildsView builds={data.BUILDS || []}
          acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds}
          newItemIds={newItemIds.builds} />
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
          team={effectiveTeam}
          workItems={data.WORK_ITEMS || []}
          prs={data.PRS || []}
          onOpenItem={onOpenItem}
          onOpenPerson={() => {}}
          onTeamChange={handleTeamChange}
          onAddNote={handleAddNote}
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
        />
      )
    }
    case 'notes':
      return <DesktopNotesView />
    case 'markdown':
      return <MarkdownViewer />
    case 'settings':
      return <DesktopSettings tweaks={tweaks} setTweak={setTweak}
        nav={NAV} defaultNavOrder={DEFAULT_TWEAKS.navOrder}
        refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange}
        onRefreshData={refreshAdoData} />
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
  const openItem = item => setDrawer({ kind: 'wi', data: item })
  const openPR   = pr   => setDrawer({ kind: 'pr', data: pr })
  const [localItems, setLocalItems] = React.useState(null)
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

  const prevSnapshotIdsRef = React.useRef(null)
  const [newItemIds, setNewItemIds] = React.useState({
    work: new Set(), pr: new Set(), builds: new Set(), tests: new Set(),
  })
  const [changeBadges, setChangeBadges] = React.useState({ work: 0, prs: 0, builds: 0, tests: 0 })

  const [refreshInterval, setRefreshInterval] = React.useState(() => {
    try { return parseInt(localStorage.getItem('nexusmd.refreshInterval') || '300', 10) } catch { return 300 }
  })
  const [refreshPaused, setRefreshPaused] = React.useState(false)
  const [refreshLeft, setRefreshLeft] = React.useState(refreshInterval)
  const refreshLeftRef = React.useRef(refreshInterval)

  const active = ALL_NAV.find(n => n.id === view) || ALL_NAV[0]
  const snapshot = useNexusSnapshot()

  React.useEffect(() => {
    const toIds = arr => new Set((arr || []).map(i => i.id))
    const cur = {
      work:   toIds(snapshot.WORK_ITEMS),
      pr:     toIds(snapshot.PRS),
      builds: toIds(snapshot.BUILDS),
      tests:  toIds(snapshot.TESTS),
    }
    if (prevSnapshotIdsRef.current === null) {
      prevSnapshotIdsRef.current = cur
      return
    }
    const prev = prevSnapshotIdsRef.current
    setNewItemIds(n => ({
      work:   new Set([...n.work,   ...[...cur.work].filter(id => !prev.work.has(id))]),
      pr:     new Set([...n.pr,     ...[...cur.pr].filter(id => !prev.pr.has(id))]),
      builds: new Set([...n.builds, ...[...cur.builds].filter(id => !prev.builds.has(id))]),
      tests:  new Set([...n.tests,  ...[...cur.tests].filter(id => !prev.tests.has(id))]),
    }))
    const changed = (curSet, prevSet) => [...curSet].filter(id => !prevSet.has(id)).length
    setChangeBadges(b => ({
      work:   b.work   + changed(cur.work,   prev.work),
      prs:    b.prs    + changed(cur.pr,     prev.pr),
      builds: b.builds + changed(cur.builds, prev.builds),
      tests:  b.tests  + changed(cur.tests,  prev.tests),
    }))
    prevSnapshotIdsRef.current = cur
  }, [snapshot])

  React.useEffect(() => {
    const keyMap = { work: 'work', prs: 'prs', builds: 'builds', tests: 'tests' }
    const wiKey = keyMap[view]
    if (wiKey) {
      setNewItemIds(n => ({ ...n, [wiKey === 'prs' ? 'pr' : wiKey]: new Set() }))
      setChangeBadges(b => ({ ...b, [wiKey]: 0 }))
    }
  }, [view])

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
        refreshAdoData()
        refreshLeftRef.current = refreshInterval
        setRefreshLeft(refreshInterval)
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [refreshPaused, refreshInterval])

  const nexusDataValue = React.useMemo(() => ({
    data:           snapshot,
    api:            { load: refreshAdoData },
    storage:        window.localStorage,
    getProfileKey,
    pushPref:       () => {},
    workItemSource: desktopWorkItemSource,
  }), [snapshot])

  return (
    <NexusDataProvider value={nexusDataValue}>
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
              view={view} onOpenItem={openItem} onOpenPR={openPR}
              tweaks={tweaks} setTweak={setTweak}
              newItemIds={newItemIds}
              plannerData={plannerData} setPlannerData={setPlannerData}
              plannerThemes={plannerThemes} setPlannerThemes={setPlannerThemes}
              refreshInterval={refreshInterval} onRefreshIntervalChange={setRefreshInterval}
              localItems={localItems} setLocalItems={setLocalItems}
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
      <DesktopDetailDrawer drawer={drawer} onClose={() => setDrawer(null)} setItems={setLocalItems} />
      <CreateWorkItemDrawer
        open={!!createWI}
        title={createWI?.title}
        project={getAdoConfig().projects || []}
        team={snapshot.TEAM || []}
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
