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
  VsProfiles, BackupRestoreCard, CloudSyncCard,
} from '@nexusmd/ui'
import { ProfileProvider, useProfile, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopFileIO } from './file-io.js'
import { desktopCloudProviders, registerCloudDeepLink } from './cloud-auth.js'
import { desktopSync, startDesktopAutoSync } from './sync.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, isAdoConfigured } from './ado-client.js'
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

// Seed a default profile and fold any pre-registry flat `nexusmd.*` data into
// its scope. Must run before initCore, which reads cached ADO data via the
// (now profile-scoped) getProfileKey.
ensureDefaultProfileAndMigrate()

// Subscribe to nexusmd:// deep links so cloud OAuth one-time codes are redeemed.
registerCloudDeepLink()

// Fire-and-forget: enables modules + inits adapters. The shell reads cached data
// and re-renders on core's 'data:updated' events.
initCore(adapters)

// Manual refresh for the views' Refresh buttons (api.load). Pulls fresh ADO data
// straight from the org via the desktop http adapter, then nudges the snapshot.
async function refreshAdoData() {
  try {
    if (!isAdoConfigured()) return
    await loadAdoData(getAdoConfig(), { http: createAdoHttpAdapter(), storage: localStorageAdapter }, { isRefresh: true })
  } catch { /* offline / not configured — keep cached */ }
  finally { core._emit?.('data:updated') }
}

const DASH_WIDGET_ORDER = ['sprint', 'review', 'blockers', 'team', 'triage', 'activity', 'resolvedme']

const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work Items',     icon: 'work' },
  { id: 'prs',       label: 'Pull Requests',  icon: 'pr' },
  { id: 'builds',    label: 'Builds',         icon: 'build' },
  { id: 'tests',     label: 'Tests',          icon: 'check' },
  { id: 'team',      label: 'Team',           icon: 'team' },
  { id: 'triage',    label: 'Triage',         icon: 'work' },
  { id: 'planner',   label: 'Planner',        icon: 'planner' },
  { id: 'settings',  label: 'Settings',       icon: 'settings' },
]

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

// Settings — profile registry (create / switch / edit / delete) plus encrypted
// backup & restore. Both are driven by the shared ProfileProvider.
function DesktopSettings() {
  const profileApi = useProfile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <VsProfiles profileApi={profileApi} />
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
      <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
    </div>
  )
}

// The view body — reads the snapshot from context and wires per-view host state.
function ViewBody({ view }) {
  const { data } = useNexusData()
  const { activeProfile } = useProfile?.() || {}
  const configured = activeProfile?.type === 'manual' || (() => { try { return isAdoConfigured() } catch { return false } })()
  const openExternal = (item) => { if (item?.url) window.open(item.url, '_blank', 'noopener') }

  const [needsMeCriteria, setNeedsMeCriteria] = usePersistedState('nexusmd.pr.needsMeCriteria', { votes: [0], includeDrafts: false })
  const [acknowledgedBuilds, setAcknowledgedBuilds] = usePersistedState('nexusmd.builds.acknowledged', [])
  const [acknowledgedTests, setAcknowledgedTests]   = usePersistedState('nexusmd.tests.acknowledged', [])
  const [widgetOrder, setWidgetOrder]   = usePersistedState('nexusmd.dash.widgetOrder', DASH_WIDGET_ORDER)
  const [widgetWidths, setWidgetWidths] = usePersistedState('nexusmd.dash.widgetWidths', {})
  const [widgetHeights, setWidgetHeights] = usePersistedState('nexusmd.dash.widgetHeights', {})

  switch (view) {
    case 'dashboard':
      if (!configured) return <NotConfigured />
      return (
        <DashboardView
          onOpenItem={openExternal} onOpenPR={openExternal}
          widgetOrder={widgetOrder} setWidgetOrder={setWidgetOrder}
          widgetWidths={widgetWidths} setWidgetWidths={setWidgetWidths}
          widgetHeights={widgetHeights} setWidgetHeights={setWidgetHeights}
          needsMeCriteria={needsMeCriteria} setPlannerData={() => {}}
          quickLinks={[]}
        />
      )
    case 'work':
      return (
        <WorkItemsView items={data.WORK_ITEMS || []} setItems={() => {}}
          onOpen={openExternal} onCreate={() => {}} />
      )
    case 'prs':
      return (
        <PRView prs={data.PRS || []} onOpen={openExternal}
          needsMeCriteria={needsMeCriteria} setNeedsMeCriteria={setNeedsMeCriteria} />
      )
    case 'builds':
      return (
        <BuildsView builds={data.BUILDS || []}
          acknowledgedBuilds={acknowledgedBuilds} setAcknowledgedBuilds={setAcknowledgedBuilds} />
      )
    case 'tests':
      return (
        <TestsView tests={data.TESTS || []}
          acknowledgedTests={acknowledgedTests} setAcknowledgedTests={setAcknowledgedTests} />
      )
    case 'team':
      return (
        <TeamView team={data.TEAM || []} workItems={data.WORK_ITEMS || []} prs={data.PRS || []}
          onOpenItem={openExternal} onOpenPerson={() => {}} />
      )
    case 'triage':
      return <TriageView />
    case 'settings':
      return <DesktopSettings />
    default:
      return <Placeholder label={(NAV.find(n => n.id === view) || NAV[0]).label} />
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

function App() {
  const [view, setView] = React.useState('dashboard')
  const active = NAV.find(n => n.id === view) || NAV[0]
  const snapshot = useNexusSnapshot()

  const nexusDataValue = React.useMemo(() => ({
    data:          snapshot,
    api:           { load: refreshAdoData },
    storage:       window.localStorage,
    getProfileKey,
    pushPref:      () => {},
  }), [snapshot])

  return (
    <NexusDataProvider value={nexusDataValue}>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <aside style={{
          width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--surface, transparent)',
        }}>
          <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
            <Icon name="dashboard" size={18} />
            <strong style={{ fontSize: 14 }}>NexusMD</strong>
          </div>
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: view === item.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
                color: view === item.id ? 'var(--accent)' : 'var(--text-muted)',
                font: 'inherit', fontSize: 13,
              }}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <header className="topbar" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 10px 18px',
            borderBottom: '1px solid var(--border)',
          }}>
            <Icon name={active.icon} size={16} />
            <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
            <WindowControls />
          </header>
          <section style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <ViewBody view={view} />
          </section>
        </main>
      </div>
      <ToastHost />
    </NexusDataProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ProfileProvider>
      <App />
    </ProfileProvider>
  </React.StrictMode>
)

startDesktopAutoSync()
