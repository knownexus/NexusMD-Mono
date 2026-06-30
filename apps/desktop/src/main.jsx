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
  DashboardView, WorkItemsView, TriageView, PlannerView, MarkdownViewer,
  VsProfiles, BackupRestoreCard, CloudSyncCard, OAuthCard,
  PlFld, VsCard, VsRow,
} from '@nexusmd/ui'
import { ProfileProvider, useProfile, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopFileIO } from './file-io.js'
import { desktopCloudProviders } from './cloud-auth.js'
import { desktopSync, startDesktopAutoSync } from './sync.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { createAdoHttpAdapter, getAdoConfig, saveAdoConfig, isAdoConfigured, adoGet } from './ado-client.js'
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
  { id: 'markdown',  label: 'Markdown',       icon: 'document' },
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

// ─── Settings modal (reads/writes localStorage via ado-client.js) ─────────────
function SettingsModal({ open, onClose, onSaved }) {
  const [org, setOrg]         = React.useState('');
  const [pat, setPat]         = React.useState('');
  const [projects, setProjects] = React.useState('');
  const [interval, setInterval] = React.useState(30);
  const [testProject, setTestProject] = React.useState('');
  const [uatProject, setUatProject] = React.useState('');
  const [uatPipelineId, setUatPipelineId] = React.useState('');
  const [uatBranch, setUatBranch] = React.useState('');
  const [status, setStatus]   = React.useState('');
  const [saving, setSaving]   = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const c = getAdoConfig();
    setOrg(c.org || '');
    setPat('');
    setProjects((c.projects || []).join(', '));
    setInterval(c.refreshSecs || 30);
    setTestProject(c.testProject || '');
    setUatProject(c.uatProject || '');
    setUatPipelineId(c.uatPipelineId || '');
    setUatBranch(c.uatBranch || '');
    setStatus('');
  }, [open]);

  const save = async () => {
    setSaving(true); setStatus('Saving…');
    try {
      const projectList = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean);
      saveAdoConfig({
        org:           org.trim(),
        ...(pat.trim() ? { pat: pat.trim() } : {}),
        projects:      projectList,
        refreshSecs:   parseInt(interval, 10) || 30,
        testProject:   testProject.trim(),
        uatProject:    uatProject.trim(),
        uatPipelineId: parseInt(uatPipelineId, 10) || 0,
        uatBranch:     uatBranch.trim(),
      });
      setStatus('Saved! Reloading data…');
      setPat('');
      onSaved?.();
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const discoverProjects = async () => {
    const currentOrg = org.trim();
    const currentPat = pat.trim() || getAdoConfig().pat;
    if (!currentOrg || !currentPat) { setStatus('Enter org and PAT first.'); return; }
    setDiscovering(true);
    try {
      // Temporarily save org+pat so adoGet can use them
      saveAdoConfig({ org: currentOrg, pat: currentPat });
      const j = await adoGet('_apis/projects?api-version=7.0');
      const names = (j.value || []).map(p => p.name).filter(Boolean);
      if (!names.length) { setStatus('No projects returned.'); setDiscovering(false); return; }
      setProjects(names.join(', '));
      setStatus(`Discovered ${names.length} projects.`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally {
      setDiscovering(false);
    }
  };

  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 720, maxWidth: '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>
            Azure DevOps Settings
          </h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <PlFld label="Azure DevOps Organisation" hint="The name in dev.azure.com/{org}">
            <input value={org} onChange={e => setOrg(e.target.value)} placeholder="e.g. MyOrg" />
          </PlFld>

          <PlFld label="Personal Access Token (PAT)" hint="Requires 'Work Items (Read/Write)', 'Code (Read)', 'Build (Read/Execute)'">
            <input type="password" value={pat} onChange={e => setPat(e.target.value)} placeholder={getAdoConfig().pat ? '•••••••• (leave blank to keep)' : 'Paste token here'} />
          </PlFld>

          <PlFld label="Projects" hint="Comma-separated list of project names to monitor">
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={projects} onChange={e => setProjects(e.target.value)} placeholder="Project1, Project2" style={{ flex: 1 }} />
              <button className="btn sm ghost" onClick={discoverProjects} disabled={discovering}>
                {discovering ? '…' : 'Discover'}
              </button>
            </div>
          </PlFld>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <PlFld label="Test Project" hint="Used for showing recent test results">
              <input value={testProject} onChange={e => setTestProject(e.target.value)} placeholder="e.g. DriveFurther.API" />
            </PlFld>
            <PlFld label="Refresh Interval" hint="How often to pull updates (seconds)">
              <input type="number" value={interval} onChange={e => setInterval(e.target.value)} />
            </PlFld>
          </div>

          <div style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Release Pipelines (UAT)</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <PlFld label="UAT Project" hint="Project containing the UAT pipeline">
                <input value={uatProject} onChange={e => setUatProject(e.target.value)} placeholder="e.g. DriveFurther.API" />
              </PlFld>
              <PlFld label="Pipeline ID" hint="The 'definitionId' from the pipeline URL">
                <input type="number" value={uatPipelineId} onChange={e => setUatPipelineId(e.target.value)} placeholder="e.g. 123" />
              </PlFld>
            </div>
            <PlFld label="Default Branch" hint="Branch to deploy by default (e.g. refs/heads/master)">
              <input value={uatBranch} onChange={e => setUatBranch(e.target.value)} placeholder="refs/heads/master" />
            </PlFld>
          </div>

          {status && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: status.startsWith('Error') ? 'var(--err-soft, #fee)' : 'var(--accent-soft, #eef)',
              color: status.startsWith('Error') ? 'var(--err, #c00)' : 'var(--accent)',
            }}>
              {status}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 12, flexShrink: 0 }}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || !org || !projects}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Settings — profile registry (create / switch / edit / delete) plus encrypted
// backup & restore. Both are driven by the shared ProfileProvider.
function DesktopSettings({ onOpenConnection }) {
  const profileApi = useProfile()
  const [googleClientId, setGoogleClientId] = React.useState('');
  const [googleClientSecret, setGoogleClientSecret] = React.useState('');
  const [msClientId, setMsClientId] = React.useState('');
  const [savingOAuth, setSavingOAuth] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI.getOAuthConfig().then(cfg => {
      setGoogleClientId(cfg.googleClientId || '');
      setGoogleClientSecret(cfg.googleClientSecret || '');
      setMsClientId(cfg.msClientId || '');
    });
  }, []);

  const saveOAuth = async () => {
    setSavingOAuth(true);
    try {
      await window.electronAPI.setOAuthConfig({ googleClientId, googleClientSecret, msClientId });
      // @ts-ignore
      window.toast?.('OAuth configuration saved.', 'success');
    } catch (e) {
      // @ts-ignore
      window.toast?.('Failed to save OAuth config: ' + e.message, 'error');
    } finally {
      setSavingOAuth(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <VsProfiles profileApi={profileApi} />
      <VsCard title="Azure DevOps Connection" icon="inbox">
        <VsRow title="Connection settings" desc="Org, PAT, projects, and refresh interval">
          <button className="btn sm ghost" onClick={onOpenConnection}>Manage connection</button>
        </VsRow>
      </VsCard>
      <OAuthCard
        googleClientId={googleClientId}
        googleClientSecret={googleClientSecret}
        msClientId={msClientId}
        onChangeGoogle={setGoogleClientId}
        onChangeGoogleSecret={setGoogleClientSecret}
        onChangeMs={setMsClientId}
        onSave={saveOAuth}
        saving={savingOAuth}
      />
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
      <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
    </div>
  )
}

// The view body — reads the snapshot from context and wires per-view host state.
function ViewBody({ view, onOpenConnection }) {
  const { data, setPlannerData, setThemes } = useNexusData()
  const configured = (() => { try { return isAdoConfigured() } catch { return false } })()
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
          onOpenItem={openExternal} onOpenPerson={() => {}}
          onTeamChange={(newTeam) => {
            // Desktop local team storage
            const k = getProfileKey('ado.team')
            localStorage.setItem(k, JSON.stringify(newTeam))
            core._emit?.('data:updated')
          }}
        />
      )
    case 'triage':
      return <TriageView />
    case 'planner':
      return <PlannerView data={data.PLANNER || {}} setData={setPlannerData} themes={data.THEMES || {}} setThemes={setThemes}
               onPushPref={(k, v) => {
                 // Forward to sync if it's a planner week key
                 if (k.startsWith('nexusmd.planner.w') || k.startsWith('helm.planner.w')) {
                    desktopSync.push?.(k, v)
                 }
               }} />
    case 'markdown':
      return <MarkdownViewer />
    case 'settings':
      return <DesktopSettings onOpenConnection={onOpenConnection} />
    default:
      return <Placeholder label={(NAV.find(n => n.id === view) || NAV[0]).label} />
  }
}

// Custom window controls for the frameless window. Sits at the right edge of the
// draggable .topbar; the injected CSS marks these buttons no-drag so they click.
function WindowControls() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.windowClose) return null
  const btn = (onClick, label, glyph, danger) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 30, height: 26, display: 'grid', placeItems: 'center',
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, borderRadius: 6,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? 'var(--danger, #e5484d)' : 'var(--accent-soft, rgba(127,127,127,0.15))'; if (danger) e.currentTarget.style.color = '#fff' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
    >{glyph}</button>
  )
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
      {btn(() => api.windowMinimize?.(), 'Minimize', '−')}
      {btn(() => api.windowToggleMaximize?.(), 'Maximize', '☐')}
      {btn(() => api.windowClose?.(), 'Close', '✕', true)}
    </div>
  )
}

function App() {
  const [view, setView] = React.useState('dashboard')
  const [plannerData, setPlannerData] = React.useState({})
  const [themes, setThemes] = React.useState({})
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const active = NAV.find(n => n.id === view) || NAV[0]
  const snapshot = useNexusSnapshot()

  const nexusDataValue = React.useMemo(() => ({
    data:          { ...snapshot, PLANNER: plannerData, THEMES: themes },
    api:           { load: refreshAdoData },
    storage:       window.localStorage,
    getProfileKey,
    pushPref:      () => {},
    setPlannerData,
    setThemes,
  }), [snapshot, plannerData, themes])

  return (
    <NexusDataProvider value={nexusDataValue}>
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
            <WindowControls />
          </header>
          <section style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <ViewBody view={view} onOpenConnection={() => setSettingsOpen(true)} />
          </section>
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={refreshAdoData} />
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
