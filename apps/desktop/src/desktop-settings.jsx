import React from 'react'
import {
  Icon, CardFrame,
  VsRow, VsCard, VsFullRow, VsSeg, ThemeChipPicker, BoardColumnsCard,
  VsProfiles, BackupRestoreCard, CloudSyncCard, IntegrationsView,
  PlToggle, VsPasswordModal, loadConfidentialConfig,
  CardsAndTablesSettings, toast, WI_TYPE_STATES_CACHE_KEY,
} from '@nexusmd/ui'
import { ADO_CACHE_KEY, JIRA_CACHE_KEY, buildConfig, resolveConnectionParams, buildConnectionString, graphJSON, SQL_AUTH, AZURE_AD_INTERACTIVE, connectionStringToFields } from '@nexusmd/core'
import { appPrefsAdapter } from './adapters/appPrefs.js'
import { useProfile } from './profile-context.jsx'
import { getProfileKey } from './profile-keys.js'
import { NavOrderEditor } from './nav-order-editor.jsx'
import { ZoomSlider } from './zoom-slider.jsx'
import { desktopFileIO } from './file-io.js'
import LogsCard from './logs-card.jsx'
import { desktopCloudProviders, makeNativeGoogleBinding, makeNativeMicrosoftBinding, setManualMicrosoftToken, decodeJwtClaims } from './cloud-auth.js'
import { desktopSync } from './sync.js'
import { getAdoConfig, saveAdoConfig, createAdoHttpAdapter } from './ado-client.js'
import { JiraConnectionCard, WorkItemsDisplayCard } from './jira-settings.jsx'
import { dbManagerAdapter } from './adapters/db-manager.js'
import { DevenvSettingsCard } from './devenv-settings-card.jsx'
import { registry } from './shell/registry.js'
import { moduleSettingsCards } from './shell/modules.js'
import { pickerAdapter } from './adapters/picker.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import {
  listSavedConnections, saveConnection, getConnectionSecret, deleteConnection,
} from './db-manager-config.js'

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
        <SettField label="Personal Access Token" hint="Needs Work Items (Read & Write), Code (Read & Write), Build (Read & Execute), Test Management (Read), and Project and Team (Read) scopes. Leave blank to keep existing.">
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

const DB_TYPES = [['sqlserver', 'SQL Server'], ['sqlite', 'SQLite']]

const DB_INPUT_MODES = [['fields', 'Fields'], ['connstr', 'Connection string']]

const DB_AUTH_MODES = [[SQL_AUTH, 'SQL login'], [AZURE_AD_INTERACTIVE, 'Entra ID (Azure AD) interactive']]

// One saved connection's editor — used both for "Add connection" (initial === null)
// and "Edit" (initial === the saved metadata, no secret included).
function ConnectionForm({ initial, onSaved, onCancel }) {
  const [name, setName]           = React.useState(initial?.name || '')
  const [dbType, setDbType]       = React.useState(initial?.type || 'sqlserver')
  const [inputMode, setInputMode] = React.useState(initial?.inputMode || 'fields')
  const [connStr, setConnStr]     = React.useState('')
  const [host, setHost]         = React.useState(initial?.host || '')
  const [port, setPort]         = React.useState(initial?.port || '1433')
  const [database, setDatabase] = React.useState(initial?.database || '')
  const [user, setUser]         = React.useState(initial?.user || '')
  const [password, setPassword] = React.useState('')
  const [filePath, setFilePath] = React.useState(initial?.filePath || '')
  const [encrypt, setEncrypt]   = React.useState(initial?.encrypt ?? true)
  const [trustCert, setTrustCert] = React.useState(initial?.trustServerCertificate ?? false)
  const [authentication, setAuthentication] = React.useState(initial?.authentication || SQL_AUTH)
  const [status, setStatus]     = React.useState('')
  const [saving, setSaving]     = React.useState(false)
  const [testing, setTesting]   = React.useState(false)
  const [secretLoaded, setSecretLoaded] = React.useState(!initial)

  const currentFields = () => ({
    host, port, database, user, filePath,
    encrypt, trustServerCertificate: trustCert, authentication,
  })
  const interactive = authentication === AZURE_AD_INTERACTIVE

  // When editing, load the connection's real saved secret into the form so
  // it's both editable and included in the generated connection string below
  // (rather than the field staying blank and the preview silently omitting it).
  // Seeds `connStr` directly here too (not just `password`) so the string is
  // correct even if the user has already switched to the Connection string
  // tab before this resolves — the "keep in sync" effect below only re-derives
  // connStr while the Fields tab is active.
  React.useEffect(() => {
    if (!initial) return
    let cancelled = false
    ;(async () => {
      const secret = await getConnectionSecret(secureStorageAdapter, initial.id)
      if (cancelled) return
      if (initial.inputMode === 'connstr') {
        setConnStr(secret)
      } else {
        setPassword(secret)
        setConnStr(buildConnectionString(dbType, { ...currentFields(), password: secret }))
      }
      setSecretLoaded(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id])

  // Keep the "Connection string" tab in sync while editing on the "Fields" tab,
  // so switching tabs shows the string those fields would produce (including
  // the password). Only runs while Fields is the active tab, so it never
  // clobbers a connection string being hand-edited directly.
  React.useEffect(() => {
    if (inputMode !== 'fields') return
    setConnStr(buildConnectionString(dbType, { ...currentFields(), password }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, dbType, host, port, database, user, password, filePath, encrypt, trustCert, authentication])

  // Parses the connection string into the form's fields, then shows the Fields tab.
  const fillFromConnStr = () => {
    try {
      const f = connectionStringToFields(dbType, connStr)
      if (dbType === 'sqlite') {
        setFilePath(f.filePath)
      } else {
        setHost(f.host); setPort(f.port); setDatabase(f.database); setUser(f.user); setPassword(f.password)
        setEncrypt(f.encrypt); setTrustCert(f.trustServerCertificate); setAuthentication(f.authentication)
      }
      setInputMode('fields')
      setStatus('')
    } catch (e) {
      setStatus('Error: couldn\'t read that connection string: ' + e.message)
    }
  }

  const resolveConfig = async () => {
    if (inputMode === 'connstr') {
      const cs = connStr.trim() || (initial ? await getConnectionSecret(secureStorageAdapter, initial.id) : '')
      if (!cs) throw new Error('Enter a connection string first.')
      return resolveConnectionParams(dbType, { connectionString: cs })
    }
    const pwd = password || (initial ? await getConnectionSecret(secureStorageAdapter, initial.id) : '')
    return buildConfig(dbType, { ...currentFields(), password: pwd })
  }

  const test = async () => {
    if (!dbManagerAdapter.isAvailable()) { setStatus('Error: database connections require the desktop app.'); return }
    setTesting(true)
    setStatus('Testing…')
    try {
      const config = await resolveConfig()
      const result = await dbManagerAdapter.connect(dbType, config)
      setStatus(`Connected — found ${result.tables.length} table${result.tables.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!name.trim()) { setStatus('Error: give this connection a name.'); return }
    setSaving(true)
    setStatus('Saving…')
    try {
      const meta   = { id: initial?.id, name: name.trim(), type: dbType, inputMode, ...currentFields() }
      // Interactive sign-in has no password to keep.
      const secret = inputMode === 'connstr' ? connStr.trim() : (interactive && dbType === 'sqlserver' ? '' : password)
      await saveConnection(secureStorageAdapter, meta, secret)
      onSaved()
    } catch (e) {
      setStatus('Error: ' + e.message)
      setSaving(false)
    }
  }

  const isError = status.startsWith('Error')

  return (
    <CardFrame title={initial ? 'Edit Connection' : 'New Connection'} icon={<Icon name="database" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SettField label="Name">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. UAT, Production" style={settInputStyle} />
        </SettField>

        <SettField label="Type">
          <VsSeg value={dbType} options={DB_TYPES} onChange={setDbType} />
        </SettField>

        <SettField label="Input mode">
          <VsSeg value={inputMode} options={DB_INPUT_MODES} onChange={setInputMode} />
        </SettField>

        {inputMode === 'connstr' ? (
          <SettField
            label={dbType === 'sqlite' ? 'File path or connection string' : 'Connection string'}
            hint={initial
              ? (secretLoaded ? 'Loaded from the saved connection, including its password.' : 'Loading saved connection string…')
              : (dbType === 'sqlserver' ? 'e.g. mssql://user:pass@host:1433/database' : undefined)}
          >
            <textarea value={connStr} onChange={e => setConnStr(e.target.value)}
              rows={3}
              placeholder={dbType === 'sqlserver'
                ? 'mssql://username:password@host:1433/database'
                : 'sqlite:///absolute/path/to/file.db'}
              style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8, fontFamily: 'monospace' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <button className="btn sm ghost" onClick={fillFromConnStr} disabled={!connStr.trim()}>Fill in fields</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reads the string into the Fields tab, so you can check or change it.</span>
            </div>
          </SettField>
        ) : (
          <>
            {dbType === 'sqlite' && (
              <SettField label="File path" hint="Path as it appears on the machine running the desktop app.">
                <input value={filePath} onChange={e => setFilePath(e.target.value)}
                  placeholder="/absolute/path/to/file.db" style={settInputStyle} />
              </SettField>
            )}

            {dbType === 'sqlserver' && (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 2 }}>
                    <SettField label="Server / Host">
                      <input value={host} onChange={e => setHost(e.target.value)}
                        placeholder="myserver.database.windows.net" style={settInputStyle} />
                    </SettField>
                  </div>
                  <div style={{ flex: 1 }}>
                    <SettField label="Port">
                      <input value={port} onChange={e => setPort(e.target.value)}
                        placeholder="1433" style={settInputStyle} />
                    </SettField>
                  </div>
                </div>
                <SettField label="Database">
                  <input value={database} onChange={e => setDatabase(e.target.value)}
                    placeholder="my_database" style={settInputStyle} />
                </SettField>
                <SettField label="Authentication">
                  <VsSeg value={authentication} options={DB_AUTH_MODES} onChange={setAuthentication} />
                </SettField>
                {interactive ? (
                  <SettField
                    label="Account (optional)"
                    hint="Connecting opens your browser to sign in with Microsoft Entra ID, with multi-factor authentication if your organisation requires it."
                  >
                    <input type="email" value={user} onChange={e => setUser(e.target.value)}
                      placeholder="name@company.com" style={settInputStyle} />
                  </SettField>
                ) : (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <SettField label="Username">
                        <input value={user} onChange={e => setUser(e.target.value)}
                          placeholder="sa" style={settInputStyle} />
                      </SettField>
                    </div>
                    <div style={{ flex: 1 }}>
                      <SettField
                        label="Password"
                        hint={initial ? (secretLoaded ? 'Loaded from the saved connection.' : 'Loading saved password…') : undefined}
                      >
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                          style={settInputStyle} />
                      </SettField>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={encrypt} onChange={e => setEncrypt(e.target.checked)} />
                    Encrypt connection
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={trustCert} onChange={e => setTrustCert(e.target.checked)} />
                    Trust server certificate
                  </label>
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={test} disabled={testing || saving}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn primary" onClick={save} disabled={saving || testing}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn sm ghost" onClick={onCancel} disabled={saving}>Cancel</button>
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

export function DatabaseConnectionCard() {
  const [connections, setConnections] = React.useState(() => listSavedConnections())
  const [formState, setFormState]     = React.useState(null) // null | 'new' | <saved entry>
  const [rowStatus, setRowStatus]     = React.useState({})   // id -> status string
  const [rowTesting, setRowTesting]   = React.useState({})   // id -> bool

  const refresh = () => setConnections(listSavedConnections())

  const testRow = async (entry) => {
    if (!dbManagerAdapter.isAvailable()) {
      setRowStatus(s => ({ ...s, [entry.id]: 'Error: database connections require the desktop app.' }))
      return
    }
    setRowTesting(s => ({ ...s, [entry.id]: true }))
    setRowStatus(s => ({ ...s, [entry.id]: 'Testing…' }))
    try {
      const secret = await getConnectionSecret(secureStorageAdapter, entry.id)
      const config = entry.inputMode === 'connstr'
        ? resolveConnectionParams(entry.type, { connectionString: secret })
        : buildConfig(entry.type, { ...entry, password: secret })
      const result = await dbManagerAdapter.connect(entry.type, config)
      setRowStatus(s => ({ ...s, [entry.id]: `Connected — found ${result.tables.length} table${result.tables.length === 1 ? '' : 's'}.` }))
    } catch (e) {
      setRowStatus(s => ({ ...s, [entry.id]: 'Error: ' + e.message }))
    } finally {
      setRowTesting(s => ({ ...s, [entry.id]: false }))
    }
  }

  const removeRow = async (id) => {
    await deleteConnection(secureStorageAdapter, id)
    refresh()
  }

  const cloneRow = async (entry) => {
    setRowStatus(s => ({ ...s, [entry.id]: 'Cloning…' }))
    try {
      const secret = await getConnectionSecret(secureStorageAdapter, entry.id)
      const { id, ...meta } = entry
      await saveConnection(secureStorageAdapter, { ...meta, name: `${entry.name} (copy)` }, secret)
      refresh()
    } catch (e) {
      setRowStatus(s => ({ ...s, [entry.id]: 'Error: ' + e.message }))
    }
  }

  if (formState) {
    return (
      <ConnectionForm
        initial={formState === 'new' ? null : formState}
        onCancel={() => setFormState(null)}
        onSaved={() => {
          setFormState(null)
          refresh()
          window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: 'db-manager' }))
        }}
      />
    )
  }

  return (
    <CardFrame title="Database Connections" icon={<Icon name="database" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {connections.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No saved connections yet. Saved connections appear here and in the Database Manager's connect dialog.
          </p>
        )}
        {connections.map(entry => (
          <div key={entry.id} style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="database" size={14} />
              <strong style={{ fontSize: 13 }}>{entry.name}</strong>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {entry.type === 'sqlite' ? 'SQLite' : 'SQL Server'}
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn sm ghost" onClick={() => testRow(entry)} disabled={rowTesting[entry.id]}>
                {rowTesting[entry.id] ? 'Testing…' : 'Test'}
              </button>
              <button className="btn sm ghost" onClick={() => setFormState(entry)}>Edit</button>
              <button className="btn sm ghost" onClick={() => cloneRow(entry)}>Clone</button>
              <button className="btn sm ghost" onClick={() => removeRow(entry.id)}>Delete</button>
            </div>
            {rowStatus[entry.id] && (
              <span style={{ fontSize: 12, color: rowStatus[entry.id].startsWith('Error') ? 'var(--danger)' : 'var(--success)' }}>
                {rowStatus[entry.id]}
              </span>
            )}
          </div>
        ))}
        <div>
          <button className="btn primary" onClick={() => setFormState('new')}>Add connection</button>
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

export function DesktopDataSyncCard({ refreshInterval, onRefreshIntervalChange, onRefreshData }) {
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

  const clearCache = () => {
    try {
      localStorage.removeItem(ADO_CACHE_KEY)
      localStorage.removeItem(JIRA_CACHE_KEY)
      localStorage.removeItem(WI_TYPE_STATES_CACHE_KEY)
    } catch {}
    toast?.('Cache cleared — refreshing…', 'success')
    onRefreshData?.().catch(() => {})
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
      {onRefreshData && (
        <VsRow title="Clear cache" desc="Drop the cached ADO and Jira data and re-fetch — keeps profiles, settings, and planner notes">
          <button className="btn sm ghost" onClick={clearCache}>Clear cache</button>
        </VsRow>
      )}
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
              <DesktopPlannerPrefsCard />
              <BoardColumnsCard />
            </>
          )}

          {tab === 'cards' && <CardsAndTablesSettings />}

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
              <DesktopDataSyncCard refreshInterval={refreshInterval} onRefreshIntervalChange={onRefreshIntervalChange} onRefreshData={onRefreshData} />
              <LogsCard />
            </>
          )}

          {tab === 'integrations' && (
            <>
              <AdoConnectionCard onRefreshData={onRefreshData} />
              <JiraConnectionCard onRefreshData={onRefreshData} />
              <WorkItemsDisplayCard />
              <DatabaseConnectionCard />
              <IntegrationsPanel />
            </>
          )}

          {tab === 'desktop' && (
            <>
              <DesktopAppCard />
              {registry.isInstalled('devenv') && <DevenvSettingsCard />}
              {moduleSettingsCards().map(({ id, Card }) => <Card key={id} picker={pickerAdapter} />)}
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
