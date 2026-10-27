import React from 'react'
import { Icon, CardFrame, VsSeg, SettField } from '@nexusmd/ui'
import { buildConfig, resolveConnectionParams, buildConnectionString, connectionStringToFields, SQL_AUTH, AZURE_AD_INTERACTIVE } from '@nexusmd/core'
import { dbManagerAdapter } from './db-manager-adapter.js'
import { listSavedConnections, saveConnection, getConnectionSecret, deleteConnection } from './db-manager-config.js'

// Text inputs in the connection form.
const settInputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
  color: 'var(--text)', boxSizing: 'border-box',
}

const DB_TYPES = [['sqlserver', 'SQL Server'], ['sqlite', 'SQLite']]

const DB_INPUT_MODES = [['fields', 'Fields'], ['connstr', 'Connection string']]

const DB_AUTH_MODES = [[SQL_AUTH, 'SQL login'], [AZURE_AD_INTERACTIVE, 'Entra ID (Azure AD) interactive']]

// One saved connection's editor — used both for "Add connection" (initial === null)
// and "Edit" (initial === the saved metadata, no secret included).
function ConnectionForm({ initial, onSaved, onCancel, secureStorage }) {
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
      const secret = await getConnectionSecret(secureStorage, initial.id)
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
      const cs = connStr.trim() || (initial ? await getConnectionSecret(secureStorage, initial.id) : '')
      if (!cs) throw new Error('Enter a connection string first.')
      return resolveConnectionParams(dbType, { connectionString: cs })
    }
    const pwd = password || (initial ? await getConnectionSecret(secureStorage, initial.id) : '')
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
      await saveConnection(secureStorage, meta, secret)
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

// host.adapters.secureStorage holds the saved passwords.
export function DatabaseConnectionCard({ host }) {
  const secureStorage = host.adapters.secureStorage
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
      const secret = await getConnectionSecret(secureStorage, entry.id)
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
    await deleteConnection(secureStorage, id)
    refresh()
  }

  const cloneRow = async (entry) => {
    setRowStatus(s => ({ ...s, [entry.id]: 'Cloning…' }))
    try {
      const secret = await getConnectionSecret(secureStorage, entry.id)
      const { id, ...meta } = entry
      await saveConnection(secureStorage, { ...meta, name: `${entry.name} (copy)` }, secret)
      refresh()
    } catch (e) {
      setRowStatus(s => ({ ...s, [entry.id]: 'Error: ' + e.message }))
    }
  }

  if (formState) {
    return (
      <ConnectionForm
        secureStorage={secureStorage}
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

