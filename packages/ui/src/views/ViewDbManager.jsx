// packages/ui/src/views/ViewDbManager.jsx
//
// Database Manager view for NexusMD Desktop.
// Consumes the `dbManager` adapter via the injected `adapters` prop — the same
// pattern used by ViewCalendar, ViewApiClient, etc.
//
// Add to packages/ui/src/index.js:
//   export { ViewDbManager } from './views/ViewDbManager.jsx'
//
// Wire in apps/desktop/src/main.jsx view switch:
//   case 'db-manager': return <ViewDbManager adapters={adapters} />
//
// Wire in apps/desktop/src/nav-config.js:
//   { id: 'db-manager', label: 'Database', icon: 'database' }
//
// Add to packages/ui/src/icons.jsx if 'database' is not already present:
//   database: <path d="M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4Z
//               M4 7v5c0 2.21 3.58 4 8 4s8-1.79 8-4V7M4 12v5c0 2.21 3.58 4 8 4s8-1.79 8-4v-5"/>

import { useState, useRef, useCallback } from 'react'
import {
  resolveConnectionParams,
  buildConfig,
  createInitialState,
  applyConnected,
  applyDisconnected,
  applyTableSelected,
  applyTableLoaded,
  applyRowsDeleted,
  applyCellUpdated,
  applyError,
  buildSearchQuery,
  buildDeleteQuery,
  buildInsertQuery,
} from '@nexusmd/core'
import { PlModal } from '../planner-chips.jsx'

// ─── Demo data (shown when no real DB is connected) ───────────────────────────

const DEMO = {
  type: 'demo',
  config: {},
  tables: ['patients', 'appointments', 'staff'],
  data: {
    patients: {
      columns: ['id', 'name', 'dob', 'status'],
      rows: [
        [1, 'Alice Johnson',  '1985-04-12', 'active'],
        [2, 'Bob Smith',      '1972-09-30', 'inactive'],
        [3, 'Carol White',    '1990-01-08', 'active'],
        [4, 'David Brown',    '1965-11-22', 'pending'],
      ],
    },
    appointments: {
      columns: ['appt_id', 'patient_id', 'date', 'type', 'status'],
      rows: [
        [101, 1, '2024-03-01', 'General',  'confirmed'],
        [102, 3, '2024-03-05', 'Follow-up','completed'],
        [103, 2, '2024-03-10', 'Specialist','cancelled'],
        [104, 4, '2024-03-15', 'General',  'confirmed'],
      ],
    },
    staff: {
      columns: ['staff_id', 'name', 'role', 'department'],
      rows: [
        [1, 'Dr. Sarah Lee',   'Physician',  'General'],
        [2, 'James Okonkwo',   'Nurse',      'Emergency'],
        [3, 'Priya Patel',     'Admin',      'Reception'],
      ],
    },
  },
}

// ─── Root view ────────────────────────────────────────────────────────────────

export function ViewDbManager({ adapters, savedConnections = [], onResolveSecret }) {
  const [dbState, setDbState]         = useState(createInitialState)
  const [activeTab, setActiveTab]     = useState('browse')
  const [search, setSearch]           = useState('')
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [editingCell, setEditingCell] = useState(null)   // { ri, ci } | null
  const [editValue, setEditValue]     = useState('')
  const [sqlQuery, setSqlQuery]       = useState('')
  const [queryTable, setQueryTable]   = useState(null)
  const [queryResult, setQueryResult] = useState(null)
  const [tableColumns, setTableColumns] = useState({})   // { [table]: Column[] }
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [activeBuilder, setActiveBuilder] = useState(null)   // 'search' | 'delete' | null
  const [toast, setToast]             = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [databasesExpanded, setDatabasesExpanded] = useState(true)
  const demoData = useRef(null)

  const db = adapters?.dbManager

  // ── Toast ──────────────────────────────────────────────────────────────────

  const notify = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ── Connect ────────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async (connType, connFields) => {
    if (connType === 'demo') {
      demoData.current = structuredClone(DEMO.data)
      setDbState(s => applyConnected(s, { type: 'demo', config: {}, tables: DEMO.tables }))
      setShowConnectDialog(false)
      notify('Demo database loaded')
      return
    }

    setDbState(s => ({ ...s, loading: true, error: null }))
    try {
      const config = resolveConnectionParams(connType, connFields)
      const result = await db.connect(connType, config)
      setDbState(s => applyConnected(s, { type: connType, config, tables: result.tables }))
      setShowConnectDialog(false)
      notify(`Connected — ${result.tables.length} tables`)
    } catch (err) {
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [db, notify])

  // One-click connect using a connection saved elsewhere (e.g. desktop Settings).
  // Its secret (password or connection string) is resolved on demand via
  // onResolveSecret — the saved metadata passed in never carries the secret itself.
  const handleConnectSaved = useCallback(async (entry) => {
    setDbState(s => ({ ...s, loading: true, error: null }))
    try {
      const secret = (await onResolveSecret?.(entry.id)) || ''
      const config = entry.inputMode === 'connstr'
        ? resolveConnectionParams(entry.type, { connectionString: secret })
        : buildConfig(entry.type, { ...entry, password: secret })
      const result = await db.connect(entry.type, config)
      setDbState(s => applyConnected(s, {
        type: entry.type, config, tables: result.tables,
        connectionId: entry.id, name: entry.name,
      }))
      setShowConnectDialog(false)
      notify(`Connected to ${entry.name} — ${result.tables.length} tables`)
    } catch (err) {
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [db, notify, onResolveSecret])

  // ── Load table ─────────────────────────────────────────────────────────────

  const loadTable = useCallback(async (name) => {
    setSelectedRows(new Set())
    setSearch('')
    setActiveTab('browse')
    setDbState(s => applyTableSelected(s, name))

    try {
      let data
      if (dbState.session?.type === 'demo') {
        data = demoData.current[name]
      } else {
        const { type, config } = dbState.session
        data = await db.getRows(type, config, name)
      }
      setDbState(s => applyTableLoaded(s, data))
    } catch (err) {
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [db, dbState.session, notify])

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filteredRows = useCallback(() => {
    const rows = dbState.tableData?.rows ?? []
    if (!search.trim()) return rows
    const t = search.toLowerCase()
    return rows.filter(row => row.some(c => String(c ?? '').toLowerCase().includes(t)))
  }, [dbState.tableData, search])

  // ── Row selection ──────────────────────────────────────────────────────────

  const toggleRow = (i) => setSelectedRows(prev => {
    const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s
  })
  const toggleAll = () => {
    const rows = filteredRows()
    setSelectedRows(prev => prev.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((_, i) => i)))
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    const rows = filteredRows()
    const toDelete = rows.filter((_, i) => selectedRows.has(i))
    const indices  = [...selectedRows]

    try {
      if (dbState.session?.type === 'demo') {
        setDbState(s => applyRowsDeleted(s, indices))
      } else {
        const { type, config } = dbState.session
        const pk     = dbState.tableData.columns[0]
        const values = toDelete.map(r => r[0])
        await db.deleteRows(type, config, dbState.selectedTable, pk, values)
        setDbState(s => applyRowsDeleted(s, indices))
      }
      setSelectedRows(new Set())
      setShowDeleteConfirm(false)
      notify(`Deleted ${toDelete.length} row${toDelete.length !== 1 ? 's' : ''}`)
    } catch (err) {
      notify(err.message, 'error')
    }
  }, [db, dbState, filteredRows, selectedRows, notify])

  // ── Cell edit ──────────────────────────────────────────────────────────────

  const startEdit = (ri, ci, val) => { setEditingCell({ ri, ci }); setEditValue(String(val ?? '')) }

  const saveEdit = useCallback(async () => {
    if (!editingCell) return
    const { ri, ci } = editingCell
    try {
      if (dbState.session?.type !== 'demo') {
        const { type, config } = dbState.session
        const pk    = dbState.tableData.columns[0]
        const pkVal = dbState.tableData.rows[ri][0]
        const col   = dbState.tableData.columns[ci]
        await db.updateCell(type, config, dbState.selectedTable, pk, pkVal, col, editValue)
      }
      setDbState(s => applyCellUpdated(s, { rowIndex: ri, colIndex: ci, value: editValue }))
      notify('Cell updated')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setEditingCell(null)
    }
  }, [db, dbState, editingCell, editValue, notify])

  // ── Query ──────────────────────────────────────────────────────────────────

  const handleQueryTableSelect = useCallback((name) => {
    setQueryTable(name)
    setSqlQuery(`SELECT * FROM ${name}`)
  }, [])

  const ensureColumnsLoaded = useCallback(async (table) => {
    if (!table || tableColumns[table]) return
    setColumnsLoading(true)
    try {
      if (dbState.session?.type === 'demo') {
        // DEMO.data[table] already has a `columns` array (see lines 43, 52, 61) —
        // treat its first entry as the primary key, matching the real-DB
        // getColumns() shape closely enough for the builders to consume.
        const demoCols = (demoData.current[table]?.columns ?? []).map((name, i) => ({
          name, dataType: 'TEXT', isPrimaryKey: i === 0,
        }))
        setTableColumns(prev => ({ ...prev, [table]: demoCols }))
        return
      }
      const { type, config } = dbState.session
      const result = await db.getColumns(type, config, table)
      setTableColumns(prev => ({ ...prev, [table]: result.columns }))
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setColumnsLoading(false)
    }
  }, [db, dbState.session, tableColumns, notify])

  const toggleBuilder = useCallback(async (name) => {
    setActiveBuilder(prev => (prev === name ? null : name))
    // Mirrors the same `queryTable ?? dbState.selectedTable` fallback QueryPanel
    // displays — without it, opening a builder before ever touching the Query
    // tab's own dropdown would try to load columns for `null`.
    const target = queryTable ?? dbState.selectedTable
    if (activeBuilder !== name) await ensureColumnsLoaded(target)
  }, [activeBuilder, ensureColumnsLoaded, queryTable, dbState.selectedTable])

  const applyBuiltSql = useCallback((sql) => {
    setSqlQuery(sql)
    setActiveBuilder(null)
  }, [])

  const runQuery = useCallback(async () => {
    setQueryResult(null)
    try {
      if (dbState.session?.type === 'demo') {
        const m = sqlQuery.match(/FROM\s+(\w+)/i)
        if (m && demoData.current[m[1]]) {
          setQueryResult({ ...demoData.current[m[1]], affected: null })
        } else {
          setQueryResult({ error: 'Table not found in demo data' })
        }
        return
      }
      const { type, config } = dbState.session
      const result = await db.runQuery(type, config, sqlQuery)
      setQueryResult(result)
    } catch (err) {
      setQueryResult({ error: err.message })
    }
  }, [db, dbState.session, sqlQuery])

  // ── Render ─────────────────────────────────────────────────────────────────

  const rows    = filteredRows()
  const session = dbState.session

  return (
    <div className="view-db-manager">
      {/* Toast */}
      {toast && (
        <div className={`db-toast db-toast--${toast.type}`}>
          <span className={`db-icon db-icon--${toast.type === 'success' ? 'check' : toast.type === 'error' ? 'alert' : 'info'}`} aria-hidden="true" />
          {toast.msg}
        </div>
      )}

      {!session ? (
        <WelcomePane
          onOpenConnect={() => setShowConnectDialog(true)}
          hasAdapter={!!db?.isAvailable?.()}
        />
      ) : (
        <div className="db-layout">
          {/* Sidebar */}
          <aside className="db-sidebar">
            <div className="db-sidebar__header">
              <div className="db-sidebar__status">
                <span className="db-status-dot db-status-dot--connected" />
                <span className="db-sidebar__db-name" title={session.type}>
                  {session.name || (session.type === 'demo' ? 'Demo' : session.config?.database ?? session.config?.filePath?.split('/').pop() ?? 'Connected')}
                </span>
              </div>
              <span className="db-sidebar__meta">{session.tables.length} tables</span>
            </div>

            {/* Databases — one-click switch between saved connections without
                disconnecting first. Collapsible since a long list can crowd
                out the Tables section below it. */}
            {savedConnections.length > 0 && (
              <div className="db-sidebar__section">
                <button
                  className="db-sidebar__section-toggle"
                  onClick={() => setDatabasesExpanded(v => !v)}
                  aria-expanded={databasesExpanded}
                >
                  <span className={`db-icon db-icon--chevron-${databasesExpanded ? 'down' : 'right'}`} aria-hidden="true" />
                  <span className="db-sidebar__section-label">Databases</span>
                </button>
                {databasesExpanded && (
                  <nav className="db-sidebar__databases" aria-label="Databases">
                    {savedConnections.map(entry => (
                      <button
                        key={entry.id}
                        className={`db-database-btn${session.connectionId === entry.id ? ' db-database-btn--active' : ''}`}
                        onClick={() => entry.id !== session.connectionId && handleConnectSaved(entry)}
                        aria-current={session.connectionId === entry.id ? 'page' : undefined}
                      >
                        <span className="db-icon db-icon--database" aria-hidden="true" />
                        <span className="db-database-btn__label">{entry.name}</span>
                      </button>
                    ))}
                  </nav>
                )}
              </div>
            )}

            <div className="db-sidebar__section db-sidebar__section--fill">
              <label className="db-sidebar__section-label" htmlFor="db-sidebar-table-select">Tables</label>
              <TableSelect
                id="db-sidebar-table-select"
                tables={session.tables}
                value={dbState.selectedTable ?? ''}
                onChange={loadTable}
              />
            </div>

            <footer className="db-sidebar__footer">
              <button
                className="db-btn db-btn--ghost db-btn--sm"
                onClick={() => { setDbState(applyDisconnected); demoData.current = null }}
              >
                <span className="db-icon db-icon--disconnect" aria-hidden="true" />
                Disconnect
              </button>
            </footer>
          </aside>

          {/* Main panel */}
          <main className="db-main">
            {!dbState.selectedTable && (
              <div className="db-empty-state">
                <span className="db-icon db-icon--database db-icon--lg" aria-hidden="true" />
                <p>Select a table to get started</p>
              </div>
            )}

            {dbState.tableLoading && (
              <div className="db-empty-state">
                <span className="db-icon db-icon--spinner db-icon--lg" aria-hidden="true" />
                <p>Loading…</p>
              </div>
            )}

            {dbState.selectedTable && dbState.tableData && !dbState.tableLoading && (
              <>
                {/* Table header */}
                <div className="db-panel-header">
                  <div>
                    <h2 className="db-panel-header__title">{dbState.selectedTable}</h2>
                    <span className="db-panel-header__meta">
                      {dbState.tableData.rows.length} rows · {dbState.tableData.columns.length} columns
                    </span>
                  </div>
                  <div className="db-tab-group" role="tablist" aria-label="View mode">
                    {[['browse', 'table', 'Browse'], ['query', 'terminal', 'Query']].map(([id, icon, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={activeTab === id}
                        className={`db-tab${activeTab === id ? ' db-tab--active' : ''}`}
                        onClick={() => setActiveTab(id)}
                      >
                        <span className={`db-icon db-icon--${icon}`} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeTab === 'browse' && (
                  <BrowsePanel
                    tableData={dbState.tableData}
                    rows={rows}
                    search={search}
                    onSearchChange={setSearch}
                    selectedRows={selectedRows}
                    onToggleRow={toggleRow}
                    onToggleAll={toggleAll}
                    onDeleteSelected={() => setShowDeleteConfirm(true)}
                    onDeleteRow={(ri) => { setSelectedRows(new Set([ri])); setShowDeleteConfirm(true) }}
                    editingCell={editingCell}
                    editValue={editValue}
                    onEditValueChange={setEditValue}
                    onStartEdit={startEdit}
                    onSaveEdit={saveEdit}
                    onCancelEdit={() => setEditingCell(null)}
                  />
                )}

                {activeTab === 'query' && (
                  <QueryPanel
                    tables={session.tables}
                    queryTable={queryTable ?? dbState.selectedTable}
                    onSelectTable={handleQueryTableSelect}
                    sqlQuery={sqlQuery}
                    onSqlChange={setSqlQuery}
                    queryResult={queryResult}
                    onRun={runQuery}
                    activeBuilder={activeBuilder}
                    onToggleBuilder={toggleBuilder}
                    columns={tableColumns[queryTable ?? dbState.selectedTable] ?? []}
                    columnsLoading={columnsLoading}
                    onBuildSql={applyBuiltSql}
                  />
                )}
              </>
            )}
          </main>
        </div>
      )}

      {/* Connect dialog */}
      {showConnectDialog && (
        <ConnectDialog
          onConnect={handleConnect}
          savedConnections={savedConnections}
          onConnectSaved={handleConnectSaved}
          onClose={() => setShowConnectDialog(false)}
          loading={dbState.loading}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${selectedRows.size} row${selectedRows.size !== 1 ? 's' : ''}?`}
          body="This action cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

// ─── Welcome pane ─────────────────────────────────────────────────────────────

function WelcomePane({ onOpenConnect, hasAdapter }) {
  return (
    <div className="db-welcome">
      <span className="db-icon db-icon--database db-icon--xl" aria-hidden="true" />
      <h2 className="db-welcome__title">Database Manager</h2>
      <p className="db-welcome__body">
        Browse, edit, and remove data from SQL Server and SQLite databases.
      </p>
      {!hasAdapter && (
        <p className="db-welcome__warning">
          Running outside of the desktop shell — database connections are unavailable.
          Use the demo to explore the interface.
        </p>
      )}
      <button className="db-btn db-btn--primary" onClick={onOpenConnect}>
        <span className="db-icon db-icon--plug" aria-hidden="true" />
        Connect to database
      </button>
    </div>
  )
}

// ─── Connect dialog ───────────────────────────────────────────────────────────

function ConnectDialog({ onConnect, savedConnections = [], onConnectSaved, onClose, loading }) {
  const [dbType, setDbType]       = useState('demo')
  const [inputMode, setInputMode] = useState('fields')
  const [connStr, setConnStr]     = useState('')
  const [fields, setFields]       = useState({
    host: '', port: '1433', database: '', user: '', password: '',
    encrypt: true, trustServerCertificate: false, filePath: '',
  })
  const [connectingId, setConnectingId] = useState(null)

  const setField = (k, v) => setFields(f => ({ ...f, [k]: v }))

  const submit = () => {
    if (dbType === 'demo') { onConnect('demo', {}); return }
    const params = inputMode === 'connstr' ? { connectionString: connStr } : fields
    onConnect(dbType, params)
  }

  const connectSaved = async (entry) => {
    setConnectingId(entry.id)
    try { await onConnectSaved(entry) } finally { setConnectingId(null) }
  }

  const sqlserverPlaceholder = [
    'mssql://username:password@host:1433/database',
    '',
    'or ADO.NET style:',
    'Server=myhost;Database=mydb;User Id=sa;Password=secret;',
  ].join('\n')

  return (
    <PlModal
      open
      onClose={onClose}
      icon="database"
      title="Connect to database"
      wide
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={loading}>
            {loading ? 'Connecting…' : dbType === 'demo' ? 'Load demo' : 'Connect'}
          </button>
        </>
      )}
    >
      {/* Everything below scrolls together as one region (PlModal's own
          .plm-body), so a long saved-connection list never overlaps/clips
          the type selector or form fields beneath it. */}

      {/* Saved connections (configured in Settings → Integrations) */}
      {savedConnections.length > 0 && (
        <div className="db-saved-connections">
          <p className="db-sidebar__section-label">Saved connections</p>
          {savedConnections.map(entry => (
            <button
              key={entry.id}
              className="db-saved-connection-btn"
              onClick={() => connectSaved(entry)}
              disabled={connectingId != null}
            >
              <span className="db-icon db-icon--database" aria-hidden="true" />
              <span className="db-saved-connection-btn__name">{entry.name}</span>
              <span className="db-saved-connection-btn__type">
                {entry.type === 'sqlite' ? 'SQLite' : 'SQL Server'}
              </span>
              {connectingId === entry.id && <span className="db-icon db-icon--spinner" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      {/* Type selector */}
      <div className="db-type-selector" role="group" aria-label="Database type">
        {[['demo', 'database', 'Demo'], ['sqlite', 'file-db', 'SQLite'], ['sqlserver', 'server', 'SQL Server']].map(([id, icon, label]) => (
          <button
            key={id}
            className={`db-type-btn${dbType === id ? ' db-type-btn--active' : ''}`}
            onClick={() => { setDbType(id); setInputMode('fields'); setConnStr('') }}
            aria-pressed={dbType === id}
          >
            <span className={`db-icon db-icon--${icon} db-icon--lg`} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Input mode toggle */}
      {dbType !== 'demo' && (
        <div className="db-tab-group db-tab-group--sm" role="tablist" aria-label="Input mode">
          {[['fields', 'list', 'Fields'], ['connstr', 'terminal', 'Connection string']].map(([m, icon, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={inputMode === m}
              className={`db-tab db-tab--sm${inputMode === m ? ' db-tab--active' : ''}`}
              onClick={() => setInputMode(m)}
            >
              <span className={`db-icon db-icon--${icon}`} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}

      {dbType === 'demo' && (
        <p className="db-hint">Load a demo database with sample medical records — no setup required.</p>
      )}

      {dbType !== 'demo' && inputMode === 'connstr' && (
        <div className="db-field">
          <label className="db-label" htmlFor="db-connstr">
            {dbType === 'sqlite' ? 'File path or connection string' : 'Connection string'}
          </label>
          <textarea
            id="db-connstr"
            className="db-textarea db-textarea--mono"
            value={connStr}
            onChange={e => setConnStr(e.target.value)}
            rows={4}
            placeholder={dbType === 'sqlserver' ? sqlserverPlaceholder : 'sqlite:///absolute/path/to/file.db\nor just: /path/to/file.db'}
          />
        </div>
      )}

      {dbType === 'sqlite' && inputMode === 'fields' && (
        <div className="db-field">
          <label className="db-label" htmlFor="db-filepath">File path</label>
          <input id="db-filepath" className="db-input" type="text" placeholder="/absolute/path/to/file.db"
            value={fields.filePath} onChange={e => setField('filePath', e.target.value)} />
          <p className="db-hint">Path as it appears on the machine running the desktop app.</p>
        </div>
      )}

      {dbType === 'sqlserver' && inputMode === 'fields' && (
        <div className="db-field-grid">
          <div className="db-field db-field--span2">
            <label className="db-label" htmlFor="db-host">Server / Host</label>
            <input id="db-host" className="db-input" type="text" placeholder="myserver.database.windows.net"
              value={fields.host} onChange={e => setField('host', e.target.value)} />
          </div>
          <div className="db-field">
            <label className="db-label" htmlFor="db-port">Port</label>
            <input id="db-port" className="db-input" type="text" placeholder="1433"
              value={fields.port} onChange={e => setField('port', e.target.value)} />
          </div>
          <div className="db-field">
            <label className="db-label" htmlFor="db-database">Database</label>
            <input id="db-database" className="db-input" type="text" placeholder="my_database"
              value={fields.database} onChange={e => setField('database', e.target.value)} />
          </div>
          <div className="db-field">
            <label className="db-label" htmlFor="db-user">Username</label>
            <input id="db-user" className="db-input" type="text" placeholder="sa"
              value={fields.user} onChange={e => setField('user', e.target.value)} />
          </div>
          <div className="db-field">
            <label className="db-label" htmlFor="db-password">Password</label>
            <input id="db-password" className="db-input" type="password"
              value={fields.password} onChange={e => setField('password', e.target.value)} />
          </div>
          <div className="db-field db-field--span2 db-field--row">
            <label className="db-checkbox-label">
              <input type="checkbox" checked={fields.encrypt}
                onChange={e => setField('encrypt', e.target.checked)} />
              Encrypt connection
            </label>
            <label className="db-checkbox-label">
              <input type="checkbox" checked={fields.trustServerCertificate}
                onChange={e => setField('trustServerCertificate', e.target.checked)} />
              Trust server certificate
            </label>
          </div>
        </div>
      )}
    </PlModal>
  )
}

// ─── Browse panel ─────────────────────────────────────────────────────────────

function BrowsePanel({
  tableData, rows, search, onSearchChange,
  selectedRows, onToggleRow, onToggleAll, onDeleteSelected, onDeleteRow,
  editingCell, editValue, onEditValueChange, onStartEdit, onSaveEdit, onCancelEdit,
}) {
  return (
    <div className="db-browse">
      <div className="db-browse__toolbar">
        <div className="db-search-wrap">
          <span className="db-icon db-icon--search" aria-hidden="true" />
          <input
            className="db-input db-search-wrap__input"
            type="search"
            placeholder="Search rows…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            aria-label="Search rows"
          />
        </div>
        {selectedRows.size > 0 && (
          <button className="db-btn db-btn--danger" onClick={onDeleteSelected}>
            <span className="db-icon db-icon--trash" aria-hidden="true" />
            Delete {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''}
          </button>
        )}
        <span className="db-row-count" aria-live="polite">
          {rows.length} {search ? 'matching' : 'total'}
        </span>
      </div>

      <div className="db-table-wrap" role="region" aria-label="Table data">
        <table className="db-table">
          <thead>
            <tr>
              <th className="db-th db-th--check">
                <input
                  type="checkbox"
                  checked={selectedRows.size === rows.length && rows.length > 0}
                  onChange={onToggleAll}
                  aria-label="Select all rows"
                />
              </th>
              {tableData.columns.map(col => (
                <th key={col} className="db-th">{col}</th>
              ))}
              <th className="db-th db-th--actions"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={`db-tr${selectedRows.has(ri) ? ' db-tr--selected' : ''}`}>
                <td className="db-td db-td--check">
                  <input
                    type="checkbox"
                    checked={selectedRows.has(ri)}
                    onChange={() => onToggleRow(ri)}
                    aria-label={`Select row ${ri + 1}`}
                  />
                </td>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="db-td"
                    onDoubleClick={() => onStartEdit(ri, ci, cell)}
                    title="Double-click to edit"
                  >
                    {editingCell?.ri === ri && editingCell?.ci === ci ? (
                      <input
                        className="db-cell-input"
                        autoFocus
                        value={editValue}
                        onChange={e => onEditValueChange(e.target.value)}
                        onBlur={onSaveEdit}
                        onKeyDown={e => {
                          if (e.key === 'Enter') onSaveEdit()
                          if (e.key === 'Escape') onCancelEdit()
                        }}
                        aria-label={`Edit ${tableData.columns[ci]}`}
                      />
                    ) : (
                      <CellValue value={cell} />
                    )}
                  </td>
                ))}
                <td className="db-td db-td--actions">
                  <button
                    className="db-btn db-btn--icon db-btn--muted"
                    onClick={() => onDeleteRow(ri)}
                    aria-label={`Delete row ${ri + 1}`}
                  >
                    <span className="db-icon db-icon--trash" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={tableData.columns.length + 2} className="db-td db-td--empty">
                  No rows match your search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="db-browse__hint">
        Double-click any cell to edit · Check rows then delete to remove them
      </div>
    </div>
  )
}

// ─── Query panel ──────────────────────────────────────────────────────────────

function QueryPanel({
  tables, queryTable, onSelectTable, sqlQuery, onSqlChange, queryResult, onRun,
  activeBuilder, onToggleBuilder, columns, columnsLoading, onBuildSql,
}) {
  return (
    <div className="db-query">
      <div className="db-query__editor">
        <div className="db-field">
          <label className="db-label" htmlFor="db-query-table-select">Table</label>
          <TableSelect
            id="db-query-table-select"
            tables={tables}
            value={queryTable ?? ''}
            onChange={onSelectTable}
          />
        </div>
        <QueryCommandToolbar
          activeBuilder={activeBuilder}
          onToggle={onToggleBuilder}
          disabled={!queryTable}
        />
        <QueryBuilderPanel
          activeBuilder={activeBuilder}
          table={queryTable}
          columns={columns}
          columnsLoading={columnsLoading}
          onBuild={onBuildSql}
          onCancel={() => onToggleBuilder(activeBuilder)}
        />
        <textarea
          className="db-textarea db-textarea--mono db-textarea--query"
          value={sqlQuery}
          onChange={e => onSqlChange(e.target.value)}
          placeholder={'SELECT * FROM patients\nWHERE status = \'active\''}
          rows={6}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onRun() }}
          aria-label="SQL query"
          spellCheck={false}
        />
        <div className="db-query__toolbar">
          <span className="db-hint">Ctrl+Enter to run</span>
          <button className="db-btn db-btn--primary" onClick={onRun}>
            <span className="db-icon db-icon--play" aria-hidden="true" />
            Run query
          </button>
        </div>
      </div>

      {queryResult && (
        <div className="db-query__results">
          {queryResult.error ? (
            <div className="db-callout db-callout--error">
              <span className="db-icon db-icon--alert" aria-hidden="true" />
              {queryResult.error}
            </div>
          ) : queryResult.columns?.length > 0 ? (
            <>
              <p className="db-hint">{queryResult.rows.length} rows returned</p>
              <div className="db-table-wrap">
                <table className="db-table">
                  <thead>
                    <tr>{queryResult.columns.map(c => <th key={c} className="db-th">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, i) => (
                      <tr key={i} className="db-tr">
                        {row.map((cell, j) => <td key={j} className="db-td"><CellValue value={cell} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="db-callout db-callout--success">
              <span className="db-icon db-icon--check" aria-hidden="true" />
              {queryResult.affected != null
                ? `${queryResult.affected} row${queryResult.affected !== 1 ? 's' : ''} affected`
                : 'Query executed'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function CellValue({ value }) {
  if (value === null || value === undefined) {
    return <span className="db-cell--null">null</span>
  }
  return <span>{String(value)}</span>
}

// ─── Table select (shared: sidebar + Query tab) ───────────────────────────────

function TableSelect({ id, tables, value, onChange, placeholder = 'Select a table…' }) {
  return (
    <select
      id={id}
      aria-label="Tables"
      className="db-input db-table-select"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="" disabled>{placeholder}</option>
      {tables.map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  )
}

// ─── Query command toolbar + builder panel ─────────────────────────────────────

const COMMANDS = [
  ['search', 'Search'], ['insert', 'Insert'], ['update', 'Update'],
  ['delete', 'Delete'], ['join', 'Join'], ['aggregate', 'Aggregate'],
]

function QueryCommandToolbar({ activeBuilder, onToggle, disabled }) {
  return (
    <div className="db-query__toolbar db-query__command-toolbar" role="group" aria-label="Query commands">
      {COMMANDS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`db-btn db-btn--sm${activeBuilder === id ? ' db-btn--active' : ''}`}
          onClick={() => onToggle(id)}
          disabled={disabled}
          title={disabled ? 'Select a table first' : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const OPERATORS = ['=', '!=', '>', '<', 'LIKE', 'IS NULL']

function ConditionRow({ columns, condition, onChange }) {
  return (
    <div className="db-condition-row">
      <select
        aria-label="Column"
        className="db-input"
        value={condition.column}
        onChange={e => onChange({ ...condition, column: e.target.value })}
      >
        <option value="" disabled>Column…</option>
        {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      <select
        aria-label="Operator"
        className="db-input"
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value })}
      >
        {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      {condition.operator !== 'IS NULL' && (
        <input
          aria-label="Value"
          className="db-input"
          type="text"
          value={condition.value}
          onChange={e => onChange({ ...condition, value: e.target.value })}
        />
      )}
    </div>
  )
}

function BuilderFooter({ onBuild, onCancel, buildDisabled }) {
  return (
    <div className="db-builder__footer">
      <button type="button" className="db-btn db-btn--ghost" onClick={onCancel}>Cancel</button>
      <button type="button" className="db-btn db-btn--primary" onClick={onBuild} disabled={buildDisabled}>
        Build
      </button>
    </div>
  )
}

function SearchBuilder({ table, columns, onBuild, onCancel }) {
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const valid = conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="db-btn db-btn--ghost db-btn--sm"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildSearchQuery(table, conditions.filter(c => c.column)))}
      />
    </div>
  )
}

function DeleteBuilder({ table, columns, onBuild, onCancel }) {
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const valid = conditions.length > 0
    && conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="db-btn db-btn--ghost db-btn--sm"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildDeleteQuery(table, conditions.filter(c => c.column)))}
      />
    </div>
  )
}

function InsertBuilder({ table, columns, onBuild, onCancel }) {
  const [values, setValues] = useState({})   // { [colName]: string }
  const [included, setIncluded] = useState(() => new Set())

  const toggle = (name) => setIncluded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const valid = included.size > 0

  return (
    <div className="db-builder">
      {columns.map(col => (
        <div key={col.name} className="db-condition-row">
          <label className="db-checkbox-label">
            <input
              type="checkbox"
              aria-label={`Include ${col.name}`}
              checked={included.has(col.name)}
              onChange={() => toggle(col.name)}
            />
            {col.name}
          </label>
          {included.has(col.name) && (
            <input
              aria-label={`Value for ${col.name}`}
              className="db-input"
              type="text"
              value={values[col.name] ?? ''}
              onChange={e => setValues(v => ({ ...v, [col.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildInsertQuery(
          table,
          columns.filter(c => included.has(c.name)).map(c => ({ name: c.name, value: values[c.name] })),
        ))}
      />
    </div>
  )
}

function QueryBuilderPanel({ activeBuilder, table, columns, columnsLoading, onBuild, onCancel }) {
  if (!activeBuilder) return null
  if (columnsLoading) return <p className="db-hint">Loading columns…</p>

  const props = { table, columns, onBuild, onCancel }
  if (activeBuilder === 'search') return <SearchBuilder {...props} />
  if (activeBuilder === 'delete') return <DeleteBuilder {...props} />
  if (activeBuilder === 'insert') return <InsertBuilder {...props} />
  return null
}

function ConfirmDialog({ title, body, confirmLabel, confirmVariant, onConfirm, onCancel }) {
  return (
    <div className="db-dialog-backdrop" onClick={onCancel}>
      <div className="db-dialog db-dialog--sm" role="alertdialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="db-dialog__header">
          <h2 className="db-dialog__title">{title}</h2>
        </div>
        <div className="db-dialog__body">
          <p className="db-hint">{body}</p>
        </div>
        <div className="db-dialog__footer">
          <button className="db-btn db-btn--ghost" onClick={onCancel}>Cancel</button>
          <button className={`db-btn db-btn--${confirmVariant}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
