// packages/ui/src/views/ViewDbManager.jsx
//
// Database Manager view for NexusMD Desktop, laid out like the Git Workspace: a header with the
// connection tabs and a table filter, a table list beside the details, and an overview when no
// table is open. Consumes the `dbManager` adapter via the injected `adapters` prop.
//
// Keys (only while this view is showing and no dialog is open):
//   Ctrl/⌘K jump to table · / filter tables · j / k next / previous table · Ctrl/⌘F search rows
//   b Browse · s Structure · q Query · r refresh the open table · Ctrl/⌘Enter run the query
//   Alt+← back to where a followed key came from

import { useState, useRef, useCallback, useEffect, useMemo, forwardRef } from 'react'
import {
  resolveConnectionParams,
  buildConfig,
  createInitialState,
  applyConnected,
  applyTableSelected,
  applyTableLoaded,
  applyRowsDeleted,
  applyCellUpdated,
  applyError,
  buildSearchQuery,
  buildDeleteQuery,
  buildInsertQuery,
  buildUpdateQuery,
  buildJoinQuery,
  buildAggregateQuery,
  SQL_AUTH,
  AZURE_AD_INTERACTIVE,
  connectionStringToFields,
  normalizeTablePrefs,
  toggleTableStarred,
  toggleTableHidden,
  setTableGroup,
  renameTableGroup,
  removeTableGroup,
  toggleSectionCollapsed,
  tableSections,
  quoteTable,
  columnTypes,
  validateTableSpec,
  buildCreateTable,
  buildCreateView,
  buildDropStatement,
  columnKind,
  isPartialInput,
  cellToInput,
  parseCellInput,
  followTargets,
  referencingTargets,
  buildInsertStatements,
  whereLabel,
} from '@nexusmd/core'
import { PlModal } from '../planner-chips.jsx'
import { Icon } from '../icons.jsx'
import { FoldAllButton } from '../fold-all-button.jsx'
import { DbMenu, menuPointFor } from './db-menu.jsx'
import { readMinCols, writeMinCols } from './db-min-cols.js'
import { pushNav, popNav } from './db-nav.js'
import { headerMenuItems, rowMenuItems } from './db-grid-menus.js'
import { StructurePanel, typeLabelOf } from './db-structure-panel.jsx'

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

// ─── Small helpers ────────────────────────────────────────────────────────────

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
const typeLabel = t => (t === 'sqlite' ? 'SQLite' : t === 'sqlserver' ? 'SQL Server' : t === 'demo' ? 'Demo' : t)
const clock = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function sessionName(session) {
  if (!session) return ''
  if (session.name) return session.name
  if (session.type === 'demo') return 'Demo'
  return session.config?.database || session.config?.filePath?.split(/[\\/]/).pop() || typeLabel(session.type)
}

// Starred tables are remembered per connection.
const connectionKey = s => (s ? s.connectionId || `${s.type}:${s.config?.server ?? ''}/${s.config?.database ?? s.config?.filePath ?? ''}` : '')
function readPref(key, fallback) {
  try { const v = window.localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
}
function writePref(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

// How a connection's table list is arranged (favourites, hidden tables, groups, folded sections).
// Stars saved before groups existed are picked up from their old key.
const tablePrefsKey = conn => `nx-db:tables:${conn}`
function readTablePrefs(conn) {
  const saved = readPref(tablePrefsKey(conn), null)
  return normalizeTablePrefs(saved ?? { starred: readPref(`nx-db:starred:${conn}`, []) })
}

const isNumeric = v => typeof v === 'number' || typeof v === 'bigint'
// Nulls sort last; numbers numerically; everything else as natural text.
function compareCells(a, b) {
  const an = a === null || a === undefined, bn = b === null || b === undefined
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  if (isNumeric(a) && isNumeric(b)) return a < b ? -1 : a > b ? 1 : 0
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function toCsv(columns, rows) {
  const cell = v => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    // Spreadsheets run text that starts like a formula; a leading quote keeps it text.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
}

function downloadCsv(name, columns, rows) {
  try {
    const url = URL.createObjectURL(new Blob([toCsv(columns, rows)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` })
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch { return false }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}


// Word-start matching, like the Git Workspace filter: "pat app" finds "patient_appointments".
function matchesWords(text, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const words = text.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])/).filter(Boolean)
  const flat = text.toLowerCase()
  return terms.every(t => words.some(w => w.startsWith(t)) || flat.includes(t))
}

// ─── Saved queries ────────────────────────────────────────────────────────────
// Kept in this browser profile. A query saved "for any table" stores {table} where the table
// name was, and runs against whichever table is open; the others belong to their connection.
const SAVED_KEY = 'nx-db:saved-queries'
const TABLE_TOKEN = '{table}'
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The table name as a whole identifier, bare or quoted ([t], "t", `t`), and a schema table as
// quoteTable writes it ([schema].[t]).
const tableRe = t => {
  const parts = quoteTable(t) === `[${t}]` ? '' : `${escapeRe(quoteTable(t))}|`
  return new RegExp(`(${parts}\\[${escapeRe(t)}\\]|"${escapeRe(t)}"|\`${escapeRe(t)}\`|(?<![\\w.])${escapeRe(t)}(?![\\w]))`, 'g')
}
const mentionsTable = (sql, table) => !!table && tableRe(table).test(sql)
const toTemplate = (sql, table) => sql.replace(tableRe(table), m => (m === quoteTable(table) ? TABLE_TOKEN : m.replace(table, TABLE_TOKEN)))
// Names always go in square brackets (SQL Server and SQLite both read them), so a reserved word
// such as Key, a space or a quote can never end the statement. A token already inside quotes only
// needs the quote character escaped.
function fillTemplate(sql, table) {
  return sql.split(TABLE_TOKEN).map((part, i, all) => {
    if (i === all.length - 1) return part
    const before = part.slice(-1), after = all[i + 1].slice(0, 1)
    if (!['[]', '""', '``'].includes(before + after)) return part + quoteTable(table)
    const q = before === '[' ? /]/g : before === '`' ? /`/g : /"/g
    return part + table.replace(q, m => m + m)
  }).join('')
}
const isTemplate = q => q.sql.includes(TABLE_TOKEN)

// Asked about before running: schema changes, and DELETE / UPDATE with no WHERE.
const RISKY_STATEMENT = /^\s*(drop|truncate|alter)\b|^\s*(delete|update)\b(?![\s\S]*\bwhere\b)/i
// Every statement is checked, not just the first: "select 1; drop table x" still asks.
const RISKY_SQL = { test: sql => sql.split(';').some(st => RISKY_STATEMENT.test(st)) }
const MUTATING_SQL = /^\s*(insert|update|delete|merge|drop|truncate|alter|create)\b/i

const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
const overlayOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"]')

// The page's keys. Views stay mounted (hidden) when the user navigates away, so a key only
// counts while the page is actually on screen.
function useDbShortcuts(rootRef, handlers) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    const onKey = e => {
      const root = rootRef.current
      if (!root || !root.getClientRects().length || e.defaultPrevented || e.isComposing) return
      const h = ref.current
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (mod && !e.altKey && !e.shiftKey) {
        const fn = key === 'k' ? h.jump : key === 'f' ? h.findRows : null
        if (!fn || overlayOpen()) return
        e.preventDefault()
        fn()
        return
      }
      if (e.altKey && !mod && !e.shiftKey && key === 'ArrowLeft') {
        if (!h.back || typing(e.target) || overlayOpen()) return
        e.preventDefault()
        h.back()
        return
      }
      if (mod || e.altKey || e.shiftKey || typing(e.target) || overlayOpen()) return
      const map = { '/': h.focusFilter, j: h.next, k: h.previous, b: h.browse, s: h.structure, q: h.query, r: h.refresh }
      const fn = Object.hasOwn(map, key) ? map[key] : null
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rootRef])
}

// ─── Root view ────────────────────────────────────────────────────────────────
// Several connections can be open at once, one tab each. Every open connection keeps its own
// DbSession mounted (only the active one shows), so switching tabs keeps the open table, the
// query, its history and the filters.

// Identifies an open connection, so connecting to one that's already open just switches to it.
function sessionKey({ type, config, connectionId }) {
  if (connectionId) return `saved:${connectionId}`
  if (type === 'demo') return 'demo'
  if (type === 'sqlite') return `sqlite:${config.filePath}`
  return `sqlserver:${config.server}:${config.port}/${config.database}/${config.user ?? ''}/${config.authentication ?? ''}`
}

// The saved connections that were open (and which was showing), so they reopen next time.
const OPEN_KEY = 'nx-db:open-connections'

// What a connection saved from the connect dialog keeps: the same metadata Settings saves, with
// the password (or the whole connection string, which may hold one) kept apart as the secret.
function connectionToSave(type, fields, name) {
  if (fields.connectionString?.trim()) {
    return { meta: { name, type, inputMode: 'connstr' }, secret: fields.connectionString.trim() }
  }
  const { host = '', port = '', database = '', user = '', filePath = '', encrypt = true, trustServerCertificate = false, authentication = SQL_AUTH } = fields
  const meta = { name, type, inputMode: 'fields', host, port, database, user, filePath, encrypt, trustServerCertificate, authentication }
  // Interactive sign-in has no password to keep.
  return { meta, secret: authentication === AZURE_AD_INTERACTIVE ? '' : (fields.password || '') }
}

export function ViewDbManager({ adapters, savedConnections = [], onResolveSecret, onSaveConnection }) {
  const [sessions, setSessions]       = useState([])          // { key, type, config, tables, connectionId?, name? }, in tab order
  const [activeKey, setActiveKey]     = useState(null)
  const [connecting, setConnecting]   = useState(null)        // saved connection id, 'new', or null
  // Saved connections that were open last time but sign in through the browser, so they wait
  // for a click rather than open a sign-in window on their own.
  const [deferred, setDeferred]       = useState([])
  const [restoring, setRestoring]     = useState(false)
  const restored = useRef(false)
  const restoringRef = useRef(false)
  const [toast, setToast]             = useState(null)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [connectError, setConnectError] = useState(null)
  const toastTimer = useRef(null)
  const dialogOpen = useRef(false)
  dialogOpen.current = showConnectDialog
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const db = adapters?.dbManager

  // ── Toast ──────────────────────────────────────────────────────────────────

  const notify = useCallback((msg, type = 'success') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, type, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 7000 : 3000)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // A connect failure shows inside the connect dialog when it's open, else as a toast.
  const connectFailed = useCallback((message) => {
    if (dialogOpen.current) setConnectError(message)
    else notify(message, 'error')
  }, [notify])

  // ── Connect ────────────────────────────────────────────────────────────────

  // Switches to the connection if it's already open; returns whether it was.
  const focusOpen = useCallback((key) => {
    if (!sessionsRef.current.some(s => s.key === key)) return false
    setActiveKey(key)
    setShowConnectDialog(false)
    setConnectError(null)
    return true
  }, [])

  const addSession = useCallback((next) => {
    const key = sessionKey(next)
    setSessions(list => (list.some(s => s.key === key) ? list : [...list, { ...next, key }]))
    setActiveKey(key)
    setShowConnectDialog(false)
    setConnectError(null)
  }, [])

  // `saveAs` ({ name }) also saves the connection, so it shows with the saved ones and reopens next time.
  const handleConnect = useCallback(async (connType, connFields, saveAs = null) => {
    setConnectError(null)
    if (connType === 'demo') {
      if (focusOpen('demo')) return
      addSession({ type: 'demo', config: {}, tables: DEMO.tables })
      notify('Demo database loaded')
      return
    }

    try {
      const config = resolveConnectionParams(connType, connFields)
      if (!saveAs && focusOpen(sessionKey({ type: connType, config }))) return
      setConnecting('new')
      const result = await db.connect(connType, config)
      const tables = plural(result.tables.length, 'table')
      if (!saveAs || !onSaveConnection) {
        addSession({ type: connType, config, tables: result.tables, views: result.views ?? [] })
        notify(`Connected · ${tables}`)
        return
      }
      // Saving under a name that's already saved replaces that connection.
      const { meta, secret } = connectionToSave(connType, connFields, saveAs.name)
      const same = savedConnections.find(c => c.name.toLowerCase() === saveAs.name.toLowerCase())
      try {
        const id = await onSaveConnection(same ? { ...meta, id: same.id } : meta, secret)
        if (focusOpen(sessionKey({ connectionId: id }))) return
        addSession({ type: connType, config, tables: result.tables, views: result.views ?? [], connectionId: id, name: saveAs.name })
        notify(`Connected and saved as ${saveAs.name} · ${tables}`)
      } catch (err) {
        addSession({ type: connType, config, tables: result.tables, views: result.views ?? [] })
        notify(`Connected, but couldn't save it: ${err.message}`, 'error')
      }
    } catch (err) {
      connectFailed(err.message)
    } finally {
      setConnecting(null)
    }
  }, [db, notify, focusOpen, addSession, connectFailed, onSaveConnection, savedConnections])

  // A saved connection's config, with its secret (password or connection string) resolved on
  // demand via onResolveSecret — the saved metadata passed in never carries the secret itself.
  const configFor = useCallback(async (entry) => {
    const secret = (await onResolveSecret?.(entry.id)) || ''
    return entry.inputMode === 'connstr'
      ? resolveConnectionParams(entry.type, { connectionString: secret })
      : buildConfig(entry.type, { ...entry, password: secret })
  }, [onResolveSecret])

  // One-click connect using a connection saved elsewhere (e.g. desktop Settings).
  const handleConnectSaved = useCallback(async (entry) => {
    setConnectError(null)
    if (focusOpen(sessionKey({ connectionId: entry.id }))) return
    setConnecting(entry.id)
    try {
      const config = await configFor(entry)
      const result = await db.connect(entry.type, config)
      addSession({ type: entry.type, config, tables: result.tables, views: result.views ?? [], connectionId: entry.id, name: entry.name })
      setDeferred(d => d.filter(id => id !== entry.id))
      notify(`Connected to ${entry.name} · ${plural(result.tables.length, 'table')}`)
    } catch (err) {
      connectFailed(err.message)
    } finally {
      setConnecting(null)
    }
  }, [db, notify, configFor, focusOpen, addSession, connectFailed])

  // ── Reopen what was open last time ─────────────────────────────────────────
  // Saved connections only: one-off ones and the demo start fresh. Each reconnects in its old
  // place; one that fails is reported and left closed.
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const last = readPref(OPEN_KEY, null)
    const entries = (Array.isArray(last?.ids) ? last.ids : [])
      .map(id => savedConnections.find(c => c.id === id)).filter(Boolean)
    if (!entries.length || !db?.isAvailable?.()) return
    // Set straight away (state only lands next render), so the list isn't saved over as empty meanwhile.
    restoringRef.current = true
    setRestoring(true)
    ;(async () => {
      const results = await Promise.all(entries.map(async (entry) => {
        try {
          const config = await configFor(entry)
          if (config.authentication === AZURE_AD_INTERACTIVE) return { entry, deferred: true }
          const result = await db.connect(entry.type, config)
          return { entry, session: { type: entry.type, config, tables: result.tables, views: result.views ?? [], connectionId: entry.id, name: entry.name } }
        } catch (err) {
          return { entry, error: err.message }
        }
      }))
      const reopened = results.filter(r => r.session).map(r => ({ ...r.session, key: sessionKey(r.session) }))
      setSessions(list => [...reopened.filter(s => !list.some(x => x.key === s.key)), ...list])
      setActiveKey(key => key ?? (reopened.find(s => s.connectionId === last.active) ?? reopened[0])?.key ?? null)
      setDeferred(results.filter(r => r.deferred).map(r => r.entry.id))
      const failed = results.filter(r => r.error)
      if (failed.length) notify(`Couldn't reopen ${failed.map(r => r.entry.name).join(', ')}: ${failed[0].error}`, 'error')
      restoringRef.current = false
      setRestoring(false)
    })()
  }, [db, savedConnections, configFor, notify])

  // Remembers the open saved connections (and any still waiting to sign in) for next time.
  useEffect(() => {
    if (restoringRef.current || !restored.current) return
    const ids = [...new Set([...sessions.map(s => s.connectionId).filter(Boolean), ...deferred])]
    writePref(OPEN_KEY, { ids, active: sessions.find(s => s.key === activeKey)?.connectionId ?? null })
  }, [sessions, activeKey, deferred, restoring])

  const forgetDeferred = useCallback(id => setDeferred(d => d.filter(x => x !== id)), [])

  // Closing the active tab moves to its neighbour; closing the last one shows the welcome pane.
  const closeSession = useCallback((key) => {
    const list = sessionsRef.current
    const i = list.findIndex(s => s.key === key)
    if (i === -1) return
    const rest = list.filter(s => s.key !== key)
    setSessions(rest)
    setActiveKey(active => (active !== key ? active : (rest[Math.min(i, rest.length - 1)]?.key ?? null)))
  }, [])

  const openConnectDialog = useCallback(() => { setConnectError(null); setShowConnectDialog(true) }, [])

  // ── Editing a saved connection ─────────────────────────────────────────────
  // The connect form, filled from the saved entry and its secret. Saving keeps the same id, so
  // Settings and any open tab follow; an open connection reconnects with the new settings, and one
  // that can't is closed with the reason rather than left open on the old ones.
  const [editing, setEditing] = useState(null)                // { entry, secret } | null
  const openEdit = useCallback(async (entry) => {
    setConnectError(null)
    setEditing({ entry, secret: (await onResolveSecret?.(entry.id)) || '' })
  }, [onResolveSecret])

  const handleSaveEdit = useCallback(async (entry, connType, connFields, name) => {
    setConnectError(null)
    let config
    try {
      config = resolveConnectionParams(connType, connFields)
      const { meta, secret } = connectionToSave(connType, connFields, name)
      await onSaveConnection({ ...meta, id: entry.id }, secret)
    } catch (err) {
      setConnectError(err.message)
      return
    }
    setEditing(null)
    const key = sessionKey({ connectionId: entry.id })
    if (!sessionsRef.current.some(s => s.key === key)) { notify(`Saved ${name}`); return }
    setConnecting(entry.id)
    try {
      const result = await db.connect(connType, config)
      setSessions(list => list.map(s => (s.key === key ? { ...s, type: connType, config, name, tables: result.tables, views: result.views ?? [], generation: (s.generation ?? 0) + 1 } : s)))
      notify(`Saved and reconnected ${name} · ${plural(result.tables.length, 'table')}`)
    } catch (err) {
      closeSession(key)
      notify(`Saved ${name}, but couldn't reconnect: ${err.message}`, 'error')
    } finally {
      setConnecting(null)
    }
  }, [db, notify, onSaveConnection, closeSession])

  const tabs = (
    <ConnectionTabs
      sessions={sessions}
      activeKey={activeKey}
      savedConnections={savedConnections}
      connectingId={connecting}
      onSelect={setActiveKey}
      onOpenSaved={handleConnectSaved}
      onClose={closeSession}
      deferred={deferred}
      onForget={forgetDeferred}
      onNew={openConnectDialog}
      onEdit={onSaveConnection ? openEdit : null}
    />
  )

  return (
    <div className="view-db-manager nx-db-page">
      {!sessions.length ? (
        <WelcomePane
          onOpenConnect={openConnectDialog}
          onDemo={() => handleConnect('demo', {})}
          savedConnections={savedConnections}
          onConnectSaved={handleConnectSaved}
          connectingId={showConnectDialog ? null : connecting}
          hasAdapter={!!db?.isAvailable?.()}
          restoring={restoring}
          deferred={deferred}
        />
      ) : sessions.map(s => (
        <DbSession
          // A reconnect after an edit may be another database: its view starts afresh.
          key={`${s.key}:${s.generation ?? 0}`}
          session={s}
          active={s.key === activeKey}
          db={db}
          tabs={tabs}
          connecting={connecting != null}
          notify={notify}
          onDisconnect={() => closeSession(s.key)}
        />
      ))}

      {/* Toast */}
      {toast && (
        <div key={toast.id} className="nx-db-toast" data-tone={toast.type} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span className="nx-db-dot" data-tone={toast.type === 'success' ? 'ok' : toast.type === 'error' ? 'bad' : 'info'} />
          <span className="msg">{toast.msg}</span>
          <button type="button" className="nx-db-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="x" size={12} /></button>
        </div>
      )}

      {/* Connect dialog */}
      {showConnectDialog && (
        <ConnectDialog
          onConnect={handleConnect}
          savedConnections={savedConnections}
          onConnectSaved={handleConnectSaved}
          openConnectionIds={sessions.map(s => s.connectionId).filter(Boolean)}
          onClose={() => { setShowConnectDialog(false); setConnectError(null) }}
          loading={connecting != null}
          error={connectError}
          canSave={!!onSaveConnection}
        />
      )}

      {editing && (
        <ConnectDialog
          editing={editing}
          editingOpen={sessions.some(s => s.connectionId === editing.entry.id)}
          onSaveEdit={(type, fields, name) => handleSaveEdit(editing.entry, type, fields, name)}
          savedConnections={savedConnections}
          onClose={() => { setEditing(null); setConnectError(null) }}
          loading={connecting != null}
          error={connectError}
          canSave
        />
      )}
    </div>
  )
}

// ─── One open connection ──────────────────────────────────────────────────────

function DbSession({ session: openedSession, active, db, tabs, connecting, notify, onDisconnect }) {
  const [dbState, setDbState]         = useState(() => applyConnected(createInitialState(), openedSession))
  const [activeTab, setActiveTab]     = useState('browse')
  const [search, setSearch]           = useState('')
  const [sort, setSort]               = useState(null)        // { col, dir: 'asc' | 'desc' } | null
  const [selectedRows, setSelectedRows] = useState(new Set()) // indices into tableData.rows
  const [editingCell, setEditingCell] = useState(null)        // { ri, ci } | null — ri indexes tableData.rows
  const [editValue, setEditValue]     = useState('')
  const [sqlQuery, setSqlQuery]       = useState('')
  const [queryTable, setQueryTable]   = useState(null)
  const [queryResult, setQueryResult] = useState(null)
  const [queryRunning, setQueryRunning] = useState(false)
  const [queryHistory, setQueryHistory] = useState([])        // newest first: { sql, at, ok, summary }
  const [savedQueries, setSavedQueries] = useState(() => readPref(SAVED_KEY, [])) // { id, name, sql, conn | null, at }
  const [tableColumns, setTableColumns] = useState({})        // { [table]: Column[] }
  const [columnsFailed, setColumnsFailed] = useState({})      // { [table]: true } once its column types couldn't be read
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [structures, setStructures]   = useState({})          // { [table]: { columns, foreignKeys, referencedBy, indexes } }
  const [structureState, setStructureState] = useState({})    // { [table]: { loading } | { error } }
  const [rowWhere, setRowWhere]       = useState(null)        // [{ column, value }] the open table is filtered to, or null
  const [navStack, setNavStack]       = useState([])          // where Back goes: { table, where, search, sort, scrollTop }
  const [nullFilter, setNullFilter]   = useState(null)        // { col, empty }: only the loaded rows whose col is (or isn't) NULL
  const [structureFocus, setStructureFocus] = useState(null)  // the foreign key Structure scrolls to and marks
  const [activeBuilder, setActiveBuilder] = useState(null)    // 'search' | 'insert' | 'update' | 'delete' | 'join' | 'aggregate' | null
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [tableFilter, setTableFilter] = useState('')
  const [listFilter, setListFilter]   = useState('all')       // all | starred | opened | hidden
  const [listHidden, setListHidden]   = useState(() => readPref('nx-db:list-hidden', false))
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Favourites, hidden tables, the user's groups and folded sections, kept for this connection.
  const [prefs, setPrefs]             = useState(() => readTablePrefs(connectionKey(openedSession)))
  const [recent, setRecent]           = useState([])          // tables opened this session, newest first
  const [tableMeta, setTableMeta]     = useState({})          // { [table]: { rows, cols, at } }
  // Each demo tab edits its own copy of the sample data.
  const demoData   = useRef(openedSession.type === 'demo' ? structuredClone(DEMO.data) : null)
  const rootRef    = useRef(null)
  const filterRef  = useRef(null)
  const rowSearchRef = useRef(null)
  const gridRef    = useRef(null)
  const pendingScroll = useRef(null)                          // a scroll position to put back once the rows show
  const loadSeq    = useRef(0)
  const columnsRef = useRef(tableColumns)
  columnsRef.current = tableColumns
  const structuresRef = useRef(structures)
  structuresRef.current = structures

  const session = dbState.session
  const isDemo = session?.type === 'demo'

  // The Saved / Recent / Run saved menus close on a click elsewhere, on Esc, or when another opens.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const close = keep => root.querySelectorAll('details.nx-db-history[open]').forEach(d => { if (d !== keep) d.open = false })
    const onDown = e => close(e.target.closest?.('details.nx-db-history'))
    const onKey = e => { if (e.key === 'Escape' && root.querySelector('details.nx-db-history[open]')) { close(null) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [])

  // Re-reads the table list (a table created from the Query tab shows up).
  const refreshTables = useCallback(async () => {
    if (!session || isDemo) return
    try {
      const result = await db.connect(session.type, session.config)
      setDbState(s => (s.session ? { ...s, session: { ...s.session, tables: result.tables, views: result.views ?? [] } } : s))
    } catch (err) {
      notify(err.message, 'error')
    }
  }, [db, session, isDemo, notify])

  // ── Columns ────────────────────────────────────────────────────────────────

  const ensureColumnsLoaded = useCallback(async (table, { quiet = false } = {}) => {
    if (!table || !session) return undefined
    if (columnsRef.current[table]) return columnsRef.current[table]
    if (!quiet) setColumnsLoading(true)
    try {
      if (isDemo) {
        // Demo tables carry only column names — treat the first as the primary key,
        // close enough to the real getColumns() shape for the builders.
        const demoCols = (demoData.current[table]?.columns ?? []).map((name, i) => ({
          name, dataType: 'TEXT', isPrimaryKey: i === 0, nullable: i !== 0,
        }))
        setTableColumns(prev => ({ ...prev, [table]: demoCols }))
        return demoCols
      }
      const result = await db.getColumns(session.type, session.config, table)
      // A table always has columns, so none back means they couldn't be read (a permissions gap, say).
      if (!result.columns?.length) {
        setColumnsFailed(prev => ({ ...prev, [table]: true }))
        return undefined
      }
      setColumnsFailed(prev => (prev[table] ? { ...prev, [table]: false } : prev))
      setTableColumns(prev => ({ ...prev, [table]: result.columns }))
      return result.columns
    } catch (err) {
      if (quiet) {
        setColumnsFailed(prev => ({ ...prev, [table]: true }))
        return undefined
      }
      notify(err.message, 'error')
      setActiveBuilder(null)
      return undefined
    } finally {
      if (!quiet) setColumnsLoading(false)
    }
  }, [db, session, isDemo, notify])

  // ── Structure ──────────────────────────────────────────────────────────────

  // Keys and indexes for the Structure tab and the Browse header markers. With no adapter method
  // (or in the demo) there are none to show, only the columns.
  const ensureStructureLoaded = useCallback(async (table, { force = false } = {}) => {
    if (!table || !session || (!force && structuresRef.current[table])) return
    setStructureState(prev => ({ ...prev, [table]: { loading: true } }))
    try {
      let found
      if (isDemo || !db.getStructure) {
        const columns = await ensureColumnsLoaded(table, { quiet: true })
        if (!columns) throw new Error("Couldn't read this table's columns")
        found = { columns, foreignKeys: [], referencedBy: [], indexes: [] }
      } else {
        const result = await db.getStructure(session.type, session.config, table)
        if (result?.ok === false) throw new Error(result.error || "Couldn't read this table's structure")
        found = {
          columns: result.columns ?? [],
          foreignKeys: result.foreignKeys ?? [],
          referencedBy: result.referencedBy ?? [],
          indexes: result.indexes ?? [],
        }
      }
      setStructures(prev => ({ ...prev, [table]: found }))
      setStructureState(prev => { const { [table]: _done, ...rest } = prev; return rest })
    } catch (err) {
      setStructureState(prev => ({ ...prev, [table]: { error: err.message } }))
    }
  }, [db, session, isDemo, ensureColumnsLoaded])

  // ── Load table ─────────────────────────────────────────────────────────────

  // `where` keeps only the rows whose columns hold those values (null meaning NULL).
  const fetchRows = useCallback(async (name, where = null) => {
    if (isDemo) {
      const data = structuredClone(demoData.current[name])
      if (!where || !data) return data
      const idx = where.map(w => data.columns.indexOf(w.column))
      const none = v => v === null || v === undefined
      const holds = (v, value) => (none(value) ? none(v) : v === value)
      return { ...data, rows: data.rows.filter(r => where.every((w, i) => holds(r[idx[i]], w.value))) }
    }
    if (!where) return db.getRows(session.type, session.config, name)
    return db.getRows(session.type, session.config, name, 500, 0, where)
  }, [db, session, isDemo])

  const recordLoaded = useCallback((name, data) => {
    setTableMeta(m => ({ ...m, [name]: { rows: data.rows.length, cols: data.columns.length, at: Date.now() } }))
    setRecent(r => [name, ...r.filter(t => t !== name)].slice(0, 8))
  }, [])

  // `where`, `search`, `sort` and `scrollTop` open it filtered to a key's row, or as Back left it.
  const openTable = useCallback(async (name, tab = 'browse', { where = null, search: keep = '', sort: order = null, scrollTop = null } = {}) => {
    if (!name || !session) return
    const seq = ++loadSeq.current
    setSelectedRows(new Set())
    setSearch(keep)
    setSort(order)
    setRowWhere(where)
    setNullFilter(null)
    setStructureFocus(null)
    pendingScroll.current = scrollTop
    setEditingCell(null)
    setActiveTab(tab)
    if (tab === 'query') {
      setQueryTable(name)
      setSqlQuery(`SELECT * FROM ${quoteTable(name)}`)
      setActiveBuilder(null)
    }
    setDbState(s => applyTableSelected(s, name))
    // Column metadata gives the real primary key for edits and deletes; fetched alongside the rows.
    ensureColumnsLoaded(name, { quiet: true })
    ensureStructureLoaded(name)
    try {
      const data = await fetchRows(name, where)
      if (seq !== loadSeq.current) return
      setDbState(s => applyTableLoaded(s, data))
      recordLoaded(name, data)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [session, fetchRows, recordLoaded, ensureColumnsLoaded, ensureStructureLoaded, notify])

  // Reads the open table's rows again, keeping the search, sort and tab.
  const reloadRows = useCallback(async (where) => {
    const name = dbState.selectedTable
    if (!name) return
    const seq = ++loadSeq.current
    setDbState(s => ({ ...s, error: null }))
    try {
      const data = await fetchRows(name, where)
      if (seq !== loadSeq.current) return
      setSelectedRows(new Set())
      setEditingCell(null)
      setDbState(s => applyTableLoaded(s, data))
      recordLoaded(name, data)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [dbState.selectedTable, fetchRows, recordLoaded, notify])

  // Refresh keeps the filter, and reads the structure again too.
  const refreshTable = useCallback(() => {
    if (!dbState.selectedTable) return
    ensureStructureLoaded(dbState.selectedTable, { force: true })
    reloadRows(rowWhere)
  }, [dbState.selectedTable, rowWhere, reloadRows, ensureStructureLoaded])
  // Back to the table's usual first rows; not a step in the history.
  const clearFilter = () => { setRowWhere(null); reloadRows(null) }

  // ── Following keys, and Back ───────────────────────────────────────────────

  // Opens `table` in Browse filtered to `where`, remembering this view for Back. The row menu's
  // "Show rows that reference this" comes through here too.
  const follow = useCallback(({ table, where }) => {
    if (dbState.selectedTable) {
      setNavStack(s => pushNav(s, { table: dbState.selectedTable, where: rowWhere, search, sort, scrollTop: gridRef.current?.scrollTop ?? 0 }))
    }
    openTable(table, 'browse', { where })
  }, [dbState.selectedTable, rowWhere, search, sort, openTable])

  // The entry is used up even if its table then fails to load: the error shows there. With no
  // table open (the history went when it closed) there's nowhere to go back from.
  const goBack = useCallback(() => {
    if (!dbState.selectedTable) return
    const [entry, rest] = popNav(navStack)
    if (!entry) return
    setNavStack(rest)
    openTable(entry.table, 'browse', entry)
  }, [dbState.selectedTable, navStack, openTable])

  // Puts back the scroll position Back saved, once the rows are on screen.
  useEffect(() => {
    if (pendingScroll.current == null || !gridRef.current || dbState.tableLoading) return
    gridRef.current.scrollTop = pendingScroll.current
    pendingScroll.current = null
  }, [dbState.tableData, dbState.tableLoading])

  const closeTable = () => { loadSeq.current++; setRowWhere(null); setNavStack([]); setDbState(s => ({ ...s, selectedTable: null, tableData: null, tableLoading: false, error: null })) }

  // ── Visible rows: search, then sort; each keeps its index into tableData.rows ──

  const tableData = dbState.tableData
  const visible = useMemo(() => {
    const all = (tableData?.rows ?? []).map((row, i) => ({ row, i }))
    const t = search.trim().toLowerCase()
    // The empty / not-empty filter works on the loaded rows, unlike a followed key's WHERE.
    const nc = nullFilter ? tableData?.columns.indexOf(nullFilter.col) ?? -1 : -1
    const kept = nc < 0 ? all : all.filter(({ row }) => (row[nc] === null || row[nc] === undefined) === nullFilter.empty)
    const hits = t ? kept.filter(({ row }) => row.some(c => String(c ?? '').toLowerCase().includes(t))) : kept
    if (!sort) return hits
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...hits].sort((a, b) => compareCells(a.row[sort.col], b.row[sort.col]) * dir || a.i - b.i)
  }, [tableData, search, sort, nullFilter])

  // Each shown column's metadata from getColumns() (type, nullability, length…), or null until it loads.
  const columnInfo = useMemo(() => {
    const cols = tableColumns[dbState.selectedTable]
    return (tableData?.columns ?? []).map(name => cols?.find(c => c.name === name) ?? null)
  }, [tableColumns, dbState.selectedTable, tableData])
  // A row is edited or deleted by every column of its primary key, so no other row can match.
  // Without a key (or before the columns load) there's no safe way to pick out one row.
  const keyIdx = useMemo(() => columnInfo.flatMap((c, i) => (c?.isPrimaryKey ? [i] : [])), [columnInfo])
  const columnsKnown = !!tableColumns[dbState.selectedTable]
  const typesUnreadable = !columnsKnown && !!columnsFailed[dbState.selectedTable]
  const canWrite = keyIdx.length > 0
  const pkIndex = keyIdx[0] ?? -1
  const keyNames = keyIdx.map(i => tableData?.columns[i])
  // The key argument the adapter takes: a column name, or every name of a composite key.
  const keyArg = () => (keyNames.length === 1 ? keyNames[0] : keyNames)
  const keyOf = row => (keyIdx.length === 1 ? row[keyIdx[0]] : keyIdx.map(i => row[i]))

  const changeSearch = (value) => { setSearch(value); setSelectedRows(new Set()) }
  // Ticks go with a filter change, as with a search, so the ticked rows stay among those shown.
  const changeNullFilter = (value) => { setNullFilter(value); setSelectedRows(new Set()) }
  const nullFilterLabel = nullFilter ? `${nullFilter.col} is ${nullFilter.empty ? 'empty' : 'not empty'}` : null
  const cycleSort = (col) => setSort(s => (!s || s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null))

  // ── Row selection ──────────────────────────────────────────────────────────

  const toggleRow = (i) => setSelectedRows(prev => {
    const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s
  })
  const allVisibleSelected = visible.length > 0 && visible.every(v => selectedRows.has(v.i))
  const toggleAll = () => setSelectedRows(allVisibleSelected ? new Set() : new Set(visible.map(v => v.i)))

  // ── Demo writes go to the in-memory copy too, so reopening a table keeps them ──

  const syncDemo = (name, fn) => {
    if (isDemo && demoData.current?.[name]) demoData.current[name] = fn(demoData.current[name])
  }
  // A shown row's place in the demo's own copy, found by its key: the shown rows may be filtered.
  const demoIndex = (d, row) => d.rows.findIndex(r => keyIdx.every(k => r[k] === row[k]))

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    const indices = [...selectedRows]
    const rows = tableData.rows
    const name = dbState.selectedTable
    if (!canWrite) { setShowDeleteConfirm(false); return }
    try {
      if (!isDemo) {
        await db.deleteRows(session.type, session.config, name, keyArg(), indices.map(i => keyOf(rows[i])))
      }
      syncDemo(name, d => {
        const at = new Set(indices.map(i => demoIndex(d, rows[i])))
        return { ...d, rows: d.rows.filter((_, i) => !at.has(i)) }
      })
      setDbState(s => applyRowsDeleted(s, indices))
      setTableMeta(m => (m[name] ? { ...m, [name]: { ...m[name], rows: m[name].rows - indices.length } } : m))
      setSelectedRows(new Set())
      setShowDeleteConfirm(false)
      notify(`Deleted ${plural(indices.length, 'row')}`)
    } catch (err) {
      setShowDeleteConfirm(false)
      notify(err.message, 'error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, session, isDemo, tableData, dbState.selectedTable, keyIdx, canWrite, selectedRows, notify])

  // ── Cell edit ──────────────────────────────────────────────────────────────

  // Only columns a person can set open an editor; the editor shows the value as its type reads it.
  const startEdit = (ri, ci, val) => {
    if (!canWrite || columnKind(columnInfo[ci]) === 'readonly') return
    setEditingCell({ ri, ci })
    setEditValue(cellToInput(columnInfo[ci], val))
  }

  // Writes one cell's checked value (see parseCellInput) and shows it.
  const commitCell = useCallback(async (ri, ci, value) => {
    const name = dbState.selectedTable
    if (!canWrite) return false
    const seq = loadSeq.current
    try {
      if (!isDemo) {
        await db.updateCell(session.type, session.config, name, keyArg(), keyOf(tableData.rows[ri]), tableData.columns[ci], value)
      }
      notify(`Updated ${tableData.columns[ci]}`)
      // Another table (or filter) opened while it saved: these row and column numbers aren't its.
      if (seq !== loadSeq.current) return true
      syncDemo(name, d => {
        const at = demoIndex(d, tableData.rows[ri])
        return { ...d, rows: d.rows.map((r, i) => (i === at ? r.map((c, j) => (j === ci ? value : c)) : r)) }
      })
      setDbState(s => applyCellUpdated(s, { rowIndex: ri, colIndex: ci, value }))
      // A filtered view reads its rows again, so a row that no longer matches drops out.
      if (rowWhere) reloadRows(rowWhere)
      return true
    } catch (err) {
      notify(err.message, 'error')
      return false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, session, isDemo, tableData, dbState.selectedTable, keyIdx, canWrite, rowWhere, reloadRows, notify])

  // Saves the open cell (nothing is written when it didn't change), then optionally opens `next`.
  // A value the column can't hold isn't written: the editor stays open, or on leaving it the
  // change is dropped with a note saying why.
  const saveEdit = useCallback(async (next = null, { leaving = false, isNull = false } = {}) => {
    if (!editingCell) return
    const { ri, ci } = editingCell
    const col = columnInfo[ci]
    const before = tableData.rows[ri]?.[ci]
    const unchanged = !isNull && cellToInput(col, before) === editValue
    const parsed = unchanged ? null : parseCellInput(col, editValue, { isNull })
    if (parsed?.error) {
      if (leaving) { setEditingCell(null); notify(`Not saved: ${parsed.error}`, 'error') }
      return
    }
    setEditingCell(null)
    if (!unchanged && !(await commitCell(ri, ci, parsed.value))) return
    if (next) startEdit(next.ri, next.ci, next.ri === ri && next.ci === ci ? parsed?.value ?? before : tableData.rows[next.ri][next.ci])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableData, columnInfo, editingCell, editValue, commitCell, notify])

  // ── Add row ────────────────────────────────────────────────────────────────

  const [addingRow, setAddingRow] = useState(null) // { initial? } while Add row is open; Duplicate fills `initial`
  // `values` maps column names to checked values; columns left out get their default.
  const addRow = useCallback(async (values) => {
    const name = dbState.selectedTable
    try {
      if (isDemo) {
        const row = tableData.columns.map(c => (c in values ? values[c] : null))
        syncDemo(name, d => ({ ...d, rows: [...d.rows, row] }))
      } else {
        await db.insertRow(session.type, session.config, name, values)
      }
      setAddingRow(null)
      notify(`Added a row to ${name}`)
      refreshTable()
      return null
    } catch (err) {
      return err.message
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, session, isDemo, tableData, dbState.selectedTable, notify, refreshTable])

  // ── Query ──────────────────────────────────────────────────────────────────

  const handleQueryTableSelect = useCallback((name) => {
    setQueryTable(name)
    setSqlQuery(`SELECT * FROM ${quoteTable(name)}`)
  }, [])

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

  const runQuery = useCallback(async (override) => {
    const sql = (typeof override === 'string' ? override : sqlQuery).trim()
    if (!sql || queryRunning) return
    if (RISKY_SQL.test(sql) && !window.confirm(`Run this on ${sessionName(session)}?\n\n${sql}\n\nIt changes the schema or every row, and can't be undone from NexusMD.`)) return
    setQueryResult(null)
    setQueryRunning(true)
    const started = performance.now()
    const log = (ok, summary) => setQueryHistory(h => [{ sql, at: Date.now(), ok, summary }, ...h.filter(q => q.sql !== sql)].slice(0, 25))
    try {
      let result
      if (isDemo) {
        const m = sql.match(/FROM\s+\[?(\w+)\]?/i)
        result = m && demoData.current[m[1]]
          ? { ...structuredClone(demoData.current[m[1]]), affected: null }
          : { error: 'Table not found in demo data' }
      } else {
        result = await db.runQuery(session.type, session.config, sql)
      }
      const ms = Math.round(performance.now() - started)
      setQueryResult({ ...result, ms })
      if (result.error) log(false, result.error)
      else if (result.columns?.length) log(true, plural(result.rows.length, 'row'))
      else log(true, result.affected != null ? `${plural(result.affected, 'row')} affected` : 'Executed')
      // A write may have changed the open table, or the table list.
      if (!result.error && !isDemo && MUTATING_SQL.test(sql)) {
        if (/^\s*(create|drop|alter)\b/i.test(sql)) refreshTables()
        else if (dbState.selectedTable) refreshTable()
      }
    } catch (err) {
      setQueryResult({ error: err.message, ms: Math.round(performance.now() - started) })
      log(false, err.message)
    } finally {
      setQueryRunning(false)
    }
  }, [db, session, isDemo, sqlQuery, queryRunning, dbState.selectedTable, refreshTable, refreshTables])

  // ── Saved queries ──────────────────────────────────────────────────────────

  const connKey = connectionKey(session)

  // Minimised Browse columns, remembered per connection and table. Read again whenever another table opens.
  const minTable = dbState.selectedTable
  const minId = `${connKey}\n${minTable}`
  const [minState, setMinState] = useState({ id: null, names: [] })
  let minCols = minState.names
  if (minState.id !== minId) {
    minCols = minTable ? readMinCols(connKey, minTable) : []
    setMinState({ id: minId, names: minCols })
  }
  const setMinCols = (names) => { setMinState({ id: minId, names }); writeMinCols(connKey, minTable, names) }
  // Only names the open table still has count; a stale one stays remembered but does nothing.
  const minimised = useMemo(() => new Set((tableData?.columns ?? []).filter(c => minCols.includes(c))), [tableData, minCols])

  // Templates show everywhere; fixed queries only on the connection they were saved from.
  const savedHere = useMemo(() => savedQueries.filter(q => isTemplate(q) || q.conn === connKey), [savedQueries, connKey])
  const persistSaved = (next) => { setSavedQueries(next); writePref(SAVED_KEY, next) }

  // Saving under a name that's already used here replaces that query.
  const saveQuery = ({ name, sql, anyTable, table }) => {
    const text = anyTable ? toTemplate(sql.trim(), table) : sql.trim()
    const entry = { id: `q-${Date.now().toString(36)}`, name: name.trim(), sql: text, conn: anyTable ? null : connKey, at: Date.now() }
    const clash = savedHere.find(q => q.name.toLowerCase() === entry.name.toLowerCase())
    persistSaved(clash ? savedQueries.map(q => (q.id === clash.id ? { ...entry, id: clash.id } : q)) : [...savedQueries, entry])
    notify(clash ? `Replaced "${entry.name}"` : `Saved "${entry.name}"${anyTable ? ' · runs on any table' : ''}`)
  }
  const deleteSaved = (q) => {
    persistSaved(savedQueries.filter(x => x.id !== q.id))
    notify(`Removed "${q.name}"`)
  }
  // Runs a saved query against `table` (the open one by default) and shows the result in the Query tab.
  const runSaved = (q, table = dbState.selectedTable) => {
    if (isTemplate(q) && !table) { notify(`Open a table to run "${q.name}" on`, 'info'); return }
    const sql = isTemplate(q) ? fillTemplate(q.sql, table) : q.sql
    if (table && table !== dbState.selectedTable) openTable(table, 'query')
    setActiveTab('query')
    if (table) setQueryTable(table)
    setActiveBuilder(null)
    setSqlQuery(sql)
    runQuery(sql)
  }
  const loadSaved = (q) => {
    const table = queryTable ?? dbState.selectedTable
    setSqlQuery(isTemplate(q) && table ? fillTemplate(q.sql, table) : q.sql)
  }

  // ── Table list ─────────────────────────────────────────────────────────────

  // SQL Server tables outside dbo are listed as schema.table; they can be left out of the list,
  // Jump to table and the Query tab's pickers, remembered for this connection.
  const allTables = session?.tables ?? []
  const otherSchema = t => session?.type === 'sqlserver' && t.includes('.')
  const otherSchemaCount = allTables.filter(otherSchema).length
  const schemasKey = `nx-db:other-schemas:${connectionKey(openedSession)}`
  const [showSchemas, setShowSchemasState] = useState(() => readPref(schemasKey, true))
  const setShowSchemas = (v) => { setShowSchemasState(v); writePref(schemasKey, v) }
  const tables = showSchemas ? allTables : allTables.filter(t => !otherSchema(t))
  const updatePrefs = (fn) => setPrefs(prev => {
    const next = fn(prev)
    writePref(tablePrefsKey(connectionKey(session)), next)
    return next
  })
  const { starred, collapsed } = prefs
  const starredSet = useMemo(() => new Set(starred), [starred])
  const hiddenSet = useMemo(() => new Set(prefs.hidden), [prefs.hidden])
  const toggleStar = (name) => updatePrefs(p => toggleTableStarred(p, name))
  const tableActions = {
    groups: prefs.groups,
    groupOf: name => prefs.assigned[name] ?? null,
    isHidden: name => hiddenSet.has(name),
    onMove: (name, group) => updatePrefs(p => setTableGroup(p, name, group)),
    onToggleHidden: (name) => {
      notify(hiddenSet.has(name) ? `Showing ${name} in the list` : `Hid ${name} · find it under Hidden`, 'info')
      updatePrefs(p => toggleTableHidden(p, name))
    },
    onRenameGroup: (from, to) => updatePrefs(p => renameTableGroup(p, from, to)),
    onRemoveGroup: (group) => updatePrefs(p => removeTableGroup(p, group)),
  }
  // Hidden tables only show under the Hidden filter.
  const listed = useMemo(() => tables.filter(t => matchesWords(t, tableFilter)
    && (listFilter === 'hidden' ? hiddenSet.has(t) : !hiddenSet.has(t)
      && (listFilter === 'all' || (listFilter === 'starred' ? starredSet.has(t) : !!tableMeta[t])))),
  [tables, tableFilter, listFilter, starredSet, hiddenSet, tableMeta])
  const hiddenCount = tables.filter(t => hiddenSet.has(t)).length
  const setHidden = (v) => { setListHidden(v); writePref('nx-db:list-hidden', v) }

  // ── Opened tables ──────────────────────────────────────────────────────────
  // A table opened this session counts under "Opened" and Recently opened until it's closed;
  // closing the one that's showing goes back to the overview.
  const openedTables = Object.keys(tableMeta)
  const isOpened = name => !!tableMeta[name] || name === dbState.selectedTable
  const closeTables = (names) => {
    const gone = new Set(names)
    setTableMeta(m => Object.fromEntries(Object.entries(m).filter(([t]) => !gone.has(t))))
    setRecent(r => r.filter(t => !gone.has(t)))
    if (gone.has(dbState.selectedTable)) closeTable()
  }

  // ── New table / view, drop ─────────────────────────────────────────────────
  // The demo has no database behind it, so there's nothing to create or drop there.
  const viewSet = useMemo(() => new Set(session?.views ?? []), [session])
  const [ddl, setDdl] = useState(null) // { kind: 'table' | 'view' | 'drop', name?, sql?, view? }
  const canDdl = !isDemo
  // Runs the statement, reads the table list again and opens what was made. Returns an error
  // message for the dialog to show, or null.
  const create = async (sql, name, what) => {
    try {
      await db.runDdl(session.type, session.config, sql)
      setDdl(null)
      await refreshTables()
      notify(`Created ${what} ${name}`)
      openTable(name)
      return null
    } catch (err) {
      return err.message
    }
  }
  const drop = async (name, view) => {
    try {
      await db.runDdl(session.type, session.config, buildDropStatement(name, { view }))
      setDdl(null)
      closeTables([name])
      // Nothing left to star, group or hide (a group it leaves empty goes too).
      updatePrefs(p => {
        const q = setTableGroup(p, name, null)
        return { ...q, starred: q.starred.filter(t => t !== name), hidden: q.hidden.filter(t => t !== name) }
      })
      await refreshTables()
      notify(`Dropped ${view ? 'view' : 'table'} ${name}`)
      return null
    } catch (err) {
      return err.message
    }
  }
  const newMenu = [
    { label: 'New table…', icon: 'plus', onSelect: () => setDdl({ kind: 'table' }) },
    { label: 'New view…', icon: 'eye', onSelect: () => setDdl({ kind: 'view', sql: '' }) },
  ]

  // ── Table and section menus (the "⋯" buttons and right-clicks) ─────────────
  const [menu, setMenu] = useState(null) // { items, x, y, alignRight, label }
  const closeMenu = useCallback(() => setMenu(null), [])
  const showMenu = (items, label, point) => setMenu({ items, label, ...point })

  const selectSql = name => (session?.type === 'sqlserver'
    ? `SELECT TOP 100 * FROM ${quoteTable(name)}`
    : `SELECT * FROM ${quoteTable(name)} LIMIT 100`)
  const copy = async (text, what) => notify((await copyText(text)) ? `Copied ${what}` : "Couldn't reach the clipboard", 'info')
  const countRows = async (name) => {
    try {
      const n = isDemo
        ? demoData.current[name]?.rows.length ?? 0
        : (await db.runQuery(session.type, session.config, `SELECT COUNT(*) AS n FROM ${quoteTable(name)}`)).rows?.[0]?.[0]
      notify(`${name}: ${typeof n === 'number' ? n.toLocaleString() : n} ${n === 1 ? 'row' : 'rows'}`, 'info')
    } catch (err) {
      notify(err.message, 'error')
    }
  }
  // Moving into a group: the existing groups, a new one, or out of the current one.
  const moveSubmenu = (names, current) => [
    ...prefs.groups.map(g => ({ label: g, icon: 'folder', checked: names.length === 1 ? g === current : undefined, disabled: names.length === 1 && g === current,
      onSelect: () => updatePrefs(p => names.reduce((q, n) => setTableGroup(q, n, g), p)) })),
    ...(prefs.groups.length ? [{ separator: true }] : []),
    { input: { label: 'New group name', placeholder: 'New group…', submitLabel: 'Add', autoFocus: !prefs.groups.length,
      onSubmit: g => updatePrefs(p => names.reduce((q, n) => setTableGroup(q, n, g), p)) } },
    ...(current ? [{ separator: true }, { label: `Remove from ${current}`, icon: 'x', onSelect: () => updatePrefs(p => names.reduce((q, n) => setTableGroup(q, n, null), p)) }] : []),
  ]

  const tableMenu = (name) => {
    const group = prefs.assigned[name] ?? null
    const others = openedTables.filter(t => t !== name)
    return [
      { heading: viewSet.has(name) ? `${name} · view` : name },
      { label: 'Browse', icon: 'list', hint: 'b', onSelect: () => openTable(name, 'browse') },
      { label: 'Query', icon: 'play', hint: 'q', onSelect: () => openTable(name, 'query') },
      { separator: true },
      { label: starredSet.has(name) ? 'Unstar' : 'Star', icon: 'star', onSelect: () => toggleStar(name) },
      { label: group ? `Move to group · ${group}` : 'Move to group', icon: 'folder', submenu: moveSubmenu([name], group) },
      { label: hiddenSet.has(name) ? 'Show in the table list' : 'Hide from the table list', icon: 'eye', onSelect: () => tableActions.onToggleHidden(name) },
      { separator: true },
      { label: 'Copy name', icon: 'copy', onSelect: () => copy(name, 'the table name') },
      { label: 'Copy SELECT statement', icon: 'copy', onSelect: () => copy(selectSql(name), 'a SELECT statement') },
      { label: 'Count rows', icon: 'info', onSelect: () => countRows(name) },
      { separator: true },
      { label: 'New view from this…', icon: 'eye', disabled: !canDdl, title: canDdl ? undefined : 'Not in the demo',
        onSelect: () => setDdl({ kind: 'view', sql: `SELECT * FROM ${quoteTable(name)}` }) },
      { label: viewSet.has(name) ? 'Drop view…' : 'Drop table…', icon: 'trash', danger: true, disabled: !canDdl, title: canDdl ? undefined : 'Not in the demo',
        onSelect: () => setDdl({ kind: 'drop', name, view: viewSet.has(name) }) },
      ...(isOpened(name) || others.length ? [{ separator: true }] : []),
      ...(isOpened(name) ? [{ label: 'Close table', icon: 'x', onSelect: () => closeTables([name]) }] : []),
      ...(others.length ? [{ label: `Close other tables (${others.length})`, icon: 'x', onSelect: () => closeTables(others) }] : []),
      ...(openedTables.length > 1 || (openedTables.length && !isOpened(name)) ? [{ label: 'Close all tables', icon: 'x', onSelect: () => closeTables(openedTables) }] : []),
    ]
  }

  // ── Grid menus (right-click on a header or a cell) ──────────────────────────
  const minimise = (name) => {
    // The editor would be left open in a column no longer drawn.
    if (editingCell && tableData?.columns[editingCell.ci] === name) setEditingCell(null)
    setMinCols([...minCols.filter(n => n !== name), name])
  }
  const isViewOpen = viewSet.has(dbState.selectedTable)
  const openStructure = structures[dbState.selectedTable]
  const shownKeys = isViewOpen ? [] : openStructure?.foreignKeys ?? []
  const cellText = v => (v === null || v === undefined ? '' : String(v))
  const rowText = row => row.map(cellText).join('\t')
  // Why editing is off, as the grid's notice puts it.
  const editReason = canWrite ? null
    : typesUnreadable ? "Couldn't read this table's column types, so editing is off"
      : !columnsKnown && !isDemo ? 'Reading the table’s columns…'
        : 'No primary key, so a change can’t be kept to one row'

  const headerMenu = (ci) => {
    const col = tableData.columns[ci]
    return headerMenuItems({
      column: col,
      sorted: sort?.col === ci ? sort.dir : null,
      anyMinimised: minimised.size > 0,
      foreignKey: shownKeys.find(fk => fk.columns.includes(col)) ?? null,
      onSort: dir => setSort(dir ? { col: ci, dir } : null),
      onMinimise: () => minimise(col),
      onRestoreAll: () => setMinCols([]),
      onCopyName: () => copy(col, 'the column name'),
      onCopyValues: () => copy(visible.map(v => cellText(v.row[ci])).join('\n'), plural(visible.length, 'value')),
      onFilterEmpty: empty => changeNullFilter({ col, empty }),
      onGoToKey: fk => { setStructureFocus(fk.name); setActiveTab('structure'); ensureStructureLoaded(dbState.selectedTable) },
    })
  }

  const rowMenu = (ri, ci) => {
    const row = tableData.rows[ri]
    const col = columnInfo[ci]
    const kind = columnKind(col)
    // A click on one of several ticked rows copies or deletes them all, in the order shown.
    const many = selectedRows.has(ri) && selectedRows.size > 1
    const rows = many ? visible.filter(v => selectedRows.has(v.i)).map(v => v.row) : [row]
    const dialect = session.type === 'sqlserver' ? 'sqlserver' : 'sqlite'
    const structure = isViewOpen ? null : openStructure
    return rowMenuItems({
      canEdit: canWrite,
      editReason,
      columnReadonly: kind === 'readonly',
      columnBoolean: kind === 'boolean',
      nullable: !!col?.nullable,
      isView: isViewOpen,
      count: rows.length,
      canDelete: canWrite,
      deleteReason: 'No primary key, so this row can’t be deleted on its own',
      canDuplicate: columnsKnown || typesUnreadable || isDemo,
      follows: structure ? followTargets(structure, tableData.columns, row) : [],
      references: structure ? referencingTargets(structure, tableData.columns, row) : [],
      onEdit: () => startEdit(ri, ci, row[ci]),
      onSetNull: () => commitCell(ri, ci, null),
      onCopyCell: () => copy(cellText(row[ci]), 'cell'),
      onCopyRows: () => copy(rows.map(rowText).join('\n'), many ? plural(rows.length, 'row') : 'row'),
      onCopyInsert: () => copy(buildInsertStatements(dbState.selectedTable, tableData.columns, rows, columnInfo.filter(Boolean), dialect),
        rows.length > 1 ? `${rows.length} INSERT statements` : 'an INSERT statement'),
      onDuplicate: () => setAddingRow({ initial: Object.fromEntries(tableData.columns.map((c, i) => [c, row[i]])) }),
      onFollow: follow,
      onDelete: () => { if (!many) setSelectedRows(new Set([ri])); setShowDeleteConfirm(true) },
    })
  }

  // A section header (a group of your own, or a schema): fold it or the rest, group or hide its tables.
  const sectionMenu = (s, shownKeys) => {
    const folded = prefs.collapsed.includes(s.key)
    const setFolded = keys => updatePrefs(p => ({ ...p, collapsed: keys }))
    const othersOpen = shownKeys.some(k => k !== s.key && !prefs.collapsed.includes(k))
    return [
      { heading: s.kind === 'group' ? `${s.label} · your group` : s.label },
      { label: folded ? 'Expand' : 'Collapse', icon: folded ? 'chevron-down' : 'chevron-right', onSelect: () => updatePrefs(p => toggleSectionCollapsed(p, s.key)) },
      { label: 'Collapse the others', icon: 'collapse', disabled: !othersOpen,
        onSelect: () => setFolded([...new Set([...prefs.collapsed.filter(k => !shownKeys.includes(k)), ...shownKeys.filter(k => k !== s.key)])]) },
      { label: 'Expand all', icon: 'expand', disabled: !shownKeys.some(k => prefs.collapsed.includes(k)),
        onSelect: () => setFolded(prefs.collapsed.filter(k => !shownKeys.includes(k))) },
      { separator: true },
      ...(s.kind === 'group' ? [
        { label: 'Rename group', icon: 'edit', submenu: [{ input: { label: 'Group name', initial: s.name, submitLabel: 'Rename', autoFocus: true, onSubmit: to => tableActions.onRenameGroup(s.name, to) } }] },
        { label: 'Ungroup tables', icon: 'trash', onSelect: () => tableActions.onRemoveGroup(s.name) },
      ] : [
        { label: `Move all ${s.names.length} to group`, icon: 'folder', submenu: moveSubmenu(s.names, null) },
      ]),
      { label: `Star all ${s.names.length}`, icon: 'star', disabled: s.names.every(t => starredSet.has(t)),
        onSelect: () => updatePrefs(p => ({ ...p, starred: [...new Set([...p.starred, ...s.names])] })) },
      { label: `Hide all ${s.names.length}`, icon: 'eye',
        onSelect: () => { updatePrefs(p => ({ ...p, hidden: [...new Set([...p.hidden, ...s.names])] })); notify(`Hid ${plural(s.names.length, 'table')} · find them under Hidden`, 'info') } },
      ...(s.names.some(isOpened) ? [{ separator: true }, { label: 'Close its opened tables', icon: 'x', onSelect: () => closeTables(s.names.filter(isOpened)) }] : []),
    ]
  }

  // j / k walk the listed tables, wrapping at the ends.
  const step = (by) => {
    const list = listHidden ? listed : tableSections(listed, prefs, { views: viewSet }).flatMap(s => (collapsed.includes(s.key) ? [] : s.names))
    if (!list.length) return
    const i = list.indexOf(dbState.selectedTable)
    openTable(list[i < 0 ? (by > 0 ? 0 : list.length - 1) : (i + by + list.length) % list.length], activeTab)
  }

  useDbShortcuts(rootRef, session ? {
    jump: () => { if (tables.length) setPaletteOpen(true) },
    focusFilter: () => { if (listHidden) setHidden(false); setTimeout(() => { filterRef.current?.focus(); filterRef.current?.select() }) },
    findRows: tableData ? () => { setActiveTab('browse'); setTimeout(() => { rowSearchRef.current?.focus(); rowSearchRef.current?.select() }) } : null,
    next: () => step(1),
    previous: () => step(-1),
    browse: () => { if (dbState.selectedTable) setActiveTab('browse') },
    structure: () => { if (dbState.selectedTable) setActiveTab('structure') },
    query: () => { if (dbState.selectedTable) setActiveTab('query') },
    refresh: () => { if (dbState.selectedTable) refreshTable() },
    back: goBack,
  } : {})

  // ── Render ─────────────────────────────────────────────────────────────────

  const connectedLabel = session ? `${typeLabel(session.type)} · ${plural(tables.length, 'table')}` : ''
  const meta = dbState.selectedTable ? tableMeta[dbState.selectedTable] : null
  const exportRows = () => visible.map(v => v.row)

  return (
    // Hidden while another connection's tab is showing; it stays mounted so nothing is lost.
    <div className="nx-db-session" ref={rootRef} hidden={!active}>
      <header className="nx-db-head">
        <div className="nx-db-head-row">
          <h2 className="nx-db-title">Database</h2>
          {tabs}
          <span className="nx-db-spacer" />
          <span className="nx-db-status">
            <span className="nx-db-dot" data-tone={connecting ? 'info' : 'ok'} />
            {connecting ? 'Connecting…' : connectedLabel}
          </span>
          <button type="button" className="nx-db-jumpbtn" disabled={!tables.length} onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={13} />Jump to table…<span className="kbd">Ctrl K</span>
          </button>
          <button type="button" className="btn sm ghost" title="Close this connection" onClick={onDisconnect}>Disconnect</button>
        </div>
        <div className="nx-db-head-row">
          <TableFilter ref={filterRef} value={tableFilter} onChange={setTableFilter} />
          <span className="nx-db-divider" />
          <span className="nx-db-show">Show</span>
          <div className="nx-db-chips" role="group" aria-label="Show tables">
            {[
              ['all', 'All', tables.length - hiddenCount, 'muted', hiddenCount ? 'Every table you haven\'t hidden' : 'Every table in this database'],
              ['starred', 'Starred', starred.filter(t => tables.includes(t) && !hiddenSet.has(t)).length, 'warn', 'Tables you starred · remembered for this connection'],
              ['opened', 'Opened', Object.keys(tableMeta).filter(t => !hiddenSet.has(t)).length, 'info', 'Tables opened this session'],
              // Only offered once something is hidden (or while it's the filter in use).
              ...(hiddenCount || listFilter === 'hidden' ? [['hidden', 'Hidden', hiddenCount, undefined, 'Tables you hid from the list · remembered for this connection']] : []),
            ].map(([id, label, n, tone, title]) => (
              <button key={id} type="button" className="nx-db-chip" aria-pressed={listFilter === id} title={title}
                onClick={() => setListFilter(listFilter === id && id !== 'all' ? 'all' : id)}>
                <span className="nx-db-dot" data-tone={tone} />{label}<span className="n">{n}</span>
              </button>
            ))}
          </div>
          {otherSchemaCount > 0 && (
            <button type="button" className="nx-db-chip" aria-pressed={showSchemas}
              title={showSchemas ? 'Showing tables outside dbo · click to list only dbo' : 'Listing only dbo · click to show tables in other schemas too'}
              onClick={() => setShowSchemas(!showSchemas)}>
              <span className="nx-db-dot" data-tone={showSchemas ? 'muted' : undefined} />Other schemas<span className="n">{otherSchemaCount}</span>
            </button>
          )}
          {listFilter === 'opened' && openedTables.length > 0 && (
            <button type="button" className="btn sm ghost" title="Close every opened table" onClick={() => { closeTables(openedTables); setListFilter('all') }}>
              <Icon name="x" size={12} />Close all
            </button>
          )}
          <span className="nx-db-spacer" />
          <button type="button" className="btn sm ghost" aria-pressed={!listHidden}
            title={listHidden ? 'Show the table list beside the details' : 'Hide the table list to give the details the full width'}
            onClick={() => setHidden(!listHidden)}>{listHidden ? 'Show tables' : 'Hide tables'}</button>
          {canDdl && (
            <button type="button" className="btn sm ghost" aria-haspopup="menu" title="Create a table or a view"
              onClick={e => showMenu(newMenu, 'New', menuPointFor(e.currentTarget))}>
              <Icon name="plus" size={12} />New
            </button>
          )}
          {!isDemo && <button type="button" className="btn sm ghost" title="Read the table list again" onClick={refreshTables}>Reload tables</button>}
        </div>
      </header>

      <div className="nx-db-body" data-list={listHidden ? 'hidden' : 'shown'}>
        {!listHidden && (
          <nav aria-label="Table list" className="nx-db-aside">
            <TableList
              tables={listed}
              total={tables.length}
              selected={dbState.selectedTable}
              starred={starredSet}
              meta={tableMeta}
              prefs={prefs}
              views={viewSet}
              onTableMenu={(name, point) => showMenu(tableMenu(name), `${name} options`, point)}
              onSectionMenu={(s, keys, point) => showMenu(sectionMenu(s, keys), `${s.label} options`, point)}
              onCloseTable={name => closeTables([name])}
              onToggleGroup={key => updatePrefs(p => toggleSectionCollapsed(p, key))}
              onSetCollapsed={keys => updatePrefs(p => ({ ...p, collapsed: keys }))}
              onOpen={name => openTable(name, activeTab)}
              onStar={toggleStar}
              onClearFilters={() => { setTableFilter(''); setListFilter('all') }}
            />
          </nav>
        )}

        <section aria-label="Details" className="nx-db-main">
          {!dbState.selectedTable ? (
            <Overview
              session={session}
              tables={tables}
              starred={starred.filter(t => tables.includes(t))}
              recent={recent}
              meta={tableMeta}
              history={queryHistory}
              onOpen={openTable}
              onCloseRecent={names => closeTables(names)}
              onUseQuery={q => {
                const m = q.sql.match(/\bFROM\s+([\w.[\]"]+)/i)
                const t = m && tables.find(x => x === m[1].replace(/[[\]"]/g, ''))
                if (t) { openTable(t, 'query'); setTimeout(() => setSqlQuery(q.sql)) }
                else notify('Open a table first, then pick the query from Recent in the Query tab', 'info')
              }}
              onJump={() => setPaletteOpen(true)}
              saved={savedHere}
              onRunSaved={(q, t) => runSaved(q, t)}
            />
          ) : (
            <div className="nx-db-detail">
              <div className="nx-db-dhead">
                <div className="nx-db-dhead-title">
                  <div className="nx-db-crumb">
                    <button type="button" className="nx-db-crumb-link" onClick={closeTable}>{sessionName(session)}</button>
                    {typeLabel(session.type) !== sessionName(session) && (
                      <><Icon name="chevron-right" size={11} /><span>{typeLabel(session.type)}</span></>
                    )}
                  </div>
                  <div className="nx-db-dhead-name">
                    <button type="button" className="nx-db-back" aria-label="Back" title="Back (Alt+←)" disabled={!navStack.length} onClick={goBack}>
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <h2 className="nx-db-table-name" title={dbState.selectedTable}>{dbState.selectedTable}</h2>
                    <StarButton on={starredSet.has(dbState.selectedTable)} onClick={() => toggleStar(dbState.selectedTable)} name={dbState.selectedTable} />
                    {tableActions.groupOf(dbState.selectedTable) && <span className="nx-db-tag">{tableActions.groupOf(dbState.selectedTable)}</span>}
                    {hiddenSet.has(dbState.selectedTable) && <span className="nx-db-tag" data-tone="muted">Hidden</span>}
                    <MenuButton label={`More for ${dbState.selectedTable}`} title="More options"
                      onOpen={point => showMenu(tableMenu(dbState.selectedTable), `${dbState.selectedTable} options`, point)} />
                  </div>
                  <div className="nx-db-dhead-meta">
                    {tableData && !dbState.tableLoading ? (
                      <>
                        <span>{plural(tableData.rows.length, 'row')}</span>
                        <span>{plural(tableData.columns.length, 'column')}</span>
                        {keyNames.length > 0
                          ? <span>key <code>{keyNames.join(', ')}</code></span>
                          : columnsKnown && !isDemo && <span title="Without a primary key a change can't be kept to one row">no primary key</span>}
                        {meta && <span>read {clock(meta.at)}</span>}
                      </>
                    ) : dbState.tableLoading ? <span>Loading…</span> : null}
                  </div>
                </div>
                <div className="nx-db-dhead-actions">
                  <SavedMenu queries={savedHere} table={dbState.selectedTable} onRun={q => runSaved(q)} />
                  <button type="button" className="btn sm ghost" title="Read this table again (r)" onClick={refreshTable} disabled={dbState.tableLoading}>
                    <Icon name="refresh" size={13} />Refresh
                  </button>
                  <button type="button" className="btn sm ghost" disabled={!tableData || dbState.tableLoading}
                    title="Copy the rows shown (after search and sort) as CSV"
                    onClick={async () => notify((await copyText(toCsv(tableData.columns, exportRows()))) ? `Copied ${plural(visible.length, 'row')} as CSV` : "Couldn't reach the clipboard", 'success')}>
                    <Icon name="copy" size={13} />Copy CSV
                  </button>
                  <button type="button" className="btn sm ghost" disabled={!tableData || dbState.tableLoading}
                    title="Save the rows shown (after search and sort) as a .csv file"
                    onClick={() => { if (!downloadCsv(dbState.selectedTable, tableData.columns, exportRows())) notify("Couldn't save the file", 'error') }}>
                    <Icon name="download" size={13} />Export
                  </button>
                  <button type="button" className="btn sm ghost" title="Close this table (takes it out of Opened)" aria-label="Close table"
                    onClick={() => closeTables([dbState.selectedTable])}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </div>

              <div className="nx-db-tabs" role="tablist" aria-label="View mode">
                {[['browse', 'Browse', tableData && !dbState.tableLoading ? tableData.rows.length : null], ['structure', 'Structure', null], ['query', 'Query', null]].map(([id, label, n]) => (
                  <button key={id} type="button" role="tab" aria-selected={activeTab === id} className="nx-db-tab"
                    title={`${label} (${id[0]})`} onClick={() => { setActiveTab(id); setStructureFocus(null) }}>
                    {label}{n != null && <span className="n" aria-hidden="true">{n}</span>}
                  </button>
                ))}
              </div>

              {dbState.tableLoading && (
                <div className="nx-db-state"><span className="nx-db-spinner" aria-hidden="true" />Reading {dbState.selectedTable}…</div>
              )}

              {!dbState.tableLoading && !tableData && dbState.error && activeTab === 'browse' && (
                <div className="nx-db-state">
                  <div className="nx-db-alert" role="alert">{dbState.error}</div>
                  <button type="button" className="btn sm" onClick={refreshTable}>Try again</button>
                </div>
              )}

              {activeTab === 'browse' && tableData && !dbState.tableLoading && (
                <BrowsePanel
                  ref={rowSearchRef}
                  gridRef={gridRef}
                  table={dbState.selectedTable}
                  where={rowWhere}
                  onClearFilter={clearFilter}
                  onFollow={follow}
                  tableData={tableData}
                  visible={visible}
                  keyIdx={keyIdx}
                  columnInfo={columnInfo}
                  minimised={minimised}
                  onMinimise={minimise}
                  onRestore={name => setMinCols(minCols.filter(n => n !== name))}
                  onRestoreAll={() => setMinCols([])}
                  canWrite={canWrite}
                  columnsKnown={columnsKnown || isDemo}
                  typesUnreadable={typesUnreadable}
                  isView={isViewOpen}
                  foreignKeys={openStructure?.foreignKeys}
                  nullFilter={nullFilterLabel}
                  onClearNullFilter={() => changeNullFilter(null)}
                  onHeaderMenu={(ci, point) => showMenu(headerMenu(ci), `${tableData.columns[ci]} options`, point)}
                  onRowMenu={(ri, ci, point) => showMenu(rowMenu(ri, ci), 'Row options', point)}
                  onSetCell={commitCell}
                  onAddRow={() => setAddingRow({})}
                  search={search}
                  onSearchChange={changeSearch}
                  sort={sort}
                  onSort={cycleSort}
                  selectedRows={selectedRows}
                  allSelected={allVisibleSelected}
                  onToggleRow={toggleRow}
                  onToggleAll={toggleAll}
                  onClearSelection={() => setSelectedRows(new Set())}
                  onDeleteSelected={() => setShowDeleteConfirm(true)}
                  onDeleteRow={(ri) => { setSelectedRows(new Set([ri])); setShowDeleteConfirm(true) }}
                  onCopyCell={async (v) => { if (await copyText(v === null || v === undefined ? '' : String(v))) notify('Copied cell') }}
                  editingCell={editingCell}
                  editValue={editValue}
                  onEditValueChange={setEditValue}
                  onStartEdit={startEdit}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => setEditingCell(null)}
                />
              )}

              {activeTab === 'structure' && (
                <StructurePanel
                  structure={structures[dbState.selectedTable] ?? null}
                  isView={viewSet.has(dbState.selectedTable)}
                  loading={!!structureState[dbState.selectedTable]?.loading}
                  error={structureState[dbState.selectedTable]?.error ?? null}
                  focusKey={structureFocus}
                  onOpenTable={name => openTable(name, 'structure')}
                  onRefresh={() => ensureStructureLoaded(dbState.selectedTable, { force: true })}
                />
              )}

              {activeTab === 'query' && (
                <QueryPanel
                  tables={tables}
                  queryTable={queryTable ?? dbState.selectedTable}
                  onSelectTable={handleQueryTableSelect}
                  sqlQuery={sqlQuery}
                  onSqlChange={setSqlQuery}
                  queryResult={queryResult}
                  running={queryRunning}
                  onRun={runQuery}
                  history={queryHistory}
                  onPickHistory={q => setSqlQuery(q.sql)}
                  onClearHistory={() => setQueryHistory([])}
                  saved={savedHere}
                  onSave={saveQuery}
                  onRunSaved={q => runSaved(q, queryTable ?? dbState.selectedTable)}
                  onLoadSaved={loadSaved}
                  onDeleteSaved={deleteSaved}
                  onCopyResult={async set => notify((await copyText(toCsv(set.columns, set.rows))) ? `Copied ${plural(set.rows.length, 'row')} as CSV` : "Couldn't reach the clipboard")}
                  onExportResult={(set, i) => downloadCsv(`${queryTable ?? dbState.selectedTable}-query${i ? `-${i + 1}` : ''}`, set.columns, set.rows)}
                  activeBuilder={activeBuilder}
                  onToggleBuilder={toggleBuilder}
                  columns={tableColumns[queryTable ?? dbState.selectedTable] ?? []}
                  columnsLoading={columnsLoading}
                  onBuildSql={applyBuiltSql}
                  allColumns={tableColumns}
                  onLoadColumnsFor={ensureColumnsLoaded}
                  onCreateView={canDdl ? sql => setDdl({ kind: 'view', sql }) : undefined}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {paletteOpen && (
        <TablePalette
          tables={tables}
          starred={starredSet}
          meta={tableMeta}
          selected={dbState.selectedTable}
          onClose={() => setPaletteOpen(false)}
          onOpen={(name, tab) => { setPaletteOpen(false); openTable(name, tab) }}
        />
      )}

      {menu && <DbMenu items={menu.items} x={menu.x} y={menu.y} alignRight={menu.alignRight} label={menu.label} onClose={closeMenu} />}

      {ddl?.kind === 'table' && (
        <NewTableDialog dialect={session.type} taken={tables} onClose={() => setDdl(null)} onCreate={(sql, name) => create(sql, name, 'table')} />
      )}
      {ddl?.kind === 'view' && (
        <NewViewDialog initialSql={ddl.sql} taken={tables} onClose={() => setDdl(null)} onCreate={(sql, name) => create(sql, name, 'view')} />
      )}
      {ddl?.kind === 'drop' && (
        <DropDialog name={ddl.name} view={ddl.view} onClose={() => setDdl(null)} onDrop={() => drop(ddl.name, ddl.view)} />
      )}

      {addingRow && tableData && (
        <AddRowDialog
          table={dbState.selectedTable}
          columns={tableData.columns}
          columnInfo={columnInfo}
          initial={addingRow.initial}
          onSave={addRow}
          onClose={() => setAddingRow(null)}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${plural(selectedRows.size, 'row')}?`}
          body={isDemo
            ? 'Removes them from the demo data for this session. This action cannot be undone.'
            : `Deletes them from ${dbState.selectedTable} by ${keyNames.join(', ') || 'key'}. This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

// ─── Welcome pane ─────────────────────────────────────────────────────────────

function WelcomePane({ onOpenConnect, onDemo, savedConnections, onConnectSaved, connectingId, hasAdapter, restoring = false, deferred = [] }) {
  return (
    <div className="nx-db-welcome">
      <div className="nx-db-welcome-mark"><Icon name="database" size={26} /></div>
      <h2 className="nx-db-welcome-title">Database Manager</h2>
      <p className="nx-db-welcome-body">Browse, edit, and query SQL Server and SQLite databases.</p>
      {!hasAdapter && (
        <p className="nx-db-alert" role="note">
          Running outside of the desktop shell — database connections are unavailable.
          Use the demo to explore the interface.
        </p>
      )}
      {restoring && (
        <p className="nx-db-muted" role="status"><span className="nx-db-spinner" aria-hidden="true" /> Reopening the connections you had open…</p>
      )}
      <div className="nx-db-welcome-actions">
        <button type="button" className="btn accent" onClick={onOpenConnect}>
          <Icon name="link" size={14} />Connect to database
        </button>
        <button type="button" className="btn ghost" onClick={onDemo}>Try the demo</button>
      </div>
      {hasAdapter && savedConnections.length > 0 && (
        <section className="nx-db-card nx-db-welcome-saved" aria-label="Quick connect">
          <div className="nx-db-card-head">
            <span className="nx-db-dot" data-tone="ok" />
            <span className="nx-db-card-title">Quick connect</span>
            <span className="hint">saved connections</span>
          </div>
          {savedConnections.map(entry => (
            <button key={entry.id} type="button" className="nx-db-saved-row" disabled={connectingId != null}
              onClick={() => onConnectSaved(entry)}>
              <Icon name="database" size={14} />
              <span className="name">{entry.name}</span>
              <span className="type">{typeLabel(entry.type)}</span>
              {deferred.includes(entry.id) && <span className="nx-db-tag" title="Open last time · signs in through your browser, so it waits for you">Was open</span>}
              {connectingId === entry.id ? <span className="nx-db-spinner" aria-hidden="true" /> : <Icon name="arrow-right" size={13} />}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

// ─── Header pieces ────────────────────────────────────────────────────────────

// Open connections as tabs, each with a close button, then any saved connections that aren't
// open yet; clicking one of those connects it in a new tab alongside the others.
function ConnectionTabs({ sessions, activeKey, savedConnections, connectingId, onSelect, onOpenSaved, onClose, deferred = [], onForget, onNew, onEdit = null }) {
  const openIds = new Set(sessions.map(s => s.connectionId).filter(Boolean))
  // A saved connection is edited from its tab: the pencil, or a right-click on the tab itself.
  const entryOf = s => (s.connectionId ? savedConnections.find(c => c.id === s.connectionId) : null)
  const editOnRightClick = entry => (onEdit && entry ? e => { e.preventDefault(); onEdit(entry) } : undefined)
  // A saved connection's tab follows its current name from Settings.
  const nameOf = s => savedConnections.find(c => c.id === s.connectionId)?.name ?? sessionName(s)
  return (
    <div className="nx-db-seg" style={{ minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
      <div role="tablist" aria-label="Connections" className="nx-db-seg-tabs">
        {sessions.map(s => (
          <span key={s.key} className="nx-db-conn" role="presentation" data-active={s.key === activeKey || undefined}>
            <button type="button" role="tab" aria-selected={s.key === activeKey}
              title={`${typeLabel(s.type)} · ${s.key === activeKey ? 'showing' : 'connected · switch to this connection'}`}
              onClick={() => onSelect(s.key)} onContextMenu={editOnRightClick(entryOf(s))}>
              <span className="nx-db-dot" data-tone="ok" aria-hidden="true" />
              {nameOf(s)}
            </button>
            {onEdit && entryOf(s) && (
              <button type="button" className="nx-db-conn-x" aria-label={`Edit ${nameOf(s)}`} title="Edit this connection"
                onClick={() => onEdit(entryOf(s))}>
                <Icon name="edit" size={11} />
              </button>
            )}
            <button type="button" className="nx-db-conn-x" aria-label={`Close ${nameOf(s)}`} title="Close this connection"
              onClick={() => onClose(s.key)}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {savedConnections.filter(entry => !openIds.has(entry.id)).map(entry => (deferred.includes(entry.id) ? (
          // Open last time, but it signs in through the browser, so it waits for a click.
          <span key={entry.id} className="nx-db-conn" role="presentation" data-closed="">
            <button type="button" role="tab" aria-selected={false}
              title={`${typeLabel(entry.type)} · open last time · click to sign in and reopen`}
              disabled={connectingId != null} onClick={() => onOpenSaved(entry)} onContextMenu={editOnRightClick(entry)}>
              <span className="nx-db-dot" data-tone="info" aria-hidden="true" />
              {entry.name}
              {connectingId === entry.id && <span className="nx-db-spinner sm" aria-hidden="true" />}
            </button>
            <button type="button" className="nx-db-conn-x" aria-label={`Don't reopen ${entry.name}`} title="Don't reopen this next time"
              onClick={() => onForget?.(entry.id)}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ) : (
          <button key={entry.id} type="button" role="tab" aria-selected={false} data-closed=""
            title={`${typeLabel(entry.type)} · not connected · connect in a new tab${onEdit ? ' · right-click to edit' : ''}`}
            disabled={connectingId != null} onClick={() => onOpenSaved(entry)} onContextMenu={editOnRightClick(entry)}>
            {entry.name}
            {connectingId === entry.id && <span className="nx-db-spinner sm" aria-hidden="true" />}
          </button>
        )))}
      </div>
      <button type="button" className="nx-db-plus" aria-label="New connection" title="Connect to another database" onClick={onNew}>+ Connect</button>
    </div>
  )
}

const TableFilter = forwardRef(function TableFilter({ value, onChange }, ref) {
  return (
    <div className="nx-db-search">
      <input ref={ref} aria-label="Filter tables" placeholder="Filter tables" value={value}
        onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange('') } }} />
      <span className="kbd">/</span>
    </div>
  )
})

function StarButton({ on, onClick, name }) {
  return (
    <button type="button" className="nx-db-star" data-on={on || undefined} aria-pressed={on}
      aria-label={on ? `Unstar ${name}` : `Star ${name}`} title={on ? 'Starred · click to unstar' : 'Star this table to keep it at the top'}
      onClick={e => { e.stopPropagation(); onClick() }}>
      <Icon name="star" size={13} />
    </button>
  )
}

// ─── Table list (sidebar) ─────────────────────────────────────────────────────

function TableList({ tables, total, selected, starred, meta, prefs, views, onToggleGroup, onSetCollapsed, onOpen, onStar, onClearFilters, onTableMenu, onSectionMenu, onCloseTable }) {
  const sections = tableSections(tables, prefs, { views })
  const shownKeys = sections.map(s => s.key)
  const pinned = tables.filter(t => starred.has(t))
  if (!total) return <div className="nx-db-list-empty">This database has no tables.</div>
  if (!tables.length) {
    return (
      <div className="nx-db-list-empty">
        <strong>No tables match</strong>
        <button type="button" className="nx-db-crumb-link" onClick={onClearFilters}>Clear filters</button>
      </div>
    )
  }
  // Under its schema a table shows without the schema; in a group of your own it keeps it.
  const row = (name, { inStarred = false, fullName = false } = {}) => {
    const m = meta[name]
    return (
      <div key={`${inStarred ? 's' : 'g'}:${name}`} className="nx-db-row" aria-current={name === selected ? 'true' : undefined}
        onContextMenu={e => { e.preventDefault(); onTableMenu(name, { x: e.clientX, y: e.clientY }) }}>
        <button type="button" className="nx-db-row-open" onClick={() => onOpen(name)} title={name}>
          <span className="nx-db-dot" data-tone={name === selected ? 'ok' : m ? 'info' : undefined} />
          <span className="nx-db-row-body">
            <span className="nx-db-row-title">
              {fullName || !name.includes('.') ? name : name.slice(name.indexOf('.') + 1)}
              {views?.has(name) && <span className="nx-db-tag" data-tone="muted">view</span>}
            </span>
            {m && <span className="nx-db-row-meta">{`${plural(m.rows, 'row')} · ${plural(m.cols, 'col')}`}</span>}
          </span>
        </button>
        {(m || name === selected) && (
          <button type="button" className="nx-db-row-close" aria-label={`Close ${name}`} title="Close this table (takes it out of Opened)"
            onClick={e => { e.stopPropagation(); onCloseTable(name) }}>
            <Icon name="x" size={11} />
          </button>
        )}
        <StarButton on={starred.has(name)} onClick={() => onStar(name)} name={name} />
        <MenuButton label={`More for ${name}`} title="More options (or right-click the table)" onOpen={point => onTableMenu(name, point)} />
      </div>
    )
  }
  return (
    <div className="nx-db-list">
      <div className="nx-db-list-bar">
        <div className="nx-db-list-keys" title="j / k move through the tables">
          <span className="kbd">j</span><span className="kbd">k</span><span>to move</span>
        </div>
        {/* Folds the sections shown; ones the filter hides keep their own state. */}
        {shownKeys.length > 1 && (
          <FoldAllButton what="groups" allCollapsed={shownKeys.every(k => prefs.collapsed.includes(k))}
            onExpandAll={() => onSetCollapsed(prefs.collapsed.filter(k => !shownKeys.includes(k)))}
            onCollapseAll={() => onSetCollapsed([...prefs.collapsed, ...shownKeys.filter(k => !prefs.collapsed.includes(k))])} />
        )}
      </div>
      {pinned.length > 0 && (
        <div className="nx-db-group">
          <div className="nx-db-group-head static">
            <span className="nx-db-group-name" data-tone="warn">Starred</span>
            <span className="nx-db-group-count">{pinned.length}</span>
          </div>
          <div className="nx-db-rows">{pinned.map(t => row(t, { inStarred: true, fullName: true }))}</div>
        </div>
      )}
      {sections.map(s => {
        const open = !prefs.collapsed.includes(s.key)
        return (
          <div key={s.key} className="nx-db-group" data-kind={s.kind}>
            <div className="nx-db-group-bar" onContextMenu={e => { e.preventDefault(); onSectionMenu(s, shownKeys, { x: e.clientX, y: e.clientY }) }}>
              <button type="button" className="nx-db-group-head" aria-expanded={open} onClick={() => onToggleGroup(s.key)}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
                {s.kind === 'group' && <Icon name="folder" size={12} />}
                <span className="nx-db-group-name">{s.label}</span>
                <span className="nx-db-group-count">{s.names.length}</span>
              </button>
              <MenuButton label={s.kind === 'group' ? `Edit group ${s.name}` : `More for ${s.label}`} title="More options (or right-click the header)"
                onOpen={point => onSectionMenu(s, shownKeys, point)} />
            </div>
            {open && <div className="nx-db-rows">{s.names.map(t => row(t, { fullName: s.kind === 'group' }))}</div>}
          </div>
        )
      })}
    </div>
  )
}

// The "⋯" button that opens a table's or section's menu, under itself.
function MenuButton({ label, title, onOpen }) {
  return (
    <button type="button" className="nx-db-rowmenu-btn" aria-label={label} aria-haspopup="menu" title={title}
      onClick={e => { e.stopPropagation(); onOpen(menuPointFor(e.currentTarget)) }}>
      <Icon name="more" size={14} />
    </button>
  )
}

// ─── Overview (nothing open) ──────────────────────────────────────────────────

function Overview({ session, tables, starred, recent, meta, history, onOpen, onCloseRecent, onUseQuery, onJump, saved = [], onRunSaved }) {
  const tableRow = (name, desc, closable = false) => (
    <div key={name} className="nx-db-ov-row">
      <button type="button" className="nx-db-ov-open" onClick={() => onOpen(name)}>
        <span className="name">{name}</span>
        {desc && <span className="desc">{desc}</span>}
      </button>
      <div className="nx-db-ov-actions">
        <button type="button" className="btn sm ghost" onClick={() => onOpen(name, 'query')}>Query</button>
        <button type="button" className="btn sm accent" onClick={() => onOpen(name)}>Browse</button>
        {closable && (
          <button type="button" className="btn sm ghost" aria-label={`Close ${name}`} title="Close this table (takes it out of Opened)" onClick={() => onCloseRecent([name])}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    </div>
  )
  const described = name => (meta[name] ? `${plural(meta[name].rows, 'row')} · ${plural(meta[name].cols, 'column')} · read ${clock(meta[name].at)}` : null)
  return (
    <div className="nx-db-ov">
      <div className="nx-db-ov-title">
        <h2>{sessionName(session)}</h2>
        <span className="muted">{typeLabel(session.type) === sessionName(session) ? plural(tables.length, 'table') : `${plural(tables.length, 'table')} · ${typeLabel(session.type)}`}</span>
      </div>
      {starred.length > 0 && (
        <section className="nx-db-card" aria-label="Starred tables">
          <div className="nx-db-card-head">
            <span className="nx-db-dot" data-tone="warn" />
            <span className="nx-db-card-title">Starred</span>
            <span className="hint">kept for this connection</span>
          </div>
          {starred.map(t => tableRow(t, described(t)))}
        </section>
      )}
      {recent.length > 0 && (
        <section className="nx-db-card" aria-label="Recently opened">
          <div className="nx-db-card-head">
            <span className="nx-db-dot" data-tone="info" />
            <span className="nx-db-card-title">Recently opened</span>
            <span className="hint">this session</span>
            <span className="nx-db-spacer" />
            <button type="button" className="btn sm ghost" onClick={() => onCloseRecent(recent)}>Close all</button>
          </div>
          {recent.map(t => tableRow(t, described(t), true))}
        </section>
      )}
      {saved.length > 0 && (
        <section className="nx-db-card" aria-label="Saved queries">
          <div className="nx-db-card-head">
            <span className="nx-db-dot" data-tone="ok" />
            <span className="nx-db-card-title">Saved queries</span>
            <span className="hint">templates run on the table you pick</span>
          </div>
          {saved.map(q => <SavedOverviewRow key={q.id} q={q} tables={tables} onRun={onRunSaved} />)}
        </section>
      )}
      {history.length > 0 && (
        <section className="nx-db-card" aria-label="Recent queries">
          <div className="nx-db-card-head">
            <span className="nx-db-dot" data-tone="muted" />
            <span className="nx-db-card-title">Recent queries</span>
            <span className="hint">{plural(history.length, 'query', 'queries')}</span>
          </div>
          {history.slice(0, 6).map(q => (
            <div key={q.at + q.sql} className="nx-db-ov-row">
              <button type="button" className="nx-db-ov-open" onClick={() => onUseQuery(q)}>
                <code className="sql">{q.sql}</code>
                <span className="desc" data-tone={q.ok ? undefined : 'bad'}>{`${clock(q.at)} · ${q.summary}`}</span>
              </button>
              <div className="nx-db-ov-actions">
                <button type="button" className="btn sm ghost" onClick={() => onUseQuery(q)}>Open in Query</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {!starred.length && !recent.length && !history.length && !saved.length && (
        <div className="nx-db-empty-good">
          <p>Pick a table on the left, or jump straight to one.</p>
          <button type="button" className="btn sm" onClick={onJump} disabled={!tables.length}>Jump to table… <span className="kbd">Ctrl K</span></button>
        </div>
      )}
    </div>
  )
}

// ─── Ctrl+K palette ───────────────────────────────────────────────────────────

function TablePalette({ tables, starred, meta, selected, onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  // Starred first, then opened, then the rest; filtered by word starts.
  const results = useMemo(() => {
    const rank = t => (starred.has(t) ? 0 : meta[t] ? 1 : 2)
    return tables.filter(t => matchesWords(t, query)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 200)
  }, [tables, query, starred, meta])
  const current = Math.min(index, Math.max(0, results.length - 1))
  const listbox = useRef(null)
  useEffect(() => { listbox.current?.children[current]?.scrollIntoView?.({ block: 'nearest' }) }, [current, results])
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(current + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(current - 1, 0)) }
    else if (e.key === 'Enter' && results[current]) { e.preventDefault(); onOpen(results[current], (e.ctrlKey || e.metaKey) ? 'query' : 'browse') }
  }
  return (
    <PlModal open onClose={onClose} title="Jump to table" sub="Enter to browse · Ctrl+Enter to query" icon="database" className="nx-db-palette">
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus role="combobox" aria-label="Table name" aria-autocomplete="list" aria-controls="db-palette-list" aria-expanded={!!results.length}
          aria-activedescendant={results.length ? `db-palette-${current}` : undefined} placeholder="Type a table name" value={query}
          onKeyDown={onKeyDown} onChange={e => { setQuery(e.target.value); setIndex(0) }} className="nx-db-pal-input" />
        <div ref={listbox} id="db-palette-list" role="listbox" aria-label="Tables found" className="nx-db-pal-list">
          {results.map((t, i) => (
            <div key={t} id={`db-palette-${i}`} role="option" aria-selected={i === current} aria-current={t === selected ? 'true' : undefined}
              className="nx-db-pal-row" onClick={() => onOpen(t)} onMouseMove={() => { if (i !== current) setIndex(i) }}>
              <span className="nx-db-dot" data-tone={starred.has(t) ? 'warn' : meta[t] ? 'info' : undefined} />
              <span className="nx-db-pal-main">{t}</span>
              <span className="nx-db-pal-meta">{meta[t] ? plural(meta[t].rows, 'row') : starred.has(t) ? 'starred' : ''}</span>
            </div>
          ))}
        </div>
        {!results.length && <div className="nx-db-muted">No tables match.</div>}
      </div>
    </PlModal>
  )
}

// ─── Connect dialog ───────────────────────────────────────────────────────────

const AUTH_OPTIONS = [[SQL_AUTH, 'SQL Server authentication'], [AZURE_AD_INTERACTIVE, 'Microsoft Entra ID (Azure AD) interactive']]

// `editing` ({ entry, secret }) turns it into the editor for that saved connection: filled in from
// it, always saved (under the same id, by onSaveEdit), and without the saved list or the demo.
function ConnectDialog({ onConnect, savedConnections = [], onConnectSaved, openConnectionIds = [], onClose, loading, error, canSave = false, editing = null, editingOpen = false, onSaveEdit }) {
  const entry = editing?.entry
  const [dbType, setDbType]       = useState(() => entry?.type ?? readPref('nx-db:last-type', 'demo'))
  const [inputMode, setInputMode] = useState(entry?.inputMode === 'connstr' ? 'connstr' : 'fields')
  const [connStr, setConnStr]     = useState(entry?.inputMode === 'connstr' ? editing.secret : '')
  const [fields, setFields]       = useState(() => {
    const blank = {
      host: '', port: '1433', database: '', user: '', password: '',
      encrypt: true, trustServerCertificate: false, filePath: '', authentication: SQL_AUTH,
    }
    if (!entry || entry.inputMode === 'connstr') return blank
    const pick = Object.fromEntries(Object.keys(blank).filter(k => entry[k] != null && entry[k] !== '').map(k => [k, entry[k]]))
    return { ...blank, ...pick, password: editing.secret }
  })
  const [connectingId, setConnectingId] = useState(null)

  const [fillError, setFillError] = useState(null)
  // Saved connections show as tabs and in Settings, and reopen next time; a one-off one doesn't.
  const [saveIt, setSaveIt]       = useState(true)
  const [saveName, setSaveName]   = useState(entry?.name ?? '')

  const setField = (k, v) => setFields(f => ({ ...f, [k]: v }))
  const interactive = fields.authentication === AZURE_AD_INTERACTIVE

  // The name a saved connection gets unless one is typed: the database, else the server or file.
  const suggestedName = (() => {
    const fileName = path => (path || '').split(/[\\/]/).pop()
    let f = fields
    if (inputMode === 'connstr') {
      try { f = connStr.trim() ? connectionStringToFields(dbType, connStr) : {} } catch { f = {} }
    }
    return (dbType === 'sqlite' ? fileName(f.filePath) : f.database || f.host) || ''
  })()
  const nameTaken = saveIt && savedConnections.some(c => c.id !== entry?.id && c.name.toLowerCase() === (saveName.trim() || suggestedName).toLowerCase())

  // Parses the pasted connection string into the form, then shows the Fields tab.
  const fillFromConnStr = () => {
    try {
      const parsed = connectionStringToFields(dbType, connStr)
      setFields(f => ({ ...f, ...parsed }))
      setFillError(null)
      setInputMode('fields')
    } catch (err) {
      setFillError(`Couldn't read that connection string: ${err.message}`)
    }
  }

  const submit = (e) => {
    e?.preventDefault?.()
    if (loading) return
    const params = inputMode === 'connstr' ? { connectionString: connStr } : fields
    // Editing can't take another saved connection's name: that would be two with one name.
    if (entry) { if (!nameTaken) onSaveEdit(dbType, params, saveName.trim() || suggestedName || entry.name); return }
    writePref('nx-db:last-type', dbType)
    if (dbType === 'demo') { onConnect('demo', {}); return }
    onConnect(dbType, params, canSave && saveIt ? { name: saveName.trim() || suggestedName || typeLabel(dbType) } : null)
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
    'Server=myserver.database.windows.net;Database=mydb;Authentication=Active Directory Interactive;',
  ].join('\n')

  return (
    <PlModal
      open
      onClose={onClose}
      icon="database"
      title={entry ? 'Edit connection' : 'Connect to database'}
      wide
      className="nx-db-connect"
      footerLeft={dbType !== 'demo'
        ? <span className="nx-db-muted">{loading && dbType === 'sqlserver' && interactive && inputMode === 'fields' ? 'Finish signing in in your browser…' : 'Enter to connect'}</span>
        : null}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-connect-form" className="btn accent" disabled={loading || (!!entry && nameTaken)}>
            {entry ? (editingOpen ? 'Save and reconnect' : 'Save') : loading ? 'Connecting…' : dbType === 'demo' ? 'Load demo' : 'Connect'}
          </button>
        </>
      )}
    >
      {/* Everything below scrolls together as one region (PlModal's own
          .plm-body), so a long saved-connection list never overlaps/clips
          the type selector or form fields beneath it. */}
      <form id="nx-db-connect-form" className="nx-db-connect-form" onSubmit={submit}>
        {error && <div className="nx-db-alert bad" role="alert">{error}</div>}

        {/* Saved connections (configured in Settings → Integrations) */}
        {!entry && savedConnections.length > 0 && (
          <div className="nx-db-saved">
            <p className="nx-db-label">Saved connections</p>
            {savedConnections.map(entry => (
              <button
                key={entry.id}
                type="button"
                className="nx-db-saved-row"
                aria-current={openConnectionIds.includes(entry.id) ? 'true' : undefined}
                onClick={() => connectSaved(entry)}
                disabled={connectingId != null}
              >
                <Icon name="database" size={14} />
                <span className="name">{entry.name}</span>
                <span className="type">
                  {entry.type === 'sqlite' ? 'SQLite' : 'SQL Server'}
                </span>
                {openConnectionIds.includes(entry.id) && <span className="nx-db-tag">Open</span>}
                {connectingId === entry.id && <span className="nx-db-spinner" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}

        {/* Type selector */}
        <div className="nx-db-types" role="group" aria-label="Database type">
          {[...(entry ? [] : [['demo', 'Demo', 'Sample data']]), ['sqlite', 'SQLite', 'A local .db file'], ['sqlserver', 'SQL Server', 'Host or connection string']].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              className="nx-db-type"
              onClick={() => { setDbType(id); setInputMode('fields'); setConnStr(''); setFillError(null) }}
              aria-pressed={dbType === id}
            >
              <span className="t">{label}</span>
              <span className="h">{hint}</span>
            </button>
          ))}
        </div>

        {/* Input mode toggle */}
        {dbType !== 'demo' && (
          <div className="nx-db-seg sm" role="tablist" aria-label="Input mode" style={{ width: 'fit-content' }}>
            {[['fields', 'Fields'], ['connstr', 'Connection string']].map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={inputMode === m}
                onClick={() => setInputMode(m)}
              >
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
              className="db-input db-textarea--mono"
              value={connStr}
              onChange={e => { setConnStr(e.target.value); setFillError(null) }}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e) }}
              rows={4}
              autoFocus
              placeholder={dbType === 'sqlserver' ? sqlserverPlaceholder : 'sqlite:///absolute/path/to/file.db\nor just: /path/to/file.db'}
            />
            <div className="db-field--row nx-db-fill">
              <button type="button" className="btn sm" disabled={!connStr.trim()} onClick={fillFromConnStr}>
                <Icon name="wand" size={12} />Fill in fields
              </button>
              {fillError
                ? <span className="db-hint" data-tone="bad" role="alert">{fillError}</span>
                : <span className="db-hint">Reads the string into the Fields tab, so you can check or change it.</span>}
            </div>
          </div>
        )}

        {dbType === 'sqlite' && inputMode === 'fields' && (
          <div className="db-field">
            <label className="db-label" htmlFor="db-filepath">File path</label>
            <input id="db-filepath" className="db-input" type="text" placeholder="/absolute/path/to/file.db" autoFocus
              value={fields.filePath} onChange={e => setField('filePath', e.target.value)} />
            <p className="db-hint">Path as it appears on the machine running the desktop app.</p>
          </div>
        )}

        {dbType === 'sqlserver' && inputMode === 'fields' && (
          <div className="db-field-grid">
            <div className="db-field db-field--span2">
              <label className="db-label" htmlFor="db-host">Server / Host</label>
              <input id="db-host" className="db-input" type="text" placeholder="myserver.database.windows.net" autoFocus
                value={fields.host} onChange={e => setField('host', e.target.value)} />
            </div>
            <div className="db-field">
              <label className="db-label" htmlFor="db-port">Port</label>
              <input id="db-port" className="db-input" type="text" inputMode="numeric" placeholder="1433"
                value={fields.port} onChange={e => setField('port', e.target.value)} />
            </div>
            <div className="db-field">
              <label className="db-label" htmlFor="db-database">Database</label>
              <input id="db-database" className="db-input" type="text" placeholder="my_database"
                value={fields.database} onChange={e => setField('database', e.target.value)} />
            </div>
            <div className="db-field db-field--span2">
              <label className="db-label" htmlFor="db-auth">Authentication</label>
              <select id="db-auth" className="db-input" value={fields.authentication}
                onChange={e => setField('authentication', e.target.value)}>
                {AUTH_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
            {interactive ? (
              <div className="db-field db-field--span2">
                <label className="db-label" htmlFor="db-user">Account (optional)</label>
                <input id="db-user" className="db-input" type="email" placeholder="name@company.com" autoComplete="username"
                  value={fields.user} onChange={e => setField('user', e.target.value)} />
                <p className="db-hint">Connecting opens your browser to sign in with Microsoft Entra ID, with multi-factor authentication if your organisation requires it.</p>
              </div>
            ) : (
              <>
                <div className="db-field">
                  <label className="db-label" htmlFor="db-user">Username</label>
                  <input id="db-user" className="db-input" type="text" placeholder="sa" autoComplete="username"
                    value={fields.user} onChange={e => setField('user', e.target.value)} />
                </div>
                <div className="db-field">
                  <label className="db-label" htmlFor="db-password">Password</label>
                  <input id="db-password" className="db-input" type="password" autoComplete="current-password"
                    value={fields.password} onChange={e => setField('password', e.target.value)} />
                </div>
              </>
            )}
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

        {dbType !== 'demo' && canSave && (
          <div className="nx-db-save-conn">
            {!entry && (
              <label className="db-checkbox-label">
                <input type="checkbox" checked={saveIt} onChange={e => setSaveIt(e.target.checked)} />
                Save this connection
              </label>
            )}
            {saveIt && (
              <input className="db-input" aria-label="Connection name" placeholder={suggestedName || 'Name, e.g. UAT'}
                value={saveName} onChange={e => setSaveName(e.target.value)} />
            )}
            <p className="db-hint" data-tone={entry && nameTaken ? 'bad' : undefined}>
              {entry
                ? (nameTaken ? 'Another saved connection already has this name.' : 'Saved here and in Settings. Leave the password blank to keep the saved one.')
                : !saveIt
                ? 'Just for now: it closes with the app and won’t be in your saved connections.'
                : nameTaken
                  ? 'Replaces the saved connection with this name.'
                  : 'Kept with your saved connections (and in Settings), password in secure storage, and reopened next time.'}
            </p>
          </div>
        )}
      </form>
    </PlModal>
  )
}

// ─── Browse panel ─────────────────────────────────────────────────────────────

const typeTitle = col => [
  typeLabelOf(col),
  col.nullable ? 'allows NULL' : 'required',
  col.isIdentity && 'set by the database (identity)',
  col.isComputed && 'computed',
  col.hasDefault && !col.isIdentity && 'has a default',
].filter(Boolean).join(' · ')

const INPUT_TYPES = { date: 'date', time: 'time', datetime: 'datetime-local' }
const OFFSET_FORMAT = 'YYYY-MM-DDTHH:MM:SS+HH:MM'

// The box a value is typed into, shaped by the column's type: number boxes only take what a
// number may hold, dates and times use pickers, text stops at the column's length.
const CellInput = forwardRef(function CellInput({ col, value, onChange, className = 'nx-db-cell-input', ...rest }, ref) {
  const kind = columnKind(col)
  return (
    <input
      ref={ref}
      className={className}
      type={INPUT_TYPES[kind] ?? 'text'}
      step={kind === 'time' || kind === 'datetime' ? 1 : undefined}
      inputMode={kind === 'integer' ? 'numeric' : kind === 'decimal' ? 'decimal' : undefined}
      maxLength={kind === 'text' && col?.maxLength > 0 ? col.maxLength : undefined}
      spellCheck={kind === 'text' ? undefined : false}
      placeholder={kind === 'datetimeoffset' ? OFFSET_FORMAT : undefined}
      value={value}
      onChange={e => { if (isPartialInput(kind, e.target.value)) onChange(e.target.value) }}
      {...rest}
    />
  )
})

// The → at the end of a foreign key cell (a composite key's first column). A click follows it; the
// value itself stays a plain value, so a double-click on the cell still edits.
function FollowButton({ fk, targets, column, value, onFollow }) {
  const target = fk && targets.find(t => t.key === fk.name)
  if (!target) return null
  return (
    <button type="button" className="nx-db-follow" aria-label={`Follow ${column} ${value} to ${fk.refTable}`}
      title={`Open ${fk.refTable} where ${whereLabel(target.where)}`}
      onClick={() => onFollow(target)} onDoubleClick={e => e.stopPropagation()}>→</button>
  )
}

const BrowsePanel = forwardRef(function BrowsePanel({
  tableData, visible, keyIdx, columnInfo, minimised, onMinimise, onRestore, onRestoreAll, canWrite, columnsKnown, typesUnreadable = false, isView = false, foreignKeys = [], onSetCell, onAddRow,
  table, where = null, onClearFilter, onFollow, nullFilter = null, onClearNullFilter, onHeaderMenu, onRowMenu, gridRef, search, onSearchChange, sort, onSort,
  selectedRows, allSelected, onToggleRow, onToggleAll, onClearSelection, onDeleteSelected, onDeleteRow, onCopyCell,
  editingCell, editValue, onEditValueChange, onStartEdit, onSaveEdit, onCancelEdit,
}, ref) {
  const total = tableData.rows.length
  const cols = tableData.columns.length
  // A column whose first value is a number lines its header up with its right-aligned values.
  const numericCol = tableData.columns.map((_, ci) => isNumeric(tableData.rows.find(r => r[ci] !== null && r[ci] !== undefined)?.[ci]))
  // Tab / Shift+Tab move the editor along the row (and on to the next / previous row) after saving,
  // passing over minimised columns.
  const neighbour = (ri, ci, by) => {
    let p = visible.findIndex(v => v.i === ri), c = ci + by
    for (;;) {
      if (c >= cols) { c = 0; p++ } else if (c < 0) { c = cols - 1; p-- }
      if (p < 0 || p >= visible.length) return null
      if (!minimised.has(tableData.columns[c])) return { ri: visible[p].i, ci: c }
      c += by
    }
  }
  const editError = editingCell ? parseCellInput(columnInfo[editingCell.ci], editValue).error : null
  const readOnly = !canWrite && (columnsKnown || typesUnreadable)
  const canAdd = columnsKnown || typesUnreadable
  // A view has no keys of its own to follow.
  const followable = isView ? [] : foreignKeys
  // A right-click, or the ContextMenu key / Shift+F10 on whatever has focus: that has no mouse
  // point, so the menu opens under the element instead.
  const menuPoint = (e, el) => {
    if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY }
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.bottom + 4 }
  }
  const firstShown = tableData.columns.findIndex(c => !minimised.has(c))
  // A row's menu is for the cell clicked; from the tick box or the row's buttons, its first shown column.
  const rowContextMenu = (e, ri) => {
    if (e.target.closest?.('.nx-db-cell-edit')) return // the editor keeps the browser's own cut / paste menu
    const td = e.target.closest?.('td')
    const ci = td?.dataset.ci != null ? Number(td.dataset.ci) : firstShown
    if (ci < 0) return
    e.preventDefault()
    onRowMenu(ri, ci, menuPoint(e, td ?? e.currentTarget))
  }
  return (
    <div className="nx-db-browse">
      <div className="nx-db-browse-tools">
        <div className="nx-db-search wide">
          <Icon name="search" size={13} className="ic" />
          <input
            ref={ref}
            type="search"
            placeholder="Search rows…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.stopPropagation(); onSearchChange('') } }}
            aria-label="Search rows"
          />
          {!search && <span className="kbd">Ctrl F</span>}
        </div>
        <span className="nx-db-count" aria-live="polite">
          {search || nullFilter ? `${visible.length} of ${total} matching` : `${total} total`}
        </span>
        {where && (
          <span className="nx-db-chip">{whereLabel(where)}<button type="button" aria-label="Clear filter" title="Show the table's rows again" onClick={onClearFilter}>✕</button></span>
        )}
        {nullFilter && (
          <span className="nx-db-chip">{nullFilter}<button type="button" aria-label={`Clear ${nullFilter}`} title="Show every loaded row again" onClick={onClearNullFilter}>✕</button></span>
        )}
        {minimised.size > 0 && (
          <button type="button" className="btn sm ghost" onClick={onRestoreAll} aria-label="Show all minimised columns">
            {`${minimised.size} minimised · Show all`}
          </button>
        )}
        <span className="nx-db-spacer" />
        {selectedRows.size > 0 && (
          <>
            <span className="nx-db-count">{`${selectedRows.size} selected`}</span>
            <button type="button" className="btn sm ghost" onClick={onClearSelection}>Clear</button>
            <button type="button" className="btn sm danger" onClick={onDeleteSelected} disabled={!canWrite}>
              <Icon name="trash" size={13} />
              Delete {plural(selectedRows.size, 'row')}
            </button>
          </>
        )}
        <button type="button" className="btn sm" onClick={onAddRow} disabled={!canAdd || isView}
          title={isView ? 'A view shows rows from its tables; add rows there' : canAdd ? 'Add a row to this table' : 'Reading the table’s columns…'}>
          <Icon name="plus" size={13} />Add row
        </button>
      </div>

      {readOnly && (
        <p className="nx-db-alert" role="note">
          {isView
            ? 'This is a view: it shows rows from other tables, so it’s read-only here. Change the rows in their own tables.'
            : typesUnreadable
              ? "Couldn't read this table's column types, so editing and deleting are off. You can still add rows, or change rows from the Query tab."
              : 'This table has no primary key, so a change can’t be kept to one row: editing and deleting are off. You can still add rows, or change rows from the Query tab.'}
        </p>
      )}

      <div className="nx-db-table-wrap" role="region" aria-label="Table data" tabIndex={0} ref={gridRef}>
        <table className="nx-db-table">
          <thead>
            <tr>
              <th className="check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label="Select all rows"
                />
              </th>
              {tableData.columns.map((col, ci) => {
                const dir = sort?.col === ci ? sort.dir : null
                if (minimised.has(col)) {
                  return (
                    <th key={col} className="min">
                      <button type="button" className="nx-db-th-min" onClick={() => onRestore(col)} aria-label={`Show ${col}`} title={`Show ${col}`}>{col}</button>
                    </th>
                  )
                }
                return (
                  <th key={col} data-num={numericCol[ci] || undefined} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    onContextMenu={e => { e.preventDefault(); onHeaderMenu(ci, menuPoint(e, e.currentTarget)) }}>
                    <button type="button" className="nx-db-th" onClick={() => onSort(ci)} title={`Sort by ${col} · right-click for more`}>
                      <span>{col}</span>
                      {keyIdx.includes(ci) && <span className="pk" title="Key used for edits and deletes">key</span>}
                      {foreignKeys.filter(fk => fk.columns.includes(col)).map(fk => {
                        const target = fk.refColumns[fk.columns.indexOf(col)]
                        return <span key={fk.name} className="fk" title={`→ ${fk.refTable}${target ? `.${target}` : ''}`}>fk</span>
                      })}
                      {columnInfo[ci] && <span className="nx-db-coltype" title={typeTitle(columnInfo[ci])}>{typeLabelOf(columnInfo[ci])}</span>}
                      <Icon name={dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={11} className={`sort${dir ? ' on' : ''}`} />
                    </button>
                    <button type="button" className="nx-db-th-hide" onClick={() => onMinimise(col)} aria-label={`Minimise ${col}`} title={`Minimise ${col}`}>
                      <Icon name="x" size={11} />
                    </button>
                  </th>
                )
              })}
              <th className="actions"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, i: ri }, vi) => {
              // Keys with a NULL part are left out, so only a value that's there can be followed.
              const targets = followable.length ? followTargets({ foreignKeys: followable }, tableData.columns, row) : []
              return (
                <tr key={ri} aria-selected={selectedRows.has(ri) || undefined} onContextMenu={e => rowContextMenu(e, ri)}>
                  <td className="check">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(ri)}
                      onChange={() => onToggleRow(ri)}
                      aria-label={`Select row ${vi + 1}`}
                    />
                  </td>
                  {row.map((cell, ci) => {
                    const col = columnInfo[ci]
                    const kind = columnKind(col)
                    if (minimised.has(tableData.columns[ci])) return <td key={ci} className="min" />
                    const editing = editingCell?.ri === ri && editingCell?.ci === ci
                    const editable = canWrite && kind !== 'readonly'
                    // A bit is a checkbox in the cell itself: one click writes the other value.
                    if (kind === 'boolean') {
                      return (
                        <td key={ci} className="bool" data-ci={ci}>
                          <input
                            type="checkbox"
                            checked={cell === true || cell === 1}
                            ref={el => { if (el) el.indeterminate = cell === null || cell === undefined }}
                            disabled={!editable}
                            onChange={e => onSetCell(ri, ci, e.target.checked)}
                            aria-label={`${tableData.columns[ci]} for row ${vi + 1}`}
                            title={cell === null || cell === undefined ? 'NULL' : undefined}
                          />
                        </td>
                      )
                    }
                    return (
                      <td
                        key={ci}
                        data-ci={ci}
                        data-num={isNumeric(cell) || undefined}
                        data-editing={editing || undefined}
                        data-invalid={(editing && editError) || undefined}
                        onDoubleClick={() => !editing && editable && onStartEdit(ri, ci, cell)}
                        title={editing ? undefined : `${cell === null || cell === undefined ? 'NULL' : String(cell)}${editable ? '\nDouble-click to edit' : kind === 'readonly' ? '\nSet by the database' : ''}`}
                      >
                        {editing ? (
                          <div className="nx-db-cell-edit">
                            <CellInput
                              col={col}
                              autoFocus
                              onFocus={e => e.target.select?.()}
                              value={editValue}
                              onChange={onEditValueChange}
                              onBlur={() => onSaveEdit(null, { leaving: true })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); onSaveEdit() }
                                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancelEdit() }
                                else if (e.key === 'Tab') { e.preventDefault(); onSaveEdit(neighbour(ri, ci, e.shiftKey ? -1 : 1)) }
                              }}
                              aria-label={`Edit ${tableData.columns[ci]}`}
                              aria-invalid={!!editError || undefined}
                            />
                            {col?.nullable && (
                              // mousedown so the box's blur (which saves what's typed) doesn't fire first.
                              <button type="button" className="nx-db-null-btn" title="Set to NULL"
                                onMouseDown={e => { e.preventDefault(); onSaveEdit(null, { isNull: true }) }}>NULL</button>
                            )}
                            {editError && <span className="nx-db-cell-error" role="alert">{editError}</span>}
                          </div>
                        ) : (
                          <>
                            <CellValue value={cell} />
                            <FollowButton fk={followable.find(k => k.columns[0] === tableData.columns[ci])} targets={targets}
                              column={tableData.columns[ci]} value={cell} onFollow={onFollow} />
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="actions">
                    <button
                      type="button"
                      className="nx-db-row-act"
                      onClick={() => onCopyCell(row.map(c => (c === null || c === undefined ? '' : String(c))).join('\t'))}
                      aria-label={`Copy row ${vi + 1}`}
                      title="Copy row (tab-separated)"
                    >
                      <Icon name="copy" size={13} />
                    </button>
                    <button
                      type="button"
                      className="nx-db-row-act danger"
                      onClick={() => onDeleteRow(ri)}
                      disabled={!canWrite}
                      aria-label={`Delete row ${vi + 1}`}
                      title={canWrite ? 'Delete row' : 'No primary key, so this row can’t be deleted on its own'}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={cols + 2} className="empty">
                  {total > 0 ? (nullFilter ? `No rows where ${nullFilter}${search ? ' match your search' : ''}` : 'No rows match your search') : where ? `No row in ${table} has ${whereLabel(where)}` : 'This table is empty'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="nx-db-foot-hint">
        <span>Double-click a cell to edit</span>
        <span><span className="kbd">Enter</span> save · <span className="kbd">Tab</span> next cell · <span className="kbd">Esc</span> cancel</span>
        <span>Click a column to sort · right-click a column or row for more</span>
      </div>
    </div>
  )
})

// ─── New table, new view, drop ────────────────────────────────────────────────

const blankColumn = (dialect, extra = {}) => ({
  key: Math.random().toString(36).slice(2), name: '', type: dialect === 'sqlite' ? 'TEXT' : 'nvarchar',
  length: '100', precision: '18', scale: '2', nullable: true, primaryKey: false, identity: false, default: '', ...extra,
})

// Designs a table column by column, with the CREATE TABLE it will run shown as it's built.
function NewTableDialog({ dialect, taken, onCreate, onClose }) {
  const types = columnTypes(dialect)
  const integer = name => types.find(t => t.name === name)?.integer
  const [name, setName] = useState('')
  const [columns, setColumns] = useState(() => [
    blankColumn(dialect, { name: dialect === 'sqlite' ? 'id' : 'Id', type: dialect === 'sqlite' ? 'INTEGER' : 'int', nullable: false, primaryKey: true, identity: true }),
    blankColumn(dialect, { name: dialect === 'sqlite' ? 'name' : 'Name' }),
  ])
  const [failure, setFailure] = useState(null)
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const set = (key, patch) => setColumns(cs => cs.map(c => {
    if (c.key !== key) return c
    const next = { ...c, ...patch }
    if (next.primaryKey) next.nullable = false
    if (next.identity && !integer(next.type)) next.identity = false
    return next
  }))
  const errors = validateTableSpec(dialect, name, columns)
  if (name.trim() && taken.some(t => t.toLowerCase() === name.trim().toLowerCase())) errors.unshift(`There's already a table or view called ${name.trim()}.`)
  const sql = errors.length ? null : buildCreateTable(dialect, name, columns)

  const submit = async (e) => {
    e.preventDefault()
    setTried(true)
    if (errors.length) return
    setSaving(true)
    setFailure(await onCreate(sql, name.trim()))
    setSaving(false)
  }

  return (
    <PlModal open onClose={onClose} icon="plus" title="New table" sub="Design its columns; the SQL it runs is shown below." wide className="nx-db-ddl"
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-newtable" className="btn accent" disabled={saving}>{saving ? 'Creating…' : 'Create table'}</button>
        </>
      )}>
      <form id="nx-db-newtable" className="nx-db-ddl-form" onSubmit={submit} noValidate>
        {failure && <div className="nx-db-alert bad" role="alert">{failure}</div>}
        <div className="db-field">
          <label className="db-label" htmlFor="db-newtable-name">Table name</label>
          <input id="db-newtable-name" className="db-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MemberNote" />
        </div>
        <table className="nx-db-coldesign" aria-label="Columns">
          <thead>
            <tr><th>Column</th><th>Type</th><th>Size</th><th title="Primary key">Key</th><th title={dialect === 'sqlite' ? 'Numbers itself (AUTOINCREMENT)' : 'Numbers itself (IDENTITY)'}>Auto</th><th>Nullable</th><th>Default</th><th><span className="sr-only">Remove</span></th></tr>
          </thead>
          <tbody>
            {columns.map((c, i) => {
              const t = types.find(x => x.name === c.type)
              return (
                <tr key={c.key}>
                  <td><input className="db-input" aria-label={`Column ${i + 1} name`} value={c.name} onChange={e => set(c.key, { name: e.target.value })} /></td>
                  <td>
                    <select className="db-input" aria-label={`Column ${i + 1} type`} value={c.type} onChange={e => set(c.key, { type: e.target.value })}>
                      {types.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                    </select>
                  </td>
                  <td className="size">
                    {t?.size === 'length' && (
                      <input className="db-input" aria-label={`Column ${i + 1} length`} value={c.length} placeholder={t.allowMax ? 'max' : ''}
                        title={`1 to ${t.max}${t.allowMax ? ', or max' : ''}`} onChange={e => set(c.key, { length: e.target.value })} />
                    )}
                    {t?.size === 'precision' && (
                      <span className="pair">
                        <input className="db-input" aria-label={`Column ${i + 1} precision`} title="Digits in all" value={c.precision} onChange={e => set(c.key, { precision: e.target.value })} />
                        <input className="db-input" aria-label={`Column ${i + 1} scale`} title="Digits after the point" value={c.scale} onChange={e => set(c.key, { scale: e.target.value })} />
                      </span>
                    )}
                  </td>
                  <td className="chk"><input type="checkbox" aria-label={`Column ${i + 1} is the primary key`} checked={c.primaryKey} onChange={e => set(c.key, { primaryKey: e.target.checked })} /></td>
                  <td className="chk"><input type="checkbox" aria-label={`Column ${i + 1} numbers itself`} checked={c.identity} disabled={!t?.integer} onChange={e => set(c.key, { identity: e.target.checked })} /></td>
                  <td className="chk"><input type="checkbox" aria-label={`Column ${i + 1} allows NULL`} checked={c.nullable} disabled={c.primaryKey} onChange={e => set(c.key, { nullable: e.target.checked })} /></td>
                  <td><input className="db-input" aria-label={`Column ${i + 1} default`} value={c.default} disabled={c.identity} placeholder="none"
                    title="A number, text, NULL, or e.g. GETDATE() / NEWID() / CURRENT_TIMESTAMP" onChange={e => set(c.key, { default: e.target.value })} /></td>
                  <td>
                    <button type="button" className="nx-db-row-act danger" aria-label={`Remove column ${i + 1}`} title="Remove this column"
                      onClick={() => setColumns(cs => cs.filter(x => x.key !== c.key))}><Icon name="x" size={12} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div>
          <button type="button" className="btn sm" onClick={() => setColumns(cs => [...cs, blankColumn(dialect)])}><Icon name="plus" size={12} />Add column</button>
        </div>
        {tried && errors.length > 0 && (
          <ul className="nx-db-ddl-errors" role="alert">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        )}
        <div className="db-field">
          <span className="db-label">SQL</span>
          <pre className="nx-db-ddl-preview" aria-label="SQL to run">{sql ?? (tried ? 'Fix the points above to see the SQL.' : 'Name the table and its columns to see the SQL.')}</pre>
        </div>
      </form>
    </PlModal>
  )
}

// A view: a name and the SELECT it shows, run as CREATE VIEW … AS ….
function NewViewDialog({ initialSql = '', taken, onCreate, onClose }) {
  const [name, setName] = useState('')
  const [select, setSelect] = useState(initialSql)
  const [failure, setFailure] = useState(null)
  const [saving, setSaving] = useState(false)
  let sql = null, problem = null
  try { sql = buildCreateView(name, select) } catch (err) { problem = err.message }
  if (!problem && taken.some(t => t.toLowerCase() === name.trim().toLowerCase())) { problem = `There's already a table or view called ${name.trim()}.`; sql = null }
  const submit = async (e) => {
    e.preventDefault()
    if (!sql) return
    setSaving(true)
    setFailure(await onCreate(sql, name.trim()))
    setSaving(false)
  }
  return (
    <PlModal open onClose={onClose} icon="eye" title="New view" sub="A saved SELECT you can browse and query like a table." wide className="nx-db-ddl"
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-newview" className="btn accent" disabled={saving || !sql}>{saving ? 'Creating…' : 'Create view'}</button>
        </>
      )}>
      <form id="nx-db-newview" className="nx-db-ddl-form" onSubmit={submit} noValidate>
        {failure && <div className="nx-db-alert bad" role="alert">{failure}</div>}
        <div className="db-field">
          <label className="db-label" htmlFor="db-newview-name">View name</label>
          <input id="db-newview-name" className="db-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ActiveMembers" />
        </div>
        <div className="db-field">
          <label className="db-label" htmlFor="db-newview-sql">SELECT query</label>
          <textarea id="db-newview-sql" className="db-input db-textarea--mono" rows={7} value={select} onChange={e => setSelect(e.target.value)}
            placeholder="SELECT [Id], [Name] FROM [Member] WHERE [Active] = 1" />
        </div>
        <div className="db-field">
          <span className="db-label">SQL</span>
          <pre className="nx-db-ddl-preview" aria-label="SQL to run">{sql ?? problem}</pre>
        </div>
      </form>
    </PlModal>
  )
}

// Dropping can't be undone, so the name is typed to confirm it.
function DropDialog({ name, view, onDrop, onClose }) {
  const [typed, setTyped] = useState('')
  const [failure, setFailure] = useState(null)
  const [saving, setSaving] = useState(false)
  const what = view ? 'view' : 'table'
  const submit = async (e) => {
    e.preventDefault()
    if (typed !== name) return
    setSaving(true)
    setFailure(await onDrop())
    setSaving(false)
  }
  return (
    <PlModal open onClose={onClose} icon="trash" title={`Drop ${what} ${name}?`} className="nx-db-ddl"
      sub={view ? 'Removes the view; the tables it reads are untouched.' : 'Deletes the table and every row in it. This can’t be undone.'}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-drop" className="btn danger" disabled={saving || typed !== name}>{saving ? 'Dropping…' : `Drop ${what}`}</button>
        </>
      )}>
      <form id="nx-db-drop" className="nx-db-ddl-form" onSubmit={submit} noValidate>
        {failure && <div className="nx-db-alert bad" role="alert">{failure}</div>}
        <div className="db-field">
          <label className="db-label" htmlFor="db-drop-confirm">Type <code>{name}</code> to confirm</label>
          <input id="db-drop-confirm" className="db-input" autoFocus autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} />
        </div>
        <pre className="nx-db-ddl-preview" aria-label="SQL to run">{buildDropStatement(name, { view })}</pre>
      </form>
    </PlModal>
  )
}

// ─── Add row ──────────────────────────────────────────────────────────────────

// The fields filled from a row's values (Duplicate row), leaving out the columns the database writes.
function filledFrom(fields, initial) {
  if (!initial) return {}
  const out = {}
  for (const { name, col } of fields) {
    const kind = columnKind(col)
    if (kind === 'readonly' || !(name in initial)) continue
    const v = initial[name]
    if (v === null || v === undefined) {
      // A NULL the column can't hold is left for the default (or the Required check) to settle.
      if (col.nullable) out[name] = { text: '', isNull: true, touched: true }
    } else if (kind === 'boolean') out[name] = { text: '', checked: v === true || v === 1, isNull: false, touched: true }
    else out[name] = { text: cellToInput(col, v), isNull: false, touched: true }
  }
  return out
}

// One field per column, typed like the grid's editor. Identity and computed columns are left
// to the database; a field left blank gets the column's default, or NULL where that's allowed.
// `initial` (Duplicate row) starts the fields with a row's values.
function AddRowDialog({ table, columns, columnInfo, initial = null, onSave, onClose }) {
  // With no column metadata at all, every field is plain text and its type is unknown.
  const typesUnknown = columnInfo.length > 0 && columnInfo.every(c => !c)
  const fields = columns.map((name, i) => ({ name, col: columnInfo[i] ?? { name, dataType: 'text', nullable: true } }))
  const [values, setValues] = useState(() => filledFrom(fields, initial))   // name → { text, checked?, isNull, touched }
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(null)
  const set = (name, patch) => {
    setValues(v => ({ ...v, [name]: { text: '', isNull: false, ...v[name], ...patch, touched: true } }))
    setErrors(e => ({ ...e, [name]: undefined }))
  }

  const submit = async (e) => {
    e.preventDefault()
    const out = {}, errs = {}
    for (const { name, col } of fields) {
      const kind = columnKind(col)
      if (kind === 'readonly') continue
      const v = values[name]
      if (!v?.touched) {
        // Untouched: the database fills it in. A checkbox left alone means false.
        if (kind === 'boolean' && !col.nullable && !col.hasDefault) out[name] = false
        else if (!col.nullable && !col.hasDefault) errs[name] = 'Required'
        continue
      }
      const parsed = parseCellInput(col, kind === 'boolean' ? !!v.checked : v.text, { isNull: v.isNull })
      if (parsed.error) errs[name] = parsed.error
      else out[name] = parsed.value
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    setFailure(await onSave(out))
    setSaving(false)
  }

  return (
    <PlModal
      open
      onClose={onClose}
      icon="plus"
      title={`Add a row to ${table}`}
      sub="Blank fields get the column's default, or NULL where it's allowed."
      wide
      className="nx-db-addrow"
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-addrow-form" className="btn accent" disabled={saving}>{saving ? 'Adding…' : 'Add row'}</button>
        </>
      )}
    >
      <form id="nx-db-addrow-form" className="nx-db-addrow-form" onSubmit={submit} noValidate>
        {failure && <div className="nx-db-alert bad" role="alert">{failure}</div>}
        {typesUnknown && <div className="nx-db-alert" role="note">{"Couldn't read this table's column types; values go in as typed"}</div>}
        {fields.map(({ name, col }, i) => {
          const kind = columnKind(col)
          const v = values[name] ?? { text: '', isNull: false, touched: false }
          const id = `db-add-${i}`
          const required = kind !== 'readonly' && !col.nullable && !col.hasDefault
          return (
            <div key={name} className="db-field nx-db-addrow-field" data-invalid={errors[name] ? true : undefined}>
              <label className="db-label" htmlFor={id}>
                {name}{required && <span className="req" aria-hidden="true"> *</span>}
                {!typesUnknown && <span className="nx-db-coltype">{typeLabelOf(col)}</span>}
              </label>
              {kind === 'readonly' ? (
                <input id={id} className="db-input" disabled value="" placeholder="Set by the database" />
              ) : kind === 'boolean' ? (
                <label className="db-checkbox-label">
                  <input id={id} type="checkbox" checked={!!v.checked} disabled={v.isNull}
                    onChange={e => set(name, { checked: e.target.checked, isNull: false })} />
                  {v.isNull ? 'NULL' : v.checked ? 'True' : 'False'}
                </label>
              ) : (
                <CellInput id={id} col={col} className="db-input" value={v.isNull ? '' : v.text} disabled={v.isNull}
                  placeholder={v.isNull ? 'NULL' : col.hasDefault ? 'Default' : kind === 'datetimeoffset' ? OFFSET_FORMAT : col.nullable ? 'NULL' : ''}
                  onChange={text => set(name, { text, isNull: false })} aria-invalid={!!errors[name] || undefined} />
              )}
              {kind !== 'readonly' && col.nullable && (
                <label className="db-checkbox-label nx-db-null-toggle">
                  <input type="checkbox" checked={!!v.isNull} onChange={e => set(name, { isNull: e.target.checked })} />NULL
                </label>
              )}
              {errors[name] && <span className="nx-db-cell-error" role="alert">{errors[name]}</span>}
            </div>
          )
        })}
      </form>
    </PlModal>
  )
}

// ─── Saved query pieces ───────────────────────────────────────────────────────

const savedPreview = (q, table) => (isTemplate(q) && table ? fillTemplate(q.sql, table) : q.sql)

// Name the query; "any table" swaps the table name for {table} so it runs on whatever is open.
function SaveQueryForm({ sql, table, existing, onSave, onCancel }) {
  const canTemplate = mentionsTable(sql, table)
  const [name, setName] = useState('')
  const [anyTable, setAnyTable] = useState(canTemplate)
  const clash = existing.find(q => q.name.toLowerCase() === name.trim().toLowerCase())
  const submit = e => { e.preventDefault(); if (name.trim()) onSave({ name, sql, anyTable: anyTable && canTemplate, table }) }
  return (
    <form className="nx-db-save" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <div className="nx-db-save-row">
        <label className="nx-db-show" htmlFor="db-save-name">Name</label>
        <input id="db-save-name" className="db-input" autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Active records" maxLength={80} />
        {canTemplate && (
          <label className="db-checkbox-label" title={`Saves ${table} as {table}, so the query runs on whichever table is open`}>
            <input type="checkbox" checked={anyTable} onChange={e => setAnyTable(e.target.checked)} />
            Use for any table
          </label>
        )}
        <span className="nx-db-spacer" />
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn sm accent" disabled={!name.trim()}>{clash ? 'Replace' : 'Save query'}</button>
      </div>
      <code className="nx-db-save-preview">{anyTable && canTemplate ? toTemplate(sql.trim(), table) : sql.trim()}</code>
      {clash && <span className="nx-db-muted">Replaces the saved query called “{clash.name}”.</span>}
    </form>
  )
}

const closeDetails = e => { const d = e.currentTarget.closest('details'); if (d) d.open = false }

// The Query tab's list: click a query to load it into the editor, ▶ to run it, the bin to remove it.
function SavedPopover({ queries, table, onLoad, onRun, onDelete }) {
  if (!queries.length) return null
  return (
    <details className="nx-db-history">
      <summary>Saved <span className="n">{queries.length}</span></summary>
      <div className="nx-db-history-pop">
        <div className="nx-db-history-head"><span>Saved queries</span><span>{table ? `on ${table}` : ''}</span></div>
        {queries.map(q => (
          <div key={q.id} className="nx-db-saved-q">
            <button type="button" className="nx-db-saved-q-main" title="Load into the editor" onClick={e => { onLoad(q); closeDetails(e) }}>
              <span className="name">{q.name}{isTemplate(q) && <span className="nx-db-tag">any table</span>}</span>
              <code>{savedPreview(q, table)}</code>
            </button>
            <button type="button" className="nx-db-row-act on" aria-label={`Run ${q.name}`} title="Run now" disabled={isTemplate(q) && !table}
              onClick={e => { onRun(q); closeDetails(e) }}><Icon name="play" size={12} /></button>
            <button type="button" className="nx-db-row-act on danger" aria-label={`Remove ${q.name}`} title="Remove" onClick={() => onDelete(q)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

// The table header's one-click menu: runs a saved query against the open table.
function SavedMenu({ queries, table, onRun }) {
  return (
    <details className="nx-db-history nx-db-savedmenu">
      <summary className="btn sm ghost" title="Run a saved query against this table">
        <Icon name="play" size={12} />Run saved{queries.length > 0 && <span className="n">{queries.length}</span>}
      </summary>
      <div className="nx-db-history-pop" data-align="right">
        <div className="nx-db-history-head"><span>{`Run on ${table}`}</span></div>
        {queries.map(q => (
          <button key={q.id} type="button" className="nx-db-saved-q-main menu" onClick={e => { onRun(q); closeDetails(e) }}>
            <span className="name">{q.name}{isTemplate(q) && <span className="nx-db-tag">any table</span>}</span>
            <code>{savedPreview(q, table)}</code>
          </button>
        ))}
        {!queries.length && <p className="nx-db-muted nx-db-saved-empty">No saved queries yet. Write one in the Query tab and press Save… (Ctrl+S) to run it from here in one click.</p>}
      </div>
    </details>
  )
}

function SavedOverviewRow({ q, tables, onRun }) {
  const template = isTemplate(q)
  const [table, setTable] = useState(template ? tables[0] ?? '' : '')
  return (
    <div className="nx-db-ov-row">
      <button type="button" className="nx-db-ov-open" onClick={() => onRun(q, template ? table : undefined)} disabled={template && !table}>
        <span className="name">{q.name}{template && <span className="nx-db-tag">any table</span>}</span>
        <code className="sql">{savedPreview(q, table)}</code>
      </button>
      <div className="nx-db-ov-actions">
        {template && (
          <select className="db-input nx-db-select sm" aria-label={`Table for ${q.name}`} value={table} onChange={e => setTable(e.target.value)}>
            {tables.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button type="button" className="btn sm accent" disabled={template && !table} onClick={() => onRun(q, template ? table : undefined)}>
          <Icon name="play" size={11} />Run
        </button>
      </div>
    </div>
  )
}

// ─── Query panel ──────────────────────────────────────────────────────────────

function QueryPanel({
  tables, queryTable, onSelectTable, sqlQuery, onSqlChange, queryResult, running, onRun,
  history, onPickHistory, onClearHistory, onCopyResult, onExportResult,
  saved = [], onSave, onRunSaved, onLoadSaved, onDeleteSaved,
  activeBuilder, onToggleBuilder, columns, columnsLoading, onBuildSql,
  allColumns, onLoadColumnsFor, onCreateView,
}) {
  const [saving, setSaving] = useState(false)
  // Older results (and the demo) carry one set as columns/rows; a real run lists them all in `sets`.
  const resultSets = queryResult?.sets?.filter(s => s.columns?.length)
    ?? (queryResult?.columns?.length ? [{ columns: queryResult.columns, rows: queryResult.rows }] : [])
  return (
    <div className="nx-db-query">
      <div className="nx-db-query-editor">
        <div className="nx-db-query-row">
          <label className="nx-db-show" htmlFor="db-query-table-select">Table</label>
          <TableSelect
            id="db-query-table-select"
            tables={tables}
            value={queryTable ?? ''}
            onChange={onSelectTable}
          />
          <span className="nx-db-divider" />
          <span className="nx-db-show">Builders</span>
          <QueryCommandToolbar
            activeBuilder={activeBuilder}
            onToggle={onToggleBuilder}
            disabled={!queryTable}
          />
        </div>
        <QueryBuilderPanel
          activeBuilder={activeBuilder}
          table={queryTable}
          columns={columns}
          columnsLoading={columnsLoading}
          onBuild={onBuildSql}
          onCancel={() => onToggleBuilder(activeBuilder)}
          allTables={tables}
          allColumns={allColumns}
          onLoadColumnsFor={onLoadColumnsFor}
        />
        <textarea
          className="nx-db-sql"
          value={sqlQuery}
          onChange={e => onSqlChange(e.target.value)}
          placeholder={'SELECT * FROM patients\nWHERE status = \'active\''}
          rows={6}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun() }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (sqlQuery.trim()) setSaving(true) }
            // Tab indents instead of leaving the editor.
            else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault()
              const el = e.target, s = el.selectionStart, end = el.selectionEnd
              onSqlChange(el.value.slice(0, s) + '  ' + el.value.slice(end))
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
            }
          }}
          aria-label="SQL query"
          spellCheck={false}
        />
        {saving && (
          <SaveQueryForm sql={sqlQuery} table={queryTable} existing={saved}
            onSave={entry => { onSave(entry); setSaving(false) }} onCancel={() => setSaving(false)} />
        )}
        <div className="nx-db-query-run">
          <SavedPopover queries={saved} table={queryTable} onLoad={onLoadSaved} onRun={onRunSaved} onDelete={onDeleteSaved} />
          {history.length > 0 && (
            <details className="nx-db-history">
              <summary>Recent <span className="n">{history.length}</span></summary>
              <div className="nx-db-history-pop">
                <div className="nx-db-history-head">
                  <span>This session</span>
                  <button type="button" className="nx-db-crumb-link" onClick={onClearHistory}>Clear</button>
                </div>
                {history.map(q => (
                  <button key={q.at + q.sql} type="button" className="nx-db-history-row"
                    onClick={e => { onPickHistory(q); e.currentTarget.closest('details').open = false }}>
                    <span className="nx-db-dot" data-tone={q.ok ? 'ok' : 'bad'} />
                    <code>{q.sql}</code>
                    <span className="meta">{`${clock(q.at)} · ${q.summary}`}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          <span className="nx-db-spacer" />
          <span className="nx-db-muted"><span className="kbd">Ctrl Enter</span> to run</span>
          <button type="button" className="btn sm" onClick={() => onSqlChange('')} disabled={!sqlQuery}>Clear</button>
          {onCreateView && (
            <button type="button" className="btn sm" onClick={() => onCreateView(sqlQuery)} disabled={!/^\s*(select|with)\b/i.test(sqlQuery)}
              title="Save this SELECT in the database as a view">
              <Icon name="eye" size={12} />Create view…
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => setSaving(v => !v)} disabled={!sqlQuery.trim()} aria-expanded={saving}
            title="Save this query to run it again in one click (Ctrl+S)">
            <Icon name="star" size={12} />Save…
          </button>
          <button type="button" className="btn sm accent" onClick={onRun} disabled={running || !sqlQuery.trim()}>
            {running ? <span className="nx-db-spinner sm" aria-hidden="true" /> : <Icon name="play" size={12} />}
            Run query
          </button>
        </div>
      </div>

      {queryResult && (
        <div className="nx-db-results">
          {queryResult.error ? (
            <div className="nx-db-alert bad" role="alert">
              <Icon name="alert" size={14} />
              <span className="pre">{queryResult.error}</span>
            </div>
          ) : resultSets.length > 0 ? (
            // Every result set the batch returned, headers included even when a set has no rows.
            resultSets.map((set, si) => (
              <div key={si} className="nx-db-result-set">
                <div className="nx-db-results-head">
                  <span className="nx-db-dot" data-tone="ok" />
                  {resultSets.length > 1 && <span className="nx-db-count">{`Result ${si + 1} of ${resultSets.length}`}</span>}
                  <span className="nx-db-count strong">{plural(set.rows.length, 'row')} returned</span>
                  {si === 0 && queryResult.ms != null && <span className="nx-db-count">{`${queryResult.ms} ms`}</span>}
                  <span className="nx-db-spacer" />
                  <button type="button" className="btn sm ghost" onClick={() => onCopyResult(set)}><Icon name="copy" size={13} />Copy CSV</button>
                  <button type="button" className="btn sm ghost" onClick={() => onExportResult(set, si)}><Icon name="download" size={13} />Export</button>
                </div>
                <div className="nx-db-table-wrap boxed">
                  <table className="nx-db-table">
                    <thead>
                      <tr>{set.columns.map((c, ci) => (
                        <th key={ci} data-num={isNumeric(set.rows.find(r => r[ci] !== null && r[ci] !== undefined)?.[ci]) || undefined}>
                          <span className="nx-db-th static">{c}</span>
                        </th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => <td key={j} data-num={isNumeric(cell) || undefined}><CellValue value={cell} /></td>)}
                        </tr>
                      ))}
                      {set.rows.length === 0 && (
                        <tr><td colSpan={set.columns.length} className="empty">No rows</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : (
            <div className="nx-db-alert ok" role="status">
              <Icon name="check" size={14} />
              {queryResult.affected != null
                ? `${plural(queryResult.affected, 'row')} affected`
                : 'Query executed'}
              {queryResult.ms != null && <span className="nx-db-muted">{` · ${queryResult.ms} ms`}</span>}
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
    return <span className="nx-db-null">null</span>
  }
  if (typeof value === 'boolean') return <span className="nx-db-bool">{String(value)}</span>
  return <span>{String(value)}</span>
}

// ─── Table select (Query tab) ─────────────────────────────────────────────────

function TableSelect({ id, tables, value, onChange, placeholder = 'Select a table…' }) {
  return (
    <select
      id={id}
      aria-label="Tables"
      className="db-input nx-db-select"
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

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="plm-veil" onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="plm nx-db-confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="plm-head">
          <span className="plm-ic nx-db-confirm-ic"><Icon name="trash" size={16} /></span>
          <div className="plm-ttl"><h2>{title}</h2></div>
        </div>
        <div className="plm-body"><p className="nx-db-muted" style={{ margin: 0 }}>{body}</p></div>
        <div className="plm-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn danger-solid" autoFocus disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Query command toolbar + builder panel ─────────────────────────────────────

const COMMANDS = [
  ['search', 'Search'], ['insert', 'Insert'], ['update', 'Update'],
  ['delete', 'Delete'], ['join', 'Join'], ['aggregate', 'Aggregate'],
]

function QueryCommandToolbar({ activeBuilder, onToggle, disabled }) {
  return (
    <div className="nx-db-chips" role="group" aria-label="Query commands">
      {COMMANDS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className="nx-db-chip"
          aria-pressed={activeBuilder === id}
          onClick={() => onToggle(id)}
          disabled={disabled}
          title={disabled ? 'Select a table first' : `Build a ${label.toUpperCase()} statement`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function BuilderFooter({ onBuild, onCancel, buildDisabled }) {
  return (
    <div className="db-builder__footer">
      <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      <button type="button" className="btn sm accent" onClick={onBuild} disabled={buildDisabled}>
        Build
      </button>
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

function SearchBuilder({ table, columns, onBuild, onCancel }) {
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const valid = conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="btn sm ghost nx-db-add"
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
      <button type="button" className="btn sm ghost nx-db-add"
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

function UpdateBuilder({ table, columns, onBuild, onCancel }) {
  const [values, setValues] = useState({})
  const [included, setIncluded] = useState(() => new Set())
  const [conditions, setConditions] = useState([{ column: '', operator: '=', value: '' }])
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c))

  const toggle = (name) => setIncluded(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const validSet = included.size > 0
  const validConditions = conditions.length > 0
    && conditions.every(c => c.column && (c.operator === 'IS NULL' || c.value !== ''))

  return (
    <div className="db-builder">
      <p className="db-hint">Set</p>
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
      <p className="db-hint">Where</p>
      {conditions.map((c, i) => (
        <ConditionRow key={i} columns={columns} condition={c} onChange={next => updateCondition(i, next)} />
      ))}
      <button type="button" className="btn sm ghost nx-db-add"
        onClick={() => setConditions(cs => [...cs, { column: '', operator: '=', value: '' }])}>
        + Add condition
      </button>
      <BuilderFooter
        buildDisabled={!validSet || !validConditions}
        onCancel={onCancel}
        onBuild={() => onBuild(buildUpdateQuery(
          table,
          columns.filter(c => included.has(c.name)).map(c => ({ name: c.name, value: values[c.name] })),
          conditions.filter(c => c.column),
        ))}
      />
    </div>
  )
}

function JoinBuilder({ table, columns, allTables, allColumns, onLoadColumnsFor, onBuild, onCancel }) {
  const [rightTable, setRightTable] = useState('')
  const [joinType, setJoinType] = useState('INNER')
  const [leftColumn, setLeftColumn] = useState('')
  const [rightColumn, setRightColumn] = useState('')

  const rightColumns = allColumns[rightTable] ?? []
  const valid = rightTable && leftColumn && rightColumn

  const selectRightTable = async (name) => {
    setRightTable(name)
    setRightColumn('')
    await onLoadColumnsFor(name)
  }

  return (
    <div className="db-builder">
      <div className="db-condition-row">
        <label className="db-label" htmlFor="db-join-table">Join table</label>
        <TableSelect
          id="db-join-table"
          tables={allTables.filter(t => t !== table)}
          value={rightTable}
          onChange={selectRightTable}
        />
      </div>
      <div className="db-condition-row">
        <label className="db-label" htmlFor="db-join-type">Join type</label>
        <select id="db-join-type" aria-label="Join type" className="db-input" value={joinType}
          onChange={e => setJoinType(e.target.value)}>
          <option value="INNER">INNER</option>
          <option value="LEFT">LEFT</option>
          <option value="RIGHT">RIGHT</option>
        </select>
      </div>
      {rightTable && (
        <div className="db-condition-row">
          <select aria-label="Left column" className="db-input" value={leftColumn}
            onChange={e => setLeftColumn(e.target.value)}>
            <option value="" disabled>Left column…</option>
            {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select aria-label="Right column" className="db-input" value={rightColumn}
            onChange={e => setRightColumn(e.target.value)}>
            <option value="" disabled>Right column…</option>
            {rightColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      )}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildJoinQuery(table, rightTable, joinType, leftColumn, rightColumn))}
      />
    </div>
  )
}

const AGGREGATE_FUNCTIONS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']

function AggregateBuilder({ table, columns, onBuild, onCancel }) {
  const [fn, setFn] = useState('COUNT')
  const [column, setColumn] = useState('')
  const [groupBy, setGroupBy] = useState(() => new Set())

  const toggleGroupBy = (name) => setGroupBy(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const valid = !!column

  return (
    <div className="db-builder">
      <div className="db-condition-row">
        <select aria-label="Function" className="db-input" value={fn} onChange={e => setFn(e.target.value)}>
          {AGGREGATE_FUNCTIONS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select aria-label="Aggregate column" className="db-input" value={column}
          onChange={e => setColumn(e.target.value)}>
          <option value="" disabled>Column…</option>
          {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </div>
      <p className="db-hint">Group by</p>
      {columns.map(col => (
        <label key={col.name} className="db-checkbox-label">
          <input
            type="checkbox"
            aria-label={`Group by ${col.name}`}
            checked={groupBy.has(col.name)}
            onChange={() => toggleGroupBy(col.name)}
          />
          {col.name}
        </label>
      ))}
      <BuilderFooter
        buildDisabled={!valid}
        onCancel={onCancel}
        onBuild={() => onBuild(buildAggregateQuery(table, [{ fn, column }], [...groupBy]))}
      />
    </div>
  )
}

function QueryBuilderPanel({
  activeBuilder, table, columns, columnsLoading, onBuild, onCancel,
  allTables, allColumns, onLoadColumnsFor,
}) {
  if (!activeBuilder) return null
  // Only gate on the loading spinner while the PRIMARY table's columns are
  // still missing. A secondary in-panel load (e.g. JoinBuilder fetching the
  // right-hand table's columns) also flips `columnsLoading` true, but must
  // not unmount the already-open builder and discard its local state.
  if (columnsLoading && columns.length === 0) return <p className="db-hint">Loading columns…</p>

  const props = { table, columns, onBuild, onCancel }
  if (activeBuilder === 'search') return <SearchBuilder {...props} />
  if (activeBuilder === 'delete') return <DeleteBuilder {...props} />
  if (activeBuilder === 'insert') return <InsertBuilder {...props} />
  if (activeBuilder === 'update') return <UpdateBuilder {...props} />
  if (activeBuilder === 'aggregate') return <AggregateBuilder {...props} />
  if (activeBuilder === 'join') {
    return (
      <JoinBuilder
        table={table}
        columns={columns}
        allTables={allTables}
        allColumns={allColumns}
        onLoadColumnsFor={onLoadColumnsFor}
        onBuild={onBuild}
        onCancel={onCancel}
      />
    )
  }
  return null
}
