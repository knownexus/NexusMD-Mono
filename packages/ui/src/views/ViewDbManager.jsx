// packages/ui/src/views/ViewDbManager.jsx
//
// Database Manager view for NexusMD Desktop, laid out like the Git Workspace: a header with the
// connection tabs and a table filter, a table list beside the details, and an overview when no
// table is open. Consumes the `dbManager` adapter via the injected `adapters` prop.
//
// Keys (only while this view is showing and no dialog is open):
//   Ctrl/⌘K jump to table · / filter tables · j / k next / previous table · Ctrl/⌘F search rows
//   b Browse · q Query · r refresh the open table · Ctrl/⌘Enter run the query

import { useState, useRef, useCallback, useEffect, useMemo, forwardRef } from 'react'
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
  buildUpdateQuery,
  buildJoinQuery,
  buildAggregateQuery,
} from '@nexusmd/core'
import { PlModal } from '../planner-chips.jsx'
import { Icon } from '../icons.jsx'

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

// "dbo.Users" groups under dbo; names without a schema group under "Tables".
function groupTables(tables) {
  const groups = new Map()
  for (const t of tables) {
    const dot = t.indexOf('.')
    const schema = dot > 0 ? t.slice(0, dot) : ''
    if (!groups.has(schema)) groups.set(schema, [])
    groups.get(schema).push(t)
  }
  return [...groups].map(([schema, names]) => ({ schema, label: schema || 'Tables', names }))
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
// The table name as a whole identifier, bare or quoted ([t], "t", `t`).
const tableRe = t => new RegExp(`(\\[${escapeRe(t)}\\]|"${escapeRe(t)}"|\`${escapeRe(t)}\`|(?<![\\w.])${escapeRe(t)}(?![\\w]))`, 'g')
const mentionsTable = (sql, table) => !!table && tableRe(table).test(sql)
const toTemplate = (sql, table) => sql.replace(tableRe(table), m => m.replace(table, TABLE_TOKEN))
// Plain names go in as they are; anything else (spaces, reserved words, quotes) is quoted for the
// connection's dialect, so a table name can never end the statement. A token already inside quotes
// only needs the quote character escaped.
const PLAIN_NAME = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/
function quoteName(name, type) {
  if (PLAIN_NAME.test(name)) return name
  if (type === 'sqlserver') return name.split('.').map(p => `[${p.replace(/]/g, ']]')}]`).join('.')
  return `"${name.replace(/"/g, '""')}"`
}
function fillTemplate(sql, table, type) {
  return sql.split(TABLE_TOKEN).map((part, i, all) => {
    if (i === all.length - 1) return part
    const before = part.slice(-1), after = all[i + 1].slice(0, 1)
    if (!['[]', '""', '``'].includes(before + after)) return part + quoteName(table, type)
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
      if (mod || e.altKey || e.shiftKey || typing(e.target) || overlayOpen()) return
      const map = { '/': h.focusFilter, j: h.next, k: h.previous, b: h.browse, q: h.query, r: h.refresh }
      const fn = Object.hasOwn(map, key) ? map[key] : null
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rootRef])
}

// ─── Root view ────────────────────────────────────────────────────────────────

export function ViewDbManager({ adapters, savedConnections = [], onResolveSecret }) {
  const [dbState, setDbState]         = useState(createInitialState)
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
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [activeBuilder, setActiveBuilder] = useState(null)    // 'search' | 'insert' | 'update' | 'delete' | 'join' | 'aggregate' | null
  const [toast, setToast]             = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [connectError, setConnectError] = useState(null)
  const [connectingId, setConnectingId] = useState(null)
  const [tableFilter, setTableFilter] = useState('')
  const [listFilter, setListFilter]   = useState('all')       // all | starred | opened
  const [listHidden, setListHidden]   = useState(() => readPref('nx-db:list-hidden', false))
  const [collapsed, setCollapsed]     = useState([])          // schema groups folded in the list
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [starred, setStarred]         = useState([])
  const [recent, setRecent]           = useState([])          // tables opened this session, newest first
  const [tableMeta, setTableMeta]     = useState({})          // { [table]: { rows, cols, at } }
  const demoData   = useRef(null)
  const rootRef    = useRef(null)
  const filterRef  = useRef(null)
  const rowSearchRef = useRef(null)
  const toastTimer = useRef(null)
  // Bumped on every connect / disconnect / table switch so a slow reply from before can't land late.
  const epoch      = useRef(0)
  const loadSeq    = useRef(0)
  const columnsRef = useRef(tableColumns)
  columnsRef.current = tableColumns
  const dialogOpen = useRef(false)
  dialogOpen.current = showConnectDialog

  const db = adapters?.dbManager
  const session = dbState.session
  const isDemo = session?.type === 'demo'

  // ── Toast ──────────────────────────────────────────────────────────────────

  const notify = useCallback((msg, type = 'success') => {
    clearTimeout(toastTimer.current)
    setToast({ msg, type, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 7000 : 3000)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

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

  // A connect failure shows inside the connect dialog when it's open, else as a toast.
  const connectFailed = useCallback((message) => {
    if (dialogOpen.current) setConnectError(message)
    else notify(message, 'error')
  }, [notify])

  // ── Connect ────────────────────────────────────────────────────────────────

  // Column metadata, the in-progress query, and any open builder are all
  // scoped to a single connection's set of tables. Switching connections (or
  // disconnecting) must wipe them — otherwise a table name that happens to
  // exist in both DB A and DB B shows DB A's stale columns while querying B.
  const resetQueryState = useCallback(() => {
    epoch.current++
    setTableColumns({})
    setQueryTable(null)
    setSqlQuery('')
    setQueryResult(null)
    setActiveBuilder(null)
    setColumnsLoading(false)
    setSelectedRows(new Set())
    setSearch('')
    setSort(null)
    setEditingCell(null)
    setActiveTab('browse')
    setRecent([])
    setTableMeta({})
    setTableFilter('')
    setCollapsed([])
  }, [])

  const afterConnect = useCallback((next) => {
    resetQueryState()
    setDbState(s => applyConnected(s, next))
    setStarred(readPref(`nx-db:starred:${connectionKey(next)}`, []))
    setShowConnectDialog(false)
    setConnectError(null)
  }, [resetQueryState])

  const handleConnect = useCallback(async (connType, connFields) => {
    setConnectError(null)
    if (connType === 'demo') {
      demoData.current = structuredClone(DEMO.data)
      afterConnect({ type: 'demo', config: {}, tables: DEMO.tables })
      notify('Demo database loaded')
      return
    }

    setDbState(s => ({ ...s, loading: true, error: null }))
    try {
      const config = resolveConnectionParams(connType, connFields)
      const result = await db.connect(connType, config)
      afterConnect({ type: connType, config, tables: result.tables })
      notify(`Connected · ${plural(result.tables.length, 'table')}`)
    } catch (err) {
      setDbState(s => ({ ...s, loading: false }))
      connectFailed(err.message)
    }
  }, [db, notify, afterConnect, connectFailed])

  // One-click connect using a connection saved elsewhere (e.g. desktop Settings).
  // Its secret (password or connection string) is resolved on demand via
  // onResolveSecret — the saved metadata passed in never carries the secret itself.
  const handleConnectSaved = useCallback(async (entry) => {
    setConnectError(null)
    setConnectingId(entry.id)
    setDbState(s => ({ ...s, loading: true, error: null }))
    try {
      const secret = (await onResolveSecret?.(entry.id)) || ''
      const config = entry.inputMode === 'connstr'
        ? resolveConnectionParams(entry.type, { connectionString: secret })
        : buildConfig(entry.type, { ...entry, password: secret })
      const result = await db.connect(entry.type, config)
      afterConnect({ type: entry.type, config, tables: result.tables, connectionId: entry.id, name: entry.name })
      notify(`Connected to ${entry.name} · ${plural(result.tables.length, 'table')}`)
    } catch (err) {
      setDbState(s => ({ ...s, loading: false }))
      connectFailed(err.message)
    } finally {
      setConnectingId(null)
    }
  }, [db, notify, onResolveSecret, afterConnect, connectFailed])

  const disconnect = useCallback(() => {
    setDbState(applyDisconnected)
    demoData.current = null
    resetQueryState()
    setStarred([])
  }, [resetQueryState])

  // Re-reads the table list (a table created from the Query tab shows up).
  const refreshTables = useCallback(async () => {
    if (!session || isDemo) return
    try {
      const at = epoch.current
      const result = await db.connect(session.type, session.config)
      if (at !== epoch.current) return
      setDbState(s => (s.session ? { ...s, session: { ...s.session, tables: result.tables } } : s))
    } catch (err) {
      notify(err.message, 'error')
    }
  }, [db, session, isDemo, notify])

  // ── Columns ────────────────────────────────────────────────────────────────

  const ensureColumnsLoaded = useCallback(async (table, { quiet = false } = {}) => {
    if (!table || columnsRef.current[table] || !session) return
    const at = epoch.current
    if (!quiet) setColumnsLoading(true)
    try {
      if (isDemo) {
        // Demo tables carry only column names — treat the first as the primary key,
        // close enough to the real getColumns() shape for the builders.
        const demoCols = (demoData.current[table]?.columns ?? []).map((name, i) => ({
          name, dataType: 'TEXT', isPrimaryKey: i === 0,
        }))
        setTableColumns(prev => ({ ...prev, [table]: demoCols }))
        return
      }
      const result = await db.getColumns(session.type, session.config, table)
      if (at !== epoch.current) return
      setTableColumns(prev => ({ ...prev, [table]: result.columns }))
    } catch (err) {
      if (quiet) return
      notify(err.message, 'error')
      setActiveBuilder(null)
    } finally {
      if (!quiet && at === epoch.current) setColumnsLoading(false)
    }
  }, [db, session, isDemo, notify])

  // ── Load table ─────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (name) => {
    if (isDemo) return structuredClone(demoData.current[name])
    return db.getRows(session.type, session.config, name)
  }, [db, session, isDemo])

  const recordLoaded = useCallback((name, data) => {
    setTableMeta(m => ({ ...m, [name]: { rows: data.rows.length, cols: data.columns.length, at: Date.now() } }))
    setRecent(r => [name, ...r.filter(t => t !== name)].slice(0, 8))
  }, [])

  const openTable = useCallback(async (name, tab = 'browse') => {
    if (!name || !session) return
    const seq = ++loadSeq.current
    setSelectedRows(new Set())
    setSearch('')
    setSort(null)
    setEditingCell(null)
    setActiveTab(tab)
    if (tab === 'query') {
      setQueryTable(name)
      setSqlQuery(`SELECT * FROM ${name}`)
      setActiveBuilder(null)
    }
    setDbState(s => applyTableSelected(s, name))
    // Column metadata gives the real primary key for edits and deletes; fetched alongside the rows.
    ensureColumnsLoaded(name, { quiet: true })
    try {
      const data = await fetchRows(name)
      if (seq !== loadSeq.current) return
      setDbState(s => applyTableLoaded(s, data))
      recordLoaded(name, data)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setDbState(s => applyError(s, err.message))
      notify(err.message, 'error')
    }
  }, [session, fetchRows, recordLoaded, ensureColumnsLoaded, notify])

  // Reads the open table again, keeping the search, sort and tab.
  const refreshTable = useCallback(async () => {
    const name = dbState.selectedTable
    if (!name) return
    const seq = ++loadSeq.current
    setDbState(s => ({ ...s, error: null }))
    try {
      const data = await fetchRows(name)
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

  const closeTable = () => { loadSeq.current++; setDbState(s => ({ ...s, selectedTable: null, tableData: null, tableLoading: false, error: null })) }

  // ── Visible rows: search, then sort; each keeps its index into tableData.rows ──

  const tableData = dbState.tableData
  const visible = useMemo(() => {
    const all = (tableData?.rows ?? []).map((row, i) => ({ row, i }))
    const t = search.trim().toLowerCase()
    const hits = t ? all.filter(({ row }) => row.some(c => String(c ?? '').toLowerCase().includes(t))) : all
    if (!sort) return hits
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...hits].sort((a, b) => compareCells(a.row[sort.col], b.row[sort.col]) * dir || a.i - b.i)
  }, [tableData, search, sort])

  // The primary key: the column getColumns() marks, else the first.
  const pkIndex = useMemo(() => {
    const cols = tableColumns[dbState.selectedTable]
    const pk = cols?.find(c => c.isPrimaryKey)?.name
    const i = pk ? (tableData?.columns ?? []).indexOf(pk) : -1
    return i >= 0 ? i : 0
  }, [tableColumns, dbState.selectedTable, tableData])

  const changeSearch = (value) => { setSearch(value); setSelectedRows(new Set()) }
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

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    const indices = [...selectedRows]
    const rows = tableData.rows
    const name = dbState.selectedTable
    try {
      if (!isDemo) {
        const pk = tableData.columns[pkIndex]
        const values = indices.map(i => rows[i][pkIndex])
        await db.deleteRows(session.type, session.config, name, pk, values)
      }
      const gone = new Set(indices)
      syncDemo(name, d => ({ ...d, rows: d.rows.filter((_, i) => !gone.has(i)) }))
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
  }, [db, session, isDemo, tableData, dbState.selectedTable, pkIndex, selectedRows, notify])

  // ── Cell edit ──────────────────────────────────────────────────────────────

  const startEdit = (ri, ci, val) => { setEditingCell({ ri, ci }); setEditValue(val === null || val === undefined ? '' : String(val)) }

  // Saves the open cell (nothing is written when it didn't change), then optionally opens `next`.
  const saveEdit = useCallback(async (next = null) => {
    if (!editingCell) return
    const { ri, ci } = editingCell
    const name = dbState.selectedTable
    const before = tableData.rows[ri]?.[ci]
    const unchanged = (before === null || before === undefined ? '' : String(before)) === editValue
    setEditingCell(null)
    if (!unchanged) {
      try {
        if (!isDemo) {
          const pk = tableData.columns[pkIndex]
          await db.updateCell(session.type, session.config, name, pk, tableData.rows[ri][pkIndex], tableData.columns[ci], editValue)
        }
        syncDemo(name, d => ({ ...d, rows: d.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? editValue : c)) : r)) }))
        setDbState(s => applyCellUpdated(s, { rowIndex: ri, colIndex: ci, value: editValue }))
        notify(`Updated ${tableData.columns[ci]}`)
      } catch (err) {
        notify(err.message, 'error')
        return
      }
    }
    if (next) startEdit(next.ri, next.ci, next.ri === ri && next.ci === ci ? editValue : tableData.rows[next.ri][next.ci])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, session, isDemo, tableData, dbState.selectedTable, pkIndex, editingCell, editValue, notify])

  // ── Query ──────────────────────────────────────────────────────────────────

  const handleQueryTableSelect = useCallback((name) => {
    setQueryTable(name)
    setSqlQuery(`SELECT * FROM ${name}`)
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
        const m = sql.match(/FROM\s+(\w+)/i)
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
    const sql = isTemplate(q) ? fillTemplate(q.sql, table, session?.type) : q.sql
    if (table && table !== dbState.selectedTable) openTable(table, 'query')
    setActiveTab('query')
    if (table) setQueryTable(table)
    setActiveBuilder(null)
    setSqlQuery(sql)
    runQuery(sql)
  }
  const loadSaved = (q) => {
    const table = queryTable ?? dbState.selectedTable
    setSqlQuery(isTemplate(q) && table ? fillTemplate(q.sql, table, session?.type) : q.sql)
  }

  // ── Table list ─────────────────────────────────────────────────────────────

  const tables = session?.tables ?? []
  const starredSet = useMemo(() => new Set(starred), [starred])
  const toggleStar = (name) => setStarred(prev => {
    const next = prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    writePref(`nx-db:starred:${connectionKey(session)}`, next)
    return next
  })
  const listed = useMemo(() => tables.filter(t => matchesWords(t, tableFilter)
    && (listFilter === 'all' || (listFilter === 'starred' ? starredSet.has(t) : !!tableMeta[t]))), [tables, tableFilter, listFilter, starredSet, tableMeta])
  const setHidden = (v) => { setListHidden(v); writePref('nx-db:list-hidden', v) }

  // j / k walk the listed tables, wrapping at the ends.
  const step = (by) => {
    const list = listHidden ? listed : groupTables(listed).flatMap(g => (collapsed.includes(g.schema) ? [] : g.names))
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
    query: () => { if (dbState.selectedTable) setActiveTab('query') },
    refresh: () => { if (dbState.selectedTable) refreshTable() },
  } : {})

  // ── Render ─────────────────────────────────────────────────────────────────

  const connectedLabel = session ? `${typeLabel(session.type)} · ${plural(tables.length, 'table')}` : ''
  const meta = dbState.selectedTable ? tableMeta[dbState.selectedTable] : null
  const exportRows = () => visible.map(v => v.row)

  return (
    <div className="view-db-manager nx-db-page" ref={rootRef}>
      {!session ? (
        <WelcomePane
          onOpenConnect={() => { setConnectError(null); setShowConnectDialog(true) }}
          onDemo={() => handleConnect('demo', {})}
          savedConnections={savedConnections}
          onConnectSaved={handleConnectSaved}
          connectingId={showConnectDialog ? null : connectingId}
          hasAdapter={!!db?.isAvailable?.()}
        />
      ) : (
        <>
          <header className="nx-db-head">
            <div className="nx-db-head-row">
              <h2 className="nx-db-title">Database</h2>
              <ConnectionTabs
                session={session}
                savedConnections={savedConnections}
                connectingId={connectingId}
                onSelect={entry => { if (entry.id !== session.connectionId) handleConnectSaved(entry) }}
                onNew={() => { setConnectError(null); setShowConnectDialog(true) }}
              />
              <span className="nx-db-spacer" />
              <span className="nx-db-status">
                <span className="nx-db-dot" data-tone={dbState.loading ? 'info' : 'ok'} />
                {dbState.loading ? 'Connecting…' : connectedLabel}
              </span>
              <button type="button" className="nx-db-jumpbtn" disabled={!tables.length} onClick={() => setPaletteOpen(true)}>
                <Icon name="search" size={13} />Jump to table…<span className="kbd">Ctrl K</span>
              </button>
              <button type="button" className="btn sm ghost" title="Close this connection" onClick={disconnect}>Disconnect</button>
            </div>
            <div className="nx-db-head-row">
              <TableFilter ref={filterRef} value={tableFilter} onChange={setTableFilter} />
              <span className="nx-db-divider" />
              <span className="nx-db-show">Show</span>
              <div className="nx-db-chips" role="group" aria-label="Show tables">
                {[
                  ['all', 'All', tables.length, 'muted', 'Every table in this database'],
                  ['starred', 'Starred', starred.filter(t => tables.includes(t)).length, 'warn', 'Tables you starred · remembered for this connection'],
                  ['opened', 'Opened', Object.keys(tableMeta).length, 'info', 'Tables opened this session'],
                ].map(([id, label, n, tone, title]) => (
                  <button key={id} type="button" className="nx-db-chip" aria-pressed={listFilter === id} title={title}
                    onClick={() => setListFilter(listFilter === id && id !== 'all' ? 'all' : id)}>
                    <span className="nx-db-dot" data-tone={tone} />{label}<span className="n">{n}</span>
                  </button>
                ))}
              </div>
              <span className="nx-db-spacer" />
              <button type="button" className="btn sm ghost" aria-pressed={!listHidden}
                title={listHidden ? 'Show the table list beside the details' : 'Hide the table list to give the details the full width'}
                onClick={() => setHidden(!listHidden)}>{listHidden ? 'Show tables' : 'Hide tables'}</button>
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
                  collapsed={collapsed}
                  onToggleGroup={g => setCollapsed(c => (c.includes(g) ? c.filter(x => x !== g) : [...c, g]))}
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
                        <h2 className="nx-db-table-name" title={dbState.selectedTable}>{dbState.selectedTable}</h2>
                        <StarButton on={starredSet.has(dbState.selectedTable)} onClick={() => toggleStar(dbState.selectedTable)} name={dbState.selectedTable} />
                      </div>
                      <div className="nx-db-dhead-meta">
                        {tableData && !dbState.tableLoading ? (
                          <>
                            <span>{plural(tableData.rows.length, 'row')}</span>
                            <span>{plural(tableData.columns.length, 'column')}</span>
                            {tableData.columns[pkIndex] && <span>key <code>{tableData.columns[pkIndex]}</code></span>}
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
                    </div>
                  </div>

                  <div className="nx-db-tabs" role="tablist" aria-label="View mode">
                    {[['browse', 'Browse', tableData && !dbState.tableLoading ? tableData.rows.length : null], ['query', 'Query', null]].map(([id, label, n]) => (
                      <button key={id} type="button" role="tab" aria-selected={activeTab === id} className="nx-db-tab"
                        title={`${label} (${id[0]})`} onClick={() => setActiveTab(id)}>
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
                      tableData={tableData}
                      visible={visible}
                      pkIndex={pkIndex}
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
                      onCopyResult={async () => notify((await copyText(toCsv(queryResult.columns, queryResult.rows))) ? `Copied ${plural(queryResult.rows.length, 'row')} as CSV` : "Couldn't reach the clipboard")}
                      onExportResult={() => downloadCsv(`${queryTable ?? dbState.selectedTable}-query`, queryResult.columns, queryResult.rows)}
                      activeBuilder={activeBuilder}
                      onToggleBuilder={toggleBuilder}
                      columns={tableColumns[queryTable ?? dbState.selectedTable] ?? []}
                      columnsLoading={columnsLoading}
                      onBuildSql={applyBuiltSql}
                      allColumns={tableColumns}
                      onLoadColumnsFor={ensureColumnsLoaded}
                    />
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div key={toast.id} className="nx-db-toast" data-tone={toast.type} role={toast.type === 'error' ? 'alert' : 'status'}>
          <span className="nx-db-dot" data-tone={toast.type === 'success' ? 'ok' : toast.type === 'error' ? 'bad' : 'info'} />
          <span className="msg">{toast.msg}</span>
          <button type="button" className="nx-db-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}><Icon name="x" size={12} /></button>
        </div>
      )}

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

      {/* Connect dialog */}
      {showConnectDialog && (
        <ConnectDialog
          onConnect={handleConnect}
          savedConnections={savedConnections}
          onConnectSaved={handleConnectSaved}
          activeConnectionId={session?.connectionId}
          onClose={() => { setShowConnectDialog(false); setConnectError(null) }}
          loading={dbState.loading}
          error={connectError}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${plural(selectedRows.size, 'row')}?`}
          body={isDemo
            ? 'Removes them from the demo data for this session. This action cannot be undone.'
            : `Deletes them from ${dbState.selectedTable} by ${tableData?.columns[pkIndex] ?? 'key'}. This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

// ─── Welcome pane ─────────────────────────────────────────────────────────────

function WelcomePane({ onOpenConnect, onDemo, savedConnections, onConnectSaved, connectingId, hasAdapter }) {
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
            <span className="hint">from Settings</span>
          </div>
          {savedConnections.map(entry => (
            <button key={entry.id} type="button" className="nx-db-saved-row" disabled={connectingId != null}
              onClick={() => onConnectSaved(entry)}>
              <Icon name="database" size={14} />
              <span className="name">{entry.name}</span>
              <span className="type">{typeLabel(entry.type)}</span>
              {connectingId === entry.id ? <span className="nx-db-spinner" aria-hidden="true" /> : <Icon name="arrow-right" size={13} />}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

// ─── Header pieces ────────────────────────────────────────────────────────────

// Saved connections as a segmented control; the current connection is a tab even when it isn't saved.
function ConnectionTabs({ session, savedConnections, connectingId, onSelect, onNew }) {
  const current = session.connectionId && savedConnections.some(c => c.id === session.connectionId)
  return (
    <div className="nx-db-seg" style={{ minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
      <div role="tablist" aria-label="Connections" className="nx-db-seg-tabs">
        {!current && (
          <button type="button" role="tab" aria-selected="true">{sessionName(session)}</button>
        )}
        {savedConnections.map(entry => (
          <button key={entry.id} type="button" role="tab" aria-selected={entry.id === session.connectionId}
            title={`${typeLabel(entry.type)}${entry.id === session.connectionId ? ' · connected' : ' · switch to this connection'}`}
            disabled={connectingId != null} onClick={() => onSelect(entry)}>
            {entry.name}
            {connectingId === entry.id && <span className="nx-db-spinner sm" aria-hidden="true" />}
          </button>
        ))}
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

function TableList({ tables, total, selected, starred, meta, collapsed, onToggleGroup, onOpen, onStar, onClearFilters }) {
  const groups = groupTables(tables)
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
  const row = (name, inStarred = false) => {
    const m = meta[name]
    return (
      <div key={`${inStarred ? 's' : 'g'}:${name}`} className="nx-db-row" aria-current={name === selected ? 'true' : undefined}>
        <button type="button" className="nx-db-row-open" onClick={() => onOpen(name)} title={name}>
          <span className="nx-db-dot" data-tone={name === selected ? 'ok' : m ? 'info' : undefined} />
          <span className="nx-db-row-body">
            <span className="nx-db-row-title">{name.includes('.') ? name.slice(name.indexOf('.') + 1) : name}</span>
            {m && <span className="nx-db-row-meta">{`${plural(m.rows, 'row')} · ${plural(m.cols, 'col')}`}</span>}
          </span>
        </button>
        <StarButton on={starred.has(name)} onClick={() => onStar(name)} name={name} />
      </div>
    )
  }
  return (
    <div className="nx-db-list">
      <div className="nx-db-list-keys" title="j / k move through the tables">
        <span className="kbd">j</span><span className="kbd">k</span><span>to move</span>
      </div>
      {pinned.length > 0 && (
        <div className="nx-db-group">
          <div className="nx-db-group-head static">
            <span className="nx-db-group-name" data-tone="warn">Starred</span>
            <span className="nx-db-group-count">{pinned.length}</span>
          </div>
          <div className="nx-db-rows">{pinned.map(t => row(t, true))}</div>
        </div>
      )}
      {groups.map(g => {
        const open = !collapsed.includes(g.schema)
        return (
          <div key={g.schema} className="nx-db-group">
            <button type="button" className="nx-db-group-head" aria-expanded={open} onClick={() => onToggleGroup(g.schema)}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
              <span className="nx-db-group-name">{g.label}</span>
              <span className="nx-db-group-count">{g.names.length}</span>
            </button>
            {open && <div className="nx-db-rows">{g.names.map(t => row(t))}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Overview (nothing open) ──────────────────────────────────────────────────

function Overview({ session, tables, starred, recent, meta, history, onOpen, onUseQuery, onJump, saved = [], onRunSaved }) {
  const tableRow = (name, desc) => (
    <div key={name} className="nx-db-ov-row">
      <button type="button" className="nx-db-ov-open" onClick={() => onOpen(name)}>
        <span className="name">{name}</span>
        {desc && <span className="desc">{desc}</span>}
      </button>
      <div className="nx-db-ov-actions">
        <button type="button" className="btn sm ghost" onClick={() => onOpen(name, 'query')}>Query</button>
        <button type="button" className="btn sm accent" onClick={() => onOpen(name)}>Browse</button>
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
          </div>
          {recent.map(t => tableRow(t, described(t)))}
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

function ConnectDialog({ onConnect, savedConnections = [], onConnectSaved, activeConnectionId, onClose, loading, error }) {
  const [dbType, setDbType]       = useState(() => readPref('nx-db:last-type', 'demo'))
  const [inputMode, setInputMode] = useState('fields')
  const [connStr, setConnStr]     = useState('')
  const [fields, setFields]       = useState({
    host: '', port: '1433', database: '', user: '', password: '',
    encrypt: true, trustServerCertificate: false, filePath: '',
  })
  const [connectingId, setConnectingId] = useState(null)

  const setField = (k, v) => setFields(f => ({ ...f, [k]: v }))

  const submit = (e) => {
    e?.preventDefault?.()
    if (loading) return
    writePref('nx-db:last-type', dbType)
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
      className="nx-db-connect"
      footerLeft={dbType !== 'demo' ? <span className="nx-db-muted">Enter to connect</span> : null}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="nx-db-connect-form" className="btn accent" disabled={loading}>
            {loading ? 'Connecting…' : dbType === 'demo' ? 'Load demo' : 'Connect'}
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
        {savedConnections.length > 0 && (
          <div className="nx-db-saved">
            <p className="nx-db-label">Saved connections</p>
            {savedConnections.map(entry => (
              <button
                key={entry.id}
                type="button"
                className="nx-db-saved-row"
                aria-current={entry.id === activeConnectionId ? 'true' : undefined}
                onClick={() => connectSaved(entry)}
                disabled={connectingId != null}
              >
                <Icon name="database" size={14} />
                <span className="name">{entry.name}</span>
                <span className="type">
                  {entry.type === 'sqlite' ? 'SQLite' : 'SQL Server'}
                </span>
                {connectingId === entry.id && <span className="nx-db-spinner" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}

        {/* Type selector */}
        <div className="nx-db-types" role="group" aria-label="Database type">
          {[['demo', 'Demo', 'Sample data'], ['sqlite', 'SQLite', 'A local .db file'], ['sqlserver', 'SQL Server', 'Host or connection string']].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              className="nx-db-type"
              onClick={() => { setDbType(id); setInputMode('fields'); setConnStr('') }}
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
              onChange={e => setConnStr(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e) }}
              rows={4}
              autoFocus
              placeholder={dbType === 'sqlserver' ? sqlserverPlaceholder : 'sqlite:///absolute/path/to/file.db\nor just: /path/to/file.db'}
            />
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
      </form>
    </PlModal>
  )
}

// ─── Browse panel ─────────────────────────────────────────────────────────────

const BrowsePanel = forwardRef(function BrowsePanel({
  tableData, visible, pkIndex, search, onSearchChange, sort, onSort,
  selectedRows, allSelected, onToggleRow, onToggleAll, onClearSelection, onDeleteSelected, onDeleteRow, onCopyCell,
  editingCell, editValue, onEditValueChange, onStartEdit, onSaveEdit, onCancelEdit,
}, ref) {
  const total = tableData.rows.length
  const cols = tableData.columns.length
  // A column whose first value is a number lines its header up with its right-aligned values.
  const numericCol = tableData.columns.map((_, ci) => isNumeric(tableData.rows.find(r => r[ci] !== null && r[ci] !== undefined)?.[ci]))
  // Tab / Shift+Tab move the editor along the row (and on to the next / previous row) after saving.
  const neighbour = (ri, ci, by) => {
    const pos = visible.findIndex(v => v.i === ri)
    let p = pos, c = ci + by
    if (c >= cols) { c = 0; p++ } else if (c < 0) { c = cols - 1; p-- }
    return p >= 0 && p < visible.length ? { ri: visible[p].i, ci: c } : null
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
          {search ? `${visible.length} of ${total} matching` : `${total} total`}
        </span>
        <span className="nx-db-spacer" />
        {selectedRows.size > 0 && (
          <>
            <span className="nx-db-count">{`${selectedRows.size} selected`}</span>
            <button type="button" className="btn sm ghost" onClick={onClearSelection}>Clear</button>
            <button type="button" className="btn sm danger" onClick={onDeleteSelected}>
              <Icon name="trash" size={13} />
              Delete {plural(selectedRows.size, 'row')}
            </button>
          </>
        )}
      </div>

      <div className="nx-db-table-wrap" role="region" aria-label="Table data" tabIndex={0}>
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
                return (
                  <th key={col} data-num={numericCol[ci] || undefined} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                    <button type="button" className="nx-db-th" onClick={() => onSort(ci)} title={`Sort by ${col}`}>
                      <span>{col}</span>
                      {ci === pkIndex && <span className="pk" title="Key used for edits and deletes">key</span>}
                      <Icon name={dir === 'desc' ? 'arrow-down' : 'arrow-up'} size={11} className={`sort${dir ? ' on' : ''}`} />
                    </button>
                  </th>
                )
              })}
              <th className="actions"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, i: ri }, vi) => (
              <tr key={ri} aria-selected={selectedRows.has(ri) || undefined}>
                <td className="check">
                  <input
                    type="checkbox"
                    checked={selectedRows.has(ri)}
                    onChange={() => onToggleRow(ri)}
                    aria-label={`Select row ${vi + 1}`}
                  />
                </td>
                {row.map((cell, ci) => {
                  const editing = editingCell?.ri === ri && editingCell?.ci === ci
                  return (
                    <td
                      key={ci}
                      data-num={isNumeric(cell) || undefined}
                      data-editing={editing || undefined}
                      onDoubleClick={() => !editing && onStartEdit(ri, ci, cell)}
                      title={editing ? undefined : `${cell === null || cell === undefined ? 'null' : String(cell)}\nDouble-click to edit`}
                    >
                      {editing ? (
                        <input
                          className="nx-db-cell-input"
                          autoFocus
                          onFocus={e => e.target.select()}
                          value={editValue}
                          onChange={e => onEditValueChange(e.target.value)}
                          onBlur={() => onSaveEdit()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); onSaveEdit() }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancelEdit() }
                            else if (e.key === 'Tab') { e.preventDefault(); onSaveEdit(neighbour(ri, ci, e.shiftKey ? -1 : 1)) }
                          }}
                          aria-label={`Edit ${tableData.columns[ci]}`}
                        />
                      ) : (
                        <CellValue value={cell} />
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
                    aria-label={`Delete row ${vi + 1}`}
                    title="Delete row"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={cols + 2} className="empty">
                  {total === 0 ? 'This table is empty' : 'No rows match your search'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="nx-db-foot-hint">
        <span>Double-click a cell to edit</span>
        <span><span className="kbd">Enter</span> save · <span className="kbd">Tab</span> next cell · <span className="kbd">Esc</span> cancel</span>
        <span>Click a column to sort</span>
      </div>
    </div>
  )
})

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
  allColumns, onLoadColumnsFor,
}) {
  const [saving, setSaving] = useState(false)
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
          ) : queryResult.columns?.length > 0 ? (
            <>
              <div className="nx-db-results-head">
                <span className="nx-db-dot" data-tone="ok" />
                <span className="nx-db-count strong">{plural(queryResult.rows.length, 'row')} returned</span>
                {queryResult.ms != null && <span className="nx-db-count">{`${queryResult.ms} ms`}</span>}
                <span className="nx-db-spacer" />
                <button type="button" className="btn sm ghost" onClick={onCopyResult}><Icon name="copy" size={13} />Copy CSV</button>
                <button type="button" className="btn sm ghost" onClick={onExportResult}><Icon name="download" size={13} />Export</button>
              </div>
              <div className="nx-db-table-wrap boxed">
                <table className="nx-db-table">
                  <thead>
                    <tr>{queryResult.columns.map(c => <th key={c}><span className="nx-db-th static">{c}</span></th>)}</tr>
                  </thead>
                  <tbody>
                    {queryResult.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => <td key={j} data-num={isNumeric(cell) || undefined}><CellValue value={cell} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
