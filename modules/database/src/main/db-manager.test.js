// @vitest-environment node
//
// Tests for the db-manager IPC handler module.
// Uses an injectable fake ipcMain — no Electron process required.
// DB calls are mocked at the package boundary (better-sqlite3).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Fake ipcMain that records registered handlers ─────────────────────────────

function makeFakeIpcMain() {
  const handlers = {}
  return {
    handle(channel, fn) { handlers[channel] = fn },
    _invoke(channel, ...args) {
      if (!handlers[channel]) throw new Error(`No handler for ${channel}`)
      return handlers[channel](null, ...args)     // null = Electron event object
    },
    _handlers: handlers,
  }
}

// ── Mock better-sqlite3 ───────────────────────────────────────────────────────

const mockSqliteRows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
const mockSqliteStmt = {
  all:  vi.fn(() => mockSqliteRows),
  run:  vi.fn(() => ({ changes: 2 })),
  get:  vi.fn(),
}
const mockSqliteDb = {
  pragma:  vi.fn(),
  prepare: vi.fn(() => mockSqliteStmt),
  close:   vi.fn(),
}

// A plain constructor (not vi.fn) — `new`-ing a vi.fn mock whose
// implementation is an arrow function throws "not a constructor", since
// arrow functions can't back a `new` call.
function MockDatabase() { return mockSqliteDb }

const { register } = await import('./db-manager.cjs')

// ─────────────────────────────────────────────────────────────────────────────

describe('db-manager IPC — SQLite', () => {
  let ipc

  beforeEach(() => {
    mockSqliteDb.prepare.mockClear()
    mockSqliteStmt.all.mockClear()
    mockSqliteStmt.run.mockClear()

    ipc = makeFakeIpcMain()
    register(ipc, { drivers: { requireSqlite: () => MockDatabase } })
  })

  const cfg = { type: 'sqlite', config: { filePath: '/test/data.db' } }

  it('connect returns table list', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([{ name: 'users' }, { name: 'orders' }])
    const result = await ipc._invoke('db-manager:connect', cfg)
    expect(result.ok).toBe(true)
    expect(result.tables).toEqual(['users', 'orders'])
  })

  it('get-rows returns columns and rows', async () => {
    const result = await ipc._invoke('db-manager:get-rows', {
      ...cfg, table: 'users', limit: 100, offset: 0,
    })
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rows).toEqual([[1, 'Alice'], [2, 'Bob']])
  })

  it('get-rows rejects invalid table identifier', async () => {
    await expect(
      ipc._invoke('db-manager:get-rows', { ...cfg, table: 'users; DROP TABLE users--' }),
    ).rejects.toThrow('Invalid identifier')
  })

  it('get-rows clamps limit to 10 000', async () => {
    // SQLite binds limit/offset as query params (not string-interpolated), so
    // assert on the bound args passed to .all(), not the SQL text.
    await ipc._invoke('db-manager:get-rows', { ...cfg, table: 'users', limit: 999999, offset: 0 })
    expect(mockSqliteStmt.all).toHaveBeenLastCalledWith(10_000, 0)
  })

  it('get-rows filters by a parameterised where, binding values before limit and offset', async () => {
    await ipc._invoke('db-manager:get-rows', { ...cfg, table: 'users', where: [{ column: 'id', value: 2 }] })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toMatch(/WHERE "id" = \? LIMIT \? OFFSET \?/)
    expect(mockSqliteStmt.all).toHaveBeenLastCalledWith(2, 500, 0)
  })

  it('delete-rows calls DELETE and returns affected count', async () => {
    const result = await ipc._invoke('db-manager:delete-rows', {
      ...cfg, table: 'users', primaryKey: 'id', values: [1, 2],
    })
    expect(result.ok).toBe(true)
    expect(result.affected).toBe(2)
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/DELETE FROM "users"/)
  })

  it('delete-rows rejects empty values array', async () => {
    await expect(
      ipc._invoke('db-manager:delete-rows', { ...cfg, table: 'users', primaryKey: 'id', values: [] }),
    ).rejects.toThrow('non-empty array')
  })

  it('connect lists views with the tables, and says which are views', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([{ name: 'active_users', type: 'view' }, { name: 'users', type: 'table' }])
    const result = await ipc._invoke('db-manager:connect', cfg)
    expect(result).toEqual({ ok: true, tables: ['active_users', 'users'], views: ['active_users'] })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toMatch(/type IN \('table', 'view'\)/)
  })

  it('run-ddl creates and drops tables and views', async () => {
    for (const sql of ['CREATE TABLE [t] (\n  [id] INTEGER\n)', 'CREATE VIEW [v] AS\nSELECT 1', 'DROP TABLE [t]', 'DROP VIEW [v];']) {
      await expect(ipc._invoke('db-manager:run-ddl', { ...cfg, sql })).resolves.toEqual({ ok: true })
      expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toBe(sql)
    }
  })

  it('run-ddl refuses anything else, and more than one statement', async () => {
    await expect(ipc._invoke('db-manager:run-ddl', { ...cfg, sql: 'DELETE FROM users' })).rejects.toThrow('Only CREATE TABLE')
    await expect(ipc._invoke('db-manager:run-ddl', { ...cfg, sql: 'ALTER TABLE users ADD x INT' })).rejects.toThrow('Only CREATE TABLE')
    await expect(ipc._invoke('db-manager:run-ddl', { ...cfg, sql: 'DROP TABLE [a]; DROP TABLE [b]' })).rejects.toThrow('one statement')
    // A semicolon in a string or a bracketed name is fine.
    await expect(ipc._invoke('db-manager:run-ddl', { ...cfg, sql: "CREATE VIEW [v;1] AS SELECT ';' AS x" })).resolves.toEqual({ ok: true })
  })

  it('delete-rows matches every column of a composite key', async () => {
    await ipc._invoke('db-manager:delete-rows', {
      ...cfg, table: 'enrolment', primaryKey: ['student', 'course'], values: [[1, 'a'], [2, 'b']],
    })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toBe('DELETE FROM "enrolment" WHERE ("student" = ? AND "course" = ?) OR ("student" = ? AND "course" = ?)')
    expect(mockSqliteStmt.run).toHaveBeenLastCalledWith(1, 'a', 2, 'b')
  })

  it('delete-rows refuses a row that leaves out part of a composite key', async () => {
    await expect(ipc._invoke('db-manager:delete-rows', {
      ...cfg, table: 'enrolment', primaryKey: ['student', 'course'], values: [[1]],
    })).rejects.toThrow('every key column')
  })

  it('update-cell matches every column of a composite key, and writes a bit as 1 / 0', async () => {
    await ipc._invoke('db-manager:update-cell', {
      ...cfg, table: 'enrolment', primaryKey: ['student', 'course'], primaryValue: [1, 'a'], column: 'active', value: true,
    })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toBe('UPDATE "enrolment" SET "active" = ? WHERE "student" = ? AND "course" = ?')
    expect(mockSqliteStmt.run).toHaveBeenLastCalledWith(1, 1, 'a')
  })

  it('insert-row writes the given columns, leaving the rest to their defaults', async () => {
    const result = await ipc._invoke('db-manager:insert-row', { ...cfg, table: 'users', values: { name: 'Dee', active: false } })
    expect(result).toEqual({ ok: true, affected: 2 })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toBe('INSERT INTO "users" ("name", "active") VALUES (?, ?)')
    expect(mockSqliteStmt.run).toHaveBeenLastCalledWith('Dee', 0)
  })

  it('insert-row with no values uses DEFAULT VALUES', async () => {
    await ipc._invoke('db-manager:insert-row', { ...cfg, table: 'users', values: {} })
    expect(mockSqliteDb.prepare.mock.calls.at(-1)[0]).toBe('INSERT INTO "users" DEFAULT VALUES')
  })

  it('insert-row rejects an unsafe column name', async () => {
    await expect(ipc._invoke('db-manager:insert-row', { ...cfg, table: 'users', values: { 'x"); DROP TABLE users--': 1 } }))
      .rejects.toThrow('Invalid identifier')
  })

  it('run-query gives an empty SELECT its column names', async () => {
    const stmt = { reader: true, columns: () => [{ name: 'id' }, { name: 'name' }], raw: () => ({ all: () => [] }) }
    mockSqliteDb.prepare.mockReturnValueOnce(stmt)
    const result = await ipc._invoke('db-manager:run-query', { ...cfg, sql: 'SELECT id, name FROM users WHERE 1 = 0' })
    expect(result).toMatchObject({ columns: ['id', 'name'], rows: [], sets: [{ columns: ['id', 'name'], rows: [] }], affected: null })
  })

  it('update-cell calls UPDATE', async () => {
    const result = await ipc._invoke('db-manager:update-cell', {
      ...cfg, table: 'users', primaryKey: 'id', primaryValue: 1, column: 'name', value: 'Carol',
    })
    expect(result.ok).toBe(true)
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/UPDATE "users" SET "name"/)
  })

  it('run-query allows SELECT', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([{ id: 1 }])
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: 'SELECT * FROM users',
    })
    expect(result.columns).toEqual(['id'])
  })

  it('run-query allows INSERT', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: "INSERT INTO users (id, name) VALUES (99, 'x')",
    })
    expect(result.affected).toBe(2)
  })

  it('run-query allows UPDATE', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: "UPDATE users SET name = 'y' WHERE id = 1",
    })
    expect(result.affected).toBe(2)
  })

  it('run-query blocks unrelated statements', async () => {
    await expect(
      ipc._invoke('db-manager:run-query', { ...cfg, sql: 'DROP TABLE users' }),
    ).rejects.toThrow('Only SELECT')
  })

  it('run-query allows DELETE', async () => {
    const result = await ipc._invoke('db-manager:run-query', {
      ...cfg, sql: 'DELETE FROM users WHERE id = 99',
    })
    expect(result.affected).toBe(2)
  })

  it('get-columns returns column metadata', async () => {
    mockSqliteStmt.all.mockReturnValueOnce([
      { cid: 0, name: 'id',   type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'name', type: 'TEXT',    notnull: 0, dflt_value: null, pk: 0 },
    ])
    const result = await ipc._invoke('db-manager:get-columns', { ...cfg, table: 'users' })
    expect(result.ok).toBe(true)
    expect(result.columns).toEqual([
      // A lone INTEGER PRIMARY KEY is the rowid, filled in by SQLite like an identity column.
      { name: 'id',   dataType: 'INTEGER', isPrimaryKey: true, nullable: false, maxLength: null, precision: null, scale: null, hasDefault: true, isIdentity: true, isComputed: false },
      { name: 'name', dataType: 'TEXT',    isPrimaryKey: false, nullable: true, maxLength: null, precision: null, scale: null, hasDefault: false, isIdentity: false, isComputed: false },
    ])
    const sql = mockSqliteDb.prepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/PRAGMA table_info\("users"\)/)
  })

  it('get-columns rejects invalid table identifier', async () => {
    await expect(
      ipc._invoke('db-manager:get-columns', { ...cfg, table: 'users; DROP TABLE users--' }),
    ).rejects.toThrow('Invalid identifier')
  })

  // Answers each prepared statement by its SQL text: `routes` maps a pattern to the rows `.all()` gives.
  function routeSqlite(routes) {
    mockSqliteDb.prepare.mockImplementation((sql) => ({
      ...mockSqliteStmt,
      all: () => routes.find(([pattern]) => pattern.test(sql))?.[1] ?? [],
    }))
  }
  const restoreSqlite = () => mockSqliteDb.prepare.mockImplementation(() => mockSqliteStmt)

  it('get-structure resolves a key to the target primary key, and finds the keys that point here', async () => {
    const fk = { id: 0, seq: 0, table: 'P', from: 'pid', to: null, on_delete: 'CASCADE', on_update: 'NO ACTION' }
    routeSqlite([
      [/PRAGMA table_info\("C"\)/, [{ name: 'pid', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 }]],
      [/PRAGMA table_info\("P"\)/, [{ name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 }]],
      [/FROM sqlite_master/, [{ name: 'C' }, { name: 'P' }]],
      [/foreign_key_list\("C"\)/, [fk]],
    ])
    try {
      const child = await ipc._invoke('db-manager:get-structure', { ...cfg, table: 'C' })
      expect(child.ok).toBe(true)
      expect(child.columns.map(c => c.name)).toEqual(['pid'])
      expect(child.foreignKeys).toEqual([
        { name: 'C(pid)', columns: ['pid'], refTable: 'P', refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      ])
      expect(child.referencedBy).toEqual([])

      const parent = await ipc._invoke('db-manager:get-structure', { ...cfg, table: 'p' })
      expect(parent.foreignKeys).toEqual([])
      expect(parent.referencedBy).toEqual([
        { name: 'C(pid)', table: 'C', columns: ['pid'], refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      ])
    } finally { restoreSqlite() }
  })

  it('get-structure orders a composite key by seq and lists a self-reference both ways', async () => {
    routeSqlite([
      [/FROM sqlite_master/, [{ name: 'Node' }]],
      [/foreign_key_list\("Node"\)/, [
        { id: 0, seq: 1, table: 'Node', from: 'ps', to: 'site', on_delete: 'SET NULL', on_update: 'RESTRICT' },
        { id: 0, seq: 0, table: 'Node', from: 'pid', to: 'id', on_delete: 'SET NULL', on_update: 'RESTRICT' },
      ]],
    ])
    try {
      const result = await ipc._invoke('db-manager:get-structure', { ...cfg, table: 'Node' })
      const key = { name: 'Node(pid, ps)', columns: ['pid', 'ps'], refColumns: ['id', 'site'], onDelete: 'SET NULL', onUpdate: 'RESTRICT' }
      expect(result.foreignKeys).toEqual([{ ...key, refTable: 'Node' }])
      expect(result.referencedBy).toEqual([{ ...key, table: 'Node' }])
    } finally { restoreSqlite() }
  })

  it('get-structure reads indexes in key order and marks the primary key', async () => {
    routeSqlite([
      [/index_list\("t"\)/, [
        { seq: 0, name: 'sqlite_autoindex_t_1', unique: 1, origin: 'pk', partial: 0 },
        { seq: 1, name: 'ix_t_a', unique: 0, origin: 'c', partial: 0 },
      ]],
      [/index_xinfo\("sqlite_autoindex_t_1"\)/, [
        { seqno: 0, cid: 0, name: 'id', desc: 0, key: 1 },
        { seqno: 1, cid: -1, name: null, desc: 0, key: 0 },
      ]],
      [/index_xinfo\("ix_t_a"\)/, [
        { seqno: 1, cid: 2, name: 'b', desc: 0, key: 1 },
        { seqno: 0, cid: 1, name: 'a', desc: 1, key: 1 },
        { seqno: 2, cid: -1, name: null, desc: 0, key: 0 },
      ]],
    ])
    try {
      const result = await ipc._invoke('db-manager:get-structure', { ...cfg, table: 't' })
      expect(result.indexes).toEqual([
        { name: 'sqlite_autoindex_t_1', columns: [{ name: 'id', desc: false }], unique: true, primaryKey: true, filter: null },
        { name: 'ix_t_a', columns: [{ name: 'a', desc: true }, { name: 'b', desc: false }], unique: false, primaryKey: false, filter: null },
      ])
    } finally { restoreSqlite() }
  })

  it('get-structure rejects invalid table identifier', async () => {
    await expect(
      ipc._invoke('db-manager:get-structure', { ...cfg, table: 'users; DROP TABLE users--' }),
    ).rejects.toThrow('Invalid identifier')
  })
})

describe('identifier validation', () => {
  let ipc

  beforeEach(() => {
    ipc = makeFakeIpcMain()
    register(ipc)
  })

  const cfg = { type: 'sqlite', config: { filePath: '/test/data.db' } }

  it.each([
    ['users; DROP TABLE users--', 'SQL injection'],
    ["users'", 'single quote'],
    ['users"', 'double quote'],
    ['../etc/passwd', 'path traversal'],
  ])('rejects table name with %s', async (table) => {
    await expect(
      ipc._invoke('db-manager:get-rows', { ...cfg, table }),
    ).rejects.toThrow('Invalid identifier')
  })
})

describe('db-manager IPC — SQL Server authentication', () => {
  let ipc, connectCalls, credentials

  // Pools are cached for the process, so each test uses its own server name.
  const fakeMssql = () => ({
    connect: vi.fn(async (config) => {
      connectCalls.push(config)
      return { request: () => ({ query: async () => ({ recordset: [{ TABLE_NAME: 'users' }] }) }) }
    }),
  })

  beforeEach(() => {
    connectCalls = []
    credentials = []
    const mssql = fakeMssql()
    ipc = makeFakeIpcMain()
    register(ipc, {
      drivers: {
        requireMssql: () => mssql,
        createInteractiveCredential: (opts) => {
          const credential = { opts, getToken: vi.fn(async () => ({ token: 't', expiresOnTimestamp: Date.now() + 3600_000 })) }
          credentials.push(credential)
          return credential
        },
      },
    })
  })

  it('passes user and password for SQL authentication', async () => {
    await ipc._invoke('db-manager:connect', {
      type: 'sqlserver',
      config: { server: 'sql-auth-host', port: 1433, database: 'd', user: 'sa', password: 'pw', authentication: 'sql' },
    })
    expect(connectCalls[0]).toMatchObject({ server: 'sql-auth-host', user: 'sa', password: 'pw' })
    expect(connectCalls[0].authentication).toBeUndefined()
    expect(credentials).toHaveLength(0)
  })

  it('signs in interactively and connects with a token credential', async () => {
    const result = await ipc._invoke('db-manager:connect', {
      type: 'sqlserver',
      config: { server: 'aad-host', port: 1433, database: 'd', user: 'me@corp.com', authentication: 'azure-ad-interactive' },
    })
    expect(result.tables).toEqual(['users'])
    expect(credentials).toHaveLength(1)
    expect(credentials[0].opts).toEqual({ loginHint: 'me@corp.com' })
    // Signed in before connecting, so the browser isn't racing tedious's connect timeout.
    expect(credentials[0].getToken).toHaveBeenCalledWith('https://database.windows.net/.default')
    expect(connectCalls[0].authentication).toEqual({ type: 'token-credential', options: { credential: credentials[0] } })
    expect(connectCalls[0].user).toBeUndefined()
    expect(connectCalls[0].password).toBeUndefined()
  })

  it('reuses the signed-in account for other databases', async () => {
    const config = { server: 'aad-host-2', port: 1433, user: 'reuse@corp.com', authentication: 'azure-ad-interactive' }
    await ipc._invoke('db-manager:connect', { type: 'sqlserver', config: { ...config, database: 'a' } })
    await ipc._invoke('db-manager:connect', { type: 'sqlserver', config: { ...config, database: 'b' } })
    expect(connectCalls).toHaveLength(2)
    expect(credentials).toHaveLength(1)
  })
})

describe('db-manager IPC — SQL Server statements', () => {
  let ipc, requests, nextResult, queuedResults

  // Each request records its parameters, its SQL and whether it asked for array rows.
  // It gets the next queued result if a test queued any, else `nextResult`.
  function fakeRequest() {
    const req = { inputs: {}, sql: null, arrayRowMode: false }
    req.input = (name, value) => { req.inputs[name] = value; return req }
    req.query = async (sql) => { req.sql = sql; requests.push(req); return queuedResults.length ? queuedResults.shift() : nextResult }
    return req
  }

  beforeEach(() => {
    requests = []
    queuedResults = []
    nextResult = { recordset: [], recordsets: [], rowsAffected: [1] }
    ipc = makeFakeIpcMain()
    register(ipc, { drivers: { requireMssql: () => ({ connect: async () => ({ request: fakeRequest }) }) } })
  })

  // Pools are cached for the process, so these tests share one server name of their own.
  const cfg = { type: 'sqlserver', config: { server: 'statements-host', port: 1433, database: 'd', user: 'u', password: 'p' } }

  it('insert-row passes every value as a parameter', async () => {
    await ipc._invoke('db-manager:insert-row', { ...cfg, table: 'Setting', values: { Key: 'theme', Value: 'dark', IsOn: true } })
    expect(requests[0].sql).toBe('INSERT INTO [Setting] ([Key], [Value], [IsOn]) VALUES (@v0, @v1, @v2)')
    expect(requests[0].inputs).toEqual({ v0: 'theme', v1: 'dark', v2: true })
  })

  it('update-cell and delete-rows match every column of a composite key', async () => {
    await ipc._invoke('db-manager:update-cell', { ...cfg, table: 'T', primaryKey: ['A', 'B'], primaryValue: [1, 2], column: 'C', value: null })
    expect(requests[0].sql).toBe('UPDATE [T] SET [C] = @val WHERE [A] = @pk0 AND [B] = @pk1')
    expect(requests[0].inputs).toEqual({ val: null, pk0: 1, pk1: 2 })

    await ipc._invoke('db-manager:delete-rows', { ...cfg, table: 'T', primaryKey: 'Id', values: [5, 6] })
    expect(requests[1].sql).toBe('DELETE FROM [T] WHERE ([Id] = @v0_0) OR ([Id] = @v1_0)')
  })

  it('run-query returns every result set, with headers even when a set is empty', async () => {
    nextResult = {
      recordsets: [[], [[1, 'a'], [2, 'b']]],
      columns: [[{ index: 0, name: 'Key' }], [{ index: 1, name: 'Value' }, { index: 0, name: 'Id' }]],
      rowsAffected: [0, 2],
    }
    const result = await ipc._invoke('db-manager:run-query', { ...cfg, sql: 'SELECT [Key] FROM [Setting] WHERE 1 = 0; SELECT Id, Value FROM T' })
    expect(requests[0].arrayRowMode).toBe(true)
    expect(result.sets).toEqual([
      { columns: ['Key'], rows: [] },
      { columns: ['Id', 'Value'], rows: [[1, 'a'], [2, 'b']] },
    ])
    expect(result).toMatchObject({ columns: ['Key'], rows: [], affected: null })
  })

  it('run-query keeps both columns when two share a name', async () => {
    nextResult = { recordsets: [[[1, 9]]], columns: [{ index: 0, name: 'id' }, { index: 1, name: 'id' }], rowsAffected: [1] }
    const result = await ipc._invoke('db-manager:run-query', { ...cfg, sql: 'SELECT a.id, b.id FROM a JOIN b ON 1 = 1' })
    expect(result.sets).toEqual([{ columns: ['id', 'id'], rows: [[1, 9]] }])
  })

  it('run-query reports rows affected for a statement with no result set', async () => {
    nextResult = { recordsets: [], rowsAffected: [3] }
    const result = await ipc._invoke('db-manager:run-query', { ...cfg, sql: 'UPDATE T SET A = 1' })
    expect(result).toMatchObject({ columns: [], rows: [], sets: [], affected: 3 })
  })

  it('connect names tables outside dbo by their schema and leaves out system schemas', async () => {
    nextResult = { recordset: [
      { TABLE_SCHEMA: 'dbo', TABLE_NAME: 'Member', TABLE_TYPE: 'BASE TABLE' },
      { TABLE_SCHEMA: 'maintenance', TABLE_NAME: 'DirectDebitEmailHistory', TABLE_TYPE: 'BASE TABLE' },
      { TABLE_SCHEMA: 'Staging', TABLE_NAME: 'V_Member', TABLE_TYPE: 'VIEW' },
    ] }
    const result = await ipc._invoke('db-manager:connect', cfg)
    expect(requests[0].sql).toMatch(/TABLE_SCHEMA NOT IN \('sys', 'INFORMATION_SCHEMA'\)/)
    expect(result.tables).toEqual(['Member', 'maintenance.DirectDebitEmailHistory', 'Staging.V_Member'])
    expect(result.views).toEqual(['Staging.V_Member'])
  })

  it('get-rows filters by a parameterised where, with null as IS NULL', async () => {
    await ipc._invoke('db-manager:get-rows', { ...cfg, table: 'maintenance.Member', where: [{ column: 'BookingID', value: '9007199254740993' }, { column: 'Note', value: null }] })
    expect(requests[0].sql).toContain('FROM [maintenance].[Member]')
    expect(requests[0].sql).toContain('WHERE [BookingID] = @w0 AND [Note] IS NULL')
    expect(requests[0].sql).toContain('ORDER BY (SELECT NULL)')
    expect(requests[0].inputs).toEqual({ w0: '9007199254740993' })
  })

  it('get-rows passes a Date filter value through as the same instance', async () => {
    const when = new Date('2026-01-02T03:04:05Z')
    await ipc._invoke('db-manager:get-rows', { ...cfg, table: 'Member', where: [{ column: 'Joined', value: when }] })
    expect(requests[0].inputs.w0).toBe(when)
  })

  it('get-rows rejects an invalid where column', async () => {
    await expect(ipc._invoke('db-manager:get-rows', { ...cfg, table: 'Member', where: [{ column: 'a]; DROP', value: 1 }] })).rejects.toThrow('Invalid identifier')
  })

  it('reads and changes a table in its own schema', async () => {
    const table = 'maintenance.DirectDebitEmailHistory'
    await ipc._invoke('db-manager:get-rows', { ...cfg, table })
    expect(requests[0].sql).toContain('SELECT * FROM [maintenance].[DirectDebitEmailHistory]')
    await ipc._invoke('db-manager:insert-row', { ...cfg, table, values: { Id: 1 } })
    expect(requests[1].sql).toBe('INSERT INTO [maintenance].[DirectDebitEmailHistory] ([Id]) VALUES (@v0)')
    await ipc._invoke('db-manager:update-cell', { ...cfg, table, primaryKey: 'Id', primaryValue: 1, column: 'Sent', value: 1 })
    expect(requests[2].sql).toBe('UPDATE [maintenance].[DirectDebitEmailHistory] SET [Sent] = @val WHERE [Id] = @pk0')
    await ipc._invoke('db-manager:delete-rows', { ...cfg, table, primaryKey: 'Id', values: [1] })
    expect(requests[3].sql).toBe('DELETE FROM [maintenance].[DirectDebitEmailHistory] WHERE ([Id] = @v0_0)')
  })

  // A bare name resolves as [name] does in the row queries: the login's default schema, then dbo.
  // Matching SCHEMA_NAME() alone found no columns for a dbo table when the default schema was another.
  it('get-columns finds the table the row queries read', async () => {
    await ipc._invoke('db-manager:get-columns', { ...cfg, table: 'maintenance.updatemember' })
    expect(requests[0].inputs).toEqual({ object: '[maintenance].[updatemember]', table: 'updatemember' })
    expect(requests[0].sql).toMatch(/OBJECT_ID\(QUOTENAME\(c\.TABLE_SCHEMA\) \+ '\.' \+ QUOTENAME\(c\.TABLE_NAME\)\) = OBJECT_ID\(@object\)/)
    expect(requests[0].sql).not.toMatch(/SCHEMA_NAME\(\)/)
    // The primary key is matched within the same schema, so a namesake elsewhere can't lend or hide one.
    expect(requests[0].sql).toMatch(/pk\.TABLE_SCHEMA = c\.TABLE_SCHEMA/)
    await ipc._invoke('db-manager:get-columns', { ...cfg, table: 'Member' })
    expect(requests[1].inputs).toEqual({ object: '[Member]', table: 'Member' })
  })

  it('get-structure groups composite keys, names targets like the table list, and reads indexes', async () => {
    const own = { ownerSchema: 'dbo', ownerTable: 'Member' }
    queuedResults = [
      { recordset: [{ name: 'Id', dataType: 'int', isPrimaryKey: 1, nullable: 0, numericPrecision: 10, numericScale: 0, hasDefault: 0, isIdentity: 1, isComputed: 0 }] },
      { recordset: [
        { name: 'FK_M_B', ...own, col: 'BookingID', refSchema: 'maintenance', refTable: 'Booking', refCol: 'ID', onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
        { name: 'FK_M_B', ...own, col: 'Site', refSchema: 'maintenance', refTable: 'Booking', refCol: 'Site', onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
        { name: 'FK_M_T', ...own, col: 'TypeID', refSchema: 'dbo', refTable: 'Type', refCol: 'ID', onDelete: 'NO ACTION', onUpdate: 'SET NULL' },
      ] },
      { recordset: [
        { name: 'FK_N_M', ownerSchema: 'audit', ownerTable: 'Note', col: 'MemberID', refSchema: 'dbo', refTable: 'Member', refCol: 'Id', onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
      ] },
      { recordset: [
        { name: 'IX_A', isUnique: 1, isPrimaryKey: 0, filter: '([A]>(0))', col: 'A', isDesc: 1 },
        { name: 'PK_M', isUnique: 1, isPrimaryKey: 1, filter: null, col: 'Id', isDesc: 0 },
        { name: 'PK_M', isUnique: 1, isPrimaryKey: 1, filter: null, col: 'Site', isDesc: 0 },
      ] },
    ]
    const result = await ipc._invoke('db-manager:get-structure', { ...cfg, table: 'Member' })
    expect(result.columns.map(c => c.name)).toEqual(['Id'])
    expect(result.foreignKeys).toEqual([
      { name: 'FK_M_B', refTable: 'maintenance.Booking', columns: ['BookingID', 'Site'], refColumns: ['ID', 'Site'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      { name: 'FK_M_T', refTable: 'Type', columns: ['TypeID'], refColumns: ['ID'], onDelete: 'NO ACTION', onUpdate: 'SET NULL' },
    ])
    expect(result.referencedBy).toEqual([
      { name: 'FK_N_M', table: 'audit.Note', columns: ['MemberID'], refColumns: ['Id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
    ])
    expect(result.indexes).toEqual([
      { name: 'IX_A', columns: [{ name: 'A', desc: true }], unique: true, primaryKey: false, filter: '([A]>(0))' },
      { name: 'PK_M', columns: [{ name: 'Id', desc: false }, { name: 'Site', desc: false }], unique: true, primaryKey: true, filter: null },
    ])
    // columns, outgoing keys, incoming keys, indexes: one request each, all scoped to the same object.
    expect(requests).toHaveLength(4)
    expect(requests[1].sql).toMatch(/parent_object_id = OBJECT_ID\(@object\)/)
    expect(requests[2].sql).toMatch(/referenced_object_id = OBJECT_ID\(@object\)/)
    expect(requests.map(r => r.inputs.object)).toEqual(['[Member]', '[Member]', '[Member]', '[Member]'])
  })

  it('get-structure scopes a schema-qualified table', async () => {
    await ipc._invoke('db-manager:get-structure', { ...cfg, table: 'maintenance.Member' })
    expect(requests.map(r => r.inputs.object)).toEqual(Array(4).fill('[maintenance].[Member]'))
  })

  it.each(['a.b.c', 'maintenance.', '.Member', 'bad;schema.T'])('rejects the table name %s', async (table) => {
    await expect(ipc._invoke('db-manager:get-rows', { ...cfg, table })).rejects.toThrow('Invalid identifier')
  })

  it('get-columns reports nullability, length, precision, defaults and identity', async () => {
    nextResult = { recordset: [
      { name: 'Id', dataType: 'int', isPrimaryKey: 1, nullable: 0, maxLength: null, numericPrecision: 10, numericScale: 0, hasDefault: 0, isIdentity: 1, isComputed: 0 },
      { name: 'Price', dataType: 'decimal', isPrimaryKey: 0, nullable: 1, maxLength: null, numericPrecision: 8, numericScale: 2, hasDefault: 1, isIdentity: 0, isComputed: 0 },
      { name: 'Name', dataType: 'nvarchar', isPrimaryKey: 0, nullable: 0, maxLength: 50, numericPrecision: null, numericScale: null, hasDefault: 0, isIdentity: 0, isComputed: 0 },
    ] }
    const result = await ipc._invoke('db-manager:get-columns', { ...cfg, table: 'Product' })
    expect(result.columns).toEqual([
      { name: 'Id', dataType: 'int', isPrimaryKey: true, nullable: false, maxLength: null, precision: null, scale: null, hasDefault: false, isIdentity: true, isComputed: false },
      { name: 'Price', dataType: 'decimal', isPrimaryKey: false, nullable: true, maxLength: null, precision: 8, scale: 2, hasDefault: true, isIdentity: false, isComputed: false },
      { name: 'Name', dataType: 'nvarchar', isPrimaryKey: false, nullable: false, maxLength: 50, precision: null, scale: null, hasDefault: false, isIdentity: false, isComputed: false },
    ])
  })
})
