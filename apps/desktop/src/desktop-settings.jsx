import React from 'react'
import {
  Icon,
  VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker,
  VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView,
  PlToggle,
  toast,
} from '@nexusmd/ui'
import { graphJSON } from '@nexusmd/core'
import { appPrefsAdapter } from './adapters/appPrefs.js'
import { useProfile } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { NavOrderEditor } from './nav-order-editor.jsx'
import { ZoomSlider } from './zoom-slider.jsx'
import { desktopFileIO } from './file-io.js'
import LogsCard from './logs-card.jsx'
import { SettingsFileCard } from './settings-file-card.jsx'
import { AppsCard } from './apps-card.jsx'
import { desktopCloudProviders, makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken, decodeJwtClaims } from './cloud-auth.js'
import { desktopSync } from './sync.js'
import { moduleSettingsCards, modulePanels } from './shell/modules.js'
import { registry } from './shell/registry.js'
import { host } from './shell/host.js'
import { pickerAdapter } from './adapters/picker.js'

const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
  color: 'var(--text)', boxSizing: 'border-box',
}

export function DesktopProfileCard() {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const savePref = (key, val) => { try { localStorage.setItem(pk(key), val) } catch {} }

  const [displayName, setDisplayName] = React.useState(() => readPref('nexusmd.profile.displayName', ''))
  const [role, setRole]               = React.useState(() => readPref('nexusmd.profile.role', 'Engineering Manager'))
  const [team, setTeam]               = React.useState(() => readPref('nexusmd.profile.team', ''))
  const [tz, setTz]                   = React.useState(() => readPref('nexusmd.profile.timeZone', (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } })()))

  const inp = { width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }

  return (
    <VsCard title="Profile" icon="more">
      <VsRow title="Display name" desc="How your name appears in the app">
        <input value={displayName} style={inp}
          onChange={e => { setDisplayName(e.target.value); savePref('nexusmd.profile.displayName', e.target.value) }} />
      </VsRow>
      <VsRow title="Role" desc="Your role or job title">
        <input value={role} style={inp}
          onChange={e => { setRole(e.target.value); savePref('nexusmd.profile.role', e.target.value) }} />
      </VsRow>
      <VsRow title="Team" desc="Your team name">
        <input value={team} style={inp}
          onChange={e => { setTeam(e.target.value); savePref('nexusmd.profile.team', e.target.value) }} />
      </VsRow>
      <VsRow title="Timezone" desc="Used for calendar and scheduling">
        <input value={tz} style={inp}
          onChange={e => { setTz(e.target.value); savePref('nexusmd.profile.timeZone', e.target.value) }} />
      </VsRow>
    </VsCard>
  )
}

export function DesktopAppCard() {
  const [loginItem, setLoginItem] = React.useState(false)
  const [closeToTray, setCloseToTray] = React.useState(true)
  const [outputPath, setOutputPath] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.outputPath') || '' } catch { return '' }
  })

  React.useEffect(() => {
    if (!appPrefsAdapter.isAvailable()) return
    Promise.resolve(appPrefsAdapter.getLoginItemEnabled()).then(v => { if (typeof v === 'boolean') setLoginItem(v) }).catch(() => {})
    Promise.resolve(appPrefsAdapter.getCloseToTray()).then(v => { if (typeof v === 'boolean') setCloseToTray(v) }).catch(() => {})
  }, [])

  if (!appPrefsAdapter.isAvailable()) return null

  const pickFolder = async () => {
    const picked = await appPrefsAdapter.pickOutputFolder()
    if (!picked) return
    setOutputPath(picked)
    try { localStorage.setItem('nexusmd.outputPath', picked) } catch {}
  }

  const clearFolder = () => {
    setOutputPath('')
    try { localStorage.removeItem('nexusmd.outputPath') } catch {}
  }

  return (
    <VsCard title="Desktop app" icon="dashboard">
      <VsRow title="Start NexusMD when I sign in to Windows" desc="Launch NexusMD automatically when you sign in">
        <PlToggle checked={loginItem} onChange={v => {
          setLoginItem(v)
          Promise.resolve(appPrefsAdapter.setLoginItemEnabled(v)).catch(() => {})
        }} />
      </VsRow>
      <VsRow title="Close to tray" desc="Minimise to the system tray instead of quitting when the window is closed">
        <PlToggle checked={closeToTray} onChange={v => {
          setCloseToTray(v)
          Promise.resolve(appPrefsAdapter.setCloseToTray(v)).catch(() => {})
        }} />
      </VsRow>
      <VsRow title="Output folder" desc={outputPath || 'Default download location'}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={pickFolder}>Change…</button>
          {outputPath && (
            <button className="btn sm ghost danger" onClick={clearFolder}>Clear</button>
          )}
        </div>
      </VsRow>
    </VsCard>
  )
}

export function DesktopDataSyncCard() {
  const [kbUsed, setKbUsed] = React.useState(0)

  React.useEffect(() => {
    try {
      let bytes = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        bytes += (localStorage.getItem(k) || '').length * 2
      }
      setKbUsed(Math.round(bytes / 1024))
    } catch {}
  }, [])

  const clearLocal = () => {
    if (!window.confirm('Clear all local NexusMD data? This cannot be undone.')) return
    try {
      const toRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('nexusmd.')) toRemove.push(k)
      }
      toRemove.forEach(k => localStorage.removeItem(k))
      window.location.reload()
    } catch {}
  }

  return (
    <VsCard title="Data & sync" icon="dashboard">
      <VsRow title="Local storage used" desc="Approximate size of all NexusMD data in this profile">
        <span style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>{kbUsed} KB</span>
      </VsRow>
      {/* Rows the installed apps add: Work's refresh interval and cache. */}
      {modulePanels('data-sync').map(({ id, Panel }) => <Panel key={id} host={host} />)}
      <VsRow title="Clear local data" desc="Remove all locally stored NexusMD data and reload">
        <button className="btn sm ghost danger" onClick={clearLocal}>Clear data…</button>
      </VsRow>
    </VsCard>
  )
}

function DesktopGitHubPATRow() {
  const [pat, setPat] = React.useState(() => {
    try { return localStorage.getItem(getProfileKey('nexusmd.github.pat')) || '' } catch { return '' }
  })
  const [valid, setValid] = React.useState(true)
  const validate = (v) => /^gh[ps]_/.test(v) || /^github_pat_/.test(v) || v === ''

  const save = () => {
    if (!validate(pat)) { setValid(false); return }
    setValid(true)
    try { localStorage.setItem(getProfileKey('nexusmd.github.pat'), pat) } catch {}
  }

  return (
    <VsRow title="Personal access token" desc="Alternative to OAuth — must start with ghp_, ghs_, or github_pat_">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="password"
          value={pat}
          style={{ width: 260, padding: '5px 10px', borderRadius: 8, border: `1px solid ${valid ? 'var(--border)' : 'var(--danger)'}`, background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
          onChange={e => { setPat(e.target.value); setValid(true) }}
          placeholder="ghp_…"
        />
        <button className="btn sm" onClick={save}>Save</button>
        {pat && <button className="btn sm ghost danger" onClick={() => { setPat(''); try { localStorage.removeItem(getProfileKey('nexusmd.github.pat')) } catch {} }}>Clear</button>}
      </div>
      {!valid && <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'block' }}>Invalid PAT format</span>}
    </VsRow>
  )
}

// Read-only presets exercising scopes the Microsoft connection already has
// (User.Read / Calendars.ReadWrite / Files.ReadWrite) — no new consent needed.
const GRAPH_TEST_PRESETS = [
  {
    id: 'me',
    label: 'My profile',
    help: 'Lowest-permission call — confirms the Microsoft connection works at all.',
    path: '/me',
  },
  {
    id: 'calendar',
    label: 'Calendar (next 7 days)',
    help: 'Same call the Outlook Calendar view uses.',
    path: () => {
      const start = new Date()
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
      return [
        '/me/calendarView',
        `?startDateTime=${encodeURIComponent(start.toISOString())}`,
        `&endDateTime=${encodeURIComponent(end.toISOString())}`,
        '&$select=id,subject,start,end',
        '&$top=10',
      ].join('')
    },
  },
  {
    id: 'onedrive',
    label: 'OneDrive: NexusMD folder',
    help: 'Same call the OneDrive cloud-sync provider uses to list backups.',
    path: '/me/drive/root:/NexusMD:/children?$select=id,name,lastModifiedDateTime',
  },
]

// Maps each Graph scope the desktop app actually requests (see
// apps/desktop/electron/oauth/config.cjs) to the GRAPH_TEST_PRESETS entry
// that exercises it. offline_access is excluded — it isn't a resource scope
// and has no corresponding Graph call to probe.
const GRAPH_SCOPE_CHECKS = [
  { scope: 'User.Read', label: 'Sign-in / profile', presetId: 'me' },
  { scope: 'Calendars.ReadWrite', label: 'Calendar', presetId: 'calendar' },
  { scope: 'Files.ReadWrite', label: 'OneDrive', presetId: 'onedrive' },
]

// Cross-references the token's granted scopes (from decodeJwtClaims) against
// a live call to each resource, so a 403 can be attributed to "scope never
// granted" vs. "scope granted but still forbidden" (admin consent, licensing,
// conditional access, etc).
function GraphPermissionsCard() {
  const { getToken } = React.useMemo(() => makeNativeMicrosoftBinding(), [])
  const { results, run } = useGraphPresetRunner(getToken)
  const [grantedScopes, setGrantedScopes] = React.useState(null) // null = not checked yet
  const [refreshing, setRefreshing] = React.useState(false)

  const diagnose = React.useCallback(async () => {
    setRefreshing(true)
    try {
      try {
        const token = await getToken()
        const claims = token ? decodeJwtClaims(token) : null
        setGrantedScopes(claims?.scp ? claims.scp.split(' ') : [])
      } catch {
        setGrantedScopes([])
      }
      await Promise.all(GRAPH_TEST_PRESETS.map(p => run(p)))
    } finally {
      setRefreshing(false)
    }
  }, [getToken])

  React.useEffect(() => { diagnose() }, [diagnose])

  return (
    <VsCard title="Permissions" icon="lock">
      <VsRow title="Diagnosis" desc="Checks the granted token scopes against a live call to each resource">
        <button className="btn sm ghost" onClick={diagnose} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </VsRow>
      {GRAPH_SCOPE_CHECKS.map(({ scope, label, presetId }) => {
        const granted = grantedScopes?.includes(scope)
        const live = results[presetId]
        const liveStatus = live?.loading ? 'Checking…' : live?.error ? 'Failed' : live?.data ? 'OK' : '—'
        return (
          <VsFullRow key={scope} title={label} desc={scope}>
            <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
              <span>Granted in token: <b style={{ color: granted ? 'var(--success)' : 'var(--danger)' }}>{grantedScopes === null ? '—' : granted ? 'Yes' : 'No'}</b></span>
              <span>Live check: <b style={{ color: liveStatus === 'OK' ? 'var(--success)' : liveStatus === 'Failed' ? 'var(--danger)' : 'var(--text-muted)' }}>{liveStatus}</b></span>
            </div>
            {live?.error && <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--danger)' }}>{live.error}</div>}
          </VsFullRow>
        )
      })}
    </VsCard>
  )
}

// Lets you paste a Microsoft Graph access token directly (e.g. from
// `az account get-access-token --resource https://graph.microsoft.com` or Graph
// Explorer) when the interactive Entra sign-in is blocked. The token is stored
// in the same slot the OAuth flow uses, so the Graph features below work with it.
function GraphManualTokenCard() {
  const [token, setToken] = React.useState('')

  const save = () => {
    if (!token.trim()) return
    setManualMicrosoftToken(token)
    setToken('')
    toast?.('Microsoft Graph token saved.', 'success')
  }

  return (
    <VsCard title="Paste Microsoft Graph token" icon="lock">
      <VsFullRow
        title="Access token"
        desc="Bypass Entra sign-in for testing. Get one via `az account get-access-token --resource https://graph.microsoft.com` or Graph Explorer. Expires when the token does; no auto-refresh."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="eyJ0eXAiOiJKV1Qi…"
            rows={3}
            style={{ ...settInputStyle, fontFamily: 'var(--mono)', fontSize: 11.5, resize: 'vertical' }}
          />
          <button className="btn sm" onClick={save} disabled={!token.trim()}>Save</button>
        </div>
      </VsFullRow>
    </VsCard>
  )
}

function useGraphPresetRunner(getToken) {
  const [results, setResults] = React.useState({})
  const run = async (preset) => {
    setResults(r => ({ ...r, [preset.id]: { loading: true } }))
    try {
      const path = typeof preset.path === 'function' ? preset.path() : preset.path
      const data = await graphJSON(getToken, path)
      setResults(r => ({ ...r, [preset.id]: { data } }))
    } catch (e) {
      setResults(r => ({ ...r, [preset.id]: { error: e.message || 'Request failed' } }))
    }
  }
  return { results, run }
}

function GraphApiTestCard() {
  const { getToken } = React.useMemo(() => makeNativeMicrosoftBinding(), [])
  const { results, run } = useGraphPresetRunner(getToken)

  return (
    <VsCard title="Graph API Test" icon="build">
      {GRAPH_TEST_PRESETS.map(preset => {
        const result = results[preset.id]
        return (
          <VsFullRow key={preset.id} title={preset.label} desc={preset.help}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn sm" onClick={() => run(preset)} disabled={result?.loading}>
                <Icon name="play" size={11} /> {result?.loading ? 'Running…' : 'Run'}
              </button>
            </div>
            {result && !result.loading && (
              <pre style={{
                marginTop: 8, padding: '8px 10px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', maxHeight: 240,
                color: result.error ? 'var(--danger)' : 'var(--text)',
              }}>
                {result.error || JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </VsFullRow>
        )
      })}
    </VsCard>
  )
}

export function IntegrationsPanel() {
  const [ghRepos, setGhRepos] = React.useState(() => {
    try { return localStorage.getItem(getProfileKey('nexusmd.github.repos')) || '' } catch { return '' }
  })

  const saveGhRepos = () => {
    try { localStorage.setItem(getProfileKey('nexusmd.github.repos'), ghRepos) } catch {}
  }

  const oauthServices = React.useMemo(() => [
    {
      id: 'google',
      label: 'Google',
      icon: 'calendar',
      desc: 'Google Calendar, Gmail, and Drive',
      ...makeNativeGoogleBinding(),
    },
    {
      id: 'microsoft',
      label: 'Microsoft / Entra ID',
      icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeNativeMicrosoftBinding(),
    },
  ], [])

  return (
    <div style={{ padding: '24px 0' }}>
      <IntegrationsView services={oauthServices} />
      <GraphManualTokenCard />
      <GraphPermissionsCard />
      <GraphApiTestCard />
      <VsCard title="GitHub" icon="pr">
        <DesktopGitHubPATRow />
        <VsRow title="Repositories" desc="owner/repo pairs, comma-separated">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={ghRepos}
              onChange={e => setGhRepos(e.target.value)}
              placeholder="myorg/backend, myorg/frontend"
              style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
            />
            <button className="btn sm" onClick={saveGhRepos}>Save</button>
          </div>
        </VsRow>
      </VsCard>
    </div>
  )
}

const SETTINGS_TABS = [
  { id: 'profile',      label: 'Profile',      icon: 'team'      },
  { id: 'appearance',   label: 'Appearance',   icon: 'sun'       },
  { id: 'planner',      label: 'Planner',      icon: 'planner'   },
  { id: 'cards',        label: 'Cards & Tables', icon: 'board'   },
  { id: 'profiles',     label: 'Profiles',     icon: 'more'      },
  { id: 'confidential', label: 'Confidential', icon: 'lock'      },
  { id: 'data',         label: 'Data & sync',  icon: 'inbox'     },
  { id: 'integrations', label: 'Integrations', icon: 'lock'      },
  { id: 'desktop',      label: 'Desktop',      icon: 'dashboard' },
]

// A tab shows only when it has something to hold: 'planner' needs the Planner or Work apps (its board
// columns are Work's), 'cards' is Work's, 'confidential' is the Planner's.
const TAB_NEEDS = { planner: ['planner', 'work'], cards: ['work'], confidential: ['planner'] }
export const visibleSettingsTabs = (reg = registry) =>
  SETTINGS_TABS.filter(t => !TAB_NEEDS[t.id] || TAB_NEEDS[t.id].some(id => reg.isInstalled(id)))

export function DesktopSettings({ tweaks, setTweak, nav, defaultNavOrder }) {
  const profileApi = useProfile()
  const [tab, setTab] = React.useState('profile')

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <nav style={{
        width: 160, flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: 2,
        padding: '16px 8px',
        borderRight: '1px solid var(--border)',
      }}>
        {visibleSettingsTabs().map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', borderRadius: 6, border: 'none',
              background: tab === t.id ? 'var(--accent-soft)' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text)',
              cursor: 'pointer', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              textAlign: 'left', width: '100%',
            }}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>

          {tab === 'profile' && (
            <>
              <DesktopProfileCard />
              <VsCard title="Project areas" icon="work">
                <VsRow title="Manage areas" desc="Define project area categories used in triage and work-item classification">
                  <button className="btn sm ghost" onClick={() => window.dispatchEvent(new CustomEvent('nexusmd:openProjectAreas'))}>Open editor</button>
                </VsRow>
              </VsCard>
            </>
          )}

          {tab === 'appearance' && (
            <VsCard title="Appearance" icon="sun">
              <VsRow title="Mode" desc="Toggle between your assigned light and dark themes">
                <VsSeg value={tweaks.theme}
                  options={[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]}
                  onChange={v => setTweak('theme', v)} />
              </VsRow>
              <VsFullRow title="Light mode theme" desc="Palette used when light mode is active">
                <ThemeChipPicker value={tweaks.lightTheme || 'parchment'} onChange={v => setTweak('lightTheme', v)} />
              </VsFullRow>
              <VsFullRow title="Dark mode theme" desc="Palette used when dark mode is active">
                <ThemeChipPicker value={tweaks.darkTheme || 'cobalt'} onChange={v => setTweak('darkTheme', v)} />
              </VsFullRow>
              <VsRow title="Zoom" desc="Scale the entire app interface">
                <ZoomSlider />
              </VsRow>
              {nav && (
                <VsFullRow title="Sidebar" desc="Drag to reorder the navigation sidebar; untick an entry to hide it">
                  <NavOrderEditor nav={nav} order={tweaks.navOrder}
                    onChange={ids => setTweak('navOrder', ids)}
                    hidden={tweaks.navHidden || []} onHiddenChange={ids => setTweak('navHidden', ids)} />
                  <button className="btn sm ghost"
                    onClick={() => { setTweak('navOrder', defaultNavOrder); setTweak('navHidden', []) }}>Reset sidebar</button>
                </VsFullRow>
              )}
            </VsCard>
          )}

          {tab === 'planner' && (
            <>
              {modulePanels('planner').map(({ id, Panel }) => <Panel key={id} host={host} />)}
            </>
          )}

          {tab === 'cards' && modulePanels('cards').map(({ id, Panel }) => <Panel key={id} host={host} tweaks={tweaks} setTweak={setTweak} />)}

          {tab === 'profiles' && (
            <>
              <VsProfiles profileApi={profileApi} />
              <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
              <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
            </>
          )}

          {tab === 'confidential' && modulePanels('confidential').map(({ id, Panel }) => <Panel key={id} host={host} />)}

          {tab === 'data' && (
            <>
              <DesktopDataSyncCard />
              <SettingsFileCard />
              <LogsCard />
            </>
          )}

          {tab === 'integrations' && (
            <>
              {modulePanels('integrations').map(({ id, Panel }) => <Panel key={id} host={host} />)}
              <IntegrationsPanel />
            </>
          )}

          {tab === 'desktop' && (
            <>
              <DesktopAppCard />
              <AppsCard />
              {moduleSettingsCards().map(({ id, Card }) => <Card key={id} picker={pickerAdapter} />)}
            </>
          )}

        </div>
      </div>
    </div>
  )
}
