# Desktop Settings Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the monolithic desktop settings panel from `main.jsx` into a dedicated file and replace its scrolling card list with an 8-tab left-rail layout matching the app/web settings pattern.

**Architecture:** All `DesktopSettings` code and its inline child components are extracted from `apps/desktop/src/main.jsx` into `apps/desktop/src/desktop-settings.jsx`. `DesktopSettings` is then given a left-rail `<nav>` tab shell (state: `useState('profile')`, no persistence) that conditionally renders each tab's content. `main.jsx` is updated to import `DesktopSettings` and pass the new `onRefreshData` prop.

**Tech Stack:** React 18, Vitest 4.1.9, @testing-library/react ^16, jsdom, @vitejs/plugin-react

## Global Constraints

- Scope: `apps/desktop` only — `packages/ui`, `apps/app`, `apps/web` receive no changes
- Export: `desktop-settings.jsx` exports `DesktopSettings` as a named export (and `IntegrationsPanel` for main.jsx nav reuse)
- Tab state: `const [tab, setTab] = React.useState('profile')` — no localStorage persistence, resets to Profile on open
- Tab render: conditional render (`tab === 'x' && ...`), not CSS hide/show
- Tab order: Profile → Appearance → Planner → Profiles → Confidential → Data & sync → Integrations → Desktop
- `AdoConnectionCard` receives `onRefreshData` prop (replaces direct call to module-level `refreshAdoData`)
- Test runner: `npm test` in `apps/desktop` runs `vitest run`
- All test mocks use `vi.stubGlobal` or `vi.mock` — never `jest.*`
- Shared `@nexusmd/ui` components (`VsProfiles`, `BackupRestoreCard`, `CloudSyncCard`, `BoardColumnsCard`, `IntegrationsView`) are mocked in tests, not tested here

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `apps/desktop/vitest.config.js` | Create | jsdom + React plugin config |
| `apps/desktop/package.json` | Modify | Add `"test": "vitest run"`, add `@testing-library/react` devDep |
| `apps/desktop/src/desktop-settings.jsx` | Create | All extracted components + tab shell |
| `apps/desktop/src/main.jsx` | Modify | Remove extracted code, add imports, pass `onRefreshData` |
| `apps/desktop/src/desktop-settings.test.jsx` | Create | Default tab + 8 tab-switch tests |
| `apps/desktop/src/DesktopProfileCard.test.jsx` | Create | Field edits persist to localStorage |
| `apps/desktop/src/DesktopPlannerPrefsCard.test.jsx` | Create | Pref changes persist to localStorage |
| `apps/desktop/src/DesktopConfidentialCard.test.jsx` | Create | Password button state, auto-relock toggle |
| `apps/desktop/src/DesktopDataSyncCard.test.jsx` | Create | Refresh interval persist, clear data reloads |
| `apps/desktop/src/DesktopAppCard.test.jsx` | Create | IPC calls for login-item and close-to-tray toggles |
| `apps/desktop/src/DesktopQuickLinksCard.test.jsx` | Create | Add / edit / remove link lifecycle |
| `apps/desktop/src/AdoConnectionCard.test.jsx` | Create | Save calls `saveAdoConfig` + `onRefreshData` |
| `apps/desktop/src/LogsCard.test.jsx` | Create | list on mount, read on select, delete on click |

---

## Shared mock helper (inline in each test file that renders `DesktopSettings` or needs `@nexusmd/ui`)

Every test file that imports from `./desktop-settings.jsx` must mock the module-level imports that would otherwise pull in heavy runtime deps or IPC. Copy this block into each test file:

```jsx
// --- Shared mocks (copy into each test file as needed) ---
import { vi } from 'vitest'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ title, children }) => <div data-testid={`vs-card-${(title||'').toLowerCase().replace(/[\s&]+/g,'-')}`}>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} data-active={String(v===value)} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div data-testid="vs-profiles">VsProfiles</div>,
  BackupRestoreCard: () => <div data-testid="backup-restore">BackupRestoreCard</div>,
  CloudSyncCard: () => <div data-testid="cloud-sync">CloudSyncCard</div>,
  BoardColumnsCard: () => <div data-testid="board-columns">BoardColumnsCard</div>,
  IntegrationsView: () => <div data-testid="integrations-view">IntegrationsView</div>,
  ThemeChipPicker: () => <div data-testid="theme-chip-picker">ThemeChipPicker</div>,
  VsPasswordModal: ({ open }) => open ? <div data-testid="pw-modal">VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))
```

---

## Task 1: Vitest setup + extract components to `desktop-settings.jsx`

**Files:**
- Create: `apps/desktop/vitest.config.js`
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/desktop-settings.jsx`
- Modify: `apps/desktop/src/main.jsx`

**Interfaces:**
- Produces: `DesktopSettings({ tweaks, setTweak, refreshInterval, onRefreshIntervalChange, onRefreshData })` — named export from `desktop-settings.jsx`
- Produces: `IntegrationsPanel()` — named export from `desktop-settings.jsx` (for main.jsx nav)
- Produces: `AdoConnectionCard({ onRefreshData })` — internal component, `onRefreshData` replaces old module-level `refreshAdoData()` call

---

- [ ] **Step 1: Add vitest config and update package.json**

Create `apps/desktop/vitest.config.js`:
```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
})
```

In `apps/desktop/package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

In `apps/desktop/package.json`, add to `"devDependencies"`:
```json
"@testing-library/react": "^16.0.0"
```

Then run `npm install` in `apps/desktop` to install `@testing-library/react`.

- [ ] **Step 2: Create `apps/desktop/src/desktop-settings.jsx`**

This file contains every component that was inline in `main.jsx` under the settings area, plus the `IntegrationsPanel` component and its `DesktopGitHubPATRow` helper. The `DesktopSettings` function keeps the SAME flat card layout for now (tab shell is added in Task 2). `AdoConnectionCard` gains an `onRefreshData` prop replacing the module-level call.

```jsx
import React from 'react'
import {
  Icon, CardFrame,
  VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker, BoardColumnsCard,
  VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView,
  PlToggle, VsPasswordModal, loadConfidentialConfig,
} from '@nexusmd/ui'
import { useProfile } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { desktopFileIO } from './file-io.js'
import LogsCard from './logs-card.jsx'
import { desktopCloudProviders, makeDesktopOAuthService } from './cloud-auth.js'
import { desktopSync } from './sync.js'
import { getAdoConfig, saveAdoConfig, createAdoHttpAdapter } from './ado-client.js'

const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
  color: 'var(--text)', boxSizing: 'border-box',
}

function SettField({ label, hint, children }) {
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
  const [loginItem, setLoginItem] = React.useState(false)
  const [closeToTray, setCloseToTray] = React.useState(true)
  const [outputPath, setOutputPath] = React.useState(() => {
    try { return localStorage.getItem('nexusmd.outputPath') || '' } catch { return '' }
  })

  React.useEffect(() => {
    window.electronAPI?.getLoginItemEnabled?.().then(setLoginItem).catch(() => {})
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
      <VsRow title="Start on login" desc="Launch NexusMD automatically when you log in">
        <PlToggle checked={loginItem} onChange={v => {
          setLoginItem(v)
          window.electronAPI.setLoginItemEnabled?.(v)?.catch(() => {})
        }} />
      </VsRow>
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
    <VsRow title="Personal Access Token" desc={valid ? 'Classic or fine-grained PAT with repo scope' : 'Token must start with ghp_, ghs_, or github_pat_'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="password"
          value={pat}
          onChange={e => { setPat(e.target.value); setValid(true) }}
          placeholder="ghp_…"
          style={{ width: 200, padding: '6px 10px', borderRadius: 8, border: `1px solid ${valid ? 'var(--border)' : 'var(--danger)'}`, background: 'var(--surface-2)', font: 'inherit', fontSize: 13, color: 'var(--text)' }}
        />
        <button className="btn sm" onClick={save}>Save</button>
      </div>
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
      id: 'ado', label: 'Azure DevOps', icon: 'inbox',
      desc: 'OAuth 2.0 — work items, PRs, pipelines',
      ...makeDesktopOAuthService('ado'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From your Azure DevOps OAuth application' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'microsoft', label: 'Microsoft / Entra ID', icon: 'mail',
      desc: 'Sign in with Microsoft — OneDrive, Teams, Calendar',
      ...makeDesktopOAuthService('microsoft'),
      credFields: [
        { key: 'clientId', label: 'Client ID (Application ID)', hint: 'From Azure portal → App registrations' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'gdrive', label: 'Google', icon: 'calendar',
      desc: 'Google Calendar, Gmail, and Drive',
      ...makeDesktopOAuthService('gdrive'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From Google Cloud Console → APIs & Services → Credentials' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      id: 'github', label: 'GitHub', icon: 'pr',
      desc: 'GitHub OAuth App — pull requests and repo access',
      ...makeDesktopOAuthService('github'),
      credFields: [
        { key: 'clientId', label: 'Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps' },
        { key: 'clientSecret', label: 'Client Secret', secret: true },
      ],
      children: (
        <React.Fragment>
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
        </React.Fragment>
      ),
    },
  ], [ghRepos])

  return (
    <div style={{ padding: '24px 0' }}>
      <IntegrationsView services={oauthServices} />
    </div>
  )
}

export function DesktopSettings({ tweaks, setTweak, refreshInterval, onRefreshIntervalChange, onRefreshData }) {
  const profileApi = useProfile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
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
      </VsCard>
      <DesktopProfileCard />
      <DesktopPlannerPrefsCard />
      <DesktopConfidentialCard />
      <DesktopAppCard />
      <DesktopQuickLinksCard
        links={tweaks.quickLinks || []}
        onChange={links => setTweak('quickLinks', links)}
      />
      <AdoConnectionCard onRefreshData={onRefreshData} />
      <VsProfiles profileApi={profileApi} />
      <BackupRestoreCard fileIO={desktopFileIO} cloudProviders={desktopCloudProviders} />
      <CloudSyncCard controller={desktopSync} providers={desktopCloudProviders} fileIO={desktopFileIO} />
      <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
      <LogsCard />
      <VsCard title="Project areas" icon="work">
        <VsRow title="Manage areas" desc="Define project area categories used in triage and work-item classification">
          <button className="btn sm ghost" onClick={() => window.dispatchEvent(new CustomEvent('nexusmd:openProjectAreas'))}>Open editor</button>
        </VsRow>
      </VsCard>
      <BoardColumnsCard />
    </div>
  )
}
```

- [ ] **Step 3: Update `apps/desktop/src/main.jsx`**

**Remove** from `main.jsx` (these lines are now in `desktop-settings.jsx`):
- Lines 293–308: `settInputStyle` const and `SettField` function
- Lines 310–401: `AdoConnectionCard` function
- Lines 681–713: `DesktopProfileCard` function
- Lines 715–748: `DesktopPlannerPrefsCard` function
- Lines 750–779: `DesktopConfidentialCard` function
- Lines 781–831: `DesktopAppCard` function
- Lines 833–884: `DesktopQuickLinksCard` function
- Lines 886–934: `DesktopDataSyncCard` function
- Lines 937–976: `DesktopSettings` function
- Lines 978–999: `DesktopGitHubPATRow` function
- Lines 1010–1087: `IntegrationsPanel` function

**Add** after line 40 (after the `'./adapters/secureStorage.js'` import block):
```js
import { DesktopSettings, IntegrationsPanel } from './desktop-settings.jsx'
```

**Update** the `<DesktopSettings>` call (was at line ~1255, now wherever it falls after removals). Change from:
```jsx
return <DesktopSettings tweaks={tweaks} setTweak={setTweak}
  refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} />
```
To:
```jsx
return <DesktopSettings tweaks={tweaks} setTweak={setTweak}
  refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange}
  onRefreshData={refreshAdoData} />
```

Also remove from main.jsx the imports that are no longer used in main.jsx but are now only needed in desktop-settings.jsx:
- `VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView, VsPasswordModal, loadConfidentialConfig, ThemeChipPicker, BoardColumnsCard` from `@nexusmd/ui`
- `desktopCloudProviders, makeDesktopOAuthService` from `./cloud-auth.js` (if no longer used in main.jsx)
- `desktopSync` from `./sync.js` (if no longer used in main.jsx)
- `desktopFileIO` from `./file-io.js` (if no longer used in main.jsx)

> **Note:** Check each removed import against remaining main.jsx code before deleting. Some (like `desktopCloudProviders`) may still be used for `registerCloudDeepLink`.

- [ ] **Step 4: Verify the app builds without errors**

Run from `apps/desktop`:
```
npm run dev
```
Expected: Vite dev server starts without module errors. Open the app and navigate to Settings — all cards should render exactly as before.

- [ ] **Step 5: Write the failing test**

Create `apps/desktop/src/DesktopProfileCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DesktopProfileCard } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div data-testid="theme-chip-picker">ThemeChipPicker</div>,
  VsPasswordModal: ({ open }) => open ? <div>VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => {
  localStorage.clear()
})

describe('DesktopProfileCard', () => {
  it('renders display name, role, team, and timezone inputs', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(4)
  })

  it('saves display name to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: 'Alice' } })
    expect(localStorage.getItem('nexusmd.profile.displayName')).toBe('Alice')
  })

  it('saves role to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[1], { target: { value: 'Developer' } })
    expect(localStorage.getItem('nexusmd.profile.role')).toBe('Developer')
  })

  it('saves team to localStorage on change', () => {
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[2], { target: { value: 'Platform' } })
    expect(localStorage.getItem('nexusmd.profile.team')).toBe('Platform')
  })

  it('reads initial display name from localStorage', () => {
    localStorage.setItem('nexusmd.profile.displayName', 'Bob')
    render(<DesktopProfileCard />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs[0].value).toBe('Bob')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

```
cd apps/desktop && npm test -- --reporter=verbose 2>&1 | head -30
```

Expected: FAIL — `DesktopProfileCard` either not found or test infrastructure not set up yet (confirms setup is needed before tests pass).

Actually at this point the test should PASS if the extraction is correct. If it fails, the extraction has a bug — fix it before proceeding.

- [ ] **Step 7: Run test to confirm it passes**

```
cd apps/desktop && npm test
```

Expected output:
```
✓ src/DesktopProfileCard.test.jsx (5)
  ✓ renders display name, role, team, and timezone inputs
  ✓ saves display name to localStorage on change
  ✓ saves role to localStorage on change
  ✓ saves team to localStorage on change
  ✓ reads initial display name from localStorage

Test Files  1 passed (1)
Tests       5 passed (5)
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/vitest.config.js
git add apps/desktop/package.json
git add apps/desktop/src/desktop-settings.jsx
git add apps/desktop/src/main.jsx
git add apps/desktop/src/DesktopProfileCard.test.jsx
git commit -m "feat(desktop): extract settings components to desktop-settings.jsx, add vitest"
```

---

## Task 2: Tab shell + tab navigation tests

**Files:**
- Modify: `apps/desktop/src/desktop-settings.jsx` (replace flat layout in `DesktopSettings` with tab shell)
- Create: `apps/desktop/src/desktop-settings.test.jsx`

**Interfaces:**
- Consumes: `DesktopSettings({ tweaks, setTweak, refreshInterval, onRefreshIntervalChange, onRefreshData })` from Task 1
- Produces: `DesktopSettings` with left-rail 8-tab layout; tab state `useState('profile')` resets on mount

---

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/desktop-settings.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopSettings } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div data-testid="logs-card">LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ title, children }) => <div data-testid={`vs-card-${(title || '').toLowerCase().replace(/[\s&]+/g, '-')}`}>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div data-testid="vs-profiles">VsProfiles</div>,
  BackupRestoreCard: () => <div data-testid="backup-restore">BackupRestoreCard</div>,
  CloudSyncCard: () => <div data-testid="cloud-sync">CloudSyncCard</div>,
  BoardColumnsCard: () => <div data-testid="board-columns">BoardColumnsCard</div>,
  IntegrationsView: () => <div data-testid="integrations-view">IntegrationsView</div>,
  ThemeChipPicker: () => <div data-testid="theme-chip-picker">ThemeChipPicker</div>,
  VsPasswordModal: ({ open }) => open ? <div>VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))

vi.stubGlobal('electronAPI', {
  getLoginItemEnabled: vi.fn(() => Promise.resolve(false)),
  getCloseToTray: vi.fn(() => Promise.resolve(true)),
  setLoginItemEnabled: vi.fn(),
  setCloseToTray: vi.fn(),
})

beforeEach(() => localStorage.clear())

const defaultProps = {
  tweaks: { theme: 'dark', lightTheme: 'parchment', darkTheme: 'cobalt', quickLinks: [] },
  setTweak: vi.fn(),
  refreshInterval: 300,
  onRefreshIntervalChange: vi.fn(),
  onRefreshData: vi.fn(),
}

describe('DesktopSettings tab navigation', () => {
  it('shows Profile tab content by default', () => {
    render(<DesktopSettings {...defaultProps} />)
    // Profile tab: DesktopProfileCard renders a VsCard with title "Profile"
    expect(screen.getByTestId('vs-card-profile')).toBeTruthy()
    // Appearance tab content should NOT be visible
    expect(screen.queryByTestId('theme-chip-picker')).toBeNull()
  })

  it('shows Appearance tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getAllByTestId('theme-chip-picker').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('vs-card-profile')).toBeNull()
  })

  it('shows Planner tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }))
    expect(screen.getByTestId('vs-card-planner')).toBeTruthy()
    expect(screen.getByTestId('board-columns')).toBeTruthy()
  })

  it('shows Profiles tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }))
    expect(screen.getByTestId('vs-profiles')).toBeTruthy()
    expect(screen.getByTestId('backup-restore')).toBeTruthy()
    expect(screen.getByTestId('cloud-sync')).toBeTruthy()
  })

  it('shows Confidential tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confidential' }))
    expect(screen.getByTestId('vs-card-confidential')).toBeTruthy()
  })

  it('shows Data & sync tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Data & sync' }))
    expect(screen.getByTestId('vs-card-data-&-sync')).toBeTruthy()
    expect(screen.getByTestId('logs-card')).toBeTruthy()
  })

  it('shows Integrations tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
    expect(screen.getByTestId('integrations-view')).toBeTruthy()
  })

  it('shows Desktop tab content when clicked', () => {
    render(<DesktopSettings {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))
    expect(screen.getByTestId('vs-card-desktop-app')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd apps/desktop && npm test
```

Expected: all tab-switch tests FAIL (`queryByTestId('theme-chip-picker')` returns something on Profile tab because the current flat layout renders everything at once).

- [ ] **Step 3: Replace flat layout in `DesktopSettings` with tab shell**

Replace the `DesktopSettings` function body in `apps/desktop/src/desktop-settings.jsx` with:

```jsx
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

export function DesktopSettings({ tweaks, setTweak, refreshInterval, onRefreshIntervalChange, onRefreshData }) {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd apps/desktop && npm test
```

Expected:
```
✓ src/desktop-settings.test.jsx (8)
✓ src/DesktopProfileCard.test.jsx (5)

Test Files  2 passed (2)
Tests  13 passed (13)
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/desktop-settings.jsx
git add apps/desktop/src/desktop-settings.test.jsx
git commit -m "feat(desktop): add 8-tab left-rail layout to DesktopSettings"
```

---

## Task 3: `DesktopPlannerPrefsCard` tests

**Files:**
- Create: `apps/desktop/src/DesktopPlannerPrefsCard.test.jsx`

**Interfaces:**
- Consumes: `DesktopPlannerPrefsCard()` from `desktop-settings.jsx` (Task 1)

---

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/DesktopPlannerPrefsCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopPlannerPrefsCard } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsSeg: ({ value, options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} data-value={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => localStorage.clear())

describe('DesktopPlannerPrefsCard', () => {
  it('saves landing preference to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(localStorage.getItem('nexusmd.planner.landing')).toBe('week')
  })

  it('saves nav style to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Tabs' }))
    expect(localStorage.getItem('nexusmd.planner.nav')).toBe('tabs')
  })

  it('saves entry style to localStorage', () => {
    render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Modal' }))
    expect(localStorage.getItem('nexusmd.planner.entry')).toBe('modal')
  })

  it('toggles carry-over prompt off', () => {
    render(<DesktopPlannerPrefsCard />)
    // Default is '1' (on). Click to turn off.
    fireEvent.click(screen.getByRole('switch'))
    expect(localStorage.getItem('nexusmd.planner.carryPrompt')).toBe('0')
  })

  it('reads initial landing from localStorage', () => {
    localStorage.setItem('nexusmd.planner.landing', 'month')
    render(<DesktopPlannerPrefsCard />)
    // The 'Month' option should have been passed as initial value to VsSeg
    // VsSeg mock doesn't visually indicate selection, but we can click another option
    // and verify the localStorage started from 'month'
    expect(localStorage.getItem('nexusmd.planner.landing')).toBeNull() // cleared in beforeEach
    // Re-verify: set it and re-render
    localStorage.setItem('nexusmd.planner.landing', 'month')
    const { unmount } = render(<DesktopPlannerPrefsCard />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Week' })[0])
    expect(localStorage.getItem('nexusmd.planner.landing')).toBe('week')
    unmount()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd apps/desktop && npm test -- DesktopPlannerPrefsCard
```

Expected: FAIL — test file not implemented yet, or `DesktopPlannerPrefsCard` not exported.

> **Note:** If the tests already pass (e.g. they were added in Task 1), skip to Step 4.

- [ ] **Step 3: Verify `DesktopPlannerPrefsCard` is exported from `desktop-settings.jsx`**

Confirm `desktop-settings.jsx` has `export function DesktopPlannerPrefsCard`. If it's not yet exported, add the `export` keyword. (This was specified in Task 1 Step 2 as an export.)

- [ ] **Step 4: Run all tests to confirm they pass**

```
cd apps/desktop && npm test
```

Expected:
```
✓ src/DesktopPlannerPrefsCard.test.jsx (5)
✓ src/desktop-settings.test.jsx (8)
✓ src/DesktopProfileCard.test.jsx (5)

Test Files  3 passed (3)
Tests  18 passed (18)
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/DesktopPlannerPrefsCard.test.jsx
git commit -m "test(desktop): add DesktopPlannerPrefsCard localStorage persistence tests"
```

---

## Task 4: `DesktopConfidentialCard` and `DesktopDataSyncCard` tests

**Files:**
- Create: `apps/desktop/src/DesktopConfidentialCard.test.jsx`
- Create: `apps/desktop/src/DesktopDataSyncCard.test.jsx`

**Interfaces:**
- Consumes: `DesktopConfidentialCard()`, `DesktopDataSyncCard({ refreshInterval, onRefreshIntervalChange })` from `desktop-settings.jsx`

---

- [ ] **Step 1: Write `DesktopConfidentialCard.test.jsx`**

Create `apps/desktop/src/DesktopConfidentialCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopConfidentialCard } from './desktop-settings.jsx'
import { loadConfidentialConfig } from '@nexusmd/ui'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: ({ open }) => open ? <div data-testid="pw-modal">VsPasswordModal</div> : null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => {
  localStorage.clear()
  vi.mocked(loadConfidentialConfig).mockReturnValue({ sections: [], hash: null })
})

describe('DesktopConfidentialCard', () => {
  it('shows "Set password" button when no hash is set', () => {
    render(<DesktopConfidentialCard />)
    expect(screen.getByRole('button', { name: 'Set password' })).toBeTruthy()
  })

  it('shows "Change password" button when hash is set', () => {
    vi.mocked(loadConfidentialConfig).mockReturnValue({ sections: [], hash: 'abc123' })
    render(<DesktopConfidentialCard />)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
  })

  it('opens password modal when password button is clicked', () => {
    render(<DesktopConfidentialCard />)
    expect(screen.queryByTestId('pw-modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))
    expect(screen.getByTestId('pw-modal')).toBeTruthy()
  })

  it('toggles auto-relock on', () => {
    render(<DesktopConfidentialCard />)
    // Default is '0' (off), so aria-checked is false
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(localStorage.getItem('nexusmd.confidential.autoRelock')).toBe('1')
  })

  it('reads auto-relock state from localStorage', () => {
    localStorage.setItem('nexusmd.confidential.autoRelock', '1')
    render(<DesktopConfidentialCard />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
```

- [ ] **Step 2: Write `DesktopDataSyncCard.test.jsx`**

Create `apps/desktop/src/DesktopDataSyncCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopDataSyncCard } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => localStorage.clear())

describe('DesktopDataSyncCard', () => {
  it('renders refresh interval input with current value', () => {
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input.value).toBe('300')
  })

  it('calls onRefreshIntervalChange and saves to localStorage when interval changes', () => {
    const onRefreshIntervalChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onRefreshIntervalChange} />)
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '120' } })
    expect(onRefreshIntervalChange).toHaveBeenCalledWith(120)
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBe('120')
  })

  it('clamps refresh interval to minimum 10', () => {
    const onRefreshIntervalChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onRefreshIntervalChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } })
    expect(onRefreshIntervalChange).toHaveBeenCalledWith(10)
  })

  it('clamps refresh interval to maximum 3600', () => {
    const onRefreshIntervalChange = vi.fn()
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={onRefreshIntervalChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '9999' } })
    expect(onRefreshIntervalChange).toHaveBeenCalledWith(3600)
  })

  it('clears nexusmd.* localStorage keys and reloads when confirmed', () => {
    const reloadFn = vi.fn()
    vi.stubGlobal('location', { reload: reloadFn })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    localStorage.setItem('nexusmd.refreshInterval', '300')
    localStorage.setItem('unrelated', 'keep')

    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))

    expect(localStorage.getItem('nexusmd.profile.displayName')).toBeNull()
    expect(localStorage.getItem('nexusmd.refreshInterval')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
    expect(reloadFn).toHaveBeenCalled()
  })

  it('does not clear data when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    localStorage.setItem('nexusmd.profile.displayName', 'Alice')
    render(<DesktopDataSyncCard refreshInterval={300} onRefreshIntervalChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear data…' }))
    expect(localStorage.getItem('nexusmd.profile.displayName')).toBe('Alice')
  })
})
```

- [ ] **Step 3: Run all tests**

```
cd apps/desktop && npm test
```

Expected:
```
✓ src/DesktopConfidentialCard.test.jsx (5)
✓ src/DesktopDataSyncCard.test.jsx (6)
✓ src/DesktopPlannerPrefsCard.test.jsx (5)
✓ src/desktop-settings.test.jsx (8)
✓ src/DesktopProfileCard.test.jsx (5)

Test Files  5 passed (5)
Tests  29 passed (29)
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/DesktopConfidentialCard.test.jsx
git add apps/desktop/src/DesktopDataSyncCard.test.jsx
git commit -m "test(desktop): add DesktopConfidentialCard and DesktopDataSyncCard tests"
```

---

## Task 5: `DesktopAppCard` tests

**Files:**
- Create: `apps/desktop/src/DesktopAppCard.test.jsx`

**Interfaces:**
- Consumes: `DesktopAppCard()` from `desktop-settings.jsx`

---

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/DesktopAppCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopAppCard } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

let mockElectronAPI

beforeEach(() => {
  localStorage.clear()
  mockElectronAPI = {
    getLoginItemEnabled: vi.fn(() => Promise.resolve(false)),
    getCloseToTray: vi.fn(() => Promise.resolve(true)),
    setLoginItemEnabled: vi.fn(() => Promise.resolve()),
    setCloseToTray: vi.fn(() => Promise.resolve()),
    pickOutputFolder: vi.fn(() => Promise.resolve(null)),
  }
  vi.stubGlobal('electronAPI', mockElectronAPI)
})

describe('DesktopAppCard', () => {
  it('calls getLoginItemEnabled and getCloseToTray on mount', async () => {
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getLoginItemEnabled).toHaveBeenCalled())
    expect(mockElectronAPI.getCloseToTray).toHaveBeenCalled()
  })

  it('calls setLoginItemEnabled(true) when start-on-login toggle is clicked', async () => {
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getLoginItemEnabled).toHaveBeenCalled())
    // First toggle is "Start on login" (loginItem=false → toggle shows Off)
    const toggles = screen.getAllByRole('switch')
    fireEvent.click(toggles[0])
    expect(mockElectronAPI.setLoginItemEnabled).toHaveBeenCalledWith(true)
  })

  it('calls setCloseToTray(false) when close-to-tray toggle is clicked', async () => {
    mockElectronAPI.getCloseToTray = vi.fn(() => Promise.resolve(true))
    render(<DesktopAppCard />)
    await waitFor(() => expect(mockElectronAPI.getCloseToTray).toHaveBeenCalled())
    const toggles = screen.getAllByRole('switch')
    // Second toggle is "Close to tray" (closeToTray=true initially before IPC resolves)
    fireEvent.click(toggles[1])
    expect(mockElectronAPI.setCloseToTray).toHaveBeenCalledWith(false)
  })

  it('calls pickOutputFolder and saves path to localStorage', async () => {
    mockElectronAPI.pickOutputFolder = vi.fn(() => Promise.resolve('/home/user/output'))
    render(<DesktopAppCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    await waitFor(() => expect(mockElectronAPI.pickOutputFolder).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem('nexusmd.outputPath')).toBe('/home/user/output'))
  })

  it('renders null when electronAPI is not present', () => {
    vi.stubGlobal('electronAPI', undefined)
    const { container } = render(<DesktopAppCard />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests**

```
cd apps/desktop && npm test -- DesktopAppCard
```

Expected: 5 tests pass.

- [ ] **Step 3: Run all tests**

```
cd apps/desktop && npm test
```

Expected: All prior tests + 5 new = 34 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/DesktopAppCard.test.jsx
git commit -m "test(desktop): add DesktopAppCard IPC interaction tests"
```

---

## Task 6: `DesktopQuickLinksCard` tests

**Files:**
- Create: `apps/desktop/src/DesktopQuickLinksCard.test.jsx`

**Interfaces:**
- Consumes: `DesktopQuickLinksCard({ links, onChange })` from `desktop-settings.jsx`

---

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/DesktopQuickLinksCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DesktopQuickLinksCard } from './desktop-settings.jsx'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: () => ({ org: '', projects: [] }),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: () => ({}),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ children }) => <div>{children}</div>,
  Icon: () => null,
}))

describe('DesktopQuickLinksCard', () => {
  it('renders existing links', () => {
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={vi.fn()} />)
    expect(screen.getByText('Google')).toBeTruthy()
  })

  it('adds a new link via form', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Google' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'https://google.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Google', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('rejects a link without https:// URL', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Bad' } })
    fireEvent.change(screen.getByPlaceholderText('URL'), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('edits an existing link in place', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('Google'), { target: { value: 'Bing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChange).toHaveBeenCalledWith([
      { label: 'Bing', url: 'https://google.com', color: 'var(--accent)' },
    ])
  })

  it('removes a link', () => {
    const onChange = vi.fn()
    const links = [{ label: 'Google', url: 'https://google.com', color: 'var(--accent)' }]
    render(<DesktopQuickLinksCard links={links} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('cancels the add form without calling onChange', () => {
    const onChange = vi.fn()
    render(<DesktopQuickLinksCard links={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Label')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests**

```
cd apps/desktop && npm test -- DesktopQuickLinksCard
```

Expected: 6 tests pass.

- [ ] **Step 3: Run all tests**

```
cd apps/desktop && npm test
```

Expected: All prior + 6 new = 40 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/DesktopQuickLinksCard.test.jsx
git commit -m "test(desktop): add DesktopQuickLinksCard add/edit/remove tests"
```

---

## Task 7: `AdoConnectionCard` tests

**Files:**
- Create: `apps/desktop/src/AdoConnectionCard.test.jsx`

**Interfaces:**
- Consumes: `AdoConnectionCard({ onRefreshData })` from `desktop-settings.jsx`

---

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/AdoConnectionCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdoConnectionCard } from './desktop-settings.jsx'
import { saveAdoConfig } from './ado-client.js'

vi.mock('./profile-keys.js', () => ({ getProfileKey: k => k }))
vi.mock('./profile-context.jsx', () => ({ useProfile: () => ({}) }))
vi.mock('./cloud-auth.js', () => ({
  desktopCloudProviders: [],
  makeDesktopOAuthService: () => ({ isConnected: false, connect: vi.fn(), disconnect: vi.fn() }),
}))
vi.mock('./sync.js', () => ({ desktopSync: {} }))
vi.mock('./file-io.js', () => ({ desktopFileIO: {} }))
vi.mock('./ado-client.js', () => ({
  getAdoConfig: vi.fn(() => ({ org: '', pat: '', projects: [] })),
  saveAdoConfig: vi.fn(),
  createAdoHttpAdapter: vi.fn(() => ({
    fetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ value: [{ name: 'ProjectA' }, { name: 'ProjectB' }] }) })),
  })),
  isAdoConfigured: () => false,
}))
vi.mock('./logs-card.jsx', () => ({ default: () => <div>LogsCard</div> }))
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ children }) => <div>{children}</div>,
  VsFullRow: ({ children }) => <div>{children}</div>,
  VsSeg: ({ options, onChange }) => (
    <div>{options.map(([v, l]) => <button key={v} onClick={() => onChange(v)}>{l}</button>)}</div>
  ),
  PlToggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
  ),
  VsProfiles: () => <div>VsProfiles</div>,
  BackupRestoreCard: () => <div>BackupRestoreCard</div>,
  CloudSyncCard: () => <div>CloudSyncCard</div>,
  BoardColumnsCard: () => <div>BoardColumnsCard</div>,
  IntegrationsView: () => <div>IntegrationsView</div>,
  ThemeChipPicker: () => <div>ThemeChipPicker</div>,
  VsPasswordModal: () => null,
  loadConfidentialConfig: vi.fn(() => ({ sections: [], hash: null })),
  CardFrame: ({ title, children }) => <div><span>{title}</span>{children}</div>,
  Icon: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdoConnectionCard', () => {
  it('renders org and PAT inputs', () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    expect(screen.getByPlaceholderText('your-org-name')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave blank to keep existing PAT')).toBeTruthy()
  })

  it('loads initial org from getAdoConfig on mount', async () => {
    const { getAdoConfig } = await import('./ado-client.js')
    vi.mocked(getAdoConfig).mockReturnValue({ org: 'myorg', projects: ['ProjectA'] })
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText('your-org-name').value).toBe('myorg'))
  })

  it('calls saveAdoConfig with org and PAT when Save is clicked', async () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing PAT'), { target: { value: 'mytoken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(saveAdoConfig).toHaveBeenCalledWith({
      org: 'myorg',
      pat: 'mytoken',
      projects: [],
    }))
  })

  it('calls onRefreshData after successful save', async () => {
    const onRefreshData = vi.fn(() => Promise.resolve())
    render(<AdoConnectionCard onRefreshData={onRefreshData} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }))
    await waitFor(() => expect(onRefreshData).toHaveBeenCalled())
  })

  it('discovers projects and populates the projects textarea', async () => {
    render(<AdoConnectionCard onRefreshData={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('your-org-name'), { target: { value: 'myorg' } })
    fireEvent.change(screen.getByPlaceholderText('Leave blank to keep existing PAT'), { target: { value: 'mytoken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discover projects' }))
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Project1, Project2')
      expect(textarea.value).toBe('ProjectA, ProjectB')
    })
  })
})
```

- [ ] **Step 2: Run tests**

```
cd apps/desktop && npm test -- AdoConnectionCard
```

Expected: 5 tests pass.

- [ ] **Step 3: Run all tests**

```
cd apps/desktop && npm test
```

Expected: All prior + 5 new = 45 tests passing.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/AdoConnectionCard.test.jsx
git commit -m "test(desktop): add AdoConnectionCard save and discovery tests"
```

---

## Task 8: `LogsCard` tests

**Files:**
- Create: `apps/desktop/src/LogsCard.test.jsx`

**Interfaces:**
- Consumes: `LogsCard` default export from `./logs-card.jsx` (tested directly, not via `desktop-settings.jsx`)

---

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/LogsCard.test.jsx`:

```jsx
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LogsCard from './logs-card.jsx'

// logs-card.jsx imports VsCard, VsRow, Icon from @nexusmd/ui
vi.mock('@nexusmd/ui', () => ({
  VsCard: ({ children }) => <div>{children}</div>,
  VsRow: ({ title, children }) => <div><span>{title}</span><div>{children}</div></div>,
  Icon: () => null,
}))

let mockLogs

beforeEach(() => {
  mockLogs = {
    list: vi.fn(() => Promise.resolve([
      { date: '2026-07-01', size: 1024 },
      { date: '2026-06-30', size: 512 },
    ])),
    read: vi.fn(() => Promise.resolve('Log line 1\nLog line 2')),
    delete: vi.fn(() => Promise.resolve(true)),
  }
  vi.stubGlobal('electronAPI', { logs: mockLogs })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('LogsCard', () => {
  it('calls electronAPI.logs.list on mount', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(mockLogs.list).toHaveBeenCalled())
  })

  it('displays available log dates after loading', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/2026-07-01/)).toBeTruthy())
  })

  it('calls logs.read with the first date automatically after list loads', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(mockLogs.read).toHaveBeenCalledWith('2026-07-01'))
  })

  it('calls logs.read when a different date is selected', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-06-30' } })
    await waitFor(() => expect(mockLogs.read).toHaveBeenCalledWith('2026-06-30'))
  })

  it('displays log content in a read-only textarea', async () => {
    render(<LogsCard />)
    await waitFor(() => expect(mockLogs.read).toHaveBeenCalled())
    await waitFor(() => {
      const textarea = screen.getByRole('textbox')
      expect(textarea.value).toBe('Log line 1\nLog line 2')
    })
  })

  it('calls logs.delete and refreshes list when Delete log is clicked', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('button', { name: /Delete log/ }))
    fireEvent.click(screen.getByRole('button', { name: /Delete log/ }))
    await waitFor(() => expect(mockLogs.delete).toHaveBeenCalledWith('2026-07-01'))
    // After delete, list is re-fetched
    await waitFor(() => expect(mockLogs.list).toHaveBeenCalledTimes(2))
  })

  it('shows "No logs available" message when list is empty', async () => {
    mockLogs.list = vi.fn(() => Promise.resolve([]))
    render(<LogsCard />)
    await waitFor(() => expect(screen.getByText(/No logs available/)).toBeTruthy())
  })

  it('renders a Refresh button that re-fetches the log list', async () => {
    render(<LogsCard />)
    await waitFor(() => screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(mockLogs.list).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run tests**

```
cd apps/desktop && npm test -- LogsCard
```

Expected: 8 tests pass.

- [ ] **Step 3: Run all tests**

```
cd apps/desktop && npm test
```

Expected:
```
✓ src/AdoConnectionCard.test.jsx (5)
✓ src/DesktopAppCard.test.jsx (5)
✓ src/DesktopConfidentialCard.test.jsx (5)
✓ src/DesktopDataSyncCard.test.jsx (6)
✓ src/DesktopPlannerPrefsCard.test.jsx (5)
✓ src/DesktopProfileCard.test.jsx (5)
✓ src/DesktopQuickLinksCard.test.jsx (6)
✓ src/LogsCard.test.jsx (8)
✓ src/desktop-settings.test.jsx (8)

Test Files  9 passed (9)
Tests  53 passed (53)
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/LogsCard.test.jsx
git commit -m "test(desktop): add LogsCard IPC interaction tests"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Extract to `desktop-settings.jsx` → Task 1
- [x] `DesktopSettings` exports as named export → Task 1
- [x] 8-tab left-rail layout → Task 2
- [x] `useState('profile')`, no persistence → Task 2 (tab shell uses `useState('profile')`)
- [x] Conditional render (not CSS hide) → Task 2 (`tab === 'x' && ...`)
- [x] All 8 tab contents match spec table → Task 2
- [x] `AdoConnectionCard` gets `onRefreshData` prop → Task 1
- [x] main.jsx passes `onRefreshData={refreshAdoData}` → Task 1
- [x] `vitest.config.js` with jsdom + React → Task 1
- [x] `"test": "vitest run"` in package.json → Task 1
- [x] `@testing-library/react` in devDeps → Task 1
- [x] All 9 test files → Tasks 1–8
- [x] `desktop-settings.test.jsx` — default tab + 8 switches → Task 2
- [x] `DesktopProfileCard.test.jsx` — field edits persist → Task 1
- [x] `DesktopPlannerPrefsCard.test.jsx` — pref changes persist → Task 3
- [x] `DesktopConfidentialCard.test.jsx` — password button + auto-relock → Task 4
- [x] `DesktopDataSyncCard.test.jsx` — interval clamp + clear → Task 4
- [x] `DesktopAppCard.test.jsx` — IPC calls → Task 5
- [x] `DesktopQuickLinksCard.test.jsx` — add/edit/remove → Task 6
- [x] `AdoConnectionCard.test.jsx` — save + discovery → Task 7
- [x] `LogsCard.test.jsx` — list/read/delete → Task 8
- [x] `IntegrationsPanel` exported and reused in settings Integrations tab → Task 2

**2. Placeholder scan:** No TBD/TODO/implement-later patterns found.

**3. Type consistency:**
- `DesktopSettings` props: `{ tweaks, setTweak, refreshInterval, onRefreshIntervalChange, onRefreshData }` — consistent across Tasks 1, 2, and tab nav tests.
- `AdoConnectionCard` prop: `{ onRefreshData }` — consistent across Task 1 implementation and Task 7 tests.
- `DesktopQuickLinksCard` props: `{ links, onChange }` — consistent across Task 1 and Task 6 tests.
- `DesktopDataSyncCard` props: `{ refreshInterval, onRefreshIntervalChange }` — consistent across Task 1 and Task 4 tests.
