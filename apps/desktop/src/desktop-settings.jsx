import React from 'react'
import {
  Icon, CardFrame,
  VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker, BoardColumnsCard,
  VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView,
  PlToggle, VsPasswordModal, loadConfidentialConfig,
} from '@nexusmd/ui'
import { useProfile } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { NavOrderEditor } from './nav-order-editor.jsx'
import { ZoomSlider } from './zoom-slider.jsx'
import { desktopFileIO } from './file-io.js'
import LogsCard from './logs-card.jsx'
import { desktopCloudProviders, makeNativeGoogleBinding, makeNativeMicrosoftBinding } from './cloud-auth.js'
import { desktopSync } from './sync.js'
import { getAdoConfig, saveAdoConfig, createAdoHttpAdapter } from './ado-client.js'

export const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
  color: 'var(--text)', boxSizing: 'border-box',
}

export function SettField({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{hint}</span>}
    </div>
  )
}

export function AdoConnectionCard({ onRefreshData }) {
  const [org, setOrg]           = React.useState('')
  const [pat, setPat]           = React.useState('')
  const [projects, setProjects] = React.useState('')
  const [status, setStatus]     = React.useState('')
  const [saving, setSaving]     = React.useState(false)
  const [discovering, setDiscovering] = React.useState(false)

  React.useEffect(() => {
    const c = getAdoConfig()
    setOrg(c.org || '')
    setProjects((c.projects || []).join(', '))
  }, [])

  const save = async () => {
    setSaving(true)
    setStatus('Saving…')
    try {
      const projectList = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean)
      saveAdoConfig({
        org: org.trim(),
        ...(pat.trim() ? { pat: pat.trim() } : {}),
        projects: projectList,
      })
      setStatus('Saved! Loading data…')
      setPat('')
      onRefreshData?.().catch(() => {})
      setTimeout(() => setStatus(''), 3000)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const discoverProjects = async () => {
    const currentOrg = org.trim()
    const currentPat = pat.trim() || getAdoConfig().pat
    if (!currentOrg || !currentPat) { setStatus('Enter org and PAT first.'); return }
    setDiscovering(true)
    setStatus('Discovering…')
    try {
      saveAdoConfig({ org: currentOrg, pat: currentPat })
      const adapter = createAdoHttpAdapter()
      const res = await adapter.fetch('_apis/projects?api-version=7.0')
      const j   = await res.json()
      const names = (j.value || []).map(p => p.name).filter(Boolean)
      if (!names.length) { setStatus('No projects returned.'); return }
      setProjects(names.join(', '))
      setStatus(`Discovered ${names.length} project${names.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setDiscovering(false)
    }
  }

  const isError = status.startsWith('Error')

  return (
    <CardFrame title="Azure DevOps Connection" icon={<Icon name="settings" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SettField label="Organisation" hint="The subdomain from dev.azure.com/your-org">
          <input value={org} onChange={e => setOrg(e.target.value)}
            placeholder="your-org-name" style={settInputStyle} />
        </SettField>
        <SettField label="Personal Access Token" hint="Needs Work Items, Code, and Build (Read) scopes. Leave blank to keep existing.">
          <input type="password" value={pat} onChange={e => setPat(e.target.value)}
            placeholder="Leave blank to keep existing PAT" style={settInputStyle} />
        </SettField>
        <SettField label="Projects" hint="Comma-separated project names.">
          <textarea value={projects} onChange={e => setProjects(e.target.value)}
            placeholder="Project1, Project2" rows={2}
            style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
        </SettField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={discoverProjects} disabled={discovering || saving}>
            {discovering ? 'Discovering…' : 'Discover projects'}
          </button>
          <button className="btn primary" onClick={save} disabled={saving || discovering}>
            {saving ? 'Saving…' : 'Save & connect'}
          </button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </CardFrame>
  )
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

export function DesktopPlannerPrefsCard() {
  const pk = k => { try { return getProfileKey(k) } catch { return k } }
  const readPref = (key, def) => { try { return localStorage.getItem(pk(key)) || def } catch { return def } }
  const savePref = (key, val) => { try { localStorage.setItem(pk(key), val) } catch {} }

  const [landing, setLanding] = React.useState(() => readPref('nexusmd.planner.landing', 'glance'))
  const [nav,     setNav]     = React.useState(() => readPref('nexusmd.planner.nav', 'rail'))
  const [entry,   setEntry]   = React.useState(() => readPref('nexusmd.planner.entry', 'inline'))
  const [carry,   setCarry]   = React.useState(() => readPref('nexusmd.planner.carryPrompt', '1'))

  return (
    <VsCard title="Planner" icon="planner">
      <VsRow title="Landing view" desc="First view when opening the Planner">
        <VsSeg value={landing}
          options={[['glance','Glance'],['week','Week'],['month','Month']]}
          onChange={v => { setLanding(v); savePref('nexusmd.planner.landing', v) }} />
      </VsRow>
      <VsRow title="Navigation style" desc="How the planner nav is displayed">
        <VsSeg value={nav}
          options={[['rail','Rail'],['tabs','Tabs']]}
          onChange={v => { setNav(v); savePref('nexusmd.planner.nav', v) }} />
      </VsRow>
      <VsRow title="Entry style" desc="How new planner entries are created">
        <VsSeg value={entry}
          options={[['inline','Inline'],['modal','Modal']]}
          onChange={v => { setEntry(v); savePref('nexusmd.planner.entry', v) }} />
      </VsRow>
      <VsRow title="Carry-over prompt" desc="Prompt to carry unfinished tasks forward each week">
        <PlToggle checked={carry === '1'}
          onChange={v => { const s = v ? '1' : '0'; setCarry(s); savePref('nexusmd.planner.carryPrompt', s) }} />
      </VsRow>
    </VsCard>
  )
}

export function DesktopConfidentialCard() {
  const [pwOpen, setPwOpen] = React.useState(false)
  const [autoRelock, setAutoRelock] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.confidential.autoRelock') || '0' } catch { return '0' }
  })
  const cfg = loadConfidentialConfig() || { sections: [], hash: null }
  const lockedCount = (cfg.sections || []).filter(s => s.locked).length

  return (
    <VsCard title="Confidential" icon="lock">
      <VsRow title="Password" desc={cfg.hash ? 'A password is set for confidential sections' : 'No password set — anyone can view confidential rows'}>
        <button className="btn sm ghost" onClick={() => setPwOpen(true)}>
          {cfg.hash ? 'Change password' : 'Set password'}
        </button>
      </VsRow>
      <VsRow title="Auto re-lock" desc="Re-lock confidential sections when the app loses focus">
        <PlToggle checked={autoRelock === '1'} onChange={v => {
          const s = v ? '1' : '0'; setAutoRelock(s)
          try { localStorage.setItem('nexusmd.confidential.autoRelock', s) } catch {}
        }} />
      </VsRow>
      {lockedCount > 0 && (
        <VsRow title="Locked sections" desc={`${lockedCount} section${lockedCount !== 1 ? 's' : ''} currently locked in the planner`}>
          <span className="pill">{lockedCount}</span>
        </VsRow>
      )}
      <VsPasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </VsCard>
  )
}

export function DesktopAppCard() {
  const [closeToTray, setCloseToTray] = React.useState(true)
  const [outputPath, setOutputPath] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.outputPath') || '' } catch { return '' }
  })

  React.useEffect(() => {
    window.electronAPI?.getCloseToTray?.().then(setCloseToTray).catch(() => {})
  }, [])

  if (!window.electronAPI) return null

  const pickFolder = async () => {
    const picked = await window.electronAPI.pickOutputFolder?.()
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
      <VsRow title="Close to tray" desc="Minimise to the system tray instead of quitting when the window is closed">
        <PlToggle checked={closeToTray} onChange={v => {
          setCloseToTray(v)
          window.electronAPI.setCloseToTray?.(v)?.catch(() => {})
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

export function DesktopQuickLinksCard({ links, onChange }) {
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({ label: '', url: '', color: 'var(--accent)' })

  const open = (idx) => {
    if (idx === 'new') {
      setForm({ label: '', url: '', color: 'var(--accent)' })
    } else {
      setForm({ ...links[idx] })
    }
    setEditing(idx)
  }
  const save = () => {
    if (!form.label || !form.url) return
    if (!/^https?:\/\//i.test(form.url)) return
    const next = editing === 'new'
      ? [...links, form]
      : links.map((l, i) => i === editing ? form : l)
    onChange(next)
    setEditing(null)
  }
  const remove = (idx) => onChange(links.filter((_, i) => i !== idx))

  const inp = { width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }

  return (
    <VsCard title="Quick links" icon="link">
      {links.map((l, i) => (
        <VsRow key={i} title={l.label} desc={l.url}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm ghost" onClick={() => open(i)}>Edit</button>
            <button className="btn sm ghost danger" onClick={() => remove(i)}>Remove</button>
          </div>
        </VsRow>
      ))}
      <div style={{ padding: '8px 16px' }}>
        <button className="btn sm" onClick={() => open('new')}>+ Add link</button>
      </div>
      {editing !== null && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="Label" value={form.label} style={inp} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <input placeholder="URL" value={form.url} style={inp} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <input placeholder="Colour (CSS var or hex)" value={form.color} style={inp} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn sm primary" onClick={save} disabled={!form.label || !form.url}>Save</button>
          </div>
        </div>
      )}
    </VsCard>
  )
}

export function DesktopDataSyncCard({ refreshInterval, onRefreshIntervalChange }) {
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
      <VsRow title="Auto-refresh interval" desc="Seconds between automatic ADO data refreshes (10–3600)">
        <input type="number" min={10} max={3600} step={10}
          value={refreshInterval}
          style={{ width: 80, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
          onChange={e => {
            const v = Math.max(10, Math.min(3600, parseInt(e.target.value, 10) || 300))
            onRefreshIntervalChange(v)
            try { localStorage.setItem('nexusmd.refreshInterval', String(v)) } catch {}
          }}
        />
      </VsRow>
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
  { id: 'profiles',     label: 'Profiles',     icon: 'more'      },
  { id: 'confidential', label: 'Confidential', icon: 'lock'      },
  { id: 'data',         label: 'Data & sync',  icon: 'inbox'     },
  { id: 'integrations', label: 'Integrations', icon: 'lock'      },
  { id: 'desktop',      label: 'Desktop',      icon: 'dashboard' },
]

export function DesktopSettings({ tweaks, setTweak, nav, defaultNavOrder, refreshInterval, onRefreshIntervalChange, onRefreshData }) {
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
        {SETTINGS_TABS.map(t => (
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
                <VsFullRow title="Sidebar order" desc="Drag to reorder the navigation sidebar">
                  <NavOrderEditor nav={nav} order={tweaks.navOrder}
                    onChange={ids => setTweak('navOrder', ids)} />
                  <button className="btn sm ghost"
                    onClick={() => setTweak('navOrder', defaultNavOrder)}>Reset order</button>
                </VsFullRow>
              )}
            </VsCard>
          )}

          {tab === 'planner' && (
            <>
              <DesktopPlannerPrefsCard />
              <BoardColumnsCard />
            </>
          )}

          {tab === 'profiles' && (
            <>
              <VsProfiles profileApi={profileApi} />
              <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
              <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
            </>
          )}

          {tab === 'confidential' && <DesktopConfidentialCard />}

          {tab === 'data' && (
            <>
              <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
              <LogsCard />
            </>
          )}

          {tab === 'integrations' && (
            <>
              <AdoConnectionCard onRefreshData={onRefreshData} />
              <IntegrationsPanel />
            </>
          )}

          {tab === 'desktop' && (
            <>
              <DesktopAppCard />
              <DesktopQuickLinksCard
                links={tweaks.quickLinks || []}
                onChange={links => setTweak('quickLinks', links)}
              />
            </>
          )}

        </div>
      </div>
    </div>
  )
}
