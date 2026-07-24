// packages/core/src/modules/db-manager/index.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseConnectionString,
  buildConfig,
  resolveConnectionParams,
  buildConnectionString,
  createInitialState,
  applyConnected,
  applyDisconnected,
  applyTableSelected,
  applyTableLoaded,
  applyRowsDeleted,
  applyCellUpdated,
  applyError,
  generateConnectionId,
  upsertConnection,
  removeConnection,
} from './index.js'

// ─── parseConnectionString ────────────────────────────────────────────────────

describe('parseConnectionString', () => {
  describe('sqlite', () => {
    it('strips sqlite:/// prefix', () => {
      const cfg = parseConnectionString('sqlite', 'sqlite:///home/user/data.db')
      expect(cfg).toEqual({ type: 'sqlite', filePath: 'home/user/data.db' })
    })

    it('passes plain paths through unchanged', () => {
      const cfg = parseConnectionString('sqlite', '/absolute/path/to/file.db')
      expect(cfg).toEqual({ type: 'sqlite', filePath: '/absolute/path/to/file.db' })
    })

    it('trims whitespace', () => {
      const cfg = parseConnectionString('sqlite', '  /some/path.db  ')
      expect(cfg.filePath).toBe('/some/path.db')
    })
  })

  describe('sqlserver — URL style', () => {
    it('parses mssql:// URL', () => {
      const cfg = parseConnectionString('sqlserver', 'mssql://sa:secret@myhost:1433/mydb')
      expect(cfg).toMatchObject({ server: 'myhost', port: 1433, database: 'mydb', user: 'sa', password: 'secret' })
    })

    it('parses sqlserver:// URL', () => {
      const cfg = parseConnectionString('sqlserver', 'sqlserver://admin:pass@db.example.com/prod')
      expect(cfg.server).toBe('db.example.com')
      expect(cfg.database).toBe('prod')
    })

    it('defaults to port 1433 when omitted', () => {
      const cfg = parseConnectionString('sqlserver', 'mssql://sa:x@host/db')
      expect(cfg.port).toBe(1433)
    })

    it('decodes percent-encoded credentials', () => {
      const cfg = parseConnectionString('sqlserver', 'mssql://user%40domain:p%40ss@host/db')
      expect(cfg.user).toBe('user@domain')
      expect(cfg.password).toBe('p@ss')
    })
  })

  describe('sqlserver — ADO.NET style', () => {
    it('parses standard key=value pairs', () => {
      const cfg = parseConnectionString(
        'sqlserver',
        'Server=myserver;Database=mydb;User Id=sa;Password=secret;',
      )
      expect(cfg).toMatchObject({ server: 'myserver', database: 'mydb', user: 'sa', password: 'secret' })
    })

    it('parses Server=host,port syntax', () => {
      const cfg = parseConnectionString('sqlserver', 'Server=myhost,5050;Database=db;User Id=u;Password=p;')
      expect(cfg.server).toBe('myhost')
      expect(cfg.port).toBe(5050)
    })

    it('parses Encrypt=false', () => {
      const cfg = parseConnectionString('sqlserver', 'Server=h;Database=d;User Id=u;Password=p;Encrypt=false;')
      expect(cfg.encrypt).toBe(false)
    })

    it('parses TrustServerCertificate=true', () => {
      const cfg = parseConnectionString('sqlserver', 'Server=h;Database=d;User Id=u;Password=p;TrustServerCertificate=true;')
      expect(cfg.trustServerCertificate).toBe(true)
    })

    it('defaults encrypt=true when omitted', () => {
      const cfg = parseConnectionString('sqlserver', 'Server=h;Database=d;User Id=u;Password=p;')
      expect(cfg.encrypt).toBe(true)
    })
  })

  describe('sqlserver — JDBC style', () => {
    it('parses host, port, and database from a jdbc:sqlserver:// URL', () => {
      const cfg = parseConnectionString(
        'sqlserver',
        'jdbc:sqlserver://df-test-sql01.msl.co.uk:1433;database=DriveFurther_UAT',
      )
      expect(cfg).toMatchObject({
        server: 'df-test-sql01.msl.co.uk', port: 1433, database: 'DriveFurther_UAT',
      })
    })

    it('parses user/password properties', () => {
      const cfg = parseConnectionString(
        'sqlserver',
        'jdbc:sqlserver://myhost:1433;database=mydb;user=sa;password=secret;',
      )
      expect(cfg).toMatchObject({ server: 'myhost', database: 'mydb', user: 'sa', password: 'secret' })
    })

    it('defaults to port 1433 when no port is given', () => {
      const cfg = parseConnectionString('sqlserver', 'jdbc:sqlserver://myhost;database=mydb')
      expect(cfg.server).toBe('myhost')
      expect(cfg.port).toBe(1433)
    })

    it('parses encrypt and trustServerCertificate properties', () => {
      const cfg = parseConnectionString(
        'sqlserver',
        'jdbc:sqlserver://myhost:1433;database=mydb;encrypt=false;trustServerCertificate=true;',
      )
      expect(cfg.encrypt).toBe(false)
      expect(cfg.trustServerCertificate).toBe(true)
    })

    it('handles a bare jdbc:sqlserver:// URL with no trailing properties', () => {
      const cfg = parseConnectionString('sqlserver', 'jdbc:sqlserver://myhost:1433')
      expect(cfg).toMatchObject({ server: 'myhost', port: 1433 })
    })
  })

  it('throws on unknown type', () => {
    expect(() => parseConnectionString('mysql', 'something')).toThrow('Unknown database type')
  })
})

// ─── buildConfig ──────────────────────────────────────────────────────────────

describe('buildConfig', () => {
  it('coerces a string port (as arrives from a form text input) to a number', () => {
    const cfg = buildConfig('sqlserver', {
      host: 'myhost', port: '1433', database: 'mydb', user: 'sa', password: 'pass',
    })
    expect(cfg.port).toBe(1433)
    expect(typeof cfg.port).toBe('number')
  })

  it('defaults to port 1433 when the field is empty', () => {
    const cfg = buildConfig('sqlserver', { host: 'myhost', port: '', database: 'mydb' })
    expect(cfg.port).toBe(1433)
  })

  it('defaults to port 1433 when the field is not a valid number', () => {
    const cfg = buildConfig('sqlserver', { host: 'myhost', port: 'not-a-port', database: 'mydb' })
    expect(cfg.port).toBe(1433)
  })

  it('passes through a numeric port unchanged', () => {
    const cfg = buildConfig('sqlserver', { host: 'myhost', port: 5050, database: 'mydb' })
    expect(cfg.port).toBe(5050)
  })

  it('builds a sqlite config from filePath, ignoring server-only fields', () => {
    const cfg = buildConfig('sqlite', { filePath: '/data/app.db' })
    expect(cfg).toEqual({ type: 'sqlite', filePath: '/data/app.db' })
  })
})

// ─── resolveConnectionParams ──────────────────────────────────────────────────

describe('resolveConnectionParams', () => {
  it('uses connection string when provided', () => {
    const cfg = resolveConnectionParams('sqlite', { connectionString: 'sqlite:///my.db', filePath: 'ignored' })
    expect(cfg.filePath).toBe('my.db')
  })

  it('falls back to manual fields when connectionString is empty', () => {
    const cfg = resolveConnectionParams('sqlite', { connectionString: '', filePath: '/manual.db' })
    expect(cfg.filePath).toBe('/manual.db')
  })

  it('falls back to manual fields when connectionString is whitespace', () => {
    const cfg = resolveConnectionParams('sqlserver', {
      connectionString: '   ',
      host: 'myhost', port: 1433, database: 'mydb', user: 'sa', password: 'pass',
    })
    expect(cfg.server).toBe('myhost')
  })
})

// ─── buildConnectionString ─────────────────────────────────────────────────────

describe('buildConnectionString', () => {
  it('renders sqlserver fields as an ADO.NET-style key=value string', () => {
    const cs = buildConnectionString('sqlserver', {
      host: 'myhost', port: '1433', database: 'mydb', user: 'sa', password: 'secret',
      encrypt: true, trustServerCertificate: false,
    })
    expect(cs).toBe('Server=myhost,1433;Database=mydb;User Id=sa;Password=secret;Encrypt=true;TrustServerCertificate=false;')
  })

  it('omits database/user/password when absent', () => {
    const cs = buildConnectionString('sqlserver', { host: 'myhost', port: '1433' })
    expect(cs).toBe('Server=myhost,1433;Encrypt=true;TrustServerCertificate=false;')
  })

  it('returns the bare file path for sqlite', () => {
    expect(buildConnectionString('sqlite', { filePath: '/data/app.db' })).toBe('/data/app.db')
  })

  it('round-trips through parseConnectionString', () => {
    const fields = {
      host: 'myhost', port: '5050', database: 'mydb', user: 'sa', password: 'secret',
      encrypt: false, trustServerCertificate: true,
    }
    const cs  = buildConnectionString('sqlserver', fields)
    const cfg = parseConnectionString('sqlserver', cs)
    expect(cfg).toMatchObject({
      server: 'myhost', port: 5050, database: 'mydb', user: 'sa', password: 'secret',
      encrypt: false, trustServerCertificate: true,
    })
  })
})

// ─── Saved-connection list helpers ────────────────────────────────────────────

describe('generateConnectionId', () => {
  it('generates a non-empty string', () => {
    expect(typeof generateConnectionId()).toBe('string')
    expect(generateConnectionId().length).toBeGreaterThan(0)
  })

  it('generates distinct ids on successive calls', () => {
    expect(generateConnectionId()).not.toBe(generateConnectionId())
  })
})

describe('upsertConnection', () => {
  it('appends a new entry with a generated id when none is given', () => {
    const next = upsertConnection([], { name: 'My DB', type: 'sqlite' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ name: 'My DB', type: 'sqlite' })
    expect(typeof next[0].id).toBe('string')
  })

  it('preserves an explicit id on insert', () => {
    const next = upsertConnection([], { id: 'abc', name: 'My DB' })
    expect(next).toEqual([{ id: 'abc', name: 'My DB' }])
  })

  it('updates the existing entry in place when the id matches', () => {
    const list = [{ id: 'a', name: 'Old' }, { id: 'b', name: 'Other' }]
    const next = upsertConnection(list, { id: 'a', name: 'New' })
    expect(next).toEqual([{ id: 'a', name: 'New' }, { id: 'b', name: 'Other' }])
  })

  it('does not mutate the input list', () => {
    const list = [{ id: 'a', name: 'Old' }]
    upsertConnection(list, { id: 'a', name: 'New' })
    expect(list).toEqual([{ id: 'a', name: 'Old' }])
  })
})

describe('removeConnection', () => {
  it('removes the entry with a matching id', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    expect(removeConnection(list, 'a')).toEqual([{ id: 'b' }])
  })

  it('is a no-op when no entry matches', () => {
    const list = [{ id: 'a' }]
    expect(removeConnection(list, 'z')).toEqual([{ id: 'a' }])
  })

  it('does not mutate the input list', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    removeConnection(list, 'a')
    expect(list).toEqual([{ id: 'a' }, { id: 'b' }])
  })
})

// ─── State helpers ────────────────────────────────────────────────────────────

describe('state helpers', () => {
  let state

  beforeEach(() => { state = createInitialState() })

  it('createInitialState returns nulled-out state', () => {
    expect(state.session).toBeNull()
    expect(state.selectedTable).toBeNull()
    expect(state.tableData).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('applyConnected sets session and clears error', () => {
    const s = applyConnected(state, { type: 'sqlite', config: {}, tables: ['users', 'orders'] })
    expect(s.session.tables).toEqual(['users', 'orders'])
    expect(s.selectedTable).toBeNull()
    expect(s.error).toBeNull()
  })

  it('applyConnected carries extra fields (e.g. connectionId/name) onto session', () => {
    const s = applyConnected(state, {
      type: 'sqlserver', config: {}, tables: ['t'], connectionId: 'abc', name: 'UAT',
    })
    expect(s.session).toMatchObject({ connectionId: 'abc', name: 'UAT' })
  })

  it('applyDisconnected resets to initial state', () => {
    const withSession = applyConnected(state, { type: 'sqlite', config: {}, tables: ['t'] })
    const reset = applyDisconnected(withSession)
    expect(reset.session).toBeNull()
  })

  it('applyTableSelected sets name, clears tableData, sets tableLoading', () => {
    const s = applyTableSelected(state, 'users')
    expect(s.selectedTable).toBe('users')
    expect(s.tableData).toBeNull()
    expect(s.tableLoading).toBe(true)
  })

  it('applyTableLoaded stores columns and rows, clears tableLoading', () => {
    const loading = applyTableSelected(state, 'users')
    const loaded = applyTableLoaded(loading, { columns: ['id', 'name'], rows: [[1, 'Alice']] })
    expect(loaded.tableData.columns).toEqual(['id', 'name'])
    expect(loaded.tableData.rows).toHaveLength(1)
    expect(loaded.tableLoading).toBe(false)
  })

  it('applyRowsDeleted removes the correct rows by index', () => {
    const loaded = applyTableLoaded(applyTableSelected(state, 't'), {
      columns: ['id'],
      rows: [[1], [2], [3], [4]],
    })
    const after = applyRowsDeleted(loaded, [0, 2])
    expect(after.tableData.rows).toEqual([[2], [4]])
  })

  it('applyRowsDeleted is a no-op when tableData is null', () => {
    const after = applyRowsDeleted(state, [0])
    expect(after).toBe(state)
  })

  it('applyCellUpdated changes only the target cell', () => {
    const loaded = applyTableLoaded(applyTableSelected(state, 't'), {
      columns: ['id', 'name'],
      rows: [[1, 'Alice'], [2, 'Bob']],
    })
    const after = applyCellUpdated(loaded, { rowIndex: 1, colIndex: 1, value: 'Robert' })
    expect(after.tableData.rows[0]).toEqual([1, 'Alice'])
    expect(after.tableData.rows[1]).toEqual([2, 'Robert'])
  })

  it('applyCellUpdated does not mutate original rows', () => {
    const loaded = applyTableLoaded(applyTableSelected(state, 't'), {
      columns: ['id'], rows: [[1]],
    })
    const originalRow = loaded.tableData.rows[0]
    applyCellUpdated(loaded, { rowIndex: 0, colIndex: 0, value: 99 })
    expect(originalRow[0]).toBe(1)
  })

  it('applyError sets error message and clears loading flags', () => {
    const busy = { ...state, loading: true, tableLoading: true }
    const s = applyError(busy, 'Connection refused')
    expect(s.error).toBe('Connection refused')
    expect(s.loading).toBe(false)
    expect(s.tableLoading).toBe(false)
  })
})
