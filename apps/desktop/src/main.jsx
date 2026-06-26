import React from 'react'
import ReactDOM from 'react-dom/client'
import '@nexusmd/ui/styles.css'

import {
  initCore, createNoOpAdapters, core, buildDigest, loadCachedAdoData,
} from '@nexusmd/core'
import { Icon, CardFrame, Stat } from '@nexusmd/ui'
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

// Fire-and-forget: enables modules + inits adapters. The shell reads cached data
// and re-renders on core's 'data:updated' events.
initCore(adapters)

const NAV = [
  { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { id: 'work',      label: 'Work Items',     icon: 'work' },
  { id: 'prs',       label: 'Pull Requests',  icon: 'pr' },
  { id: 'planner',   label: 'Planner',        icon: 'planner' },
  { id: 'settings',  label: 'Settings',       icon: 'settings' },
]

const EMPTY_DIGEST = {
  openCount: 0, blockedCount: 0, criticalCount: 0,
  activePrCount: 0, failedBuildCount: 0, runningBuildCount: 0,
  sprintName: null, sprintVelocity: null, teamMetrics: [],
}

function useDigest() {
  const [digest, setDigest] = React.useState(EMPTY_DIGEST)
  const refresh = React.useCallback(() => {
    try {
      const cached = loadCachedAdoData(getAdoConfig(), { storage: localStorageAdapter })
      setDigest(cached
        ? buildDigest({
            workItems: cached.WORK_ITEMS, prs: cached.PRS, builds: cached.BUILDS,
            team: cached.TEAM, sprint: cached.SPRINT,
          })
        : EMPTY_DIGEST)
    } catch { setDigest(EMPTY_DIGEST) }
  }, [])

  React.useEffect(() => {
    refresh()
    const onData = () => refresh()
    core.on('data:updated', onData)
    return () => core.off('data:updated', onData)
  }, [refresh])

  return digest
}

function Dashboard() {
  const digest = useDigest()
  const configured = (() => { try { return isAdoConfigured() } catch { return false } })()

  if (!configured) {
    return (
      <CardFrame title="Welcome to NexusMD" icon={<Icon name="dashboard" size={16} />}>
        <p style={{ color: 'var(--text-muted)', maxWidth: 520 }}>
          Connect your Azure DevOps organisation in <strong>Settings</strong> to populate your
          dashboard with work items, pull requests, builds and sprint metrics.
        </p>
      </CardFrame>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      <Stat label="Open items"     value={digest.openCount}        icon={<Icon name="work" size={14} />} />
      <Stat label="Blocked"        value={digest.blockedCount}     accent="var(--danger)" />
      <Stat label="Critical"       value={digest.criticalCount}    accent="var(--danger)" />
      <Stat label="Active PRs"     value={digest.activePrCount}    icon={<Icon name="pr" size={14} />} />
      <Stat label="Failed builds"  value={digest.failedBuildCount} accent="var(--danger)" />
      <Stat label="Running builds" value={digest.runningBuildCount} />
      {digest.sprintName && (
        <Stat label="Sprint" value={digest.sprintName} meta={digest.sprintVelocity != null ? `velocity ${digest.sprintVelocity}` : null} />
      )}
    </div>
  )
}

function Placeholder({ label }) {
  return (
    <CardFrame title={label}>
      <p style={{ color: 'var(--text-muted)' }}>
        {label} renders the shared NexusMD view here. The shared views are being promoted into
        <code> @nexusmd/ui</code> so desktop and web render the same UI.
      </p>
    </CardFrame>
  )
}

function App() {
  const [view, setView] = React.useState('dashboard')
  const active = NAV.find(n => n.id === view) || NAV[0]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <aside style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
        background: 'var(--surface, transparent)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
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
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Icon name={active.icon} size={16} />
          <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
        </header>
        <section style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          {view === 'dashboard' ? <Dashboard /> : <Placeholder label={active.label} />}
        </section>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
